import { element } from './library-home-view.js';
import { button, table, selectField, pager } from './viewer-view.js';
import { buildYieldLots, createYieldViewState, filteredYieldLots, sortedYieldLots, yieldTrendPoints, lotDeviceOptions, recordedTime } from './viewer-yield-model.js';

export { createYieldViewState };
const number = (value) => Number(value ?? 0).toLocaleString();
const percent = (value) => value == null ? '—' : `${value.toFixed(2)}%`;
const present = (value) => value == null || value === '' ? 'Not recorded' : String(value);
const lotName = (lot) => lot.lotId || `No lot ID · ${lot.files[0].sourceName}`;
const utc = (value) => recordedTime(value) == null ? 'Not recorded' : new Date(value * 1000).toISOString().replace('T', ' ').slice(0, 19);
const svgElement = (name, attributes = {}, text) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};
function identity(main, secondary) {
  const cell = element('span', undefined, 'yield-identity');
  cell.append(typeof main === 'string' ? element('span', main) : main);
  if (secondary) cell.append(element('small', secondary));
  return cell;
}
function countControl(value, outcome, lot, onDevices, extra = {}, label = lotName(lot)) {
  const control = button(number(value), () => onDevices(lotDeviceOptions(lot, outcome, extra), label), 'yield-count');
  control.setAttribute('aria-label', `Show ${outcome || 'all'} devices for ${label}: ${number(value)}`);
  control.disabled = !value;
  return control;
}
function countColumns(lotOf, onDevices, extraOf = () => ({}), labelOf = lotName) {
  return [['total', 'Recorded', undefined], ['passed', 'Pass', 'pass'], ['failed', 'Fail', 'fail'], ['unknown', 'Unknown', 'unknown']]
    .map(([key, label, outcome]) => ({ label, sortKey: key, numeric: true, value: (row) => countControl(row[key], outcome, lotOf(row), onDevices, extraOf(row), labelOf(row)),
      className: (row) => key === 'failed' && row.failed > 0 ? 'yield-fail' : 'yield-neutral' }));
}
function heading(container, title, text) {
  const section = element('section', undefined, 'yield-section'), h = element('h3', title);
  section.append(h); if (text) section.append(element('p', text, 'viewer-help'));
  container.append(section); return section;
}
function sortControls(viewState, refresh) {
  return { sort: viewState.sort, direction: viewState.direction, onSort: (key) => {
    viewState.direction = viewState.sort === key && viewState.direction === 'asc' ? 'desc' : 'asc';
    viewState.sort = key; refresh(`[data-yield-sort="${key}"]`);
  } };
}
function markSortButtons(wrap, columns) {
  for (const [index, header] of [...wrap.querySelectorAll('thead tr:first-child th')].entries()) {
    if (columns[index].sortKey) header.querySelector('button').dataset.yieldSort = columns[index].sortKey;
  }
}

