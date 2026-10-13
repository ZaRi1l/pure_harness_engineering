import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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
  execFileSync('git', ['init', '--initial-branch=main', projectRoot], { stdio: 'ignore' });
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
      const guidance = await readFile(path.join(f.projectRoot, 'AGENTS.md'), 'utf8');
      assert.match(guidance, /run from this project checkout and claim exact paths with: node '/);
      assert.match(guidance, /Release with: node '[^\n]+' release-claim <agent-id>/);
      assert.doesNotMatch(guidance, /--project|--checkout|--binding/);
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
  assert.match(agents, /claim <agent-id> <path>/);
  assert.doesNotMatch(agents, /--project|--checkout|--binding/);
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

test('Claude installs two executable subagent hooks while preserving user settings and rollback bytes', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.projectRoot, '.claude'));
  const original = '{\n  "permissions": {"allow": ["Read"]},\n  "hooks": {"SubagentStart": [{"hooks": [{"type": "command", "command": "echo user"}]}], "CustomEvent": []}\n}\n';
  const file = path.join(f.projectRoot, '.claude/settings.json');
  await writeFile(file, original);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  assert.equal(plan.actions.find(item => item.path === '.claude/settings.json')?.action, 'append-managed-block');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  const settings = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(settings.permissions, { allow: ['Read'] });
  assert.equal(settings.hooks.SubagentStart[0].hooks[0].command, 'echo user');
  assert.deepEqual(Object.keys(settings.hooks), ['SubagentStart', 'CustomEvent', 'SubagentStop']);
  for (const event of ['SubagentStart', 'SubagentStop']) {
    const hook = settings.hooks[event].at(-1).hooks[0];
    assert.equal(hook.type, 'command');
    assert.equal(hook.command, 'node');
    assert.deepEqual(hook.args, [path.join(f.harnessRoot, 'scripts/hook-runtime.mjs')]);
    assert.equal('commandWindows' in hook, false);
  }
  assert.equal(settings.hooks.SubagentStart.length, 2);
  assert.equal(settings.hooks.SubagentStop.length, 1);
  assert.equal(settings.hooks.SessionStart, undefined);
  assert.equal((await planBridgeUpdate({ ...f, target: 'claude' })).actions.find(item => item.path === '.claude/settings.json').action, 'unchanged');
  assert.equal((await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'claude' })).ok, true);
  await rollbackNativeBridge({ ...f, target: 'claude' });
  assert.equal(await readFile(file, 'utf8'), original);
});

test('Claude settings with no hooks are accepted and post-install user edits block updates', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.projectRoot, '.claude'));
  const file = path.join(f.projectRoot, '.claude/settings.json');
  await writeFile(file, '{"permissions":{"allow":["Read"]}}\n');
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  assert.equal(plan.actions.find(item => item.path === '.claude/settings.json')?.action, 'append-managed-block');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  const settings = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(settings.hooks), ['SubagentStart', 'SubagentStop']);
  settings.hooks.SubagentStop.push({ hooks: [{ type: 'command', command: 'echo later user change' }] });
  await writeFile(file, JSON.stringify(settings));
  const update = await planBridgeUpdate({ ...f, target: 'claude' });
  assert.equal(update.actions.find(item => item.path === '.claude/settings.json').action, 'conflict');
  await assert.rejects(rollbackNativeBridge({ ...f, target: 'claude' }), /drift/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).hooks.SubagentStop.at(-1).hooks[0].command, 'echo later user change');
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

test('serialized plan contains hashes and actions but no user file bodies or secrets', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.projectRoot, '.codex'));
  await writeFile(path.join(f.projectRoot, '.codex/config.toml'), '# private-user-token-7823\n[other]\nvalue = "keep"\n');
  await writeFile(path.join(f.projectRoot, 'AGENTS.md'), 'private-product-instruction-8392\n');
  const plan = await buildBridgePlan({ ...f, target: 'codex' });
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /private-user-token-7823|private-product-instruction-8392/);
  assert.ok(plan.actions.every(action => !('afterBase64' in action)));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: JSON.parse(serialized) });
  assert.match(await readFile(path.join(f.projectRoot, 'AGENTS.md'), 'utf8'), /private-product-instruction-8392/);
});

test('Apply requires already published independent project Git before management writes', async t => {
  const f = await fixture(t);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  await rm(path.join(f.projectRoot, '.git'), { recursive: true });
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }), /independent|Git|published/i);
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapter.lock')));
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/claude.json')));
});

