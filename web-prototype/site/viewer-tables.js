import { scopeWhere, testWhere, pageOptions, rowsBounded, eachRow, retiredExpression } from './viewer-context.js';
import { testKey, parseTestKey, textOption, boundedInteger, datasetId, invalid, deviceOutcome } from './viewer-model.js';

export async function overview(view) {
  const counts = view.selection.groups.map((_, group_id) => ({ group_id, total: 0, superseded: 0, passed: 0, failed: 0, unknown: 0 }));
  const headSet = new Set(), siteSet = new Set();
  await eachRow(view, 'SELECT d.group_id,d.head,d.site,d.retired,d.part_flags FROM v_devices d', [], (row) => {
    headSet.add(row.head); siteSet.add(`${row.head}/${row.site}`);
    if (view.selection.heads && !view.selection.heads.includes(row.head) || view.selection.sites && !view.selection.sites.includes(row.site)) return;
    const item = counts[row.group_id]; item.total++; item.superseded += row.retired;
    if (view.selection.attempts === 'all' || !row.retired) item[{ pass: 'passed', fail: 'failed', unknown: 'unknown' }[deviceOutcome(row.part_flags)]]++;
  });
  const heads = [...headSet].sort((a, b) => a - b), sites = [...siteSet].map((key) => { const [head, site] = key.split('/').map(Number); return { head, site }; }).sort((a, b) => a.head - b.head || a.site - b.site);
  const sources = [];
  for (const [id, cache] of view.caches) {
    const alias = view.sources.find((s) => s.datasetId === id).alias;
    const metadata = rowsBounded(view.db, `SELECT seq,type,subtype,json FROM ${alias}.metadata WHERE type IN (0,1) AND subtype NOT IN(40,50,60,62,63) ORDER BY seq LIMIT 101`, []);
    sources.push({ datasetId: id, name: cache.dataset.name, sha256: cache.manifest.sha256, sourceBytes: cache.manifest.sourceBytes,
      counts: cache.manifest.counts, byteOrder: cache.manifest.byteOrder, warnings: cache.manifest.warnings,
      metadata: metadata.slice(0, 100).map((r) => ({ ...r, fields: JSON.parse(r.json), json: undefined })), moreMetadata: metadata.length > 100 });
  }
  return { groups: view.selection.groups.map((group, groupId) => {
    const item = counts.find((r) => r.group_id === groupId) ?? { total: 0, superseded: 0, passed: 0, failed: 0, unknown: 0 };
    return { ...group, ...item, yield: item.passed + item.failed ? item.passed / (item.passed + item.failed) : null };
  }), heads, sites, sources, attempts: view.selection.attempts };
}

