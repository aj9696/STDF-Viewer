import { boundedInteger, deviceOutcome, invalid } from './viewer-model.js';
import { studyTests, iterateJoinedDevices, scanStudyObservations, decisionIdentity, sourceProvenance, STUDY_METHOD_VERSION, populationPolicy } from './viewer-population.js';

function recipesFor(options) {
  const input = options.recipes ?? (options.tests ?? []).map((testKey) => ({ testKey }));
  if (!Array.isArray(input) || !input.length || input.length > 12) invalid('Choose one to twelve test recipes.');
  studyTests(input.map((recipe) => recipe?.testKey));
  return input.map((recipe) => {
    for (const bound of ['low', 'high']) if (recipe[bound] != null && !Number.isFinite(recipe[bound])) invalid('Screening limits must be finite numbers.');
    const low = recipe.low ?? null, high = recipe.high ?? null;
    if (low !== null && high !== null && low > high) invalid('The lower limit exceeds the upper limit.');
    if (options.method === 'whatif' && low === null && high === null) invalid('What-If requires at least one explicit limit per test.');
    const failBin = recipe.failBin == null ? null : boundedInteger(recipe.failBin, 0, 65534, 'Test failure bin');
    return { testKey: recipe.testKey, low, high, failBin, manual: low !== null || high !== null };
  });
}

async function referenceMedian(view, testKey, count, groups, distanceFrom = null, sourceFilter = null) {
  let seen = 0, total = 0;
  const low = Math.floor((count - 1) / 2), high = Math.ceil((count - 1) / 2);
  await scanStudyObservations(view, testKey, (row, source) => {
    if (!groups.includes(source.groupId)) return;
    const rank = seen++, value = distanceFrom === null ? row.value : Math.abs(row.value - distanceFrom);
    if (rank === low) total += value / 2;
    if (rank === high) total += value / 2;
  }, { passingOnly: true, finalOnly: true, distanceFrom, sourceFilter });
  return total;
}

async function fitPat(view, recipe, options, groups, sourceFilter) {
  if (recipe.manual) return { ...recipe, referenceCount: 0, center: null, spread: null, reason: null, fit: 'manual' };
  let count = 0, mean = 0, m2 = 0;
  await scanStudyObservations(view, recipe.testKey, (row, source) => {
    if (!groups.includes(source.groupId)) return;
    count++; const delta = row.value - mean; mean += delta / count; m2 += delta * (row.value - mean);
  }, { passingOnly: true, finalOnly: true, order: 'seq', sourceFilter });
  let center = count ? mean : null, spread = count > 1 ? Math.sqrt(Math.max(0, m2 / (count - 1))) : null;
  if (options.fit === 'mad' && count >= 30) {
    center = await referenceMedian(view, recipe.testKey, count, groups, null, sourceFilter);
    spread = 1.4826 * await referenceMedian(view, recipe.testKey, count, groups, center, sourceFilter);
  }
  const reason = count < 30 ? 'At least 30 known-passing reference devices are required.' : !Number.isFinite(spread) || spread <= 0 ? 'Reference dispersion is zero or unavailable.' : null;
  return { ...recipe, referenceCount: count, center, spread, low: reason ? null : center - options.k * spread,
    high: reason ? null : center + options.k * spread, reason, fit: options.fit };
}

