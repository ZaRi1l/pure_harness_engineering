import { artifactUrlPolicy, renderArtifactTabs } from '/preview/artifact-tabs.js';
import { createTaskEditor } from '/preview/task-editor.js';
import { createTelemetryPanel } from '/preview/telemetry-panel.js';
import { createGuidePanel } from './guide-panel.js';

const app = document.querySelector('#app');
const preferences = globalThis.PreviewPreferences.create(document);
const t = (key, values) => preferences.t(key, values);
const q = value => String(value ?? '');
const el = (tag, className = '', text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let catalog = { agents: [], skills: [] };
let selectedArtifactHref = '';
let artifactRenderKey = '';
let networkController;
let networkHost;
let renderedLocale = preferences.locale;
let taskEditor;
let telemetryPanel;
let taskPollGeneration = 0;
let snapshotPollGeneration = 0;
let taskFetchError;
const dashboardTabs = ['overview', 'tasks', 'agents', 'telemetry'];
let selectedDashboardTab = 'overview';
let lastDashboardSnapshot;

const fallbackPolicy = (model, reasoning) => /^gpt-6-(sol|luna)$/.test(model || '')
  ? `${model.replace('gpt-6-', 'gpt-5.6-')} · ${q(reasoning || t('common.inherited'))}`
  : '';

function list(host, items, render) {
  const ul = el('ul');
  if (items?.length) items.forEach(item => {
    const li = el('li');
    render(li, item);
    ul.append(li);
  });
  else ul.append(el('li', 'muted', t('common.none')));
  host.append(ul);
}

function localizeShell() {
  document.querySelector('#app-tagline').textContent = t('app.tagline');
  document.querySelector('#sidebar-note').textContent = t('sidebar.note');
  const labels = {
    dashboard: 'nav.dashboard', preview: 'nav.preview', agents: 'nav.agents',
    skills: 'nav.skills', guide: 'nav.guide'
  };
  document.querySelectorAll('[data-view]').forEach(button => { button.textContent = t(labels[button.dataset.view]); });
}

function head(title, detail) {
  const header = el('header');
  header.append(el('div', 'muted', 'Pure Harness'), el('h1', '', title), el('p', 'muted', detail));
  return header;
}

async function dashboard() {
  if (document.querySelector('#goal')) { localizeDashboard(); paint(); return; }
  const dashboardHeader = head(t('dashboard.title'), t('dashboard.detail'));
  dashboardHeader.children[1].id = 'dashboard-title';
  dashboardHeader.children[2].id = 'dashboard-detail';
  app.replaceChildren(dashboardHeader);
  const layout = el('div', 'dashboard-layout');
  const rail = el('nav', 'dashboard-rail');
  rail.id = 'dashboard-tablist';
  rail.setAttribute?.('role', 'tablist');
  rail.setAttribute?.('aria-label', t('nav.dashboard'));
  rail.innerHTML = dashboardTabs.map((name, index) => `<button id="dashboard-tab-${name}" class="dashboard-tab" type="button" role="tab" aria-controls="dashboard-pane-${name}"><small>${String(index + 1).padStart(2, '0')}</small><span data-dashboard-label="dashboard.tabs.${name}">${t(`dashboard.tabs.${name}`)}</span></button>`).join('');
  layout.append(rail);
  app.append(layout);
  for (const name of dashboardTabs) {
    const button = document.querySelector(`#dashboard-tab-${name}`);
    button.onclick = () => selectDashboardTab(name);
    button.onkeydown = event => {
      const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? dashboardTabs.length - 1 : offset ? (dashboardTabs.indexOf(name) + offset + dashboardTabs.length) % dashboardTabs.length : -1;
      if (next < 0) return;
      event.preventDefault();
      selectDashboardTab(dashboardTabs[next]);
      document.querySelector(`#dashboard-tab-${dashboardTabs[next]}`).focus?.();
    };
  }
  const grid = el('div', 'dashboard-content');
  grid.innerHTML = `<section id="dashboard-pane-overview" class="dashboard-pane grid" role="tabpanel" aria-labelledby="dashboard-tab-overview"><section class="card wide"><h2 data-dashboard-label="section.goal">${t('section.goal')}</h2><div id="goal"></div><div id="progress"></div></section><section class="card"><h2 data-dashboard-label="section.phase">${t('section.phase')}</h2><div id="phase"></div></section><section class="card"><h2 data-dashboard-label="section.verification">${t('section.verification')}</h2><div id="verification"></div></section><section class="card wide"><h2 data-dashboard-label="section.activeAgents">${t('section.activeAgents')}</h2><div id="agents"></div></section><section class="card"><h2 data-dashboard-label="section.claims">${t('section.claims')}</h2><div id="claims"></div></section><section class="card"><h2 data-dashboard-label="section.warnings">${t('section.warnings')}</h2><div id="warnings"></div></section><section class="card"><h2 data-dashboard-label="section.blockers">${t('section.blockers')}</h2><div id="blockers"></div></section></section><section id="dashboard-pane-tasks" class="dashboard-pane grid" role="tabpanel" aria-labelledby="dashboard-tab-tasks"><section class="card full"><h2 data-dashboard-label="section.tasks">${t('section.tasks')}</h2><div id="tasks"></div></section><section class="card wide"><h2 data-dashboard-label="section.events">${t('section.events')}</h2><div id="events"></div></section><section class="card"><h2 data-dashboard-label="section.artifacts">${t('section.artifacts')}</h2><div id="artifacts"></div></section></section><section id="dashboard-pane-agents" class="dashboard-pane grid" role="tabpanel" aria-labelledby="dashboard-tab-agents"><section class="card full"><h2 data-dashboard-label="section.network">${t('section.network')}</h2><div id="agent-network"></div></section><section class="card full"><h2 data-dashboard-label="section.signals">${t('section.signals')}</h2><div id="signals"></div></section></section>`;
  const telemetryCard = el('section', 'card full');
  const telemetryHeading = el('h2', '', t('section.telemetry'));
  telemetryHeading.setAttribute?.('data-dashboard-label', 'section.telemetry');
  telemetryCard.append(telemetryHeading);
  const telemetryHost = el('div');
  telemetryHost.id = 'telemetry';
  telemetryCard.append(telemetryHost);
  const telemetryPane = el('section', 'dashboard-pane grid');
  telemetryPane.id = 'dashboard-pane-telemetry';
  telemetryPane.setAttribute?.('role', 'tabpanel');
  telemetryPane.setAttribute?.('aria-labelledby', 'dashboard-tab-telemetry');
  telemetryPane.append(telemetryCard);
  grid.append(telemetryPane);
  layout.append(grid);
  selectDashboardTab(selectedDashboardTab);
  taskEditor = createTaskEditor(document.querySelector('#tasks'), { fetchImpl: fetch, translate: t });
  telemetryPanel = createTelemetryPanel(telemetryHost, { fetchImpl: fetch, translate: t });
  taskFetchError = undefined;
  paint();
}

function selectDashboardTab(name) {
  selectedDashboardTab = name;
  for (const tabName of dashboardTabs) {
    const pane = document.querySelector(`#dashboard-pane-${tabName}`);
    const tab = document.querySelector(`#dashboard-tab-${tabName}`);
    if (pane) pane.hidden = tabName !== name;
    if (tab) {
      tab.setAttribute?.('aria-selected', String(tabName === name));
      tab.setAttribute?.('tabindex', tabName === name ? '0' : '-1');
      tab.classList.toggle('active', tabName === name);
    }
  }
  if (name === 'agents' && lastDashboardSnapshot && networkController) networkController.update(lastDashboardSnapshot, catalog);
}

function localizeDashboard() {
  const title = document.querySelector('#dashboard-title');
  const detail = document.querySelector('#dashboard-detail');
  document.querySelector('#dashboard-tablist')?.setAttribute?.('aria-label', t('nav.dashboard'));
  if (title) title.textContent = t('dashboard.title');
  if (detail) detail.textContent = t('dashboard.detail');
  document.querySelectorAll('[data-dashboard-label]').forEach(node => { node.textContent = t(node.getAttribute('data-dashboard-label')); });
}

function localizeErrors() {
  for (const [selector, key] of [
    ['#tasks [data-dashboard-error="tasks"]', 'task.fetchFailed'],
    ['#dashboard-error', 'dashboard.unavailable'],
    ['#preview-error', 'preview.unavailable']
  ]) {
    const message = document.querySelector(selector);
    if (message) message.textContent = t(key);
  }
}

function elapsed(at, observedAt) {
  const parsed = Date.parse(at || '');
  if (!Number.isFinite(parsed)) return t('common.unknown');
  if (parsed > observedAt) return t('dashboard.futureStart');
  return `${Math.floor((observedAt - parsed) / 60000)}m`;
}

function startedWithinPastHour(agent, observedAt) {
  const started = Date.parse(agent.started_at || '');
  return Number.isFinite(started) && started <= observedAt && observedAt - started <= 3600000;
}

function updateNetwork(snapshot) {
  const host = document.querySelector('#agent-network');
  if (!host) return;
  if (host !== networkHost) {
    const initialState = networkController?.getState?.();
    networkController?.destroy?.();
    networkHost = host;
    networkController = AgentSignalNetwork.create(host, { translate: t, initialState });
  }
  networkController.update(snapshot, catalog);
}

async function paintTasks() {
  const requestGeneration = ++taskPollGeneration;
  try {
    const taskDocument = await fetch('/runtime/tasks', { cache: 'no-store' }).then(response => {
      if (response.ok === false) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    if (requestGeneration !== taskPollGeneration || !document.querySelector('#tasks')) return;
    taskEditor.update(taskDocument.tasks, taskDocument.write_token ?? null);
    taskFetchError?.remove?.();
    taskFetchError = undefined;
  } catch {
    if (requestGeneration !== taskPollGeneration || !document.querySelector('#tasks')) return;
    if (!taskFetchError) { taskFetchError = el('p', 'bad'); taskFetchError.setAttribute?.('data-dashboard-error', 'tasks'); document.querySelector('#tasks').append(taskFetchError); }
    taskFetchError.textContent = t('task.fetchFailed');
  }
}

async function paint() {
  if (!document.querySelector('#goal')) return;
  paintTasks();
  telemetryPanel?.refresh();
  const requestGeneration = ++snapshotPollGeneration;
  try {
    const snapshot = await fetch('/runtime/snapshot', { cache: 'no-store' }).then(response => response.json());
    if (requestGeneration !== snapshotPollGeneration || !document.querySelector('#goal')) return;
    lastDashboardSnapshot = snapshot;
    const status = snapshot.status;
    const fill = (selector, items, render) => {
      const host = document.querySelector(selector);
      host.replaceChildren();
      list(host, items, render);
    };
    document.querySelector('#goal').textContent = status.current_goal || t('dashboard.noGoal');
    document.querySelector('#phase').textContent = status.phase || 'idle';
    const progress = document.querySelector('#progress');
    progress.replaceChildren();
    if (status.progress) {
      const bar = el('progress');
      bar.max = status.progress.total;
      bar.value = status.progress.completed;
      progress.append(bar);
    }
    const reportedAgents = status.active_agents || [];
    const observedAt = Date.now();
    fill('#agents', reportedAgents, (li, agent) => {
      li.textContent = `${q(agent.role)} — ${q(agent.current_task || t('dashboard.noTask'))} (${elapsed(agent.started_at, observedAt)}) — ${t('dashboard.reportedRunning')} · ${t(startedWithinPastHour(agent, observedAt) ? 'dashboard.startedRecent' : 'dashboard.startedOutside')}`;
    });
    const recentCount = reportedAgents.filter(agent => startedWithinPastHour(agent, observedAt)).length;
    document.querySelector('#agents').append(el('p', 'muted', t('dashboard.agentCount', { reported: reportedAgents.length, recent: recentCount, outside: reportedAgents.length - recentCount })));
    fill('#claims', snapshot.claims.claims, (li, claim) => { li.textContent = `${q(claim.agent_id)} — ${claim.scopes.join(', ')}`; });
    fill('#warnings', status.warnings, (li, warning) => { li.className = 'bad'; li.textContent = q(warning.message); });
    fill('#blockers', status.blockers, (li, blocker) => { li.textContent = q(blocker.message); });
    fill('#signals', status.signals?.slice(-10).reverse(), (li, signal) => { li.textContent = `${signal.time ? `${q(signal.time)} — ` : ''}${q(signal.from)} → ${q(signal.to)} — ${q(signal.kind)} — ${q(signal.summary)}`; });
    fill('#events', snapshot.events?.slice(-10).reverse(), (li, event) => { li.textContent = `${q(event.time)} — ${q(event.message)}`; });
    fill('#artifacts', status.artifact_preview_links, (li, artifact) => {
      const href = q(artifact.href);
      const policy = artifactUrlPolicy(href, location.origin);
      if (!policy.openable) { li.append(el('span', 'muted', t('artifacts.urlHidden'))); return; }
      const link = el('a', '', q(artifact.label));
      link.href = href;
      li.append(link);
    });
    const verification = document.querySelector('#verification');
    verification.textContent = q(status.verification?.status || 'not_run');
    verification.className = status.verification?.status === 'passed' ? 'ok' : 'bad';
    updateNetwork(snapshot);
    document.querySelector('#dashboard-error')?.remove();
  } catch {
    if (requestGeneration !== snapshotPollGeneration || !document.querySelector('#goal')) return;
    let message = document.querySelector('#dashboard-error');
    if (!message) { message = el('p', 'bad'); message.id = 'dashboard-error'; app.append(message); }
    message.textContent = t('dashboard.unavailable');
  }
}

function catalogView(type) {
  const records = catalog[type];
  const title = t(type === 'agents' ? 'catalog.agentTitle' : 'catalog.skillTitle');
  app.replaceChildren(head(title, t('catalog.detail')));
  const wrap = el('section', 'catalog'), menu = el('div'), detail = el('article', 'detail');
  let chosen = records[0];
  function draw() {
    menu.replaceChildren();
    records.forEach(record => {
      const button = el('button', record === chosen ? 'active' : '', record.id);
      button.onclick = () => { chosen = record; draw(); };
      menu.append(button);
    });
    detail.replaceChildren();
    if (!chosen) { detail.textContent = t('catalog.empty'); return; }
    detail.append(el('h2', '', chosen.id), el('p', '', chosen.description || t('catalog.noDescription')), el('p', 'muted', t('catalog.path', { path: chosen.path })));
    if (type === 'agents') {
      detail.append(el('p', 'muted', t('catalog.preferred', { model: q(chosen.model || t('common.inherited')), reasoning: q(chosen.reasoning || t('common.inherited')) })));
      const fallback = fallbackPolicy(chosen.model, chosen.reasoning);
      if (fallback) detail.append(el('p', 'muted', t('catalog.fallback', { value: fallback })));
    }
    detail.append(el('h2', '', t('catalog.currentFile')), el('pre', '', chosen.source || t('catalog.sourceUnavailable')));
  }
  draw();
  wrap.append(menu, detail);
  app.append(wrap);
}

async function paintPreview() {
  const specsHost = document.querySelector('#task-specs'), artifactsHost = document.querySelector('#preview-artifacts');
  if (!specsHost || !artifactsHost) return;
  try {
    const [specs, snapshot] = await Promise.all([
      fetch('/runtime/task-specs', { cache: 'no-store' }).then(response => response.json()),
      fetch('/runtime/snapshot', { cache: 'no-store' }).then(response => response.json())
    ]);
    specsHost.replaceChildren();
    list(specsHost, specs.taskSpecs, (li, spec) => {
      const details = el('details'), summary = el('summary', '', `${q(spec.title)} — ${q(spec.path)}`), source = el('pre', '', q(spec.content));
      details.append(summary, source);
      li.append(details);
    });
    const artifacts = snapshot.status.artifact_preview_links || [];
    const nextArtifactKey = JSON.stringify([preferences.locale, artifacts.map(artifact => [artifact.label, artifact.href])]);
    if (artifactRenderKey !== nextArtifactKey || !artifactsHost.hasChildNodes()) {
      const rendered = renderArtifactTabs(artifactsHost, artifacts, { selectedHref: selectedArtifactHref, translate: t, onSelect: href => { selectedArtifactHref = href; } });
      selectedArtifactHref = rendered.selectedHref;
      artifactRenderKey = nextArtifactKey;
    }
    document.querySelector('#preview-error')?.remove();
  } catch {
    let message = document.querySelector('#preview-error');
    if (!message) { message = el('p', 'bad'); message.id = 'preview-error'; app.append(message); }
    message.textContent = t('preview.unavailable');
  }
}

function preview() {
  const grid = el('section', 'grid');
  grid.innerHTML = `<section class="card full"><h2>${t('preview.planSpecs')}</h2><div id="task-specs"></div></section><section class="card full"><h2>${t('preview.uiArtifacts')}</h2><div id="preview-artifacts"></div></section>`;
  app.replaceChildren(head(t('preview.title'), t('preview.detail')), grid);
  paintPreview();
}

function guide() {
  app.replaceChildren(head(t('guide.title'), t('guide.detail')), createGuidePanel({ document, translate: t }));
}

function route() {
  const viewName = location.hash.slice(1) || 'dashboard';
  const view = ({ dashboard, preview, agents: () => catalogView('agents'), skills: () => catalogView('skills'), guide }[viewName] || dashboard);
  if (view !== dashboard && networkController) {
    networkController.destroy();
    networkController = undefined;
    networkHost = undefined;
  }
  if (view !== dashboard && taskEditor) {
    taskPollGeneration++;
    snapshotPollGeneration++;
    taskEditor.destroy();
    taskEditor = undefined;
    taskFetchError = undefined;
  }
  if (view !== dashboard && telemetryPanel) {
    telemetryPanel.destroy();
    telemetryPanel = undefined;
  }
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === viewName));
  view();
}

document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => { location.hash = button.dataset.view; }; });
addEventListener('hashchange', route);
preferences.mount(document.querySelector('#preview-preferences'));
preferences.subscribe(({ locale }) => {
  if (locale === renderedLocale) return;
  renderedLocale = locale;
  telemetryPanel?.rerender();
  taskEditor?.relocalize?.();
  networkController?.setTranslate?.(t);
  artifactRenderKey = '';
  localizeShell();
  localizeErrors();
  route();
});
localizeShell();
fetch('/runtime/catalog').then(response => response.json()).then(value => { catalog = value; route(); }).catch(route);
setInterval(() => {
  const view = location.hash.slice(1) || 'dashboard';
  if (view === 'dashboard') paint();
  if (view === 'preview') paintPreview();
}, 3000);
route();
