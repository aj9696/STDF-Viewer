import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url)), site = resolve(root, 'site'), channel = process.argv[2] ?? 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Use chrome or msedge');
const output = resolve(root, 'results', `viewer-study-charts-${channel}-${Date.now()}`); await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="viewer.css"><link rel="stylesheet" href="viewer-studies.css"></head><body><main id="chart" style="max-width:1000px;margin:20px auto;padding:12px"></main></body></html>'); return; }
    const file = resolve(site, '.' + path); if (!file.startsWith(site + sep)) throw Error('Outside root');
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser; const checks = [], errors = [];
try {
  browser = await chromium.launch({ channel, headless: true }); const page = await browser.newPage({ viewport: { width: 1150, height: 1000 } }); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    window.renderer = await import('./viewer-study-charts.js'); window.picks = []; window.strokes = [];
    const original = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function(...args) { strokes.push({ dash: this.getLineDash(), color: this.strokeStyle }); return original.apply(this, args); };
    window.render = data => { window.chart?.destroy?.(); document.querySelector('#chart').replaceChildren(); window.chart = renderer.renderStudyChart(document.querySelector('#chart'), { onPick: point => picks.push(point), ...data }); };
    render({ title: 'Correlation', axes: ['X test with a deliberately long recorded name '.repeat(5), 'Y test'], specLimits: [{ low: -4, high: 8 }, { low: -10, high: 20 }], series: [
      { label: 'Population A', regression: { slope: 2, intercept: 1 }, points: [{ x: 0, y: 1, deviceId: 1 }, { x: 2, y: 5, deviceId: 2 }, { x: 4, y: 9, deviceId: 3 }] },
      { label: 'Population B', points: [{ x: 1, y: 2, deviceId: 4 }, { x: 3, y: 7, deviceId: 5 }] },
    ] });
  });
  assert.deepEqual((await page.evaluate(() => chart.viewState.ranges)).slice(0, 2), [[0, 4], [1, 9]]);
  assert.ok(await page.evaluate(() => strokes.some(stroke => String(stroke.dash) === '7,3'))); assert.ok(await page.evaluate(() => strokes.filter(stroke => String(stroke.dash) === '5,4').length >= 4));
  assert.match(await page.locator('canvas').getAttribute('aria-label'), /deliberately long recorded name/);
  await page.getByText('Plot options', { exact: true }).click();
  await page.getByRole('button', { name: 'Full', exact: true }).click(); assert.deepEqual((await page.evaluate(() => chart.viewState.ranges)).slice(0, 2), [[-4, 8], [-10, 20]]);
  await page.getByRole('button', { name: 'Auto', exact: true }).click(); assert.deepEqual((await page.evaluate(() => chart.viewState.ranges)).slice(0, 2), [[0, 4], [1, 9]]);
  for (const [name, value] of [['X minimum', '-1'], ['X maximum', '5'], ['Y minimum', '0'], ['Y maximum', '12']]) await page.getByLabel(`Visible ${name}`, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Set visible range', exact: true }).click(); assert.deepEqual((await page.evaluate(() => chart.viewState.ranges)).slice(0, 2), [[-1, 5], [0, 12]]); assert.equal(await page.evaluate(() => picks.length), 0);
  await page.getByLabel('Visible X minimum', { exact: true }).fill('9'); await page.getByRole('button', { name: 'Set visible range', exact: true }).click(); assert.match(await page.locator('.study-chart-status').textContent(), /increasing/); assert.deepEqual((await page.evaluate(() => chart.viewState.ranges))[0], [-1, 5]);
  checks.push('Data/full spec extents, stable-limit lines, full-population regression overlay, range validation and safe full axis labels');
  await page.getByLabel('Regression', { exact: true }).uncheck(); assert.equal(await page.evaluate(() => chart.viewState.showRegression), false);
  await page.getByLabel('Plot opacity', { exact: true }).press('Home'); for (let i = 0; i < 8; i++) await page.getByLabel('Plot opacity', { exact: true }).press('ArrowRight'); assert.equal(await page.evaluate(() => chart.viewState.opacity), .5);
  await page.getByRole('button', { name: 'Population A', exact: true }).click(); assert.equal(await page.evaluate(() => chart.viewState.projected.length), 2);
  await page.getByRole('button', { name: 'None', exact: true }).click(); assert.equal(await page.evaluate(() => chart.viewState.projected.length), 0);
  await page.getByRole('button', { name: 'All', exact: true }).click(); assert.equal(await page.evaluate(() => chart.viewState.projected.length), 5);
  const canvas = await page.locator('canvas').boundingBox(), point = await page.evaluate(() => chart.viewState.projected.find(point => point.x === 2).pixels);
  await page.mouse.click(canvas.x + point[0], canvas.y + point[1]); assert.equal(await page.evaluate(() => picks.at(-1).deviceId), 2);
  await page.screenshot({ path: resolve(output, 'scatter-controls.png'), fullPage: true });
  checks.push('Population All/None/individual visibility, opacity, regression toggle and preserved original-device picks');
  await page.evaluate(() => render({ title: 'Box plot', series: [{ label: 'Box', kind: 'line', points: [{ x: 1, y: 4, box: { q1: 2, median: 4, q3: 6, whiskerLow: 1, whiskerHigh: 8, outlierCount: 3 } }] }] }));
  assert.equal(await page.getByRole('button', { name: 'Full', exact: true }).count(), 0);
  assert.deepEqual((await page.evaluate(() => chart.viewState.ranges)).slice(0, 2), [[.5, 1.5], [1, 8]]);
  const boxCanvas = await page.locator('canvas').boundingBox(), boxPoint = await page.evaluate(() => chart.viewState.projected[0].pixels);
  await page.mouse.move(boxCanvas.x + boxPoint[0], boxCanvas.y + boxPoint[1]); assert.match(await page.locator('.study-chart-status').textContent(), /q1 2.*median 4.*q3 6.*outlierCount 3/);
  checks.push('Box whiskers determine extent; hover exposes quartiles/outliers; Full is absent without supplied stable limits');
  await page.evaluate(() => render({ title: 'Wafer', wafer: true, orientation: { posX: 'L', posY: 'D', dieAspectRatio: 2 }, series: [{ label: 'Wafer', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }] }] }));
  const waferPoints = await page.evaluate(() => chart.viewState.projected.map(point => point.pixels)); assert.ok(waferPoints[0][0] > waferPoints[1][0]); assert.ok(waferPoints[0][1] < waferPoints[2][1]); assert.ok(Math.abs((waferPoints[0][0] - waferPoints[1][0]) / (waferPoints[2][1] - waferPoints[0][1]) - 2) < 1e-10);
  await page.setViewportSize({ width: 390, height: 850 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: resolve(output, 'wafer-390.png'), fullPage: true });
  checks.push('Wafer direction and physical aspect survive plot controls; narrow viewport remains bounded');
  await page.setViewportSize({ width: 1150, height: 1000 });
  await page.evaluate(() => {
    render({ title: 'Solid wafer dies', wafer: true, threeD: true, orientation: { posX: 'L', posY: 'D', dieAspectRatio: 2 }, series: [{ label: 'Wafer', points: [{ x: 0, y: 0, z: 0, deviceId: 11, color: '#245cce' }, { x: 2, y: 0, z: 10, deviceId: 12, color: '#b63842' }, { x: 0, y: 2, z: 5, deviceId: 13, color: '#008477' }] }] });
    renderer.renderValueRange(document.querySelector('#chart'), { min: 2, max: 8, mean: 5, median: 6, count: 12, low: 0, high: 10, unit: 'V' });
  });
  assert.equal(await page.evaluate(() => chart.viewState.projected.length), 3); assert.ok(await page.evaluate(() => chart.viewState.solidFaces >= 9));
  assert.equal(await page.locator('[data-marker="Mean"]').evaluate(node => node.style.left), '50%'); assert.equal(await page.locator('[data-marker="Median"]').evaluate(node => node.style.left), '60%');
  assert.match(await page.locator('figure').textContent(), /Min 2 V.*Mean 5 V.*Median 6 V.*Max 8 V.*N 12/);
  const solidCanvas = await page.locator('canvas').boundingBox(), solidPoint = await page.evaluate(() => chart.viewState.projected.find(point => point.x === 2).pixels);
  await page.mouse.click(solidCanvas.x + solidPoint[0], solidCanvas.y + solidPoint[1]); assert.equal(await page.evaluate(() => picks.at(-1).deviceId), 12);
  const originalPixels = await page.evaluate(() => chart.viewState.projected.map(point => point.pixels)); await page.locator('canvas').press('ArrowRight'); assert.notDeepEqual(await page.evaluate(() => chart.viewState.projected.map(point => point.pixels)), originalPixels); await page.locator('canvas').press('Home');
  await page.screenshot({ path: resolve(output, 'wafer-solid.png'), fullPage: true });
  assert.equal(await page.evaluate(() => renderer.renderValueRange(document.querySelector('#chart'), { min: null, max: null, count: 0 })), null);
  checks.push('Solid die faces preserve original identity through rotation; range strip uses exact mean/median/limits and omits empty populations');
  await page.evaluate(() => render({ title: 'Two populations', series: [{ label: 'Yield', kind: 'bar', points: [{ x: 1, y: 90 }, { x: 2, y: 99 }] }] })); assert.equal(await page.evaluate(() => chart.viewState.barWidth), 80);
  await page.evaluate(() => render({ title: 'Many populations', series: [{ label: 'Yield', kind: 'bar', points: Array.from({ length: 100 }, (_, index) => ({ x: index, y: 90 })) }] })); assert.ok(await page.evaluate(() => chart.viewState.barWidth > 1 && chart.viewState.barWidth < 10));
  checks.push('Categorical bar widths follow nearest population spacing, capped at 80 pixels');
  assert.deepEqual(errors, []); await writeFile(resolve(output, 'results.json'), JSON.stringify({ channel, passed: true, checks, errors }, null, 2)); console.log(JSON.stringify({ output, checks: checks.length, passed: true }));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
