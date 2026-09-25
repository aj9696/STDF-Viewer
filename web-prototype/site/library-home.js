import { DataLibraryClient } from './data-client.js';
import { inventoryFiles } from './sources.js';
import { ImportQueue } from './import-queue.js';
import { createExamplePicker } from './example-picker.js';
import { createAtdfImporter } from './library-atdf-ui.js';
import { $, bytes, count, element, hydrateIcons, renderRows, renderDataset } from './library-home-view.js';

const PAGE_SIZE = 25;
let library, datasets = [], page = 0, ready = false, busy = false, generation = 0;
let selected = null, importedId = null, importing = false, cancelling = false;
let datasetReturnFocus = null, restoreDatasetFocus = false;
let selectedItems = [], sourceFiles = [], activeQueue = null;

function returnToDataset() {
  if (!restoreDatasetFocus || busy || $('dataset-dialog').open) return;
  const selector = datasetReturnFocus?.arrow ? '.row-open' : '.file-name';
  const target = [...document.querySelectorAll(selector)].find((button) => button.dataset.datasetId === datasetReturnFocus?.id);
  (target ?? $('add-file')).focus();
  restoreDatasetFocus = false;
}

function notice(message, error = false) {
  $('library-notice').textContent = message;
  $('library-notice').hidden = !message;
  $('library-notice').classList.toggle('error-notice', error);
}
function controls() {
  for (const id of ['add-file', 'add-atdf', 'empty-import', 'try-examples', 'refresh-files', 'search-files', 'sort-files']) $(id).disabled = !ready || busy;
  document.querySelectorAll('[data-dataset-id]').forEach((button) => { button.disabled = !ready || busy; });
  $('previous-page').disabled = !ready || busy || page === 0;
  $('next-page').disabled = !ready || busy || (page + 1) * PAGE_SIZE >= filtered().length;
  $('retry-open').disabled = busy;
  $('start-import').disabled = !selected || !ready || busy;
  $('source-file').disabled = importing;
  for (const id of ['source-folder', 'choose-folder', 'include-subfolders']) $(id).disabled = importing;
  $('close-import').disabled = importing;
  $('cancel-import').disabled = !importing || cancelling;
  $('cancel-import').hidden = !importing;
  $('open-imported').disabled = busy;
  for (const id of ['show-storage', 'storage-summary']) $(id).disabled = busy;
  document.querySelectorAll('.tools-link').forEach((link) => { link.setAttribute('aria-disabled', String(busy)); });
}
function filtered() {
  const query = $('search-files').value.trim().toLocaleLowerCase();
  return datasets.filter((item) => `${item.name}\n${item.relative_path}`.toLocaleLowerCase().includes(query)).sort((a, b) => {
    if ($('sort-files').value === 'name') return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    if ($('sort-files').value === 'size') return b.source_bytes - a.source_bytes || a.id.localeCompare(b.id);
    return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
  });
}
function renderLibrary() {
  const rows = filtered();
  page = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  $('loading-library').hidden = ready || !$('connection-error').hidden;
  $('empty-library').hidden = !ready || datasets.length > 0;
  $('no-results').hidden = !ready || datasets.length === 0 || rows.length > 0;
  $('files-table-wrap').hidden = !ready || rows.length === 0;
  $('pagination').hidden = !ready || rows.length === 0;
  $('file-count').textContent = ready ? count(datasets.length) : '—';
  $('sidebar-count').textContent = ready ? count(datasets.length) : '—';
  $('total-datasets').textContent = ready ? count(datasets.length) : '—';
  $('total-measurements').textContent = ready ? count(datasets.reduce((sum, item) => sum + item.manifest.counts.measurements, 0)) : '—';
  $('total-bytes').textContent = ready ? bytes(datasets.reduce((sum, item) => sum + item.source_bytes, 0)) : '—';
  $('library-caption').textContent = ready ? `${count(datasets.length)} saved files` : 'Library disconnected';
  const start = page * PAGE_SIZE;
  $('page-label').textContent = `${count(start + 1)}–${count(Math.min(start + PAGE_SIZE, rows.length))} of ${count(rows.length)} datasets`;
  renderRows(ready ? rows.slice(start, start + PAGE_SIZE) : []);
  controls();
}
async function loadCatalog(epoch) {
  const items = [];
  let offset = 0;
  do {
    const batch = await library.listDatasets({ offset, limit: 100 });
    if (epoch !== generation) return false;
    items.push(...batch.items);
    if (items.length > 1000 || (batch.nextOffset !== null && batch.nextOffset <= offset)) throw new Error('The library inventory exceeds this preview’s supported limit. Open Library tools to inspect it.');
    offset = batch.nextOffset;
  } while (offset !== null);
  datasets = items;
  return true;
}
async function operation(work) {
  if (busy) return;
  const epoch = generation;
  busy = true; controls();
  try { await work(epoch); }
  catch (error) {
    if (epoch !== generation) return;
    notice(error.message ?? String(error), true);
    if (!library?.worker) {
      ready = false;
      showConnectionError(error);
    }
  } finally {
    if (epoch === generation) { busy = false; renderLibrary(); returnToDataset(); }
  }
}
function showConnectionError(error) {
  $('connection-error').hidden = false;
  $('connection-status').textContent = 'Library disconnected';
  $('connection-error-title').textContent = error.code === 'BUSY' ? 'Your library is open in another tab' : error.code === 'UNSUPPORTED' ? 'This browser can’t open the library' : 'We couldn’t open your library';
  $('connection-error-text').textContent = error.code === 'BUSY'
    ? 'Close the library in the other tab, then try again here. Your saved data is unchanged.'
    : error.code === 'UNSUPPORTED' ? 'Use a supported desktop browser, such as Chrome or Edge. No temporary library was created.' : `${error.message ?? error} Your saved data has not been reset.`;
}
async function connect() {
  if (busy) return;
  await operation(async (epoch) => {
    ready = false;
    $('connection-error').hidden = true;
    $('connection-status').textContent = 'Opening library…';
    renderLibrary();
    library = new DataLibraryClient({ onProgress: progress });
    try {
      const status = await library.open();
      if (!await loadCatalog(epoch)) return;
      ready = true;
      $('connection-status').textContent = 'Local library';
      notice(status.interrupted ? `${count(status.interrupted)} interrupted import${status.interrupted === 1 ? '' : 's'} need attention. Open Library tools to review them before retrying.` : '');
    } catch (error) {
      if (epoch !== generation) return;
      library.terminate();
      showConnectionError(error);
    }
  });
  void storageStatus();
  if (ready && new URLSearchParams(location.search).has('examples')) {
    history.replaceState(null, '', location.pathname);
    void examples.open();
  }
}
async function storageStatus() {
  $('storage-origin').textContent = location.origin;
  try {
    const [estimate, persistent] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]);
    $('storage-used').textContent = bytes(estimate?.usage);
    $('storage-quota').textContent = bytes(estimate?.quota);
    $('storage-persistence').textContent = persistent === undefined ? 'Unavailable' : persistent ? 'Granted by this browser' : 'Not granted';
    $('storage-summary').textContent = estimate ? `${bytes(estimate.usage)} used · Storage details` : 'Storage details';
    $('persist-storage').disabled = !navigator.storage?.persist || persistent === true;
    $('persist-storage').textContent = persistent ? 'Persistent storage granted' : 'Request persistent storage';
  } catch {
    $('storage-summary').textContent = 'Storage details';
    for (const id of ['storage-used', 'storage-quota', 'storage-persistence']) $(id).textContent = 'Unavailable';
  }
}
function importMessage(message, state = '') {
  $('import-status').textContent = message;
  $('import-status').className = `import-status ${state}`;
}
function showImport() {
  if (!ready || busy) return;
  selected = null; importedId = null;
  selectedItems = []; sourceFiles = []; $('import-outcomes').replaceChildren(); $('source-folder').value = '';
  $('source-file').value = '';
  $('selected-file').hidden = true;
  $('drop-zone').hidden = false;
  $('import-progress').hidden = true;
  $('open-imported').hidden = true;
  $('start-import').hidden = false;
  importMessage('');
  controls();
  $('import-dialog').showModal();
}
function chooseFiles(files) {
  if (importing) return;
  selected = null;
  sourceFiles = Array.from(files); selectedItems = []; $('import-outcomes').replaceChildren();
  $('selected-file').hidden = true;
  $('import-progress').hidden = true;
  $('open-imported').hidden = true;
  $('start-import').hidden = false;
  try {
    const inventory = inventoryFiles(sourceFiles, { includeSubfolders: $('include-subfolders').checked });
    if (!inventory.items.length) throw new Error(inventory.skipped[0]?.message ?? 'Choose a raw STDF file.');
    selected = inventory.items[0].file;
    selectedItems = inventory.items;
    $('selected-file').hidden = false;
    $('selected-name').textContent = selectedItems.length === 1 ? selected.name : `${selectedItems.length} files selected`;
    $('selected-size').textContent = bytes(selectedItems.reduce((total, item) => total + item.size, 0));
    importMessage(`Ready to import. The original files will stay unchanged.${inventory.skipped.length ? ` ${inventory.skipped.length} entries skipped (unsupported, empty, or outside the chosen folder depth).` : ''}`);
  } catch (error) { importMessage(error.message, 'error'); }
  controls();
}
function progress(event) {
  if (!importing) return;
  const labels = { decompressing: 'Expanding your file locally', snapshot: 'Copying and identifying your file', parsing: 'Reading test records', validating: 'Checking the saved dataset', publishing: 'Saving to your library' };
  const phases = Object.keys(labels), index = phases.indexOf(event.phase);
  $('phase-label').textContent = `${labels[event.phase] ?? event.phase}${['decompressing', 'snapshot', 'parsing'].includes(event.phase) ? ` · ${bytes(event.completedBytes)} of ${bytes(event.totalBytes)}` : ''}`;
  $('phase-progress').setAttribute('aria-label', labels[event.phase] ?? event.phase);
  if (['decompressing', 'snapshot', 'parsing'].includes(event.phase) && event.totalBytes > 0) $('phase-progress').value = Math.min(100, event.completedBytes / event.totalBytes * 100);
  else $('phase-progress').removeAttribute('value');
  document.querySelectorAll('[data-phase]').forEach((node, position) => {
    node.classList.toggle('active', position === index);
    node.classList.toggle('complete', position < index);
  });
}
async function startImport() {
  if (!selected || !ready || busy) return;
  const file = selected;
  importing = true; cancelling = false;
  // A new job may wait for the worker before its first progress event.
  $('phase-label').textContent = 'Preparing your file…';
  $('phase-progress').setAttribute('aria-label', 'Preparing your file');
  $('phase-progress').removeAttribute('value');
  document.querySelectorAll('[data-phase]').forEach((node) => node.classList.remove('active', 'complete'));
  $('import-progress').hidden = false;
  $('drop-zone').hidden = true;
  $('start-import').hidden = true;
  importMessage('Preparing your file…');
  await operation(async (epoch) => {
    try {
      if (selectedItems.length > 1) {
        activeQueue = new ImportQueue(library);
        const outcomes = await activeQueue.run(selectedItems, { onProgress: (report) => {
          importMessage(`${report.completed} of ${report.total} files processed.`);
          $('import-outcomes').replaceChildren(...report.outcomes.slice(0, 100).map((item) => element('li', `${item.relativePath}: ${item.status}${item.error ? ` — ${item.error.message}` : ''}`)));
        } });
        const completed = outcomes.filter((item) => item.dataset);
        importedId = completed.at(-1)?.dataset.id ?? null;
        importMessage(`${completed.length} saved or reused; ${outcomes.filter((o) => o.status === 'failed').length} failed; ${outcomes.filter((o) => ['cancelled', 'pending'].includes(o.status)).length} cancelled or not started.`, completed.length ? 'success' : '');
        $('open-imported').hidden = !importedId;
        if (completed.length !== outcomes.length) { $('drop-zone').hidden = false; $('start-import').hidden = false; }
        return;
      }
      const result = await library.importFile(file, { relativePath: selectedItems[0]?.relativePath ?? file.name });
      if (epoch !== generation) return;
      importedId = result.dataset.id;
      importMessage(result.duplicate ? 'Already imported — using the saved copy.' : 'Imported.', 'success');
      $('open-imported').hidden = false;
    } catch (error) {
      if (epoch !== generation) return;
      importMessage(error.code === 'CANCELLED' ? 'Import cancelled. Previously saved datasets are still available.' : `Import failed: ${error.message ?? error}`, error.code === 'CANCELLED' ? '' : 'error');
      $('drop-zone').hidden = false;
      $('start-import').hidden = false;
    } finally {
      if (epoch === generation) {
        importing = false; cancelling = false; activeQueue = null;
        $('import-progress').hidden = true;
        if (library.worker) await loadCatalog(epoch);
        else { ready = false; showConnectionError({ message: 'The library connection stopped. Reopen it to inspect the import outcome.' }); }
        void storageStatus();
      }
    }
  });
}
async function openDataset(id) {
  if (!ready || busy) return;
  datasetReturnFocus = { id, arrow: document.activeElement?.classList.contains('row-open') };
  restoreDatasetFocus = false;
  const cached = datasets.find((item) => item.id === id);
  $('dataset-name').textContent = cached?.name ?? 'Dataset';
  $('dataset-subtitle').textContent = 'Opening saved metadata…';
  $('dataset-info').replaceChildren();
  $('dataset-dialog').showModal();
  await operation(async (epoch) => {
    try {
      const dataset = await library.getDataset(id);
      if (epoch === generation) renderDataset(dataset);
    } catch (error) {
      if (epoch !== generation) return;
      $('dataset-subtitle').textContent = 'This dataset needs attention';
      $('dataset-info').replaceChildren(element('p', error.message ?? String(error), 'notice error-notice'), element('p', 'The saved entry has been kept. Library tools can help you inspect its recovery state.', 'muted'));
      if (library.worker) await loadCatalog(epoch);
      else throw error;
    }
  });
}

