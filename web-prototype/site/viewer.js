import { DataLibraryClient } from './data-client.js';
import { element, hydrateIcons } from './library-home-view.js';
import { validateSelection, parseTestKey } from './viewer-model.js';
import { loadSettings, validateSettings, saveSettings, applyFont, editSettings } from './viewer-settings.js';
import { editGroups } from './viewer-groups.js';
import { renderTrend, renderHistogram, renderBins, renderWafer } from './viewer-charts.js';
import { installViewerActions } from './viewer-actions.js';
import { $, fmt, hex, button, empty, section, detail, warnings, table, pager, selectField, testTitle, renderCatalog, renderOverview, renderStats, renderDevices, renderObservations, renderRecord } from './viewer-view.js';

const PAGE = 50, WORKSPACE_KEY = 'semidata.viewer.workspace.v1';
const state = { ready: false, opened: false, busy: false, datasets: [], selection: null, settings: loadSettings(), selected: new Map(),
  tab: 'overview', overview: null, catalog: { items: [], total: 0, offset: 0, nextOffset: null }, testQuery: '', testOrder: 'original', wildcard: false,
  seriesBy: 'aggregate', includeAggregate: false, deviceOffset: 0, deviceQuery: '', deviceSort: 'index', deviceDirection: 'asc', pick: null,
  recordOffset: 0, recordQuery: '', recordFamily: 'datalog', rawAfter: 0, rawHistory: [], rawSource: '', waferKey: 'stacked', waferBounds: null, binKind: 'soft', analyses: new Map(), health: new Map() };
