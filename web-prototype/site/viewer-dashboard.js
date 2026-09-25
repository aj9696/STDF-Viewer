import { iterateReportDevices } from './viewer-tables.js';
import { eachRow, rowsBounded, scopeWhere } from './viewer-context.js';
import { binChart, listWafers, waferMap } from './viewer-maps.js';
import { deviceOutcome, testOutcome, testKey, invalid, datasetId, boundedInteger, TrendSampler } from './viewer-model.js';
import { sourceProvenance, decisionIdentity } from './viewer-population.js';

const METHOD = 'dashboard-v1';
const emptyCounts = () => ({ total: 0, passed: 0, failed: 0, unknown: 0, timingCount: 0, timeMeanMs: 0, timeMinMs: null, timeMaxMs: null, timeSumMs: 0 });
export function addDashboardAttempt(counts, row) {
  counts.total++; counts[{ pass: 'passed', fail: 'failed', unknown: 'unknown' }[deviceOutcome(row.part_flags)]]++;
  if (Number.isFinite(row.test_time) && row.test_time >= 0) {
    counts.timingCount++; counts.timeSumMs += row.test_time;
    counts.timeMeanMs += (row.test_time - counts.timeMeanMs) / counts.timingCount;
    counts.timeMinMs = counts.timeMinMs == null ? row.test_time : Math.min(counts.timeMinMs, row.test_time);
    counts.timeMaxMs = counts.timeMaxMs == null ? row.test_time : Math.max(counts.timeMaxMs, row.test_time);
  }
  return counts;
}
export function finishDashboardCounts(counts) {
  return { ...counts, timeMeanMs: counts.timingCount ? counts.timeMeanMs : null,
    yield: counts.passed + counts.failed ? counts.passed / (counts.passed + counts.failed) : null };
}
function binSummary(map) {
  const bins = [...map.values()].sort((a, b) => b.count - a.count || a.number - b.number), total = bins.reduce((sum, b) => sum + b.count, 0);
  let cumulative = 0;
  return bins.map((b) => { cumulative += b.count; return { ...b, percent: total ? b.count / total : 0, cumulative: total ? cumulative / total : 0 }; });
}
function addBin(map, number, outcome) {
  if (number === 65535) return;
  if (!map.has(number)) map.set(number, { number, count: 0, passed: 0, failed: 0, unknown: 0 });
  const bin = map.get(number); bin.count++; bin[{ pass: 'passed', fail: 'failed', unknown: 'unknown' }[outcome]]++;
}
function fileInformation(view) {
  return view.sources.map((source) => {
    const metadata = rowsBounded(view.db, `SELECT seq,type,subtype,json FROM ${source.alias}.metadata WHERE (type=1 AND subtype IN(10,20,30)) OR (type=2 AND subtype IN(10,20)) ORDER BY seq LIMIT 1001`, [], 4 * 1024 * 1024);
    const header = metadata.find((r) => r.type === 1 && r.subtype === 10), end = metadata.findLast((r) => r.type === 1 && r.subtype === 20);
    const mir = header ? JSON.parse(header.json) : {}, mrr = end ? JSON.parse(end.json) : {};
    return { group: source.groupId, source: source.source, datasetId: source.datasetId, sourceName: source.cache.dataset.name,
      lotId: mir.LOT_ID || null, sublotId: mir.SBLOT_ID || null, device: mir.PART_TYP || null, testProgram: mir.JOB_NAM || null,
      programRevision: mir.JOB_REV || null, tester: mir.NODE_NAM || mir.TSTR_TYP || null, operator: mir.OPER_NAM || null,
      dateCode: mir.DATE_COD || null, flow: mir.FLOW_ID || null, specName: mir.SPEC_NAM || null, specVersion: mir.SPEC_VER || null,
      setupTime: mir.SETUP_T || null, startTime: mir.START_T || null, finishTime: mrr.FINISH_T || null,
      elapsedSeconds: mir.START_T > 0 && mrr.FINISH_T >= mir.START_T ? mrr.FINISH_T - mir.START_T : null,
      declaredPartCounts: metadata.filter((r) => r.type === 1 && r.subtype === 30).map((r) => JSON.parse(r.json)),
      metadataTruncated: metadata.length > 1000, counts: emptyCounts(), soft: new Map(), hard: new Map() };
  });
}

