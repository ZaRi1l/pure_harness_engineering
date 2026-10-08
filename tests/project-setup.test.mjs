import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planProjectSetup, applyProjectSetup, recoverProjectSetup } from '../harness/project-setup.mjs';

const engine = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const exists = async file => !!(await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; }));

async function fixture(t, emptyDestination = false) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'project-setup-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const harnessRoot = path.join(base, 'harness');
  await mkdir(harnessRoot);
  await cp(path.join(engine, 'harness/agents'), path.join(harnessRoot, 'harness/agents'), { recursive: true });
  await cp(path.join(engine, '.agents/skills'), path.join(harnessRoot, '.agents/skills'), { recursive: true });
  await cp(path.join(engine, 'harness/compatibility.json'), path.join(harnessRoot, 'harness/compatibility.json'));
  if (emptyDestination) await mkdir(path.join(harnessRoot, 'project'));
  return { base, harnessRoot, projectRoot: path.join(harnessRoot, 'project') };
}

async function sourceFixture(t, f) {
  const source = path.join(f.base, 'source');
  await mkdir(source);
  git(source, 'init', '-q');
  git(source, 'config', 'user.name', 'Fixture');
  git(source, 'config', 'user.email', 'fixture@example.test');
  await writeFile(path.join(source, '.gitignore'), 'ignored.txt\n');
  await writeFile(path.join(source, 'README.md'), 'committed\n');
  git(source, 'add', '.'); git(source, 'commit', '-qm', 'first');
  await writeFile(path.join(source, 'README.md'), 'dirty\n');
  await writeFile(path.join(source, 'untracked.txt'), 'untracked\n');
  await writeFile(path.join(source, 'ignored.txt'), 'ignored\n');
  git(source, 'remote', 'add', 'origin', 'https://example.test/product.git');
  return source;
}

test('new plan is read-only, metadata-only, and apply creates isolated child Git plus exact config', async t => {
  const f = await fixture(t);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'codex' });
  assert.equal(await exists(path.join(f.harnessRoot, '.harness')), false);
  assert.equal(await exists(f.projectRoot), false);
  assert.equal(plan.mode, 'new');
  assert.equal(JSON.stringify(plan).includes('afterBase64'), false);
  assert.equal(plan.conflicts.length, 0);
  const result = await applyProjectSetup({ harnessRoot: f.harnessRoot, plan });
  assert.equal(path.resolve(git(f.projectRoot, 'rev-parse', '--show-toplevel')).toLowerCase(), f.projectRoot.toLowerCase());
  assert.equal(git(f.projectRoot, 'remote'), '');
  assert.equal(result.nativeSmoke, 'unverified');
  const config = JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/config.json')));
  assert.deepEqual(Object.keys(config), ['version', 'layout', 'projectPath', 'target', 'setupId', 'createdAt', 'updatedAt']);
  assert.equal(config.projectPath, 'project');
  assert.equal(config.setupId, plan.setupId);
});

test('existing local apply preserves complete Git metadata, dirty, untracked, ignored, and source bytes', async t => {
  const f = await fixture(t);
  const source = await sourceFixture(t, f);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'existing', source, target: 'claude' });
  const sourceReport = plan.source;
  await applyProjectSetup({ harnessRoot: f.harnessRoot, plan });
  for (const name of ['README.md', 'untracked.txt', 'ignored.txt'])
    assert.equal(sha(await readFile(path.join(f.projectRoot, name))), sha(await readFile(path.join(source, name))));
  assert.equal(git(f.projectRoot, 'rev-parse', 'HEAD'), sourceReport.git.head);
  assert.equal(git(f.projectRoot, 'remote', 'get-url', 'origin'), git(source, 'remote', 'get-url', 'origin'));
  assert.equal(git(f.projectRoot, 'status', '--short', '--untracked-files=all').includes('README.md'), true);
  assert.equal(await readFile(path.join(source, 'README.md'), 'utf8'), 'dirty\n');
  assert.equal(sourceReport.files.find(item => item.path === 'ignored.txt').gitClass, 'ignored');
});

