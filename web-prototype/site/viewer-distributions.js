import { analyzeTest } from './viewer-analysis.js';
import { overview } from './viewer-tables.js';
import { scanStudyObservations, studyTests, STUDY_METHOD_VERSION } from './viewer-population.js';
import { boundedInteger } from './viewer-model.js';

const seriesKeys = (source, row, options) => [
  ...(options.seriesBy !== 'site' || options.includeAggregate === true ? [JSON.stringify([source.groupId, row.head, null])] : []),
  ...(options.seriesBy === 'site' ? [JSON.stringify([source.groupId, row.head, row.site])] : []),
];
export function quantileRanks(count, probability) {
  const position = (count - 1) * probability;
  return { low: Math.floor(position), high: Math.ceil(position), fraction: position - Math.floor(position) };
}

export async function compareDistributions(view, options) {
  const [test] = studyTests([options.testKey ?? options.tests?.[0]]), maxCdfPoints = boundedInteger(options.maxCdfPoints ?? 1001, 2, 2001, 'CDF points');
  const analyzed = await analyzeTest(view, { ...options, testKey: test.key });
  const working = new Map(analyzed.series.map((series) => {
    const n = series.stats.count, ranks = [0.25, 0.5, 0.75].map((p) => quantileRanks(n, p));
    return [series.key, { series, seen: 0, ranks, values: new Map(), cdf: [], cdfIndex: 0, cdfCount: Math.min(n, maxCdfPoints) }];
  }));
  await scanStudyObservations(view, test.key, (row, source) => {
    for (const key of seriesKeys(source, row, options)) {
      const item = working.get(key); if (!item) continue;
      const rank = item.seen++;
      for (const target of item.ranks) if (rank === target.low || rank === target.high) item.values.set(rank, row.value);
      const target = item.cdfCount <= 1 ? 0 : Math.floor(item.cdfIndex * (item.series.stats.count - 1) / (item.cdfCount - 1));
      if (rank === target) {
        item.cdfIndex++;
        // Preserve an exact CDF ordinate at the eventual end of a tied run.
        const point = { value: row.value, probability: item.seen / item.series.stats.count };
        if (item.cdf.at(-1)?.value === row.value) Object.assign(item.cdf.at(-1), point); else item.cdf.push(point);
      } else if (item.cdf.at(-1)?.value === row.value) item.cdf.at(-1).probability = item.seen / item.series.stats.count;
    }
  });
  for (const item of working.values()) {
    const quantiles = item.ranks.map(({ low, high, fraction }) => item.values.has(low) ? item.values.get(low) * (1 - fraction) + item.values.get(high) * fraction : null);
    const [q1, median, q3] = quantiles, iqr = q1 === null ? null : q3 - q1;
    item.distribution = { q1, median, q3, fenceLow: iqr === null ? null : q1 - 1.5 * iqr, fenceHigh: iqr === null ? null : q3 + 1.5 * iqr,
      whiskerLow: null, whiskerHigh: null, outlierCount: 0, cdf: item.cdf, cdfReduced: item.series.stats.count > maxCdfPoints, quantileMethod: 'linear (n-1)*p', whiskerMethod: 'Observed values inside inclusive 1.5 IQR fences' };
  }
  await scanStudyObservations(view, test.key, (row, source) => {
    for (const key of seriesKeys(source, row, options)) {
      const distribution = working.get(key)?.distribution; if (!distribution) continue;
      if (row.value < distribution.fenceLow || row.value > distribution.fenceHigh) distribution.outlierCount++;
      else { distribution.whiskerLow ??= row.value; distribution.whiskerHigh = row.value; }
    }
  });
  const dut = await overview(view);
  return { ...analyzed, methodVersion: STUDY_METHOD_VERSION, dutGroups: dut.groups,
    series: analyzed.series.map((series) => ({ ...series, stats: { ...series.stats,
      cp: series.stats.cpkReason ? null : (series.stats.usl - series.stats.lsl) / (6 * series.stats.stdev),
      testYield: series.stats.pass + series.stats.fail ? series.stats.pass / (series.stats.pass + series.stats.fail) : null },
      distribution: working.get(series.key).distribution })),
    warnings: [...analyzed.warnings, ...(analyzed.series.some((series) => series.stats.count > maxCdfPoints) ? ['CDF display is reduced; quantiles, whiskers and counts use all eligible observations.'] : [])] };
}
