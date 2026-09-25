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
  const displayTime = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value)) ? value : 'unknown';

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
    if (!document.querySelector?.('[data-agent-network-styles]')) {
      const style = element(document, 'style');
      data(style, 'agent-network-styles', '');
      style.textContent = '.asn{font:13px/1.45 system-ui,sans-serif;color:inherit}.asn-controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}.asn-controls button,.asn-controls select{font:inherit;width:auto;max-width:100%;padding:5px 9px;border:1px solid #607383;border-radius:6px;background:#172730;color:inherit}.asn-main{display:grid;grid-template-columns:minmax(0,2fr) minmax(220px,1fr);gap:12px}.asn-svg{display:block;width:100%;height:auto;min-height:360px;border:1px solid #53616c;border-radius:8px;background:#0e1a22;touch-action:none}.asn-detail{padding:12px;border:1px solid #53616c;border-radius:8px;overflow-wrap:anywhere}.asn-detail-row{margin:4px 0}.asn-edge{fill:none;stroke:#6f8794;stroke-width:2}.asn-edge[data-emphasis="false"]{opacity:.23}.asn-edge[data-failure="true"]{stroke:#ff8291;stroke-dasharray:7 4}.asn-edge[data-kind="retry"]{stroke:#f5c771;stroke-width:3;stroke-dasharray:6 4}.asn-hit{fill:none;stroke:transparent;stroke-width:16;cursor:pointer}.asn-node{cursor:pointer}.asn-node circle{fill:#488da8;stroke:#c1dae5;stroke-width:2}.asn-node[data-status="active"] circle{fill:#45b998}.asn-node[data-status="completed"] circle{fill:#718b9d}.asn-node[data-status="failed"] circle,.asn-node[data-status="blocked"] circle{fill:#bd5b72}.asn-node[data-emphasis="false"]{opacity:.3}.asn-node text{fill:#f1f5f8;text-anchor:middle;font:11px system-ui,sans-serif;pointer-events:none}.asn-selected circle,.asn-selected path,.asn-node:focus-visible circle,.asn-hit:focus-visible{stroke:#ffe088;stroke-width:4;outline:none}.asn-note{margin:5px 0;color:#9bb2bf}@media(max-width:760px){.asn-main{grid-template-columns:1fr}.asn-svg{min-height:280px}.asn-detail{min-height:100px}}';
      document.head.append(style);
    }
    const root = element(document, 'section', 'asn');
    const controls = element(document, 'div', 'asn-controls');
    const mode = options.staticMode ? null : data(element(document, 'select'), 'network-mode', '');
    if (mode) {
      mode.setAttribute('aria-label', 'Network mode');
      for (const [value, label] of [['live', 'Live'], ['history', 'History']]) {
        const option = element(document, 'option', '', label); option.value = value; mode.append(option);
      }
      controls.append(mode);
    } else controls.append(element(document, 'span', 'asn-note', 'Snapshot History'));
    const filter = data(element(document, 'select'), 'network-filter', '');
    filter.setAttribute('aria-label', 'Network filter');
    for (const [value, label] of [['all', 'All'], ['active', 'Active'], ['failures', 'Failures'], ['task', 'Current Task']]) {
      const option = element(document, 'option', '', label); option.value = value; filter.append(option);
    }
    const task = data(element(document, 'select'), 'network-task', '');
    task.setAttribute('aria-label', 'Network task');
    controls.append(filter, task);
    const actionButtons = new Map();
    for (const [action, label] of [['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out'], ['fit', 'Fit'], ['reset', 'Reset']]) {
      const button = data(element(document, 'button', '', label), 'network-action', action);
      controls.append(button); actionButtons.set(action, button);
    }
    const main = element(document, 'div', 'asn-main');
    const svg = svgElement(document, 'svg', { class: 'asn-svg', viewBox: '0 0 800 440', 'aria-label': 'Agent Signal Network' });
    const graph = svgElement(document, 'g');
    svg.append(graph);
    const detail = data(element(document, 'aside', 'asn-detail'), 'network-detail', '');
    main.append(svg, detail);
    const note = element(document, 'p', 'asn-note');
    root.append(controls, note, main);
    host.replaceChildren(root);

    const state = { mode: options.staticMode ? 'history' : 'live', filter: 'all', taskId: '', selection: null, transform: { x: 0, y: 0, scale: 1 } };
    let snapshot = {}, catalog = {}, model = { nodes: [], edges: [], tasks: [] }, positions = [], drag = null, destroyed = false, focusAfterDraw = false;
    const bounds = { width: 800, height: 440 };
    const clampScale = value => Math.max(0.35, Math.min(3, value));
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
      return state.selection.type === 'node' ? model.nodes.find(node => node.id === state.selection.id)
        : model.edges.find(edge => edge.key === state.selection.key);
    }
    function drawDetail() {
      detail.replaceChildren();
      const record = selectedRecord();
      if (!record) {
        detail.append(element(document, 'p', '', `Select an agent or signal. ${model.nodes.length} agents, ${model.edges.length} signals.`));
        return;
      }
      if (state.selection.type === 'node') {
        for (const [label, value] of [
          ['Agent', record.id], ['Role', record.role], ['Status', record.status], ['Model', record.catalog?.model],
          ['Reasoning', record.catalog?.reasoning], ['Current/Last Task', record.current_task], ['Started', displayTime(record.started_at)],
          ['Finished', displayTime(record.stopped_at)], ['Claims', record.claims.join(', ')],
          ['Inbound Signals', model.edges.filter(edge => edge.to === record.id).length],
          ['Outbound Signals', model.edges.filter(edge => edge.from === record.id).length]
        ]) if (value !== undefined && value !== null && value !== '') detail.append(detailRow(document, label, value));
        if (record.started_at && record.stopped_at) {
          const elapsed = Date.parse(record.stopped_at) - Date.parse(record.started_at);
          if (Number.isFinite(elapsed) && elapsed >= 0) detail.append(detailRow(document, 'Elapsed', `${Math.round(elapsed / 1000)}s`));
        }
      } else {
        for (const [label, value] of [
          ['From', record.from], ['To', record.to], ['Kind', record.kind], ['Summary', record.summary], ['Sent', displayTime(record.time)],
          ['Task', record.task_id], ['Status', record.status], ['Artifact', record.artifact_href], ['Verification', record.verification_name]
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
      for (const edge of model.edges) {
        const path = pathFor(edge, counts);
        const visible = svgElement(document, 'path', { d: path, class: 'asn-edge', 'marker-end': 'url(#asn-arrow)', 'data-emphasis': edge.emphasized, 'data-failure': failed(edge.kind) || failed(edge.status), 'data-kind': string(edge.kind) });
        const hit = data(svgElement(document, 'path', { d: path, class: 'asn-hit', 'aria-label': `${string(edge.from)} to ${string(edge.to)}: ${string(edge.kind)}`, 'data-edge-key': edge.key }), 'edge-index', edge.index);
        if (state.selection?.type === 'edge' && state.selection.key === edge.key) visible.setAttribute('class', 'asn-edge asn-selected');
        if (state.selection?.type === 'edge' && state.selection.key === edge.key) focusTarget = hit;
        if (focusedEdgeKey === edge.key) focusedTarget = hit;
        activate(hit, event => { state.selection = { type: 'edge', key: edge.key }; focusAfterDraw = event.type === 'keydown'; draw(); });
        graph.append(visible, hit);
      }
      for (const position of positions) {
        const node = model.nodes.find(item => item.id === position.id);
        const group = data(svgElement(document, 'g', { class: state.selection?.type === 'node' && state.selection.id === node.id ? 'asn-node asn-selected' : 'asn-node', 'data-status': node.status, 'data-emphasis': node.emphasized, 'aria-label': `${node.id}, ${node.status}` }), 'node-id', node.id);
        group.append(svgElement(document, 'circle', { cx: position.x, cy: position.y, r: 18 }));
        const label = svgElement(document, 'text', { x: position.x, y: position.y + 34 }); label.textContent = node.id; group.append(label);
        if (state.selection?.type === 'node' && state.selection.id === node.id) focusTarget = group;
        if (focusedNodeId === node.id) focusedTarget = group;
        activate(group, event => { state.selection = { type: 'node', id: node.id }; focusAfterDraw = event.type === 'keydown'; draw(); });
        graph.append(group);
      }
      note.textContent = model.nodes.length === 0 && model.edges.length === 0 ? 'No agents or signals in this snapshot.'
        : state.mode === 'live' && !model.nodes.some(active) ? 'No active flow. Retained history is still shown.'
          : state.filter === 'task' && state.taskId && !model.nodes.some(node => node.matchesFilter) && !model.edges.some(edge => edge.matchesFilter)
            ? 'No linked network data for the selected task.'
            : 'History includes only agents and signals retained in this runtime.';
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
      positions = layout(model, bounds.width, bounds.height);
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
    const rebuild = () => { model = buildModel(snapshot, catalog, state); draw(); };
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
    actionButtons.get('reset').addEventListener('click', () => { positions = layout(model, bounds.width, bounds.height); state.transform = { x: 0, y: 0, scale: 1 }; draw(); });
    const wheel = event => { event.preventDefault(); const rect = svg.getBoundingClientRect(); scaleAround(event.deltaY < 0 ? 1.1 : 1 / 1.1, (event.clientX - rect.left) * bounds.width / rect.width, (event.clientY - rect.top) * bounds.height / rect.height); };
    const pointerDown = event => {
      if (event.target !== svg) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      svg.setPointerCapture(event.pointerId);
    };
    const pointerMove = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const rect = svg.getBoundingClientRect();
      state.transform.x += (event.clientX - drag.x) * (rect.width > 0 ? bounds.width / rect.width : 1);
      state.transform.y += (event.clientY - drag.y) * (rect.height > 0 ? bounds.height / rect.height : 1);
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
