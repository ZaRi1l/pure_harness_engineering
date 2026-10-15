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
  if (target === 'claude' && relative.startsWith('.claude/skills/pure-harness-lifecycle/')
      && !['.claude/skills/pure-harness-lifecycle/.claude-plugin/plugin.json', '.claude/skills/pure-harness-lifecycle/hooks/hooks.json'].includes(relative)) return false;
  const skill = new RegExp(`^\\.${target === 'claude' ? 'claude' : 'agents'}/skills/[a-z][a-z0-9-]*/(?:[^/]+/)*[^/]+$`).test(relative);
  const role = target === 'antigravity' ? /^\.agents\/agents\/[a-z][a-z0-9-]*\/agent\.md$/.test(relative)
    : target === 'codex' ? /^\.codex\/agents\/[a-z][a-z0-9-]*\.toml$/.test(relative)
    : new RegExp(`^\\.${target}/agents/[a-z][a-z0-9-]*\\.md$`).test(relative);
  return skill || role || relative === 'AGENTS.md' || (target === 'codex' && ['.codex/config.toml', '.codex/hooks.json'].includes(relative))
    || (target === 'antigravity' && ['.agents/hooks.json', '.agents/rules/pure-harness-hooks.md'].includes(relative))
    || (target === 'claude' && ['.claude/settings.json', '.claude/skills/pure-harness-lifecycle/.claude-plugin/plugin.json', '.claude/skills/pure-harness-lifecycle/hooks/hooks.json'].includes(relative));
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
function hookEntry(harnessRoot, event, legacy = false) {
  const script = path.join(harnessRoot, 'scripts/hook-runtime.mjs');
  const posix = `'${script.replaceAll("'", "'\\''")}'`;
  const powershell = `'${script.replaceAll("'", "''")}'`;
  return { hooks: [{ type: 'command', command: `node ${posix}${legacy ? '' : ' --source=codex'}`,
    commandWindows: `powershell -NoProfile -Command "& node ${powershell}${legacy ? '' : ' --source=codex'}"`,
    timeout: event === 'SessionEnd' && !legacy ? 3 : 5, statusMessage: 'Pure Harness lifecycle (candidate; native dispatch unverified)' }] };
}
function mergeHooks(prior, harnessRoot) {
  let document;
  try { document = prior ? JSON.parse(prior) : { hooks: {} }; } catch { return null; }
  if (!document || typeof document !== 'object' || Array.isArray(document) || !document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks)) return null;
  for (const event of events) {
    if (document.hooks[event] !== undefined && !Array.isArray(document.hooks[event])) return null;
    document.hooks[event] ??= [];
    document.hooks[event].push(hookEntry(harnessRoot, event));
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}
const antigravityHookName = 'pure-harness-lifecycle';
const antigravityEvents = ['PreToolUse', 'PostToolUse'];
function antigravityHookEntry(harnessRoot) {
  const script = path.join(harnessRoot, 'scripts/hook-runtime.mjs');
  const quoted = process.platform === 'win32' ? `"${slash(script).replaceAll('"', '\\"')}"` : `'${slash(script).replaceAll("'", "'\\''")}'`;
  return { matcher: 'invoke_subagent|manage_subagents', hooks: [{ type: 'command', command: `node ${quoted} --source=antigravity`, timeout: 5 }] };
}
function mergeAntigravityHooks(prior, harnessRoot) {
  let document;
  try { document = prior ? JSON.parse(prior) : {}; } catch { return null; }
  if (!document || typeof document !== 'object' || Array.isArray(document) || Object.hasOwn(document, antigravityHookName)) return null;
  document[antigravityHookName] = { enabled: true, ...Object.fromEntries(antigravityEvents.map(event => [event, [antigravityHookEntry(harnessRoot)]])) };
  return `${JSON.stringify(document, null, 2)}\n`;
}
function stripAntigravityHooks(prior, harnessRoot) {
  try {
    const document = JSON.parse(prior), owned = document[antigravityHookName];
    if (!document || typeof document !== 'object' || Array.isArray(document) || !owned || owned.enabled !== true
        || Object.keys(owned).length !== 3 || antigravityEvents.some(event => JSON.stringify(owned[event]) !== JSON.stringify([antigravityHookEntry(harnessRoot)]))) return null;
    delete document[antigravityHookName];
    return JSON.stringify(document);
  } catch { return null; }
}
const claudePluginRoot = '.claude/skills/pure-harness-lifecycle';
const claudeSettings = '.claude/settings.json';
const claudePluginFiles = [
  `${claudePluginRoot}/.claude-plugin/plugin.json`,
  `${claudePluginRoot}/hooks/hooks.json`,
];
function claudeHookEntry(script, legacy = false) {
  return { hooks: [{ type: 'command', command: 'node', args: legacy ? [script] : [script, '--source=claude'], timeout: 5 }] };
}
function claudePluginHooks(script) {
  return { hooks: {
    SubagentStart: [claudeHookEntry(script)],
    SubagentStop: [claudeHookEntry(script)],
    SessionEnd: [claudeHookEntry(script)],
    PostToolUse: [{ matcher: 'TaskStop', ...claudeHookEntry(script) }, { matcher: 'Agent', ...claudeHookEntry(script) }],
  } };
}
function legacyClaudeSettings(body, script, taskStop) {
  const data = body ? JSON.parse(body) : {};
  data.hooks ??= {};
  for (const event of ['SubagentStart', 'SubagentStop']) {
    data.hooks[event] ??= [];
    data.hooks[event].push(claudeHookEntry(script, true));
  }
  if (taskStop) {
    data.hooks.PostToolUse ??= [];
    data.hooks.PostToolUse.push({ matcher: 'TaskStop', ...claudeHookEntry(script, true) });
  }
  return Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
}
function sameHookScript(value, script) {
  if (typeof value !== 'string') return false;
  const canonical = text => {
    const normalized = text.replace(/^['"]|['"]$/g, '').replaceAll('\\', '/');
    return /^(?:[a-z]:\/|\/\/[^/]+\/[^/]+\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  return canonical(value) === canonical(script);
}
function hasClaudeHookConflict(body, script) {
  if (!body?.length) return false;
  let data;
  try { data = JSON.parse(body); } catch { return true; }
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data.hooks !== undefined && (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)))) return true;
  for (const event of ['SubagentStart', 'SubagentStop', 'PostToolUse']) {
    const entries = data.hooks?.[event];
    if (entries !== undefined && !Array.isArray(entries)) return true;
    if (entries?.some(entry => Array.isArray(entry?.hooks) && entry.hooks.some(hook => hook?.type === 'command'
        && (hook.args?.some?.(arg => sameHookScript(arg, script)) || (typeof hook.command === 'string'
          && (hook.command.match(/['"][^'"]+['"]|[^\s]+/g) ?? []).some(part => sameHookScript(part, script))))))) return true;
  }
  return false;
}
async function retiredClaudeSettings(harnessRoot, setupId, previous, script) {
  if (!previous || previous.path !== claudeSettings || !previous.afterSha256) throw new Error('invalid legacy Claude settings ownership');
  if (previous.beforeSha256 === null && previous.backupSha256 === null) {
    if (sha(legacyClaudeSettings(null, script, false)) !== previous.afterSha256
        && sha(legacyClaudeSettings(null, script, true)) !== previous.afterSha256)
      throw new Error('legacy Claude settings ownership cannot be verified');
    return null;
  }
  if (!previous.beforeSha256 || previous.beforeSha256 !== previous.backupSha256) throw new Error('invalid legacy Claude settings backup');
  const backup = await bytes(await backupPath(harnessRoot, setupId, 'claude', claudeSettings));
  if (!backup || sha(backup) !== previous.beforeSha256) throw new Error('bridge backup drift: .claude/settings.json');
  if (sha(legacyClaudeSettings(backup.toString('utf8'), script, false)) !== previous.afterSha256
      && sha(legacyClaudeSettings(backup.toString('utf8'), script, true)) !== previous.afterSha256)
    throw new Error('legacy Claude settings ownership cannot be verified');
  if (hasClaudeHookConflict(backup, script)) throw new Error('legacy Claude settings backup conflicts with plugin hooks');
  return backup;
}
function stripOwnedHooks(prior, harnessRoot) {
  try {
    const data = JSON.parse(prior);
    const shape = events.map(event => {
      if (!Array.isArray(data.hooks?.[event])) return null;
      const last = data.hooks[event].at(-1);
      return JSON.stringify(last) === JSON.stringify(hookEntry(harnessRoot, event)) ? 'current'
        : JSON.stringify(last) === JSON.stringify(hookEntry(harnessRoot, event, true)) ? 'legacy' : null;
    });
    if (shape.includes(null) || new Set(shape).size !== 1) return null;
    for (const event of events) data.hooks[event].pop();
    return JSON.stringify(data);
  } catch { return null; }
}
function agentsBlock(harnessRoot) {
  const runtime = path.join(harnessRoot, 'scripts/runtime-state.mjs').replaceAll("'", "''");
  return `<!-- BEGIN PURE HARNESS PROJECT SCOPE -->\nProduct instructions govern this project/ checkout. Parent engine core-maintenance and --core claim rules apply only to engine files, not product files.\nFor project writes when Node is available, run from this project checkout and claim exact paths with: node '${runtime}' claim <agent-id> <path> [...]. Release with: node '${runtime}' release-claim <agent-id>. Local task, memory, and runtime state live in the parent engine .harness/tasks, .harness/memory, and .harness/runtime directories. If Node is unavailable, use one cooperative writer per checkout and distinct worktrees for parallel writers; do not claim that coordination is automatically enforced.\n<!-- END PURE HARNESS PROJECT SCOPE -->\n`;
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
async function pendingBridgeJournals(harnessRoot) {
  const pending = [];
  for (const target of Object.keys(targets)) for (const kind of ['journal', 'rollback-journal']) {
    const relative = `.harness/adapters/${target}.${kind}.json`;
    if (await meta(await safeStatePath(harnessRoot, relative))) pending.push(relative);
  }
  return pending;
}
async function otherSharedOwners(harnessRoot, projectRoot, setupId, selectedTarget) {
  const shared = new Map();
  for (const otherTarget of Object.keys(targets).filter(id => id !== selectedTarget)) {
    const record = await manifest(harnessRoot, otherTarget);
    if (!record) continue;
    if (record.setupId !== setupId || record.projectRoot !== path.resolve(projectRoot) || !Array.isArray(record.actions))
      throw new Error(`incompatible active bridge ownership: ${otherTarget}`);
    for (const entry of record.actions) {
      if (entry.path !== 'AGENTS.md' && !entry.path.startsWith('.agents/skills/')) continue;
      const existing = shared.get(entry.path);
      if (existing && (existing.entry.afterSha256 !== entry.afterSha256 || existing.entry.beforeSha256 !== entry.beforeSha256
          || existing.entry.backupSha256 !== entry.backupSha256)) throw new Error(`conflicting shared bridge ownership: ${entry.path}`);
      shared.set(entry.path, { entry, target: otherTarget });
    }
  }
  return shared;
}

export async function buildBridgePlan({ harnessRoot, projectRoot, inputRoot = projectRoot, target, setupId, profile = 'core', antigravityHooks = false } = {}) {
  assertRoots(harnessRoot, projectRoot, target, setupId);
  if (!path.isAbsolute(inputRoot) || !['core', 'all'].includes(profile) || typeof antigravityHooks !== 'boolean'
      || (antigravityHooks && target !== 'antigravity')) throw new Error('invalid bridge input/profile/hooks');
  if ((await pendingBridgeJournals(harnessRoot)).length) throw new Error('pending bridge journal requires recovery before planning');
  const priorManifest = await manifest(harnessRoot, target);
  if (priorManifest && (priorManifest.setupId !== setupId || priorManifest.projectRoot !== path.resolve(projectRoot))) throw new Error('bridge setupId/project mismatch');
  if (priorManifest?.actions.some(item => !allowed(item.path, target))
      || (priorManifest?.retiredBackups && (!Array.isArray(priorManifest.retiredBackups)
        || target !== 'antigravity' || priorManifest.retiredBackups.some(item => item.path !== '.agents/hooks.json'
          || !item.backupSha256 || item.beforeSha256 !== item.backupSha256)))) throw new Error('bridge prior path not allowlisted');
  const shared = await otherSharedOwners(harnessRoot, projectRoot, setupId, target);
  const compatibility = JSON.parse(await readFile(path.join(harnessRoot, 'harness/compatibility.json'), 'utf8'));
  const roles = await loadRoles(harnessRoot, profile), skills = await listSkills(harnessRoot, profile);
  const prior = new Map((priorManifest?.actions ?? []).map(item => [item.path.toLowerCase(), item]));
  const retiredHookBackup = priorManifest?.retiredBackups?.find(item => item.path === '.agents/hooks.json');
  if (retiredHookBackup) {
    const backup = await bytes(await backupPath(harnessRoot, setupId, target, retiredHookBackup.path));
    if (!backup || sha(backup) !== retiredHookBackup.backupSha256) throw new Error('bridge backup drift: .agents/hooks.json');
  }
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
    const script = await checkedPath(harnessRoot, 'scripts/hook-runtime.mjs');
    const runtime = await bytes(script);
    if (!runtime) throw new Error('missing verified Codex hook runtime script');
    sourceHashes.hookRuntime = sha(runtime);
    if (prior.has('.codex/config.toml')) configInput = stripOwnedToml(configInput);
    const merged = mergeToml(configInput, roles);
    add('.codex/config.toml', merged ?? '', merged === null ? 'conflict' : 'registry');
    let hookInput = (await bytes(await safePath(inputRoot, '.codex/hooks.json', target)))?.toString('utf8') ?? '';
    if (prior.has('.codex/hooks.json')) hookInput = stripOwnedHooks(hookInput, harnessRoot);
    const hooks = hookInput === null ? null : mergeHooks(hookInput, harnessRoot);
    add('.codex/hooks.json', hooks ?? '', hooks === null ? 'conflict' : 'hooks');
  }
  if (target === 'antigravity') {
    const rule = `---\ntrigger: always_on\n---\nPure Harness Antigravity lifecycle hooks are ${antigravityHooks ? 'on (unverified)' : 'off'}. To enable them, run from the Harness root: npm run setup -- --target antigravity --antigravity-hooks on --plan, review and save the JSON plan to a file, then apply it with npm run setup -- --apply <plan-file>. These hooks record only categorical diagnostics, not agent starts or stops. On Windows, PreToolUse dispatch has been observed in agy 1.3.5, but lifecycle handling remains unverified (issue #257).\n`;
    add('.agents/rules/pure-harness-hooks.md', rule, 'instructions');
    const hookPath = '.agents/hooks.json';
    const existing = prior.get(hookPath);
    if (antigravityHooks) {
      const script = await checkedPath(harnessRoot, 'scripts/hook-runtime.mjs');
      const runtime = await bytes(script);
      if (!runtime) throw new Error('missing verified Antigravity hook runtime script');
      sourceHashes.hookRuntime = sha(runtime);
      let input = (await bytes(await safePath(inputRoot, hookPath, target)))?.toString('utf8') ?? '';
      if (existing) input = stripAntigravityHooks(input, harnessRoot);
      if (!existing && retiredHookBackup && sha(Buffer.from(input)) !== retiredHookBackup.beforeSha256) input = null;
      const merged = input === null ? null : mergeAntigravityHooks(input, harnessRoot);
      add(hookPath, merged ?? '', merged === null ? 'conflict' : 'hooks');
    } else if (existing) {
      const current = await bytes(await safePath(inputRoot, hookPath, target));
      if (!current || stripAntigravityHooks(current.toString('utf8'), harnessRoot) === null) {
        desired.set(hookPath, { path: hookPath, body: null, kind: 'conflict', sourcePath: null });
      } else {
        const backup = existing.backupSha256 ? await bytes(await backupPath(harnessRoot, setupId, target, hookPath)) : null;
        if (existing.backupSha256 && (!backup || sha(backup) !== existing.backupSha256)) throw new Error('bridge backup drift: .agents/hooks.json');
        desired.set(hookPath, { path: hookPath, body: backup, kind: 'retire', sourcePath: null });
      }
    }
  }
  if (target === 'claude') {
    const script = await checkedPath(harnessRoot, 'scripts/hook-runtime.mjs');
    const runtime = await bytes(script);
    if (!runtime) throw new Error('missing verified Claude hook runtime script');
    sourceHashes.hookRuntime = sha(runtime);
    const settingsBytes = await bytes(await safePath(inputRoot, claudeSettings, target));
    const priorSettings = prior.get(claudeSettings);
    if (priorSettings) {
      const restored = await retiredClaudeSettings(harnessRoot, setupId, priorSettings, script);
      desired.set(claudeSettings, { path: claudeSettings, body: restored, kind: 'retire', sourcePath: null });
    } else if (hasClaudeHookConflict(settingsBytes, script)) {
      desired.set(claudeSettings, { path: claudeSettings, body: null, kind: 'conflict', sourcePath: null });
    }
    add(claudePluginFiles[0], `${JSON.stringify({ name: 'pure-harness-lifecycle', version: '0.1.0', description: 'Project-scoped Pure Harness agent lifecycle hooks' }, null, 2)}\n`, 'plugin');
    add(claudePluginFiles[1], `${JSON.stringify(claudePluginHooks(script), null, 2)}\n`, 'hooks');
  }
  let agentsInput = (await bytes(await safePath(inputRoot, 'AGENTS.md', target)))?.toString('utf8') ?? '';
  if (prior.has('agents.md') || shared.has('AGENTS.md')) agentsInput = stripOwnedAgents(agentsInput);
  const agents = mergeAgents(agentsInput, harnessRoot);
  add('AGENTS.md', agents ?? '', agents === null ? 'conflict' : 'instructions');
  const actions = [];
  for (const item of [...desired.values()].sort((a, b) => (a.kind === 'retire') - (b.kind === 'retire') || a.path.localeCompare(b.path))) {
    const before = await bytes(await safePath(inputRoot, item.path, target));
    const beforeSha256 = before ? sha(before) : null;
    const owned = prior.get(item.path.toLowerCase());
    const borrowed = shared.get(item.path)?.entry;
    let action = item.kind === 'conflict' ? 'conflict' : item.kind === 'retire' ? 'retire-owned'
      : !before ? 'create' : before.equals(item.body) ? 'unchanged'
      : owned && owned.afterSha256 === beforeSha256 ? 'replace-owned'
      : ['registry', 'hooks', 'instructions'].includes(item.kind) && item.path !== claudePluginFiles[1] && !owned ? 'append-managed-block' : 'conflict';
    if (owned && owned.afterSha256 !== beforeSha256) action = 'conflict';
    if (item.kind === 'retire' && !owned) action = 'conflict';
    if (item.kind === 'retire' && item.path === '.agents/hooks.json' && owned && (owned.beforeSha256 !== (item.body ? sha(item.body) : null))) action = 'conflict';
    if (borrowed && (borrowed.afterSha256 !== beforeSha256 || !item.body || borrowed.afterSha256 !== sha(item.body))) action = 'conflict';
    actions.push({ path: item.path, kind: item.kind, sourcePath: item.sourcePath ?? null, action, beforeSha256,
      afterSha256: action === 'conflict' ? null : item.body ? sha(item.body) : null });
  }
  const plan = { schemaVersion: 1, harnessRoot: path.resolve(harnessRoot), projectRoot: path.resolve(projectRoot), inputRoot: path.resolve(inputRoot), target, setupId, profile,
    antigravityHooks, actions, sourceHashes, nativeSmoke: 'unverified', ...(target === 'antigravity' && process.platform === 'win32'
      ? { warnings: ['Antigravity lifecycle hooks on Windows remain unverified (issue #257)'] } : {}) };
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
async function createBackup(file, content, relative, recordCreation) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw new Error(`bridge backup collision: ${relative}`);
    throw error;
  });
  try {
    await handle.writeFile(content);
    await handle.close();
    await recordCreation();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(file, { force: true });
    throw error;
  }
}
function retiredHookBackupFrom(record) { return record?.retiredBackups?.find(item => item.path === '.agents/hooks.json'); }
function bridgeResult(plan, changedPaths) {
  return { setupId: plan.setupId, target: plan.target, projectRoot: plan.projectRoot, changedPaths, manifestPath: path.join(plan.harnessRoot, manifestPath(plan.target)), nativeSmoke: 'unverified' };
}