function renderTrend(container, lots, selectedKey, chooseLot, addChart) {
  const points = yieldTrendPoints(lots), files = lots.flatMap((lot) => lot.files), section = heading(container, 'File yield over time');
  const plot = element('div', undefined, 'yield-trend-wrap'); section.append(plot);
  if (!points.length) plot.append(element('p', 'No files have both a recorded start time and a known outcome.', 'yield-empty'));
  const draw = () => {
    if (!points.length) return;
    const focusedPoint = plot.contains(document.activeElement) ? document.activeElement.dataset?.yieldPoint : null;
    const width = Math.max(250, Math.round(plot.getBoundingClientRect().width)), height = 190;
    const left = 44, right = width - 12, top = 14, bottom = height - 42;
    const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'yield-trend', role: 'group', 'aria-label': 'File yield by recorded start time in UTC. Select a point to review its lot.' });
    const start = points[0].time, end = points.at(-1).time, singleTime = start === end;
    for (const value of [0, 25, 50, 75, 100]) {
      const y = bottom - value / 100 * (bottom - top);
      svg.append(svgElement('line', { x1: left, x2: right, y1: y, y2: y, class: 'yield-grid' }));
      svg.append(svgElement('text', { x: left - 7, y: y + 4, 'text-anchor': 'end', class: 'yield-axis' }, `${value}%`));
    }
    const tickCount = singleTime ? 1 : width < 420 ? 2 : 3;
    for (let i = 0; i < tickCount; i++) {
      const fraction = singleTime ? .5 : i / (tickCount - 1), time = start + fraction * (end - start), x = left + fraction * (right - left);
      const stamp = new Date(time * 1000).toISOString();
      const label = svgElement('text', { x, y: bottom + 18, 'text-anchor': singleTime ? 'middle' : i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle', class: 'yield-axis' });
      label.append(svgElement('tspan', { x }, stamp.slice(0, 10)));
      if (end - start < 172800) label.append(svgElement('tspan', { x, dy: 13 }, stamp.slice(11, end - start < 120 ? 19 : 16)));
      svg.append(label);
    }
    // Files are independent observations. No segment implies a measured value
    // between times, or connects unrelated groups, products or test programs.
    for (const point of [...points].sort((a, b) => Number(a.lotKey === selectedKey) - Number(b.lotKey === selectedKey))) {
      const x = left + (singleTime ? .5 : (point.time - start) / (end - start)) * (right - left), y = bottom - point.yield / 100 * (bottom - top);
      const description = `${point.sourceName} · ${point.groupName} · ${utc(point.time)} UTC · ${percent(point.yield)}`;
      const mark = svgElement('circle', { cx: x, cy: y, r: 5, tabindex: 0, role: 'button', class: point.lotKey === selectedKey ? 'yield-point is-selected' : 'yield-point',
        'aria-label': description, 'data-yield-point': point.key });
      mark.append(svgElement('title', {}, description));
      mark.addEventListener('click', () => chooseLot(point.lotKey));
      mark.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseLot(point.lotKey); } });
      svg.append(mark);
    }
    plot.replaceChildren(svg);
    if (focusedPoint != null) [...svg.querySelectorAll('[data-yield-point]')].find((point) => point.dataset.yieldPoint === focusedPoint)?.focus({ preventScroll: true });
  };
  draw();
  if (addChart) {
    const observer = new ResizeObserver(() => draw()); observer.observe(plot);
    addChart({ destroy: () => observer.disconnect() });
  }
  section.append(element('p', 'Recorded start (UTC). One point per file. The selected lot is teal.', 'viewer-help'));
  const noTime = files.filter((file) => recordedTime(file.startTime) == null).length;
  const noOutcome = files.filter((file) => !(file.passed + file.failed)).length;
  const missing = (value, text) => value ? `${number(value)} ${value === 1 ? 'file has' : 'files have'} ${text}.` : '';
  if (noTime || noOutcome) section.append(element('p', [missing(noTime, 'no recorded start time'), missing(noOutcome, 'no known outcome')].filter(Boolean).join(' '), 'viewer-help'));
  return section;
}

