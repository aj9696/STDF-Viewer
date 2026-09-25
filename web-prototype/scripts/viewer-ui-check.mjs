import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = fileURLToPath(new URL('../', import.meta.url)), channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw new Error('Use chrome or msedge');
const output = resolve(base, 'results', `viewer-ui-${channel}-${Date.now()}`); await mkdir(output, { recursive: true });
// This UI suite deliberately substitutes a deterministic provider. Actual SQLite,
// analysis population and source-decoding correctness are qualified separately.
function mockProvider() {
  const ids = ['12345678-1234-1234-1234-123456789012', '12345678-1234-1234-1234-123456789013'];
  const sources = ids.map((id, index) => ({ id, name: index ? 'Second source.stdf' : 'Source <img src=x onerror=alert(1)>.stdf', sourceBytes: 1024, sha256: 'abc', byteOrder: 'little', counts: {}, warnings: [], metadata: [{ seq: 1, type: 1, subtype: 10, fields: { LOT_ID: 'DEMO' } }] }));
  const tests = Array.from({ length: 53 }, (_, index) => { const t = { family: index === 1 ? 15 : index === 2 ? 20 : 10, number: index, name: index === 0 ? 'Leakage <script>alert(1)</script>' : `Test ${index}`, unit: index === 2 ? '' : 'V', channel: index === 1 ? 'pmr:1' : '', identity: 'resolved', observations: 120, failures: index % 2, groups: [0] }; t.key = JSON.stringify([t.family, t.number, t.name, t.unit, t.channel, t.identity]); return t; });
  window.mock = { calls: [], delay: 0, error: false, cancel: null, ids, tests, empty: new URL(location.href).searchParams.has('empty') };
  return class DataLibraryClient {
    constructor(options) { this.options = options; this.worker = {}; }
    async open() { return {}; }
    async listDatasets({ offset = 0, limit = 100 } = {}) { const all = window.mock.empty ? [] : sources; return { items: all.slice(offset, offset + limit), nextOffset: null }; }
    terminate() { this.worker = null; }
    async cancel() { window.mock.cancel?.(); }
    async viewer(action, selection, options = {}) {
      window.mock.calls.push({ action, selection: structuredClone(selection), options: structuredClone(options) });
      if (window.mock.delay) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, window.mock.delay); window.mock.cancel = () => { clearTimeout(timer); reject(Object.assign(new Error('Operation cancelled'), { code: 'CANCELLED' })); }; });
      if (window.mock.error) { window.mock.error = false; throw new Error('Deliberate recoverable provider failure'); }
      const page = (rows) => { const offset = options.offset ?? 0, limit = options.limit ?? 50; return { items: rows.slice(offset, offset + limit), total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null }; };
      const seriesKey = JSON.stringify([0, 1, null]);
      if (action === 'prepare') return {};
      if (action === 'overview') return { groups: selection.groups.map((g) => ({ ...g, total: 120, superseded: 5, passed: 100, failed: 10, unknown: 5, yield: 100 / 110 })), heads: [1, 2], sites: [{ head: 1, site: 0 }, { head: 1, site: 1 }], sources: sources.filter((s) => selection.groups.some((g) => g.datasetIds.includes(s.id))).map((s) => ({ ...s, datasetId: s.id })) };
      if (action === 'tests') return { ...page(tests.filter((t) => !options.query || t.name.includes(options.query))), countScope: 'All recorded observations before head/site/current filters.' };
      if (action === 'analyze') { const test = tests.find((t) => t.key === options.testKey); return { test, population: { observations: 120, attempts: 120 }, warnings: [], series: [{ key: seriesKey, label: 'Group 1 · Head 1 · All selected sites', group: 0, head: 1, site: null, count: 120, stats: { total: 120, count: 115, excluded: 5, pass: 100, fail: 10, unknown: 10, mean: 1.2, median: 1.1, stdev: .2, min: .5, max: 1.9, lsl: 0, usl: 2, cpk: 1.1 }, bins: [{ low: 0, high: 1, count: 50, last: false }, { low: 1, high: 2, count: 65, last: true }], points: [{ x: 0, value: .5, lsl: 0, usl: 2 }, { x: 50, value: 1.2, lsl: 0, usl: 2 }, { x: 119, value: 1.9, lsl: 0, usl: 2 }] }] }; }
      if (action === 'devices') return page(Array.from({ length: 73 }, (_, index) => ({ id: index + 1, dataset_id: ids[0], source_name: sources[0].name, group_id: 0, head: 1, site: index % 2, part_id: `DUT ${index}`, x_index: index, part_flags: index % 2 ? 8 : 0, retired: false, hard_bin: 1, soft_bin: 2, x: index, y: 0, wafer_id: 1, test_time: 20, num_tests: 3, testResults: Object.fromEntries((options.tests ?? []).map((k) => [k, [{ seq: 10, value: 1.23456789, test_flags: 0 }]])) })));
      if (action === 'device') return { attempt: { ...options, part_flags: 0 }, items: tests.slice(0, 3).map((t, i) => ({ ...t, test_name: t.name, seq: 10 + i, ordinal: 0, value: i ? 1.2345 : -0, low: 0, high: 2, test_flags: 0, parm_flags: 0, raw_bits: 0x80000000 })), nextAfter: null };
      if (action === 'bins') return { warnings: [], series: [{ key: seriesKey, label: 'Head 1 · selected sites', group: 0, head: 1, site: null, bins: Array.from({ length: 123 }, (_, number) => ({ number, name: `Bin ${number}`, count: number + 1, percent: 1, passed: number, failed: 1, unknown: 0 })) }] };
      if (action === 'wafers') return { items: [{ key: JSON.stringify([ids[0], 1, 0]), datasetId: ids[0], id: 1, group: 0, name: 'Wafer A', sourceName: sources[0].name }] };
      if (action === 'wafer') return { stacked: options.waferKey === 'stacked', wafer: options.waferKey === 'stacked' ? null : { datasetId: ids[0], id: 1, group: 0 }, orientation: { posX: 'R', posY: 'U', dieAspectRatio: 2 }, warnings: [], dies: [{ x: 0, y: 0, bin: 1, count: 1, failed: 0 }, { x: 1, y: 0, bin: 2, count: 1, failed: 1 }] };
      if (action === 'records') return page([{ seq: 1, type: 50, subtype: 10, datasetId: ids[0], sourceName: sources[0].name, fields: { TEXT_DAT: 'Safe <script>alert(1)</script>' } }]);
      if (action === 'rawRecords') return { items: [{ seq: 1, type: 0, subtype: 10, offset: 0, length: 6, device_id: null }], nextAfter: null };
      if (action === 'record') return { record: { offset: 0 }, decoded: { value: '<img src=x onerror=alert(1)>' }, bytes: new Uint8Array([2, 0, 0, 10, 2, 4]).buffer };
      throw new Error(`Unexpected action ${action}`);
    }
  };
}
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/data-client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(`export const DataLibraryClient = (${mockProvider.toString()})();`); return; }
    if (path.includes('..')) throw new Error('Invalid path');
    const extension = extname(path); response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extension] ?? 'application/octet-stream');
    response.end(await readFile(resolve(base, 'site', path.slice(1))));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser, page; const checks = [], errors = [];
