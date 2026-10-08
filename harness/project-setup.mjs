import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeSetupDestination, inspectSetupSource } from './source-inventory.mjs';
import { applyBridgePlan, buildBridgePlan, checkNativeBridge, rollbackNativeBridge } from './native-bridge.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const configName = '.harness/config.json';
const journalName = '.harness/setup-journal.json';
const targets = new Set(['codex', 'claude', 'opencode', 'antigravity']);
const configKeys = ['version', 'layout', 'projectPath', 'target', 'setupId', 'createdAt', 'updatedAt'];
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const iso = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

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
async function treeEntries(root, ignoredDirectories = new Set()) {
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
  return entries.sort((a, b) => a[0].localeCompare(b[0]));
}
async function treeFingerprint(root, ignoredDirectories = new Set()) { return hash(JSON.stringify(await treeEntries(root, ignoredDirectories))); }
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
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== configKeys.length || configKeys.some(key => !Object.hasOwn(data, key)) ||
      data.version !== 1 || data.layout !== 'single-project' || data.projectPath !== 'project' || !targets.has(data.target) || !uuid(data.setupId) || !iso(data.createdAt) || !iso(data.updatedAt)) throw new Error('invalid setup config');
  return { data, bytes };
}
async function setupJournal(harnessRoot) {
  const bytes = await content(path.join(harnessRoot, journalName));
  if (!bytes) return null;
  try { return JSON.parse(bytes); } catch { throw new Error('invalid setup journal; explicit recovery required'); }
}
function checkedJournal(harnessRoot, journal) {
  const stagingRoot = path.join(path.resolve(harnessRoot), '.harness/staging');
  if (!journal || journal.schemaVersion !== 1 || !uuid(journal.setupId) || !['new', 'existing', 'update'].includes(journal.mode) ||
      !['preparing', 'displacing-empty', 'publishing', 'published', 'bridge-applied', 'rollback-blocked', 'recovering', 'rolled-back'].includes(journal.phase) ||
      journal.projectRoot !== path.join(path.resolve(harnessRoot), 'project') ||
      !['absent', 'empty', 'configured'].includes(journal.destinationState) || !targets.has(journal.target) ||
      typeof journal.transaction !== 'string' || path.dirname(journal.transaction) !== stagingRoot ||
      !path.basename(journal.transaction).startsWith(`${journal.setupId}-`) || !uuid(path.basename(journal.transaction).slice(journal.setupId.length + 1)) ||
      journal.staged !== path.join(journal.transaction, 'project') || journal.displaced !== path.join(journal.transaction, 'empty-project') ||
      !(journal.stagedFingerprint === null || /^[a-f0-9]{64}$/.test(journal.stagedFingerprint)) || !Array.isArray(journal.ignoredDirectories) ||
      journal.ignoredDirectories.some(value => typeof value !== 'string' || value.includes('\\') || path.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) ||
      (journal.recoveryRecord !== undefined && journal.recoveryRecord !== path.join(path.resolve(harnessRoot), '.harness/recovery-records', `${path.basename(journal.transaction)}.json`)))
    throw new Error('invalid setup journal; manual recovery required');
  return journal;
}
async function assertOwnedPath(harnessRoot, relative) {
  const root = path.resolve(harnessRoot);
  const target = path.resolve(root, relative);
  const parts = path.relative(root, target).split(path.sep);
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..') || !target.startsWith(`${root}${path.sep}`)) throw new Error('recovery path escape');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await stat(current);
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error('recovery link or reparse point forbidden');
    const canonical = await realpath(current);
    if ((process.platform === 'win32' ? canonical.toLowerCase() : canonical) !== (process.platform === 'win32' ? current.toLowerCase() : current))
      throw new Error('recovery link or reparse escape');
  }
}
async function assertRecoveryPaths(harnessRoot, journal) {
  for (const candidate of [journal.transaction, journal.staged, journal.displaced, path.join(journal.transaction, 'recovered-project')])
    await assertOwnedPath(harnessRoot, path.relative(harnessRoot, candidate));
  await assertOwnedPath(harnessRoot, path.join('.harness', 'recovery-records'));
}
function recordFile(harnessRoot, journal) {
  return path.join(harnessRoot, '.harness/recovery-records', `${path.basename(journal.transaction)}.json`);
}
function expectedRecoveryRecord(journal, { retainProject, retainStaging }) {
  return { schemaVersion: 1, setupId: journal.setupId, transaction: journal.transaction,
    destinationState: journal.destinationState, stagedFingerprint: journal.stagedFingerprint,
    retainedProject: retainProject ? path.join(journal.transaction, 'recovered-project') : null,
    retainedStaging: retainStaging ? journal.staged : null };
}
async function readRecoveryRecord(harnessRoot, journal) {
  const file = recordFile(harnessRoot, journal);
  await assertOwnedPath(harnessRoot, path.relative(harnessRoot, file));
  const bytes = await content(file);
  if (!bytes) return null;
  let record;
  try { record = JSON.parse(bytes); } catch { throw new Error('invalid recovery record'); }
  if (JSON.stringify(record) !== JSON.stringify(expectedRecoveryRecord(journal, {
    retainProject: record.retainedProject === path.join(journal.transaction, 'recovered-project'),
    retainStaging: record.retainedStaging === journal.staged
  }))) throw new Error('recovery record drift');
  return record;
}
async function ensureRecoveryRecord(harnessRoot, journal, expected) {
  const file = path.join(harnessRoot, '.harness/recovery-records', `${path.basename(journal.transaction)}.json`);
  await assertOwnedPath(harnessRoot, path.relative(harnessRoot, file));
  const prior = await readRecoveryRecord(harnessRoot, journal);
  if (prior) {
    if (JSON.stringify(prior) !== JSON.stringify(expected)) throw new Error('recovery record drift');
  } else {
    await mkdir(path.dirname(file), { recursive: true });
    await assertOwnedPath(harnessRoot, path.relative(harnessRoot, file));
    const handle = await open(file, 'wx');
    try { await handle.writeFile(JSON.stringify(expected)); await handle.sync(); }
    finally { await handle.close(); }
  }
  return file;
}
async function verifyRetainedEvidence(harnessRoot, journal, record) {
  await assertRecoveryPaths(harnessRoot, journal);
  if (record.retainedProject) {
    if (!(await stat(record.retainedProject))?.isDirectory() ||
        await treeFingerprint(record.retainedProject, new Set(journal.ignoredDirectories)) !== journal.stagedFingerprint)
      throw new Error('retained project drift');
  }
  if (record.retainedStaging && (!(await stat(record.retainedStaging))?.isDirectory() ||
      (journal.stagedFingerprint && await treeFingerprint(record.retainedStaging, new Set(journal.ignoredDirectories)) !== journal.stagedFingerprint)))
    throw new Error('retained staging drift');
}
async function assertNoPendingJournal(harnessRoot) {
  const journal = await setupJournal(harnessRoot);
  if (!journal) return;
  checkedJournal(harnessRoot, journal);
  if (journal.phase !== 'rolled-back') throw new Error('pending setup journal; explicit recovery required');
  if (journal.recoveryRecord) {
    await assertRecoveryPaths(harnessRoot, journal);
    const record = await readRecoveryRecord(harnessRoot, journal);
    if (!record || recordFile(harnessRoot, journal) !== journal.recoveryRecord) throw new Error('missing recovery record');
    await verifyRetainedEvidence(harnessRoot, journal, record);
  }
}
async function atomic(file, bytes, { sync = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    if (sync) {
      const handle = await open(temp, 'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    } else await writeFile(temp, bytes, { flag: 'wx' });
    await rename(temp, file);
  }
  finally { await rm(temp, { force: true }); }
}
async function lock(harnessRoot, fn, { recoverStale = false } = {}) {
  const file = path.join(harnessRoot, '.harness/setup.lock');
  await mkdir(path.dirname(file), { recursive: true });
  let handle;
  try { handle = await open(file, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!recoverStale) throw new Error('setup lock exists');
    const prior = await content(file);
    let owner;
    try { owner = JSON.parse(prior); } catch { throw new Error('unverifiable setup lock; manual recovery required'); }
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !uuid(owner.token)) throw new Error('unverifiable setup lock; manual recovery required');
    try { process.kill(owner.pid, 0); throw new Error('setup lock owner is still running'); }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    if (!(await content(file))?.equals(prior)) throw new Error('setup lock changed during recovery');
    await unlink(file);
    handle = await open(file, 'wx').catch(openError => { if (openError.code === 'EEXIST') throw new Error('setup lock reacquired'); throw openError; });
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() }));
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
  await assertNoPendingJournal(harnessRoot);
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
  const stagedFiles = (await treeEntries(staged)).filter(([, value]) => value !== 'directory').map(([name]) => name);
  const plannedFiles = sourceReport.files.map(item => item.path).sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(stagedFiles) !== JSON.stringify(plannedFiles)) throw new Error('staged source file inventory changed');
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