export function listViewerTests(view, options) {
  const { offset, limit } = pageOptions(options, 200), query = textOption(options.query ?? '');
  const orders = { number: 'number,name,unit,channel,family', name: 'name,number,unit,channel,family', original: 'MIN(source),MIN(first_seq),number,name,unit,channel,family' };
  const order = options.order ?? 'number'; if (!Object.hasOwn(orders, order)) invalid('Invalid test ordering.');
  let condition = '1', bind = [];
  if (query) {
    if (options.wildcard === true) {
      const pattern = query.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '%').replace(/\?/g, '_');
      condition = "(CAST(number AS TEXT) LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')"; bind = [pattern, pattern];
    } else { condition = '(instr(CAST(number AS TEXT),?)>0 OR instr(lower(name),lower(?))>0)'; bind = [query, query]; }
  }
  const group = 'family,number,name,unit,channel,identity';
  const total = view.db.selectValue(`SELECT COUNT(*) FROM(SELECT 1 FROM v_tests WHERE ${condition} GROUP BY ${group})`, bind.length ? bind : undefined);
  const items = rowsBounded(view.db, `SELECT ${group},SUM(observations) observations,SUM(failures) failures,COUNT(DISTINCT group_id) groups FROM v_tests WHERE ${condition} GROUP BY ${group} ORDER BY ${orders[order]} LIMIT ? OFFSET ?`, [...bind, limit, offset]);
  const requestedPins = [...new Set(items.filter((row) => row.family === 15 && row.channel.startsWith('pmr:')).map((row) => Number(row.channel.slice(4))))];
  if (requestedPins.length) {
    const pinRows = [];
    for (const [id] of view.caches) {
      const source = view.sources.find((s) => s.datasetId === id);
      const records = rowsBounded(view.db, `SELECT json FROM ${source.alias}.metadata WHERE type=1 AND subtype=60 AND json_extract(json,'$.PMR_INDX') IN(${requestedPins.map(() => '?').join(',')}) LIMIT 65537`, requestedPins);
      for (const record of records) {
        const pin = JSON.parse(record.json);
        if (view.selection.heads && pin.HEAD_NUM !== 255 && !view.selection.heads.includes(pin.HEAD_NUM) || view.selection.sites && pin.SITE_NUM !== 255 && !view.selection.sites.includes(pin.SITE_NUM)) continue;
        pinRows.push({ datasetId: id, pmr: pin.PMR_INDX, head: pin.HEAD_NUM, site: pin.SITE_NUM, logical: pin.LOG_NAM, physical: pin.PHY_NAM, channel: pin.CHAN_NAM });
        if (pinRows.length > 4096) invalid('This catalogue page has too many pin-map scopes. Select fewer tests or sources.');
      }
    }
    for (const item of items) if (item.channel.startsWith('pmr:')) {
      item.pins = pinRows.filter((pin) => pin.pmr === Number(item.channel.slice(4)));
      item.pinLabel = [...new Set(item.pins.map((pin) => pin.logical || pin.physical || pin.channel).filter(Boolean))].join(' / ');
    }
  }
  return { items: items.map((row) => ({ ...row, key: testKey(row) })), total, offset, countScope: 'All recorded observations in the selected sources, before head/site/attempt filters.', nextOffset: offset + items.length < total ? offset + items.length : null };
}

export function deviceFilter(view, options) {
  const scope = scopeWhere(view.selection), parts = [scope.sql], bind = [...scope.bind];
  const query = textOption(options.query ?? '');
  if (query) { parts.push('(instr(lower(d.part_id),lower(?))>0 OR instr(lower(d.part_text),lower(?))>0 OR CAST(d.dut_index AS TEXT)=?)'); bind.push(query, query, query); }
  if (options.group !== undefined) { parts.push('d.group_id=?'); bind.push(boundedInteger(options.group, 0, view.selection.groups.length - 1, 'Group')); }
  if (options.bin) {
    if (!['hard', 'soft'].includes(options.bin.kind)) invalid('Choose hardware or software bins.');
    parts.push(`d.${options.bin.kind}_bin=?`); bind.push(boundedInteger(options.bin.number, 0, 65535, 'Bin'));
  }
  if (options.wafer && options.wafer !== 'stacked') {
    datasetId(options.wafer.datasetId); boundedInteger(options.wafer.id, 1, Number.MAX_SAFE_INTEGER, 'Wafer');
    parts.push('d.dataset_id=? AND d.wafer_id=?'); bind.push(options.wafer.datasetId, options.wafer.id);
  }
  const pick = options.pick;
  if (pick) {
    if (!['trend', 'histogram', 'bin', 'wafer'].includes(pick.type)) invalid('Unknown plot selection.');
    if (pick.seriesKeys) {
      if (!Array.isArray(pick.seriesKeys) || !pick.seriesKeys.length || pick.seriesKeys.length > 64) invalid('Select a visible plot series.');
      const series = pick.seriesKeys.map((key) => {
        let values; try { values = JSON.parse(key); } catch { invalid('Invalid plot series.'); }
        if (!Array.isArray(values) || values.length !== 3) invalid('Invalid plot series.');
        boundedInteger(values[0], 0, view.selection.groups.length - 1, 'Group'); boundedInteger(values[1], 0, 255, 'Head');
        if (values[2] !== null) boundedInteger(values[2], 0, 255, 'Site');
        bind.push(values[0], values[1]);
        if (values[2] === null) return '(d.group_id=? AND d.head=?)';
        bind.push(values[2]); return '(d.group_id=? AND d.head=? AND d.site=?)';
      });
      parts.push(`(${series.join(' OR ')})`);
    }
    if (pick.type === 'trend') {
      if (![pick.xlo, pick.xhi].every(Number.isFinite) || pick.xlo > pick.xhi) invalid('Invalid trend interval.');
      parts.push('d.x_index BETWEEN ? AND ?'); bind.push(pick.xlo, pick.xhi);
    }
    if (pick.type === 'wafer') {
      boundedInteger(pick.x, -32767, 32767, 'X'); boundedInteger(pick.y, -32767, 32767, 'Y');
      parts.push('d.x=? AND d.y=?'); bind.push(pick.x, pick.y);
    }
  }
  if (options.testKey) {
    const test = testWhere(options.testKey), extra = [];
    if (pick?.type === 'histogram') {
      if (![pick.low, pick.high].every(Number.isFinite) || pick.low > pick.high) invalid('Invalid histogram interval.');
      extra.push(`o.value>=? AND o.value${pick.inclusiveHigh ? '<=' : '<'}?`); test.bind.push(pick.low, pick.high);
    }
    if (pick && ['trend', 'histogram'].includes(pick.type)) {
      extra.push('o.value IS NOT NULL AND (o.test_flags&63)=0');
      if (test.test.family !== 20) extra.push('(o.parm_flags&7)=0');
    }
    parts.push(`EXISTS(SELECT 1 FROM v_observations o WHERE o.source=d.source AND o.device_id=d.id AND ${test.sql}${extra.length ? ` AND ${extra.join(' AND ')}` : ''})`); bind.push(...test.bind);
  } else if (pick && ['trend', 'histogram'].includes(pick.type)) invalid('A plot selection requires its original test.');
  return { sql: parts.join(' AND '), bind };
}

