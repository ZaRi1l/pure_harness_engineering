export function artifactUrlPolicy(href, origin) {
  try {
    const url = new URL(String(href), origin);
    const credentialed = Boolean(url.username || url.password);
    const openable = !credentialed && ['http:', 'https:'].includes(url.protocol);
    return {
      openable,
      credentialed,
      embeddable: openable && (url.origin === origin || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
    };
  } catch {
    return { openable: false, credentialed: false, embeddable: false };
  }
}

export const isEmbeddableArtifact = (href, origin) => artifactUrlPolicy(href, origin).embeddable;

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
  const fallback = {
    'artifacts.empty': 'No UI artifacts registered.',
    'artifacts.tabsLabel': 'UI artifact previews',
    'artifacts.refresh': 'Refresh',
    'artifacts.open': 'Open separately',
    'artifacts.externalBlocked': 'This URL is not embedded by the Preview Lab safety policy. Use Open separately to inspect it.',
    'artifacts.schemeBlocked': 'This URL scheme is not supported by the Preview Lab safety policy.',
    'artifacts.credentialsBlocked': 'URLs containing credentials cannot be opened by the Preview Lab.',
    'artifacts.urlHidden': 'URL hidden for safety'
  };
  const t = key => options.translate?.(key) ?? fallback[key] ?? key;
  const records = (Array.isArray(artifacts) ? artifacts : [])
    .map(artifact => {
      const href = String(artifact?.href || '');
      const policy = artifactUrlPolicy(href, origin);
      return { label: policy.openable ? String(artifact?.label || href || 'UI artifact') : t('artifacts.urlHidden'), href, ...policy };
    })
    .filter(artifact => artifact.href);

  host.replaceChildren();
  if (!records.length) {
    host.append(element(document, 'p', 'artifact-empty muted', t('artifacts.empty')));
    return { selectedHref: '' };
  }

  let selectedIndex = Math.max(0, records.findIndex(artifact => artifact.href === options.selectedHref));
  const root = element(document, 'div', 'artifact-browser');
  const tabs = element(document, 'div', 'artifact-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', t('artifacts.tabsLabel'));
  const stage = element(document, 'section', 'artifact-stage');
  const browserId = `artifact-browser-${++browserSequence}`;
  stage.id = `${browserId}-panel`;
  stage.setAttribute('role', 'tabpanel');
  const tabButtons = [];

  function drawSelected() {
    const artifact = records[selectedIndex];
    const safe = artifact.embeddable;
    tabButtons.forEach((button, index) => {
      const selected = index === selectedIndex;
      button.className = selected ? 'artifact-tab active' : 'artifact-tab';
      button.setAttribute('aria-selected', String(selected));
      button.setAttribute('tabindex', selected ? '0' : '-1');
    });
    stage.setAttribute('aria-labelledby', tabButtons[selectedIndex].id);

    const toolbar = element(document, 'div', 'artifact-toolbar');
    const identity = element(document, 'div', 'artifact-identity');
    identity.append(element(document, 'strong', '', artifact.label), element(document, 'span', 'muted artifact-url', artifact.openable ? artifact.href : t('artifacts.urlHidden')));
    const actions = element(document, 'div', 'artifact-actions');
    const refresh = element(document, 'button', '', t('artifacts.refresh'));
    refresh.type = 'button';
    refresh.dataset.action = 'refresh';
    refresh.disabled = !safe;
    const openable = artifact.openable;
    const open = element(document, openable ? 'a' : 'span', 'artifact-open', t('artifacts.open'));
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
      const message = artifact.credentialed ? t('artifacts.credentialsBlocked')
        : openable ? t('artifacts.externalBlocked') : t('artifacts.schemeBlocked');
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
