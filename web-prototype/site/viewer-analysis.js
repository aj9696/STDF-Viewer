import { PopulationStats, TrendSampler, histogramEdges, addToHistogram, parseTestKey,
  boundedInteger, invalid } from './viewer-model.js';
import { eachRow, retiredExpression } from './viewer-context.js';

const seriesKey = (group, head, site) => JSON.stringify([group, head, site]);
function projection(view, source, test, order = 'seq') {
  const alias = source.alias;
  if (test.identity !== 'resolved' && !test.identity.startsWith(`${source.datasetId}:`)) return null;
  const identity = test.identity === 'resolved' ? 'resolved' : test.identity.split(':').at(-1);
  const testId = view.db.selectValue(`SELECT id FROM ${alias}.tests WHERE family=? AND number=? AND name=? AND identity=?`, [test.family, test.number, test.name, identity]);
  if (!testId) return null;
  const where = ['o.test_id=?', 'o.unit=?', 'o.channel=?'], bind = [testId, test.unit, test.channel];
  if (view.selection.attempts === 'current') {
    where.push(`NOT ${retiredExpression(view, source)}`);
  }
  for (const [key, column] of [['heads', 'head'], ['sites', 'site']]) if (view.selection[key]) {
    where.push(`d.${column} IN (${view.selection[key].map(() => '?').join(',')})`); bind.push(...view.selection[key]);
  }
  if (order === 'value') {
    where.push('o.value IS NOT NULL', '(o.test_flags&63)=0');
    if (test.family !== 20) where.push('(o.parm_flags&7)=0');
  }
  return { sql: `SELECT o.seq,o.ordinal,o.device_id,o.head,o.site,o.test_flags,o.parm_flags,o.value,o.low,o.high,o.metadata_id,d.dut_index+${source.attemptOffset} x_index FROM ${alias}.observations o INDEXED BY ${order === 'value' ? 'observations_value' : 'observations_test'} JOIN ${alias}.devices d ON d.id=o.device_id WHERE ${where.join(' AND ')} ORDER BY o.${order}${order === 'seq' ? ',o.ordinal' : ''}`, bind };
}

