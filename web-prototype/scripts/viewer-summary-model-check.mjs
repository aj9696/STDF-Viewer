import assert from 'node:assert/strict';
import { newTestSummary, loadTestSummary, testSummaryPage, summaryRows } from '../site/viewer-summary-model.js';

const summary = newTestSummary();
const tests = Array.from({length: 53}, (_, number) => ({key: String(number), number, name: `Test ${number}`, family:10, unit:'V'}));
const calls = [];
let fail = true;
const context = { seriesBy:'aggregate', includeAggregate:false, checkCancelled() {}, onProgress() {},
  async query(action, options) {
    calls.push([action,options]);
    if (action === 'tests') return {items:tests,total:53,nextOffset:null};
    if (options.tests[0] === '10' && fail) throw Object.assign(new Error('cancelled'), {code:'CANCELLED'});
    return {items:options.tests.map(key => ({test:tests[Number(key)],series:[{key:'s',label:'Group A',stats:{total:10,count:10,pass:8,fail:2,mean:53-Number(key),cpk: Number(key) === 1 ? null : Number(key)}}]}))};
  } };
await assert.rejects(loadTestSummary(summary,context), {code:'CANCELLED'});
assert.equal(summary.done,10); assert.equal(summary.rows.length,10); assert.equal(summary.paused,true); assert.equal(summary.complete,false);
fail=false;
await loadTestSummary(summary,context);
assert.equal(summary.complete,true); assert.equal(summary.done,53); assert.equal(summary.rows.length,53);
assert.equal(calls.filter(([action]) => action === 'tests').length,1);
assert.equal(calls.filter(([action,options]) => action === 'testSummaries' && options.tests[0] === '0').length,1);
summary.sort='mean';
let page=testSummaryPage(summary);
assert.equal(page.items[0].test.number,52); assert.equal(page.items.length,50); assert.equal(page.nextOffset,50);
summary.offset=50; page=testSummaryPage(summary); assert.deepEqual(page.items.map(row => row.test.number),[2,1,0]);
summary.sort='cpk'; summary.direction='desc'; summary.offset=50;
assert.equal(testSummaryPage(summary).items.at(-1).test.number,1);
summary.direction='asc'; assert.equal(testSummaryPage(summary).items.at(-1).test.number,1);
summary.query='Test 52'; assert.equal(testSummaryPage(summary).items[0].test.number,52); assert.equal(testSummaryPage(summary).offset,0);
const empty=summaryRows({test:tests[0],series:[]}); assert.equal(empty[0].total,0); assert.equal(empty[0].testYield,null);
summary.rows=[{...summary.rows[0],test:{...tests[0],family:20}}, {...summary.rows[1],cpk:2}];
summary.sort='cpk'; summary.query=''; summary.offset=0;
assert.equal(testSummaryPage(summary).items.at(-1).test.family,20);
console.log('PASS: full-result numeric sort, nulls last, search, paging, partial cancellation/resume without duplicates, empty/FTR rows.');
