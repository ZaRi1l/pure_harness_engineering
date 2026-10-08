import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeSetupDestination, inspectSetupSource } from './source-inventory.mjs';
import { applyBridgePlan, buildBridgePlan, checkNativeBridge, rollbackNativeBridge } from './native-bridge.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const configName = '.harness/config.json';
const journalName = '.harness/setup-journal.json';
const targets = new Set(['codex', 'claude', 'opencode', 'antigravity']);

async function stat(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function content(file) {
  const info = await stat(file);
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`unsafe setup file: ${file}`);
  return readFile(file);
}
async function emptyDestination(root) {
  const info = await stat(root);
  if (!info) return 'absent';
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe destination');
  if ((await readdir(root)).length) throw new Error('destination must be empty');
  return 'empty';
}
async function treeFingerprint(root, ignoredDirectories = new Set()) {
  const entries = [];
  async function walk(folder, prefix = '') {
    const names = new Set();
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const folded = item.name.toLowerCase();
      if (names.has(folded)) throw new Error('case-colliding destination names');
      names.add(folded);
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      const absolute = path.join(folder, item.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error('destination link or reparse point forbidden');
      if (info.isDirectory()) { if (!ignoredDirectories.has(relative)) entries.push([relative, 'directory']); await walk(absolute, relative); }
      else if (info.isFile()) entries.push([relative, hash(await readFile(absolute))]);
      else throw new Error('non-regular destination entry');
    }
  }
  await walk(root);
  return hash(JSON.stringify(entries.sort((a, b) => a[0].localeCompare(b[0]))));
}
function git(cwd, args, { remote = false, allowFailure = false } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  for (const name of Object.keys(env)) if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|NAMESPACE|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+|CONFIG_PARAMETERS|CONFIG_GLOBAL|CONFIG_SYSTEM)$/.test(name)) delete env[name];
  for (const name of ['GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_PROXY_COMMAND', 'GIT_SSH_VARIANT', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_EXEC_PATH', 'GIT_TEMPLATE_DIR']) delete env[name];
  if (remote) { env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'; env.GIT_CONFIG_NOSYSTEM = '1'; }
  const result = spawnSync('git', args, { cwd, env, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && !allowFailure)) throw new Error(`Git acquisition failed: ${args[0]}`);
  return result.status === 0 ? result.stdout.trim() : '';
}
function digest(plan) { const { planSha256, ...body } = plan; return hash(JSON.stringify(body)); }
function bridgeSummary(plan) {
  return { nativeSmoke: 'unverified', actions: plan.actions.map(({ path: file, action, beforeSha256, afterSha256 }) => ({ path: file, action, beforeSha256, afterSha256 })),
    sourceHashes: plan.sourceHashes, conflicts: plan.actions.filter(item => item.action === 'conflict').map(item => item.path) };
}
async function readConfig(harnessRoot) {
  const bytes = await content(path.join(harnessRoot, configName));
  if (!bytes) return null;
  let data;
  try { data = JSON.parse(bytes); } catch { throw new Error('invalid setup config'); }
  if (Object.keys(data).length !== 7 || data.version !== 1 || data.layout !== 'single-project' || data.projectPath !== 'project' || !targets.has(data.target) || typeof data.setupId !== 'string') throw new Error('invalid setup config');
  return { data, bytes };
}
async function atomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
async function lock(harnessRoot, fn) {
  const file = path.join(harnessRoot, '.harness/setup.lock');
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error('setup lock exists'); throw error; });
  try { return await fn(); } finally { await handle.close(); await unlink(file); }
}
function assertPlan(plan, harnessRoot) {
  if (!plan || plan.schemaVersion !== 1 || plan.planSha256 !== digest(plan) || plan.harnessRoot !== path.resolve(harnessRoot) || plan.projectRoot !== path.join(path.resolve(harnessRoot), 'project') || !targets.has(plan.target) || !['new', 'existing', 'update'].includes(plan.mode)) throw new Error('invalid or modified setup plan');
}
async function childGit(root) {
  const dotGit = await stat(path.join(root, '.git'));
  if (!dotGit?.isDirectory() || dotGit.isSymbolicLink()) throw new Error('configured child Git required');
  if (path.resolve(git(root, ['rev-parse', '--show-toplevel'])) !== root) throw new Error('configured child Git root mismatch');
}
async function inventory({ harnessRoot, mode, source }) {
  return mode === 'existing' ? inspectSetupSource({ harnessRoot, mode, source }) : null;
}

