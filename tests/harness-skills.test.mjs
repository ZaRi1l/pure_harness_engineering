import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listSkills, skillAvailability } from '../harness/inventory.mjs';

const root = path.resolve('.');
const hostPath = ['C:', 'Users', 'alice', 'private.txt'].join('/');
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

test('core guidance separates engine ownership from product work and routes specialized procedures', async () => {
  const core = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  const testing = await readFile(path.join(root, '.agents/skills/testing/SKILL.md'), 'utf8');
  const routing = await readFile(path.join(root, '.agents/skills/task-routing/SKILL.md'), 'utf8');
  const lifecycle = await readFile(path.join(root, '.agents/skills/task-routing/references/codex-lifecycle.md'), 'utf8');

  assert.match(core, /Root[\s\S]*overall (?:goal|request)/i);
  assert.match(core, /delegate[^\n]*SMALL|SMALL[^\n]*delegate/i);
  assert.match(core, /(?:nonduplicat|non-duplicat|avoid duplicat)/i);
  assert.match(core, /(?:architectural|architecture)[\s\S]*user/i);
  assert.match(core, /(?:actual|real) (?:commands|checks|test)[\s\S]*evidence/i);
  assert.match(core, /--core[^\n]*engine|engine[^\n]*--core/i);
  assert.match(core, /(?:product|selected project)[^\n]*(?:own|govern|guidance|instruction)/i);

  assert.match(testing, /(?:focused|targeted) behavioral regression test/i);
  assert.match(testing, /(?:record|document)[^\n]*impractical/i);
  assert.match(testing, /real.modules?[^\n]*DOM/i);
  assert.match(testing, /normal[^\n]*failure[^\n]*navigation/i);
  assert.match(testing, /without an available computer-use or browser path/i);

  assert.match(routing, /project-declared runtime/i);
  assert.match(routing, /references\/codex-lifecycle\.md/);
  assert.match(routing, /unavailable observability[^\n]*nonblocking|observability[^\n]*unavailable[^\n]*nonblocking/i);
  assert.doesNotMatch(routing, /turn.token|CODEX_THREAD_ID|followup_task/);
  assert.match(lifecycle, /turn.token/i);
  assert.match(lifecycle, /prior turn/i);
  assert.match(lifecycle, /exact[^\n]*ID/i);
  assert.equal((await listSkills(root, 'all')).length, allIds.length);
});

test('core skill selection rejects contaminated optional skill metadata and copied reference files', async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'harness-skills-portability-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await cp(path.join(root, '.agents/skills'), path.join(fixture, '.agents/skills'), { recursive: true });
  const optional = path.join(fixture, '.agents/skills/context-curation/SKILL.md');
  await writeFile(optional, (await readFile(optional, 'utf8')).replace('description:', `description: ${hostPath} `));
  await assert.rejects(listSkills(fixture, 'core'), /portable|identity|credential/i);
  await cp(path.join(root, '.agents/skills/context-curation/SKILL.md'), optional);
  const reference = path.join(fixture, '.agents/skills/task-routing/profiles.md');
  await writeFile(reference, (await readFile(reference, 'utf8')) + `\n${hostPath}\n`);
  await assert.rejects(listSkills(fixture, 'core'), /portable|identity|credential/i);
  await cp(path.join(root, '.agents/skills/task-routing/profiles.md'), reference);
  const lifecycle = path.join(fixture, '.agents/skills/task-routing/references/codex-lifecycle.md');
  await writeFile(lifecycle, (await readFile(lifecycle, 'utf8')) + `\n${hostPath}\n`);
  await assert.rejects(listSkills(fixture, 'core'), /portable|identity|credential/i);
});

test('skill availability does not mistake source presence for native target discovery', async () => {
  const compatibility = JSON.parse(await readFile(path.join(root, 'harness/compatibility.json'), 'utf8'));
  const pinned = skillAvailability('codex', compatibility);
  assert.equal(pinned.status, 'native');
  assert.equal(pinned.version, 'codex-cli 0.161.0');
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