test('existing Codex source with user AGENTS, TOML, and hooks uses canonical post-publish bridge plan', async t => {
  const f = await fixture(t);
  const source = await sourceFixture(t, f);
  await mkdir(path.join(source, '.codex'));
  const agents = '# Product instructions\nKeep customer rules.\n';
  const toml = '# customer comment\n[other]\nkey = "keep"\n';
  const hooks = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo customer' }] }], CustomEvent: [] } };
  await writeFile(path.join(source, 'AGENTS.md'), agents);
  await writeFile(path.join(source, '.codex/config.toml'), toml);
  await writeFile(path.join(source, '.codex/hooks.json'), JSON.stringify(hooks));
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'existing', source, target: 'codex' });
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.bridge.actions.find(item => item.path === 'AGENTS.md').beforeSha256, sha(Buffer.from(agents)));
  const result = await applyProjectSetup({ harnessRoot: f.harnessRoot, plan });
  assert.equal(result.verification.ok, true);
  assert.ok((await readFile(path.join(f.projectRoot, 'AGENTS.md'), 'utf8')).startsWith(agents));
  assert.ok((await readFile(path.join(f.projectRoot, '.codex/config.toml'), 'utf8')).startsWith(toml));
  const merged = JSON.parse(await readFile(path.join(f.projectRoot, '.codex/hooks.json'), 'utf8'));
  assert.deepEqual(merged.hooks.SessionStart[0], hooks.hooks.SessionStart[0]);
  assert.deepEqual(merged.hooks.CustomEvent, hooks.hooks.CustomEvent);
  assert.equal(await readFile(path.join(source, 'AGENTS.md'), 'utf8'), agents);
  assert.equal(await readFile(path.join(source, '.codex/config.toml'), 'utf8'), toml);
  assert.deepEqual(JSON.parse(await readFile(path.join(source, '.codex/hooks.json'), 'utf8')), hooks);
});

test('tampered plan, changed source, and nonempty destination fail before publish', async t => {
  const f = await fixture(t);
  const source = await sourceFixture(t, f);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'existing', source, target: 'claude' });
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan: { ...plan, target: 'codex' } }), /plan|digest|modified/i);
  await writeFile(path.join(source, 'README.md'), 'later\n');
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }), /source|changed|fingerprint/i);
  assert.equal(await exists(f.projectRoot), false);
  const newer = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'existing', source, target: 'claude' });
  await mkdir(f.projectRoot); await writeFile(path.join(f.projectRoot, 'user.txt'), 'keep');
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan: newer }), /destination|empty|changed/i);
  assert.equal(await readFile(path.join(f.projectRoot, 'user.txt'), 'utf8'), 'keep');
});

test('failure after publish restores previous empty directory and leaves no configured child', async t => {
  const f = await fixture(t, true);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'codex' });
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }, {
    beforeWrite: phase => { if (phase === 'after-publish') throw new Error('injected publish failure'); }
  }), /injected publish failure/);
  assert.deepEqual(await readdir(f.projectRoot), []);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/config.json')), false);
  await applyProjectSetup({ harnessRoot: f.harnessRoot, plan });
  assert.equal(await exists(path.join(f.projectRoot, '.git')), true);
});

test('bridge write failure rolls back published child and retains recoverable setup journal', async t => {
  const f = await fixture(t);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'codex' });
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }, {
    beforeWrite: phase => { if (phase.startsWith('bridge:')) throw new Error('injected bridge failure'); }
  }), /injected bridge failure/);
  assert.equal(await exists(f.projectRoot), false);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/config.json')), false);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/setup-journal.json')), true);
});

test('update retains setup identity and prior config until final commit', async t => {
  const f = await fixture(t);
  const first = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  await applyProjectSetup({ harnessRoot: f.harnessRoot, plan: first });
  const configPath = path.join(f.harnessRoot, '.harness/config.json');
  const original = await readFile(configPath);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'update', target: 'opencode' });
  assert.equal(plan.setupId, first.setupId);
  assert.equal(plan.createdAt, first.createdAt);
  assert.deepEqual(await readFile(configPath), original);
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }, {
    beforeWrite: phase => { if (phase === 'before-config') throw new Error('injected final commit failure'); }
  }), /injected final commit failure/);
  assert.deepEqual(await readFile(configPath), original);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/adapters/opencode.json')), false);
  const result = await applyProjectSetup({ harnessRoot: f.harnessRoot, plan });
  assert.equal(result.target, 'opencode');
  const updated = JSON.parse(await readFile(configPath));
  assert.equal(updated.setupId, first.setupId);
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.target, 'opencode');
});