function renderFiles(container, lots, onDevices, { collapsed = true, label = 'File yields' } = {}) {
  const files = lots.flatMap((lot) => lot.files.map((file) => ({ ...file, lot, yield: file.passed + file.failed ? 100 * file.passed / (file.passed + file.failed) : null })))
    .sort((a, b) => (recordedTime(a.startTime) ?? Infinity) - (recordedTime(b.startTime) ?? Infinity) || a.key.localeCompare(b.key));
  const box = collapsed ? element('details', undefined, 'yield-files') : element('section', undefined, 'yield-files');
  box.append(element(collapsed ? 'summary' : 'h3', `${label} (${number(files.length)})`));
  const fileLot = (row) => ({ ...row.lot, datasetIds: [row.datasetId] });
  const columns = [
    { label: 'File', wrap: true, value: (row) => identity(row.sourceName, `${present(row.lot.lotId)} · ${present(row.groupName)}`) },
    { label: 'Recorded start (UTC)', value: (row) => utc(row.startTime) },
    { label: 'Yield', numeric: true, value: (row) => percent(row.yield) },
    ...countColumns(fileLot, onDevices, () => ({}), (row) => row.sourceName),
    { label: 'Tester', value: (row) => present(row.tester) },
  ];
  table(box, columns, files, { label }).classList.add('yield-file-table');
  container.append(box);
}
function renderLotDetail(container, lot, viewState, refresh, onDevices) {
  const detail = element('div', undefined, 'yield-lot-detail');
  detail.dataset.yieldDetail = lot.key;
  const name = element('h3', lotName(lot)); name.tabIndex = -1; name.dataset.yieldDetailTitle = '';
  detail.append(name, element('p', `${present(lot.groupName)} · ${present(lot.product)} · ${present(lot.program)} · Revision ${present(lot.revision)}`, 'viewer-help'));
  const metadata = [['Sublot', lot.sublotId], ['Flow', lot.flow], ['Stage', lot.stage]].filter(([, value]) => value);
  if (metadata.length) detail.append(element('p', metadata.map(([key, value]) => `${key} ${value}`).join(' · '), 'viewer-help'));
  const toolbar = element('div', undefined, 'yield-bin-heading');
  toolbar.append(element('h4', 'Failing bins'));
  selectField(toolbar, 'Bin type', [['soft', 'Software'], ['hard', 'Hardware']], viewState.binKind, (value) => { viewState.binKind = value; viewState.binOffset = 0; refresh('[data-yield-bins]'); }).dataset.yieldBins = '';
  detail.append(toolbar);
  const bins = lot[viewState.binKind === 'hard' ? 'hardBins' : 'softBins'].filter((bin) => bin.failed > 0);
  if (!lot.failed) detail.append(element('p', 'No failed devices in this lot.', 'yield-empty'));
  else {
    const columns = [
      { label: 'Bin', value: (row) => row.number === 65535 ? 'Not recorded' : number(row.number) },
      { label: 'Failed devices', numeric: true, value: (row) => countControl(row.failed, 'fail', lot, onDevices,
        { bin: { kind: viewState.binKind, number: row.number } }, `${lotName(lot)} · ${viewState.binKind === 'hard' ? 'hardware' : 'software'} bin ${row.number === 65535 ? 'not recorded' : row.number}`) },
      { label: 'Share of all failures', numeric: true, value: (row) => percent(100 * row.failed / lot.failed) },
    ];
    const page = breakdownPage(bins, viewState, 'binOffset');
    table(detail, columns, page.items, { label: `Failing ${viewState.binKind === 'hard' ? 'hardware' : 'software'} bins` }).classList.add('yield-bin-table');
    breakdownPager(detail, page, viewState, 'binOffset', 'failing bins', refresh);
  }
  container.append(detail);
}
function breakdownPage(rows, viewState, field) {
  const offset = Math.min(Math.max(0, viewState[field] ?? 0), Math.max(0, Math.ceil(rows.length / 50) - 1) * 50);
  viewState[field] = offset;
  return { items: rows.slice(offset, offset + 50), total: rows.length, offset, nextOffset: offset + 50 < rows.length ? offset + 50 : null };
}
function breakdownPager(container, page, viewState, field, label, refresh) {
  if (page.total <= 50) return;
  const move = (offset) => { viewState[field] = offset; refresh(`[data-yield-page="${field}"]`); };
  const controls = pager(container, page, () => move(Math.max(0, page.offset - 50)), () => move(page.nextOffset));
  controls.dataset.yieldPage = field; controls.tabIndex = -1;
  controls.querySelectorAll('button').forEach((control, index) => control.setAttribute('aria-label', `${index ? 'Next' : 'Previous'} ${label}`));
}
function renderSites(container, lot, onDevices, viewState, refresh) {
  const section = heading(container, 'Sites');
  const columns = [
    { label: 'Head / site', value: (row) => `${row.head} / ${row.site}` },
    { label: 'Yield', numeric: true, value: (row) => percent(row.yield) },
    ...countColumns(() => lot, onDevices, (row) => ({ pick: { type: 'bin', seriesKeys: [JSON.stringify([lot.group, row.head, row.site])] } }),
      (row) => `${lotName(lot)} · head ${row.head} / site ${row.site}`),
  ];
  const page = breakdownPage(lot.sites, viewState, 'siteOffset');
  table(section, columns, page.items, { label: 'Site yields for the selected lot' }).classList.add('yield-site-table');
  breakdownPager(section, page, viewState, 'siteOffset', 'sites', refresh);
}

