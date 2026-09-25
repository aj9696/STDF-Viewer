import { tr } from './viewer-i18n.js';
import { element } from './library-home-view.js';
import { button, table, detail, warnings, selectField, disclosure } from './viewer-view.js';
import { readRecord } from './stdf-encode.js';
import { EDITABLE_RECORD_FIELDS as EDITABLE, EDIT_DATE_FIELDS, EDIT_FIELD_NOTES, editFieldType } from './stdf-edit-policy.js';
import { showDownload } from './viewer-actions.js';

const field = (container,name,type='text',value='') => { const label=element('label',name),input=element('input');input.type=type;input.value=value;input.setAttribute('aria-label',name);if(type==='number')input.step='any';label.append(input);container.append(label);return input; };
const numeric = (record, field) => /^[UIR]/.test(editFieldType(record,field)) || field === 'RTN_RSLT';
const displayEdit = (edit, value) => value == null ? 'omitted' : EDIT_DATE_FIELDS.has(edit.field) ? new Date(value * 1000).toISOString() : value;
function request(api,action,options){api.checkCancelled();return api.client().viewerAuthoring(action,api.state.selection,options).then(result=>{api.checkCancelled();return result;});}
export function downloadAuthored(result,api){showDownload(result.file,result.filename,()=>api.client().request('viewerDownloads',{action:'release',kind:result.kind,token:result.token}),`${result.kind}:${result.token}`);}
function showReceipt(container,result){const box=element('div',undefined,'study-receipt');box.append(element('p',`${result.filename} · ${result.file.size.toLocaleString()} bytes`));container.append(box);detail(box,tr('Export receipt'),result.receipt);}
function showPlan(container,result,api){
  container.replaceChildren();warnings(container,result.warnings);
  table(container,[{label:tr('Record'),value:r=>`${r.seq} · ${r.name}`},{label:tr('Field'),value:r=>r.field+(r.ordinal==null?'':'['+r.ordinal+']')+(r.reason?' (related)':'')},{label:tr('Before'),value:r=>displayEdit(r,r.before),wrap:true},{label:tr('After'),value:r=>displayEdit(r,r.value),wrap:true}],[...result.plan.edits,...(result.plan.relatedEdits??[])]);
  if(result.plan.rebuiltSummaries?.length)container.append(element('p',`${result.plan.rebuiltSummaries.length} test summaries will receive rebuilt execution counts; unavailable timing/result aggregates will be flagged invalid.`));
  if(result.plan.remap)container.append(element('p',`${result.remappedDevices} device attempts: ${result.plan.remap.kind} bin ${result.plan.remap.from} → ${result.plan.remap.to}; outcome ${result.plan.remap.outcome}.`));
  if(result.plan.deleteDevices?.length)container.append(element('p',`${result.deletedDevices} device attempt${result.deletedDevices===1?'':'s'} removed from the derived copy. Original PIR sequences: ${result.plan.deleteDevices.join(', ')}.`));
  if(result.plan.insertRecords.length||result.plan.deleteSeqs.length)detail(container,tr('Inserted / deleted records'),{insert:result.plan.insertRecords,delete:result.plan.deleteSeqs}).open=true;
  const bar=element('div',undefined,'viewer-toolbar');container.append(bar);
  bar.append(button(tr('Export derived STDF'),()=>api.run(async()=>{const output=await request(api,'export',{datasetId:result.plan.datasetId,plan:result.plan});downloadAuthored(output,api);showReceipt(container,output);})),button(tr('Save edit plan'),()=>showDownload(new Blob([JSON.stringify(result.plan,null,2)],{type:'application/json'}),'stdf-edit-plan.json')));
}
export async function renderAuthoring(container,api){
  const ids=[...new Set(api.state.selection.groups.flatMap(g=>g.datasetIds))],choices=ids.map(id=>[id,api.state.datasets.find(d=>d.id===id)?.name??id]);
  const toolbar=element('div',undefined,'viewer-toolbar'),content=element('div');container.append(toolbar,content);
  const source=selectField(toolbar,tr('Source'),choices,choices[0][0],()=>draw());
  const operation=selectField(toolbar,tr('Operation'),[['fields',tr('Edit fields / results')],['remap',tr('Remap bins')],['records',tr('Add / remove records')],['attempts',tr('Remove device attempts')],['convert',tr('Batch conversion')],['atdf',tr('Import ATDF')],['originalAtdf',tr('Recover original ATDF')],['plan',tr('Open edit plan')]],'fields',()=>draw());
  const draw=()=>{
    source.closest('label').hidden=['convert','atdf'].includes(operation.value);
    content.replaceChildren();const fields=element('div',undefined,'viewer-toolbar'),preview=element('div'),draft={edits:[],insertRecords:[],deleteSeqs:[],deleteDevices:[]};content.append(fields);
    const reason=field(content,tr('Revision reason'));reason.maxLength=500;
    const pending=element('div');content.append(pending);
    const redraw=()=>{pending.replaceChildren();table(pending,[{label:tr('Record'),value:r=>r.seq},{label:tr('Field'),value:r=>r.field},{label:tr('Value'),value:r=>displayEdit(r,r.value),wrap:true}],draft.edits);};
    const previewButton=button(tr('Preview revision'),()=>api.run(async()=>{const result=await request(api,'preview',{datasetId:source.value,reason:reason.value,...draft});showPlan(preview,result,api);}));
    if(operation.value==='fields'){
      const seq=field(fields,tr('Record sequence'),'number');seq.min=1;seq.step=1;
      const editor=element('div',undefined,'viewer-toolbar');content.append(editor);
      fields.append(button(tr('Read record'),()=>api.run(async()=>{
        const raw=await api.query('record',{datasetId:source.value,seq:seq.valueAsNumber});
        const order=api.state.overview.sources.find(s=>s.datasetId===source.value)?.byteOrder;
        const record=readRecord(new Uint8Array(raw.bytes),order);editor.replaceChildren();editor.append(element('strong',record.name));
        const names=EDITABLE[record.name]??[];if(!names.length){editor.append(element('p',tr('This record has no editable fields.')));return;}
        const current=element('output'),value=field(editor,tr('New value')),ordinal=field(editor,tr('Result ordinal'),'number',0);ordinal.min=0;ordinal.step=1;ordinal.closest('label').hidden=record.name!=='MPR';
        const name=selectField(editor,tr('Field'),names.map(n=>[n,n]),names[0],()=>load());editor.append(current);
        function load(){const raw=record.values[name.value],original=Array.isArray(raw)?raw[ordinal.valueAsNumber]:raw,type=editFieldType(record.name,name.value),date=EDIT_DATE_FIELDS.has(name.value);value.type=date?'datetime-local':numeric(record.name,name.value)?'number':'text';value.step=['R4','AR4'].includes(type)?'any':'1';value.removeAttribute('min');value.removeAttribute('max');value.removeAttribute('maxlength');if(date){value.min='1970-01-01T00:00:00';value.max='2106-02-07T06:28:15';value.value=original==null?'':new Date(original*1000).toISOString().slice(0,19);}else{if(/^[UI][124]$/.test(type)){const bits=Number(type[1])*8;value.min=type[0]==='I'?-(2**(bits-1)):0;value.max=type[0]==='I'?2**(bits-1)-1:2**bits-1;}if(type==='C1')value.maxLength=1;if(type==='Cn')value.maxLength=255;value.value=original??'';}current.textContent=`Recorded${date?' (UTC)':''}: ${displayEdit({field:name.value},original)}`;}
        ordinal.addEventListener('change',load);load();
        editor.append(button(tr('Stage change'),()=>{if(!value.reportValidity())return;const next=EDIT_DATE_FIELDS.has(name.value)?Date.parse(value.value+'Z')/1000:numeric(record.name,name.value)?value.valueAsNumber:value.value;if(typeof next==='number'&&!Number.isFinite(next)){value.setCustomValidity('Enter a valid value.');value.reportValidity();value.setCustomValidity('');return;}const edit={seq:raw.record.seq,field:name.value,value:next,...(record.name==='MPR'?{ordinal:ordinal.valueAsNumber}:{})};const i=draft.edits.findIndex(e=>e.seq===edit.seq&&e.field===edit.field&&e.ordinal===edit.ordinal);if(i>=0)draft.edits[i]=edit;else draft.edits.push(edit);preview.replaceChildren();redraw();}));
        detail(content,tr('Recorded fields'),record.values);
        if(record.name==='PTR'||record.name==='MPR')editor.append(element('p',tr('Result edits use base STDF units. Test flags are retained.'),'viewer-help'));
        if(EDIT_FIELD_NOTES[record.name])editor.append(element('p',EDIT_FIELD_NOTES[record.name],'viewer-help'));
      })));
    }else if(operation.value==='remap'){
      const kind=selectField(fields,tr('Bin family'),[['soft',tr('Software')],['hard',tr('Hardware')]],'soft',()=>update()),from=field(fields,tr('From bin'),'number',1),to=field(fields,tr('To bin'),'number',2),outcome=selectField(fields,tr('New outcome'),[['preserve',tr('Keep recorded outcome')],['pass',tr('Pass')],['fail',tr('Fail')]],'preserve',()=>update());
      function update(){draft.remap={kind:kind.value,from:from.valueAsNumber,to:to.valueAsNumber,outcome:outcome.value};preview.replaceChildren();}
      from.addEventListener('input',update);to.addEventListener('input',update);update();content.append(element('p',tr('Bin remapping applies to every matching attempt in this source.'),'viewer-help'));
    }else if(operation.value==='records'){
      const kind=selectField(fields,tr('Record type'),[['SBR',tr('Software bin')],['HBR',tr('Hardware bin')],['DTR',tr('Datalog note')]],'SBR',()=>{}),number=field(fields,tr('Bin number'),'number',1),head=field(fields,tr('Head'),'number',255),site=field(fields,tr('Site'),'number',255),name=field(fields,tr('Name / note')),outcome=selectField(fields,tr('Bin outcome'),[['P',tr('Pass')],['F',tr('Fail')],[' ',tr('Unknown')]],'P',()=>{});
      const list=element('div');content.append(list);
      fields.append(button(tr('Stage new record'),()=>{const p=kind.value==='HBR'?'HBIN':'SBIN',record={name:kind.value,fields:kind.value==='DTR'?{TEXT_DAT:name.value}:{HEAD_NUM:head.valueAsNumber,SITE_NUM:site.valueAsNumber,[`${p}_NUM`]:number.valueAsNumber,[`${p}_PF`]:outcome.value,[`${p}_NAM`]:name.value}};draft.insertRecords.push(record);list.append(element('p',`Add ${record.name}: ${name.value}`));preview.replaceChildren();}));
      const removal=element('div',undefined,'viewer-toolbar');content.append(removal);const seq=field(removal,tr('Delete record sequence'),'number');removal.append(button(tr('Stage deletion'),()=>{draft.deleteSeqs.push(seq.valueAsNumber);list.append(element('p',`Delete record ${seq.value}`));preview.replaceChildren();}));content.append(element('p',tr('Deletion is limited to optional SBR, HBR, TSR and DTR records.'),'viewer-help'));
    }else if(operation.value==='attempts'){
      const seq=field(fields,tr('Attempt PIR sequence'),'number');seq.min=1;seq.step=1;seq.required=true;
      const staged=element('div');content.append(staged);
      const redrawRemoved=()=>{staged.replaceChildren();table(staged,[{label:tr('Original PIR'),value:id=>id},{label:tr('Action'),value:id=>button(tr('Undo'),()=>{draft.deleteDevices=draft.deleteDevices.filter(v=>v!==id);preview.replaceChildren();redrawRemoved();},'quiet-button')}],draft.deleteDevices);};
      fields.append(button(tr('Stage attempt removal'),()=>{const id=seq.valueAsNumber;if(!Number.isSafeInteger(id)||id<1){seq.reportValidity();return;}if(!draft.deleteDevices.includes(id))draft.deleteDevices.push(id);preview.replaceChildren();redrawRemoved();}));
      content.append(element('p',tr('Use the original PIR sequence shown in the device record. Preview checks ownership and inherited test metadata before removing an attempt.'),'viewer-help'));
    }else if(operation.value==='convert'){
      reason.closest('label').remove();pending.remove();const format=selectField(fields,tr('Format'),[['original',tr('Original STDF')],['csv',tr('Device / measurement CSV')],['json',tr('Complete records JSON')],['all',tr('STDF + CSV + JSON ZIP')]],'csv',()=>{});
      const sources=element('fieldset',undefined,'authoring-sources'),legend=element('legend',tr('Sources')),actions=element('div',undefined,'viewer-toolbar'),selectedCount=element('output');sources.append(legend,actions);content.append(sources);
      const boxes=choices.map(([id,label])=>{const row=element('label',undefined,'export-option'),box=element('input');box.type='checkbox';box.value=id;box.checked=id===source.value;box.setAttribute('aria-label',`${tr('Convert')} ${label}`);row.append(box,document.createTextNode(label));sources.append(row);return box;});
      const generate=button(tr('Generate conversion'),()=>api.run(async()=>{const datasetIds=boxes.filter(b=>b.checked).map(b=>b.value);if(!datasetIds.length||datasetIds.length>8)throw new Error('Select one to eight sources.');const result=format.value==='original'&&datasetIds.length===1?await request(api,'export',{datasetId:datasetIds[0]}):await request(api,'convert',{datasetIds,formats:format.value==='all'?['original','csv','json']:[format.value]});downloadAuthored(result,api);showReceipt(content,result);}));
      const update=()=>{const count=boxes.filter(b=>b.checked).length;selectedCount.textContent=`${count} selected · maximum 8`;generate.disabled=!count||count>8;};
      for(const box of boxes)box.addEventListener('change',update);
      actions.append(button(tr('All'),()=>{boxes.forEach(b=>b.checked=true);update();},'quiet-button'),button(tr('None'),()=>{boxes.forEach(b=>b.checked=false);update();},'quiet-button'),selectedCount);content.append(generate);update();return;
    }else if(operation.value==='atdf'){
      reason.closest('label').remove();pending.remove();const file=field(fields,tr('ATDF file'),'file');file.accept='.atdf';const offset=field(fields,tr('Timestamp UTC offset (minutes)'),'number',0);offset.min=-840;offset.max=840;offset.step=1;
      fields.append(button(tr('Import ATDF'),()=>api.run(async()=>{if(!file.files[0])throw new Error('Choose an ATDF file.');const result=await request(api,'importAtdf',{file:file.files[0],utcOffsetMinutes:offset.valueAsNumber});detail(content,tr('Import receipt'),result.atdf).open=true;const link=element('a',tr('Open imported data'),'button primary');link.href=`./viewer.html?dataset=${encodeURIComponent(result.dataset.id)}`;content.append(link);})));return;
    }else if(operation.value==='originalAtdf'){
      reason.closest('label').remove();pending.remove();const results=element('div');content.append(results);
      fields.append(button(tr('Find saved ATDF'),()=>api.run(async()=>{const result=await request(api,'atdfSources',{datasetId:source.value});results.replaceChildren();if(!result.items.length){results.append(element('p',tr('No original ATDF is saved for this source.')));return;}
        table(results,[{label:tr('Original input'),value:r=>r.originalName,wrap:true},{label:tr('Bytes'),value:r=>r.originalBytes},{label:tr('UTC offset'),value:r=>r.utcOffsetMinutes},{label:tr('Download'),value:r=>button(tr('Original ATDF'),()=>api.run(async()=>{const original=await request(api,'atdfOriginal',{datasetId:source.value,originalToken:r.originalToken});showDownload(original.file,original.filename,undefined,`atdf:${r.originalToken}`);}))},{label:tr('Provenance'),value:r=>button(tr('Receipt JSON'),()=>showDownload(new Blob([JSON.stringify(r,null,2)],{type:'application/json'}),`${r.originalName}.receipt.json`),'quiet-button')}],result.items);
      })));
      content.append(element('p',tr('Original ATDF inputs stay in this browser and are separate from workspace backups. Download the input and receipt to keep them together.'),'viewer-help'));return;
    }else if(operation.value==='plan'){
      reason.closest('label').remove();pending.remove();const file=field(fields,tr('Edit plan JSON'),'file');file.accept='.json';fields.append(button(tr('Validate plan'),()=>api.run(async()=>{if(!file.files[0]||file.files[0].size>1024*1024)throw new Error('Choose an edit plan up to 1 MiB.');const plan=JSON.parse(await file.files[0].text());if(plan.datasetId!==source.value||plan.sourceSha256!==api.state.overview.sources.find(s=>s.datasetId===source.value)?.sha256)throw new Error('This edit plan belongs to a different source.');showPlan(preview,await request(api,'preview',plan),api);})));content.append(preview);return;
    }
    content.append(previewButton,button(tr('Revert draft'),draw,'quiet-button'),preview);
  };draw();
  disclosure(container,tr('Editing policy')).append(element('p',tr('Edits create a derived STDF. The source stays byte-for-byte unchanged. Preview lists field changes; exports include a revision receipt. Parts and measurements remain traceable to their original record sequences.')));
}

