#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPreviewServer } from './preview-server.mjs';
import { RuntimeStore, findRoot } from './runtime-state.mjs';

const AGENTS = ['planner', 'worker', 'reviewer', 'supervisor', 'context-curator', 'preview-manager', 'verifier', 'impact-analyzer', 'integrator', 'environment-doctor', 'researcher', 'security-auditor', 'performance-analyzer', 'release-manager'];
const SKILLS = ['task-routing', 'task-spec', 'failure-recovery', 'context-curation', 'token-efficiency'];
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
    : [false, `Codex executable unavailable: ${result.error.message}`];
  try { const payload = JSON.parse(result.stdout); if (payload.checks?.['config.load']?.status === 'ok') return [true, '']; }
  catch {}
  return [false, `Codex config rejected: ${(result.stderr || result.stdout || 'unknown error').slice(0, 500)}`];
}

export async function checkRepository(root, { exerciseRuntime = true, exerciseHttp = true, codexExecutable, spawnCodex } = {}) {
  root = path.resolve(root); const report = reportObject(), configPath = path.join(root, '.codex', 'config.toml'), hooksPath = path.join(root, '.codex', 'hooks.json');
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
    for (const name of AGENTS) {
      const agentPath = path.join(root, '.codex', 'agents', `${name}.toml`), exists = existsSync(agentPath); report.require(exists, `Agent ${name} exists`, `missing agent config: ${name}`);
      const section = text.match(new RegExp(`\\[agents\\.${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`)), declared = section && new RegExp(`config_file\\s*=\\s*"\\./agents/${name}\\.toml"`).test(section[1]); report.require(Boolean(declared), `Agent ${name} is declared`, `agent ${name} is not linked from config.toml`);
      if (exists) { const agent = readFileSync(agentPath, 'utf8'), fields = ['name', 'description', 'developer_instructions'].every(field => new RegExp(`(^|\\n)${field}\\s*=`).test(agent)), identity = new RegExp(`(^|\\n)name\\s*=\\s*"${name}"`).test(agent); report.require(fields && identity, `Agent ${name} has required fields`, `agent ${name} lacks required fields or matching name`); }
    }
  }
  for (const name of SKILLS) { const skillPath = path.join(root, '.agents', 'skills', name, 'SKILL.md'), text = existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : '', frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); const valid = frontmatter && new RegExp(`(^|\\n)name:\\s*${name}\\s*($|\\n)`).test(frontmatter[1]) && /(^|\n)description:\s*Use when\b/.test(frontmatter[1]); report.require(Boolean(valid), `Skill ${name} is discoverable`, `missing or invalid skill: ${name}`); }
  report.require(existsSync(path.join(root, '.agents', 'skills', 'task-routing', 'profiles.md')), 'Project profiles exist', 'missing task-routing profiles reference');
  report.require(existsSync(path.join(root, 'preview', 'index.html')), 'Dashboard exists', 'missing preview/index.html');
  if (exerciseRuntime) {
    const temporary = await mkdtemp(path.join(tmpdir(), 'pure-self-check-')); await mkdir(path.join(temporary, 'preview')); await copyFile(path.join(root, 'preview', 'index.html'), path.join(temporary, 'preview', 'index.html'));
    const store = new RuntimeStore(temporary, { eventLimit: 10 }); await store.initialize(); await store.setGoal('Mock SMALL task', 'execution'); await store.upsertTask('small-1', 'Make one change', 'completed', 'worker'); await store.agentStarted('mock-planner', 'planner', 'Plan MEDIUM task'); await store.agentStopped('mock-planner', 'completed'); await store.setVerification('passed', 'mock-check', 'exit 0'); const state = await store.readStatus();
    report.require(JSON.stringify(state.progress) === JSON.stringify({ completed: 1, total: 1 }), 'Runtime mock transitions pass', 'runtime derived progress is incorrect'); report.require(state.active_agents.length === 0 && state.signals.length === 2, 'Agent lifecycle and signals pass', 'agent lifecycle state is incorrect');
    if (exerciseHttp) { const server = await createPreviewServer(temporary); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); try { const port = server.address().port, html = await (await fetch(`http://127.0.0.1:${port}/`)).text(), payload = await (await fetch(`http://127.0.0.1:${port}/runtime/snapshot`)).json(); report.require(html.includes('Agent Signal Network') && payload.status.current_goal === 'Mock SMALL task' && payload.status.task_counts.total === payload.tasks.tasks.length, 'Dashboard serves a consistent runtime snapshot', 'dashboard snapshot smoke test failed'); } finally { await new Promise(resolve => server.close(resolve)); } }
  }
  return report;
}

export async function main() { const report = await checkRepository(findRoot()); for (const item of report.checks) console.log(`PASS ${item}`); for (const item of report.warnings) console.log(`WARN ${item}`); for (const item of report.failures) console.log(`FAIL ${item}`); return report.ok ? 0 : 1; }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