let library, running = Promise.resolve(), retryWork = null, chartHandles = [], disposed = false, returnFocus = null, actionRunning = false;
let cancelRequested = false;
const dialogOpeners = new WeakMap();
const actions = {};
const actionButtons = [['viewer-export', 'export'], ['viewer-save-session', 'saveSession'], ['viewer-open-session', 'openSession'], ['viewer-manage-downloads', 'manageDownloads']];
function runAction(work) { return run(async () => { actionRunning = true; try { await work(); } finally { actionRunning = false; } }); }
function changed() {
  try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, selection: state.selection, tests: [...state.selected.keys()] })); } catch { /* Data operations remain usable when preference storage is full. */ }
  window.dispatchEvent(new CustomEvent('viewer-statechange', { detail: snapshot() }));
}
function snapshot() { return structuredClone({ selection: state.selection, settings: state.settings, tests: [...state.selected.keys()], tab: state.tab, seriesBy: state.seriesBy, includeAggregate: state.includeAggregate }); }
function disposeCharts() { chartHandles.forEach((chart) => chart.destroy()); chartHandles = []; }
function controls() {
  document.querySelectorAll('[data-ready]').forEach((el) => { el.disabled = !state.ready || state.busy; });
  $('viewer-tests-prev').disabled = !state.ready || state.busy || state.catalog.offset === 0;
  $('viewer-tests-next').disabled = !state.ready || state.busy || state.catalog.nextOffset == null;
  $('viewer-cancel').disabled = !state.busy; $('viewer-cancel').hidden = !state.busy;
  $('viewer-retry').disabled = state.busy;
  for (const [id, key] of actionButtons) $(id).disabled = !(['openSession', 'manageDownloads'].includes(key) ? state.opened : state.ready) || state.busy || typeof actions[key] !== 'function';
  $('main').setAttribute('aria-busy', String(state.busy));
  for (const id of ['viewer-panel', 'viewer-tests', 'viewer-selected', 'viewer-device-body', 'viewer-record-body']) $(id).inert = state.busy;
}
function showError(error) {
  $('viewer-error').hidden = false; $('viewer-error-text').textContent = error.code === 'BUSY' ? 'This browser library is open in another tab. Close that tab or return to it, then try again.' : error.message ?? String(error);
  $('connection-status').textContent = error.code === 'CANCELLED' ? 'Operation cancelled' : 'Needs attention';
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (dialog) {
    dialog.querySelector('[data-operation-error]')?.remove(); const notice = element('div', undefined, 'viewer-warning'); notice.dataset.operationError = ''; notice.setAttribute('role', 'alert');
    notice.append(element('p', error.message ?? String(error)), button('Try this view again', () => { notice.remove(); run(retryWork); })); dialog.append(notice);
  }
}
function run(work) {
  if (state.busy || disposed) return running;
  retryWork = work; state.busy = true; cancelRequested = false; $('viewer-error').hidden = true; $('viewer-progress').hidden = false;
  document.querySelectorAll('[data-operation-error]').forEach((notice) => notice.remove());
  $('viewer-progress-title').textContent = state.ready ? 'Reading your selection' : 'Opening local data'; $('viewer-progress-text').textContent = 'Processing locally. You can cancel without removing saved source data.';
  const active = document.activeElement, disabled = [];
  for (const el of document.querySelectorAll('#viewer-panel button,#viewer-panel input,#viewer-panel select,#viewer-tests input,#viewer-selected button,#viewer-device-body button,#viewer-record-body button')) { disabled.push([el, el.disabled]); el.disabled = true; }
  controls();
  running = (async () => {
    try { await work(); if (!disposed) $('connection-status').textContent = 'Ready · local data'; }
    catch (error) { if (!disposed) showError(error); }
    finally {
      state.busy = false;
      if (disposed) return;
      for (const [el, wasDisabled] of disabled) if (el.isConnected) el.disabled = wasDisabled;
      $('viewer-progress').hidden = true; controls();
      if (returnFocus) { restoreFocus(returnFocus); returnFocus = null; }
      else if (active && !active.isConnected) {
        const dialog = [...document.querySelectorAll('dialog[open]')].at(-1), scope = dialog ?? $('viewer-panel');
        const replacement = active.dataset?.testKey ? [...$('viewer-tests').querySelectorAll('input')].find((el) => el.dataset.testKey === active.dataset.testKey) : [...scope.querySelectorAll('button')].find((el) => el.textContent === active.textContent && !el.disabled);
        (replacement ?? scope.querySelector('.viewer-pager button:not(:disabled)') ?? dialog?.querySelector('button') ?? scope).focus();
      }
      else if (active?.isConnected && !active.disabled && !document.querySelector('dialog[open]') && (document.activeElement === document.body || document.activeElement === $('viewer-cancel'))) active.focus();
    }
  })();
  return running;
}
function checkCancelled() {
  if (state.busy && cancelRequested) throw Object.assign(new Error('Operation cancelled. No further requests will run for this operation.'), { code: 'CANCELLED' });
}
async function query(action, options = {}) {
  checkCancelled();
  const result = await library.viewer(action, state.selection, options);
  checkCancelled();
  return result;
}
function progress(value) {
  $('viewer-progress-title').textContent = value.phase === 'viewer-query' || value.phase === 'viewer-distribution' ? 'Reading full-population observations' : 'Preparing local analysis indexes';
  $('viewer-progress-text').textContent = [value.name, value.phase, value.rows != null ? `${value.rows.toLocaleString()} rows` : '', value.bytesRead != null ? `${value.bytesRead.toLocaleString()} bytes` : '', value.records != null ? `${value.records.toLocaleString()} records` : ''].filter(Boolean).join(' · ');
}
function renderFilterOptions() {
  for (const [id, choices, selected] of [['viewer-head', state.overview.heads, state.selection.heads], ['viewer-site', [...new Set(state.overview.sites.map((r) => r.site))], state.selection.sites]]) {
    const select = $(id); select.replaceChildren();
    for (const value of ['all', ...choices]) { const option = element('option', value === 'all' ? 'All' : String(value)); option.value = value; option.selected = value === 'all' ? !selected : selected?.includes(value); select.append(option); }
  }
  $('viewer-attempts').value = state.selection.attempts;
  $('viewer-subtitle').textContent = state.selection.groups.map((group) => `${group.name} (${group.datasetIds.length} file${group.datasetIds.length === 1 ? '' : 's'})`).join(' · ');
  $('viewer-raw').href = `./explore.html?dataset=${encodeURIComponent(state.selection.groups[0].datasetIds[0])}`;
}
function drawCatalog() {
  const activeKey = document.activeElement?.dataset?.testKey;
  for (const item of state.catalog.items) if (state.selected.has(item.key)) state.selected.set(item.key, item);
  renderCatalog(state.catalog, state.selected, (item, checked) => {
    if (state.busy) return;
    if (checked && state.selected.size >= 12) { showError(new Error('Select up to twelve tests at a time.')); drawCatalog(); return; }
    checked ? state.selected.set(item.key, item) : state.selected.delete(item.key); if (!checked) state.analyses.delete(item.key); changed(); drawCatalog(); run(renderPanel);
  }, (key) => { if (state.busy) return; state.selected.delete(key); state.analyses.delete(key); changed(); drawCatalog(); run(renderPanel); }, state.health, state.settings.cpkThreshold); controls();
  if (activeKey && !state.busy) [...$('viewer-tests').querySelectorAll('input')].find((el) => el.dataset.testKey === activeKey)?.focus();
}
async function loadCatalog(offset = 0) {
  state.catalog = await query('tests', { query: state.testQuery, wildcard: state.wildcard, order: state.testOrder, offset, limit: PAGE }); drawCatalog();
}
async function reloadWorkspace() {
  clearHealth(); state.analyses.clear(); state.deviceOffset = 0; state.recordOffset = 0; state.pick = null; disposeCharts();
  await query('prepare'); state.overview = await query('overview'); state.ready = true; renderFilterOptions();
  await loadCatalog(0); await renderPanel(); changed();
}
function clearHealth() { state.health.clear(); $('viewer-health-status').textContent = 'Scan all test identities for failures and low Cpk in the current population.'; }
async function scanHealth() {
  clearHealth(); let offset = 0, total = 0, complete = false;
  try {
    do {
      const catalog = await query('tests', { offset, limit: 200, order: 'original' }); total = catalog.total;
      for (const test of catalog.items) {
        if (cancelRequested) throw Object.assign(new Error('Test health scan cancelled. Completed markers remain labeled as a partial scan.'), { code: 'CANCELLED' });
        const result = await query('analyze', { testKey: test.key, bins: state.settings.bins, seriesBy: state.seriesBy, includeAggregate: state.includeAggregate });
        const cpks = result.series.map((s) => s.stats.cpk).filter(Number.isFinite);
        state.health.set(test.key, { fails: result.series.some((s) => s.stats.fail > 0), cpk: cpks.length ? Math.min(...cpks) : null });
        if (state.selected.has(test.key)) state.analyses.set(test.key, result);
        $('viewer-progress-title').textContent = 'Scanning test health'; $('viewer-progress-text').textContent = `${state.health.size.toLocaleString()} of ${total.toLocaleString()} test identities. Current heads, sites and attempt policy; full-population statistics.`;
      }
      offset = catalog.nextOffset;
    } while (offset != null);
    complete = true;
  } finally {
    $('viewer-health-status').textContent = `${complete ? 'Complete' : 'Partial'} scan: ${state.health.size.toLocaleString()} / ${total.toLocaleString()} identities · ${state.selection.attempts} attempts · selected heads/sites · Cpk < ${state.settings.cpkThreshold}. Cpk markers use the lowest defined series value.`;
    drawCatalog();
  }
}
async function getAnalyses() {
  const output = [];
  for (const key of state.selected.keys()) {
    if (!state.analyses.has(key)) state.analyses.set(key, await query('analyze', { testKey: key, bins: state.settings.bins, seriesBy: state.seriesBy, includeAggregate: state.includeAggregate }));
    output.push(state.analyses.get(key));
  }
  return output;
}
function colored(series) { return series.map((item) => ({ ...item, color: state.settings.siteColors[item.site ?? -1] })); }
function pickDevices(pick, options = {}) {
  if (state.busy) return;
  state.pick = { pick, ...options }; state.deviceOffset = 0; state.tab = 'devices'; run(renderPanel);
}
function addSearch(toolbar, label, value, change) {
  const form = element('form', undefined, 'viewer-toolbar'), field = element('label', label), input = element('input'); input.type = 'search'; input.maxLength = 128; input.value = value; field.append(input);
  const submit = element('button', 'Search', 'button secondary'); submit.type = 'submit'; form.append(field, submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); change(input.value); }); toolbar.append(form);
}
function drawDeviceToolbar(container, matrix) {
  const toolbar = element('div', undefined, 'viewer-toolbar'); container.append(toolbar);
  addSearch(toolbar, 'Part ID, part text or index', state.deviceQuery, (value) => { state.deviceQuery = value; state.deviceOffset = 0; run(renderPanel); });
  selectField(toolbar, 'Sort devices', [['index', 'Test order'], ['part', 'Part ID'], ['head', 'Head'], ['site', 'Site'], ['hard_bin', 'Hardware bin'], ['soft_bin', 'Software bin'], ['time', 'Test time'], ['tests', 'Test count'], ['status', 'Outcome'], ['x', 'X'], ['y', 'Y']], state.deviceSort, (value) => { state.deviceSort = value; state.deviceOffset = 0; run(renderPanel); });
  selectField(toolbar, 'Direction', [['asc', 'Ascending'], ['desc', 'Descending']], state.deviceDirection, (value) => { state.deviceDirection = value; state.deviceOffset = 0; run(renderPanel); });
  if (state.pick) { container.append(element('p', 'Showing a plot selection within the current source/head/site/attempt population.', 'viewer-help')); toolbar.append(button('Clear plot selection', () => { state.pick = null; state.deviceOffset = 0; run(renderPanel); })); }
  if (matrix) container.append(element('p', 'Values join by original device identity. Repeated executions remain separate; open a device to inspect every recorded result and flag.', 'viewer-help'));
}
async function drawDevices(container, matrix = false) {
  drawDeviceToolbar(container, matrix);
  const result = await query('devices', { offset: state.deviceOffset, limit: PAGE, query: state.deviceQuery, sort: state.deviceSort, direction: state.deviceDirection, ...(state.pick ?? {}), tests: matrix ? [...state.selected.keys()] : [] });
  renderDevices(container, result, matrix ? state.selected : new Map(), state.selection, openDevice, state.settings);
  pager(container, result, () => { state.deviceOffset = Math.max(0, state.deviceOffset - PAGE); run(renderPanel); }, () => { state.deviceOffset = result.nextOffset; run(renderPanel); });
}
function restoreFocus(target) {
  const dialogs = [...document.querySelectorAll('dialog[open]')], top = dialogs.at(-1);
  if (target?.isConnected && !target.disabled && (!top || top.contains(target))) target.focus();
  else (top?.querySelector('button') ?? $('viewer-panel')).focus();
}
function showDialog(id) { if (!$(id).open) { dialogOpeners.set($(id), document.activeElement); $(id).showModal(); } }
function openDevice(row, after = [0, -1], history = []) {
  if (!history.length) { $('viewer-device-title').textContent = row.part_id || `Attempt ${row.x_index}`; showDialog('viewer-device-dialog'); }
  run(async () => {
    const result = await query('device', { datasetId: row.dataset_id, deviceId: row.id, group: row.group_id, after, limit: PAGE });
    const body = $('viewer-device-body'); body.replaceChildren(); detail(body, 'Attempt identity and recorded part fields', result.attempt);
    body.append(element('p', 'Normalized values are accompanied by original R4 bits and recorded flags. Open a record for all fields and exact source bytes.', 'viewer-help'));
    const exportBar = element('div', undefined, 'viewer-toolbar');
    for (const [text, format] of [['Export CSV', 'csv'], ['Export Excel', 'xlsx']]) {
      const exportButton = button(text, () => runAction(() => actions.exportDevice(snapshot(), { datasetId: row.dataset_id, deviceId: row.id, group: row.group_id }, format)));
      exportButton.disabled = typeof actions.exportDevice !== 'function'; exportBar.append(exportButton);
    }
    body.append(element('p', 'Device exports include all recorded observations for this attempt, beyond the displayed page and selected tests.', 'viewer-help'), exportBar);
    const transpose = element('input'), label = element('label', undefined, 'viewer-transpose'), observations = element('div'); transpose.type = 'checkbox'; transpose.checked = state.deviceTranspose === true;
    label.append(transpose, document.createTextNode('Transpose this page')); body.append(label, observations);
    const draw = () => { observations.replaceChildren(); renderObservations(observations, result, state.settings, (seq) => openRecord(row.dataset_id, seq), transpose.checked); };
    transpose.addEventListener('change', () => { state.deviceTranspose = transpose.checked; draw(); }); draw();
    pager(body, { ...result, offset: history.length * PAGE, nextOffset: result.nextAfter }, () => { const prior = [...history]; openDevice(row, prior.pop() ?? [0, -1], prior); }, () => openDevice(row, result.nextAfter, [...history, after]));
  });
}
function openRecord(datasetId, seq) {
  $('viewer-record-title').textContent = `Original record ${seq}`; showDialog('viewer-record-dialog');
  run(async () => renderRecord($('viewer-record-body'), await query('record', { datasetId, seq })));
}
async function drawRecords(container) {
  const toolbar = element('div', undefined, 'viewer-toolbar'); container.append(toolbar);
  selectField(toolbar, 'Record collection', [['datalog', 'GDR / DTR'], ['headers', 'File headers'], ['pins', 'Pin metadata'], ['all', 'All indexed metadata'], ['raw', 'All original records']], state.recordFamily, (value) => { state.recordFamily = value; state.recordOffset = 0; state.rawAfter = 0; state.rawHistory = []; run(renderPanel); });
  if (state.recordFamily === 'raw') {
    const sources = state.overview.sources; state.rawSource ||= sources[0].datasetId;
    selectField(toolbar, 'Source', sources.map((s) => [s.datasetId, s.name]), state.rawSource, (value) => { state.rawSource = value; state.rawAfter = 0; state.rawHistory = []; run(renderPanel); });
    const result = await query('rawRecords', { datasetId: state.rawSource, after: state.rawAfter, limit: PAGE });
    table(container, [{ label: 'Source sequence', value: (r) => button(String(r.seq), () => openRecord(state.rawSource, r.seq), '') }, { label: 'Type / subtype', value: (r) => `${r.type} / ${r.subtype}` }, { label: 'Source offset', value: (r) => r.offset }, { label: 'Record bytes', value: (r) => r.length }, { label: 'Attempt ID', value: (r) => r.device_id }], result.items, { label: 'Original source records' });
    pager(container, { ...result, offset: state.rawHistory.length * PAGE, nextOffset: result.nextAfter }, () => { state.rawAfter = state.rawHistory.pop() ?? 0; run(renderPanel); }, () => { state.rawHistory.push(state.rawAfter); state.rawAfter = result.nextAfter; run(renderPanel); });
  } else {
    addSearch(toolbar, 'Search recorded text', state.recordQuery, (value) => { state.recordQuery = value; state.recordOffset = 0; run(renderPanel); });
    const result = await query('records', { family: state.recordFamily, query: state.recordQuery, offset: state.recordOffset, limit: PAGE });
    table(container, [{ label: 'Source / record', value: (r) => button(`${r.sourceName} · ${r.seq}`, () => openRecord(r.datasetId, r.seq), ''), wrap: true }, { label: 'Type / subtype', value: (r) => `${r.type} / ${r.subtype}` }, { label: 'Recorded fields', value: (r) => { const d = element('details', undefined, 'viewer-detail'); d.append(element('summary', 'Inspect fields'), element('pre', JSON.stringify(r.fields, null, 2))); return d; }, wrap: true }], result.items, { label: 'Decoded metadata records' });
    pager(container, result, () => { state.recordOffset = Math.max(0, state.recordOffset - PAGE); run(renderPanel); }, () => { state.recordOffset = result.nextOffset; run(renderPanel); });
  }
}
function drawBinTable(container, series) {
  const rows = series.flatMap((s) => s.bins.map((b) => ({ ...b, label: s.label, key: s.key }))), body = element('div'); container.append(body);
  const draw = (offset) => {
    body.replaceChildren(); const items = rows.slice(offset, offset + PAGE);
    table(body, [{ label: 'Population', value: (r) => r.label, wrap: true }, { label: 'Bin / name', value: (r) => button(`${r.number}: ${r.name}`, () => pickDevices({ type: 'bin', number: r.number, seriesKeys: [r.key] }, { bin: { kind: state.binKind, number: r.number } }), ''), wrap: true }, { label: 'Count', value: (r) => r.count }, { label: 'Percent', value: (r) => `${fmt(r.percent)}%` }, { label: 'Pass / fail / unknown', value: (r) => `${r.passed} / ${r.failed} / ${r.unknown}` }], items, { label: 'Bin counts and device drilldown' });
    pager(body, { items, offset, total: rows.length, nextOffset: offset + PAGE < rows.length ? offset + PAGE : null }, () => { draw(Math.max(0, offset - PAGE)); body.querySelector('.viewer-table-wrap').focus(); }, () => { draw(offset + PAGE); body.querySelector('.viewer-table-wrap').focus(); });
  }; draw(0);
}
function waferViewport(container) {
  const form = element('form', undefined, 'viewer-toolbar'), inputs = [];
  for (const [axis, bound, text] of [['x', 0, 'Minimum X'], ['x', 1, 'Maximum X'], ['y', 0, 'Minimum Y'], ['y', 1, 'Maximum Y']]) {
    const label = element('label', text), input = element('input'); input.type = 'number'; input.step = '1'; input.min = '-32767'; input.max = '32767'; input.placeholder = 'All'; input.value = state.waferBounds?.[axis][bound] ?? ''; input.style.width = '100px'; label.append(input); form.append(label); inputs.push(input);
  }
  const apply = element('button', 'Apply viewport', 'button secondary'); apply.type = 'submit'; form.append(apply, button('All coordinates', () => { state.waferBounds = null; run(renderPanel); }));
  form.addEventListener('submit', (event) => {
    event.preventDefault(); const values = inputs.map((input) => input.value === '' ? null : input.valueAsNumber);
    if (values.every((v) => v === null)) state.waferBounds = null;
    else if (values.some((v) => !Number.isInteger(v)) || values[0] > values[1] || values[2] > values[3]) { showError(new Error('Enter all four viewport bounds with minimum no greater than maximum.')); return; }
    else state.waferBounds = { x: values.slice(0, 2), y: values.slice(2, 4) };
    run(renderPanel);
  }); container.append(form);
}
async function renderPanel() {
  const panel = $('viewer-panel'); disposeCharts(); panel.replaceChildren();
  for (const tab of document.querySelectorAll('[data-tab]')) { tab.setAttribute('aria-selected', String(tab.dataset.tab === state.tab)); tab.tabIndex = tab.dataset.tab === state.tab ? 0 : -1; }
  panel.setAttribute('aria-labelledby', `tab-${state.tab}`);
  if (state.tab === 'overview') { renderOverview(panel, state.overview); return; }
  if (state.tab === 'devices') { await drawDevices(panel); return; }
  if (['tests', 'trend', 'histogram'].includes(state.tab)) {
    if (!state.selected.size) { empty(panel, 'Choose a test', 'Select up to twelve tests from the catalog to compare statistics, distributions and devices.'); return; }
    const analyses = await getAnalyses();
    if (state.tab === 'tests') {
      renderStats(section(panel, 'Full-population test statistics'), analyses, state.settings);
      for (const item of state.selected.values()) if (item.pins?.length) detail(panel, `Pin metadata · ${testTitle(item)}`, item.pins);
      await drawDevices(section(panel, 'Device test matrix'), true); return;
    }
    for (const analysis of analyses) {
      const box = section(panel, testTitle(analysis.test)); warnings(box, analysis.warnings);
      const pinInfo = state.selected.get(analysis.test.key)?.pins; if (pinInfo?.length) detail(box, 'Pin metadata with source/head/site scope', pinInfo);
      const chartBox = element('div'); box.append(chartBox);
      const args = { series: colored(analysis.series), settings: state.settings, title: `${FAMILY_LABEL(analysis.test.family)} · ${testTitle(analysis.test)}`, onPick: (pick) => pickDevices(pick, { testKey: analysis.test.key }) };
      const label = analysis.test.family === 20 ? 'Test flag (status byte)' : `Test value${analysis.test.unit ? ` (${analysis.test.unit})` : ''}`;
      chartHandles.push(state.tab === 'trend' ? renderTrend(chartBox, { ...args, yLabel: label }) : renderHistogram(chartBox, { ...args, xLabel: label }));
      renderStats(box, [analysis], state.settings);
    }
    return;
  }
  if (state.tab === 'bins') {
    const toolbar = element('div', undefined, 'viewer-toolbar'); panel.append(toolbar);
    selectField(toolbar, 'Bin family', [['soft', 'Software bins'], ['hard', 'Hardware bins']], state.binKind, (value) => { state.binKind = value; run(renderPanel); });
    const result = await query('bins', { kind: state.binKind, seriesBy: state.seriesBy }); warnings(panel, result.warnings);
    const chartBox = element('div'); panel.append(chartBox); chartHandles.push(renderBins(chartBox, { series: colored(result.series), settings: state.settings, title: `${state.binKind === 'soft' ? 'Software' : 'Hardware'} bins`, onPick: (pick) => pickDevices(pick, { bin: { kind: state.binKind, number: pick.number } }) }));
    drawBinTable(panel, result.series); return;
  }
  if (state.tab === 'wafers') {
    const wafers = await query('wafers'), toolbar = element('div', undefined, 'viewer-toolbar'); panel.append(toolbar);
    if (state.waferKey !== 'stacked' && !wafers.items.some((w) => w.key === state.waferKey)) state.waferKey = 'stacked';
    selectField(toolbar, 'Wafer map', [['stacked', 'Stacked failure counts'], ...wafers.items.map((w) => [w.key, `${state.selection.groups[w.group].name} · ${w.name} · ${w.sourceName}`])], state.waferKey, (value) => { state.waferKey = value; run(renderPanel); });
    waferViewport(panel);
    const result = await query('wafer', { waferKey: state.waferKey, ...(state.waferBounds ? { bounds: state.waferBounds } : {}) }); warnings(panel, result.warnings);
    const chartBox = element('div'); panel.append(chartBox); chartHandles.push(renderWafer(chartBox, { ...result, settings: state.settings, onPick: (pick) => pickDevices(pick, result.wafer ? { wafer: { datasetId: result.wafer.datasetId, id: result.wafer.id }, group: result.wafer.group } : { wafer: 'stacked' }) }));
    if (result.wafer) detail(panel, 'Wafer metadata and orientation provenance', result.wafer); return;
  }
  await drawRecords(panel);
}
const FAMILY_LABEL = (family) => ({ 10: 'PTR', 15: 'MPR', 20: 'FTR' })[family] ?? 'Test';

