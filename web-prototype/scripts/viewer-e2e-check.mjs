// Production UI + worker end to end. Only fixture provisioning uses the public API.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '..'), site = resolve(root, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Use chrome or msedge');
const output = resolve(root, 'results', `viewer-e2e-${channel}-${Date.now()}`), fixtures = resolve(repo, '.venv/viewer-fixtures');
await mkdir(output, { recursive: true });
const fixtureNames = ['golden-little.stdf', 'golden-big.stdf'];
for (const name of fixtureNames) await readFile(resolve(fixtures, name));
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/__seed.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Isolated fixture provisioning</title>'); return; }
    const base = path.startsWith('/fixture/') ? fixtures : site, file = resolve(base, '.' + (base === fixtures ? path.slice(8) : path));
    if (!file.startsWith(base + sep)) throw Error('Outside test root');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, contexts = [], checks = [], errors = [], externalRequests = [], screenshots = [], traces = [];
let page, browserInternalRequests = 0;
async function launch(name) {
  const context = await chromium.launchPersistentContext(resolve(output, name), { channel, headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  contexts.push(context); context.setDefaultTimeout(20000);
  context.on('request', (r) => {
    const url = r.url();
    // Edge opens its own downloads-hub WebUI after a successful download. These
    // browser resources are not network requests made by the application.
    if (/^(edge|chrome):/.test(url)) { browserInternalRequests++; return; }
    if (!url.startsWith(origin) && !url.startsWith('blob:' + origin)) externalRequests.push(url);
  });
  context.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); });
  return context.newPage();
}
async function ready(p = page, empty = false) {
  await p.waitForFunction(() => window.semidataViewer && document.querySelector('#main')?.getAttribute('aria-busy') === 'false');
  if (await p.locator('#viewer-error').isVisible()) throw Error(await p.locator('#viewer-error-text').textContent());
  assert.equal(await p.locator(empty ? '#viewer-open-session' : '#viewer-groups').isEnabled(), true);
}
async function click(selector, p = page) { await p.locator(selector).click(); await ready(p); }
async function tab(name) { await click('#tab-' + name); assert.equal(await page.locator('#tab-' + name).getAttribute('aria-selected'), 'true'); }
async function choose(label, value, p = page) { await p.getByRole('combobox', { name: label, exact: true }).selectOption(value); await ready(p); }
async function openDialog(id, p = page) { await p.waitForFunction((id) => document.getElementById(id)?.open, id); }
async function closedDialog(id, p = page) { await p.waitForFunction((id) => !document.getElementById(id)?.open, id); }
async function screenshot(name, fullPage = false, p = page) {
  await p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  await p.screenshot({ path: resolve(output, name), fullPage }); screenshots.push(name);
}
async function fits(p = page) {
  const bounds = await p.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => ({ left: d.getBoundingClientRect().left, right: d.getBoundingClientRect().right, width: d.scrollWidth, client: d.clientWidth })) }));
  assert.ok(bounds.document <= bounds.width + 1 && bounds.body <= bounds.width + 1, JSON.stringify(bounds));
  for (const dialog of bounds.dialogs) assert.ok(dialog.left >= 0 && dialog.right <= bounds.width + 1 && dialog.width <= dialog.client + 1, JSON.stringify(bounds));
}
async function scopedRows(expected = 2) {
  await ready(); assert.equal(await page.locator('#tab-devices').getAttribute('aria-selected'), 'true');
  const rows = await page.getByRole('region', { name: 'Device attempts', exact: true }).locator('tbody tr').allTextContents();
  assert.equal(rows.length, expected); rows.forEach((row) => { assert.match(row, /Comparison/); assert.match(row, /golden-big\.stdf/); assert.doesNotMatch(row, /Ordered merge/); });
  assert.equal(await page.getByRole('button', { name: 'Clear plot selection', exact: true }).isVisible(), true);
}
async function selectTests() {
  const wanted = await page.locator('#viewer-tests input').evaluateAll((inputs) => inputs.map((input) => ({ key: input.dataset.testKey, index: [...input.parentNode.parentNode.children].indexOf(input.parentNode) })).filter(({ key }) => {
    const test = JSON.parse(key); return test[0] === 10 || test[0] === 20 || test[0] === 15 && test[4] === 'pmr:21';
  }));
  assert.equal(wanted.length, 3);
  for (const { index } of wanted) { await page.locator('#viewer-tests input').nth(index).check(); await ready(); }
  assert.equal(await page.locator('#viewer-selected-count').textContent(), '3 / 12');
}
async function restoreUi(p, file) {
  const chooserPromise = p.waitForEvent('filechooser'); await p.locator('#viewer-open-session').click();
  const chooser = await chooserPromise; await chooser.setFiles(file); await ready(p);
}
async function download(p, action, filename) {
  const pending = p.waitForEvent('download', { timeout: 90000 }); await action();
  const result = await pending; assert.equal(result.suggestedFilename(), filename);
  await result.saveAs(resolve(output, filename)); await ready(p); return resolve(output, filename);
}
const inspect = String.raw`
import csv,json,pathlib,sys,zipfile,xml.etree.ElementTree as E
p=pathlib.Path(sys.argv[1]);ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(p/'semidata-report.xlsx') as z:
 assert z.testzip() is None
 sheets=[n.attrib['name'] for n in E.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns)]
 assert len(sheets)==8 and 'DUT Summary' in sheets and 'GDR & DTR Summary' in sheets
 images=[n for n in z.namelist() if n.startswith('xl/media/')];assert len(images)>=8
 assert all(z.read(n).startswith(b'\x89PNG\r\n\x1a\n') for n in images)
 counts=[]
 for i in range(8):
  root=E.fromstring(z.read(f'xl/worksheets/sheet{i+1}.xml'));counts.append(len(root.findall('s:sheetData/s:row',ns)))
  assert counts[-1]>1
with zipfile.ZipFile(p/'workspace.sdworkspace') as z:
 assert z.testzip() is None;manifest=json.loads(z.read('manifest.json'));assert len(manifest['sources'])==2
 assert len(manifest['state']['tests'])==3 and manifest['state']['settings']['bins']==7
 assert manifest['state']['tab']=='histogram'
with (p/'device-16.csv').open(encoding='utf-8-sig',newline='') as f:
 device=list(csv.DictReader(f));assert len(device)==7
 assert [int(r['Record sequence']) for r in device]==[17,18,19,20,20,20,21]
 assert [int(r['Result ordinal']) for r in device]==[0,0,0,0,1,2,0]
 assert [int(r['Family']) for r in device]==[10,10,10,15,15,15,20]
 assert all(r['Group']=='Comparison' and r['Head']=='1' and r['Site']=='2' and r['Part ID']=='DUPLICATE' for r in device)
 assert device[3]['Original R4 bits']=='2143294004'
with zipfile.ZipFile(p/'device-16.xlsx') as z:
 assert z.testzip() is None
 sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'));rows=sheet.findall('s:sheetData/s:row',ns);assert len(rows)==8
 sequences=[int(row.find("s:c[@r='G"+str(i+2)+"']/s:v",ns).text) for i,row in enumerate(rows[1:])]
 assert sequences==[17,18,19,20,20,20,21]
 assert not sheet.findall('.//s:f',ns)
print(json.dumps({'reportSheets':sheets,'pngImages':len(images),'reportRows':counts,'workspaceSources':2,'deviceObservations':7}))
`;
try {
  page = await launch('profile-original');
  await page.goto(origin + '/__seed.html');
  const ids = await page.evaluate(async (names) => {
    const { DataLibraryClient } = await import('./data-client.js'); const library = new DataLibraryClient(); await library.open();
    try { const ids = []; for (const name of names) { const file = new File([await (await fetch('/fixture/' + name)).blob()], name); ids.push((await library.importFile(file)).dataset.id); } return ids; }
    finally { await library.close(); }
  }, fixtureNames);
  await page.goto(origin + '/viewer.html?dataset=' + ids[0]); await ready();
  assert.equal(await page.locator('#viewer-tests input').count(), 5); assert.match(await page.locator('#viewer-panel').textContent(), /golden-little.stdf/);
  await screenshot('desktop-overview.png');
  checks.push('Production boot, local cache and five-identity PTR/MPR/FTR catalog from a real retained STDF');

  await page.locator('#viewer-groups').click(); await openDialog('viewer-groups-dialog');
  await page.getByLabel('Group 1 name', { exact: true }).fill('Ordered merge');
  await page.getByLabel('Saved file for group 1', { exact: true }).selectOption(ids[1]);
  await page.getByRole('button', { name: 'Add file to group', exact: true }).click();
  await page.getByRole('button', { name: 'Move golden-big.stdf earlier in group 1', exact: true }).click();
  assert.match(await page.locator('#viewer-group-editor ol li').first().textContent(), /1\. golden-big/);
  await page.locator('#viewer-apply-groups').click(); await ready();
  assert.deepEqual(await page.evaluate(() => semidataViewer.getState().selection.groups[0].datasetIds), [ids[1], ids[0]]);
  await tab('devices');
  const current = await page.getByRole('region', { name: 'Device attempts', exact: true }).locator('tbody tr').allTextContents();
  assert.equal(current.length, 1); assert.match(current[0], /golden-little/);
  await page.locator('#viewer-groups').click(); await openDialog('viewer-groups-dialog');
  await page.locator('#viewer-add-group').click(); await page.getByLabel('Group 2 name', { exact: true }).fill('Comparison');
  const secondGroup = page.locator('#viewer-group-editor .viewer-group').nth(1);
  await secondGroup.getByLabel('Saved file for group 2', { exact: true }).selectOption(ids[1]);
  await secondGroup.getByRole('button', { name: 'Add file to group', exact: true }).click();
  await page.locator('#viewer-apply-groups').click(); await ready();
  await page.locator('#viewer-head').selectOption('1'); await ready(); await page.locator('#viewer-site').selectOption('2'); await ready();
  await page.locator('#viewer-attempts').selectOption('all'); await ready();
  assert.equal(await page.getByRole('region', { name: 'Device attempts', exact: true }).locator('tbody tr').count(), 6);
  checks.push('Files & groups UI preserves ordered sources; current retest follows last file; independent comparison and head/site/all-attempt filters render six scoped attempts');

  await selectTests(); await tab('tests');
  const stats = page.getByRole('region', { name: 'Full-population test statistics', exact: true });
  assert.equal(await stats.locator('tbody tr').count(), 6);
  assert.match(await stats.textContent(), /MULTI/); assert.match(await stats.textContent(), /SCAN/);
  await page.locator('#viewer-scan-health').click(); await ready(); assert.match(await page.locator('#viewer-health-status').textContent(), /^Complete scan: 5 \/ 5/);
  await page.locator('#viewer-settings').click(); await openDialog('viewer-settings-dialog');
  await page.getByLabel('Histogram bins', { exact: true }).fill('7'); await page.getByRole('button', { name: 'Save settings', exact: true }).click(); await ready();
  checks.push('Actual PTR/MPR-channel/FTR checkbox selections drive full-population statistics and matrix; test-health scan and histogram settings operate against real data');

  await tab('trend'); assert.equal(await page.locator('.viewer-chart').count(), 3);
  let chart = page.locator('.viewer-chart').first();
  await chart.locator('.chart-legend button').first().click();
  await chart.getByLabel('First device index', { exact: true }).fill('1'); await chart.getByLabel('Last device index', { exact: true }).fill('2');
  await chart.getByRole('button', { name: 'Inspect range', exact: true }).click(); await scopedRows();
  const device = page.getByRole('region', { name: 'Device attempts', exact: true }).getByRole('button', { name: 'DUPLICATE', exact: true }).first();
  await device.click(); await ready(); await openDialog('viewer-device-dialog');
  assert.match(await page.locator('#viewer-device-body').textContent(), /MPR/); assert.match(await page.locator('#viewer-device-body').textContent(), /FTR/);
  await page.locator('#viewer-device-body').getByRole('button', { name: '20', exact: true }).first().click(); await ready(); await openDialog('viewer-record-dialog');
  assert.match(await page.locator('#viewer-record-body').textContent(), /MPR/); assert.ok((await page.locator('.viewer-record-bytes').textContent()).length > 100);
  await page.keyboard.press('Escape'); await closedDialog('viewer-record-dialog');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '20');
  await download(page, () => page.locator('#viewer-device-dialog').getByRole('button', { name: 'Export CSV', exact: true }).click(), 'device-16.csv');
  await download(page, () => page.locator('#viewer-device-dialog').getByRole('button', { name: 'Export Excel', exact: true }).click(), 'device-16.xlsx');
  await page.keyboard.press('Escape'); await closedDialog('viewer-device-dialog');
  await tab('histogram'); chart = page.locator('.viewer-chart').first();
  await chart.locator('.chart-legend button').first().click(); await chart.getByLabel('Lower value', { exact: true }).fill('-1000'); await chart.getByLabel('Upper value', { exact: true }).fill('1000');
  await chart.getByRole('button', { name: 'Inspect intervals', exact: true }).click(); await scopedRows();
  await tab('bins'); await page.getByLabel(/^Bin series/).selectOption('1'); await page.getByLabel('Bin number', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Inspect bin', exact: true }).click(); await scopedRows();
  await tab('wafers');
  const wafer = await page.getByLabel('Wafer map', { exact: true }).locator('option').evaluateAll((options) => options.find((o) => o.textContent.includes('Comparison')).value);
  await choose('Wafer map', wafer); await page.getByLabel('Die X coordinate', { exact: true }).fill('12'); await page.getByLabel('Die Y coordinate', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Inspect die', exact: true }).click(); await scopedRows();
  checks.push('Trend, histogram, bin and wafer UI picks retain comparison-group/source/head/site/attempt scope; nested device-to-original-MPR drilldown, seven-observation CSV/XLSX exports and Escape focus work');

  await tab('records'); assert.equal(await page.getByRole('region', { name: 'Decoded metadata records', exact: true }).locator('tbody tr').count(), 6);
  await choose('Record collection', 'raw'); assert.equal(await page.getByRole('region', { name: 'Original source records', exact: true }).locator('tbody tr').count(), 31);
  await page.getByRole('region', { name: 'Original source records', exact: true }).getByRole('button', { name: '20', exact: true }).click(); await ready(); await openDialog('viewer-record-dialog');
  assert.match(await page.locator('#viewer-record-body').textContent(), /MPR/); await page.getByRole('button', { name: 'Close record detail', exact: true }).click(); await closedDialog('viewer-record-dialog');
  await tab('overview'); await tab('histogram'); await screenshot('desktop-histogram.png');
  checks.push('All eight production tabs render; indexed datalog and complete original records expose exact source-byte detail');

  await page.locator('#viewer-export').click(); await openDialog('viewer-export-dialog');
  assert.equal(await page.locator('#viewer-export-images').isChecked(), true);
  await download(page, () => page.getByRole('button', { name: 'Generate export', exact: true }).click(), 'semidata-report.xlsx');
  const workspaceFile = await download(page, () => page.locator('#viewer-save-session').click(), 'workspace.sdworkspace');
  const savedState = await page.evaluate(() => semidataViewer.getState()); traces.push({ savedState });
  await click('#viewer-clear-tests'); await tab('overview'); await restoreUi(page, workspaceFile);
  assert.deepEqual(await page.evaluate(() => semidataViewer.getState()), savedState);
  const datasets = await page.evaluate(() => semidataViewer.getDatasets()); assert.equal(datasets.length, 2);
  checks.push('Export dialog generates and downloads complete Excel report with real chart PNGs; workspace download restores settings, selected tests, tab and ordered groups in an existing library');

  await page.setViewportSize({ width: 360, height: 900 }); await fits(); await screenshot('mobile-histogram.png', true);
  for (const name of ['overview', 'devices', 'tests', 'trend', 'histogram', 'bins', 'wafers', 'records']) { await tab(name); await fits(); }
  await page.locator('#viewer-groups').click(); await openDialog('viewer-groups-dialog'); await fits(); await screenshot('mobile-groups.png');
  await page.getByRole('button', { name: 'Close files and groups', exact: true }).click(); await closedDialog('viewer-groups-dialog');
  await tab('devices'); await page.getByRole('region', { name: 'Device attempts', exact: true }).getByRole('button', { name: 'DUPLICATE', exact: true }).first().click(); await ready(); await openDialog('viewer-device-dialog');
  await fits(); await screenshot('mobile-device.png'); await page.getByRole('button', { name: 'Close device observations', exact: true }).click(); await closedDialog('viewer-device-dialog');
  checks.push('All tabs and populated group/device dialogs fit 360 px; wide tables scroll inside their own regions');

  await page.reload(); await ready();
  await page.locator('#viewer-manage-downloads').click(); await openDialog('viewer-download-dialog'); await fits();
  const inventory = page.locator('#viewer-download-dialog');
  assert.equal(await inventory.getByRole('status').textContent(), '4 temporary files');
  const workspaceRow = inventory.locator('.viewer-toolbar').filter({ hasText: '.sdworkspace' });
  const recoveredDownload = page.waitForEvent('download'); await workspaceRow.getByRole('button', { name: 'Download', exact: true }).click();
  const recovered = await recoveredDownload; assert.match(recovered.suggestedFilename(), /^[0-9a-f-]{36}\.sdworkspace$/);
  const recoveredPath = resolve(output, 'recovered-workspace.sdworkspace'); await recovered.saveAs(recoveredPath); assert.deepEqual(await readFile(recoveredPath), await readFile(workspaceFile));
  await screenshot('mobile-generated-files.png');
  for (let remaining = 3; remaining >= 0; remaining--) {
    await inventory.getByRole('button', { name: 'Remove temporary copy', exact: true }).first().click();
    await page.waitForFunction((count) => document.querySelector('#viewer-download-dialog [role="status"]')?.textContent === count + ' temporary files', remaining);
  }
  await inventory.getByRole('button', { name: 'Close', exact: true }).click(); await ready();
  const verified = await page.evaluate(async (ids) => { const output = []; for (const id of ids) output.push(await semidataViewer.client().verifyDataset(id)); return output; }, ids);
  assert.ok(verified.every((result) => result.verified));
  checks.push('Generated-file dialog survives reload, downloads byte-identical retained workspace and explicitly removes all four temporary exports; both original source datasets still pass checksum/integrity verification');

  const restoredPage = await launch('profile-empty-restore');
  await restoredPage.goto(origin + '/viewer.html'); await ready(restoredPage, true);
  assert.match(await restoredPage.locator('#viewer-panel').textContent(), /library is empty/i);
  assert.equal(await restoredPage.locator('#viewer-save-session').isDisabled(), true);
  await restoreUi(restoredPage, workspaceFile);
  const freshState = await restoredPage.evaluate(() => semidataViewer.getState()), freshDatasets = await restoredPage.evaluate(() => semidataViewer.getDatasets());
  assert.equal(freshDatasets.length, 2); assert.deepEqual(freshState.tests, savedState.tests); assert.deepEqual(freshState.settings, savedState.settings); assert.equal(freshState.tab, 'histogram');
  const hashByOld = Object.fromEntries(datasets.map((d) => [d.id, d.manifest.source.sha256])), hashByNew = Object.fromEntries(freshDatasets.map((d) => [d.id, d.manifest.source.sha256]));
  assert.deepEqual(freshState.selection.groups.map((g) => g.datasetIds.map((id) => hashByNew[id])), savedState.selection.groups.map((g) => g.datasetIds.map((id) => hashByOld[id])));
  assert.ok(freshState.selection.groups.flatMap((g) => g.datasetIds).every((id) => !ids.includes(id)));
  await screenshot('restored-workspace.png', false, restoredPage);
  await restoredPage.reload(); await ready(restoredPage); assert.equal(await restoredPage.locator('#viewer-selected-count').textContent(), '3 / 12');
  checks.push('Open workspace is usable in an empty library; restore rebuilds caches, remaps source IDs by verified hashes and retains ordered groups/tests/settings through reload');

  const inspectFile = resolve(output, 'inspect-downloads.py'); await writeFile(inspectFile, inspect);
  const inspected = spawnSync(resolve(repo, '.venv/Scripts/python.exe'), [inspectFile, output], { encoding: 'utf8' }); assert.equal(inspected.status, 0, inspected.stderr);
  const downloads = JSON.parse(inspected.stdout); assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, checks, screenshots, downloads, traces, errors, externalRequests, browserInternalRequests }, null, 2));
  console.log(JSON.stringify({ output, checks, downloads, screenshots }));
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, screenshots, traces, errors, externalRequests, url: page?.url() }, null, 2)); throw error;
} finally { for (const context of contexts) await context.close(); await new Promise((done) => server.close(done)); }
