// Exercise provider resource limits with a virtual SQLite cursor. The response
// budget uses a synthetic long label so no large STDF or device array is needed.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { yieldManager } from '../site/viewer-yield-manager.js';

function virtualView({ rows = 1, rowAt = () => ({}), name = 'fixture.stdf' } = {}) {
  const statements = [], id = '12345678-1234-1234-1234-123456789abc';
  const view = {
    selection: { groups: [{ name: 'Limit check', datasetIds: [id] }], attempts: 'all' },
    sources: [{ source: 0, groupId: 0, sourceIndex: 0, datasetId: id, alias: 'main', cache: { dataset: { name } } }],
    context: { progress() {}, checkCancelled() {} },
    db: { prepare(sql) {
      assert.ok(!/observations|wafer|v_tests/i.test(sql), `Unexpected non-device read: ${sql}`);
      const metadata = sql.includes('.metadata');
      assert.ok(metadata || sql.includes('FROM v_devices'), `Unexpected query: ${sql}`);
      const total = metadata ? 1 : rows;
      const statement = { sql, finalized: false, visited: 0, index: -1,
        bind() {},
        step() { assert.equal(this.finalized, false); this.index++; if (this.index >= total) return false; this.visited++; return true; },
        get() {
          if (metadata) return { json: JSON.stringify(sql.includes('subtype=10')
            ? { LOT_ID: 'L', PART_TYP: 'P', JOB_NAM: 'J', START_T: 1792368000 } : { FINISH_T: 1792368060 }) };
          return { source: 0, head: 1, site: 1, part_flags: 0, soft_bin: 1, hard_bin: 1, ...rowAt(this.index) };
        },
        finalize() { assert.equal(this.finalized, false, 'Statement finalized twice'); this.finalized = true; },
      };
      statements.push(statement); return statement;
    } },
  };
  return { view, statements };
}
function finalized(fixture) {
  assert.equal(fixture.statements.filter((statement) => /FROM v_devices/.test(statement.sql)).length, 1);
  assert.ok(fixture.statements.every((statement) => statement.finalized), 'Every metadata and device cursor must close');
}
async function rejected(fixture, expected) {
  await assert.rejects(() => yieldManager(fixture.view), (error) => {
    assert.equal(error.code, 'INVALID_REQUEST'); assert.match(error.message, expected);
    assert.match(error.message, /Select fewer sources, heads, or sites/); return true;
  });
  finalized(fixture);
}

export async function verifyYieldBounds() {
  const checks = [], sites = (index) => ({ head: 1 + Math.floor(index / 256), site: index % 256 });
  let fixture = virtualView({ rows: 4096, rowAt: sites });
  assert.equal((await yieldManager(fixture.view)).files[0].sites.length, 4096); finalized(fixture);
  fixture = virtualView({ rows: 4097, rowAt: sites });
  await rejected(fixture, /too many head and site groups/);
  assert.equal(fixture.statements.at(-1).visited, 4097);
  checks.push('site limit: 4096 buckets accepted, 4097 rejected with actionable INVALID_REQUEST and finalized cursor');

  const bins = (index) => ({ soft_bin: index, hard_bin: index });
  fixture = virtualView({ rows: 16384, rowAt: bins });
  const atLimit = await yieldManager(fixture.view);
  assert.equal(atLimit.files[0].softBins.length + atLimit.files[0].hardBins.length, 32768); finalized(fixture);
  fixture = virtualView({ rows: 16385, rowAt: bins });
  await rejected(fixture, /too many bin groups/);
  assert.equal(fixture.statements.at(-1).visited, 16385);
  checks.push('bin limit: 32768 combined buckets accepted, the next bucket rejected before completing the scan, with finalized cursor');

  fixture = virtualView({ name: '' });
  const overhead = new TextEncoder().encode(JSON.stringify(await yieldManager(fixture.view))).byteLength;
  finalized(fixture);
  const available = 4 * 1024 * 1024 - overhead;
  // Non-ASCII text distinguishes a UTF-8 transport budget from a character count.
  const name = 'é'.repeat(Math.floor(available / 2)) + (available % 2 ? 'x' : '');
  fixture = virtualView({ name });
  const exact = await yieldManager(fixture.view);
  assert.equal(new TextEncoder().encode(JSON.stringify(exact)).byteLength, 4 * 1024 * 1024); finalized(fixture);
  fixture = virtualView({ name: name + 'x' });
  await rejected(fixture, /results are too large/);
  checks.push('response limit: exactly 4 MiB UTF-8 accepted, one additional byte rejected after finalizing all cursors; no observations read');
  return checks;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) console.log(JSON.stringify(await verifyYieldBounds(), null, 2));
