#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeStore, findRoot } from './runtime-state.mjs';
import { pathToFileURL } from 'node:url';

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function renderStaticPreview(snapshot) {
  const { status, tasks, claims } = snapshot;
  const taskRows = tasks.tasks.map(task => '<li>' + escape(task.status) + ' · ' + escape(task.title) + ' · ' + escape(task.owner || 'unassigned') + '</li>').join('') || '<li>none</li>';
  const claimRows = claims.claims.map(claim => '<li>' + escape(claim.agent_id) + ' · ' + escape(claim.scopes.join(', ')) + '</li>').join('') || '<li>none</li>';
  return '<!doctype html><meta charset="utf-8"><title>Pure Harness snapshot</title><style>body{max-width:900px;margin:40px auto;font:16px system-ui;background:#0b1116;color:#e8f1f6}section{padding:16px;margin:12px 0;border:1px solid #2b3d4b;border-radius:10px;background:#121c24}h1{color:#69d6b0}li{padding:4px 0}</style><h1>Pure Harness</h1><p>Static snapshot generated ' + escape(status.last_update) + '</p><section><h2>Goal</h2><p>' + escape(status.current_goal || 'none') + '</p><p>Phase: ' + escape(status.phase) + '</p></section><section><h2>Tasks</h2><ul>' + taskRows + '</ul></section><section><h2>Write Claims</h2><ul>' + claimRows + '</ul></section><section><h2>Verification</h2><p>' + escape(status.verification.status) + '</p></section>';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = findRoot(), store = new RuntimeStore(root), snapshot = await store.readSnapshot(), output = path.join(root, '.ai', 'runtime', 'preview.html');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, renderStaticPreview(snapshot), 'utf8');
  console.log(output);
}