export async function topFailTests(view, options = {}) {
  const limit = boundedInteger(options.limit ?? 20, 1, 200, 'Failure ranking size'), totals = new Map();
  let observations = 0;
  for (const source of view.sources) {
    const scope = scopeWhere(view.selection), alias = source.alias;
    let device = null, deviceTests = new Set();
    await eachRow(view, `SELECT o.device_id,o.seq,o.test_flags,o.unit,o.channel,t.family,t.number,t.name,t.identity,t.id test_id
      FROM ${alias}.observations o INDEXED BY observations_device JOIN ${alias}.tests t ON t.id=o.test_id
      JOIN v_devices d ON d.source=${source.source} AND d.id=o.device_id WHERE ${scope.sql}
      ORDER BY o.device_id,o.seq,o.ordinal`, scope.bind, (row) => {
      observations++; if (testOutcome(row.test_flags) !== 'fail') return;
      if (device !== row.device_id) { device = row.device_id; deviceTests = new Set(); }
      const identity = row.identity === 'resolved' ? 'resolved' : `${source.datasetId}:${row.test_id}:${row.identity}`;
      const key = testKey({ ...row, identity }), bucket = JSON.stringify([source.groupId, key]);
      if (!totals.has(bucket)) {
        if (totals.size >= 20000) invalid('Failure ranking exceeds 20,000 test identities. Select fewer source files.');
        totals.set(bucket, { key, group: source.groupId, number: row.number, name: row.name, unit: row.unit, channel: row.channel, family: row.family, failedExecutions: 0, failureDevices: 0 });
      }
      const item = totals.get(bucket); item.failedExecutions++;
      if (!deviceTests.has(key)) { item.failureDevices++; deviceTests.add(key); }
    });
  }
  return { items: [...totals.values()].sort((a, b) => b.failureDevices - a.failureDevices || b.failedExecutions - a.failedExecutions || a.number - b.number).slice(0, limit), totalFailingTests: totals.size, observations,
    countPolicy: 'Failed executions and distinct failed device attempts for each test. A device can fail more than one test.' };
}

export async function dashboard(view, options = {}) {
  const files = fileInformation(view), bySource = new Map(files.map((f) => [f.source, f])), sites = new Map(), totals = emptyCounts();
  const trends = view.selection.groups.map((group, groupId) => ({ group: groupId, label: group.name, attempts: 0, knownOutcomes: 0, passed: 0, time: new TrendSampler(128), yield: new TrendSampler(128) }));
  for await (const row of iterateReportDevices(view)) {
    const file = bySource.get(row.source), outcome = deviceOutcome(row.part_flags);
    addDashboardAttempt(totals, row); addDashboardAttempt(file.counts, row);
    const trend = trends[row.group_id], point = { ...decisionIdentity(row), x: row.x_index, outcome }; trend.attempts++;
    if (outcome !== 'unknown') { trend.knownOutcomes++; trend.passed += Number(outcome === 'pass'); }
    if (trend.knownOutcomes) trend.yield.add({ ...point, value: trend.passed / trend.knownOutcomes, knownOutcomes: trend.knownOutcomes, passed: trend.passed });
    if (Number.isFinite(row.test_time) && row.test_time >= 0) trend.time.add({ ...point, value: row.test_time });
    addBin(file.soft, row.soft_bin, outcome); addBin(file.hard, row.hard_bin, outcome);
    const key = JSON.stringify([row.group_id, row.head, row.site]);
    if (!sites.has(key)) {
      if (sites.size >= 4096) invalid('Dashboard contains too many head/site groups. Select fewer heads or sites.');
      sites.set(key, { group: row.group_id, head: row.head, site: row.site, ...emptyCounts() });
    }
    addDashboardAttempt(sites.get(key), row);
  }
  const lotGroups = new Map();
  for (const file of files) {
    const key = JSON.stringify([file.group, file.lotId || file.datasetId]);
    if (!lotGroups.has(key)) lotGroups.set(key, { key, group: file.group, lotId: file.lotId, sourceIds: [], devices: new Set(), programs: new Set(), ...emptyCounts(), soft: new Map(), hard: new Map() });
    const lot = lotGroups.get(key); lot.sourceIds.push(file.datasetId); if (file.device) lot.devices.add(file.device); if (file.testProgram) lot.programs.add(file.testProgram);
    const priorTiming = lot.timingCount;
    for (const field of ['total', 'passed', 'failed', 'unknown', 'timingCount', 'timeSumMs']) lot[field] += file.counts[field];
    if (file.counts.timingCount) {
      lot.timeMeanMs = (lot.timeMeanMs * priorTiming + file.counts.timeMeanMs * file.counts.timingCount) / lot.timingCount;
      lot.timeMinMs = lot.timeMinMs == null ? file.counts.timeMinMs : Math.min(lot.timeMinMs, file.counts.timeMinMs);
      lot.timeMaxMs = lot.timeMaxMs == null ? file.counts.timeMaxMs : Math.max(lot.timeMaxMs, file.counts.timeMaxMs);
    }
    for (const kind of ['soft', 'hard']) for (const bin of file[kind].values()) {
      if (!lot[kind].has(bin.number)) lot[kind].set(bin.number, { number: bin.number, count: 0, passed: 0, failed: 0, unknown: 0 });
      const dest = lot[kind].get(bin.number); for (const field of ['count', 'passed', 'failed', 'unknown']) dest[field] += bin[field];
    }
  }
  const finishFile = ({ counts, soft, hard, ...file }) => {
    const softBins = binSummary(soft), hardBins = binSummary(hard), failBins = softBins.filter((b) => b.failed).sort((a, b) => b.failed - a.failed || a.number - b.number);
    return { ...file, ...finishDashboardCounts(counts), softBins, hardBins, topFail: failBins[0] ?? null };
  };
  const rankedFiles = files.map(finishFile).sort((a, b) => (a.yield ?? Infinity) - (b.yield ?? Infinity) || a.sourceName.localeCompare(b.sourceName));
  const lots = [...lotGroups.values()].map(({ soft, hard, devices, programs, ...r }) => ({ ...finishDashboardCounts(r), devices: [...devices], programs: [...programs], softBins: binSummary(soft), hardBins: binSummary(hard) }));
  lots.sort((a, b) => (a.yield ?? Infinity) - (b.yield ?? Infinity) || String(a.lotId).localeCompare(String(b.lotId)));
  const topFails = options.topFailures === false ? null : await topFailTests(view, { limit: options.failLimit ?? 20 });
  const wafers = listWafers(view).items;
  let waferPreview = null, previewWarning = null;
  if (options.waferPreview !== false && wafers.length) {
    try { waferPreview = await waferMap(view, { waferKey: wafers[0].key }); }
    catch (error) { if (error.code !== 'INVALID_REQUEST' || !String(error.message).includes('50,000')) throw error; previewWarning = 'The first wafer is larger than the dashboard preview limit. Open Wafers and choose a coordinate range.'; }
  }
  const yieldValues = rankedFiles.map((f) => f.yield).filter((n) => n != null);
  return { method: METHOD, totals: finishDashboardCounts(totals), sites: [...sites.values()].map(finishDashboardCounts), files: rankedFiles, lots,
    deviceTrends: trends.map(({ time, yield: yieldSampler, ...trend }) => {
      const timePoints = time.finish(), yieldPoints = yieldSampler.finish();
      return { ...trend, timingCount: time.total, yieldPointCount: yieldSampler.total, timePoints, yieldPoints,
        reducedTime: time.total > timePoints.length, reducedYield: yieldSampler.total > yieldPoints.length };
    }),
    yieldRange: { min: yieldValues.length ? Math.min(...yieldValues) : null, max: yieldValues.length ? Math.max(...yieldValues) : null,
      meanFileYield: yieldValues.length ? yieldValues.reduce((a, b) => a + b, 0) / yieldValues.length : null },
    topFailTests: topFails, bins: { soft: await binChart(view, { kind: 'soft' }), hard: await binChart(view, { kind: 'hard' }) }, waferPreview, waferCount: wafers.length,
    population: view.selection, provenance: sourceProvenance(view), warnings: [
      'Yield excludes unknown outcomes. Totals count each comparison group independently, including overlapping sources.',
      'Test time summarizes recorded PRR milliseconds, including zero. Summed device time is not wall-clock elapsed time.',
      ...(lots.some((l) => l.devices.length > 1 || l.programs.length > 1) ? ['A lot contains multiple device names or programs; those source labels remain visible.'] : []),
      ...(previewWarning ? [previewWarning] : []),
    ] };
}

