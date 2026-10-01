import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { aggregateCodexRollouts, attributeThreads, toolOutputStats } from '../scripts/codex-rollout-telemetry.mjs';

const at = offset => new Date(Date.UTC(2026, 9, 1, 0, 0, offset)).toISOString();
const record = (type, payload, offset = 0) => ({ timestamp: at(offset), type, payload });
const meta = id => record('session_meta', { id });
const usage = (response_id, input_tokens, output_tokens, cached_input_tokens = 0, reasoning_output_tokens = 0, extra = {}) => record('token_usage_record', { response_id, usage: { input_tokens, output_tokens, cached_input_tokens, reasoning_output_tokens }, ...extra });
const cumulative = (input_tokens, output_tokens, cached_input_tokens = 0, reasoning_output_tokens = 0, offset = 0) => record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens, output_tokens, cached_input_tokens, reasoning_output_tokens } } }, offset);
const tool = (type, call_id, fields, offset = 0) => record('response_item', { type, call_id, ...fields }, offset);

async function fixture(files, run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rollout-fixture-'));
  try {
    const paths = [];
    for (const [index, lines] of files.entries()) {
      const file = path.join(dir, `private-${index}.jsonl`);
      await writeFile(file, lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n');
      paths.push(file);
    }
    return await run(paths);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const aggregate = files => fixture(files, paths => aggregateCodexRollouts(paths, { projectId: 'alpha', links: [] }));
const link = (child, parent, task = 'task-1', root = 'root-1', role = 'worker') => ({ child_agent_id: child, parent_agent_id: parent, task_id: task, root_turn_id: root, role, fork_turns: 'all' });
const observed = (id, parent = null, root = 'root-1', input = 4, output = 2) => ({ thread_id: id, parent_thread_id: parent, root_turn_id: root, status: 'observed', totals: { input, output, processed: input + output, cached_input: 0, reasoning_output: 0, responses: 1, tool_calls: 0 } });

test('exact child, parent, root and task links yield task, role and agent rows', () => {
  const result = attributeThreads([observed('child-1', 'parent-1')], [link('child-1', 'parent-1')]);
  assert.equal(result.tasks[0].task_id, 'task-1');
  assert.equal(result.tasks[0].totals.processed, 6);
  assert.equal(result.roles[0].role, 'worker');
  assert.equal(result.agents[0].agent_id, 'child-1');
  assert.equal(result.unattributed.processed, 0);
});

test('contradictory_parent_is_unattributed despite matching child ID', () => {
  const result = attributeThreads([observed('child-1', 'other-parent')], [link('child-1', 'parent-1')]);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.unattributed.processed, 6);
});

test('nested children require every exact edge and ambiguous links never join', () => {
  const threads = [observed('child-1', 'parent-1'), observed('grandchild-1', 'child-1', 'root-1', 3, 1)];
  const valid = attributeThreads(threads, [link('child-1', 'parent-1'), link('grandchild-1', 'child-1')]);
  assert.equal(valid.tasks[0].totals.processed, 10);
  const orphan = attributeThreads(threads, [link('grandchild-1', 'child-1')]);
  assert.equal(orphan.unattributed.processed, 10);
  const ambiguous = attributeThreads([threads[0]], [link('child-1', 'parent-1'), link('child-1', 'parent-1', 'task-2')]);
  assert.equal(ambiguous.unattributed.processed, 6);
});

test('nested child may carry a different exact task and root from its linked parent', () => {
  const threads = [observed('child-1', 'parent-1', 'root-1'), observed('grandchild-1', 'child-1', 'root-2', 3, 1)];
  const result = attributeThreads(threads, [link('child-1', 'parent-1', 'task-1', 'root-1'), link('grandchild-1', 'child-1', 'task-2', 'root-2')]);
  assert.deepEqual(result.tasks.map(row => [row.task_id, row.totals.processed]), [['task-1', 6], ['task-2', 4]]);
  assert.equal(result.unattributed.processed, 0);
});

test('missing root turn or task-only link leaves measured usage unattributed', () => {
  for (const links of [[link('child-1', 'parent-1')], [{ ...link('child-1', 'parent-1'), child_agent_id: null }]]) {
    const result = attributeThreads([observed('child-1', 'parent-1', null)], links);
    assert.equal(result.unattributed.processed, 6);
    assert.deepEqual(result.tasks, []);
  }
});

test('observed turn task contradiction and multiple roots do not assign a whole-thread cumulative total', async () => {
  const links = [{ ...link('child-1', 'parent-1'), project_id: 'alpha', acknowledgement: 'success', short_task_name: 'task-1', model: null, reasoning_effort: null, spawned_at: at(0), completed_at: null }];
  const result = await fixture([[meta('child-1'), record('turn_context', { root_turn_id: 'root-1', task_id: 'task-2' }), cumulative(4, 2)]], paths => aggregateCodexRollouts(paths, { projectId: 'alpha', links }));
  assert.equal(result.unattributed.processed, 6);
  assert.deepEqual(result.tasks, []);
  const mixed = await fixture([[meta('child-1'), record('turn_context', { root_turn_id: 'root-1' }), record('turn_context', { root_turn_id: 'root-2' }), cumulative(4, 2)]], paths => aggregateCodexRollouts(paths, { projectId: 'alpha', links }));
  assert.equal(mixed.unattributed.processed, 6);
  assert.deepEqual(mixed.tasks, []);
});

test('unknown non-usage record IDs cannot poison recognized native attribution evidence', async () => {
  const links = [{ ...link('child-1', 'parent-1'), project_id: 'alpha' }];
  const result = await fixture([[meta('child-1'), record('turn_context', { root_turn_id: 'root-1', task_id: 'task-1' }), record('noise', { root_turn_id: 'false-root', task_id: 'false-task' }), cumulative(4, 2)]], paths => aggregateCodexRollouts(paths, { projectId: 'alpha', links }));
  assert.equal(result.tasks[0].totals.processed, 6);
  assert.equal(result.unattributed.processed, 0);
});

test('unrooted observed turn blocks whole-thread attribution of cumulative usage', async () => {
  const links = [{ ...link('child-1', 'parent-1'), project_id: 'alpha' }];
  const result = await fixture([[meta('child-1'), record('turn_context', { turn_id: 'turn-1', root_turn_id: 'root-1' }), record('turn_context', { turn_id: 'turn-2' }), cumulative(4, 2)]], paths => aggregateCodexRollouts(paths, { projectId: 'alpha', links }));
  assert.deepEqual(result.tasks, []);
  assert.equal(result.unattributed.processed, 6);
});

test('observed spawn attempt remains separate from confirmed child', async () => {
  const result = await fixture([[meta('child-1'), record('turn_context', { root_turn_id: 'root-1' }), cumulative(4, 2), tool('function_call', 'spawn-1', { name: 'collaboration.spawn_agent', arguments: 'SECRET_PROMPT' }), tool('function_call', 'spawn-2', { name: 'collaboration.spawn_agent', arguments: 'SECRET_PROMPT' })]], paths => aggregateCodexRollouts(paths, { projectId: 'alpha', links: [{ ...link('child-1', 'parent-1'), project_id: 'alpha', acknowledgement: 'success', short_task_name: 'task-1', model: null, reasoning_effort: null, spawned_at: at(0), completed_at: null }] }));
  assert.equal(result.spawns.reduce((sum, row) => sum + (row.attempts || 0), 0), 2);
  assert.equal(result.spawns.reduce((sum, row) => sum + (row.confirmed || 0), 0), 1);
  assert.equal(JSON.stringify(result).includes('SECRET_PROMPT'), false);
});

test('replayed spawn call ID is one observed attempt', async () => {
  const spawn = tool('function_call', 'spawn-1', { name: 'collaboration.spawn_agent', arguments: 'SECRET_PROMPT' });
  const result = await aggregate([[meta('child-1'), cumulative(1, 1), spawn, spawn]]);
  assert.equal(result.spawns.reduce((sum, row) => sum + (row.attempts || 0), 0), 1);
});

test('no-usage rollout preserves observed parent spawn attempts without token zeros', async () => {
  const result = await aggregate([[meta('parent-1'), tool('function_call', 'spawn-1', { name: 'collaboration.spawn_agent', arguments: 'SECRET_PROMPT' })]]);
  assert.equal(result.status, 'missing');
  assert.equal(result.totals.processed, null);
  assert.equal(result.unattributed.processed, null);
  assert.deepEqual(result.spawns, [{ parent_agent_id: 'parent-1', child_agent_id: null, task_id: null, role: null, fork_turns: null, attempts: 1, confirmed: 0 }]);
});

test('per-response usage dedupes identical records but stays partial without complete coverage evidence', async () => {
  const result = await aggregate([[meta('thread-1'), usage('response-1', 10, 4, 3, 2), usage('response-1', 10, 4, 3, 2), usage('response-2', 5, 3, 1, 1)]]);
  assert.equal(result.status, 'partial');
  assert.equal(result.totals.processed, null);
  assert.equal(result.coverage.responses, 2);
  assert.equal(result.coverage.observed_responses, 2);
  assert.equal(result.coverage.partial_threads, 1);
});

test('response item or turn without usage cannot let a per-response map understate measured tokens', async () => {
  const result = await aggregate([[meta('thread-1'), usage('r1', 2, 1), record('turn_context', { turn_id: 'turn-2' }), record('response_item', { type: 'message', response_id: 'r2', content: 'SECRET_BODY' })]]);
  assert.equal(result.status, 'partial');
  assert.equal(result.totals.input, null);
  assert.equal(result.totals.processed, null);
});

test('cumulative final snapshot wins over per-response records without double counting', async () => {
  const result = await aggregate([[meta('thread-1'), usage('response-1', 10, 4), cumulative(10, 4), usage('response-2', 7, 2), cumulative(17, 6, 2, 1, 3)]]);
  assert.equal(result.status, 'observed');
  assert.equal(result.totals.input, 17);
  assert.equal(result.totals.output, 6);
  assert.equal(result.totals.processed, 23);
  assert.equal(result.totals.responses, 2);
  assert.equal(result.elapsed_ms, 3000);
});

test('counter reset invalidates one thread without turning the other into zero', async () => {
  const result = await aggregate([[meta('bad'), cumulative(10, 3), cumulative(9, 3, 0, 0, 1)], [meta('good'), cumulative(5, 2)]]);
  assert.equal(result.status, 'partial');
  assert.equal(result.totals.input, null);
  assert.equal(result.coverage.observed_threads, 1);
  assert.equal(result.coverage.partial_threads, 1);
});

test('cumulative subset high-water survives a snapshot that omits optional counters', async () => {
  const result = await aggregate([[meta('thread-1'), cumulative(20, 10, 8, 5), record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 21, output_tokens: 11 } } }), cumulative(22, 12, 7, 4, 2)]]);
  assert.equal(result.status, 'partial');
  assert.equal(result.totals.processed, null);
});

