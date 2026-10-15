import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { handleHook, runHook } from '../scripts/hook-runtime.mjs';
import { RuntimeStore } from '../scripts/runtime-state.mjs';
import { fixedFixture } from './support/fixed-project-fixture.mjs';

const legacyHook = (payload, root) => handleHook(payload, RuntimeStore.legacyFixture(root));

test('anchored hook reaches fixed child runtime and ignores outside checkout without leaking prompt', async () => {
  const f = await fixedFixture();
  await runHook({ hook_event_name: 'SubagentStart', cwd: f.projectRoot, agent_id: 'native-1',
    parent_thread_id: 'parent-1', task_id: 'task-1', turn_token: 'turn-1', spawned_at: '2026-10-08T00:00:00.000Z', task: 'SECRET_PROMPT' }, { harnessRoot: f.harnessRoot });
  const store = new RuntimeStore(await (await import('../scripts/project-context.mjs')).loadFixedProjectContext({ harnessRoot: f.harnessRoot, cwd: f.projectRoot }));
  const snapshot = await store.readSnapshot();
  assert.equal(snapshot.status.agents[0].id, 'native-1');
  assert.equal(snapshot.status.agents[0].current_task, '');
  assert.equal(snapshot.status.agents[0].turn_token, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_PROMPT/);
  const before = JSON.stringify(snapshot);
  await runHook({ hook_event_name: 'SessionStart', cwd: path.dirname(f.harnessRoot) }, { harnessRoot: f.harnessRoot, diagnostic: () => {} });
  assert.equal(JSON.stringify(await store.readSnapshot()), before);
});

test('Claude project hooks record native start and stop without inferring a resume or storing prompt bodies', async () => {
  const f = await fixedFixture();
  const cwd = f.projectRoot;
  await runHook({ hook_event_name: 'SubagentStart', cwd, agent_id: 'claude-native-1', agent_type: 'Explore', prompt: 'SECRET_PROMPT' }, { harnessRoot: f.harnessRoot });
  await runHook({ hook_event_name: 'SubagentStart', cwd, agent_id: 'claude-native-1', agent_type: 'Explore', prompt: 'SECRET_PROMPT' }, { harnessRoot: f.harnessRoot });
  const store = new RuntimeStore(await (await import('../scripts/project-context.mjs')).loadFixedProjectContext({ harnessRoot: f.harnessRoot, cwd }));
  const active = await store.readSnapshot();
  assert.deepEqual(active.status.active_agents.map(agent => agent.id), ['claude-native-1']);
  assert.equal(active.status.agents[0].role, 'unknown');
  assert.equal(active.events.filter(event => event.type === 'agent_started').length, 1);
  await runHook({ hook_event_name: 'SubagentStop', cwd, agent_id: 'claude-native-1', agent_type: 'Explore', agent_transcript_path: 'SECRET_OUTPUT' }, { harnessRoot: f.harnessRoot });
  await runHook({ hook_event_name: 'SubagentStop', cwd, agent_id: 'claude-native-1', agent_type: 'Explore' }, { harnessRoot: f.harnessRoot });
  const stopped = await store.readSnapshot();
  assert.equal(stopped.status.agents[0].status, 'stopped');
  assert.deepEqual(stopped.status.active_agents, []);
  assert.equal(stopped.events.filter(event => event.type === 'agent_stopped').length, 1);
  assert.deepEqual(stopped.status.signals.map(signal => signal.kind), ['delegate', 'result']);
  assert.doesNotMatch(JSON.stringify(stopped), /SECRET_PROMPT|SECRET_OUTPUT/);
  assert.equal(stopped.status.agents[0].resumed_at, undefined);
  assert.ok(stopped.events.filter(event => event.type === 'hook_dispatch').every(event => !event.message.includes('Codex')));
});

