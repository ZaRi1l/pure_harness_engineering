(() => {
  'use strict';

  const entries = [
    { id: 'example', title: 'Task brief', description: 'A standalone work-item sketch', href: './tasks/example.html' },
  ];
  const tabs = document.getElementById('gallery-tabs');
  const frame = document.getElementById('gallery-frame');
  const open = document.getElementById('gallery-open');
  const status = document.getElementById('gallery-status');
  const buttons = new Map();

  const isSafeRelativeHtmlPath = value =>
    typeof value === 'string' && /^\.\/tasks\/[a-z0-9][a-z0-9-]*\.html$/.test(value);

  function select(id) {
    const entry = entries.find(item => item.id === id);
    if (!entry || !isSafeRelativeHtmlPath(entry.href)) return false;
    frame.src = entry.href;
    open.href = entry.href;
    status.textContent = `${entry.title} — ${entry.description}. If the embedded preview is blocked, open separately.`;
    for (const [buttonId, button] of buttons) {
      button.setAttribute('aria-selected', String(buttonId === id));
    }
    return true;
  }

  for (const entry of entries) {
    if (!isSafeRelativeHtmlPath(entry.href)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.title;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'gallery-frame');
    button.setAttribute('aria-selected', 'false');
    button.addEventListener('click', () => select(entry.id));
    tabs.append(button);
    buttons.set(entry.id, button);
  }

  window.PureOfflineGallery = { entries, isSafeRelativeHtmlPath, select };
  if (entries.length) select(entries[0].id);
})();
