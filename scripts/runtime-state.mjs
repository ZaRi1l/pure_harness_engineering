#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isValidatedProjectContext, loadProjectContext } from './project-context.mjs';
import { TASK_STATUSES, safeTask, taskRevision, validateTaskFields } from './task-records.mjs';
import { normalizeChildLink, normalizeTelemetry } from './telemetry-schema.mjs';

export { TASK_STATUSES } from './task-records.mjs';
export const VERIFICATION_STATUSES = new Set(['not_run', 'running', 'passed', 'failed', 'blocked']);
const SIGNAL_METADATA_FIELDS = ['task_id', 'status', 'artifact_href', 'verification_name'];
const LIFECYCLE_SOURCES = new Set(['hook', 'orchestration']);
const coreContexts = new WeakSet();
export const isCoreContext = value => value !== null && typeof value === 'object' && coreContexts.has(value);
function signalMetadata(value = {}) {
  return Object.fromEntries(SIGNAL_METADATA_FIELDS
    .filter(key => value[key] !== undefined && value[key] !== null && value[key] !== '')
    .map(key => [key, String(value[key]).slice(0, 500)]));
}
function appendSignal(status, signal) {
  const stored = { ...signal, id: randomUUID() };
  status.signals = status.signals.concat(stored).slice(-50);
  return stored;
}
function lifecycleSource(value) { return LIFECYCLE_SOURCES.has(value) ? value : undefined; }
function preferredLifecycleSource(current, next) { return current === 'hook' || next !== 'hook' ? current || next : 'hook'; }
const now = () => new Date().toISOString();
const assertUniqueTaskIds = tasks => {
  const ids = new Set();
  for (const task of tasks.tasks) {
    if (typeof task.id !== 'string' || !task.id) throw new Error('invalid task id');
    if (ids.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    ids.add(task.id);
  }
};
const uniqueTaskToken = (tasks, field) => {
  const used = new Set(tasks.tasks.map(task => task[field]));
  let token;
  do { token = randomUUID(); } while (used.has(token));
  return token;
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const normalizeScope = scope => {
  const value = String(scope || '').split('\\').join('/').split('/').filter(Boolean).join('/');
  if (!value || value === '.' || value.split('/').some(segment => segment === '..' || segment === '.') || String(scope).includes(':') || path.isAbsolute(String(scope)) || path.win32.isAbsolute(String(scope))) throw new Error('invalid claim scope');
  return value;
};
const scopesOverlap = (left, right) => left === right || left.startsWith(right + '/') || right.startsWith(left + '/');
const checkoutKey = value => process.platform === 'win32' ? String(value).toLowerCase() : String(value);
const assertSchema = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema_version !== 1) throw new Error(`${name} runtime schema unsupported`);
  return value;
};

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
  static coreContext({ engineRoot, runtimeRoot }) {
    if (!path.isAbsolute(engineRoot) || !path.isAbsolute(runtimeRoot)) throw new Error('core context requires absolute roots');
    const relative = path.relative(path.resolve(engineRoot), path.resolve(runtimeRoot));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('core runtime outside engine root');
    const context = Object.freeze({ kind: 'core', projectId: 'core', checkoutRoot: path.resolve(engineRoot), harnessRoot: path.resolve(engineRoot), paths: Object.freeze({ runtime: path.resolve(runtimeRoot) }) });
    coreContexts.add(context);
    return context;
  }
  static legacyFixture(root, options = {}) { return new RuntimeStore(root, { ...options, legacyFixture: true }); }
  constructor(context, { eventLimit = 100, lockTimeoutMs = 5000, runtimeDir, legacyFixture = false } = {}) {
    if (legacyFixture && typeof context === 'string') {
      this.context = null; this.root = path.resolve(context); this.runtime = runtimeDir ? path.resolve(runtimeDir) : path.join(this.root, '.ai', 'runtime');
    } else if (isValidatedProjectContext(context) || isCoreContext(context)) {
      if (runtimeDir) throw new Error('runtime override forbidden for context');
      this.context = context; this.root = context.checkoutRoot; this.runtime = context.paths.runtime;
    } else throw new Error('validated project or explicit core context required');
    this.statusPath = path.join(this.runtime, 'status.json'); this.tasksPath = path.join(this.runtime, 'tasks.json');
    this.eventsPath = path.join(this.runtime, 'events.jsonl'); this.claimsPath = path.join(this.runtime, 'claims.json'); this.lockPath = path.join(this.runtime, '.state.lock');
    this.telemetryPath = path.join(this.runtime, 'telemetry.json'); this.agentLinksPath = path.join(this.runtime, 'agent-links.json');
    this.eventLimit = Math.max(1, eventLimit); this.lockTimeoutMs = lockTimeoutMs;
  }
  assertDocument(value, name) {
    assertSchema(value, name);
    if (this.context && value.project_id !== this.context.projectId) throw new Error(`${name} project identity mismatch`);
    return value;
  }
  parseEvents(source) {
    return source.split(/\r?\n/).filter(Boolean).map(line => {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('invalid runtime event');
      if (this.context && event.project_id !== this.context.projectId) throw new Error('event project identity mismatch');
      return event;
    });
  }
  emptyDocument(name) { return { schema_version: 1, ...(this.context ? { project_id: this.context.projectId } : {}), [name]: [] }; }
  ownsClaim(claim, agentId) { return claim.agent_id === String(agentId) && (!this.context || checkoutKey(claim.checkout_root) === checkoutKey(this.context.checkoutRoot)); }
  sharesCheckout(claim) { return !this.context || checkoutKey(claim.checkout_root) === checkoutKey(this.context.checkoutRoot); }
  async assertRuntimePath() {
    if (!this.context) return;
    const owner = this.context.harnessRoot, relative = path.relative(owner, this.runtime);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('runtime path escapes context root');
    let current = owner;
    for (const [index, segment] of ['', ...relative.split(path.sep)].entries()) {
      current = segment ? path.join(current, segment) : current;
      let metadata;
      try { metadata = await lstat(current); }
      catch (error) { if (error.code === 'ENOENT') { if (index === 0) throw new Error('runtime path root unavailable'); return; } throw error; }
      if (metadata.isSymbolicLink()) throw new Error('runtime path traverses symlink');
      if (!metadata.isDirectory()) throw new Error('runtime path is not a directory');
      if (checkoutKey(await realpath(current)) !== checkoutKey(current)) throw new Error('runtime path escapes context root');
    }
  }
  async assertClaimPath(entry) {
    if (!this.context) return;
    const owner = entry.kind === 'installation' ? this.context.harnessRoot : this.context.checkoutRoot;
    let current = owner;
    for (const segment of entry.scope.split('/')) {
      current = path.join(current, segment);
      let metadata;
      try { metadata = await lstat(current); }
      catch (error) { if (error.code === 'ENOENT') break; throw error; }
      if (metadata.isSymbolicLink()) throw new Error('claim scope traverses symlink');
      const canonical = await realpath(current);
      const relative = path.relative(owner, canonical);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('claim scope escapes context root');
    }
  }
  ownsAgent(agent, agentId) { return agent.id === agentId && (!this.context || checkoutKey(agent.checkout_root) === checkoutKey(this.context.checkoutRoot)); }
  checkoutMetadata() { return this.context ? { checkout_root: this.context.checkoutRoot } : {}; }
  ownsLifecycleEvent(event, agentId) { return event.data?.agent_id === agentId && (!this.context || checkoutKey(event.data?.checkout_root) === checkoutKey(this.context.checkoutRoot)); }
  emptyStatus() { return { schema_version: 1, ...(this.context ? { project_id: this.context.projectId } : {}), current_goal: null, phase: 'idle', active_agents: [], agents: [], signals: [], task_counts: { total: 0, completed: 0 }, progress: null, completed_tasks: [], next_tasks: [], verification: { status: 'not_run', checks: [], last_run: null }, blockers: [], warnings: [], recent_events: [], artifact_preview_links: [], last_update: now() }; }
  assertSafeLockPath() { const resolved = path.resolve(this.lockPath); if (path.dirname(resolved) !== path.resolve(this.runtime)) throw new Error('unsafe lock path'); return resolved; }
  async removeOwnedLock(token) { await this.assertRuntimePath(); try { const owner = JSON.parse(await readFile(path.join(this.lockPath, 'owner.json'), 'utf8')); if (owner.token !== token) return; } catch { return; } await rm(this.assertSafeLockPath(), { recursive: true, force: true }); }
  async recoverStaleLock() {
    await this.assertRuntimePath();
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
    await this.assertRuntimePath(); await mkdir(this.runtime, { recursive: true }); await this.assertRuntimePath(); const deadline = Date.now() + this.lockTimeoutMs; const token = crypto.randomUUID();
    while (true) {
      await this.assertRuntimePath();
      try { await mkdir(this.lockPath); await writeFile(path.join(this.lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, token, created_at: now() })); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; if (await this.recoverStaleLock()) continue; if (Date.now() >= deadline) throw new Error('runtime state lock timed out'); await wait(20); }
    }
    try { return await operation(); } finally { await this.removeOwnedLock(token); }
  }
  async initialize({ force = false } = {}) {
    if (force && this.context) throw new Error('force init forbidden for project or core context');
    await this.withLock(async () => {
      if (!force) await this.loadUnlocked();
      let status = this.emptyStatus();
      if (!force && existsSync(this.statusPath)) { status = this.assertDocument(JSON.parse(await readFile(this.statusPath, 'utf8')), 'status'); for (const [key, value] of Object.entries(this.emptyStatus())) if (!(key in status)) status[key] = key === 'agents' ? [...(status.active_agents || [])] : value; status.last_update = now(); }
      if (!force && existsSync(this.tasksPath)) this.assertDocument(JSON.parse(await readFile(this.tasksPath, 'utf8')), 'tasks');
      if (!force && existsSync(this.claimsPath)) this.assertDocument(JSON.parse(await readFile(this.claimsPath, 'utf8')), 'claims');
      await atomicWrite(this.statusPath, `${JSON.stringify(status, null, 2)}\n`);
      if (force || !existsSync(this.tasksPath)) await atomicWrite(this.tasksPath, `${JSON.stringify(this.emptyDocument('tasks'), null, 2)}\n`);
      if (force || !existsSync(this.eventsPath)) await atomicWrite(this.eventsPath, '');
      if (force || !existsSync(this.claimsPath)) await atomicWrite(this.claimsPath, JSON.stringify(this.emptyDocument('claims'), null, 2) + '\n');
    });
  }
  async readStatus() { await this.assertRuntimePath(); if (!existsSync(this.statusPath)) await this.initialize(); return this.assertDocument(JSON.parse(await readFile(this.statusPath, 'utf8')), 'status'); }
  async readTasks() { await this.assertRuntimePath(); if (!existsSync(this.tasksPath)) await this.initialize(); return this.assertDocument(JSON.parse(await readFile(this.tasksPath, 'utf8')), 'tasks'); }
  async readEvents() { await this.assertRuntimePath(); if (!existsSync(this.eventsPath)) await this.initialize(); return this.parseEvents(await readFile(this.eventsPath, 'utf8')); }
  async readClaims() { await this.assertRuntimePath(); if (!existsSync(this.claimsPath)) await this.initialize(); return this.assertDocument(JSON.parse(await readFile(this.claimsPath, 'utf8')), 'claims'); }
  telemetryProjectId() { if (!this.context) throw new Error('validated project or core context required'); return this.context.projectId; }
  async readTelemetry() {
    const projectId = this.telemetryProjectId();
    await this.assertRuntimePath();
    if (!existsSync(this.telemetryPath)) return { schema_version: 1, project_id: projectId, status: 'missing' };
    return normalizeTelemetry(this.assertDocument(JSON.parse(await readFile(this.telemetryPath, 'utf8')), 'telemetry'), projectId);
  }
  async replaceTelemetry(value) {
    const document = normalizeTelemetry(value, this.telemetryProjectId());
    await this.withLock(async () => { await atomicWrite(this.telemetryPath, `${JSON.stringify(document, null, 2)}\n`); });
  }
  async readChildLinks() {
    const projectId = this.telemetryProjectId();
    await this.assertRuntimePath();
    if (!existsSync(this.agentLinksPath)) return [];
    const document = this.assertDocument(JSON.parse(await readFile(this.agentLinksPath, 'utf8')), 'agent-links');
    if (!Array.isArray(document.links)) throw new Error('invalid child links');
    return document.links.map(link => normalizeChildLink({ ...link, acknowledgement: 'success' }, projectId));
  }
  async recordChildLink(value) {
    const projectId = this.telemetryProjectId();
    const link = normalizeChildLink(value, projectId);
    await this.withLock(async () => {
      const links = await this.readChildLinks();
      const existing = links.find(item => item.child_agent_id === link.child_agent_id);
      if (existing) {
        if (existing.spawned_at !== link.spawned_at) throw new Error('conflicting child link');
        const merged = { ...existing };
        for (const key of ['task_id', 'root_turn_id', 'parent_agent_id', 'role', 'short_task_name', 'fork_turns', 'model', 'reasoning_effort', 'completed_at']) {
          if (link[key] === null) continue;
          if (existing[key] !== null && existing[key] !== link[key]) throw new Error('conflicting child link');
          merged[key] = link[key];
        }
        links[links.indexOf(existing)] = normalizeChildLink({ ...merged, acknowledgement: 'success' }, projectId);
      } else links.push(link);
      await atomicWrite(this.agentLinksPath, `${JSON.stringify({ schema_version: 1, project_id: projectId, links }, null, 2)}\n`);
    });
  }
  async completeChildLink(childAgentId, completedAt) {
    const projectId = this.telemetryProjectId();
    if (typeof childAgentId !== 'string' || !childAgentId) throw new Error('invalid child agent id');
    await this.withLock(async () => {
      const links = await this.readChildLinks();
      const index = links.findIndex(item => item.child_agent_id === childAgentId);
      if (index < 0) throw new Error('unknown child agent id');
      links[index] = normalizeChildLink({ ...links[index], acknowledgement: 'success', completed_at: completedAt }, projectId);
      await atomicWrite(this.agentLinksPath, `${JSON.stringify({ schema_version: 1, project_id: projectId, links }, null, 2)}\n`);
    });
  }
  async readSnapshot() {
    await this.assertRuntimePath();
    if (!existsSync(this.statusPath) || !existsSync(this.tasksPath) || !existsSync(this.eventsPath) || !existsSync(this.claimsPath)) await this.initialize();
    return this.withLock(async () => ({ ...await this.loadUnlocked(), ...(this.context ? { telemetry: await this.readTelemetry() } : {}) }));
  }
  async loadUnlocked() {
    await this.assertRuntimePath();
    const status = existsSync(this.statusPath) ? this.assertDocument(JSON.parse(await readFile(this.statusPath, 'utf8')), 'status') : this.emptyStatus(); status.agents ??= [...(status.active_agents || [])]; status.signals ??= [];
    const tasks = existsSync(this.tasksPath) ? this.assertDocument(JSON.parse(await readFile(this.tasksPath, 'utf8')), 'tasks') : this.emptyDocument('tasks');
    const events = existsSync(this.eventsPath) ? this.parseEvents(await readFile(this.eventsPath, 'utf8')) : [];
    const claims = existsSync(this.claimsPath) ? this.assertDocument(JSON.parse(await readFile(this.claimsPath, 'utf8')), 'claims') : this.emptyDocument('claims');
    return { status, tasks, events, claims };
  }
  event(type, message, data = {}) { const clean = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null && value !== '' && value !== undefined)); return { time: now(), ...(this.context ? { project_id: this.context.projectId } : {}), type, message: String(message).slice(0, 500), ...(Object.keys(clean).length ? { data: clean } : {}) }; }
  async persist(status, tasks, events, claims) {
    await this.assertRuntimePath();
    status.last_update = now(); status.recent_events = events.slice(-10); const completed = tasks.tasks.filter(task => task.status === 'completed');
    status.task_counts = { total: tasks.tasks.length, completed: completed.length }; status.progress = tasks.tasks.length ? { completed: completed.length, total: tasks.tasks.length } : null; status.completed_tasks = completed; status.next_tasks = tasks.tasks.filter(task => ['pending', 'blocked'].includes(task.status));
    await atomicWrite(this.claimsPath, JSON.stringify(claims || { schema_version: 1, claims: [] }, null, 2) + '\n');
    await atomicWrite(this.tasksPath, `${JSON.stringify(tasks, null, 2)}\n`); await atomicWrite(this.statusPath, `${JSON.stringify(status, null, 2)}\n`); await atomicWrite(this.eventsPath, events.slice(-this.eventLimit).map(item => JSON.stringify(item)).join('\n') + (events.length ? '\n' : ''));
  }
  async mutate(update) { await this.withLock(async () => { const state = await this.loadUnlocked(); await update(state); await this.persist(state.status, state.tasks, state.events, state.claims); }); }
  async setGoal(goal, phase = 'planning') { await this.mutate(({ status, events }) => { status.current_goal = String(goal).slice(0, 500); status.phase = phase; events.push(this.event('goal', 'Goal updated', { phase })); }); }
  async setPhase(phase) { await this.mutate(({ status, events }) => { status.phase = phase; events.push(this.event('phase', `Phase: ${phase}`)); }); }
  async upsertTask(id, title, taskStatus, owner = null) { if (!TASK_STATUSES.has(taskStatus)) throw new Error(`invalid task status: ${taskStatus}`); await this.mutate(({ tasks, events }) => { assertUniqueTaskIds(tasks); let record = tasks.tasks.find(task => task.id === id); if (!record) { record = { id, created_at: now() }; tasks.tasks.push(record); } Object.assign(record, { title: String(title).slice(0, 300), status: taskStatus, owner, updated_at: now(), revision: uniqueTaskToken(tasks, 'revision') }); events.push(this.event('task', `${id}: ${taskStatus}`, { owner })); }); }
  async createTask(fields) {
    if (!this.context) throw new Error('validated project or core context required');
    const editable = validateTaskFields(fields);
    return this.withLock(async () => {
      const state = await this.loadUnlocked();
      assertUniqueTaskIds(state.tasks);
      const timestamp = now();
      const record = { id: uniqueTaskToken(state.tasks, 'id'), ...editable, created_at: timestamp, updated_at: timestamp, revision: uniqueTaskToken(state.tasks, 'revision') };
      state.tasks.tasks.push(record);
      state.events.push(this.event('task', `${record.id}: ${record.status}`, { task_id: record.id, status: record.status }));
      await this.persist(state.status, state.tasks, state.events, state.claims);
      return safeTask(record);
    });
  }
  async updateTask(id, revision, fields) {
    if (!this.context) throw new Error('validated project or core context required');
    if (typeof id !== 'string' || !id || typeof revision !== 'string' || !revision) throw new Error('invalid task identity');
    const editable = validateTaskFields(fields);
    return this.withLock(async () => {
      const state = await this.loadUnlocked();
      assertUniqueTaskIds(state.tasks);
      const record = state.tasks.tasks.find(task => task.id === id);
      if (!record) return { kind: 'missing' };
      if (taskRevision(record) !== revision) return { kind: 'conflict', task: safeTask(record) };
      Object.assign(record, editable, { updated_at: now(), revision: uniqueTaskToken(state.tasks, 'revision') });
      state.events.push(this.event('task', `${record.id}: ${record.status}`, { task_id: record.id, status: record.status }));
      await this.persist(state.status, state.tasks, state.events, state.claims);
      return { kind: 'updated', task: safeTask(record) };
    });
  }
  async agentStarted(id, role, task = '', metadata = {}) { await this.mutate(({ status, events }) => {
    const source = lifecycleSource(metadata.source), active = status.active_agents.find(agent => this.ownsAgent(agent, id));
    let existing = status.agents.find(agent => this.ownsAgent(agent, id));
    if (!existing && active) { existing = { ...active }; status.agents = status.agents.concat(existing).slice(-30); }
    if (existing) {
      if (existing.resumed_at && source === 'hook' && metadata.turn_token !== existing.turn_token) return;
      const startSource = preferredLifecycleSource(existing.start_source, source);
      if (startSource) existing.start_source = startSource;
      if (source === 'hook') {
        existing.role = role;
        if (task) existing.current_task = String(task).slice(0, 300);
        const signal = existing.start_signal_id ? status.signals.find(item => item.id === existing.start_signal_id) : undefined;
        if (signal) { signal.summary = existing.current_task || `Start ${role}`; if (metadata.task_id) signal.task_id = String(metadata.task_id).slice(0, 500); }
        const event = events.findLast(item => item.type === 'agent_started' && this.ownsLifecycleEvent(item, id));
        if (event) { event.message = `${role} started`; event.data = { ...event.data, source: 'hook' }; }
      } else if (!existing.current_task && task) existing.current_task = String(task).slice(0, 300);
      for (const active of status.active_agents) if (this.ownsAgent(active, id)) Object.assign(active, existing);
      return;
    }
    const agent = { id, ...this.checkoutMetadata(), role, status: 'running', current_task: String(task).slice(0, 300), started_at: now(), stopped_at: null, ...(source ? { start_source: source } : {}) };
    const signal = appendSignal(status, { time: now(), from: 'main', to: id, kind: 'delegate', summary: agent.current_task || `Start ${role}`, ...signalMetadata({ task_id: metadata.task_id }) });
    agent.start_signal_id = signal.id;
    status.active_agents = status.active_agents.filter(item => !this.ownsAgent(item, id)).concat(agent);
    status.agents = status.agents.filter(item => !this.ownsAgent(item, id)).concat({ ...agent }).slice(-30);
    events.push(this.event('agent_started', `${role} started`, { agent_id: id, ...this.checkoutMetadata(), source }));
  }); }
  async agentResumed(id, task = '', summary = '', metadata = {}) { if (!String(summary).trim()) throw new Error('resume summary required'); if (!String(metadata.turn_token || '').trim()) throw new Error('resume turn token required'); await this.mutate(({ status, events }) => {
    const agent = status.agents.find(item => this.ownsAgent(item, id));
    if (!agent) throw new Error(`unknown agent: ${id}`);
    if (agent.resume_tokens?.includes(metadata.turn_token)) return;
    if (!agent.stopped_at) throw new Error(`agent already active: ${id}`);
    const startedAt = now(), source = lifecycleSource(metadata.source);
    const signal = appendSignal(status, { time: startedAt, from: 'main', to: id, kind: 'delegate', summary: String(summary).slice(0, 200), ...signalMetadata({ task_id: metadata.task_id }) });
    Object.assign(agent, { status: 'running', current_task: String(task).slice(0, 300), started_at: startedAt, stopped_at: null,
      start_signal_id: signal.id, task_id: metadata.task_id, start_source: source, resumed_at: startedAt,
      turn_token: metadata.turn_token, resume_tokens: [...(agent.resume_tokens || []), metadata.turn_token] });
    delete agent.stop_signal_id; delete agent.stop_source;
    status.active_agents = status.active_agents.filter(item => !this.ownsAgent(item, id)).concat({ ...agent });
    events.push(this.event('agent_started', `${agent.role || 'agent'} resumed`, { agent_id: id, ...this.checkoutMetadata(), source }));
  }); }
  async agentStopped(id, outcome = 'stopped', metadata = {}) { await this.mutate(({ status, events, claims }) => {
    const source = lifecycleSource(metadata.source), active = status.active_agents.find(item => this.ownsAgent(item, id));
    let agent = status.agents.find(item => this.ownsAgent(item, id));
    if (!agent && active) { agent = { ...active }; status.agents = status.agents.concat(agent).slice(-30); }
    if (!agent) return;
    if (agent.resumed_at && source === 'hook' && metadata.turn_token !== agent.turn_token) return;
    if (agent.resumed_at && metadata.turn_token !== agent.turn_token) throw new Error('current turn token required to stop resumed agent');
    if (agent.task_id && metadata.task_id && agent.task_id !== metadata.task_id) return;
    if (agent.stopped_at) {
      const stopSource = preferredLifecycleSource(agent.stop_source, source);
      if (stopSource) agent.stop_source = stopSource;
      if (source === 'hook') {
        agent.status = outcome;
        const signal = agent.stop_signal_id ? status.signals.find(item => item.id === agent.stop_signal_id) : undefined;
        if (signal) {
          signal.summary = String(outcome).slice(0, 300);
          if (outcome === 'stopped') delete signal.status; else signal.status = String(outcome).slice(0, 500);
          if (metadata.task_id) signal.task_id = String(metadata.task_id).slice(0, 500);
        }
        const event = events.findLast(item => item.type === 'agent_stopped' && this.ownsLifecycleEvent(item, id));
        if (event) { event.message = `${agent.role || 'agent'} ${outcome}`; event.data = { ...event.data, source: 'hook' }; }
      }
      return;
    }
    const stoppedAt = now(), stopSource = preferredLifecycleSource(agent.stop_source, source);
    status.active_agents = status.active_agents.filter(item => !this.ownsAgent(item, id));
    Object.assign(agent, { status: outcome, stopped_at: stoppedAt, ...(stopSource ? { stop_source: stopSource } : {}) });
    const signal = appendSignal(status, { time: stoppedAt, from: id, to: 'main', kind: 'result', summary: String(outcome).slice(0, 300), ...signalMetadata({ task_id: metadata.task_id, status: outcome !== 'stopped' ? outcome : undefined }) });
    agent.stop_signal_id = signal.id;
    events.push(this.event('agent_stopped', `${agent.role || 'agent'} ${outcome}`, { agent_id: id, ...this.checkoutMetadata(), source }));
    if (source === 'hook') {
      claims.claims = claims.claims.filter(claim => !this.ownsClaim(claim, id));
      events.push(this.event('claim_released', `${id} released claims`, { agent_id: id, ...this.checkoutMetadata() }));
    }
  }); }
  async addSignal(from, to, kind, summary, metadata = {}) { await this.mutate(({ status, events }) => { appendSignal(status, { time: now(), from, to, kind: String(kind).slice(0, 80), summary: String(summary).slice(0, 300), ...signalMetadata(metadata) }); events.push(this.event('agent_signal', `${from} -> ${to}: ${kind}`)); }); }
  async setVerification(checkStatus, name, detail = '') { if (!VERIFICATION_STATUSES.has(checkStatus)) throw new Error(`invalid verification status: ${checkStatus}`); await this.mutate(({ status, events }) => { const checks = status.verification.checks.filter(check => check.name !== name).concat({ name, status: checkStatus, detail: String(detail).slice(0, 500), time: now() }); const values = new Set(checks.map(check => check.status)); const aggregate = ['failed', 'blocked', 'running'].find(value => values.has(value)) || (checks.length && values.size === 1 && values.has('passed') ? 'passed' : 'not_run'); status.verification = { status: aggregate, checks, last_run: now() }; events.push(this.event('verification', `${name}: ${checkStatus}`)); }); }
  async addBlocker(id, message) { await this.mutate(({ status, events }) => { status.blockers = status.blockers.filter(item => item.id !== id).concat({ id, message: String(message).slice(0, 500), time: now() }); events.push(this.event('blocker', message, { blocker_id: id })); }); }
  async clearBlocker(id) { await this.mutate(({ status, events }) => { status.blockers = status.blockers.filter(item => item.id !== id); events.push(this.event('blocker_cleared', `Cleared blocker ${id}`)); }); }
  async addArtifact(label, href) { await this.mutate(({ status, events }) => { status.artifact_preview_links = status.artifact_preview_links.filter(item => item.href !== href).concat({ label: String(label).slice(0, 200), href }); events.push(this.event('artifact', `Preview registered: ${label}`)); }); }
  async addEvent(type, message, data = {}) { await this.mutate(({ events }) => events.push(this.event(type, message, data))); }
  async setWarnings(warnings) { await this.mutate(({ status, events }) => { status.warnings = warnings.map(warning => ({ id: String(warning.id).slice(0, 120), message: String(warning.message).slice(0, 500), time: now() })); events.push(this.event('watchdog', warnings.length ? String(warnings.length) + ' watchdog warning(s)' : 'Watchdog clear')); }); }
  async claim(agentId, scopes) {
    const entries = (Array.isArray(scopes) ? scopes : [scopes]).map(scope => {
      if (!this.context) return { scope: normalizeScope(scope), kind: 'legacy' };
      const raw = String(scope || '');
      const installation = raw.startsWith('installation:');
      if (installation && this.context.kind === 'core') throw new Error('core claim cannot use installation scope');
      const scoped = installation ? raw.slice('installation:'.length) : raw;
      let relative, managementScope = installation;
      if (path.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
        const checkoutRelative = path.relative(this.context.checkoutRoot, path.resolve(raw));
        const managementRelative = path.relative(this.context.harnessRoot, path.resolve(raw));
        const inside = value => value && value !== '..' && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value);
        if (inside(checkoutRelative)) return { scope: normalizeScope(checkoutRelative), kind: 'checkout' };
        if (this.context.kind !== 'core' && inside(managementRelative)) { relative = managementRelative; managementScope = true; }
        else throw new Error('claim scope outside context root');
      } else relative = scoped;
      const normalized = normalizeScope(relative);
      if (managementScope) {
        if (!normalized.startsWith(`projects/${this.context.projectId}/`)) throw new Error('installation claim outside selected project');
        return { scope: normalized, kind: 'installation' };
      }
      return { scope: normalized, kind: 'checkout' };
    });
    const kinds = new Set(entries.map(entry => entry.kind));
    if (kinds.size !== 1) throw new Error('mixed claim roots');
    for (const entry of entries) await this.assertClaimPath(entry);
    const kind = entries[0]?.kind;
    const normalized = [...new Set(entries.map(entry => entry.scope))];
    if (!normalized.length) throw new Error('claim requires a scope');
    await this.mutate(({ claims, events }) => {
      const others = claims.claims.filter(claim => !this.ownsClaim(claim, agentId));
      for (const scope of normalized) for (const claim of others) for (const existing of claim.scopes) if ((kind === 'installation' || this.sharesCheckout(claim)) && (claim.scope_kind || (this.context ? 'checkout' : 'legacy')) === kind && scopesOverlap(scope, existing)) throw new Error('claim conflict: ' + scope + ' overlaps ' + existing + ' (' + claim.agent_id + ')');
      claims.claims = others.concat({ agent_id: String(agentId), scopes: normalized, claimed_at: now(), ...(this.context ? { project_id: this.context.projectId, checkout_root: this.context.checkoutRoot, scope_kind: kind } : {}) });
      events.push(this.event('claim', String(agentId) + ' claimed ' + normalized.join(', '), { agent_id: agentId }));
    });
  }
  async releaseClaim(agentId) { await this.mutate(({ claims, events }) => { claims.claims = claims.claims.filter(claim => !this.ownsClaim(claim, agentId)); events.push(this.event('claim_released', String(agentId) + ' released claims', { agent_id: agentId })); }); }
}

