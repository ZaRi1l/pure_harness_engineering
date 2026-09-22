#!/usr/bin/env node
import { RuntimeStore, findRoot } from './runtime-state.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function readStdin() { let value = ''; for await (const chunk of process.stdin) value += chunk; return value.trim(); }
export async function handleHook(payload, root = findRoot()) {
  const store = new RuntimeStore(root); await store.initialize(); const event = payload.hook_event_name || payload.event || 'Unknown';
  const id = String(payload.agent_id || payload.subagent_id || 'unknown-agent'), role = String(payload.agent_type || payload.agent_name || 'subagent');
  if (event === 'SessionStart') await store.addEvent('session_started', 'Codex session started');
  else if (event === 'SessionEnd') await store.addEvent('session_ended', 'Codex session ended');
  else if (event === 'SubagentStart') await store.agentStarted(id, role, String(payload.task || ''));
  else if (event === 'SubagentStop') await store.agentStopped(id, 'stopped');
  else if (event === 'Stop') await store.addEvent('turn_stopped', 'Codex turn stopped');
}
async function main() { try { const raw = await readStdin(); await handleHook(raw ? JSON.parse(raw) : {}); } catch (error) { console.log(JSON.stringify({ systemMessage: `Pure Harness runtime update skipped: ${error.message}` })); } }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
