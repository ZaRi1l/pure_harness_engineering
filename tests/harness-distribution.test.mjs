import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { makeGeneratedFile, parseGeneratedFile, validateManifest } from '../harness/ownership.mjs';
import { listSkills, loadRoles, skillAvailability } from '../harness/inventory.mjs';
import { assertPortableText } from '../harness/schema.mjs';
import { renderRole as renderCodexRole } from '../harness/targets/codex.mjs';
import { renderRole as renderClaudeRole } from '../harness/targets/claude.mjs';
import { renderRole as renderOpenCodeRole } from '../harness/targets/opencode.mjs';
import { renderRole as renderAntigravityRole } from '../harness/targets/antigravity.mjs';

const repository = path.resolve('.');
const exists = async absolute => stat(absolute).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-distribution-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const producer = path.join(root, 'producer'), consumer = path.join(root, 'consumer');
  await mkdir(producer);
  await mkdir(consumer);
  const compatibility = JSON.parse(await readFile(path.join(repository, 'harness/compatibility.json'), 'utf8'));
  const roles = await loadRoles(repository, 'core');
  const adapters = [['codex', renderCodexRole], ['claude', renderClaudeRole],
    ['opencode', renderOpenCodeRole], ['antigravity', renderAntigravityRole]];
  const items = adapters.flatMap(([target, render]) => roles.map(role => ({
    ...render(role, { compatibility, profile: 'core' }), target, roleId: role.id,
    sourcePath: role.sourcePath, sourceSha256: role.sourceSha256,
  })));
  const manifest = { entries: [] };
  for (const item of items) {
    const { file, entry } = makeGeneratedFile(item);
    await mkdir(path.dirname(path.join(producer, item.path)), { recursive: true });
    await writeFile(path.join(producer, item.path), file);
    manifest.entries.push(entry);
  }
  manifest.entries.sort((a, b) => a.target.localeCompare(b.target) || a.path.localeCompare(b.path));
  await writeFile(path.join(consumer, 'AGENTS.md'), '# Existing consumer policy\n');
  await writeFile(path.join(consumer, 'CLAUDE.md'), '# Existing Claude policy\n');
  const skills = await listSkills(repository, 'core');
  return { root, producer, consumer, manifest, skills, compatibility };
}

async function copyDistribution(manifest, skills, sourceRoot, consumerRoot, compatibility) {
  const entries = validateManifest(manifest);
  const paths = [];
  for (const entry of entries) {
    const source = path.join(sourceRoot, entry.path);
    const bytes = await readFile(source);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.fileSha256);
    parseGeneratedFile(entry.target, bytes.toString('utf8'), entry);
    await mkdir(path.dirname(path.join(consumerRoot, entry.path)), { recursive: true });
    await cp(source, path.join(consumerRoot, entry.path), { errorOnExist: true, force: false });
    paths.push(entry.path);
  }
  for (const skill of skills) {
    const directory = path.dirname(skill.path);
    await cp(path.join(repository, directory), path.join(consumerRoot, directory), { recursive: true, errorOnExist: true, force: false });
    paths.push(skill.path);
  }
  return { paths, skillDiscovery: Object.fromEntries([...new Set(entries.map(entry => entry.target))]
    .map(target => [target, skillAvailability(target, compatibility)])) };
}

async function readGeneratedText(root, manifest) {
  const bodies = [];
  for (const entry of validateManifest(manifest))
    bodies.push(parseGeneratedFile(entry.target, await readFile(path.join(root, entry.path), 'utf8'), entry).body);
  return bodies.join('\n');
}

test('synthetic manifest copies only generated outputs and canonical skills into a Node-free consumer', async t => {
  const { producer, consumer, manifest, skills, compatibility } = await fixture(t);
  const coreIds = ['planner', 'worker', 'verifier', 'reviewer', 'goal-manager'];
  const targets = ['codex', 'claude', 'opencode', 'antigravity'];
  assert.equal(manifest.entries.length, coreIds.length * targets.length);
  for (const target of targets)
    assert.deepEqual(new Set(manifest.entries.filter(entry => entry.target === target).map(entry => entry.roleId)), new Set(coreIds));
  const copied = await copyDistribution(manifest, skills, producer, consumer, compatibility);
  assert.deepEqual(new Set(copied.paths), new Set([...manifest.entries.map(entry => entry.path), ...skills.map(skill => skill.path)]));
  for (const entry of manifest.entries) assert.equal(await exists(path.join(consumer, entry.path)), true);
  for (const skill of skills) assert.equal(await exists(path.join(consumer, skill.path)), true);
  assert.equal(await readFile(path.join(consumer, 'AGENTS.md'), 'utf8'), '# Existing consumer policy\n');
  assert.equal(await readFile(path.join(consumer, 'CLAUDE.md'), 'utf8'), '# Existing Claude policy\n');
  for (const absent of ['node', 'npm', 'scripts', '.ai/runtime', '.codex/hooks.json', 'harness/agents'])
    assert.equal(await exists(path.join(consumer, absent)), false, absent);
  await rm(producer, { recursive: true });
  const prompts = await readGeneratedText(consumer, manifest);
  assert.doesNotMatch(prompts, /localhost|node scripts\/|\.ai\/runtime|npm/i);
  for (const reference of prompts.matchAll(/\.agents\/skills\/([a-z-]+)\/SKILL\.md/g))
    assert.equal(await exists(path.join(consumer, reference[0])), true, reference[0]);
});

test('copied skills do not imply unverified native discovery', async t => {
  const { producer, consumer, manifest, skills, compatibility } = await fixture(t);
  const copied = await copyDistribution(manifest, skills, producer, consumer, compatibility);
  assert.equal(copied.skillDiscovery.claude.status, 'unsupported');
  assert.match(copied.skillDiscovery.claude.reason, /not verified|No tested/i);
  assert.equal(copied.skillDiscovery.opencode.status, 'unsupported');
  assert.equal(copied.skillDiscovery.antigravity.status, 'unsupported');
  assert.equal(copied.skillDiscovery.codex.status, skillAvailability('codex', compatibility).status);
  assert.equal(compatibility.targets.claude.nativeSmoke, 'unverified');
});

test('all 15 canonical roles render portable descriptions and bodies for all four targets', async () => {
  const compatibility = JSON.parse(await readFile(path.join(repository, 'harness/compatibility.json'), 'utf8'));
  const roles = await loadRoles(repository, 'all');
  assert.equal(roles.length, 15);
  assert.equal((await listSkills(repository, 'all')).length, 8);
  for (const adapter of [
    { targetId: 'codex', renderRole: renderCodexRole },
    { targetId: 'claude', renderRole: renderClaudeRole },
    { targetId: 'opencode', renderRole: renderOpenCodeRole },
    { targetId: 'antigravity', renderRole: renderAntigravityRole },
  ]) for (const role of roles) {
    const output = adapter.renderRole(role, { compatibility, profile: 'all' });
    assertPortableText(output.body, output.path);
    assert.ok(output.body.includes(role.description), `${adapter.targetId}:${role.id}`);
  }
});