export function findRoot(start = process.cwd()) { let current = path.resolve(start), instructionRoot = null; while (true) { if (existsSync(path.join(current, '.git'))) return current; if (!instructionRoot && existsSync(path.join(current, 'AGENTS.md'))) instructionRoot = current; const parent = path.dirname(current); if (parent === current) break; current = parent; } return instructionRoot || path.resolve(start); }
function option(args, name, fallback = null) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }
export async function contextFromArgs(argv) {
  const copy = [...argv];
  const take = name => { const index = copy.indexOf(name); return index < 0 ? undefined : copy.splice(index, 2)[1]; };
  const projectId = take('--project'), checkoutRoot = take('--checkout'), bindingPath = take('--binding');
  if (!projectId || !checkoutRoot || !bindingPath) throw new Error('project, checkout, and binding are required');
  return { context: await loadProjectContext({ projectId, checkoutRoot, bindingPath }), args: copy };
}
export async function runCli(argv = process.argv.slice(2), { legacyFixtureRoot } = {}) {
  const copy = [...argv];
  const rootIndex = copy.indexOf('--root');
  const root = rootIndex < 0 ? undefined : copy.splice(rootIndex, 2)[1];
  if (root && (!legacyFixtureRoot || path.resolve(root) !== path.resolve(legacyFixtureRoot))) throw new Error('--root is only available to explicit legacy fixtures');
  const resolved = legacyFixtureRoot ? { context: null, args: copy } : await contextFromArgs(copy);
  const store = legacyFixtureRoot ? RuntimeStore.legacyFixture(legacyFixtureRoot) : new RuntimeStore(resolved.context);
  const [command, ...args] = resolved.args;
  const actions = { init: () => store.initialize({ force: args.includes('--force') }), goal: () => store.setGoal(args[0], option(args, '--phase', 'planning')), phase: () => store.setPhase(args[0]), task: () => store.upsertTask(args[0], args[1], args[2], option(args, '--owner')), 'agent-start': () => store.agentStarted(args[0], args[1], option(args, '--task', ''), { task_id: option(args, '--task-id'), source: option(args, '--source') }), 'agent-resume': () => store.agentResumed(args[0], option(args, '--task', ''), option(args, '--summary', ''), { task_id: option(args, '--task-id'), turn_token: option(args, '--turn-token'), source: option(args, '--source') }), 'agent-stop': () => store.agentStopped(args[0], option(args, '--outcome', 'stopped'), { task_id: option(args, '--task-id'), turn_token: option(args, '--turn-token'), source: option(args, '--source') }), verify: () => store.setVerification(args[0], args[1], option(args, '--detail', '')), blocker: () => store.addBlocker(args[0], args[1]), 'clear-blocker': () => store.clearBlocker(args[0]), artifact: () => store.addArtifact(args[0], args[1]), event: () => store.addEvent(args[0], args[1]), signal: () => store.addSignal(args[0], args[1], args[2], args[3], { task_id: option(args, '--task'), status: option(args, '--status'), artifact_href: option(args, '--artifact'), verification_name: option(args, '--verification') }) };
  actions.claim = () => store.claim(args[0], args.slice(1));
  actions['release-claim'] = () => store.releaseClaim(args[0]);
  if (!actions[command]) throw new Error(`unknown command: ${command || '(missing)'}`); await actions[command]();
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli().catch(error => { console.error(error.message); process.exitCode = 1; });
