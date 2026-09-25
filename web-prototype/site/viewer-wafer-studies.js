import { listWafers } from './viewer-maps.js';
import { iterateReportDevices } from './viewer-tables.js';
import { iterateJoinedDevices, studyTests, decisionIdentity, sourceProvenance, checkpoint } from './viewer-population.js';
import { boundedInteger, invalid, deviceOutcome, histogramEdges, addToHistogram } from './viewer-model.js';

export const MAX_WAFER_COORDINATES = 50000;
const METHOD = 'wafer-studies-v1';
const waferScope = (row) => JSON.stringify([row.group_id, row.dataset_id, row.wafer_id, row.head]);
const position = (row) => `${row.x}/${row.y}`;
const knownCoordinate = (row) => row.wafer_id != null && row.x !== -32768 && row.y !== -32768;

function boundsOption(bounds) {
  if (bounds == null) return null;
  const result = {};
  for (const axis of ['x', 'y']) {
    if (!Array.isArray(bounds[axis]) || bounds[axis].length !== 2) invalid('Map bounds require X and Y intervals.');
    result[axis] = bounds[axis].map((v) => boundedInteger(v, -32767, 32767, 'Coordinate'));
    if (result[axis][0] > result[axis][1]) invalid('Map bounds must be ordered.');
  }
  return result;
}
function numericLimits(input) {
  if (input == null) return null;
  const low = input.low ?? null, high = input.high ?? null;
  if (low !== null && !Number.isFinite(low) || high !== null && !Number.isFinite(high) || low === null && high === null || low !== null && high !== null && low > high) invalid('Choose ordered finite limits.');
  return { low, high };
}
function chooseWafer(view, waferKey) {
  const wafer = listWafers(view).items.find((w) => w.key === waferKey);
  if (!wafer) invalid('Choose a wafer from this workspace.');
  return wafer;
}
function inWafer(row, wafer) {
  return row.dataset_id === wafer.datasetId && row.group_id === wafer.group && row.wafer_id === wafer.id && row.head === wafer.head;
}
function makeCell(row, testKey) {
  const result = testKey ? row.results?.[testKey] : null;
  return { ...decisionIdentity(row), value: testKey ? row.values?.[testKey] ?? null : null,
    outcome: deviceOutcome(row.part_flags), softBin: row.soft_bin, hardBin: row.hard_bin,
    missing: testKey ? !result : false, invalid: testKey ? !!result && !result.eligible : false,
    recordSeq: result?.seq ?? null, ordinal: result?.ordinal ?? null, testOutcome: result?.outcome ?? null, attempts: 1 };
}

/** Latest selected PRR represents a coordinate, even if its final test is invalid. */
export function addWaferCell(cells, row, testKey = null, maximum = MAX_WAFER_COORDINATES) {
  const key = position(row), prior = cells.get(key);
  if (!prior && cells.size >= maximum) invalid('This map exceeds 50,000 coordinates. Select a smaller X/Y range.');
  const attempts = (prior?.attempts ?? 0) + 1;
  if (!prior || row.prr_seq > prior.prrSeq || row.prr_seq === prior.prrSeq && row.id > prior.deviceId) cells.set(key, { ...makeCell(row, testKey), attempts });
  else prior.attempts = attempts;
}

export function summarizeWaferCells(cells, limits = null) {
  const counts = { attempts: 0, coordinates: cells.length, valid: 0, missing: 0, invalid: 0, passed: 0, failed: 0, unknown: 0, outliers: 0 };
  const values = []; let mean = 0, m2 = 0;
  for (const cell of cells) {
    counts.attempts += cell.attempts; counts[{ pass: 'passed', fail: 'failed', unknown: 'unknown' }[cell.outcome]]++;
    counts.missing += Number(cell.missing); counts.invalid += Number(cell.invalid);
    cell.inRange = null;
    if (cell.value != null && Number.isFinite(cell.value)) {
      counts.valid++; values.push(cell.value);
      const delta = cell.value - mean; mean += delta / counts.valid; m2 += delta * (cell.value - mean);
      if (limits) { cell.inRange = (limits.low == null || cell.value >= limits.low) && (limits.high == null || cell.value <= limits.high); counts.outliers += Number(!cell.inRange); }
    }
  }
  values.sort((a, b) => a - b);
  const median = values.length ? (values[Math.floor((values.length - 1) / 2)] / 2 + values[Math.floor(values.length / 2)] / 2) : null;
  const min = values[0] ?? null, max = values.at(-1) ?? null;
  const histogram = values.length ? histogramEdges(min, max, 30) : [];
  for (const value of values) addToHistogram(histogram, value);
  return { summary: { ...counts, mean: values.length ? mean : null, median, min, max,
    stdev: values.length ? Math.sqrt(Math.max(0, m2 / values.length)) : null,
    yield: counts.passed + counts.failed ? counts.passed / (counts.passed + counts.failed) : null }, histogram };
}

