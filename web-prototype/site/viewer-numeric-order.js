import { deviceFilter, attachDeviceResults, attachFailureSummary } from './viewer-tables.js';
import { pageOptions, retiredExpression } from './viewer-context.js';
import { parseTestKey, invalid } from './viewer-model.js';

/** Indexed final eligible results first, missing/invalid results last in both directions. */
export async function listDevicesByTest(view, options) {
  const test=parseTestKey(options.sortTest),{offset,limit}=pageOptions(options),filter=deviceFilter(view,options),direction=options.direction??'asc';
  if(test.family===20||!['asc','desc'].includes(direction))invalid('Choose a numeric test and sort direction.');
  const total=view.db.selectValue(`SELECT COUNT(*) FROM v_devices d WHERE ${filter.sql}`,filter.bind.length?filter.bind:undefined),cursors=[],items=[];
  try {
    for(const source of view.sources){
      const identity=test.identity==='resolved'?'resolved':test.identity.startsWith(`${source.datasetId}:`)?test.identity.split(':').at(-1):null;
      const testId=identity===null?null:view.db.selectValue(`SELECT id FROM ${source.alias}.tests WHERE family=? AND number=? AND name=? AND identity=?`,[test.family,test.number,test.name,identity]);
      const extras=`${source.source} source,${source.groupId} group_id,${source.sourceIndex} source_index,ss.dataset_id,ss.name source_name,d.dut_index+ss.attempt_offset x_index,CASE WHEN ${retiredExpression(view,source)} THEN 1 ELSE 0 END retired`;
      const match='o.test_id=? AND o.unit=? AND o.channel=?',bind=[testId,test.unit,test.channel];
      const final=`NOT EXISTS(SELECT 1 FROM ${source.alias}.observations later INDEXED BY observations_device WHERE later.device_id=o.device_id AND later.test_id=o.test_id AND later.unit=o.unit AND later.channel=o.channel AND (later.seq>o.seq OR later.seq=o.seq AND later.ordinal>o.ordinal))`;
      const valid='o.value IS NOT NULL AND (o.test_flags&63)=0 AND (o.parm_flags&7)=0';
      const add=(sql,args,missing)=>{const statement=view.db.prepare(sql);const cursor={statement,missing,row:null};cursors.push(cursor);if(args.length)statement.bind(args);if(statement.step())cursor.row=statement.get({});};
      if(testId!=null){
        const projection=`SELECT d.*,${extras},o.value sort_value,o.seq sort_seq FROM ${source.alias}.observations o INDEXED BY observations_value JOIN ${source.alias}.devices d ON d.id=o.device_id JOIN source_scope ss ON ss.source=${source.source} WHERE ${match} AND ${valid} AND ${final}`;
        add(`SELECT d.* FROM(${projection}) d WHERE ${filter.sql} ORDER BY d.sort_value ${direction},d.sort_seq ${direction}`,[...bind,...filter.bind],false);
      }
      const projection=`SELECT d.*,${extras},NULL sort_value FROM ${source.alias}.devices d JOIN source_scope ss ON ss.source=${source.source}`;
      const missing=testId==null?'1':`NOT EXISTS(SELECT 1 FROM ${source.alias}.observations o INDEXED BY observations_device WHERE o.device_id=d.id AND ${match} AND ${valid} AND ${final})`;
      add(`SELECT d.* FROM(${projection}) d WHERE ${filter.sql} AND ${missing} ORDER BY d.id`,[...filter.bind,...(testId==null?[]:bind)],true);
    }
    const compare=(a,b)=>Number(a.missing)-Number(b.missing)||(a.missing?0:(direction==='asc'?1:-1)*(a.row.sort_value-b.row.sort_value))||a.row.group_id-b.row.group_id||a.row.source_index-b.row.source_index||(a.missing?a.row.id-b.row.id:(direction==='asc'?1:-1)*(a.row.sort_seq-b.row.sort_seq));
    let visited=0,bytes=0;
    while(items.length<limit){
      let current=null;for(const cursor of cursors)if(cursor.row&&(!current||compare(cursor,current)<0))current=cursor;if(!current)break;
      if(visited++>=offset){bytes+=JSON.stringify(current.row).length*2;if(bytes>2*1024*1024)invalid('This device page is too large.');items.push(current.row);}
      current.row=current.statement.step()?current.statement.get({}):null;
      if(visited%4096===0){await new Promise(resolve=>setTimeout(resolve,0));view.context.checkCancelled();}
    }
  }finally{for(const cursor of cursors)cursor.statement.finalize();}
  attachDeviceResults(view,items,options.tests??[]);
  if(options.failureSummary === true) await attachFailureSummary(view,items);
  return {items,total,offset,nextOffset:offset+items.length<total?offset+items.length:null,sortPolicy:'Last execution per device; finite flag-valid numeric values first; missing/invalid last.'};
}