test('update requires child Git and rejects edited configured child before apply', async t => {
  const f = await fixture(t);
  await mkdir(f.projectRoot);
  await assert.rejects(planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'update', target: 'codex' }), /config/i);
  const first = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  await applyProjectSetup({ harnessRoot: f.harnessRoot, plan: first });
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'update', target: 'codex' });
  await writeFile(path.join(f.projectRoot, 'AGENTS.md'), 'outside edit\n');
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }), /bridge|changed|drift/i);
});

test('absolute source core.worktree is a plan conflict and never publishes', async t => {
  const f = await fixture(t);
  const source = await sourceFixture(t, f);
  git(source, 'config', '--local', 'core.worktree', source);
  const before = await readFile(path.join(source, '.git/config'));
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'existing', source, target: 'claude' });
  assert.match(plan.conflicts.join(' '), /core\.worktree.*primary checkout/i);
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }), /conflict/i);
  assert.deepEqual(await readFile(path.join(source, '.git/config')), before);
  assert.equal(await exists(f.projectRoot), false);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/config.json')), false);
});

test('outside write after publish blocks rollback without overwriting that write', async t => {
  const f = await fixture(t);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }, {
    beforeWrite: async phase => {
      if (phase === 'after-publish') {
        await writeFile(path.join(f.projectRoot, 'outside.txt'), 'external bytes\n');
        throw new Error('injected outside drift');
      }
    }
  }), /rollback refused.*outside drift/i);
  assert.equal(await readFile(path.join(f.projectRoot, 'outside.txt'), 'utf8'), 'external bytes\n');
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/config.json')), false);
  const journal = JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/setup-journal.json')));
  assert.equal(journal.phase, 'rollback-blocked');
});

test('partial bridge failure on target update restores previous child and config without stray directories', async t => {
  const f = await fixture(t);
  const first = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  await applyProjectSetup({ harnessRoot: f.harnessRoot, plan: first });
  const oldConfig = await readFile(path.join(f.harnessRoot, '.harness/config.json'));
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'update', target: 'opencode' });
  let bridgeWrites = 0;
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }, {
    beforeWrite: phase => { if (phase.startsWith('bridge:') && ++bridgeWrites === 2) throw new Error('injected partial update'); }
  }), /injected partial update/);
  assert.deepEqual(await readFile(path.join(f.harnessRoot, '.harness/config.json')), oldConfig);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/adapters/opencode.json')), false);
  assert.equal(await exists(path.join(f.projectRoot, '.opencode')), false);
  assert.equal(JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/setup-journal.json'))).phase, 'rolled-back');
});

test('pending setup journal blocks both planning and Apply without overwriting recovery evidence', async t => {
  const f = await fixture(t);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const journalPath = path.join(f.harnessRoot, '.harness/setup-journal.json');
  await mkdir(path.dirname(journalPath), { recursive: true });
  const evidence = Buffer.from(JSON.stringify({ schemaVersion: 1, setupId: plan.setupId, phase: 'rollback-blocked', projectRoot: f.projectRoot }));
  await writeFile(journalPath, evidence);
  await assert.rejects(planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' }), /journal|recover/i);
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }), /journal|recover/i);
  assert.deepEqual(await readFile(journalPath), evidence);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/setup.lock')), false);
  assert.equal(await exists(f.projectRoot), false);
});

