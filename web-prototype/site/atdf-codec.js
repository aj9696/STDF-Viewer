// Teradyne ATDF v2 / STDF v4. Text field order is deliberately separate from
// the STDF binary schema. Dates use an explicit fixed UTC offset (default UTC).
import { encodeRecord, frameRecord, joinBytes, scalar, RECORD_SCHEMAS } from './stdf-encode.js';
const fail=(message)=>{throw Object.assign(new Error(message),{code:'INVALID_ATDF'});};
const order='little';
const mappings={
  ATR:'MOD_TIM CMD_LINE',
  MIR:'LOT_ID PART_TYP JOB_NAM NODE_NAM TSTR_TYP SETUP_T START_T OPER_NAM MODE_COD STAT_NUM SBLOT_ID TEST_COD RTST_COD JOB_REV EXEC_TYP EXEC_VER PROT_COD CMOD_COD BURN_TIM TST_TEMP USER_TXT AUX_FILE PKG_TYP FAMLY_ID DATE_COD FACIL_ID FLOOR_ID PROC_ID OPER_FRQ SPEC_NAM SPEC_VER FLOW_ID SETUP_ID DSGN_REV ENG_ID ROM_COD SERL_NUM SUPR_NAM',
  MRR:'FINISH_T DISP_COD USR_DESC EXC_DESC', PCR:'HEAD_NUM SITE_NUM PART_CNT RTST_CNT ABRT_CNT GOOD_CNT FUNC_CNT',
  HBR:'HEAD_NUM SITE_NUM HBIN_NUM HBIN_CNT HBIN_PF HBIN_NAM', SBR:'HEAD_NUM SITE_NUM SBIN_NUM SBIN_CNT SBIN_PF SBIN_NAM',
  PMR:'PMR_INDX CHAN_TYP CHAN_NAM PHY_NAM LOG_NAM HEAD_NUM SITE_NUM', PGR:'GRP_INDX GRP_NAM PMR_INDX',
  PLR:'GRP_INDX GRP_MODE GRP_RADX PGM_CODES RTN_CODES', RDR:'RTST_BIN',
  SDR:'HEAD_NUM SITE_GRP SITE_NUM HAND_TYP HAND_ID CARD_TYP CARD_ID LOAD_TYP LOAD_ID DIB_TYP DIB_ID CABL_TYP CABL_ID CONT_TYP CONT_ID LASR_TYP LASR_ID EXTR_TYP EXTR_ID',
  WIR:'HEAD_NUM START_T SITE_GRP WAFER_ID', WRR:'HEAD_NUM FINISH_T PART_CNT WAFER_ID SITE_GRP RTST_CNT ABRT_CNT GOOD_CNT FUNC_CNT FABWF_ID FRAME_ID MASK_ID USR_DESC EXC_DESC',
  WCR:'WF_FLAT POS_X POS_Y WAFR_SIZ DIE_HT DIE_WID WF_UNITS CENTER_X CENTER_Y', PIR:'HEAD_NUM SITE_NUM',
  PRR:'HEAD_NUM SITE_NUM PART_ID NUM_TEST PASS HARD_BIN SOFT_BIN X_COORD Y_COORD RETEST ABORT TEST_T PART_TXT PART_FIX',
  TSR:'HEAD_NUM SITE_NUM TEST_NUM TEST_NAM TEST_TYP EXEC_CNT FAIL_CNT ALRM_CNT SEQ_NAME TEST_LBL TEST_TIM TEST_MIN TEST_MAX TST_SUMS TST_SQRS',
  PTR:'TEST_NUM HEAD_NUM SITE_NUM RESULT PASS ALARMS TEST_TXT ALARM_ID COMPARE UNITS LO_LIMIT HI_LIMIT C_RESFMT C_LLMFMT C_HLMFMT LO_SPEC HI_SPEC RES_SCAL LLM_SCAL HLM_SCAL',
  MPR:'TEST_NUM HEAD_NUM SITE_NUM RTN_STAT RTN_RSLT PASS ALARMS TEST_TXT ALARM_ID COMPARE UNITS LO_LIMIT HI_LIMIT START_IN INCR_IN UNITS_IN RTN_INDX C_RESFMT C_LLMFMT C_HLMFMT LO_SPEC HI_SPEC RES_SCAL LLM_SCAL HLM_SCAL',
  FTR:'TEST_NUM HEAD_NUM SITE_NUM PASS ALARMS VECT_NAM TIME_SET CYCL_CNT REL_VADR REPT_CNT NUM_FAIL XFAIL_AD YFAIL_AD VECT_OFF RTN_INDX RTN_STAT PGM_INDX PGM_STAT FAIL_PIN OP_CODE TEST_TXT ALARM_ID PROG_TXT RSLT_TXT PATG_NUM SPIN_MAP',
  BPS:'SEQ_NAME', EPS:'', DTR:'TEXT_DAT',
};
const required={MIR:['LOT_ID','PART_TYP','JOB_NAM','NODE_NAM','TSTR_TYP','SETUP_T','START_T','OPER_NAM','MODE_COD','STAT_NUM'],MRR:['FINISH_T'],PCR:['PART_CNT'],HBR:['HBIN_NUM','HBIN_CNT'],SBR:['SBIN_NUM','SBIN_CNT'],PMR:['PMR_INDX'],PGR:['GRP_INDX'],PLR:['GRP_INDX'],SDR:['HEAD_NUM','SITE_GRP','SITE_NUM'],WIR:['HEAD_NUM','START_T'],WRR:['HEAD_NUM','FINISH_T','PART_CNT'],PIR:['HEAD_NUM','SITE_NUM'],PRR:['HEAD_NUM','SITE_NUM','NUM_TEST','HARD_BIN'],TSR:['TEST_NUM'],PTR:['TEST_NUM','HEAD_NUM','SITE_NUM'],MPR:['TEST_NUM','HEAD_NUM','SITE_NUM'],FTR:['TEST_NUM','HEAD_NUM','SITE_NUM']};
const unsignedUnknown=new Set(['RTST_CNT','ABRT_CNT','GOOD_CNT','FUNC_CNT','EXEC_CNT','FAIL_CNT','ALRM_CNT']);
function number(text,defaultValue=0){if(text===undefined||text==='')return defaultValue;if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim()))fail(`Invalid decimal number: ${text.slice(0,40)}`);const n=Number(text);if(!Number.isFinite(n))fail('Non-finite ATDF number.');return n;}
function list(text,convert=number){return text?text.split(',').map((v)=>{if(!v)fail('Empty array item.');return convert(v);}):[];}
function hex(text){const s=(text??'').replace(/^X/i,'');if(!/^(?:[a-fA-F0-9]{2})*$/.test(s))fail('Binary data must contain complete hexadecimal bytes.');return Array.from({length:s.length/2},(_,i)=>parseInt(s.slice(i*2,i*2+2),16));}
const nibble=(text)=>{if(!/^[0-9a-f]$/i.test(text))fail('Invalid hexadecimal nibble.');return parseInt(text,16);};
const states=(text)=>text?text.replaceAll(',','').split('').map(nibble):[];
function date(text,offset){if(!text)return 0;const m=/^(\d{1,2}):(\d{2}):(\d{2}) (\d{1,2})-([A-Z]{3})-(\d{4})$/i.exec(text);if(!m)fail('Dates must use hh:mm:ss DD-MMM-YYYY.');const month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(m[5].toUpperCase()),parts=[+m[6],month,+m[4],+m[1],+m[2],+m[3]],ms=Date.UTC(...parts),d=new Date(ms);if(month<0||d.getUTCFullYear()!==parts[0]||d.getUTCMonth()!==month||d.getUTCDate()!==parts[2]||parts[3]>23||parts[4]>59||parts[5]>59)fail('Invalid ATDF date.');return ms/1000-offset*60;}
function bits(indices){const a=list(indices);if(a.length>65535||a.some((n)=>!Number.isInteger(n)||n<0||n>65534))fail('Pin index exceeds Dn capacity.');let n=0;for(const index of a)n=Math.max(n,index+1);const b=new Uint8Array(Math.ceil(n/8));for(const index of a)b[index>>3]|=1<<(index%8);return {bits:n,bytes:Array.from(b)};}
function flags(raw,functional=false){const pass=raw.PASS??'';if(!(functional?['','P','F']:['','P','F','A']).includes(pass))fail('Unknown pass/fail flag.');let test=pass===''?64:pass==='F'?128:0,parm=pass==='A'?32:0;
  for(const c of raw.ALARMS??''){const t={A:1,U:4,T:8,N:16,X:32}[c],p={S:1,D:2,O:4,L:8,H:16}[c];if(t)test|=t;else if(p&&!functional)parm|=p;else fail('Unknown test alarm flag.');}
  for(const c of raw.COMPARE??''){if(c==='L')parm|=64;else if(c==='H')parm|=128;else fail('Unknown limit comparison flag.');}return {TEST_FLG:test,PARM_FLG:parm};}