export async function recoverProjectSetup({ harnessRoot } = {}, { beforeWrite } = {}) {
  if (typeof harnessRoot !== 'string' || !path.isAbsolute(harnessRoot)) throw new Error('absolute harness root required');
  const projectRoot = path.join(path.resolve(harnessRoot), 'project');
  await assertSafeSetupDestination({ harnessRoot, destination: projectRoot });
  return lock(harnessRoot, async () => {
    const file = path.join(harnessRoot, journalName);
    const journal = checkedJournal(harnessRoot, await setupJournal(harnessRoot));
    if (journal.phase === 'rolled-back') {
      if (journal.recoveryRecord) {
        const record = await readRecoveryRecord(harnessRoot, journal);
        if (!record) throw new Error('missing recovery record');
        await verifyRetainedEvidence(harnessRoot, journal, record);
      }
      return { phase: 'rolled-back', projectRoot, retainedStaging: journal.transaction };
    }
    if (journal.mode === 'update' || journal.phase === 'bridge-applied') throw new Error('setup journal requires manual bridge/config recovery');
    await assertRecoveryPaths(harnessRoot, journal);
    if (await content(path.join(harnessRoot, `.harness/adapters/${journal.target}.journal.json`)) ||
        await content(path.join(harnessRoot, `.harness/adapters/${journal.target}.json`)) ||
        await content(path.join(harnessRoot, configName))) throw new Error('setup journal has bridge or config state; manual recovery required');
    const retained = path.join(journal.transaction, 'recovered-project');
    const destination = await stat(projectRoot), displaced = await stat(journal.displaced), staged = await stat(journal.staged), retainedInfo = await stat(retained);
    if (destination && (!destination.isDirectory() || destination.isSymbolicLink())) throw new Error('recovery destination drift');
    if (displaced && (!displaced.isDirectory() || displaced.isSymbolicLink() || (await readdir(journal.displaced)).length)) throw new Error('displaced empty destination drift');
    if (staged && (!staged.isDirectory() || staged.isSymbolicLink())) throw new Error('staged project drift');
    if (retainedInfo && (!retainedInfo.isDirectory() || retainedInfo.isSymbolicLink())) throw new Error('retained project drift');
    let record;
    let published = false;
    if (journal.phase === 'recovering') {
      if (journal.recoveryRecord !== recordFile(harnessRoot, journal)) throw new Error('missing recovery intent');
      record = await readRecoveryRecord(harnessRoot, journal);
      if (!record) throw new Error('missing recovery record');
    } else {
      if (retainedInfo) throw new Error('unexpected retained project before recovery intent');
      published = !!(destination && journal.stagedFingerprint &&
        await treeFingerprint(projectRoot, new Set(journal.ignoredDirectories)) === journal.stagedFingerprint);
      if (published && staged) throw new Error('staged and published projects both present');
      if (!published && destination && (journal.destinationState !== 'empty' || (await readdir(projectRoot)).length || displaced))
        throw new Error('recovery destination drift');
      if (!published && !destination && journal.destinationState === 'empty' && !displaced) throw new Error('missing displaced empty destination');
      if (published && journal.destinationState === 'empty' && !displaced) throw new Error('missing displaced empty destination');
      if (journal.destinationState === 'absent' && displaced) throw new Error('unexpected displaced destination');
      record = expectedRecoveryRecord(journal, { retainProject: published, retainStaging: !!staged });
      journal.recoveryRecord = await ensureRecoveryRecord(harnessRoot, journal, record);
      await beforeWrite?.('after-record');
      journal.phase = 'recovering';
      await atomic(file, JSON.stringify(journal), { sync: true });
    }

    if (record.retainedProject) {
      if (!journal.stagedFingerprint || staged) throw new Error('invalid retained project intent');
      if (retainedInfo) {
        if (await treeFingerprint(retained, new Set(journal.ignoredDirectories)) !== journal.stagedFingerprint)
          throw new Error('retained project drift');
        if (destination && (journal.destinationState !== 'empty' || displaced || (await readdir(projectRoot)).length))
          throw new Error('both published and retained projects present');
      } else {
        if (!destination || await treeFingerprint(projectRoot, new Set(journal.ignoredDirectories)) !== journal.stagedFingerprint)
          throw new Error('published project outside drift');
        if (journal.destinationState === 'empty' && !displaced) throw new Error('missing displaced empty destination');
        if (journal.destinationState === 'absent' && displaced) throw new Error('unexpected displaced destination');
        await assertSafeSetupDestination({ harnessRoot, destination: projectRoot });
        await assertRecoveryPaths(harnessRoot, journal);
        await rename(projectRoot, retained);
        await beforeWrite?.('after-retain');
      }
    } else if (retainedInfo) throw new Error('unexpected retained project');
    if (!!record.retainedStaging !== !!staged) throw new Error('retained staging drift');
    if (journal.destinationState === 'empty' && displaced && !(await stat(projectRoot))) {
      await assertSafeSetupDestination({ harnessRoot, destination: projectRoot });
      await assertRecoveryPaths(harnessRoot, journal);
      await rename(journal.displaced, projectRoot);
      await beforeWrite?.('after-restore-empty');
    }
    if (journal.destinationState === 'empty') {
      if (!(await stat(projectRoot))?.isDirectory() || (await readdir(projectRoot)).length || await stat(journal.displaced))
        throw new Error('empty destination not restored');
    } else if (await stat(projectRoot)) throw new Error('unexpected recovered destination');
    await verifyRetainedEvidence(harnessRoot, journal, record);
    if (JSON.stringify(await readRecoveryRecord(harnessRoot, journal)) !== JSON.stringify(record)) throw new Error('recovery record drift');
    await beforeWrite?.('before-final-journal');
    journal.phase = 'rolled-back';
    await atomic(file, JSON.stringify(journal), { sync: true });
    return { phase: 'rolled-back', projectRoot, retainedStaging: journal.transaction };
  }, { recoverStale: true });
}

