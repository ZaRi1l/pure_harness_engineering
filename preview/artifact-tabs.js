export function isEmbeddableArtifact(href, origin) {
  try {
    const url = new URL(String(href), origin);
    return url.origin === origin || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
  } catch {
    return false;
  }
}

function isOpenableArtifact(href, origin) {
  try {
    return ['http:', 'https:'].includes(new URL(String(href), origin).protocol);
  } catch {
    return false;
  }
}

function element(document, tagName, className = '', text = '') {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = text;
  return node;
}

let browserSequence = 0;

export function renderArtifactTabs(host, artifacts, options = {}) {
  const document = host.ownerDocument;
  const origin = options.origin || document.defaultView?.location?.origin || 'http://127.0.0.1';
  const records = (Array.isArray(artifacts) ? artifacts : [])
    .map(artifact => ({ label: String(artifact?.label || artifact?.href || 'UI artifact'), href: String(artifact?.href || '') }))
    .filter(artifact => artifact.href);

  host.replaceChildren();
  if (!records.length) {
    host.append(element(document, 'p', 'artifact-empty muted', 'No UI artifacts registered.'));
    return { selectedHref: '' };
  }

  let selectedIndex = Math.max(0, records.findIndex(artifact => artifact.href === options.selectedHref));
  const root = element(document, 'div', 'artifact-browser');
  const tabs = element(document, 'div', 'artifact-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'UI artifact previews');
  const stage = element(document, 'section', 'artifact-stage');
  const browserId = `artifact-browser-${++browserSequence}`;
  stage.id = `${browserId}-panel`;
  stage.setAttribute('role', 'tabpanel');
  const tabButtons = [];

  function drawSelected() {
    const artifact = records[selectedIndex];
    const safe = isEmbeddableArtifact(artifact.href, origin);
    tabButtons.forEach((button, index) => {
      const selected = index === selectedIndex;
      button.className = selected ? 'artifact-tab active' : 'artifact-tab';
      button.setAttribute('aria-selected', String(selected));
      button.setAttribute('tabindex', selected ? '0' : '-1');
    });
    stage.setAttribute('aria-labelledby', tabButtons[selectedIndex].id);

    const toolbar = element(document, 'div', 'artifact-toolbar');
    const identity = element(document, 'div', 'artifact-identity');
    identity.append(element(document, 'strong', '', artifact.label), element(document, 'span', 'muted artifact-url', artifact.href));
    const actions = element(document, 'div', 'artifact-actions');
    const refresh = element(document, 'button', '', 'Refresh');
    refresh.type = 'button';
    refresh.dataset.action = 'refresh';
    refresh.disabled = !safe;
    const openable = isOpenableArtifact(artifact.href, origin);
    const open = element(document, openable ? 'a' : 'span', 'artifact-open', 'Open separately');
    open.dataset.action = 'open';
    if (openable) {
      open.href = artifact.href;
      open.target = '_blank';
      open.rel = 'noopener';
    } else {
      open.setAttribute('aria-disabled', 'true');
    }
    actions.append(refresh, open);
    toolbar.append(identity, actions);

    const viewport = element(document, 'div', 'artifact-viewport');
    if (safe) {
      const frame = element(document, 'iframe', 'artifact-frame');
      frame.src = artifact.href;
      frame.title = artifact.label;
      frame.setAttribute('sandbox', 'allow-scripts');
      refresh.onclick = () => { frame.src = artifact.href; };
      viewport.append(frame);
    } else {
      const message = openable
        ? 'This URL is not embedded by the Preview Lab safety policy. Use Open separately to inspect it.'
        : 'This URL scheme is not supported by the Preview Lab safety policy.';
      viewport.append(element(document, 'p', 'artifact-blocked muted', message));
    }
    stage.replaceChildren(toolbar, viewport);
  }

  records.forEach((artifact, index) => {
    const button = element(document, 'button', 'artifact-tab', artifact.label);
    button.type = 'button';
    button.id = `${browserId}-tab-${index}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', stage.id);
    const select = () => {
      selectedIndex = index;
      options.onSelect?.(artifact.href);
      drawSelected();
    };
    button.onclick = select;
    button.onkeydown = event => {
      const destinations = {
        ArrowRight: (index + 1) % records.length,
        ArrowLeft: (index - 1 + records.length) % records.length,
        Home: 0,
        End: records.length - 1
      };
      const destination = destinations[event.key];
      if (destination === undefined) return;
      event.preventDefault();
      tabButtons[destination].onclick();
      tabButtons[destination].focus();
    };
    tabButtons.push(button);
    tabs.append(button);
  });

  root.append(tabs, stage);
  host.append(root);
  drawSelected();
  return { get selectedHref() { return records[selectedIndex].href; } };
}
