const STATUSES = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'];
let pageSortOldestFirst = false;
const validTime = value => { const time = Date.parse(value || ''); return Number.isFinite(time) ? time : null; };
function orderedTaskRows(tasks, oldestFirst) {
  return [...tasks].map(task => {
    const createdAt = validTime(task.created_at), updatedAt = validTime(task.updated_at);
    return { task, createdAt, updatedAt, sortAt: updatedAt ?? createdAt };
  }).sort((a, b) => {
    const byId = String(a.task.id) < String(b.task.id) ? -1 : String(a.task.id) > String(b.task.id) ? 1 : 0;
    const left = a.sortAt, right = b.sortAt;
    if (left === null || right === null) return left === null && right === null ? byId : left === null ? 1 : -1;
    return (oldestFirst ? left - right : right - left) || byId;
  });
}
export function sortTasks(tasks, oldestFirst = false) { return orderedTaskRows(tasks, oldestFirst).map(row => row.task); }

export function createTaskEditor(host, { fetchImpl = fetch, translate = key => key }) {
  const document = host.ownerDocument;
  const make = (tag, text, className = '') => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, action, handler) => {
    const node = make('button', translate(label));
    node.type = 'button'; node.setAttribute('data-task-action', action); node.onclick = handler;
    return node;
  };
  const toolbar = make('div', undefined, 'task-toolbar');
  const formHost = make('div');
  const rows = make('ul');
  host.replaceChildren(toolbar, formHost, rows);
  let tasks = [], writeToken = null, active = null, oldestFirst = pageSortOldestFirst, generation = 0, destroyed = false;
  const adopted = new Map();
  const showMessage = (kind, text) => {
    if (!active) return;
    let node = active.messages[kind];
    if (!node) {
      node = make('p', text, kind === 'validation' || kind === 'error' ? 'bad' : 'muted');
      node.setAttribute('data-task-message', kind);
      active.messages[kind] = node;
      active.messageHost.append(node);
    } else node.textContent = text;
  };
  const clearMessage = kind => { active?.messages[kind]?.remove(); if (active) delete active.messages[kind]; };
  const renderRows = () => {
    rows.replaceChildren();
    const visible = new Map(tasks.map(task => [task.id, task]));
    for (const [id, { task, priorRevision }] of adopted) {
      const polled = visible.get(id);
      if (polled && (polled.revision === task.revision || polled.revision !== priorRevision)) adopted.delete(id);
      else visible.set(id, task);
    }
    for (const { task, createdAt, updatedAt } of orderedTaskRows(visible.values(), oldestFirst)) {
      const li = make('li', undefined, 'task-row');
      li.append(make('div', task.title ?? ''));
      li.append(make('div', `${translate('task.status')}: ${task.status ?? translate('common.unknown')}`, 'muted'));
      li.append(make('div', `${translate('task.branch')}: ${task.branch || translate('common.none')}`, 'muted'));
      li.append(make('div', `${translate('task.owner')}: ${task.owner || translate('dashboard.unassigned')}`, 'muted'));
      li.append(make('div', `${translate('task.created')}: ${createdAt === null ? translate('common.unknown') : task.created_at}`, 'muted'));
      li.append(make('div', `${translate('task.updated')}: ${updatedAt === null ? translate('common.unknown') : task.updated_at}`, 'muted'));
      if (writeToken && !active) li.append(button('task.edit', `edit-${task.id}`, () => start('edit', task)));
      rows.append(li);
    }
    if (!visible.size) rows.append(make('li', translate('common.none'), 'muted'));
  };
  const renderToolbar = () => {
    toolbar.replaceChildren(button(oldestFirst ? 'task.newest' : 'task.oldest', 'sort', () => { oldestFirst = !oldestFirst; pageSortOldestFirst = oldestFirst; renderToolbar(); renderRows(); }));
    if (writeToken && !active) toolbar.append(button('task.add', 'add', () => start('add')));
  };
  const cancel = () => { generation++; active = null; formHost.replaceChildren(); renderToolbar(); renderRows(); };
  const start = (mode, record = null) => {
    if (active || !writeToken) return;
    const form = make('form', undefined, 'task-form');
    form.onsubmit = event => { event.preventDefault(); save(); };
    const title = make('input'); title.value = record?.title ?? ''; title.maxLength = 300; title.setAttribute('data-task-field', 'title');
    const status = make('select'); status.setAttribute('data-task-field', 'status');
    for (const value of STATUSES) { const option = make('option', translate(`task.status.${value}`)); option.value = value; status.append(option); }
    status.value = record?.status ?? 'pending';
    const branch = make('input'); branch.value = record?.branch ?? ''; branch.maxLength = 120; branch.setAttribute('data-task-field', 'branch');
    for (const [label, control] of [['task.title', title], ['task.status', status], ['task.branch', branch]]) {
      const wrapper = make('label', translate(label)); wrapper.append(control); form.append(wrapper);
    }
    const messageHost = make('div'); form.append(messageHost);
    form.append(button('task.save', 'save', save), button('task.cancel', 'cancel', cancel));
    active = { mode, id: record?.id, originalRevision: record?.revision, fields: { title, status, branch }, messages: {}, messageHost, form, conflict: null };
    formHost.replaceChildren(form); renderToolbar(); renderRows(); title.focus?.();
  };
  async function save() {
    if (!active || !writeToken || active.conflict || active.saving) return;
    const draft = active;
    const title = draft.fields.title.value.trim(), branch = draft.fields.branch.value.trim();
    if (!title || title.length > 300) { showMessage('validation', translate('task.invalidTitle')); return; }
    if (branch.length > 120 || (branch && /[\u0000-\u001f\u007f]/.test(branch))) { showMessage('validation', translate('task.invalidBranch')); return; }
    clearMessage('validation'); clearMessage('error');
    draft.saving = true;
    const requestId = ++generation;
    const body = { title, status: draft.fields.status.value, branch: branch || null };
    if (draft.mode === 'edit') body.revision = draft.originalRevision;
    const url = draft.mode === 'add' ? '/runtime/tasks' : `/runtime/tasks/${encodeURIComponent(draft.id)}`;
    try {
      const response = await fetchImpl(url, { method: draft.mode === 'add' ? 'POST' : 'PUT', headers: { 'content-type': 'application/json', 'x-task-write-token': writeToken }, body: JSON.stringify(body) });
      if (destroyed || requestId !== generation || active !== draft) return;
      const result = await response.json();
      if (destroyed || requestId !== generation || active !== draft) return;
      if (response.status === 409 && result.current) {
        draft.conflict = result.current;
        showMessage('conflict', `${translate('task.conflict')}: ${result.current.status} — ${result.current.title} — ${result.current.branch || translate('common.none')}`);
        if (!draft.reloadButton) { draft.reloadButton = button('task.reload', 'reload', () => { const current = draft.conflict; cancel(); start('edit', current); }); draft.messageHost.append(draft.reloadButton); }
      } else if (!response.ok) showMessage('error', translate('task.saveFailed'));
      else { adopted.set(result.id, { task: result, priorRevision: draft.originalRevision ?? null }); cancel(); }
    } catch {
      if (destroyed || requestId !== generation || active !== draft) return;
      showMessage('error', translate('task.networkError'));
      if (!draft.retryButton) { draft.retryButton = button('task.retry', 'retry', save); draft.messageHost.append(draft.retryButton); }
    } finally { draft.saving = false; }
  }
  return {
    update(nextTasks, nextToken) { if (destroyed) return; tasks = Array.isArray(nextTasks) ? nextTasks : []; writeToken = nextToken || null; renderToolbar(); renderRows(); },
    destroy() { destroyed = true; generation++; active = null; host.replaceChildren(); }
  };
}