export async function applyBridgePlan({ harnessRoot, plan } = {}, { beforeWrite } = {}) {
  if (!plan || plan.schemaVersion !== 1 || plan.planSha256 !== planDigest(plan) || plan.harnessRoot !== path.resolve(harnessRoot)) throw new Error('invalid or modified bridge plan');
  assertRoots(harnessRoot, plan.projectRoot, plan.target, plan.setupId);
  await assertPublishedChild(plan.projectRoot);
  const outputRoot = plan.projectRoot;
  return withLock(harnessRoot, async () => {
    if ((await pendingBridgeJournals(harnessRoot)).length) throw new Error('pending bridge journal requires recovery before Apply');
    const journalFile = await safeStatePath(harnessRoot, `.harness/adapters/${plan.target}.journal.json`);
    const replay = await buildBridgePlan({ harnessRoot, projectRoot: plan.projectRoot, inputRoot: plan.inputRoot, target: plan.target, setupId: plan.setupId, profile: plan.profile, antigravityHooks: plan.antigravityHooks });
    if (replay.planSha256 !== plan.planSha256) throw new Error('bridge source or input changed since planning');
    const desired = planBodies.get(replay);
    if (plan.actions.some(item => item.action === 'conflict')) throw new Error('bridge plan contains review conflict');
    const priorManifest = await manifest(harnessRoot, plan.target);
    const priorManifestBytes = await bytes(await safeStatePath(harnessRoot, manifestPath(plan.target)));
    const shared = await otherSharedOwners(harnessRoot, plan.projectRoot, plan.setupId, plan.target);
    const journal = { schemaVersion: 1, setupId: plan.setupId, target: plan.target, priorManifest, actions: [], borrowedBackups: [] };
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
        const reuseRetired = item.path === '.agents/hooks.json' && retiredHookBackupFrom(priorManifest)?.beforeSha256 === item.beforeSha256;
        const backup = before && !previousOwnership && !reuseRetired ? await backupPath(harnessRoot, plan.setupId, plan.target, item.path) : null;
        if (reuseRetired) {
          const retainedBackup = await bytes(await backupPath(harnessRoot, plan.setupId, plan.target, item.path));
          if (!retainedBackup || sha(retainedBackup) !== retiredHookBackupFrom(priorManifest).backupSha256) throw new Error(`bridge backup drift: ${item.path}`);
        }
        const entry = { path: item.path, kind: item.kind, beforeSha256: previousOwnership ? previousOwnership.beforeSha256 : item.beforeSha256,
          afterSha256: item.afterSha256, backupSha256: previousOwnership ? previousOwnership.backupSha256 : before ? sha(before) : null, ownership: 'harness-managed' };
        const journalEntry = { ...entry, currentBeforeBase64: before?.toString('base64') ?? null, backupCreated: false };
        journal.actions.push(journalEntry);
        await atomicWrite(journalFile, JSON.stringify(journal));
        if (backup) await createBackup(backup, before, item.path, async () => {
          journalEntry.backupCreated = true;
          await atomicWrite(journalFile, JSON.stringify(journal));
        });
        await beforeWrite?.(item.path);
        const latest = await bytes(await safePath(outputRoot, item.path, plan.target));
        if ((latest ? sha(latest) : null) !== item.beforeSha256) throw new Error(`bridge destination changed before write: ${item.path}`);
        if (desired.get(item.path)) await atomicWrite(destination, desired.get(item.path));
        else await unlink(destination);
        const written = await bytes(destination);
        if ((written ? sha(written) : null) !== item.afterSha256) throw new Error(`bridge post-write mismatch: ${item.path}`);
        changedPaths.push(item.path);
      }
      const retained = new Map((priorManifest?.actions ?? []).map(item => [item.path.toLowerCase(), item]));
      for (const item of journal.actions) {
        if (item.kind === 'retire') { retained.delete(item.path.toLowerCase()); continue; }
        const { currentBeforeBase64, backupCreated, ...recordEntry } = item;
        retained.set(item.path.toLowerCase(), recordEntry);
      }
      for (const item of plan.actions.filter(action => action.action === 'unchanged')) {
        if (retained.has(item.path.toLowerCase())) continue;
        const borrowed = shared.get(item.path);
        if (!borrowed) continue;
        if (borrowed.entry.afterSha256 !== item.afterSha256) throw new Error(`shared bridge bytes changed: ${item.path}`);
        if (borrowed.entry.backupSha256) {
          const sourceBackup = await bytes(await backupPath(harnessRoot, plan.setupId, borrowed.target, item.path));
          if (!sourceBackup || sha(sourceBackup) !== borrowed.entry.backupSha256) throw new Error(`shared bridge backup drift: ${item.path}`);
          const destinationBackup = await backupPath(harnessRoot, plan.setupId, plan.target, item.path);
          const existingBackup = await bytes(destinationBackup);
          if (existingBackup) throw new Error(`shared bridge backup collision: ${item.path}`);
          await createBackup(destinationBackup, sourceBackup, item.path, async () => {
            journal.borrowedBackups.push(item.path);
            await atomicWrite(journalFile, JSON.stringify(journal));
          });
        }
        retained.set(item.path.toLowerCase(), { ...borrowed.entry, ownership: 'harness-shared' });
      }
      const retiredBackups = [...(priorManifest?.retiredBackups ?? [])];
      for (const item of journal.actions) if (item.kind === 'retire' && item.path === '.agents/hooks.json' && item.backupSha256
          && !retiredBackups.some(backup => backup.path === item.path))
        retiredBackups.push({ path: item.path, beforeSha256: item.beforeSha256, backupSha256: item.backupSha256 });
      const record = { schemaVersion: 1, setupId: plan.setupId, target: plan.target, projectRoot: plan.projectRoot,
        actions: [...retained.values()].sort((a, b) => a.path.localeCompare(b.path)), ...(retiredBackups.length ? { retiredBackups } : {}) };
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
        for (const relative of journal.borrowedBackups) await rm(await backupPath(harnessRoot, plan.setupId, plan.target, relative), { force: true });
        const file = await safeStatePath(harnessRoot, manifestPath(plan.target));
        if (priorManifestBytes) await atomicWrite(file, priorManifestBytes);
        else await rm(file, { force: true });
        await rm(journalFile, { force: true });
      }
      throw new Error(drift ? `bridge rollback refused user drift: ${error.message}` : error.message);
    }
  });
}

