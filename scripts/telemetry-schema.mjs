const object = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid ${name}`);
  return value;
};
const count = (value, name) => {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${name}`);
  return value;
};
const midpoint = (value, name) => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value * 2)) throw new Error(`invalid ${name}`);
  return value;
};
const timestamp = (value, name) => {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`invalid ${name}`);
  return value;
};
const id = (value, name, { nullable = false, max = 128 } = {}) => {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !value || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error(`invalid ${name}`);
  return value;
};
export const isOpaqueTaskId = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const taskId = (value, { nullable = false } = {}) => {
  if (nullable && value == null) return null;
  if (!isOpaqueTaskId(value)) throw new Error('invalid task id');
  return value;
};
export const shortTaskNameForId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(value) ? value : null;
const known = (value, allowed, name, fallback = 'other') => {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`invalid ${name}`);
  return allowed.has(value) ? value : fallback;
};
const ROLES = new Set(['worker', 'verifier', 'reviewer', 'planner', 'integrator', 'explorer', 'researcher', 'supervisor', 'security-auditor', 'performance-analyzer', 'environment-doctor', 'goal-manager', 'preview-manager', 'release-manager', 'context-curator', 'default', 'other']);
const MODELS = new Set(['gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'other']);
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'other']);
const SOURCES = new Set(['codex_rollout', 'other']);
const STATUSES = new Set(['observed', 'partial', 'missing', 'unsupported']);
const TOOLS = new Set(['exec_command', 'apply_patch', 'write_stdin', 'web.run', 'functions.exec', 'functions.wait', 'mcp__cua_repl.js', 'image_gen.imagegen', 'collaboration.spawn_agent', 'collaboration.send_message', 'other']);

export function normalizeTotals(input) {
  const value = object(input, 'totals');
  const output = Object.fromEntries(['input', 'output', 'processed', 'cached_input', 'reasoning_output'].map(key => [key, count(value[key], key)]));
  if (output.input !== null && output.output !== null) {
    const sum = output.input + output.output;
    if (!Number.isSafeInteger(sum) || output.processed !== sum) throw new Error('invalid processed total');
  } else if (output.processed !== null) throw new Error('processed requires observed input and output');
  if (output.cached_input !== null && output.input !== null && output.cached_input > output.input) throw new Error('cached input exceeds input');
  if (output.reasoning_output !== null && output.output !== null && output.reasoning_output > output.output) throw new Error('reasoning output exceeds output');
  for (const key of ['responses', 'tool_calls']) if (key in value) output[key] = count(value[key], key);
  return output;
}

const rows = (input, name, field) => {
  if (!Array.isArray(input)) throw new Error(`invalid ${name}`);
  return input.map(item => {
    const row = object(item, name);
    return { [field]: field === 'role' ? known(row[field], ROLES, field) : field === 'task_id' ? taskId(row[field]) : id(row[field], field), totals: normalizeTotals(row.totals) };
  });
};
const fraction = value => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('invalid fraction');
  return value;
};
const forkTurns = value => {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^(?:none|all|0|[1-9][0-9]{0,2})$/.test(value)) throw new Error('invalid fork turns');
  return value;
};

