import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AtdfDecoder } from '../site/atdf-codec.js';
import { readRecord, patchRecord, encodeRecord, joinBytes } from '../site/stdf-encode.js';
const files=new URL('../../.venv/library-fixtures/',import.meta.url);
let checks=0;
for(const order of ['little','big']){
  const source=await readFile(new URL(`golden-${order}.stdf`,files));let offset=0;const decoded=[];
  while(offset<source.length){const size=(order==='little'?source.readUInt16LE(offset):source.readUInt16BE(offset))+4,bytes=source.subarray(offset,offset+size);decoded.push(readRecord(bytes,order));offset+=size;}
  assert.equal(decoded.length,18);assert.equal(decoded[16].name,'UNKNOWN');
  const header=patchRecord(decoded[1].bytes,[{field:'LOT_ID',value:'new lot'}],order);assert.equal(readRecord(header,order).values.LOT_ID,'new lot');
  const ptr=patchRecord(decoded[13].bytes,[{field:'RESULT',value:.8}],order);assert.equal(readRecord(ptr,order).values.RESULT,Math.fround(.8));
  assert.deepEqual(Buffer.from(ptr.subarray(0,12)),decoded[13].bytes.subarray(0,12));assert.deepEqual(Buffer.from(ptr.subarray(16)),decoded[13].bytes.subarray(16));
  const mpr=patchRecord(decoded[8].bytes,[{field:'RTN_RSLT',ordinal:1,value:1.25}],order);assert.deepEqual(readRecord(mpr,order).values.RTN_RSLT,[.25,1.25]);
  const multiple=patchRecord(decoded[8].bytes,[{field:'RTN_RSLT',ordinal:0,value:.5},{field:'RTN_RSLT',ordinal:1,value:1.25}],order);assert.deepEqual(readRecord(multiple,order).values.RTN_RSLT,[.5,1.25]);checks++;
  assert.throws(()=>patchRecord(decoded[8].bytes,[{field:'RTN_RSLT',ordinal:2,value:1}],order));assert.throws(()=>patchRecord(decoded[13].bytes,[{field:'RESULT',value:1e300}],order));
  assert.throws(()=>patchRecord(decoded[1].bytes,[{field:'LOT_ID',value:'🙂'}],order));checks+=8;
}
export const atdfSample=[
  'FAR:A|4|2|U',
  'ATR:0:00:00 01-JAN-2020|independent fixture',
  'MIR:LOT|IC|JOB|NODE|TESTER|0:00:00 01-JAN-2020|0:00:01 01-JAN-2020|OP|P|1',
  'SDR:1|1|1|HANDLER',
  'WCR:D|R|U|300|1|1|3|0|0',
  'PMR:1|1|C1|PIN1|LOG1|1|1',
  'PMR:2|1|C2|PIN2|LOG2|1|1',
  'PGR:32768|BUS|1,2',
  'PLR:1,2|20,21|H,H|H,L/H,L|0,1/0,1',
  'WIR:1|0:00:01 01-JAN-2020|1|W01',
  'PIR:1|1',
  'BPS:DC',
  'PTR:10|1|1|1000|P||Supply|||mV|900|1100',
  'PTR:10|1|1|1010|F|H|Supply',
  'MPR:11|1|1|0,1|1,2|P||Pins|||mA|0|3|0|1|V|1,2',
  'FTR:12|1|1|F|A|VECT|T1|10|XFF|1|1|1|2|0|1|5|2|1|1|OP|DIGITAL|ALARM|P|F|0|1,2',
  'GDR:Tnote|L-435|U255|F645.7110|XFFE0014C|Y0F|N15',
  'DTR:A note',
  'EPS:',
  'PRR:1|1|PART1|4|F|2|9|0|0|||15|part note|F13C20',
  'WRR:1|0:00:02 01-JAN-2020|1|W01|1|0|0|0|1',
  'TSR:||10|Supply|P|2|1|0|||.005|1|1.01|2.01|2.0201',
  'HBR:||2|1|F|Fail',
  'SBR:||9|1|F|Fail',
  'PCR:||1|0|0|0|1',
  'MRR:0:00:03 01-JAN-2020|P|done',
].join('\r\n');
function parse(text,options){const p=new AtdfDecoder(options),records=[];for(let i=0;i<text.length;i+=7)records.push(...p.push(text.slice(i,i+7)));records.push(...p.finish());return records;}
const parsed=parse(atdfSample),known=parsed.map((b)=>readRecord(b));
assert.equal(known[12].values.RESULT,1);assert.equal(known[12].values.UNITS,'V');assert.equal(known[13].values.RESULT,Math.fround(1.01));assert.equal(known[13].values.LO_LIMIT,Math.fround(.9));assert.equal(known[13].values.TEST_FLG,128);assert.equal(known[13].values.PARM_FLG,16);
assert.deepEqual(known[14].values.RTN_RSLT,[Math.fround(.001),Math.fround(.002)]);assert.equal(known[15].values.REL_VADR,255);assert.equal(known[15].values.OPT_FLAG,0);assert.equal(known[19].values.PART_FLG,8);assert.equal(known[24].values.HEAD_NUM,255);checks+=11;
assert.equal(known[21].values.OPT_FLAG,0xc8);assert.equal(parse(atdfSample.replace('.005|1|1.01|2.01|2.0201','.005|1|1.01')).map(b=>readRecord(b)).find(r=>r.name==='TSR').values.OPT_FLAG,0xf8);checks+=2;
assert.deepEqual(joinBytes(parse(atdfSample.replaceAll('|',';'))),joinBytes(parsed));
assert.deepEqual(joinBytes(parse(atdfSample.replace('Supply|||mV','Supp\r\n ly|||mV'))),joinBytes(parsed));
const shifted=parse(atdfSample,{utcOffsetMinutes:60});assert.equal(readRecord(shifted[2]).values.START_T,readRecord(parsed[2]).values.START_T-3600);checks+=3;
const ftrDefaults=parse(atdfSample.replace('GDR:Tnote','FTR:12|1|1|P\r\nGDR:Tnote')).map((b)=>readRecord(b)).filter((r)=>r.name==='FTR');assert.equal(ftrDefaults[1].values.PATG_NUM,0);assert.deepEqual(ftrDefaults[1].values.SPIN_MAP,ftrDefaults[0].values.SPIN_MAP);checks+=2;
for(const text of [atdfSample.replace('FAR:A|4|2|U','FAR:A|4|1|U'),atdfSample.replace('mV','µV'),atdfSample.replace('1,2|P||Pins','1,nan|P||Pins'),atdfSample.replace('0:00:03 01-JAN-2020','0:00:03 32-JAN-2020'),atdfSample.replace('GDR:Tnote','XXX:Tnote'),atdfSample.replace('PCR:||1|0|0|0|1\r\n',''),atdfSample+'\nDTR:after MRR']){assert.throws(()=>parse(text));checks++;}
// Preserve another MPR result's non-finite payload while editing one element.
const mpr=encodeRecord('MPR',{TEST_NUM:1,HEAD_NUM:1,SITE_NUM:1,TEST_FLG:0,PARM_FLG:0,RTN_ICNT:0,RSLT_CNT:2,RTN_STAT:[],RTN_RSLT:[0,1]});new DataView(mpr.buffer).setUint32(16,0x7fc01234,true);
const patched=patchRecord(mpr,[{field:'RTN_RSLT',ordinal:1,value:2}]);assert.equal(new DataView(patched.buffer).getUint32(16,true),0x7fc01234);checks++;
console.log(JSON.stringify({passed:true,checks,atdfRecords:parsed.length}));
