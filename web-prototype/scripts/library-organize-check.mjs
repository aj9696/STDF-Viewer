import assert from 'node:assert/strict';
import { organizeDatasets, groupDatasets, selectLibraryFiles, testDate } from '../site/library-organize.js';
const source = (id, metadata, created_at = '2026-10-19') => ({ id, name: `${id}.stdf`, relative_path: `${id}.stdf`, status: 'ready', created_at, source_bytes: 100, test_metadata: metadata });
const rows = [source('missing', {}), source('old', { startTime: 1704067200, partNumber: 'P2', lotId: 'L2' }),
  source('new', { startTime: 1735689600, partNumber: 'P1', lotId: 'L1', program: 'probe' }, '2020-01-01')];
assert.deepEqual(organizeDatasets(rows).map(row => row.id), ['new', 'old', 'missing']);
assert.equal(testDate(rows[0]), null);
assert.equal(testDate(rows[1], true), '2024-01-01 00:00:00 UTC');
assert.deepEqual(organizeDatasets(rows, { sort: 'test-oldest' }).map(row => row.id), ['old', 'new', 'missing']);
assert.deepEqual(organizeDatasets(rows, { query: 'P1 probe 2025' }).map(row => row.id), ['new']);
assert.equal(groupDatasets(rows, 'part').size, 3);
const selected = selectLibraryFiles(new Set(['new']), ['old'], rows);
assert.deepEqual([...selected], ['new', 'old']);
assert.deepEqual([...selected], ['new', 'old'], 'Filtering and grouping do not mutate selection');
const nine = Array.from({ length: 9 }, (_, index) => source(String(index), {}));
assert.throws(() => selectLibraryFiles(new Set(), nine.map(row => row.id), nine), /up to 8/);
assert.throws(() => selectLibraryFiles(new Set(), ['bad'], [{ ...source('bad', {}), status: 'missing' }]), /ready/);
assert.equal(selected.size, 2);
console.log('Library organization: date provenance, full-inventory search/group/sort, atomic eight-file selection passed.');