test('explicit recovery restores an empty child displaced before publish and permits retry', async t => {
  const f = await fixture(t, true);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const transaction = path.join(f.harnessRoot, '.harness/staging', `${plan.setupId}-${randomUUID()}`);
  const displaced = path.join(transaction, 'empty-project');
  await mkdir(transaction, { recursive: true });
  await import('node:fs/promises').then(fs => fs.rename(f.projectRoot, displaced));
  const journalPath = path.join(f.harnessRoot, '.harness/setup-journal.json');
  await writeFile(journalPath, JSON.stringify({ schemaVersion: 1, setupId: plan.setupId, mode: 'new', phase: 'displacing-empty',
    projectRoot: f.projectRoot, destinationState: 'empty', target: 'claude', transaction, staged: path.join(transaction, 'project'), displaced,
    stagedFingerprint: null, ignoredDirectories: [] }));
  await assert.rejects(planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' }), /journal|recover/i);
  const result = await recoverProjectSetup({ harnessRoot: f.harnessRoot });
  assert.equal(result.phase, 'rolled-back');
  assert.deepEqual(await readdir(f.projectRoot), []);
  assert.equal(JSON.parse(await readFile(journalPath)).phase, 'rolled-back');
  await applyProjectSetup({ harnessRoot: f.harnessRoot, plan });
  assert.equal(await exists(path.join(f.projectRoot, '.git')), true);
});

test('crash after publish requires explicit recovery and refuses outside drift', async t => {
  const f = await fixture(t, true);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const moduleUrl = new URL('../harness/project-setup.mjs', import.meta.url).href;
  const code = `import { applyProjectSetup } from ${JSON.stringify(moduleUrl)}; await applyProjectSetup(${JSON.stringify({ harnessRoot: f.harnessRoot, plan })}, { beforeWrite: phase => { if (phase === 'after-publish') process.exit(86); } });`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 86, child.stderr);
  const journalPath = path.join(f.harnessRoot, '.harness/setup-journal.json');
  const journal = JSON.parse(await readFile(journalPath));
  assert.equal(journal.phase, 'published');
  assert.equal(await exists(journal.displaced), true);
  assert.equal(await exists(f.projectRoot), true);
  await assert.rejects(planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' }), /journal|recover/i);
  await writeFile(path.join(f.projectRoot, 'outside.txt'), 'external');
  await assert.rejects(recoverProjectSetup({ harnessRoot: f.harnessRoot }), /outside drift|destination drift/i);
  assert.equal(await readFile(path.join(f.projectRoot, 'outside.txt'), 'utf8'), 'external');
  await rm(path.join(f.projectRoot, 'outside.txt'));
  const result = await recoverProjectSetup({ harnessRoot: f.harnessRoot });
  assert.equal(result.phase, 'rolled-back');
  assert.deepEqual(await readdir(f.projectRoot), []);
  assert.equal(await exists(path.join(journal.transaction, 'recovered-project/.git')), true);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/config.json')), false);
  await applyProjectSetup({ harnessRoot: f.harnessRoot, plan });
  assert.equal(await exists(path.join(f.projectRoot, '.git')), true);
  assert.equal(await exists(path.join(journal.transaction, 'recovered-project/.git')), true);
  const recordPath = path.join(f.harnessRoot, '.harness/recovery-records', `${path.basename(journal.transaction)}.json`);
  const record = JSON.parse(await readFile(recordPath));
  assert.equal(record.retainedProject, path.join(journal.transaction, 'recovered-project'));
  assert.equal(await exists(record.retainedProject), true);
});

test('recovery refuses a junction-swapped transaction without moving the published project outside core', async t => {
  const f = await fixture(t, true);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const moduleUrl = new URL('../harness/project-setup.mjs', import.meta.url).href;
  const code = `import { applyProjectSetup } from ${JSON.stringify(moduleUrl)}; await applyProjectSetup(${JSON.stringify({ harnessRoot: f.harnessRoot, plan })}, { beforeWrite: phase => { if (phase === 'after-publish') process.exit(86); } });`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true }).status, 86);
  const journalPath = path.join(f.harnessRoot, '.harness/setup-journal.json');
  const journalBytes = await readFile(journalPath);
  const journal = JSON.parse(journalBytes);
  const outside = path.join(f.base, 'outside-transaction');
  await rename(journal.transaction, outside);
  await symlink(outside, journal.transaction, process.platform === 'win32' ? 'junction' : 'dir');
  const outsideBefore = await readdir(outside);
  await writeFile(path.join(outside, 'sentinel.txt'), 'untouched outside');
  await assert.rejects(recoverProjectSetup({ harnessRoot: f.harnessRoot }), /link|junction|reparse|escape|unsafe/i);
  assert.deepEqual(await readFile(journalPath), journalBytes);
  assert.deepEqual((await readdir(outside)).sort((a, b) => a.localeCompare(b)), [...outsideBefore, 'sentinel.txt'].sort((a, b) => a.localeCompare(b)));
  assert.equal(await readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'untouched outside');
  assert.equal(await exists(path.join(outside, 'recovered-project')), false);
  assert.equal(await exists(path.join(f.projectRoot, '.git')), true);
});