async function startup() {
  state.ready = false; state.opened = false;
  library?.terminate(); library = new DataLibraryClient({ onProgress: progress }); await library.open(); state.opened = true;
  state.datasets = []; let offset = 0;
  do { const page = await library.listDatasets({ offset, limit: 100 }); state.datasets.push(...page.items); offset = page.nextOffset; if (state.datasets.length > 1000) throw new Error('This workspace supports a catalog of up to 1,000 saved datasets.'); } while (offset != null);
  if (!state.datasets.length) { state.ready = false; empty($('viewer-panel'), 'Your library is empty', 'Add STDF files in Data library, or open a saved workspace.'); $('viewer-subtitle').textContent = 'Add a file to begin.'; $('viewer-test-count').textContent = 'No saved tests'; window.dispatchEvent(new CustomEvent('viewer-ready', { detail: snapshot() })); return; }
  const requested = new URL(location.href).searchParams.get('dataset');
  if (requested && !state.datasets.some((d) => d.id === requested)) throw new Error('That dataset is not in this browser library. Open it from Data library.');
  if (!state.selection) {
    let saved; try { saved = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? 'null'); } catch { /* Ignore invalid local preference data. */ }
    if (!requested && saved?.version === 1) {
      try { const selection = validateSelection(saved.selection); if (selection.groups.every((g) => g.datasetIds.every((id) => state.datasets.some((d) => d.id === id)))) { state.selection = selection; for (const key of (saved.tests ?? []).slice(0, 12)) state.selected.set(key, parseTestKey(key)); } } catch { state.selection = null; state.selected.clear(); }
    }
    if (!state.selection) { const source = state.datasets.find((d) => d.id === requested) ?? state.datasets[0]; state.selection = validateSelection({ groups: [{ name: source.name.slice(0, 120), datasetIds: [source.id] }] }); }
  }
  await restoreFont(state.settings);
  await reloadWorkspace(); window.dispatchEvent(new CustomEvent('viewer-ready', { detail: snapshot() }));
}
async function restoreFont(settings) {
  try { await applyFont(settings); }
  catch (error) {
    settings.font = 'Segoe UI'; await applyFont(settings);
    $('viewer-notice').hidden = false; $('viewer-notice').textContent = `${error.message} This workspace uses Segoe UI until you add that font in Settings.`;
  }
}

