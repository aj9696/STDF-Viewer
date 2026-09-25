import { tr } from './viewer-i18n.js';
import { element } from './library-home-view.js';
import { selectField, testTitle, fmt, table } from './viewer-view.js';
import { renderTrend, renderHistogram, renderBins, renderWafer } from './viewer-charts.js';
import { showDownload } from './viewer-actions.js';
import { createDocumentBatch, normalizeReportLayout } from './viewer-document-formats.js';

const SECTION_CHOICES = [['summary','Summary and source information'],['statistics','Selected test statistics and Cpk ranking'],['histogram','Histograms'],['trend','Test order trends'],['bins','Hardware and software bins'],['wafer','Wafer maps'],['sites','Site yield and test time'],['deviceTrends','Device yield and test time trends'],['retest','Retest counts'],['pcr','Recorded part count summaries'],['datalog','Datalog notes'],['pat','PAT screening'],['worstCpk','Full catalogue worst Cpk histograms (scan all tests)']];
const number = value => Number.isFinite(value) ? fmt(value, 5) : 'Unavailable';
const percent = value => value == null ? 'Unavailable' : `${(100 * value).toFixed(2)}%`;
const sourceIds = selection => [...new Set(selection.groups.flatMap(group => group.datasetIds))];
const checkbox = (parent, label, value, checked = false) => { const wrapper = element('label', undefined, 'export-option'), box = element('input'); box.type = 'checkbox'; box.value = value; box.checked = checked; wrapper.append(box, document.createTextNode(label)); parent.append(wrapper); return box; };