export async function planProjectSetup({ harnessRoot, mode, source, target } = {}) {
  if (typeof harnessRoot !== 'string' || !path.isAbsolute(harnessRoot) || !targets.has(target) || !['new', 'existing', 'update'].includes(mode)) throw new Error('invalid setup request');
  const projectRoot = path.join(path.resolve(harnessRoot), 'project');
  await assertSafeSetupDestination({ harnessRoot, destination: projectRoot });
  const prior = await readConfig(harnessRoot);
  if (mode === 'update' ? !prior : !!prior) throw new Error(mode === 'update' ? 'setup config required for update' : 'setup already exists; use update');
  if (mode !== 'existing' && source !== undefined) throw new Error('source only allowed for existing mode');
  let destinationState;
  if (mode === 'update') { await childGit(projectRoot); destinationState = 'configured'; }
  else destinationState = await emptyDestination(projectRoot);
  const sourceReport = await inventory({ harnessRoot, mode, source });
  if (sourceReport?.kind === 'remote' && sourceReport.git.remotes[0].urlSha256 !== hash(sourceReport.git.remotes[0].displayUrl)) throw new Error('noncanonical remote URL unsupported');
  const sourceConflicts = [];
  if (sourceReport?.kind === 'local') {
    const worktree = git(sourceReport.canonicalSource, ['config', '--local', '--get', 'core.worktree'], { allowFailure: true });
    if (worktree && path.isAbsolute(worktree)) sourceConflicts.push('absolute core.worktree cannot be copied portably; use an ordinary primary checkout');
  }
  const setupId = prior?.data.setupId ?? randomUUID();
  const createdAt = prior?.data.createdAt ?? new Date().toISOString();
  const updatedAt = mode === 'update' ? new Date().toISOString() : createdAt;
  const inputRoot = mode === 'existing' && sourceReport.kind === 'local' ? sourceReport.canonicalSource : projectRoot;
  const bridge = mode === 'existing' && sourceReport.kind === 'remote' ? { nativeSmoke: 'unverified', actions: [], sourceHashes: null, conflicts: [], warnings: ['remote-content-not-yet-inspected'] }
    : bridgeSummary(await buildBridgePlan({ harnessRoot, projectRoot, inputRoot, target, setupId }));
  const plan = { schemaVersion: 1, harnessRoot: path.resolve(harnessRoot), projectRoot, mode, target, setupId, createdAt, updatedAt,
    source: sourceReport, destinationState, configSha256: prior ? hash(prior.bytes) : null, bridge,
    conflicts: [...sourceConflicts, ...bridge.conflicts], expectedHashes: { sourceFingerprint: sourceReport?.fingerprint ?? null, configSha256: prior ? hash(prior.bytes) : null,
      destinationState, destinationFingerprint: mode === 'update' ? await treeFingerprint(projectRoot) : null } };
  plan.planSha256 = digest(plan);
  return plan;
}