test('stop dispatch distinguishes missing, unknown, stale, mismatched, stopped, and duplicate without payload bodies', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root); await store.initialize();
  const stop = payload => legacyHook({ hook_event_name: 'SubagentStop',
    prompt: 'SECRET_PROMPT', agent_transcript_path: 'SECRET_PATH', error: 'SECRET_ERROR', ...payload }, root);
  await stop({ agent_id: 'SECRET INVALID ID' });
  await stop({ agent_id: 'unknown-1' });
  await store.agentStarted('stale-1', 'worker', '', { source: 'hook' });
  await store.agentStopped('stale-1', 'stopped', { source: 'orchestration' });
  await store.agentResumed('stale-1', '', 'Accepted', { task_id: 'shared', turn_token: 'turn-2', source: 'orchestration' });
  await store.claim('stale-1', ['src/stale']);
  await stop({ agent_id: 'stale-1', task_id: 'shared' });
  await store.agentStarted('mismatch-1', 'worker', '', { source: 'hook' });
  await store.agentStopped('mismatch-1', 'stopped', { source: 'orchestration' });
  await store.agentResumed('mismatch-1', '', 'Accepted', { task_id: 'current', turn_token: 'turn-3', source: 'orchestration' });
  await store.claim('mismatch-1', ['src/mismatch']);
  await stop({ agent_id: 'mismatch-1', task_id: 'old', turn_token: 'turn-3' });
  await store.agentStarted('accepted-1', 'worker', '', { source: 'hook' });
  await store.claim('accepted-1', ['src/accepted']);
  await stop({ agent_id: 'accepted-1' });
  await stop({ agent_id: 'accepted-1' });
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.events.filter(event => event.type === 'hook_stop_diagnostic' && event.data?.hook_event === 'SubagentStop')
    .map(event => [event.data.agent_id, event.data.disposition]), [
    [undefined, 'missing_id'], ['unknown-1', 'unknown_agent'], ['stale-1', 'stale_turn'],
    ['mismatch-1', 'task_mismatch'], ['accepted-1', 'stopped'], ['accepted-1', 'duplicate'],
  ]);
  assert.deepEqual(snapshot.claims.claims.map(claim => claim.agent_id).sort(), ['mismatch-1', 'stale-1']);
  assert.deepEqual(snapshot.status.active_agents.map(agent => agent.id).sort(), ['mismatch-1', 'stale-1']);
  assert.equal(snapshot.events.filter(event => event.type === 'agent_stopped' && event.data.agent_id === 'accepted-1').length, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_PROMPT|SECRET_PATH|SECRET_ERROR|SECRET INVALID ID/);
});

test('hook without native child or parent IDs does not fabricate a confirmed link', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = new RuntimeStore(RuntimeStore.coreContext({ engineRoot: root, runtimeRoot: path.join(root, '.ai', 'runtime') }));
  await handleHook({ hook_event_name: 'SubagentStart', task_id: 'task-1', root_turn_id: 'root-1', task: 'SECRET_PROMPT' }, store);
  assert.deepEqual(await store.readChildLinks(), []);
  assert.deepEqual((await store.readStatus()).agents, []);
});

test('TaskStop callback diagnostic stores only categorical facts and never stops an agent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root);
  await store.agentStarted('a1aed61c61cefb817', 'worker', '', { source: 'hook' });
  await handleHook({ hook_event_name: 'PostToolUse', tool_name: 'TaskStop',
    tool_input: { task_id: 'a1aed61c61cefb817', prompt: 'SECRET_INPUT' },
    tool_response: { task_type: 'local_agent',
      message: 'Successfully stopped task: a1aed61c61cefb817 (SECRET_RESPONSE)' } }, store);
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.events.filter(event => event.type === 'taskstop_callback_diagnostic').map(event => event.data), [{
    hook_event: 'PostToolUse', input_id: 'valid', response_id: 'missing_or_invalid', task_type: 'local_agent', success_marker: 'other_or_missing',
  }]);
  assert.deepEqual(snapshot.status.active_agents.map(agent => agent.id), ['a1aed61c61cefb817']);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_INPUT|SECRET_RESPONSE/);
});

