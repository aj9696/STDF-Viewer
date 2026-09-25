import { readRecord, patchRecord } from './stdf-encode.js';
import { TSR_IDENTITY_FIELDS } from './stdf-edit-policy.js';
import { invalid } from './viewer-model.js';

const binIdentity = new Set(['HEAD_NUM','SITE_NUM','HBIN_NUM','SBIN_NUM']);
export function validateSummaryScope(fields) {
  if (fields.HEAD_NUM === 255 && fields.SITE_NUM !== 255) invalid('An all-heads summary requires site 255.');
}

/** Compute related edits from retained bytes; never trust a plan's relatedEdits. */
export async function metadataEffects(opened, edits, inserted, deleted, context) {
  const bySeq = new Map(), deletedSet = new Set(deleted), relatedEdits = [], rebuiltSummaries = [];
  for (const edit of edits) { if (!bySeq.has(edit.seq)) bySeq.set(edit.seq, []); bySeq.get(edit.seq).push(edit); }
  const renameGroups = edits.some(e => e.name === 'SDR' && e.field === 'SITE_GRP');
  const binChanges = edits.some(e => ['HBR','SBR'].includes(e.name) && binIdentity.has(e.field)) || inserted.some(r => ['HBR','SBR'].includes(r.name));
  const dateChanges = edits.some(e => ['SETUP_T','START_T','FINISH_T'].includes(e.field));
  const tsrChanges = edits.some(e => e.name === 'TSR' && TSR_IDENTITY_FIELDS.has(e.field));
  if (!renameGroups && !binChanges && !dateChanges && !tsrChanges) return { relatedEdits, rebuiltSummaries };
  const stmt = opened.db.prepare('SELECT seq,offset,length,type,subtype FROM records WHERE (type=1 AND subtype IN (10,20,40,50,80)) OR (type=2 AND subtype IN (10,20)) OR (type=10 AND subtype=30) ORDER BY seq');
  const groups = new Map(), groupNumbers = new Set(), bins = new Set(), testIdentities = new Set(), wafers = [];
  let setup, start, finish, count = 0;
  const keepBin = (name, f) => { validateSummaryScope(f); const key = `${name}/${f.HEAD_NUM}/${f.SITE_NUM}/${f[name === 'HBR' ? 'HBIN_NUM' : 'SBIN_NUM']}`; if (bins.has(key)) invalid('A bin definition already exists for the resulting number/head/site.'); bins.add(key); };
  try {
    while (stmt.step()) {
      context.checkCancelled(); if (++count > 200000) invalid('Metadata validation exceeds 200,000 records.');
      const row = stmt.get({}); if (deletedSet.has(row.seq)) continue;
      const bytes = new Uint8Array(await opened.file.slice(row.offset, row.offset + row.length).arrayBuffer());
      const before = readRecord(bytes, opened.manifest.byteOrder), changes = bySeq.get(row.seq) ?? [];
      const after = changes.length ? readRecord(patchRecord(bytes, changes, opened.manifest.byteOrder), opened.manifest.byteOrder) : before;
      const f = after.values;
      if (after.name === 'MIR') { setup = f.SETUP_T; start = f.START_T; }
      if (after.name === 'MRR') finish = f.FINISH_T;
      if (renameGroups && after.name === 'SDR') {
        if (groupNumbers.has(f.SITE_GRP)) invalid('Site group numbers must be unique.'); groupNumbers.add(f.SITE_GRP);
        if (f.SITE_GRP !== before.values.SITE_GRP) {
          if (f.SITE_GRP === 255 || before.values.SITE_GRP === 255) invalid('Unknown site group 255 cannot be renamed safely.');
          groups.set(before.values.SITE_GRP, { head: f.HEAD_NUM, value: f.SITE_GRP });
        }
      }
      if (renameGroups && ['WIR','WRR'].includes(after.name)) wafers.push({ seq: row.seq, name: after.name, ...f });
      if (binChanges && ['HBR','SBR'].includes(after.name)) keepBin(after.name, f);
      if (tsrChanges && after.name === 'TSR') {
        validateSummaryScope(f); if (!['P','M','F',' '].includes(f.TEST_TYP)) invalid('TSR test type must be P, M, F, or a space for unknown.');
        const key = `${f.TEST_TYP}/${f.TEST_NUM}/${f.HEAD_NUM}/${f.SITE_NUM}`;
        if (testIdentities.has(key)) invalid('A test summary already exists for the resulting test/type/head/site.'); testIdentities.add(key);
        if (changes.some(e => TSR_IDENTITY_FIELDS.has(e.field))) rebuiltSummaries.push({ seq: row.seq, head: f.HEAD_NUM, site: f.SITE_NUM, testType: f.TEST_TYP, number: f.TEST_NUM });
      }
    }
  } finally { stmt.finalize(); }
  for (const r of inserted) if (['HBR','SBR'].includes(r.name)) keepBin(r.name, r.fields);
  for (const wafer of wafers) {
    const group = groups.get(wafer.SITE_GRP); if (!group) continue;
    if (wafer.HEAD_NUM !== group.head) invalid('A wafer site-group reference uses a different head; renumbering is ambiguous.');
    relatedEdits.push({ seq: wafer.seq, name: wafer.name, field: 'SITE_GRP', before: wafer.SITE_GRP, value: group.value, reason: 'SDR site-group reference' });
  }
  const setupOrStart = edits.some(e => e.name === 'MIR' && ['SETUP_T','START_T'].includes(e.field));
  const startOrFinish = edits.some(e => ['START_T','FINISH_T'].includes(e.field));
  if (setupOrStart && setup > 0 && start > 0 && setup > start) invalid('Setup time must not follow start time.');
  if (startOrFinish && start > 0 && finish > 0 && start > finish) invalid('Start time must not follow finish time.');
  return { relatedEdits, rebuiltSummaries };
}

/** Count test records, not MPR result ordinals. Invalid verdicts remain unknown. */
export function createTestSummaryCounters(requests = []) {
  const counters = new Map(), bySequence = new Map();
  for (const r of requests) { const key = `${r.testType}/${r.number}/${r.head}/${r.site}`; if (!counters.has(key)) counters.set(key, { executions: 0, failures: 0, alarms: 0, unknownFailure: false }); bySequence.set(r.seq, counters.get(key)); }
  return {
    observe(record, order) {
      if (!counters.size || record.type !== 15 || ![10,15,20].includes(record.subtype) || record.device_id === null) return;
      const b = record.bytes, flags = b[10]; if (flags & 16) return;
      const number = new DataView(b.buffer, b.byteOffset + 4, 4).getUint32(0, order === 'little');
      for (const family of [({10:'P',15:'M',20:'F'})[record.subtype], ' ']) for (const scope of new Set([`${b[8]}/${b[9]}`,`${b[8]}/255`,'255/255'])) {
        const c = counters.get(`${family}/${number}/${scope}`); if (!c) continue;
        c.executions++; if (flags & 64) c.unknownFailure = true; else if (flags & 128) c.failures++;
        if (flags & 1) c.alarms++;
      }
    },
    forSequence(seq) {
      const c = bySequence.get(seq); if (!c) return null;
      return { EXEC_CNT: c.executions, FAIL_CNT: c.unknownFailure ? 4294967295 : c.failures, ALRM_CNT: c.alarms,
        OPT_FLAG: 255, TEST_TIM: 0, TEST_MIN: 0, TEST_MAX: 0, TST_SUMS: 0, TST_SQRS: 0 };
    },
  };
}