hydrateIcons();
$('viewer-cancel').addEventListener('click', () => { cancelRequested = true; $('viewer-cancel').disabled = true; $('viewer-progress-text').textContent = 'Cancelling at a safe boundary…'; library?.cancel(); });
$('viewer-retry').addEventListener('click', () => run(library?.worker && state.ready ? retryWork ?? renderPanel : startup));
$('viewer-groups').addEventListener('click', () => editGroups(state.selection, state.datasets, (selection) => { state.selection = selection; state.selected.clear(); state.rawSource = ''; run(reloadWorkspace); }));
$('viewer-settings').addEventListener('click', () => editSettings(state.settings, (settings) => { state.settings = settings; state.analyses.clear(); clearHealth(); drawCatalog(); changed(); run(renderPanel); }));
for (const [id, field] of [['viewer-head', 'heads'], ['viewer-site', 'sites']]) $(id).addEventListener('change', () => {
  const values = [...$(id).selectedOptions].map((o) => o.value).filter((value) => value !== 'all').map(Number); state.selection[field] = values.length ? values : null; run(reloadWorkspace);
});
$('viewer-attempts').addEventListener('change', () => { state.selection.attempts = $('viewer-attempts').value; run(reloadWorkspace); });
$('viewer-series').addEventListener('change', () => { const value = $('viewer-series').value; state.seriesBy = value === 'aggregate' ? 'aggregate' : 'site'; state.includeAggregate = value === 'both'; state.analyses.clear(); clearHealth(); drawCatalog(); run(renderPanel); });
$('viewer-scan-health').addEventListener('click', () => run(scanHealth));
$('viewer-test-search').addEventListener('submit', (e) => { e.preventDefault(); state.testQuery = $('viewer-test-query').value; state.wildcard = $('viewer-wildcard').checked; state.testOrder = $('viewer-test-order').value; run(() => loadCatalog()); });
$('viewer-test-order').addEventListener('change', () => { state.testOrder = $('viewer-test-order').value; run(() => loadCatalog()); });
$('viewer-tests-prev').addEventListener('click', () => run(() => loadCatalog(Math.max(0, state.catalog.offset - PAGE))));
$('viewer-tests-next').addEventListener('click', () => run(() => loadCatalog(state.catalog.nextOffset)));
$('viewer-clear-tests').addEventListener('click', () => { state.selected.clear(); state.analyses.clear(); changed(); drawCatalog(); run(renderPanel); });
for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => { state.tab = tab.dataset.tab; run(renderPanel); });
  tab.addEventListener('keydown', (e) => {
    const tabs = [...document.querySelectorAll('[data-tab]')], index = tabs.indexOf(tab); let target;
    if (e.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length]; else if (e.key === 'ArrowLeft') target = tabs[(index + tabs.length - 1) % tabs.length]; else if (e.key === 'Home') target = tabs[0]; else if (e.key === 'End') target = tabs.at(-1);
    if (target) { e.preventDefault(); target.focus(); target.click(); }
  });
}
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => $(b.dataset.close).close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => {
  const target = dialogOpeners.get(dialog); dialogOpeners.delete(dialog);
  if (state.busy) returnFocus = target; else if (target) restoreFocus(target);
});
for (const [id, key] of actionButtons) $(id).addEventListener('click', () => {
  if (actions[key]) runAction(() => actions[key](snapshot()));
});

