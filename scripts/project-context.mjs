import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_MESSAGE = 160;
const validatedContexts = new WeakSet();
export const isValidatedProjectContext = value => value !== null && typeof value === 'object' && validatedContexts.has(value);
class ContextError extends Error {
  constructor(code, field) { super(`${field}: ${code.replaceAll('_', ' ')}`); this.code = code; }
}
const fail = (code, field) => { throw new ContextError(code, field); };
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
const same = (left, right) => key(left) === key(right);
const isInside = (owner, target) => {
  const relative = path.relative(owner, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const nested = (left, right) => isInside(left, right) || isInside(right, left);
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

async function rootPath(value, field) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('INVALID_ROOT', field);
  try { return await realpath(value); } catch { fail('UNAVAILABLE_ROOT', field); }
}

async function jsonFile(filename, field) {
  let source;
  try { source = await readFile(filename, 'utf8'); } catch { fail('MISSING_FILE', field); }
  try { return JSON.parse(source); } catch { fail('INVALID_JSON', field); }
}

async function containedPath(owner, relative, field) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes('\\')) fail('INVALID_PATH', field);
  const resolved = path.resolve(owner, relative);
  if (same(owner, resolved) || !isInside(owner, resolved)) fail('PATH_ESCAPE', field);
  // Existing path components must also remain under owner after following symlinks.
  let ancestor = resolved;
  while (true) {
    try {
      const canonical = await realpath(ancestor);
      if (!isInside(owner, canonical)) fail('PATH_ESCAPE', field);
      break;
    } catch (error) {
      if (error instanceof ContextError) throw error;
      if (error.code !== 'ENOENT') fail('UNAVAILABLE_PATH', field);
      const parent = path.dirname(ancestor);
      if (parent === ancestor) fail('UNAVAILABLE_PATH', field);
      ancestor = parent;
    }
  }
  return resolved;
}

async function rejectManagementSymlinks(owner, target, field) {
  let current = owner;
  for (const segment of path.relative(owner, target).split(path.sep)) {
    current = path.join(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) fail('PATH_ESCAPE', field); }
    catch (error) { if (error instanceof ContextError) throw error; if (error.code === 'ENOENT') break; fail('UNAVAILABLE_PATH', field); }
  }
}

async function primaryGitDir(projectRoot) {
  const dotGit = path.join(projectRoot, '.git');
  try { if (!(await stat(dotGit)).isDirectory()) fail('INVALID_GIT', 'projectRoot'); }
  catch (error) { if (error instanceof ContextError) throw error; fail('INVALID_GIT', 'projectRoot'); }
  const gitdir = await realpath(dotGit);
  await verifyGitIdentity(projectRoot, gitdir, 'projectRoot');
  return gitdir;
}

async function verifyGitIdentity(checkoutRoot, expectedGitdir, field) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--is-inside-work-tree'], { cwd: checkoutRoot, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail('INVALID_GIT', field);
  const [top, gitdir, inside] = result.stdout.trim().split(/\r?\n/);
  if (inside !== 'true') fail('INVALID_GIT', field);
  let canonicalTop, canonicalGitdir;
  try { canonicalTop = await realpath(top); canonicalGitdir = await realpath(gitdir); }
  catch { fail('INVALID_GIT', field); }
  if (!same(canonicalTop, checkoutRoot) || !same(canonicalGitdir, expectedGitdir)) fail('INVALID_GIT', field);
}

