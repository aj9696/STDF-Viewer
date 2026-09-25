import { element } from './library-home-view.js';
import { renderTrend, renderHistogram, renderBins, renderWafer } from './viewer-charts.js';

const SECTIONS = ['File Info', 'DUT Summary', 'Trend Chart', 'Histogram', 'Bin Chart', 'Wafer Map', 'Test Statistics', 'GDR & DTR Summary'];
const generatedLinks = new Map();
const generatedIdentity = (kind, token) => `${kind}:${token}`;
function forgetDownload(identity) {
  for (const { url, row } of generatedLinks.get(identity) ?? []) { URL.revokeObjectURL(url); row.remove(); }
  generatedLinks.delete(identity);
}
window.addEventListener('pagehide', () => { for (const identity of generatedLinks.keys()) forgetDownload(identity); }, { once: true });
function reportChoice(state, datasets) {
  return new Promise((resolve) => {
    const dialog = element('dialog', undefined, 'modal'), title = element('h2', 'Export your data');
    dialog.id = 'viewer-export-dialog'; title.id = 'viewer-export-title'; dialog.setAttribute('aria-labelledby', title.id);
    const form = element('form'), mode = element('select'), label = element('label', 'Export format'); label.append(mode);
    mode.id = 'viewer-export-mode';
    for (const [value, text] of [['report', 'Excel investigation report'], ['records', 'Complete STDF record workbook'], ['diagnostics', 'Workspace diagnostic JSON']]) { const option = element('option', text); option.value = value; mode.append(option); }
    const sections = element('fieldset'), legend = element('legend', 'Report sections'); sections.append(legend);
    for (const name of SECTIONS) {
      const box = element('input'); box.type = 'checkbox'; box.value = name; box.checked = true; box.name = 'section';
      const row = element('label', undefined, 'export-option'); row.append(box, document.createTextNode(name)); sections.append(row);
    }
    const images = element('input'); images.type = 'checkbox'; images.checked = true; images.id = 'viewer-export-images';
    const imageLabel = element('label', undefined, 'export-option'); imageLabel.append(images, document.createTextNode('Include chart images (up to 32 wafer maps)'));
    const source = element('select'); source.id = 'viewer-export-source';
    for (const id of new Set(state.selection.groups.flatMap((g) => g.datasetIds))) { const option = element('option', datasets.find((d) => d.id === id)?.name ?? id); option.value = id; source.append(option); }
    const sourceLabel = element('label', 'Record source'); sourceLabel.append(source); sourceLabel.hidden = true;
    const note = element('p', `${state.tests.length} selected tests. Reports retain the current groups, heads, sites and attempt policy. File information includes source hashes and methods.`, 'muted');
    const actions = element('div', undefined, 'dialog-actions'), cancel = element('button', 'Cancel', 'button secondary'), submit = element('button', 'Generate export', 'button primary');
    cancel.type = 'button'; submit.type = 'submit'; actions.append(cancel, submit);
    form.append(label, note, sections, imageLabel, sourceLabel, actions); dialog.append(title, form); document.body.append(dialog);
    mode.addEventListener('change', () => { sections.hidden = imageLabel.hidden = mode.value !== 'report'; sourceLabel.hidden = mode.value !== 'records'; });
    cancel.addEventListener('click', () => dialog.close());
    let result = null;
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const selected = [...sections.querySelectorAll('input:checked')].map((el) => el.value);
      if (mode.value === 'report' && !selected.length) { note.textContent = 'Select at least one report section.'; return; }
      result = { kind: mode.value, sections: selected, includeImages: images.checked, datasetId: source.value }; dialog.close();
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true }); dialog.showModal();
  });
}

function showDownload(file, filename, release, identity = Symbol('local download')) {
  let panel = document.getElementById('viewer-downloads');
  if (!panel) { panel = element('section', undefined, 'library-panel viewer-downloads'); panel.id = 'viewer-downloads'; panel.append(element('h2', 'Generated files')); document.querySelector('.viewer-footer').before(panel); }
  const row = element('div', undefined, 'viewer-toolbar'), link = element('a', `Download ${filename}`, 'button secondary'), remove = element('button', 'Remove temporary copy', 'quiet-button');
  const url = URL.createObjectURL(file); link.href = url; link.download = filename;
  if (!generatedLinks.has(identity)) generatedLinks.set(identity, new Set());
  generatedLinks.get(identity).add({ url, row });
  row.append(link, element('span', `${(file.size / 1024 / 1024).toFixed(2)} MiB`));
  if (window.showSaveFilePicker) {
    const save = element('button', 'Save to a chosen location', 'quiet-button');
    save.type = 'button'; save.addEventListener('click', async () => {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: filename });
        save.disabled = true; await file.stream().pipeTo(await handle.createWritable()); save.textContent = 'Saved to disk';
      } catch (error) { if (error.name !== 'AbortError') save.textContent = error.message; }
      finally { save.disabled = false; }
    }); row.append(save);
  }
  remove.type = 'button'; remove.addEventListener('click', async () => {
    remove.disabled = true;
    try { await release?.(); forgetDownload(identity); }
    catch (error) { remove.disabled = false; remove.textContent = error.message; }
  }); row.append(remove); panel.append(row); link.click();
}

