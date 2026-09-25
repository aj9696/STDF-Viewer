// STDF V4 record framing and lossless field patching. Unchanged fields retain
// their original bytes, including floating-point payloads and omitted tails.
const fail = (message) => { throw Object.assign(new Error(message), { code: 'INVALID_STDF_EDIT' }); };
const fields = (text) => text.split(' ').filter(Boolean).map((entry) => entry.split(':'));
const definitions = {
  FAR: [0,10,'CPU_TYPE:U1 STDF_VER:U1'], ATR: [0,20,'MOD_TIM:U4 CMD_LINE:Cn'],
  MIR: [1,10,'SETUP_T:U4 START_T:U4 STAT_NUM:U1 MODE_COD:C1 RTST_COD:C1 PROT_COD:C1 BURN_TIM:U2 CMOD_COD:C1 LOT_ID:Cn PART_TYP:Cn NODE_NAM:Cn TSTR_TYP:Cn JOB_NAM:Cn JOB_REV:Cn SBLOT_ID:Cn OPER_NAM:Cn EXEC_TYP:Cn EXEC_VER:Cn TEST_COD:Cn TST_TEMP:Cn USER_TXT:Cn AUX_FILE:Cn PKG_TYP:Cn FAMLY_ID:Cn DATE_COD:Cn FACIL_ID:Cn FLOOR_ID:Cn PROC_ID:Cn OPER_FRQ:Cn SPEC_NAM:Cn SPEC_VER:Cn FLOW_ID:Cn SETUP_ID:Cn DSGN_REV:Cn ENG_ID:Cn ROM_COD:Cn SERL_NUM:Cn SUPR_NAM:Cn'],
  MRR: [1,20,'FINISH_T:U4 DISP_COD:C1 USR_DESC:Cn EXC_DESC:Cn'],
  PCR: [1,30,'HEAD_NUM:U1 SITE_NUM:U1 PART_CNT:U4 RTST_CNT:U4 ABRT_CNT:U4 GOOD_CNT:U4 FUNC_CNT:U4'],
  HBR: [1,40,'HEAD_NUM:U1 SITE_NUM:U1 HBIN_NUM:U2 HBIN_CNT:U4 HBIN_PF:C1 HBIN_NAM:Cn'],
  SBR: [1,50,'HEAD_NUM:U1 SITE_NUM:U1 SBIN_NUM:U2 SBIN_CNT:U4 SBIN_PF:C1 SBIN_NAM:Cn'],
  PMR: [1,60,'PMR_INDX:U2 CHAN_TYP:U2 CHAN_NAM:Cn PHY_NAM:Cn LOG_NAM:Cn HEAD_NUM:U1 SITE_NUM:U1'],
  PGR: [1,62,'GRP_INDX:U2 GRP_NAM:Cn INDX_CNT:U2 PMR_INDX:AU2:INDX_CNT'],
  PLR: [1,63,'GRP_CNT:U2 GRP_INDX:AU2:GRP_CNT GRP_MODE:AU2:GRP_CNT GRP_RADX:AU1:GRP_CNT PGM_CHAR:ACn:GRP_CNT RTN_CHAR:ACn:GRP_CNT PGM_CHAL:ACn:GRP_CNT RTN_CHAL:ACn:GRP_CNT'],
  RDR: [1,70,'NUM_BINS:U2 RTST_BIN:AU2:NUM_BINS'],
  SDR: [1,80,'HEAD_NUM:U1 SITE_GRP:U1 SITE_CNT:U1 SITE_NUM:AU1:SITE_CNT HAND_TYP:Cn HAND_ID:Cn CARD_TYP:Cn CARD_ID:Cn LOAD_TYP:Cn LOAD_ID:Cn DIB_TYP:Cn DIB_ID:Cn CABL_TYP:Cn CABL_ID:Cn CONT_TYP:Cn CONT_ID:Cn LASR_TYP:Cn LASR_ID:Cn EXTR_TYP:Cn EXTR_ID:Cn'],
  WIR: [2,10,'HEAD_NUM:U1 SITE_GRP:U1 START_T:U4 WAFER_ID:Cn'],
  WRR: [2,20,'HEAD_NUM:U1 SITE_GRP:U1 FINISH_T:U4 PART_CNT:U4 RTST_CNT:U4 ABRT_CNT:U4 GOOD_CNT:U4 FUNC_CNT:U4 WAFER_ID:Cn FABWF_ID:Cn FRAME_ID:Cn MASK_ID:Cn USR_DESC:Cn EXC_DESC:Cn'],
  WCR: [2,30,'WAFR_SIZ:R4 DIE_HT:R4 DIE_WID:R4 WF_UNITS:U1 WF_FLAT:C1 CENTER_X:I2 CENTER_Y:I2 POS_X:C1 POS_Y:C1'],
  PIR: [5,10,'HEAD_NUM:U1 SITE_NUM:U1'],
  PRR: [5,20,'HEAD_NUM:U1 SITE_NUM:U1 PART_FLG:U1 NUM_TEST:U2 HARD_BIN:U2 SOFT_BIN:U2 X_COORD:I2 Y_COORD:I2 TEST_T:U4 PART_ID:Cn PART_TXT:Cn PART_FIX:Bn'],
  TSR: [10,30,'HEAD_NUM:U1 SITE_NUM:U1 TEST_TYP:C1 TEST_NUM:U4 EXEC_CNT:U4 FAIL_CNT:U4 ALRM_CNT:U4 TEST_NAM:Cn SEQ_NAME:Cn TEST_LBL:Cn OPT_FLAG:U1 TEST_TIM:R4 TEST_MIN:R4 TEST_MAX:R4 TST_SUMS:R4 TST_SQRS:R4'],
  PTR: [15,10,'TEST_NUM:U4 HEAD_NUM:U1 SITE_NUM:U1 TEST_FLG:U1 PARM_FLG:U1 RESULT:R4 TEST_TXT:Cn ALARM_ID:Cn OPT_FLAG:U1 RES_SCAL:I1 LLM_SCAL:I1 HLM_SCAL:I1 LO_LIMIT:R4 HI_LIMIT:R4 UNITS:Cn C_RESFMT:Cn C_LLMFMT:Cn C_HLMFMT:Cn LO_SPEC:R4 HI_SPEC:R4'],
  MPR: [15,15,'TEST_NUM:U4 HEAD_NUM:U1 SITE_NUM:U1 TEST_FLG:U1 PARM_FLG:U1 RTN_ICNT:U2 RSLT_CNT:U2 RTN_STAT:N:RTN_ICNT RTN_RSLT:AR4:RSLT_CNT TEST_TXT:Cn ALARM_ID:Cn OPT_FLAG:U1 RES_SCAL:I1 LLM_SCAL:I1 HLM_SCAL:I1 LO_LIMIT:R4 HI_LIMIT:R4 START_IN:R4 INCR_IN:R4 RTN_INDX:AU2:RTN_ICNT UNITS:Cn UNITS_IN:Cn C_RESFMT:Cn C_LLMFMT:Cn C_HLMFMT:Cn LO_SPEC:R4 HI_SPEC:R4'],
  FTR: [15,20,'TEST_NUM:U4 HEAD_NUM:U1 SITE_NUM:U1 TEST_FLG:U1 OPT_FLAG:U1 CYCL_CNT:U4 REL_VADR:U4 REPT_CNT:U4 NUM_FAIL:U4 XFAIL_AD:I4 YFAIL_AD:I4 VECT_OFF:I2 RTN_ICNT:U2 PGM_ICNT:U2 RTN_INDX:AU2:RTN_ICNT RTN_STAT:N:RTN_ICNT PGM_INDX:AU2:PGM_ICNT PGM_STAT:N:PGM_ICNT FAIL_PIN:Dn VECT_NAM:Cn TIME_SET:Cn OP_CODE:Cn TEST_TXT:Cn ALARM_ID:Cn PROG_TXT:Cn RSLT_TXT:Cn PATG_NUM:U1 SPIN_MAP:Dn'],
  BPS: [20,10,'SEQ_NAME:Cn'], EPS: [20,20,''], DTR: [50,30,'TEXT_DAT:Cn'],
};
export const RECORD_SCHEMAS = Object.fromEntries(Object.entries(definitions).map(([name,[type,subtype,text]]) => [name,{ name,type,subtype,fields: fields(text) }]));
const byType = new Map(Object.values(RECORD_SCHEMAS).map((s) => [`${s.type}/${s.subtype}`,s]));
const widths = { U1:1,I1:1,C1:1,U2:2,I2:2,U4:4,I4:4,R4:4,R8:8 };
const methods = { U1:'Uint8',I1:'Int8',U2:'Uint16',I2:'Int16',U4:'Uint32',I4:'Int32',R4:'Float32',R8:'Float64' };
const le = (order) => { if (!['little','big'].includes(order)) fail('Unknown byte order.'); return order === 'little'; };
export function joinBytes(parts) { const out = new Uint8Array(parts.reduce((n,p) => n+p.length,0)); let pos=0; for(const p of parts){out.set(p,pos);pos+=p.length;} return out; }
function ascii(value) {
  if (typeof value !== 'string' || value.length > 255 || [...value].some((c) => c.charCodeAt(0)>255)) fail('STDF strings must contain at most 255 single-byte characters.');
  return Uint8Array.from(value, (c) => c.charCodeAt(0));
}
export function scalar(type,value,order='little') {
  if (type==='Cn' || type==='C1') { const b=ascii(value); if(type==='C1'){if(b.length!==1)fail('C1 requires exactly one character.');return b;}return joinBytes([Uint8Array.of(b.length),b]); }
  if(type==='Bn' || type==='Dn') { const b=Uint8Array.from(value.bytes??value);const count=type==='Dn'?(value.bits??b.length*8):b.length;if(!Number.isInteger(count)||count<0||count>(type==='Dn'?65535:255)||b.length!==Math.ceil(count/(type==='Dn'?8:1)))fail('Invalid binary field length.');return joinBytes([scalar(type==='Dn'?'U2':'U1',count,order),b]); }
  const width=widths[type]; if(!width)fail(`Unsupported field type ${type}.`);
  if(typeof value!=='number'||!Number.isFinite(value))fail(`${type} requires a finite number.`);
  if(type[0]!=='R' && (!Number.isInteger(value)||value<(type[0]==='I'?-(2**(width*8-1)):0)||value>(type[0]==='I'?2**(width*8-1)-1:2**(width*8)-1)))fail(`${type} is outside its integer range.`);
  const b=new Uint8Array(width),v=new DataView(b.buffer);v['set'+methods[type]](0,value,le(order));
  if(type==='R4'&&!Number.isFinite(v.getFloat32(0,le(order))))fail('Value overflows STDF R4.');return b;
}
function encodeField(def,value,values,order) {
  const [,type,countName]=def;
  if(type[0]==='A'||type==='N') {
    if(!Array.isArray(value)||value.length!==values[countName])fail(`Array length does not match ${countName}.`);
    if(type==='N'){const b=new Uint8Array(Math.ceil(value.length/2));value.forEach((n,i)=>{if(!Number.isInteger(n)||n<0||n>15)fail('Nibble out of range.');b[i>>1]|=n<<((i%2)*4);});return b;}
    return joinBytes(value.map((v)=>scalar(type.slice(1),v,order)));
  }
  return scalar(type,value,order);
}
export function frameRecord(type,subtype,body,order='little') {
  if(body.length>65535)fail('STDF record body exceeds 65,535 bytes.');return joinBytes([scalar('U2',body.length,order),Uint8Array.of(type,subtype),body]);
}
export function encodeRecord(name,values,order='little') {
  const s=RECORD_SCHEMAS[name];if(!s)fail(`Cannot encode ${name}.`);
  const allowed=new Set(s.fields.map((f)=>f[0]));if(Object.keys(values).some((key)=>!allowed.has(key)))fail(`Unknown ${name} field.`);
  const last=s.fields.findLastIndex(([key])=>Object.hasOwn(values,key));const parts=[];
  for(let i=0;i<=last;i++){const f=s.fields[i];if(!Object.hasOwn(values,f[0]))fail(`Missing ${name}.${f[0]} before a present field.`);parts.push(encodeField(f,values[f[0]],values,order));}
  return frameRecord(s.type,s.subtype,joinBytes(parts),order);
}
export function readRecord(bytes,order='little') {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),little=le(order);
  if(bytes.length<4||view.getUint16(0,little)+4!==bytes.length)fail('Expected one complete STDF record.');
  const s=byType.get(`${bytes[2]}/${bytes[3]}`),values={},spans={};if(!s)return {name:'UNKNOWN',values,spans,bytes};
  let pos=4;
  const need=(n)=>{if(pos+n>bytes.length)fail(`${s.name} ends inside a field.`);};
  function read(type) {
    if(type==='Cn'||type==='Bn'){need(1);const count=bytes[pos++];need(count);const b=bytes.slice(pos,pos+count);pos+=count;return type==='Cn'?Array.from(b,(x)=>String.fromCharCode(x)).join(''):Array.from(b);}
    if(type==='Dn'){need(2);const bits=view.getUint16(pos,little);pos+=2;need(Math.ceil(bits/8));const b=bytes.slice(pos,pos+Math.ceil(bits/8));pos+=b.length;return {bits,bytes:Array.from(b)};}
    if(type==='C1'){need(1);return String.fromCharCode(bytes[pos++]);}
    const n=widths[type];need(n);const result=view['get'+methods[type]](pos,little);pos+=n;return result;
  }
  for(const def of s.fields){if(pos===bytes.length)break;const [name,type,countName]=def,start=pos;
    if(type==='N'){const count=values[countName];need(Math.ceil(count/2));values[name]=Array.from({length:count},(_,i)=>(bytes[pos+(i>>1)]>>((i%2)*4))&15);pos+=Math.ceil(count/2);}
    else if(type[0]==='A')values[name]=Array.from({length:values[countName]},()=>read(type.slice(1)));
    else values[name]=read(type);spans[name]=[start,pos];
  }
  if(pos!==bytes.length)fail(`${s.name} has unsupported trailing bytes.`);return {name:s.name,values,spans,bytes};
}
export function patchRecord(bytes,edits,order='little') {
  const decoded=readRecord(bytes,order),schema=RECORD_SCHEMAS[decoded.name];if(!schema)fail('Unknown record cannot be edited.');
  const changes=new Map();for(const e of edits){const previous=changes.get(e.field)??[];if(previous.some((old)=>old.ordinal===undefined||e.ordinal===undefined||old.ordinal===e.ordinal))fail('Edit each field/result ordinal once per record.');previous.push(e);changes.set(e.field,previous);}
  for(const name of changes.keys())if(!schema.fields.some((f)=>f[0]===name))fail(`Unknown ${decoded.name}.${name}.`);
  const values={...decoded.values};
  for(const [field,items] of changes)for(const e of items){if(e.ordinal!==undefined){if(!Array.isArray(values[field])||!Number.isInteger(e.ordinal)||e.ordinal<0||e.ordinal>=values[field].length)fail('Invalid result ordinal.');values[field]=[...values[field]];values[field][e.ordinal]=e.value;}else values[field]=e.value;}
  const last=schema.fields.findLastIndex(([key])=>Object.hasOwn(values,key));const parts=[];
  for(let i=0;i<=last;i++){const def=schema.fields[i],key=def[0],items=changes.get(key);
    if(items?.[0].ordinal!==undefined&&def[1]==='AR4'&&decoded.spans[key]){const [start,end]=decoded.spans[key],copy=Uint8Array.from(bytes.subarray(start,end));for(const change of items)copy.set(scalar('R4',change.value,order),change.ordinal*4);parts.push(copy);}
    else if(items)parts.push(encodeField(def,values[key],values,order));else if(decoded.spans[key])parts.push(bytes.subarray(...decoded.spans[key]));else if(def[1]==='Cn')parts.push(Uint8Array.of(0));else fail(`Cannot insert ${key} implicitly into an omitted tail.`);}
  return frameRecord(bytes[2],bytes[3],joinBytes(parts),order);
}
