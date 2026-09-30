import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertPortableMetadata, parseRole, assertSafeRelativePath } from '../harness/schema.mjs';
import { loadRoles, inventoryCodexRoles } from '../harness/inventory.mjs';

const root = path.resolve('.');
const valid = `---
schemaVersion: 1
id: planner
description: Plans bounded work.
tier: core
intent: read-only
modelPolicy:
  codex: gpt-6-sol
  claude: inherit
  opencode: inherit
  antigravity: inherit
codexReasoningEffort: high
needs:
  - read
requiresEnforcement: []
---
Plan work and report evidence.
`;

test('canonical role parses complete schema and source fingerprint', () => {
  const role = parseRole(valid, 'harness/agents/planner.md');
  assert.equal(role.id, 'planner');
  assert.equal(role.modelPolicy.claude, 'inherit');
  assert.equal(role.codexReasoningEffort, 'high');
  assert.equal(role.body, 'Plan work and report evidence.');
  assert.match(role.sourceSha256, /^[a-f0-9]{64}$/);
});

for (const [field, declaration] of [
  ['schemaVersion', 'schemaVersion: 1\n'],
  ['id', 'id: planner\n'],
  ['description', 'description: Plans bounded work.\n'],
  ['tier', 'tier: core\n'],
  ['intent', 'intent: read-only\n'],
  ['modelPolicy', 'modelPolicy:\n  codex: gpt-6-sol\n  claude: inherit\n  opencode: inherit\n  antigravity: inherit\n'],
  ['codexReasoningEffort', 'codexReasoningEffort: high\n'],
  ['needs', 'needs:\n  - read\n'],
  ['requiresEnforcement', 'requiresEnforcement: []\n'],
]) test(`rejects missing required ${field}`, () => {
  const source = valid.replace(declaration, '');
  assert.notEqual(source, valid, `fixture must remove ${field}`);
  assert.throws(() => parseRole(source, 'harness/agents/planner.md'), new RegExp(`missing ${field}`));
});

test('rejects block list items after an inline empty list', () => {
  const malformed = valid.replace('requiresEnforcement: []', 'requiresEnforcement: []\n  - read');
  assert.throws(() => parseRole(malformed, 'harness/agents/planner.md'), /unsupported YAML|inline empty list/);
});

for (const [name, source, pattern] of [
  ['uppercase ID', valid.replace('id: planner', 'id: Planner'), /id/],
  ['missing description', valid.replace('description: Plans bounded work.\n', ''), /description/],
  ['duplicate YAML key', valid.replace('id: planner', 'id: planner\nid: duplicate'), /duplicate key/],
  ['unknown field', valid.replace('modelPolicy:', 'unknownField: yes\nmodelPolicy:'), /unknownField/],
  ['YAML alias', valid.replace('description: Plans bounded work.', 'description: *shared'), /alias|unsupported/],
  ['implicit boolean', valid.replace('description: Plans bounded work.', 'description: yes'), /implicit boolean/],
  ['undeclared target model', valid.replace('  antigravity: inherit\n', ''), /antigravity/],
  ['invalid Codex reasoning effort', valid.replace('codexReasoningEffort: high', 'codexReasoningEffort: extreme'), /codexReasoningEffort/],
  ['undeclared enforcement need', valid.replace('requiresEnforcement: []', 'requiresEnforcement:\n  - write'), /requiresEnforcement/],
  ['nonportable runtime path leak', valid.replace('Plan work', 'See .ai/runtime/status.json. Plan work'), /portable/],
]) test(`rejects ${name}`, () => assert.throws(() => parseRole(source, 'harness/agents/planner.md'), pattern));

for (const [label, source] of [
    ['description host path', valid.replace('Plans bounded work.', 'Plans C:/Users/alice/private.txt work.')],
    ['model metadata host path', valid.replace('  claude: inherit', '  claude: C:/Users/alice/private.txt')],
    ['host path', valid.replace('Plan work', 'Read C:/Users/alice/private.txt. Plan work')],
    ['UNC host path', valid.replace('Plan work', String.raw`Read \\office-server\private\config. Plan work`)],
    ['credential', valid.replace('Plan work', `Use sk-${'A'.repeat(30)}. Plan work`)],
    ['project credential', valid.replace('Plan work', `Use sk-proj-${'A'.repeat(30)}. Plan work`)],
    ['assigned credential', valid.replace('Plan work', `api_key=${'A'.repeat(30)}. Plan work`)],
]) test(`rejects nonportable ${label}`, () =>
  assert.throws(() => parseRole(source, 'harness/agents/planner.md'), /portable|identity|credential/i));

test('allows generic project-declared goal adapter wording', () => {
  assert.doesNotThrow(() => parseRole(valid.replace('Plan work', 'Use a project-declared GOAL adapter. Plan work'), 'harness/agents/planner.md'));
});

