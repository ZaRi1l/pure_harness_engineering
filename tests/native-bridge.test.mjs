import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBridgePlan, applyBridgePlan, checkNativeBridge, planBridgeUpdate, rollbackNativeBridge } from '../harness/native-bridge.mjs';

const source = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, prefix = 'native-bridge-') {
  const harnessRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(harnessRoot, { recursive: true, force: true }));
  await cp(path.join(source, 'harness/agents'), path.join(harnessRoot, 'harness/agents'), { recursive: true });
  await cp(path.join(source, '.agents/skills'), path.join(harnessRoot, '.agents/skills'), { recursive: true });
  await mkdir(path.join(harnessRoot, 'harness'), { recursive: true });
  await cp(path.join(source, 'harness/compatibility.json'), path.join(harnessRoot, 'harness/compatibility.json'));
  await mkdir(path.join(harnessRoot, 'scripts'));
  await cp(path.join(source, 'scripts/hook-runtime.mjs'), path.join(harnessRoot, 'scripts/hook-runtime.mjs'));
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

test('Codex validates runtime script, bounds SessionEnd, and executes generated commands with one JSON ack', async t => {
  const f = await fixture(t, 'native bridge space ');
  for (const name of ['runtime-state.mjs', 'project-context.mjs', 'task-records.mjs', 'telemetry-schema.mjs'])
    await cp(path.join(source, 'scripts', name), path.join(f.harnessRoot, 'scripts', name));
  execFileSync('git', ['init', '--initial-branch=main', f.harnessRoot], { stdio: 'ignore' });
  await mkdir(path.join(f.harnessRoot, '.harness'));
  await writeFile(path.join(f.harnessRoot, '.harness/config.json'), JSON.stringify({ version: 1, layout: 'single-project', projectPath: 'project',
    target: 'codex', setupId: f.setupId, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' }));
  const plan = await buildBridgePlan({ ...f, target: 'codex' });
  assert.equal(plan.sourceHashes.hookRuntime, sha(await readFile(hookScript(f))));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  const hooks = JSON.parse(await readFile(path.join(f.projectRoot, '.codex/hooks.json'), 'utf8')).hooks;
  for (const [event, entries] of Object.entries(hooks)) {
    const hook = entries[0].hooks[0];
    assert.equal(hook.timeout, event === 'SessionEnd' ? 3 : 5);
    assert.match(hook.command, /--source=codex$/);
    const result = process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-Command', hook.commandWindows.slice('powershell -NoProfile -Command "'.length, -1)], { cwd: f.projectRoot, input: JSON.stringify({ hook_event_name: event, cwd: f.projectRoot }), encoding: 'utf8' })
      : spawnSync('sh', ['-c', hook.command], { cwd: f.projectRoot, input: JSON.stringify({ hook_event_name: event, cwd: f.projectRoot }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
    assert.deepEqual(JSON.parse(result.stdout), {});
  }
  await writeFile(hookScript(f), 'not the reviewed script');
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }), /source or input changed/);
});

test('Codex upgrades an exact legacy hook set while preserving user hooks and restores prior bytes on rollback', async t => {
  const f = await fixture(t);
  const file = path.join(f.projectRoot, '.codex/hooks.json');
  const script = hookScript(f);
  const legacy = { hooks: [{ type: 'command', command: `node '${script}'`, commandWindows: `powershell -NoProfile -Command "& node '${script}'"`, timeout: 5, statusMessage: 'Pure Harness lifecycle (candidate; native dispatch unverified)' }] };
  const user = { hooks: [{ type: 'command', command: 'echo user' }] };
  const events = ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop'];
  const previous = { hooks: Object.fromEntries(events.map(event => [event, [user, legacy]])) };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(previous, null, 2)}\n`);
  const original = `${JSON.stringify({ hooks: Object.fromEntries(events.map(event => [event, [user]])) }, null, 2)}\n`;
  const backup = path.join(f.harnessRoot, '.harness/backups', f.setupId, 'codex', sha(Buffer.from('.codex/hooks.json')));
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, original);
  // Simulate the earlier bridge manifest without changing any product bytes outside this fixture.
  const manifestFile = path.join(f.harnessRoot, '.harness/adapters/codex.json');
  await mkdir(path.dirname(manifestFile), { recursive: true });
  await writeFile(manifestFile, JSON.stringify({ schemaVersion: 1, setupId: f.setupId, target: 'codex', projectRoot: f.projectRoot,
    actions: [{ path: '.codex/hooks.json', kind: 'hooks', beforeSha256: sha(original), afterSha256: sha(await readFile(file)), backupSha256: sha(original), ownership: 'harness-managed' }] }));
  const upgrade = await buildBridgePlan({ ...f, target: 'codex' });
  assert.equal(upgrade.actions.find(item => item.path === '.codex/hooks.json').action, 'replace-owned');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: upgrade });
  const updated = JSON.parse(await readFile(file));
  for (const event of events) {
    assert.deepEqual(updated.hooks[event][0], user);
    assert.equal(updated.hooks[event].length, 2);
    assert.match(updated.hooks[event][1].hooks[0].command, /--source=codex$/);
  }
  assert.equal(updated.hooks.SessionEnd[1].hooks[0].timeout, 3);
  assert.equal((await planBridgeUpdate({ ...f, target: 'codex' })).actions.find(item => item.path === '.codex/hooks.json').action, 'unchanged');
  await rollbackNativeBridge({ ...f, target: 'codex' });
  assert.equal(await readFile(file, 'utf8'), original);
});

test('Codex rejects a hook runtime reached through a scripts junction', async t => {
  const f = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'hook-junction-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await cp(hookScript(f), path.join(outside, 'hook-runtime.mjs'));
  await rm(path.join(f.harnessRoot, 'scripts'), { recursive: true });
  await symlink(outside, path.join(f.harnessRoot, 'scripts'), 'junction');
  await assert.rejects(buildBridgePlan({ ...f, target: 'codex' }), /symlink|junction/);
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

const pluginPath = '.claude/skills/pure-harness-lifecycle';
const pluginManifest = `${pluginPath}/.claude-plugin/plugin.json`;
const pluginHooks = `${pluginPath}/hooks/hooks.json`;
const hookScript = f => path.join(f.harnessRoot, 'scripts/hook-runtime.mjs');
const hookGroup = script => ({ hooks: [{ type: 'command', command: 'node', args: [script], timeout: 5 }] });
async function legacyClaude(f, { initial = null, taskStop = false } = {}) {
  const file = path.join(f.projectRoot, '.claude/settings.json');
  if (initial !== null) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, initial); }
  const original = initial === null ? {} : JSON.parse(initial);
  const data = structuredClone(original);
  data.hooks ??= {};
  for (const event of ['SubagentStart', 'SubagentStop']) (data.hooks[event] ??= []).push(hookGroup(hookScript(f)));
  if (taskStop) (data.hooks.PostToolUse ??= []).push({ matcher: 'TaskStop', ...hookGroup(hookScript(f)) });
  const rendered = `${JSON.stringify(data, null, 2)}\n`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, rendered);
  const backupSha256 = initial === null ? null : sha(Buffer.from(initial));
  if (initial !== null) {
    const backup = path.join(f.harnessRoot, '.harness/backups', f.setupId, 'claude', sha(Buffer.from('.claude/settings.json')));
    await mkdir(path.dirname(backup), { recursive: true }); await writeFile(backup, initial);
  }
  const manifest = { schemaVersion: 1, setupId: f.setupId, target: 'claude', projectRoot: f.projectRoot,
    actions: [{ path: '.claude/settings.json', kind: 'hooks', beforeSha256: backupSha256, afterSha256: sha(Buffer.from(rendered)), backupSha256, ownership: 'harness-managed' }] };
  const manifestFile = path.join(f.harnessRoot, '.harness/adapters/claude.json');
  await mkdir(path.dirname(manifestFile), { recursive: true }); await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { file, rendered, manifestFile };
}

test('Antigravity stays off by default and opt-in preserves user entries through update and disable', async t => {
  const f = await fixture(t);
  const file = path.join(f.projectRoot, '.agents/hooks.json');
  const user = '{\r\n  "my-hook": {"enabled": true, "PreToolUse": [{"matcher": "read_file", "hooks": [{"type": "command", "command": "echo user"}]}]}\r\n}\r\n';
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, user);
  const off = await buildBridgePlan({ ...f, target: 'antigravity' });
  assert.equal(off.actions.some(item => item.path === '.agents/hooks.json'), false);
  assert.equal(off.sourceHashes.hookRuntime, undefined);
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: off });
  assert.equal(await readFile(file, 'utf8'), user);
  assert.match((await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'antigravity' })).hookNote, /off.*--antigravity-hooks on/);
  const on = await planBridgeUpdate({ ...f, target: 'antigravity', antigravityHooks: true });
  assert.equal(on.actions.find(item => item.path === '.agents/hooks.json').action, 'append-managed-block');
  assert.equal(on.sourceHashes.hookRuntime, sha(await readFile(hookScript(f))));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: on });
  const installed = JSON.parse(await readFile(file));
  assert.deepEqual(installed['my-hook'], JSON.parse(user)['my-hook']);
  assert.equal(installed['pure-harness-lifecycle'].enabled, true);
  for (const event of ['PreToolUse', 'PostToolUse']) {
    assert.equal(installed['pure-harness-lifecycle'][event][0].matcher, 'invoke_subagent|manage_subagents');
    assert.match(installed['pure-harness-lifecycle'][event][0].hooks[0].command, /--source=antigravity$/);
  }
  assert.match((await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'antigravity' })).hookNote, /on\/unverified/);
  assert.ok((await planBridgeUpdate({ ...f, target: 'antigravity', antigravityHooks: true })).actions.every(item => item.action === 'unchanged'));
  const disabled = await planBridgeUpdate({ ...f, target: 'antigravity', antigravityHooks: false });
  assert.equal(disabled.actions.find(item => item.path === '.agents/hooks.json').action, 'retire-owned');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: disabled });
  assert.equal(await readFile(file, 'utf8'), user);
  const manifest = JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/adapters/antigravity.json')));
  assert.equal(manifest.actions.some(item => item.path === '.agents/hooks.json'), false);
  const retained = manifest.retiredBackups.find(item => item.path === '.agents/hooks.json');
  const backup = path.join(f.harnessRoot, '.harness/backups', f.setupId, 'antigravity', sha(Buffer.from('.agents/hooks.json')));
  assert.equal(retained.backupSha256, sha(Buffer.from(user)));
  assert.equal(await readFile(backup, 'utf8'), user);
  await writeFile(backup, 'tampered backup');
  await assert.rejects(planBridgeUpdate({ ...f, target: 'antigravity', antigravityHooks: true }), /backup drift/);
  await writeFile(backup, user);
  await writeFile(file, '{"changed":true}');
  assert.equal((await planBridgeUpdate({ ...f, target: 'antigravity', antigravityHooks: true })).actions.find(item => item.path === '.agents/hooks.json').action, 'conflict');
  await writeFile(file, user);
  const reenabled = await planBridgeUpdate({ ...f, target: 'antigravity', antigravityHooks: true });
  assert.equal(reenabled.actions.find(item => item.path === '.agents/hooks.json').action, 'append-managed-block');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: reenabled });
  assert.equal(await readFile(backup, 'utf8'), user);
  await rollbackNativeBridge({ ...f, target: 'antigravity' });
  assert.equal(await readFile(file, 'utf8'), user);
  assert.equal(await readFile(backup, 'utf8'), user);
});

test('Antigravity hook ownership fails closed on drift and restores opt-in after interrupted disable', async t => {
  const f = await fixture(t);
  const file = path.join(f.projectRoot, '.agents/hooks.json');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: await buildBridgePlan({ ...f, target: 'antigravity', antigravityHooks: true }) });
  const installed = await readFile(file);
  const disable = await planBridgeUpdate({ ...f, target: 'antigravity', antigravityHooks: false });
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan: disable }, { beforeWrite(relative) {
    if (relative === '.agents/hooks.json') throw new Error('injected disable failure');
  } }), /injected disable failure/);
  assert.deepEqual(await readFile(file), installed);
  await writeFile(file, JSON.stringify({ other: { enabled: true } }));
  assert.equal((await planBridgeUpdate({ ...f, target: 'antigravity', antigravityHooks: false })).actions.find(item => item.path === '.agents/hooks.json').action, 'conflict');
  await assert.rejects(rollbackNativeBridge({ ...f, target: 'antigravity' }), /drift/);
  await writeFile(file, installed);
  await rollbackNativeBridge({ ...f, target: 'antigravity' });
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});

test('Claude fresh install writes project plugin, not settings, and rollback preserves user settings bytes', async t => {
  const f = await fixture(t);
  const file = path.join(f.projectRoot, '.claude/settings.json');
  const original = '{\r\n  "permissions": {"allow": ["Read"]},\r\n  "hooks": {"SubagentStart": [{"hooks": [{"type": "command", "command": "echo user"}]}], "PostToolUse": [{"matcher": "Edit", "hooks": [{"type": "command", "command": "echo user"}]}]}\r\n}\r\n';
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, original);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  assert.equal(plan.actions.some(item => item.path === '.claude/settings.json'), false);
  assert.deepEqual(plan.actions.filter(item => item.kind === 'plugin' || item.kind === 'hooks').map(item => item.path), [pluginManifest, pluginHooks]);
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal(JSON.parse(await readFile(path.join(f.projectRoot, pluginManifest), 'utf8')).name, 'pure-harness-lifecycle');
  const data = JSON.parse(await readFile(path.join(f.projectRoot, pluginHooks), 'utf8'));
  assert.deepEqual(Object.keys(data.hooks), ['SubagentStart', 'SubagentStop', 'SessionEnd', 'PostToolUse']);
  assert.deepEqual(data.hooks.PostToolUse.map(entry => entry.matcher), ['TaskStop', 'Agent']);
  for (const event of ['SubagentStart', 'SubagentStop', 'SessionEnd', 'PostToolUse']) {
    for (const entry of data.hooks[event]) {
      const hook = entry.hooks[0];
      assert.equal(hook.command, 'node');
      assert.deepEqual(hook.args, [hookScript(f), '--source=claude']);
      assert.equal('commandWindows' in hook, false);
    }
  }
  const update = await planBridgeUpdate({ ...f, target: 'claude' });
  assert.ok(update.actions.every(item => item.action === 'unchanged'));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: update });
  assert.equal((await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'claude' })).ok, true);
  await rollbackNativeBridge({ ...f, target: 'claude' });
  assert.equal(await readFile(file, 'utf8'), original);
  await assert.rejects(readFile(path.join(f.projectRoot, pluginHooks)));
});

test('Claude existing settings without hooks remain untouched; post-install plugin drift blocks update and rollback', async t => {
  const f = await fixture(t);
  const file = path.join(f.projectRoot, '.claude/settings.json');
  const original = '{"permissions":{"allow":["Read"]}}\n';
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, original);
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: await buildBridgePlan({ ...f, target: 'claude' }) });
  assert.equal(await readFile(file, 'utf8'), original);
  const hooks = path.join(f.projectRoot, pluginHooks);
  await writeFile(hooks, '{"hooks":{}}\n');
  const update = await planBridgeUpdate({ ...f, target: 'claude' });
  assert.equal(update.actions.find(item => item.path === pluginHooks).action, 'conflict');
  await assert.rejects(rollbackNativeBridge({ ...f, target: 'claude' }), /drift/);
  assert.equal(await readFile(hooks, 'utf8'), '{"hooks":{}}\n');
});

test('Claude migrates hash-clean two- and three-hook settings, restores exact user bytes and retires ownership', async t => {
  for (const taskStop of [false, true]) await t.test(taskStop ? 'three-hook' : 'two-hook', async t => {
    const f = await fixture(t);
    const original = '{\r\n  "permissions": {"allow": ["Read"]},\r\n  "hooks": {"SubagentStart": [{"hooks": [{"type": "command", "command": "echo user start"}]}], "PostToolUse": [{"matcher": "Edit", "hooks": [{"type": "command", "command": "echo user edit"}]}]}\r\n}\r\n';
    const { file, rendered, manifestFile } = await legacyClaude(f, { initial: original, taskStop });
    const plan = await buildBridgePlan({ ...f, target: 'claude' });
    const retired = plan.actions.find(item => item.path === '.claude/settings.json');
    assert.equal(retired.action, 'retire-owned');
    assert.equal(retired.beforeSha256, sha(Buffer.from(rendered)));
    assert.equal(retired.afterSha256, sha(Buffer.from(original)));
    assert.equal(plan.actions.at(-1).path, '.claude/settings.json', 'retirement happens after plugin writes');
    const result = await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
    assert.equal(result.changedPaths.at(-1), '.claude/settings.json');
    assert.equal(await readFile(file, 'utf8'), original);
    const ownership = JSON.parse(await readFile(manifestFile, 'utf8'));
    assert.equal(ownership.actions.some(action => action.path === '.claude/settings.json'), false);
    assert.equal(ownership.actions.some(action => action.path === pluginHooks), true);
    const hooks = JSON.parse(await readFile(path.join(f.projectRoot, pluginHooks), 'utf8')).hooks;
    assert.equal(hooks.SessionEnd.length, 1);
    assert.deepEqual(hooks.PostToolUse.map(entry => entry.matcher), ['TaskStop', 'Agent']);
    const update = await planBridgeUpdate({ ...f, target: 'claude' });
    assert.ok(update.actions.every(item => item.action === 'unchanged'));
    await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: update });
    await rollbackNativeBridge({ ...f, target: 'claude' });
    assert.equal(await readFile(file, 'utf8'), original);
  });
});

test('Claude plugin Node arguments preserve an absolute Windows path containing spaces', async t => {
  const f = await fixture(t, 'native bridge space ');
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  assert.match(hookScript(f), /native bridge space /);
  assert.ok(path.isAbsolute(hookScript(f)));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  const hooks = JSON.parse(await readFile(path.join(f.projectRoot, pluginHooks), 'utf8')).hooks;
  for (const event of ['SubagentStart', 'SubagentStop', 'SessionEnd', 'PostToolUse'])
    for (const entry of hooks[event]) assert.deepEqual(entry.hooks[0].args, [hookScript(f), '--source=claude']);
});

test('Claude rejects a hook runtime reached through a scripts junction during plan and Apply', async t => {
  const f = await fixture(t);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  const external = await mkdtemp(path.join(os.tmpdir(), 'bridge-hook-redirect-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await cp(hookScript(f), path.join(external, 'hook-runtime.mjs'));
  await rm(path.join(f.harnessRoot, 'scripts'), { recursive: true });
  await symlink(external, path.join(f.harnessRoot, 'scripts'), 'junction');
  await assert.rejects(buildBridgePlan({ ...f, target: 'claude' }), /symlink/);
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }), /symlink/);
  await assert.rejects(readFile(path.join(f.projectRoot, pluginHooks)), { code: 'ENOENT' });
  assert.deepEqual(await readdir(external), ['hook-runtime.mjs']);
});

test('Claude migrates a settings-based install over a zero-byte settings file and restores the empty bytes', async t => {
  const f = await fixture(t);
  const file = path.join(f.projectRoot, '.claude/settings.json');
  // Exact output of the earlier settings-based installer for an existing empty settings file.
  const rendered = `${JSON.stringify({ hooks: { SubagentStart: [hookGroup(hookScript(f))], SubagentStop: [hookGroup(hookScript(f))] } }, null, 2)}\n`;
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, rendered);
  const backup = path.join(f.harnessRoot, '.harness/backups', f.setupId, 'claude', sha(Buffer.from('.claude/settings.json')));
  await mkdir(path.dirname(backup), { recursive: true }); await writeFile(backup, '');
  const manifestFile = path.join(f.harnessRoot, '.harness/adapters/claude.json');
  await mkdir(path.dirname(manifestFile), { recursive: true });
  await writeFile(manifestFile, `${JSON.stringify({ schemaVersion: 1, setupId: f.setupId, target: 'claude', projectRoot: f.projectRoot,
    actions: [{ path: '.claude/settings.json', kind: 'hooks', beforeSha256: sha(''), afterSha256: sha(rendered), backupSha256: sha(''), ownership: 'harness-managed' }] }, null, 2)}\n`);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  const retired = plan.actions.find(item => item.path === '.claude/settings.json');
  assert.equal(retired.action, 'retire-owned');
  assert.equal(retired.afterSha256, sha(''));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  assert.equal(await readFile(file, 'utf8'), '');
  assert.equal(JSON.parse(await readFile(manifestFile, 'utf8')).actions.some(item => item.path === '.claude/settings.json'), false);
  const update = await planBridgeUpdate({ ...f, target: 'claude' });
  assert.ok(update.actions.every(item => item.action === 'unchanged'));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: update });
  assert.equal(await readFile(file, 'utf8'), '');
  await rollbackNativeBridge({ ...f, target: 'claude' });
  assert.equal(await readFile(file, 'utf8'), '');
});

test('Claude fresh install over a zero-byte settings file is not a conflict and keeps the empty bytes', async t => {
  const f = await fixture(t);
  const file = path.join(f.projectRoot, '.claude/settings.json');
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, '');
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  assert.equal(plan.actions.some(item => item.path === '.claude/settings.json'), false);
  assert.ok(plan.actions.every(item => item.action !== 'conflict'));
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  assert.equal((await readFile(file)).length, 0);
});

test('Claude refuses an absent or altered legacy backup even when managed settings are hash-clean', async t => {
  for (const backupState of ['missing', 'altered']) await t.test(backupState, async t => {
    const f = await fixture(t);
    const original = '{"permissions":{"allow":["Read"]}}\r\n';
    const { file, rendered, manifestFile } = await legacyClaude(f, { initial: original });
    const backup = path.join(f.harnessRoot, '.harness/backups', f.setupId, 'claude', sha(Buffer.from('.claude/settings.json')));
    if (backupState === 'missing') await rm(backup);
    else await writeFile(backup, 'altered');
    const manifestBefore = await readFile(manifestFile);
    await assert.rejects(buildBridgePlan({ ...f, target: 'claude' }), /backup drift/);
    assert.equal(await readFile(file, 'utf8'), rendered);
    assert.deepEqual(await readFile(manifestFile), manifestBefore);
  });
});

test('Claude legacy bridge-created settings are removed after plugin install, with interruption rollback', async t => {
  const f = await fixture(t);
  const { file, rendered, manifestFile } = await legacyClaude(f);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  const retired = plan.actions.find(item => item.path === '.claude/settings.json');
  assert.equal(retired.action, 'retire-owned');
  assert.equal(retired.afterSha256, null);
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }, { beforeWrite(relative) {
    if (relative === '.claude/settings.json') throw new Error('injected retirement failure');
  } }), /injected retirement failure/);
  assert.equal(await readFile(file, 'utf8'), rendered);
  await assert.rejects(readFile(path.join(f.projectRoot, pluginHooks)));
  assert.equal(JSON.parse(await readFile(manifestFile)).actions.length, 1);
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/claude.journal.json')), { code: 'ENOENT' });
  const result = await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  assert.equal(result.changedPaths.at(-1), '.claude/settings.json');
  await assert.rejects(readFile(file));
  assert.equal(JSON.parse(await readFile(manifestFile)).actions.some(item => item.path === '.claude/settings.json'), false);
  await rollbackNativeBridge({ ...f, target: 'claude' });
  await assert.rejects(readFile(file));
});

test('Claude refuses malformed, drifted and unverified legacy settings without adopting new bytes', async t => {
  const f = await fixture(t);
  const original = '{"permissions":{"allow":["Read"]}}\n';
  const { file, rendered, manifestFile } = await legacyClaude(f, { initial: original, taskStop: false });
  const manifestBefore = await readFile(manifestFile);
  const modified = JSON.parse(await readFile(file, 'utf8'));
  modified.hooks.PostToolUse = [{ matcher: 'TaskStop', ...hookGroup(hookScript(f)) }];
  await writeFile(file, JSON.stringify(modified));
  const drift = await buildBridgePlan({ ...f, target: 'claude' });
  assert.equal(drift.actions.find(item => item.path === '.claude/settings.json').action, 'conflict');
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan: drift }), /conflict/);
  assert.deepEqual(await readFile(manifestFile), manifestBefore);
  await writeFile(file, '{bad');
  const malformed = await buildBridgePlan({ ...f, target: 'claude' });
  assert.equal(malformed.actions.find(item => item.path === '.claude/settings.json').action, 'conflict');
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan: malformed }), /conflict/);
  await writeFile(file, rendered);
  const manifest = JSON.parse(manifestBefore);
  manifest.actions[0].afterSha256 = sha(Buffer.from('foreign bytes'));
  await writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(buildBridgePlan({ ...f, target: 'claude' }), /cannot be verified/);
});

test('Claude refuses a prior manifest pointing to unlisted plugin files', async t => {
  const f = await fixture(t);
  const { manifestFile } = await legacyClaude(f);
  const record = JSON.parse(await readFile(manifestFile));
  record.actions.push({ path: `${pluginPath}/hooks/register.tsx`, kind: 'hooks', beforeSha256: null,
    afterSha256: sha(Buffer.from('foreign')), backupSha256: null, ownership: 'harness-managed' });
  await writeFile(manifestFile, JSON.stringify(record));
  await assert.rejects(buildBridgePlan({ ...f, target: 'claude' }), /allowlisted/);
});

test('Claude detects duplicate legacy registration despite Windows slash, drive case, and path quotes', async t => {
  const f = await fixture(t);
  const script = hookScript(f);
  const equivalent = process.platform === 'win32' ? `"${script.replaceAll('\\', '/').toUpperCase()}"` : `"${script}"`;
  const settings = path.join(f.projectRoot, '.claude/settings.json');
  await mkdir(path.dirname(settings), { recursive: true });
  await writeFile(settings, JSON.stringify({ hooks: { SubagentStart: [{ hooks: [{ type: 'command', command: 'node', args: [equivalent] }] }] } }));
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  assert.equal(plan.actions.find(item => item.path === '.claude/settings.json').action, 'conflict');
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }), /conflict/);
});

test('Antigravity Windows command dispatches through cmd from a spaced path', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, 'agy hook space ');
  for (const name of ['runtime-state.mjs', 'project-context.mjs', 'task-records.mjs', 'telemetry-schema.mjs'])
    await cp(path.join(source, 'scripts', name), path.join(f.harnessRoot, 'scripts', name));
  execFileSync('git', ['init', '--initial-branch=main', f.harnessRoot], { stdio: 'ignore' });
  await mkdir(path.join(f.harnessRoot, '.harness'));
  await writeFile(path.join(f.harnessRoot, '.harness/config.json'), JSON.stringify({ version: 1, layout: 'single-project', projectPath: 'project',
    target: 'antigravity', setupId: f.setupId, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' }));
  const plan = await buildBridgePlan({ ...f, target: 'antigravity', antigravityHooks: true });
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan });
  const command = JSON.parse(await readFile(path.join(f.projectRoot, '.agents/hooks.json')))['pure-harness-lifecycle'].PreToolUse[0].hooks[0].command;
  assert.match(command, /^node "[^"]*agy hook space [^"]*" --source=antigravity$/);
  const result = spawnSync('cmd.exe', ['/d', '/c', command], { cwd: f.projectRoot, input: '{}', encoding: 'utf8', windowsVerbatimArguments: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test('Antigravity check reports unknown when manifest is missing or owned hooks drift', async t => {
  const f = await fixture(t);
  const missing = await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'antigravity' });
  assert.equal(missing.hooks, 'unknown/unverified');
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: await buildBridgePlan({ ...f, target: 'antigravity', antigravityHooks: true }) });
  await writeFile(path.join(f.projectRoot, '.agents/hooks.json'), '{}');
  const drift = await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'antigravity' });
  assert.equal(drift.hooks, 'unknown/unverified');
  assert.equal(drift.ok, false);
  await writeFile(path.join(f.harnessRoot, '.harness/adapters/antigravity.json'), '{bad');
  const invalid = await checkNativeBridge({ harnessRoot: f.harnessRoot, projectRoot: f.projectRoot, target: 'antigravity' });
  assert.equal(invalid.hooks, 'unknown/unverified');
  assert.equal(invalid.ok, false);
});

test('Claude refuses duplicate runtime registration in user settings and pre-existing plugin files', async t => {
  const f = await fixture(t);
  const settings = path.join(f.projectRoot, '.claude/settings.json');
  await mkdir(path.dirname(settings), { recursive: true });
  await writeFile(settings, JSON.stringify({ hooks: { SubagentStop: [hookGroup(hookScript(f))] } }));
  const conflict = await buildBridgePlan({ ...f, target: 'claude' });
  assert.equal(conflict.actions.find(item => item.path === '.claude/settings.json').action, 'conflict');
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan: conflict }), /conflict/);
  await writeFile(settings, '{"permissions":{"allow":["Read"]}}');
  await mkdir(path.dirname(path.join(f.projectRoot, pluginHooks)), { recursive: true });
  await writeFile(path.join(f.projectRoot, pluginHooks), '{"hooks":{}}');
  const pluginConflict = await buildBridgePlan({ ...f, target: 'claude' });
  assert.equal(pluginConflict.actions.find(item => item.path === pluginHooks).action, 'conflict');
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

test('Apply refuses an existing deterministic backup without overwriting or deleting it', async t => {
  const f = await fixture(t);
  const original = '# user product notes\n';
  const foreign = 'foreign backup bytes\n';
  const destination = path.join(f.projectRoot, 'AGENTS.md');
  await writeFile(destination, original);
  const plan = await buildBridgePlan({ ...f, target: 'claude' });
  const backup = path.join(f.harnessRoot, '.harness/backups', f.setupId, 'claude', sha(Buffer.from('AGENTS.md')));
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, foreign);
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }), /backup collision/);
  assert.equal(await readFile(backup, 'utf8'), foreign);
  assert.equal(await readFile(destination, 'utf8'), original);
  for (const item of plan.actions.filter(action => action.action === 'create'))
    await assert.rejects(readFile(path.join(f.projectRoot, item.path)), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/claude.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/claude.journal.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapter.lock')), { code: 'ENOENT' });
});

test('a matching foreign backup for a borrowed shared path is not adopted or removed', async t => {
  const f = await fixture(t);
  const original = '# user product notes\n';
  await writeFile(path.join(f.projectRoot, 'AGENTS.md'), original);
  await applyBridgePlan({ harnessRoot: f.harnessRoot, plan: await buildBridgePlan({ ...f, target: 'codex' }) });
  const firstBackup = path.join(f.harnessRoot, '.harness/backups', f.setupId, 'codex', sha(Buffer.from('AGENTS.md')));
  const foreignBackup = path.join(f.harnessRoot, '.harness/backups', f.setupId, 'opencode', sha(Buffer.from('AGENTS.md')));
  await mkdir(path.dirname(foreignBackup), { recursive: true });
  await writeFile(foreignBackup, await readFile(firstBackup));
  const sharedBefore = await readFile(path.join(f.projectRoot, 'AGENTS.md'));
  const plan = await buildBridgePlan({ ...f, target: 'opencode' });
  await assert.rejects(applyBridgePlan({ harnessRoot: f.harnessRoot, plan }), /backup collision/);
  assert.equal(await readFile(foreignBackup, 'utf8'), original);
  assert.deepEqual(await readFile(path.join(f.projectRoot, 'AGENTS.md')), sharedBefore);
  assert.equal(await readFile(firstBackup, 'utf8'), original);
  for (const item of plan.actions.filter(action => action.action === 'create'))
    await assert.rejects(readFile(path.join(f.projectRoot, item.path)), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/opencode.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.harnessRoot, '.harness/adapters/opencode.journal.json')), { code: 'ENOENT' });
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
