export function createTelemetryPanel(host, { fetchImpl = fetch, translate = key => key } = {}) {
  const document = host.ownerDocument;
  let snapshot = null;
  let selectedTask = null;
  let stale = false;
  let generation = 0;
  let destroyed = false;

  const node = (tag, text, attribute, value) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (attribute) element.setAttribute(attribute, value);
    return element;
  };
  const unknown = () => translate('telemetry.unknown');
  const value = input => Number.isSafeInteger(input) && input >= 0 ? String(input) : unknown();
  const metric = (container, key, input) => {
    const row = node('div');
    row.className = 'telemetry-metric';
    row.append(node('span', translate(`telemetry.${key}`)), node('strong', value(input), 'data-telemetry-value', key));
    container.append(row);
  };
  const safeSource = source => ['codex_rollout', 'other'].includes(source) ? source : 'other';
  const safeStatus = status => ['observed', 'partial', 'missing', 'unsupported'].includes(status) ? status : 'missing';

  function render() {
    if (destroyed) return;
    const status = safeStatus(snapshot?.status);
    const root = node('div');
    if (stale) root.append(node('p', translate('telemetry.stale'), 'data-telemetry-state', 'stale'));
    root.append(node('p', translate(`telemetry.status.${status}`)));
    if (snapshot?.source) root.append(node('p', translate(`telemetry.source.${safeSource(snapshot.source)}`)));
    const coverage = snapshot?.coverage;
    if (coverage) {
      const summary = ['threads', 'observed_threads', 'partial_threads', 'unsupported_threads']
        .filter(key => coverage[key] !== undefined)
        .map(key => `${translate(`telemetry.${key}`)}: ${value(coverage[key])}`);
      if (summary.length) root.append(node('p', `${translate('telemetry.coverage')}: ${summary.join(' · ')}`));
    }

    const selectorLabel = node('label', translate('telemetry.taskSelector'));
    const selector = node('select', undefined, 'data-telemetry-task', 'selector');
    const all = node('option', translate('telemetry.allTasks'));
    all.value = '';
    selector.append(all);
    for (const task of snapshot?.tasks || []) {
      if (typeof task.task_id !== 'string') continue;
      const option = node('option', task.task_id);
      option.value = task.task_id;
      selector.append(option);
    }
    if (selectedTask && !((snapshot?.tasks || []).some(task => task.task_id === selectedTask))) selectedTask = null;
    selector.value = selectedTask || '';
    selector.addEventListener('change', () => { selectedTask = selector.value || null; render(); });
    selectorLabel.append(selector);
    root.append(selectorLabel);

    const task = selectedTask ? (snapshot?.tasks || []).find(item => item.task_id === selectedTask) : null;
    if (selectedTask) root.append(node('p', translate('telemetry.selectedExcludesUnassigned')));
    const totals = selectedTask ? task?.totals : snapshot?.totals;
    const metrics = node('div');
    for (const key of ['input', 'cached_input', 'output', 'reasoning_output', 'processed', 'responses', 'tool_calls']) {
      if (key === 'responses' || key === 'tool_calls') {
        if (!totals || !(key in totals)) continue;
      }
      metric(metrics, key, status === 'observed' || status === 'partial' ? totals?.[key] : null);
    }
    if (!selectedTask) {
      metric(metrics, 'unattributed', snapshot?.unattributed?.processed);
      const numerator = snapshot?.unattributed?.processed;
      const denominator = snapshot?.totals?.processed;
      const ratio = Number.isSafeInteger(numerator) && numerator >= 0 && Number.isSafeInteger(denominator) && denominator > 0 && numerator <= denominator
        ? `${Math.round(numerator / denominator * 100)}%` : unknown();
      const ratioRow = node('div');
      ratioRow.className = 'telemetry-metric';
      ratioRow.append(node('span', translate('telemetry.unattributedFraction')), node('strong', ratio, 'data-telemetry-value', 'unattributedFraction'));
      metrics.append(ratioRow);
    } else {
      metric(metrics, 'unattributed', null);
    }
    root.append(metrics);

    if (!selectedTask) {
      for (const [key, field] of [['roles', 'role'], ['agents', 'agent_id']]) {
        const section = node('section');
        section.append(node('h3', translate(`telemetry.${key}`)));
        for (const row of snapshot?.[key] || []) section.append(node('p', `${row[field]} · ${translate('telemetry.processed')}: ${value(row.totals?.processed)}`));
        root.append(section);
      }
      const tools = snapshot?.largest_tool_outputs || [];
      if (tools.length) {
        const section = node('section');
        section.append(node('h3', translate('telemetry.largestToolOutputs')));
        for (const row of tools) section.append(node('p', `${row.tool} · ${translate('telemetry.count')}: ${value(row.count)} · ${translate('telemetry.totalBytes')}: ${value(row.total_bytes)} · ${translate('telemetry.medianBytes')}: ${row.median_bytes ?? unknown()} · ${translate('telemetry.p95Bytes')}: ${value(row.p95_bytes)} · ${translate('telemetry.maxBytes')}: ${value(row.max_bytes)}`));
        root.append(section);
      }
    }
    const spawns = selectedTask ? (snapshot?.spawns || []).filter(row => row.task_id === selectedTask) : snapshot?.spawns || [];
    if (spawns.length) {
      const section = node('section');
      section.append(node('h3', translate('telemetry.spawns')));
      for (const row of spawns) section.append(node('p', `${row.parent_agent_id ?? unknown()} → ${row.child_agent_id ?? unknown()} · ${row.role ?? unknown()} · ${row.fork_turns ?? unknown()} · ${translate('telemetry.attempts')}: ${value(row.attempts)} · ${translate('telemetry.confirmed')}: ${value(row.confirmed)}`));
      root.append(section);
    }
    if (!selectedTask) {
      const timing = node('div');
      metric(timing, 'compactions', snapshot?.compactions);
      for (const key of ['start_at', 'end_at']) {
        const row = node('div');
        row.className = 'telemetry-metric';
        row.append(node('span', translate(`telemetry.${key}`)), node('strong', snapshot?.[key] || unknown()));
        timing.append(row);
      }
      metric(timing, 'elapsed_ms', snapshot?.elapsed_ms);
      root.append(timing);
    }
    host.replaceChildren(root);
  }

  async function refresh() {
    const request = ++generation;
    try {
      const response = await fetchImpl('/runtime/telemetry', { cache: 'no-store' });
      if (response.ok === false) throw new Error('telemetry read failed');
      const next = await response.json();
      if (destroyed || request !== generation) return;
      snapshot = next;
      stale = false;
      render();
    } catch {
      if (destroyed || request !== generation) return;
      stale = true;
      render();
    }
  }

  render();
  return {
    refresh,
    setTask(taskId) { selectedTask = taskId ?? null; render(); },
    rerender: render,
    destroy() { destroyed = true; generation++; host.replaceChildren(); }
  };
}
