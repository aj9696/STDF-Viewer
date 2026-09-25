import { setUiLocale, tr, uiChoices } from './viewer-i18n.js';
import { formatNumber } from './viewer-number.js';
import { numericEligible } from './viewer-model.js';
import { element } from './library-home-view.js';

const TABLE = Object.freeze({ softBin: true, hardBin: true, time: true, testNumber: true, unitSuffix: false, flags: false, autoFit: true,
  appliedLimits: false, highlight: true, showLimits: true, moments: false, capability: false, outcomes: false, density: 'normal', unitStyle: 'recorded' });
const SKIP = Object.freeze({ enabled: false, noLimits: false, constant: false, neverJudged: false, nameContains: [] });
export const DEFAULT_PREFERENCES = Object.freeze({ locale: 'en', coordinateDirection: 'recorded', passColor: '#26734d', failColor: '#b63842',
  useYieldColors: false, yieldTiers: [{ minimum: 0.9, color: '#26734d' }, { minimum: 0.8, color: '#245cce' }, { minimum: 0.7, color: '#b46918' }, { minimum: 0, color: '#b63842' }], table: TABLE, skipTests: SKIP });
const color = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const PALETTES = {
  classic: { pass: '#26734d', fail: '#b63842', colors: ['#245cce', '#b55416', '#008477', '#914ab1', '#a33a58', '#5e6b25', '#476d83'] },
  blueOrange: { pass: '#126782', fail: '#b74d00', colors: ['#126782', '#b74d00', '#5f4690', '#0f8554', '#c78e00', '#8d3970', '#526170'] },
  grayscale: { pass: '#343a40', fail: '#747d86', colors: ['#343a40', '#747d86', '#9ba3aa', '#4d5964', '#89949d', '#b6bec4', '#606a73'] },
};
/** Presets cover displayed palette pages, not a restriction on valid STDF bin numbers. */
export function colorPreset(name) {
  const palette = PALETTES[name]; if (!palette) throw Error('Choose an available color preset.');
  const siteColors = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [index - 1, palette.colors[index % palette.colors.length]]));
  const binColors = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [index, palette.colors[index % palette.colors.length]]));
  return { passColor: palette.pass, failColor: palette.fail, useYieldColors: true,
    yieldTiers: [.9, .8, .7, 0].map((minimum, index) => ({ minimum, color: [palette.pass, palette.colors[0], palette.colors[4], palette.fail][index] })), siteColors, binColors };
}
export function validatePreferences(input = {}) {
  const result = structuredClone(DEFAULT_PREFERENCES);
  for (const [key, choices] of [['locale', ['en', 'ko', 'zh']], ['coordinateDirection', ['recorded', 'RD', 'RU', 'LD', 'LU']]]) {
    if (input[key] !== undefined && !choices.includes(input[key])) throw Error(`Invalid ${key}.`);
    result[key] = input[key] ?? result[key];
  }
  for (const key of ['passColor', 'failColor']) { if (input[key] !== undefined && !color(input[key])) throw Error('Choose a valid pass/fail color.'); result[key] = input[key] ?? result[key]; }
  if (input.useYieldColors !== undefined && typeof input.useYieldColors !== 'boolean') throw Error('Invalid yield-color setting.');
  result.useYieldColors = input.useYieldColors ?? result.useYieldColors;
  if (input.yieldTiers !== undefined) {
    if (!Array.isArray(input.yieldTiers) || !input.yieldTiers.length || input.yieldTiers.length > 8) throw Error('Choose one to eight yield color tiers.');
    result.yieldTiers = input.yieldTiers.map((tier) => {
      if (!tier || !Number.isFinite(tier.minimum) || tier.minimum < 0 || tier.minimum > 1 || !color(tier.color)) throw Error('Yield tiers need a minimum from zero to one and a color.');
      return { minimum: tier.minimum, color: tier.color };
    }).sort((a, b) => b.minimum - a.minimum);
    if (new Set(result.yieldTiers.map((t) => t.minimum)).size !== result.yieldTiers.length) throw Error('Yield tier thresholds must be distinct.');
  }
  for (const [group, defaults] of [['table', TABLE], ['skipTests', SKIP]]) {
    const values = input[group] ?? {};
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error(`Invalid ${group} settings.`);
    for (const [key, fallback] of Object.entries(defaults)) if (typeof fallback === 'boolean') {
      if (values[key] !== undefined && typeof values[key] !== 'boolean') throw Error(`Invalid ${group}.${key} setting.`);
      result[group][key] = values[key] ?? fallback;
    }
  }
  for (const [key, choices] of [['density', ['compact', 'normal', 'comfortable']], ['unitStyle', ['recorded', 'engineering']]]) {
    const value = input.table?.[key] ?? TABLE[key]; if (!choices.includes(value)) throw Error(`Invalid table ${key}.`); result.table[key] = value;
  }
  const names = input.skipTests?.nameContains ?? [];
  if (!Array.isArray(names) || names.length > 32 || names.some((s) => typeof s !== 'string' || s.length > 128)) throw Error('Use up to 32 test-name fragments of 128 characters.');
  result.skipTests.nameContains = [...new Set(names.map((s) => s.trim()).filter(Boolean))];
  return result;
}

