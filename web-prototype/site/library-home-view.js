import { libraryGroup, LIBRARY_SELECTION_LIMIT, testDate, testMetadata } from './library-organize.js';

export const $ = (id) => document.getElementById(id);
export const count = (value) => Number(value ?? 0).toLocaleString();
export function bytes(value) {
  if (!Number.isFinite(value)) return 'Unavailable';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = value > 0 ? Math.min(4, Math.floor(Math.log(value) / Math.log(1024))) : 0;
  return `${(value / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}
export function date(value, detailed = false) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleString(undefined,
    detailed ? { dateStyle: 'medium', timeStyle: 'short' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const paths = {
  library: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z M8 12l3 3 5-6',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  plus: 'M12 5v14 M5 12h14', search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  refresh: 'M20 8a8 8 0 1 0 0 8 M20 3v5h-5',
  chevron: 'm8 10 4 4 4-4', left: 'm14 6-6 6 6 6', right: 'M4 12h16 m-6-6 6 6-6 6',
  close: 'm6 6 12 12 M6 18 18 6', lock: 'M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0v3',
  file: 'M14 2H5v20h14V7z M14 2v6h5 M8 13h8 M8 17h6',
  upload: 'M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6',
  fingerprint: 'M4 11a8 8 0 0 1 16 0 M7 14v-3a5 5 0 0 1 10 0v4 M10 17v-6a2 2 0 0 1 4 0v7 M4 15v3 M7 18v3 M17 19v2 M20 14v4 M10 21v-1',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] ?? paths.file);
  svg.append(path);
  return svg;
}
export function hydrateIcons() {
  document.querySelectorAll('[data-icon]').forEach((node) => node.replaceChildren(icon(node.dataset.icon)));
}
export function renderRows(rows, { selectedIds = new Set(), groupBy = 'none', groups = new Map() } = {}) {
  const fragment = document.createDocumentFragment();
  let previousGroup;
  for (const dataset of rows) {
    const metadata = testMetadata(dataset), group = libraryGroup(dataset, groupBy);
    if (groupBy !== 'none' && group.key !== previousGroup) {
      previousGroup = group.key;
      const items = groups.get(group.key)?.items ?? [], ready = items.filter(item => item.status === 'ready');
      const allSelected = ready.length > 0 && ready.every(item => selectedIds.has(item.id));
      const available = ready.filter(item => !selectedIds.has(item.id)).length;
      const headingRow = element('tr', undefined, 'library-group-row'), heading = element('th');
      heading.colSpan = 8; heading.scope = 'rowgroup';
      const content = element('div', undefined, 'library-group-heading');
      const caption = element('span', group.label);
      caption.append(element('small', ` ${count(items.length)} file${items.length === 1 ? '' : 's'}`));
      const select = element('button', allSelected ? 'Deselect group' : 'Select group', 'quiet-button');
      select.type = 'button'; select.dataset.selectGroup = group.key;
      select.disabled = !ready.length || (!allSelected && selectedIds.size + available > LIBRARY_SELECTION_LIMIT);
      select.title = select.disabled ? `Select individual files. The Viewer accepts up to ${LIBRARY_SELECTION_LIMIT} files.` : `${allSelected ? 'Deselect' : 'Select'} ${ready.length} ready file${ready.length === 1 ? '' : 's'} in ${group.label}`;
      content.append(caption, select); heading.append(content); headingRow.append(heading); fragment.append(headingRow);
    }
    const row = element('tr'); row.dataset.id = dataset.id;
    const selectionCell = element('td', undefined, 'library-check-cell'), selectionLabel = element('label');
    const selection = document.createElement('input'); selection.type = 'checkbox'; selection.dataset.selectId = dataset.id;
    selection.checked = selectedIds.has(dataset.id);
    selection.disabled = dataset.status !== 'ready' || (!selection.checked && selectedIds.size >= LIBRARY_SELECTION_LIMIT);
    selection.setAttribute('aria-label', `Select ${dataset.name}`);
    selection.title = dataset.status !== 'ready' ? 'This file needs attention.' : `Select for Viewer (up to ${LIBRARY_SELECTION_LIMIT} files)`;
    selectionLabel.append(selection); selectionCell.append(selectionLabel);
    const fileCell = element('td'), file = element('div', undefined, 'file-cell');
    const glyph = element('span', undefined, 'file-glyph'); glyph.append(icon('file'));
    const copy = element('div'), name = element('button', dataset.name, 'file-name'); name.title = dataset.name;
    name.type = 'button'; name.dataset.datasetId = dataset.id;
    const caption = dataset.relative_path !== dataset.name ? dataset.relative_path : `${count(dataset.manifest.counts.devices)} device attempts`;
    copy.append(name, element('small', caption, 'file-meta')); file.append(glyph, copy); fileCell.append(file);
    const status = element('span', dataset.status === 'ready' ? 'Ready' : 'Needs attention', `status-pill ${dataset.status === 'ready' ? 'ready' : 'unavailable'}`);
    const statusCell = element('td'); statusCell.append(status);
    const actionCell = element('td'), action = element('button', 'Details', 'quiet-button row-open');
    action.type = 'button'; action.dataset.datasetId = dataset.id;
    action.setAttribute('aria-label', `Details for ${dataset.name}`); actionCell.append(action);
    const identityCell = element('td', undefined, 'library-identity-cell');
    const part = element('span', metadata.partNumber || '—'); part.title = metadata.partNumber || 'Part number not recorded';
    const lot = element('small', metadata.lotId || '—', 'file-meta'); lot.title = metadata.lotId ? `Lot ${metadata.lotId}` : 'Lot ID not recorded';
    identityCell.append(part, lot);
    const dateCell = element('td', testDate(dataset) || '—', 'date-cell library-test-date');
    dateCell.title = testDate(dataset, true) || metadata.warning || 'Test start time not recorded';
    row.append(selectionCell, fileCell, identityCell, dateCell, element('td', count(dataset.manifest.counts.measurements), 'number-cell'),
      element('td', bytes(dataset.source_bytes), 'number-cell'), statusCell, actionCell);
    fragment.append(row);
  }
  $('dataset-rows').replaceChildren(fragment);
}
function facts(entries) {
  const dl = element('dl', undefined, 'detail-facts');
  for (const [label, value] of entries) {
    const pair = element('div'); pair.append(element('dt', label), element('dd', value)); dl.append(pair);
  }
  return dl;
}
export function renderDataset(dataset) {
  $('dataset-name').textContent = dataset.name;
  $('dataset-subtitle').textContent = `Imported ${date(dataset.created_at, true)}`;
  const counts = dataset.manifest.counts;
  const grid = element('div', undefined, 'detail-grid');
  for (const [label, value] of [['PTR measurements', counts.measurements], ['Device attempts', counts.devices], ['PTR declarations', counts.definitions], ['Source records', counts.records]]) {
    const item = element('article'); item.append(element('small', label), element('strong', count(value))); grid.append(item);
  }
  const source = element('section', undefined, 'detail-section');
  source.append(element('h3', 'Saved source'), facts([['Original file', bytes(dataset.source_bytes)], ['Database', bytes(dataset.db_bytes)], ['Location', 'This browser · this device']]));
  const metadata = testMetadata(dataset), test = element('section', undefined, 'detail-section');
  test.append(element('h3', 'Test information'), facts([['Test start', testDate(dataset, true) || 'Not recorded'], ['Part number', metadata.partNumber || 'Not recorded'],
    ['Lot ID', metadata.lotId || 'Not recorded'], ['Sublot ID', metadata.sublotId || 'Not recorded'], ['Program', metadata.program || 'Not recorded'],
    ['Revision', metadata.revision || 'Not recorded'], ['Tester', metadata.tester || 'Not recorded']]));
  if (metadata.warning) test.append(element('p', metadata.warning, 'muted'));
  const coverage = element('details', undefined, 'detail-section detail-coverage');
  coverage.append(element('summary', 'Record coverage'));
  const families = dataset.manifest.coverage?.measurement_families;
  coverage.append(element('p', `Measurement rows: ${Array.isArray(families) && families.length ? families.join(', ') : 'None declared'}. Other record families are available in the original source.`, 'muted'));
  const identity = element('details', undefined, 'fingerprint');
  identity.append(element('summary', 'SHA-256'), element('code', dataset.source_hash));
  const viewer = element('a', 'Open data viewer', 'button primary');
  viewer.href = `./viewer.html?dataset=${encodeURIComponent(dataset.id)}`;
  viewer.append(icon('right'));
  const explore = element('a', 'Raw records', 'quiet-button');
  explore.href = `./explore.html?dataset=${encodeURIComponent(dataset.id)}`;
  explore.append(icon('right'));
  $('dataset-info').replaceChildren(viewer, explore, grid, test, source, coverage, identity);
}
