/** Browser-only canvas renderers. Data are already normalized/reduced by the query provider.
 * No statistics or source filtering are performed here. Picks describe full-population queries.
 * Every render replaces the previous chart in its container and returns {destroy,reset,exportPng}.
 * onPick payloads: trend {type,xlo,xhi,seriesKeys}; histogram {type,low,high,inclusiveHigh,seriesKeys};
 * bin {type,number,seriesKeys}; wafer {type,x,y}. See SPEC-browser-viewer.md for population rules.
 */
import { formatNumber } from './viewer-number.js';
const charts = new WeakMap();
const palette = ["#245cce", "#b55416", "#008477", "#914ab1", "#a33a58", "#5e6b25", "#476d83"];
const finite = Number.isFinite;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const node = (tag, className, text) => {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = String(text);
  return result;
};
function options(settings = {}) {
  return { showLimits: true, showMean: true, showSigma: false, showGaussian: false, ...settings,
    precision: clamp(Number.isInteger(settings.precision) ? settings.precision : 3, 0, 12),
    dotSize: clamp(finite(settings.dotSize) ? settings.dotSize : 3, 1, 10) };
}
const format = formatNumber;
function extent(values, includeZero = false) {
  let lo = includeZero ? 0 : Infinity, hi = includeZero ? 0 : -Infinity;
  for (const value of values) if (finite(value)) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
  if (lo === Infinity) return [0, 1];
  if (lo === hi) { const pad = Math.max(Math.abs(lo) * 0.05, 0.5); return [lo - pad, hi + pad]; }
  return [lo, hi];
}
const fraction = (n, lo, hi) => finite(hi - lo) ? (n - lo) / (hi - lo) : (n / 2 - lo / 2) / (hi / 2 - lo / 2);
const mix = (lo, hi, p) => lo * (1 - p) + hi * p;
function color(value, index = 0) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : palette[Math.abs(index) % palette.length];
}
function seriesList(series = []) {
  const seen = new Set();
  return series.map((item, i) => {
    if (typeof item.key !== "string" || seen.has(item.key)) throw new TypeError("Chart series require unique string keys.");
    seen.add(item.key);
    return { ...item, label: String(item.label ?? item.key), color: color(item.color, i) };
  });
}
function createChart(container, title, series, settings, onPick) {
  charts.get(container)?.destroy();
  const root = node("section", "viewer-chart");
  root.setAttribute("aria-label", title);
  const header = node("div", "chart-heading"), heading = node("h3", "", title), reset = node("button", "", "Reset chart");
  reset.type = "button"; header.append(heading, reset);
  const legend = node("div", "chart-legend"); legend.setAttribute("aria-label", "Visible series");
  const stage = node("div", "chart-stage"), canvas = node("canvas"), tip = node("div", "chart-tooltip");
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `${title}. Use the labeled controls below to select data without a pointer.`);
  const selection = node("div", "chart-selection"), empty = node("div", "chart-empty", "No data in the selected population.");
  tip.hidden = selection.hidden = true;
  stage.append(canvas, empty, selection, tip);
  const note = node("p", "chart-note"), controls = node("form", "chart-controls"), status = node("p", "chart-status");
  status.setAttribute("role", "status"); controls.append(status);
  root.append(header, legend, stage, note, controls); container.replaceChildren(root);
  const ctx = canvas.getContext("2d"), hidden = new Set(), listeners = new AbortController();
  let frame = 0, disposed = false, start = null;
  const chart = { root, ctx, canvas, stage, controls, note, status, series, settings, hidden, items: [],
    area: null, rangePick: null, paint: null, keyboardReset: null, hasData: false, viewport: null, fullDomain: null, scale: null, dragMode: 'inspect', afterPaint: null, opacity: 1,
    visible: () => series.filter((s) => !hidden.has(s.key)),
    pick(payload) {
      if (!chart.hasData) { status.textContent = "There are no visible data to select."; return false; }
      if (typeof onPick === "function") onPick(payload);
      return true;
    },
    redraw() {
      if (disposed || !chart.paint) return;
      const width = Math.max(200, stage.clientWidth), height = Math.max(240, stage.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
      chart.area = { left: width < 380 ? 51 : 65, top: 20, right: width - 18, bottom: height - 48, width, height };
      chart.items = []; chart.afterPaint = null; tip.hidden = true; selection.hidden = true;
      ctx.save(); const hasData = chart.paint(); ctx.restore(); chart.afterPaint?.(); chart.hasData = hasData; empty.hidden = hasData;
      if (!hasData) note.textContent = "Change the population or show a series to view data.";
      empty.textContent = hidden.size === series.length && series.length ? "All series are hidden. Use the legend or Reset chart." : "No data in the selected population.";
    },
    reset() {
      hidden.clear(); for (const b of legend.querySelectorAll("button[aria-pressed]")) b.setAttribute("aria-pressed", "true");
      chart.viewport = null; status.textContent = "Chart reset; all series are visible and the full extent is shown."; chart.redraw(); chart.keyboardReset?.();
    },
    destroy() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frame); observer.disconnect(); listeners.abort();
      if (charts.get(container) === chart) charts.delete(container);
      root.remove();
    },
    exportPng() { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Chart export failed.")), "image/png")); },
  };
  // Wafer data can have many distinct bins: keep the legend's DOM bounded.
  let legendPage = 0;
  const renderLegend = () => {
    legend.replaceChildren();
    for (const item of series.slice(legendPage * 24, (legendPage + 1) * 24)) {
      const b = node("button"), swatch = node("span", "chart-swatch"), label = node("span", "", item.label);
      b.type = "button"; b.setAttribute("aria-pressed", String(!hidden.has(item.key))); swatch.style.setProperty("--series-color", item.color);
      b.append(swatch, label); b.addEventListener("click", () => {
        hidden.has(item.key) ? hidden.delete(item.key) : hidden.add(item.key);
        b.setAttribute("aria-pressed", String(!hidden.has(item.key))); chart.viewport = null; chart.redraw();
      }); legend.append(b);
    }
    if (series.length > 24) {
      const navigation = node("span", "chart-legend-pages");
      for (const [text, offset] of [["Previous legend page", -1], ["Next legend page", 1]]) {
        const b = node("button", "", text); b.type = "button";
        b.disabled = offset < 0 ? legendPage === 0 : (legendPage + 1) * 24 >= series.length;
        b.addEventListener("click", () => { legendPage += offset; renderLegend(); legend.querySelector("button")?.focus(); }); navigation.append(b);
      }
      navigation.append(node("span", "", ` ${legendPage + 1} / ${Math.ceil(series.length / 24)}`)); legend.append(navigation);
    }
    if (series.length > 1) for (const [name, hide] of [['All', false], ['None', true]]) {
      const control = node('button', '', name); control.type = 'button'; control.addEventListener('click', () => { hidden.clear(); if (hide) series.forEach(s => hidden.add(s.key)); renderLegend(); chart.redraw(); }); legend.append(control);
    }
  };
  renderLegend();
  const navigation = node('div', 'chart-navigation'), modeLabel = node('label', '', 'Pointer drag'), mode = node('select'); mode.setAttribute('aria-label', 'Pointer drag');
  for (const [value, text] of [['inspect', 'Inspect data'], ['zoom', 'Zoom rectangle'], ['pan', 'Pan view']]) { const option = node('option', '', text); option.value = value; mode.append(option); }
  mode.addEventListener('change', () => { chart.dragMode = mode.value; canvas.style.touchAction = mode.value === 'inspect' ? 'pan-y' : 'none'; }); modeLabel.append(mode); navigation.append(modeLabel);
  const setViewport = (next) => {
    if (!chart.fullDomain || !chart.hasData) return;
    const bounded = {};
    for (const axis of ['x', 'y']) {
      const full = chart.fullDomain[axis], values = next[axis], width = values[1] - values[0], whole = full[1] - full[0];
      if (!values.every(finite) || !(width > 0)) return;
      if (width >= whole) bounded[axis] = [...full];
      else { const first = clamp(values[0], full[0], full[1] - width); bounded[axis] = [first, first + width]; }
    }
    chart.viewport = bounded; chart.redraw(); status.textContent = `View changed. X ${format(bounded.x[0], settings.precision, settings.notation)} to ${format(bounded.x[1], settings.precision, settings.notation)}; Y ${format(bounded.y[0], settings.precision, settings.notation)} to ${format(bounded.y[1], settings.precision, settings.notation)}. Statistics retain the full population.`;
  };
  const transform = (factor, dx = 0, dy = 0) => {
    const current = chart.viewport ?? chart.fullDomain; if (!current) return;
    const next = {};
    for (const [axis, delta] of [['x', dx], ['y', dy]]) { const [lo, hi] = current[axis], half = (hi - lo) * factor / 2, center = (lo + hi) / 2 + delta * (hi - lo); next[axis] = [center - half, center + half]; }
    setViewport(next);
  };
  for (const [text, action] of [['Zoom in', () => transform(.5)], ['Zoom out', () => transform(2)], ['Pan left', () => transform(1, chart.flipX ? .25 : -.25)], ['Pan right', () => transform(1, chart.flipX ? -.25 : .25)], ['Pan up', () => transform(1, 0, chart.flipY ? -.25 : .25)], ['Pan down', () => transform(1, 0, chart.flipY ? .25 : -.25)]]) {
    const b = node('button', '', text); b.type = 'button'; b.addEventListener('click', action); navigation.append(b);
  }
  root.insertBefore(navigation, stage); chart.navigation = navigation;
  const plotOptions = node('details'), opacityLabel = node('label', '', 'Opacity'), opacity = node('input');
  opacity.type = 'range'; opacity.min = '.1'; opacity.max = '1'; opacity.step = '.05'; opacity.value = '1'; opacity.setAttribute('aria-label', 'Plot opacity'); opacity.addEventListener('input', () => { chart.opacity = opacity.valueAsNumber; chart.redraw(); });
  opacityLabel.append(opacity); plotOptions.append(node('summary', '', 'Opacity'), opacityLabel); navigation.append(plotOptions);
  reset.addEventListener("click", chart.reset, { signal: listeners.signal });
  const point = (event) => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
  const inside = (p) => { const area = chart.scale ?? chart.area; return area && p.x >= area.left && p.x <= area.right && p.y >= area.top && p.y <= area.bottom; };
  const hit = (p) => {
    if (!inside(p)) return null;
    let best = null, distance = Infinity;
    for (const item of chart.items) {
      const d = Math.hypot(p.x - item.x, p.y - item.y);
      if (item.width !== undefined ? Math.abs(p.x - item.x) <= item.width / 2 && Math.abs(p.y - item.y) <= item.height / 2 : d <= 9) {
        if (d < distance) { best = item; distance = d; }
      }
    }
    return best;
  };
  canvas.addEventListener("pointerdown", (event) => {
    const p = point(event); if (event.button !== 0 || !inside(p) || !chart.hasData) return;
    start = p; canvas.setPointerCapture(event.pointerId);
  }, { signal: listeners.signal });
  canvas.addEventListener("pointermove", (event) => {
    const p = point(event);
    if (start && (chart.rangePick || chart.dragMode !== 'inspect')) {
      const a = chart.area, right = clamp(p.x, a.left, a.right);
      selection.hidden = false; tip.hidden = true;
      const bottom = clamp(p.y, a.top, a.bottom);
      Object.assign(selection.style, { left: `${Math.min(start.x, right)}px`, top: `${chart.dragMode === 'zoom' ? Math.min(start.y, bottom) : a.top}px`, width: `${Math.abs(right - start.x)}px`, height: `${chart.dragMode === 'zoom' ? Math.abs(bottom - start.y) : a.bottom - a.top}px` });
      return;
    }
    const item = hit(p); tip.hidden = !item;
    if (item) { tip.textContent = item.tip; tip.style.left = `${clamp(p.x + 12, 0, Math.max(0, stage.clientWidth - tip.offsetWidth))}px`; tip.style.top = `${clamp(p.y + 12, 0, Math.max(0, stage.clientHeight - tip.offsetHeight))}px`; }
  }, { signal: listeners.signal });
  canvas.addEventListener("pointerup", (event) => {
    if (!start) return; const p = point(event), origin = start; start = null; selection.hidden = true;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (chart.dragMode === 'zoom' && chart.scale && Math.abs(p.x - origin.x) > 4 && Math.abs(p.y - origin.y) > 4) {
      setViewport({ x: [chart.scale.fromX(origin.x), chart.scale.fromX(p.x)].sort((a, b) => a - b), y: [chart.scale.fromY(origin.y), chart.scale.fromY(p.y)].sort((a, b) => a - b) });
    } else if (chart.dragMode === 'pan' && chart.scale) {
      const current = chart.viewport ?? chart.fullDomain, dx = chart.scale.fromX(origin.x) - chart.scale.fromX(p.x), dy = chart.scale.fromY(origin.y) - chart.scale.fromY(p.y);
      setViewport({ x: current.x.map((v) => v + dx), y: current.y.map((v) => v + dy) });
    } else if (chart.dragMode !== 'inspect') return;
    else if (chart.rangePick && Math.abs(p.x - origin.x) > 4) chart.rangePick(origin.x, p.x);
    else { const item = hit(p); if (item) chart.pick(item.payload); }
  }, { signal: listeners.signal });
  for (const name of ["pointercancel", "lostpointercapture"]) canvas.addEventListener(name, () => { start = null; selection.hidden = true; }, { signal: listeners.signal });
  canvas.addEventListener("pointerleave", () => { tip.hidden = true; }, { signal: listeners.signal });
  const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(chart.redraw); });
  observer.observe(stage); charts.set(container, chart);
  return chart;
}
function axisTicks(domain, integer) {
  if (!integer) return Array.from({ length: 5 }, (_, i) => mix(...domain, i / 4));
  const raw = Math.max(1, (domain[1] - domain[0]) / 5), power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power;
  const start = Math.ceil(domain[0] / step) * step, ticks = [];
  for (let i = 0; i < 8; i++) { const value = start + i * step; if (value > domain[1]) break; ticks.push(value); }
  return ticks;
}
function axes(chart, xDomain, yDomain, xLabel, yLabel, flipX = false, flipY = false, equal = false, integer = {}) {
  const { ctx, area: a, settings } = chart;
  chart.fullDomain = { x: [...xDomain], y: [...yDomain] }; chart.flipX = flipX; chart.flipY = flipY;
  if (chart.viewport) { xDomain = chart.viewport.x; yDomain = chart.viewport.y; }
  let left = a.left, right = a.right, top = a.top, bottom = a.bottom;
  if (equal) {
    const aspect = typeof equal === "number" ? equal : 1;
    const scale = Math.min((right - left) / ((xDomain[1] - xDomain[0]) * aspect), (bottom - top) / (yDomain[1] - yDomain[0]));
    const w = scale * (xDomain[1] - xDomain[0]) * aspect, h = scale * (yDomain[1] - yDomain[0]);
    left += (right - left - w) / 2; right = left + w; top += (bottom - top - h) / 2; bottom = top + h;
  }
  const x = (v) => mix(flipX ? right : left, flipX ? left : right, fraction(v, ...xDomain));
  const y = (v) => mix(flipY ? top : bottom, flipY ? bottom : top, fraction(v, ...yDomain));
  const font = ["Segoe UI", "Arial", "Consolas", "SemiDataLocalFont"].includes(settings.font) ? settings.font : "Segoe UI";
  ctx.font = `11px "${font}", sans-serif`; ctx.lineWidth = 1;
  for (const xv of axisTicks(xDomain, integer.x)) {
    const px = x(xv);
    ctx.strokeStyle = "#e4e9f1"; ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke();
    ctx.fillStyle = "#58687f"; ctx.textAlign = "center"; ctx.fillText(format(xv, settings.precision, settings.notation), px, bottom + 18);
  }
  for (const yv of axisTicks(yDomain, integer.y)) {
    const py = y(yv);
    ctx.strokeStyle = "#e4e9f1"; ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
    ctx.fillStyle = "#58687f";
    ctx.textAlign = "right"; ctx.fillText(format(yv, settings.precision, settings.notation), left - 8, py + 4);
  }
  ctx.fillStyle = "#35475f"; ctx.textAlign = "center"; ctx.fillText(xLabel, (left + right) / 2, a.height - 6);
  ctx.save(); ctx.translate(12, (top + bottom) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();
  chart.scale = { x, y, fromX: (px) => mix(...xDomain, clamp(fraction(px, flipX ? right : left, flipX ? left : right), 0, 1)), fromY: (py) => mix(...yDomain, clamp(fraction(py, flipY ? top : bottom, flipY ? bottom : top), 0, 1)), left, right, top, bottom };
  ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
  ctx.globalAlpha = chart.opacity;
  return chart.scale;
}
function line(chart, coords, colorValue, dashed = false) {
  const { ctx } = chart; ctx.strokeStyle = colorValue; ctx.lineWidth = 1.4; ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.beginPath(); coords.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.setLineDash([]);
}
function rangeControls(chart, firstLabel, secondLabel, submitLabel, submit) {
  const inputs = [firstLabel, secondLabel].map((text) => {
    const label = node("label", "", text), input = node("input"); input.type = "number"; input.step = "any"; input.required = true;
    label.append(input); chart.controls.insertBefore(label, chart.status); return input;
  });
  const button = node("button", "", submitLabel); button.type = "submit"; chart.controls.insertBefore(button, chart.status);
  chart.controls.addEventListener("submit", (event) => {
    event.preventDefault(); const values = inputs.map((input) => input.valueAsNumber);
    if (!values.every(finite)) { chart.status.textContent = "Enter two finite numbers."; return; }
    submit(...values);
  });
  return inputs;
}
function plotRangeControls(chart, axis, fullReset, dataReset) {
  for (const [label, action] of [['Auto', dataReset], ['Full', fullReset]]) {
    const control = node('button', '', label); control.type = 'button'; control.title = label === 'Auto' ? 'Fit the recorded data' : 'Include recorded data and available limits';
    control.addEventListener('click', () => { chart.viewport = null; action(); chart.redraw(); chart.keyboardReset?.(); chart.status.textContent = label === 'Auto' ? 'View fitted to data.' : 'View includes data and available limits.'; }); chart.navigation.append(control);
  }
  const inputs = ['minimum', 'maximum'].map((suffix) => {
    const label = node('label', '', `Visible ${axis.toUpperCase()} ${suffix}`), input = node('input'); input.type = 'number'; input.step = 'any'; input.setAttribute('aria-label', `Visible ${axis.toUpperCase()} ${suffix}`); input.style.width = '115px';
    label.append(input); chart.navigation.append(label); return input;
  });
  const apply = node('button', '', 'Set visible range'); apply.type = 'button';
  const submit = () => {
    const values = inputs.map((input) => input.valueAsNumber);
    if (!values.every(finite) || values[0] >= values[1]) { chart.status.textContent = 'Choose finite, increasing viewport limits.'; return; }
    if (!chart.fullDomain || !chart.hasData) { chart.status.textContent = 'There are no visible data to fit.'; return; }
    chart.viewport = { x: [...(chart.viewport?.x ?? chart.fullDomain.x)], y: [...(chart.viewport?.y ?? chart.fullDomain.y)], [axis]: values };
    chart.redraw(); chart.status.textContent = 'Visible range changed. Full-population statistics and query selection are unchanged.';
  };
  apply.addEventListener('click', submit); chart.navigation.append(apply);
  for (const input of inputs) input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
  return () => { if (chart.fullDomain) inputs.forEach((input, i) => { input.value = String((chart.viewport?.[axis] ?? chart.fullDomain[axis])[i]); }); };
}
function chartCheckbox(chart, label, checked, change) {
  const holder = node('label', 'chart-checkbox'), input = node('input'); input.type = 'checkbox'; input.checked = checked; holder.append(input, document.createTextNode(label));
  input.addEventListener('change', () => { change(input.checked); chart.redraw(); }); chart.navigation.append(holder); return input;
}
/** series: [{key,label,color,points:[{x,value,lsl,usl,datasetId,deviceId,seq}],stats}]. */
export function renderTrend(container, { series = [], settings = {}, onPick, title = "Trend", yLabel = "Test value" } = {}) {
  const list = seriesList(series), config = options(settings), chart = createChart(container, title, list, config, onPick);
  let scale, domain = [0, 1], domainMode = 'full', showGaps = true, showFails = true;
  const choose = (lo, hi, keys = chart.visible().map((s) => s.key)) => {
    if (lo > hi) { chart.status.textContent = "The first device index must be no greater than the last."; return; }
    if (!keys.length) { chart.status.textContent = "Show at least one series before selecting data."; return; }
    if (!chart.pick({ type: "trend", xlo: lo, xhi: hi, seriesKeys: keys })) return;
    chart.status.textContent = `Selected device indices ${format(lo, 6)} to ${format(hi, 6)}; the full population will be queried.`;
  };
  const inputs = rangeControls(chart, "First device index", "Last device index", "Inspect range", choose);
  const resetVisible = plotRangeControls(chart, 'y', () => { domainMode = 'full'; }, () => { domainMode = 'data'; });
  chartCheckbox(chart, 'Gaps', true, (value) => { showGaps = value; }); chartCheckbox(chart, 'Fails', true, (value) => { showFails = value; });
  chart.keyboardReset = () => { inputs.forEach((input, i) => { input.value = String(domain[i]); }); resetVisible(); };
  chart.rangePick = (lo, hi) => { const a = scale.fromX(lo), b = scale.fromX(hi); choose(Math.min(a, b), Math.max(a, b)); };
  chart.paint = () => {
    const visible = chart.visible(), points = visible.flatMap((s) => (s.points ?? []).filter((p) => finite(p.x) && finite(p.value)));
    if (!points.length) return false;
    domain = extent(points.map((p) => p.x));
    const values = points.map((p) => p.value);
    if (domainMode === 'full') {
      if (config.showLimits) for (const p of points) values.push(p.lsl, p.usl);
      for (const s of visible) values.push(s.stats?.lsl, s.stats?.usl, s.stats?.lowSpec, s.stats?.highSpec);
    }
    scale = axes(chart, domain, extent(values), "Device index", yLabel, false, false, false, { x: true });
    for (const s of visible) {
      const data = (s.points ?? []).filter((p) => finite(p.x) && finite(p.value));
      if (config.showSigma && finite(s.stats?.mean) && finite(s.stats?.stdev) && s.stats.stdev > 0) {
        const low = s.stats.mean - 3 * s.stats.stdev, high = s.stats.mean + 3 * s.stats.stdev;
        chart.ctx.fillStyle = s.color; chart.ctx.globalAlpha = .08 * chart.opacity;
        chart.ctx.fillRect(scale.left, scale.y(high), scale.right - scale.left, scale.y(low) - scale.y(high)); chart.ctx.globalAlpha = chart.opacity;
        for (const value of [low, high]) line(chart, [[scale.left, scale.y(value)], [scale.right, scale.y(value)]], s.color, true);
      }
      if (config.showLimits) for (const [field, shade] of [["lsl", "#8057a6"], ["usl", "#ad3f55"]]) {
        const limits = data.filter((p) => finite(p[field])).map((p) => [scale.x(p.x), scale.y(p[field])]);
        if (limits.length) line(chart, limits, shade, true);
        else if (finite(s.stats?.[field])) line(chart, [[scale.left, scale.y(s.stats[field])], [scale.right, scale.y(s.stats[field])]], shade, true);
      }
      if (config.showMean && finite(s.stats?.mean)) line(chart, [[scale.left, scale.y(s.stats.mean)], [scale.right, scale.y(s.stats.mean)]], s.color, true);
      if (config.showMedian && finite(s.stats?.median)) line(chart, [[scale.left, scale.y(s.stats.median)], [scale.right, scale.y(s.stats.median)]], '#286b60', true);
      if (config.showSpecs) for (const field of ['lowSpec', 'highSpec']) if (finite(s.stats?.[field])) line(chart, [[scale.left, scale.y(s.stats[field])], [scale.right, scale.y(s.stats[field])]], '#a36518', true);
      let segment = [], prior = null;
      for (const p of data) {
        if (showGaps && prior && (p.segment !== undefined && prior.segment !== undefined && p.segment !== prior.segment || p.datasetId !== undefined && prior.datasetId !== undefined && p.datasetId !== prior.datasetId)) { line(chart, segment, s.color); segment = []; }
        segment.push([scale.x(p.x), scale.y(p.value)]); prior = p;
      }
      if (segment.length) line(chart, segment, s.color);
      for (const p of data) {
        const x = scale.x(p.x), y = scale.y(p.value), failed = p.failed === true || Number.isInteger(p.testFlags) && !(p.testFlags & 0x50) && !!(p.testFlags & 0x80);
        chart.ctx.beginPath(); chart.ctx.fillStyle = showFails && failed ? color(settings.failColor ?? '#b63842') : s.color; chart.ctx.arc(x, y, showFails && failed ? config.dotSize + 2 : config.dotSize, 0, 2 * Math.PI); chart.ctx.fill();
        chart.items.push({ x, y, tip: `${s.label}\nDevice index: ${p.x}\n${yLabel}: ${format(p.value, config.precision, config.notation)}${failed ? '\nRecorded test failure' : ''}${p.seq ? `\nRecord ${p.seq}` : ''}`, payload: { type: "trend", xlo: p.x, xhi: p.x, seriesKeys: [s.key] } });
      }
    }
    const total = visible.reduce((sum, s) => sum + (finite(s.stats?.count) ? s.stats.count : (s.points?.length ?? 0)), 0);
    const recorded = visible.reduce((sum, s) => sum + (finite(s.stats?.total) ? s.stats.total : (s.stats?.count ?? s.points?.length ?? 0)), 0);
    chart.note.textContent = `${points.length.toLocaleString()} displayed points · ${recorded.toLocaleString()} observations · ${total.toLocaleString()} numerically eligible. Picks query full intervals. Gaps use invalid runs and source boundaries; untested device gaps are not inferred. Fails marks retained samples; reduced trends may omit other failures.`;
    chart.note.title = `Dashed overlays: ${[config.showLimits && 'test limits', config.showSpecs && 'specifications (amber)', config.showMean && 'mean (series color)', config.showMedian && 'median (green)', config.showSigma && '±3 sigma shaded band'].filter(Boolean).join(', ') || 'none'}. Missing or changing specifications are not drawn.`;
    return true;
  };
  chart.redraw(); chart.keyboardReset(); return chart;
}

/** Histogram bins come from the query provider: [{low,high,count,last}]. Shared edges are its responsibility. */
export function renderHistogram(container, { series = [], settings = {}, onPick, title = "Histogram", xLabel = "Test value" } = {}) {
  const list = seriesList(series), config = options(settings), chart = createChart(container, title, list, config, onPick);
  let scale, domain = [0, 1], domainMode = 'full';
  const validBins = (s) => (s.bins ?? []).filter((b) => finite(b.low) && finite(b.high) && b.high > b.low && finite(b.count) && b.count >= 0);
  const choose = (low, high) => {
    if (low >= high) { chart.status.textContent = "The lower value must be less than the upper value."; return; }
    const selected = chart.visible().flatMap((s) => validBins(s)).filter((b) => b.high > low && b.low < high);
    if (!selected.length) { chart.status.textContent = "No visible histogram intervals intersect that range."; return; }
    const bounds = extent(selected.flatMap((b) => [b.low, b.high]));
    const inclusiveHigh = selected.some((b) => b.high === bounds[1] && b.last === true);
    if (!chart.pick({ type: "histogram", low: bounds[0], high: bounds[1], inclusiveHigh, seriesKeys: chart.visible().map((s) => s.key) })) return;
    chart.status.textContent = `Selected whole histogram intervals: [${format(bounds[0], config.precision, config.notation)}, ${format(bounds[1], config.precision, config.notation)}${inclusiveHigh ? "]" : ")"}.`;
  };
  const inputs = rangeControls(chart, "Lower value", "Upper value", "Inspect intervals", choose);
  const resetVisible = plotRangeControls(chart, 'x', () => { domainMode = 'full'; }, () => { domainMode = 'data'; });
  chart.keyboardReset = () => { inputs.forEach((input, i) => { input.value = String(domain[i]); }); resetVisible(); };
  chart.rangePick = (lo, hi) => { const a = scale.fromX(lo), b = scale.fromX(hi); choose(Math.min(a, b), Math.max(a, b)); };
  chart.paint = () => {
    const visible = chart.visible(), bins = visible.flatMap(validBins);
    if (!bins.some((b) => b.count > 0)) return false;
    const values = bins.flatMap((b) => [b.low, b.high]);
    if (domainMode === 'full') for (const s of visible) values.push(s.stats?.lsl, s.stats?.usl, s.stats?.lowSpec, s.stats?.highSpec);
    domain = extent(values); const peak = extent(bins.map((b) => b.count), true)[1];
    scale = axes(chart, domain, [0, peak * 1.12], xLabel, "Observation count", false, false, false, { y: true });
    visible.forEach((s, index) => {
      const data = validBins(s), { ctx } = chart, total = data.reduce((sum, b) => sum + b.count, 0); let cumulative = 0;
      for (const b of data) {
        cumulative += b.count;
        const totalWidth = scale.x(b.high) - scale.x(b.low), width = totalWidth / visible.length;
        const x = scale.x(b.low) + index * width + 0.5, y = scale.y(b.count), height = scale.y(0) - y;
        ctx.fillStyle = s.color; ctx.globalAlpha = 0.84 * chart.opacity; ctx.fillRect(x, y, Math.max(0.5, width - 1), height); ctx.globalAlpha = chart.opacity;
        if (b.count) chart.items.push({ x: x + width / 2, y: y + height / 2, width: Math.max(1, width), height,
          tip: `${s.label}\n[${format(b.low, config.precision, config.notation)}, ${format(b.high, config.precision, config.notation)}${b.last ? "]" : ")"}\nCount: ${b.count.toLocaleString()}\nShare: ${format(100 * b.count / total, 2)}%\nCumulative: ${format(100 * cumulative / total, 2)}%`,
          payload: { type: "histogram", low: b.low, high: b.high, inclusiveHigh: b.last === true, seriesKeys: [s.key] } });
      }
      const stats = s.stats ?? {}, overlay = (value, shade) => {
        if (finite(value) && value >= domain[0] && value <= domain[1]) line(chart, [[scale.x(value), scale.top], [scale.x(value), scale.bottom]], shade, true);
      };
      if (config.showLimits) { overlay(stats.lsl, "#8057a6"); overlay(stats.usl, "#ad3f55"); }
      if (config.showMean) overlay(stats.mean, s.color);
      if (config.showMedian) overlay(stats.median, '#286b60');
      if (config.showSpecs) { overlay(stats.lowSpec, '#a36518'); overlay(stats.highSpec, '#a36518'); }
      if (finite(stats.mean) && finite(stats.stdev) && stats.stdev > 0) {
        if (config.showSigma) for (const n of [-9, -6, -3, 3, 6, 9]) overlay(stats.mean + n * stats.stdev, "#78879b");
        if (config.showGaussian && data.length) {
          const height = extent(data.map((b) => b.count), true)[1];
          line(chart, Array.from({ length: 201 }, (_, i) => {
            const value = mix(...domain, i / 200), z = (value - stats.mean) / stats.stdev;
            return [scale.x(value), scale.y(height * Math.exp(-0.5 * z * z))];
          }), s.color);
        }
      }
    });
    chart.note.textContent = `Equal-width intervals supplied by the query; the final interval includes its upper endpoint. Inspect drag selects whole intervals.${config.showGaussian ? " Gaussian overlays are scaled to each series' peak count." : ""}${config.showMedian ? ' Median: green.' : ''}${config.showSpecs ? ' Constant specification limits: amber; absent/changing specs are not drawn.' : ''}`;
    return true;
  };
  chart.redraw(); chart.keyboardReset(); return chart;
}

/** Hardware/software bin series: [{key,label,color,bins:[{number,name,count,percent,passFail}]}]. */
export function renderBins(container, { series = [], settings = {}, onPick, title = "Bin distribution" } = {}) {
  const list = seriesList(series), chart = createChart(container, title, list, options(settings), onPick);
  const label = node("label", "", "Bin series"), select = node("select"), button = node("button", "", "Inspect bin");
  list.forEach((s, index) => { const option = node("option", "", s.label); option.value = String(index); select.append(option); });
  const binLabel = node("label", "", "Bin number"), binInput = node("input"); binInput.type = "number"; binInput.step = "1"; binInput.required = true;
  binLabel.append(binInput); label.append(select); button.type = "submit";
  for (const item of [label, binLabel, button]) chart.controls.insertBefore(item, chart.status);
  chart.controls.addEventListener("submit", (event) => {
    event.preventDefault(); const s = list[Number(select.value)], number = binInput.valueAsNumber;
    if (!s || chart.hidden.has(s.key) || !(s.bins ?? []).some((b) => b.number === number && b.count > 0)) { chart.status.textContent = "Enter a recorded bin from a visible series."; return; }
    if (chart.pick({ type: "bin", number, seriesKeys: [s.key] })) chart.status.textContent = `Selected bin ${number}.`;
  });
  chart.paint = () => {
    const visible = chart.visible(), numbers = [...new Set(visible.flatMap((s) => (s.bins ?? []).filter((b) => b.count > 0).map((b) => b.number)))].sort((a, b) => Number(a) - Number(b));
    if (!numbers.length) return false;
    const counts = visible.flatMap((s) => (s.bins ?? []).map((b) => b.count)), peak = extent(counts, true)[1];
    const scale = axes(chart, [-0.6, numbers.length - 0.4], [0, peak * 1.12], "Bin number", "Device count", false, false, false, { y: true });
    // Category labels replace numeric x ticks; selected/hovered bins retain their exact identity even on dense charts.
    const shown = chart.viewport?.x ?? [-.6, numbers.length - .4], step = Math.max(1, Math.ceil((shown[1] - shown[0]) / Math.max(2, (scale.right - scale.left) / 45)));
    chart.afterPaint = () => {
      const font = ['Segoe UI', 'Arial', 'Consolas', 'SemiDataLocalFont'].includes(chart.settings.font) ? chart.settings.font : 'Segoe UI'; chart.ctx.font = `11px "${font}", sans-serif`;
      chart.ctx.fillStyle = "#fff"; chart.ctx.fillRect(scale.left - 18, scale.bottom + 3, scale.right - scale.left + 36, 22);
      chart.ctx.fillStyle = "#58687f"; chart.ctx.textAlign = "center";
      numbers.forEach((number, i) => { const x = scale.x(i); if (i % step === 0 && x >= scale.left && x <= scale.right) chart.ctx.fillText(String(number), x, scale.bottom + 18); });
    };
    const numberIndices = new Map(numbers.map((number, i) => [number, i]));
    visible.forEach((s, index) => {
      for (const b of s.bins ?? []) {
        if (!finite(b.count) || b.count <= 0) continue;
        const i = numberIndices.get(b.number), groupWidth = (scale.x(i + 0.4) - scale.x(i - 0.4)), width = groupWidth / visible.length;
        const x = scale.x(i - 0.4) + index * width, y = scale.y(b.count), height = scale.y(0) - y;
        chart.ctx.fillStyle = chart.settings.binColors?.[b.number] ? color(chart.settings.binColors[b.number]) : s.color; chart.ctx.fillRect(x, y, Math.max(0.5, width - 1), height);
        chart.items.push({ x: x + width / 2, y: y + height / 2, width, height,
          tip: `${s.label}\nBin ${b.number}: ${b.name || "Name not recorded"}\nCount: ${b.count.toLocaleString()}${finite(b.percent) ? ` (${format(b.percent, 2)}%)` : ""}\nPass/fail: ${b.passFail ?? "Unknown"}`,
          payload: { type: "bin", number: b.number, seriesKeys: [s.key] } });
      }
    });
    chart.note.textContent = `Bins are ordered by number. Click a bar or use the bin selector to inspect its devices. Counts use the population shown by the workspace.${Object.keys(chart.settings.binColors ?? {}).length ? ' Custom bin colors override series colors where assigned.' : ''}`;
    return true;
  };
  chart.redraw(); return chart;
}

/** Dies: [{x,y,bin,count,failed,datasetId,deviceId}]. stacked=true colors by supplied failed counts.
 * Orientation changes only display; callbacks always retain original STDF coordinates.
 */
export function renderWafer(container, { dies = [], orientation = {}, settings = {}, onPick, title = "Wafer map", stacked = false } = {}) {
  const valid = dies.filter((d) => finite(d.x) && finite(d.y)), groups = new Map();
  const maxCount = extent(valid.map((d) => d.count), true)[1];
  const keyFor = (d) => String(stacked ? (finite(d.count) ? d.count : "unknown") : (d.bin ?? "unknown"));
  for (const d of valid) {
    const key = keyFor(d);
    if (!groups.has(key)) {
      const ratio = maxCount > 0 && finite(d.count) ? clamp(d.count / maxCount, 0, 1) : 0;
      const fill = stacked ? `#${Math.round(34 + 165 * ratio).toString(16).padStart(2, "0")}${Math.round(135 - 76 * ratio).toString(16).padStart(2, "0")}55` : color(settings.binColors?.[key], finite(d.bin) ? d.bin : groups.size);
      groups.set(key, { key, label: stacked ? `Failed count: ${key}` : `Soft bin ${key}`, color: fill });
    }
  }
  const list = [...groups.values()].sort((a, b) => Number(a.key) - Number(b.key)), chart = createChart(container, title, list, options(settings), onPick);
  const inputs = rangeControls(chart, "Die X coordinate", "Die Y coordinate", "Inspect die", (x, y) => {
    const die = valid.find((d) => d.x === x && d.y === y && !chart.hidden.has(keyFor(d)));
    if (!die) { chart.status.textContent = "No visible die has those coordinates."; return; }
    if (chart.pick({ type: "wafer", x, y })) chart.status.textContent = `Selected original STDF coordinate (${x}, ${y}).`;
  });
  chart.keyboardReset = () => inputs.forEach((input, i) => { input.value = valid.length ? String(valid[0][i ? "y" : "x"]) : ""; });
  chart.paint = () => {
    const visible = valid.filter((d) => !chart.hidden.has(keyFor(d))); if (!visible.length) return false;
    const xBounds = extent(valid.map((d) => d.x)), yBounds = extent(valid.map((d) => d.y));
    const aspect = finite(orientation.dieAspectRatio) && orientation.dieAspectRatio > 0 ? orientation.dieAspectRatio : 1;
    const scale = axes(chart, [xBounds[0] - 0.7, xBounds[1] + 0.7], [yBounds[0] - 0.7, yBounds[1] + 0.7], "STDF X coordinate", "STDF Y coordinate", orientation.posX === "L", orientation.posY === "D", aspect, { x: true, y: true });
    const width = Math.abs(scale.x(xBounds[0] + 0.88) - scale.x(xBounds[0])), height = Math.abs(scale.y(yBounds[0] + 0.88) - scale.y(yBounds[0]));
    for (const d of visible) {
      const x = scale.x(d.x), y = scale.y(d.y); chart.ctx.fillStyle = groups.get(keyFor(d)).color; chart.ctx.fillRect(x - width / 2, y - height / 2, width, height);
      chart.items.push({ x, y, width, height, tip: `STDF XY: (${d.x}, ${d.y})\n${stacked ? `Failed count: ${d.count ?? "Unknown"}` : `Soft bin: ${d.bin ?? "Not recorded"}`}\n${d.failed === undefined ? "" : `Failed: ${d.failed}`}`,
        payload: { type: "wafer", x: d.x, y: d.y } });
    }
    chart.note.textContent = `${visible.length.toLocaleString()} mapped coordinates. Positive X: ${orientation.posX === "L" ? "left" : orientation.posX === "R" ? "right" : "right (default)"}; positive Y: ${orientation.posY === "D" ? "down" : orientation.posY === "U" ? "up" : "up (default)"}. Flat: ${orientation.flat || "not recorded"}. Die aspect: ${format(aspect, 3)}${orientation.dieAspectRatio ? "" : " (default)"}. Select a die to inspect its devices.`;
    return true;
  };
  chart.redraw(); chart.keyboardReset(); return chart;
}