export function capabilityCp(stats, family = 10) {
  if (family === 20 || stats.changingLimits || !Number.isFinite(stats.lsl) || !Number.isFinite(stats.usl) || stats.lsl >= stats.usl || !(stats.stdev > 0) || !Number.isFinite(stats.stdev)) return null;
  const cp = (stats.usl - stats.lsl) / (6 * stats.stdev); return Number.isFinite(cp) ? cp : null;
}
export function measurementOutsideLimits(row, family = 10) {
  if (family === 20 || !numericEligible(row, family)) return false;
  return Number.isFinite(row.low) && row.value < row.low || Number.isFinite(row.high) && row.value > row.high;
}
const PREFIX = { p: -12, n: -9, u: -6, 'µ': -6, m: -3, '': 0, k: 3, M: 6, G: 9 };
const SUFFIX = { '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G' };
export function measurementDisplay(value, unit, settings = {}) {
  const preferences = { ...TABLE, ...settings.table }, precision = settings.precision ?? 3, notation = settings.notation ?? 'adaptive';
  if (!preferences.unitSuffix || !unit || !Number.isFinite(value)) return formatNumber(value, precision, notation);
  if (preferences.unitStyle === 'engineering' && notation !== 'scientific') {
    const match = /^([pnuµmkMG]?)(V|A|Ω|Ohm|s|Hz|F|H|W)$/.exec(unit);
    if (match) {
      const base = value * 10 ** PREFIX[match[1]], exponent = base === 0 ? 0 : Math.max(-12, Math.min(9, 3 * Math.floor(Math.log10(Math.abs(base)) / 3)));
      if (Number.isFinite(base)) return `${formatNumber(base / 10 ** exponent, precision, notation)} ${SUFFIX[exponent]}${match[2]}`;
    }
  }
  return `${formatNumber(value, precision, notation)} ${unit}`;
}
export function orientationForDisplay(orientation = {}, settings = {}) {
  const value = settings.coordinateDirection ?? 'recorded';
  return value === 'recorded' ? { ...orientation } : { ...orientation, posX: value[0], posY: value[1], displayOverride: value };
}
export function yieldColor(value, settings = {}) {
  if (!settings.useYieldColors || !Number.isFinite(value)) return null;
  return [...(settings.yieldTiers ?? DEFAULT_PREFERENCES.yieldTiers)].sort((a, b) => b.minimum - a.minimum).find((tier) => value >= tier.minimum)?.color ?? null;
}

/** A preview of analyzed identities only, never an unqualified whole-catalog claim. */
export function previewTestExclusions(analyses, settings = {}) {
  const rules = { ...SKIP, ...settings.skipTests }, rows = [];
  for (const analysis of analyses) {
    const stats = analysis.series.map((s) => s.stats), measured = stats.filter((s) => s.count > 0), reasons = [];
    if (rules.noLimits && analysis.test.family !== 20 && measured.length && measured.every((s) => !s.changingLimits && s.lsl == null && s.usl == null)) reasons.push('No recorded limits');
    if (rules.constant && measured.length && measured.every((s) => s.min === s.max && s.min === measured[0].min)) reasons.push('Constant valid value');
    if (rules.neverJudged && stats.some((s) => s.total > 0) && stats.every((s) => s.pass + s.fail === 0)) reasons.push('No judged results');
    if (rules.nameContains.some((part) => analysis.test.name.toLowerCase().includes(part.toLowerCase()))) reasons.push('Name matches exclusion');
    rows.push({ key: analysis.test.key, number: analysis.test.number, name: analysis.test.name, hidden: rules.enabled && reasons.length > 0, reasons });
  }
  return { examined: rows.length, hidden: rows.filter((r) => r.hidden).length, rows, hiddenKeys: rows.filter((r) => r.hidden).map((r) => r.key), scope: 'Analyzed tests only; other catalog identities have not been evaluated.' };
}