test('TaskStop accepts punctuation in a confirmed task description without storing it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root);
  const id = 'native-1';
  await store.agentStarted(id, 'worker', '', { source: 'hook' });
  await store.claim(id, ['src/backend']);
  await handleHook({ hook_event_name: 'PostToolUse', tool_name: 'TaskStop',
    tool_input: { task_id: id },
    tool_response: { task_id: id, task_type: 'local_agent', message: `Successfully stopped task: ${id} (Fix #42: parser?! [a+b] & @scope)` } }, store);
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.status.active_agents, []);
  assert.deepEqual(snapshot.claims.claims, []);
  assert.equal(snapshot.events.filter(event => event.type === 'agent_stopped').length, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /Fix #42|parser\?!|@scope/);
});

test('TaskStop accepts balanced parentheses in a bounded task description', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root);
  const id = 'native-1';
  await store.agentStarted(id, 'worker', '', { source: 'hook' });
  await handleHook({ hook_event_name: 'PostToolUse', tool_name: 'TaskStop',
    tool_input: { task_id: id },
    tool_response: { task_id: id, task_type: 'local_agent', message: `Successfully stopped task: ${id} (Fix (nested) parser)` } }, store);
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.status.active_agents, []);
  assert.doesNotMatch(JSON.stringify(snapshot), /Fix \(nested\) parser/);
});

test('confirmed native TaskStop stops only its matching active agent and releases its claims', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root);
  const id = 'a1aed61c61cefb817';
  await store.agentStarted(id, 'worker', '', { source: 'hook' });
  await store.claim(id, ['src/backend']);
  const stop = { hook_event_name: 'PostToolUse', tool_name: 'TaskStop',
    tool_input: { task_id: id, prompt: 'SECRET_INPUT' },
    tool_response: { task_id: id, task_type: 'local_agent', message: `Successfully stopped task: ${id} (Observe native forced termination)`, command: 'SECRET_RESPONSE' } };
  await handleHook(stop, store);
  await handleHook(stop, store);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: id }, store);
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.status.active_agents, []);
  assert.deepEqual(snapshot.claims.claims, []);
  assert.equal(snapshot.status.agents[0].stop_source, 'hook');
  assert.equal(snapshot.events.filter(event => event.type === 'agent_stopped').length, 1);
  assert.deepEqual(snapshot.events.filter(event => event.type === 'hook_stop_diagnostic').map(event => [event.data.hook_event, event.data.disposition]), [
    ['PostToolUse:TaskStop', 'stopped'], ['PostToolUse:TaskStop', 'duplicate'], ['SubagentStop', 'duplicate'],
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_INPUT|SECRET_RESPONSE|Observe native forced termination/);
});

test('TaskStop failure, mismatch, invalid ID, and wrong context leave agents active', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root);
  const id = 'a1aed61c61cefb817';
  await store.agentStarted(id, 'worker', '', { source: 'hook' });
  await store.claim(id, ['src/backend']);
  const base = { hook_event_name: 'PostToolUse', tool_name: 'TaskStop', tool_input: { task_id: id },
    tool_response: { task_id: id, task_type: 'local_agent', message: `Successfully stopped task: ${id} (Worker)` } };
  for (const payload of [
    { ...base, tool_response: { ...base.tool_response, message: 'Failed to stop task: SECRET_ERROR' } },
    { ...base, tool_response: { ...base.tool_response, isError: true } },
    { ...base, tool_response: { ...base.tool_response, message: `${base.tool_response.message} SECRET_ERROR` } },
    { ...base, tool_response: { ...base.tool_response, message: `Successfully stopped task: ${id} (Worker) (SECRET_ERROR)` } },
    { ...base, tool_response: { ...base.tool_response, message: `Successfully stopped task: ${id} (Worker) STOP_FAILED)` } },
    // Without a structured native success field, even a legitimate unmatched ')' is ambiguous and must fail closed.
    { ...base, tool_response: { ...base.tool_response, message: `Successfully stopped task: ${id} (Fix unmatched ) in parser)` } },
    { ...base, tool_response: { ...base.tool_response, task_id: 'other-id' } },
    { ...base, tool_response: { ...base.tool_response, task_type: 'shell_command' } },
    { ...base, tool_response: { ...base.tool_response, message: `Successfully stopped task: ${id} (Worker)\nSECRET_ERROR` } },
    { ...base, tool_input: { task_id: 'INVALID ID' } },
    { ...base, tool_name: 'Agent' },
    { ...base, hook_event_name: 'PreToolUse' },
  ]) await handleHook(payload, store);
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.status.active_agents.map(agent => agent.id), [id]);
  assert.deepEqual(snapshot.claims.claims.map(claim => claim.agent_id), [id]);
  assert.equal(snapshot.events.filter(event => event.type === 'agent_stopped').length, 0);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_ERROR|INVALID ID/);
});

