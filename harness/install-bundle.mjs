import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TARGETS = new Set(['codex', 'claude', 'opencode', 'antigravity']);
const STATE = 'harness-adapter/install-state.json';
const LOCK = 'harness-adapter/install.lock';
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HEX = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const parts = relative => relative.split('/');
const inside = (root, relative) => path.join(root, ...parts(relative));
const exists = async file => { try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.includes(':') || path.isAbsolute(value)
      || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw new Error(`invalid path: ${String(value)}`);
  return value;
}
async function assertNoSymlinks(root, relative, leafRequired = false) {
  let current = root;
  for (const [index, part] of parts(relative).entries()) {
    current = path.join(current, part);
    const entry = await exists(current);
    if (entry?.isSymbolicLink()) throw new Error(`symlink forbidden: ${relative}`);
    if (index < parts(relative).length - 1 && entry && !entry.isDirectory()) throw new Error(`non-directory ancestor: ${relative}`);
    if (index === parts(relative).length - 1 && leafRequired && !entry?.isFile()) throw new Error(`missing regular file: ${relative}`);
  }
}
async function assertRoot(root, name) {
  if (!path.isAbsolute(root) || !(await exists(root))?.isDirectory()) throw new Error(`${name} must be an absolute existing directory`);
  if (await realpath(root) !== path.resolve(root)) throw new Error(`${name} symlink forbidden`);
}
function validateEntry(entry, manifest) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid bundle entry');
  const relative = safeRelative(entry.path);
  if (!HEX.test(entry.sha256)) throw new Error(`invalid hash: ${relative}`);
  if (!['role', 'skill', 'registry'].includes(entry.kind)) throw new Error(`invalid kind: ${relative}`);
  if (entry.kind === 'role') {
    if (!ID.test(entry.roleId) || !manifest.roleIds.includes(entry.roleId) || !manifest.targets.includes(entry.target) || !HEX.test(entry.sourceSha256)
        || entry.sourcePath !== `harness/agents/${entry.roleId}.md`) throw new Error(`invalid role metadata: ${relative}`);
    const expected = { codex: `.codex/agents/${entry.roleId}.toml`, claude: `.claude/agents/${entry.roleId}.md`,
      opencode: `.opencode/agents/${entry.roleId}.md`, antigravity: `.agents/agents/${entry.roleId}/agent.md` }[entry.target];
    if (relative !== expected) throw new Error(`role path not allowed: ${relative}`);
  } else if (entry.kind === 'skill') {
    if (!ID.test(entry.skillId) || !manifest.skillIds.includes(entry.skillId)) throw new Error(`invalid skill metadata: ${relative}`);
    const sourcePrefix = `.agents/skills/${entry.skillId}/`;
    const source = safeRelative(entry.sourcePath);
    if (!source.startsWith(sourcePrefix) || !HEX.test(entry.sourceSha256)) throw new Error(`invalid skill source: ${relative}`);
    const resource = source.slice(sourcePrefix.length);
    if (!resource || source === sourcePrefix || entry.sourceSha256 !== entry.sha256) throw new Error(`invalid skill hash: ${relative}`);
    if (entry.target === undefined) {
      if (relative !== source) throw new Error(`canonical skill path not allowed: ${relative}`);
    } else if (entry.target !== 'claude' || !manifest.targets.includes('claude') || relative !== `.claude/skills/${entry.skillId}/${resource}`) {
      throw new Error(`native skill path not allowed: ${relative}`);
    }
  } else if (relative !== '.codex/config.toml' || entry.target !== 'codex' || !manifest.targets.includes('codex')
      || entry.roleId !== undefined || entry.skillId !== undefined) throw new Error(`registry path not allowed: ${relative}`);
}
async function listFiles(root, base = '') {
  const output = [];
  for (const dirent of await readdir(inside(root, base || '.'), { withFileTypes: true })) {
    const name = base ? `${base}/${dirent.name}` : dirent.name;
    safeRelative(name);
    if (dirent.isSymbolicLink()) throw new Error(`symlink forbidden: ${name}`);
    if (dirent.isDirectory()) output.push(...await listFiles(root, name));
    else if (dirent.isFile()) output.push(name);
    else throw new Error(`unsupported file type: ${name}`);
  }
  return output;
}
async function loadBundle(bundleRoot) {
  await assertRoot(bundleRoot, 'bundle');
  await assertNoSymlinks(bundleRoot, 'bundle-manifest.json', true);
  const manifestBytes = await readFile(inside(bundleRoot, 'bundle-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest?.schemaVersion !== 1 || manifest.generator !== 'pure-harness-candidate-export' || manifest.status !== 'unverified'
      || !['core', 'all'].includes(manifest.profile) || !Array.isArray(manifest.targets) || !manifest.targets.length
      || manifest.targets.some(id => !TARGETS.has(id)) || new Set(manifest.targets).size !== manifest.targets.length
      || !Array.isArray(manifest.roleIds) || manifest.roleIds.some(id => !ID.test(id)) || new Set(manifest.roleIds).size !== manifest.roleIds.length
      || !Array.isArray(manifest.skillIds) || manifest.skillIds.some(id => !ID.test(id)) || new Set(manifest.skillIds).size !== manifest.skillIds.length
      || !Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error('invalid bundle manifest');
  const keys = new Set();
  const validatedBytes = new Map();
  for (const entry of manifest.entries) {
    validateEntry(entry, manifest);
    const key = entry.path.toLowerCase();
    if (keys.has(key)) throw new Error(`case collision: ${entry.path}`);
    keys.add(key);
    await assertNoSymlinks(bundleRoot, entry.path, true);
    const bytes = await readFile(inside(bundleRoot, entry.path));
    if (digest(bytes) !== entry.sha256) throw new Error(`bundle hash mismatch: ${entry.path}`);
    validatedBytes.set(entry.path, bytes);
  }
  const found = await listFiles(bundleRoot);
  const expected = new Set(['bundle-manifest.json', ...manifest.entries.map(entry => entry.path)]);
  if (found.length !== expected.size || found.some(name => !expected.has(name))) throw new Error('bundle contains unlisted files');
  return { manifest, manifestHash: digest(manifestBytes), validatedBytes };
}
async function assertGitRoot(projectRoot) {
  await assertRoot(projectRoot, 'project');
  let gitRoot;
  try { gitRoot = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Error('project must be an existing Git root'); }
  if (path.resolve(gitRoot).toLowerCase() !== path.resolve(projectRoot).toLowerCase()) throw new Error('project must be exact Git root');
}
async function assertDisposable(projectRoot, owned = []) {
  const remotes = execFileSync('git', ['-C', projectRoot, 'remote'], { encoding: 'utf8' }).trim();
  if (remotes) throw new Error('trial requires disposable Git checkout with no remotes');
  const files = await listFiles(projectRoot);
  const ownedPaths = new Set([STATE, LOCK, ...owned]);
  for (const file of files) {
    if (file === '.git' || file.startsWith('.git/')) continue;
    if (ownedPaths.has(file)) continue;
    if (['README.md', '.gitignore', 'probe.txt'].includes(file)) continue;
    throw new Error(`trial requires disposable checkout; found ${file}`);
  }
}
async function loadState(projectRoot) {
  const file = inside(projectRoot, STATE);
  await assertNoSymlinks(projectRoot, STATE);
  const info = await exists(file);
  if (!info) return null;
  if (!info.isFile()) throw new Error('invalid installer state');
  const state = JSON.parse(await readFile(file, 'utf8'));
  if (state?.schemaVersion !== 1 || !['applying', 'active', 'rolling-back'].includes(state.phase) || !HEX.test(state.manifestHash)
      || !Array.isArray(state.entries) || state.entries.some(entry => !entry || !safeRelative(entry.path) || !HEX.test(entry.sha256))) throw new Error('invalid installer state');
  return state;
}
async function saveState(projectRoot, state) {
  const file = inside(projectRoot, STATE);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, file); } catch (error) { await rm(temporary, { force: true }); throw error; }
}
async function assertInstalled(projectRoot, entries, allowMissing = false) {
  for (const entry of entries) {
    await assertNoSymlinks(projectRoot, entry.path);
    const file = inside(projectRoot, entry.path);
    const info = await exists(file);
    if (!info && allowMissing) continue;
    if (!info?.isFile() || digest(await readFile(file)) !== entry.sha256) throw new Error(`installed file modified or mismatch: ${entry.path}`);
  }
}
async function preflight(projectRoot, entries, state) {
  const owned = new Map(state?.entries.map(entry => [entry.path, entry.sha256]) || []);
  if (state?.phase !== undefined && state.phase !== 'active') throw new Error('partial install state; rollback required');
  if (state) await assertInstalled(projectRoot, state.entries);
  const actions = [];
  for (const entry of entries) {
    await assertNoSymlinks(projectRoot, entry.path);
    const info = await exists(inside(projectRoot, entry.path));
    if (info && (!info.isFile() || owned.get(entry.path) !== entry.sha256)) throw new Error(`existing user-owned path: ${entry.path}`);
    if (!info) actions.push(entry.path);
  }
  return actions;
}
async function withLock(projectRoot, action) {
  const dir = inside(projectRoot, 'harness-adapter');
  await assertNoSymlinks(projectRoot, 'harness-adapter');
  await mkdir(dir, { recursive: true });
  const file = inside(projectRoot, LOCK);
  const lock = await open(file, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error('installer lock exists; inspect before retry'); throw error; });
  try { return await action(); } finally { await lock.close(); await unlink(file); }
}
export async function installBundle({ bundleRoot, projectRoot, mode = 'plan', trial = false } = {}) {
  if (!['plan', 'apply', 'check', 'rollback'].includes(mode)) throw new Error('invalid install mode');
  if (typeof bundleRoot !== 'string' || typeof projectRoot !== 'string') throw new Error('bundle and project absolute paths required');
  await assertGitRoot(projectRoot);
  const bundle = await loadBundle(bundleRoot);
  const verifiedState = async () => {
    const state = await loadState(projectRoot);
    if (state && (state.manifestHash !== bundle.manifestHash
        || state.entries.length !== bundle.manifest.entries.length
        || state.entries.some((entry, index) => entry.path !== bundle.manifest.entries[index].path || entry.sha256 !== bundle.manifest.entries[index].sha256))) {
      throw new Error('installer state and bundle mismatch; refusing ownership');
    }
    return state;
  };
  const prepareApply = async state => {
    const actions = await preflight(projectRoot, bundle.manifest.entries, state);
    if (!trial) throw new Error('bundle unverified; apply refused without disposable --trial');
    await assertDisposable(projectRoot, state?.entries.map(entry => entry.path));
    return actions;
  };
  const execute = async () => {
    const state = await verifiedState();
    if (mode === 'rollback') {
      if (!state) throw new Error('no installer-owned state to rollback');
      await assertInstalled(projectRoot, state.entries, state.phase !== 'active');
      if (state.phase === 'active') await saveState(projectRoot, { ...state, phase: 'rolling-back' });
      for (const entry of [...state.entries].reverse()) {
        const file = inside(projectRoot, entry.path);
        if (await exists(file)) await unlink(file);
      }
      await unlink(inside(projectRoot, STATE));
      return { ok: true, actions: state.entries.map(entry => entry.path) };
    }
    if (mode === 'check') {
      if (!state || state.phase !== 'active') throw new Error('bundle not actively installed');
      await assertInstalled(projectRoot, state.entries);
      return { ok: true, actions: [] };
    }
    const actions = mode === 'plan' ? await preflight(projectRoot, bundle.manifest.entries, state) : await prepareApply(state);
    if (mode === 'plan') return { ok: true, actions, status: bundle.manifest.status };
    if (!actions.length) return { ok: true, actions: [] };
    const next = { schemaVersion: 1, phase: 'applying', manifestHash: bundle.manifestHash,
      entries: bundle.manifest.entries.map(({ path, sha256 }) => ({ path, sha256 })) };
    await saveState(projectRoot, next);
    for (const relative of actions) {
      const target = inside(projectRoot, relative);
      await assertNoSymlinks(projectRoot, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bundle.validatedBytes.get(relative), { flag: 'wx' });
    }
    await saveState(projectRoot, { ...next, phase: 'active' });
    return { ok: true, actions };
  };
  if (mode === 'plan' || mode === 'check') return execute();
  if (mode === 'apply') await prepareApply(await verifiedState());
  if (mode === 'rollback') {
    const state = await verifiedState();
    if (!state) throw new Error('no installer-owned state to rollback');
    await assertInstalled(projectRoot, state.entries, state.phase !== 'active');
  }
  return withLock(projectRoot, execute);
}