/** Statistics and bins read every eligible value; only the trend is reduced. */
export async function analyzeTest(view, options) {
  const test = parseTestKey(options.testKey), binCount = boundedInteger(options.bins ?? 30, 1, 1000, 'Histogram bins');
  const bySite = options.seriesBy === 'site', aggregate = !bySite || options.includeAggregate === true;
  if (options.seriesBy !== undefined && !['site', 'aggregate'].includes(options.seriesBy)) invalid('Series must be aggregate or site.');
  const series = new Map();
  const keysFor = (source, row) => [
    ...(aggregate ? [seriesKey(source.groupId, row.head, null)] : []),
    ...(bySite ? [seriesKey(source.groupId, row.head, row.site)] : []),
  ];
  const getSeries = (key) => {
    if (!series.has(key)) {
      if (series.size >= 64) invalid('This selection produces more than 64 series. Select fewer heads/sites or use aggregate series.');
      const [group, head, site] = JSON.parse(key);
      series.set(key, { key, group, head, site, label: `${view.selection.groups[group].name} · Head ${head} · ${site === null ? 'All selected sites' : `Site ${site}`}`,
        moments: new PopulationStats(test.family), sampler: new TrendSampler(128), medianValues: [], seen: 0, trendSegment: 0, pendingGap: false, lastSource: null, gapRuns: 0 });
    }
    return series.get(key);
  };
  let physicalRows = 0;
  for (const source of view.sources) {
    const query = projection(view, source, test);
    if (!query) continue;
    // Only compact specification pairs are cached. Local overrides can create
    // arbitrarily many declarations, so this is deliberately a bounded LRU.
    const specs = new Map();
    await eachRow(view, query.sql, query.bind, (row) => {
      let spec = specs.get(row.metadata_id);
      if (!spec) {
        const metadata = JSON.parse(view.db.selectValue(`SELECT json FROM ${source.alias}.metadata WHERE id=?`, [row.metadata_id]));
        spec = { lowSpec: metadata.effective?.lowSpec ?? null, highSpec: metadata.effective?.highSpec ?? null };
        if (specs.size >= 256) specs.delete(specs.keys().next().value);
      } else specs.delete(row.metadata_id);
      specs.set(row.metadata_id, spec); Object.assign(row, spec);
      physicalRows++;
      for (const key of keysFor(source, row)) {
        const item = getSeries(key);
        if (item.lastSource !== source.source) { if (item.lastSource !== null) item.trendSegment++; item.lastSource = source.source; }
        if (item.moments.add(row)) {
          if (item.pendingGap) { item.trendSegment++; item.pendingGap = false; }
          item.sampler.add({ x: row.x_index, value: row.value, lsl: row.low, usl: row.high,
            testFlags: row.test_flags, failed: !(row.test_flags & 0x50) && !!(row.test_flags & 0x80), segment: item.trendSegment,
            datasetId: source.datasetId, deviceId: row.device_id, seq: row.seq, ordinal: row.ordinal });
        } else if (!item.pendingGap) { item.pendingGap = true; item.gapRuns++; }
      }
    });
  }
  let low = Infinity, high = -Infinity;
  for (const item of series.values()) if (item.moments.count) { low = Math.min(low, item.moments.min); high = Math.max(high, item.moments.max); }
  for (const item of series.values()) item.bins = histogramEdges(low, high, binCount);

  // Each source's value index supplies a sorted cursor. Merge at most 64
  // cursors to calculate exact medians without a population array or SQL sort.
  const cursors = [];
  try {
    for (const source of view.sources) {
      const query = projection(view, source, test, 'value');
      if (!query) continue;
      const statement = view.db.prepare(query.sql); cursors.push({ source, statement, row: null });
      statement.bind(query.bind);
      if (statement.step()) cursors.at(-1).row = statement.get({});
    }
    let visited = 0;
    while (true) {
      let cursor = null;
      for (const candidate of cursors) if (candidate.row && (!cursor || candidate.row.value < cursor.row.value)) cursor = candidate;
      if (!cursor) break;
      const row = cursor.row;
      for (const key of keysFor(cursor.source, row)) {
        const item = series.get(key); item.seen++;
        addToHistogram(item.bins, row.value);
        const n = item.moments.count;
        if (item.seen === Math.floor((n + 1) / 2) || item.seen === Math.floor(n / 2) + 1) item.medianValues.push(row.value);
      }
      cursor.row = cursor.statement.step() ? cursor.statement.get({}) : null;
      if (++visited % 4096 === 0) {
        view.context.progress({ phase: 'viewer-distribution', rows: visited });
        await new Promise((resolve) => setTimeout(resolve, 0)); view.context.checkCancelled();
      }
    }
  } finally { for (const cursor of cursors) cursor.statement.finalize(); }
  const output = [...series.values()].map(({ moments, sampler, medianValues, seen, trendSegment, pendingGap, lastSource, ...item }) => {
    const median = medianValues.length ? medianValues.reduce((sum, value) => sum + value / medianValues.length, 0) : null;
    return { ...item, count: moments.total, stats: moments.finish(median), points: sampler.finish(), reduced: sampler.total > sampler.finish().length };
  });
  return { test: { ...test, key: options.testKey }, population: { observations: physicalRows, attempts: view.selection.attempts }, series: output,
    histogramRange: output[0]?.bins.length ? [output[0].bins[0].low, output[0].bins.at(-1).high] : null,
    warnings: [
      ...(test.family === 20 ? ['FTR values are raw test-status flags, not physical measurements.'] : []),
      ...(output.some((s) => s.reduced) ? ['Trend display retains bucket extrema; statistics, medians and bins use the full eligible population.'] : []),
      ...(output.some((s) => s.stats.changingLimits) ? ['Changing limits are shown per observation. Cpk is withheld for affected populations.'] : []),
      ...(output.some((s) => s.stats.changingSpecs) ? ['Specification limits change within a population; its specification overlays are withheld.'] : []),
    ] };
}
