import { tr } from './viewer-i18n.js';
import { element } from './library-home-view.js';
import { button, section, disclosure, detail, warnings, table, selectField, fmt, testTitle, pager, compactChart } from './viewer-view.js';
import { renderStudyChart, renderValueRange, heatColor } from './viewer-study-charts.js';
import { renderHistogram, renderBins, renderWafer } from './viewer-charts.js';
import { showDownload } from './viewer-actions.js';
import { orientationForDisplay, yieldColor } from './viewer-preferences.js';
import { compareTestAliases } from './viewer-test-aliases.js';

export const STUDY_TOOLS = [
  ['dashboard', 'Dashboard'], ['compare', 'Compare files / lots'], ['distributions', 'Compare distributions'],
  ['scatter', 'Scatter 2D / 3D'], ['values', 'Wafer values / 3D'], ['gallery', 'Wafer gallery'],
  ['pat', 'PAT'], ['patLots', 'PAT by lot'], ['spatial', 'GDBN / cluster detection'], ['reclassify', 'Combined screening'], ['whatif', 'What-If limits'],
  ['pvt', 'PVT corners'], ['grr', 'Gauge R&R'], ['authoring', 'Edit / convert'], ['documents', 'Reports'],
];
const number = v => Number.isFinite(v) ? fmt(v, 4) : '—';
const percent = v => v == null ? '—' : `${(v * 100).toFixed(2)}%`;
const labels={count:'N',mean:'Mean',stdev:'Sigma',cp:'Cp',cpk:'Cpk',testYield:'Test yield',q1:'Q1',median:'Median',q3:'Q3',whiskerLow:'Lower whisker',whiskerHigh:'Upper whisker',outlierCount:'Outliers',referenceCount:'Reference N',low:'Lower limit',high:'Upper limit',r2:'r²',r:'r',ss:'SS',df:'df',ms:'MS'};
const labelFor=key=>tr(labels[key]??key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase()));
export function metrics(container, rows) {
  const box = element('div', undefined, 'viewer-metrics');
  for (const [label, value] of rows) { const item = element('article'); item.append(element('small', labelFor(label)), element('strong', String(value ?? '—'))); box.append(item); }
  container.append(box);
}
export function inputField(container, label, value = '', type = 'text', options = {}) {
  const wrapper = element('label', label), input = element('input'); input.type = type; input.value = value; input.setAttribute('aria-label', label);
  for (const [key, setting] of Object.entries(options)) input[key] = setting;
  wrapper.append(input); container.append(wrapper); return input;
}
export function submitForm(container, title, api, work) {
  const form = element('form', undefined, 'study-form'), fields = element('div', undefined, 'viewer-toolbar'), submit = element('button', title, 'button primary'), output = element('div', undefined, 'study-result');
  submit.type = 'submit'; form.append(fields, submit); container.append(form, output);
  form.addEventListener('submit', event => { event.preventDefault(); api.run(async () => { api.clearCharts?.(); output.replaceChildren(); await work(output); }); });
  return { fields, output, form };
}
function jsonDownload(value, filename) { showDownload(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename); }
function resultActions(container, result, filename, api, { screening = false } = {}) {
  const bar = element('div', undefined, 'viewer-toolbar');
  bar.append(button(tr('Save result & recipe'), () => jsonDownload(result, filename)));
  if (screening && result.decisions?.length) bar.append(button(tr('Export screened copy…'), () => api.run(async () => {
    const { exportScreening } = await import('./viewer-authoring-ui.js'); await exportScreening(container, result, api);
  })));
  if(screening)bar.append(button(tr('Preview wafer changes'),()=>api.run(async()=>{
    const maps=await api.query('advanced',{kind:'waferGallery',mode:'passFail',limit:6});
    container.querySelector('[data-screening-maps]')?.remove();api.clearCharts?.();
    const grid=element('div',undefined,'study-gallery');grid.dataset.screeningMaps='';container.append(grid);
    const keys=new Set((result.decisions??[]).map(d=>JSON.stringify([d.group,d.datasetId,d.deviceId])));
    for(const tile of maps.tiles){const box=element('section');grid.append(box);drawValueMap(box,{...tile,cells:tile.cells.map(c=>({...c,screened:keys.has(JSON.stringify([c.group,c.datasetId,c.deviceId]))}))},null,'passFail',api);}
    if(!maps.tiles.length)grid.append(element('p',tr('No wafer coordinates in this selection.')));
    grid.append(element('p',`Orange marks screened devices; other colors show original outcomes. Maps show the latest selected attempt at each coordinate. ${maps.tiles.length} of ${maps.total} wafers shown.`, 'viewer-help'));
  })));
  container.append(bar);
  detail(container, tr('Method & provenance'), Object.fromEntries(Object.entries(result).filter(([key]) => ['method','methodVersion','populationPolicy','population','sources','provenance','recipe','warnings'].includes(key))));
}
function drawDecisionTable(container, result, api) {
  table(container, [
    { label: tr('Device'), value: r => button(r.partId || `Attempt ${r.deviceId}`, () => api.openPoint(r), '') },
    { label: tr('Head / site'), value: r => `${r.head} / ${r.site}` }, { label: tr('XY'), value: r => `${r.x}, ${r.y}` },
    { label: tr('Reason'), value: r => r.reason ?? (r.reasons ?? []).map(v => `${number(v.value)} outside ${number(v.low)}…${number(v.high)}`).join('; '), wrap: true },
    { label: tr('Projected'), value: r => r.projectedOutcome ?? 'fail' },
  ], (result.decisions ?? []).slice(0, 1000), { label: tr('Screening decisions') });
  if (result.decisions?.length > 1000 || result.decisionsTruncated) warnings(container, ['Showing the first 1,000 decisions. The saved result identifies whether the worker preview is truncated.']);
}
function testSelector(container, label, tests, current) { return selectField(container, label, tests.map(test => [test.key, testTitle(test)]), current ?? tests[0]?.key, () => {}); }
function pickedTests(state) { return [...state.selected.values()].filter(t => t.family !== 20); }
function sourceChoices(state) { return [...new Set(state.selection.groups.flatMap(g => g.datasetIds))].map(id => state.datasets.find(d => d.id === id)); }
function asChart(api, container, options) {
  const onPick=point=>{if(typeof point.datasetId==='string'&&Number.isSafeInteger(point.deviceId)&&Number.isInteger(point.group))api.openPoint(point);};
  const chart = renderStudyChart(container, { settings: api.state.settings, onPick, ...options }); api.addChart(chart); return chart;
}
function stackedFailureBars(container,items,settings){
  const box=disclosure(container,tr('Failure bins by file / lot')),max=Math.max(1,...items.map(r=>r.failed));
  for(const item of items){const row=element('div',undefined,'study-stacked-row'),bar=element('div',undefined,'study-stacked-bar');row.append(element('span',item.sourceName??item.lotId??'Unspecified'),bar,element('span',`${item.failed} failed`));
    for(const bin of (item.softBins??[]).filter(b=>b.failed)){const segment=element('span');segment.style.width=`${bin.failed/max*100}%`;segment.style.background=settings.binColors[bin.number]??`hsl(${(bin.number*67)%360} 55% 43%)`;segment.title=`Bin ${bin.number}: ${bin.failed} failed attempts`;segment.setAttribute('role','img');segment.setAttribute('aria-label',segment.title);bar.append(segment);}box.append(row);}
}

