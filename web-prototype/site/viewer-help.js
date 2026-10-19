import { VIEWER_HELP_TOPICS, VIEWER_HELP_BY_ID } from './viewer-help-content.js';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

/** Create one local, read-only help panel. getTopic returns a tab or tool ID. */
export function installViewerHelp({ getTopic = () => 'overview' } = {}) {
  const dialog = node('dialog', undefined, 'viewer-help-drawer');
  dialog.id = 'viewer-help-dialog';
  dialog.lang = 'en';
  dialog.setAttribute('aria-labelledby', 'viewer-help-title');
  const frame = node('div', undefined, 'viewer-help-frame');
  const header = node('header', undefined, 'viewer-help-heading');
  header.append(node('span', 'Help', 'viewer-help-label'));
  const closeButton = node('button', 'Close', 'button');
  closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close help');
  header.append(closeButton);
  const navigation = node('div', undefined, 'viewer-help-navigation');
  const label = node('label', 'Topic'); label.htmlFor = 'viewer-help-topic';
  const select = node('select'); select.id = 'viewer-help-topic';
  for (const groupName of new Set(VIEWER_HELP_TOPICS.map(topic => topic.group))) {
    const group = node('optgroup'); group.label = groupName;
    for (const topic of VIEWER_HELP_TOPICS.filter(item => item.group === groupName)) {
      const option = node('option', topic.title); option.value = topic.id; group.append(option);
    }
    select.append(group);
  }
  navigation.append(label, select);
  const content = node('article', undefined, 'viewer-help-content');
  const title = node('h2'); title.id = 'viewer-help-title'; title.tabIndex = -1;
  frame.append(header, navigation, content); dialog.append(frame); document.body.append(dialog);
  let returnFocus = null, destroyed = false;

  function section(heading, values, ordered = false) {
    if (!values?.length) return;
    const block = node('section'); block.append(node('h3', heading));
    const list = node(ordered ? 'ol' : 'ul');
    for (const value of values) list.append(node('li', value));
    block.append(list); content.append(block);
  }

  function render(id, focusTitle = false) {
    const topic = VIEWER_HELP_BY_ID.get(id) ?? VIEWER_HELP_BY_ID.get('overview');
    select.value = topic.id; dialog.dataset.topic = topic.id;
    title.textContent = topic.title;
    content.replaceChildren(title, node('p', topic.purpose, 'viewer-help-purpose'));
    section('Steps', topic.steps, true);
    section('Read the result', topic.results);
    if (topic.terms) {
      const definitions = node('dl', undefined, 'viewer-help-definitions');
      for (const [term, definition] of topic.terms) definitions.append(node('dt', term), node('dd', definition));
      content.append(definitions);
    }
    section('Limits', topic.limits);
    if (topic.related?.length) {
      const related = node('nav', undefined, 'viewer-help-related'); related.setAttribute('aria-label', 'Related help topics');
      related.append(node('h3', 'Related topics'));
      const links = node('div');
      for (const id of topic.related) {
        const target = VIEWER_HELP_BY_ID.get(id); if (!target) continue;
        const button = node('button', target.title, 'button'); button.type = 'button';
        button.addEventListener('click', () => render(id, true)); links.append(button);
      }
      related.append(links); content.append(related);
    }
    content.scrollTop = 0;
    if (focusTitle) title.focus({ preventScroll: true });
  }

  function close() { if (dialog.open) dialog.close(); }
  closeButton.addEventListener('click', close);
  select.addEventListener('change', () => render(select.value));
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });
  // Keep both ends of the keyboard sequence inside the modal, including its heading.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled), select:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === title)) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === title)) {
      event.preventDefault(); first?.focus();
    }
  });

  return {
    open(topic) {
      if (destroyed) return;
      const wasOpen = dialog.open;
      if (!wasOpen) returnFocus = document.activeElement;
      render(topic ?? getTopic());
      if (!wasOpen) dialog.showModal();
      title.focus({ preventScroll: true });
    },
    close,
    destroy() { if (destroyed) return; close(); dialog.remove(); destroyed = true; },
  };
}