export async function collectDocumentReport(api, choice, { checkCancelled = () => {}, onProgress = () => {} } = {}) {
  const state = api.state, selectedTests = [...state.selected.values()], selected = structuredClone(choice.selection), sections = [];
  const query = async (action, options = {}) => { checkCancelled(); const value = await api.client().viewer(action, selected, options); checkCancelled(); return value; };
  const overview = await query('overview'), numeric = selectedTests.filter(test => test.family !== 20);
  const selectedScope = { attempts: selected.attempts ?? 'current', heads: selected.heads ?? 'all', sites: selected.sites ?? 'all', groups: selected.groups };
  const report = { title: choice.title || 'Semiconductor test data report', createdAt: new Date().toISOString(), scope: choice.scopeLabel, filenameStem: choice.filenameStem,
    layout: normalizeReportLayout(choice.layout),
    provenance: { selection: selectedScope, sources: overview.sources.map(source => ({ datasetId: source.datasetId, name: source.name, sha256: source.sha256 })),
      tests: selectedTests.map(test => ({ key: test.key, name: test.name, number: test.number, unit: test.unit })), methods: 'Base STDF units; exact full-population descriptive statistics; population standard deviation. Trends display bounded extrema; PAT uses final executions and known-passing devices.' }, sections };
  const host = element('div'); Object.assign(host.style, { position: 'fixed', left: '-12000px', top: '0', width: '1040px', background: '#fff' }); document.body.append(host);
  const capture = async (title, renderer, data) => {
    checkCancelled(); const chart = renderer(host, { ...data, title, settings: state.settings, onPick: () => {} });
    try { const image = await chart.exportPng(); checkCancelled(); sections.push({ title, image }); }
    finally { chart.destroy(); host.replaceChildren(); }
  };
  try {
    if (choice.sections.includes('summary')) {
      sections.push({ title: 'Selected population', paragraphs: [`Attempts: ${selectedScope.attempts}. Heads: ${JSON.stringify(selectedScope.heads)}. Sites: ${JSON.stringify(selectedScope.sites)}.`],
        table: { headers: ['Group','Pass','Fail','Unknown','Yield'], rows: overview.groups.map(group => [group.name,group.passed,group.failed,group.unknown,percent(group.yield)]) } });
      for (const source of overview.sources) {
        const mir = source.metadata.find(record => record.type === 1 && record.subtype === 10)?.fields ?? {};
        sections.push({ title: source.name, paragraphs: [`Source ID ${source.datasetId}`, `SHA256 ${source.sha256}`],
          table: { headers: ['Field','Value'], rows: [['Lot',mir.LOT_ID ?? ''],['Part type',mir.PART_TYP ?? ''],['Test program',mir.JOB_NAM ?? ''],['Tester',mir.NODE_NAM ?? ''],['Source bytes',source.sourceBytes],['Recorded devices',source.counts.devices]] } });
      }
    }
    if (choice.sections.some(section => ['statistics','histogram','trend'].includes(section))) {
      if (!selectedTests.length) throw Error('Select at least one test for statistics or charts.');
      const statistics = [];
      for (const test of selectedTests) {
        const data = await query('analyze', { testKey: test.key, bins: state.settings.bins, seriesBy: state.seriesBy, includeAggregate: state.includeAggregate });
        for (const series of data.series) statistics.push({ title: testTitle(test), unit: test.unit, series: series.label, ...series.stats });
        if (choice.sections.includes('histogram')) await capture(`${testTitle(test)} histogram`, renderHistogram, { series: data.series, xLabel: test.unit || 'Base units' });
        if (choice.sections.includes('trend')) await capture(`${testTitle(test)} test order`, renderTrend, { series: data.series, yLabel: test.unit || 'Base units' });
      }
      if (choice.sections.includes('statistics')) {
        statistics.sort((a,b) => (a.cpk ?? Infinity) - (b.cpk ?? Infinity));
        sections.push({ title: 'Selected test statistics', paragraphs: ['Ranked by available Cpk from lowest to highest. All eligible recorded measurements contribute; unknown and invalid results remain separate.'],
          table: { headers: ['Test','Population','N','Mean','Median','Sigma','Cpk','Unit'], rows: statistics.map(row => [row.title,row.series,row.count,number(row.mean),number(row.median),number(row.stdev),number(row.cpk),row.unit]) } });
        const unavailable = statistics.filter(row => row.cpkReason);
        if (unavailable.length) sections.push({ title: 'Capability availability', table: { headers: ['Test','Population','Reason'], rows: unavailable.map(row => [row.title,row.series,row.cpkReason]) } });
      }
    }
    if (choice.sections.includes('bins')) for (const kind of ['hard','soft']) {
      const data = await query('bins', { kind, seriesBy: state.seriesBy }); await capture(`${kind === 'hard' ? 'Hardware' : 'Software'} bins`, renderBins, data);
      sections.push({ title: `${kind === 'hard' ? 'Hardware' : 'Software'} bin counts`, table: { headers: ['Population','Bin','Name','Count','Percent'], rows: data.series.flatMap(series => series.bins.map(bin => [series.label,bin.number,bin.name,bin.count,`${bin.percent.toFixed(2)}%`])) } });
    }
    if (choice.sections.includes('worstCpk')) {
      let offset = 0, scanned = 0, unavailable = 0; const worst = [];
      while (true) {
        const catalog = await query('tests', { offset, limit: 200 });
        if (catalog.total > 20000) throw Error('The full-catalogue report scan is limited to 20,000 test identities. Narrow the source selection.');
        for (const test of catalog.items) {
          checkCancelled(); if (test.family === 20) continue;
          const analysis = await query('analyze', { testKey: test.key, bins: state.settings.bins, seriesBy: state.seriesBy, includeAggregate: state.includeAggregate });
          const values = analysis.series.map(series => series.stats.cpk).filter(Number.isFinite); scanned++;
          if (!values.length) unavailable++;
          else { worst.push({ test, analysis, cpk: Math.min(...values) }); worst.sort((a,b) => a.cpk - b.cpk || a.test.number - b.test.number); if (worst.length > 6) worst.pop(); }
          onProgress({ phase: 'document-catalogue', completed: scanned, total: catalog.total });
        }
        if (catalog.nextOffset == null) break; offset = catalog.nextOffset;
      }
      report.provenance.catalogueScan = { scannedNumericTests: scanned, unavailableCpk: unavailable, displayedWorstTests: worst.length };
      sections.push({ title: 'Full catalogue capability scan', paragraphs: [`Scanned ${scanned} numeric test identities. ${unavailable} had no available Cpk. The lowest six available test Cpk values determine the following histograms; functional status tests are excluded.`],
        table: { headers: ['Test','Worst population Cpk','Unit'], rows: worst.map(item => [testTitle(item.test),number(item.cpk),item.test.unit]) } });
      for (const item of worst) await capture(`${testTitle(item.test)} worst Cpk histogram`, renderHistogram, { series: item.analysis.series, xLabel: item.test.unit || 'Base units' });
    }
    if (choice.sections.includes('wafer')) {
      const wafers = await query('wafers'); if (wafers.items.length > 16) throw Error('Document reports support up to 16 wafer maps. Select one lot or fewer sources.');
      for (const wafer of wafers.items) await capture(`${wafer.name} ${wafer.sourceName}`, renderWafer, await query('wafer', { waferKey: wafer.key }));
      if (!wafers.items.length) sections.push({ title: 'Wafer maps', paragraphs: ['No wafer coordinates are recorded in this selection.'] });
    }
    if (choice.sections.includes('sites') || choice.sections.includes('deviceTrends')) {
      const data = await query('advanced', { kind: 'dashboard', topFailures: false, waferPreview: false });
      if (choice.sections.includes('sites')) sections.push({ title: 'Site yield and timing', table: { headers: ['Group','Head','Site','Pass','Fail','Unknown','Yield','Mean time ms'],
        rows: data.sites.map(site => [selected.groups[site.group].name,site.head,site.site,site.passed,site.failed,site.unknown,percent(site.yield),number(site.timeMeanMs)]) } });
      if (choice.sections.includes('deviceTrends')) {
        if (!data.deviceTrends) throw Error('Device trend provider is unavailable.');
        const makeSeries = (item, field, percent = false) => ({ key: String(item.group), label: item.label,
          stats: { total: item.attempts, count: field === 'timePoints' ? item.timingCount : item.yieldPointCount },
          points: item[field].map(point => ({ ...point, value: percent ? point.value * 100 : point.value })) });
        await capture('Cumulative device yield by test order', renderTrend, { series: data.deviceTrends.map(item => makeSeries(item, 'yieldPoints', true)), yLabel: 'Known-outcome yield (%)' });
        await capture('Recorded device test time by test order', renderTrend, { series: data.deviceTrends.map(item => makeSeries(item, 'timePoints')), yLabel: 'PRR test time (ms)' });
        sections.push({ title: 'Device trend population', paragraphs: ['Trend displays retain bounded extrema; cumulative yield and counts use every selected device. Unknown outcomes are excluded from the cumulative yield denominator.'] });
      }
    }
    if (choice.sections.includes('retest')) sections.push({ title: 'Explicit retest counts', paragraphs: ['Superseded counts use explicit STDF retest flags and the selected source order; repeated identifiers alone do not imply a retest.'],
      table: { headers: ['Group','All attempts','Explicitly superseded','Selected policy'], rows: overview.groups.map(group => [group.name,group.total,group.superseded,selectedScope.attempts]) } });
    if (choice.sections.includes('datalog')) {
      const records = await query('records', { family: 'datalog', limit: 100 });
      sections.push({ title: 'Datalog notes', paragraphs: [`${records.items.length} of ${records.total} records shown. Use the record workbook for complete record data.`],
        table: { headers: ['Source','Sequence','Record','Content'], rows: records.items.map(record => [record.sourceName,record.seq,`${record.type}/${record.subtype}`,JSON.stringify(record.fields)]) } });
    }
    if (choice.sections.includes('pcr')) {
      const rows = []; let offset = 0;
      while (true) {
        const records = await query('records', { family: 'headers', query: 'PART_CNT', offset, limit: 100 });
        for (const record of records.items.filter(record => record.type === 1 && record.subtype === 30)) {
          const f = record.fields, count = key => f[key] === 4294967295 ? 'Unknown' : f[key] ?? 'Not recorded';
          rows.push([record.sourceName,f.HEAD_NUM,f.SITE_NUM,count('PART_CNT'),count('RTST_CNT'),count('ABRT_CNT'),count('GOOD_CNT'),count('FUNC_CNT')]);
        }
        if (rows.length > 3000) throw Error('The report contains more than 3,000 PCR records. Select fewer sources.');
        if (records.nextOffset == null) break; offset = records.nextOffset;
      }
      sections.push({ title: 'Recorded part count summaries', paragraphs: ['PCR values describe original source summaries, independently of current head, site and retest filters. Head/site 255 denotes a summary scope. Missing or sentinel counts remain unknown.'],
        table: { headers: ['Source','Head','Site','Parts','Retests','Aborts','Good','Functional'], rows } });
    }
    if (choice.sections.includes('pat')) {
      if (!numeric.length) throw Error('Select at least one numeric test for PAT.');
      const result = await query('advanced', { kind: 'screening', method: 'pat', tests: numeric.map(test => test.key), fit: choice.patFit, k: choice.patK, limit: 1000 });
      report.provenance.pat = result.recipe;
      sections.push({ title: 'PAT screening', paragraphs: [`${result.summary.flagged} flagged devices from ${result.summary.eligible} eligible devices; ${result.summary.excluded} excluded. Method ${result.methodVersion}.`, ...result.warnings],
        table: { headers: ['Test','Reference N','Center','Spread','Low','High','Flagged'], rows: result.tests.map(test => [testTitle(numeric.find(item => item.key === test.testKey)),test.referenceCount,number(test.center),number(test.spread),number(test.low),number(test.high),test.flagged]) } });
      if (result.decisions.length) sections.push({ title: 'PAT flagged devices', paragraphs: [`Showing ${result.decisions.length} of ${result.summary.flagged} decisions. This report does not change device disposition.`],
        table: { headers: ['Source','Device','Head','Site','Values'], rows: result.decisions.map(decision => [decision.datasetId,decision.partId || decision.deviceId,decision.head,decision.site,decision.reasons.map(reason => number(reason.value)).join('; ')]) } });
    }
    sections.push({ title: 'Methods and provenance', paragraphs: [report.provenance.methods, `Created ${report.createdAt}. Documents contain selected summary sections and chart images; original STDF remains in the local library.`,
      ...report.provenance.sources.map(source => `${source.name} | ${source.datasetId} | SHA256 ${source.sha256}`)] });
    return report;
  } finally { host.remove(); }
}

