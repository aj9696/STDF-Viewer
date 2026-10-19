import assert from 'node:assert/strict';
import { metadataFromMir, readHeaderMetadata, hydrateDatasetMetadata } from '../site/library-metadata.js';

const expected = { startTime: 1792324800, partNumber: 'A-100', lotId: 'LOT-01', sublotId: 'SUB-2', program: 'FT',
  revision: 'R3', tester: 'BENCH-1', status: 'recorded', warning: null };
assert.deepEqual(metadataFromMir({ START_T: 1792324800, PART_TYP: ' A-100 ', LOT_ID: 'LOT-01', SBLOT_ID: 'SUB-2',
  JOB_NAM: 'FT', JOB_REV: 'R3', NODE_NAM: 'BENCH-1', TSTR_TYP: 'FALLBACK' }), expected);
for (const START_T of [undefined, null, 0, -1, 4294967296, '2000', 1.5]) assert.equal(metadataFromMir({ START_T }).startTime, null);
assert.equal(metadataFromMir({ START_T: 4294967295 }).startTime, 4294967295);
assert.equal(metadataFromMir({ NODE_NAM: '', TSTR_TYP: 'FALLBACK' }).tester, 'FALLBACK');
assert.equal(metadataFromMir({ PART_TYP: '<script>data</script>' }).partNumber, '<script>data</script>');
assert.equal(metadataFromMir({ LOT_ID: {} }).lotId, '');
assert.equal(metadataFromMir({ LOT_ID: 'x'.repeat(999) }).lotId.length, 255);
assert.equal(metadataFromMir([]).status, 'unavailable');

let calls = 0;
const context = { checkCancelled() {} };
const db = (rows) => ({ selectObjects(sql, [after, maximum]) {
  calls++; assert.match(sql, /FROM records WHERE seq>\? AND seq<=\? ORDER BY seq LIMIT 64/);
  assert.doesNotMatch(sql, /FROM (observations|measurements|devices)/);
  return rows.filter((row) => row.seq > after && row.seq <= maximum).slice(0, 64);
} });
const header = { seq: 2, type: 1, subtype: 10, device_id: null, header: JSON.stringify({ START_T: 2000, PART_TYP: 'A' }) };
assert.equal((await readHeaderMetadata(db([header]), context)).partNumber, 'A');
calls = 0;
const noHeader = [{ seq: 1, type: 0, subtype: 10, device_id: null }, { seq: 2, type: 5, subtype: 10, device_id: 2 }];
for (let seq = 3; seq < 10000; seq++) noHeader.push({ seq, type: 15, subtype: 10, device_id: 2 });
assert.equal((await readHeaderMetadata(db(noHeader), context)).status, 'not-recorded');
assert.equal(calls, 1, 'A missing MIR stops at the first device without a data scan.');
calls = 0;
const prefix = Array.from({ length: 5000 }, (_, i) => ({ seq: i + 1, type: 50, subtype: 30, device_id: null }));
assert.match((await readHeaderMetadata(db(prefix), context)).warning, /4,096/);
assert.equal(calls, 64);
calls = 0;
await assert.rejects(readHeaderMetadata(db(prefix), { checkCancelled() { if (calls === 2) throw Object.assign(new Error('cancel'), { code: 'CANCELLED' }); } }), { code: 'CANCELLED' });
assert.equal(calls, 2);
assert.equal((await readHeaderMetadata(db([{ ...header, header: '{' }]), context)).status, 'unavailable');
assert.equal((await readHeaderMetadata(db([]), context)).status, 'not-recorded');
let closed = 0;
const fakeStore = { headerMetadataCache: { root: { async getFileHandle() { throw new Error('cache write denied'); } }, entries: new Map() },
  async access() { return { db: { ...db([header]), close() { closed++; } } }; }, get() { return { status: 'ready' }; } };
const item = { id: '00000000-0000-0000-0000-000000000001', source_hash: 'a'.repeat(64), parser_version: 'retained-v1', schema_version: 1, source_bytes: 100, status: 'ready' };
const hydrated = await hydrateDatasetMetadata(fakeStore, { items: [{ ...item }], nextOffset: null }, context);
assert.equal(hydrated.items[0].test_metadata.partNumber, 'A'); assert.equal(closed, 1);
assert.equal(fakeStore.headerMetadataCache.entries.size, 1);
fakeStore.access = async () => { throw new Error('Cache hit unexpectedly accessed the dataset'); };
assert.equal((await hydrateDatasetMetadata(fakeStore, { items: [{ ...item }] }, context)).items[0].test_metadata.partNumber, 'A');
console.log('Library metadata: normalization, record bounds, early stop, invalid header, cancellation, cache failure passed.');