test('conflict_is_thread_local for exact response identity across files', async () => {
  const result = await aggregate([[meta('bad'), usage('same', 3, 1)], [meta('bad'), usage('same', 4, 1)], [meta('good'), usage('same', 5, 2), cumulative(5, 2)]]);
  assert.equal(result.status, 'partial');
  assert.equal(result.totals.processed, null);
  assert.equal(result.coverage.observed_threads, 1);
  assert.equal(result.coverage.partial_threads, 1);
});

test('unknown usage-bearing shape and unknown counter field are unsupported, unrelated records ignored', async () => {
  const result = await aggregate([[meta('bad'), record('unknown_usage', { usage: { input_tokens: 4 } })], [meta('good'), record('noise', { text: 'SECRET_BODY' }), usage('r', 2, 1), cumulative(2, 1)]]);
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.unsupported_threads, 1);
  assert.equal(result.totals.processed, null);
  const other = await aggregate([[meta('bad'), usage('r', 1, 1, 0, 0, { usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0, reasoning_output_tokens: 0, mystery_tokens: 9 } })]]);
  assert.equal(other.status, 'unsupported');
});

test('missing and unsupported evidence stay nullable, explicit measured empty cumulative is zero', async () => {
  const missing = await aggregate([[meta('thread-1'), record('noise', { text: 'SECRET' })]]);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.totals.processed, null);
  assert.equal(missing.compactions, null);
  const empty = await aggregate([[meta('thread-1'), cumulative(0, 0)]]);
  assert.equal(empty.status, 'observed');
  assert.equal(empty.totals.processed, 0);
});