export async function renderStudy(container, tool, api) {
  const state = api.state, tests = pickedTests(state), query = options => api.query('advanced', options);
  container.append(element('h2', tr(STUDY_TOOLS.find(([key]) => key === tool)?.[1] ?? 'Study')));
  if (tool === 'authoring') { return (await import('./viewer-authoring-ui.js')).renderAuthoring(container, api); }
  if (tool === 'documents') { return (await import('./viewer-document-ui.js')).renderDocumentTools(container, api); }
  if (['dashboard', 'compare'].includes(tool)) {
    const data = await query({ kind: 'dashboard' });
    metrics(container, [['Devices', data.totals.total], ['Pass', data.totals.passed], ['Fail', data.totals.failed], ['Unknown', data.totals.unknown], ['Yield', percent(data.totals.yield)], ['Mean time', `${number(data.totals.timeMeanMs)} ms`]]);
    const sources = section(container, tr('Files / lots')), switcher = element('div', undefined, 'viewer-toolbar'), grid = element('div'); sources.append(switcher, grid);
    let chart;
    const draw = kind => {
      grid.replaceChildren(); chart?.destroy(); const items = kind === 'lot' ? data.lots : data.files;
      chart = asChart(api, grid, { title: tr('Yield by population'), axes: [tr('Population rank (lowest yield first)'), tr('Yield (%)')], series: [{ kind: 'bar', label: tr('Yield'), points: items.map((r, i) => ({ x: i + 1, y: r.yield == null ? null : 100 * r.yield, label: r.sourceName ?? r.lotId ?? 'Unspecified lot' })) },{kind:'line',label:tr('Weighted aggregate yield'),points:items.map((r,i)=>({x:i+1,y:data.totals.yield==null?null:data.totals.yield*100}))}] });
      table(grid, [{ label: tr(kind === 'lot' ? 'Lot' : 'File'), value: r => r.sourceName ?? r.lotId ?? 'Unspecified', wrap: true }, ...[['total','Devices'],['passed','Pass'],['failed','Fail'],['unknown','Unknown']].map(([key,label]) => ({label:tr(label),value:r=>r[key]})), {label:tr('Yield'),value:r=>percent(r.yield)}, {label:tr('Mean time (ms)'),value:r=>number(r.timeMeanMs)}, {label:tr('Fail bins'),value:r=>(r.softBins??[]).filter(b=>b.failed).map(b=>`${b.number}: ${b.failed}`).join(' · '),wrap:true}], items, {label:tr('File and lot comparison')});
      stackedFailureBars(grid,items,state.settings);
    };
    selectField(switcher, tr('Group by'), [['file',tr('File')],['lot',tr('Lot')]], 'file', draw); draw('file');
    table(section(container, tr('Sites')), [{label:tr('Group'),value:r=>state.selection.groups[r.group].name},{label:tr('Head / site'),value:r=>`${r.head} / ${r.site}`},{label:tr('Devices'),value:r=>r.total},{label:tr('Pass'),value:r=>r.passed},{label:tr('Fail'),value:r=>r.failed},{label:tr('Yield'),value:r=>percent(r.yield)},{label:tr('Mean time (ms)'),value:r=>number(r.timeMeanMs)}],data.sites);
    table(section(container, tr('Top failing tests')), [{label:tr('Test'),value:r=>`${r.number} · ${r.name??''}`,wrap:true},{label:tr('Failing devices'),value:r=>r.failureDevices},{label:tr('Failed executions'),value:r=>r.failedExecutions}],data.topFailTests?.items??[]);
    const metadata=disclosure(container,tr('Source details & timing'));
    for(const file of data.files){const box=disclosure(metadata,file.sourceName);table(box,[{label:tr('Field'),value:r=>r[0]},{label:tr('Value'),value:r=>r[1]??'Not recorded',wrap:true}],['lotId','sublotId','device','testProgram','programRevision','tester','operator','dateCode','flow','specName','specVersion','elapsedSeconds','timeMinMs','timeMeanMs','timeMaxMs'].map(key=>[key,file[key]]).concat(['setupTime','startTime','finishTime'].map(key=>[`${key} (UTC)`,file[key]?new Date(file[key]*1000).toISOString():null])));}
    const binBox=section(container,tr('Bins')),binControls=element('div',undefined,'viewer-toolbar'),binCanvas=element('div');binBox.append(binControls,binCanvas);let binChartHandle;
    const drawBins=kind=>{binChartHandle?.destroy();binChartHandle=renderBins(binCanvas,{series:data.bins[kind].series,settings:state.settings,title:kind==='soft'?'Software bins':'Hardware bins',onPick:()=>{}});api.addChart(binChartHandle);compactChart(binCanvas);};selectField(binControls,tr('Bin family'),[['soft',tr('Software')],['hard',tr('Hardware')]],'soft',drawBins);drawBins('soft');
    if(data.waferPreview) api.addChart(renderWafer(section(container,tr('Wafer preview')), {...data.waferPreview,settings:state.settings,onPick:()=>{}}));
    resultActions(container,data,'dashboard.json',api); return;
  }
  if(tool==='patLots'||tool==='reclassify'){const methods=await import('./viewer-pat-recipes.js');return methods[tool==='patLots'?'renderPatLotRecipes':'renderCombinedScreening'](container,api,{resultActions,drawDecisionTable,metrics});}
  if (!tests.length && !['gallery','spatial','grr'].includes(tool)) { container.append(element('p',tr('Select a numeric test from the catalog.'))); return; }
  if (tool === 'scatter') {
    const choices = tests.length > 1 ? tests : state.catalog.items.filter(t=>t.family!==20);
    let x,y,z,dimension;
    const form = submitForm(container,tr('Plot correlation'),api,async output=>{
      const result = await query({kind:'correlation',tests:[x.value,y.value,...(dimension.value==='3'?[z.value]:[])],seriesBy:state.seriesBy});
      metrics(output,Object.entries(result.population)); warnings(output,result.warnings);
      const specLimits=result.tests.map((_,i)=>{const limits=result.series.map(s=>s.limits[i]);return limits.length&&limits.every(v=>!v.varying&&v.low===limits[0].low&&v.high===limits[0].high)?{low:limits[0].low,high:limits[0].high}:{};});
      const plotSeries=result.tests.length===3?['pass','fail','unknown'].map(outcome=>({label:outcome,color:outcome==='pass'?state.settings.passColor:outcome==='fail'?state.settings.failColor:'#949ca6',points:result.series.flatMap(s=>s.points.filter(p=>p.outcome===outcome).map(p=>({...p,label:s.label})))})):result.series;
      asChart(api,output,{title:tr('Device correlation'),threeD:result.tests.length===3,specLimits,axes:result.tests.map(t=>`${testTitle(t)} (${t.unit||'unitless'})`),series:plotSeries});
      table(output,[{label:tr('Population'),value:r=>r.label,wrap:true},{label:tr('Paired devices'),value:r=>r.count},...['r','r2','slope','intercept'].map(key=>({label:labelFor(key),value:r=>number(r.regression[key])})),{label:tr('Note'),value:r=>r.regression.reason??'',wrap:true}],result.series);
      resultActions(output,result,'correlation.json',api);
    });
    dimension=selectField(form.fields,tr('Dimensions'),[['2',tr('2D')],['3',tr('3D')]],'2',v=>{z.closest('label').hidden=v!=='3';});
    x=testSelector(form.fields,tr('X test'),choices,choices[0]?.key); y=testSelector(form.fields,tr('Y test'),choices,choices[1]?.key); z=testSelector(form.fields,tr('Z test'),choices,choices[2]?.key); z.closest('label').hidden=true; return;
  }
  if(tool==='distributions') {
    let selected, mode, mapping;const aliasFields=[];
    const form=submitForm(container,tr('Compare'),api,async output=>{
      const options={kind:'distributions',testKey:selected.value,seriesBy:state.seriesBy,includeAggregate:state.includeAggregate,bins:state.settings.bins};
      const result=mapping?.checked?await compareTestAliases(api,aliasFields.map(field=>field.value),options):await query(options);
      warnings(output,result.warnings);
      if(mode.value==='histogram'){
        const groups=mapping?.checked?state.selection.groups.map((group,index)=>({title:group.name,series:result.series.filter(series=>series.group===index)})):[{title:testTitle(result.test),series:result.series}];
        if(mapping?.checked)output.append(element('p',tr('Each mapped group uses its own histogram range.'),'viewer-help'));
        for(const group of groups){const chart=element('div');output.append(chart);api.addChart(renderHistogram(chart,{title:group.title,series:group.series,settings:state.settings,xLabel:result.test.unit,onPick:()=>{}}));compactChart(chart);}
      }
      else if(mode.value==='cdf') asChart(api,output,{title:tr('Empirical CDF'),axes:[result.test.unit||tr('Test value'),tr('Cumulative fraction')],series:result.series.map(s=>({label:s.label,kind:'step',points:[...(s.distribution.cdf.length?[{x:s.distribution.cdf[0].value,y:0}]:[]),...s.distribution.cdf.map(p=>({x:p.value,y:p.probability}))]}))});
      else if(mode.value==='box') {
        const rows=result.series.map((s,i)=>({...s,index:i+1}));
        asChart(api,output,{title:tr('Quartiles and Tukey whiskers'),axes:[tr('Population'),tr('Test value')],series:rows.map(s=>({label:s.label,kind:'line',points:[{x:s.index,y:s.distribution.median,box:s.distribution}]}))});
      } else asChart(api,output,{title:mode.selectedOptions[0].textContent,axes:[tr('Population'),tr(mode.value)],series:result.series.map((s,i)=>({label:s.label,kind:'bar',points:[{x:i+1,y:s.stats[mode.value]}]}))});
      table(output,[{label:tr('Population'),value:r=>r.label,wrap:true},...['count','mean','stdev','cp','cpk','testYield'].map(key=>({label:labelFor(key),value:r=>key==='testYield'?percent(r.stats[key]):number(r.stats[key])})),...['q1','median','q3','whiskerLow','whiskerHigh','outlierCount'].map(key=>({label:labelFor(key),value:r=>number(r.distribution[key])}))],result.series);
      resultActions(output,result,'distributions.json',api);
    });
    selected=testSelector(form.fields,tr('Test'),tests); mode=selectField(form.fields,tr('Plot'),[['histogram',tr('Histogram')],['cdf',tr('CDF')],['box',tr('Box / whiskers')],['mean',tr('Mean')],['stdev',tr('Sigma')],['cpk',tr('Cpk')],['cp',tr('Cp')],['testYield',tr('Test yield')]],'cdf',()=>{});
    if(state.selection.groups.length>1){
      const aliases=disclosure(form.form,tr('Compare differently named tests')),label=element('label');mapping=element('input');mapping.type='checkbox';label.append(mapping,document.createTextNode(tr('Use an explicit test for each group')));aliases.append(label);
      const fields=element('div',undefined,'viewer-toolbar');fields.hidden=true;aliases.append(fields);
      for(const [index,group] of state.selection.groups.entries())aliasFields.push(testSelector(fields,`${tr('Test for')} ${group.name}`,tests,tests[index]?.key??tests[0]?.key));
      aliases.append(element('p',tr('Select the equivalent tests in the catalog first. Family, unit and channel must match.'),'viewer-help'));
      mapping.addEventListener('change',()=>{fields.hidden=!mapping.checked;selected.disabled=mapping.checked;});
    }return;
  }
  if (tool==='values'||tool==='gallery') {
    const wafers=await api.query('wafers'); if(!wafers.items.length){container.append(element('p',tr('No wafer coordinates in this selection.')));return;}
    let test,wafer,mode,sort,low,high;let offset=0;
    const draw=async output=>{
      if(tool==='gallery') {
        const result=await query({kind:'waferGallery',testKey:test.value||undefined,mode:mode.value,sort:sort.value,offset,limit:6});
        metrics(output,[['Wafers',result.total],['Mean yield',percent(result.summary.meanYield)],['Minimum',percent(result.summary.minYield)],['Maximum',percent(result.summary.maxYield)]]);
        const grid=element('div',undefined,'study-gallery');output.append(grid);
        for(const tile of result.tiles){const box=element('section');const border=yieldColor(tile.yield,api.state.settings);if(border)box.style.borderTop=`4px solid ${border}`;grid.append(box);drawValueMap(box,tile,result.range,mode.value,api);box.append(button(tr('Open wafer'),()=>api.openWafer(tile.wafer.key)));}
        pager(output,{...result,items:result.tiles},()=>api.run(async()=>{offset=Math.max(0,offset-6);api.clearCharts?.();output.replaceChildren();await draw(output);}),()=>api.run(async()=>{offset=result.nextOffset;api.clearCharts?.();output.replaceChildren();await draw(output);}));warnings(output,result.warnings);
      } else {
        const limits=low.value!==''||high.value!==''?{low:low.value===''?null:low.valueAsNumber,high:high.value===''?null:high.valueAsNumber}:undefined;
        const result=await query({kind:wafer.value==='aggregate'?'waferAggregate':'waferValues',testKey:test.value,waferKey:wafer.value,limits});
        warnings(output,result.warnings);
        metrics(output,[['Coordinates',result.summary.coordinates],['Valid',result.summary.valid],['Median',number(result.summary.median)],['Missing',result.summary.missing],['Invalid',result.summary.invalid],['Outside limits',result.summary.outliers]]);
        renderValueRange(output,{...result.summary,count:result.summary.valid,low:result.limits?.low,high:result.limits?.high,unit:result.test.unit});
        drawValueMap(output,result,{low:result.summary.min,high:result.summary.max},mode.value,api);
        const histogram=disclosure(output,tr('Value distribution')),chart=element('div');histogram.append(chart);
        api.addChart(renderHistogram(chart,{title:tr('Latest coordinate values'),series:[{key:'wafer-values',label:result.wafer.name,bins:result.histogram,stats:{count:result.summary.valid,mean:result.summary.mean,median:result.summary.median,stdev:result.summary.stdev,lsl:result.limits?.low,usl:result.limits?.high}}],settings:state.settings,xLabel:result.test.unit||'Value',onPick:()=>{}}));compactChart(chart);
        table(disclosure(output,tr('Die values')),[{label:tr('Device / contributors'),value:r=>r.members?`${r.count} valid / ${r.members.length}`:button(r.partId||`Attempt ${r.deviceId}`,()=>api.openPoint(r),'')},{label:tr('X'),value:r=>r.x},{label:tr('Y'),value:r=>r.y},{label:tr('Value'),value:r=>number(r.value)},{label:tr('In limits'),value:r=>r.inRange==null?'—':r.inRange?'Yes':'No'},{label:tr('Bin'),value:r=>r.softBin??'—'}],result.cells.slice(0,1000));
        if(result.cells.length>1000)warnings(output,[`The die table shows the first 1,000 of ${result.cells.length} coordinates; the map and saved result include all coordinates.`]);
        resultActions(output,result,'wafer-values.json',api);
      }
    };
    const form=submitForm(container,tr('Show wafers'),api,draw);
    test=testSelector(form.fields,tr('Test'),tests);
    if(tool==='values')wafer=selectField(form.fields,tr('Wafer'),[...wafers.items.map(w=>[w.key,`${w.sourceName} · ${w.name}`]),['aggregate',tr('Mean at matching coordinates')]],wafers.items[0].key,value=>{low.disabled=high.disabled=value==='aggregate';});
    mode=selectField(form.fields,tr('Map'),tool==='gallery'?[['bin',tr('Bins')],['passFail',tr('Pass / fail')],['value',tr('Values')],['3d',tr('3D values')]]:[['value',tr('Values')],['3d',tr('3D values')]],tests.length?'value':'bin',()=>{});
    if(tool==='gallery')sort=selectField(form.fields,tr('Sort'),[['file',tr('File')],['yield',tr('Yield')]],'file',()=>{});
    else{low=inputField(form.fields,tr('Lower limit'),'','number',{step:'any'});high=inputField(form.fields,tr('Upper limit'),'','number',{step:'any'});}return;
  }
  if(['pat','whatif','spatial'].includes(tool)) {
    let fit,k,radius,neighbors,cluster,fraction,method,connectivity,exempt,bin,calcMode,referenceGroups;
    const recipes=[];
    const form=submitForm(container,tr('Preview screening'),api,async output=>{
      const options=tool==='spatial'?{kind:'spatial',method:method.value,radius:radius.valueAsNumber,minFailNeighbors:neighbors.valueAsNumber,minCluster:cluster.valueAsNumber,failFraction:fraction.valueAsNumber,connectivity:Number(connectivity.value),calcMode:calcMode.value,exemptBins:exempt.value.trim()?exempt.value.split(',').map(v=>Number(v.trim())):[],failBin:bin.valueAsNumber}:{kind:'screening',method:tool,fit:fit?.value,k:k?.valueAsNumber,recipes:recipes.map(r=>({testKey:r.key,...(r.low.value!==''?{low:r.low.valueAsNumber}:{}),...(r.high.value!==''?{high:r.high.valueAsNumber}:{}),...(r.bin.value!==''?{failBin:r.bin.valueAsNumber}:{})}))};
      if(referenceGroups?.value.trim())options.referenceGroups=referenceGroups.value.split(',').map(value=>Number(value.trim())-1);
      const result=await query(options);result.exportFailBin=bin.valueAsNumber;
      metrics(output,Object.entries(result.summary??result.counts));warnings(output,result.warnings);
      if(result.tests)table(output,[{label:tr('Test'),value:r=>tests.find(t=>t.key===r.testKey)?.name??r.testKey,wrap:true},...['referenceCount','center','spread','low','high','eligible','excluded','flagged'].map(key=>({label:labelFor(key),value:r=>number(r[key])})),{label:tr('Status'),value:r=>r.reason??'Ready',wrap:true}],result.tests);
      drawDecisionTable(output,result,api);resultActions(output,result,`${tool}-preview.json`,api,{screening:true});
    });
    bin=inputField(form.fields,tr('Failure bin'),tool==='spatial'?7:8,'number',{min:0,max:65534,step:1,required:true});
    if(tool==='spatial'){
      method=selectField(form.fields,tr('Rule'),[['gdbn',tr('Good die / bad neighborhood')],['cd',tr('Cluster detection')]],'gdbn',()=>{});
      radius=inputField(form.fields,tr('Radius'),1,'number',{min:1,max:10,required:true});neighbors=inputField(form.fields,tr('Failing neighbors'),3,'number',{min:1,max:440,required:true});cluster=inputField(form.fields,tr('Minimum cluster'),3,'number',{min:1,max:50000,required:true});fraction=inputField(form.fields,tr('Fail fraction'),.5,'number',{min:0,max:1,step:.01,required:true});connectivity=selectField(form.fields,tr('Connectivity'),[['4',tr('4 neighbors')],['8',tr('8 neighbors')]],'8',()=>{});calcMode=selectField(form.fields,tr('Density weights'),[['uniform',tr('Uniform')],['weighted',tr('Distance weighted')]],'uniform',()=>{});exempt=inputField(form.fields,tr('Exempt bins (comma separated)'));
    } else {
      if(tool==='pat'){fit=selectField(form.fields,tr('Fit'),[['sigma',tr('Mean / sample sigma')],['mad',tr('Median / 1.4826 MAD')]],'sigma',()=>{});k=inputField(form.fields,tr('Multiplier'),3,'number',{min:.5,max:10,step:.1,required:true});const references=disclosure(form.form,tr('Reference population'));referenceGroups=inputField(references,tr('Reference groups (comma separated)'));references.append(element('p',state.selection.groups.map((group,index)=>`${index+1}: ${group.name}`).join(' · '),'viewer-help'));}
      const limits=element('div',undefined,'study-limit-grid');form.form.insertBefore(limits,form.form.lastChild);
      for(const test of tests){const row=element('div',undefined,'viewer-toolbar');row.append(element('strong',testTitle(test)));limits.append(row);recipes.push({key:test.key,low:inputField(row,tr('Low limit'),'','number',{step:'any'}),high:inputField(row,tr('High limit'),'','number',{step:'any'}),bin:inputField(row,tr('Test fail bin (optional)'),'','number',{min:0,max:65534,step:1})});}
      form.form.append(element('p',tool==='pat'?'Blank limits use the fitted reference. At least 30 known-passing devices are required.':'Limits apply to selected tests. Existing device failures are never promoted to passing by this preview.','viewer-help'));
    }
    detail(container,tr('Screening method'),tool==='spatial'?{GDBN:'Count known failing neighbors within the radius.',CD:'Find connected failed components, then screen their observed neighborhood by fail density.',population:'Latest selected PRR per source / wafer / head / XY. Missing, unknown and exempt neighbors are excluded.'}:{reference:'Known-passing devices and valid known-passing final test results.',fit:'Mean ± k × sample sigma, or median ± k × 1.4826 MAD.',limits:'Inclusive; invalid or missing values are excluded. Preview does not change the library.'});return;
  }
  if(tool==='pvt') {
    let test;const corners=[];
    const form=submitForm(container,tr('Compare corners'),api,async output=>{
      const result=await query({kind:'pvt',testKey:test.value,corners:corners.map(c=>({datasetId:c.id,process:c.process.value,voltage:c.voltage.valueAsNumber,temperature:c.temperature.valueAsNumber}))});warnings(output,result.warnings);
      asChart(api,output,{title:tr('PVT response'),axes:[tr('Voltage (V)'),tr('Temperature (°C)'),tr('Mean test value')],threeD:true,series:result.corners.map(c=>({label:c.process,points:[{x:c.voltage,y:c.temperature,z:c.stats.mean,label:c.process}]}))});
      table(output,[...['process','voltage','temperature','devices','missing','invalid'].map(key=>({label:labelFor(key),value:r=>r[key]})),...['mean','stdev','min','max','cpk'].map(key=>({label:labelFor(key),value:r=>number(r.stats[key])}))],result.corners);resultActions(output,result,'pvt.json',api);
    });test=testSelector(form.fields,tr('Test'),tests);
    for(const source of sourceChoices(state)){const row=element('div',undefined,'viewer-toolbar');row.append(element('strong',source.name));form.form.insertBefore(row,form.form.lastChild);corners.push({id:source.id,process:inputField(row,tr('Process corner'),'','text',{required:true,maxLength:80}),voltage:inputField(row,tr('Voltage (V)'),'','number',{required:true,step:'any'}),temperature:inputField(row,tr('Temperature (°C)'),'','number',{required:true,step:'any'})});}return;
  }
  if(tool==='grr') {
    let test,file,tolerance;
    const form=submitForm(container,tr('Calculate Gauge R&R'),api,async output=>{
      const selected=file.files[0];if(!selected||selected.size>4*1024*1024)throw new Error('Choose a mapping CSV up to 4 MiB.');
      const rows=parseMappingCsv(await selected.text());
      const result=await query({kind:'grr',testKey:test.value,rows,tolerance:tolerance.value===''?null:tolerance.valueAsNumber});
      metrics(output,Object.entries(result.design));warnings(output,result.warnings);
      table(output,[{label:tr('Component'),value:r=>r.name},...['variance','standardDeviation','studyVariation','percentContribution','percentStudyVariation','percentTolerance'].map(key=>({label:labelFor(key),value:r=>number(r[key])}))],result.components);
      table(disclosure(output,tr('ANOVA')),['source','ss','df','ms'].map(key=>({label:labelFor(key),value:r=>typeof r[key]==='number'?number(r[key]):r[key]})),result.anova);
      resultActions(output,result,'gauge-rr.json',api);
    });test=testSelector(form.fields,tr('Test'),tests);file=inputField(form.fields,tr('Design CSV'),'','file',{accept:'.csv',required:true});tolerance=inputField(form.fields,tr('Tolerance width (optional)'),'','number',{min:0,step:'any'});
    container.append(element('p',tr('Map each source attempt to a part, operator and trial. Use a balanced crossed design with at least 2 parts × 2 operators × 2 trials.'),'viewer-help'));
    container.append(button(tr('Download mapping template'),()=>api.run(async()=>{
      const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
      const rows=['datasetId,deviceId,recordedPartId,part,operator,trial'];let offset=0;
      do{const page=await api.query('devices',{offset,limit:200});if(page.total>20000)throw new Error('Narrow the selection to at most 20,000 attempts for a Gauge design.');
        for(const row of page.items){const label=/^[\s]*[=+@-]/.test(row.part_id??'')?"'"+row.part_id:row.part_id;rows.push([row.dataset_id,row.id,label,'','',''].map(quote).join(','));}offset=page.nextOffset;
      }while(offset!=null);
      showDownload(new Blob([rows.join('\r\n')+'\r\n'],{type:'text/csv'}),'gauge-design.csv');
    })));
    return;
  }
}
function drawValueMap(container,result,range,mode,api){
  const lo=range?.low??0,hi=range?.high??1;
  const contributors=element('div');
  asChart(api,container,{title:`${result.wafer?.sourceName??''} · ${result.wafer?.name??'Wafer'}`,wafer:true,threeD:mode==='3d',orientation:orientationForDisplay(result.orientation,api.state.settings),axes:[tr('Die X'),tr('Die Y'),tr('Test value')],onPick:row=>{if(!row.members){api.openPoint(row);return;}contributors.replaceChildren();table(contributors,[{label:tr('Device'),value:r=>button(r.partId||`Attempt ${r.deviceId}`,()=>api.openPoint(r),'')},{label:tr('Value'),value:r=>number(r.value)},{label:tr('Source'),value:r=>api.state.datasets.find(d=>d.id===r.datasetId)?.name??r.datasetId,wrap:true}],row.members.slice(0,1000));if(row.members.length>1000)warnings(contributors,[`Showing 1,000 of ${row.members.length} contributors.`]);},valueRange:['value','3d'].includes(mode)?[lo,hi]:null,series:[{label:'',points:result.cells.map(c=>({...c,z:c.value,color:c.screened?'#bd701d':mode==='passFail'?(c.outcome==='pass'?api.state.settings.passColor:c.outcome==='fail'?api.state.settings.failColor:'#aeb7c2'):mode==='bin'?api.state.settings.binColors[c.softBin]??`hsl(${(c.softBin*67)%360} 55% 48%)`:heatColor(c.value,lo,hi)}))}]});container.append(contributors);
}
/** RFC4180 subset with strict headers; no expression evaluation or type inference. */
export function parseMappingCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"'){if(field)throw new Error('Invalid CSV quote.');quoted=true;}else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw new Error('Unclosed CSV field.');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  const header=rows.shift()?.map(v=>v.replace(/^\uFEFF/,'').trim());const required=['datasetId','deviceId','part','operator','trial'];
  if(!header||required.some(key=>!header.includes(key))||new Set(header).size!==header.length)throw new Error('CSV headers must include datasetId,deviceId,part,operator,trial.');
  return rows.filter(r=>r.some(v=>v.trim())).map(r=>{if(r.length!==header.length)throw new Error('CSV row width differs from its header.');const item=Object.fromEntries(header.map((key,i)=>[key,r[i].trim()]));item.deviceId=Number(item.deviceId);return item;});
}
