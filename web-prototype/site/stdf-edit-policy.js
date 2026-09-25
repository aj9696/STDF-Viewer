import { RECORD_SCHEMAS } from './stdf-encode.js';

// One typed allowlist is shared by worker validation and the editor controls.
export const EDITABLE_RECORD_FIELDS = {
  PTR: ['RESULT'], MPR: ['RTN_RSLT'],
  PRR: ['HARD_BIN','SOFT_BIN','PART_FLG','PART_ID','PART_TXT','X_COORD','Y_COORD'],
  MIR: RECORD_SCHEMAS.MIR.fields.map(([name]) => name),
  SDR: ['SITE_GRP', ...RECORD_SCHEMAS.SDR.fields.filter(([,type]) => type === 'Cn').map(([name]) => name)],
  MRR: ['FINISH_T','DISP_COD','USR_DESC','EXC_DESC'], DTR: ['TEXT_DAT'],
  HBR: ['HEAD_NUM','SITE_NUM','HBIN_NUM','HBIN_PF','HBIN_NAM'],
  SBR: ['HEAD_NUM','SITE_NUM','SBIN_NUM','SBIN_PF','SBIN_NAM'],
  TSR: ['HEAD_NUM','SITE_NUM','TEST_TYP','TEST_NUM','TEST_NAM','SEQ_NAME','TEST_LBL'],
};
export const EDIT_DATE_FIELDS = new Set(['SETUP_T','START_T','FINISH_T']);
export const TSR_IDENTITY_FIELDS = new Set(['HEAD_NUM','SITE_NUM','TEST_TYP','TEST_NUM']);
export const EDIT_FIELD_NOTES = {
  MIR: 'Timestamps use UTC. Burn-in duration is minutes; 65535 means unknown.',
  SDR: 'Renumbering a site group updates its wafer references. Head and site membership stay fixed.',
  HBR: 'Definition changes do not reclassify parts. Counts are rebuilt; use Remap bins to move parts.',
  SBR: 'Definition changes do not reclassify parts. Counts are rebuilt; use Remap bins to move parts.',
  TSR: 'Retargeting a summary rebuilds execution counts and marks unavailable timing/result statistics invalid.',
  MRR: 'Finish time uses UTC. Device and wafer timestamps are unchanged.',
};
export function editFieldType(record, field) { return RECORD_SCHEMAS[record]?.fields.find(([name]) => name === field)?.[1]; }
