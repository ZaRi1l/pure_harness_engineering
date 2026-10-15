#!/usr/bin/env node
import { RuntimeStore, contextFromArgs } from './runtime-state.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

export function renderStatus(snapshot, bridge = null) {
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
  lines.push('', 'Watchdog Warnings');
  for (const warning of status.warnings || []) lines.push('  ! ' + warning.message);
  if (!(status.warnings || []).length) lines.push('  none');
  if (bridge?.hookNote) lines.push('', bridge.hookNote);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { context } = await contextFromArgs(process.argv.slice(2));
  const store = new RuntimeStore(context), snapshot = await store.readSnapshot();
  let bridge = null;
  if (context?.harnessRoot) {
    try {
      const config = JSON.parse(await readFile(path.join(context.harnessRoot, '.harness/config.json'), 'utf8'));
      if (config.target === 'antigravity') {
        const { checkNativeBridge } = await import('../harness/native-bridge.mjs');
        bridge = await checkNativeBridge({ harnessRoot: context.harnessRoot, projectRoot: path.join(context.harnessRoot, 'project'), target: 'antigravity' });
      }
    } catch { bridge = { hookNote: 'Antigravity hooks: unverified (bridge check unavailable)' }; }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...snapshot, ...(bridge ? { bridge } : {}) }, null, 2));
  else process.stdout.write(renderStatus(snapshot, bridge));
}
