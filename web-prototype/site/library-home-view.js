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
export function renderRows(rows) {
  const fragment = document.createDocumentFragment();
  for (const dataset of rows) {
    const row = element('tr'); row.dataset.id = dataset.id;
    const fileCell = element('td'), file = element('div', undefined, 'file-cell');
    const glyph = element('span', undefined, 'file-glyph'); glyph.append(icon('file'));
    const copy = element('div'), name = element('button', dataset.name, 'file-name');
    name.type = 'button'; name.dataset.datasetId = dataset.id;
    const caption = dataset.relative_path !== dataset.name ? dataset.relative_path : `${count(dataset.manifest.counts.devices)} device attempts`;
    copy.append(name, element('small', caption, 'file-meta')); file.append(glyph, copy); fileCell.append(file);
    const status = element('span', dataset.status === 'ready' ? 'Ready' : 'Needs attention', `status-pill ${dataset.status === 'ready' ? 'ready' : 'unavailable'}`);
    const statusCell = element('td'); statusCell.append(status);
    const actionCell = element('td'), action = element('button', undefined, 'icon-button row-open');
    action.type = 'button'; action.dataset.datasetId = dataset.id;
    action.setAttribute('aria-label', `Open ${dataset.name}`); action.append(icon('right')); actionCell.append(action);
    row.append(fileCell, element('td', count(dataset.manifest.counts.measurements), 'number-cell'),
      element('td', bytes(dataset.source_bytes), 'number-cell'), element('td', date(dataset.created_at), 'date-cell'), statusCell, actionCell);
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
  for (const [label, value] of [['Measurements', counts.measurements], ['Device attempts', counts.devices], ['Test declarations', counts.definitions], ['Source records', counts.records]]) {
    const item = element('article'); item.append(element('small', label), element('strong', count(value))); grid.append(item);
  }
  const source = element('section', undefined, 'detail-section');
  source.append(element('h3', 'Saved source'), facts([['Original file', bytes(dataset.source_bytes)], ['Database', bytes(dataset.db_bytes)], ['Location', 'This browser · this device']]));
  const coverage = element('section', undefined, 'detail-section detail-coverage');
  coverage.append(element('h3', 'What’s preserved'), element('p', 'Every source record, device attempt and repeated measurement is retained. Your original STDF is saved alongside this dataset.'));
  const families = dataset.manifest.coverage?.measurement_families;
  coverage.append(element('p', `Measurement rows: ${Array.isArray(families) && families.length ? families.join(', ') : 'None declared'}. Other record families are available in the original source.`, 'muted'));
  const identity = element('details', undefined, 'fingerprint');
  identity.append(element('summary', 'File fingerprint'), element('p', 'This content fingerprint identifies duplicate files, even after a rename.'), element('code', dataset.source_hash));
  const viewer = element('a', 'Open data viewer', 'button primary');
  viewer.href = `./viewer.html?dataset=${encodeURIComponent(dataset.id)}`;
  viewer.append(icon('right'));
  const explore = element('a', 'Explore tests', 'button secondary');
  explore.href = `./explore.html?dataset=${encodeURIComponent(dataset.id)}`;
  explore.append(icon('right'));
  $('dataset-info').replaceChildren(viewer, explore, grid, source, coverage, identity);
}