export async function waferValues(view, options = {}) {
  const [test] = studyTests([options.testKey]), wafer = chooseWafer(view, options.waferKey);
  const bounds = boundsOption(options.bounds), limits = numericLimits(options.limits), cells = new Map();
  let omittedCoordinates = 0;
  for await (const row of iterateJoinedDevices(view, { tests: [test.key] })) {
    if (!inWafer(row, wafer)) continue;
    if (!knownCoordinate(row)) { omittedCoordinates++; continue; }
    if (bounds && (row.x < bounds.x[0] || row.x > bounds.x[1] || row.y < bounds.y[0] || row.y > bounds.y[1])) continue;
    addWaferCell(cells, row, test.key);
  }
  const result = [...cells.values()], stats = summarizeWaferCells(result, limits);
  return { method: METHOD, wafer, orientation: wafer.orientation, test, cells: result, ...stats, limits, bounds, omittedCoordinates,
    population: view.selection, provenance: sourceProvenance(view), warnings: [
      ...(result.some((c) => c.attempts > 1) ? ['Repeated coordinates use the last selected PRR. Earlier attempts remain in the device table.'] : []),
      ...(stats.summary.missing + stats.summary.invalid ? ['Missing or invalid final measurements have no value color.'] : []),
      ...(limits ? ['The displayed limits are an explicit preview; source results are unchanged.'] : []),
    ] };
}

export async function waferGallery(view, options = {}) {
  const mode = options.mode ?? 'bin', sort = options.sort ?? 'file';
  if (!['bin', 'passFail', 'value', '3d'].includes(mode) || !['file', 'yield'].includes(sort)) invalid('Choose a supported gallery mode and order.');
  const numeric = mode === 'value' || mode === '3d', test = numeric ? studyTests([options.testKey])[0] : null;
  const offset = boundedInteger(options.offset ?? 0, 0, 100000, 'Gallery offset'), limit = boundedInteger(options.limit ?? 8, 1, 12, 'Gallery page size');
  const wafers = listWafers(view).items;
  if (wafers.length > 10000) invalid('Gallery supports up to 10,000 wafer scopes. Select fewer sources or comparison groups.');
  const summaries = new Map(wafers.map((w) => [JSON.stringify([w.group, w.datasetId, w.id, w.head]), { wafer: w, passed: 0, failed: 0, unknown: 0, attempts: 0 }]));
  // Device outcome rollups stream independently of the map page and do not keep
  // one coordinate per wafer in memory just to sort thousands of wafer titles.
  for await (const row of iterateReportDevices(view)) {
    const summary = summaries.get(waferScope(row)); if (!summary) continue;
    summary.attempts++; summary[{ pass: 'passed', fail: 'failed', unknown: 'unknown' }[deviceOutcome(row.part_flags)]]++;
  }
  const ordered = [...summaries.values()].map((r) => ({ ...r, yield: r.passed + r.failed ? r.passed / (r.passed + r.failed) : null }));
  ordered.sort((a, b) => sort === 'yield' ? (a.yield ?? Infinity) - (b.yield ?? Infinity) || a.wafer.sourceName.localeCompare(b.wafer.sourceName) || a.wafer.id - b.wafer.id
    : a.wafer.sourceName.localeCompare(b.wafer.sourceName) || a.wafer.group - b.wafer.group || a.wafer.id - b.wafer.id);
  const page = ordered.slice(offset, offset + limit), selected = new Map(page.map((r) => [JSON.stringify([r.wafer.group, r.wafer.datasetId, r.wafer.id, r.wafer.head]), { ...r, cells: new Map() }]));
  let coordinates = 0;
  const iterator = numeric ? iterateJoinedDevices(view, { tests: [test.key] }) : iterateReportDevices(view);
  for await (const row of iterator) {
    const tile = selected.get(waferScope(row)); if (!tile || !knownCoordinate(row)) continue;
    if (!tile.cells.has(position(row)) && ++coordinates > MAX_WAFER_COORDINATES) invalid('This gallery page exceeds 50,000 coordinates. Reduce its page size.');
    addWaferCell(tile.cells, row, test?.key);
  }
  const yields = ordered.map((r) => r.yield).filter((n) => n != null), tiles = [...selected.values()].map(({ cells, ...r }) => {
    const result = [...cells.values()]; return { ...r, cells: result, orientation: r.wafer.orientation, ...summarizeWaferCells(result) };
  });
  const ranges = tiles.map((t) => t.summary).filter((s) => s.valid), total = ordered.length;
  return { method: METHOD, mode, test, tiles, offset, total, nextOffset: offset + tiles.length < total ? offset + tiles.length : null,
    summary: { wafers: total, meanYield: yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : null, minYield: yields.length ? Math.min(...yields) : null, maxYield: yields.length ? Math.max(...yields) : null },
    range: ranges.length ? { low: Math.min(...ranges.map((s) => s.min)), high: Math.max(...ranges.map((s) => s.max)) } : null,
    warnings: ['Tile yield counts selected attempts; map colors use the latest selected attempt at each coordinate.', ...(numeric ? ['Value colors share a range across the displayed page.'] : [])] };
}