async function verifyCheckout(projectRoot, checkoutRoot) {
  const primaryGit = await primaryGitDir(projectRoot);
  if (same(projectRoot, checkoutRoot)) return;
  if (nested(projectRoot, checkoutRoot)) fail('NESTED_ROOT', 'checkoutRoot');
  const pointer = path.join(checkoutRoot, '.git');
  let contents;
  try { contents = await readFile(pointer, 'utf8'); } catch { fail('INVALID_WORKTREE', 'checkoutRoot'); }
  const match = /^gitdir: (.+)\s*$/i.exec(contents.trim());
  if (!match) fail('INVALID_WORKTREE', 'checkoutRoot');
  let gitdir;
  try { gitdir = await realpath(path.resolve(checkoutRoot, match[1])); } catch { fail('INVALID_WORKTREE', 'checkoutRoot'); }
  if (!isInside(path.join(primaryGit, 'worktrees'), gitdir)) fail('INVALID_WORKTREE', 'checkoutRoot');
  let backpointer, common;
  try {
    backpointer = await realpath((await readFile(path.join(gitdir, 'gitdir'), 'utf8')).trim());
    common = await realpath(path.resolve(gitdir, (await readFile(path.join(gitdir, 'commondir'), 'utf8')).trim()));
  } catch { fail('INVALID_WORKTREE_BACKPOINTER', 'checkoutRoot'); }
  if (!same(backpointer, await realpath(pointer)) || !same(common, primaryGit)) fail('INVALID_WORKTREE_BACKPOINTER', 'checkoutRoot');
  await verifyGitIdentity(checkoutRoot, gitdir, 'checkoutRoot');
}

export function getScriptHarnessRoot(moduleUrl) {
  const scriptPath = fileURLToPath(moduleUrl);
  const scriptsRoot = path.dirname(scriptPath);
  if (path.basename(scriptsRoot) !== 'scripts') fail('INVALID_PATH', 'moduleUrl');
  return path.dirname(scriptsRoot);
}

async function rejectSymlinkComponents(target, field) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) fail('PATH_ESCAPE', field); }
    catch (error) { if (error instanceof ContextError) throw error; if (error.code === 'ENOENT') break; fail('UNAVAILABLE_PATH', field); }
  }
}

async function requireDirectoryIfPresent(target, field) {
  try { if (!(await lstat(target)).isDirectory()) fail('INVALID_PATH', field); }
  catch (error) { if (error instanceof ContextError) throw error; if (error.code !== 'ENOENT') fail('UNAVAILABLE_PATH', field); }
}

async function gitIdentity(cwd, field) {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--is-inside-work-tree'], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail('INVALID_GIT', field);
  const [top, gitdir, common, inside] = result.stdout.trim().split(/\r?\n/);
  if (inside !== 'true' || !top || !gitdir || !common) fail('INVALID_GIT', field);
  try { return { top: await realpath(top), gitdir: await realpath(gitdir), common: await realpath(common) }; }
  catch { fail('INVALID_GIT', field); }
}

function validateFixedConfig(config) {
  const keys = ['version', 'layout', 'projectPath', 'target', 'setupId', 'createdAt', 'updatedAt'];
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => ![...keys, 'profile'].includes(key)) || keys.some(key => !Object.hasOwn(config, key)) ||
      (Object.hasOwn(config, 'profile') && !['core', 'all'].includes(config.profile))) fail('INVALID_CONFIG', 'config');
  if (config.version !== 1 || config.layout !== 'single-project' || config.projectPath !== 'project' || !['codex', 'claude', 'opencode', 'antigravity'].includes(config.target)) fail('INVALID_CONFIG', 'config');
  if (typeof config.setupId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(config.setupId)) fail('INVALID_CONFIG', 'config');
  for (const name of ['createdAt', 'updatedAt']) {
    if (typeof config[name] !== 'string' || Number.isNaN(Date.parse(config[name])) || new Date(config[name]).toISOString() !== config[name]) fail('INVALID_CONFIG', 'config');
  }
}

