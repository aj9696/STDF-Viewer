import { element, bytes } from './library-home-view.js';
import { FAMILY_NAMES, deviceOutcome, testOutcome, parseTestKey } from './viewer-model.js';
import { formatNumber } from './viewer-number.js';
export const $ = (id) => document.getElementById(id);
export const fmt = formatNumber;
export const hex = (n, digits = 2) => Number.isInteger(n) ? `0x${(n >>> 0).toString(16).toUpperCase().padStart(digits, '0')}` : 'Not recorded';
export const button = (text, action, className = 'button secondary') => { const b = element('button', text, className); b.type = 'button'; b.addEventListener('click', action); return b; };
export function empty(container, title, text) { const box = element('div', undefined, 'viewer-empty'); box.append(element('h2', title), element('p', text)); container.replaceChildren(box); }
export function section(container, title) { const s = element('section', undefined, 'viewer-section'); if (title) s.append(element('h2', title)); container.append(s); return s; }
export function detail(container, title, fields) { const d = element('details', undefined, 'viewer-detail'); d.append(element('summary', title), element('pre', JSON.stringify(fields, null, 2))); container.append(d); return d; }
export function warnings(container, values = []) { for (const text of values) container.append(element('p', text, 'viewer-warning')); }
export function table(container, columns, rows, { label = 'Data table', rowClass } = {}) {
  const wrap = element('div', undefined, 'viewer-table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label);
  const t = element('table', undefined, 'viewer-table'), head = element('thead'), tr = element('tr'), body = element('tbody');
  for (const column of columns) { const th = element('th', column.label); th.scope = 'col'; tr.append(th); }
  head.append(tr); t.append(head, body);
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
    const label = element('label', undefined, `viewer-test-choice${item.failures > 0 ? ' has-failures' : ''}`), input = element('input'), text = element('span');
    input.type = 'checkbox'; input.checked = selected.has(item.key); input.dataset.testKey = item.key;
    input.addEventListener('change', () => onToggle(item, input.checked));
    text.append(element('strong', `${item.number} · ${FAMILY_NAMES[item.family] ?? item.family}`), element('span', item.name || '(name not recorded)', 'test-name'), element('small', `${item.unit || 'No unit'}${item.channel ? ` · ${item.channel}` : ''}${item.pinLabel ? ` · ${item.pinLabel}` : ''} · ${item.observations.toLocaleString()} recorded · ${item.failures} failures`));
    if (health.has(item.key)) {
      const status = health.get(item.key), low = status.cpk != null && status.cpk < threshold;
      text.append(element('small', `Scanned population: ${status.fails ? 'failures' : 'no failures'} · ${status.cpk == null ? 'Cpk unavailable' : `${low ? 'low ' : ''}Cpk ${fmt(status.cpk)}`}`, low || status.fails ? 'health-warning' : 'health-clear'));
    }
    label.append(input, text); $('viewer-tests').append(label);
  }
  if (!result.items.length) $('viewer-tests').append(element('p', 'No tests match this search.', 'viewer-help'));
  $('viewer-test-count').textContent = `${result.total.toLocaleString()} identities · source totals`;
  $('viewer-test-count').title = result.countScope ?? 'Catalog counts include all recorded observations before population filters.';
  $('viewer-selected-count').textContent = `${selected.size} / 12`;
  $('viewer-test-page').textContent = `${result.items.length ? result.offset + 1 : 0}–${result.offset + result.items.length}`;
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
    box.append(metrics, element('p', `Outcome counts describe ${data.attempts === 'all' ? 'all attempts, including superseded attempts,' : 'current attempts'} in the selected heads/sites. All-attempt and superseded totals retain history regardless of the attempt selector. Yield excludes unknown outcomes.`, 'viewer-help'));
  }
  for (const source of data.sources) {
    const s = section(container, source.name); s.append(element('p', `${bytes(source.sourceBytes)} · ${source.byteOrder} endian · SHA-256 ${source.sha256}`, 'viewer-help'));
    warnings(s, source.warnings);
    for (const record of source.metadata) detail(s, `Record ${record.seq} · ${record.type}/${record.subtype}`, record.fields);
    if (source.moreMetadata) s.append(element('p', 'Additional header records are available in Records.', 'viewer-help'));
  }
}
export function renderStats(container, analyses, settings) {
  const rows = analyses.flatMap((analysis) => analysis.series.map((series) => ({ ...series.stats, label: series.label, test: testTitle(analysis.test) })));
  table(container, [
    { label: 'Test / population', value: (r) => `${r.test}\n${r.label}`, wrap: true },
    ...[['total', 'Recorded'], ['count', 'Valid'], ['excluded', 'Excluded'], ['pass', 'Pass'], ['fail', 'Fail'], ['unknown', 'Unknown']].map(([key, label]) => ({ label, value: (r) => r[key] })),
    ...[['mean', 'Mean'], ['median', 'Median'], ['stdev', 'Population σ'], ['min', 'Min'], ['max', 'Max'], ['lsl', 'Low limit'], ['usl', 'High limit']].map(([key, label]) => ({ label, value: (r) => fmt(r[key], settings.precision, settings.notation) })),
    { label: 'Cpk', value: (r) => r.cpk == null ? r.cpkReason ?? 'Not available' : fmt(r.cpk, settings.precision, settings.notation), wrap: true, className: (r) => r.cpk != null && r.cpk < settings.cpkThreshold ? 'value-warning' : 'value-neutral' },
  ], rows, { label: 'Full-population test statistics' });
}
export function renderDevices(container, result, tests, selection, openDevice, settings) {
  const columns = [
    { label: 'Device / part ID', value: (r) => button(r.part_id || `Attempt ${r.x_index}`, () => openDevice(r), ''), wrap: true },
    { label: 'Group / source', value: (r) => `${selection.groups[r.group_id].name}\n${r.source_name}`, wrap: true },
    { label: 'Index', value: (r) => r.x_index }, { label: 'Head / site', value: (r) => `${r.head} / ${r.site}` },
    { label: 'Outcome', value: (r) => r.retired ? 'Superseded' : deviceOutcome(r.part_flags), className: (r) => r.retired ? 'value-retired' : deviceOutcome(r.part_flags) === 'fail' ? 'value-fail' : deviceOutcome(r.part_flags) === 'unknown' ? 'value-warning' : 'value-neutral' },
    { label: 'Hard / soft bin', value: (r) => `${r.hard_bin === 65535 ? '—' : r.hard_bin} / ${r.soft_bin === 65535 ? '—' : r.soft_bin}` },
    { label: 'Time (ms)', value: (r) => r.test_time }, { label: 'Tests', value: (r) => r.num_tests },
    { label: 'Wafer / XY', value: (r) => `${r.wafer_id ?? '—'} / ${r.x === -32768 || r.y === -32768 ? 'Not recorded' : `${r.x}, ${r.y}`}` },
    { label: 'Part flags', value: (r) => hex(r.part_flags) },
  ];
  for (const [key, test] of tests) columns.push({ label: testTitle(test), wrap: true, value: (row) => {
    const entries = row.testResults?.[key] ?? [];
    if (!entries.length) return 'Not tested';
    const shown = entries.slice(0, 5).map((r) => `#${r.seq}: ${test.family === 20 ? `Flag ${hex(r.test_flags)}` : fmt(r.value, settings.precision, settings.notation)} (${testOutcome(r.test_flags)})`);
    if (entries.length > 5) shown.push(`${entries.length - 5} more executions; open device`); return shown.join('\n');
  } });
  table(container, columns, result.items, { label: tests.size ? 'Device test matrix' : 'Device attempts' });
}
export function renderObservations(container, result, settings, readRecord, transpose = false) {
  const columns = [
    { label: 'Record', value: (r) => button(String(r.seq), () => readRecord(r.seq), '') },
    { label: 'Test', value: (r) => `${r.number} · ${r.test_name}`, wrap: true }, { label: 'Family / channel', value: (r) => `${FAMILY_NAMES[r.family]} ${r.channel}` },
    { label: 'Value', value: (r) => r.family === 20 ? `Test flag ${hex(r.test_flags)}` : fmt(r.value, settings.precision, settings.notation) },
    { label: 'Unit', value: (r) => r.unit }, { label: 'Low / high', value: (r) => `${fmt(r.low, settings.precision, settings.notation)} / ${fmt(r.high, settings.precision, settings.notation)}` },
    { label: 'TEST_FLG', value: (r) => hex(r.test_flags) }, { label: 'PARM_FLG', value: (r) => hex(r.parm_flags) },
    { label: 'Original R4 bits', value: (r) => hex(r.raw_bits, 8) }, { label: 'Result ordinal', value: (r) => r.ordinal },
  ];
  if (transpose) table(container, [{ label: 'Recorded field', value: (r) => r.label }, ...result.items.map((observation) => ({ label: `Record ${observation.seq} · result ${observation.ordinal}`, value: (field) => field.value(observation), wrap: true }))], columns, { label: 'Transposed observation page for the selected attempt' });
  else table(container, columns, result.items, { label: 'All recorded observations for the selected attempt' });
}
export function renderRecord(container, result) {
  container.replaceChildren(); detail(container, 'Decoded record fields', result.decoded).open = true;
  const raw = new Uint8Array(result.bytes), lines = [];
  for (let i = 0; i < raw.length; i += 16) lines.push(`${i.toString(16).toUpperCase().padStart(4, '0')}  ${[...raw.slice(i, i + 16)].map((n) => n.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
  container.append(element('p', `Original source offset ${result.record.offset}; ${raw.length} bytes including the record header.`, 'viewer-help'), element('pre', lines.join('\n'), 'viewer-record-bytes'));
}