test('missing optional subset counters remain unknown instead of fabricated zero', async () => {
  const result = await aggregate([[meta('thread-1'), record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 3, output_tokens: 2 } } })]]);
  assert.equal(result.status, 'observed');
  assert.equal(result.totals.processed, 5);
  assert.equal(result.totals.cached_input, null);
  assert.equal(result.totals.reasoning_output, null);
});

test('usage-bearing unexpected record family is unsupported even when name is recognized', async () => {
  const result = await aggregate([[meta('thread-1'), record('turn_context', { turn_id: 't', usage: { input_tokens: 3 } }), usage('r', 1, 1)]]);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.totals.processed, null);
});

test('response_item and compaction usage-bearing variants invalidate only their thread', async () => {
  const badResponse = await aggregate([[meta('bad'), cumulative(2, 1), record('response_item', { type: 'message', info: { total_token_usage: { input_tokens: 99 } } })]]);
  assert.equal(badResponse.status, 'unsupported');
  const badCompaction = await aggregate([[meta('bad'), cumulative(2, 1), record('compaction', { usage: { input_tokens: 99 } })]]);
  assert.equal(badCompaction.status, 'unsupported');
});

test('response_item info.usage metadata is unsupported without inspecting output body text', async () => {
  const result = await aggregate([[meta('bad'), cumulative(2, 1), record('response_item', { type: 'message', info: { usage: { input_tokens: 99 } } })], [meta('good'), cumulative(3, 1), tool('function_call', 'c1', { name: 'exec_command' }), tool('function_call_output', 'c1', { output: 'info.usage SECRET_BODY' })]]);
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.unsupported_threads, 1);
  assert.equal(result.coverage.observed_threads, 1);
  assert.equal(result.totals.processed, null);
  assert.equal(JSON.stringify(result).includes('SECRET_BODY'), false);
});

