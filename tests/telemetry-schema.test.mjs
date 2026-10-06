import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTelemetry, normalizeChildLink } from '../scripts/telemetry-schema.mjs';

const totals = { input: 10, output: 4, processed: 14, cached_input: 3, reasoning_output: 2 };
const base = () => ({ schema_version: 1, project_id: 'alpha', observed_at: '2026-10-01T00:00:00.000Z', source: 'codex_rollout', status: 'observed', start_at: '2026-10-01T00:00:00.000Z', end_at: '2026-10-01T00:00:01.000Z', elapsed_ms: 1000, totals, tasks: [], roles: [], agents: [], unattributed: { ...totals, fraction: 1 }, largest_tool_outputs: [], spawns: [], compactions: 0, coverage: { threads: 1, observed_threads: 1 } });

test('aggregate projects only allowlisted metadata and derives no source content', () => {
  const input = base();
  input.prompt = 'PROMPT_SENTINEL'; input.source_path = 'PATH_SENTINEL';
  input.totals = { ...totals, reasoning: 'REASONING_SENTINEL' };
  input.tasks = [{ task_id: 'task-1', totals, title: 'BODY_SENTINEL' }];
  input.largest_tool_outputs = [{ tool: 'SECRET_SENTINEL', count: 1, total_bytes: 1, median_bytes: 1, p95_bytes: 1, max_bytes: 1, output: 'BODY_SENTINEL' }];
  const normalized = normalizeTelemetry(input, 'alpha');
  const json = JSON.stringify(normalized);
  for (const sentinel of ['PROMPT_SENTINEL', 'PATH_SENTINEL', 'REASONING_SENTINEL', 'BODY_SENTINEL', 'SECRET_SENTINEL']) assert.equal(json.includes(sentinel), false);
  assert.equal(normalized.largest_tool_outputs[0].tool, 'other');
  assert.equal(normalized.elapsed_ms, 1000);
  assert.deepEqual(normalized.tasks[0], { task_id: 'task-1', totals });
});

test('aggregate rejects unsafe numbers, equations, timestamps, and project identity', () => {
  for (const patch of [
    { totals: { ...totals, input: -1 } }, { totals: { ...totals, input: 1.5 } },
    { totals: { ...totals, input: Number.MAX_SAFE_INTEGER + 1 } },
    { totals: { ...totals, processed: 15 } }, { totals: { ...totals, cached_input: 11 } },
    { totals: { ...totals, reasoning_output: 5 } },
    { start_at: null, elapsed_ms: 1000 }, { elapsed_ms: 999 }, { project_id: 'beta' },
  ]) assert.throws(() => normalizeTelemetry({ ...base(), ...patch }, 'alpha'));
  assert.equal(normalizeTelemetry({ ...base(), totals: { input: null, output: 4, processed: null, cached_input: null, reasoning_output: 2 }, unattributed: { input: null, output: 4, processed: null, cached_input: null, reasoning_output: 2, fraction: null } }, 'alpha').totals.processed, null);
});

test('child link accepts only exact successful acknowledgement and metadata labels', () => {
  const link = { project_id: 'alpha', acknowledgement: 'success', task_id: 'task-1', root_turn_id: 'turn-1', parent_agent_id: 'parent-1', child_agent_id: 'child-1', role: 'worker', short_task_name: 'task-1', fork_turns: 'all', model: 'gpt-6-sol', reasoning_effort: 'medium', spawned_at: '2026-10-01T00:00:00.000Z', completed_at: null, prompt: 'PROMPT_SENTINEL' };
  const normalized = normalizeChildLink(link, 'alpha');
  assert.equal(JSON.stringify(normalized).includes('PROMPT_SENTINEL'), false);
  assert.equal(normalized.child_agent_id, 'child-1');
  assert.throws(() => normalizeChildLink({ ...link, acknowledgement: 'attempted' }, 'alpha'));
  assert.throws(() => normalizeChildLink({ ...link, child_agent_id: null }, 'alpha'));
  assert.throws(() => normalizeChildLink({ ...link, project_id: 'beta' }, 'alpha'));
  assert.throws(() => normalizeChildLink({ ...link, short_task_name: 'x'.repeat(101) }, 'alpha'));
});

