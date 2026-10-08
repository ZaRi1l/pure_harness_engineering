import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBridgePlan, applyBridgePlan, checkNativeBridge, planBridgeUpdate, rollbackNativeBridge } from '../harness/native-bridge.mjs';

const source = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const harnessRoot = await mkdtemp(path.join(os.tmpdir(), 'native-bridge-'));
  t.after(() => rm(harnessRoot, { recursive: true, force: true }));
  await cp(path.join(source, 'harness/agents'), path.join(harnessRoot, 'harness/agents'), { recursive: true });
  await cp(path.join(source, '.agents/skills'), path.join(harnessRoot, '.agents/skills'), { recursive: true });
  await mkdir(path.join(harnessRoot, 'harness'), { recursive: true });
  await cp(path.join(source, 'harness/compatibility.json'), path.join(harnessRoot, 'harness/compatibility.json'));
  const projectRoot = path.join(harnessRoot, 'project');
  await mkdir(projectRoot);
  return { harnessRoot, projectRoot, setupId: randomUUID() };
}

test('each target plans and installs canonical role and skill bytes without engine files', async t => {
  for (const target of ['codex', 'claude', 'opencode', 'antigravity']) {
    await t.test(target, async t => {
      const f = await fixture(t);
      const plan = await buildBridgePlan({ ...f, target });
      assert.equal(plan.schemaVersion, 1);
      assert.equal(plan.nativeSmoke, 'unverified');
      assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
      assert.ok(plan.sourceHashes.roles.planner);
      assert.ok(plan.sourceHashes.skills['task-routing/SKILL.md']);
      assert.equal(plan.sourceHashes.roles.planner, sha(await readFile(path.join(f.harnessRoot, 'harness/agents/planner.md'))));
      assert.equal(plan.sourceHashes.skills['task-routing/SKILL.md'], sha(await readFile(path.join(f.harnessRoot, '.agents/skills/task-routing/SKILL.md'))));
      const rolePath = target === 'antigravity' ? '.agents/agents/planner/agent.md' :
        target === 'codex' ? '.codex/agents/planner.toml' : `.${target}/agents/planner.md`;
      assert.ok(plan.actions.some(item => item.path === rolePath && item.action === 'create'));
      const result = await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
      assert.equal(result.nativeSmoke, 'unverified');
      assert.equal(sha(await readFile(path.join(f.projectRoot, rolePath))), plan.actions.find(item => item.path === rolePath).afterSha256);
      assert.doesNotMatch(await readFile(path.join(f.projectRoot, rolePath), 'utf8'), /runtime-state\.mjs/);
      const skillPath = target === 'claude' ? '.claude/skills/task-routing/SKILL.md' : '.agents/skills/task-routing/SKILL.md';
      assert.equal(sha(await readFile(path.join(f.projectRoot, skillPath))),
        sha(await readFile(path.join(f.harnessRoot, '.agents/skills/task-routing/SKILL.md'))));
      const check = await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target });
      assert.equal(check.nativeSmoke, 'unverified');
      assert.equal(check.ok, true);
      for (const forbidden of ['harness', 'scripts', '.ai']) await assert.rejects(readFile(path.join(f.projectRoot, forbidden, 'runtime-state.mjs')));
    });
  }
});

test('Codex preserves user TOML, hook ordering, and product AGENTS while adding bounded content', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.projectRoot, '.codex'));
  const original = '# user comment\n[other]\nkey = "keep"\n';
  await writeFile(path.join(f.projectRoot, '.codex/config.toml'), original);
  const userHook = { hooks: [{ type: 'command', command: 'echo user' }] };
  const hooks = { hooks: { SessionStart: [userHook], CustomEvent: [userHook] } };
  await writeFile(path.join(f.projectRoot, '.codex/hooks.json'), JSON.stringify(hooks));
  await writeFile(path.join(f.projectRoot, 'AGENTS.md'), '# Product rules\nKeep this.\n');
  const plan = await buildBridgePlan({ ...f, target: 'codex' });
  assert.equal(plan.actions.find(item => item.path === '.codex/config.toml').action, 'append-managed-block');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  const config = await readFile(path.join(f.projectRoot, '.codex/config.toml'), 'utf8');
  assert.ok(config.startsWith(original));
  assert.match(config, /\[agents\.planner\]/);
  const merged = JSON.parse(await readFile(path.join(f.projectRoot, '.codex/hooks.json'), 'utf8'));
  assert.deepEqual(merged.hooks.SessionStart[0], userHook);
  assert.deepEqual(merged.hooks.CustomEvent, [userHook]);
  assert.deepEqual(Object.keys(merged.hooks).slice(0, 2), ['SessionStart', 'CustomEvent']);
  assert.deepEqual(['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop'].filter(event => merged.hooks[event].length),
    ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop']);
  assert.doesNotMatch(JSON.stringify(merged), /git rev-parse|trust.*bypass/i);
  const agents = await readFile(path.join(f.projectRoot, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('# Product rules\nKeep this.\n'));
  assert.match(agents, /\.harness\/runtime/);
  assert.match(agents, /--project project/);
  assert.match(agents, /If Node is unavailable/);
  const update = await planBridgeUpdate({ ...f, target: 'codex' });
  assert.ok(update.actions.every(item => item.action === 'unchanged'));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: update });
  assert.equal((await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'codex' })).ok, true);
  await rollbackNativeBridge({ ...f, target: 'codex' });
  assert.equal(await readFile(path.join(f.projectRoot, '.codex/config.toml'), 'utf8'), original);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.projectRoot, '.codex/hooks.json'), 'utf8')), hooks);
  assert.equal(await readFile(path.join(f.projectRoot, 'AGENTS.md'), 'utf8'), '# Product rules\nKeep this.\n');
});

