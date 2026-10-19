import assert from 'node:assert/strict';
import { buildYieldLots, createYieldViewState, filteredYieldLots, sortedYieldLots, yieldTrendPoints, lotDeviceOptions, recordedTime } from '../site/viewer-yield-model.js';

const file = (datasetId, extra = {}) => ({
  key: JSON.stringify(['g1', datasetId]), group: 'g1', groupName: 'Production', datasetId, sourceName: `${datasetId}.stdf`,
  lotId: 'LOT-7', sublotId: '', product: 'Regulator', program: 'Final', revision: 'R3', flow: 'FT', stage: '1',
  startTime: 1735689600, finishTime: null, total: 10, passed: 6, failed: 3, unknown: 1,
  sites: [{ head: 1, site: 0, total: 10, passed: 6, failed: 3, unknown: 1 }],
  softBins: [{ number: 1, total: 6, passed: 6, failed: 0, unknown: 0 }, { number: 5, total: 2, passed: 0, failed: 2, unknown: 0 }, { number: 65535, total: 2, passed: 0, failed: 1, unknown: 1 }],
  hardBins: [], ...extra,
});
const files = [file('a'), file('b', { startTime: 1735776000 }),
  file('c', { group: 'g2', groupName: 'Comparison' }), file('d', { product: 'Switch' }),
  file('e', { revision: 'R4' }), file('f', { sublotId: '2' }), file('g', { flow: 'WS' }),
  file('h', { stage: '2' }), file('i', { program: 'Probe' }),
  file('j', { lotId: '', startTime: null }), file('k', { lotId: '', startTime: 0 }),
  file('l', { lotId: 'Unknown outcomes', passed: 0, failed: 0, unknown: 10 })];
const lots = buildYieldLots(files), combined = lots.find((row) => row.files.length === 2);
assert.equal(lots.length, 11);
assert.deepEqual([combined.total, combined.passed, combined.failed, combined.unknown], [20, 12, 6, 2]);
assert.equal(combined.yield, 100 * 12 / 18);
assert.deepEqual(combined.datasetIds, ['a', 'b']);
assert.equal(combined.startTime, 1735689600);
assert.equal(combined.sites[0].total, 20);
assert.equal(combined.softBins.find((bin) => bin.number === 65535).failed, 2);
assert.equal(combined.softBins.reduce((sum, bin) => sum + bin.failed, 0), combined.failed);
assert.equal(lots.filter((row) => !row.lotId).length, 2);
const state = createYieldViewState();
state.query = 'SWITCH'; assert.equal(filteredYieldLots(lots, state).length, 1);
state.query = ''; state.group = JSON.stringify('g2'); assert.equal(filteredYieldLots(lots, state).length, 1);
state.group = ''; state.product = JSON.stringify('Switch'); assert.equal(filteredYieldLots(lots, state).length, 1);
for (const direction of ['asc', 'desc']) assert.equal(sortedYieldLots(lots, { sort: 'yield', direction }).at(-1).lotId, 'Unknown outcomes');
const points = yieldTrendPoints(lots);
assert.equal(points.length, 9); assert.equal(points.at(-1).datasetId, 'b');
assert(points.every((point) => point.time > 0 && point.yield != null));
assert.equal(recordedTime(-1), null); assert.equal(recordedTime(Infinity), null); assert.equal(recordedTime('1735689600'), null);
assert.deepEqual(lotDeviceOptions(combined, 'fail', { bin: { kind: 'soft', number: 65535 } }),
  { group: 'g1', datasetIds: ['a', 'b'], outcome: 'fail', bin: { kind: 'soft', number: 65535 } });
assert.deepEqual(buildYieldLots([]), []);
console.log('PASS: exact lot identity, independent groups, missing lot isolation, counts and missing bins, scoped drill-down, search/sort, UTC chronology and missing dates.');