test('unknown and delayed native TaskStop cannot stop a resumed turn or release its claims', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root);
  const stop = id => ({ hook_event_name: 'PostToolUse', tool_name: 'TaskStop', tool_input: { task_id: id },
    tool_response: { task_id: id, task_type: 'local_agent', message: `Successfully stopped task: ${id} (Worker)` } });
  await handleHook(stop('unknown-1'), store);
  await store.agentStarted('native-1', 'worker', '', { source: 'hook' });
  await store.agentStopped('native-1', 'stopped', { source: 'hook' });
  await store.agentResumed('native-1', '', 'Accepted', { turn_token: 'turn-2', source: 'orchestration' });
  await store.claim('native-1', ['src/backend']);
  await handleHook(stop('native-1'), store);
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.status.active_agents.map(agent => agent.id), ['native-1']);
  assert.deepEqual(snapshot.claims.claims.map(claim => claim.agent_id), ['native-1']);
  assert.deepEqual(snapshot.events.filter(event => event.type === 'hook_stop_diagnostic' && event.data.hook_event === 'PostToolUse:TaskStop')
    .map(event => event.data.disposition), ['unknown_agent', 'stale_turn']);
});

test('TaskStop handler rejects mismatched project checkout without recording a native stop', async () => {
  const f = await fixedFixture();
  const store = new RuntimeStore(await (await import('../scripts/project-context.mjs')).loadFixedProjectContext({ harnessRoot: f.harnessRoot, cwd: f.projectRoot }));
  const id = 'a1aed61c61cefb817';
  await store.agentStarted(id, 'worker', '', { source: 'hook' });
  await runHook({ hook_event_name: 'PostToolUse', tool_name: 'TaskStop', cwd: path.dirname(f.harnessRoot),
    tool_input: { task_id: id }, tool_response: { task_id: id, task_type: 'local_agent', message: `Successfully stopped task: ${id} (Worker)` } },
  { harnessRoot: f.harnessRoot, diagnostic: () => {} });
  assert.deepEqual((await store.readStatus()).active_agents.map(agent => agent.id), [id]);
});

test('unknown event names cannot persist prompt or credential-shaped payload text', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root);
  await handleHook({ hook_event_name: 'SessionStart SECRET_CREDENTIAL_BODY', event: 'SubagentStart', task: 'SECRET_PROMPT_BODY' }, store);
  const snapshot = await store.readSnapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_CREDENTIAL_BODY|SECRET_PROMPT_BODY/);
  assert.deepEqual(snapshot.status.agents, []);
});

test('agent nickname and unsupported outcome cannot enter lifecycle status, signals, or events', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root);
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'native-1', agent_name: 'SECRET_NICKNAME_BODY',
    agent_type: 'SECRET_ROLE_BODY', task: 'SECRET_PROMPT_BODY' }, store);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'native-1', outcome: 'SECRET_OUTPUT_BODY' }, store);
  const snapshot = await store.readSnapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_NICKNAME_BODY|SECRET_ROLE_BODY|SECRET_PROMPT_BODY|SECRET_OUTPUT_BODY/);
  assert.equal(snapshot.status.agents[0].role, 'unknown');
  assert.equal(snapshot.status.agents[0].status, 'stopped');
});