function openViewer(ids, example) {
  if (!ready) return;
  const params = new URLSearchParams(ids.length === 1 && !example ? { dataset: ids[0] } : { datasets: ids.join(',') });
  if (example) {
    params.set('example', example.id);
    params.set('tab', example.suggested.tab);
    params.set('test', String(example.suggested.testNumber));
    params.set('series', example.suggested.seriesBy ?? 'aggregate');
  }
  library.terminate();
  location.assign(`./viewer.html?${params}`);
}

const examples = createExamplePicker({
  available: () => ready && !busy,
  run: operation,
  client: () => library,
  refresh: loadCatalog,
  openViewer,
});
const atdf = createAtdfImporter({ available: () => ready && !busy, run: operation, client: () => library,
  refresh: async epoch => { await loadCatalog(epoch); void storageStatus(); }, openViewer });

hydrateIcons();
$('try-examples').addEventListener('click', () => examples.open());
$('add-atdf').addEventListener('click', () => atdf.open());
for (const id of ['add-file', 'empty-import']) $(id).addEventListener('click', showImport);
$('retry-open').addEventListener('click', connect);
$('refresh-files').addEventListener('click', () => operation(async (epoch) => { await loadCatalog(epoch); notice('Library refreshed.'); }));
for (const id of ['search-files', 'sort-files']) $(id).addEventListener(id === 'search-files' ? 'input' : 'change', () => { page = 0; renderLibrary(); });
$('clear-search').addEventListener('click', () => { $('search-files').value = ''; page = 0; renderLibrary(); $('search-files').focus(); });
$('previous-page').addEventListener('click', () => { --page; renderLibrary(); });
$('next-page').addEventListener('click', () => { ++page; renderLibrary(); });
$('dataset-rows').addEventListener('click', (event) => {
  const button = event.target.closest('[data-dataset-id]');
  if (!button || !ready || busy) return;
  const id = button.dataset.datasetId;
  if (button.classList.contains('file-name') && datasets.find((item) => item.id === id)?.status === 'ready') openViewer([id]);
  else void openDataset(id);
});
$('source-file').addEventListener('change', (event) => { if (event.target.files.length) chooseFiles(event.target.files); });
$('choose-folder').addEventListener('click', () => $('source-folder').click());
$('source-folder').addEventListener('change', (event) => { if (event.target.files.length) chooseFiles(event.target.files); });
$('include-subfolders').addEventListener('change', () => { if (sourceFiles.length) chooseFiles(sourceFiles); });
$('drop-zone').addEventListener('dragover', (event) => { event.preventDefault(); if (!importing) $('drop-zone').classList.add('is-dragging'); });
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('is-dragging'));
$('drop-zone').addEventListener('drop', (event) => { event.preventDefault(); $('drop-zone').classList.remove('is-dragging'); chooseFiles(event.dataTransfer.files); });
$('start-import').addEventListener('click', startImport);
$('cancel-import').addEventListener('click', async () => {
  if (!importing || cancelling) return;
  cancelling = true; controls(); importMessage('Stopping after the current operation. Waiting for the saved outcome…');
  await (activeQueue ? activeQueue.cancel() : library.cancel());
});
$('close-import').addEventListener('click', () => { if (!importing) $('import-dialog').close(); });
$('import-dialog').addEventListener('cancel', (event) => { if (importing) event.preventDefault(); });
$('open-imported').addEventListener('click', () => { if (!busy && importedId) openViewer([importedId]); });
$('close-dataset').addEventListener('click', () => $('dataset-dialog').close());
$('dataset-dialog').addEventListener('close', () => { restoreDatasetFocus = true; returnToDataset(); });
for (const id of ['show-storage', 'storage-summary']) $(id).addEventListener('click', () => { $('storage-details').showModal(); void storageStatus(); });
$('close-storage').addEventListener('click', () => $('storage-details').close());
$('persist-storage').addEventListener('click', async () => {
  $('persist-storage').disabled = true;
  try {
    const granted = await navigator.storage.persist();
    $('persistence-result').textContent = granted ? 'This browser granted protection from automatic cleanup. Keep exported backups too.' : 'This browser did not grant persistence. Your library remains browser-managed; keep exported backups.';
  } catch (error) { $('persistence-result').textContent = error.message; }
  await storageStatus();
});
document.querySelectorAll('.tools-link').forEach((link) => link.addEventListener('click', (event) => { if (busy) event.preventDefault(); }));
window.addEventListener('pagehide', () => { ++generation; library?.terminate(); ready = false; });
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  busy = false; importing = false; selected = null;
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  void connect();
});
renderLibrary();
void connect();