test('explicit compaction count on partial thread remains observed when another thread has valid totals', async () => {
  const result = await aggregate([[meta('partial'), usage('r', 1, 1), record('event_msg', { type: 'context_compacted' })], [meta('observed'), cumulative(2, 1)]]);
  assert.equal(result.status, 'partial');
  assert.equal(result.compactions, 1);
  assert.equal(result.coverage.compactions, 1);
});

test('multibyte_even_median and nearest-rank p95 count only joined output bytes', async () => {
  const result = await aggregate([[meta('thread-1'), cumulative(1, 1), tool('function_call', 'c1', { name: 'exec_command', arguments: 'SECRET_ARGUMENT' }), tool('function_call_output', 'c1', { output: 'é' }), tool('custom_tool_call', 'c2', { name: 'exec_command', input: 'SECRET_INPUT' }), tool('custom_tool_call_output', 'c2', { output: 'abcd' }), tool('function_call_output', 'orphan', { output: 'SECRET_ORPHAN' }), tool('function_call', 'c3', { name: 'untrusted-secret-name', arguments: '{}' }), tool('function_call_output', 'c3', { output: 'x' })]]);
  assert.deepEqual(result.largest_tool_outputs[0], { tool: 'exec_command', count: 2, total_bytes: 6, median_bytes: 3, p95_bytes: 4, max_bytes: 4 });
  assert.equal(result.largest_tool_outputs[1].tool, 'other');
  assert.equal(result.totals.tool_calls, 3);
  assert.deepEqual(toolOutputStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), { count: 20, total_bytes: 210, median_bytes: 10.5, p95_bytes: 19, max_bytes: 20 });
});

test('explicit compaction only, observed interval, and source content excluded', async () => {
  const result = await aggregate([[meta('thread-1'), record('turn_context', { turn_id: 'turn-1', model: 'SECRET_MODEL', effort: 'SECRET_EFFORT' }, 1), cumulative(2, 1, 0, 0, 2), record('event_msg', { type: 'context_compacted', text: 'SECRET_COMPACTION' }, 3), record('compaction', { text: 'SECRET_BODY' }, 4), record('noise', { text: 'SECRET_REASONING' }, 5)]]);
  assert.equal(result.compactions, 2);
  assert.equal(result.start_at, at(0));
  assert.equal(result.end_at, at(5));
  assert.equal(result.elapsed_ms, 5000);
  const serialized = JSON.stringify(result);
  for (const secret of ['SECRET_MODEL', 'SECRET_EFFORT', 'SECRET_COMPACTION', 'SECRET_BODY', 'SECRET_REASONING', 'private-0.jsonl']) assert.equal(serialized.includes(secret), false);
});

test('ambiguous thread identity aborts import with line number only', async () => {
  await fixture([[meta('thread-1'), usage('r', 1, 1, 0, 0, { thread_id: 'thread-2' })]], async paths => {
    await assert.rejects(aggregateCodexRollouts(paths, { projectId: 'alpha', links: [] }), error => {
      assert.equal(error.lineNumber, 2);
      assert.equal(JSON.stringify(error).includes(paths[0]), false);
      assert.equal(String(error.message).includes(paths[0]), false);
      return true;
    });
  });
});

test('session alias identifies its own thread while conflicting parent metadata invalidates coverage', async () => {
  const alias = await aggregate([[record('session_meta', { id: 'thread-1', session_id: 'session-1' }), usage('r', 2, 1, 0, 0, { session_id: 'session-1' }), cumulative(2, 1)]]);
  assert.equal(alias.status, 'observed');
  const conflict = await aggregate([[record('session_meta', { id: 'thread-1', parent_thread_id: 'parent-a' }), usage('r', 2, 1)], [record('session_meta', { id: 'thread-1', parent_thread_id: 'parent-b' })]]);
  assert.equal(conflict.status, 'unsupported');
  assert.equal(conflict.totals.processed, null);
});

test('malformed JSONL aborts atomically with line-number-only diagnostic', async () => {
  await fixture([[meta('thread-1'), '{ SECRET_BODY broken json']], async paths => {
    await assert.rejects(aggregateCodexRollouts(paths, { projectId: 'alpha', links: [] }), error => {
      assert.equal(error.lineNumber, 2);
      assert.equal(String(error.message).includes('SECRET_BODY'), false);
      assert.equal(String(error.message).includes(paths[0]), false);
      return true;
    });
  });
});
