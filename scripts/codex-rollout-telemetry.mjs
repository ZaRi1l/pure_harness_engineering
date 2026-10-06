import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { isOpaqueTaskId, normalizeTelemetry } from './telemetry-schema.mjs';

const COUNTERS = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'reasoning_output_tokens', 'cache_write_input_tokens', 'total_tokens'];
const TOOL_NAMES = new Set(['exec_command', 'apply_patch', 'write_stdin', 'web.run', 'functions.exec', 'functions.wait', 'exec', 'wait', 'mcp__cua_repl.js', 'image_gen.imagegen', 'collaboration.spawn_agent', 'collaboration.send_message']);
const COMPACTIONS = new Set(['context_compacted', 'compaction', 'compacted']);
const UNKNOWN = { input: null, output: null, processed: null, cached_input: null, reasoning_output: null, responses: null, tool_calls: null };

function structural(lineNumber) {
  const error = new Error(`invalid rollout structure at line ${lineNumber}`);
  error.lineNumber = lineNumber;
  throw error;
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeCount = value => Number.isSafeInteger(value) && value >= 0;
const safeAdd = (left, right) => {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
};
const addKnown = (left, right) => left === null || right === null ? null : safeAdd(left, right);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

function counters(value) {
  if (!object(value)) return { kind: 'partial' };
  if (Object.keys(value).some(key => !COUNTERS.includes(key))) return { kind: 'unsupported' };
  if (!safeCount(value.input_tokens) || !safeCount(value.output_tokens)) return { kind: 'partial' };
  const cached = value.cached_input_tokens ?? null, reasoning = value.reasoning_output_tokens ?? null;
  const cacheWrite = value.cache_write_input_tokens ?? null, total = value.total_tokens ?? null;
  const processed = safeAdd(value.input_tokens, value.output_tokens);
  if ((cached !== null && (!safeCount(cached) || cached > value.input_tokens)) || (reasoning !== null && (!safeCount(reasoning) || reasoning > value.output_tokens)) || (cacheWrite !== null && (!safeCount(cacheWrite) || cacheWrite > value.input_tokens)) || (total !== null && (!safeCount(total) || total !== processed)) || processed === null) return { kind: 'partial' };
  return { kind: 'valid', value: [value.input_tokens, value.output_tokens, cached, reasoning] };
}

function thread(id) {
  return { id, sessionId: null, parentThreadId: null, rootTurns: new Set(), taskIds: new Set(), unrootedTurn: false, responses: new Map(), cumulative: null, cumulativeHighWater: [null, null, null, null], cumulativeSeen: false, invalid: null, calls: new Map(), outputs: new Map(), toolGroups: new Map(), compactions: 0, spawnAttempts: 0 };
}
const mark = (state, kind) => { if (state.invalid !== 'unsupported') state.invalid = kind; };
function addResponse(state, payload) {
  if (!safeId(payload.response_id)) { mark(state, 'partial'); return; }
  const parsed = counters(payload.usage);
  if (parsed.kind !== 'valid') { mark(state, parsed.kind); return; }
  const previous = state.responses.get(payload.response_id);
  if (previous && previous.some((value, index) => value !== parsed.value[index])) mark(state, 'partial');
  else state.responses.set(payload.response_id, parsed.value);
}
function addCumulative(state, value) {
  state.cumulativeSeen = true;
  const parsed = counters(value);
  if (parsed.kind !== 'valid') { mark(state, parsed.kind); return; }
  if (state.cumulativeHighWater.some((counter, index) => counter !== null && parsed.value[index] !== null && parsed.value[index] < counter)) mark(state, 'partial');
  state.cumulativeHighWater = state.cumulativeHighWater.map((counter, index) => parsed.value[index] === null ? counter : parsed.value[index]);
  state.cumulative = parsed.value;
}
function toolOutputBytes(output) {
  if (typeof output === 'string') return Buffer.byteLength(output, 'utf8');
  if (!Array.isArray(output)) return null;
  let bytes = 0;
  for (const block of output) {
    if (!object(block) || block.type !== 'input_text' || typeof block.text !== 'string') return null;
    bytes = safeAdd(bytes, Buffer.byteLength(block.text, 'utf8'));
    if (bytes === null) return null;
  }
  return bytes;
}
function addTool(state, item) {
  if (!object(item) || !safeId(item.call_id)) return;
  if (item.type === 'custom_tool_call' || item.type === 'function_call') {
    if (state.calls.has(item.call_id)) return;
    state.calls.set(item.call_id, TOOL_NAMES.has(item.name) ? item.name : 'other');
    if (item.name === 'collaboration.spawn_agent') state.spawnAttempts++;
  } else if (item.type === 'custom_tool_call_output' || item.type === 'function_call_output') {
    const bytes = toolOutputBytes(item.output);
    if (bytes !== null) state.outputs.set(item.call_id, bytes);
  }
}
function finishTools(state) {
  for (const [id, bytes] of state.outputs) {
    const name = state.calls.get(id);
    if (!name) continue;
    const values = state.toolGroups.get(name) || [];
    values.push(bytes);
    state.toolGroups.set(name, values);
  }
  state.outputs.clear();
}

export function toolOutputStats(byteLengths) {
  const sorted = [...byteLengths].sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, total_bytes: 0, median_bytes: null, p95_bytes: null, max_bytes: null };
  const middle = Math.floor(sorted.length / 2);
  return { count: sorted.length, total_bytes: sorted.reduce((sum, value) => sum + value, 0), median_bytes: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, p95_bytes: sorted[Math.ceil(sorted.length * 0.95) - 1], max_bytes: sorted.at(-1) };
}

