import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const base = fileURLToPath(new URL("../", import.meta.url));
const channel = process.argv[2] ?? "chrome";
if (!["chrome", "msedge"].includes(channel)) throw new Error("Use chrome or msedge");
const output = resolve(base, "results", `viewer-charts-${channel}-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chart qualification</title><link rel="stylesheet" href="/viewer-charts.css"><style>body{margin:20px;background:#f4f6fa}main{padding:20px;background:white;max-width:1100px;margin:auto;min-width:0}h1{font:24px Segoe UI}section+section{margin-top:36px}</style><main><h1>Viewer chart qualification</h1><div id="chart"></div></main></html>');
  } else if (["/viewer-charts.js", "/viewer-charts.css", "/viewer-number.js"].includes(path)) {
    response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css");
    response.end(await readFile(resolve(base, "site", path.slice(1))));
  } else { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const checks = [], errors = [];
let browser, page;
try {
  browser = await chromium.launch({ channel, headless: true });
  page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.renderer = await import("/viewer-charts.js"); window.picks = [];
    window.makeTrend = () => {
      window.handle = renderer.renderTrend(document.querySelector("#chart"), {
        series: [{ key: "A", label: "Head 1 / Site 0 <img src=x onerror=alert(1)>", color: "#245cce",
          points: [{ x: 0, value: 1, lsl: 0, usl: 6 }, { x: 5, value: 5, lsl: 0, usl: 6 }, { x: 10, value: 3, lsl: 1, usl: 7 }], stats: { count: 10000, mean: 3 } },
          { key: "B", label: "Head 1 / Site 1", color: "#b55416", points: [{ x: 0, value: 2 }, { x: 5, value: 4 }, { x: 10, value: 6 }], stats: { count: 9000, mean: 4 } }],
        onPick: (value) => picks.push(value),
      });
    }; makeTrend();
  });
  assert.equal(await page.locator("#chart img").count(), 0);
  assert.match(await page.locator(".chart-note").textContent(), /19,000 observations/);
  await page.getByLabel("First device index").fill("0");
  await page.getByLabel("Last device index").fill("5");
  await page.getByRole("button", { name: "Inspect range", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => picks.at(-1)), { type: "trend", xlo: 0, xhi: 5, seriesKeys: ["A", "B"] });
  await page.getByRole("button", { name: "Head 1 / Site 1", exact: true }).click();
  await page.getByRole("button", { name: "Inspect range", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => picks.at(-1).seriesKeys), ["A"]);
  await page.getByLabel("First device index").fill("9"); await page.getByLabel("Last device index").fill("1");
  const previous = await page.evaluate(() => picks.length);
  await page.getByRole("button", { name: "Inspect range", exact: true }).click();
  assert.equal(await page.evaluate(() => picks.length), previous);
  await page.getByRole("button", { name: "Reset chart", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Head 1 / Site 1", exact: true }).getAttribute("aria-pressed"), "true");
  const canvas = await page.locator("canvas").boundingBox();
  await page.mouse.move(canvas.x + 80, canvas.y + 100); await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width - 25, canvas.y + 100); await page.mouse.up();
  assert.equal(await page.evaluate(() => picks.at(-1).type), "trend");
  assert.ok(await page.evaluate(() => picks.at(-1).xlo < picks.at(-1).xhi));
  const png = await page.evaluate(async () => { const b = await handle.exportPng(); return { type: b.type, size: b.size }; });
  assert.equal(png.type, "image/png"); assert.ok(png.size > 1000);
  await page.screenshot({ path: resolve(output, "trend.png"), fullPage: true });
  checks.push("trend semantics, hidden-series scope, reversed-range validation, pointer range, safe labels, PNG");
  const beforeZoom = await page.evaluate(() => ({ x: [...handle.fullDomain.x], y: [...handle.fullDomain.y], picks: picks.length }));
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom = await page.evaluate(() => handle.viewport); assert.ok(zoom.x[1] - zoom.x[0] < beforeZoom.x[1] - beforeZoom.x[0]);
  await page.getByRole('button', { name: 'Pan right', exact: true }).click(); assert.ok(await page.evaluate((x) => handle.viewport.x[0] > x, zoom.x[0]));
  await page.getByLabel('Pointer drag', { exact: true }).selectOption('zoom');
  await page.mouse.move(canvas.x + 180, canvas.y + 80); await page.mouse.down(); await page.mouse.move(canvas.x + 400, canvas.y + 180); await page.mouse.up();
  assert.equal(await page.evaluate(() => picks.length), beforeZoom.picks); assert.ok(await page.evaluate((x) => handle.viewport.x[1] - handle.viewport.x[0] < x, zoom.x[1] - zoom.x[0]));
  await page.getByLabel('Pointer drag', { exact: true }).selectOption('pan');
  const beforePan = await page.evaluate(() => [...handle.viewport.x]); await page.mouse.move(canvas.x + 400, canvas.y + 160); await page.mouse.down(); await page.mouse.move(canvas.x + 300, canvas.y + 160); await page.mouse.up(); assert.notDeepEqual(await page.evaluate(() => handle.viewport.x), beforePan);
  await page.getByRole('button', { name: 'Reset chart', exact: true }).click(); assert.equal(await page.evaluate(() => handle.viewport), null);
  await page.getByLabel('Pointer drag', { exact: true }).selectOption('inspect'); checks.push('Keyboard zoom/pan and pointer rectangle/pan preserve query scope and reset full extent');
  await page.evaluate(() => {
    const previous = handle; makeTrend(); previous.destroy();
  });
  assert.equal(await page.locator("canvas").count(), 1);
  await page.setViewportSize({ width: 360, height: 850 });
  assert.ok(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: resolve(output, "trend-360.png"), fullPage: true });
  await page.evaluate(() => { handle = renderer.renderTrend(document.querySelector("#chart"), { series: [], onPick: (x) => picks.push(x) }); });
  assert.equal(await page.locator(".chart-empty").isVisible(), true);
  await page.evaluate(() => handle.destroy()); assert.equal(await page.locator("canvas").count(), 0);
  checks.push("replacement/disposal, no-data rendering, 360px layout");
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.evaluate(() => {
    handle = renderer.renderHistogram(document.querySelector("#chart"), {
      series: [{ key: "H", label: "Histogram cohort", color: "#245cce", bins: [
        { low: 0, high: 1, count: 8, last: false }, { low: 1, high: 2, count: 4, last: true }],
        stats: { mean: 0.8, stdev: 0.3, lsl: 0, usl: 2 } }],
      settings: { showGaussian: true, showSigma: true }, onPick: (x) => picks.push(x),
    });
  });
  await page.getByLabel("Lower value", { exact: true }).fill("0"); await page.getByLabel("Upper value", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Inspect intervals", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => picks.at(-1)), { type: "histogram", low: 0, high: 1, inclusiveHigh: false, seriesKeys: ["H"] });
  await page.getByLabel("Lower value", { exact: true }).fill("1.2"); await page.getByLabel("Upper value", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Inspect intervals", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => picks.at(-1)), { type: "histogram", low: 1, high: 2, inclusiveHigh: true, seriesKeys: ["H"] });
  const lastBar = await page.evaluate(() => ({ x: handle.items.at(-1).x, y: handle.items.at(-1).y }));
  const histCanvas = await page.locator("canvas").boundingBox();
  await page.mouse.move(histCanvas.x + lastBar.x, histCanvas.y + lastBar.y);
  assert.match(await page.locator(".chart-tooltip").textContent(), /\[1, 2\]/);
  await page.mouse.click(histCanvas.x + lastBar.x, histCanvas.y + lastBar.y);
  assert.equal(await page.evaluate(() => picks.at(-1).inclusiveHigh), true);
  await page.screenshot({ path: resolve(output, "histogram.png"), fullPage: true });
  checks.push("histogram half-open/final-closed boundaries, interval snapping, overlay, hover and pointer picks");
  await page.evaluate(() => {
    handle = renderer.renderBins(document.querySelector("#chart"), { series: [
      { key: "G", label: "Group zero", color: "#245cce", bins: [{ number: 0, count: 99, name: "Pass", percent: 99, passFail: "P" }, { number: 7, count: 1, name: "Fail", percent: 1, passFail: "F" }] },
      { key: "Q", label: "Group two", color: "#b55416", bins: [{ number: 0, count: 10, name: "Pass" }] }], onPick: (x) => picks.push(x) });
  });
  await page.getByLabel("Bin series").selectOption("0"); await page.getByLabel("Bin number", { exact: true }).fill("0"); await page.getByRole("button", { name: "Inspect bin", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => picks.at(-1)), { type: "bin", number: 0, seriesKeys: ["G"] });
  await page.getByRole("button", { name: "Group zero", exact: true }).click();
  const beforeHidden = await page.evaluate(() => picks.length);
  await page.getByRole("button", { name: "Inspect bin", exact: true }).click();
  assert.equal(await page.evaluate(() => picks.length), beforeHidden);
  await page.getByRole("button", { name: "Reset chart", exact: true }).click();
  await page.screenshot({ path: resolve(output, "bins.png"), fullPage: true });
  checks.push("bin zero, exact group identity and hidden-series keyboard pick guard");
  await page.evaluate(() => {
    window.waferDies = [{ x: 0, y: 0, bin: 1, count: 0 }, { x: 2, y: 0, bin: 1, count: 0 }, { x: 0, y: 2, bin: 7, count: 0 }];
    handle = renderer.renderWafer(document.querySelector("#chart"), { dies: waferDies, orientation: { posX: "L", posY: "D", flat: "D", dieAspectRatio: 2 }, onPick: (x) => picks.push(x) });
  });
  assert.equal(await page.evaluate(() => handle.items[0].x > handle.items[1].x && handle.items[0].y < handle.items[2].y), true);
  assert.ok(await page.evaluate(() => Math.abs(handle.items[0].width / handle.items[0].height - 2) < 0.00001));
  await page.getByLabel("Die X coordinate").fill("0"); await page.getByLabel("Die Y coordinate").fill("2");
  await page.getByRole("button", { name: "Inspect die", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => picks.at(-1)), { type: "wafer", x: 0, y: 2 });
  await page.screenshot({ path: resolve(output, "wafer.png"), fullPage: true });
  await page.evaluate(() => { handle = renderer.renderWafer(document.querySelector("#chart"), { dies: waferDies, stacked: true, onPick: (x) => picks.push(x) }); });
  assert.equal(await page.locator(".chart-empty").isVisible(), false);
  assert.equal(await page.getByRole("button", { name: "Failed count: 0", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Failed count: 0", exact: true }).click();
  assert.match(await page.locator(".chart-empty").textContent(), /All series are hidden/);
  await page.getByRole("button", { name: "Reset chart", exact: true }).click();
  checks.push("wafer original-coordinate picking, reversed axes, die aspect ratio, all-passing stack, hide/reset");
  await page.setViewportSize({ width: 360, height: 850 });
  assert.ok(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: resolve(output, "wafer-360.png"), fullPage: true });
  await page.evaluate(() => { handle = renderer.renderTrend(document.querySelector("#chart"), { series: [{ key: "C", points: [{ x: 0, value: 3.4e38 }, { x: 1, value: -3.4e38 }, { x: 2, value: NaN }, { x: 3, value: Infinity }] }] }); });
  assert.equal(await page.evaluate(() => handle.items.every((i) => Number.isFinite(i.x) && Number.isFinite(i.y))), true);
  assert.equal(await page.evaluate(() => handle.items.length), 2);
  checks.push("float32 extreme and nonfinite rendering");
  const performance = await page.evaluate(() => {
    const dies = Array.from({ length: 50000 }, (_, i) => ({ x: i % 250, y: Math.floor(i / 250), bin: i % 40, count: 0 }));
    const started = window.performance.now();
    handle = renderer.renderWafer(document.querySelector("#chart"), { dies, orientation: { posX: "R", posY: "U" } });
    return { milliseconds: window.performance.now() - started, rectangles: handle.items.length, legendButtons: document.querySelectorAll('.chart-legend button[aria-pressed]').length };
  });
  assert.equal(performance.rectangles, 50000); assert.equal(performance.legendButtons, 24);
  await page.getByRole("button", { name: "Next legend page", exact: true }).click();
  assert.equal(await page.locator('.chart-legend button[aria-pressed]').count(), 16);
  checks.push(`50,000-coordinate canvas and bounded legend DOM: ${performance.milliseconds.toFixed(1)} ms initial render`);
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "results.json"), JSON.stringify({ channel, checks, errors }, null, 2));
  console.log(JSON.stringify({ output, checks, errors }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: error.stack, checks, errors }, null, 2));
  throw error;
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
