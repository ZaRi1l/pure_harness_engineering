#!/usr/bin/env node
import { RuntimeStore } from './runtime-state.mjs';
import { getScriptHarnessRoot, loadFixedProjectContext } from './project-context.mjs';
import { isOpaqueTaskId, shortTaskNameForId } from './telemetry-schema.mjs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function readStdin() { let value = ''; for await (const chunk of process.stdin) value += chunk; return value.trim(); }
const events = new Set(['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop', 'PostToolUse']);
const roles = new Set(['worker', 'verifier', 'reviewer', 'planner', 'integrator', 'explorer', 'researcher', 'supervisor', 'security-auditor', 'performance-analyzer', 'environment-doctor', 'goal-manager', 'preview-manager', 'release-manager', 'context-curator', 'default']);
const outcomes = new Set(['stopped', 'completed', 'failed', 'cancelled', 'blocked']);
const models = new Set(['gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']);
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const nativeId = value => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
const known = (value, allowed) => typeof value === 'string' && allowed.has(value) ? value : null;
function confirmsTaskStop(message, id) {
  if (!id || typeof message !== 'string') return false;
  const prefix = `Successfully stopped task: ${id} (`;
  if (!message.startsWith(prefix) || !message.endsWith(')')) return false;
  const description = message.slice(prefix.length, -1);
  if (!description.length || description.length > 200 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(description)) return false;
  // Unbalanced parentheses can be a legitimate description or appended tool output; fail closed.
  let depth = 0;
  for (const char of description) {
    if (char === '(') depth += 1;
    else if (char === ')' && --depth < 0) return false;
  }
  return depth === 0;
}
export async function handleHook(payload, context) {
  const store = context instanceof RuntimeStore ? context : new RuntimeStore(context);
  if (store.context?.kind !== 'core' && store.context) {
    const cwd = await realpath(payload.cwd || process.cwd());
    const relative = path.relative(store.context.checkoutRoot, cwd);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('hook outside verified checkout');
  }
  const event = payload.hook_event_name ?? payload.event;
  if (!known(event, events) || (event === 'PostToolUse' && payload.tool_name !== 'TaskStop')) return;
  const id = nativeId(payload.agent_id) ?? nativeId(payload.subagent_id);
  const role = known(payload.agent_type, roles) ?? 'unknown';
  const taskId = isOpaqueTaskId(payload.task_id) ? payload.task_id : undefined;
  const turnToken = nativeId(payload.turn_token) ?? undefined;
  await store.initialize();
  await store.addEvent('hook_dispatch', `Native hook dispatched: ${event}`, { hook_event: event });
  if (event === 'PostToolUse' && payload.tool_name === 'TaskStop') {
    const inputId = nativeId(payload.tool_input?.task_id);
    const responseId = nativeId(payload.tool_response?.task_id);
    const success = inputId && responseId === inputId && payload.tool_response?.task_type === 'local_agent'
      && payload.tool_response?.isError !== true && confirmsTaskStop(payload.tool_response?.message, inputId);
    await store.addEvent('taskstop_callback_diagnostic', 'Native TaskStop callback assessed', {
      hook_event: event,
      input_id: inputId ? 'valid' : 'missing_or_invalid',
      response_id: !responseId ? 'missing_or_invalid' : responseId === inputId ? 'same' : 'different',
      task_type: payload.tool_response?.task_type === 'local_agent' ? 'local_agent' : 'other_or_missing',
      success_marker: success ? 'expected_shape' : 'other_or_missing',
    });
    if (success) await store.agentStopped(inputId, 'stopped', { source: 'hook', hook_event: 'PostToolUse:TaskStop' });
    return;
  }
  if (event === 'SessionStart') await store.addEvent('session_started', 'Native session started');
  else if (event === 'SessionEnd') await store.addEvent('session_ended', 'Native session ended');
  else if (event === 'SubagentStart' && id) {
    await store.agentStarted(id, role, '', { task_id: taskId, turn_token: turnToken, source: 'hook' });
    const parentId = nativeId(payload.parent_thread_id), spawnedAt = stamp(payload.spawned_at);
    if (store.context && parentId && spawnedAt) await store.recordChildLink({
      project_id: store.context.projectId, acknowledgement: 'success', child_agent_id: id,
      parent_agent_id: parentId, root_turn_id: nativeId(payload.root_turn_id),
      task_id: taskId ?? null, role: known(payload.agent_type, roles),
      short_task_name: shortTaskNameForId(taskId), fork_turns: typeof payload.fork_turns === 'string' && /^(?:none|all|0|[1-9][0-9]{0,2})$/.test(payload.fork_turns) ? payload.fork_turns : null,
      model: known(payload.model, models), reasoning_effort: known(payload.reasoning_effort, efforts),
      spawned_at: spawnedAt, completed_at: null,
    });
  }
  else if (event === 'SubagentStop' && !id) await store.addEvent('hook_stop_diagnostic', 'Native stop hook assessed', { hook_event: event, disposition: 'missing_id' });
  else if (event === 'SubagentStop' && id) {
    const stopSignalId = await store.agentStopped(id, known(payload.outcome, outcomes) ?? 'stopped', { task_id: taskId, turn_token: turnToken, source: 'hook' });
    const completedAt = stamp(payload.completed_at);
    if (store.context && stopSignalId && completedAt && (await store.readChildLinks()).some(link => link.child_agent_id === id)) await store.completeChildLink(id, completedAt, stopSignalId);
  }
  else if (event === 'Stop') await store.addEvent('turn_stopped', 'Native turn stopped');
}
export async function runHook(payload, { harnessRoot = getScriptHarnessRoot(import.meta.url), diagnostic = message => console.log(JSON.stringify({ systemMessage: message })) } = {}) {
  try {
    const context = await loadFixedProjectContext({ harnessRoot, cwd: payload.cwd || process.cwd() });
    await handleHook(payload, context);
  } catch {
    diagnostic('Pure Harness hook skipped: outside the verified project or context unavailable');
  }
}
async function main() { try { const raw = await readStdin(); await runHook(raw ? JSON.parse(raw) : {}); } catch { console.log(JSON.stringify({ systemMessage: 'Pure Harness hook skipped: invalid payload' })); } }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
