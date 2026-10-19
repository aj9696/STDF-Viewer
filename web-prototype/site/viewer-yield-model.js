// Lot rows retain comparison-group and test-program identity. A missing LOT_ID
// cannot establish that two source files belong to the same lot.
const IDENTITY_FIELDS = ['lotId', 'sublotId', 'product', 'program', 'revision', 'flow', 'stage'];
const COUNT_FIELDS = ['total', 'passed', 'failed', 'unknown'];
const text = (value) => value == null ? '' : String(value);
const count = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
const sumCounts = (target, source) => { for (const key of COUNT_FIELDS) target[key] += count(source[key]); };
const counts = () => ({ total: 0, passed: 0, failed: 0, unknown: 0 });

export function createYieldViewState() {
  return { query: '', group: '', product: '', sort: 'yield', direction: 'asc', detailKey: null, binKind: 'soft', binOffset: 0, siteOffset: 0 };
}
export function recordedTime(value) {
  return Number.isFinite(value) && value > 0 && value <= 0xffffffff ? value : null;
}
export function outcomeYield(row) {
  const known = row.passed + row.failed;
  return known ? 100 * row.passed / known : null;
}
export function yieldLotKey(file) {
  return JSON.stringify([file.group, ...IDENTITY_FIELDS.map((key) => text(file[key])), text(file.lotId) ? null : file.key]);
}
function mergeBreakdown(files, field, keyOf) {
  const entries = new Map();
  for (const file of files) for (const row of file[field] ?? []) {
    const key = keyOf(row);
    if (!entries.has(key)) entries.set(key, { ...row, ...counts() });
    sumCounts(entries.get(key), row);
  }
  return [...entries.values()].map((row) => ({ ...row, yield: outcomeYield(row) }));
}
export function buildYieldLots(files = []) {
  const lots = new Map();
  for (const file of files) {
    const key = yieldLotKey(file);
    if (!lots.has(key)) lots.set(key, {
      key, group: file.group, groupName: text(file.groupName),
      ...Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, text(file[field])])),
      ...counts(), files: [], datasetIds: [], startTime: null, finishTime: null,
    });
    const lot = lots.get(key);
    lot.files.push(file); sumCounts(lot, file);
    if (!lot.datasetIds.includes(file.datasetId)) lot.datasetIds.push(file.datasetId);
    const start = recordedTime(file.startTime), finish = recordedTime(file.finishTime);
    if (start != null && (lot.startTime == null || start < lot.startTime)) lot.startTime = start;
    if (finish != null && (lot.finishTime == null || finish > lot.finishTime)) lot.finishTime = finish;
  }
  for (const lot of lots.values()) {
    lot.yield = outcomeYield(lot);
    lot.sites = mergeBreakdown(lot.files, 'sites', (row) => JSON.stringify([row.head, row.site]))
      .sort((a, b) => a.head - b.head || a.site - b.site);
    for (const field of ['softBins', 'hardBins']) {
      lot[field] = mergeBreakdown(lot.files, field, (row) => row.number)
        .sort((a, b) => b.failed - a.failed || a.number - b.number);
    }
  }
  return [...lots.values()];
}
export function filteredYieldLots(lots, viewState) {
  const query = text(viewState.query).trim().toLocaleLowerCase();
  return lots.filter((lot) => {
    if (viewState.group && JSON.stringify(lot.group) !== viewState.group) return false;
    if (viewState.product && JSON.stringify(lot.product) !== viewState.product) return false;
    if (!query) return true;
    return [lot.groupName, ...IDENTITY_FIELDS.map((key) => lot[key]), ...lot.files.flatMap((file) => [file.sourceName, file.tester])]
      .some((value) => text(value).toLocaleLowerCase().includes(query));
  });
}
export function sortedYieldLots(lots, { sort = 'yield', direction = 'asc' } = {}) {
  const numeric = new Set(['yield', 'total', 'passed', 'failed', 'unknown', 'startTime']);
  const field = numeric.has(sort) || ['lotId', 'product', 'program', 'groupName'].includes(sort) ? sort : 'yield';
  const sign = direction === 'desc' ? -1 : 1;
  return [...lots].sort((a, b) => {
    const left = a[field], right = b[field];
    if (left == null || right == null) return left == null ? right == null ? a.key.localeCompare(b.key) : 1 : -1;
    const order = numeric.has(field) ? left - right : text(left).localeCompare(text(right), undefined, { numeric: true });
    return sign * order || a.key.localeCompare(b.key);
  });
}
export function yieldTrendPoints(lots) {
  return lots.flatMap((lot) => lot.files.map((file) => ({ ...file, lotKey: lot.key, yield: outcomeYield(file), time: recordedTime(file.startTime) })))
    .filter((file) => file.time != null && file.yield != null)
    .sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
}
export function lotDeviceOptions(lot, outcome, extra = {}) {
  return { group: lot.group, datasetIds: [...lot.datasetIds], ...(outcome ? { outcome } : {}), ...extra };
}
