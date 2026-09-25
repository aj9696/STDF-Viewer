import assert from 'node:assert/strict';
import { float32, hex, declarationFields, recordedText } from '../site/explorer-view.js';

// IEEE-754 reference bit patterns, independent of SQLite numeric conversion.
for (const [bits, expected] of [[0, '0'], [0x80000000, '-0'], [0x7fc01234, 'NaN'],
  [0x7f800000, 'Infinity'], [0xff800000, '-Infinity'], [0x3fa00000, '1.25'],
  [0x3dcccccd, '0.10000000149011612'], [1, '1.401298464324817e-45']]) {
  assert.equal(float32(bits), expected);
}
for (const bad of [null, undefined, -1, 2 ** 32, 1.5, '0']) assert.equal(float32(bad), 'Invalid recorded bits');
assert.equal(hex(128), '0x80');
assert.equal(hex(0x7fc01234, 8), '0x7FC01234');
assert.equal(recordedText(null), 'Not recorded');
assert.equal(recordedText(''), '(empty)');

const omitted = declarationFields(JSON.stringify({ PRESENT_FIELDS: [] }));
assert.deepEqual(omitted.values, Array(8).fill('Not recorded'));
const metadata = { PRESENT_FIELDS: ['TEST_TXT', 'UNITS', 'LO_LIMIT', 'HI_LIMIT', 'RES_SCAL', 'OPT_FLAG'],
  TEST_TXT: '', UNITS: 'V', LO_LIMIT: null, LO_LIMIT_BITS: 0x7f800000,
  HI_LIMIT: 0, HI_LIMIT_BITS: 0x80000000, RES_SCAL: -3, OPT_FLAG: [128] };
assert.deepEqual(declarationFields(JSON.stringify(metadata)).values,
  ['(empty)', 'V', 'Infinity', '-0', '-3', 'Not recorded', 'Not recorded', '0x80']);
for (const value of ['{', 'null', '[]', '{}', '{"PRESENT_FIELDS": "TEST_TXT"}',
  '{"PRESENT_FIELDS": [null]}', JSON.stringify({ ...metadata, OPT_FLAG: 128 }),
  '{"PRESENT_FIELDS": [["TEST_TXT"]], "TEST_TXT": "present"}',
  '{"PRESENT_FIELDS": ["FUTURE_FIELD"]}', '{"PRESENT_FIELDS": ["ALARM_ID"], "ALARM_ID": []}',
  JSON.stringify({ ...metadata, LO_LIMIT_BITS: null }), JSON.stringify({ ...metadata, TEST_TXT: null })]) {
  assert.match(declarationFields(value).error, /Metadata unavailable/);
}
console.log('Explorer formatting passed: exact float bits, omission/empty distinction, raw scales/flags, malformed metadata.');