test('recovery refuses a junction-swapped record directory before retaining published bytes', async t => {
  const f = await fixture(t, true);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const moduleUrl = new URL('../harness/project-setup.mjs', import.meta.url).href;
  const code = `import { applyProjectSetup } from ${JSON.stringify(moduleUrl)}; await applyProjectSetup(${JSON.stringify({ harnessRoot: f.harnessRoot, plan })}, { beforeWrite: phase => { if (phase === 'after-publish') process.exit(86); } });`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true }).status, 86);
  const journalPath = path.join(f.harnessRoot, '.harness/setup-journal.json');
  const journalBefore = await readFile(journalPath);
  const outside = path.join(f.base, 'outside-records');
  await mkdir(outside);
  await writeFile(path.join(outside, 'sentinel.txt'), 'outside bytes');
  await symlink(outside, path.join(f.harnessRoot, '.harness/recovery-records'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(recoverProjectSetup({ harnessRoot: f.harnessRoot }), /link|junction|reparse|escape|unsafe/i);
  assert.deepEqual(await readFile(journalPath), journalBefore);
  assert.deepEqual(await readdir(outside), ['sentinel.txt']);
  assert.equal(await readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside bytes');
  assert.equal(await exists(path.join(f.projectRoot, '.git')), true);
});

test('conflicting recovery record blocks before moving the published child', async t => {
  const f = await fixture(t, true);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const moduleUrl = new URL('../harness/project-setup.mjs', import.meta.url).href;
  const code = `import { applyProjectSetup } from ${JSON.stringify(moduleUrl)}; await applyProjectSetup(${JSON.stringify({ harnessRoot: f.harnessRoot, plan })}, { beforeWrite: phase => { if (phase === 'after-publish') process.exit(86); } });`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true }).status, 86);
  const journalPath = path.join(f.harnessRoot, '.harness/setup-journal.json');
  const before = await readFile(journalPath);
  const journal = JSON.parse(before);
  const recordPath = path.join(f.harnessRoot, '.harness/recovery-records', `${path.basename(journal.transaction)}.json`);
  await mkdir(path.dirname(recordPath), { recursive: true });
  await writeFile(recordPath, '{"foreign":true}');
  await assert.rejects(recoverProjectSetup({ harnessRoot: f.harnessRoot }), /record|collision|drift/i);
  assert.deepEqual(await readFile(journalPath), before);
  assert.equal(await readFile(recordPath, 'utf8'), '{"foreign":true}');
  assert.equal(await exists(path.join(f.projectRoot, '.git')), true);
  assert.equal(await exists(journal.displaced), true);
  assert.equal(await exists(path.join(journal.transaction, 'recovered-project')), false);
});

test('crash after empty destination restore resumes recovery from durable intent', async t => {
  const f = await fixture(t, true);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const moduleUrl = new URL('../harness/project-setup.mjs', import.meta.url).href;
  const applyCode = `import { applyProjectSetup } from ${JSON.stringify(moduleUrl)}; await applyProjectSetup(${JSON.stringify({ harnessRoot: f.harnessRoot, plan })}, { beforeWrite: phase => { if (phase === 'after-publish') process.exit(86); } });`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', applyCode], { encoding: 'utf8', windowsHide: true }).status, 86);
  const recoverCode = `import { recoverProjectSetup } from ${JSON.stringify(moduleUrl)}; await recoverProjectSetup(${JSON.stringify({ harnessRoot: f.harnessRoot })}, { beforeWrite: phase => { if (phase === 'after-restore-empty') process.exit(87); } });`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', recoverCode], { encoding: 'utf8', windowsHide: true }).status, 87);
  const journal = JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/setup-journal.json')));
  assert.equal(journal.phase, 'recovering');
  assert.deepEqual(await readdir(f.projectRoot), []);
  assert.equal(await exists(path.join(journal.transaction, 'recovered-project/.git')), true);
  const recordPath = path.join(f.harnessRoot, '.harness/recovery-records', `${path.basename(journal.transaction)}.json`);
  assert.equal(JSON.parse(await readFile(recordPath)).retainedProject, path.join(journal.transaction, 'recovered-project'));
  const result = await recoverProjectSetup({ harnessRoot: f.harnessRoot });
  assert.equal(result.phase, 'rolled-back');
  await applyProjectSetup({ harnessRoot: f.harnessRoot, plan });
  assert.equal(await exists(path.join(journal.transaction, 'recovered-project/.git')), true);
});

