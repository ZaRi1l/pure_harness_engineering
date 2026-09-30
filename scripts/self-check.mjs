#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPreviewServer } from './preview-server.mjs';
import { RuntimeStore, findRoot } from './runtime-state.mjs';
import { discoverCatalog, legacyCatalogFixture } from './catalog.mjs';
import { hookDispatchDiagnostic, inspectRuntime } from './watchdog.mjs';
import { renderStaticPreview } from './generate-preview.mjs';
import { inspectProjectBinding } from './project-diagnostic.mjs';

const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop'];
const MODEL = /^gpt-6-(sol|luna)$/;
const EFFORT = new Set(['low', 'medium', 'high']);
export { hookDispatchDiagnostic };

function reportObject() {
  return { checks: [], warnings: [], failures: [], get ok() { return this.failures.length === 0; }, require(condition, success, failure) { (condition ? this.checks : this.failures).push(condition ? success : failure); } };
}

function basicTomlShape(text) {
  return text.split(/\r?\n/).every(line => { const value = line.trim(); return !value.startsWith('[') || /^\[[^\[\]]+\]$/.test(value); });
}

function trackedManifestChecks(root, report) {
  const listing = spawnSync('git', ['ls-files', '-z', '--cached'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (listing.status !== 0) { report.failures.push('tracked manifest inventory unavailable'); return; }
  const files = listing.stdout.split('\0').filter(file => /(^|\/)project\.json$/.test(file) && (file.startsWith('projects/') || file === 'harness-adapter/project.json'));
  const isAbsolute = value => typeof value === 'string' && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
  const containsAbsolute = value => isAbsolute(value) || (value && typeof value === 'object' && Object.values(value).some(containsAbsolute));
  for (const file of files) {
    try {
      const indexed = spawnSync('git', ['show', `:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true });
      if (indexed.status !== 0) throw new Error('indexed content unavailable');
      const manifest = JSON.parse(indexed.stdout);
      report.require(!containsAbsolute(manifest), `Tracked manifest ${file} contains no absolute path`, `tracked manifest ${file} contains absolute path`);
    } catch {
      report.failures.push(`tracked manifest ${file} is unreadable or invalid JSON`);
    }
  }
}

function validateCodex(root, text, executableOverride, spawnCodex = spawnSync) {
  if (!basicTomlShape(text)) return [false, 'Codex config has invalid TOML table syntax'];
  const executable = executableOverride || (process.platform === 'win32' ? 'codex.exe' : 'codex');
  const result = spawnCodex(executable, ['--strict-config', 'doctor', '--json'], { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.error) return result.error.code === 'EPERM'
    ? [null, `Codex config validation blocked by the current sandbox: ${result.error.message}`]
    : [null, `Codex executable unavailable: ${result.error.message}`];
  try { const payload = JSON.parse(result.stdout); if (payload.checks?.['config.load']?.status === 'ok') return [true, '']; }
  catch {}
  return [false, `Codex config rejected: ${(result.stderr || result.stdout || 'unknown error').slice(0, 500)}`];
}

export async function checkRepository(root, { exerciseRuntime = true, exerciseHttp = true, codexExecutable, spawnCodex, projectBinding } = {}) {
  root = path.resolve(root); const report = reportObject(), configPath = path.join(root, '.codex', 'config.toml'), hooksPath = path.join(root, '.codex', 'hooks.json');
  if (projectBinding !== undefined) {
    const diagnostic = await inspectProjectBinding(projectBinding);
    report.require(diagnostic.ok, `Project ${diagnostic.projectId} binding is valid`, `project binding ${diagnostic.code}: ${diagnostic.message}`);
  }
  trackedManifestChecks(root, report);
  report.require(Number(process.versions.node.split('.')[0]) >= 20, 'Node.js 20+ is available', 'Node.js 20+ is required');
  report.require(existsSync(configPath), 'Codex config exists', 'missing .codex/config.toml'); report.require(existsSync(hooksPath), 'Hook config exists', 'missing .codex/hooks.json');
  if (existsSync(hooksPath)) {
    try {
      const hookMap = JSON.parse(readFileSync(hooksPath, 'utf8')).hooks; report.require(hookMap && typeof hookMap === 'object', 'Hook JSON parses', 'hooks.json lacks hooks object');
      if (hookMap && typeof hookMap === 'object') for (const event of HOOK_EVENTS) { const groups = hookMap[event], handlers = Array.isArray(groups) ? groups.flatMap(group => Array.isArray(group?.hooks) ? group.hooks : []) : []; const valid = handlers.length > 0 && handlers.every(handler => handler.type === 'command' && handler.command && handler.commandWindows); report.require(valid, `Hook event ${event} is configured`, `missing or invalid required hook event: ${event}`); }
    } catch (error) { report.failures.push(`invalid hooks.json: ${error.message}`); }
  }
  const core = RuntimeStore.coreContext({ engineRoot: root, runtimeRoot: path.join(root, '.ai', 'core-runtime', 'context-v1') });
  const runtimeStatusPath = path.join(core.paths.runtime, 'status.json');
  const dispatch = existsSync(runtimeStatusPath) ? hookDispatchDiagnostic(await new RuntimeStore(core).readSnapshot()) : hookDispatchDiagnostic({ status: { agents: [] }, events: [] });
  if (dispatch.state === 'observed') report.checks.push(dispatch.message);
  else report.warnings.push(dispatch.message);
  if (existsSync(configPath)) {
    const text = readFileSync(configPath, 'utf8'), [valid, detail] = validateCodex(root, text, codexExecutable, spawnCodex);
    if (valid === null) report.warnings.push(detail); else report.require(valid, 'Codex config loads in strict mode', detail);
    report.require(!/(^|\n)\s*model\s*=/.test(text), 'Root model is not hardcoded', 'project config hardcodes the root model');
    const defaultModel = text.match(/(?:^|\n)default_subagent_model\s*=\s*"([^"]+)"/)?.[1], defaultEffort = text.match(/(?:^|\n)default_subagent_reasoning_effort\s*=\s*"([^"]+)"/)?.[1]; report.require(MODEL.test(defaultModel || '') && EFFORT.has(defaultEffort), 'Default subagent policy is valid', 'invalid default subagent model or reasoning effort');
    const agentCatalog = discoverCatalog(core); report.require(agentCatalog.agents.length > 0, 'Agent catalog is discoverable', 'no agent declarations found');
    for (const agent of agentCatalog.agents) { const agentPath = path.join(root, '.codex', agent.path.replace(/^\.\//, '')); const exists = existsSync(agentPath); report.require(exists, `Agent ${agent.id} exists`, `missing agent config: ${agent.id}`); if (exists) { const contents = readFileSync(agentPath, 'utf8'); report.require(basicTomlShape(contents) && ['name', 'description', 'developer_instructions'].every(key => new RegExp(`(^|\\n)${key}\\s*=`).test(contents)), `Agent ${agent.id} has required fields`, `agent ${agent.id} lacks required fields`); report.require(MODEL.test(agent.model) && EFFORT.has(agent.reasoning) && agent.model !== 'gpt-6-astra', `Agent ${agent.id} has a valid role policy`, `agent ${agent.id} has invalid model or reasoning policy`); } }
    report.warnings.push('Model entitlement was not verified; configured models must be available to the active Codex account');
  }
  const skillCatalog = discoverCatalog(core); report.require(skillCatalog.skills.length > 0, 'Skill catalog is discoverable', 'no skills found'); for (const skill of skillCatalog.skills) report.require(skill.valid && skill.name === skill.id, `Skill ${skill.id} is discoverable`, `missing or invalid skill: ${skill.id}`);
  report.require(existsSync(path.join(root, '.agents', 'skills', 'task-routing', 'profiles.md')), 'Project profiles exist', 'missing task-routing profiles reference');
  const dashboardPath = path.join(root, 'preview', 'index.html'), dashboardModulePath = path.join(root, 'preview', 'artifact-tabs.js'), liveModulePath = path.join(root, 'preview', 'dashboard.js'), preferencesPath = path.join(root, 'preview', 'preferences.js'), networkPath = path.join(root, 'preview', 'agent-network.js');
  const dashboardExists = existsSync(dashboardPath), dashboardModuleExists = existsSync(dashboardModulePath), liveModuleExists = existsSync(liveModulePath), preferencesExist = existsSync(preferencesPath), networkExists = existsSync(networkPath);
  report.require(dashboardExists, 'Dashboard exists', 'missing preview/index.html');
  report.require(dashboardModuleExists, 'Dashboard module exists', 'missing preview/artifact-tabs.js');
  report.require(liveModuleExists, 'Live dashboard renderer exists', 'missing preview/dashboard.js');
  report.require(preferencesExist, 'Preview preferences renderer exists', 'missing preview/preferences.js');
  report.require(networkExists, 'Agent network renderer exists', 'missing preview/agent-network.js');
  if (exerciseRuntime) {
    const temporary = await mkdtemp(path.join(tmpdir(), 'pure-self-check-')); await mkdir(path.join(temporary, 'preview'));
    if (dashboardExists) await copyFile(dashboardPath, path.join(temporary, 'preview', 'index.html'));
    if (dashboardModuleExists) await copyFile(dashboardModulePath, path.join(temporary, 'preview', 'artifact-tabs.js'));
    if (liveModuleExists) await copyFile(liveModulePath, path.join(temporary, 'preview', 'dashboard.js'));
    if (preferencesExist) await copyFile(preferencesPath, path.join(temporary, 'preview', 'preferences.js'));
    if (networkExists) await copyFile(networkPath, path.join(temporary, 'preview', 'agent-network.js'));
    const store = RuntimeStore.legacyFixture(temporary, { eventLimit: 10 }); await store.initialize(); await store.setGoal('Mock SMALL task', 'execution'); await store.upsertTask('small-1', 'Make one change', 'completed', 'worker'); await store.agentStarted('mock-planner', 'planner', 'Plan MEDIUM task'); await store.agentStopped('mock-planner', 'completed'); await store.setVerification('passed', 'mock-check', 'exit 0'); await store.claim('mock-worker', ['src/mock/']); const state = await store.readStatus();
    report.require(JSON.stringify(state.progress) === JSON.stringify({ completed: 1, total: 1 }), 'Runtime mock transitions pass', 'runtime derived progress is incorrect'); report.require(state.active_agents.length === 0 && state.signals.length === 2, 'Agent lifecycle and signals pass', 'agent lifecycle state is incorrect'); await store.upsertTask('orphan', 'Orphan test', 'pending', 'missing-agent'); const warnings = inspectRuntime(await store.readSnapshot()); report.require(warnings.some(item => item.id === 'unknown-owner-orphan'), 'Watchdog mock transition passes', 'watchdog smoke test failed'); await store.upsertTask('orphan', 'Orphan test', 'cancelled', 'missing-agent'); const staticHtml = renderStaticPreview(await store.readSnapshot(), [], { agents: [] }, networkExists ? readFileSync(networkPath, 'utf8') : '', preferencesExist ? readFileSync(preferencesPath, 'utf8') : ''); report.require(staticHtml.includes('Write Claims'), 'Static preview generation passes', 'static preview generation failed'); report.require(networkExists && staticHtml.includes('Agent Signal Network') && staticHtml.includes('Snapshot History'), 'Static agent network generation passes', 'static agent network generation failed');
      if (exerciseHttp) { const server = await createPreviewServer(legacyCatalogFixture(temporary)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); try { const port = server.address().port, html = await (await fetch(`http://127.0.0.1:${port}/`)).text(), moduleResponse = await fetch(`http://127.0.0.1:${port}/preview/artifact-tabs.js`), moduleSource = await moduleResponse.text(), liveResponse = await fetch(`http://127.0.0.1:${port}/preview/dashboard.js`), liveSource = await liveResponse.text(), preferencesResponse = await fetch(`http://127.0.0.1:${port}/preview/preferences.js`), preferencesSource = await preferencesResponse.text(), payload = await (await fetch(`http://127.0.0.1:${port}/runtime/snapshot`)).json(), networkResponse = await fetch(`http://127.0.0.1:${port}/preview/agent-network.js`), networkSource = await networkResponse.text(); report.require(html.includes('preview-preferences') && liveSource.includes('section.warnings') && preferencesSource.includes('Watchdog Warnings') && payload.status.current_goal === 'Mock SMALL task' && payload.status.task_counts.total === payload.tasks.tasks.length && payload.claims.claims.length === 1, 'Dashboard serves a consistent runtime snapshot', 'dashboard snapshot smoke test failed'); report.require(moduleResponse.ok && liveResponse.ok && preferencesResponse.ok && /text\/javascript/.test(moduleResponse.headers.get('content-type') || '') && moduleSource.includes('renderArtifactTabs') && liveSource.includes('PreviewPreferences') && preferencesSource.includes('PreviewPreferences'), 'Dashboard module is served', 'dashboard module smoke test failed'); report.require(networkResponse.ok && /text\/javascript/.test(networkResponse.headers.get('content-type') || '') && networkSource.includes('AgentSignalNetwork'), 'Agent network renderer is served', 'agent network renderer smoke test failed'); } finally { await new Promise(resolve => server.close(resolve)); } }
  }
  return report;
}

export async function main() { const report = await checkRepository(findRoot()); for (const item of report.checks) console.log(`PASS ${item}`); for (const item of report.warnings) console.log(`WARN ${item}`); for (const item of report.failures) console.log(`FAIL ${item}`); return report.ok ? 0 : 1; }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