test('duplicate user hook is never mistaken for appended owned hook on update', async t => {
  const f = await fixture(t);
  const script = path.join(f.harnessRoot, 'scripts/hook-runtime.mjs');
  const entry = { hooks: [{ type: 'command', command: `node '${script}'`, commandWindows: `powershell -NoProfile -Command "& node '${script}'"`, timeout: 5, statusMessage: 'Pure Harness lifecycle (candidate; native dispatch unverified)' }] };
  await mkdir(path.join(f.projectRoot, '.codex'));
  const anotherUserHook = { hooks: [{ type: 'command', command: 'echo user-other' }] };
  await writeFile(path.join(f.projectRoot, '.codex/hooks.json'), JSON.stringify({ hooks: { Stop: [entry, anotherUserHook] } }));
  const plan = await buildBridgePlan({ ...f, target: 'codex' });
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  const before = await readFile(path.join(f.projectRoot, '.codex/hooks.json'));
  const update = await planBridgeUpdate({ ...f, target: 'codex' });
  assert.equal(update.actions.find(item => item.path === '.codex/hooks.json').action, 'unchanged');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: update });
  assert.deepEqual(await readFile(path.join(f.projectRoot, '.codex/hooks.json')), before);
});

test('management path symlink is rejected before lock, manifest, or backup writes', async t => {
  const f = await fixture(t);
  const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'bridge-elsewhere-'));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  await symlink(elsewhere, path.join(f.harnessRoot, '.harness'), 'junction');
  await assert.rejects(buildBridgePlan({ ...f, target: 'claude' }), /symlink|junction/);
  assert.deepEqual(await readFile(path.join(elsewhere, 'sentinel')).catch(() => null), null);
});

test('nested adapter and backup symlinks cannot redirect bridge state writes', async t => {
  const adapters = await fixture(t);
  const external = await mkdtemp(path.join(os.tmpdir(), 'bridge-redirect-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await mkdir(path.join(adapters.harnessRoot, '.harness'));
  await symlink(external, path.join(adapters.harnessRoot, '.harness/adapters'), 'junction');
  await assert.rejects(buildBridgePlan({ ...adapters, target: 'claude' }), /symlink/);

  const backups = await fixture(t);
  await mkdir(path.join(backups.harnessRoot, '.harness'));
  await symlink(external, path.join(backups.harnessRoot, '.harness/backups'), 'junction');
  await writeFile(path.join(backups.projectRoot, 'AGENTS.md'), '# user product notes\n');
  const plan = await buildBridgePlan({ ...backups, target: 'claude' });
  await assert.rejects(applyBridgePlan({ harnessRoot: backups.harnessRoot, plan }), /symlink/);
  assert.deepEqual(await readdir(external), []);
});

test('Apply rechecks a destination changed immediately before its write', async t => {
  const f = await fixture(t);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  const file = path.join(f.projectRoot, 'AGENTS.md');
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }, { beforeWrite: async relative => {
    if (relative === 'AGENTS.md') await writeFile(file, 'outside writer bytes\n');
  } }), /changed|drift/i);
  assert.equal(await readFile(file, 'utf8'), 'outside writer bytes\n');
});

test('interrupted rollback retains journal and resumes without clobbering outside drift', async t => {
  const f = await fixture(t);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  let count = 0;
  await assert.rejects(rollbackNativeBridge({ ...f, target: 'claude' }, { beforeWrite: () => {
    if (++count === 2) throw new Error('rollback interrupted');
  } }), /interrupted/);
  assert.ok(await readFile(path.join(f.harnessRoot, '.harness/adapters/claude.rollback-journal.json')));
  await rollbackNativeBridge({ ...f, target: 'claude' });
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/claude.json')));
});

test('rollback retry refuses an outside edit to an already-restored path', async t => {
  const f = await fixture(t);
  const plan = await buildBridgePlan({ ...f, target: 'opencode' });
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  let count = 0, firstPath;
  await assert.rejects(rollbackNativeBridge({ ...f, target: 'opencode' }, { beforeWrite: relative => {
    if (++count === 1) firstPath = relative;
    if (count === 2) throw new Error('stop rollback');
  } }), /stop rollback/);
  const changed = path.join(f.projectRoot, firstPath);
  await writeFile(changed, 'outside user edit\n');
  await assert.rejects(rollbackNativeBridge({ ...f, target: 'opencode' }), /drift/);
  assert.equal(await readFile(changed, 'utf8'), 'outside user edit\n');
});

