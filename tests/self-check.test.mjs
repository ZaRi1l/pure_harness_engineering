import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkRepository, hookDispatchDiagnostic, main as selfCheckMain } from '../scripts/self-check.mjs';
import { rolesFor } from '../scripts/route-task.mjs';
import { discoverCatalog, legacyCatalogFixture } from '../scripts/catalog.mjs';
import { RuntimeStore } from '../scripts/runtime-state.mjs';
import { fixedFixture } from './support/fixed-project-fixture.mjs';

test('unconfigured installation warns without creating project management or child checkout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-unconfigured-check-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const before = await readdir(root);
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false });
  assert.ok(report.warnings.some(item => /setup.*not.*run/i.test(item)));
  assert.ok(!report.failures.some(item => /fixed project|child Git|setup/i.test(item)));
  assert.deepEqual(await readdir(root), before);
});

test('configured installation diagnoses fixed child identity without runtime initialization', async () => {
  const f = await fixedFixture();
  const configBefore = await readFile(f.configPath, 'utf8');
  const report = await checkRepository(f.harnessRoot, { exerciseRuntime: false, exerciseHttp: false });
  assert.ok(report.checks.some(item => /fixed project.*project/i.test(item)));
  assert.ok(!report.failures.some(item => /fixed project|child Git|setup/i.test(item)));
  assert.equal(await readFile(f.configPath, 'utf8'), configBefore);
  assert.deepEqual(await readdir(path.dirname(f.configPath)), ['config.json']);
});

test('present malformed fixed config fails without repair', async () => {
  const f = await fixedFixture();
  const bytes = '{bad json';
  await writeFile(f.configPath, bytes);
  const report = await checkRepository(f.harnessRoot, { exerciseRuntime: false, exerciseHttp: false });
  assert.ok(report.failures.some(item => /fixed project.*config/i.test(item)));
  assert.equal(await readFile(f.configPath, 'utf8'), bytes);
});

test('missing child Git fails even with a valid fixed config', async () => {
  const f = await fixedFixture();
  await rename(path.join(f.projectRoot, '.git'), path.join(f.projectRoot, 'saved-git'));
  const configBefore = await readFile(f.configPath, 'utf8');
  const report = await checkRepository(f.harnessRoot, { exerciseRuntime: false, exerciseHttp: false });
  assert.ok(report.failures.some(item => /fixed project.*Git/i.test(item)));
  assert.equal(await readFile(f.configPath, 'utf8'), configBefore);
});