async function revalidate(harnessRoot, plan) {
  const projectRoot = plan.projectRoot;
  await assertSafeSetupDestination({ harnessRoot, destination: projectRoot });
  const prior = await readConfig(harnessRoot);
  if ((prior ? hash(prior.bytes) : null) !== plan.configSha256) throw new Error('setup config changed since planning');
  if (plan.mode === 'update') {
    await childGit(projectRoot);
    if (await treeFingerprint(projectRoot) !== plan.expectedHashes.destinationFingerprint) throw new Error('destination changed since planning');
  }
  else if (await emptyDestination(projectRoot) !== plan.destinationState) throw new Error('destination changed since planning');
  if (plan.mode === 'existing') {
    const fresh = await inspectSetupSource({ harnessRoot, mode: 'existing', source: plan.source.kind === 'local' ? plan.source.canonicalSource : plan.source.git.remotes[0].displayUrl });
    if (fresh.fingerprint !== plan.source.fingerprint) throw new Error('source fingerprint changed since planning');
  }
  if (plan.mode !== 'existing' || plan.source.kind === 'local') {
    const inputRoot = plan.mode === 'existing' ? plan.source.canonicalSource : projectRoot;
    const fresh = bridgeSummary(await buildBridgePlan({ harnessRoot, projectRoot, inputRoot, target: plan.target, setupId: plan.setupId }));
    if (JSON.stringify(fresh) !== JSON.stringify(plan.bridge)) throw new Error('bridge source or destination changed since planning');
  }
}
async function assertCopied(sourceReport, staged) {
  if (path.resolve(git(staged, ['rev-parse', '--show-toplevel'])) !== staged) throw new Error('staged Git worktree points outside destination');
  for (const file of sourceReport.files) {
    const bytes = await content(path.join(staged, ...file.path.split('/')));
    if (!bytes || hash(bytes) !== file.sha256) throw new Error(`staged source changed: ${file.path}`);
  }
  if (git(staged, ['rev-parse', 'HEAD']) !== sourceReport.git.head) throw new Error('staged Git HEAD changed');
  const refs = git(staged, ['for-each-ref', '--format=%(refname) %(objectname)']).split(/\r?\n/).filter(Boolean).map(line => { const [name, oid] = line.split(' '); return { name, oid }; });
  if (JSON.stringify(refs) !== JSON.stringify(sourceReport.git.refs)) throw new Error('staged Git refs changed');
  const remotes = git(staged, ['remote']).split(/\r?\n/).filter(Boolean);
  if (JSON.stringify(remotes) !== JSON.stringify(sourceReport.git.remotes.map(item => item.name))) throw new Error('staged Git remotes changed');
}
function equalBridgeActions(first, second) {
  return JSON.stringify(bridgeSummary(first)) === JSON.stringify(bridgeSummary(second));
}
function managedDirectories(actions) {
  const result = new Set();
  for (const item of actions) {
    const parts = item.path.split('/');
    for (let count = 1; count < parts.length; count++) result.add(parts.slice(0, count).join('/'));
  }
  return result;
}