for (const [label, metadata] of [
  ['nested host-path key', { inventory: [{ targets: { 'C:/Users/alice/private.txt': 'neutral' } }] }],
  ['nested credential key', { inventory: [{ targets: { [`sk-proj-${'A'.repeat(30)}`]: 'neutral' } }] }],
  ['escaped host-path key', JSON.parse(String.raw`{"\u0043:/Users/alice/private.txt":"neutral"}`)],
  ['escaped host-path value', JSON.parse(String.raw`{"neutral":"\u0043:/Users/alice/private.txt"}`)],
  ['nested host-path value', { inventory: [{ path: 'C:/Users/alice/private.txt' }] }],
  ['nested credential value', { inventory: [{ token: `sk-proj-${'A'.repeat(30)}` }] }],
]) test(`rejects decoded compatibility ${label}`, () =>
  assert.throws(() => assertPortableMetadata(metadata, 'harness/compatibility.json'), /portable|identity|credential/i));

test('allows nested project-declared goal adapter metadata', () => {
  assert.doesNotThrow(() => assertPortableMetadata({ adapters: [{ goal: {
    projectRelativePath: 'projects/example/goal.json', description: 'project-declared GOAL adapter',
  } }] }, 'harness/compatibility.json'));
});

test('core profile rejects contaminated optional canonical role before rendering', async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'harness-optional-portability-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await cp(path.join(root, 'harness/agents'), path.join(fixture, 'harness/agents'), { recursive: true });
  await cp(path.join(root, '.agents/skills'), path.join(fixture, '.agents/skills'), { recursive: true });
  const file = path.join(fixture, 'harness/agents/researcher.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace('description:', 'description: C:/Users/alice/private.txt '));
  await assert.rejects(loadRoles(fixture, 'core'), /portable|identity|credential/i);
});

test('safe relative paths reject traversal, absolute paths, and case collisions', () => {
  const seen = new Set();
  assert.equal(assertSafeRelativePath('harness/agents/planner.md', 'harness/agents', seen), 'harness/agents/planner.md');
  assert.throws(() => assertSafeRelativePath('harness/agents/Planner.md', 'harness/agents', seen), /collision/);
  for (const unsafe of ['../planner.md', 'harness/agents/../x.md', '/harness/agents/a.md', 'C:/harness/agents/a.md']) {
    assert.throws(() => assertSafeRelativePath(unsafe, 'harness/agents'), /path|root/);
  }
});

test('inventory preserves 14 unique hand-owned Codex role IDs', async () => {
  const roles = await inventoryCodexRoles(root);
  assert.equal(roles.length, 14);
  assert.equal(new Set(roles).size, 14);
  assert.deepEqual(roles.slice(0, 4), ['planner', 'worker', 'reviewer', 'supervisor']);
  assert.ok(!roles.includes('goal-manager'));
});

test('core profile preserves approved order; canonical goal role remains unregistered', async () => {
  const core = await loadRoles(root, 'core');
  assert.deepEqual(core.map(role => role.id), ['planner', 'worker', 'verifier', 'reviewer', 'goal-manager']);
  const all = await loadRoles(root, 'all');
  const registered = await inventoryCodexRoles(root);
  const tomlStems = (await readdir(path.join(root, '.codex/agents'))).filter(name => name.endsWith('.toml')).map(name => name.slice(0, -5));
  assert.equal(all.length, 15);
  assert.deepEqual(new Set(all.map(role => role.id).filter(id => id !== 'goal-manager')), new Set(registered));
  assert.deepEqual(new Set(registered), new Set(tomlStems));
  assert.deepEqual(new Set(all.map(role => role.id)), new Set([
    'planner', 'worker', 'verifier', 'reviewer', 'goal-manager', 'supervisor',
    'context-curator', 'preview-manager', 'impact-analyzer', 'integrator',
    'environment-doctor', 'researcher', 'security-auditor',
    'performance-analyzer', 'release-manager',
  ]));
  assert.deepEqual(all.slice(0, 5).map(role => role.id), core.map(role => role.id));
  assert.ok(all.slice(5).every(role => role.tier === 'optional'));
});

test('load rejects duplicate IDs and missing referenced skills', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'harness-schema-'));
  try {
    await mkdir(path.join(fixture, 'harness/agents'), { recursive: true });
    await writeFile(path.join(fixture, 'harness/agents/planner.md'), valid);
    await writeFile(path.join(fixture, 'harness/agents/worker.md'), valid);
    await assert.rejects(loadRoles(fixture, 'all'), /duplicate id/);
    await writeFile(path.join(fixture, 'harness/agents/worker.md'), valid.replace('id: planner', 'id: worker').replace('Plan work', 'Use .agents/skills/missing/SKILL.md. Plan work'));
    await assert.rejects(loadRoles(fixture, 'all'), /missing.*skill/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('load rejects a missing core role rather than returning a partial core profile', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'harness-missing-core-'));
  try {
    await mkdir(path.join(fixture, 'harness/agents'), { recursive: true });
    await writeFile(path.join(fixture, 'harness/agents/planner.md'), valid);
    await assert.rejects(loadRoles(fixture, 'core'), /missing core id: worker/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