test('agent_name alone is not a role and body-like child metadata is not retained', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = new RuntimeStore(RuntimeStore.coreContext({ engineRoot: root, runtimeRoot: path.join(root, '.ai', 'runtime') }));
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'native-2', agent_name: 'SECRET_NICKNAME_BODY',
    parent_thread_id: 'parent-1', root_turn_id: 'SECRET ROOT BODY', spawned_at: '2026-10-01T00:00:00.000Z',
    model: 'SECRET_MODEL_BODY', reasoning_effort: 'SECRET_EFFORT_BODY', fork_turns: 'SECRET_FORK_BODY' }, store);
  const snapshot = await store.readSnapshot();
  assert.equal(snapshot.status.agents[0].role, 'unknown');
  assert.equal((await store.readChildLinks())[0].root_turn_id, null);
  assert.doesNotMatch(JSON.stringify({ snapshot, links: await store.readChildLinks() }), /SECRET_/);
});

test('malformed native identifiers are not persisted or used to fabricate child links', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = new RuntimeStore(RuntimeStore.coreContext({ engineRoot: root, runtimeRoot: path.join(root, '.ai', 'runtime') }));
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'SECRET AGENT BODY', parent_thread_id: 'parent-1',
    spawned_at: '2026-10-01T00:00:00.000Z' }, store);
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.status.agents, []);
  assert.deepEqual(await store.readChildLinks(), []);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET AGENT BODY/);
});

test('hook forwards explicitly observed native IDs into one exact child link', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = new RuntimeStore(RuntimeStore.coreContext({ engineRoot: root, runtimeRoot: path.join(root, '.ai', 'runtime') }));
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'child-1', parent_thread_id: 'parent-1', root_turn_id: 'root-1', task_id: 'task-1', agent_type: 'worker', spawned_at: '2026-10-01T00:00:00.000Z', task: 'SECRET_PROMPT' }, store);
  const links = await store.readChildLinks();
  assert.equal(links.length, 1);
  assert.deepEqual([links[0].child_agent_id, links[0].parent_agent_id, links[0].root_turn_id], ['child-1', 'parent-1', 'root-1']);
  assert.equal(JSON.stringify(links).includes('SECRET_PROMPT'), false);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'child-1', completed_at: '2026-10-01T00:00:01.000Z' }, store);
  assert.equal((await store.readChildLinks())[0].completed_at, '2026-10-01T00:00:01.000Z');
});

test('duplicate native stop preserves the first confirmed child completion time', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = new RuntimeStore(RuntimeStore.coreContext({ engineRoot: root, runtimeRoot: path.join(root, '.ai', 'runtime') }));
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'child-1', parent_thread_id: 'parent-1',
    spawned_at: '2026-10-01T00:00:00.000Z' }, store);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'child-1', completed_at: '2026-10-01T00:00:01.000Z' }, store);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'child-1', completed_at: '2026-10-01T00:00:02.000Z' }, store);
  assert.equal((await store.readChildLinks())[0].completed_at, '2026-10-01T00:00:01.000Z');
  assert.equal((await store.readEvents()).filter(event => event.type === 'agent_stopped').length, 1);
});

test('an orchestration-only stop accepts the first native completion time', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = new RuntimeStore(RuntimeStore.coreContext({ engineRoot: root, runtimeRoot: path.join(root, '.ai', 'runtime') }));
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'child-1', parent_thread_id: 'parent-1',
    spawned_at: '2026-10-01T00:00:00.000Z' }, store);
  await store.agentStopped('child-1', 'stopped', { source: 'orchestration' });
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'child-1', completed_at: '2026-10-01T00:00:01.000Z' }, store);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'child-1', completed_at: '2026-10-01T00:00:02.000Z' }, store);
  assert.equal((await store.readChildLinks())[0].completed_at, '2026-10-01T00:00:01.000Z');
  assert.equal((await store.readStatus()).agents[0].stop_source, 'hook');
});

