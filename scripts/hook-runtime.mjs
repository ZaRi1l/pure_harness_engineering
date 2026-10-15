#!/usr/bin/env node
import { RuntimeStore } from './runtime-state.mjs';
import { getScriptHarnessRoot, loadFixedProjectContext } from './project-context.mjs';
import { isOpaqueTaskId, shortTaskNameForId } from './telemetry-schema.mjs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function readStdin() { let value = ''; for await (const chunk of process.stdin) value += chunk; return value.trim(); }
const events = new Set(['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop', 'PreToolUse', 'PostToolUse']);
const sources = new Set(['claude', 'codex', 'antigravity']);
const roles = new Set(['worker', 'verifier', 'reviewer', 'planner', 'integrator', 'explorer', 'researcher', 'supervisor', 'security-auditor', 'performance-analyzer', 'environment-doctor', 'goal-manager', 'impact-analyzer', 'preview-manager', 'release-manager', 'context-curator', 'default']);
const outcomes = new Set(['stopped', 'completed', 'failed', 'cancelled', 'blocked']);
const models = new Set(['gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']);
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const nativeId = value => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
const known = (value, allowed) => typeof value === 'string' && allowed.has(value) ? value : null;
// A title is optional public metadata, never a place to persist arbitrary tool inputs.
const safeTitle = value => typeof value === 'string' && value.length <= 60 && value.trim() === value && value.length > 0
  && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
  && !/(?:password|passwd|secret|credential|api[_ -]?key|access[_ -]?token|bearer|sk-[A-Za-z0-9])/i.test(value) ? value : null;
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
// Antigravity camelCase is mapped only for categorical diagnostics until real event fixtures confirm lifecycle IDs.
function antigravityFields(payload) {
  return { event: payload.hookEventName ?? payload.event, tool_name: payload.toolCall?.name,
    agent_id: payload.agentId, subagent_id: payload.subagentId, agent_type: payload.agentType, cwd: payload.cwd };
}
export async function handleHook(payload, context, { source = 'unknown' } = {}) {
  const sourceTool = known(source, sources) ?? 'unknown';
  const normalized = sourceTool === 'antigravity' ? antigravityFields(payload) : payload;
  const store = context instanceof RuntimeStore ? context : new RuntimeStore(context);
  if (store.context?.kind !== 'core' && store.context) {
    const cwd = await realpath(normalized.cwd || process.cwd());
    const relative = path.relative(store.context.checkoutRoot, cwd);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('hook outside verified checkout');
  }
  const event = normalized.hook_event_name ?? normalized.event;
  if (!known(event, events)) return;
  if (sourceTool === 'antigravity') {
    if (!['PreToolUse', 'PostToolUse'].includes(event) || !['invoke_subagent', 'manage_subagents'].includes(normalized.tool_name)) return;
  } else if (event === 'PreToolUse' || (event === 'PostToolUse' && normalized.tool_name !== 'TaskStop'
      && !(sourceTool === 'claude' && normalized.tool_name === 'Agent')
      && !(sourceTool === 'codex' && ['close_agent', 'interrupt_agent'].includes(normalized.tool_name)))) return;
  const agentId = nativeId(normalized.agent_id), subagentId = nativeId(normalized.subagent_id);
  const ambiguousId = agentId && subagentId && agentId !== subagentId;
  const id = ambiguousId ? null : agentId ?? subagentId;
  const role = known(normalized.agent_type, roles) ?? 'unknown';
  const taskId = isOpaqueTaskId(normalized.task_id) ? normalized.task_id : undefined;
  const turnToken = nativeId(normalized.turn_token) ?? undefined;
  await store.initialize();
  await store.addEvent('hook_dispatch', `Native hook dispatched: ${event}`, { hook_event: event, source_tool: sourceTool });
  if (sourceTool === 'antigravity') {
    await store.addEvent('hook_lifecycle_diagnostic', 'Antigravity hook assessed', { hook_event: event, source_tool: sourceTool,
      tool_category: normalized.tool_name === 'invoke_subagent' ? 'invoke_subagent' : 'manage_subagents', disposition: 'unverified_payload' });
    return;
  }
  if (sourceTool === 'codex' && ['close_agent', 'interrupt_agent'].includes(normalized.tool_name) && event === 'PostToolUse') {
    await store.addEvent('hook_lifecycle_diagnostic', 'Codex tool callback assessed', { hook_event: event, source_tool: sourceTool,
      tool_category: normalized.tool_name, disposition: 'unverified_stop' });
    return;
  }
  if (sourceTool === 'claude' && event === 'PostToolUse' && payload.tool_name === 'Agent') {
    const childId = nativeId(payload.tool_response?.agentId);
    const sessionId = nativeId(payload.session_id);
    const title = safeTitle(payload.tool_input?.description);
    if (childId && sessionId && title) await store.agentTitled(childId, sessionId, title);
    return;
  }
  if (event === 'PostToolUse' && payload.tool_name === 'TaskStop') {
    const inputId = nativeId(payload.tool_input?.task_id);
    const responseId = nativeId(payload.tool_response?.task_id);
    const success = inputId && responseId === inputId && payload.tool_response?.task_type === 'local_agent'
      && payload.tool_response?.isError !== true && confirmsTaskStop(payload.tool_response?.message, inputId);
    await store.addEvent('taskstop_callback_diagnostic', 'Native TaskStop callback assessed', {
      hook_event: event, source_tool: sourceTool,
      input_id: inputId ? 'valid' : 'missing_or_invalid',
      response_id: !responseId ? 'missing_or_invalid' : responseId === inputId ? 'same' : 'different',
      task_type: payload.tool_response?.task_type === 'local_agent' ? 'local_agent' : 'other_or_missing',
      success_marker: success ? 'expected_shape' : 'other_or_missing',
    });
    if (success) await store.agentStopped(inputId, 'stopped', { source: 'hook', hook_event: 'PostToolUse:TaskStop', source_tool: sourceTool });
    return;
  }
  if (event === 'SessionStart') await store.addEvent('session_started', 'Native session started');
  else if (event === 'SessionEnd') {
    await store.addEvent('session_ended', 'Native session ended');
    if (sourceTool === 'claude' && nativeId(payload.session_id)) await store.sessionEnded(nativeId(payload.session_id));
  }
  else if (event === 'SubagentStart' && !id) await store.addEvent('hook_lifecycle_diagnostic', 'Native start hook assessed',
    { hook_event: event, source_tool: sourceTool, disposition: 'missing_or_ambiguous' });
  else if (event === 'SubagentStart' && id) {
    await store.agentStarted(id, role, '', { task_id: taskId, turn_token: turnToken, source: 'hook', source_tool: sourceTool,
      ...(sourceTool === 'claude' && nativeId(payload.session_id) ? { session_id: nativeId(payload.session_id) } : {}) });
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
  else if (event === 'SubagentStop' && !id) await store.addEvent('hook_stop_diagnostic', 'Native stop hook assessed',
    { hook_event: event, source_tool: sourceTool, disposition: ambiguousId ? 'missing_or_ambiguous' : 'missing_id' });
  else if (event === 'SubagentStop' && id) {
    const stopSignalId = await store.agentStopped(id, known(payload.outcome, outcomes) ?? 'stopped', { task_id: taskId, turn_token: turnToken, source: 'hook', source_tool: sourceTool, hook_event: 'SubagentStop' });
    const completedAt = stamp(payload.completed_at);
    if (store.context && stopSignalId && completedAt && (await store.readChildLinks()).some(link => link.child_agent_id === id)) await store.completeChildLink(id, completedAt, stopSignalId);
  }
  else if (event === 'Stop') await store.addEvent('turn_stopped', 'Native turn stopped');
}
export async function runHook(payload, { harnessRoot = getScriptHarnessRoot(import.meta.url), source = 'unknown',
  diagnostic = message => console.log(JSON.stringify({ systemMessage: message })) } = {}) {
  try {
    const context = await loadFixedProjectContext({ harnessRoot, cwd: payload.cwd || process.cwd() });
    await handleHook(payload, context, { source });
  } catch {
    diagnostic('Pure Harness hook skipped: outside the verified project or context unavailable');
  }
}
async function main() {
  const flag = process.argv.slice(2);
  const source = flag.length === 1 && /^--source=(claude|codex|antigravity)$/.test(flag[0]) ? flag[0].slice(9) : 'unknown';
  try {
    const raw = await readStdin();
    let reported = false;
    await runHook(raw ? JSON.parse(raw) : {}, { source, diagnostic: message => {
      reported = true;
      console.log(JSON.stringify({ systemMessage: message }));
    } });
    if (!reported && source !== 'unknown') console.log('{}');
  } catch { console.log(JSON.stringify({ systemMessage: 'Pure Harness hook skipped: invalid payload' })); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