export async function checkNativeBridge({ harnessRoot, projectRoot, target } = {}) {
  assertRoots(harnessRoot, projectRoot, target);
  let record;
  const issues = [];
  try { record = await manifest(harnessRoot, target); }
  catch (error) { if (error.message !== 'invalid bridge manifest') throw error; issues.push(error.message); }
  if ((await pendingBridgeJournals(harnessRoot)).length) issues.push('pending bridge journal requires recovery');
  if (!record || record.projectRoot !== path.resolve(projectRoot) || record.target !== target || !Array.isArray(record.actions)) issues.push('missing or mismatched adapter manifest');
  else for (const item of record.actions) {
    const current = await bytes(await safePath(projectRoot, item.path, target));
    if (!current || sha(current) !== item.afterSha256) issues.push(`owned file drift: ${item.path}`);
  }
  const verifiedRecord = record && record.projectRoot === path.resolve(projectRoot) && record.target === target && Array.isArray(record.actions) && !issues.length;
  const hooks = target === 'antigravity' ? !verifiedRecord ? 'unknown/unverified'
    : record.actions.some(item => item.path === '.agents/hooks.json') ? 'on/unverified' : 'off' : 'unverified';
  return { ok: issues.length === 0, issues, target, projectRoot: path.resolve(projectRoot), nativeSmoke: 'unverified', discovery: 'unverified', permission: 'unverified', hooks,
    ...(target === 'antigravity' ? { hookNote: hooks === 'off'
      ? 'Antigravity hooks: off (enable: npm run setup -- --target antigravity --antigravity-hooks on --plan; review/save JSON, then npm run setup -- --apply <plan-file>)'
      : hooks === 'on/unverified' ? 'Antigravity hooks: on/unverified (Windows issue #257)'
        : 'Antigravity hooks: unknown/unverified (manifest missing, mismatched, or drifted)' } : {}) };
}

