#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeStore, findRoot } from './runtime-state.mjs';
import { pathToFileURL } from 'node:url';
import { discoverCatalog, discoverTaskSpecs } from './catalog.mjs';

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = value => escape(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const scriptData = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const scriptSource = value => String(value).replace(/<\/script/gi, '<\\/script');
export function renderStaticPreview(snapshot, taskSpecs = [], catalog = { agents: [], skills: [] }, networkSource = '', preferencesSource = '') {
  const { status, tasks, claims } = snapshot;
  const emptyList = '<li data-i18n="common.none">none</li>';
  const taskRows = tasks.tasks.map(task => '<li>' + escape(task.status) + ' · ' + escape(task.title) + ' · ' + (task.owner ? escape(task.owner) : '<span data-i18n="dashboard.unassigned">unassigned</span>') + '</li>').join('') || emptyList;
  const claimRows = claims.claims.map(claim => '<li>' + escape(claim.agent_id) + ' · ' + escape(claim.scopes.join(', ')) + '</li>').join('') || emptyList;
  const specRows = taskSpecs.map(spec => '<details><summary>' + escape(spec.title) + ' · ' + escape(spec.path) + '</summary><pre>' + escape(spec.content) + '</pre></details>').join('') || '<p data-i18n="common.none">none</p>';
  const generatedValues = escapeAttribute(JSON.stringify({ time: status.last_update || '' }));
  const phaseValues = escapeAttribute(JSON.stringify({ phase: status.phase || '' }));
  const bootstrap = preferencesSource
    ? scriptSource(preferencesSource) + '\n' + scriptSource(networkSource) + '\n'
      + 'const previewPreferences=PreviewPreferences.create(document);previewPreferences.mount(document.querySelector("#preview-preferences"));const previewNetwork=AgentSignalNetwork.create(document.querySelector("#agent-network"),{staticMode:true,translate:previewPreferences.t});previewNetwork.update(' + scriptData(snapshot) + ',' + scriptData(catalog) + ');previewPreferences.subscribe(()=>previewNetwork.setTranslate(previewPreferences.t));previewPreferences.translate(document);'
    : scriptSource(networkSource) + '\nAgentSignalNetwork.create(document.querySelector("#agent-network"), { staticMode: true }).update(' + scriptData(snapshot) + ', ' + scriptData(catalog) + ');';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pure Harness snapshot</title><style>:root{color-scheme:dark;--b:#0b1116;--p:#121c24;--l:#2b3d4b;--a:#69d6b0;--m:#98aebb;--text:#e8f1f6;--graph-bg:#0e1a22;--graph-control:#172730;--graph-border:#53616c;--graph-edge:#6f8794;--graph-node-stroke:#c1dae5;--graph-text:#f1f5f8}:root[data-theme="light"]{color-scheme:light;--b:#f3f7f8;--p:#fff;--l:#bdcbd2;--a:#08765d;--m:#526873;--text:#14232b;--graph-bg:#f7fafb;--graph-control:#fff;--graph-border:#8da2ad;--graph-edge:#607984;--graph-node-stroke:#244b5a;--graph-text:#172b34}body{max-width:1200px;margin:40px auto;padding:0 16px;font:16px system-ui;background:var(--b);color:var(--text)}section{padding:16px;margin:12px 0;border:1px solid var(--l);border-radius:10px;background:var(--p)}h1{color:var(--a)}li{padding:4px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}.preferences{display:flex;gap:8px;justify-content:flex-end}.preference-button{padding:7px 12px;border:1px solid var(--l);border-radius:7px;background:var(--p);color:inherit;cursor:pointer}</style><div id="preview-preferences" class="preferences"></div><h1>Pure Harness</h1><p data-i18n="static.generated" data-i18n-values="' + generatedValues + '">Static snapshot generated ' + escape(status.last_update) + '</p><section><h2 data-i18n="section.goal">Goal</h2><p>' + escape(status.current_goal || 'none') + '</p><p data-i18n="static.phase" data-i18n-values="' + phaseValues + '">Phase: ' + escape(status.phase) + '</p></section><section><h2 data-i18n="section.tasks">Tasks</h2><ul>' + taskRows + '</ul></section><section><h2 data-i18n="section.claims">Write Claims</h2><ul>' + claimRows + '</ul></section><section><h2 data-i18n="section.verification">Verification</h2><p>' + escape(status.verification.status) + '</p></section><section><h2 data-i18n="preview.planSpecs">Plan / Task Specs</h2>' + specRows + '</section><section><h2 data-i18n="section.network">Agent Signal Network</h2><div id="agent-network"></div></section>'
    + (networkSource ? '<script>' + bootstrap + '</script>' : '') + '</html>';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = findRoot(), store = new RuntimeStore(root), snapshot = await store.readSnapshot(), output = path.join(root, '.ai', 'runtime', 'preview.html');
  await mkdir(path.dirname(output), { recursive: true });
  const networkSource = await readFile(path.join(root, 'preview', 'agent-network.js'), 'utf8');
  const preferencesSource = await readFile(path.join(root, 'preview', 'preferences.js'), 'utf8');
  await writeFile(output, renderStaticPreview(snapshot, discoverTaskSpecs(root), discoverCatalog(root), networkSource, preferencesSource), 'utf8');
  console.log(output);
}
