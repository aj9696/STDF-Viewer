import { element } from './library-home-view.js';
import { button, table, disclosure, fmt } from './viewer-view.js';
import { renderStudyChart } from './viewer-study-charts.js';

export function waferSummary(container,result,settings,addChart){
  if(!result.summary)return;
  const s=result.summary,stats=element('div',undefined,'viewer-stat-summary');
  for(const [name,value] of [['Coordinates',s.coordinates],['Attempts',s.attempts],['Pass',s.passed],['Fail',s.failed],['Unknown',s.unknown],['Yield',s.yield==null?'—':`${(s.yield*100).toFixed(2)}%`]]){const item=element('span');item.append(document.createTextNode(`${name} `),element('strong',String(value)));stats.append(item);}container.append(stats);
  const expanded=disclosure(container,'Bin counts & failure Pareto'),rows=result.binSummary??[],failures=rows.filter(r=>r.failed).sort((a,b)=>b.failed-a.failed||a.number-b.number);let cumulative=0;
  const pareto=failures.map((row,i)=>({...row,rank:i+1,share:s.failed?row.failed/s.failed:0,cumulative:s.failed?(cumulative+=row.failed)/s.failed:0}));
  table(expanded,[{label:'Software bin',value:r=>r.number===65535?'Unrecorded':r.number},{label:'Attempts',value:r=>r.count},{label:'Pass',value:r=>r.passed},{label:'Fail',value:r=>r.failed},{label:'Unknown',value:r=>r.unknown}],rows);
  if(pareto.length){
    const shown=pareto.slice(0,50),chart=element('div');expanded.append(chart);
    addChart(renderStudyChart(chart,{title:'Failure Pareto',axes:['Bin rank (see table)','Share of failed attempts (%)'],settings,series:[{label:'Bin failure share',kind:'bar',points:shown.map(r=>({x:r.rank,y:r.share*100,label:`Bin ${r.number}`}))},{label:'Cumulative share',kind:'line',points:shown.map(r=>({x:r.rank,y:r.cumulative*100,label:`Through bin ${r.number}`}))}]}));
    if(pareto.length>50)expanded.append(element('p',`Showing the first 50 of ${pareto.length} failing bins. Cumulative share uses all failed attempts.`,'viewer-help'));
    table(expanded,[{label:'Rank',value:r=>r.rank},{label:'Bin',value:r=>r.number},{label:'Failed',value:r=>r.failed},{label:'Share',value:r=>`${fmt(r.share*100)}%`},{label:'Cumulative',value:r=>`${fmt(r.cumulative*100)}%`}],shown);
  }
  expanded.append(element('p','Counts describe selected mapped attempts within the coordinate range. Unknown outcomes are excluded from yield.','viewer-help'));
}

export function pinnedDieControl(container,result,inspect){
  const label=element('label'),toggle=element('input');toggle.type='checkbox';label.append(toggle,document.createTextNode('Pin clicked die'));const output=element('div');container.append(label,output);
  return pick=>{
    if(!toggle.checked){inspect(pick);return;}
    const die=result.dies.find(d=>d.x===pick.x&&d.y===pick.y);output.replaceChildren();
    if(die){output.append(element('p',`X ${die.x}, Y ${die.y} · Bin ${die.bin} · ${die.attempts} attempts · ${die.failed} failures`),button('Inspect pinned die',()=>inspect(pick)),button('Unpin',()=>output.replaceChildren(),'quiet-button'));}
  };
}