test('recovery write error after retaining project is safely resumable', async t => {
  const f = await fixture(t, true);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const moduleUrl = new URL('../harness/project-setup.mjs', import.meta.url).href;
  const applyCode = `import { applyProjectSetup } from ${JSON.stringify(moduleUrl)}; await applyProjectSetup(${JSON.stringify({ harnessRoot: f.harnessRoot, plan })}, { beforeWrite: phase => { if (phase === 'after-publish') process.exit(86); } });`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', applyCode], { encoding: 'utf8', windowsHide: true }).status, 86);
  await assert.rejects(recoverProjectSetup({ harnessRoot: f.harnessRoot }, {
    beforeWrite: phase => { if (phase === 'after-retain') throw new Error('injected recovery write error'); }
  }), /injected recovery write error/);
  const journal = JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/setup-journal.json')));
  assert.equal(journal.phase, 'recovering');
  assert.equal(await exists(f.projectRoot), false);
  assert.equal(await exists(path.join(journal.transaction, 'recovered-project/.git')), true);
  assert.equal(await exists(journal.displaced), true);
  assert.equal((await recoverProjectSetup({ harnessRoot: f.harnessRoot })).phase, 'rolled-back');
  assert.deepEqual(await readdir(f.projectRoot), []);
  assert.equal(await exists(path.join(journal.transaction, 'recovered-project/.git')), true);
});

for (const phase of ['after-record', 'before-final-journal']) {
  test(`recovery resumes after process crash at ${phase}`, async t => {
    const f = await fixture(t, true);
    const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
    const moduleUrl = new URL('../harness/project-setup.mjs', import.meta.url).href;
    const applyCode = `import { applyProjectSetup } from ${JSON.stringify(moduleUrl)}; await applyProjectSetup(${JSON.stringify({ harnessRoot: f.harnessRoot, plan })}, { beforeWrite: step => { if (step === 'after-publish') process.exit(86); } });`;
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', applyCode], { encoding: 'utf8', windowsHide: true }).status, 86);
    const recoverCode = `import { recoverProjectSetup } from ${JSON.stringify(moduleUrl)}; await recoverProjectSetup(${JSON.stringify({ harnessRoot: f.harnessRoot })}, { beforeWrite: step => { if (step === ${JSON.stringify(phase)}) process.exit(87); } });`;
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', recoverCode], { encoding: 'utf8', windowsHide: true }).status, 87);
    const journalPath = path.join(f.harnessRoot, '.harness/setup-journal.json');
    const interrupted = JSON.parse(await readFile(journalPath));
    assert.equal(interrupted.phase, phase === 'after-record' ? 'published' : 'recovering');
    assert.equal(await exists(path.join(f.harnessRoot, '.harness/recovery-records', `${path.basename(interrupted.transaction)}.json`)), true);
    assert.equal((await recoverProjectSetup({ harnessRoot: f.harnessRoot })).phase, 'rolled-back');
    assert.deepEqual(await readdir(f.projectRoot), []);
    assert.equal(await exists(path.join(interrupted.transaction, 'recovered-project/.git')), true);
  });
}

test('extra staged local file introduced during copy fails before canonical publish', async t => {
  const f = await fixture(t);
  const source = await sourceFixture(t, f);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'existing', source, target: 'claude' });
  await assert.rejects(applyProjectSetup({ harnessRoot: f.harnessRoot, plan }, {
    beforeWrite: async phase => {
      if (phase !== 'after-copy') return;
      const journal = JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/setup-journal.json')));
      const transient = path.join(source, 'transient-extra.txt');
      await writeFile(transient, 'unreviewed');
      await cp(transient, path.join(journal.staged, 'transient-extra.txt'));
      await rm(transient);
    }
  }), /staged|inventory|unreviewed/i);
  assert.equal(await exists(f.projectRoot), false);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness/config.json')), false);
});

test('malformed seven-key prior configs reject update planning before any write', async t => {
  const f = await fixture(t);
  const first = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  await applyProjectSetup({ harnessRoot: f.harnessRoot, plan: first });
  const configPath = path.join(f.harnessRoot, '.harness/config.json');
  const valid = JSON.parse(await readFile(configPath));
  for (const malformed of [
    { ...valid, createdAt: 'not-a-date' },
    { ...valid, setupId: 'not-a-uuid' },
    { ...valid, unknown: true, updatedAt: undefined },
  ]) {
    await writeFile(configPath, JSON.stringify(malformed));
    const before = await readFile(configPath);
    await assert.rejects(planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'update', target: 'codex' }), /invalid setup config/i);
    assert.deepEqual(await readFile(configPath), before);
  }
});
