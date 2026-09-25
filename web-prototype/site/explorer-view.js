import { $, count, element } from './library-home-view.js';

export function float32(bits) {
  if (!Number.isInteger(bits) || bits < 0 || bits > 0xffffffff) return 'Invalid recorded bits';
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits);
  const value = view.getFloat32(0);
  return Object.is(value, -0) ? '-0' : String(value);
}
export function hex(value, digits = 2) {
  return Number.isInteger(value) && value >= 0 && value < 16 ** digits
    ? `0x${value.toString(16).toUpperCase().padStart(digits, '0')}` : 'Invalid recorded flags';
}
export function recordedText(value) {
  return value == null ? 'Not recorded' : value === '' ? '(empty)' : String(value);
}
export function declarationFields(json) {
  try {
    const meta = JSON.parse(json);
    const types = { TEST_TXT: 'text', ALARM_ID: 'text', OPT_FLAG: 'flag', RES_SCAL: 'scale',
      LLM_SCAL: 'scale', HLM_SCAL: 'scale', LO_LIMIT: 'float', HI_LIMIT: 'float', UNITS: 'text',
      C_RESFMT: 'text', C_LLMFMT: 'text', C_HLMFMT: 'text', LO_SPEC: 'float', HI_SPEC: 'float' };
    if (!meta || typeof meta !== 'object' || Array.isArray(meta) || !Array.isArray(meta.PRESENT_FIELDS)
      || meta.PRESENT_FIELDS.some((field) => typeof field !== 'string' || !Object.hasOwn(types, field))
      || new Set(meta.PRESENT_FIELDS).size !== meta.PRESENT_FIELDS.length) throw new Error('Invalid metadata');
    const field = (key, type) => {
      if (!meta.PRESENT_FIELDS.includes(key)) return 'Not recorded';
      const value = meta[key];
      if (type === 'text' && typeof value === 'string') return recordedText(value);
      if (type === 'scale' && Number.isInteger(value) && value >= -128 && value <= 127) return String(value);
      if (type === 'flag' && Array.isArray(value) && value.length === 1 && Number.isInteger(value[0]) && value[0] >= 0 && value[0] <= 255) return hex(value[0]);
      if (type === 'float' && Number.isInteger(meta[`${key}_BITS`]) && meta[`${key}_BITS`] >= 0 && meta[`${key}_BITS`] <= 0xffffffff) return float32(meta[`${key}_BITS`]);
      throw new Error('Invalid metadata field');
    };
    for (const key of meta.PRESENT_FIELDS) field(key, types[key]);
    return { values: [field('TEST_TXT', 'text'), field('UNITS', 'text'), field('LO_LIMIT', 'float'),
      field('HI_LIMIT', 'float'), field('RES_SCAL', 'scale'), field('LLM_SCAL', 'scale'),
      field('HLM_SCAL', 'scale'), field('OPT_FLAG', 'flag')] };
  } catch { return { error: 'Metadata unavailable: unsupported or invalid recorded declaration.' }; }
}
export function pageLabel(page, total, label) {
  return page.items.length
    ? `${count(page.start + 1)}–${count(page.start + page.items.length)} of ${count(total)} ${label}`
    : `0 ${label}`;
}
export function renderTests(page, selected) {
  const fragment = document.createDocumentFragment();
  for (const row of page.items) {
    const button = element('button', undefined, 'test-choice');
    button.type = 'button'; button.dataset.testNumber = row.test_number;
    button.setAttribute('aria-pressed', String(row.test_number === selected));
    button.append(element('strong', `Test ${row.test_number}`), element('span', row.name ?? 'Unnamed test'),
      element('small', `${count(row.definition_count)} recorded ${row.definition_count === 1 ? 'declaration' : 'declarations'}`));
    fragment.append(button);
  }
  $('tests-body').replaceChildren(fragment);
  $('test-count').textContent = `${count(page.matchedTests)} of ${count(page.totalTests)} test numbers`;
  $('tests-page').textContent = pageLabel(page, page.matchedTests, 'tests');
  $('test-list-message').hidden = page.items.length > 0;
  $('test-list-message').textContent = page.totalTests === 0
    ? 'No PTR measurements are available in this dataset. Other record families are preserved in the original source.'
    : 'No matching tests. Try another number or name, or clear the search.';
}
export function renderDefinitions(page, total) {
  const fragment = document.createDocumentFragment();
  for (const row of page.items) {
    const tr = element('tr'); tr.append(element('td', row.id));
    const fields = declarationFields(row.metadata_json);
    if (fields.error) {
      const cell = element('td', fields.error, 'field-error'); cell.colSpan = 8; tr.append(cell);
    } else {
      fields.values.forEach((value, index) => tr.append(element('td', value, index < 2 ? 'text-cell' : undefined)));
    }
    fragment.append(tr);
  }
  $('definitions-body').replaceChildren(fragment);
  $('definitions-page').textContent = pageLabel(page, total, 'declarations');
}
export function renderMeasurements(page, total) {
  const fragment = document.createDocumentFragment();
  for (const row of page.items) {
    const tr = element('tr'), result = element('td', float32(row.result_bits));
    result.title = `IEEE-754 bits: ${hex(row.result_bits, 8)}`;
    tr.append(element('td', row.seq), element('td', row.device_id), element('td', recordedText(row.part_id), 'text-cell'),
      element('td', `${row.head} / ${row.site}`), result, element('td', row.definition_id),
      element('td', hex(row.test_flags)), element('td', hex(row.parm_flags)));
    fragment.append(tr);
  }
  $('measurements-body').replaceChildren(fragment);
  $('measurements-page').textContent = pageLabel(page, total, 'observations');
}
