import { element } from './library-home-view.js';
import { button, fmt } from './viewer-view.js';

const COLORS = ['#285fa5', '#bf543b', '#258b74', '#9463b0', '#b57d19', '#367a91', '#985a7b', '#596b37'];
export function heatColor(value, low, high) {
  if (!Number.isFinite(value)) return '#aeb7c2';
  const t = high > low ? Math.max(0, Math.min(1, (value - low) / (high - low))) : .5;
  return `hsl(${225 * (1 - t)} 68% 48%)`;
}
/** Compact full-population range strip; no statistics are recomputed from display points. */
export function renderValueRange(container, { min, max, mean, median, count, low, high, unit = '' } = {}) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || !(count > 0)) return null;
  const limits = [low, high].filter(Number.isFinite), domainLow = Math.min(min, ...limits), domainHigh = Math.max(max, ...limits);
  const fraction = value => domainHigh > domainLow ? Math.max(0, Math.min(1, (value - domainLow) / (domainHigh - domainLow))) : .5;
  const box = element('figure'), caption = element('figcaption'), strip = element('div'); box.style.margin = '.65rem 0'; caption.style.fontSize = '.78rem';
  const values = [['Min', min], ['Mean', mean], ['Median', median], ['Max', max]].filter(([, value]) => Number.isFinite(value));
  caption.textContent = `${values.map(([name, value]) => `${name} ${fmt(value)}${unit ? ` ${unit}` : ''}`).join(' · ')} · N ${count.toLocaleString()}`;
  strip.setAttribute('role', 'img'); strip.setAttribute('aria-label', `${caption.textContent}${Number.isFinite(low) ? `; lower limit ${low}` : ''}${Number.isFinite(high) ? `; upper limit ${high}` : ''}`);
  Object.assign(strip.style, { position: 'relative', height: '20px', margin: '6px 7px', borderBottom: '1px solid #aeb7c2' });
  const band = element('div'); Object.assign(band.style, { position: 'absolute', left: `${fraction(min) * 100}%`, width: `${(fraction(max) - fraction(min)) * 100}%`, minWidth: '2px', top: '6px', height: '7px', background: 'linear-gradient(90deg,#245cce,#b63842)' }); strip.append(band);
  for (const [name, value, shade, dashed] of [['Mean', mean, '#17263b', false], ['Median', median, '#4e7a68', true], ['Low limit', low, '#a36518', true], ['High limit', high, '#a36518', true]]) if (Number.isFinite(value)) {
    const marker = element('span'); marker.title = `${name}: ${value}${unit ? ` ${unit}` : ''}`; marker.dataset.marker = name;
    Object.assign(marker.style, { position: 'absolute', left: `${fraction(value) * 100}%`, height: '18px', borderLeft: `2px ${dashed ? 'dashed' : 'solid'} ${shade}` }); strip.append(marker);
  }
  box.append(caption, strip); container.append(box); return box;
}
/** Canvas retains only bounded display points. Statistics come from worker populations. */
export function renderStudyChart(container, { title = '', series = [], axes = ['X', 'Y'], threeD = false, wafer = false, onPick = () => {}, valueRange, settings = {}, orientation = {}, specLimits = [] } = {}) {
  const box = element('section', undefined, 'study-chart'), heading = element('h3', title), canvas = element('canvas'), status = element('output', 'Hover a point for details.', 'study-chart-status'), bar = element('div', undefined, 'viewer-toolbar');
  canvas.tabIndex = 0; canvas.title = axes.join(', '); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${title}. ${axes.join(', ')}. ${threeD ? 'Drag to rotate; right-drag to pan; wheel to zoom; double-click to reset.' : 'Wheel to zoom; drag to pan; double-click to reset.'}`);
  box.append(heading, canvas, status, bar); container.append(box);
  let yaw = -.6, pitch = .55, zoom = 1, pan = [0, 0], drag = null, moved = false, projected = [], width = 700, height = 400, closed = false, solidFaces = 0, barWidth = 14;
  const points = series.flatMap((s, i) => (s.points ?? []).map(p => ({ ...p, color: p.color ?? s.color ?? COLORS[i % COLORS.length], label: s.label ?? '', drawKind: s.kind ?? 'points', seriesIndex: i })));
  const hidden = new Set(), legends = [], rangeInputs = [];
  let opacity = 1, showRegression = true, domainMode = 'auto';
  const hasLimits = specLimits.slice(0, 2).some(limit => Number.isFinite(limit?.low) || Number.isFinite(limit?.high));
  const computeRanges = (full = false) => [0, 1, 2].map((i) => {
    const visible = points.filter(point => !hidden.has(point.seriesIndex));
    const key = ['x', 'y', 'z'][i]; let lo = Infinity, hi = -Infinity;
    for (const p of visible) {
      if (Number.isFinite(p[key])) { lo = Math.min(lo, p[key]); hi = Math.max(hi, p[key]); }
      if (i === 1 && p.drawKind === 'bar') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      if (i === 1 && p.box) for (const v of [p.box.whiskerLow,p.box.whiskerHigh]) if (Number.isFinite(v)) {lo=Math.min(lo,v);hi=Math.max(hi,v);}
    }
    if (full && !threeD && !wafer) for (const value of [specLimits[i]?.low, specLimits[i]?.high]) if (Number.isFinite(value)) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
    if (!Number.isFinite(lo)) return [0, 1];
    if (i === 0 && visible.some(p => p.drawKind === 'bar' || p.box)) return [lo - .5, hi + .5];
    if (lo === hi) return [lo - (Math.abs(lo) * .05 || .5), hi + (Math.abs(hi) * .05 || .5)];
    return [lo, hi];
  });
  let ranges = computeRanges();
  const normalize = (v, axis) => Number.isFinite(v) ? (v - ranges[axis][0]) / (ranges[axis][1] - ranges[axis][0]) * 2 - 1 : 0;
  const aspect = Number.isFinite(orientation.dieAspectRatio) && orientation.dieAspectRatio > 0 ? orientation.dieAspectRatio : 1;
  const waferScale = () => Math.min((width-100)/((ranges[0][1]-ranges[0][0]+1)*aspect),(height-90)/(ranges[1][1]-ranges[1][0]+1));
  const project = (x, y, z = 0) => {
    if (wafer) { if (orientation.posX === 'L') x = -x; if (orientation.posY === 'D') y = -y; }
    if (threeD) {
      if (wafer) { const dx=(ranges[0][1]-ranges[0][0]+1)*aspect,dy=ranges[1][1]-ranges[1][0]+1,span=Math.max(dx,dy);x*=dx/span;y*=dy/span; }
      const a = x * Math.cos(yaw) - y * Math.sin(yaw), b = x * Math.sin(yaw) + y * Math.cos(yaw);
      let scale=Math.min(width*.36,height*.33)*zoom;
      if (wafer) {
        const dx = (ranges[0][1] - ranges[0][0] + 1) * aspect, dy = ranges[1][1] - ranges[1][0] + 1, span = Math.max(dx, dy);
        const extentX = dx / span * (1 + .82 / (ranges[0][1] - ranges[0][0])), extentY = dy / span * (1 + .82 / (ranges[1][1] - ranges[1][0]));
        scale = Math.min(width - 80, height - 80) / (2 * Math.hypot(extentX, extentY, 1)) * zoom;
      }
      return [width / 2 + a * scale + pan[0], height / 2 - (b * Math.sin(pitch) + z * Math.cos(pitch)) * scale + pan[1], b * Math.cos(pitch) - z * Math.sin(pitch)];
    }
    if (wafer) {const scale=waferScale()*zoom;return [(width+30)/2+x*(ranges[0][1]-ranges[0][0])/2*aspect*scale+pan[0],(height-10)/2-y*(ranges[1][1]-ranges[1][0])/2*scale+pan[1],0];}
    return [65 + (x + 1) / 2 * (width - 100) * zoom + pan[0], height - 50 - (y + 1) / 2 * (height - 90) * zoom + pan[1], 0];
  };
  const draw = () => {
    if (closed) return;
    width = Math.max(280, Math.round(box.clientWidth || 700)); height = wafer ? 430 : 380;
    const scale = Math.min(devicePixelRatio || 1, 2); canvas.width = width * scale; canvas.height = height * scale; canvas.style.width = '100%'; canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.font = '12px Segoe UI, sans-serif';
    ctx.strokeStyle = '#d7dde5'; ctx.lineWidth = 1;
    const active = points.filter(point => !hidden.has(point.seriesIndex)), categorical = active.some(point => point.drawKind === 'bar' || point.box);
    const shortLabel = (label, limit) => { let text = String(label ?? ''); if (ctx.measureText(text).width <= limit) return text; while (text && ctx.measureText(text + '…').width > limit) text = text.slice(0, -1); return text + '…'; };
    if (threeD) {
      const o = project(-1, -1, -1);
      for (let axis = 0; axis < 3; axis++) {
        const v = [-1, -1, -1]; v[axis] = 1; const p = project(...v);
        ctx.beginPath(); ctx.moveTo(...o.slice(0, 2)); ctx.lineTo(...p.slice(0, 2)); ctx.stroke(); ctx.fillStyle = '#526170'; ctx.fillText(shortLabel(axes[axis], Math.max(100, width / 3)), p[0] + 4, p[1]);
      }
    } else {
      for (let tick = 0; tick <= 4; tick++) {
        const x = 65 + tick / 4 * (width - 100), y = 40 + tick / 4 * (height - 90);
        ctx.beginPath(); ctx.moveTo(65, y); ctx.lineTo(width - 35, y); ctx.stroke();
        let yf = (height - 50 + pan[1] - y) / ((height - 90) * zoom), xf = (x - 65 - pan[0]) / ((width - 100) * zoom);
        if (wafer) {const scale=waferScale()*zoom;xf=.5+(x-(width+30)/2-pan[0])/((ranges[0][1]-ranges[0][0])*aspect*scale);yf=.5+((height-10)/2+pan[1]-y)/((ranges[1][1]-ranges[1][0])*scale);}
        if (wafer && orientation.posX === 'L') xf = 1-xf; if (wafer && orientation.posY === 'D') yf = 1-yf;
        ctx.fillStyle = '#526170'; ctx.textAlign = 'right'; ctx.fillText(fmt(ranges[1][0] + yf * (ranges[1][1] - ranges[1][0])), 57, y + 4);
        if (!categorical) {ctx.textAlign = 'center'; ctx.fillText(fmt(ranges[0][0] + xf * (ranges[0][1] - ranges[0][0])), x, height - 30);}
      }
      if (categorical) for (const value of [...new Set(active.map(p=>p.x))]) {const [x]=project(normalize(value,0),0);if(x>=65&&x<=width-35){ctx.textAlign='center';ctx.fillText(String(value),x,height-30);}}
      ctx.textAlign = 'center'; ctx.fillText(shortLabel(axes[0], width - 100), width / 2, height - 8); ctx.textAlign = 'left'; ctx.fillText(shortLabel(axes[1], width - 24), 8, 18);
    }
    // Viewport changes are rendering only; worker populations and regression fits remain unchanged.
    ctx.save(); if (!threeD && !wafer) { ctx.beginPath(); ctx.rect(65, 40, width - 100, height - 90); ctx.clip(); }
    if (!threeD && !wafer) {
      const coords = (x, y) => project(normalize(x, 0), normalize(y, 1));
      if (settings.showLimits !== false) for (let axis = 0; axis < 2; axis++) for (const bound of ['low', 'high']) {
        const value = specLimits[axis]?.[bound]; if (!Number.isFinite(value)) continue;
        const a = axis === 0 ? coords(value, ranges[1][0]) : coords(ranges[0][0], value), b = axis === 0 ? coords(value, ranges[1][1]) : coords(ranges[0][1], value);
        ctx.strokeStyle = bound === 'low' ? '#8057a6' : '#ad3f55'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(...a.slice(0, 2)); ctx.lineTo(...b.slice(0, 2)); ctx.stroke(); ctx.setLineDash([]);
      }
      if (showRegression) series.forEach((item, index) => {
        if (hidden.has(index) || !Number.isFinite(item.regression?.slope) || !Number.isFinite(item.regression?.intercept)) return;
        const [low, high] = ranges[0], a = coords(low, item.regression.intercept + item.regression.slope * low), b = coords(high, item.regression.intercept + item.regression.slope * high);
        if (![...a, ...b].every(Number.isFinite)) return;
        ctx.strokeStyle = item.color ?? COLORS[index % COLORS.length]; ctx.lineWidth = 1.6; ctx.setLineDash([7, 3]); ctx.beginPath(); ctx.moveTo(...a.slice(0, 2)); ctx.lineTo(...b.slice(0, 2)); ctx.stroke(); ctx.setLineDash([]);
      });
    }
    projected = active.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (!threeD || Number.isFinite(p.z))).map(p => ({ p, xy: project(normalize(p.x, 0), normalize(p.y, 1), normalize(p.z, 2)) }));
    const barXs = [...new Set(projected.filter(item => item.p.drawKind === 'bar').map(item => item.xy[0]))].sort((a, b) => a - b);
    let nearestBar = width - 100; for (let i = 1; i < barXs.length; i++) nearestBar = Math.min(nearestBar, barXs[i] - barXs[i - 1]);
    barWidth = Math.min(80, Math.max(1, .65 * nearestBar));
    if (threeD) projected.sort((a, b) => b.xy[2] - a.xy[2]);
    solidFaces = 0;
    if (threeD && wafer) {
      // Each die occupies 82% of one original coordinate step in both axes.
      // Projection carries the recorded physical aspect and direction, including
      // mirrored wafers. All faces share a global depth sort for occlusion.
      const faces = [], halfX = .82 / (ranges[0][1] - ranges[0][0]), halfY = .82 / (ranges[1][1] - ranges[1][0]);
      for (const item of projected) {
        const { p } = item, x = normalize(p.x, 0), y = normalize(p.y, 1), z = normalize(p.z, 2);
        const corners = [[x - halfX, y - halfY], [x + halfX, y - halfY], [x + halfX, y + halfY], [x - halfX, y + halfY]];
        const top = corners.map(([a, b]) => project(a, b, z)), bottom = corners.map(([a, b]) => project(a, b, -1));
        const add = (vertices, shade) => { const area = vertices.reduce((sum, a, index) => { const b = vertices[(index + 1) % vertices.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0); if (Math.abs(area) > .01) faces.push({ vertices, shade, color: p.color, depth: vertices.reduce((sum, vertex) => sum + vertex[2], 0) / vertices.length }); };
        add(top, 0); for (let side = 0; side < 4; side++) add([bottom[side], bottom[(side + 1) % 4], top[(side + 1) % 4], top[side]], side % 2 ? .28 : .14);
      }
      faces.sort((a, b) => b.depth - a.depth); solidFaces = faces.length;
      for (const face of faces) {
        ctx.beginPath(); face.vertices.forEach((point, index) => index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1])); ctx.closePath(); ctx.fillStyle = face.color; ctx.globalAlpha = opacity; ctx.fill();
        if (face.shade) { ctx.fillStyle = '#000000'; ctx.globalAlpha = face.shade * opacity; ctx.fill(); }
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = .3; ctx.globalAlpha = .4 * opacity; ctx.stroke();
      }
    }
    const last = new Map();
    for (const { p, xy } of projected) {
      if (threeD && wafer) continue;
      const [x, y] = xy;
      ctx.fillStyle = p.color; ctx.strokeStyle = p.color; ctx.lineWidth = 1.6; ctx.globalAlpha = opacity;
      if (['line','step'].includes(p.drawKind) && !p.box) {
        const prev = last.get(p.seriesIndex); if (prev) { ctx.beginPath(); ctx.moveTo(...prev); if(p.drawKind==='step')ctx.lineTo(x,prev[1]);ctx.lineTo(x, y); ctx.stroke(); } last.set(p.seriesIndex, [x, y]);
      } else if (p.box) {
        const at = value => project(normalize(p.x,0), normalize(value,1))[1], b = p.box;
        if ([b.q1,b.q3,b.median,b.whiskerLow,b.whiskerHigh].every(Number.isFinite)) {
          ctx.beginPath();ctx.moveTo(x,at(b.whiskerLow));ctx.lineTo(x,at(b.whiskerHigh));ctx.stroke();
          ctx.globalAlpha=.2*opacity;ctx.fillRect(x-16,at(b.q3),32,at(b.q1)-at(b.q3));ctx.globalAlpha=opacity;
          ctx.strokeRect(x-16,at(b.q3),32,at(b.q1)-at(b.q3));
          for (const v of [b.whiskerLow,b.median,b.whiskerHigh]) {ctx.beginPath();ctx.moveTo(x-16,at(v));ctx.lineTo(x+16,at(v));ctx.stroke();}
        }
      } else if (p.drawKind === 'bar') { const baseline = project(normalize(p.x, 0), normalize(0, 1)); ctx.fillRect(x - barWidth / 2, Math.min(y, baseline[1]), barWidth, Math.max(1, Math.abs(baseline[1] - y))); }
      else if (wafer) { const side = Math.max(2, Math.min(40, waferScale()*zoom*.82)); ctx.fillRect(x - side*aspect / 2, y - side / 2, side*aspect, side); }
      else { ctx.beginPath(); ctx.arc(x, y, settings.dotSize ?? 3, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    if (!active.length) { ctx.fillStyle = '#697887'; ctx.fillText(points.length ? 'All populations are hidden.' : 'No eligible values in this selection.', 65, 80); }
  };
  const updateRangeInputs = () => rangeInputs.forEach((inputs, axis) => inputs.forEach((input, index) => { input.value = String(ranges[axis][index]); }));
  const reset = () => { yaw = -.6; pitch = .55; zoom = 1; pan = [0, 0]; ranges = computeRanges(domainMode === 'full'); updateRangeInputs(); draw(); };
  bar.append(button('Reset view', reset));
  if (valueRange) bar.append(element('span', `${fmt(valueRange[0])} (blue) → ${fmt(valueRange[1])} (red)`));
  const updateLegends = () => legends.forEach(({ control, index }) => { control.setAttribute('aria-pressed', String(!hidden.has(index))); control.style.opacity = hidden.has(index) ? '.45' : '1'; });
  for (let i = 0; i < series.length; i++) { if (!series[i].label) continue; const label = button(series[i].label, () => { hidden.has(i) ? hidden.delete(i) : hidden.add(i); updateLegends(); draw(); }, 'study-legend'); label.style.setProperty('--series-color', series[i].color ?? COLORS[i % COLORS.length]); label.setAttribute('aria-pressed', 'true'); legends.push({ control: label, index: i }); bar.append(label); }
  if (series.length > 1) for (const [name, hide] of [['All', false], ['None', true]]) bar.append(button(name, () => { hidden.clear(); if (hide) series.forEach((_, index) => hidden.add(index)); updateLegends(); draw(); }));
  const options = element('details'), optionBar = element('div', undefined, 'viewer-toolbar'); options.append(element('summary', 'Plot options'), optionBar); box.append(options);
  const opacityLabel = element('label', 'Opacity'), opacityInput = element('input'); opacityInput.type = 'range'; opacityInput.min = '.1'; opacityInput.max = '1'; opacityInput.step = '.05'; opacityInput.value = '1'; opacityInput.setAttribute('aria-label', 'Plot opacity'); opacityInput.addEventListener('input', () => { opacity = opacityInput.valueAsNumber; draw(); }); opacityLabel.append(opacityInput); optionBar.append(opacityLabel);
  if (!threeD && !wafer) {
    optionBar.append(button('Auto', () => { domainMode = 'auto'; reset(); }));
    if (hasLimits) optionBar.append(button('Full', () => { domainMode = 'full'; reset(); }));
    for (let axis = 0; axis < 2; axis++) {
      const inputs = ['minimum', 'maximum'].map((bound, index) => { const label = element('label', `${axis === 0 ? 'X' : 'Y'} ${bound}`), input = element('input'); input.type = 'number'; input.step = 'any'; input.style.width = '110px'; input.value = String(ranges[axis][index]); input.setAttribute('aria-label', `Visible ${axis === 0 ? 'X' : 'Y'} ${bound}`); label.title = String(axes[axis] ?? ''); label.append(input); optionBar.append(label); return input; }); rangeInputs.push(inputs);
    }
    const applyRanges = () => {
      const requested = rangeInputs.map(inputs => inputs.map(input => input.valueAsNumber));
      if (requested.some(([low, high]) => !Number.isFinite(low) || !Number.isFinite(high) || low >= high || !Number.isFinite(high - low))) { status.textContent = 'Choose finite, increasing X and Y limits.'; return; }
      ranges = [...requested, ranges[2]]; zoom = 1; pan = [0, 0]; draw(); status.textContent = 'Viewport changed; population statistics and regression are unchanged.';
    };
    optionBar.append(button('Set visible range', applyRanges));
    for (const input of rangeInputs.flat()) input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyRanges(); } });
    if (series.some(item => Number.isFinite(item.regression?.slope))) { const label = element('label'), input = element('input'); input.type = 'checkbox'; input.checked = true; input.addEventListener('change', () => { showRegression = input.checked; draw(); }); label.append(input, document.createTextNode('Regression')); optionBar.append(label); }
  }
  const hit = e => {
    const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    let found = null, distance = 225;
    for (const point of projected) { if (!threeD && !wafer && (point.xy[0] < 65 || point.xy[0] > width - 35 || point.xy[1] < 40 || point.xy[1] > height - 50)) continue; const d = (point.xy[0] - x) ** 2 + (point.xy[1] - y) ** 2; if (d < distance) { found = point.p; distance = d; } }
    return found;
  };
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, button: e.button }; moved = false; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved ||= Math.abs(dx) + Math.abs(dy) > 2; if (threeD && drag.button === 0) { yaw += dx / 150; pitch = Math.max(-1.5, Math.min(1.5, pitch + dy / 150)); } else { pan[0] += dx; pan[1] += dy; } drag.x = e.clientX; drag.y = e.clientY; draw(); }
    else { const p = hit(e); status.textContent = p ? [p.label, `X ${fmt(p.x)}`, `Y ${fmt(p.y)}`, threeD ? `Z ${fmt(p.z)}` : '', p.value != null ? `Value ${fmt(p.value)}` : '', p.outcome ?? '', p.deviceId != null ? `Attempt ${p.deviceId}` : '', ...(p.box ? ['q1','median','q3','whiskerLow','whiskerHigh','outlierCount'].map(key => `${key} ${fmt(p.box[key])}`) : [])].filter(Boolean).join(' · ') : 'Hover a point for details.'; }
  });
  canvas.addEventListener('pointerup', e => { if (!moved) { const p = hit(e); if (p) onPick(p); } drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(.2, Math.min(12, zoom * Math.exp(-e.deltaY / 700))); draw(); }, { passive: false });
  canvas.addEventListener('dblclick', reset);
  canvas.addEventListener('keydown', e => { if (e.key === 'Home') reset(); else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); if (threeD) { yaw += e.key === 'ArrowLeft' ? -.1 : e.key === 'ArrowRight' ? .1 : 0; pitch += e.key === 'ArrowUp' ? .1 : e.key === 'ArrowDown' ? -.1 : 0; } else { pan[0] += e.key === 'ArrowLeft' ? -15 : e.key === 'ArrowRight' ? 15 : 0; pan[1] += e.key === 'ArrowUp' ? -15 : e.key === 'ArrowDown' ? 15 : 0; } draw(); } });
  const observer = new ResizeObserver(draw); observer.observe(box); draw();
  return { destroy() { closed = true; observer.disconnect(); }, exportPng() { return new Promise(resolve => canvas.toBlob(resolve, 'image/png')); }, get viewState() { return { ranges: ranges.map(range => [...range]), hidden: [...hidden], opacity, showRegression, solidFaces, barWidth, projected: projected.map(({ p, xy }) => ({ seriesIndex: p.seriesIndex, x: p.x, y: p.y, pixels: [...xy] })) }; } };
}
