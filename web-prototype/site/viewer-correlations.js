import { boundedInteger, deviceOutcome, invalid } from './viewer-model.js';
import { iterateJoinedDevices, studyTests, populationPolicy, STUDY_METHOD_VERSION } from './viewer-population.js';

export class PairMoments {
  constructor() { this.count = 0; this.meanX = 0; this.meanY = 0; this.xx = 0; this.xy = 0; this.yy = 0; }
  add(x, y) {
    this.count++;
    const dx = x - this.meanX, dy = y - this.meanY;
    this.meanX += dx / this.count; this.meanY += dy / this.count;
    this.xx += dx * (x - this.meanX); this.xy += dx * (y - this.meanY); this.yy += dy * (y - this.meanY);
  }
  finish() {
    const reason = this.count < 2 ? 'At least two complete devices are required.' : this.xx <= 0 || this.yy <= 0 ? 'An axis has zero spread.' : null;
    const r = reason ? null : Math.max(-1, Math.min(1, this.xy / Math.sqrt(this.xx * this.yy)));
    const slope = reason ? null : this.xy / this.xx;
    return { count: this.count, r, r2: r === null ? null : r * r, slope, intercept: slope === null ? null : this.meanY - slope * this.meanX,
      meanX: this.count ? this.meanX : null, meanY: this.count ? this.meanY : null, reason };
  }
}

/** Stable seeded reservoir: statistics always cover all complete devices. */
export class PointSample {
  constructor(limit) { this.limit = limit; this.count = 0; this.state = 0x6d2b79f5; this.items = []; }
  add(point) {
    this.count++;
    if (this.items.length < this.limit) { this.items.push(point); return; }
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    const index = Math.floor(this.state / 4294967296 * this.count);
    if (index < this.limit) this.items[index] = point;
  }
}

export async function correlateTests(view, options) {
  const tests = studyTests(options.tests, 2, 3), maxPoints = boundedInteger(options.maxPoints ?? 10000, 1, 20000, 'Displayed points');
  const seriesBy = options.seriesBy ?? 'aggregate';
  if (!['aggregate', 'site'].includes(seriesBy)) invalid('Choose aggregate or site series.');
  const population = { devices: 0, complete: 0, missing: 0, invalid: 0 }, series = new Map(), sample = new PointSample(maxPoints);
  for await (const device of iterateJoinedDevices(view, { tests: tests.map((test) => test.key) })) {
    population.devices++;
    const results = tests.map((test) => device.results[test.key]);
    if (results.some((row) => row === null)) { population.missing++; continue; }
    if (results.some((row) => !row.eligible)) { population.invalid++; continue; }
    population.complete++;
    const site = seriesBy === 'site' ? device.site : null, key = JSON.stringify([device.group_id, device.head, site]);
    if (!series.has(key)) {
      if (series.size >= 64) invalid('Select fewer heads or sites for the correlation.');
      series.set(key, { key, group: device.group_id, head: device.head, site, label: `${view.selection.groups[device.group_id].name} · Head ${device.head}${site === null ? '' : ` · Site ${site}`}`, limits:tests.map(()=>({low:null,high:null,set:false,varying:false})), pairs: { xy: new PairMoments(), ...(tests.length === 3 ? { xz: new PairMoments(), yz: new PairMoments() } : {}) } });
    }
    const values = results.map((row) => row.value), item = series.get(key);
    results.forEach((row,index)=>{const limits=item.limits[index];if(!limits.set){limits.low=row.low;limits.high=row.high;limits.set=true;}else if(limits.low!==row.low||limits.high!==row.high)limits.varying=true;});
    item.pairs.xy.add(values[0], values[1]);
    if (values.length === 3) { item.pairs.xz.add(values[0], values[2]); item.pairs.yz.add(values[1], values[2]); }
    sample.add({ key, datasetId: device.dataset_id, deviceId: device.id, group: device.group_id, head: device.head, site: device.site,
      x: values[0], y: values[1], ...(values.length === 3 ? { z: values[2] } : {}), outcome: deviceOutcome(device.part_flags),
      observations: results.map((row) => ({ seq: row.seq, ordinal: row.ordinal })) });
  }
  return { methodVersion: STUDY_METHOD_VERSION, populationPolicy, tests, population, sampled: population.complete > maxPoints,
    displayed: sample.items.length, series: [...series.values()].map(({ pairs, ...item }) => ({ ...item,
      count: pairs.xy.count, regression: pairs.xy.finish(), correlations: Object.fromEntries(Object.entries(pairs).map(([key, moments]) => [key, moments.finish()])),
      points: sample.items.filter((point) => point.key === item.key) })), warnings: population.complete > maxPoints ? [`Showing ${maxPoints} deterministically sampled devices; correlations use all ${population.complete} complete devices.`] : [] };
}
