import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSkills, loadRoles } from './inventory.mjs';
import { makeGeneratedFile } from './ownership.mjs';
import { assertPortableMetadata, assertPortableText } from './schema.mjs';
import * as codex from './targets/codex.mjs';
import * as claude from './targets/claude.mjs';
import * as opencode from './targets/opencode.mjs';
import * as antigravity from './targets/antigravity.mjs';

const adapters = [codex, claude, opencode, antigravity];
const byId = new Map(adapters.map(adapter => [adapter.targetId, adapter]));
const defaultSource = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const digest = content => createHash('sha256').update(content).digest('hex');
const slash = value => value.split(path.sep).join('/');

function targetNames(value) {
  const names = value === 'all' ? adapters.map(adapter => adapter.targetId)
    : typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length
      || names.some(name => !byId.has(name))) throw new Error('invalid --targets');
  return adapters.map(adapter => adapter.targetId).filter(id => names.includes(id));
}

async function assertNoSymlinkAncestors(absolute) {
  let current = path.parse(absolute).root;
  for (const segment of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error(`symlink path rejected: ${current}`);
    if (!metadata.isDirectory()) throw new Error(`not a directory: ${current}`);
  }
}

async function assertRegularSourceFile(absolute) {
  await assertNoSymlinkAncestors(path.dirname(absolute));
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink()) throw new Error(`symlink source rejected: ${absolute}`);
  if (!metadata.isFile()) throw new Error(`source is not a regular file: ${absolute}`);
}

async function assertSourceTree(directory) {
  await assertNoSymlinkAncestors(directory);
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink source rejected: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (!entry.isFile()) throw new Error(`unsupported source file type: ${absolute}`);
    }
  }
  await visit(directory);
}

function assertDistinct(source, output) {
  const a = path.normalize(source).toLowerCase(), b = path.normalize(output).toLowerCase();
  if (a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`))
    throw new Error('source/output overlap or nested path');
}

async function collectSkill(root, skillId, addFile, claudeSelected) {
  const base = path.join(root, '.agents/skills', skillId);
  async function visit(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) await visit(absolute);
      else if (item.isFile()) {
        const relative = slash(path.relative(root, absolute));
        const body = await readFile(absolute);
        assertPortableText(body.toString('utf8'), relative);
        addFile(relative, body, 'skill', { skillId, sourcePath: relative, sourceSha256: digest(body) });
        if (claudeSelected) {
          const nativeRelative = `.claude/skills/${skillId}/${slash(path.relative(base, absolute))}`;
          addFile(nativeRelative, body, 'skill', { target: 'claude', skillId,
            sourcePath: relative, sourceSha256: digest(body) });
        }
      } else throw new Error(`skill contains symlink or unsupported file type: ${absolute}`);
    }
  }
  await visit(base);
}

function codexRegistry(roles) {
  const lines = ['[features]', 'multi_agent = true', '', '[agents]', 'enabled = true'];
  for (const role of roles) lines.push('', `[agents.${role.id}]`,
    `description = ${JSON.stringify(role.description)}`, `config_file = "./agents/${role.id}.toml"`);
  return `${lines.join('\n')}\n`;
}

export async function exportBundle({ source = defaultSource, output, targets = 'all', profile = 'all' } = {}) {
  if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('--source must be absolute');
  if (typeof output !== 'string' || !path.isAbsolute(output)) throw new Error('--output must be absolute');
  if (!['core', 'all'].includes(profile)) throw new Error('invalid --profile');
  const sourceRoot = path.normalize(source), outputRoot = path.normalize(output);
  assertDistinct(sourceRoot, outputRoot);
  const names = targetNames(targets);
  await assertNoSymlinkAncestors(sourceRoot);
  await assertNoSymlinkAncestors(path.dirname(outputRoot));
  try { await lstat(outputRoot); throw new Error(`output already exists: ${outputRoot}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  await assertRegularSourceFile(path.join(sourceRoot, 'harness/compatibility.json'));
  await assertSourceTree(path.join(sourceRoot, 'harness/agents'));
  await assertSourceTree(path.join(sourceRoot, '.agents/skills'));

  const compatibilityText = await readFile(path.join(sourceRoot, 'harness/compatibility.json'), 'utf8');
  assertPortableText(compatibilityText, 'harness/compatibility.json');
  const compatibility = JSON.parse(compatibilityText);
  assertPortableMetadata(compatibility, 'harness/compatibility.json');
  const roles = await loadRoles(sourceRoot, profile), skills = await listSkills(sourceRoot, profile);
  const files = new Map(), entries = [];
  function addFile(relative, content, kind, metadata = {}) {
    if (relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')
        || path.isAbsolute(relative) || files.has(relative.toLowerCase())) throw new Error(`duplicate or unsafe bundle path: ${relative}`);
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    files.set(relative.toLowerCase(), { relative, body });
    entries.push({ path: relative, kind, sha256: digest(body), ...metadata });
  }
  for (const target of names) for (const role of roles) {
    const rendered = byId.get(target).renderRole(role, { compatibility, profile });
    assertPortableText(rendered.body, rendered.path);
    const generated = makeGeneratedFile({ ...rendered, target, roleId: role.id,
      sourcePath: role.sourcePath, sourceSha256: role.sourceSha256 });
    const nativeFile = target === 'codex' ? generated.file : rendered.body;
    addFile(rendered.path, nativeFile, 'role', { target, roleId: role.id,
      sourcePath: role.sourcePath, sourceSha256: role.sourceSha256 });
  }
  if (names.includes('codex')) addFile('.codex/config.toml', codexRegistry(roles), 'registry', { target: 'codex' });
  for (const skill of skills) await collectSkill(sourceRoot, skill.id, addFile, names.includes('claude'));
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = { schemaVersion: 1, generator: 'pure-harness-candidate-export', status: 'unverified',
    profile, targets: names, roleIds: roles.map(role => role.id), skillIds: skills.map(skill => skill.id),
    limits: ['Native target loading, permissions, and skill discovery are not verified by this export.',
      'No root instructions, hooks, project runtime binding, task telemetry, or existing project configuration is installed.'],
    entries };
  addFile('bundle-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'manifest');
  await mkdir(outputRoot); // exclusive reservation: never merge with an existing directory
  for (const { relative, body } of files.values()) {
    const destination = path.join(outputRoot, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, body, { flag: 'wx' });
  }
  return { output: outputRoot, manifest };
}
