import { capabilityCp } from './viewer-preferences.js';

export const SUMMARY_TEST_LIMIT = 20000, SUMMARY_ROW_LIMIT = 100000, SUMMARY_PAGE = 50;
export function newTestSummary() {
  return { tests: [], catalogOffset: 0, catalogDone: false, total: null, done: 0,
    rows: [], complete: false, paused: false, query: '', sort: 'number', direction: 'asc', offset: 0 };
}

/** Retain compact results only. A cancelled batch is retried, never marked complete. */
export async function loadTestSummary(summary, { query, checkCancelled, seriesBy, includeAggregate, onProgress }) {
  try {
    while (!summary.catalogDone) {
      checkCancelled();
      const page = await query('tests', { offset: summary.catalogOffset, limit: 200, order: 'original', includePins: false });
      summary.total = page.total;
      if (summary.tests.length + page.items.length > SUMMARY_TEST_LIMIT) {
        throw new Error(`This table supports ${SUMMARY_TEST_LIMIT.toLocaleString()} test identities. Select fewer source files in Files & groups.`);
      }
      summary.tests.push(...page.items.map(test => ({ key: test.key })));
      summary.catalogDone = page.nextOffset == null;
      summary.catalogOffset = page.nextOffset;
      onProgress(summary);
    }
    while (summary.done < summary.tests.length) {
      checkCancelled();
      const tests = summary.tests.slice(summary.done, summary.done + 10);
      const result = await query('testSummaries', { tests: tests.map(test => test.key), seriesBy, includeAggregate });
      const rows = result.items.flatMap(summaryRows);
      if (summary.rows.length + rows.length > SUMMARY_ROW_LIMIT) {
        throw new Error(`This table supports ${SUMMARY_ROW_LIMIT.toLocaleString()} population rows. Select fewer source files or use All selected sites.`);
      }
      summary.rows.push(...rows); summary.done += tests.length; onProgress(summary);
    }
    summary.complete = true; summary.paused = false;
  } catch (error) { summary.paused = true; throw error; }
}

export function summaryRows(analysis) {
  const series = analysis.series.length ? analysis.series : [{ key: 'empty', label: 'No observations in this scope',
    stats: { total: 0, count: 0, excluded: 0, pass: 0, fail: 0, unknown: 0, cpkReason: 'No observations in this scope.' } }];
  return series.map(item => ({ test: analysis.test, label: item.label, seriesKey: item.key,
    ...item.stats, cp: capabilityCp(item.stats, analysis.test.family),
    testYield: item.stats.pass + item.stats.fail ? 100 * item.stats.pass / (item.stats.pass + item.stats.fail) : null,
  }));
}

export function summaryValue(row, key) {
  if (['number', 'name', 'unit', 'family', 'channel'].includes(key)) return row.test[key];
  if (row.test.family === 20 && ['mean', 'median', 'stdev', 'min', 'max', 'lsl', 'usl', 'cp', 'cpk'].includes(key)) return null;
  if (row.changingLimits && ['lsl', 'usl'].includes(key)) return null;
  return row[key] ?? null;
}

/** Sort the whole completed result, then page it. Missing values stay last in both directions. */
export function testSummaryPage(summary) {
  const search = summary.query.trim().toLocaleLowerCase();
  const rows = summary.rows.filter(row => !search || [row.test.number, row.test.name, row.test.unit,
    row.test.channel, ({10:'PTR',15:'MPR',20:'FTR'})[row.test.family], row.label].join(' ').toLocaleLowerCase().includes(search));
  const sign = summary.direction === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const x = summaryValue(a, summary.sort), y = summaryValue(b, summary.sort);
    const xMissing = x == null || typeof x === 'number' && !Number.isFinite(x);
    const yMissing = y == null || typeof y === 'number' && !Number.isFinite(y);
    if (xMissing || yMissing) return xMissing === yMissing ? 0 : xMissing ? 1 : -1;
    return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }));
  });
  const offset = Math.min(summary.offset, Math.max(0, Math.floor((rows.length - 1) / SUMMARY_PAGE) * SUMMARY_PAGE));
  return { items: rows.slice(offset, offset + SUMMARY_PAGE), total: rows.length, offset,
    nextOffset: offset + SUMMARY_PAGE < rows.length ? offset + SUMMARY_PAGE : null };
}