test('target switch shares AGENTS and common Skills without deleting the active target on either rollback order', async t => {
  for (const [first, second] of [['codex', 'opencode'], ['opencode', 'codex'], ['claude', 'opencode']]) for (const rollbackFirst of [first, second]) await t.test(`${first} to ${second}; rollback ${rollbackFirst} first`, async t => {
    const f = await fixture(t);
    const originalAgents = '# Product-owned instructions\nKeep this text.\n';
    await writeFile(path.join(f.projectRoot, 'AGENTS.md'), originalAgents);
    await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: await buildBridgePlan({ ...f, target: first }) });
    const secondPlan = await buildBridgePlan({ ...f, target: second });
    assert.ok(secondPlan.actions.every(item => item.action !== 'conflict'));
    await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: secondPlan });
    const sharedAgents = await readFile(path.join(f.projectRoot, 'AGENTS.md'));
    const sharedSkill = await readFile(path.join(f.projectRoot, '.agents/skills/testing/SKILL.md'));
    assert.equal((await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: second })).ok, true);
    await rollbackNativeBridge({ ...f, target: rollbackFirst });
    assert.deepEqual(await readFile(path.join(f.projectRoot, 'AGENTS.md')), sharedAgents);
    const remaining = rollbackFirst === first ? second : first;
    if (remaining === 'claude') {
      await assert.rejects(readFile(path.join(f.projectRoot, '.agents/skills/testing/SKILL.md')));
      assert.ok(await readFile(path.join(f.projectRoot, '.claude/skills/testing/SKILL.md')));
    } else assert.deepEqual(await readFile(path.join(f.projectRoot, '.agents/skills/testing/SKILL.md')), sharedSkill);
    assert.equal((await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: remaining })).ok, true);
    await rollbackNativeBridge({ ...f, target: remaining });
    assert.equal(await readFile(path.join(f.projectRoot, 'AGENTS.md'), 'utf8'), originalAgents);
    await assert.rejects(readFile(path.join(f.projectRoot, '.agents/skills/testing/SKILL.md')));
  });
});

test('rollback crash after manifest removal blocks new plan and Apply until journal recovery', async t => {
  const f = await fixture(t);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  await assert.rejects(rollbackNativeBridge({ ...f, target: 'claude' }, {
    afterManifestRemoval() { throw new Error('crash after manifest removal'); },
  }), /crash after manifest removal/);
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/claude.json')));
  assert.ok(await readFile(path.join(f.harnessRoot, '.harness/adapters/claude.rollback-journal.json')));
  await assert.rejects(buildBridgePlan({ ...f, target: 'claude' }), /pending.*journal/i);
  await assert.rejects(planBridgeUpdate({ ...f, target: 'claude' }), /pending.*journal/i);
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }), /pending.*journal/i);
  const check = await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'claude' });
  assert.equal(check.ok, false);
  assert.ok(check.issues.some(issue => /pending.*journal/i.test(issue)));
  await rollbackNativeBridge({ ...f, target: 'claude' });
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/claude.rollback-journal.json')));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  assert.equal((await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'claude' })).ok, true);
});

test('generated project guidance claim command runs against the fixed child from its cwd', async t => {
  const f = await fixture(t);
  execFileSync('git', ['init', '--initial-branch=main', f.harnessRoot], { stdio: 'ignore' });
  await mkdir(path.join(f.harnessRoot, 'scripts'));
  for (const name of ['runtime-state.mjs', 'project-context.mjs', 'task-records.mjs', 'telemetry-schema.mjs'])
    await cp(path.join(source, 'scripts', name), path.join(f.harnessRoot, 'scripts', name));
  await mkdir(path.join(f.harnessRoot, '.harness'));
  await writeFile(path.join(f.harnessRoot, '.harness/config.json'), JSON.stringify({ version: 1, layout: 'single-project', projectPath: 'project',
    target: 'codex', setupId: f.setupId, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' }));
  await writeFile(path.join(f.projectRoot, 'README.md'), 'product file\n');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: await buildBridgePlan({ ...f, target: 'codex' }) });
  const guidance = await readFile(path.join(f.projectRoot, 'AGENTS.md'), 'utf8');
  const claimTemplate = /claim exact paths with: (node '[^\n]+?' claim <agent-id> <path> \[\.\.\.\])\./.exec(guidance)?.[1];
  assert.ok(claimTemplate, 'generated guidance has an executable claim command');
  const claim = claimTemplate.replace('<agent-id>', 'bridge-worker').replace('<path> [...]', 'README.md');
  execFileSync('powershell', ['-NoProfile', '-Command', claim], { cwd: f.projectRoot, stdio: 'pipe' });
  const claims = JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/runtime/claims.json'), 'utf8'));
  assert.deepEqual(claims.claims.map(item => item.agent_id), ['bridge-worker']);
  const releaseTemplate = /Release with: (node '[^\n]+?' release-claim <agent-id>)\./.exec(guidance)?.[1];
  assert.ok(releaseTemplate, 'generated guidance has an executable release command');
  execFileSync('powershell', ['-NoProfile', '-Command', releaseTemplate.replace('<agent-id>', 'bridge-worker')], { cwd: f.projectRoot, stdio: 'pipe' });
  const released = JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/runtime/claims.json'), 'utf8'));
  assert.deepEqual(released.claims, []);
});