function usageBearing(type, payload) {
  if (!object(payload)) return false;
  return 'usage' in payload || 'total_token_usage' in payload || (object(payload.info) && ('usage' in payload.info || 'total_token_usage' in payload.info)) || /(?:token|usage)/i.test(type);
}
function totalsFrom(values, responses, toolCalls) {
  return { input: values[0], output: values[1], processed: values[0] + values[1], cached_input: values[2], reasoning_output: values[3], responses, tool_calls: toolCalls };
}
const addTotals = (left, right) => Object.fromEntries(Object.keys(UNKNOWN).map(key => [key, addKnown(left[key], right[key])]));
const zeroTotals = () => ({ input: 0, output: 0, processed: 0, cached_input: 0, reasoning_output: 0, responses: 0, tool_calls: 0 });
export function attributeThreads(threads, links) {
  const byThread = new Map(threads.map(item => [item.thread_id, item]));
  const candidates = new Map();
  for (const link of links) {
    if (!link?.child_agent_id) continue;
    candidates.set(link.child_agent_id, [...(candidates.get(link.child_agent_id) || []), link]);
  }
  const valid = new Map();
  const visiting = new Set();
  function resolve(id) {
    if (valid.has(id)) return valid.get(id);
    if (visiting.has(id)) return null;
    const choices = candidates.get(id), item = byThread.get(id);
    if (!item || !choices || choices.length !== 1) return null;
    const link = choices[0];
    if (!link.task_id || !link.root_turn_id || !link.parent_agent_id || item.root_turn_id !== link.root_turn_id || (item.task_ids?.length && (item.task_ids.length !== 1 || item.task_ids[0] !== link.task_id)) || (item.parent_thread_id && item.parent_thread_id !== link.parent_agent_id)) return null;
    visiting.add(id);
    const parent = byThread.get(link.parent_agent_id);
    const parentLink = candidates.get(link.parent_agent_id);
    const accepted = !parent && !parentLink ? link : parent && parentLink?.length === 1 && resolve(link.parent_agent_id) ? link : null;
    visiting.delete(id);
    if (accepted) valid.set(id, accepted);
    return accepted;
  }
  const tasks = new Map(), roles = new Map(), agents = new Map();
  let unattributed = zeroTotals(), attributed = zeroTotals(), unknown = false;
  for (const item of threads) {
    const link = resolve(item.thread_id);
    if (item.status !== 'observed' || item.totals.processed === null) { unknown = true; continue; }
    if (!link) { unattributed = addTotals(unattributed, item.totals); continue; }
    attributed = addTotals(attributed, item.totals);
    for (const [map, key] of [[tasks, link.task_id], [roles, link.role], [agents, link.child_agent_id]]) {
      if (key === null) continue;
      map.set(key, addTotals(map.get(key) || zeroTotals(), item.totals));
    }
  }
  const all = addTotals(attributed, unattributed);
  const rows = (map, field) => [...map].map(([key, totals]) => ({ [field]: key, totals }));
  const spawns = [];
  for (const item of threads) if (item.spawn_attempts) spawns.push({ parent_agent_id: item.thread_id, child_agent_id: null, task_id: null, role: null, fork_turns: null, attempts: item.spawn_attempts, confirmed: 0 });
  for (const [id, choices] of candidates) if (choices.length === 1) {
    const link = choices[0];
    spawns.push({ parent_agent_id: link.parent_agent_id ?? null, child_agent_id: id, task_id: link.task_id ?? null, role: link.role ?? null, fork_turns: link.fork_turns ?? null, attempts: 0, confirmed: 1 });
  }
  return { tasks: rows(tasks, 'task_id'), roles: rows(roles, 'role'), agents: rows(agents, 'agent_id'), unattributed: { ...(unknown ? UNKNOWN : unattributed), fraction: unknown || !all.processed ? null : unattributed.processed / all.processed }, spawns, coverage: { attributed_threads: valid.size, unattributed_threads: threads.length - valid.size } };
}
function summarize(states, projectId, startAt, endAt, links) {
  const coverage = { threads: states.size, observed_threads: 0, partial_threads: 0, unsupported_threads: 0, responses: 0, observed_responses: 0, tool_calls: 0, compactions: 0 };
  let summed = [0, 0, 0, 0], responses = 0, toolCalls = 0;
  const tools = new Map();
  const threadAggregates = [];
  for (const state of states.values()) {
    finishTools(state);
    coverage.responses += state.responses.size;
    coverage.observed_responses += state.responses.size;
    coverage.tool_calls += state.calls.size;
    coverage.compactions += state.compactions;
    let status = state.invalid;
    if (!status) status = state.cumulativeSeen ? 'observed' : state.responses.size ? 'partial' : 'missing';
    let threadTotals = UNKNOWN;
    if (status === 'observed') {
      coverage.observed_threads++;
      let values = state.cumulative;
      if (!values) {
        values = [0, 0, 0, 0];
        for (const counts of state.responses.values()) values = values.map((value, index) => addKnown(value, counts[index]));
      }
      if (values[0] === null || values[1] === null || values[0] + values[1] > Number.MAX_SAFE_INTEGER) { coverage.observed_threads--; coverage.partial_threads++; continue; }
      summed = summed.map((value, index) => addKnown(value, values[index]));
      threadTotals = totalsFrom(values, state.responses.size, state.calls.size);
      responses += state.responses.size;
      toolCalls += state.calls.size;
      for (const [name, bytes] of state.toolGroups) tools.set(name, [...(tools.get(name) || []), ...bytes]);
    } else if (status === 'unsupported') coverage.unsupported_threads++;
    else if (status === 'partial') coverage.partial_threads++;
    threadAggregates.push({ thread_id: state.id, parent_thread_id: state.parentThreadId, root_turn_id: !state.unrootedTurn && state.rootTurns.size === 1 ? [...state.rootTurns][0] : null, task_ids: [...state.taskIds], status, totals: threadTotals, spawn_attempts: state.spawnAttempts });
  }
  const attribution = attributeThreads(threadAggregates, links);
  const complete = coverage.observed_threads === states.size && states.size > 0 && summed[0] !== null && summed[1] !== null && safeAdd(summed[0], summed[1]) !== null;
  const status = complete ? 'observed' : coverage.observed_threads ? 'partial' : coverage.unsupported_threads ? 'unsupported' : coverage.partial_threads ? 'partial' : 'missing';
  const totals = complete ? totalsFrom(summed, responses, toolCalls) : UNKNOWN;
  const largest = status === 'observed' || status === 'partial' ? [...tools].map(([tool, lengths]) => ({ tool, ...toolOutputStats(lengths) })).sort((a, b) => b.total_bytes - a.total_bytes || a.tool.localeCompare(b.tool)) : [];
  const validStart = startAt === null ? null : new Date(startAt).toISOString();
  const validEnd = endAt === null ? null : new Date(endAt).toISOString();
  return normalizeTelemetry({ schema_version: 1, project_id: projectId, observed_at: new Date().toISOString(), source: 'codex_rollout', status,
    start_at: validStart, end_at: validEnd, elapsed_ms: validStart && validEnd ? Date.parse(validEnd) - Date.parse(validStart) : null,
    totals, tasks: status === 'observed' || status === 'partial' ? attribution.tasks : [], roles: status === 'observed' || status === 'partial' ? attribution.roles : [], agents: status === 'observed' || status === 'partial' ? attribution.agents : [], unattributed: status === 'observed' || status === 'partial' ? attribution.unattributed : { ...UNKNOWN, fraction: null }, largest_tool_outputs: largest, spawns: attribution.spawns,
    compactions: status === 'observed' || status === 'partial' ? coverage.compactions : null, coverage }, projectId);
}

