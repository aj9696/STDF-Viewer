// Production report forms and document collection use real browser SQLite data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Choose chrome or msedge');
const output = resolve(root, 'results', `viewer-report-filter-ui-${channel}-${Date.now()}`), fixtures = resolve(output, 'fixtures');
await mkdir(output, { recursive: true });
const python = (file, args = []) => {
  const result = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [file, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout;
};
python(resolve(root, 'scripts/make-report-filter-fixtures.py'), [fixtures]);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (/^\/artifact\/[a-z-]+\.(xlsx|pdf|docx|zip|png)$/.test(pathname) && request.method === 'POST') {
      await pipeline(request, createWriteStream(resolve(output, pathname.slice('/artifact/'.length)))); response.end('ok'); return;
    }
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/viewer.css"><link rel="stylesheet" href="/viewer-charts.css"><input id="file" type="file"><input id="viewer-session-file" type="file" hidden><main id="tools"></main><footer class="viewer-footer"></footer>'); return;
    }
    const path = resolve(site, '.' + decodeURIComponent(pathname)); if (!path.startsWith(site + sep)) throw Error('Outside site');
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], pageErrors = [];
let browser;
try {
  browser = await chromium.launch({ channel, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => pageErrors.push(error.message)); await page.goto(origin);
  await page.evaluate(async () => {
    const { DataLibraryClient } = await import('./data-client.js'); window.library = new DataLibraryClient(); await library.open(); window.datasets = [];
  });
  for (const name of ['base', 'retest']) {
    await page.locator('#file').setInputFiles(resolve(fixtures, name + '.stdf'));
    await page.evaluate(async () => { datasets.push((await library.importFile(document.querySelector('#file').files[0])).dataset); });
  }
  await page.evaluate(async () => {
    const selection = { groups: [{ name: 'Production', datasetIds: datasets.map(dataset => dataset.id) }], attempts: 'current', heads: [1], sites: [1] };
    const test = (await library.viewer('tests', selection)).items[0]; window.traces = []; window.exports = [];
    const viewer = library.viewer.bind(library), viewerReport = library.viewerReport.bind(library);
    library.viewer = async (action, selected, options = {}) => {
      const result = await viewer(action, selected, options);
      traces.push({ action, options: structuredClone(options),
        count: action === 'analyze' ? result.series.reduce((sum, series) => sum + series.stats.count, 0) : action === 'bins' ? result.series.reduce((sum, series) => sum + series.total, 0) : action === 'wafer' ? result.attempts : action === 'advanced' && options.kind === 'dashboard' ? result.totals.total : null });
      return result;
    };
    library.viewerReport = async (selected, options) => {
      const result = await viewerReport(selected, options);
      exports.push({ deviceOutcomes: options.deviceOutcomes, kind: options.kind, images: options.images?.length ?? 0 });
      if (options.kind === 'report') await fetch('/artifact/ui-export.xlsx', { method: 'POST', body: result.file });
      return result;
    };
    window.api = { state: { selection, selected: new Map([[test.key, test]]), datasets, settings: { bins: 5, precision: 3 }, seriesBy: 'aggregate', includeAggregate: false },
      query: (action, options) => library.viewer(action, selection, options), client: () => library,
      getDatasets: () => datasets, installActions(actions) { window.actions = actions; }, checkCancelled() {},
      run: async work => { try { await work(); window.finished = true; } catch (error) { window.failure = error.stack; } } };
    window.snapshot = { ...api.state, tests: [test.key] }; delete snapshot.selected;
    const { installViewerActions } = await import('./viewer-actions.js'); installViewerActions(api);
  });
  for (const [mode, expected] of [['non-failed', 4], ['pass', 1]]) {
    const model = await page.evaluate(async mode => {
      const { collectDocumentReport } = await import('./viewer-document-ui.js');
      const { createDocumentExports } = await import('./viewer-document-formats.js'); traces.length = 0;
      const report = await collectDocumentReport(api, { selection: api.state.selection, title: 'Filtered production report', scopeLabel: 'Production · current attempts', deviceOutcomes: mode,
        sections: ['statistics', 'histogram', 'trend', 'bins', 'wafer', 'sites', 'deviceTrends', 'pcr', 'datalog'] });
      const created = await createDocumentExports(report, { formats: ['docx', 'xlsx', 'pdf', 'png'] });
      for (const item of created.files) await fetch(`/artifact/${mode}-${item.format}.${item.filename.split('.').at(-1)}`, { method: 'POST', body: item.file });
      window.lastReport = report;
      return { scope: report.scope, provenance: report.provenance, sections: report.sections.map(({ image, ...section }) => ({ ...section, imageBytes: image?.size ?? 0 })), traces: [...traces], pages: created.files.find(file => file.format === 'pdf').pages };
    }, mode);
    assert.equal(model.provenance.selection.deviceOutcomes, mode);
    assert.ok(model.scope.includes(mode === 'pass' ? 'Only device attempts' : 'Failed device attempts excluded'));
    assert.ok(!model.sections.some(section => section.title === 'Selected population'));
    assert.equal(model.sections.find(section => section.title === 'Selected test statistics').table.rows[0][2], expected);
    assert.equal(model.sections.find(section => section.title === 'Software bin counts').table.rows.reduce((sum, row) => sum + row[3], 0), expected);
    const site = model.sections.find(section => section.title === 'Site yield and timing').table.rows[0];
    assert.equal(site[3], 1); assert.equal(site[4], 0); assert.equal(site[5], mode === 'pass' ? 0 : 3);
    const methods = model.sections.find(section => section.title === 'Methods and provenance').paragraphs.join(' ');
    assert.match(methods, /filtered population/); assert.match(methods, /Retained devices can contain failed test executions/);
    assert.ok(model.traces.length >= 8); assert.ok(model.traces.every(trace => trace.options.deviceOutcomes === mode));
    for (const trace of model.traces.filter(trace => ['analyze', 'bins', 'advanced'].includes(trace.action))) assert.equal(trace.count, expected);
    assert.equal(model.traces.filter(trace => trace.action === 'wafer').reduce((sum, trace) => sum + trace.count, 0), expected);
    assert.ok(model.sections.filter(section => section.imageBytes).length >= 6); assert.ok(model.pages >= 2);
    await writeFile(resolve(output, `${mode}-model.json`), JSON.stringify(model, null, 2));
    checks.push(`${mode}: real document summaries and every chart use the same filtered population; scope/provenance survive an omitted Summary section in PDF/Word/XLSX/PNG`);
  }
  await page.evaluate(async () => { const { renderDocumentTools } = await import('./viewer-document-ui.js'); await renderDocumentTools(document.querySelector('#tools'), api); });
  assert.equal(await page.getByLabel('Report devices', { exact: true }).inputValue(), 'all');
  await page.getByLabel('Report devices', { exact: true }).selectOption('non-failed');
  await page.getByLabel('Summary and source information', { exact: true }).uncheck();
  await page.getByLabel('PDF', { exact: true }).uncheck(); await page.getByLabel('Excel summary', { exact: true }).check();
  await page.getByRole('button', { name: 'Create report', exact: true }).click();
  await page.waitForFunction(() => window.finished || window.failure); assert.equal(await page.evaluate(() => window.failure), undefined);
  await page.getByRole('button', { name: 'Download receipt', exact: true }).click();
  const receipt = await page.evaluate(async () => JSON.parse(await (await fetch(document.querySelector('a[download="report-receipt.json"]').href)).text()));
  assert.equal(receipt.reports[0].provenance.selection.deviceOutcomes, 'non-failed');
  assert.match(receipt.reports[0].scope, /Failed device attempts excluded/);
  await page.screenshot({ path: resolve(output, 'document-filter-ui.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => { document.querySelector('#tools').replaceChildren(); window.finished = false; window.failure = undefined; });
  checks.push('Production Reports form defaults to all; user-selected filter reaches its generated workbook and receipt without Summary');

  const openExport = async () => {
    await page.evaluate(() => { window.exportDone = false; window.exportFailure = undefined; void actions.export(snapshot).then(() => { window.exportDone = true; }, error => { window.exportFailure = error.stack; }); });
    await page.locator('#viewer-export-dialog').waitFor();
  };
  await openExport(); assert.equal(await page.getByLabel('Report devices', { exact: true }).inputValue(), 'all');
  await writeFile(resolve(output, 'export-accessibility.txt'), await page.locator('#viewer-export-dialog').ariaSnapshot());
  await page.getByLabel('Report devices', { exact: true }).selectOption('non-failed');
  await page.getByLabel('File Info', { exact: true }).uncheck();
  await page.evaluate(() => { traces.length = 0; });
  await page.screenshot({ path: resolve(output, 'export-filter-ui.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Generate export', exact: true }).click();
  await page.waitForFunction(() => window.exportDone || window.exportFailure); assert.equal(await page.evaluate(() => window.exportFailure), undefined);
  const exported = await page.evaluate(() => ({ traces: [...traces], last: exports.at(-1) }));
  assert.equal(exported.last.deviceOutcomes, 'non-failed'); assert.equal(exported.last.images, 6);
  assert.ok(exported.traces.every(trace => trace.options.deviceOutcomes === 'non-failed'));
  for (const trace of exported.traces.filter(trace => ['analyze', 'bins'].includes(trace.action))) assert.equal(trace.count, 4);
  assert.equal(exported.traces.filter(trace => trace.action === 'wafer').reduce((sum, trace) => sum + trace.count, 0), 4);
  await openExport(); assert.equal(await page.getByLabel('Report devices', { exact: true }).inputValue(), 'all');
  await page.getByLabel('Report devices', { exact: true }).selectOption('pass');
  await page.getByLabel('Export format', { exact: true }).selectOption('records');
  assert.equal(await page.locator('#viewer-export-outcomes').isVisible(), false);
  await page.getByRole('button', { name: 'Generate export', exact: true }).click();
  await page.waitForFunction(() => window.exportDone || window.exportFailure); assert.equal(await page.evaluate(() => window.exportFailure), undefined);
  assert.deepEqual(await page.evaluate(() => exports.at(-1)), { deviceOutcomes: 'all', kind: 'records', images: 0 });
  assert.equal(await page.evaluate(async () => (await library.viewer('devices', api.state.selection)).total), 6);
  checks.push('Investigation export modal forwards the filter to all six actual PNG charts and workbook; next dialog resets to all; records hide/ignore the report filter; workspace remains unchanged');

  const inspector = resolve(output, 'inspect-ui.py');
  await writeFile(inspector, String.raw`
import json,pathlib,sys,zipfile,xml.etree.ElementTree as E
p=pathlib.Path(sys.argv[1]);ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
for mode,count in [('non-failed',4),('pass',1)]:
 with zipfile.ZipFile(p/(mode+'-docx.docx')) as z:
  root=E.fromstring(z.read('word/document.xml'))
  text=' '.join(root.itertext())
  assert 'Failed device attempts excluded' in text if mode=='non-failed' else 'Only device attempts with a known passing outcome retained' in text
  assert 'filtered population' in text and 'Selected population' not in text
  receipt=json.loads(z.read('report-receipt.json'))
  assert receipt['provenance']['selection']['deviceOutcomes']==mode
 with zipfile.ZipFile(p/(mode+'-xlsx.xlsx')) as z:
  content=' '.join(z.read(name).decode() for name in z.namelist() if name.startswith('xl/worksheets/') and name.endswith('.xml'))
  assert 'filtered population' in content and 'deviceOutcomes' in content and mode in content
  assert len([name for name in z.namelist() if name.startswith('xl/media/')])>=6
 with zipfile.ZipFile(p/(mode+'-png.zip')) as z:
  receipt=json.loads(z.read('report-receipt.json'));assert receipt['provenance']['selection']['deviceOutcomes']==mode
  (p/(mode+'-page-1.png')).write_bytes(z.read('page-001.png'))
 pdf=(p/(mode+'-pdf.pdf')).read_bytes();assert pdf.startswith(b'%PDF-')
 assert b'"deviceOutcomes": "'+mode.encode()+b'"' in pdf
with zipfile.ZipFile(p/'ui-export.xlsx') as z:
 names=[n.attrib['name'] for n in E.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns)]
 assert names[0]=='Report scope' and 'File Info' not in names
 index=names.index('DUT Summary')+1
 rows=E.fromstring(z.read(f'xl/worksheets/sheet{index}.xml')).findall('s:sheetData/s:row',ns)
 assert len(rows)==5
 assert len([name for name in z.namelist() if name.startswith('xl/media/')])==6
 assert b'Failed device attempts excluded' in z.read('xl/worksheets/sheet1.xml')
print(json.dumps({'formats':4,'modes':2,'investigationChartImages':6,'verified':True}))
`);
  const inspected = JSON.parse(python(inspector, [output]));
  const liveDatasetId = await page.evaluate(async () => { const id = datasets[0].id; await library.close(); return id; });
  await page.setViewportSize({ width: 360, height: 800 }); await page.goto(`${origin}/viewer.html?dataset=${liveDatasetId}`);
  await page.waitForFunction(() => !document.querySelector('#viewer-workspace').disabled && document.querySelector('#main').getAttribute('aria-busy') === 'false');
  await page.locator('#viewer-workspace').click(); await page.getByRole('button', { name: 'Export report', exact: true }).click();
  await page.getByLabel('Report devices', { exact: true }).focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByLabel('Report devices', { exact: true }).inputValue(), 'non-failed');
  const bounds = await page.locator('#viewer-export-dialog').evaluate(dialog => { const rect = dialog.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width, clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth }; });
  assert.ok(bounds.left >= 0 && bounds.right <= 360 && bounds.width <= 360); assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1);
  await page.screenshot({ path: resolve(output, 'production-export-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape'); await page.locator('#viewer-export-dialog').waitFor({ state: 'detached' });
  checks.push('Actual viewer page at 360px: outcome select keyboard operation, visible labels, no dialog horizontal overflow, Escape closes');
  assert.deepEqual(pageErrors, []);
  const result = { passed: true, channel, browserVersion: browser.version(), checks, inspected, pageErrors, output };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
