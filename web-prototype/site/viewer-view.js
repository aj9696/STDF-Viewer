import { element, bytes } from './library-home-view.js';
import { FAMILY_NAMES, deviceOutcome, testOutcome, parseTestKey, numericEligible } from './viewer-model.js';
import { formatNumber } from './viewer-number.js';
import { DEFAULT_PREFERENCES, capabilityCp, measurementDisplay, measurementOutsideLimits } from './viewer-preferences.js';
export const $ = (id) => document.getElementById(id);
export const fmt = formatNumber;
export const hex = (n, digits = 2) => Number.isInteger(n) ? `0x${(n >>> 0).toString(16).toUpperCase().padStart(digits, '0')}` : 'Not recorded';
export const button = (text, action, className = 'button secondary') => { const b = element('button', text, className); b.type = 'button'; b.addEventListener('click', action); return b; };
export function empty(container, title, text) { const box = element('div', undefined, 'viewer-empty'); box.append(element('h2', title), element('p', text)); container.replaceChildren(box); }
export function section(container, title) { const s = element('section', undefined, 'viewer-section'); if (title) s.append(element('h2', title)); container.append(s); return s; }
export function detail(container, title, fields) { const d = element('details', undefined, 'viewer-detail'); d.append(element('summary', title), element('pre', JSON.stringify(fields, null, 2))); container.append(d); return d; }
export function disclosure(container, title) { const d = element('details', undefined, 'viewer-detail'); d.append(element('summary', title)); container.append(d); return d; }
export function compactChart(container) {
  const chart = container.querySelector('.viewer-chart'); if (!chart) return;
  const note = chart.querySelector('.chart-note'), controls = chart.querySelector('.chart-controls'), navigation = chart.querySelector('.chart-navigation'), status = chart.querySelector('.chart-status');
  const tools = disclosure(chart, 'Chart tools'); tools.classList.add('chart-tools'); tools.append(navigation, controls);
  disclosure(chart, 'About this chart').append(note);
  // Status remains outside collapsed tools so selection/validation feedback is visible.
  chart.append(status);
}
export function renderStatSummary(container, analysis, settings) {
  const summary = element('div', undefined, 'viewer-stat-summary');
  for (const series of analysis.series) {
    const row = element('div', undefined, 'viewer-stat-row');
    if (analysis.series.length > 1) row.append(element('span', series.label, 'viewer-stat-label'));
    for (const [label, value] of [['n', series.stats.count], ['Mean', fmt(series.stats.mean, settings.precision, settings.notation)], ['σ', fmt(series.stats.stdev, settings.precision, settings.notation)], ['Cpk', series.stats.cpk == null ? '—' : fmt(series.stats.cpk, settings.precision, settings.notation)]]) {
      const item = element('span'); item.append(document.createTextNode(`${label} `), element('strong', String(value))); if (label === 'Cpk' && series.stats.cpk == null) item.title = series.stats.cpkReason ?? 'Cpk unavailable'; row.append(item);
    }
    if (series.stats.excluded) row.append(element('span', `${series.stats.excluded} excluded`, 'viewer-stat-excluded'));
    summary.append(row);
  }
  container.append(summary);
}
export function warnings(container, values = []) { for (const text of values) container.append(element('p', text, 'viewer-warning')); }
export function table(container, columns, rows, { label = 'Data table', rowClass, headerRows = [], onSort, sort, direction } = {}) {
  const wrap = element('div', undefined, 'viewer-table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label);
  const t = element('table', undefined, 'viewer-table'), head = element('thead'), tr = element('tr'), body = element('tbody');
  for (const column of columns) {
    const th = element('th', onSort && column.sortKey ? undefined : column.label); th.scope = 'col';
    if (onSort && column.sortKey) { th.append(button(column.label, () => onSort(column.sortKey), '')); th.setAttribute('aria-sort', sort === column.sortKey ? direction === 'desc' ? 'descending' : 'ascending' : 'none'); }
    tr.append(th);
  }
  head.append(tr); t.append(head, body);
  for (const row of headerRows) {
    const r = element('tr', undefined, 'viewer-spec-row');
    for (const [index, column] of columns.entries()) { const cell = element('th', index === 0 ? row.label : row.value(column), column.wrap ? 'text-wrap' : undefined); cell.scope = index === 0 ? 'row' : 'col'; r.append(cell); }
    head.append(r);
  }
  for (const row of rows) {
    const r = element('tr'); if (rowClass) r.className = rowClass(row);
    for (const column of columns) {
      const cell = element('td', undefined, column.wrap ? 'text-wrap' : undefined), value = column.value(row);
      if (value instanceof Node) cell.append(value); else cell.textContent = value == null ? 'Not recorded' : String(value);
      if (column.className) cell.classList.add(column.className(row)); r.append(cell);
    }
    body.append(r);
  }
  if (!rows.length) { const r = element('tr'), cell = element('td', 'No matching records.'); cell.colSpan = columns.length; r.append(cell); body.append(r); }
  wrap.append(t); container.append(wrap); return wrap;
}
export function pager(container, { offset = 0, total = null, nextOffset = null, items = [] }, previous, next) {
  const p = element('div', undefined, 'viewer-pager');
  const prev = button('Previous page', previous, 'quiet-button'), after = button('Next page', next, 'quiet-button');
  prev.disabled = offset === 0; after.disabled = nextOffset == null;
  p.append(prev, element('span', `${items.length ? offset + 1 : 0}–${offset + items.length}${total == null ? '' : ` of ${total.toLocaleString()}`}`), after); container.append(p); return p;
}
export function selectField(container, labelText, values, current, change) {
  const label = element('label', labelText), select = element('select');
  select.setAttribute('aria-label', labelText);
  for (const [value, text] of values) { const option = element('option', text); option.value = value; select.append(option); }
  select.value = current; select.addEventListener('change', () => change(select.value)); label.append(select); container.append(label); return select;
}
export function testTitle(test) { return `${test.number} · ${test.name || '(name not recorded)'}${test.channel ? ` · ${test.channel}` : ''}`; }
export function renderCatalog(result, selected, onToggle, onRemove, health = new Map(), threshold = 1.33) {
  $('viewer-tests').replaceChildren();
  for (const item of result.items) {
    const label = element('label', undefined, `viewer-test-choice${selected.has(item.key) ? ' is-selected' : ''}`), input = element('input'), text = element('span');
    input.type = 'checkbox'; input.checked = selected.has(item.key); input.dataset.testKey = item.key;
    input.addEventListener('change', () => onToggle(item, input.checked));
    text.append(element('strong', String(item.number)), element('span', item.name || '(unnamed)', 'test-name'));
    const metadata = [item.channel || FAMILY_NAMES[item.family], item.pinLabel, item.unit].filter(Boolean).join(' · ');
    if (metadata) text.append(element('small', metadata));
    label.title = `${item.observations.toLocaleString()} recorded · ${item.failures} failures before population filters`;
    if (health.has(item.key)) {
      const status = health.get(item.key), low = status.cpk != null && status.cpk < threshold;
      text.append(element('small', `${status.fails ? 'Failures' : 'No failures'} · ${status.cpk == null ? 'Cpk —' : `Cpk ${fmt(status.cpk)}`}`, low || status.fails ? 'health-warning' : 'health-clear'));
    }
    label.append(input, text); $('viewer-tests').append(label);
  }
  if (!result.items.length) $('viewer-tests').append(element('p', 'No tests match this search.', 'viewer-help'));
  $('viewer-test-count').textContent = `${result.total.toLocaleString()} tests`;
  $('viewer-test-count').title = result.countScope ?? 'Catalog counts include all recorded observations before population filters.';
  $('viewer-selected-count').textContent = `${selected.size} / 12`;
  $('viewer-test-page').textContent = `${result.items.length ? result.offset + 1 : 0}–${result.offset + result.items.length}`;
  $('viewer-tests-prev').parentElement.hidden = result.total <= result.items.length && result.offset === 0;
  $('viewer-clear-tests').hidden = selected.size === 0;
  $('viewer-selected').closest('details').hidden = selected.size === 0;
  $('viewer-selected').replaceChildren();
  for (const [key, item] of selected) {
    const b = button(`${item.number}${item.channel ? ` ${item.channel}` : ''} ×`, () => onRemove(key), ''); b.setAttribute('aria-label', `Remove ${testTitle(item)} from selection`); $('viewer-selected').append(b);
  }
}
export function renderOverview(container, data) {
  container.replaceChildren();
  const policy = data.attempts === 'all' ? 'All-attempt' : 'Current';
  for (const group of data.groups) {
    const box = section(container, group.name), metrics = element('div', undefined, 'viewer-metrics');
    for (const [name, value] of [['All attempts', group.total], ['Superseded', group.superseded], [`${policy} pass`, group.passed], [`${policy} fail`, group.failed], [`${policy} unknown`, group.unknown], [`${policy} yield`, group.yield == null ? 'Not available' : `${(100 * group.yield).toFixed(2)}%`]]) {
      const m = element('article'); m.append(element('small', name), element('strong', typeof value === 'number' ? value.toLocaleString() : value)); metrics.append(m);
    }
    box.append(metrics); disclosure(box, 'Counting rules').append(element('p', `Outcome counts describe ${data.attempts === 'all' ? 'all attempts, including superseded attempts,' : 'current attempts'} in the selected heads/sites. All-attempt and superseded totals retain history regardless of the attempt selector. Yield excludes unknown outcomes.`, 'viewer-help'));
  }
  for (const source of data.sources) {
    const s = section(container, source.name); s.append(element('p', bytes(source.sourceBytes), 'viewer-help'));
    detail(s, 'Source details', { byteOrder: source.byteOrder, sha256: source.sha256 });
    warnings(s, source.warnings);
    for (const record of source.metadata) detail(s, `Record ${record.seq} · ${record.type}/${record.subtype}`, record.fields);
    if (source.moreMetadata) s.append(element('p', 'Additional header records are available in Records.', 'viewer-help'));
  }
}
export function renderStats(container, analyses, settings) {
  const rows = analyses.flatMap((analysis) => analysis.series.map((series) => ({ ...series.stats, cp: capabilityCp(series.stats, analysis.test.family), label: series.label, test: testTitle(analysis.test) })));
  table(container, [
    { label: 'Test / population', value: (r) => `${r.test}\n${r.label}`, wrap: true },
    ...[['total', 'Recorded'], ['count', 'Valid'], ['excluded', 'Excluded'], ['pass', 'Pass'], ['fail', 'Fail'], ['unknown', 'Unknown']].map(([key, label]) => ({ label, value: (r) => r[key] })),
    ...[['mean', 'Mean'], ['median', 'Median'], ['stdev', 'Population σ'], ['min', 'Min'], ['max', 'Max'], ['lsl', 'Low limit'], ['usl', 'High limit']].map(([key, label]) => ({ label, value: (r) => fmt(r[key], settings.precision, settings.notation) })),
    { label: 'Cp', value: (r) => fmt(r.cp, settings.precision, settings.notation) },
    { label: 'Cpk', value: (r) => r.cpk == null ? r.cpkReason ?? 'Not available' : fmt(r.cpk, settings.precision, settings.notation), wrap: true, className: (r) => r.cpk != null && r.cpk < settings.cpkThreshold ? 'value-warning' : 'value-neutral' },
    { label: 'Test yield', value: (r) => r.pass + r.fail ? `${fmt(100 * r.pass / (r.pass + r.fail), settings.precision, settings.notation)}%` : 'Not available' },
  ], rows, { label: 'Full-population test statistics' });
}
export function renderDevices(container, result, tests, selection, openDevice, settings, analyses = [], sortOptions = {}) {
  const prefs = { ...DEFAULT_PREFERENCES.table, ...settings.table }, analysisByKey = new Map(analyses.map((a) => [a.test.key, a]));
  const columns = [
    { label: 'Device / part ID', sortKey: 'part', value: (r) => button(r.part_id || `Attempt ${r.x_index}`, () => openDevice(r), ''), wrap: true },
    { label: 'Group / source', value: (r) => `${selection.groups[r.group_id].name}\n${r.source_name}`, wrap: true },
    { label: 'Index', sortKey: 'index', value: (r) => r.x_index }, { label: 'Head / site', sortKey: 'site', value: (r) => `${r.head} / ${r.site}` },
    { label: 'Outcome', sortKey: 'status', value: (r) => r.retired ? 'Superseded' : deviceOutcome(r.part_flags), className: (r) => r.retired ? 'value-retired' : deviceOutcome(r.part_flags) === 'fail' ? 'value-fail' : deviceOutcome(r.part_flags) === 'unknown' ? 'value-warning' : 'value-pass' },
    ...(prefs.hardBin ? [{ label: 'Hard bin', sortKey: 'hard_bin', value: (r) => r.hard_bin === 65535 ? '—' : r.hard_bin }] : []),
    ...(prefs.softBin ? [{ label: 'Soft bin', sortKey: 'soft_bin', value: (r) => r.soft_bin === 65535 ? '—' : r.soft_bin }] : []),
    ...(prefs.time ? [{ label: 'Time (ms)', sortKey: 'time', value: (r) => r.test_time }] : []), { label: 'Tests', sortKey: 'tests', value: (r) => r.num_tests },
    { label: 'Failed tests', value: r => (r.failedTests ?? []).map(t => `${t.number} · ${t.name}`).join('\n') + (r.failureNamesTruncated ? '\nMore failures; open device' : ''), wrap: true },
    { label: 'Wafer / XY', value: (r) => `${r.wafer_id ?? '—'} / ${r.x === -32768 || r.y === -32768 ? 'Not recorded' : `${r.x}, ${r.y}`}` },
    ...(prefs.flags ? [{ label: 'Part flags', value: (r) => hex(r.part_flags) }] : []),
  ];
  for (const [key, test] of tests) columns.push({ label: prefs.testNumber ? testTitle(test) : `${test.name || '(unnamed)'}${test.channel ? ` · ${test.channel}` : ''}`, sortKey: test.family === 20 ? undefined : `test:${key}`, testKey: key, test, wrap: true, value: (row) => {
    const entries = row.testResults?.[key] ?? [];
    if (!entries.length) return 'Not tested';
    const shown = element('div');
    for (const r of entries.slice(0, 5)) {
      const status = `${testOutcome(r.test_flags)}${test.family !== 20 && !numericEligible(r, test.family) ? '; invalid value' : ''}`;
      const item = element('span', `#${r.seq}: ${test.family === 20 ? `Flag ${hex(r.test_flags)}` : measurementDisplay(r.value, test.unit, settings)} (${status})`, `viewer-measurement${prefs.highlight && measurementOutsideLimits(r, test.family) ? ' value-fail' : ''}`);
      if (prefs.appliedLimits && test.family !== 20) item.prepend(element('small', `${measurementDisplay(r.low, test.unit, settings)} ≤ value ≤ ${measurementDisplay(r.high, test.unit, settings)}`));
      shown.append(item);
    }
    if (entries.length > 5) shown.append(element('small', `${entries.length - 5} more executions; open device`)); return shown;
  } });
  const headerRows = [];
  if (tests.size && prefs.showLimits) {
    for (const [field, label] of [['lsl', 'Low limit'], ['usl', 'High limit']]) headerRows.push({ label, value: (column) => {
      if (!column.testKey) return '';
      const analysis = analysisByKey.get(column.testKey); if (!analysis) return 'See applied limits';
      const stats = analysis.series.filter((s) => s.stats.count).map((s) => s.stats);
      if (stats.some((s) => s.changingLimits) || new Set(stats.map((s) => s[field])).size > 1) return 'Varies';
      return fmt(stats[0]?.[field], settings.precision, settings.notation);
    } });
    headerRows.push({ label: 'Unit', value: (column) => column.test?.unit ?? '' });
  }
  for (const [enabled, fields] of [[prefs.moments, [['min', 'Min'], ['max', 'Max'], ['mean', 'Mean'], ['stdev', 'Population σ']]], [prefs.capability, [['cp', 'Cp'], ['cpk', 'Cpk']]], [prefs.outcomes, [['fail', 'Fail executions'], ['yield', 'Test yield'], ['count', 'Valid count']]]]) if (enabled) for (const [field, label] of fields) {
    headerRows.push({ label, value: (column) => {
      if (!column.testKey) return '';
      const analysis = analysisByKey.get(column.testKey); if (!analysis) return 'Not analyzed';
      return analysis.series.map((series) => {
        const stats = series.stats, value = field === 'cp' ? capabilityCp(stats, analysis.test.family) : field === 'yield' ? stats.pass + stats.fail ? 100 * stats.pass / (stats.pass + stats.fail) : null : stats[field];
        return `${analysis.series.length > 1 ? `${series.label}: ` : ''}${fmt(value, settings.precision, settings.notation)}${field === 'yield' && value != null ? '%' : ''}`;
      }).join('\n');
    } });
  }
  const wrap = table(container, columns, result.items, { label: tests.size ? 'Device test matrix' : 'Device attempts', headerRows, ...sortOptions });
  wrap.querySelector('table').dataset.autoFit = String(prefs.autoFit);
}
export function renderObservations(container, result, settings, readRecord, transpose = false) {
  const columns = [
    { label: 'Record', value: (r) => button(String(r.seq), () => readRecord(r.seq), '') },
    { label: 'Test', value: (r) => `${r.number} · ${r.test_name}`, wrap: true }, { label: 'Family / channel', value: (r) => `${FAMILY_NAMES[r.family]} ${r.channel}` },
    { label: 'Value', value: (r) => r.family === 20 ? `Test flag ${hex(r.test_flags)}` : measurementDisplay(r.value, r.unit, settings), className: (r) => settings.table?.highlight !== false && measurementOutsideLimits(r, r.family) ? 'value-fail' : 'value-neutral' },
    { label: 'Unit', value: (r) => r.unit }, { label: 'Low / high', value: (r) => `${fmt(r.low, settings.precision, settings.notation)} / ${fmt(r.high, settings.precision, settings.notation)}` },
    { label: 'TEST_FLG', value: (r) => hex(r.test_flags) }, { label: 'PARM_FLG', value: (r) => hex(r.parm_flags) },
    { label: 'Original R4 bits', value: (r) => hex(r.raw_bits, 8) }, { label: 'Result ordinal', value: (r) => r.ordinal },
  ];
  if (transpose) table(container, [{ label: 'Recorded field', value: (r) => r.label }, ...result.items.map((observation) => ({ label: `Record ${observation.seq} · result ${observation.ordinal}`, value: (field) => field.value(observation), wrap: true }))], columns, { label: 'Transposed observation page for the selected attempt' });
  else table(container, columns, result.items, { label: 'All recorded observations for the selected attempt' });
}
export function renderRecord(container, result) {
  container.replaceChildren();
  const raw = new Uint8Array(result.bytes), lines = [];
  for (let i = 0; i < raw.length; i += 16) lines.push(`${i.toString(16).toUpperCase().padStart(4, '0')}  ${[...raw.slice(i, i + 16)].map((n) => n.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
  const fields = element('div', undefined, 'viewer-stat-summary');
  fields.append(element('span', `REC_LEN ${result.record.length - 4} · REC_TYP ${result.record.type} · REC_SUB ${result.record.subtype}`)); container.append(fields);
  const toolbar = element('div', undefined, 'viewer-toolbar'), status = element('p', '', 'viewer-help'); status.setAttribute('role', 'status');
  const copy = (label, text) => {
    const control = button(label, async () => {
      control.disabled = true; status.textContent = '';
      try { if (!navigator.clipboard?.writeText) throw Error('Clipboard access is unavailable in this browser context.'); await navigator.clipboard.writeText(text); status.textContent = 'Copied.'; }
      catch (error) { status.textContent = `Could not copy: ${error.message}`; }
      finally { control.disabled = false; }
    }); toolbar.append(control);
  };
  copy('Copy hex', [...raw].map((n) => n.toString(16).toUpperCase().padStart(2, '0')).join(' ')); copy('Copy decoded fields', JSON.stringify(result.decoded, null, 2));
  container.append(toolbar, status); detail(container, 'Decoded record fields', result.decoded).open = true;
  container.append(element('p', `Original source offset ${result.record.offset}; ${raw.length} bytes including the record header.`, 'viewer-help'), element('pre', lines.join('\n'), 'viewer-record-bytes'));
}