function defaults(name){const values={};for(const [key,type]of RECORD_SCHEMAS[name].fields){values[key]=type==='Cn'?'':type==='C1'?' ':type==='Dn'?{bits:0,bytes:[]}:type==='Bn'||type==='N'||type[0]==='A'?[]:unsignedUnknown.has(key)?4294967295:['SOFT_BIN','BURN_TIM'].includes(key)?65535:['X_COORD','Y_COORD','CENTER_X','CENTER_Y'].includes(key)?-32768:key==='SITE_GRP'?255:0;}return values;}
// Exact ATDF-v2 prefix table; do not guess arbitrary modern SI prefixes.
const prefixes={T:12,G:9,M:6,K:3,'%':-2,m:-3,u:-6,n:-9,p:-12,f:-15};
function scaleUnit(unit){if((unit.length>1||unit==='%')&&Object.hasOwn(prefixes,unit[0]))return {factor:10**prefixes[unit[0]],scale:-prefixes[unit[0]],unit:unit.slice(1)};return {factor:1,scale:0,unit};}
function generic(raw){const parts=[],types={U:['U1',1],M:['U2',2],B:['U4',3],I:['I1',4],S:['I2',5],L:['I4',6],F:['R4',7],D:['R8',8],T:['Cn',10],X:['Bn',11],Y:['Dn',12],N:['U1',13]};
  let count=0,position=2;for(const text of raw){if(!text)fail('GDR fields need a type character.');const type=types[text[0]];if(!type)fail('Unsupported GDR type.');const s=text.slice(1),value=type[0]==='Cn'?s:type[0]==='Bn'?hex(s):type[0]==='Dn'?{bits:hex(s).length*8,bytes:hex(s)}:number(s);
    const b=scalar(type[0],value,order);
    if(text[0]==='N'&&(value<0||value>15||!Number.isInteger(value)))fail('GDR nibble out of range.');
    if([2,3,5,6,7,8].includes(type[1])&&position%2===0){parts.push(Uint8Array.of(0));position++;count++;}
    parts.push(Uint8Array.of(type[1]),b);position+=1+b.length;count++;}
  if(count>65535)fail('Too many GDR fields.');return frameRecord(50,10,joinBytes([Uint8Array.of(count&255,count>>8),...parts]));
}
export class AtdfDecoder {
  constructor({utcOffsetMinutes=0}={}){if(!Number.isInteger(utcOffsetMinutes)||Math.abs(utcOffsetMinutes)>840)fail('UTC offset must be an integer from −840 to 840 minutes.');this.offset=utcOffsetMinutes;this.carry='';this.logical='';this.records=0;this.defaults=new Map();this.defaultBytes=0;this.hasMir=false;this.hasMrr=false;this.hasPcr=false;this.finished=false;this.line=0;this.openParts=new Set();this.waferHeads=new Set();this.previous='';this.seenRdr=false;}
  push(text){if(this.finished)fail('ATDF decoder is closed.');if(/[^\x20-\x7e\r\n]/.test(text))fail('ATDF input must contain printable ASCII and line endings only.');this.carry+=text;const out=[];let i;
    while((i=this.carry.search(/[\r\n]/))>=0){const line=this.carry.slice(0,i);this.carry=this.carry.slice(i+1);this.line++;this.accept(line,out);}if(this.carry.length>1048576)fail('ATDF physical line exceeds 1 MiB.');return out;}
  accept(line,out){if(!line)return;if(line.startsWith(' ')){if(!this.logical)fail('Continuation has no preceding record.');this.logical+=line.slice(1);}else{if(this.logical)out.push(this.record(this.logical));this.logical=line;}if(this.logical.length>1048576)fail('ATDF record exceeds 1 MiB.');}
  finish(){const out=[];if(this.carry)this.accept(this.carry,out);if(this.logical)out.push(this.record(this.logical));this.carry=this.logical='';this.finished=true;if(!this.hasMir||!this.hasMrr||!this.hasPcr)fail('ATDF requires FAR, MIR, at least one PCR, and final MRR.');if(this.openParts.size||this.waferHeads.size)fail('ATDF has unmatched part or wafer records.');return out;}
  record(line){if(!/^[A-Z]{3}:/.test(line))fail(`Invalid record header near line ${this.line}.`);const name=line.slice(0,3);if(this.hasMrr)fail('A record follows MRR.');
    if(!this.records++){if(name!=='FAR'||line[4]!=='A')fail('ATDF must begin with FAR:A.');this.separator=line[5];if(!this.separator||/[a-zA-Z0-9 :]/.test(this.separator))fail('Unsupported ATDF separator.');const a=line.slice(4).split(this.separator);if(a[1]!=='4'||a[2]!=='2'||!['','S','U'].includes(a[3]??'')||a.length>4)fail('Only ATDF v2 / STDF v4 is supported.');this.scaling=a[3]||'S';return encodeRecord('FAR',{CPU_TYPE:2,STDF_VER:4});}
    if(name==='FAR')fail('Repeated FAR.');if(name==='MIR'){if(this.hasMir)fail('Repeated MIR.');this.hasMir=true;}else if(!this.hasMir&&name!=='ATR')fail('MIR must precede data records.');if(name==='ATR'&&this.hasMir)fail('ATR must precede MIR.');if(name==='RDR'){if(this.previous!=='MIR'||this.seenRdr)fail('A single RDR may appear immediately after MIR.');this.seenRdr=true;}this.previous=name;if(name==='MRR')this.hasMrr=true;if(name==='PCR')this.hasPcr=true;
    const values=line.slice(4).split(this.separator);if(name==='GDR')return generic(values.length===1&&values[0]===''?[]:values);
    if(!Object.hasOwn(mappings,name))fail(`Unsupported ATDF record ${name}; no records were silently skipped.`);const keys=mappings[name]?mappings[name].split(' '):[];if(values.length>keys.length&&!(keys.length===0&&values.length===1&&!values[0]))fail(`Too many ${name} fields.`);
    let raw=Object.fromEntries(keys.map((k,i)=>[k,values[i]??'']));for(const k of required[name]??[])if(raw[k]==='')fail(`Missing ${name}.${k}.`);
    const v=defaults(name),types=Object.fromEntries(RECORD_SCHEMAS[name].fields.map(([k,t])=>[k,t]));
    if(['PTR','MPR','FTR'].includes(name)){const key=`${name}/${raw.TEST_NUM}`,initial=this.defaults.get(key),defaultKeys=keys.slice(keys.indexOf(name==='FTR'?'PATG_NUM':'UNITS'));if(initial){for(const k of defaultKeys)if(raw[k]==='')raw[k]=initial[k];}else{const saved=Object.fromEntries(defaultKeys.map((k)=>[k,raw[k]]));this.defaultBytes+=JSON.stringify(saved).length*2;if(this.defaults.size>=20000||this.defaultBytes>16*1024**2)fail('ATDF default metadata exceeds 20,000 tests / 16 MiB.');this.defaults.set(key,saved);}}
    for(const [key,text]of Object.entries(raw)){const type=types[key];if(!type||text===''||(name==='PLR'&&['GRP_MODE','GRP_RADX'].includes(key))||(name==='FTR'&&key==='REL_VADR'))continue;if(['SETUP_T','START_T','FINISH_T','MOD_TIM'].includes(key))v[key]=date(text,this.offset);else if(type==='Cn')v[key]=text===' '&&['UNITS','UNITS_IN','C_RESFMT','C_LLMFMT','C_HLMFMT'].includes(key)?'\0':text.trimEnd();else if(type==='C1')v[key]=text.length===1?text:fail(`${name}.${key} must have one character.`);else if(type==='Bn')v[key]=hex(text);else if(type==='Dn')v[key]=bits(text);else if(type==='N')v[key]=states(text);else if(type[0]==='A')v[key]=list(text);else v[key]=number(text);}
    if(['PCR','HBR','SBR','TSR'].includes(name)){if(raw.HEAD_NUM===''||raw.SITE_NUM===''){if(raw.HEAD_NUM!==raw.SITE_NUM)fail('Summary head/site must both be empty.');v.HEAD_NUM=v.SITE_NUM=255;}}
    if(name==='PMR'){if(!raw.HEAD_NUM)v.HEAD_NUM=1;if(!raw.SITE_NUM)v.SITE_NUM=1;}
    if(name==='PGR')v.INDX_CNT=v.PMR_INDX.length;if(name==='RDR')v.NUM_BINS=v.RTST_BIN.length;if(name==='SDR')v.SITE_CNT=v.SITE_NUM.length;
    if(name==='PRR'){if(!['','P','F'].includes(raw.PASS)||!['','I','C'].includes(raw.RETEST)||!['','Y'].includes(raw.ABORT))fail('Invalid PRR flags.');v.PART_FLG=(raw.PASS==='F'?8:raw.PASS===''?16:0)|(raw.RETEST==='I'?1:raw.RETEST==='C'?2:0)|(raw.ABORT==='Y'?4:0);}
    if(name==='PTR'||name==='MPR'){Object.assign(v,flags(raw));const absent=name==='PTR'?raw.RESULT==='':v.RTN_RSLT.length===0;if(absent)v.TEST_FLG|=2;
      let unit={factor:1,scale:null,unit:v.UNITS};if(this.scaling==='U')unit=scaleUnit(v.UNITS);v.UNITS=unit.unit;
      if(name==='PTR')v.RESULT*=unit.factor;else v.RTN_RSLT=v.RTN_RSLT.map((n)=>n*unit.factor);
      for(const key of ['LO_LIMIT','HI_LIMIT','LO_SPEC','HI_SPEC'])v[key]*=unit.factor;
      if(unit.scale!==null)v.RES_SCAL=v.LLM_SCAL=v.HLM_SCAL=unit.scale;
      v.OPT_FLAG=(raw.LO_LIMIT===''?64:0)|(raw.HI_LIMIT===''?128:0)|(raw.LO_SPEC===''?4:0)|(raw.HI_SPEC===''?8:0)|(raw.START_IN===''&&name==='MPR'?2:0);
      if(name==='MPR'){v.RTN_ICNT=v.RTN_STAT.length;v.RSLT_CNT=v.RTN_RSLT.length;if(v.RTN_INDX.length!==v.RTN_ICNT)fail('This ATDF profile requires an index for every returned MPR state.');}
    }
    if(name==='TSR')v.OPT_FLAG=[['TEST_MIN',0],['TEST_MAX',1],['TEST_TIM',2],['TST_SUMS',4],['TST_SQRS',5]].reduce((mask,[key,bit])=>mask|(raw[key]===''?1<<bit:0),0xc8);
    if(name==='FTR'){Object.assign(v,flags(raw,true));delete v.PARM_FLG;v.RTN_ICNT=v.RTN_INDX.length;v.PGM_ICNT=v.PGM_INDX.length;if(v.RTN_STAT.length!==v.RTN_ICNT||v.PGM_STAT.length!==v.PGM_ICNT)fail('FTR index/state arrays differ.');v.PATG_NUM=raw.PATG_NUM===''?255:v.PATG_NUM;v.OPT_FLAG=['CYCL_CNT','REL_VADR','REPT_CNT','NUM_FAIL'].reduce((m,k,i)=>m|(raw[k]===''?1<<i:0),0)|(raw.XFAIL_AD===''||raw.YFAIL_AD===''?16:0)|(raw.VECT_OFF===''?32:0);if(raw.REL_VADR){const s=raw.REL_VADR.replace(/^X/i,'');if(!/^[a-f\d]+$/i.test(s))fail('Invalid relative vector hex address.');v.REL_VADR=parseInt(s,16);}}
    if(name==='PLR'){v.GRP_CNT=v.GRP_INDX.length;v.GRP_MODE=raw.GRP_MODE?list(raw.GRP_MODE,(s)=>{if(!/^[a-f\d]+$/i.test(s))fail('Invalid pin mode.');return parseInt(s,16);}):Array(v.GRP_CNT).fill(0);const radix={B:2,O:8,D:10,H:16,S:20};v.GRP_RADX=raw.GRP_RADX?list(raw.GRP_RADX,(s)=>radix[s]??fail('Invalid pin radix.')):Array(v.GRP_CNT).fill(0);
      for(const prefix of ['PGM','RTN']){const lists=raw[`${prefix}_CODES`]?raw[`${prefix}_CODES`].split('/'):Array(v.GRP_CNT).fill('');if(lists.length!==v.GRP_CNT)fail('Pin state lists differ from group count.');v[`${prefix}_CHAR`]=[];v[`${prefix}_CHAL`]=[];for(const item of lists){const codes=item?item.split(','):[];if(codes.some((s)=>!s||s.length>2))fail('Pin symbols must have one or two characters.');v[`${prefix}_CHAR`].push(codes.map((s)=>s.at(-1)).join(''));v[`${prefix}_CHAL`].push(codes.some((s)=>s.length===2)?codes.map((s)=>s.length===2?s[0]:' ').join(''):'');}}
    }
    const part=`${v.HEAD_NUM}/${v.SITE_NUM}`;
    if(name==='PIR'){if(this.openParts.has(part))fail('Repeated open PIR head/site.');this.openParts.add(part);}
    if(name==='PRR'){if(!this.openParts.delete(part))fail('PRR has no matching PIR.');}
    if(['PTR','MPR','FTR'].includes(name)&&!this.openParts.has(part)&&!(name==='PTR'&&(v.TEST_FLG&16)&&v.PARM_FLG===0))fail('Test result has no matching open PIR.');
    if(name==='WIR'){if(this.waferHeads.has(v.HEAD_NUM))fail('Overlapping wafers on one head require a separate supported profile.');this.waferHeads.add(v.HEAD_NUM);}
    if(name==='WRR'&&!this.waferHeads.delete(v.HEAD_NUM))fail('WRR has no matching WIR.');
    return encodeRecord(name,v,order);
  }
}