const LABELS = {
  'viewer-groups': ['Files & groups', '파일 및 그룹', '文件与分组'], 'viewer-settings': ['Settings', '설정', '设置'],
  'catalog-heading': ['Tests', '테스트', '测试'], 'viewer-clear-tests': ['Clear selection', '선택 해제', '清除选择'],
  'viewer-reset-filters': ['Reset filters', '필터 초기화', '重置筛选'], 'viewer-scan-health': ['Scan test health', '테스트 상태 검사', '检查测试状态'],
  'tab-histogram': ['Histogram', '히스토그램', '直方图'], 'tab-trend': ['Trend', '추세', '趋势'], 'tab-tests': ['Statistics', '통계', '统计'],
  'tab-devices': ['Devices', '디바이스', '器件'], 'tab-bins': ['Bins', '빈', '分档'], 'tab-wafers': ['Wafers', '웨이퍼', '晶圆'],
  'tab-overview': ['File info', '파일 정보', '文件信息'], 'tab-records': ['Records', '레코드', '记录'], 'tab-dashboard': ['Overview', '개요', '概览'],
  'viewer-export': ['Export report', '보고서 내보내기', '导出报告'], 'viewer-save-session': ['Save workspace', '작업 공간 저장', '保存工作区'],
  'viewer-open-session': ['Open workspace', '작업 공간 열기', '打开工作区'], 'viewer-manage-downloads': ['Downloads', '다운로드', '下载'],
  'viewer-tests-prev': ['Previous tests', '이전 테스트', '上一页测试'], 'viewer-tests-next': ['Next tests', '다음 테스트', '下一页测试'],
};
export function applyPreferences(settings) {
  const valid = validatePreferences(settings), index = { en: 0, ko: 1, zh: 2 }[valid.locale];
  setUiLocale(valid.locale);
  document.documentElement.lang = valid.locale === 'zh' ? 'zh-CN' : valid.locale;
  document.body.dataset.tableDensity = valid.table.density;
  document.body.style.setProperty('--viewer-pass-color', valid.passColor); document.body.style.setProperty('--viewer-fail-color', valid.failColor);
  for (const [id, labels] of Object.entries(LABELS)) { const node = document.getElementById(id); if (node) node.textContent = labels[index]; }
  const toolsLabel = document.getElementById('viewer-tool-label'); if (toolsLabel) toolsLabel.textContent = tr('Tools');
  for (const option of document.querySelectorAll('#viewer-tool option[data-ui-label]')) option.textContent = tr(option.dataset.uiLabel);
  const emptyTool = document.querySelector('#viewer-tool option[value=""]'); if (emptyTool) emptyTool.textContent = tr('Choose a tool…');
  if (!document.getElementById('viewer-preferences-style')) {
    const link = document.createElement('link'); link.id = 'viewer-preferences-style'; link.rel = 'stylesheet'; link.href = new URL('./viewer-preferences.css', import.meta.url).href; document.head.append(link);
  }
}

