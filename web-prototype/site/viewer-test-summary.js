import { element } from './library-home-view.js';
import { button, table, pager, testTitle, fmt } from './viewer-view.js';
import { loadTestSummary, testSummaryPage, summaryValue, SUMMARY_PAGE } from './viewer-summary-model.js';

export async function renderTestSummary(container, context) {
  const { summary } = context;
  const content = element('section', undefined, 'viewer-all-tests'); container.append(content);
  if (!summary.complete && !summary.paused) {
    content.append(element('p', 'Reading test statistics…', 'viewer-help'));
    try { await loadTestSummary(summary, context); }
    finally { drawSummary(content, context); }
  } else drawSummary(content, context);
}

function drawSummary(container, context) {
  const { summary, settings, onChange, onOpen, onHelp } = context;
  container.replaceChildren();
  const heading = element('div', undefined, 'summary-heading');
  heading.append(element('h2', 'All test statistics'), button('Column help', () => onHelp('terms'), 'quiet-button'));
  container.append(heading);
  const progress = `${summary.done.toLocaleString()} / ${summary.total?.toLocaleString() ?? '…'} tests`;
  container.append(element('p', `${summary.complete ? progress : `Partial results · ${progress}`} · One row per test and population.`, 'viewer-help'));
  if (!summary.complete) {
    const note = element('div', undefined, 'viewer-warning');
    note.append(element('p', 'The scan is not complete. Search and sort apply only to the completed results.'),
      button('Resume scan', () => { summary.paused = false; onChange(); })); container.append(note);
  }
  if (settings.skipTests.enabled) container.append(element('p', 'All tests are shown here, including tests hidden by display rules.', 'viewer-help'));
  const toolbar = element('form', undefined, 'viewer-toolbar summary-search');
  const label = element('label', 'Find in statistics'), input = element('input');
  input.type = 'search'; input.maxLength = 128; input.value = summary.query; input.placeholder = 'Test, unit or population';
  input.id = 'viewer-summary-query'; label.htmlFor = input.id; label.append(input);
  const submit = element('button', 'Find', 'button secondary'); submit.type = 'submit';
  toolbar.append(label, submit); toolbar.addEventListener('submit', event => {
    event.preventDefault(); summary.query = input.value; summary.offset = 0; onChange();
  }); container.append(toolbar);

  const number = (row, key) => {
    const value = summaryValue(row, key);
    const text = element('span', value == null || !Number.isFinite(value) ? '—' : fmt(value, settings.precision, settings.notation));
    if (value == null) text.title = row.test.family === 20 ? 'FTR records contain test status flags, not physical measurements.' :
      row.changingLimits && ['lsl','usl'].includes(key) ? 'Limits change within this population.' :
      ['cp','cpk'].includes(key) ? row.cpkReason ?? 'Capability is not available for this population.' : 'Not available.';
    return text;
  };
  const columns = [
    { label: 'Test', sortKey: 'number', wrap: true, value: row => {
      const box = element('div'), open = button(testTitle(row.test), () => onOpen(row.test), 'summary-open-test');
      open.title = 'Open histogram'; open.setAttribute('aria-label', `Open histogram for ${testTitle(row.test)}`);
      box.append(open, element('small', `${({10:'PTR',15:'MPR',20:'FTR'})[row.test.family] ?? 'Test'}${row.test.channel ? ` · ${row.test.channel}` : ''}`));
      return box;
    } },
    { label: 'Population', sortKey: 'label', wrap: true, value: row => row.label },
    { label: 'Unit', sortKey: 'unit', value: row => row.test.unit || '—' },
    ...[['total','Recorded'],['count','Valid'],['fail','Fail']].map(([key,label]) => ({ label, sortKey: key, numeric: true,
      value: row => row[key]?.toLocaleString() ?? '—', className: row => key === 'fail' && row.fail > 0 ? 'value-fail' : 'value-neutral' })),
    ...[['mean','Mean'],['median','Median'],['stdev','Population σ'],['min','Min'],['max','Max'],['lsl','Low limit'],['usl','High limit'],['cp','Cp'],['cpk','Cpk']].map(([key,label]) => ({ label, sortKey: key, numeric: true,
      value: row => number(row,key), className: row => key === 'cpk' && summaryValue(row,key) != null && row.cpk < settings.cpkThreshold ? 'value-warning' : 'value-neutral' })),
    ...[['pass','Pass'],['unknown','Unknown'],['excluded','Excluded']].map(([key,label]) => ({ label, sortKey: key, numeric: true, value: row => row[key]?.toLocaleString() ?? '—' })),
    { label: 'Test yield', sortKey: 'testYield', numeric: true, value: row => row.testYield == null ? '—' : `${fmt(row.testYield,settings.precision,settings.notation)}%` },
  ];
  const page = testSummaryPage(summary);
  table(container, columns, page.items, { label: 'All test statistics', sort: summary.sort, direction: summary.direction,
    onSort: key => { summary.direction = summary.sort === key && summary.direction === 'asc' ? 'desc' : 'asc'; summary.sort = key; summary.offset = 0; onChange(); } });
  if (!page.total) container.append(element('p', summary.complete ? 'No tests match this search and scope.' : 'No completed results match this search.', 'viewer-help'));
  if (page.total > SUMMARY_PAGE) pager(container, page,
    () => { summary.offset = Math.max(0, page.offset - SUMMARY_PAGE); onChange(); },
    () => { summary.offset = page.nextOffset; onChange(); });
}
