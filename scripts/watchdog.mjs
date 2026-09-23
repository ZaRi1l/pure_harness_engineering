#!/usr/bin/env node
import { RuntimeStore, findRoot } from './runtime-state.mjs';

export function inspectRuntime(snapshot, { staleMs = Number(process.env.PURE_HARNESS_STALE_AGENT_MS || 3600000) } = {}) {
  const warnings = [], { status, tasks, claims } = snapshot, known = new Set(status.agents.map(agent => agent.id));
  for (const agent of status.active_agents) if (Date.now() - Date.parse(agent.started_at || 0) > staleMs) warnings.push({ id: 'stale-agent-' + agent.id, message: 'Active agent appears stale: ' + agent.id });
  for (const task of tasks.tasks) if (task.owner && task.owner !== 'main' && !known.has(task.owner)) warnings.push({ id: 'unknown-owner-' + task.id, message: 'Task owner is unknown: ' + task.owner });
  if (tasks.tasks.length && tasks.tasks.every(task => task.status === 'completed') && status.verification.status !== 'passed') warnings.push({ id: 'missing-verification', message: 'Completed tasks lack passed verification' });
  if (['failed', 'blocked'].includes(status.verification.status)) warnings.push({ id: 'verification-' + status.verification.status, message: 'Verification is ' + status.verification.status });
  for (let index = 0; index < claims.claims.length; index += 1) for (let next = index + 1; next < claims.claims.length; next += 1) for (const left of claims.claims[index].scopes) for (const right of claims.claims[next].scopes) if (left === right || left.startsWith(right + '/') || right.startsWith(left + '/')) warnings.push({ id: 'claim-conflict', message: 'Overlapping claims: ' + left + ' and ' + right });
  return warnings;
}

const store = new RuntimeStore(findRoot()), snapshot = await store.readSnapshot(), warnings = inspectRuntime(snapshot);
for (const warning of warnings) await store.addEvent('watchdog', warning.message);
if (process.argv.includes('--json')) console.log(JSON.stringify({ warnings }, null, 2));
else console.log(warnings.length ? warnings.map(warning => 'WARN ' + warning.message).join('\n') : 'OK no watchdog warnings');
