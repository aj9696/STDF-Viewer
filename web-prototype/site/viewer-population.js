import { iterateReportDevices } from './viewer-tables.js';
import { parseTestKey, numericEligible, testOutcome, invalid } from './viewer-model.js';
import { retiredExpression } from './viewer-context.js';

export const STUDY_METHOD_VERSION = 'open-studies-v1';
export const populationPolicy = 'Final recorded execution per test and device attempt; validity assessed after selection; current/all attempts and head/site scope preserved.';

export function studyTests(keys, minimum = 1, maximum = 12) {
  if (!Array.isArray(keys) || keys.length < minimum || keys.length > maximum || new Set(keys).size !== keys.length) invalid(`Choose ${minimum}–${maximum} distinct tests.`);
  return keys.map((key) => {
    const test = parseTestKey(key);
    if (test.family === 20) invalid('This study requires numeric PTR or MPR tests.');
    return { ...test, key };
  });
}

export function sourceTest(view, source, test) {
  if (test.identity !== 'resolved' && !test.identity.startsWith(`${source.datasetId}:`)) return null;
  const identity = test.identity === 'resolved' ? 'resolved' : test.identity.split(':').at(-1);
  return view.db.selectValue(`SELECT id FROM ${source.alias}.tests WHERE family=? AND number=? AND name=? AND identity=?`, [test.family, test.number, test.name, identity]) ?? null;
}

export async function checkpoint(view, rows, phase = 'viewer-study') {
  view.context.progress({ phase, rows });
  await new Promise((resolve) => setTimeout(resolve, 0));
  view.context.checkCancelled();
}

/** Bounded pages, indexed DUT joins. Repeats never multiply axis combinations. */
export async function* iterateJoinedDevices(view, { tests, sourceFilter = null }) {
  const parsed = studyTests(tests), testIds = new Map();
  for (const source of view.sources) testIds.set(source.source, parsed.map((test) => sourceTest(view, source, test)));
  let page = [], sourceId = null, visited = 0;
  const attach = async (items) => {
    if (!items.length) return;
    const source = view.sources.find((entry) => entry.source === items[0].source), lookup = new Map(items.map((item) => [item.id, item]));
    for (const item of items) { item.results = {}; item.values = {}; for (const test of parsed) item.results[test.key] = null; }
    for (const [index, test] of parsed.entries()) {
      const id = testIds.get(source.source)[index]; if (!id) continue;
      const statement = view.db.prepare(`SELECT o.device_id,o.seq,o.ordinal,o.value,o.low,o.high,o.test_flags,o.parm_flags FROM ${source.alias}.observations o INDEXED BY observations_device WHERE o.test_id=? AND o.unit=? AND o.channel=? AND o.device_id IN(${items.map(() => '?').join(',')})`);
      try {
        statement.bind([id, test.unit, test.channel, ...items.map((item) => item.id)]);
        while (statement.step()) {
          const row = statement.get({}), item = lookup.get(row.device_id), old = item.results[test.key];
          if (!old || row.seq > old.seq || row.seq === old.seq && row.ordinal > old.ordinal) item.results[test.key] = row;
          if (++visited % 4096 === 0) await checkpoint(view, visited);
        }
      } finally { statement.finalize(); }
    }
    for (const item of items) for (const test of parsed) {
      const row = item.results[test.key];
      if (row) { row.eligible = numericEligible(row, test.family); row.outcome = testOutcome(row.test_flags); }
      item.values[test.key] = row?.eligible ? row.value : null;
    }
  };
  for await (const device of iterateReportDevices(view, { sourceFilter })) {
    if (page.length && (page.length >= 100 || device.source !== sourceId)) {
      await attach(page); for (const item of page) yield item; page = [];
    }
    page.push(device); sourceId = device.source;
  }
  await attach(page); for (const item of page) yield item;
}

/** Full observation population; at most one sorted cursor row per source. */
export async function scanStudyObservations(view, key, callback, { order = 'value', passingOnly = false, finalOnly = false, distanceFrom = null, sourceFilter = null } = {}) {
  const [test] = studyTests([key]), cursors = [];
  if (!['value', 'seq'].includes(order)) invalid('Invalid observation order.');
  try {
    for (const source of view.sources) {
      if (sourceFilter && !sourceFilter(source)) continue;
      const id = sourceTest(view, source, test); if (!id) continue;
      const where = ['o.test_id=?', 'o.unit=?', 'o.channel=?', 'o.value IS NOT NULL', '(o.test_flags&63)=0', '(o.parm_flags&7)=0'], bind = [id, test.unit, test.channel];
      if (view.selection.attempts === 'current') where.push(`NOT ${retiredExpression(view, source)}`);
      for (const [key, column] of [['heads', 'head'], ['sites', 'site']]) if (view.selection[key]) {
        where.push(`d.${column} IN(${view.selection[key].map(() => '?').join(',')})`); bind.push(...view.selection[key]);
      }
      if (passingOnly) where.push('(o.test_flags&208)=0', '(d.part_flags&28)=0');
      if (finalOnly) where.push(`NOT EXISTS(SELECT 1 FROM ${source.alias}.observations later INDEXED BY observations_device WHERE later.device_id=o.device_id AND later.test_id=o.test_id AND later.unit=o.unit AND later.channel=o.channel AND (later.seq>o.seq OR later.seq=o.seq AND later.ordinal>o.ordinal))`);
      for (const side of distanceFrom === null ? [null] : ['left', 'right']) {
        const extra = side ? ` AND o.value${side === 'left' ? '<' : '>='}?` : '';
        const statement = view.db.prepare(`SELECT o.*,d.part_flags,d.dut_index,d.part_id,d.x,d.y,d.wafer_id FROM ${source.alias}.observations o INDEXED BY observations_${order === 'value' ? 'value' : 'test'} JOIN ${source.alias}.devices d ON d.id=o.device_id WHERE ${where.join(' AND ')}${extra} ORDER BY o.${order}${side === 'left' ? ' DESC' : ''}${order === 'seq' ? ',o.ordinal' : ''}`);
        cursors.push({ statement, source, row: null }); statement.bind(side ? [...bind, distanceFrom] : bind);
        if (statement.step()) cursors.at(-1).row = statement.get({});
      }
    }
    let visited = 0;
    while (true) {
      let cursor = null;
      const sortValue = (row) => distanceFrom === null ? row[order] : Math.abs(row.value - distanceFrom);
      for (const item of cursors) if (item.row && (!cursor || sortValue(item.row) < sortValue(cursor.row))) cursor = item;
      if (!cursor) break;
      callback(cursor.row, cursor.source);
      cursor.row = cursor.statement.step() ? cursor.statement.get({}) : null;
      if (++visited % 4096 === 0) await checkpoint(view, visited, 'viewer-study-distribution');
    }
  } finally { for (const cursor of cursors) cursor.statement.finalize(); }
}

export function sourceProvenance(view) {
  return [...view.caches.entries()].map(([datasetId, cache]) => ({ datasetId, name: cache.dataset.name, sha256: cache.manifest.sha256 }));
}

export function decisionIdentity(device) {
  return { group: device.group_id, datasetId: device.dataset_id, deviceId: device.id, prrSeq: device.prr_seq, originalPartFlags: device.part_flags, head: device.head, site: device.site,
    partId: device.part_id, waferId: device.wafer_id, x: device.x, y: device.y };
}