export function renderYieldManager(container, { result, viewState, onChange, onDevices, onHelp, addChart }) {
  const lots = buildYieldLots(result.files), filtered = filteredYieldLots(lots, viewState), rows = sortedYieldLots(filtered, viewState);
  if (!rows.some((lot) => lot.key === viewState.detailKey)) { viewState.detailKey = sortedYieldLots(rows)[0]?.key ?? null; viewState.binOffset = 0; viewState.siteOffset = 0; }
  const selected = rows.find((lot) => lot.key === viewState.detailKey);
  const root = element('div', undefined, 'viewer-yield-manager'); container.replaceChildren(root);
  const refresh = (focus) => {
    const work = onChange();
    if (focus) Promise.resolve(work).then(() => container.querySelector(focus)?.focus({ preventScroll: true }));
  };
  const chooseLot = (key) => { viewState.detailKey = key; viewState.binOffset = 0; viewState.siteOffset = 0; refresh('[data-yield-detail-title]'); };
  const title = element('div', undefined, 'yield-heading');
  title.append(element('h2', 'Yield Manager'), button('Yield help', () => onHelp('yield'), 'quiet-button'));
  root.append(title);
  const toolbar = element('div', undefined, 'viewer-toolbar yield-toolbar'), search = element('form', undefined, 'yield-search');
  const label = element('label', 'Find lots'), input = element('input'); input.type = 'search'; input.value = viewState.query; input.dataset.yieldSearch = ''; input.setAttribute('aria-label', 'Find lots');
  const line = element('div', undefined, 'yield-search-line');
  const find = element('button', 'Find', 'button secondary'); find.type = 'submit'; line.append(input, find); label.append(line); search.append(label);
  search.addEventListener('submit', (event) => { event.preventDefault(); viewState.query = input.value; refresh('[data-yield-search]'); });
  input.addEventListener('search', () => { if (!input.value) { viewState.query = ''; refresh('[data-yield-search]'); } });
  toolbar.append(search);
  const groups = [...new Map(lots.map((lot) => [JSON.stringify(lot.group), present(lot.groupName)])).entries()];
  if (groups.length > 1) selectField(toolbar, 'Group', [['', 'All groups'], ...groups], viewState.group, (value) => { viewState.group = value; refresh('[data-yield-group]'); }).dataset.yieldGroup = '';
  const products = [...new Set(lots.map((lot) => lot.product))].sort((a, b) => a.localeCompare(b));
  if (products.length > 1) selectField(toolbar, 'Product', [['', 'All products'], ...products.map((product) => [JSON.stringify(product), present(product)])], viewState.product,
    (value) => { viewState.product = value; refresh('[data-yield-product]'); }).dataset.yieldProduct = '';
  if (viewState.query || viewState.group || viewState.product) toolbar.append(button('Clear filters', () => { viewState.query = ''; viewState.group = ''; viewState.product = ''; refresh('[data-yield-search]'); }, 'quiet-button'));
  root.append(toolbar);
  const fileCount = rows.reduce((sum, lot) => sum + lot.files.length, 0);
  const countLine = element('p', `${number(rows.length)} lot ${rows.length === 1 ? 'row' : 'rows'} · ${number(fileCount)} ${fileCount === 1 ? 'file' : 'files'}. Yield = Pass ÷ (Pass + Fail). Unknown outcomes are excluded.`, 'viewer-help yield-count-line');
  countLine.setAttribute('role', 'status'); root.append(countLine);
  if (result.reviewGroups?.length) {
    const names = [...new Set(result.reviewGroups)].map((group) => lots.find((lot) => lot.group === group)?.groupName || `Group ${group + 1}`);
    const notice = element('p', `Check group scope: ${names.join(', ')}. Use separate groups for independent lots. Current attempts can replace records across lot or program labels.`, 'viewer-warning yield-scope-warning');
    root.append(notice);
  }
  const columns = [
    { label: 'Lot', sortKey: 'lotId', wrap: true, value: (lot) => {
      const control = button(lotName(lot), () => chooseLot(lot.key), 'yield-open-lot'); control.dataset.yieldLot = lot.key;
      control.setAttribute('aria-pressed', String(lot.key === viewState.detailKey));
      return identity(control, [lot.groupName, lot.sublotId ? `Sublot ${lot.sublotId}` : '', lot.flow, lot.stage ? `Stage ${lot.stage}` : ''].filter(Boolean).join(' · '));
    } },
    { label: 'Product / program', sortKey: 'product', wrap: true, value: (lot) => identity(present(lot.product), `${present(lot.program)} · Rev ${present(lot.revision)}`) },
    { label: 'Yield', sortKey: 'yield', numeric: true, value: (lot) => percent(lot.yield) },
    ...countColumns((lot) => lot, onDevices),
    { label: 'Recorded start (UTC)', sortKey: 'startTime', value: (lot) => utc(lot.startTime) },
  ];
  const wrap = table(root, columns, rows, { label: 'Lot yields', rowClass: (lot) => lot.key === viewState.detailKey ? 'yield-selected-row' : '', ...sortControls(viewState, refresh) });
  wrap.classList.add('yield-lot-table'); markSortButtons(wrap, columns);
  const scopeNotes = () => {
    if (!result.warnings?.length) return;
    const notes = element('details', undefined, 'yield-scope-notes'); notes.append(element('summary', 'Scope notes'));
    for (const warning of result.warnings) notes.append(element('p', warning, 'viewer-help'));
    root.append(notes);
  };
  if (!selected) {
    root.append(element('p', lots.length ? 'No lots match these filters.' : 'No device attempts are available in this selection.', 'yield-empty'));
    scopeNotes();
    return;
  }
  const grid = element('div', undefined, 'yield-detail-grid'); root.append(grid);
  renderLotDetail(grid, selected, viewState, refresh, onDevices);
  const trend = renderTrend(grid, filtered, viewState.detailKey, chooseLot, addChart); renderFiles(trend, filtered, onDevices);
  renderSites(root, selected, onDevices, viewState, refresh);
  renderFiles(root, [selected], onDevices, { label: 'Files in the selected lot' });
  scopeNotes();
}
