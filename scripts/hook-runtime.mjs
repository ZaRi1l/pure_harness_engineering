#!/usr/bin/env node
import { RuntimeStore } from './runtime-state.mjs';
import { getScriptHarnessRoot, loadFixedProjectContext } from './project-context.mjs';
import { shortTaskNameForId } from './telemetry-schema.mjs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function readStdin() { let value = ''; for await (const chunk of process.stdin) value += chunk; return value.trim(); }
export async function handleHook(payload, context) {
  const store = context instanceof RuntimeStore ? context : new RuntimeStore(context);
  if (store.context?.kind !== 'core' && store.context) {
    const cwd = await realpath(payload.cwd || process.cwd());
    const relative = path.relative(store.context.checkoutRoot, cwd);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('hook outside verified checkout');
  }
  await store.initialize(); const event = payload.hook_event_name || payload.event || 'Unknown';
  const agentId = payload.agent_id || payload.subagent_id, id = agentId ? String(agentId) : null, role = String(payload.agent_type || payload.agent_name || 'subagent');
  await store.addEvent('hook_dispatch', `Codex hook dispatched: ${event}`, { hook_event: event });
  if (event === 'SessionStart') await store.addEvent('session_started', 'Codex session started');
  else if (event === 'SessionEnd') await store.addEvent('session_ended', 'Codex session ended');
  else if (event === 'SubagentStart' && id) {
    await store.agentStarted(id, role, '', { task_id: payload.task_id, turn_token: payload.turn_token, source: 'hook' });
    if (store.context && agentId && payload.spawned_at && payload.parent_thread_id) await store.recordChildLink({
      project_id: store.context.projectId, acknowledgement: 'success', child_agent_id: agentId,
      parent_agent_id: payload.parent_thread_id, root_turn_id: payload.root_turn_id ?? null,
      task_id: payload.task_id ?? null, role: payload.agent_type ?? null,
      short_task_name: shortTaskNameForId(payload.task_id), fork_turns: payload.fork_turns ?? null,
      model: payload.model ?? null, reasoning_effort: payload.reasoning_effort ?? null,
      spawned_at: payload.spawned_at, completed_at: null,
    });
  }
  else if (event === 'SubagentStop' && id) {
    await store.agentStopped(id, payload.outcome ? String(payload.outcome) : 'stopped', { task_id: payload.task_id, turn_token: payload.turn_token, source: 'hook' });
    if (store.context && agentId && payload.completed_at && (await store.readChildLinks()).some(link => link.child_agent_id === agentId)) await store.completeChildLink(agentId, payload.completed_at);
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
