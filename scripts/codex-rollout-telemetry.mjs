import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { normalizeTelemetry } from './telemetry-schema.mjs';

const COUNTERS = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'reasoning_output_tokens'];
const TOOL_NAMES = new Set(['exec_command', 'apply_patch', 'write_stdin', 'web.run', 'functions.exec', 'functions.wait', 'mcp__cua_repl.js', 'image_gen.imagegen', 'collaboration.spawn_agent', 'collaboration.send_message']);
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
  if ((cached !== null && (!safeCount(cached) || cached > value.input_tokens)) || (reasoning !== null && (!safeCount(reasoning) || reasoning > value.output_tokens)) || safeAdd(value.input_tokens, value.output_tokens) === null) return { kind: 'partial' };
  return { kind: 'valid', value: [value.input_tokens, value.output_tokens, cached, reasoning] };
}

function thread(id) {
  return { id, sessionId: null, parentThreadId: null, responses: new Map(), cumulative: null, cumulativeHighWater: [null, null, null, null], cumulativeSeen: false, invalid: null, calls: new Map(), outputs: new Map(), toolGroups: new Map(), compactions: 0 };
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
function addTool(state, item) {
  if (!object(item) || !safeId(item.call_id)) return;
  if (item.type === 'custom_tool_call' || item.type === 'function_call') {
    state.calls.set(item.call_id, TOOL_NAMES.has(item.name) ? item.name : 'other');
  } else if (item.type === 'custom_tool_call_output' || item.type === 'function_call_output') {
    if (typeof item.output === 'string') state.outputs.set(item.call_id, Buffer.byteLength(item.output, 'utf8'));
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
  return 'usage' in payload || 'total_token_usage' in payload || (object(payload.info) && 'total_token_usage' in payload.info) || /(?:token|usage)/i.test(type);
}
function totalsFrom(values, responses, toolCalls) {
  return { input: values[0], output: values[1], processed: values[0] + values[1], cached_input: values[2], reasoning_output: values[3], responses, tool_calls: toolCalls };
}
function summarize(states, projectId, startAt, endAt) {
  const coverage = { threads: states.size, observed_threads: 0, partial_threads: 0, unsupported_threads: 0, responses: 0, observed_responses: 0, tool_calls: 0, compactions: 0 };
  let summed = [0, 0, 0, 0], responses = 0, toolCalls = 0;
  const tools = new Map();
  for (const state of states.values()) {
    finishTools(state);
    coverage.responses += state.responses.size;
    coverage.observed_responses += state.responses.size;
    coverage.tool_calls += state.calls.size;
    coverage.compactions += state.compactions;
    let status = state.invalid;
    if (!status) status = state.cumulativeSeen ? 'observed' : state.responses.size ? 'partial' : 'missing';
    if (status === 'observed') {
      coverage.observed_threads++;
      let values = state.cumulative;
      if (!values) {
        values = [0, 0, 0, 0];
        for (const counts of state.responses.values()) values = values.map((value, index) => addKnown(value, counts[index]));
      }
      if (values[0] === null || values[1] === null || values[0] + values[1] > Number.MAX_SAFE_INTEGER) { coverage.observed_threads--; coverage.partial_threads++; continue; }
      summed = summed.map((value, index) => addKnown(value, values[index]));
      responses += state.responses.size;
      toolCalls += state.calls.size;
      for (const [name, bytes] of state.toolGroups) tools.set(name, [...(tools.get(name) || []), ...bytes]);
    } else if (status === 'unsupported') coverage.unsupported_threads++;
    else if (status === 'partial') coverage.partial_threads++;
  }
  const complete = coverage.observed_threads === states.size && states.size > 0 && summed[0] !== null && summed[1] !== null && safeAdd(summed[0], summed[1]) !== null;
  const status = complete ? 'observed' : coverage.observed_threads ? 'partial' : coverage.unsupported_threads ? 'unsupported' : coverage.partial_threads ? 'partial' : 'missing';
  const totals = complete ? totalsFrom(summed, responses, toolCalls) : UNKNOWN;
  const largest = status === 'observed' || status === 'partial' ? [...tools].map(([tool, lengths]) => ({ tool, ...toolOutputStats(lengths) })).sort((a, b) => b.total_bytes - a.total_bytes || a.tool.localeCompare(b.tool)) : [];
  const validStart = startAt === null ? null : new Date(startAt).toISOString();
  const validEnd = endAt === null ? null : new Date(endAt).toISOString();
  return normalizeTelemetry({ schema_version: 1, project_id: projectId, observed_at: new Date().toISOString(), source: 'codex_rollout', status,
    start_at: validStart, end_at: validEnd, elapsed_ms: validStart && validEnd ? Date.parse(validEnd) - Date.parse(validStart) : null,
    totals, tasks: [], roles: [], agents: [], unattributed: { ...UNKNOWN, fraction: null }, largest_tool_outputs: largest, spawns: [],
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
  return summarize(states, projectId, startAt, endAt);
}
