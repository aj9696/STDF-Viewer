import assert from 'node:assert/strict';
import { PopulationStats, TrendSampler, histogramEdges, addToHistogram, deviceOutcome,
  testOutcome, validateSelection, parseTestKey } from '../site/viewer-model.js';

const stats = new PopulationStats();
for (const value of [1, 2, 3, 4]) stats.add({ value, low: 0, high: 5, test_flags: value === 4 ? 128 : 0, parm_flags: 0 });
stats.add({ value: 100, low: 0, high: 5, test_flags: 2, parm_flags: 0 });
stats.add({ value: null, low: 0, high: 5, test_flags: 64, parm_flags: 0 });
const result = stats.finish(2.5);
assert.equal(result.total, 6); assert.equal(result.count, 4); assert.equal(result.excluded, 2);
assert.equal(result.mean, 2.5); assert.equal(result.stdev, Math.sqrt(1.25));
assert.equal(result.cpk, 2.5 / (3 * Math.sqrt(1.25))); assert.equal(result.fail, 1); assert.equal(result.unknown, 1);
const constant = new PopulationStats();
constant.add({ value: 7, low: 0, high: 5, test_flags: 128, parm_flags: 0 });
assert.equal(constant.finish().cpk, null); assert.match(constant.finish().cpkReason, /zero spread/);
stats.add({ value: 2, low: null, high: 5, test_flags: 0, parm_flags: 0 });
assert.equal(stats.finish().cpk, null); assert.equal(stats.finish().changingLimits, true);
const specs = new PopulationStats();
for (const value of [1, 2]) specs.add({ value, low: 0, high: 3, lowSpec: -1, highSpec: 4, test_flags: 0, parm_flags: 0 });
assert.equal(specs.finish().lowSpec, -1); assert.equal(specs.finish().highSpec, 4);
specs.add({ value: 3, low: 0, high: 3, lowSpec: 0, highSpec: 4, test_flags: 0, parm_flags: 0 });
assert.equal(specs.finish().lowSpec, null); assert.equal(specs.finish().highSpec, null); assert.equal(specs.finish().changingSpecs, true);
const bins = histogramEdges(0, 3, 3);
for (const value of [0, 0.5, 1, 2, 3, NaN, -1, 4]) addToHistogram(bins, value);
assert.deepEqual(bins.map((b) => b.count), [2, 1, 2]);
const roundedEdges = histogramEdges(-20, 55, 50);
addToHistogram(roundedEdges, 23.5); addToHistogram(roundedEdges, 55);
assert.equal(roundedEdges[28].count, 0); assert.equal(roundedEdges[29].count, 1); assert.equal(roundedEdges[49].count, 1);
for (let i = 1; i < roundedEdges.length; i++) {
  const before = roundedEdges[i].count; addToHistogram(roundedEdges, roundedEdges[i].low); assert.equal(roundedEdges[i].count, before + 1);
}
const same = histogramEdges(1, 1, 30); addToHistogram(same, 1);
assert.equal(same.reduce((n, b) => n + b.count, 0), 1);
assert.equal(deviceOutcome(16), 'unknown'); assert.equal(deviceOutcome(4), 'unknown');
assert.equal(deviceOutcome(8), 'fail'); assert.equal(deviceOutcome(1), 'pass');
assert.equal(testOutcome(64 | 128), 'unknown'); assert.equal(testOutcome(16), 'unknown');
const sampler = new TrendSampler(32);
for (let x = 1; x <= 1000000; x++) sampler.add({ x, seq: x, value: x === 543210 ? -100 : x === 123456 ? 100 : 1 });
const points = sampler.finish();
assert(points.length <= 256); assert.equal(points[0].x, 1); assert.equal(points.at(-1).x, 1000000);
assert(points.some((p) => p.value === -100)); assert(points.some((p) => p.value === 100));
assert.throws(() => validateSelection({ groups: [] }), /groups/);
assert.throws(() => parseTestKey('[15,1,"x","V","","resolved"]'), /channel/);
console.log('Viewer model: independent numerical, endpoint, flag, constant-limit and million-point reduction checks passed.');
