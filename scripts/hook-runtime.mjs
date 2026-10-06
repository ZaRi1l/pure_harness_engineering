#!/usr/bin/env node
import { RuntimeStore, contextFromArgs } from './runtime-state.mjs';
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
  const agentId = payload.agent_id || payload.subagent_id, id = String(agentId || 'unknown-agent'), role = String(payload.agent_type || payload.agent_name || 'subagent');
  await store.addEvent('hook_dispatch', `Codex hook dispatched: ${event}`, { hook_event: event });
  if (event === 'SessionStart') await store.addEvent('session_started', 'Codex session started');
  else if (event === 'SessionEnd') await store.addEvent('session_ended', 'Codex session ended');
  else if (event === 'SubagentStart') {
    await store.agentStarted(id, role, String(payload.task || ''), { task_id: payload.task_id, turn_token: payload.turn_token, source: 'hook' });
    if (store.context && agentId && payload.spawned_at && payload.parent_thread_id) await store.recordChildLink({
      project_id: store.context.projectId, acknowledgement: 'success', child_agent_id: agentId,
      parent_agent_id: payload.parent_thread_id, root_turn_id: payload.root_turn_id ?? null,
      task_id: payload.task_id ?? null, role: payload.agent_type ?? null,
      short_task_name: shortTaskNameForId(payload.task_id), fork_turns: payload.fork_turns ?? null,
      model: payload.model ?? null, reasoning_effort: payload.reasoning_effort ?? null,
      spawned_at: payload.spawned_at, completed_at: null,
    });
  }
  else if (event === 'SubagentStop') {
    await store.agentStopped(id, payload.outcome ? String(payload.outcome) : 'stopped', { task_id: payload.task_id, turn_token: payload.turn_token, source: 'hook' });
    if (store.context && agentId && payload.completed_at && (await store.readChildLinks()).some(link => link.child_agent_id === agentId)) await store.completeChildLink(agentId, payload.completed_at);
  }
  else if (event === 'Stop') await store.addEvent('turn_stopped', 'Codex turn stopped');
}
async function main() { try { const { context } = await contextFromArgs(process.argv.slice(2)); const raw = await readStdin(); await handleHook(raw ? JSON.parse(raw) : {}, context); } catch { console.log(JSON.stringify({ systemMessage: 'Pure Harness runtime update skipped: project context or binding invalid' })); } }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