const RECORD_NAMES = { '0/10': 'FAR', '0/20': 'ATR', '0/30': 'VUR', '1/10': 'MIR', '1/20': 'MRR', '1/30': 'PCR', '1/40': 'HBR', '1/50': 'SBR', '1/60': 'PMR', '1/62': 'PGR', '1/63': 'PLR', '1/70': 'RDR', '1/80': 'SDR', '2/10': 'WIR', '2/20': 'WRR', '2/30': 'WCR', '5/10': 'PIR', '5/20': 'PRR', '10/30': 'TSR', '15/10': 'PTR', '15/15': 'MPR', '15/20': 'FTR', '20/10': 'BPS', '20/20': 'EPS', '50/10': 'GDR', '50/30': 'DTR' };
export function recordSummary(view, options = {}) {
  if (options.datasetId != null && !view.caches.has(datasetId(options.datasetId))) invalid('Source is outside this workspace.');
  const totals = new Map(), sources = []; let total = 0;
  for (const [id, cache] of view.caches) {
    if (options.datasetId != null && id !== options.datasetId) continue;
    let count = 0;
    for (const [key, value] of Object.entries(cache.manifest.recordCounts ?? {})) {
      const [type, subtype] = key.split('/').map(Number);
      if (![type, subtype].every((n) => Number.isInteger(n) && n >= 0 && n <= 255) || !Number.isSafeInteger(value) || value < 0) invalid('Saved record count manifest is invalid.');
      if (!totals.has(key)) totals.set(key, { type, subtype, name: RECORD_NAMES[key] ?? `${type}/${subtype}`, count: 0, sources: [] });
      const entry = totals.get(key); entry.count += value; entry.sources.push({ datasetId: id, name: cache.dataset.name, count: value }); count += value; total += value;
    }
    sources.push({ datasetId: id, name: cache.dataset.name, total: count });
  }
  return { method: METHOD, items: [...totals.values()].sort((a, b) => a.type - b.type || a.subtype - b.subtype), total, sources,
    warnings: ['Record counts describe complete original sources, independent of head/site/retest filters. Repeated sources in comparison groups count once.'] };
}