export function preferencesEditor(form, settings, { analyses = [], scope = 'Analyzed tests only' } = {}) {
  const current = validatePreferences(settings), fields = {};
  const group = (title, open = false) => { const d = element('details', undefined, 'viewer-detail'); d.open = open; d.append(element('summary', tr(title))); const grid = element('div', undefined, 'viewer-settings-grid'); d.append(grid); form.append(d); return grid; };
  const addSelect = (grid, key, name, values, selected) => {
    const label = element('label', tr(name)), input = element('select'); input.setAttribute('aria-label', tr(name));
    for (const [value, text] of uiChoices(values)) { const option = element('option', text); option.value = value; input.append(option); }
    input.value = selected; fields[key] = input; label.append(input); grid.append(label);
  };
  const checkbox = (grid, key, name, checked) => { const label = element('label', undefined, 'checkbox-setting'), input = element('input'); input.type = 'checkbox'; input.checked = checked; fields[key] = input; label.append(input, element('span', tr(name))); grid.append(label); };
  const display = group('Display');
  addSelect(display, 'locale', 'Navigation language', [['en', 'English'], ['ko', '한국어'], ['zh', '简体中文']], current.locale);
  addSelect(display, 'coordinateDirection', 'Wafer direction', [['recorded', 'As recorded'], ['RD', 'Right / down'], ['RU', 'Right / up'], ['LD', 'Left / down'], ['LU', 'Left / up']], current.coordinateDirection);
  const table = group('Table');
  for (const [key, label] of [['softBin', 'Software bin'], ['hardBin', 'Hardware bin'], ['time', 'Test time'], ['testNumber', 'Test numbers'], ['flags', 'Raw device flags'], ['unitSuffix', 'Units with values'], ['autoFit', 'Fit columns to content'], ['appliedLimits', 'Applied limits at each value'], ['highlight', 'Highlight out-of-limit values'], ['showLimits', 'Limit and unit rows'], ['moments', 'Min / max / mean / sigma rows'], ['capability', 'Cp / Cpk rows'], ['outcomes', 'Fail / yield / count rows']]) checkbox(table, `table.${key}`, label, current.table[key]);
  addSelect(table, 'table.density', 'Row density', [['compact', 'Compact'], ['normal', 'Normal'], ['comfortable', 'Comfortable']], current.table.density);
  addSelect(table, 'table.unitStyle', 'Unit format', [['recorded', 'As recorded'], ['engineering', 'Engineering prefixes']], current.table.unitStyle);
  const colors = group('Outcome and yield colors');
  for (const [key, name] of [['passColor', 'Pass'], ['failColor', 'Fail']]) { const label = element('label', tr(name)), input = element('input'); input.type = 'color'; input.value = current[key]; fields[key] = input; label.append(input); colors.append(label); }
  checkbox(colors, 'useYieldColors', 'Color wafer tiles by yield', current.useYieldColors);
  let tiers = [];
  const tierGrid = element('div', undefined, 'viewer-settings-grid'); colors.append(tierGrid);
  const drawTiers = values => { tierGrid.replaceChildren(); tiers = values.map((tier) => {
    const label = element('label', tr('Yield ≥ (%)')), minimum = element('input'), color = element('input'); minimum.type = 'number'; minimum.min = 0; minimum.max = 100; minimum.step = 'any'; minimum.value = tier.minimum * 100;
    color.type = 'color'; color.value = tier.color; color.setAttribute('aria-label', tr('Yield tier color')); label.append(minimum, color); tierGrid.append(label); return { minimum, color };
  }); };
  drawTiers(current.yieldTiers);
  const skip = group('Hide tests');
  for (const [key, label] of [['enabled', 'Apply display exclusions'], ['noLimits', 'No limits'], ['constant', 'Constant value'], ['neverJudged', 'Never judged']]) checkbox(skip, `skipTests.${key}`, label, current.skipTests[key]);
  const nameLabel = element('label', tr('Name contains (comma-separated)')), names = element('input'); names.value = current.skipTests.nameContains.join(', '); names.maxLength = 4096; nameLabel.append(names); skip.append(nameLabel);
  const preview = element('button', tr('Preview test exclusions'), 'button secondary'); preview.type = 'button'; const result = element('div'); result.setAttribute('aria-live', 'polite'); skip.append(element('p', scope, 'viewer-help'), preview, result);
  const read = () => {
    const next = structuredClone(current);
    for (const [key, input] of Object.entries(fields)) { const [group, field] = key.split('.'), value = input.type === 'checkbox' ? input.checked : input.value; if (field) next[group][field] = value; else next[key] = value; }
    next.yieldTiers = tiers.map((t) => ({ minimum: t.minimum.valueAsNumber / 100, color: t.color.value }));
    next.skipTests.nameContains = names.value.split(',').map((s) => s.trim()).filter(Boolean); return validatePreferences(next);
  };
  preview.addEventListener('click', () => {
    try { const data = previewTestExclusions(analyses, read()); result.replaceChildren(element('p', `${data.hidden} / ${data.examined} tests hidden. ${scope}`, 'viewer-help'));
      for (const item of data.rows.filter((r) => r.reasons.length)) result.append(element('p', `${item.number} · ${item.name}: ${item.reasons.join(', ')}`, 'viewer-help'));
      if (!data.examined) result.append(element('p', 'Scan test health first to evaluate the full catalog.', 'viewer-help'));
    } catch (error) { result.textContent = error.message; }
  });
  read.setColors = value => { fields.passColor.value = value.passColor; fields.failColor.value = value.failColor; fields.useYieldColors.checked = value.useYieldColors; drawTiers(value.yieldTiers); };
  return read;
}