test('fixed management junction fails without touching target or config', async t => {
  const f = await fixedFixture();
  const target = path.join(path.dirname(f.harnessRoot), 'outside-management');
  await mkdir(target);
  await rename(path.join(f.harnessRoot, '.harness'), path.join(f.harnessRoot, '.harness-original'));
  try { await symlink(target, path.join(f.harnessRoot, '.harness'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('symlink privilege unavailable'); return; } throw error; }
  const before = await readdir(target);
  const report = await checkRepository(f.harnessRoot, { exerciseRuntime: false, exerciseHttp: false });
  assert.ok(report.failures.some(item => /fixed project.*path/i.test(item)));
  assert.deepEqual(await readdir(target), before);
  assert.ok((await readFile(path.join(f.harnessRoot, '.harness-original', 'config.json'))).length > 0);
});

test('normal CLI self-check anchors to its script installation from unrelated cwd', async () => {
  const unrelated = await mkdtemp(path.join(tmpdir(), 'pure-other-cwd-'));
  execFileSync('git', ['init', '-q'], { cwd: unrelated });
  const script = path.resolve('scripts/self-check.mjs');
  const result = spawnSync(process.execPath, [script], { cwd: unrelated, encoding: 'utf8', windowsHide: true });
  assert.match(result.stdout, /PASS Codex config exists/);
  assert.match(result.stdout, /PASS Hook config exists/);
  assert.doesNotMatch(result.stdout, /FAIL missing \.codex\/config\.toml|FAIL missing \.codex\/hooks\.json/);
});

test('unsupported installed Codex doctor is unverified, not an own-config failure', async () => {
  const report = await checkRepository(path.resolve('.'), { exerciseRuntime: false, exerciseHttp: false,
    spawnCodex: () => ({ status: 2, stdout: '', stderr: "error: unrecognized subcommand 'doctor'" }) });
  assert.ok(report.warnings.some(item => /Codex.*unsupported|Codex.*unverified/i.test(item)));
  assert.ok(!report.failures.some(item => /Codex config rejected/.test(item)));
});

test('installed Codex that ignores project config reports unverified native validation', async () => {
  const report = await checkRepository(path.resolve('.'), { exerciseRuntime: false, exerciseHttp: false,
    spawnCodex: () => ({ status: 0, stdout: '{"checks":{"config.load":{"status":"ignored"}}}', stderr: '' }) });
  assert.ok(report.warnings.some(item => /config.*ignored|config.*unverified/i.test(item)));
  assert.ok(!report.checks.includes('Codex config loads in strict mode'));
});

test('global Codex config failure is unverified while own config failure remains fatal', async () => {
  const global = await checkRepository(path.resolve('.'), { exerciseRuntime: false, exerciseHttp: false,
    spawnCodex: () => ({ status: 1, stdout: '', stderr: 'error in C:/Users/User/.codex/config.toml: invalid model' }) });
  assert.ok(global.warnings.some(item => /global Codex config/i.test(item)));
  assert.ok(!global.failures.some(item => /Codex config rejected/.test(item)));
  const own = await checkRepository(path.resolve('.'), { exerciseRuntime: false, exerciseHttp: false,
    spawnCodex: () => ({ status: 1, stdout: '', stderr: `error in ${path.resolve('.codex/config.toml')}: invalid model` }) });
  assert.ok(own.failures.some(item => /Codex config rejected/.test(item)));
});

test('own config error defeats ignored or unsupported native validation signals', async () => {
  for (const ownPath of [path.resolve('.codex/config.toml'), '.codex/config.toml']) {
    const report = await checkRepository(path.resolve('.'), { exerciseRuntime: false, exerciseHttp: false,
      spawnCodex: () => ({ status: 1, stdout: '{"checks":{"config.load":{"status":"ignored"}}}',
        stderr: `error in ${ownPath}: invalid model; unrecognized subcommand 'doctor'` }) });
    assert.ok(report.failures.some(item => /Codex config rejected/.test(item)), ownPath);
    assert.ok(!report.warnings.some(item => /native config validation is unverified/.test(item)), ownPath);
  }
});

test('routing keeps SMALL light and expands larger work', () => {
  assert.deepEqual(rolesFor('small'), ['worker']);
  assert.deepEqual(rolesFor('medium'), ['planner', 'worker', 'verifier', 'reviewer']);
  assert.ok(rolesFor('large').includes('supervisor'));
});

test('discovered role policies use only supported cost-aware defaults', () => {
  const catalog = discoverCatalog(legacyCatalogFixture(path.resolve('.')));
  assert.ok(catalog.agents.length > 0);
  for (const agent of catalog.agents) {
    assert.match(agent.model, /^gpt-6-(sol|luna)$/);
    assert.ok(['low', 'medium', 'high'].includes(agent.reasoning));
    assert.notEqual(agent.model, 'gpt-6-astra');
  }
  assert.ok(catalog.agents.every(agent => agent.source.includes('model_reasoning_effort')));
  const byId = new Map(catalog.agents.map(agent => [agent.id, agent]));
  assert.deepEqual([byId.get('planner').model, byId.get('planner').reasoning], ['gpt-6-sol', 'high']);
  assert.deepEqual([byId.get('worker').model, byId.get('worker').reasoning], ['gpt-6-sol', 'medium']);
  assert.deepEqual([byId.get('verifier').model, byId.get('verifier').reasoning], ['gpt-6-luna', 'medium']);
  assert.deepEqual([byId.get('reviewer').model, byId.get('reviewer').reasoning], ['gpt-6-sol', 'high']);
});

test('generic subagent default is Luna medium while root remains inherited', async () => {
  const config = await readFile(path.resolve('.codex/config.toml'), 'utf8');
  assert.match(config, /default_subagent_model\s*=\s*"gpt-6-luna"/);
  assert.match(config, /default_subagent_reasoning_effort\s*=\s*"medium"/);
  assert.doesNotMatch(config, /(^|\n)model\s*=/);
});

test('self-check rejects invalid config and empty hooks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-check-'));
  await mkdir(path.join(root, '.codex'));
  await writeFile(path.join(root, '.codex', 'config.toml'), '[agents\ninvalid');
  await writeFile(path.join(root, '.codex', 'hooks.json'), '{"hooks":{}}');
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some(failure => failure.includes('Codex config')));
  assert.ok(report.failures.some(failure => failure.includes('required hook event')));
});

test('self-check warns when Codex is not installed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-check-'));
  await mkdir(path.join(root, '.codex'));
  await writeFile(path.join(root, '.codex', 'config.toml'), '[features]\nhooks = true\n');
  await writeFile(path.join(root, '.codex', 'hooks.json'), '{"hooks":{}}');
  const unavailable = () => ({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }) });
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false, spawnCodex: unavailable });
  assert.ok(report.warnings.some(warning => warning.includes('Codex executable unavailable')));
});