test('planning marks conflicting role registration and malformed configuration for review', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.projectRoot, '.codex'));
  await writeFile(path.join(f.projectRoot, '.codex/config.toml'), '[agents.planner]\nconfig_file = "elsewhere"\n');
  const plan = await buildBridgePlan({ ...f, target: 'codex' });
  assert.equal(plan.actions.find(item => item.path === '.codex/config.toml').action, 'conflict');
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }), /conflict/);
});

test('rollback refuses to overwrite drift in installed bytes', async t => {
  const f = await fixture(t);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  const file = path.join(f.projectRoot, '.claude/agents/planner.md');
  await writeFile(file, 'user edit\n');
  await assert.rejects(rollbackNativeBridge({ ...f, target: 'claude' }), /drift|modified/i);
  assert.equal(await readFile(file, 'utf8'), 'user edit\n');
});

test('partial write failure restores exact baseline and leaves unrelated user file untouched', async t => {
  const f = await fixture(t);
  const unrelated = path.join(f.projectRoot, 'README.md');
  await writeFile(unrelated, 'user bytes\n');
  const plan = await buildBridgePlan({ ...f, target: 'opencode' });
  let writes = 0;
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }, {
    beforeWrite() { if (++writes === 3) throw new Error('injected failure'); },
  }), /injected failure/);
  assert.equal(await readFile(unrelated, 'utf8'), 'user bytes\n');
  await assert.rejects(readFile(path.join(f.projectRoot, '.opencode/agents/planner.md')));
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/opencode.json')));
});

test('malformed hooks and case-colliding paths cannot be installed', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.projectRoot, '.codex'));
  await writeFile(path.join(f.projectRoot, '.codex/hooks.json'), '{bad');
  const plan = await buildBridgePlan({ ...f, target: 'codex' });
  assert.equal(plan.actions.find(item => item.path === '.codex/hooks.json').action, 'conflict');
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }), /conflict/);
  const other = await fixture(t);
  await mkdir(path.join(other.projectRoot, '.Codex'));
  await assert.rejects(buildBridgePlan({ ...other, target: 'codex' }), /case collision/);
});

test('source drift invalidates reviewed plan and update restores prior owned version on rollback', async t => {
  const f = await fixture(t);
  const skillSource = path.join(f.harnessRoot, '.agents/skills/task-routing/SKILL.md');
  const skillTarget = path.join(f.projectRoot, '.agents/skills/task-routing/SKILL.md');
  const original = await readFile(skillSource);
  const stale = await buildBridgePlan({ ...f, target: 'antigravity' });
  await writeFile(skillSource, Buffer.concat([original, Buffer.from('\nAdditional portable guidance.\n')]));
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan: stale }), /source or input changed/);
  const first = await buildBridgePlan({ ...f, target: 'antigravity' });
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: first });
  const firstBytes = await readFile(skillTarget);
  await writeFile(skillSource, Buffer.concat([firstBytes, Buffer.from('\nFurther guidance.\n')]));
  const update = await planBridgeUpdate({ ...f, target: 'antigravity' });
  assert.equal(update.actions.find(item => item.path === '.agents/skills/task-routing/SKILL.md').action, 'replace-owned');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: update });
  await rollbackNativeBridge({ ...f, target: 'antigravity' });
  await assert.rejects(readFile(skillTarget));
  await assert.rejects(readFile(path.join(f.projectRoot, '.agents/agents/planner/agent.md')));
});

test('unsupported TOML and conflicting product scope remain review conflicts', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.projectRoot, '.codex'));
  await writeFile(path.join(f.projectRoot, '.codex/config.toml'), '[features]\nmulti_agent = false\n');
  await writeFile(path.join(f.projectRoot, 'AGENTS.md'), 'Use --core claims for project product files.\n');
  const plan = await buildBridgePlan({ ...f, target: 'codex' });
  assert.equal(plan.actions.find(item => item.path === '.codex/config.toml').action, 'conflict');
  assert.equal(plan.actions.find(item => item.path === 'AGENTS.md').action, 'conflict');
});

test('edited owned hook entry blocks update as conflict', async t => {
  const f = await fixture(t);
  const plan = await buildBridgePlan({ ...f, target: 'codex' });
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  const file = path.join(f.projectRoot, '.codex/hooks.json');
  const document = JSON.parse(await readFile(file, 'utf8'));
  document.hooks.Stop.pop();
  await writeFile(file, JSON.stringify(document));
  const update = await planBridgeUpdate({ ...f, target: 'codex' });
  assert.equal(update.actions.find(item => item.path === '.codex/hooks.json').action, 'conflict');
});
