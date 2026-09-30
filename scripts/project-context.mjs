import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const MAX_MESSAGE = 160;
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

function validatedManifest(value, projectId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_MANIFEST', 'manifest');
  if (value.schemaVersion !== 1) fail('INVALID_MANIFEST_VERSION', 'manifest');
  if (value.id !== projectId || !/^[a-z][a-z0-9-]*$/.test(value.id)) fail('MISMATCHED_ID', 'manifest.id');
  if (typeof value.displayName !== 'string' || !value.displayName.trim()) fail('INVALID_MANIFEST', 'manifest.displayName');
  if (!value.paths || typeof value.paths !== 'object') fail('INVALID_MANIFEST', 'manifest.paths');
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
  if (new Set(Object.values(paths).map(key)).size !== 3 || Object.values(paths).some(item => same(item, harnessRoot))) fail('INVALID_PATHS', 'manifest.paths');
  const adapters = {};
  for (const [name, adapter] of Object.entries(manifest.adapters)) {
    if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter) || typeof adapter.type !== 'string' || !adapter.type.trim()) fail('INVALID_ADAPTER', `manifest.adapters.${name}`);
    if (adapter.projectRelativePath !== undefined) await containedPath(projectRoot, adapter.projectRelativePath, `manifest.adapters.${name}.projectRelativePath`);
    adapters[name] = Object.freeze({ ...adapter });
  }
  const safeManifest = Object.freeze({ schemaVersion: 1, id: manifest.id, displayName: manifest.displayName, paths: Object.freeze({ ...manifest.paths }), adapters: Object.freeze(adapters) });
  return Object.freeze({ projectId, harnessRoot, projectRoot, checkoutRoot: checkout, manifest: safeManifest, paths: Object.freeze(paths), adapters: Object.freeze(adapters) });
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