export async function applyProjectSetup({ harnessRoot, plan } = {}, { beforeWrite } = {}) {
  assertPlan(plan, harnessRoot);
  if (plan.conflicts.length) throw new Error('setup plan contains review conflicts');
  return lock(harnessRoot, async () => {
    await revalidate(harnessRoot, plan);
    const projectRoot = plan.projectRoot;
    const journalFile = path.join(harnessRoot, journalName);
    const transaction = path.join(harnessRoot, '.harness/staging', `${plan.setupId}-${randomUUID()}`);
    const staged = path.join(transaction, 'project');
    const displaced = path.join(transaction, 'empty-project');
    const journal = { schemaVersion: 1, setupId: plan.setupId, mode: plan.mode, phase: 'preparing', projectRoot, destinationState: plan.destinationState, target: plan.target };
    let published = false, bridgeApplied = false, emptyMoved = false, configWritten = false;
    let stagedFingerprint = null, ignoredDirectories = new Set(), bridgeBefore = [], createdDirectories = [], manifestBefore = null, manifestAfterHash = null;
    await mkdir(transaction, { recursive: true });
    await atomic(journalFile, JSON.stringify(journal));
    try {
      let stageBridge = null;
      if (plan.mode !== 'update') {
        if (plan.mode === 'new') {
          await mkdir(staged);
          git(staged, ['init', '--initial-branch=main']);
        } else if (plan.source.kind === 'local') {
          await cp(plan.source.canonicalSource, staged, { recursive: true, force: false, errorOnExist: true });
          await assertCopied(plan.source, staged);
        } else {
          const url = plan.source.git.remotes[0].displayUrl;
          const safeGit = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always'];
          if (git(transaction, [...safeGit, 'ls-remote', '--get-url', url], { remote: true }) !== url) throw new Error('remote URL rewrite or transport forbidden');
          const emptyTemplate = path.join(transaction, 'git-template');
          await mkdir(emptyTemplate);
          git(transaction, [...safeGit, '-c', `core.hooksPath=${emptyTemplate}`, 'clone', '--no-checkout', `--template=${emptyTemplate}`, url, staged], { remote: true });
          if (git(staged, ['rev-parse', 'HEAD']) !== plan.source.git.head) throw new Error('remote HEAD changed since planning');
          git(staged, [...safeGit, '-c', `core.hooksPath=${emptyTemplate}`, 'checkout', '--detach', plan.source.git.head], { remote: true });
        }
        stageBridge = await buildBridgePlan({ harnessRoot, projectRoot, inputRoot: staged, target: plan.target, setupId: plan.setupId });
        ignoredDirectories = managedDirectories(stageBridge.actions);
        if (stageBridge.actions.some(item => item.action === 'conflict')) throw new Error('staged bridge review conflict; plan from a local checkout');
        if (plan.mode !== 'existing' || plan.source.kind === 'local') {
          if (!equalBridgeActions(stageBridge, { actions: plan.bridge.actions, sourceHashes: plan.bridge.sourceHashes })) throw new Error('staged bridge differs from reviewed plan');
        }
        await beforeWrite?.('after-staging');
        await revalidate(harnessRoot, plan);
        stagedFingerprint = await treeFingerprint(staged, ignoredDirectories);
        if (plan.destinationState === 'empty') { await rename(projectRoot, displaced); emptyMoved = true; }
        await rename(staged, projectRoot); published = true;
        journal.phase = 'published'; await atomic(journalFile, JSON.stringify(journal));
        await beforeWrite?.('after-publish');
      }
      const canonical = await buildBridgePlan({ harnessRoot, projectRoot, target: plan.target, setupId: plan.setupId });
      if (stageBridge && !equalBridgeActions(stageBridge, canonical)) throw new Error('canonical bridge differs from staged preview');
      if (!stageBridge && !equalBridgeActions(canonical, { actions: plan.bridge.actions, sourceHashes: plan.bridge.sourceHashes })) throw new Error('bridge changed since planning');
      if (plan.mode === 'update') {
        for (const item of canonical.actions.filter(item => item.action !== 'unchanged')) {
          bridgeBefore.push({ path: item.path, before: await content(path.join(projectRoot, ...item.path.split('/'))), afterSha256: item.afterSha256 });
        }
        for (const relative of [...managedDirectories(canonical.actions)].sort((a, b) => a.split('/').length - b.split('/').length)) {
          if (!(await stat(path.join(projectRoot, ...relative.split('/'))))) createdDirectories.push(relative);
        }
        manifestBefore = await content(path.join(harnessRoot, `.harness/adapters/${plan.target}.json`));
      }
      const bridgeResult = await applyBridgePlan({ harnessRoot, plan: canonical }, { beforeWrite: file => beforeWrite?.(`bridge:${file}`) });
      bridgeApplied = true;
      if (plan.mode === 'update') manifestAfterHash = hash(await readFile(path.join(harnessRoot, `.harness/adapters/${plan.target}.json`)));
      journal.phase = 'bridge-applied'; await atomic(journalFile, JSON.stringify(journal));
      const config = { version: 1, layout: 'single-project', projectPath: 'project', target: plan.target, setupId: plan.setupId, createdAt: plan.createdAt, updatedAt: plan.updatedAt };
      await beforeWrite?.('before-config');
      if (plan.mode === 'update') await atomic(path.join(transaction, 'prior-config'), (await readConfig(harnessRoot)).bytes);
      await atomic(path.join(harnessRoot, configName), `${JSON.stringify(config, null, 2)}\n`);
      configWritten = true;
      if (JSON.stringify((await readConfig(harnessRoot)).data) !== JSON.stringify(config)) throw new Error('config verification failed');
      const verification = await checkNativeBridge({ harnessRoot, projectRoot, target: plan.target });
      if (!verification.ok) throw new Error('bridge verification failed');
      await rm(journalFile, { force: true });
      await rm(transaction, { recursive: true, force: true });
      return { projectRoot, setupId: plan.setupId, target: plan.target, changedPaths: bridgeResult.changedPaths, verification, nativeSmoke: 'unverified' };
    } catch (error) {
      let rollbackError = null;
      try {
        if (configWritten) {
          const configFile = path.join(harnessRoot, configName);
          const current = await content(configFile);
          const expected = hash(Buffer.from(`${JSON.stringify({ version: 1, layout: 'single-project', projectPath: 'project', target: plan.target, setupId: plan.setupId, createdAt: plan.createdAt, updatedAt: plan.updatedAt }, null, 2)}\n`));
          if (!current || hash(current) !== expected) throw new Error('config drift during rollback');
          if (plan.mode === 'update') {
            await atomic(configFile, await readFile(path.join(transaction, 'prior-config')));
          } else await unlink(configFile);
        }
        if (bridgeApplied && plan.mode === 'update') {
          const manifestFile = path.join(harnessRoot, `.harness/adapters/${plan.target}.json`);
          const currentManifest = await content(manifestFile);
          if (!currentManifest || hash(currentManifest) !== manifestAfterHash) throw new Error('adapter manifest drift during rollback');
          for (const item of bridgeBefore) {
            const file = path.join(projectRoot, ...item.path.split('/'));
            const current = await content(file);
            if ((current ? hash(current) : null) !== item.afterSha256) throw new Error(`bridge path drift during rollback: ${item.path}`);
          }
          for (const item of [...bridgeBefore].reverse()) {
            const file = path.join(projectRoot, ...item.path.split('/'));
            if (item.before) await atomic(file, item.before); else await unlink(file);
          }
          if (manifestBefore) await atomic(manifestFile, manifestBefore); else await unlink(manifestFile);
        } else if (bridgeApplied) await rollbackNativeBridge({ harnessRoot, projectRoot, target: plan.target, setupId: plan.setupId });
        if (plan.mode === 'update') for (const relative of [...createdDirectories].reverse()) {
          const directory = path.join(projectRoot, ...relative.split('/'));
          if (await stat(directory)) await rmdir(directory);
        }
        if (published) {
          if (!(await stat(projectRoot))?.isDirectory()) throw new Error('published project drift');
          if (await treeFingerprint(projectRoot, ignoredDirectories) !== stagedFingerprint) throw new Error('published project outside drift');
          await rename(projectRoot, path.join(transaction, 'failed-project'));
        } else if (plan.mode === 'update' && await treeFingerprint(projectRoot) !== plan.expectedHashes.destinationFingerprint) throw new Error('configured project outside drift');
        if (emptyMoved) await rename(displaced, projectRoot);
      } catch (failure) { rollbackError = failure; }
      journal.phase = rollbackError ? 'rollback-blocked' : 'rolled-back';
      journal.error = error.message;
      if (rollbackError) journal.rollbackError = rollbackError.message;
      await atomic(journalFile, JSON.stringify(journal));
      if (!rollbackError) await rm(transaction, { recursive: true, force: true });
      throw new Error(rollbackError ? `${error.message}; rollback refused: ${rollbackError.message}` : error.message);
    }
  });
}
