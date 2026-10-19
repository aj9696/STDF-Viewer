import { eachRow, rowsBounded, scopeWhere } from './viewer-context.js';
import { deviceOutcome, invalid } from './viewer-model.js';

const MAX_SITES = 4096, MAX_BINS = 32768, MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const counts = () => ({ total: 0, passed: 0, failed: 0, unknown: 0 });
const field = (value) => typeof value === 'string' && value.trim() ? value : null;
const timestamp = (value) => Number.isSafeInteger(value) && value > 0 ? value : null;
const finish = (value) => ({ ...value, yield: value.passed + value.failed ? value.passed / (value.passed + value.failed) : null });
function add(value, outcome) {
  value.total++;
  value[{ pass: 'passed', fail: 'failed', unknown: 'unknown' }[outcome]]++;
}

function sourceInformation(view, source, warnings) {
  const headers = rowsBounded(view.db, `SELECT json FROM ${source.alias}.metadata WHERE type=1 AND subtype=10 ORDER BY seq LIMIT 2`, [], 256 * 1024);
  const endings = rowsBounded(view.db, `SELECT json FROM ${source.alias}.metadata WHERE type=1 AND subtype=20 ORDER BY seq DESC LIMIT 2`, [], 256 * 1024);
  const mir = headers.length ? JSON.parse(headers[0].json) : {}, mrr = endings.length ? JSON.parse(endings[0].json) : {};
  if (!headers.length) warnings.add('A source has no MIR header. Its product, lot, program, and start date are not recorded.');
  if (headers.length > 1 || endings.length > 1) warnings.add('A source has more than one MIR or MRR record. Source labels use the first MIR and the last MRR.');
  const startTime = timestamp(mir.START_T), finishTime = timestamp(mrr.FINISH_T);
  if (startTime === null) warnings.add('A source has no valid start date. It does not appear in the date trend.');
  if (startTime !== null && finishTime !== null && finishTime < startTime) warnings.add('A source finish date is before its start date. Check the recorded dates.');
  return {
    key: JSON.stringify([source.groupId, source.datasetId]), group: source.groupId,
    groupName: view.selection.groups[source.groupId].name, sourceIndex: source.sourceIndex,
    datasetId: source.datasetId, sourceName: source.cache.dataset.name,
    lotId: field(mir.LOT_ID), sublotId: field(mir.SBLOT_ID), product: field(mir.PART_TYP),
    program: field(mir.JOB_NAM), revision: field(mir.JOB_REV), flow: field(mir.FLOW_ID),
    stage: field(mir.TEST_COD), tester: field(mir.NODE_NAM) ?? field(mir.TSTR_TYP),
    startTime, finishTime, ...counts(), sites: new Map(), softBins: new Map(), hardBins: new Map(),
  };
}

/** One device scan; observations and charts are not read or materialized. */
export async function yieldManager(view) {
  view.context.checkCancelled();
  const warnings = new Set([
    'Yield is pass count divided by pass plus fail count. Unknown outcomes are excluded from yield.',
    'Each comparison group is counted separately. The same source can appear in more than one group.',
    'Dates use the source MIR start time. They are not device test times.',
  ]);
  const files = view.sources.map((source) => sourceInformation(view, source, warnings));
  const bySource = new Map(view.sources.map((source, index) => [source.source, files[index]]));
  if (view.selection.attempts === 'current') {
    warnings.add('Current attempts use recorded replacement flags and source order. This is not first-pass yield.');
    for (const [group] of view.selection.groups.entries()) {
      const members = files.filter((file) => file.group === group);
      const cohorts = new Set(members.map((file) => JSON.stringify([file.lotId, file.sublotId, file.product, file.program, file.revision, file.flow, file.stage])));
      if (members.length > 1 && (cohorts.size > 1 || members.some((file) => !file.lotId || !file.product || !file.program))) {
        warnings.add('A group has different or missing lot, sublot, product, or program labels. Cross-file replacements still use head, site, part ID, and source order. Check the group.');
      }
    }
  } else warnings.add('All attempts include recorded retests. Counts are device attempts, not unique physical devices.');
  view.context.progress({ phase: 'viewer-yield-manager', rows: 0 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  view.context.checkCancelled();
  const scope = scopeWhere(view.selection);
  let siteBuckets = 0, binBuckets = 0;
  await eachRow(view, `SELECT d.source,d.head,d.site,d.part_flags,d.soft_bin,d.hard_bin FROM v_devices d WHERE ${scope.sql}`, scope.bind, (row) => {
    const file = bySource.get(row.source), outcome = deviceOutcome(row.part_flags);
    add(file, outcome);
    const siteKey = `${row.head}/${row.site}`;
    if (!file.sites.has(siteKey)) {
      if (++siteBuckets > MAX_SITES) invalid('Yield Manager has too many head and site groups. Select fewer sources, heads, or sites.');
      file.sites.set(siteKey, { head: row.head, site: row.site, ...counts() });
    }
    add(file.sites.get(siteKey), outcome);
    for (const [name, number] of [['softBins', row.soft_bin], ['hardBins', row.hard_bin]]) {
      if (!file[name].has(number)) {
        if (++binBuckets > MAX_BINS) invalid('Yield Manager has too many bin groups. Select fewer sources, heads, or sites.');
        file[name].set(number, { number, ...counts() });
      }
      add(file[name].get(number), outcome);
    }
  });
  view.context.checkCancelled();
  const result = { method: 'yield-manager-v1', files: files.map(({ sites, softBins, hardBins, ...file }) => ({
    ...finish(file), sites: [...sites.values()].map(finish).sort((a, b) => a.head - b.head || a.site - b.site),
    softBins: [...softBins.values()].sort((a, b) => a.number - b.number),
    hardBins: [...hardBins.values()].sort((a, b) => a.number - b.number),
  })), warnings: [...warnings] };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_RESPONSE_BYTES) invalid('Yield Manager results are too large. Select fewer sources, heads, or sites.');
  return result;
}
