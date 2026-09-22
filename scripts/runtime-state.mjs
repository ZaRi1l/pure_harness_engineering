#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const TASK_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed', 'cancelled']);
export const VERIFICATION_STATUSES = new Set(['not_run', 'running', 'passed', 'failed', 'blocked']);
const now = () => new Date().toISOString();
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  const deadline = Date.now() + 1000;
  while (true) {
    try { await rename(temporary, file); break; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || Date.now() >= deadline) { await rm(temporary, { force: true }); throw error; }
      await wait(10);
    }
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export class RuntimeStore {
  constructor(root, { eventLimit = 100, lockTimeoutMs = 5000 } = {}) {
    this.root = path.resolve(root); this.runtime = path.join(this.root, '.ai', 'runtime');
    this.statusPath = path.join(this.runtime, 'status.json'); this.tasksPath = path.join(this.runtime, 'tasks.json');
    this.eventsPath = path.join(this.runtime, 'events.jsonl'); this.lockPath = path.join(this.runtime, '.state.lock');
    this.eventLimit = Math.max(1, eventLimit); this.lockTimeoutMs = lockTimeoutMs;
  }
  emptyStatus() { return { schema_version: 1, current_goal: null, phase: 'idle', active_agents: [], agents: [], signals: [], task_counts: { total: 0, completed: 0 }, progress: null, completed_tasks: [], next_tasks: [], verification: { status: 'not_run', checks: [], last_run: null }, blockers: [], recent_events: [], artifact_preview_links: [], last_update: now() }; }
  assertSafeLockPath() { const resolved = path.resolve(this.lockPath); if (path.dirname(resolved) !== path.resolve(this.runtime)) throw new Error('unsafe lock path'); return resolved; }
  async removeOwnedLock(token) { try { const owner = JSON.parse(await readFile(path.join(this.lockPath, 'owner.json'), 'utf8')); if (owner.token !== token) return; } catch { return; } await rm(this.assertSafeLockPath(), { recursive: true, force: true }); }
  async recoverStaleLock() {
    let owner;
    try { owner = JSON.parse(await readFile(path.join(this.lockPath, 'owner.json'), 'utf8')); }
    catch { try { if (Date.now() - (await stat(this.lockPath)).mtimeMs < 1000) return false; } catch { return true; } }
    if (owner && processAlive(owner.pid)) return false;
    const lock = this.assertSafeLockPath(), quarantine = `${lock}.stale.${process.pid}.${crypto.randomUUID()}`;
    try { await rename(lock, quarantine); }
    catch (error) { if (['ENOENT', 'EPERM', 'EBUSY', 'EACCES'].includes(error.code)) return false; throw error; }
    await rm(quarantine, { recursive: true, force: true }); return true;
  }
  async withLock(operation) {
    await mkdir(this.runtime, { recursive: true }); const deadline = Date.now() + this.lockTimeoutMs; const token = crypto.randomUUID();
    while (true) {
      try { await mkdir(this.lockPath); await writeFile(path.join(this.lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, token, created_at: now() })); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; if (await this.recoverStaleLock()) continue; if (Date.now() >= deadline) throw new Error('runtime state lock timed out'); await wait(20); }
    }
    try { return await operation(); } finally { await this.removeOwnedLock(token); }
  }
  async initialize({ force = false } = {}) {
    await this.withLock(async () => {
      let status = this.emptyStatus();
      if (!force && existsSync(this.statusPath)) { status = JSON.parse(await readFile(this.statusPath, 'utf8')); for (const [key, value] of Object.entries(this.emptyStatus())) if (!(key in status)) status[key] = key === 'agents' ? [...(status.active_agents || [])] : value; status.last_update = now(); }
      await atomicWrite(this.statusPath, `${JSON.stringify(status, null, 2)}\n`);
      if (force || !existsSync(this.tasksPath)) await atomicWrite(this.tasksPath, `${JSON.stringify({ schema_version: 1, tasks: [] }, null, 2)}\n`);
      if (force || !existsSync(this.eventsPath)) await atomicWrite(this.eventsPath, '');
    });
  }
  async readStatus() { if (!existsSync(this.statusPath)) await this.initialize(); return JSON.parse(await readFile(this.statusPath, 'utf8')); }
  async readTasks() { if (!existsSync(this.tasksPath)) await this.initialize(); return JSON.parse(await readFile(this.tasksPath, 'utf8')); }
  async readEvents() { if (!existsSync(this.eventsPath)) await this.initialize(); return (await readFile(this.eventsPath, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  async readSnapshot() {
    if (!existsSync(this.statusPath) || !existsSync(this.tasksPath) || !existsSync(this.eventsPath)) await this.initialize();
    return this.withLock(async () => this.loadUnlocked());
  }
  async loadUnlocked() {
    const status = existsSync(this.statusPath) ? JSON.parse(await readFile(this.statusPath, 'utf8')) : this.emptyStatus(); status.agents ??= [...(status.active_agents || [])]; status.signals ??= [];
    const tasks = existsSync(this.tasksPath) ? JSON.parse(await readFile(this.tasksPath, 'utf8')) : { schema_version: 1, tasks: [] };
    const events = existsSync(this.eventsPath) ? (await readFile(this.eventsPath, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
    return { status, tasks, events };
  }
  event(type, message, data = {}) { const clean = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null && value !== '' && value !== undefined)); return { time: now(), type, message: String(message).slice(0, 500), ...(Object.keys(clean).length ? { data: clean } : {}) }; }
  async persist(status, tasks, events) {
    status.last_update = now(); status.recent_events = events.slice(-10); const completed = tasks.tasks.filter(task => task.status === 'completed');
    status.task_counts = { total: tasks.tasks.length, completed: completed.length }; status.progress = tasks.tasks.length ? { completed: completed.length, total: tasks.tasks.length } : null; status.completed_tasks = completed; status.next_tasks = tasks.tasks.filter(task => ['pending', 'blocked'].includes(task.status));
    await atomicWrite(this.tasksPath, `${JSON.stringify(tasks, null, 2)}\n`); await atomicWrite(this.statusPath, `${JSON.stringify(status, null, 2)}\n`); await atomicWrite(this.eventsPath, events.slice(-this.eventLimit).map(item => JSON.stringify(item)).join('\n') + (events.length ? '\n' : ''));
  }
  async mutate(update) { await this.withLock(async () => { const state = await this.loadUnlocked(); await update(state); await this.persist(state.status, state.tasks, state.events); }); }
  async setGoal(goal, phase = 'planning') { await this.mutate(({ status, events }) => { status.current_goal = String(goal).slice(0, 500); status.phase = phase; events.push(this.event('goal', 'Goal updated', { phase })); }); }
  async setPhase(phase) { await this.mutate(({ status, events }) => { status.phase = phase; events.push(this.event('phase', `Phase: ${phase}`)); }); }
  async upsertTask(id, title, taskStatus, owner = null) { if (!TASK_STATUSES.has(taskStatus)) throw new Error(`invalid task status: ${taskStatus}`); await this.mutate(({ tasks, events }) => { let record = tasks.tasks.find(task => task.id === id); if (!record) { record = { id, created_at: now() }; tasks.tasks.push(record); } Object.assign(record, { title: String(title).slice(0, 300), status: taskStatus, owner, updated_at: now() }); events.push(this.event('task', `${id}: ${taskStatus}`, { owner })); }); }
  async agentStarted(id, role, task = '') { await this.mutate(({ status, events }) => { const agent = { id, role, status: 'running', current_task: String(task).slice(0, 300), started_at: now(), stopped_at: null }; status.active_agents = status.active_agents.filter(item => item.id !== id).concat(agent); status.agents = status.agents.filter(item => item.id !== id).concat({ ...agent }).slice(-30); status.signals = status.signals.concat({ time: now(), from: 'main', to: id, kind: 'delegate', summary: agent.current_task || `Start ${role}` }).slice(-50); events.push(this.event('agent_started', `${role} started`, { agent_id: id })); }); }
  async agentStopped(id, outcome = 'stopped') { await this.mutate(({ status, events }) => { const active = status.active_agents.find(agent => agent.id === id); status.active_agents = status.active_agents.filter(agent => agent.id !== id); for (const agent of status.agents) if (agent.id === id) Object.assign(agent, { status: outcome, stopped_at: now() }); status.signals = status.signals.concat({ time: now(), from: id, to: 'main', kind: 'result', summary: String(outcome).slice(0, 300) }).slice(-50); events.push(this.event('agent_stopped', `${active?.role || 'agent'} ${outcome}`, { agent_id: id })); }); }
  async addSignal(from, to, kind, summary) { await this.mutate(({ status, events }) => { status.signals = status.signals.concat({ time: now(), from, to, kind: String(kind).slice(0, 80), summary: String(summary).slice(0, 300) }).slice(-50); events.push(this.event('agent_signal', `${from} -> ${to}: ${kind}`)); }); }
  async setVerification(checkStatus, name, detail = '') { if (!VERIFICATION_STATUSES.has(checkStatus)) throw new Error(`invalid verification status: ${checkStatus}`); await this.mutate(({ status, events }) => { const checks = status.verification.checks.filter(check => check.name !== name).concat({ name, status: checkStatus, detail: String(detail).slice(0, 500), time: now() }); const values = new Set(checks.map(check => check.status)); const aggregate = ['failed', 'blocked', 'running'].find(value => values.has(value)) || (checks.length && values.size === 1 && values.has('passed') ? 'passed' : 'not_run'); status.verification = { status: aggregate, checks, last_run: now() }; events.push(this.event('verification', `${name}: ${checkStatus}`)); }); }
  async addBlocker(id, message) { await this.mutate(({ status, events }) => { status.blockers = status.blockers.filter(item => item.id !== id).concat({ id, message: String(message).slice(0, 500), time: now() }); events.push(this.event('blocker', message, { blocker_id: id })); }); }
  async clearBlocker(id) { await this.mutate(({ status, events }) => { status.blockers = status.blockers.filter(item => item.id !== id); events.push(this.event('blocker_cleared', `Cleared blocker ${id}`)); }); }
  async addArtifact(label, href) { await this.mutate(({ status, events }) => { status.artifact_preview_links = status.artifact_preview_links.filter(item => item.href !== href).concat({ label: String(label).slice(0, 200), href }); events.push(this.event('artifact', `Preview registered: ${label}`)); }); }
  async addEvent(type, message) { await this.mutate(({ events }) => events.push(this.event(type, message))); }
}

export function findRoot(start = process.cwd()) { let current = path.resolve(start), instructionRoot = null; while (true) { if (existsSync(path.join(current, '.git'))) return current; if (!instructionRoot && existsSync(path.join(current, 'AGENTS.md'))) instructionRoot = current; const parent = path.dirname(current); if (parent === current) break; current = parent; } return instructionRoot || path.resolve(start); }
function option(args, name, fallback = null) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }
export async function runCli(argv = process.argv.slice(2)) {
  const copy = [...argv], rootIndex = copy.indexOf('--root'), root = rootIndex >= 0 ? copy.splice(rootIndex, 2)[1] : findRoot(); const store = new RuntimeStore(root); const [command, ...args] = copy;
  const actions = { init: () => store.initialize({ force: args.includes('--force') }), goal: () => store.setGoal(args[0], option(args, '--phase', 'planning')), phase: () => store.setPhase(args[0]), task: () => store.upsertTask(args[0], args[1], args[2], option(args, '--owner')), 'agent-start': () => store.agentStarted(args[0], args[1], option(args, '--task', '')), 'agent-stop': () => store.agentStopped(args[0], option(args, '--outcome', 'stopped')), verify: () => store.setVerification(args[0], args[1], option(args, '--detail', '')), blocker: () => store.addBlocker(args[0], args[1]), 'clear-blocker': () => store.clearBlocker(args[0]), artifact: () => store.addArtifact(args[0], args[1]), event: () => store.addEvent(args[0], args[1]), signal: () => store.addSignal(args[0], args[1], args[2], args[3]) };
  if (!actions[command]) throw new Error(`unknown command: ${command || '(missing)'}`); await actions[command]();
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli().catch(error => { console.error(error.message); process.exitCode = 1; });