export async function applyProjectSetup({ harnessRoot, plan } = {}, { beforeWrite } = {}) {
  assertPlan(plan, harnessRoot);
  if (plan.conflicts.length) throw new Error('setup plan contains review conflicts');
  await assertNoPendingJournal(harnessRoot);
  return lock(harnessRoot, async () => {
    await assertNoPendingJournal(harnessRoot);
    await revalidate(harnessRoot, plan);
    const projectRoot = plan.projectRoot;
    const journalFile = path.join(harnessRoot, journalName);
    const transaction = path.join(harnessRoot, '.harness/staging', `${plan.setupId}-${randomUUID()}`);
    const staged = path.join(transaction, 'project');
    const displaced = path.join(transaction, 'empty-project');
    const journal = { schemaVersion: 1, setupId: plan.setupId, mode: plan.mode, phase: 'preparing', projectRoot,
      destinationState: plan.destinationState, target: plan.target, transaction, staged, displaced, stagedFingerprint: null, ignoredDirectories: [] };
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
          await beforeWrite?.('after-copy');
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
        journal.stagedFingerprint = stagedFingerprint;
        journal.ignoredDirectories = [...ignoredDirectories];
        if (plan.destinationState === 'empty') {
          journal.phase = 'displacing-empty'; await atomic(journalFile, JSON.stringify(journal));
          await rename(projectRoot, displaced); emptyMoved = true;
        }
        journal.phase = 'publishing'; await atomic(journalFile, JSON.stringify(journal));
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
