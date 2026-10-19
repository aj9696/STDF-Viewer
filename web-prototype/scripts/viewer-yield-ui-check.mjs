// Deterministic Yield Manager UI checks, then real Rust/WASM + SQLite integration.
// Complete provider count, retest, and scope coverage lives in viewer-yield-check.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const base = fileURLToPath(new URL('../', import.meta.url)), site = resolve(base, 'site');
const channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Use chrome or msedge');
const output = resolve(base, 'results', `viewer-yield-ui-${channel}-${Date.now()}`);
await mkdir(output, { recursive: true });

function mockProvider() {
  const ids = Array.from({ length: 8 }, (_, i) => `12345678-1234-1234-1234-${String(i + 1).padStart(12, '0')}`);
  const common = { lotId: 'LOT-100', sublotId: 'S1', product: 'P1', program: 'CP-program', revision: 'A', flow: 'CP', stage: 'WAFER', tester: 'ATE-1' };
  const specs = [
    { name: 'baseline <img src=x onerror=alert(1)>.stdf', date: '2026-10-01T12:00:00Z', counts: [8, 1, 1] },
    { name: 'follow-up.stdf', date: '2026-10-02T12:00:00Z', counts: [6, 3, 1] },
    { name: 'other-product.stdf', date: '2026-10-03T12:00:00Z', counts: [5, 5, 0], product: 'P2' },
    { name: 'other-revision.stdf', date: '2026-10-04T12:00:00Z', counts: [9, 1, 0], revision: 'B' },
    { name: 'undated-sublot.stdf', date: null, counts: [7, 2, 1], sublotId: 'S2' },
    { name: 'no-lot-first.stdf', date: '2026-10-05T12:00:00Z', counts: [0, 0, 5], lotId: null },
    { name: 'no-lot-empty.stdf', date: null, counts: [0, 0, 0], lotId: null },
    { name: 'comparison-group.stdf', date: '2026-10-06T12:00:00Z', counts: [2, 2, 0] },
  ].map((spec, i) => ({ ...common, ...spec, datasetId: ids[i], sourceIndex: i, startTime: spec.date ? Date.parse(spec.date) / 1000 : null }));
  const sources = specs.map(spec => ({ id: spec.datasetId, name: spec.name, sourceBytes: 1024, sha256: String(spec.sourceIndex), byteOrder: 'little', counts: {}, warnings: [], metadata: [] }));
  function devices(spec, group, selection) {
    if (selection.heads && !selection.heads.includes(1)) return [];
    const rows = [];
    const expanded = window.mock.expanded && spec.sourceIndex === 0, sourceCounts = expanded ? [0, 53, 0] : spec.counts;
    for (const [i, outcome] of ['pass', 'fail', 'unknown'].entries()) {
      for (let k = 0; k < sourceCounts[i]; k++) {
        const id = rows.length + 1;
        rows.push({ id, dataset_id: spec.datasetId, source_name: spec.name, group_id: group, head: 1, site: (id - 1) % 2, part_id: `${spec.sourceIndex}-DUT-${id}`, x_index: id - 1,
          part_flags: outcome === 'pass' ? 0 : outcome === 'fail' ? 8 : 16, retired: false, hard_bin: outcome === 'pass' ? 1 : 65535, soft_bin: outcome === 'pass' ? 1 : 65535,
          x: id, y: 0, wafer_id: 1, test_time: 20, num_tests: 0, outcome });
        if (expanded) Object.assign(rows.at(-1), { site: id - 1, soft_bin: 1000 + id, hard_bin: 2000 + id });
      }
    }
    if (selection.attempts === 'all' && rows.length) rows.push({ ...rows.at(-1), id: 99, x_index: 99, part_id: `${spec.sourceIndex}-OLD`, part_flags: 8, retired: true, outcome: 'fail' });
    return rows.filter(row => !selection.sites || selection.sites.includes(row.site));
  }
  function counts(rows) {
    const passed = rows.filter(row => row.outcome === 'pass').length, failed = rows.filter(row => row.outcome === 'fail').length;
    return { total: rows.length, passed, failed, unknown: rows.filter(row => row.outcome === 'unknown').length, yield: passed + failed ? passed / (passed + failed) : null };
  }
  function files(selection) {
    return selection.groups.flatMap((group, groupIndex) => group.datasetIds.map((datasetId, sourceIndex) => {
      const spec = specs.find(spec => spec.datasetId === datasetId), rows = devices(spec, groupIndex, selection);
      return { ...spec, key: JSON.stringify([groupIndex, datasetId]), group: groupIndex, groupName: group.name, sourceName: spec.name, sourceIndex, finishTime: spec.startTime ? spec.startTime + 60 : null,
        ...counts(rows), sites: [...new Set(rows.map(row => row.site))].map(site => ({ head: 1, site, ...counts(rows.filter(row => row.site === site)) })),
        softBins: [...new Set(rows.map(row => row.soft_bin))].map(number => ({ number, ...counts(rows.filter(row => row.soft_bin === number)) })),
        hardBins: [...new Set(rows.map(row => row.hard_bin))].map(number => ({ number, ...counts(rows.filter(row => row.hard_bin === number)) })) };
    }));
  }
  window.mock = { calls: [], ids, sources, specs, delay: false, error: false, cancel: null };
  return class DataLibraryClient {
    constructor() { this.worker = {}; }
    async open() { return {}; }
    terminate() { this.worker = null; }
    async listDatasets() { return { items: sources, nextOffset: null }; }
    async cancel() { window.mock.cancel?.(); }
    async viewer(action, selection, options = {}) {
      window.mock.calls.push({ action, selection: structuredClone(selection), options: structuredClone(options) });
      if (action === 'advanced' && options.kind === 'yieldManager') {
        if (window.mock.delay) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 5000); window.mock.cancel = () => { clearTimeout(timer); reject(Object.assign(Error('Operation cancelled'), { code: 'CANCELLED' })); }; });
        if (window.mock.error) { window.mock.error = false; throw Error('Deliberate recoverable yield summary failure'); }
        return { method: 'yield-manager-v1', files: files(selection), warnings: [], reviewGroups: selection.attempts === 'current' ? selection.groups.flatMap((group, i) => group.datasetIds.length > 2 ? [i] : []) : [] };
      }
      if (action === 'prepare') return {};
      if (action === 'overview') return { attempts: selection.attempts, groups: selection.groups.map((group, i) => ({ ...group, ...counts(group.datasetIds.flatMap(id => devices(specs.find(spec => spec.datasetId === id), i, selection))), superseded: 0 })), heads: [1, 2], sites: [{ head: 1, site: 0 }, { head: 1, site: 1 }], sources: sources.filter(source => selection.groups.some(group => group.datasetIds.includes(source.id))).map(source => ({ ...source, datasetId: source.id })) };
      if (action === 'tests') return { items: [], total: 0, offset: 0, nextOffset: null, countScope: 'No test observations in fixture.' };
      if (action === 'devices') {
        let rows = selection.groups.flatMap((group, i) => group.datasetIds.flatMap(id => devices(specs.find(spec => spec.datasetId === id), i, selection)));
        if (options.group != null) rows = rows.filter(row => row.group_id === options.group);
        if (options.datasetIds) rows = rows.filter(row => options.datasetIds.includes(row.dataset_id));
        if (options.outcome) rows = rows.filter(row => row.outcome === options.outcome);
        if (options.bin) rows = rows.filter(row => row[`${options.bin.kind}_bin`] === options.bin.number);
        if (options.pick?.seriesKeys) rows = rows.filter(row => options.pick.seriesKeys.some(key => { const [group, head, site] = JSON.parse(key); return group === row.group_id && (head == null || head === row.head) && (site == null || site === row.site); }));
        const offset = options.offset ?? 0, limit = options.limit ?? 50;
        return { items: rows.slice(offset, offset + limit), total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null };
      }
      throw Error(`Unexpected action ${action}`);
    }
  };
}