export async function previewScreening(view, options) {
  if (!['pat', 'whatif'].includes(options.method)) invalid('Choose PAT or What-If.');
  const recipes = recipesFor(options), limit = boundedInteger(options.limit ?? 1000, 1, 20000, 'Preview rows');
  const fit = options.fit ?? 'sigma', k = options.k ?? 3;
  if (!['sigma', 'mad'].includes(fit) || !Number.isFinite(k) || k < 0.5 || k > 10) invalid('PAT requires sigma/MAD and a multiplier from 0.5 to 10.');
  const groups = options.referenceGroups ?? view.selection.groups.map((_, i) => i);
  if (!Array.isArray(groups) || !groups.length || groups.length > 8 || new Set(groups).size !== groups.length) invalid('Choose distinct reference groups.');
  groups.forEach((group) => boundedInteger(group, 0, view.selection.groups.length - 1, 'Reference group'));
  const datasetIds = options.datasetIds ?? [...new Set(view.sources.map(source => source.datasetId))];
  if (!Array.isArray(datasetIds) || !datasetIds.length || new Set(datasetIds).size !== datasetIds.length || datasetIds.some(id => !view.sources.some(source => source.datasetId === id))) invalid('Screening source membership must name distinct selected files.');
  const candidateGroups = options.candidateGroups ?? view.selection.groups.map((_, index) => index);
  if (!Array.isArray(candidateGroups) || !candidateGroups.length || new Set(candidateGroups).size !== candidateGroups.length) invalid('Choose distinct candidate groups.');
  candidateGroups.forEach(group => boundedInteger(group, 0, view.selection.groups.length - 1, 'Candidate group'));
  const sourceFilter = source => datasetIds.includes(source.datasetId);
  if (options.method === 'pat' && recipes.some(recipe => !recipe.manual)) {
    const references = new Set();
    for (const source of view.sources.filter(source => sourceFilter(source) && groups.includes(source.groupId))) {
      if (references.has(source.datasetId)) invalid('PAT reference groups would count the same source twice. Choose non-overlapping reference groups.');
      references.add(source.datasetId);
    }
  }
  const tests = [];
  for (const recipe of recipes) tests.push(options.method === 'pat' ? await fitPat(view, recipe, { fit, k }, groups, source => sourceFilter(source) && groups.includes(source.groupId)) : { ...recipe, reason: null });
  const summary = { devices: 0, eligible: 0, excluded: 0, flagged: 0, originalPass: 0, originalFail: 0, originalUnknown: 0,
    projectedPass: 0, projectedFail: 0, projectedUnknown: 0, selectedPass: 0, selectedFail: 0, selectedUnknown: 0 };
  const decisions = [], details = tests.map((test) => ({ ...test, eligible: 0, excluded: 0, flagged: 0 }));
  for await (const device of iterateJoinedDevices(view, { tests: tests.map((test) => test.testKey), sourceFilter: source => sourceFilter(source) && candidateGroups.includes(source.groupId) })) {
    summary.devices++;
    const original = deviceOutcome(device.part_flags), title = (value) => value[0].toUpperCase() + value.slice(1);
    summary[`original${title(original)}`]++;
    const reasons = []; let missing = false, anyEligible = false;
    for (const test of details) {
      const row = device.results[test.testKey];
      const eligible = !test.reason && row?.eligible && (options.method === 'whatif' || original === 'pass' && row.outcome === 'pass');
      if (!eligible) { test.excluded++; missing = true; continue; }
      test.eligible++; anyEligible = true;
      if (test.low !== null && row.value < test.low || test.high !== null && row.value > test.high) {
        test.flagged++; reasons.push({ testKey: test.testKey, seq: row.seq, ordinal: row.ordinal, value: row.value, low: test.low, high: test.high, failBin:test.failBin });
      }
    }
    if (anyEligible) summary.eligible++; else summary.excluded++;
    const selected = reasons.length ? 'fail' : missing ? 'unknown' : 'pass';
    summary[`selected${title(selected)}`]++;
    const projected = original === 'pass' && reasons.length ? 'fail' : original;
    summary[`projected${title(projected)}`]++;
    if (reasons.length) {
      summary.flagged++;
      if (decisions.length < limit) decisions.push({ ...decisionIdentity(device), originalOutcome: original, projectedOutcome: projected, toBin:reasons.find(reason=>reason.failBin!=null)?.failBin??null, reasons });
    }
  }
  summary.selectedYield = summary.selectedPass + summary.selectedFail ? summary.selectedPass / (summary.selectedPass + summary.selectedFail) : null;
  summary.projectedYield = summary.projectedPass + summary.projectedFail ? summary.projectedPass / (summary.projectedPass + summary.projectedFail) : null;
  return { methodVersion: STUDY_METHOD_VERSION, method: options.method, populationPolicy, sources: sourceProvenance(view),
    recipe: { method: options.method, fit, k, referenceGroups: [...groups], datasetIds: [...datasetIds], candidateGroups: [...candidateGroups], recipes, selection: view.selection, minimumReference: 30, limitsInclusive: true },
    summary, tests: details, decisions, decisionsTruncated: summary.flagged > decisions.length,
    warnings: [...(options.method === 'whatif' ? ['Overall projection only demotes original passes. Failures may originate in unselected tests.'] : []),
      ...(summary.flagged > decisions.length ? [`Preview includes ${decisions.length} of ${summary.flagged} decisions. Narrow the selection before applying.`] : []),
      ...details.filter((test) => test.reason).map((test) => test.reason)] };
}
