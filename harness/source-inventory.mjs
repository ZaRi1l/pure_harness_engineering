import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
const same = (a, b) => key(a) === key(b);
const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};
const overlaps = (a, b) => inside(a, b) || inside(b, a);

function git(cwd, args, { allowFailure = false, isolatedRemote = false } = {}) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_NAMESPACE']) delete env[name];
  if (isolatedRemote) {
    for (const name of Object.keys(env)) if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS|GLOBAL|SYSTEM|NOSYSTEM)$/.test(name)) delete env[name];
    env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
    env.GIT_CONFIG_NOSYSTEM = '1';
  }
  const result = spawnSync('git', args, { cwd, encoding: 'buffer', windowsHide: true, maxBuffer: 32 * 1024 * 1024, env });
  if (result.error || (result.status !== 0 && !allowFailure)) throw new Error(`Git inspection failed: ${args[0]}`);
  return result.status === 0 ? result.stdout : Buffer.alloc(0);
}
const lines = bytes => bytes.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
const nulPaths = bytes => bytes.toString('utf8').split('\0').filter(Boolean).map(value => value.replaceAll('\\', '/'));

async function hashFile(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function regularTree(root) {
  const files = [];
  const visited = new Set();
  async function walk(directory, relative = '') {
    const canonical = await realpath(directory);
    if (!inside(root, canonical) || visited.has(key(canonical))) throw new Error('source link or reparse escape');
    visited.add(key(canonical));
    const names = new Set();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const folded = entry.name.toLowerCase();
      if (names.has(folded)) throw new Error('case-colliding source names');
      names.add(folded);
      const absolute = path.join(directory, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error('source link or reparse point forbidden');
      if (info.isDirectory()) await walk(absolute, rel);
      else if (info.isFile()) files.push({ path: rel, absolute, size: info.size });
      else throw new Error('non-regular source entry forbidden');
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function canonicalMatch(harnessRoot, relative, body) {
  const candidate = path.join(harnessRoot, ...relative.split('/'));
  try {
    if (!same(await realpath(candidate), candidate) || !(await lstat(candidate)).isFile()) return false;
    return sha256(await readFile(candidate)) === sha256(body);
  } catch { return false; }
}

async function classify(harnessRoot, relative, body) {
  const lower = relative.toLowerCase();
  if (!/^\.(ai|agents|codex)(\/|$)/.test(lower)) return ['not-applicable', 'source-user', 'outside-configuration'];
  if (/(^|\/)(runtime|logs?|cache|secrets?|credentials?|tokens?|\.env)(\/|\.|$)/i.test(lower)) return ['private-runtime', 'source-user', 'private-path'];
  const sample = body.toString('utf8');
  if (/(?:["']?(?:api[_-]?key|access[_-]?token|secret|password|private[_-]?key)["']?)\s*[:=]/i.test(sample)) return ['private-runtime', 'source-user', 'credential-clues'];
  if (sample.includes('\ufffd') || body.includes(0)) return ['needs-review', 'source-user', 'binary-or-unknown-content'];
  if (lower.startsWith('.ai/') && !/\/(skills|agents|templates)\//.test(lower)) return ['needs-review', 'source-user', 'unclassified-ai-material'];
  if (await canonicalMatch(harnessRoot, relative, body)) return ['generic', 'harness-generated', 'canonical-path-and-content-match'];
  const product = /\b(project|product|silo|customer|workspace|domain|business)\b/i.test(sample);
  const generic = /\b(agent|skill|workflow|test|review|instruction|tool|model|hook)\b/i.test(sample);
  if (product && generic) return ['mixed', 'source-user', 'generic-and-product-clues'];
  if (product) return ['product', 'source-user', 'product-clues'];
  return ['needs-review', 'source-user', 'insufficient-evidence'];
}

function remoteInfo(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error('invalid remote URL');
  if (/^git@[^\s:@]+:[^\s]+$/.test(value)) {
    if (/[?#]/.test(value)) throw new Error('remote credential or query forbidden');
    return { displayUrl: value, urlSha256: sha256(value) };
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('invalid remote URL'); }
  if (!['https:', 'ssh:'].includes(parsed.protocol) || !parsed.hostname || (parsed.username && !(parsed.protocol === 'ssh:' && parsed.username === 'git')) || parsed.password || parsed.search || parsed.hash) throw new Error('remote credential or transport forbidden');
  return { displayUrl: parsed.toString(), urlSha256: sha256(value) };
}

export async function assertSafeSetupDestination({ harnessRoot, destination }) {
  if (typeof harnessRoot !== 'string' || !path.isAbsolute(harnessRoot) || typeof destination !== 'string' || !path.isAbsolute(destination)) throw new Error('absolute destination and harness root required');
  const canonicalHarnessRoot = await realpath(harnessRoot);
  if (!same(canonicalHarnessRoot, path.resolve(harnessRoot))) throw new Error('harness root link forbidden');
  const expected = path.join(canonicalHarnessRoot, 'project');
  if (!same(path.resolve(destination), expected) || path.resolve(destination) !== expected) throw new Error('destination must be fixed project child');
  const children = await readdir(canonicalHarnessRoot);
  if (children.some(name => name.toLowerCase() === 'project' && name !== 'project')) throw new Error('case-colliding destination name');
  let destinationState = 'absent';
  try {
    const info = await lstat(expected);
    if (info.isSymbolicLink() || !info.isDirectory() || !same(await realpath(expected), expected)) throw new Error('destination link or reparse point forbidden');
    destinationState = 'existing-directory';
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { canonicalHarnessRoot, destinationState };
}

export async function inspectSetupSource({ harnessRoot, mode, source }, { remoteLookup } = {}) {
  const canonicalHarnessRoot = await realpath(harnessRoot);
  if (mode !== 'existing') throw new Error('source inspection requires existing mode');
  if (typeof source !== 'string' || !source) throw new Error('source required');
  if (/^(https:\/\/|ssh:\/\/|git@)/i.test(source)) {
    const remote = remoteInfo(source);
    const effective = lines(git(canonicalHarnessRoot, ['ls-remote', '--get-url', source]))[0];
    if (effective !== source) throw new Error('remote URL rewrite or transport forbidden');
    const response = remoteLookup
      ? Buffer.from(await remoteLookup(source))
      : git(os.tmpdir(), ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', 'ls-remote', '--symref', source, 'HEAD'], { isolatedRemote: true });
    const output = lines(response);
    const head = output.find(line => /^[a-f0-9]{40,64}\s+HEAD$/.test(line))?.split(/\s+/)[0];
    if (!head) throw new Error('remote HEAD unavailable');
    const ref = output.find(line => line.startsWith('ref: '))?.match(/^ref: (\S+)\s+HEAD$/)?.[1];
    const gitInfo = { head, gitDirKind: 'remote', remotes: [{ name: 'origin', ...remote }], refs: ref ? [ref] : [], dirty: false };
    return { kind: 'remote', git: gitInfo, files: [], warnings: ['remote-content-not-yet-inspected'], fingerprint: sha256(JSON.stringify(gitInfo)) };
  }
  if (!path.isAbsolute(source)) throw new Error('local source must be absolute');
  const canonicalSource = await realpath(source);
  if (!same(canonicalSource, path.resolve(source))) throw new Error('source link forbidden');
  if (overlaps(canonicalSource, canonicalHarnessRoot)) throw new Error('source overlaps harness root');
  const dotGit = path.join(canonicalSource, '.git');
  const gitStat = await lstat(dotGit).catch(() => null);
  if (!gitStat?.isDirectory() || gitStat.isSymbolicLink()) throw new Error('primary checkout required; linked worktree .git pointer forbidden');
  const configuredWorktree = lines(git(canonicalSource, ['config', '--local', '--get', 'core.worktree'], { allowFailure: true }))[0];
  if (configuredWorktree && !same(path.resolve(dotGit, configuredWorktree), canonicalSource)) throw new Error('external core.worktree forbidden');
  const [top, gitDir] = lines(git(canonicalSource, ['rev-parse', '--show-toplevel', '--absolute-git-dir']));
  if (!same(await realpath(top), canonicalSource) || !same(await realpath(gitDir), dotGit)) throw new Error('source must own its Git repository');
  const head = lines(git(canonicalSource, ['rev-parse', 'HEAD'], { allowFailure: true }))[0] ?? null;
  const tracked = new Set(nulPaths(git(canonicalSource, ['ls-files', '-z', '--cached'])));
  const modified = new Set(nulPaths(git(canonicalSource, ['diff', 'HEAD', '--name-only', '-z'], { allowFailure: true })));
  const ignored = new Set(nulPaths(git(canonicalSource, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard'])));
  const dirty = git(canonicalSource, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).length > 0;
  const refs = lines(git(canonicalSource, ['for-each-ref', '--format=%(refname) %(objectname)'])).map(line => {
    const [name, oid] = line.split(' ');
    return { name, oid };
  });
  const remoteNames = lines(git(canonicalSource, ['remote']));
  const remotes = remoteNames.map(name => {
    const url = lines(git(canonicalSource, ['remote', 'get-url', name]))[0];
    let displayUrl = '<local-or-unsupported-remote>';
    try { displayUrl = remoteInfo(url).displayUrl; } catch {
      try { const parsed = new URL(url); if (parsed.hostname) displayUrl = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`; } catch { /* omit local path */ }
    }
    return { name, displayUrl, urlSha256: sha256(url) };
  });
  const tree = await regularTree(canonicalSource);
  const files = [];
  for (const item of tree) {
    const gitClass = item.path === '.git' || item.path.startsWith('.git/') ? 'git-metadata' : ignored.has(item.path) ? 'ignored' : modified.has(item.path) ? 'modified' : tracked.has(item.path) ? 'tracked' : 'untracked';
    const classification = gitClass === 'git-metadata' ? ['not-applicable', 'source-user', 'git-metadata'] : await classify(canonicalHarnessRoot, item.path, await readFile(item.absolute));
    files.push({ path: item.path, sha256: await hashFile(item.absolute), size: item.size, gitClass, classification: classification[0], ownership: classification[1], reason: classification[2] });
  }
  const gitInfo = { head, gitDirKind: 'directory', remotes, refs, dirty };
  return { kind: 'local', canonicalSource, git: gitInfo, files, fingerprint: sha256(JSON.stringify({ canonicalSource, gitInfo, files })) };
}
