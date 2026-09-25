import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), site = resolve(root, 'site'), channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Use chrome or msedge');
const output = resolve(root, 'results', `viewer-preferences-${channel}-${Date.now()}`); await mkdir(output, { recursive: true });
const html = '<!doctype html><html><head><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="viewer.css"></head><body class="data-viewer"><button id="viewer-settings">Settings</button><button id="tab-histogram">Histogram</button><main id="table"></main><dialog id="viewer-settings-dialog"><form id="viewer-settings-form"></form></dialog></body></html>';
const server = createServer(async (request, response) => {
  try { const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
    const file = resolve(site, '.' + pathname); if (!file.startsWith(site + sep)) throw Error('Outside root');
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser; const checks = [], errors = [];
try {
  browser = await chromium.launch({ channel, headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const settings = await import('./viewer-settings.js'), prefs = await import('./viewer-preferences.js'), view = await import('./viewer-view.js');
    const test = { key: 'key', number: 101, name: '<script>Voltage</script>', unit: 'V', family: 10, channel: '' };
    const stats = { count: 3, total: 3, pass: 2, fail: 1, mean: 3, min: 1, max: 5, stdev: 2, lsl: 0, usl: 6, cpk: 0.5 };
    const analysis = { test, series: [{ label: 'Fixture', stats }] }, device = { part_id: 'D1', x_index: 1, group_id: 0, source_name: 'Sample', head: 1, site: 1, part_flags: 0, hard_bin: 1, soft_bin: 1, test_time: 100, num_tests: 2, wafer_id: 4, x: 0, y: 1,
      testResults: { key: [{ seq: 11, value: 7, low: 0, high: 6, test_flags: 128, parm_flags: 0 }, { seq: 12, value: 99, low: 0, high: 6, test_flags: 2, parm_flags: 0 }] } };
    window.prefsTest = { settings, prefs, view, test, analysis, device };
    window.render = (value) => { const container = document.querySelector('#table'); container.replaceChildren(); prefs.applyPreferences(value); view.renderDevices(container, { items: [device] }, new Map([['key', test]]), { groups: [{ name: 'Fixture' }] }, () => {}, value, [analysis]); };
    window.current = settings.validateSettings({ table: { hardBin: false, appliedLimits: true, moments: true, capability: true, outcomes: true, density: 'compact', unitSuffix: true } }); window.render(window.current);
  });
  assert.equal(await page.getByRole('columnheader', { name: 'Hard bin', exact: true }).count(), 0); assert.equal(await page.getByRole('columnheader', { name: 'Soft bin', exact: true }).count(), 1);
  assert.equal(await page.locator('.viewer-measurement.value-fail').count(), 1);
  assert.match(await page.locator('#table').textContent(), /0 V ≤ value ≤ 6 V/); assert.equal(await page.locator('#table script').count(), 0);
  assert.equal(await page.locator('.viewer-spec-row').count(), 12); checks.push('Table toggles, full-population rows, invalid-value exclusion and source text safety');
  await page.evaluate(() => { const { settings } = prefsTest; settings.editSettings(current, (next) => { current = next; window.render(next); }, { analyses: [prefsTest.analysis] }); });
  await page.getByText('Display', { exact: true }).click(); await page.getByLabel('Navigation language').selectOption('ko');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.equal(await page.locator('#viewer-settings').textContent(), '설정'); assert.equal(await page.locator('html').getAttribute('lang'), 'ko');
  const restored = await page.evaluate(() => prefsTest.settings.loadSettings()); assert.equal(restored.locale, 'ko'); assert.equal(restored.table.hardBin, false); checks.push('Language and nested table preferences persist without changing source strings');
  await page.evaluate(() => { current.locale = 'zh'; prefsTest.prefs.applyPreferences(current); }); assert.equal(await page.locator('#tab-histogram').textContent(), '直方图');
  await page.evaluate(() => { current.locale = 'en'; prefsTest.prefs.applyPreferences(current); }); assert.equal(await page.locator('#tab-histogram').textContent(), 'Histogram'); checks.push('Navigation language changes are reversible');
  await page.evaluate(() => { prefsTest.settings.editSettings(current, next => { current = next; window.render(next); }, { analyses: [prefsTest.analysis], scope: 'Fixture catalog analyzed' }); });
  await page.getByLabel('Palette preset', { exact: true }).selectOption('blueOrange'); await page.getByRole('button', { name: 'Apply palette', exact: true }).click();
  await page.getByText('Hide tests', { exact: true }).click(); await page.getByRole('button', { name: 'Preview test exclusions', exact: true }).click(); assert.match(await page.locator('#viewer-settings-form').textContent(), /Fixture catalog analyzed/);
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.equal(await page.evaluate(() => current.failColor), '#b74d00'); assert.equal(await page.evaluate(() => Object.keys(current.binColors).length), 50); assert.equal(await page.evaluate(() => current.table.hardBin), false);
  await page.evaluate(() => { prefsTest.settings.editSettings(current, next => { current = next; window.render(next); }); }); await page.getByRole('button', { name: 'Reset all colors', exact: true }).click(); await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => [current.siteColors, current.binColors]), [{}, {}]); assert.equal(await page.evaluate(() => current.failColor), '#b63842'); assert.equal(await page.evaluate(() => current.table.hardBin), false); assert.equal(await page.evaluate(() => current.useYieldColors), false);
  checks.push('Palette staging/persistence and reset clear every color override while preserving non-color preferences; exclusion preview retains caller scope');
  await page.screenshot({ path: resolve(output, 'table.png') });
  await page.evaluate(() => {
    window.clipboardWrites = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { clipboardWrites.push(text); } } });
    prefsTest.view.renderRecord(document.querySelector('#table'), { record: { length: 6, offset: 32, type: 0, subtype: 10 }, bytes: new Uint8Array([2, 0, 0, 10, 2, 4]), decoded: { CPU_TYPE: 2, STDF_VER: 4 } });
  });
  assert.match(await page.locator('#table').textContent(), /REC_LEN 2 · REC_TYP 0 · REC_SUB 10/);
  await page.getByRole('button', { name: 'Copy hex', exact: true }).click(); assert.equal(await page.evaluate(() => clipboardWrites.at(-1)), '02 00 00 0A 02 04');
  await page.getByRole('button', { name: 'Copy decoded fields', exact: true }).click(); assert.deepEqual(JSON.parse(await page.evaluate(() => clipboardWrites.at(-1))), { CPU_TYPE: 2, STDF_VER: 4 });
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('Permission denied'); }; });
  await page.getByRole('button', { name: 'Copy hex', exact: true }).click(); assert.match(await page.getByRole('status').textContent(), /Could not copy: Permission denied/); assert.equal(await page.getByRole('button', { name: 'Copy hex', exact: true }).isEnabled(), true);
  checks.push('Record length header, exact hex/decoded clipboard content and visible denied-permission recovery');
  assert.deepEqual(errors, []); await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, passed: true, checks }, null, 2)); console.log(JSON.stringify({ output, checks: checks.length, passed: true }));
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