export async function loadFixedProjectContext({ harnessRoot, cwd = process.cwd(), requireSetup = true } = {}) {
  if (typeof harnessRoot !== 'string' || !path.isAbsolute(harnessRoot)) fail('INVALID_ROOT', 'harnessRoot');
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) fail('INVALID_ROOT', 'cwd');
  await rejectSymlinkComponents(harnessRoot, 'harnessRoot');
  await rejectSymlinkComponents(cwd, 'cwd');
  const harness = await rootPath(harnessRoot, 'harnessRoot');
  const current = await rootPath(cwd, 'cwd');
  const harnessGit = await gitIdentity(harness, 'harnessRoot');
  if (!same(harnessGit.top, harness)) fail('INVALID_GIT', 'harnessRoot');
  const childPath = path.join(harness, 'project');
  await rejectSymlinkComponents(childPath, 'projectRoot');
  const projectRoot = await rootPath(childPath, 'projectRoot');
  if (!same(projectRoot, childPath)) fail('PATH_ESCAPE', 'projectRoot');
  const dotGit = path.join(projectRoot, '.git');
  await rejectSymlinkComponents(dotGit, 'projectRoot');
  let gitStat;
  try { gitStat = await lstat(dotGit); } catch { fail('INVALID_GIT', 'projectRoot'); }
  if (!gitStat.isDirectory()) fail('INVALID_GIT', 'projectRoot');
  const primary = await gitIdentity(projectRoot, 'projectRoot');
  if (!same(primary.top, projectRoot) || !same(primary.gitdir, await realpath(dotGit)) || !same(primary.common, primary.gitdir)) fail('INVALID_GIT', 'projectRoot');

  const management = path.join(harness, '.harness');
  for (const name of ['', 'config.json', 'tasks', 'memory', 'runtime']) await rejectSymlinkComponents(path.join(management, name), `.harness/${name}`);
  for (const name of ['', 'tasks', 'memory', 'runtime']) await requireDirectoryIfPresent(path.join(management, name), `.harness/${name}`);
  const configPath = path.join(management, 'config.json');
  let configExists;
  try { if (!(await lstat(configPath)).isFile()) fail('INVALID_CONFIG', 'config'); configExists = true; }
  catch (error) { if (error instanceof ContextError) throw error; if (error.code === 'ENOENT') configExists = false; else fail('UNAVAILABLE_PATH', 'config'); }
  if (configExists) validateFixedConfig(await jsonFile(configPath, 'config'));
  else if (requireSetup) fail('MISSING_CONFIG', 'config');

  const currentGit = await gitIdentity(current, 'cwd');
  let checkoutRoot;
  if (isInside(harness, current)) {
    if (isInside(projectRoot, current)) {
      if (!same(currentGit.top, projectRoot) || !same(currentGit.common, primary.common)) fail('INVALID_GIT', 'cwd');
    } else if (!same(currentGit.top, harness) || !same(currentGit.common, harnessGit.common)) fail('INVALID_GIT', 'cwd');
    checkoutRoot = projectRoot;
  } else {
    checkoutRoot = currentGit.top;
    if (!isInside(checkoutRoot, current)) fail('INVALID_WORKTREE', 'cwd');
    await rejectSymlinkComponents(checkoutRoot, 'checkoutRoot');
    await rejectSymlinkComponents(path.join(checkoutRoot, '.git'), 'checkoutRoot');
    await verifyCheckout(projectRoot, checkoutRoot);
    if (!same(currentGit.common, primary.common)) fail('INVALID_WORKTREE', 'checkoutRoot');
  }
  const paths = Object.freeze({ tasks: path.join(management, 'tasks'), memory: path.join(management, 'memory'), runtime: path.join(management, 'runtime') });
  const adapters = Object.freeze(Object.create(null));
  const context = Object.freeze({ root: projectRoot, projectRoot, checkoutRoot, harnessRoot: harness, projectId: 'project', paths, adapters });
  validatedContexts.add(context);
  return context;
}

function validatedManifest(value, projectId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_MANIFEST', 'manifest');
  if (Object.keys(value).some(name => !['schemaVersion', 'id', 'displayName', 'paths', 'adapters'].includes(name))) fail('INVALID_MANIFEST', 'manifest');
  if (value.schemaVersion !== 1) fail('INVALID_MANIFEST_VERSION', 'manifest');
  if (value.id !== projectId || !/^[a-z][a-z0-9-]*$/.test(value.id)) fail('MISMATCHED_ID', 'manifest.id');
  if (typeof value.displayName !== 'string' || !value.displayName.trim()) fail('INVALID_MANIFEST', 'manifest.displayName');
  if (!value.paths || typeof value.paths !== 'object' || Array.isArray(value.paths) || Object.keys(value.paths).some(name => !['tasks', 'memory', 'runtime'].includes(name))) fail('INVALID_MANIFEST', 'manifest.paths');
  if (!value.adapters || typeof value.adapters !== 'object' || Array.isArray(value.adapters)) fail('INVALID_MANIFEST', 'manifest.adapters');
  return value;
}

