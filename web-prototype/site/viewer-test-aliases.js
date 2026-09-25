import { parseTestKey } from './viewer-model.js';

/** Explicit comparison mapping only: no cache identities or source records change. */
export function validateTestAliases(selection, mappings) {
  if (!Array.isArray(mappings) || mappings.length !== selection.groups.length || mappings.length < 2) throw Error('Choose one test for each of at least two comparison groups.');
  const tests = mappings.map((key) => ({ ...parseTestKey(key), key }));
  const first = tests[0];
  if (tests.some(test => test.family === 20 || test.family !== first.family || test.unit !== first.unit || test.channel !== first.channel)) throw Error('Equivalent tests must share the same numeric record family, recorded unit and channel. Units are not converted.');
  return tests;
}

export async function compareTestAliases(api, mappings, options) {
  const selection = structuredClone(api.state.selection), tests = validateTestAliases(selection, mappings), series = [], warnings = [], populations = [];
  for (const [index, group] of selection.groups.entries()) {
    api.checkCancelled();
    const result = await api.client().viewer('advanced', { ...selection, groups: [group] }, { ...options, kind: 'distributions', testKey: tests[index].key });
    api.checkCancelled();
    if (!result.series.some(item => item.stats.total > 0)) throw Error(`No selected observations for ${group.name}: ${tests[index].name}. Choose a test recorded in that group.`);
    for (const item of result.series) series.push({ ...item, key: JSON.stringify([index, item.key]), group: index, label: `${item.label} · ${tests[index].name}`, mappedTest: tests[index] });
    warnings.push(...result.warnings); populations.push({ group: index, ...result.population });
  }
  return { test: { ...tests[0], name: 'Explicit test comparison' }, series, warnings: [...new Set(warnings)], populations,
    methodVersion: 'explicit-test-aliases-v1', recipe: { selection, mappings: tests.map((test, group) => ({ group, testKey: test.key })) },
    populationPolicy: 'Each group uses its explicitly selected test; original identities, units and filters are preserved. No tests are merged in the library.' };
}