export function validateSpatialRecipe(options = {}) {
  const method = options.method ?? 'gdbn'; if (!['gdbn', 'cd'].includes(method)) invalid('Choose GDBN or cluster detection.');
  const radius = boundedInteger(options.radius ?? 1, 1, 10, 'Neighbor radius'), connectivity = options.connectivity ?? 8;
  if (![4, 8].includes(connectivity)) invalid('Connectivity must be four or eight.');
  const minFailNeighbors = boundedInteger(options.minFailNeighbors ?? 3, 1, 440, 'Minimum failing neighbors');
  const minNeighbors = boundedInteger(options.minNeighbors ?? 1, 1, 440, 'Minimum known neighbors');
  const minCluster = boundedInteger(options.minCluster ?? 3, 1, MAX_WAFER_COORDINATES, 'Minimum failed cluster size');
  const failFraction = options.failFraction ?? 0.5;
  if (!Number.isFinite(failFraction) || failFraction < 0 || failFraction > 1) invalid('Fail fraction must be between zero and one.');
  const calcMode = options.calcMode ?? 'uniform'; if (!['uniform', 'weighted'].includes(calcMode)) invalid('Choose uniform or distance-weighted cluster density.');
  if (options.exemptBins != null && (!Array.isArray(options.exemptBins) || options.exemptBins.length > 65536)) invalid('Exempt bins must be a bounded bin list.');
  const exemptBins = [...new Set((options.exemptBins ?? []).map((b) => boundedInteger(b, 0, 65535, 'Exempt bin')))];
  return { method, version: 'spatial-preview-v1', algorithm: method === 'gdbn' ? 'known-neighbor-count' : 'failed-component-neighborhood', radius, connectivity,
    minFailNeighbors, minNeighbors, minCluster, failFraction, calcMode, exemptBins,
    failBin: boundedInteger(options.failBin ?? (method === 'gdbn' ? 7 : 9), 0, 65534, 'Failure bin') };
}
function neighborOffsets(recipe, radius = recipe.radius) {
  const offsets = [];
  for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
    const distance = recipe.connectivity === 4 ? Math.abs(dx) + Math.abs(dy) : Math.max(Math.abs(dx), Math.abs(dy));
    if (distance > 0 && distance <= radius) offsets.push({ dx, dy, distance });
  }
  return offsets;
}