export function screeningEditGroups(result){
  if(result.decisionsTruncated)throw new Error('This screening preview is truncated. Narrow the population before exporting a screened copy.');
  const groups=new Map(),seen=new Map();
  for(const decision of result.decisions??[]){
    if(result.method==='whatif'&&decision.originalOutcome!=='pass')continue;
    if(!Number.isInteger(decision.originalPartFlags))throw new Error('Screening result lacks original part flags. Run the preview again.');
    const failBin=decision.toBin??result.exportFailBin;
    if(!Number.isInteger(failBin)||failBin<0||failBin>65534)throw new Error('Choose a valid failure bin.');
    const key=`${decision.datasetId}/${decision.prrSeq}`,signature=JSON.stringify([failBin,decision.originalPartFlags]);
    if(seen.has(key)){if(seen.get(key)!==signature)throw new Error('Comparison groups propose conflicting changes to one part.');continue;}seen.set(key,signature);
    if(!groups.has(decision.datasetId))groups.set(decision.datasetId,[]);
    const edits=groups.get(decision.datasetId);edits.push({seq:decision.prrSeq,field:'SOFT_BIN',value:failBin},{seq:decision.prrSeq,field:'PART_FLG',value:(decision.originalPartFlags&~24)|8});
    if(edits.length>10000)throw new Error('A derived revision supports up to 5,000 screened devices per source. Narrow this preview.');
  }
  return groups;
}
export async function exportScreening(container,result,api){
  const groups=screeningEditGroups(result);if(!groups.size)throw new Error('No eligible device changes to export.');
  const previews=[];for(const [datasetId,edits] of groups)previews.push(await request(api,'preview',{datasetId,reason:`${result.method??result.recipe?.method} screening (${result.methodVersion??result.recipe?.version})`,edits}));
  const review=element('section',undefined,'viewer-section');container.append(review);review.append(element('h3',tr('Derived copies')));
  table(review,[{label:tr('Source'),value:r=>api.state.datasets.find(s=>s.id===r.plan.datasetId)?.name??r.plan.datasetId},{label:tr('Affected devices'),value:r=>r.affectedDevices},{label:tr('Field changes'),value:r=>r.changes}],previews);
  review.append(button(tr('Generate screened copies'),()=>api.run(async()=>{for(const preview of previews){const output=await request(api,'export',{datasetId:preview.plan.datasetId,plan:preview.plan});downloadAuthored(output,api);showReceipt(review,output);}showDownload(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),'screening-recipe-and-decisions.json');})));
}
