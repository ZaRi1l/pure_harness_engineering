((global) => {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const FAILURE_KINDS = new Set(['failed', 'blocked', 'retry', 'reject']);
  const normalizeStatus = value => value === 'running' ? 'active' : (value || 'unknown');
  const hash = value => [...String(value)].reduce((result, character) =>
    Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const signalSignature = signal => JSON.stringify([
    signal.time, signal.from, signal.to, signal.kind, signal.summary,
    signal.task_id, signal.status, signal.artifact_href, signal.verification_name
  ]);
  const signalKey = (signal, ordinalFromTail) => signal.id
    ? `id:${signal.id}` : `legacy:${signalSignature(signal)}|${ordinalFromTail}`;
  const exactTaskMatch = (node, edge, task) => Boolean(task) && (
    node?.task_id === task.id || task.owner === node?.id || edge?.task_id === task.id
  );
  const active = node => node?.status === 'active';
  const failed = value => FAILURE_KINDS.has(String(value || '').toLowerCase());
  const string = value => String(value ?? '');
  const displayTime = value => value == null || (typeof value === 'string' && !value.trim())
    ? undefined : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : 'unknown';

  function buildModel(snapshot = {}, catalog = {}, viewState = {}) {
    const status = snapshot?.status || {};
    const tasks = snapshot?.tasks?.tasks || [];
    const selectedTask = tasks.find(task => task.id === viewState.taskId);
    const records = new Map();
    for (const item of status.agents || []) if (item?.id) records.set(item.id, { ...item });
    for (const item of status.active_agents || []) if (item?.id) records.set(item.id, { ...records.get(item.id), ...item });
    for (const signal of status.signals || []) {
      for (const id of [signal?.from, signal?.to]) if (id && !records.has(id)) records.set(id, { id });
    }
    const claims = snapshot?.claims?.claims || [];
    const nodes = [...records.values()].map(record => {
      const catalogRecord = (catalog?.agents || []).find(item => item.id === record.role) || null;
      const node = {
        ...record, status: normalizeStatus(record.status),
        catalog: catalogRecord,
        claims: claims.filter(claim => claim.agent_id === record.id).flatMap(claim => claim.scopes || [])
      };
      node.matchesFilter = viewState.filter === 'active' ? active(node)
        : viewState.filter === 'failures' ? failed(node.status)
          : viewState.filter === 'task' ? exactTaskMatch(node, null, selectedTask)
            : true;
      node.emphasized = node.matchesFilter && (viewState.mode !== 'live' || active(node));
      return node;
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    const signals = status.signals || [];
    const ordinals = new Array(signals.length);
    const counts = new Map();
    for (let index = signals.length - 1; index >= 0; index--) {
      const signature = signalSignature(signals[index]);
      ordinals[index] = counts.get(signature) || 0;
      counts.set(signature, ordinals[index] + 1);
    }
    const edges = signals.map((signal, index) => {
      const edge = { ...signal, index, key: signalKey(signal, ordinals[index]), legacySignature: signal.id ? null : signalSignature(signal) };
      const from = byId.get(signal.from);
      const to = byId.get(signal.to);
      edge.matchesFilter = viewState.filter === 'active' ? active(from) || active(to)
        : viewState.filter === 'failures' ? failed(signal.kind) || failed(signal.status)
          : viewState.filter === 'task' ? exactTaskMatch(null, edge, selectedTask)
            : true;
      edge.emphasized = edge.matchesFilter && (viewState.mode !== 'live' || active(from) || active(to));
      return edge;
    });
    return { nodes, edges, tasks };
  }

  function layout(model, width, height) {
    const w = Number.isFinite(width) && width > 0 ? width : 800;
    const h = Number.isFinite(height) && height > 0 ? height : 440;
    const nodes = model.nodes.map(node => {
      const angle = (hash(node.id) / 4294967296) * Math.PI * 2;
      const radius = Math.min(w, h) * (0.19 + (hash(`${node.id}:radius`) % 25) / 100);
      return { id: node.id, x: w / 2 + Math.cos(angle) * radius, y: h / 2 + Math.sin(angle) * radius };
    });
    if (nodes.length === 1) { nodes[0].x = w / 2; nodes[0].y = h / 2; }
    const indices = new Map(nodes.map((node, index) => [node.id, index]));
    for (let step = 0; step < 80; step++) {
      const forces = nodes.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        if (Math.abs(dx) + Math.abs(dy) < 0.01) { dx = 0.01 + (hash(nodes[i].id) % 13) / 100; dy = 0.01; }
        const distance = Math.max(1, Math.hypot(dx, dy));
        const repulsion = Math.min(7, 2000 / (distance * distance));
        const separation = distance < 52 ? (52 - distance) * 0.15 : 0;
        const fx = dx / distance * (repulsion + separation);
        const fy = dy / distance * (repulsion + separation);
        forces[i].x -= fx; forces[i].y -= fy;
        forces[j].x += fx; forces[j].y += fy;
      }
      for (const edge of model.edges || []) {
        const i = indices.get(edge.from), j = indices.get(edge.to);
        if (i === undefined || j === undefined || i === j) continue;
        const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const force = Math.max(-3, Math.min(3, (distance - 150) * 0.012));
        forces[i].x += dx / distance * force; forces[i].y += dy / distance * force;
        forces[j].x -= dx / distance * force; forces[j].y -= dy / distance * force;
      }
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].x = Math.max(30, Math.min(w - 30, nodes[i].x + Math.max(-8, Math.min(8, forces[i].x + (w / 2 - nodes[i].x) * 0.004))));
        nodes[i].y = Math.max(30, Math.min(h - 30, nodes[i].y + Math.max(-8, Math.min(8, forces[i].y + (h / 2 - nodes[i].y) * 0.004))));
      }
    }
    return nodes;
  }

  function element(document, name, className = '', content) {
    const node = document.createElement(name);
    if (className) node.setAttribute('class', className);
    if (content !== undefined) node.textContent = string(content);
    return node;
  }
  function svgElement(document, name, attributes = {}) {
    const node = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }
  function data(node, key, value) { node.setAttribute(`data-${key}`, value); return node; }
  function activate(node, action) {
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.addEventListener('click', action);
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(event); }
    });
  }
  function detailRow(document, label, value) {
    const row = element(document, 'div', 'asn-detail-row');
    row.append(element(document, 'strong', '', `${label}: `), element(document, 'span', '', value));
    return row;
  }

  function create(host, options = {}) {
    const document = host.ownerDocument;
    const fallback = {
      'network.modeLabel': 'Network mode', 'network.live': 'Reported running only', 'network.history': 'Full history',
      'network.snapshotHistory': 'Snapshot History', 'network.filterLabel': 'Network filter', 'network.all': 'All',
      'network.active': 'Reported running', 'network.failures': 'Failures', 'network.currentTask': 'Current Task',
      'network.taskLabel': 'Network task', 'network.zoomIn': 'Zoom in', 'network.zoomOut': 'Zoom out',
      'network.fit': 'Fit', 'network.reset': 'Reset', 'network.graphLabel': 'Agent Signal Network',
      'network.empty': 'Select an agent or signal. {agents} agents, {signals} signals.',
      'network.noData': 'No agents or signals in this snapshot.',
      'network.noActive': 'No agents reported running in this snapshot. Switch to Full history for retained records.',
      'network.observed': 'Runtime records report {agents} as running. No live liveness check; last snapshot update: {time}. This is not the full native agent list.',
      'network.reportedRunning': 'reported running; liveness unconfirmed',
      'network.noTaskData': 'No linked network data for the selected task.',
      'network.historyNote': 'History includes only agents and signals retained in this runtime.',
      'network.agent': 'Agent', 'network.role': 'Role', 'network.status': 'Status', 'network.model': 'Model',
      'network.reasoning': 'Reasoning', 'network.currentLastTask': 'Current/Last Task', 'network.started': 'Started',
      'network.finished': 'Finished', 'network.claims': 'Claims', 'network.inbound': 'Inbound Signals',
      'network.outbound': 'Outbound Signals', 'network.elapsed': 'Elapsed', 'network.from': 'From', 'network.to': 'To',
      'network.kind': 'Kind', 'network.summary': 'Summary', 'network.sent': 'Sent', 'network.task': 'Task',
      'network.artifact': 'Artifact', 'network.verification': 'Verification', 'network.edgeLabel': '{from} to {to}: {kind}'
    };
    let translate = options.translate;
    const t = (key, values = {}) => {
      const message = translate?.(key, values) ?? fallback[key] ?? key;
      return String(message).replace(/\{([^}]+)\}/g, (_match, name) => String(values[name] ?? ''));
    };
    const shownStatus = value => value === 'active' ? t('network.reportedRunning') : value;
    if (!document.querySelector?.('[data-agent-network-styles]')) {
      const style = element(document, 'style');
      data(style, 'agent-network-styles', '');
      style.textContent = '.asn{font:13px/1.45 system-ui,sans-serif;color:inherit}.asn-controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}.asn-controls button,.asn-controls select{font:inherit;width:auto;max-width:100%;padding:5px 9px;border:1px solid var(--graph-border,#607383);border-radius:6px;background:var(--graph-control,#172730);color:inherit}.asn-main{display:grid;grid-template-columns:minmax(0,2fr) minmax(220px,1fr);gap:12px}.asn-svg{display:block;width:100%;height:auto;min-height:360px;border:1px solid var(--graph-border,#53616c);border-radius:8px;background:var(--graph-bg,#0e1a22);touch-action:none}.asn-detail{padding:12px;border:1px solid var(--graph-border,#53616c);border-radius:8px;overflow-wrap:anywhere}.asn-detail-row{margin:4px 0}.asn-edge{fill:none;stroke:var(--graph-edge,#6f8794);stroke-width:2}.asn-edge[data-emphasis="false"]{opacity:.23}.asn-edge[data-failure="true"]{stroke:#d94f68;stroke-dasharray:7 4}.asn-edge[data-kind="retry"]{stroke:#c98b16;stroke-width:3;stroke-dasharray:6 4}.asn-hit{fill:none;stroke:transparent;stroke-width:16;cursor:pointer}.asn-node{cursor:pointer}.asn-node circle{fill:#397f9b;stroke:var(--graph-node-stroke,#c1dae5);stroke-width:2}.asn-node[data-status="reported-running"] circle{fill:#9b792c;stroke-dasharray:4 3}.asn-node[data-status="completed"] circle{fill:#60798b}.asn-node[data-status="failed"] circle,.asn-node[data-status="blocked"] circle{fill:#ad4058}.asn-node[data-emphasis="false"]{opacity:.3}.asn-node text{fill:var(--graph-text,#f1f5f8);text-anchor:middle;font:11px system-ui,sans-serif;pointer-events:none}.asn-selected circle,.asn-selected path,.asn-node:focus-visible circle,.asn-hit:focus-visible{stroke:#d3a700;stroke-width:4;outline:none}.asn-note{margin:5px 0;color:var(--m,#9bb2bf)}@media(max-width:760px){.asn-main{grid-template-columns:1fr}.asn-svg{min-height:280px}.asn-detail{min-height:100px}}';
      document.head.append(style);
    }
    const root = element(document, 'section', 'asn');
    const controls = element(document, 'div', 'asn-controls');
    const mode = options.staticMode ? null : data(element(document, 'select'), 'network-mode', '');
    const modeOptions = [['live', 'network.live'], ['history', 'network.history']];
    let snapshotModeNote;
    if (mode) {
      mode.setAttribute('aria-label', t('network.modeLabel'));
      for (const [value, key] of modeOptions) {
        const option = element(document, 'option', '', t(key)); option.value = value; mode.append(option);
      }
      controls.append(mode);
    } else { snapshotModeNote = element(document, 'span', 'asn-note', t('network.snapshotHistory')); controls.append(snapshotModeNote); }
    const filter = data(element(document, 'select'), 'network-filter', '');
    filter.setAttribute('aria-label', t('network.filterLabel'));
    const filterOptions = [['all', 'network.all'], ['active', 'network.active'], ['failures', 'network.failures'], ['task', 'network.currentTask']];
    for (const [value, key] of filterOptions) {
      const option = element(document, 'option', '', t(key)); option.value = value; filter.append(option);
    }
    const task = data(element(document, 'select'), 'network-task', '');
    task.setAttribute('aria-label', t('network.taskLabel'));
    controls.append(filter, task);
    const actionButtons = new Map();
    const actionLabels = new Map([['zoom-in', 'network.zoomIn'], ['zoom-out', 'network.zoomOut'], ['fit', 'network.fit'], ['reset', 'network.reset']]);
    for (const [action, key] of actionLabels) {
      const button = data(element(document, 'button', '', t(key)), 'network-action', action);
      controls.append(button); actionButtons.set(action, button);
    }
    const main = element(document, 'div', 'asn-main');
    const svg = svgElement(document, 'svg', { class: 'asn-svg', viewBox: '0 0 800 440', 'aria-label': t('network.graphLabel') });
    const graph = svgElement(document, 'g');
    svg.append(graph);
    const detail = data(element(document, 'aside', 'asn-detail'), 'network-detail', '');
    main.append(svg, detail);
    const note = element(document, 'p', 'asn-note');
    const provenance = element(document, 'p', 'asn-note');
    root.append(controls, note, provenance, main);
    host.replaceChildren(root);

    const initial = options.initialState || {};
    const initialTransform = initial.transform || {};
    const state = {
      mode: options.staticMode ? 'history' : (['live', 'history'].includes(initial.mode) ? initial.mode : 'live'),
      filter: ['all', 'active', 'failures', 'task'].includes(initial.filter) ? initial.filter : 'all',
      taskId: string(initial.taskId),
      selection: initial.selection ? { ...initial.selection } : null,
      transform: {
        x: Number.isFinite(initialTransform.x) ? initialTransform.x : 0,
        y: Number.isFinite(initialTransform.y) ? initialTransform.y : 0,
        scale: Number.isFinite(initialTransform.scale) ? Math.max(0.35, Math.min(3, initialTransform.scale)) : 1
      }
    };
    let snapshot = {}, catalog = {}, model = { nodes: [], edges: [], tasks: [] }, positions = [], drag = null, destroyed = false, focusAfterDraw = false;
    const bounds = { width: 800, height: 440 };
    const clampScale = value => Math.max(0.35, Math.min(3, value));
    function visibleModel() {
      if (state.mode !== 'live') return model;
      const activeIds = Array.isArray(snapshot?.status?.active_agents)
        ? new Set(snapshot.status.active_agents.filter(item => item?.id).map(item => item.id)) : null;
      const running = model.nodes.filter(node => node.id !== 'main' && active(node) && (!activeIds || activeIds.has(node.id)));
      const main = model.nodes.find(node => node.id === 'main');
      const nodes = running.length
        ? [{ ...main, id: 'main', role: main?.role || 'main', status: 'unknown', claims: main?.claims || [], matchesFilter: Boolean(main?.matchesFilter), emphasized: true }, ...running]
        : [];
      const runningIds = new Set(running.map(node => node.id));
      const ids = new Set(nodes.map(node => node.id));
      return { nodes, edges: model.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to) && (runningIds.has(edge.from) || runningIds.has(edge.to))), tasks: model.tasks };
    }
    function scaleAround(factor, x = bounds.width / 2, y = bounds.height / 2) {
      const next = clampScale(state.transform.scale * factor);
      const ratio = next / state.transform.scale;
      state.transform.x = x - (x - state.transform.x) * ratio;
      state.transform.y = y - (y - state.transform.y) * ratio;
      state.transform.scale = next;
      draw();
    }
    function selectedRecord() {
      if (!state.selection) return null;
      const visible = visibleModel();
      return state.selection.type === 'node' ? visible.nodes.find(node => node.id === state.selection.id)
        : visible.edges.find(edge => edge.key === state.selection.key);
    }
    function drawDetail() {
      detail.replaceChildren();
      const visible = visibleModel();
      const record = selectedRecord();
      if (!record) {
        detail.append(element(document, 'p', '', t('network.empty', { agents: visible.nodes.length, signals: visible.edges.length })));
        return;
      }
      if (state.selection.type === 'node') {
        for (const [label, value] of [
          [t('network.agent'), record.id], [t('network.role'), record.role], [t('network.status'), shownStatus(record.status)], [t('network.model'), record.catalog?.model],
          [t('network.reasoning'), record.catalog?.reasoning], [t('network.currentLastTask'), record.current_task], [t('network.started'), displayTime(record.started_at)],
          [t('network.finished'), displayTime(record.stopped_at)], [t('network.claims'), record.claims.join(', ')],
          [t('network.inbound'), visible.edges.filter(edge => edge.to === record.id).length],
          [t('network.outbound'), visible.edges.filter(edge => edge.from === record.id).length]
        ]) if (value !== undefined && value !== null && value !== '') detail.append(detailRow(document, label, value));
        if (record.started_at && record.stopped_at) {
          const elapsed = Date.parse(record.stopped_at) - Date.parse(record.started_at);
          if (Number.isFinite(elapsed) && elapsed >= 0) detail.append(detailRow(document, t('network.elapsed'), `${Math.round(elapsed / 1000)}s`));
        }
      } else {
        for (const [label, value] of [
          [t('network.from'), record.from], [t('network.to'), record.to], [t('network.kind'), record.kind], [t('network.summary'), record.summary], [t('network.sent'), displayTime(record.time)],
          [t('network.task'), record.task_id], [t('network.status'), record.status], [t('network.artifact'), record.artifact_href], [t('network.verification'), record.verification_name]
        ]) if (value !== undefined && value !== null && value !== '') detail.append(detailRow(document, label, value));
      }
    }
    function pathFor(edge, counts) {
      const from = positions.find(node => node.id === edge.from), to = positions.find(node => node.id === edge.to);
      if (!from || !to) return '';
      const pair = `${edge.from}|${edge.to}`;
      const offset = counts.get(pair) || 0;
      counts.set(pair, offset + 1);
      if (from.id === to.id) return `M ${from.x + 16} ${from.y - 8} C ${from.x + 65} ${from.y - 80}, ${from.x - 45} ${from.y - 80}, ${from.x - 16} ${from.y - 8}`;
      const dx = to.x - from.x, dy = to.y - from.y, distance = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / distance, uy = dy / distance;
      const bend = offset ? (Math.ceil(offset / 2) * (offset % 2 ? 1 : -1) * 22) : 0;
      return `M ${from.x + ux * 18} ${from.y + uy * 18} Q ${(from.x + to.x) / 2 - uy * bend} ${(from.y + to.y) / 2 + ux * bend} ${to.x - ux * 21} ${to.y - uy * 21}`;
    }
    function draw() {
      if (destroyed) return;
      const visibleModelNow = visibleModel();
      const focused = graph.contains?.(document.activeElement) ? document.activeElement : null;
      const focusedNodeId = focused?.getAttribute('data-node-id');
      const focusedEdgeKey = focused?.getAttribute('data-edge-key');
      mode && (mode.value = state.mode);
      filter.value = state.filter;
      task.value = state.taskId;
      graph.setAttribute('transform', `translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.scale})`);
      graph.replaceChildren();
      let focusTarget = null, focusedTarget = null;
      const defs = svgElement(document, 'defs');
      const marker = svgElement(document, 'marker', { id: 'asn-arrow', markerWidth: 8, markerHeight: 8, refX: 6, refY: 4, orient: 'auto', markerUnits: 'strokeWidth' });
      marker.append(svgElement(document, 'path', { d: 'M 0 0 L 8 4 L 0 8 z', fill: '#8caab8' }));
      defs.append(marker); graph.append(defs);
      const counts = new Map();
      for (const edge of visibleModelNow.edges) {
        const path = pathFor(edge, counts);
        const visible = svgElement(document, 'path', { d: path, class: 'asn-edge', 'marker-end': 'url(#asn-arrow)', 'data-emphasis': edge.emphasized, 'data-failure': failed(edge.kind) || failed(edge.status), 'data-kind': string(edge.kind) });
        const hit = data(svgElement(document, 'path', { d: path, class: 'asn-hit', 'aria-label': t('network.edgeLabel', { from: string(edge.from), to: string(edge.to), kind: string(edge.kind) }), 'data-edge-key': edge.key }), 'edge-index', edge.index);
        if (state.selection?.type === 'edge' && state.selection.key === edge.key) visible.setAttribute('class', 'asn-edge asn-selected');
        if (state.selection?.type === 'edge' && state.selection.key === edge.key) focusTarget = hit;
        if (focusedEdgeKey === edge.key) focusedTarget = hit;
        activate(hit, event => { state.selection = { type: 'edge', key: edge.key }; focusAfterDraw = event.type === 'keydown'; draw(); });
        graph.append(visible, hit);
      }
      for (const position of positions) {
        const node = visibleModelNow.nodes.find(item => item.id === position.id);
        const group = data(svgElement(document, 'g', { class: state.selection?.type === 'node' && state.selection.id === node.id ? 'asn-node asn-selected' : 'asn-node', 'data-status': node.status === 'active' ? 'reported-running' : node.status, 'data-emphasis': node.emphasized, 'aria-label': `${node.id}, ${shownStatus(node.status)}` }), 'node-id', node.id);
        group.append(svgElement(document, 'circle', { cx: position.x, cy: position.y, r: 18 }));
        const label = svgElement(document, 'text', { x: position.x, y: position.y + 34 }); label.textContent = node.id; group.append(label);
        if (state.selection?.type === 'node' && state.selection.id === node.id) focusTarget = group;
        if (focusedNodeId === node.id) focusedTarget = group;
        activate(group, event => { state.selection = { type: 'node', id: node.id }; focusAfterDraw = event.type === 'keydown'; draw(); });
        graph.append(group);
      }
      note.textContent = model.nodes.length === 0 && model.edges.length === 0 ? t('network.noData')
        : state.mode === 'live' && !visibleModelNow.nodes.some(node => node.id !== 'main') ? t('network.noActive')
          : state.filter === 'task' && state.taskId && !visibleModelNow.nodes.some(node => node.matchesFilter) && !visibleModelNow.edges.some(edge => edge.matchesFilter)
            ? t('network.noTaskData')
            : t('network.historyNote');
      provenance.textContent = t('network.observed', {
        agents: Array.isArray(snapshot?.status?.active_agents) ? snapshot.status.active_agents.length : model.nodes.filter(node => node.id !== 'main' && active(node)).length,
        time: displayTime(snapshot?.status?.last_update) || t('common.unknown')
      });
      drawDetail();
      if (focused) focusedTarget?.focus();
      else if (focusAfterDraw) focusTarget?.focus();
      focusAfterDraw = false;
    }
    function update(nextSnapshot, nextCatalog) {
      const previousEdge = state.selection?.type === 'edge' ? selectedRecord() : null;
      const previousEdges = model.edges;
      snapshot = nextSnapshot || {}; catalog = nextCatalog || {};
      const tasks = snapshot?.tasks?.tasks || [];
      if (!tasks.some(item => item.id === state.taskId)) state.taskId = tasks[0]?.id || '';
      task.replaceChildren();
      for (const item of tasks) { const option = element(document, 'option', '', item.title || item.id); option.value = item.id; task.append(option); }
      task.value = state.taskId;
      model = buildModel(snapshot, catalog, state);
      positions = layout(visibleModel(), bounds.width, bounds.height);
      if (previousEdge && !previousEdge.id) {
        const signature = previousEdge.legacySignature;
        const oldCount = previousEdges.filter(edge => edge.legacySignature === signature).length;
        const newCount = model.edges.filter(edge => edge.legacySignature === signature).length;
        const oldKeys = previousEdges.map(edge => edge.key);
        const newKeys = model.edges.map(edge => edge.key);
        let overlap = 0;
        for (let length = Math.min(oldKeys.length, newKeys.length); length > 0; length--) {
          if (newKeys.slice(0, length).every((key, index) => key === oldKeys[oldKeys.length - length + index])) {
            overlap = length;
            break;
          }
        }
        const nextIndex = previousEdges.indexOf(previousEdge) - (oldKeys.length - overlap);
        const retained = nextIndex >= 0 && nextIndex < overlap && newKeys[nextIndex] === previousEdge.key;
        if ((oldCount !== newCount && Math.max(oldCount, newCount) > 1) || !retained) state.selection = null;
      }
      if (state.selection && !selectedRecord()) state.selection = null;
      draw();
    }
    const rebuild = () => {
      model = buildModel(snapshot, catalog, state);
      positions = layout(visibleModel(), bounds.width, bounds.height);
      if (state.selection && !selectedRecord()) state.selection = null;
      draw();
    };
    function setTranslate(nextTranslate) {
      translate = nextTranslate;
      mode?.setAttribute('aria-label', t('network.modeLabel'));
      if (mode) Array.from(mode.children).forEach((option, index) => { option.textContent = t(modeOptions[index][1]); });
      if (snapshotModeNote) snapshotModeNote.textContent = t('network.snapshotHistory');
      filter.setAttribute('aria-label', t('network.filterLabel'));
      Array.from(filter.children).forEach((option, index) => { option.textContent = t(filterOptions[index][1]); });
      task.setAttribute('aria-label', t('network.taskLabel'));
      for (const [action, key] of actionLabels) actionButtons.get(action).textContent = t(key);
      svg.setAttribute('aria-label', t('network.graphLabel'));
      draw();
    }
    mode?.addEventListener('change', () => { state.mode = mode.value; rebuild(); });
    filter.addEventListener('change', () => { state.filter = filter.value; rebuild(); });
    task.addEventListener('change', () => { state.taskId = task.value; rebuild(); });
    actionButtons.get('zoom-in').addEventListener('click', () => scaleAround(1.2));
    actionButtons.get('zoom-out').addEventListener('click', () => scaleAround(1 / 1.2));
    actionButtons.get('fit').addEventListener('click', () => {
      if (!positions.length) return;
      const xs = positions.map(node => node.x), ys = positions.map(node => node.y);
      const left = Math.min(...xs) - 35, right = Math.max(...xs) + 35;
      const top = Math.min(...ys) - 45, bottom = Math.max(...ys) + 45;
      const scale = clampScale(Math.min(bounds.width / Math.max(1, right - left), bounds.height / Math.max(1, bottom - top)) * 0.9);
      state.transform = { scale, x: bounds.width / 2 - ((left + right) / 2) * scale, y: bounds.height / 2 - ((top + bottom) / 2) * scale };
      draw();
    });
    actionButtons.get('reset').addEventListener('click', () => { positions = layout(visibleModel(), bounds.width, bounds.height); state.transform = { x: 0, y: 0, scale: 1 }; draw(); });
    const wheel = event => { event.preventDefault(); const rect = svg.getBoundingClientRect(); scaleAround(event.deltaY < 0 ? 1.1 : 1 / 1.1, (event.clientX - rect.left) * bounds.width / rect.width, (event.clientY - rect.top) * bounds.height / rect.height); };
    const pointerDown = event => {
      if (event.target !== svg) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      svg.setPointerCapture(event.pointerId);
    };
    const pointerMove = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const rect = svg.getBoundingClientRect();
      const scale = Math.max(
        Number.isFinite(rect.width) && rect.width > 0 ? bounds.width / rect.width : 1,
        Number.isFinite(rect.height) && rect.height > 0 ? bounds.height / rect.height : 1
      );
      state.transform.x += (event.clientX - drag.x) * scale;
      state.transform.y += (event.clientY - drag.y) * scale;
      drag = { id: drag.id, x: event.clientX, y: event.clientY };
      draw();
    };
    const pointerUp = event => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    };
    const captureLost = () => { drag = null; };
    svg.addEventListener('wheel', wheel);
    svg.addEventListener('pointerdown', pointerDown);
    svg.addEventListener('pointermove', pointerMove);
    svg.addEventListener('pointerup', pointerUp);
    svg.addEventListener('pointercancel', pointerUp);
    svg.addEventListener('lostpointercapture', captureLost);
    draw();
    return {
      update,
      setTranslate,
      getState: () => ({ mode: state.mode, filter: state.filter, taskId: state.taskId, selection: state.selection && { ...state.selection }, transform: { ...state.transform } }),
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        svg.removeEventListener('wheel', wheel);
        svg.removeEventListener('pointerdown', pointerDown);
        svg.removeEventListener('pointermove', pointerMove);
        svg.removeEventListener('pointerup', pointerUp);
        svg.removeEventListener('pointercancel', pointerUp);
        svg.removeEventListener('lostpointercapture', captureLost);
        if (drag && svg.hasPointerCapture(drag.id)) svg.releasePointerCapture(drag.id);
        host.replaceChildren();
      }
    };
  }

  Object.freeze(FAILURE_KINDS);
  global.AgentSignalNetwork = Object.freeze({ create, buildModel, layout });
})(globalThis);