test('a stale stop hook cannot complete a resumed child link', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = new RuntimeStore(RuntimeStore.coreContext({ engineRoot: root, runtimeRoot: path.join(root, '.ai', 'runtime') }));
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'child-1', parent_thread_id: 'parent-1', root_turn_id: 'root-1',
    spawned_at: '2026-10-01T00:00:00.000Z' }, store);
  await store.agentStopped('child-1', 'stopped', { source: 'orchestration' });
  await store.agentResumed('child-1', '', 'Accepted', { turn_token: 'turn-2', source: 'orchestration' });
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'child-1', completed_at: '2026-10-01T00:00:01.000Z' }, store);
  assert.deepEqual((await store.readStatus()).active_agents.map(agent => agent.id), ['child-1']);
  assert.equal((await store.readChildLinks())[0].completed_at, null);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'child-1', turn_token: 'turn-2', completed_at: '2026-10-01T00:00:02.000Z' }, store);
  assert.deepEqual((await store.readStatus()).active_agents, []);
  assert.equal((await store.readChildLinks())[0].completed_at, '2026-10-01T00:00:02.000Z');
});

test('hook preserves an opaque legacy task ID without copying prompt text into its short label', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = new RuntimeStore(RuntimeStore.coreContext({ engineRoot: root, runtimeRoot: path.join(root, '.ai', 'runtime') }));
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'child-1', parent_thread_id: 'parent-1', root_turn_id: 'root-1', task_id: '한글/작업 1', agent_type: 'worker', spawned_at: '2026-10-01T00:00:00.000Z', task: 'PROMPT_SENTINEL' }, store);
  const links = await store.readChildLinks();
  assert.equal(links[0].task_id, '한글/작업 1');
  assert.equal(links[0].short_task_name, null);
  assert.doesNotMatch(JSON.stringify(links), /PROMPT_SENTINEL/);
});

test('actual SubagentStop shape records a neutral lifecycle return', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  await legacyHook({ hook_event_name: 'SubagentStart', agent_id: 'agent-1', agent_type: 'worker', task: 'Do work' }, root);
  const store = RuntimeStore.legacyFixture(root); await store.claim('agent-1', ['src/backend/']); await store.claim('agent-2', ['src/frontend/']);
  await legacyHook({ hook_event_name: 'SubagentStop', agent_id: 'agent-1', agent_type: 'worker' }, root);
  const status = await store.readStatus(), claims = await store.readClaims();
  assert.equal(status.agents[0].status, 'stopped');
  assert.equal(status.signals.at(-1).summary, 'stopped');
  assert.equal('status' in status.signals.at(-1), false);
  assert.deepEqual(status.active_agents, []);
  assert.equal(claims.claims.length, 1);
  assert.equal(claims.claims[0].agent_id, 'agent-2');
  assert.deepEqual(claims.claims[0].scopes, ['src/frontend']);
});

test('hooks attach explicit task and outcome metadata to lifecycle signals', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  await legacyHook({ hook_event_name: 'SubagentStart', agent_id: 'agent-1', agent_type: 'worker',
    task: 'Do work', task_id: 'task-1' }, root);
  await legacyHook({ hook_event_name: 'SubagentStop', agent_id: 'agent-1', agent_type: 'worker',
    task_id: 'task-1', outcome: 'failed' }, root);
  const status = await RuntimeStore.legacyFixture(root).readStatus();
  assert.equal(status.signals[0].task_id, 'task-1');
  assert.equal(status.signals[1].task_id, 'task-1');
  assert.equal(status.signals[1].status, 'failed');
  assert.equal(status.agents[0].status, 'failed');
});