export async function listDevices(view, options) {
  if (options.sortTest) return (await import('./viewer-numeric-order.js')).listDevicesByTest(view, options);
  const { offset, limit } = pageOptions(options), filter = deviceFilter(view, options);
  const sorts = { index: 'd.group_id,d.x_index', part: 'd.part_id', head: 'd.head', site: 'd.site', hard_bin: 'd.hard_bin', soft_bin: 'd.soft_bin', time: 'd.test_time', x: 'd.x', y: 'd.y', status: 'd.part_flags', tests: 'd.num_tests' };
  const sort = options.sort ?? 'index', direction = options.direction ?? 'asc';
  if (!Object.hasOwn(sorts, sort) || !['asc', 'desc'].includes(direction)) invalid('Invalid device ordering.');
  const total = view.db.selectValue(`SELECT COUNT(*) FROM v_devices d WHERE ${filter.sql}`, filter.bind.length ? filter.bind : undefined);
  const items = [], cursors = [], sign = direction === 'asc' ? 1 : -1, encoder = new TextEncoder();
  const compareValue = (a, b) => {
    if (typeof a !== 'string') return a - b;
    const x = encoder.encode(a), y = encoder.encode(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  };
  const compare = (a, b) => {
    if (sort === 'index') return sign * (a.group_id - b.group_id || a.source_index - b.source_index || a.id - b.id);
    const field = sorts[sort].slice(2);
    return sign * (compareValue(a[field], b[field]) || a.group_id - b.group_id || a.source_index - b.source_index || a.id - b.id);
  };
  // Merge indexed source cursors instead of sorting an entire device population
  // into SQLite WASM temporary memory. At most one row per source stays live.
  try {
    for (const source of view.sources) {
      const index = sort === 'index' ? '' : ` INDEXED BY devices_sort_${sort}`;
      const projection = `SELECT d.*,${source.source} source,${source.groupId} group_id,${source.sourceIndex} source_index,ss.dataset_id,ss.name source_name,d.dut_index+ss.attempt_offset x_index,CASE WHEN ${retiredExpression(view, source)} THEN 1 ELSE 0 END retired FROM ${source.alias}.devices d${index} JOIN source_scope ss ON ss.source=${source.source}`;
      const order = sort === 'index' ? 'd.id' : sorts[sort];
      const statement = view.db.prepare(`SELECT d.* FROM(${projection}) d WHERE ${filter.sql} ORDER BY ${order} ${direction},d.id ${direction}`);
      const cursor = { statement, row: null }; cursors.push(cursor);
      if (filter.bind.length) statement.bind(filter.bind);
      if (statement.step()) cursor.row = statement.get({});
    }
    let skipped = 0, bytes = 0;
    while (items.length < limit) {
      let selected = null;
      for (const cursor of cursors) if (cursor.row && (!selected || compare(cursor.row, selected.row) < 0)) selected = cursor;
      if (!selected) break;
      if (skipped++ >= offset) {
        bytes += JSON.stringify(selected.row).length * 2;
        if (bytes > 2 * 1024 * 1024) invalid('This device page is too large. Use a smaller page size.');
        items.push(selected.row);
      }
      selected.row = selected.statement.step() ? selected.statement.get({}) : null;
      if (skipped % 4096 === 0) { await new Promise((resolve) => setTimeout(resolve, 0)); view.context.checkCancelled(); }
    }
  } finally { for (const cursor of cursors) cursor.statement.finalize(); }
  attachDeviceResults(view, items, options.tests ?? []);
  if(options.failureSummary === true) await attachFailureSummary(view, items);
  return { items, total, offset, nextOffset: offset + items.length < total ? offset + items.length : null };
}

export async function attachFailureSummary(view, items) {
  for (const row of items) { row.failedTests=[]; row.failedExecutions=0; row.failureNamesTruncated=false; }
  for (const source of view.sources) {
    const page=items.filter(row=>row.source===source.source);if(!page.length)continue;
    const lookup=new Map(page.map(row=>[row.id,row])),names=new Map(page.map(row=>[row.id,new Set()]));
    await eachRow(view,`SELECT o.device_id,t.number,t.name FROM ${source.alias}.observations o INDEXED BY observations_device JOIN ${source.alias}.tests t ON t.id=o.test_id WHERE o.device_id IN(${page.map(()=>'?').join(',')}) AND (o.test_flags&208)=128 ORDER BY o.device_id,o.seq,o.ordinal`,page.map(row=>row.id),observation=>{
      const row=lookup.get(observation.device_id),seen=names.get(observation.device_id),key=JSON.stringify([observation.number,observation.name]);row.failedExecutions++;
      if(!seen.has(key)){if(seen.size<20){seen.add(key);row.failedTests.push({number:observation.number,name:observation.name});}else row.failureNamesTruncated=true;}
    });
  }
}

export function attachDeviceResults(view, items, tests) {
  if (!Array.isArray(tests) || tests.length > 12) invalid('Select up to twelve tests for the device matrix.');
  for (const row of items) row.testResults = {};
  // One indexed query per source/test/page, joining by device ID rather than row position.
  for (const key of tests) {
    const test = parseTestKey(key);
    for (const source of view.sources) {
      if (test.identity !== 'resolved' && !test.identity.startsWith(`${source.datasetId}:`)) continue;
      const pageRows = items.filter((row) => row.source === source.source);
      if (!pageRows.length) continue;
      const identity = test.identity === 'resolved' ? 'resolved' : test.identity.split(':').at(-1);
      const testId = view.db.selectValue(`SELECT id FROM ${source.alias}.tests WHERE family=? AND number=? AND name=? AND identity=?`, [test.family, test.number, test.name, identity]);
      if (!testId) continue;
      const results = rowsBounded(view.db, `SELECT o.device_id,o.seq,o.ordinal,o.value,o.raw_bits,o.test_flags,o.parm_flags,o.low,o.high,o.metadata_id FROM ${source.alias}.observations o INDEXED BY observations_device WHERE o.test_id=? AND o.unit=? AND o.channel=? AND o.device_id IN (${pageRows.map(() => '?').join(',')}) ORDER BY o.device_id,o.seq,o.ordinal LIMIT 10001`, [testId, test.unit, test.channel, ...pageRows.map((r) => r.id)]);
      if (results.length > 10000) invalid('This device matrix contains too many repeated executions. Select fewer devices.');
      const lookup = new Map(pageRows.map((r) => [r.id, r]));
      for (const result of results) (lookup.get(result.device_id).testResults[key] ??= []).push(result);
    }
  }
}

/**
 * Stream report rows in group/source/PIR order with the current view's scope.
 * Each row has the same shape as listDevices().items, including repeated test
 * executions. Keyset pages hold at most 100 attempts, perform no COUNT/OFFSET,
 * and finalize their SQL statements before yielding to the report writer.
 */
export async function* iterateReportDevices(view, { tests = [], sourceFilter = null } = {}) {
  if (!Array.isArray(tests) || tests.length > 12) invalid('Select up to twelve tests for the device matrix.');
  tests.forEach(parseTestKey);
  const filter = deviceFilter(view, {});
  let rows = 0;
  for (const source of view.sources) {
    if (sourceFilter && !sourceFilter(source)) continue;
    const projection = `SELECT d.*,${source.source} source,${source.groupId} group_id,${source.sourceIndex} source_index,ss.dataset_id,ss.name source_name,d.dut_index+ss.attempt_offset x_index,CASE WHEN ${retiredExpression(view, source)} THEN 1 ELSE 0 END retired FROM ${source.alias}.devices d JOIN source_scope ss ON ss.source=${source.source}`;
    const sql = `SELECT d.* FROM(${projection}) d WHERE ${filter.sql} AND d.id>? ORDER BY d.id LIMIT 100`;
    let after = 0;
    while (true) {
      view.context.checkCancelled();
      const items = rowsBounded(view.db, sql, [...filter.bind, after]);
      if (!items.length) break;
      attachDeviceResults(view, items, tests);
      after = items.at(-1).id;
      for (const item of items) {
        view.context.checkCancelled();
        rows++; yield item;
      }
      view.context.progress({ phase: 'viewer-report-devices', rows });
      await new Promise((resolve) => setTimeout(resolve, 0));
      view.context.checkCancelled();
      if (items.length < 100) break;
    }
  }
}

export function readDevice(view, options) {
  const id = datasetId(options.datasetId), device = boundedInteger(options.deviceId, 1, Number.MAX_SAFE_INTEGER, 'Attempt');
  const candidates = view.sources.filter((s) => s.datasetId === id && (options.group === undefined || s.groupId === options.group));
  if (candidates.length > 1) invalid('Choose the comparison group for this device.');
  const source = candidates[0];
  if (!source) invalid('Device source is outside this workspace.');
  const limit = boundedInteger(options.limit ?? 100, 1, 1000, 'Page size');
  const after = options.after ?? [0, -1];
  if (!Array.isArray(after) || after.length !== 2) invalid('Invalid observation cursor.');
  boundedInteger(after[0], 0, Number.MAX_SAFE_INTEGER, 'Sequence'); boundedInteger(after[1], -1, 65535, 'Result ordinal');
  const attempt = view.db.selectObject('SELECT * FROM v_devices WHERE source=? AND id=?', [source.source, device]);
  if (!attempt) invalid('Attempt is not present in this source.');
  const items = rowsBounded(view.db, `SELECT o.*,t.family,t.number,t.name test_name FROM ${source.alias}.observations o JOIN ${source.alias}.tests t ON t.id=o.test_id WHERE o.device_id=? AND (o.seq,o.ordinal)>(?,?) ORDER BY o.seq,o.ordinal LIMIT ?`, [device, ...after, limit + 1]);
  const more = items.length > limit; if (more) items.pop();
  return { attempt, items, nextAfter: more ? [items.at(-1).seq, items.at(-1).ordinal] : null };
}

export function readMetadata(view, options) {
  const { offset, limit } = pageOptions(options, 100), query = textOption(options.query ?? '');
  const families = { datalog: '(type=50 AND subtype IN(10,30))', pins: '(type=1 AND subtype IN(60,62,63))', headers: '(type IN(0,1) AND subtype NOT IN(40,50,60,62,63))', all: '1' };
  const family = options.family ?? 'datalog'; if (!Object.hasOwn(families, family)) invalid('Unknown record family.');
  const union = view.sources.map((s) => `SELECT seq,type,subtype,device_id,json,${s.source} source FROM ${s.alias}.metadata`).join(' UNION ALL ');
  const where = `${families[family]} AND instr(lower(json),lower(?))>0`;
  const total = view.db.selectValue(`SELECT COUNT(*) FROM(${union}) WHERE ${where}`, [query]);
  const items = rowsBounded(view.db, `SELECT * FROM(${union}) WHERE ${where} ORDER BY source,seq LIMIT ? OFFSET ?`, [query, limit, offset]);
  return { items: items.map((row) => ({ ...row, datasetId: view.sources[row.source].datasetId, sourceName: view.sources[row.source].cache.dataset.name, fields: JSON.parse(row.json), json: undefined })), total, offset, nextOffset: offset + items.length < total ? offset + items.length : null };
}