let useMockProvider = true;
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/harness') { response.setHeader('Content-Type', 'text/html'); response.end('<title>Yield fixture setup</title>'); return; }
    if (useMockProvider && pathname === '/data-client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(`export const DataLibraryClient = (${mockProvider.toString()})();`); return; }
    const path = resolve(site, '.' + pathname); if (!path.startsWith(site + sep)) throw Error('Outside site');
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [], errors = [];
let browser, page;
try {
  browser = await chromium.launch({ channel, headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles' });
  page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  const idle = async (allowError = false) => { await page.waitForFunction(() => window.semidataViewer && document.querySelector('#main')?.getAttribute('aria-busy') === 'false'); if (!allowError) assert.equal(await page.locator('#viewer-error').isVisible(), false, await page.locator('#viewer-error-text').textContent()); };
  const tab = async id => { await page.locator(`#tab-${id}`).click(); await idle(); };
  const calls = () => page.evaluate(() => mock.calls.filter(call => call.action === 'advanced' && call.options.kind === 'yieldManager').length);
  await page.goto(origin + '/viewer.html'); await idle();
  await page.evaluate(async () => { const saved = semidataViewer.getState(); await semidataViewer.applyWorkspace({ ...saved, tests: [], tab: 'yield', selection: { groups: [{ name: 'Production', datasetIds: mock.ids.slice(0, 7) }, { name: 'Reference', datasetIds: [mock.ids[7]] }], attempts: 'current', heads: null, sites: null } }); });
  await idle();
  assert.equal(await page.locator('#tab-yield').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.viewer-yield-manager').count(), 1);
  assert.deepEqual(await page.evaluate(() => semidataViewer.getState().tests), [], 'Yield Manager does not require selected tests');
  assert.equal(await calls(), 1);
  assert.equal(await page.locator('.yield-scope-warning').isVisible(), true);
  assert.match(await page.locator('.yield-scope-warning').textContent(), /Check group scope: Production\./);
  assert.doesNotMatch(await page.locator('.yield-scope-warning').textContent(), /Reference/);
  checks.push('Yield Manager opens with eight distinct files and no selected tests');
  const lotRows = () => page.getByRole('region', { name: 'Lot yields', exact: true }).locator('tbody tr');
  const lotButton = async (predicate) => {
    for (const button of await page.locator('[data-yield-lot]').all()) if (predicate(JSON.parse(await button.getAttribute('data-yield-lot')))) return button;
    throw Error('Expected lot identity is absent');
  };
  const mergedButton = () => lotButton(key => key[0] === 0 && key[1] === 'LOT-100' && key[2] === 'S1' && key[3] === 'P1' && key[5] === 'A');
  const chooseMerged = async () => { await (await mergedButton()).click(); await idle(); };
  const selectedRow = () => page.locator('.yield-lot-table .yield-selected-row');
  const find = async query => { await page.locator('[data-yield-search]').fill(query); await page.locator('.yield-search').getByRole('button', { name: 'Find', exact: true }).click(); await idle(); };
  assert.equal(await lotRows().count(), 7, 'Metadata-identical sources merge; product, revision, sublot, and group remain distinct');
  assert.equal(await page.locator('[data-yield-lot]').evaluateAll(buttons => buttons.filter(button => JSON.parse(button.dataset.yieldLot)[1] === '').length), 2, 'Each missing-lot file has a separate lot row');
  assert.equal(await page.locator('.viewer-yield-manager img').count(), 0, 'Source metadata renders as text');
  await chooseMerged();
  assert.deepEqual(await selectedRow().locator('td').allTextContents().then(cells => cells.slice(2, 7)), ['77.78%', '20', '14', '4', '2']);
  assert.equal(await page.locator('[data-yield-detail-title]').evaluate(element => element === document.activeElement), true);
  for (const column of ['yield', 'failed', 'startTime']) {
    await page.locator(`[data-yield-sort="${column}"]`).click(); await idle();
    const heading = page.locator('th').filter({ has: page.locator(`[data-yield-sort="${column}"]`) });
    assert.equal(await heading.getAttribute('aria-sort'), column === 'yield' ? 'descending' : 'ascending');
  }
  await page.locator('[data-yield-sort="yield"]').click(); await idle();
  assert.deepEqual(await lotRows().locator('td:nth-child(3)').allTextContents().then(cells => cells.slice(-2)), ['—', '—'], 'Unknown-only and empty yield values sort last');
  checks.push('Exact lot identity, separate missing-lot rows, unknown denominator, source-label escaping, numeric sorting, and lot-detail focus');

  await find('OTHER-PRODUCT'); assert.equal(await lotRows().count(), 1); assert.match(await lotRows().textContent(), /P2/);
  await find('nothing matches'); assert.equal(await page.locator('[data-yield-lot]').count(), 0); assert.match(await page.locator('.viewer-yield-manager').textContent(), /No lots match/);
  await find('');
  await page.locator('[data-yield-group]').selectOption('1'); await idle(); assert.equal(await lotRows().count(), 1); assert.match(await lotRows().textContent(), /Reference/);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await idle();
  await page.locator('[data-yield-product]').selectOption('"P2"'); await idle(); assert.equal(await lotRows().count(), 1);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await idle(); await chooseMerged();
  assert.equal(await calls(), 1, 'Local lot search, metadata filters, sorting, and selection reuse the summary');
  const points = page.locator('[data-yield-point]'); assert.equal(await points.count(), 5);
  assert.ok((await page.locator('.yield-trend').boundingBox()).height >= 180, 'Global icon CSS must not collapse the yield plot');
  const descriptions = await points.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  assert(descriptions.some(text => text.includes('2026-10-01 12:00:00 UTC')), 'Recorded UTC is independent of browser local timezone');
  assert(!descriptions.some(text => text.includes('undated-sublot') || text.includes('no-lot-')), 'Undated and unknown-only files have no invented time point');
  const productPoint = page.locator('[data-yield-point]').filter({ has: page.locator('title').filter({ hasText: 'other-product.stdf' }) });
  await productPoint.focus(); await page.keyboard.press('Enter'); await idle();
  assert.match(await selectedRow().textContent(), /P2/); await chooseMerged();
  await page.getByText('File yields (8)', { exact: true }).click();
  const sourceRows = page.getByRole('region', { name: 'File yields', exact: true }).locator('tbody tr');
  assert.equal(await sourceRows.count(), 8); assert.match(await sourceRows.filter({ hasText: 'undated-sublot.stdf' }).textContent(), /Not recorded/);
  assert.match(await sourceRows.filter({ hasText: 'no-lot-first.stdf' }).textContent(), /—/);
  checks.push('Cached lot search and filters; five real UTC time points; all eight source rows retain undated and unknown-only files');

  const originalSelection = await page.evaluate(() => semidataViewer.getState().selection);
  const deviceCall = () => page.evaluate(() => mock.calls.filter(call => call.action === 'devices').at(-1));
  await selectedRow().getByRole('button', { name: /^Show fail devices for LOT-100:/ }).click(); await idle();
  assert.equal(await page.locator('#tab-devices').getAttribute('aria-selected'), 'true');
  let picked = await deviceCall(); assert.equal(picked.options.outcome, 'fail'); assert.equal(picked.options.group, 0);
  assert.deepEqual(picked.options.datasetIds, await page.evaluate(() => mock.ids.slice(0, 2)));
  assert.equal(picked.options.query, ''); assert.equal(picked.options.sort, 'index');
  assert.deepEqual(await page.evaluate(() => semidataViewer.getState().selection), originalSelection);
  assert.match(await page.locator('.viewer-pager').last().textContent(), /of 4/);
  await tab('yield'); assert.equal(await calls(), 1); await chooseMerged();
  const unknownBin = page.getByRole('region', { name: 'Failing software bins', exact: true }).locator('tbody tr');
  assert.deepEqual(await unknownBin.locator('td').allTextContents(), ['Not recorded', '4', '100.00%']);
  await unknownBin.getByRole('button').click(); await idle();
  picked = await deviceCall(); assert.deepEqual(picked.options.bin, { kind: 'soft', number: 65535 }); assert.equal(picked.options.outcome, 'fail');
  await tab('yield'); await chooseMerged(); await page.getByLabel('Bin type', { exact: true }).selectOption('hard'); await idle();
  await page.getByRole('region', { name: 'Failing hardware bins', exact: true }).getByRole('button').click(); await idle();
  assert.deepEqual((await deviceCall()).options.bin, { kind: 'hard', number: 65535 });
  await tab('yield'); await chooseMerged();
  await page.getByRole('region', { name: 'Site yields for the selected lot', exact: true }).locator('tbody tr').first().getByRole('button', { name: /^Show fail devices/ }).click(); await idle();
  picked = await deviceCall(); assert.deepEqual(picked.options.pick, { type: 'bin', seriesKeys: ['[0,1,0]'] });
  await tab('yield'); await chooseMerged();
  await page.getByText('Files in the selected lot (2)', { exact: true }).click();
  await page.getByRole('region', { name: 'Files in the selected lot', exact: true }).locator('tbody tr').first().getByRole('button', { name: /^Show fail devices/ }).click(); await idle();
  assert.deepEqual((await deviceCall()).options.datasetIds, [await page.evaluate(() => mock.ids[0])]);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click(); await idle();
  assert.equal((await deviceCall()).options.datasetIds, undefined);
  assert.deepEqual(await page.evaluate(() => semidataViewer.getState().selection), originalSelection);
  checks.push('Lot, missing soft/hard bin, site, and exact-source device drilldowns preserve global scope; clearing drilldown restores the full selection');

  await tab('yield'); const countBeforeScope = await calls();
  await page.locator('#viewer-series').selectOption('site'); await idle(); assert.equal(await calls(), countBeforeScope, 'Chart series does not change device outcomes');
  await page.locator('#viewer-filters > summary').click(); await page.locator('#viewer-head').selectOption('2'); await idle();
  assert.equal(await calls(), countBeforeScope + 1); assert.equal(await lotRows().count(), 7);
  assert((await lotRows().locator('td:nth-child(3)').allTextContents()).every(cell => cell === '—'));
  await page.locator('#viewer-reset-filters').click(); await idle(); assert.equal(await calls(), countBeforeScope + 2);
  await page.locator('#viewer-attempts').selectOption('all'); await idle(); assert.equal(await calls(), countBeforeScope + 3);
  assert.equal(await page.locator('.yield-scope-warning').count(), 0, 'The replacement warning does not apply to all-attempt counts');
  await chooseMerged(); assert.equal(await selectedRow().locator('td').nth(3).textContent(), '22');
  await page.locator('#viewer-reset-filters').click(); await idle();
  await page.evaluate(() => { mock.error = true; }); await page.locator('#viewer-head').selectOption('2'); await idle(true);
  assert.match(await page.locator('#viewer-error-text').textContent(), /recoverable yield summary failure/);
  await page.locator('#viewer-retry').click(); await idle();
  await page.evaluate(() => { mock.delay = true; });
  const beforeCancel = await calls(); await page.locator('#viewer-reset-filters').click();
  await page.waitForFunction(count => mock.calls.filter(call => call.action === 'advanced' && call.options.kind === 'yieldManager').length > count, beforeCancel);
  await page.locator('#viewer-cancel').click(); await idle(true); assert.match(await page.locator('#viewer-error-text').textContent(), /cancel/i);
  await page.evaluate(() => { mock.delay = false; }); await page.locator('#viewer-retry').click(); await idle();
  await chooseMerged(); assert.equal(await selectedRow().locator('td').nth(3).textContent(), '20');
  checks.push('Head and attempt changes invalidate the cache; mixed-cohort current-attempt warning names only affected groups; chart series stays independent; error and cancellation both retry');

  await page.locator('#viewer-help-open').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#viewer-help-dialog').getAttribute('data-topic'), 'yield');
  assert.equal(await page.locator('#viewer-help-title').textContent(), 'Yield Manager');
  await page.keyboard.press('Tab'); assert.equal(await page.getByRole('button', { name: 'Close help', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#viewer-help-open').evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'Yield help', exact: true }).click(); assert.equal(await page.locator('#viewer-help-dialog').getAttribute('data-topic'), 'yield'); await page.keyboard.press('Escape');
  if (await page.locator('#viewer-filters').evaluate(element => element.open)) await page.locator('#viewer-filters > summary').click();
  assert.deepEqual(await page.evaluate(() => semidataViewer.exportChartPNGs()), [], 'Resize cleanup handles are not exportable canvas charts');
  await page.screenshot({ path: resolve(output, 'yield-manager-desktop.png'), fullPage: true, animations: 'disabled' });
  await points.first().focus(); const focusedPoint = await points.first().getAttribute('data-yield-point');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'The page fits 360px; wide tables scroll inside their own regions');
  assert.ok((await page.locator('.yield-trend').boundingBox()).height >= 180);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.yieldPoint), focusedPoint, 'Resize preserves keyboard focus on the same source point');
  await page.locator('[data-yield-detail-title]').focus();
  await page.screenshot({ path: resolve(output, 'yield-manager-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.reload(); await idle(); assert.equal(await page.locator('#tab-yield').getAttribute('aria-selected'), 'true');
  const workspace = await page.evaluate(() => semidataViewer.getState());
  await tab('overview'); await page.evaluate(saved => semidataViewer.applyWorkspace(saved), workspace); await idle();
  assert.equal(await page.locator('#tab-yield').getAttribute('aria-selected'), 'true');
  checks.push('Keyboard contextual help, Escape and focus restoration; 360px layout; reload and workspace-state restore retain the Yield Manager tab');
  await page.evaluate(async () => { mock.expanded = true; await semidataViewer.applyWorkspace({ ...semidataViewer.getState(), selection: { groups: [{ name: 'Many bins and sites', datasetIds: [mock.ids[0]] }], heads: null, sites: null, attempts: 'current' } }); });
  await idle(); const beforePaging = await calls();
  for (const [region, next] of [['Failing software bins', 'Next failing bins'], ['Site yields for the selected lot', 'Next sites']]) {
    assert.equal(await page.getByRole('region', { name: region, exact: true }).locator('tbody tr').count(), 50);
    if (region === 'Failing software bins') assert.equal(await page.getByRole('region', { name: region, exact: true }).locator('tbody tr').first().locator('td').nth(2).textContent(), '1.89%', 'Failure share includes bins beyond the visible page');
    await page.getByRole('button', { name: next, exact: true }).click(); await idle();
    assert.equal(await page.getByRole('region', { name: region, exact: true }).locator('tbody tr').count(), 3);
    if (region === 'Failing software bins') assert.equal(await page.getByRole('region', { name: region, exact: true }).locator('tbody tr').first().locator('td').nth(2).textContent(), '1.89%');
  }
  await page.getByLabel('Bin type', { exact: true }).selectOption('hard'); await idle();
  assert.equal(await page.getByRole('region', { name: 'Failing hardware bins', exact: true }).locator('tbody tr').count(), 50);
  assert.equal(await calls(), beforePaging);
  checks.push('53 failing bins and 53 sites render 50 rows per page; local pagination and bin-family changes reuse cached results');

  // Import real PRR-only fixtures through the production client in a fresh profile.
  await page.context().close(); useMockProvider = false;
  const fixtures = resolve(output, 'fixtures');
  const generated = spawnSync(resolve(base, '../.venv/Scripts/python.exe'), [resolve(base, 'scripts/make-yield-fixtures.py'), fixtures], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/harness');
  const realIds = [];
  for (const name of ['original-little', 'retest']) realIds.push(await page.evaluate(async ({ name, bytes }) => {
    const { DataLibraryClient } = await import('./data-client.js'); const client = new DataLibraryClient(); await client.open();
    try { return (await client.importFile(new File([new Uint8Array(bytes)], name + '.stdf'))).dataset.id; } finally { await client.close(); }
  }, { name, bytes: [...await readFile(resolve(fixtures, name + '.stdf'))] }));
  await page.goto(origin + '/viewer.html'); await idle();
  await page.evaluate(async ids => { await semidataViewer.applyWorkspace({ ...semidataViewer.getState(), tab: 'yield', tests: [], selection: { groups: [{ name: 'Recorded retest order', datasetIds: ids }], heads: null, sites: null, attempts: 'current' } }); }, realIds);
  await idle(); assert.equal(await lotRows().count(), 1);
  assert.deepEqual(await lotRows().locator('td').allTextContents().then(cells => cells.slice(2, 7)), ['50.00%', '8', '3', '3', '2']);
  const realUnknownBin = page.getByRole('region', { name: 'Failing software bins', exact: true }).locator('tbody tr').filter({ hasText: 'Not recorded' });
  assert.deepEqual(await realUnknownBin.locator('td').allTextContents(), ['Not recorded', '1', '33.33%']);
  const realScope = await page.evaluate(() => semidataViewer.getState().selection);
  await realUnknownBin.getByRole('button').click(); await idle();
  assert.equal(await page.getByRole('button', { name: 'F', exact: true }).count(), 1); assert.equal(await page.getByRole('button', { name: 'D', exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => semidataViewer.getState().selection), realScope);
  await tab('yield'); await page.getByRole('button', { name: 'Yield help', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'yield-real-provider-help.png'), fullPage: false, animations: 'disabled' }); await page.keyboard.press('Escape');
  checks.push('Real Rust/WASM and SQLite imports: current retest summary is 8 recorded, 3 pass, 3 fail, 2 unknown, 50% yield; unknown-bin drilldown returns F and excludes unknown D');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, checks, errors }, null, 2));
  console.log(JSON.stringify({ output, checks, errors }, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors }, null, 2));
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