async function manageDownloads(api) {
  const dialog = element('dialog', undefined, 'viewer-dialog'), title = element('h2', 'Generated files');
  dialog.id = 'viewer-download-dialog'; title.id = 'viewer-download-title'; dialog.setAttribute('aria-labelledby', title.id);
  const note = element('p', 'Report and workspace downloads use temporary local storage. After saving a copy to disk and confirming the download finished, remove its temporary copy here. Interrupted exports may also appear; this list does not certify file completeness.', 'viewer-help');
  const body = element('div'), status = element('p'), close = element('button', 'Close', 'button secondary');
  let inFlight = false, closeRequested = false;
  const closeWhenReady = () => { if (inFlight) closeRequested = true; else dialog.close(); };
  status.setAttribute('role', 'status'); close.type = 'button'; close.addEventListener('click', closeWhenReady);
  dialog.addEventListener('cancel', (event) => { if (inFlight) { event.preventDefault(); closeRequested = true; } });
  dialog.append(title, note, body, status, close); document.body.append(dialog);
  const request = (action, options = {}) => api.client().request('viewerDownloads', { action, ...options });
  const perform = async (work) => {
    if (inFlight) return;
    inFlight = true;
    const controls = [...dialog.querySelectorAll('button')].map((button) => [button, button.disabled]);
    controls.forEach(([button]) => { button.disabled = true; });
    try { await work(); }
    catch (error) { status.textContent = error.message; }
    finally {
      inFlight = false;
      for (const [button, disabled] of controls) if (button.isConnected) button.disabled = disabled;
      if (closeRequested) dialog.close();
    }
  };
  const load = async (offset = 0) => {
    const page = await request('list', { offset }); body.replaceChildren(); status.textContent = `${page.total} temporary files`;
    for (const item of page.items) {
      const row = element('div', undefined, 'viewer-toolbar'), name = element('span', `${item.token} · ${(item.bytes / 1024 ** 2).toFixed(2)} MiB`);
      name.style.overflowWrap = 'anywhere';
      const download = element('button', 'Download', 'quiet-button'), remove = element('button', 'Remove temporary copy', 'quiet-button');
      for (const button of [download, remove]) button.type = 'button';
      download.addEventListener('click', () => perform(async () => {
        const result = await request('get', item); showDownload(result.file, result.filename, () => request('release', item), generatedIdentity(item.kind, item.token));
      }));
      remove.addEventListener('click', () => perform(async () => {
        await request('release', item); forgetDownload(generatedIdentity(item.kind, item.token)); await load(offset);
      })); row.append(name, download, remove); body.append(row);
    }
    for (const [label, next] of [['Previous page', Math.max(0, offset - 50)], ['Next page', page.nextOffset]]) {
      const button = element('button', label, 'quiet-button'); button.type = 'button'; button.disabled = label === 'Previous page' ? offset === 0 : next === null;
      button.addEventListener('click', () => perform(() => load(next))); body.append(button);
    }
  };
  try { await load(); dialog.showModal(); await new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true })); }
  finally { dialog.remove(); }
}

