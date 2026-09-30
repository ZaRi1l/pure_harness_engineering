import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listSkills, skillAvailability } from '../harness/inventory.mjs';

const root = path.resolve('.');
const coreIds = ['task-routing', 'task-spec', 'testing', 'failure-recovery'];
const allIds = [...coreIds, 'context-curation', 'model-routing', 'token-efficiency', 'token-optimization'];

test('skill inventory has exact core and optional IDs with real canonical files', async () => {
  const core = await listSkills(root, 'core');
  const all = await listSkills(root, 'all');
  assert.deepEqual(core.map(skill => skill.id), coreIds);
  assert.deepEqual(new Set(all.map(skill => skill.id)), new Set(allIds));
  for (const skill of all) {
    assert.equal(skill.path, `.agents/skills/${skill.id}/SKILL.md`);
    assert.ok((await stat(path.join(root, skill.path))).isFile());
  }
  await assert.rejects(listSkills(root, 'unknown'), /profile/);
});

test('core skill selection rejects contaminated optional skill metadata and copied reference files', async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'harness-skills-portability-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await cp(path.join(root, '.agents/skills'), path.join(fixture, '.agents/skills'), { recursive: true });
  const optional = path.join(fixture, '.agents/skills/context-curation/SKILL.md');
  await writeFile(optional, (await readFile(optional, 'utf8')).replace('description:', 'description: C:/Users/alice/private.txt '));
  await assert.rejects(listSkills(fixture, 'core'), /portable|identity|credential/i);
  await cp(path.join(root, '.agents/skills/context-curation/SKILL.md'), optional);
  const reference = path.join(fixture, '.agents/skills/task-routing/profiles.md');
  const product = ['S', 'ILO'].join('');
  await writeFile(reference, (await readFile(reference, 'utf8')) + `\n${product} private notes\n`);
  await assert.rejects(listSkills(fixture, 'core'), /portable|identity|credential/i);
});

test('skill availability does not mistake source presence for native target discovery', async () => {
  const compatibility = JSON.parse(await readFile(path.join(root, 'harness/compatibility.json'), 'utf8'));
  const pinned = skillAvailability('codex', compatibility);
  assert.equal(pinned.status, 'native');
  assert.equal(pinned.version, 'codex-cli 0.153.4');
  for (const target of ['claude', 'opencode', 'antigravity']) {
    const result = skillAvailability(target, compatibility);
    assert.equal(result.status, 'unsupported', target);
    assert.ok(result.reason);
  }
  assert.equal(skillAvailability('antigravity', { antigravity: { skills: 'unverified' } }).status, 'unsupported');
  assert.equal(skillAvailability('unknown', compatibility).status, 'unsupported');
  assert.equal(skillAvailability('codex', { targets: { codex: { skillDiscovery: 'Official docs explicitly scan repository .agents/skills' } } }).status, 'unsupported');
});

test('Codex discovery needs structured positive evidence for the exact installed version', async () => {
  const compatibility = JSON.parse(await readFile(path.join(root, 'harness/compatibility.json'), 'utf8'));
  const bogusVersion = structuredClone(compatibility);
  bogusVersion.targets.codex.testedCliVersion = 'codex-cli 999.0.0';
  assert.equal(skillAvailability('codex', bogusVersion).status, 'unsupported');

  const negativeProse = structuredClone(compatibility);
  negativeProse.targets.codex.skillDiscovery = 'Does not scan repository .agents/skills';
  delete negativeProse.targets.codex.skillDiscoveryEvidence;
  assert.equal(skillAvailability('codex', negativeProse).status, 'unsupported');

  const unverified = structuredClone(compatibility);
  unverified.targets.codex.skillDiscoveryEvidence = { status: 'unverified', version: 'codex-cli 0.153.4', directory: '.agents/skills' };
  assert.equal(skillAvailability('codex', unverified).status, 'unsupported');

  const noEvidence = structuredClone(compatibility);
  delete noEvidence.targets.codex.skillDiscoveryEvidence;
  assert.equal(skillAvailability('codex', noEvidence).status, 'unsupported');
});