test('self-check leaves legacy engine runtime as an explicit read fixture', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-check-'));
  const legacy = RuntimeStore.legacyFixture(root);
  await legacy.initialize();
  const before = await readFile(legacy.statusPath, 'utf8');
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false });
  assert.equal(Array.isArray(report.failures), true);
  assert.equal(await readFile(legacy.statusPath, 'utf8'), before);
});

test('self-check does not reinterpret pre-context core runtime events', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-check-'));
  const oldRuntime = path.join(root, '.ai', 'core-runtime');
  await mkdir(oldRuntime, { recursive: true });
  const oldStatus = '{"schema_version":1,"project_id":"core","agents":[]}';
  const oldEvents = '{"type":"fixture","project_id":"alpha"}\n';
  await writeFile(path.join(oldRuntime, 'status.json'), oldStatus);
  await writeFile(path.join(oldRuntime, 'events.jsonl'), oldEvents);
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false });
  assert.equal(Array.isArray(report.warnings), true);
  assert.equal(await readFile(path.join(oldRuntime, 'status.json'), 'utf8'), oldStatus);
  assert.equal(await readFile(path.join(oldRuntime, 'events.jsonl'), 'utf8'), oldEvents);
});

test('self-check serves both dashboard assets and renders the static network', async () => {
  const accepted = () => ({ status: 0, stdout: '{"checks":{"config.load":{"status":"ok"}}}', stderr: '' });
  const report = await checkRepository(path.resolve('.'), { spawnCodex: accepted });
  assert.equal(report.ok, true);
  assert.ok(report.checks.includes('Dashboard module is served'));
  assert.ok(report.checks.includes('Agent network renderer exists'));
  assert.ok(report.checks.includes('Agent network renderer is served'));
  assert.ok(report.checks.includes('Static agent network generation passes'));
});

test('self-check distinguishes observed, not-yet-observed, and suspected lifecycle dispatch', () => {
  const empty = { status: { agents: [] }, events: [] };
  assert.deepEqual(hookDispatchDiagnostic(empty), { state: 'not_yet_observed', message: 'Lifecycle hook dispatch not yet observed in current runtime' });
  const observed = { status: { agents: [] }, events: [{ type: 'hook_dispatch', data: { hook_event: 'SessionStart' } }] };
  assert.equal(hookDispatchDiagnostic(observed).state, 'observed');
  const retainedHookAgent = { status: { agents: [{ id: 'worker-1', start_source: 'hook', stop_source: 'hook' }] }, events: [] };
  assert.equal(hookDispatchDiagnostic(retainedHookAgent).state, 'observed');
  const fallback = { status: { agents: [{ id: 'worker-1', start_source: 'orchestration' }] }, events: [] };
  assert.equal(hookDispatchDiagnostic(fallback).state, 'suspected_unavailable');
});

test('self-check rejects tracked Unix and Windows absolute roots in manifests and adapters', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-absolute-path-check-'));
  const manifestDir = path.join(root, 'projects', 'alpha');
  const adapterDir = path.join(root, 'harness-adapter');
  await mkdir(manifestDir, { recursive: true });
  await mkdir(adapterDir);
  await writeFile(path.join(manifestDir, 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'alpha', paths: { tasks: ['', 'var', 'private', 'tasks'].join('/') } }));
  await writeFile(path.join(adapterDir, 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'alpha', projectRoot: ['C:', 'private', 'repo'].join('\\') }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', 'projects/alpha/project.json', 'harness-adapter/project.json'], { cwd: root });
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false });
  assert.ok(report.failures.some(item => item.includes('tracked manifest') && item.includes('absolute')));
  assert.equal(report.failures.filter(item => item.includes('tracked manifest') && item.includes('absolute')).length, 2);
  assert.doesNotMatch(JSON.stringify(report), /private/);
});

test('self-check inspects indexed manifest bytes even when worktree differs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-index-check-'));
  const directory = path.join(root, 'projects', 'alpha');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'project.json');
  await writeFile(file, JSON.stringify({ paths: { tasks: ['', 'private', 'staged'].join('/') } }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', 'projects/alpha/project.json'], { cwd: root });
  await writeFile(file, JSON.stringify({ paths: { tasks: 'projects/alpha/tasks' } }));
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false });
  assert.ok(report.failures.some(item => item.includes('tracked manifest') && item.includes('absolute')));
  assert.doesNotMatch(JSON.stringify(report), /private/);
});

test('self-check fails closed when tracked-file inventory is unavailable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-no-index-check-'));
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false });
  assert.ok(report.failures.some(item => item.includes('tracked manifest') && item.includes('unavailable')));
});

