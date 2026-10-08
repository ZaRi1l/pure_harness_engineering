/** Build the beginner decision guide. The caller supplies the current locale's translator. */
export function createGuidePanel({ document, translate }) {
  const root = document.createElement('section');
  root.className = 'guide-panel';
  const heading = document.createElement('h2');
  heading.textContent = translate('guide.choose');
  const choices = document.createElement('div');
  choices.className = 'guide-choices';
  const result = document.createElement('div');
  result.className = 'guide-selected';

  const paths = ['new', 'existing', 'connected'];
  const buttons = paths.map(path => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.guideChoice = path;
    button.textContent = translate(`guide.choice.${path}`);
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => {
      buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      const body = document.createElement('p');
      body.textContent = translate(`guide.${path}.body`);
      const children = [body];
      if (path !== 'existing') {
        const commands = document.createElement('pre');
        commands.textContent = translate(`guide.${path}.commands`);
        children.push(commands);
      }
      result.replaceChildren(...children);
      result.dataset.guideSelected = 'true';
    };
    return button;
  });
  choices.append(...buttons);

  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = translate('guide.note');
  root.append(heading, choices, note, result);

  for (const [labelKey, bodyKey] of [
    ['guide.advanced', 'guide.body'],
    ['guide.networkAdvanced', 'guide.networkBody']
  ]) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = translate(labelKey);
    const body = document.createElement('div');
    body.innerHTML = translate(bodyKey);
    details.append(summary, body);
    root.append(details);
  }
  return root;
}
