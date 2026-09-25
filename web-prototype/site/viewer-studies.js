import { PopulationStats, boundedInteger, datasetId, invalid, textOption } from './viewer-model.js';
import { iterateJoinedDevices, studyTests, scanStudyObservations, STUDY_METHOD_VERSION, populationPolicy, sourceProvenance } from './viewer-population.js';

export async function pvtStudy(view, options) {
  const [test] = studyTests([options.testKey]);
  if (!Array.isArray(options.corners) || !options.corners.length || options.corners.length > 8) invalid('Assign one to eight source corners.');
  const assignments = new Map(), buckets = new Map();
  for (const corner of options.corners) {
    const id = datasetId(corner.datasetId), process = textOption(corner.process, 80).trim();
    if (!view.caches.has(id) || assignments.has(id)) invalid('Each corner source must appear once in this workspace.');
    if (!process || !Number.isFinite(corner.voltage) || !Number.isFinite(corner.temperature)) invalid('Each corner requires a process label and finite voltage and temperature.');
    const key = JSON.stringify([process, corner.voltage, corner.temperature]);
    assignments.set(id, key);
    if (!buckets.has(key)) buckets.set(key, { key, process, voltage: corner.voltage, temperature: corner.temperature, sources: [], devices: 0, missing: 0, invalid: 0, moments: new PopulationStats(test.family), seen: 0, middle: [] });
    buckets.get(key).sources.push(id);
  }
  let unassigned = 0;
  for await (const device of iterateJoinedDevices(view, { tests: [test.key] })) {
    const key = assignments.get(device.dataset_id); if (!key) { unassigned++; continue; }
    const bucket = buckets.get(key), row = device.results[test.key]; bucket.devices++;
    if (!row) { bucket.missing++; continue; }
    if (!bucket.moments.add(row)) bucket.invalid++;
  }
  await scanStudyObservations(view, test.key, (row, source) => {
    const bucket = buckets.get(assignments.get(source.datasetId)); if (!bucket) return;
    const rank = bucket.seen++, n = bucket.moments.count;
    if (rank === Math.floor((n - 1) / 2)) bucket.middle.push(row.value / 2);
    if (rank === Math.ceil((n - 1) / 2)) bucket.middle.push(row.value / 2);
  }, { finalOnly: true });
  return { methodVersion: STUDY_METHOD_VERSION, populationPolicy, test, unassignedDevices: unassigned,
    corners: [...buckets.values()].map(({ moments, middle, seen, ...bucket }) => ({ ...bucket, stats: moments.finish(middle.length ? middle.reduce((a, b) => a + b, 0) : null) })),
    warnings: unassigned ? [`${unassigned} devices belong to sources without a corner assignment.`] : [] };
}

function label(value, name) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string' || !value.trim() || value.length > 128) invalid(`${name} must be a nonempty label of at most 128 characters.`);
  return value.trim();
}

