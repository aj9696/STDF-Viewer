import { configureDatabase } from './dataset-schema.js';
import { ensureViewerCache } from './viewer-cache.js';
import { validateSelection, parseTestKey, boundedInteger, invalid } from './viewer-model.js';

/** Scope SQL to validated sources. Only internal aliases enter SQL text. */
export async function openViewerContext(store, input, context) {
  const selection = validateSelection(input), caches = new Map();
  for (const id of new Set(selection.groups.flatMap((g) => g.datasetIds))) {
    caches.set(id, await ensureViewerCache(store, id, context));
  }
  const first = caches.values().next().value;
  const db = new store.pool.OpfsSAHPoolDb(first.path, 'r');
  try {
    configureDatabase(store.sqlite3, db);
    const aliases = new Map(); let aliasIndex = 0;
    for (const [id, cache] of caches) {
      const alias = aliasIndex === 0 ? 'main' : `v${aliasIndex}`;
      if (aliasIndex) db.exec({ sql: `ATTACH DATABASE ? AS ${alias}`, bind: [cache.path] });
      aliases.set(id, alias); aliasIndex++;
    }
    db.exec('CREATE TEMP TABLE source_scope(source INTEGER PRIMARY KEY,group_id INTEGER,source_index INTEGER,dataset_id TEXT,name TEXT,attempt_offset INTEGER)');
    const sources = [];
    for (const [groupId, group] of selection.groups.entries()) {
      let attemptOffset = 0;
      for (const [sourceIndex, id] of group.datasetIds.entries()) {
        const cache = caches.get(id), alias = aliases.get(id), source = sources.length;
        const item = { source, groupId, sourceIndex, datasetId: id, alias, attemptOffset, cache };
        sources.push(item);
        db.exec({ sql: 'INSERT INTO source_scope VALUES(?,?,?,?,?,?)', bind: [source, groupId, sourceIndex, id, cache.dataset.name, attemptOffset] });
        attemptOffset += cache.manifest.counts.devices;
      }
    }
    const deviceViews = sources.map((s) => `SELECT d.*,${s.source} source,${s.groupId} group_id,${s.sourceIndex} source_index,ss.dataset_id,ss.name source_name,d.dut_index+ss.attempt_offset x_index,CASE WHEN ${retiredExpression({ sources }, s)} THEN 1 ELSE 0 END retired FROM ${s.alias}.devices d JOIN source_scope ss ON ss.source=${s.source}`);
    const identity = (s) => `CASE WHEN t.identity='resolved' THEN 'resolved' ELSE '${s.datasetId}:'||t.id||':'||t.identity END identity`;
    const observationViews = sources.map((s) => `SELECT o.*,t.family,t.number,t.name test_name,${identity(s)},${s.source} source,${s.groupId} group_id FROM ${s.alias}.observations o JOIN ${s.alias}.tests t ON t.id=o.test_id`);
    const testViews = sources.map((s) => `SELECT t.family,t.number,t.name,t.first_seq,${identity(s)},c.unit,c.channel,c.observations,c.failures,${s.source} source,${s.groupId} group_id FROM ${s.alias}.channels c JOIN ${s.alias}.tests t ON t.id=c.test_id`);
    db.exec(`CREATE TEMP VIEW v_devices AS ${deviceViews.join(' UNION ALL ')}; CREATE TEMP VIEW v_observations AS ${observationViews.join(' UNION ALL ')}; CREATE TEMP VIEW v_tests AS ${testViews.join(' UNION ALL ')}`);
    return { db, selection, sources, caches, context, close() { db.close(); } };
  } catch (error) { db.close(); throw error; }
}

/** No per-device TEMP table: even a mostly-retested file stays memory bounded. */
export function retiredExpression(view, source, alias = 'd') {
  const clauses = [`${alias}.superseded=1`];
  for (const later of view.sources) {
    if (later.groupId !== source.groupId || later.sourceIndex <= source.sourceIndex) continue;
    clauses.push(`EXISTS(SELECT 1 FROM ${later.alias}.devices n INDEXED BY devices_superseding_parts WHERE (n.part_flags&1)!=0 AND n.part_id!='' AND n.head=${alias}.head AND n.site=${alias}.site AND n.part_id=${alias}.part_id)`);
  }
  return `(${clauses.join(' OR ')})`;
}

export function scopeWhere(selection, alias = 'd', { allAttempts = false } = {}) {
  const where = [], bind = [];
  if (!allAttempts && selection.attempts === 'current') where.push(`${alias}.retired=0`);
  for (const [key, column] of [['heads', 'head'], ['sites', 'site']]) {
    if (selection[key]) { where.push(`${alias}.${column} IN (${selection[key].map(() => '?').join(',')})`); bind.push(...selection[key]); }
  }
  return { sql: where.length ? where.join(' AND ') : '1', bind };
}
export function testWhere(key, alias = 'o') {
  const test = parseTestKey(key);
  return { sql: `${alias}.family=? AND ${alias}.number=? AND ${alias}.test_name=? AND ${alias}.unit=? AND ${alias}.channel=? AND ${alias}.identity=?`, bind: [test.family, test.number, test.name, test.unit, test.channel, test.identity], test };
}
export function pageOptions(options = {}, max = 1000) {
  return { offset: boundedInteger(options.offset ?? 0, 0, 1000000000, 'Offset'), limit: boundedInteger(options.limit ?? 100, 1, max, 'Page size') };
}
export async function eachRow(view, sql, bind, callback) {
  const statement = view.db.prepare(sql); let rows = 0;
  try {
    if (bind.length) statement.bind(bind);
    while (statement.step()) {
      callback(statement.get({})); rows++;
      if (rows % 4096 === 0) {
        view.context.progress({ phase: 'viewer-query', rows });
        await new Promise((resolve) => setTimeout(resolve, 0)); view.context.checkCancelled();
      }
    }
  } finally { statement.finalize(); }
  return rows;
}
export function rowsBounded(db, sql, bind, maxBytes = 2 * 1024 * 1024) {
  const statement = db.prepare(sql), rows = []; let bytes = 2;
  try {
    if (bind.length) statement.bind(bind);
    while (statement.step()) {
      const row = statement.get({}); bytes += JSON.stringify(row).length * 2;
      if (bytes > maxBytes) invalid('This page is too large. Use a smaller page size or narrower selection.');
      rows.push(row);
    }
  } finally { statement.finalize(); }
  return rows;
}