export async function aggregateCodexRollouts(paths, { projectId, links } = {}) {
  if (!Array.isArray(paths) || !paths.length || paths.some(value => typeof value !== 'string' || !value) || !safeId(projectId) || !Array.isArray(links)) throw new Error('invalid rollout import arguments');
  const states = new Map();
  let startAt = null, endAt = null;
  for (const file of paths) {
    let current = null, lineNumber = 0;
    const stream = createReadStream(file, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        lineNumber++;
        if (!line.trim()) continue;
        let record;
        try { record = JSON.parse(line); } catch { structural(lineNumber); }
        if (!object(record) || typeof record.type !== 'string' || !object(record.payload) || typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp))) structural(lineNumber);
        const stamp = Date.parse(record.timestamp);
        startAt = startAt === null ? stamp : Math.min(startAt, stamp);
        endAt = endAt === null ? stamp : Math.max(endAt, stamp);
        const payload = record.payload;
        if (record.type === 'session_meta') {
          if (!safeId(payload.id)) structural(lineNumber);
          if (payload.session_id != null && !safeId(payload.session_id)) structural(lineNumber);
          if (payload.parent_thread_id != null && !safeId(payload.parent_thread_id)) structural(lineNumber);
          if (current && current.id !== payload.id) structural(lineNumber);
          current = states.get(payload.id) || thread(payload.id);
          if (current.sessionId && payload.session_id && current.sessionId !== payload.session_id) mark(current, 'unsupported');
          if (current.parentThreadId && payload.parent_thread_id && current.parentThreadId !== payload.parent_thread_id) mark(current, 'unsupported');
          current.sessionId ||= payload.session_id || null;
          current.parentThreadId ||= payload.parent_thread_id || null;
          states.set(payload.id, current);
          continue;
        }
        if (!current) structural(lineNumber);
        if (payload.thread_id != null && payload.thread_id !== current.id) structural(lineNumber);
        if (payload.session_id != null && payload.session_id !== (current.sessionId || current.id)) structural(lineNumber);
        const nativeTurn = record.type === 'turn_context' || (record.type === 'event_msg' && payload.type === 'task_started');
        const nativeUsage = record.type === 'token_usage_record' || (record.type === 'event_msg' && payload.type === 'token_count');
        if (nativeTurn && payload.root_turn_id == null) current.unrootedTurn = true;
        if ((nativeTurn || nativeUsage) && payload.root_turn_id != null) {
          if (!safeId(payload.root_turn_id)) structural(lineNumber);
          current.rootTurns.add(payload.root_turn_id);
        }
        if ((nativeTurn || nativeUsage) && payload.task_id != null) {
          if (!isOpaqueTaskId(payload.task_id)) structural(lineNumber);
          current.taskIds.add(payload.task_id);
        }
        if (record.type === 'token_usage_record') addResponse(current, payload);
        else if (record.type === 'event_msg') {
          if (payload.type === 'token_count') addCumulative(current, payload.info?.total_token_usage);
          else if (COMPACTIONS.has(payload.type)) {
            if (usageBearing(payload.type, payload)) mark(current, 'unsupported');
            current.compactions++;
          }
          else if (usageBearing(payload.type, payload)) mark(current, 'unsupported');
        } else if (record.type === 'response_item') {
          if (usageBearing(payload.type, payload)) mark(current, 'unsupported');
          addTool(current, payload);
        }
        else if (COMPACTIONS.has(record.type)) {
          if (usageBearing(record.type, payload)) mark(current, 'unsupported');
          current.compactions++;
        }
        else if (usageBearing(record.type, payload)) mark(current, 'unsupported');
      }
    } catch (error) {
      if (error.lineNumber) throw error;
      throw new Error('rollout import failed');
    } finally { lines.close(); stream.destroy(); }
  }
  return summarize(states, projectId, startAt, endAt, links);
}