test('hook dispatch reconciles orchestration fallback without duplicate lifecycle history', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root); await store.initialize();
  await store.agentStarted('native-1', 'worker', 'Do work', { task_id: 'task-1', source: 'orchestration' });
  await legacyHook({ hook_event_name: 'SubagentStart', agent_id: 'native-1', agent_type: 'worker', task: 'Do work', task_id: 'task-1' }, root);
  await legacyHook({ hook_event_name: 'SubagentStop', agent_id: 'native-1', agent_type: 'worker', task_id: 'task-1' }, root);
  await store.agentStopped('native-1', 'stopped', { task_id: 'task-1', source: 'orchestration' });
  const snapshot = await store.readSnapshot(), agent = snapshot.status.agents[0];
  assert.deepEqual([agent.start_source, agent.stop_source, agent.status], ['hook', 'hook', 'stopped']);
  assert.deepEqual(snapshot.status.signals.map(signal => signal.kind), ['delegate', 'result']);
  assert.equal(snapshot.events.filter(event => event.type === 'agent_started').length, 1);
  assert.equal(snapshot.events.filter(event => event.type === 'agent_stopped').length, 1);
  assert.deepEqual(snapshot.events.filter(event => event.type === 'hook_dispatch').map(event => event.data.hook_event), ['SubagentStart', 'SubagentStop']);
});

test('a duplicate stop hook releases only a claim already held at the orchestration stop', async () => {
  for (const claimBeforeStop of [true, false]) {
    const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
    const store = RuntimeStore.legacyFixture(root); await store.initialize();
    await store.agentStarted('native-1', 'worker', 'First', { task_id: 'task-1', source: 'orchestration' });
    if (claimBeforeStop) await store.claim('native-1', ['src/backend/']);
    await store.agentStopped('native-1', 'stopped', { task_id: 'task-1', source: 'orchestration' });
    if (!claimBeforeStop) await store.claim('native-1', ['src/backend/']);
    await legacyHook({ hook_event_name: 'SubagentStop', agent_id: 'native-1', agent_type: 'worker', task_id: 'task-1' }, root);
    const snapshot = await store.readSnapshot();
    assert.equal(snapshot.status.agents[0].stop_source, 'hook');
    assert.deepEqual(snapshot.claims.claims.map(claim => claim.agent_id), claimBeforeStop ? [] : ['native-1']);
    assert.equal(snapshot.events.filter(event => event.type === 'claim_released').length, claimBeforeStop ? 1 : 0);
    assert.equal(snapshot.events.filter(event => event.type === 'agent_stopped').length, 1);
  }
});

test('a duplicate TaskStop releases a claim held at the earlier orchestration stop', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root); await store.initialize();
  const id = 'native-1';
  await store.agentStarted(id, 'worker', '', { source: 'orchestration' });
  await store.claim(id, ['src/backend/']);
  await store.agentStopped(id, 'stopped', { source: 'orchestration' });
  await handleHook({ hook_event_name: 'PostToolUse', tool_name: 'TaskStop',
    tool_input: { task_id: id },
    tool_response: { task_id: id, task_type: 'local_agent', message: `Successfully stopped task: ${id} (Fix #42: parser?!)` } }, store);
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.claims.claims, []);
  assert.equal(snapshot.status.agents[0].stop_source, 'hook');
  assert.equal(snapshot.events.filter(event => event.type === 'agent_stopped').length, 1);
});

test('a replaced claim after orchestration stop survives a duplicate hook', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root); await store.initialize();
  await store.agentStarted('native-1', 'worker', 'First', { source: 'orchestration' });
  await store.claim('native-1', ['src/first/']);
  await store.agentStopped('native-1', 'stopped', { source: 'orchestration' });
  await store.claim('native-1', ['src/first/']);
  await legacyHook({ hook_event_name: 'SubagentStop', agent_id: 'native-1' }, root);
  assert.deepEqual((await store.readClaims()).claims.map(claim => claim.scopes), [['src/first']]);
});