export async function renderDocumentTools(container, api) {
  const state = api.state, form = element('form', undefined, 'study-form'), controls = element('div', undefined, 'viewer-toolbar');
  const titleLabel = element('label',tr('Title')), title = element('input'); title.value = 'Semiconductor test data report'; title.maxLength = 200; titleLabel.append(title); controls.append(titleLabel);
  const sources = sourceIds(state.selection).map(id => ({ id, name: state.datasets.find(dataset => dataset.id === id)?.name ?? id }));
  const scope = selectField(controls,tr('Scope'),[['current',tr('Current comparison')],['source',tr('Single source')],['lot',tr('One lot')],['sources',tr('Each source')],['lots',tr('Each lot')],['both',tr('Each source and each lot')]],'current',value => { source.closest('label').hidden = value !== 'source'; lot.closest('label').hidden = value !== 'lot'; });
  const source = selectField(controls,tr('Source'),sources.map(item => [item.id,item.name]),sources[0]?.id,()=>{}); source.closest('label').hidden = true;
  const overview = await api.query('overview'), lots = new Map();
  for (const item of overview.sources) {
    const name = item.metadata.find(record => record.type === 1 && record.subtype === 10)?.fields?.LOT_ID ?? '';
    if (!lots.has(name)) lots.set(name, []); lots.get(name).push(item.datasetId);
  }
  const lot = selectField(controls,tr('Lot'),[...lots.keys()].map(name => [name,name || 'Unspecified lot']),lots.keys().next().value,()=>{}); lot.closest('label').hidden = true;
  const formats = element('fieldset'), formatLegend = element('legend',tr('Formats')); formats.append(formatLegend);
  const formatChecks = [['pdf','PDF'],['docx','Word'],['png','PNG pages'],['jpg','JPEG pages'],['xlsx','Excel summary']].map(([value,label]) => checkbox(formats,tr(label),value,value==='pdf'));
  const sections = element('fieldset'); sections.append(element('legend',tr('Sections')));
  const layout = element('details'), layoutFields = element('div', undefined, 'viewer-toolbar'), layoutInputs = {};
  layout.append(element('summary', tr('Page layout')), layoutFields);
  for (const [key, label, value, min, max, step] of [['pageWidthMm', 'Page width (mm)', 210, 148, 420, .1], ['pageHeightMm', 'Page height (mm)', 297, 148, 594, .1], ['imageWidthPx', 'Image width (pixels)', 1200, 800, 2400, 1]]) {
    const wrapper = element('label', tr(label)), field = element('input'); Object.assign(field, { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step), required: true }); wrapper.append(field); layoutFields.append(wrapper); layoutInputs[key] = field;
  }
  const sectionChecks = SECTION_CHOICES.map(([value,label]) => checkbox(sections,tr(label),value,['summary','statistics','histogram'].includes(value)));
  const pat = element('details'), patSummary = element('summary',tr('PAT options')), patFields = element('div',undefined,'viewer-toolbar'); pat.append(patSummary,patFields);
  const fit = selectField(patFields,tr('Fit'),[['sigma',tr('Mean / sample SD')],['mad',tr('Median / MAD')]],'mad',()=>{}), kLabel = element('label',tr('Multiplier')), k = element('input'); k.type='number'; k.value='3'; k.min='0.5'; k.max='10'; k.step='0.1'; kLabel.append(k); patFields.append(kLabel);
  const note = element('p',tr('PDF preserves Unicode as page images. Word text and tables remain editable. Multi-page PNG/JPEG exports are ZIP files.'),'muted');
  const actions = element('div',undefined,'viewer-toolbar'), submit = element('button',tr('Create report'),'button primary'), cancel = element('button',tr('Cancel'),'quiet-button'); submit.type='submit'; cancel.type='button'; cancel.hidden=true; actions.append(submit,cancel);
  const output = element('div',undefined,'study-result'); form.append(controls,formats,sections,pat,layout,note,actions); container.append(form,output); let cancelled=false;
  cancel.addEventListener('click',()=>{cancelled=true;api.client().cancel();});
  form.addEventListener('submit',event=>{
    event.preventDefault(); api.run(async()=>{
      cancelled=false; output.replaceChildren(); cancel.hidden=false;
      const checkCancelled=()=>{api.checkCancelled?.();if(cancelled)throw Error('Report cancelled.');};
      try {
        const selectedSections=sectionChecks.filter(box=>box.checked).map(box=>box.value), selectedFormats=formatChecks.filter(box=>box.checked).map(box=>box.value);
        if(!selectedSections.length||!selectedFormats.length)throw Error('Choose at least one section and format.');
        const pageLayout = normalizeReportLayout(Object.fromEntries(Object.entries(layoutInputs).map(([key, field]) => [key, field.valueAsNumber])));
        const scopes=[];
        if(scope.value==='current')scopes.push({selection:structuredClone(state.selection),scopeLabel:'Current comparison'});
        const addScope=(name,ids,filenameStem)=>scopes.push({selection:{...structuredClone(state.selection),groups:[{name,datasetIds:ids}]},scopeLabel:name,filenameStem});
        if(['source','sources','both'].includes(scope.value))for(const item of sources)if(scope.value!=='source'||item.id===source.value)addScope(item.name,[item.id],`source-${scopes.length+1}-${item.name}`);
        if(['lot','lots','both'].includes(scope.value))for(const [name,ids]of lots)if(scope.value!=='lot'||name===lot.value)addScope(`Lot ${name||'unspecified'}`,ids,`lot-${scopes.length+1}-${name||'unspecified'}`);
        const progress=event=>{output.textContent=event.phase==='document-pages'?`Rendering page ${event.pages}…`:event.phase==='document-catalogue'?`Analyzing test ${event.completed} of ${event.total}…`:event.phase==='document-batch'?`Completed report ${event.completed} of ${event.total}…`:`Writing ${event.completed} of ${event.total} formats…`;};
        const tasks=scopes.map(item=>()=>collectDocumentReport(api,{title:title.value,...item,layout:pageLayout,sections:selectedSections,patFit:fit.value,patK:k.valueAsNumber},{checkCancelled,onProgress:progress}));
        const result=await createDocumentBatch(tasks,{formats:selectedFormats,checkCancelled,onProgress:progress});
        checkCancelled();output.replaceChildren();
        for(const item of result.files)showDownload(item.file,item.filename,()=>api.client().request('viewerDownloads',{action:'release',kind:'document',token:item.token}),`document:${item.token}`);
        table(output,[{label:tr('Completed file'),value:item=>item.filename},{label:tr('Size KiB'),value:item=>(item.bytes/1024).toFixed(1)},{label:tr('Pages'),value:item=>item.pages??(item.format==='xlsx'?'—':tr('Word layout'))}],result.receipt.files);
        const receipt=element('button',tr('Download receipt'),'quiet-button');receipt.type='button';receipt.addEventListener('click',()=>showDownload(new Blob([JSON.stringify(result.receipt,null,2)],{type:'application/json'}),'report-receipt.json'));output.append(receipt);
      } finally {cancel.hidden=true;}
    });
  });
}