test('self-check accepts non-Git installation only with a valid explicit project binding', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-install-check-'));
  const checkoutRoot = path.join(root, 'checkout');
  const harnessRoot = path.join(root, 'installation');
  await mkdir(path.join(checkoutRoot, 'harness-adapter'), { recursive: true });
  await mkdir(harnessRoot);
  execFileSync('git', ['init', '-q'], { cwd: checkoutRoot });
  await writeFile(path.join(checkoutRoot, 'harness-adapter', 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'alpha', displayName: 'Alpha', paths: { tasks: 'projects/alpha/tasks', memory: 'projects/alpha/memory', runtime: 'projects/alpha/runtime' }, adapters: {} }));
  const bindingPath = path.join(root, 'binding.json');
  await writeFile(bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [{ projectId: 'alpha', harnessRoot, projectRoot: checkoutRoot }] }));
  const report = await checkRepository(harnessRoot, { exerciseRuntime: false, exerciseHttp: false, projectBinding: { projectId: 'alpha', checkoutRoot, bindingPath } });
  assert.ok(report.checks.some(item => item.includes('binding is valid')));
  assert.ok(report.warnings.some(item => item.includes('Legacy binding is diagnostic only')));
  assert.ok(report.warnings.some(item => item.includes('Fixed project setup has not run')));
  assert.ok(report.warnings.some(item => item.includes('non-Git installation')));
  assert.ok(!report.failures.some(item => item.includes('tracked manifest inventory unavailable')));
});

test('self-check CLI forwards explicit binding into non-Git installation check', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-install-cli-'));
  const checkoutRoot = path.join(root, 'checkout');
  const harnessRoot = path.join(root, 'installation');
  await mkdir(path.join(checkoutRoot, 'harness-adapter'), { recursive: true });
  await mkdir(harnessRoot);
  execFileSync('git', ['init', '-q'], { cwd: checkoutRoot });
  await writeFile(path.join(checkoutRoot, 'harness-adapter', 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'alpha', displayName: 'Alpha', paths: { tasks: 'projects/alpha/tasks', memory: 'projects/alpha/memory', runtime: 'projects/alpha/runtime' }, adapters: {} }));
  const bindingPath = path.join(root, 'binding.json');
  await writeFile(bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [{ projectId: 'alpha', harnessRoot, projectRoot: checkoutRoot }] }));
  const warnings = [], failures = [];
  const originalLog = console.log, originalError = console.error;
  console.log = message => { if (message.startsWith('WARN')) warnings.push(message); if (message.startsWith('FAIL')) failures.push(message); };
  console.error = message => failures.push(message);
  try { await selfCheckMain(['--project', 'alpha', '--checkout', checkoutRoot, '--binding', bindingPath], harnessRoot); }
  finally { console.log = originalLog; console.error = originalError; }
  assert.ok(warnings.some(item => item.includes('non-Git installation')));
  assert.ok(!failures.some(item => item.includes('tracked manifest inventory unavailable')));
});

test('non-Git installation self-check report and CLI exit are green with valid binding', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-complete-install-'));
  const checkoutRoot = path.join(root, 'checkout');
  const harnessRoot = path.join(root, 'installation');
  await mkdir(path.join(checkoutRoot, 'harness-adapter'), { recursive: true });
  await mkdir(harnessRoot);
  execFileSync('git', ['init', '-q'], { cwd: checkoutRoot });
  await writeFile(path.join(checkoutRoot, 'harness-adapter', 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'alpha', displayName: 'Alpha', paths: { tasks: 'projects/alpha/tasks', memory: 'projects/alpha/memory', runtime: 'projects/alpha/runtime' }, adapters: {} }));
  for (const directory of ['.codex', '.agents', 'preview']) await cp(path.resolve(directory), path.join(harnessRoot, directory), { recursive: true });
  const bindingPath = path.join(root, 'binding.json');
  await writeFile(bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [{ projectId: 'alpha', harnessRoot, projectRoot: checkoutRoot }] }));
  let codexChecks = 0;
  const spawnCodex = () => { codexChecks++; return { status: 0, stdout: '{"checks":{"config.load":{"status":"ok"}}}', stderr: '' }; };
  const projectBinding = { projectId: 'alpha', checkoutRoot, bindingPath };
  const report = await checkRepository(harnessRoot, { projectBinding, spawnCodex });
  assert.equal(report.ok, true, report.failures.join('; '));
  assert.ok(report.warnings.some(item => item.includes('non-Git installation')));
  const originalLog = console.log;
  console.log = () => {};
  let exit;
  try { exit = await selfCheckMain(['--project', 'alpha', '--checkout', checkoutRoot, '--binding', bindingPath], harnessRoot, { spawnCodex }); }
  finally { console.log = originalLog; }
  assert.equal(exit, 0);
  assert.ok(codexChecks >= 2);
});