export async function loadProjectContext({ checkoutRoot, bindingPath, projectId } = {}) {
  if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(projectId)) fail('INVALID_ID', 'projectId');
  if (typeof bindingPath !== 'string' || !path.isAbsolute(bindingPath)) fail('INVALID_PATH', 'binding');
  const binding = await jsonFile(bindingPath, 'binding');
  if (binding?.schemaVersion !== 1 || !Array.isArray(binding.registrations)) fail('INVALID_BINDING', 'binding');
  const matches = binding.registrations.filter(item => item?.projectId === projectId);
  if (matches.length !== 1) fail(matches.length ? 'DUPLICATE_REGISTRATION' : 'MISSING_REGISTRATION', 'binding.registrations');
  const registration = matches[0];
  const harnessRoot = await rootPath(registration.harnessRoot, 'harnessRoot');
  const projectRoot = await rootPath(registration.projectRoot, 'projectRoot');
  const checkout = await rootPath(checkoutRoot, 'checkoutRoot');
  for (const other of binding.registrations) {
    if (other === registration || typeof other?.projectRoot !== 'string') continue;
    let otherRoot;
    try { otherRoot = await realpath(other.projectRoot); } catch { continue; }
    if (same(otherRoot, projectRoot)) fail('DUPLICATE_REGISTRATION', 'binding.registrations');
  }
  if (nested(harnessRoot, projectRoot) || nested(harnessRoot, checkout)) fail('NESTED_ROOT', 'harnessRoot');
  await verifyCheckout(projectRoot, checkout);
  const manifestPath = await containedPath(projectRoot, 'harness-adapter/project.json', 'manifest');
  const manifest = validatedManifest(await jsonFile(manifestPath, 'manifest'), projectId);
  const paths = {};
  const managementRoot = await containedPath(harnessRoot, `projects/${projectId}`, 'manifest.paths');
  await rejectManagementSymlinks(harnessRoot, managementRoot, 'manifest.paths');
  for (const name of ['tasks', 'memory', 'runtime']) {
    paths[name] = await containedPath(harnessRoot, manifest.paths[name], `manifest.paths.${name}`);
    if (same(paths[name], managementRoot) || !isInside(managementRoot, paths[name])) fail('PATH_ESCAPE', `manifest.paths.${name}`);
    await rejectManagementSymlinks(harnessRoot, paths[name], `manifest.paths.${name}`);
  }
  const managementPaths = Object.values(paths);
  if (managementPaths.some((item, index) => managementPaths.slice(index + 1).some(other => nested(item, other)))) fail('INVALID_PATHS', 'manifest.paths');
  const adapters = Object.create(null);
  for (const [name, adapter] of Object.entries(manifest.adapters)) {
    if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter) || typeof adapter.type !== 'string' || !adapter.type.trim()) fail('INVALID_ADAPTER', `manifest.adapters.${name}`);
    if (adapter.projectRelativePath !== undefined) await containedPath(projectRoot, adapter.projectRelativePath, `manifest.adapters.${name}.projectRelativePath`);
    adapters[name] = deepFreeze({ ...adapter });
  }
  const safeManifest = Object.freeze({ schemaVersion: 1, id: manifest.id, displayName: manifest.displayName, paths: Object.freeze({ ...manifest.paths }), adapters: Object.freeze(adapters) });
  const context = Object.freeze({ projectId, harnessRoot, projectRoot, checkoutRoot: checkout, manifest: safeManifest, paths: Object.freeze(paths), adapters: Object.freeze(adapters) });
  validatedContexts.add(context);
  return context;
}

export async function diagnoseProjectContext(options) {
  try {
    await loadProjectContext(options);
    return { ok: true, code: 'OK', message: 'Project context is valid' };
  } catch (error) {
    const code = error instanceof ContextError ? error.code : 'INVALID_CONTEXT';
    const message = error instanceof ContextError ? error.message : 'project context: invalid';
    return { ok: false, code, message: message.slice(0, MAX_MESSAGE) };
  }
}
