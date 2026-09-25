import { libraryError } from './dataset-schema.js';

export const VIEWER_VERSION = 1;
export const MAX_VIEWER_SOURCES = 8;
export const FAMILY_NAMES = { 10: 'PTR', 15: 'MPR', 20: 'FTR' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function invalid(message) { throw libraryError('INVALID_REQUEST', message); }
export function datasetId(value) {
  if (typeof value !== 'string' || !uuid.test(value)) invalid('Choose a saved dataset.');
  return value;
}
export function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(`${label} must be ${minimum}–${maximum}.`);
  return value;
}
export function textOption(value, maximum = 128) {
  if (typeof value !== 'string' || value.length > maximum) invalid(`Text must be at most ${maximum} characters.`);
  return value;
}
function byteList(values, label) {
  if (values == null) return null;
  if (!Array.isArray(values) || !values.length || values.length > 256) invalid(`Select at least one ${label}, or all.`);
  return [...new Set(values.map((v) => boundedInteger(v, 0, 255, label)))].sort((a, b) => a - b);
}
export function validateSelection(input) {
  if (!input || !Array.isArray(input.groups) || !input.groups.length || input.groups.length > 8) invalid('Choose one to eight comparison groups.');
  const groups = input.groups.map((group, index) => {
    if (!group || !Array.isArray(group.datasetIds) || !group.datasetIds.length || group.datasetIds.length > MAX_VIEWER_SOURCES) invalid('Each group needs one to eight saved files.');
    const datasetIds = group.datasetIds.map(datasetId);
    if (new Set(datasetIds).size !== datasetIds.length) invalid('A source may appear only once in each group.');
    return { name: textOption(group.name ?? `Group ${index + 1}`, 120), datasetIds };
  });
  if (new Set(groups.flatMap((g) => g.datasetIds)).size > MAX_VIEWER_SOURCES) invalid('A workspace supports eight distinct source files.');
  const attempts = input.attempts ?? 'current';
  if (!['current', 'all'].includes(attempts)) invalid('Choose current or all attempts.');
  return { groups, heads: byteList(input.heads, 'head'), sites: byteList(input.sites, 'site'), attempts };
}
export function testKey(row) { return JSON.stringify([row.family, row.number, row.name, row.unit, row.channel, row.identity ?? 'resolved']); }
export function parseTestKey(key) {
  if (typeof key !== 'string' || key.length > 2048) invalid('Choose a test from the catalogue.');
  let fields;
  try { fields = JSON.parse(key); } catch { invalid('Invalid test identity.'); }
  if (!Array.isArray(fields) || fields.length !== 6 || ![10, 15, 20].includes(fields[0])) invalid('Invalid test identity.');
  const [family, number, name, unit, channel, identity] = fields;
  boundedInteger(number, 0, 4294967295, 'Test number');
  textOption(name, 1024); textOption(unit, 255); textOption(channel, 32);
  textOption(identity, 128);
  if (identity !== 'resolved' && !/^[0-9a-f-]{36}:\d+:unresolved-(omitted|ambiguous)$/i.test(identity)) invalid('Invalid unresolved test identity.');
  if (family === 15 ? !/^(pmr|result):\d+$/.test(channel) : channel !== '') invalid('Invalid test channel.');
  return { family, number, name, unit, channel, identity };
}
export function deviceOutcome(flags) {
  if (flags == null || flags & 0x14) return 'unknown';
  return flags & 8 ? 'fail' : 'pass';
}
export function testOutcome(flags) {
  if (flags == null || flags & 0x50) return 'unknown';
  return flags & 0x80 ? 'fail' : 'pass';
}
export function numericEligible(row, family) {
  return Number.isFinite(row.value) && !(row.test_flags & 0x3f) &&
    (family === 20 || !(row.parm_flags & 7));
}