try {
  browser = await chromium.launch({ channel, headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', (e) => errors.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}/viewer.html`;
  const idle = async () => { await page.waitForFunction(() => window.semidataViewer && document.querySelector('#main').getAttribute('aria-busy') === 'false'); };
  const tab = async (name) => { await page.locator(`#tab-${name}`).click(); await idle(); };
  await page.goto(url); await idle();
  assert.deepEqual(await page.evaluate(async () => { const { formatNumber } = await import('./viewer-number.js'); return [formatNumber(-0, 3), formatNumber(-0, 3, 'fixed'), formatNumber(-0, 3, 'scientific'), formatNumber(1e-8, 3), formatNumber(1.234567, 3, 'scientific'), formatNumber(NaN)]; }), ['-0', '-0.000', '-0.000e+0', '1.000e-8', '1.235e+0', 'Not available']);
  assert.equal(await page.locator('#viewer-tests input').count(), 50); assert.equal(await page.locator('img').count(), 0); await page.screenshot({ path: resolve(output, 'overview.png'), fullPage: true });
  await page.locator('#viewer-tests-next').click(); await idle(); assert.equal(await page.locator('#viewer-tests input').count(), 3); await page.locator('#viewer-tests-prev').click(); await idle();
  await page.locator('#viewer-tests input').nth(0).check(); await idle(); await page.locator('#viewer-tests input').nth(1).check(); await idle();
  await page.locator('#viewer-scan-health').click(); await idle(); assert.match(await page.locator('#viewer-health-status').textContent(), /Complete scan: 53 \/ 53/); assert.equal(await page.locator('#viewer-tests .health-warning').count(), 50); assert.equal(await page.evaluate(() => semidataViewer.getState().tests.length), 2);
  await tab('tests'); assert.match(await page.locator('#viewer-panel').textContent(), /Original device identity|Values join by original device identity/); assert.equal(await page.locator('#viewer-panel tbody').first().locator('tr').count(), 2);
  await tab('trend'); assert.equal(await page.locator('canvas').count(), 2); await page.screenshot({ path: resolve(output, 'trend.png'), fullPage: true });
  await page.getByRole('button', { name: 'Inspect range', exact: true }).first().click(); await idle();
  const picked = await page.evaluate(() => mock.calls.filter((r) => r.action === 'devices').at(-1)); assert.equal(picked.options.pick.type, 'trend'); assert.equal(picked.options.testKey, await page.evaluate(() => mock.tests[0].key));
  checks.push('Startup, safe source/test labels, catalog pagination, multi-test statistics/matrix/charts, scoped trend pick');
  checks.push('Explicit full-catalog health scan marks filtered-population failures/low Cpk beyond selected tests');
  const dut = page.getByRole('button', { name: 'DUT 0', exact: true }); await dut.click(); await idle(); assert.equal(await page.locator('#viewer-device-dialog').isVisible(), true); assert.match(await page.locator('#viewer-device-body').textContent(), /0x80000000/);
  await page.getByLabel('Transpose this page', { exact: true }).check(); assert.equal(await page.locator('#viewer-device-body .viewer-table th').count(), 4); await page.getByLabel('Transpose this page', { exact: true }).uncheck();
  assert.equal(await page.evaluate(() => mock.calls.filter((r) => r.action === 'device').at(-1).options.group), 0);
  await page.locator('#viewer-device-body').getByRole('button', { name: '10', exact: true }).click(); await idle(); assert.equal(await page.locator('#viewer-record-dialog').isVisible(), true); assert.match(await page.locator('#viewer-record-body').textContent(), /02 00 00 0A 02 04/);
  await page.getByRole('button', { name: 'Close record detail' }).click(); assert.equal(await page.evaluate(() => document.activeElement.textContent), '10');
  await page.getByRole('button', { name: 'Close device observations' }).click(); assert.equal(await page.evaluate(() => document.activeElement.textContent), 'DUT 0');
  checks.push('Device group identity, raw bits, exact bytes, nested dialog keyboard focus restoration');
  await tab('histogram'); await page.getByRole('button', { name: 'Inspect intervals', exact: true }).first().click(); await idle(); assert.equal(await page.evaluate(() => mock.calls.filter((r) => r.action === 'devices').at(-1).options.pick.type), 'histogram');
  await tab('bins'); assert.equal(await page.locator('#viewer-panel tbody tr').count(), 50); await page.locator('#viewer-panel .viewer-pager').getByRole('button', { name: 'Next page' }).click(); assert.equal(await page.locator('#viewer-panel tbody tr').count(), 50); await page.getByRole('button', { name: '50: Bin 50', exact: true }).click(); await idle(); assert.equal(await page.evaluate(() => mock.calls.filter((r) => r.action === 'devices').at(-1).options.bin.number), 50);
  await tab('wafers'); await page.getByRole('combobox', { name: 'Wafer map', exact: true }).selectOption({ index: 1 }); await idle(); await page.getByLabel('Minimum X', { exact: true }).fill('0'); await page.getByLabel('Maximum X', { exact: true }).fill('10'); await page.getByLabel('Minimum Y', { exact: true }).fill('-1'); await page.getByLabel('Maximum Y', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Apply viewport' }).click(); await idle(); assert.deepEqual(await page.evaluate(() => mock.calls.filter((r) => r.action === 'wafer').at(-1).options.bounds), { x: [0, 10], y: [-1, 1] });
  await page.getByRole('button', { name: 'Inspect die', exact: true }).click(); await idle(); assert.equal(await page.evaluate(() => mock.calls.filter((r) => r.action === 'devices').at(-1).options.group), 0);
  checks.push('Histogram interval drilldown, bounded bin pagination/drilldown, wafer viewport and group scope');
  await tab('records'); await page.getByLabel('Record collection', { exact: true }).selectOption('raw'); await idle(); await page.locator('#viewer-panel').getByRole('button', { name: '1', exact: true }).click(); await idle(); await page.getByRole('button', { name: 'Close record detail' }).click();
  await page.locator('#viewer-settings').click(); await page.getByLabel('Histogram bins', { exact: true }).fill('100'); await page.getByLabel('Number notation', { exact: true }).selectOption('scientific'); await page.getByRole('button', { name: 'Save settings', exact: true }).click(); await idle(); assert.equal(await page.evaluate(() => semidataViewer.getState().settings.bins), 100); await page.reload(); await idle(); assert.equal(await page.evaluate(() => semidataViewer.getState().settings.notation), 'scientific'); assert.equal(await page.evaluate(() => semidataViewer.getState().settings.bins), 100);
  await page.locator('#viewer-groups').click(); await page.getByRole('button', { name: 'Add comparison group', exact: true }).click(); await page.getByLabel('Saved file for group 2', { exact: true }).selectOption({ index: 1 }); await page.getByRole('button', { name: 'Add file to group', exact: true }).nth(1).click(); await page.getByRole('button', { name: 'Apply groups', exact: true }).click(); await idle(); assert.equal(await page.evaluate(() => semidataViewer.getState().selection.groups.length), 2);
  checks.push('Original record browser, validated persistent settings, independent comparison groups');
  assert.equal(await page.locator('#viewer-tests .health-warning').count(), 0);
  await page.evaluate(() => { mock.delay = 250; }); await page.locator('#tab-devices').click(); assert.equal(await page.locator('#viewer-panel').getAttribute('inert'), ''); await idle(); await page.evaluate(() => { mock.delay = 1000; }); await page.locator('#tab-bins').click(); await page.locator('#viewer-cancel').click(); await idle(); assert.match(await page.locator('#viewer-error-text').textContent(), /cancelled/); await page.evaluate(() => { mock.delay = 0; }); await page.locator('#viewer-retry').click(); await idle(); assert.equal(await page.locator('#viewer-error').isVisible(), false);
  await page.evaluate(() => { mock.delay = 150; }); await page.locator('#viewer-scan-health').click(); await page.locator('#viewer-cancel').click(); await idle(); assert.match(await page.locator('#viewer-health-status').textContent(), /Partial scan/); await page.evaluate(() => { mock.delay = 0; });
  await page.evaluate(() => { mock.error = true; }); await page.locator('#tab-devices').click(); await idle(); assert.match(await page.locator('#viewer-error-text').textContent(), /Deliberate/); await page.locator('#viewer-retry').click(); await idle();
  await page.evaluate(() => { semidataViewer.installActions({ openSession: async () => { await semidataViewer.applyWorkspace({ ...semidataViewer.getState(), tests: [mock.tests[2].key] }); window.applied = true; } }); }); await page.locator('#viewer-open-session').click(); await idle(); assert.equal(await page.evaluate(() => window.applied), true);
  checks.push('New controls remain inert during operations; cancellation, retry, action-safe workspace application');
  for (const checkpoint of ['explicit', 'query']) {
    await page.evaluate((checkpoint) => {
      window.gapReady = false; window.gapError = null; window.gapFinished = false; mock.cancel = null;
      semidataViewer.installActions({ export: async () => {
        await semidataViewer.query('overview');
        await new Promise((resolve) => { window.releaseCapture = resolve; window.gapReady = true; });
        try {
          if (checkpoint === 'explicit') semidataViewer.checkCancelled();
          await semidataViewer.query('devices'); window.gapFinished = true;
        } catch (error) { window.gapError = error.code; throw error; }
      } });
    }, checkpoint);
    await page.locator('#viewer-export').click(); await page.waitForFunction(() => window.gapReady);
    const count = await page.evaluate(() => mock.calls.length);
    await page.locator('#viewer-cancel').click(); await page.evaluate(() => window.releaseCapture()); await idle();
    assert.equal(await page.evaluate(() => window.gapError), 'CANCELLED'); assert.equal(await page.evaluate(() => window.gapFinished), false); assert.equal(await page.evaluate(() => mock.calls.length), count);
    await page.evaluate(() => semidataViewer.checkCancelled());
  }
  checks.push('Cancellation during a no-worker capture gap blocks explicit checkpoints and the next query; idle checks do not retain stale cancellation');
  for (const name of ['overview', 'tests', 'trend', 'bins', 'wafers', 'records']) { await tab(name); await page.setViewportSize({ width: 360, height: 850 }); assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth), `${name} overflows 360px`); }
  await page.screenshot({ path: resolve(output, 'mobile-360.png'), fullPage: true }); checks.push('360px no horizontal page overflow across six views');
  await page.goto(`${url}?empty=1`); await idle(); await page.evaluate(() => { semidataViewer.installActions({ openSession: async () => { mock.empty = false; await semidataViewer.applyWorkspace({ selection: { groups: [{ name: 'Restored', datasetIds: [mock.ids[0]] }] }, settings: { font: 'SemiDataLocalFont' }, tests: [] }); } }); }); assert.equal(await page.locator('#viewer-open-session').isEnabled(), true); await page.locator('#viewer-open-session').click(); await idle(); assert.equal(await page.locator('#viewer-groups').isEnabled(), true); assert.equal(await page.evaluate(() => semidataViewer.getState().settings.font), 'Segoe UI'); assert.match(await page.locator('#viewer-notice').textContent(), /font is unavailable/); checks.push('Empty-library workspace restore refreshes dataset catalog and survives missing custom font');
  assert.deepEqual(errors, []); await writeFile(resolve(output, 'summary.json'), JSON.stringify({ channel, checks, errors }, null, 2)); console.log(JSON.stringify({ output, checks, errors }, null, 2));
} catch (error) { if (page) { await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(resolve(output, 'failure.html'), await page.content()).catch(() => {}); } console.error(JSON.stringify({ output, checks, errors, error: error.stack }, null, 2)); process.exitCode = 1; }
finally { await browser?.close(); await new Promise((done) => server.close(done)); }
