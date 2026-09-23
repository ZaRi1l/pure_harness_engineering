#!/usr/bin/env node
import { RuntimeStore, findRoot } from './runtime-state.mjs';

export function renderStatus(snapshot) {
  const { status, tasks, claims } = snapshot;
  const lines = ['Pure Harness', '', 'Goal       ' + (status.current_goal || 'none'), 'Phase      ' + (status.phase || 'idle')];
  if (status.progress) lines.push('Progress   ' + status.progress.completed + ' / ' + status.progress.total);
  lines.push('', 'Active Agents');
  for (const agent of status.active_agents) lines.push('  ' + agent.id + '  ' + agent.role + '  ' + agent.status + '  ' + (agent.current_task || ''));
  if (!status.active_agents.length) lines.push('  none');
  lines.push('', 'Tasks');
  for (const task of tasks.tasks) lines.push('  ' + task.status + '  ' + task.title + (task.owner ? '  ' + task.owner : ''));
  lines.push('', 'Verification');
  for (const check of status.verification.checks) lines.push('  ' + check.name + '  ' + check.status);
  if (!status.verification.checks.length) lines.push('  none');
  lines.push('', 'Claims');
  for (const claim of claims.claims) lines.push('  ' + claim.agent_id + '  ' + claim.scopes.join(', '));
  if (!claims.claims.length) lines.push('  none');
  return lines.join('\n') + '\n';
}

const root = findRoot(), store = new RuntimeStore(root), snapshot = await store.readSnapshot();
if (process.argv.includes('--json')) console.log(JSON.stringify(snapshot, null, 2));
else process.stdout.write(renderStatus(snapshot));