window.semidataViewer = {
  getState: snapshot,
  getDatasets: () => structuredClone(state.datasets),
  query,
  checkCancelled,
  client: () => library,
  exportChartPNGs: () => Promise.all(chartHandles.map((chart) => chart.exportPng())),
  installActions(handlers) { Object.assign(actions, handlers); controls(); },
  async applyWorkspace(workspace) {
    if (state.busy && !actionRunning) throw new Error('Wait for the current operation before opening a workspace.');
    const selection = validateSelection(workspace.selection), settings = validateSettings(workspace.settings ?? {}), selected = new Map();
    if (!Array.isArray(workspace.tests ?? []) || (workspace.tests?.length ?? 0) > 12) throw new Error('A workspace can select up to twelve tests.');
    for (const key of workspace.tests ?? []) selected.set(key, parseTestKey(key));
    const apply = async () => {
      await restoreFont(settings); saveSettings(settings); state.selection = selection; state.settings = settings; state.selected = selected;
      state.rawSource = ''; state.waferBounds = null;
      state.tab = ['overview', 'devices', 'tests', 'trend', 'histogram', 'bins', 'wafers', 'records'].includes(workspace.tab) ? workspace.tab : 'overview';
      state.seriesBy = workspace.seriesBy === 'site' ? 'site' : 'aggregate'; state.includeAggregate = workspace.includeAggregate === true;
      $('viewer-series').value = state.seriesBy === 'aggregate' ? 'aggregate' : state.includeAggregate ? 'both' : 'site';
      state.datasets = []; let offset = 0;
      do { const page = await library.listDatasets({ offset, limit: 100 }); state.datasets.push(...page.items); offset = page.nextOffset; } while (offset != null && state.datasets.length <= 1000);
      await reloadWorkspace();
    };
    return actionRunning ? apply() : run(apply);
  },
};
installViewerActions(window.semidataViewer);
window.addEventListener('pagehide', () => { disposed = true; disposeCharts(); library?.terminate(); }, { once: true });
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
run(startup);