/** Balanced two-way random-effects ANOVA, retaining part/operator interaction. */
export function computeGauge(rows, { tolerance = null } = {}) {
  if (!Array.isArray(rows) || rows.length < 8 || rows.length > 20000) invalid('Gauge R&R requires 8–20,000 mapped measurements.');
  if (tolerance !== null && (!Number.isFinite(tolerance) || tolerance <= 0)) invalid('Tolerance must be a positive full specification width.');
  const cells = new Map(), parts = new Map(), operators = new Map(); let grand = 0, count = 0;
  for (const row of rows) {
    const part = label(row.part, 'Part'), operator = label(row.operator, 'Operator'), trial = label(row.trial, 'Trial');
    if (!Number.isFinite(row.value)) invalid('Every mapped Gauge measurement must be finite and valid.');
    const key = JSON.stringify([part, operator]);
    if (!cells.has(key)) cells.set(key, { part, operator, trials: new Set(), count: 0, mean: 0, m2: 0 });
    const cell = cells.get(key);
    if (cell.trials.has(trial)) invalid('A part/operator/trial appears more than once.');
    cell.trials.add(trial); cell.count++;
    const delta = row.value - cell.mean; cell.mean += delta / cell.count; cell.m2 += delta * (row.value - cell.mean);
    count++; grand += (row.value - grand) / count;
    for (const [map, id] of [[parts, part], [operators, operator]]) {
      if (!map.has(id)) map.set(id, { count: 0, mean: 0 });
      const item = map.get(id); item.count++; item.mean += (row.value - item.mean) / item.count;
    }
  }
  const p = parts.size, o = operators.size, repetitions = cells.values().next().value.count;
  if (p < 2 || o < 2 || repetitions < 2 || cells.size !== p * o || [...cells.values()].some((cell) => cell.count !== repetitions)) invalid('Use a complete balanced crossed design with at least two parts, two operators and two repeats per cell.');
  let ssInteraction = 0, ssError = 0;
  for (const cell of cells.values()) {
    const interaction = cell.mean - parts.get(cell.part).mean - operators.get(cell.operator).mean + grand;
    ssInteraction += repetitions * interaction * interaction; ssError += cell.m2;
  }
  const ssPart = o * repetitions * [...parts.values()].reduce((sum, part) => sum + (part.mean - grand) ** 2, 0);
  const ssOperator = p * repetitions * [...operators.values()].reduce((sum, operator) => sum + (operator.mean - grand) ** 2, 0);
  const dfPart = p - 1, dfOperator = o - 1, dfInteraction = (p - 1) * (o - 1), dfError = p * o * (repetitions - 1);
  const msPart = ssPart / dfPart, msOperator = ssOperator / dfOperator, msInteraction = ssInteraction / dfInteraction, msError = ssError / dfError;
  const raw = { repeatability: msError, interaction: (msInteraction - msError) / repetitions,
    operator: (msOperator - msInteraction) / (p * repetitions), part: (msPart - msInteraction) / (o * repetitions) };
  const variances = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Math.max(0, value)]));
  variances.reproducibility = variances.operator + variances.interaction;
  variances.gauge = variances.repeatability + variances.reproducibility;
  variances.total = variances.gauge + variances.part;
  const components = Object.entries(variances).map(([name, variance]) => ({ name, variance, standardDeviation: Math.sqrt(variance), studyVariation: 6 * Math.sqrt(variance),
    percentContribution: variances.total ? 100 * variance / variances.total : null,
    percentStudyVariation: variances.total ? 100 * Math.sqrt(variance / variances.total) : null,
    percentTolerance: tolerance ? 600 * Math.sqrt(variance) / tolerance : null }));
  return { methodVersion: STUDY_METHOD_VERSION, method: 'Balanced crossed random-effects ANOVA with retained interaction',
    design: { parts: p, operators: o, repetitions, measurements: count }, mean: grand, tolerance,
    anova: [{ source: 'Part', ss: ssPart, df: dfPart, ms: msPart }, { source: 'Operator', ss: ssOperator, df: dfOperator, ms: msOperator },
      { source: 'Part × Operator', ss: ssInteraction, df: dfInteraction, ms: msInteraction }, { source: 'Repeatability', ss: ssError, df: dfError, ms: msError }],
    components, rawVarianceComponents: raw, cells: [...cells.values()].map(({ trials, m2, ...cell }) => ({ ...cell, sampleStdev: Math.sqrt(m2 / (cell.count - 1)) })),
    distinctCategories: variances.gauge > 0 ? Math.floor(1.41 * Math.sqrt(variances.part / variances.gauge)) : null,
    warnings: [...(Object.values(raw).some((value) => value < 0) ? ['Negative estimated variance components were clamped to zero. Raw estimates remain available.'] : []),
      ...(variances.total === 0 ? ['All measurements are identical; percentages and distinct categories are unavailable.'] : [])] };
}

export async function gaugeStudy(view, options) {
  const [test] = studyTests([options.testKey]);
  if (!Array.isArray(options.rows) || options.rows.length < 8 || options.rows.length > 20000) invalid('Map 8–20,000 Gauge measurements.');
  const mapping = new Map();
  for (const row of options.rows) {
    const id = datasetId(row.datasetId); boundedInteger(row.deviceId, 1, Number.MAX_SAFE_INTEGER, 'Device');
    if (!view.caches.has(id)) invalid('A Gauge source is outside this workspace.');
    const key = JSON.stringify([id, row.deviceId]);
    if (mapping.has(key)) invalid('A device measurement cannot be reused as an independent Gauge trial.');
    mapping.set(key, { part: label(row.part, 'Part'), operator: label(row.operator, 'Operator'), trial: label(row.trial, 'Trial'), value: null, found: false });
  }
  for await (const device of iterateJoinedDevices(view, { tests: [test.key] })) {
    const row = mapping.get(JSON.stringify([device.dataset_id, device.id])); if (!row || row.found) continue;
    const result = device.results[test.key];
    if (!result?.eligible) invalid('A mapped Gauge device has a missing or invalid final measurement.');
    row.value = result.value; row.found = true;
  }
  if ([...mapping.values()].some((row) => !row.found)) invalid('A mapped Gauge device is outside the selected head/site/attempt scope.');
  return { ...computeGauge([...mapping.values()], { tolerance: options.tolerance ?? null }), test, populationPolicy, sources: sourceProvenance(view) };
}