export function normalizeTelemetry(input, projectId) {
  const value = object(input, 'telemetry');
  id(projectId, 'project id');
  if (value.schema_version !== 1) throw new Error('unsupported telemetry schema');
  if (value.project_id !== projectId) throw new Error('telemetry project identity mismatch');
  const observedAt = timestamp(value.observed_at, 'observed at');
  if (!observedAt) throw new Error('missing observed at');
  if (!STATUSES.has(value.status)) throw new Error('invalid telemetry status');
  const startAt = timestamp(value.start_at, 'start at');
  const endAt = timestamp(value.end_at, 'end at');
  const elapsedMs = count(value.elapsed_ms, 'elapsed');
  if ((startAt === null || endAt === null) && elapsedMs !== null) throw new Error('elapsed requires observed endpoints');
  if (startAt !== null && endAt !== null) {
    const difference = Date.parse(endAt) - Date.parse(startAt);
    if (difference < 0 || !Number.isSafeInteger(difference) || elapsedMs !== difference) throw new Error('invalid elapsed');
  }
  const unassigned = object(value.unattributed, 'unattributed');
  const coverage = object(value.coverage, 'coverage');
  const projectedCoverage = {};
  for (const key of ['threads', 'observed_threads', 'partial_threads', 'unsupported_threads', 'responses', 'observed_responses', 'tool_calls', 'compactions']) if (key in coverage) projectedCoverage[key] = count(coverage[key], `coverage ${key}`);
  const output = {
    schema_version: 1, project_id: projectId, observed_at: observedAt,
    source: known(value.source, SOURCES, 'source'), status: value.status,
    start_at: startAt, end_at: endAt, elapsed_ms: elapsedMs,
    totals: normalizeTotals(value.totals),
    tasks: rows(value.tasks, 'tasks', 'task_id'), roles: rows(value.roles, 'roles', 'role'), agents: rows(value.agents, 'agents', 'agent_id'),
    unattributed: { ...normalizeTotals(unassigned), fraction: fraction(unassigned.fraction) },
    largest_tool_outputs: [], spawns: [], compactions: count(value.compactions, 'compactions'), coverage: projectedCoverage,
  };
  if (!Array.isArray(value.largest_tool_outputs) || !Array.isArray(value.spawns)) throw new Error('invalid telemetry rows');
  output.largest_tool_outputs = value.largest_tool_outputs.map(raw => {
    const row = object(raw, 'tool output');
    return { tool: known(row.tool, TOOLS, 'tool'), count: count(row.count, 'tool count'), total_bytes: count(row.total_bytes, 'tool bytes'), median_bytes: midpoint(row.median_bytes, 'median bytes'), p95_bytes: count(row.p95_bytes, 'p95 bytes'), max_bytes: count(row.max_bytes, 'max bytes') };
  });
  output.spawns = value.spawns.map(raw => {
    const row = object(raw, 'spawn');
    return { parent_agent_id: id(row.parent_agent_id, 'parent agent', { nullable: true }), child_agent_id: id(row.child_agent_id, 'child agent', { nullable: true }), task_id: taskId(row.task_id, { nullable: true }), role: known(row.role, ROLES, 'role'), fork_turns: forkTurns(row.fork_turns), attempts: count(row.attempts, 'spawn attempts'), confirmed: count(row.confirmed, 'confirmed spawns') };
  });
  const denominator = output.totals.processed, numerator = output.unattributed.processed, ratio = output.unattributed.fraction;
  if (denominator !== null && numerator !== null && numerator > denominator) throw new Error('unattributed exceeds total');
  if (ratio !== null && (denominator === null || denominator === 0 || numerator === null || Math.abs(ratio - numerator / denominator) > 1e-12)) throw new Error('invalid unattributed fraction');
  if (value.status === 'missing' || value.status === 'unsupported') {
    const tokenFields = ['input', 'output', 'processed', 'cached_input', 'reasoning_output', 'responses', 'tool_calls'];
    if (tokenFields.some(key => output.totals[key] != null || output.unattributed[key] != null) || ratio !== null || output.compactions !== null || output.tasks.length || output.roles.length || output.agents.length || output.largest_tool_outputs.length) throw new Error('unobserved telemetry cannot contain measured values');
  }
  return output;
}

export function normalizeChildLink(input, projectId) {
  const value = object(input, 'child link');
  id(projectId, 'project id');
  if (value.project_id !== projectId) throw new Error('child link project identity mismatch');
  if (value.acknowledgement !== 'success') throw new Error('child link requires successful acknowledgement');
  const spawnedAt = timestamp(value.spawned_at, 'spawned at');
  if (!spawnedAt) throw new Error('missing spawn time');
  const completedAt = timestamp(value.completed_at, 'completed at');
  if (completedAt && completedAt < spawnedAt) throw new Error('completion precedes spawn');
  const label = value.short_task_name;
  if (label != null && label !== value.task_id) throw new Error('invalid short task name');
  return {
    project_id: projectId, task_id: taskId(value.task_id, { nullable: true }), root_turn_id: id(value.root_turn_id, 'root turn id', { nullable: true }),
    parent_agent_id: id(value.parent_agent_id, 'parent agent id', { nullable: true }), child_agent_id: id(value.child_agent_id, 'child agent id'),
    role: known(value.role, ROLES, 'role'), short_task_name: shortTaskNameForId(label), fork_turns: forkTurns(value.fork_turns),
    model: known(value.model, MODELS, 'model'), reasoning_effort: known(value.reasoning_effort, EFFORTS, 'reasoning effort'),
    spawned_at: spawnedAt, completed_at: completedAt,
  };
}