/** Stable population moments; observations flagged as failed remain eligible. */
export class PopulationStats {
  constructor(family = 10) {
    this.family = family; this.total = 0; this.count = 0; this.pass = 0; this.fail = 0; this.unknown = 0;
    this.mean = 0; this.m2 = 0; this.min = Infinity; this.max = -Infinity;
    this.lsl = null; this.usl = null; this.changingLimits = false;
    this.lowSpec = null; this.highSpec = null; this.changingSpecs = false;
  }
  add(row) {
    this.total++; this[testOutcome(row.test_flags)]++;
    if (!numericEligible(row, this.family)) return false;
    this.count++;
    const delta = row.value - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (row.value - this.mean);
    this.min = Math.min(this.min, row.value); this.max = Math.max(this.max, row.value);
    const low = Number.isFinite(row.low) ? row.low : null, high = Number.isFinite(row.high) ? row.high : null;
    if (this.count === 1) { this.lsl = low; this.usl = high; }
    else if (this.lsl !== low || this.usl !== high) this.changingLimits = true;
    const lowSpec = Number.isFinite(row.lowSpec) ? row.lowSpec : null, highSpec = Number.isFinite(row.highSpec) ? row.highSpec : null;
    if (this.count === 1) { this.lowSpec = lowSpec; this.highSpec = highSpec; }
    else if (this.lowSpec !== lowSpec || this.highSpec !== highSpec) this.changingSpecs = true;
    return true;
  }
  finish(median = null) {
    const stdev = this.count ? Math.sqrt(Math.max(0, this.m2 / this.count)) : null;
    const reason = this.family === 20 ? 'Functional test flags have no capability limits.'
      : !this.count ? 'No valid numeric measurements.'
        : this.changingLimits ? 'Limits change within this population.'
          : this.lsl === null || this.usl === null ? 'Both limits are required.'
            : this.lsl >= this.usl ? 'Limits are not strictly ordered.'
              : !stdev ? 'Population has zero spread.' : null;
    const cpk = reason ? null : Math.min(this.usl - this.mean, this.mean - this.lsl) / (3 * stdev);
    return { total: this.total, count: this.count, excluded: this.total - this.count,
      pass: this.pass, fail: this.fail, unknown: this.unknown,
      mean: this.count ? this.mean : null, median, stdev,
      min: this.count ? this.min : null, max: this.count ? this.max : null,
      lsl: this.changingLimits ? null : this.lsl, usl: this.changingLimits ? null : this.usl,
      lowSpec: this.changingSpecs ? null : this.lowSpec, highSpec: this.changingSpecs ? null : this.highSpec, changingSpecs: this.changingSpecs,
      changingLimits: this.changingLimits, cpk: Number.isFinite(cpk) ? cpk : null, cpkReason: reason };
  }
}

export function histogramEdges(low, high, count) {
  boundedInteger(count, 1, 1000, 'Histogram bins');
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [];
  if (low === high) {
    const padding = Math.max(Math.abs(low) * 0.01, 0.5);
    low -= padding; high += padding;
  }
  return Array.from({ length: count }, (_, i) => ({ low: low + (high - low) * (i / count),
    high: i + 1 === count ? high : low + (high - low) * ((i + 1) / count), count: 0, last: i + 1 === count }));
}
export function addToHistogram(bins, value) {
  if (!bins.length || !Number.isFinite(value) || value < bins[0].low || value > bins.at(-1).high) return;
  // Compare the same stored edges used by SQL drilldowns. Recomputing an index
  // with division can round an exact interior-edge value into the prior bin.
  let low = 0, high = bins.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bins[middle].low <= value) low = middle + 1; else high = middle;
  }
  bins[Math.max(0, low - 1)].count++;
}

/** Hierarchical buckets retain first/last/min/max with O(display budget) memory. */
export class TrendSampler {
  constructor(maxBuckets = 512) { this.maxBuckets = maxBuckets; this.width = 1; this.buckets = []; this.current = null; this.total = 0; }
  add(point) {
    this.total++;
    if (!this.current) this.current = { first: point, last: point, min: point, max: point, n: 0 };
    const bucket = this.current;
    bucket.last = point; bucket.n++;
    if (point.value < bucket.min.value) bucket.min = point;
    if (point.value > bucket.max.value) bucket.max = point;
    if (bucket.n === this.width) { this.buckets.push(bucket); this.current = null; }
    if (this.buckets.length === this.maxBuckets * 2) {
      const merged = [];
      for (let i = 0; i < this.buckets.length; i += 2) {
        const a = this.buckets[i], b = this.buckets[i + 1];
        merged.push({ first: a.first, last: b.last, min: a.min.value <= b.min.value ? a.min : b.min,
          max: a.max.value >= b.max.value ? a.max : b.max, n: a.n + b.n });
      }
      this.buckets = merged; this.width *= 2;
    }
  }
  finish() {
    const buckets = this.current ? [...this.buckets, this.current] : this.buckets;
    return buckets.flatMap((b) => [...new Set([b.first, b.min, b.max, b.last])].sort((a, c) => a.x - c.x || a.seq - c.seq));
  }
}