async function chartImages(api, state, choice) {
  const output = [], offsets = new Map(), host = element('div');
  Object.assign(host.style, { position: 'fixed', left: '-12000px', top: '0', width: '1000px', background: '#fff' }); document.body.append(host);
  const capture = async (sheet, render, data) => {
    api.checkCancelled?.();
    const chart = render(host, { ...data, settings: state.settings });
    try {
      const blob = await chart.exportPng();
      api.checkCancelled?.();
      const row = offsets.get(sheet) ?? 1;
      output.push({ sheet, blob, anchor: { column: 24, row, width: 1000, height: 500 } }); offsets.set(sheet, row + 28);
    } finally { chart.destroy(); host.replaceChildren(); }
  };
  try {
    if (choice.sections.some((s) => ['Trend Chart', 'Histogram'].includes(s))) for (const key of state.tests) {
      api.checkCancelled?.();
      const data = await api.query('analyze', { testKey: key, bins: state.settings.bins, seriesBy: state.seriesBy, includeAggregate: state.includeAggregate });
      api.checkCancelled?.();
      const title = `${data.test.number}: ${data.test.name} ${data.test.channel}`, label = data.test.family === 20 ? 'Test flag (status byte)' : `Value (${data.test.unit || 'base units'})`;
      if (choice.sections.includes('Trend Chart')) await capture('Trend Chart', renderTrend, { series: data.series, title, yLabel: label });
      if (choice.sections.includes('Histogram')) await capture('Histogram', renderHistogram, { series: data.series, title, xLabel: label });
    }
    if (choice.sections.includes('Bin Chart')) for (const kind of ['hard', 'soft']) {
      api.checkCancelled?.(); const data = await api.query('bins', { kind, seriesBy: state.seriesBy }); api.checkCancelled?.();
      await capture('Bin Chart', renderBins, { ...data, title: `${kind === 'hard' ? 'Hardware' : 'Software'} bin counts` });
    }
    if (choice.sections.includes('Wafer Map')) {
      api.checkCancelled?.();
      const maps = await api.query('wafers');
      api.checkCancelled?.();
      if (maps.items.length > 32) throw new Error('This report has more than 32 wafer chart images. Disable images to export the complete wafer data, or select fewer sources.');
      for (const wafer of maps.items) {
        api.checkCancelled?.(); const data = await api.query('wafer', { waferKey: wafer.key }); api.checkCancelled?.();
        await capture('Wafer Map', renderWafer, { ...data, title: `${wafer.name} · ${wafer.sourceName}` });
      }
    }
  } finally { host.remove(); }
  return output;
}

export function installViewerActions(api) {
  const input = document.getElementById('viewer-session-file'); input.accept = '.sdworkspace';
  const pickSession = () => new Promise((resolve) => {
    input.value = '';
    const finish = () => { input.removeEventListener('change', finish); input.removeEventListener('cancel', finish); resolve(input.files[0] ?? null); };
    input.addEventListener('change', finish); input.addEventListener('cancel', finish); input.click();
  });
  api.installActions({
    async manageDownloads() { await manageDownloads(api); },
    async exportDevice(state, device, format) {
      api.checkCancelled?.();
      const result = await api.client().viewerReport(state.selection, { kind: format === 'csv' ? 'deviceCsv' : 'device', device });
      showDownload(result.file, result.filename, () => api.client().request('viewerReport', { action: 'release', token: result.token }), generatedIdentity('report', result.token));
    },
    async saveSession(state) {
      const result = await api.client().viewerTransfer('saveSession', { state });
      showDownload(result.file, result.filename, () => api.client().viewerTransfer('release', { token: result.token }), generatedIdentity('workspace', result.token));
    },
    async openSession() {
      const file = await pickSession(); if (!file) return;
      const result = await api.client().viewerTransfer('restoreSession', { file });
      await api.applyWorkspace(result.state);
    },
    async export(state) {
      const choice = await reportChoice(state, api.getDatasets()); if (!choice) return;
      api.checkCancelled?.();
      if (choice.kind === 'diagnostics') {
        const info = await api.query('overview');
        api.checkCancelled?.();
        const diagnostic = { format: 'semidata-viewer-diagnostic', version: 1, createdAt: new Date().toISOString(), state,
          environment: { userAgent: navigator.userAgent, origin: location.origin, secureContext: isSecureContext },
          sources: info.sources.map(({ datasetId, name, sha256, sourceBytes, counts, byteOrder, warnings }) => ({ datasetId, name, sha256, sourceBytes, counts, byteOrder, warnings })) };
        showDownload(new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' }), 'semidata-diagnostic.json'); return;
      }
      const images = choice.kind === 'report' && choice.includeImages ? await chartImages(api, state, choice) : [];
      api.checkCancelled?.();
      const result = await api.client().viewerReport(state.selection, { ...choice, tests: state.tests, bins: state.settings.bins, seriesBy: state.seriesBy,
        includeAggregate: state.includeAggregate, settings: state.settings, images });
      showDownload(result.file, result.filename, () => api.client().request('viewerReport', { action: 'release', token: result.token }), generatedIdentity('report', result.token));
    },
  });
}