export async function planBridgeUpdate(options = {}) { return buildBridgePlan(options); }

export async function rollbackNativeBridge({ harnessRoot, projectRoot, target, setupId } = {}, { beforeWrite, afterManifestRemoval } = {}) {
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
    const shared = await otherSharedOwners(harnessRoot, projectRoot, setupId, target);
    for (const item of record.actions) {
      const current = await bytes(await safePath(projectRoot, item.path, target));
      const currentHash = current ? sha(current) : null;
      if (currentHash !== item.afterSha256 && (!journal || currentHash !== item.beforeSha256)) throw new Error(`owned file drift: ${item.path}`);
      if (shared.has(item.path) && shared.get(item.path).entry.afterSha256 !== item.afterSha256)
        throw new Error(`shared bridge ownership drift: ${item.path}`);
      if (item.backupSha256) {
        const backup = await bytes(await backupPath(harnessRoot, setupId, target, item.path));
        if (!backup || sha(backup) !== item.backupSha256) throw new Error(`bridge backup drift: ${item.path}`);
      }
    }
    if (!journal) await atomicWrite(journalFile, JSON.stringify(record));
    const changedPaths = [];
    for (const item of [...record.actions].reverse()) {
      if (shared.has(item.path)) continue;
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
    await afterManifestRemoval?.();
    await rm(journalFile, { force: true });
    return bridgeResult({ harnessRoot, projectRoot, target, setupId }, changedPaths);
  });
}
