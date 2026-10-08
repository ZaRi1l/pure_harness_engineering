import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listSkills, loadRoles } from './inventory.mjs';
import { makeGeneratedFile } from './ownership.mjs';
import { assertPortableText } from './schema.mjs';
import * as codex from './targets/codex.mjs';
import * as claude from './targets/claude.mjs';
import * as opencode from './targets/opencode.mjs';
import * as antigravity from './targets/antigravity.mjs';

const targets = Object.fromEntries([codex, claude, opencode, antigravity].map(adapter => [adapter.targetId, adapter]));
const events = ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(path.sep).join('/');
const manifestPath = target => `.harness/adapters/${target}.json`;
const lockPath = '.harness/adapter.lock';
const safeId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const planBodies = new WeakMap();

async function meta(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function bytes(file) {
  const info = await meta(file);
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`non-regular bridge path: ${file}`);
  return readFile(file);
}
function assertRoots(harnessRoot, projectRoot, target, setupId) {
  if (!path.isAbsolute(harnessRoot) || path.resolve(projectRoot) !== path.join(path.resolve(harnessRoot), 'project'))
    throw new Error('bridge destination must be the fixed project child');
  if (!Object.hasOwn(targets, target)) throw new Error('invalid bridge target');
  if (setupId !== undefined && !safeId(setupId)) throw new Error('invalid setupId');
}
function allowed(relative, target) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) return false;
  const skill = new RegExp(`^\\.${target === 'claude' ? 'claude' : 'agents'}/skills/[a-z][a-z0-9-]*/(?:[^/]+/)*[^/]+$`).test(relative);
  const role = target === 'antigravity' ? /^\.agents\/agents\/[a-z][a-z0-9-]*\/agent\.md$/.test(relative)
    : target === 'codex' ? /^\.codex\/agents\/[a-z][a-z0-9-]*\.toml$/.test(relative)
    : new RegExp(`^\\.${target}/agents/[a-z][a-z0-9-]*\\.md$`).test(relative);
  return skill || role || relative === 'AGENTS.md' || (target === 'codex' && ['.codex/config.toml', '.codex/hooks.json'].includes(relative));
}
async function safePath(root, relative, target) {
  if (!allowed(relative, target)) throw new Error(`bridge path not allowlisted: ${relative}`);
  return checkedPath(root, relative);
}
async function checkedPath(root, relative) {
  let current = path.resolve(root);
  if ((await meta(current))?.isSymbolicLink()) throw new Error('symlink bridge root');
  for (const part of relative.split('/')) {
    const info = await meta(current);
    if (info && !info.isDirectory()) throw new Error(`non-directory ancestor: ${relative}`);
    if (info) {
      const names = await readdir(current);
      if (names.some(name => name.toLowerCase() === part.toLowerCase() && name !== part)) throw new Error(`case collision: ${relative}`);
    }
    current = path.join(current, part);
    if ((await meta(current))?.isSymbolicLink()) throw new Error(`symlink bridge path: ${relative}`);
  }
  return current;
}
async function safeStatePath(harnessRoot, relative) {
  if (!/^\.harness\/(?:adapter\.lock|adapters\/(?:codex|claude|opencode|antigravity)(?:\.(?:json|journal\.json|rollback-journal\.json))|backups\/[0-9a-f-]{36}\/(?:codex|claude|opencode|antigravity)\/[a-f0-9]{64})$/.test(relative))
    throw new Error(`bridge management path not allowlisted: ${relative}`);
  return checkedPath(harnessRoot, relative);
}
async function assertPublishedChild(projectRoot) {
  const root = await meta(projectRoot), dotGit = await meta(path.join(projectRoot, '.git'));
  if (!root?.isDirectory() || root.isSymbolicLink() || !dotGit?.isDirectory() || dotGit.isSymbolicLink())
    throw new Error('bridge Apply requires an already-published independent child Git');
  let discovered;
  try { discovered = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { throw new Error('bridge Apply requires an independent child Git'); }
  if (path.resolve(discovered).toLowerCase() !== path.join(path.resolve(projectRoot), '.git').toLowerCase()) throw new Error('bridge child Git root mismatch');
}
async function collectSkill(root, id, add, sourceHashes, target) {
  const base = path.join(root, '.agents/skills', id);
  async function visit(dir) {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.isSymbolicLink()) throw new Error('symlink canonical skill');
      const absolute = path.join(dir, item.name);
      if (item.isDirectory()) await visit(absolute);
      else if (item.isFile()) {
        const suffix = slash(path.relative(base, absolute));
        const sourcePath = `${id}/${suffix}`;
        const body = await readFile(absolute);
        assertPortableText(body.toString('utf8'), sourcePath);
        sourceHashes.skills[sourcePath] = sha(body);
        add(target === 'claude' ? `.claude/skills/${sourcePath}` : `.agents/skills/${sourcePath}`, body, 'skill', sourcePath);
      } else throw new Error('non-file canonical skill');
    }
  }
  await visit(base);
}
function mergeToml(prior, roles) {
  if (prior.includes('\0')) return null;
  const sections = new Map();
  let section = '';
  for (const line of prior.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const header = /^\[([A-Za-z0-9_.-]+)\](?:\s*#.*)?$/.exec(trimmed);
    if (header) {
      section = header[1];
      if (sections.has(section)) return null;
      sections.set(section, new Map());
      continue;
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(?:true|false|"(?:[^"\\]|\\.)*"|'[^']*'|\d+)(?:\s*#.*)?$/.exec(trimmed);
    if (!assignment) return null;
    const keys = sections.get(section) ?? new Map();
    if (keys.has(assignment[1])) return null;
    keys.set(assignment[1], trimmed.slice(trimmed.indexOf('=') + 1).split('#')[0].trim());
    sections.set(section, keys);
  }
  if (sections.get('features')?.get('multi_agent') === 'false' || sections.get('agents')?.get('enabled') === 'false') return null;
  if (roles.some(role => sections.has(`agents.${role.id}`))) return null;
  const lines = [];
  if (!sections.has('features')) lines.push('[features]', 'multi_agent = true', '');
  else if (!sections.get('features').has('multi_agent')) return null;
  if (!sections.has('agents')) lines.push('[agents]', 'enabled = true', '');
  else if (!sections.get('agents').has('enabled')) return null;
  for (const role of roles) lines.push(`[agents.${role.id}]`, `description = ${JSON.stringify(role.description)}`, `config_file = "./agents/${role.id}.toml"`, '');
  return prior + (prior && !prior.endsWith('\n') ? '\n' : '') + '\n# BEGIN PURE HARNESS MANAGED ROLES\n' + lines.join('\n') + '# END PURE HARNESS MANAGED ROLES\n';
}
function stripOwnedToml(prior) {
  const match = /\n# BEGIN PURE HARNESS MANAGED ROLES\n[\s\S]*?# END PURE HARNESS MANAGED ROLES\n$/.exec(prior);
  return match ? prior.slice(0, match.index) : prior;
}
function hookEntry(harnessRoot) {
  const script = path.join(harnessRoot, 'scripts/hook-runtime.mjs');
  const posix = `'${script.replaceAll("'", "'\\''")}'`;
  const powershell = `'${script.replaceAll("'", "''")}'`;
  return { hooks: [{ type: 'command', command: `node ${posix}`, commandWindows: `powershell -NoProfile -Command "& node ${powershell}"`, timeout: 5, statusMessage: 'Pure Harness lifecycle (candidate; native dispatch unverified)' }] };
}
function mergeHooks(prior, harnessRoot) {
  let document;
  try { document = prior ? JSON.parse(prior) : { hooks: {} }; } catch { return null; }
  if (!document || typeof document !== 'object' || Array.isArray(document) || !document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks)) return null;
  for (const event of events) {
    if (document.hooks[event] !== undefined && !Array.isArray(document.hooks[event])) return null;
    document.hooks[event] ??= [];
    document.hooks[event].push(hookEntry(harnessRoot));
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}
function stripOwnedHooks(prior, harnessRoot) {
  try {
    const data = JSON.parse(prior);
    const owned = JSON.stringify(hookEntry(harnessRoot));
    for (const event of events) {
      if (!Array.isArray(data.hooks?.[event])) return null;
      const last = data.hooks[event].length - 1;
      if (last < 0 || JSON.stringify(data.hooks[event][last]) !== owned) return null;
      data.hooks[event].pop();
    }
    return JSON.stringify(data);
  } catch { return null; }
}
function agentsBlock(harnessRoot) {
  const runtime = path.join(harnessRoot, 'scripts/runtime-state.mjs').replaceAll("'", "''");
  const checkout = path.join(harnessRoot, 'project').replaceAll("'", "''");
  const binding = path.join(harnessRoot, '.harness/config.json').replaceAll("'", "''");
  return `<!-- BEGIN PURE HARNESS PROJECT SCOPE -->\nProduct instructions govern this project/ checkout. Parent engine core-maintenance and --core claim rules apply only to engine files, not product files.\nFor project writes when Node is available, claim exact paths with: node '${runtime}' --project project --checkout '${checkout}' --binding '${binding}' claim <agent-id> <path> [...]. Release the same claim after writing. Local task, memory, and runtime state live in the parent engine .harness/tasks, .harness/memory, and .harness/runtime directories. If Node is unavailable, use one cooperative writer per checkout and distinct worktrees for parallel writers; do not claim that coordination is automatically enforced.\n<!-- END PURE HARNESS PROJECT SCOPE -->\n`;
}
function mergeAgents(prior, harnessRoot) {
  if (/BEGIN PURE HARNESS PROJECT SCOPE|END PURE HARNESS PROJECT SCOPE/.test(prior)) return null;
  if (/--core[^\n]*(?:project|product)|(?:project|product)[^\n]*--core/i.test(prior)) return null;
  return prior + (prior && !prior.endsWith('\n') ? '\n' : '') + '\n' + agentsBlock(harnessRoot);
}
function stripOwnedAgents(prior) {
  const match = /\n<!-- BEGIN PURE HARNESS PROJECT SCOPE -->\n[\s\S]*?<!-- END PURE HARNESS PROJECT SCOPE -->\n$/.exec(prior);
  return match ? prior.slice(0, match.index) : prior;
}
function planDigest(plan) { const { planSha256, ...body } = plan; return sha(JSON.stringify(body)); }
async function manifest(harnessRoot, target) {
  const data = await bytes(await safeStatePath(harnessRoot, manifestPath(target)));
  if (!data) return null;
  try { return JSON.parse(data); } catch { throw new Error('invalid bridge manifest'); }
}

export async function buildBridgePlan({ harnessRoot, projectRoot, inputRoot = projectRoot, target, setupId, profile = 'core' } = {}) {
  assertRoots(harnessRoot, projectRoot, target, setupId);
  if (!path.isAbsolute(inputRoot) || !['core', 'all'].includes(profile)) throw new Error('invalid bridge input/profile');
  const priorManifest = await manifest(harnessRoot, target);
  if (priorManifest && priorManifest.setupId !== setupId) throw new Error('bridge setupId mismatch');
  const compatibility = JSON.parse(await readFile(path.join(harnessRoot, 'harness/compatibility.json'), 'utf8'));
  const roles = await loadRoles(harnessRoot, profile), skills = await listSkills(harnessRoot, profile);
  const prior = new Map((priorManifest?.actions ?? []).map(item => [item.path.toLowerCase(), item]));
  const sourceHashes = { roles: {}, skills: {} };
  const desired = new Map();
  function add(relative, body, kind, sourcePath) {
    if (!allowed(relative, target) || desired.has(relative.toLowerCase())) throw new Error(`unsafe or colliding bridge path: ${relative}`);
    desired.set(relative.toLowerCase(), { path: relative, body: Buffer.from(body), kind, sourcePath });
  }
  for (const role of roles) {
    sourceHashes.roles[role.id] = role.sourceSha256;
    const rendered = targets[target].renderRole(role, { compatibility, profile });
    assertPortableText(rendered.body, rendered.path);
    const generated = makeGeneratedFile({ ...rendered, target, roleId: role.id, sourcePath: role.sourcePath, sourceSha256: role.sourceSha256 });
    add(rendered.path, target === 'codex' ? generated.file : rendered.body, 'role', role.sourcePath);
  }
  for (const skill of skills) await collectSkill(harnessRoot, skill.id, add, sourceHashes, target);
  let configInput = target === 'codex' ? (await bytes(await safePath(inputRoot, '.codex/config.toml', target)))?.toString('utf8') ?? '' : null;
  if (target === 'codex') {
    if (prior.has('.codex/config.toml')) configInput = stripOwnedToml(configInput);
    const merged = mergeToml(configInput, roles);
    add('.codex/config.toml', merged ?? '', merged === null ? 'conflict' : 'registry');
    let hookInput = (await bytes(await safePath(inputRoot, '.codex/hooks.json', target)))?.toString('utf8') ?? '';
    if (prior.has('.codex/hooks.json')) hookInput = stripOwnedHooks(hookInput, harnessRoot);
    const hooks = hookInput === null ? null : mergeHooks(hookInput, harnessRoot);
    add('.codex/hooks.json', hooks ?? '', hooks === null ? 'conflict' : 'hooks');
  }
  let agentsInput = (await bytes(await safePath(inputRoot, 'AGENTS.md', target)))?.toString('utf8') ?? '';
  if (prior.has('agents.md')) agentsInput = stripOwnedAgents(agentsInput);
  const agents = mergeAgents(agentsInput, harnessRoot);
  add('AGENTS.md', agents ?? '', agents === null ? 'conflict' : 'instructions');
  const actions = [];
  for (const item of [...desired.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const before = await bytes(await safePath(inputRoot, item.path, target));
    const beforeSha256 = before ? sha(before) : null;
    const owned = prior.get(item.path.toLowerCase());
    let action = item.kind === 'conflict' ? 'conflict' : !before ? 'create' : before.equals(item.body) ? 'unchanged'
      : owned && owned.afterSha256 === beforeSha256 ? 'replace-owned'
      : ['registry', 'hooks', 'instructions'].includes(item.kind) && !owned ? 'append-managed-block' : 'conflict';
    if (owned && owned.afterSha256 !== beforeSha256) action = 'conflict';
    actions.push({ path: item.path, kind: item.kind, sourcePath: item.sourcePath ?? null, action, beforeSha256,
      afterSha256: action === 'conflict' ? null : sha(item.body) });
  }
  const plan = { schemaVersion: 1, harnessRoot: path.resolve(harnessRoot), projectRoot: path.resolve(projectRoot), inputRoot: path.resolve(inputRoot), target, setupId, profile, actions, sourceHashes, nativeSmoke: 'unverified' };
  plan.planSha256 = planDigest(plan);
  planBodies.set(plan, new Map([...desired.values()].map(item => [item.path, item.body])));
  return plan;
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, content, { flag: 'wx' }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
async function withLock(harnessRoot, run) {
  const file = await safeStatePath(harnessRoot, lockPath);
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error('bridge adapter lock exists'); throw error; });
  try { return await run(); } finally { await handle.close(); await unlink(file); }
}
async function backupPath(harnessRoot, setupId, target, relative) {
  return safeStatePath(harnessRoot, `.harness/backups/${setupId}/${target}/${sha(relative)}`);
}
function bridgeResult(plan, changedPaths) {
  return { setupId: plan.setupId, target: plan.target, projectRoot: plan.projectRoot, changedPaths, manifestPath: path.join(plan.harnessRoot, manifestPath(plan.target)), nativeSmoke: 'unverified' };
}

export async function applyBridgePlan({ harnessRoot, plan } = {}, { beforeWrite } = {}) {
  if (!plan || plan.schemaVersion !== 1 || plan.planSha256 !== planDigest(plan) || plan.harnessRoot !== path.resolve(harnessRoot)) throw new Error('invalid or modified bridge plan');
  assertRoots(harnessRoot, plan.projectRoot, plan.target, plan.setupId);
  await assertPublishedChild(plan.projectRoot);
  const outputRoot = plan.projectRoot;
  return withLock(harnessRoot, async () => {
    const journalFile = await safeStatePath(harnessRoot, `.harness/adapters/${plan.target}.journal.json`);
    if (await meta(journalFile)) throw new Error('pending bridge Apply journal requires manual recovery');
    const replay = await buildBridgePlan({ harnessRoot, projectRoot: plan.projectRoot, inputRoot: plan.inputRoot, target: plan.target, setupId: plan.setupId, profile: plan.profile });
    if (replay.planSha256 !== plan.planSha256) throw new Error('bridge source or input changed since planning');
    const desired = planBodies.get(replay);
    if (plan.actions.some(item => item.action === 'conflict')) throw new Error('bridge plan contains review conflict');
    const priorManifest = await manifest(harnessRoot, plan.target);
    const journal = { schemaVersion: 1, setupId: plan.setupId, target: plan.target, priorManifest, actions: [] };
    for (const item of plan.actions) {
      if (!allowed(item.path, plan.target)) throw new Error('bridge path not allowlisted');
      const actual = await bytes(await safePath(outputRoot, item.path, plan.target));
      if ((actual ? sha(actual) : null) !== item.beforeSha256) throw new Error(`bridge destination changed: ${item.path}`);
    }
    const changedPaths = [];
    try {
      for (const item of plan.actions) {
        if (item.action === 'unchanged') continue;
        const destination = await safePath(outputRoot, item.path, plan.target);
        const before = await bytes(destination);
        const previousOwnership = priorManifest?.actions.find(owned => owned.path === item.path);
        const backup = before && !previousOwnership ? await backupPath(harnessRoot, plan.setupId, plan.target, item.path) : null;
        const entry = { path: item.path, kind: item.kind, beforeSha256: previousOwnership ? previousOwnership.beforeSha256 : item.beforeSha256,
          afterSha256: item.afterSha256, backupSha256: previousOwnership ? previousOwnership.backupSha256 : before ? sha(before) : null, ownership: 'harness-managed' };
        journal.actions.push({ ...entry, currentBeforeBase64: before?.toString('base64') ?? null, backupCreated: !!backup });
        await atomicWrite(journalFile, JSON.stringify(journal));
        if (backup) await atomicWrite(backup, before);
        await beforeWrite?.(item.path);
        const latest = await bytes(await safePath(outputRoot, item.path, plan.target));
        if ((latest ? sha(latest) : null) !== item.beforeSha256) throw new Error(`bridge destination changed before write: ${item.path}`);
        await atomicWrite(destination, desired.get(item.path));
        if (sha(await readFile(destination)) !== item.afterSha256) throw new Error(`bridge post-write mismatch: ${item.path}`);
        changedPaths.push(item.path);
      }
      const retained = new Map((priorManifest?.actions ?? []).map(item => [item.path.toLowerCase(), item]));
      for (const item of journal.actions) {
        const { currentBeforeBase64, backupCreated, ...recordEntry } = item;
        retained.set(item.path.toLowerCase(), recordEntry);
      }
      const record = { schemaVersion: 1, setupId: plan.setupId, target: plan.target, projectRoot: plan.projectRoot,
        actions: [...retained.values()].sort((a, b) => a.path.localeCompare(b.path)) };
      await atomicWrite(await safeStatePath(harnessRoot, manifestPath(plan.target)), JSON.stringify(record, null, 2) + '\n');
      await rm(journalFile, { force: true });
      return bridgeResult(plan, changedPaths);
    } catch (error) {
      let drift = false;
      for (const item of [...journal.actions].reverse()) {
        const destination = await safePath(outputRoot, item.path, plan.target);
        const actual = await bytes(destination), actualHash = actual ? sha(actual) : null;
        const currentBefore = item.currentBeforeBase64 === null ? null : Buffer.from(item.currentBeforeBase64, 'base64');
        const currentBeforeHash = currentBefore ? sha(currentBefore) : null;
        if (actualHash === currentBeforeHash) continue;
        if (actualHash !== item.afterSha256) { drift = true; break; }
        if (currentBefore) await atomicWrite(destination, currentBefore);
        else await unlink(destination);
      }
      if (!drift) {
        for (const item of journal.actions) if (item.backupCreated) await rm(await backupPath(harnessRoot, plan.setupId, plan.target, item.path), { force: true });
        const file = await safeStatePath(harnessRoot, manifestPath(plan.target));
        if (priorManifest) await atomicWrite(file, JSON.stringify(priorManifest, null, 2) + '\n');
        else await rm(file, { force: true });
        await rm(journalFile, { force: true });
      }
      throw new Error(drift ? `bridge rollback refused user drift: ${error.message}` : error.message);
    }
  });
}

export async function checkNativeBridge({ harnessRoot, projectRoot, target } = {}) {
  assertRoots(harnessRoot, projectRoot, target);
  const record = await manifest(harnessRoot, target);
  const issues = [];
  if (!record || record.projectRoot !== path.resolve(projectRoot) || record.target !== target) issues.push('missing or mismatched adapter manifest');
  else for (const item of record.actions) {
    const current = await bytes(await safePath(projectRoot, item.path, target));
    if (!current || sha(current) !== item.afterSha256) issues.push(`owned file drift: ${item.path}`);
  }
  return { ok: issues.length === 0, issues, target, projectRoot: path.resolve(projectRoot), nativeSmoke: 'unverified', discovery: 'unverified', permission: 'unverified', hooks: 'unverified' };
}

export async function planBridgeUpdate(options = {}) { return buildBridgePlan(options); }

export async function rollbackNativeBridge({ harnessRoot, projectRoot, target, setupId } = {}, { beforeWrite } = {}) {
  assertRoots(harnessRoot, projectRoot, target, setupId);
  await assertPublishedChild(projectRoot);
  return withLock(harnessRoot, async () => {
    const journalFile = await safeStatePath(harnessRoot, `.harness/adapters/${target}.rollback-journal.json`);
    const pending = await bytes(journalFile);
    let journal;
    if (pending) {
      try { journal = JSON.parse(pending); } catch { throw new Error('invalid bridge rollback journal'); }
      if (journal.schemaVersion !== 1 || journal.setupId !== setupId || journal.target !== target || journal.projectRoot !== path.resolve(projectRoot)
          || !Array.isArray(journal.actions)) throw new Error('mismatched bridge rollback journal');
    }
    const record = journal ?? await manifest(harnessRoot, target);
    if (!record || record.setupId !== setupId || record.projectRoot !== path.resolve(projectRoot)) throw new Error('no matching bridge ownership');
    for (const item of record.actions) {
      const current = await bytes(await safePath(projectRoot, item.path, target));
      const currentHash = current ? sha(current) : null;
      if (currentHash !== item.afterSha256 && (!journal || currentHash !== item.beforeSha256)) throw new Error(`owned file drift: ${item.path}`);
      if (item.backupSha256) {
        const backup = await bytes(await backupPath(harnessRoot, setupId, target, item.path));
        if (!backup || sha(backup) !== item.backupSha256) throw new Error(`bridge backup drift: ${item.path}`);
      }
    }
    if (!journal) await atomicWrite(journalFile, JSON.stringify(record));
    const changedPaths = [];
    for (const item of [...record.actions].reverse()) {
      const destination = await safePath(projectRoot, item.path, target);
      const prior = await bytes(destination);
      if ((prior ? sha(prior) : null) === item.beforeSha256) continue;
      await beforeWrite?.(item.path);
      const latest = await bytes(await safePath(projectRoot, item.path, target));
      if (!latest || sha(latest) !== item.afterSha256) throw new Error(`owned file drift before rollback write: ${item.path}`);
      if (item.backupSha256) await atomicWrite(destination, await readFile(await backupPath(harnessRoot, setupId, target, item.path)));
      else await unlink(destination);
      changedPaths.push(item.path);
    }
    await rm(await safeStatePath(harnessRoot, manifestPath(target)), { force: true });
    await rm(journalFile, { force: true });
    return bridgeResult({ harnessRoot, projectRoot, target, setupId }, changedPaths);
  });
}
