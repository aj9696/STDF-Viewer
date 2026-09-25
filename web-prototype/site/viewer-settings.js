import { element } from './library-home-view.js';
const KEY = 'semidata.viewer.settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({ bins: 30, precision: 3, notation: 'adaptive', dotSize: 3, showLimits: true, showSpecs: false, showMean: true, showMedian: false, showSigma: true, showGaussian: true, cpkThreshold: 1.33, font: 'Segoe UI', siteColors: {}, binColors: {} });
export function validateSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Viewer settings must be an object.');
  const result = { ...DEFAULT_SETTINGS };
  for (const [key, low, high, integer] of [['bins', 1, 1000, true], ['precision', 0, 12, true], ['dotSize', 1, 10, false], ['cpkThreshold', 0, 100, false]]) {
    const value = input[key] ?? result[key];
    if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < low || value > high) throw new Error(`${key} must be ${low}–${high}.`);
    result[key] = value;
  }
  for (const key of ['showLimits', 'showSpecs', 'showMean', 'showMedian', 'showSigma', 'showGaussian']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`Invalid ${key} setting.`);
    result[key] = input[key] ?? result[key];
  }
  if (input.font !== undefined && !['Segoe UI', 'Arial', 'Consolas', 'SemiDataLocalFont'].includes(input.font)) throw new Error('Choose an available font.');
  result.font = input.font ?? result.font;
  if (input.notation !== undefined && !['adaptive', 'fixed', 'scientific'].includes(input.notation)) throw new Error('Choose adaptive, fixed or scientific number notation.');
  result.notation = input.notation ?? result.notation;
  for (const key of ['siteColors', 'binColors']) {
    const values = input[key] ?? {};
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 256) throw new Error('Color settings support up to 256 entries.');
    result[key] = {};
    for (const [number, fill] of Object.entries(values)) {
      if (!/^-?\d+$/.test(number) || Number(number) < -1 || Number(number) > 65535 || typeof fill !== 'string' || !/^#[0-9a-f]{6}$/i.test(fill)) throw new Error('Invalid site or bin color.');
      result[key][number] = fill;
    }
  }
  return result;
}
export function loadSettings() {
  try { const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return stored?.version === 1 ? validateSettings(stored.settings) : validateSettings(); }
  catch { return validateSettings(); }
}
export function saveSettings(settings) { const valid = validateSettings(settings); localStorage.setItem(KEY, JSON.stringify({ version: 1, settings: valid })); return valid; }
function fontDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('semidata-viewer-preferences', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('fonts');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function fontRecord(value) {
  const db = await fontDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('fonts', value ? 'readwrite' : 'readonly'), store = transaction.objectStore('fonts');
      const request = value ? store.put(value, 'custom') : store.get('custom'); let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error ?? new Error('Font storage was interrupted.'));
    });
  } finally { db.close(); }
}
let loadedFont = null;
async function installFont(bytes) {
  const face = await new FontFace('SemiDataLocalFont', bytes).load();
  if (loadedFont) document.fonts.delete(loadedFont); loadedFont = face; document.fonts.add(face);
}
export async function applyFont(settings) {
  if (settings.font === 'SemiDataLocalFont' && !loadedFont) {
    const saved = await fontRecord(); if (!saved?.bytes) throw new Error('The saved local font is unavailable. Choose a system font or add the font again.');
    await installFont(saved.bytes);
  }
  document.body.style.setProperty('--viewer-font', `"${settings.font}", system-ui, sans-serif`);
}
export function editSettings(settings, onApply) {
  const dialog = document.getElementById('viewer-settings-dialog'), form = document.getElementById('viewer-settings-form'); form.replaceChildren();
  const grid = element('div', undefined, 'viewer-settings-grid'), fields = {};
  for (const [key, name, min, max, step] of [['bins', 'Histogram bins', 1, 1000, 1], ['precision', 'Displayed decimal precision', 0, 12, 1], ['dotSize', 'Trend point size', 1, 10, 0.5], ['cpkThreshold', 'Low-Cpk warning threshold', 0, 100, 0.01]]) {
    const label = element('label', name), input = element('input'); input.type = 'number'; input.required = true; input.min = min; input.max = max; input.step = step; input.value = settings[key]; fields[key] = input; label.append(input); grid.append(label);
  }
  for (const [key, name] of [['showLimits', 'Show test limits'], ['showSpecs', 'Show specification limits'], ['showMean', 'Show mean'], ['showMedian', 'Show median'], ['showSigma', 'Show ±3/6/9 sigma'], ['showGaussian', 'Show peak-scaled Gaussian']]) {
    const label = element('label', undefined, 'checkbox-setting'), input = element('input'); input.type = 'checkbox'; input.checked = settings[key]; fields[key] = input; label.append(input, element('span', name)); grid.append(label);
  }
  const fontLabel = element('label', 'Display font'), font = element('select');
  font.setAttribute('aria-label', 'Display font');
  for (const name of ['Segoe UI', 'Arial', 'Consolas', 'SemiDataLocalFont']) { const option = element('option', name === 'SemiDataLocalFont' ? 'Your local font' : name); option.value = name; font.append(option); }
  font.value = settings.font; fontLabel.append(font); grid.append(fontLabel);
  const notationLabel = element('label', 'Number notation'), notation = element('select'); notation.setAttribute('aria-label', 'Number notation');
  for (const [value, name] of [['adaptive', 'Adaptive'], ['fixed', 'Fixed decimal'], ['scientific', 'Scientific']]) { const option = element('option', name); option.value = value; notation.append(option); }
  notation.value = settings.notation; notationLabel.append(notation); grid.append(notationLabel); form.append(grid);
  const localLabel = element('label', 'Add a local TTF or OTF font (up to 10 MiB)'), file = element('input'); file.type = 'file'; file.accept = '.ttf,.otf'; localLabel.append(file); form.append(localLabel);
  const colors = structuredClone({ siteColors: settings.siteColors, binColors: settings.binColors });
  const colorFields = element('fieldset'), colorLegend = element('legend', 'Site and bin colors'); colorFields.append(colorLegend);
  const colorRow = element('div', undefined, 'viewer-toolbar'), kindLabel = element('label', 'Color category'), kind = element('select');
  for (const [value, label] of [['siteColors', 'Site (-1 for aggregate)'], ['binColors', 'Bin number']]) { const o = element('option', label); o.value = value; kind.append(o); }
  kindLabel.append(kind); const numberLabel = element('label', 'Site or bin number'), number = element('input'); number.type = 'number'; number.step = '1'; number.min = '-1'; number.max = '65535'; number.value = '0'; numberLabel.append(number);
  const fillLabel = element('label', 'Color'), fill = element('input'); fill.type = 'color'; fill.value = '#245cce'; fillLabel.append(fill);
  const add = element('button', 'Set color', 'button secondary'); add.type = 'button'; const colorList = element('p', '', 'viewer-help');
  const renderColors = () => { colorList.textContent = Object.entries(colors).flatMap(([category, entries]) => Object.entries(entries).map(([n, c]) => `${category === 'siteColors' ? 'Site' : 'Bin'} ${n}: ${c}`)).join(' · ') || 'Default color palette'; };
  colorRow.append(kindLabel, numberLabel, fillLabel, add); colorFields.append(colorRow, colorList); form.append(colorFields); renderColors();
  const error = element('p'); error.setAttribute('role', 'alert'); form.append(error);
  add.addEventListener('click', () => {
    if (!Number.isInteger(number.valueAsNumber) || number.valueAsNumber < -1 || number.valueAsNumber > 65535) { error.textContent = 'Enter a valid site or bin number.'; return; }
    colors[kind.value][number.valueAsNumber] = fill.value; renderColors();
  });
  const save = element('button', 'Save settings', 'button primary'); save.type = 'submit'; form.append(save);
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true; error.textContent = '';
    try {
      const next = validateSettings({ ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.type === 'checkbox' ? input.checked : input.valueAsNumber])), font: font.value, notation: notation.value, ...colors });
      if (file.files.length) {
        const selected = file.files[0]; if (selected.size > 10 * 1024 * 1024) throw new Error('Choose a font no larger than 10 MiB.');
        const bytes = await selected.arrayBuffer(); await installFont(bytes); await fontRecord({ name: selected.name, bytes }); next.font = 'SemiDataLocalFont';
      }
      await applyFont(next); saveSettings(next); dialog.close(); onApply(next);
    } catch (e) { error.textContent = e.message; }
    finally { save.disabled = false; }
  };
  dialog.showModal();
}