/** Deterministic, bounded open method. Independent of DOM and SQLite for review. */
export async function screenSpatialCells(cells, input = {}, check = async () => {}) {
  const recipe = validateSpatialRecipe(input), exemptions = new Set(recipe.exemptBins);
  if (!Array.isArray(cells) || cells.length > MAX_WAFER_COORDINATES) invalid('Spatial screening supports up to 50,000 wafer coordinates.');
  const eligible = new Map(), decisions = new Map(), offsets = neighborOffsets(recipe), connectedOffsets = neighborOffsets(recipe, 1);
  const counts = { coordinates: cells.length, eligible: 0, passed: 0, failed: 0, unknown: 0, exempt: 0, screened: 0, flagged: 0, newlyFailed: 0, clusters: 0, qualifyingClusters: 0 };
  for (const cell of cells) {
    if (exemptions.has(cell.softBin)) { counts.exempt++; continue; }
    if (cell.outcome === 'unknown') { counts.unknown++; continue; }
    counts.eligible++; counts[cell.outcome === 'pass' ? 'passed' : 'failed']++;
    const key = JSON.stringify([cell.group, cell.datasetId, cell.waferId, cell.head, cell.x, cell.y]);
    if (eligible.has(key)) invalid('Spatial input contains duplicate scoped coordinates.');
    eligible.set(key, cell);
  }
  const keyAt = (cell, dx = 0, dy = 0) => JSON.stringify([cell.group, cell.datasetId, cell.waferId, cell.head, cell.x + dx, cell.y + dy]);
  const mark = (cell, info) => {
    const key = keyAt(cell), previous = decisions.get(key);
    if (previous) { previous.clusterIds.push(...(info.clusterIds ?? [])); return; }
    decisions.set(key, { ...cell, fromBin: cell.softBin, toBin: recipe.failBin, projectedOutcome: 'fail', reason: recipe.method, ...info });
  };
  let visited = 0;
  if (recipe.method === 'gdbn') {
    for (const cell of eligible.values()) {
      if (cell.outcome !== 'pass') continue;
      let neighbors = 0, failing = 0;
      for (const { dx, dy } of offsets) { const n = eligible.get(keyAt(cell, dx, dy)); if (n) { neighbors++; failing += Number(n.outcome === 'fail'); } }
      counts.screened++;
      if (neighbors >= recipe.minNeighbors && failing >= recipe.minFailNeighbors) mark(cell, { neighbors, failingNeighbors: failing });
      if (++visited % 256 === 0) await check();
    }
  } else {
    const seen = new Set();
    for (const [key, seed] of eligible) {
      if (seed.outcome !== 'fail' || seen.has(key)) continue;
      const component = [seed]; seen.add(key);
      for (let index = 0; index < component.length; index++) {
        const member = component[index];
        for (const { dx, dy } of connectedOffsets) {
          const candidate = keyAt(member, dx, dy), neighbor = eligible.get(candidate);
          if (neighbor?.outcome === 'fail' && !seen.has(candidate)) { seen.add(candidate); component.push(neighbor); }
        }
        if (++visited % 256 === 0) await check();
      }
      counts.clusters++; if (component.length < recipe.minCluster) continue;
      const footprint = new Map();
      for (const member of component) {
        footprint.set(keyAt(member), { cell: member, weight: 1 });
        for (const { dx, dy, distance } of offsets) {
          const candidate = keyAt(member, dx, dy), neighbor = eligible.get(candidate);
          if (!neighbor) continue;
          const weight = recipe.calcMode === 'weighted' ? 1 / (1 + distance) : 1;
          if (!footprint.has(candidate) || footprint.get(candidate).weight < weight) footprint.set(candidate, { cell: neighbor, weight });
        }
        if (++visited % 256 === 0) await check();
      }
      let totalWeight = 0, failingWeight = 0;
      for (const { cell, weight } of footprint.values()) { totalWeight += weight; failingWeight += cell.outcome === 'fail' ? weight : 0; }
      const density = totalWeight ? failingWeight / totalWeight : 0; counts.screened += component.length;
      if (density < recipe.failFraction) continue;
      counts.qualifyingClusters++;
      for (const { cell } of footprint.values()) if (cell.outcome === 'pass' || cell.softBin !== recipe.failBin) mark(cell, { clusterIds: [counts.clusters], clusterSize: component.length, failFraction: density, neighborhood: footprint.size });
    }
  }
  counts.flagged = decisions.size; counts.newlyFailed = [...decisions.values()].filter((d) => d.outcome === 'pass').length;
  await check();
  return { recipe, counts, decisions: [...decisions.values()] };
}

export async function spatialScreening(view, options = {}) {
  const recipe = validateSpatialRecipe(options), wafer = options.waferKey ? chooseWafer(view, options.waferKey) : null;
  const scopes = new Map(); let coordinates = 0, omittedCoordinates = 0, attempts = 0;
  for await (const row of iterateReportDevices(view)) {
    if (wafer && !inWafer(row, wafer)) continue;
    attempts++; if (!knownCoordinate(row)) { omittedCoordinates++; continue; }
    const scope = waferScope(row); if (!scopes.has(scope)) scopes.set(scope, new Map());
    const cells = scopes.get(scope);
    if (!cells.has(position(row)) && ++coordinates > MAX_WAFER_COORDINATES) invalid('Screening exceeds 50,000 coordinates. Select one wafer or fewer sources.');
    addWaferCell(cells, row);
  }
  const allCells = [...scopes.values()].flatMap((m) => [...m.values()]);
  const result = await screenSpatialCells(allCells, recipe, () => checkpoint(view, coordinates, 'viewer-spatial-preview'));
  return { method: METHOD, ...result, attempts, omittedCoordinates, wafers: scopes.size, population: view.selection, provenance: sourceProvenance(view),
    warnings: ['Preview only. Original measurements and bins are unchanged.', 'One latest selected PRR per source, WIR, head and coordinate. Missing/unknown/exempt neighbors do not count as passing dies.',
      ...(recipe.method === 'cd' ? ['Cluster detection uses the documented failed-component neighborhood method; it does not claim a proprietary vendor formula.'] : [])] };
}
