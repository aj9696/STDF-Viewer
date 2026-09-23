import { esc, fmt, precise } from "./format.js";

// Charts use numeric SVG geometry. All imported labels are escaped before rendering.
function chartFrame(yMin, yMax, xLabel) {
  const w = 680,
    h = 270,
    left = 65,
    right = 23,
    top = 20,
    bottom = 47,
    plotW = w - left - right,
    plotH = h - top - bottom;
  if (yMin === yMax) {
    const pad = Math.abs(yMin) * 0.05 || 1;
    yMin -= pad;
    yMax += pad;
  }
  const y = (v) => top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  let content = "";
  for (let i = 0; i <= 4; i++) {
    const value = yMin + ((yMax - yMin) * i) / 4;
    const yy = y(value);
    content += `<line class="grid-line" x1="${left}" y1="${yy}" x2="${w - right}" y2="${yy}"/><text x="${left - 10}" y="${yy + 4}" text-anchor="end">${esc(precise(value))}</text>`;
  }
  content += `<text class="axis-label" x="${left + plotW / 2}" y="${h - 6}" text-anchor="middle">${esc(xLabel)}</text>`;
  return { w, h, left, right, top, bottom, plotW, plotH, y, content };
}
function svg(c, content, label) {
  return `<svg viewBox="0 0 ${c.w} ${c.h}" role="img" aria-label="${esc(label)}">${c.content}${content}</svg>`;
}
export function histogramChart(bins, unit) {
  if (!bins?.length)
    return '<div class="chart-note">No valid measurements to plot.</div>';
  const c = chartFrame(
    0,
    Math.max(...bins.map((b) => b.count)) || 1,
    unit || "Measurement value",
  );
  const step = c.plotW / bins.length;
  let content = bins
    .map(
      (b, i) =>
        `<rect class="data-bar" x="${c.left + i * step + 1}" y="${c.y(b.count)}" width="${Math.max(1, step - 2)}" height="${c.y(0) - c.y(b.count)}" rx="1"><title>${esc(precise(b.low))} to ${esc(precise(b.high))}: ${fmt(b.count)} measurements</title></rect>`,
    )
    .join("");
  const low = bins[0].low,
    high = bins[bins.length - 1].high;
  for (let i = 0; i <= 4; i++)
    content += `<text x="${c.left + (c.plotW * i) / 4}" y="${c.h - 27}" text-anchor="middle">${esc(precise(low + ((high - low) * i) / 4))}</text>`;
  return svg(
    c,
    content,
    `Histogram of ${unit || "measurement values"}; all valid measurements`,
  );
}
export function meansChart(groups, unit) {
  const valid = groups
    .map((g, index) => ({ ...g, order: index + 1 }))
    .filter((g) => g.mean != null);
  if (!valid.length)
    return '<div class="chart-note">No lot means available.</div>';
  const vals = valid.map((g) => g.mean),
    min = Math.min(...vals),
    max = Math.max(...vals),
    pad = (max - min) * 0.2 || Math.abs(min) * 0.03 || 1;
  const c = chartFrame(
      min - pad,
      max + pad,
      `Dataset / lot mean${unit ? ` (${unit})` : ""}`,
    ),
    step = c.plotW / valid.length;
  const content = valid
    .map(
      (g, i) =>
        `<line x1="${c.left + (i + 0.5) * step}" x2="${c.left + (i + 0.5) * step}" y1="${c.y(min - pad)}" y2="${c.y(g.mean)}" stroke="#d1e6e5" stroke-width="3"/><circle cx="${c.left + (i + 0.5) * step}" cy="${c.y(g.mean)}" r="5" fill="#13858a"><title>${esc(g.lot || g.name)} · mean ${esc(precise(g.mean))} · n=${fmt(g.count)}</title></circle><text x="${c.left + (i + 0.5) * step}" y="${c.h - 27}" text-anchor="middle">${esc(valid.length > 7 ? g.order : String(g.lot || g.name).slice(0, 14))}</text>`,
    )
    .join("");
  return svg(
    c,
    content,
    "Mean measurement for each selected dataset; numbered labels follow the table order",
  );
}
export function pointsChart(points, stats, unit) {
  if (!points?.length)
    return '<div class="chart-note">No ordered measurements to plot.</div>';
  const values = points.map((p) => p.value);
  [stats.lsl, stats.usl]
    .filter((v) => v != null)
    .forEach((v) => values.push(v));
  const low = Math.min(...values),
    high = Math.max(...values),
    pad = (high - low) * 0.1 || Math.abs(low) * 0.02 || 1;
  const c = chartFrame(
      low - pad,
      high + pad,
      "Measurement order within selected sources",
    ),
    minX = Math.min(...points.map((p) => p.index)),
    maxX = Math.max(...points.map((p) => p.index));
  const x = (v) => c.left + ((v - minX) / (maxX - minX || 1)) * c.plotW;
  let content = points
    .map(
      (p) =>
        `<circle class="data-point" cx="${x(p.index)}" cy="${c.y(p.value)}" r="2.5"><title>Order ${esc(p.index)} · ${esc(p.part_id || "No part ID")} · site ${esc(p.site)} · ${esc(precise(p.value))} ${esc(unit)}</title></circle>`,
    )
    .join("");
  [
    ["LSL", stats.lsl],
    ["USL", stats.usl],
  ].forEach(([label, v]) => {
    if (v != null)
      content += `<line class="limit-line" x1="${c.left}" x2="${c.w - c.right}" y1="${c.y(v)}" y2="${c.y(v)}"/><text x="${c.w - c.right}" y="${c.y(v) - 5}" text-anchor="end">${label} ${esc(precise(v))}</text>`;
  });
  for (let i = 0; i <= 4; i++)
    content += `<text x="${c.left + (c.plotW * i) / 4}" y="${c.h - 27}" text-anchor="middle">${fmt(Math.round(minX + ((maxX - minX) * i) / 4), 0)}</text>`;
  return svg(
    c,
    content,
    "Measurement values by source order, with available test limits",
  );
}
