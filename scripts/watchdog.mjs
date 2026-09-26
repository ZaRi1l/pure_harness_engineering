#!/usr/bin/env node
import { RuntimeStore, findRoot } from './runtime-state.mjs';
import { pathToFileURL } from 'node:url';

export function hookDispatchDiagnostic(snapshot) {
  const agents = Array.isArray(snapshot?.status?.agents) ? snapshot.status.agents : [];
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const observed = new Set(events.filter(event => event?.type === 'hook_dispatch').map(event => event?.data?.hook_event).filter(Boolean));
  if (agents.some(agent => agent.start_source === 'hook')) observed.add('SubagentStart');
  if (agents.some(agent => agent.stop_source === 'hook')) observed.add('SubagentStop');
  const missing = [];
  if (agents.some(agent => agent.start_source === 'orchestration') && !observed.has('SubagentStart')) missing.push('SubagentStart');
  if (agents.some(agent => agent.stop_source === 'orchestration') && !observed.has('SubagentStop')) missing.push('SubagentStop');
  if (missing.length) return { state: 'suspected_unavailable', message: `Lifecycle hook dispatch not observed (${missing.join(', ')}). Falling back to orchestration lifecycle tracking.` };
  if (observed.size) return { state: 'observed', message: `Hook dispatch observed: ${[...observed].join(', ')}` };
  return { state: 'not_yet_observed', message: 'Lifecycle hook dispatch not yet observed in current runtime' };
}

export function inspectRuntime(snapshot, { staleMs = Number(process.env.PURE_HARNESS_STALE_AGENT_MS || 3600000) } = {}) {
  const warnings = [], { status, tasks, claims } = snapshot, known = new Set(status.agents.map(agent => agent.id));
  const hookDiagnostic = hookDispatchDiagnostic(snapshot);
  if (hookDiagnostic.state === 'suspected_unavailable') warnings.push({ id: 'lifecycle-hook-dispatch-unobserved', message: hookDiagnostic.message });
  for (const agent of status.active_agents) if (Date.now() - Date.parse(agent.started_at || 0) > staleMs) warnings.push({ id: 'stale-agent-' + agent.id, message: 'Active agent appears stale: ' + agent.id });
  for (const task of tasks.tasks) if (task.owner && task.owner !== 'main' && !known.has(task.owner)) warnings.push({ id: 'unknown-owner-' + task.id, message: 'Task owner is unknown: ' + task.owner });
  if (tasks.tasks.length && tasks.tasks.every(task => task.status === 'completed') && status.verification.status !== 'passed') warnings.push({ id: 'missing-verification', message: 'Completed tasks lack passed verification' });
  if (['failed', 'blocked'].includes(status.verification.status)) warnings.push({ id: 'verification-' + status.verification.status, message: 'Verification is ' + status.verification.status });
  for (let index = 0; index < claims.claims.length; index += 1) for (let next = index + 1; next < claims.claims.length; next += 1) for (const left of claims.claims[index].scopes) for (const right of claims.claims[next].scopes) if (left === right || left.startsWith(right + '/') || right.startsWith(left + '/')) warnings.push({ id: 'claim-conflict', message: 'Overlapping claims: ' + left + ' and ' + right });
  return warnings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new RuntimeStore(findRoot()), snapshot = await store.readSnapshot(), warnings = inspectRuntime(snapshot);
  await store.setWarnings(warnings);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ warnings }, null, 2));
  else console.log(warnings.length ? warnings.map(warning => 'WARN ' + warning.message).join('\n') : 'OK no watchdog warnings');
}