test('median accepts safe half-byte midpoint while byte counts stay integral', () => {
  const input = base();
  input.largest_tool_outputs = [{ tool: 'exec_command', count: 2, total_bytes: 3, median_bytes: 1.5, p95_bytes: 2, max_bytes: 2 }];
  assert.equal(normalizeTelemetry(input, 'alpha').largest_tool_outputs[0].median_bytes, 1.5);
  for (const field of ['count', 'total_bytes', 'p95_bytes', 'max_bytes']) assert.throws(() => normalizeTelemetry({ ...input, largest_tool_outputs: [{ ...input.largest_tool_outputs[0], [field]: 1.5 }] }, 'alpha'));
});

test('missing and unsupported status cannot serialize measured token zeros or rates', () => {
  for (const status of ['missing', 'unsupported']) {
    assert.throws(() => normalizeTelemetry({ ...base(), status }, 'alpha'));
    const unknown = { input: null, output: null, processed: null, cached_input: null, reasoning_output: null };
    const valid = { ...base(), status, totals: unknown, unattributed: { ...unknown, fraction: null }, compactions: null };
    assert.equal(normalizeTelemetry(valid, 'alpha').totals.processed, null);
    assert.throws(() => normalizeTelemetry({ ...valid, unattributed: { ...unknown, fraction: 0 } }, 'alpha'));
    assert.throws(() => normalizeTelemetry({ ...valid, compactions: 0 }, 'alpha'));
  }
});

test('missing token usage may still carry observed spawn metadata without token zeros', () => {
  const unknown = { input: null, output: null, processed: null, cached_input: null, reasoning_output: null };
  const input = { ...base(), status: 'missing', totals: unknown, unattributed: { ...unknown, fraction: null }, compactions: null,
    spawns: [{ parent_agent_id: 'parent-1', child_agent_id: null, task_id: null, role: null, fork_turns: null, attempts: 1, confirmed: 0 }] };
  const result = normalizeTelemetry(input, 'alpha');
  assert.equal(result.spawns[0].parent_agent_id, 'parent-1');
  assert.equal(result.totals.processed, null);
});

test('fraction requires known positive total and known unattributed numerator', () => {
  assert.throws(() => normalizeTelemetry({ ...base(), totals: { input: null, output: null, processed: null, cached_input: null, reasoning_output: null } }, 'alpha'));
  assert.throws(() => normalizeTelemetry({ ...base(), unattributed: { ...totals, fraction: 0 } }, 'alpha'));
});

test('known unattributed count cannot exceed known total even when fraction is unknown', () => {
  assert.throws(() => normalizeTelemetry({ ...base(), unattributed: { input: 11, output: 4, processed: 15, cached_input: 3, reasoning_output: 2, fraction: null } }, 'alpha'));
});

test('link label is only the exact task identifier and fork turns is a bounded enum', () => {
  const link = { project_id: 'alpha', acknowledgement: 'success', task_id: 'task-1', root_turn_id: null, parent_agent_id: null, child_agent_id: 'child-1', role: 'worker', short_task_name: 'task-1', fork_turns: '4', model: null, reasoning_effort: null, spawned_at: '2026-10-01T00:00:00.000Z', completed_at: null };
  assert.equal(normalizeChildLink(link, 'alpha').fork_turns, '4');
  for (const fork_turns of ['PROMPT_SENTINEL', '1000', '-1', '01']) assert.throws(() => normalizeChildLink({ ...link, fork_turns }, 'alpha'));
  for (const short_task_name of ['PROMPT_SENTINEL', 'token=SECRET_SENTINEL', 'task-1 extra']) assert.throws(() => normalizeChildLink({ ...link, short_task_name }, 'alpha'));
});

test('opaque legacy task IDs remain exact while unsuitable short labels stay null', () => {
  for (const taskId of ['with space', '한글/하위', 'part/child', 'task.v1:fix']) {
    const input = base();
    input.tasks = [{ task_id: taskId, totals }];
    assert.equal(normalizeTelemetry(input, 'alpha').tasks[0].task_id, taskId);
    const link = { project_id: 'alpha', acknowledgement: 'success', task_id: taskId, root_turn_id: 'turn-1', parent_agent_id: 'parent-1', child_agent_id: 'child-1', role: 'worker', short_task_name: null, fork_turns: 'all', model: null, reasoning_effort: null, spawned_at: '2026-10-01T00:00:00.000Z', completed_at: null, task: 'PROMPT_SENTINEL' };
    const normalized = normalizeChildLink(link, 'alpha');
    assert.equal(normalized.task_id, taskId);
    assert.equal(normalized.short_task_name, null);
    assert.equal(normalizeChildLink({ ...link, short_task_name: taskId }, 'alpha').short_task_name, null);
    assert.doesNotMatch(JSON.stringify(normalized), /PROMPT_SENTINEL/);
  }
});
