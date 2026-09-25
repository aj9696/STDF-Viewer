import { DataLibraryClient } from './data-client.js';
import { $, count, hydrateIcons } from './library-home-view.js';
import { renderTests, renderDefinitions, renderMeasurements } from './explorer-view.js';

const datasetId = new URL(location.href).searchParams.get('dataset');
const limits = { tests: 50, definitions: 25, measurements: 100 };
const initialPage = (after = 0) => ({ items: [], after, nextAfter: null, start: 0, history: [] });
let library, ready = false, busy = false, generation = 0, selected = null, summary = null, query = '';
let pages = { tests: initialPage(null), definitions: initialPage(), measurements: initialPage() };

function controls() {
  for (const id of ['test-query', 'test-search-submit']) $(id).disabled = !ready || busy;
  document.querySelectorAll('[data-test-number]').forEach((button) => { button.disabled = !ready || busy; });
  for (const kind of Object.keys(limits)) {
    $(`${kind}-previous`).disabled = !ready || busy || pages[kind].history.length === 0;
    $(`${kind}-next`).disabled = !ready || busy || pages[kind].nextAfter === null;
  }
  $('explorer-retry').disabled = busy;
  $('main').setAttribute('aria-busy', String(busy));
}
function clearSelection() {
  selected = null; summary = null;
  pages.definitions = initialPage(); pages.measurements = initialPage();
  $('test-detail').hidden = true; $('test-empty').hidden = false;
  $('definitions-body').replaceChildren(); $('measurements-body').replaceChildren();
}
function showError(error) {
  const guidance = {
    BUSY: 'Another tab is using this library. Close its library connection, then try again.',
    NOT_FOUND: 'This dataset is not in the current library. Return to Data library and open a saved dataset.',
    UNAVAILABLE: 'The saved dataset needs attention. Open Library tools to inspect it or recover an exported copy.',
    UNSUPPORTED: 'Local storage is unavailable here. Use a supported desktop Chrome or Edge browser at the same app address.',
    WORKER_STOPPED: 'The library connection stopped. Try again to reopen the saved dataset.',
    NOT_OPEN: 'The library connection is closed. Try again to reopen it.',
  };
  $('explorer-error-text').textContent = guidance[error.code] ?? error.message ?? String(error);
  $('explorer-error').hidden = false;
  $('test-count').textContent = 'Tests unavailable — try reopening the dataset.';
  if ($('explorer-dataset').textContent === 'Opening the saved dataset…') $('explorer-dataset').textContent = 'Dataset unavailable';
}
async function operation(label, work) {
  if (busy) return;
  const epoch = ++generation, trigger = document.activeElement;
  busy = true; $('explorer-error').hidden = true;
  $('explorer-status').textContent = label; controls();
  try {
    await work(epoch);
    if (epoch === generation) $('explorer-status').textContent = 'Saved locally';
  } catch (error) {
    if (epoch !== generation) return;
    ready = false; library?.terminate();
    showError(error); $('explorer-status').textContent = 'Needs attention';
  } finally {
    if (epoch === generation) {
      busy = false; controls();
      // Disabling an active native control blurs it. Restore a useful keyboard
      // position after reads, unless selection already focused its heading.
      if (document.activeElement === document.body && trigger !== document.body) {
        const fallback = trigger.id?.endsWith('-next') ? $(trigger.id.replace(/-next$/, '-previous'))
          : trigger.id?.endsWith('-previous') ? $(trigger.id.replace(/-previous$/, '-next')) : $('test-query');
        const target = !ready ? $('explorer-retry') : trigger.isConnected && !trigger.disabled ? trigger : fallback;
        if (!target.disabled) target.focus({ preventScroll: true });
      }
    }
  }
}
function connect() {
  return operation('Opening library…', async (epoch) => {
    ready = false; clearSelection();
    pages.tests = initialPage(null); query = ''; $('test-query').value = '';
    $('tests-body').replaceChildren(); $('test-count').textContent = 'Opening test list…';
    $('tests-page').textContent = ''; $('test-list-message').hidden = true;
    library?.terminate();
    if (!datasetId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(datasetId)) {
      throw new Error('No valid dataset was selected. Return to Data library and choose Explore tests from a dataset overview.');
    }
    const client = new DataLibraryClient(); library = client;
    await client.open();
    const dataset = await client.getDataset(datasetId);
    const page = await client.listTests(datasetId, { limit: limits.tests });
    if (epoch !== generation) return;
    $('explorer-dataset').textContent = dataset.name;
    document.title = `${dataset.name} · Test Explorer · SemiData`;
    pages.tests = { ...initialPage(null), ...page };
    ready = true; renderTests(pages.tests, selected);
  });
}
function search() {
  if (!ready) return;
  const nextQuery = $('test-query').value;
  return operation('Searching tests…', async (epoch) => {
    const page = await library.listTests(datasetId, { query: nextQuery, limit: limits.tests });
    if (epoch !== generation) return;
    query = nextQuery; clearSelection();
    pages.tests = { ...initialPage(null), ...page };
    renderTests(pages.tests, selected);
  });
}
function selectTest(number) {
  if (!ready) return;
  return operation('Reading test…', async (epoch) => {
    const client = library;
    const detail = await client.getTest(datasetId, number);
    const definitions = await client.readTestDefinitions(datasetId, number, { limit: limits.definitions });
    const measurements = await client.readTestMeasurements(datasetId, number, { limit: limits.measurements });
    if (epoch !== generation) return;
    selected = number; summary = detail;
    pages.definitions = { ...initialPage(), ...definitions };
    pages.measurements = { ...initialPage(), ...measurements };
    $('selected-test').textContent = `Test ${number}`;
    $('selected-name').textContent = pages.tests.items.find((row) => row.test_number === number)?.name ?? 'Unnamed test';
    $('test-summary').textContent = `${count(detail.measurementCount)} observations · ${count(detail.definitionCount)} recorded declarations`;
    $('test-empty').hidden = true; $('test-detail').hidden = false;
    renderTests(pages.tests, selected);
    renderDefinitions(pages.definitions, detail.definitionCount);
    renderMeasurements(pages.measurements, detail.measurementCount);
    $('selected-test').focus({ preventScroll: true });
  });
}
function turnPage(kind, direction) {
  if (!ready || busy || (kind !== 'tests' && selected === null)) return;
  const current = pages[kind], previous = direction < 0;
  if (previous ? !current.history.length : current.nextAfter === null) return;
  const history = [...current.history];
  const target = previous ? history.pop() : { after: current.nextAfter, start: current.start + current.items.length };
  if (!previous) history.push({ after: current.after, start: current.start });
  return operation('Reading page…', async (epoch) => {
    const options = { after: target.after, limit: limits[kind] };
    const page = kind === 'tests' ? await library.listTests(datasetId, { ...options, query })
      : kind === 'definitions' ? await library.readTestDefinitions(datasetId, selected, options)
        : await library.readTestMeasurements(datasetId, selected, options);
    if (epoch !== generation) return;
    pages[kind] = { ...page, ...target, history };
    if (kind === 'tests') renderTests(pages.tests, selected);
    else if (kind === 'definitions') renderDefinitions(pages.definitions, summary.definitionCount);
    else renderMeasurements(pages.measurements, summary.measurementCount);
  });
}

hydrateIcons();
$('test-search').addEventListener('submit', (event) => { event.preventDefault(); search(); });
$('tests-body').addEventListener('click', (event) => {
  const button = event.target.closest('[data-test-number]');
  if (button && !button.disabled) selectTest(Number(button.dataset.testNumber));
});
for (const kind of Object.keys(limits)) {
  $(`${kind}-previous`).addEventListener('click', () => turnPage(kind, -1));
  $(`${kind}-next`).addEventListener('click', () => turnPage(kind, 1));
}
$('explorer-retry').addEventListener('click', connect);
addEventListener('pagehide', () => { generation++; ready = false; busy = false; library?.terminate(); });
addEventListener('pageshow', (event) => { if (event.persisted) connect(); });
connect();
