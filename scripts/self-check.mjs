#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPreviewServer } from './preview-server.mjs';
import { RuntimeStore, findRoot } from './runtime-state.mjs';
import { discoverCatalog } from './catalog.mjs';
import { inspectRuntime } from './watchdog.mjs';
import { renderStaticPreview } from './generate-preview.mjs';

const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop'];

function reportObject() {
  return { checks: [], warnings: [], failures: [], get ok() { return this.failures.length === 0; }, require(condition, success, failure) { (condition ? this.checks : this.failures).push(condition ? success : failure); } };
}

function basicTomlShape(text) {
  return text.split(/\r?\n/).every(line => { const value = line.trim(); return !value.startsWith('[') || /^\[[^\[\]]+\]$/.test(value); });
}

function validateCodex(root, text, executableOverride, spawnCodex = spawnSync) {
  if (!basicTomlShape(text)) return [false, 'Codex config has invalid TOML table syntax'];
  const executable = executableOverride || (process.platform === 'win32' ? 'codex.exe' : 'codex');
  const result = spawnCodex(executable, ['--strict-config', 'doctor', '--json'], { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.error) return result.error.code === 'EPERM'
    ? [null, `Codex config validation blocked by the current sandbox: ${result.error.message}`]
    : [null, `Codex executable unavailable: ${result.error.message}`];
  try { const payload = JSON.parse(result.stdout); if (payload.checks?.['config.load']?.status === 'ok') return [true, '']; }
  catch {}
  return [false, `Codex config rejected: ${(result.stderr || result.stdout || 'unknown error').slice(0, 500)}`];
}

export async function checkRepository(root, { exerciseRuntime = true, exerciseHttp = true, codexExecutable, spawnCodex } = {}) {
  root = path.resolve(root); const report = reportObject(), configPath = path.join(root, '.codex', 'config.toml'), hooksPath = path.join(root, '.codex', 'hooks.json');
  report.require(Number(process.versions.node.split('.')[0]) >= 20, 'Node.js 20+ is available', 'Node.js 20+ is required');
  report.require(existsSync(configPath), 'Codex config exists', 'missing .codex/config.toml'); report.require(existsSync(hooksPath), 'Hook config exists', 'missing .codex/hooks.json');
  if (existsSync(hooksPath)) {
    try {
      const hookMap = JSON.parse(readFileSync(hooksPath, 'utf8')).hooks; report.require(hookMap && typeof hookMap === 'object', 'Hook JSON parses', 'hooks.json lacks hooks object');
      if (hookMap && typeof hookMap === 'object') for (const event of HOOK_EVENTS) { const groups = hookMap[event], handlers = Array.isArray(groups) ? groups.flatMap(group => Array.isArray(group?.hooks) ? group.hooks : []) : []; const valid = handlers.length > 0 && handlers.every(handler => handler.type === 'command' && handler.command && handler.commandWindows); report.require(valid, `Hook event ${event} is configured`, `missing or invalid required hook event: ${event}`); }
    } catch (error) { report.failures.push(`invalid hooks.json: ${error.message}`); }
  }
  if (existsSync(configPath)) {
    const text = readFileSync(configPath, 'utf8'), [valid, detail] = validateCodex(root, text, codexExecutable, spawnCodex);
    if (valid === null) report.warnings.push(detail); else report.require(valid, 'Codex config loads in strict mode', detail);
    report.require(!/(^|\n)\s*(model|default_subagent_model)\s*=/.test(text), 'No model is hardcoded', 'project config hardcodes a model');
    const agentCatalog = discoverCatalog(root); report.require(agentCatalog.agents.length > 0, 'Agent catalog is discoverable', 'no agent declarations found');
    for (const agent of agentCatalog.agents) { const agentPath = path.join(root, '.codex', agent.path.replace(/^\.\//, '')); const exists = existsSync(agentPath); report.require(exists, `Agent ${agent.id} exists`, `missing agent config: ${agent.id}`); if (exists) { const contents = readFileSync(agentPath, 'utf8'); report.require(['name', 'description', 'developer_instructions'].every(key => new RegExp(`(^|\\n)${key}\\s*=`).test(contents)), `Agent ${agent.id} has required fields`, `agent ${agent.id} lacks required fields`); } }
  }
  const skillCatalog = discoverCatalog(root); report.require(skillCatalog.skills.length > 0, 'Skill catalog is discoverable', 'no skills found'); for (const skill of skillCatalog.skills) report.require(skill.valid && skill.name === skill.id, `Skill ${skill.id} is discoverable`, `missing or invalid skill: ${skill.id}`);
  report.require(existsSync(path.join(root, '.agents', 'skills', 'task-routing', 'profiles.md')), 'Project profiles exist', 'missing task-routing profiles reference');
  report.require(existsSync(path.join(root, 'preview', 'index.html')), 'Dashboard exists', 'missing preview/index.html');
  if (exerciseRuntime) {
    const temporary = await mkdtemp(path.join(tmpdir(), 'pure-self-check-')); await mkdir(path.join(temporary, 'preview')); await copyFile(path.join(root, 'preview', 'index.html'), path.join(temporary, 'preview', 'index.html'));
    const store = new RuntimeStore(temporary, { eventLimit: 10 }); await store.initialize(); await store.setGoal('Mock SMALL task', 'execution'); await store.upsertTask('small-1', 'Make one change', 'completed', 'worker'); await store.agentStarted('mock-planner', 'planner', 'Plan MEDIUM task'); await store.agentStopped('mock-planner', 'completed'); await store.setVerification('passed', 'mock-check', 'exit 0'); await store.claim('mock-worker', ['src/mock/']); const state = await store.readStatus();
    report.require(JSON.stringify(state.progress) === JSON.stringify({ completed: 1, total: 1 }), 'Runtime mock transitions pass', 'runtime derived progress is incorrect'); report.require(state.active_agents.length === 0 && state.signals.length === 2, 'Agent lifecycle and signals pass', 'agent lifecycle state is incorrect'); await store.upsertTask('orphan', 'Orphan test', 'pending', 'missing-agent'); const warnings = inspectRuntime(await store.readSnapshot()); report.require(warnings.some(item => item.id === 'unknown-owner-orphan'), 'Watchdog mock transition passes', 'watchdog smoke test failed'); await store.upsertTask('orphan', 'Orphan test', 'cancelled', 'missing-agent'); report.require(renderStaticPreview(await store.readSnapshot()).includes('Write Claims'), 'Static preview generation passes', 'static preview generation failed');
      if (exerciseHttp) { const server = await createPreviewServer(temporary); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); try { const port = server.address().port, html = await (await fetch(`http://127.0.0.1:${port}/`)).text(), payload = await (await fetch(`http://127.0.0.1:${port}/runtime/snapshot`)).json(); report.require(html.includes('Watchdog Warnings') && payload.status.current_goal === 'Mock SMALL task' && payload.status.task_counts.total === payload.tasks.tasks.length && payload.claims.claims.length === 1, 'Dashboard serves a consistent runtime snapshot', 'dashboard snapshot smoke test failed'); } finally { await new Promise(resolve => server.close(resolve)); } }
  }
  return report;
}

export async function main() { const report = await checkRepository(findRoot()); for (const item of report.checks) console.log(`PASS ${item}`); for (const item of report.warnings) console.log(`WARN ${item}`); for (const item of report.failures) console.log(`FAIL ${item}`); return report.ok ? 0 : 1; }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