test('a delayed duplicate cannot release a resumed turn claim even if the previous turn held a claim', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root); await store.initialize();
  await store.agentStarted('native-1', 'worker', 'First', { source: 'orchestration' });
  await store.claim('native-1', ['src/backend/']);
  await store.agentStopped('native-1', 'stopped', { source: 'orchestration' });
  await store.agentResumed('native-1', 'Second', 'Accepted', { turn_token: 'turn-2', source: 'orchestration' });
  await store.claim('native-1', ['src/frontend/']);
  await legacyHook({ hook_event_name: 'SubagentStop', agent_id: 'native-1' }, root);
  const snapshot = await store.readSnapshot();
  assert.deepEqual(snapshot.status.active_agents.map(agent => agent.id), ['native-1']);
  assert.deepEqual(snapshot.claims.claims.map(claim => claim.scopes), [['src/frontend']]);
  assert.equal(snapshot.events.filter(event => event.type === 'claim_released').length, 0);
});

test('a stale uncorrelated stop hook cannot end a resumed turn or release its claim', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root); await store.initialize();
  await store.agentStarted('native-1', 'worker', 'First', { task_id: 'first', source: 'hook' });
  await store.agentStopped('native-1', 'stopped', { task_id: 'first', source: 'hook' });
  await store.agentResumed('native-1', 'Second', 'Accepted', { task_id: 'second', turn_token: 'turn-2', source: 'orchestration' });
  await store.claim('native-1', ['src/backend/']);
  await legacyHook({ hook_event_name: 'SubagentStop', agent_id: 'native-1', agent_type: 'worker' }, root);
  assert.deepEqual((await store.readStatus()).active_agents.map(agent => agent.id), ['native-1']);
  assert.deepEqual((await store.readClaims()).claims.map(claim => claim.agent_id), ['native-1']);
});

test('a same-task stale stop hook cannot end a resumed turn or release its claim', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root); await store.initialize();
  await store.agentStarted('native-1', 'worker', 'First', { task_id: 'shared', source: 'hook' });
  await store.agentStopped('native-1', 'stopped', { task_id: 'shared', source: 'hook' });
  await store.agentResumed('native-1', 'Second', 'Accepted', { task_id: 'shared', turn_token: 'turn-2', source: 'orchestration' });
  await store.claim('native-1', ['src/backend/']);
  await legacyHook({ hook_event_name: 'SubagentStop', agent_id: 'native-1', agent_type: 'worker', task_id: 'shared' }, root);
  assert.deepEqual((await store.readStatus()).active_agents.map(agent => agent.id), ['native-1']);
  assert.deepEqual((await store.readClaims()).claims.map(claim => claim.agent_id), ['native-1']);
});

test('a hook with the exact resumed turn token remains canonical', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = RuntimeStore.legacyFixture(root); await store.initialize();
  await store.agentStarted('native-1', 'worker', 'First', { task_id: 'shared', source: 'hook' });
  await store.agentStopped('native-1', 'stopped', { task_id: 'shared', source: 'hook' });
  await store.agentResumed('native-1', 'Second', 'Accepted', { task_id: 'shared', turn_token: 'turn-2', source: 'orchestration' });
  await store.claim('native-1', ['src/backend/']);
  await legacyHook({ hook_event_name: 'SubagentStop', agent_id: 'native-1', agent_type: 'worker', task_id: 'shared', turn_token: 'turn-2' }, root);
  const status = await store.readStatus();
  assert.deepEqual(status.active_agents, []);
  assert.equal(status.agents[0].stop_source, 'hook');
  assert.deepEqual((await store.readClaims()).claims, []);
});

test('session hooks record dispatch evidence without fabricating lifecycle state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  await legacyHook({ hook_event_name: 'SessionStart' }, root);
  const snapshot = await RuntimeStore.legacyFixture(root).readSnapshot();
  assert.deepEqual(snapshot.status.agents, []);
  assert.equal(snapshot.events.some(event => event.type === 'hook_dispatch' && event.data.hook_event === 'SessionStart'), true);
});
