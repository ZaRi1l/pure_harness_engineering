#!/usr/bin/env node
import { RuntimeStore } from './runtime-state.mjs';
import { getScriptHarnessRoot, loadFixedProjectContext } from './project-context.mjs';
import { isOpaqueTaskId, shortTaskNameForId } from './telemetry-schema.mjs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function readStdin() { let value = ''; for await (const chunk of process.stdin) value += chunk; return value.trim(); }
const events = new Set(['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop']);
const roles = new Set(['worker', 'verifier', 'reviewer', 'planner', 'integrator', 'explorer', 'researcher', 'supervisor', 'security-auditor', 'performance-analyzer', 'environment-doctor', 'goal-manager', 'preview-manager', 'release-manager', 'context-curator', 'default']);
const outcomes = new Set(['stopped', 'completed', 'failed', 'cancelled', 'blocked']);
const models = new Set(['gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']);
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const nativeId = value => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
const known = (value, allowed) => typeof value === 'string' && allowed.has(value) ? value : null;
export async function handleHook(payload, context) {
  const store = context instanceof RuntimeStore ? context : new RuntimeStore(context);
  if (store.context?.kind !== 'core' && store.context) {
    const cwd = await realpath(payload.cwd || process.cwd());
    const relative = path.relative(store.context.checkoutRoot, cwd);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('hook outside verified checkout');
  }
  const event = payload.hook_event_name ?? payload.event;
  if (!known(event, events)) return;
  const id = nativeId(payload.agent_id) ?? nativeId(payload.subagent_id);
  const role = known(payload.agent_type, roles) ?? 'unknown';
  const taskId = isOpaqueTaskId(payload.task_id) ? payload.task_id : undefined;
  const turnToken = nativeId(payload.turn_token) ?? undefined;
  await store.initialize();
  await store.addEvent('hook_dispatch', `Codex hook dispatched: ${event}`, { hook_event: event });
  if (event === 'SessionStart') await store.addEvent('session_started', 'Codex session started');
  else if (event === 'SessionEnd') await store.addEvent('session_ended', 'Codex session ended');
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
  else if (event === 'SubagentStop' && id) {
    await store.agentStopped(id, known(payload.outcome, outcomes) ?? 'stopped', { task_id: taskId, turn_token: turnToken, source: 'hook' });
    const completedAt = stamp(payload.completed_at);
    if (store.context && completedAt && (await store.readChildLinks()).some(link => link.child_agent_id === id)) await store.completeChildLink(id, completedAt);
  }
  else if (event === 'Stop') await store.addEvent('turn_stopped', 'Codex turn stopped');
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
