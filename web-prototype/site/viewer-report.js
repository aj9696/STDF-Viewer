import { openViewerContext } from './viewer-context.js';
import { overview, iterateReportDevices, readDevice } from './viewer-tables.js';
import { rowsBounded } from './viewer-context.js';
import { analyzeTest } from './viewer-analysis.js';
import { binChart, listWafers, waferMap } from './viewer-maps.js';
import { parseTestKey, datasetId, boundedInteger, invalid } from './viewer-model.js';
import { writeWorkbook } from './xlsx-writer.js';
import { loadParser } from './import-source.js';

export const REPORT_SECTIONS = ['File Info', 'DUT Summary', 'Trend Chart', 'Histogram', 'Bin Chart', 'Wafer Map', 'Test Statistics', 'GDR & DTR Summary'];
const DIRECTORY = 'semidata-report-exports-v1', LIMIT = 16 * 1024 ** 3;
const text = (value) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const chunks = (value, size = 30000) => {
  const string = text(value), parts = [];
  for (let i = 0; i < string.length;) {
    let end = Math.min(string.length, i + size);
    if (end < string.length && /[\uD800-\uDBFF]/.test(string[end - 1]) && /[\uDC00-\uDFFF]/.test(string[end])) end--;
    parts.push(string.slice(i, end)); i = end;
  }
  return parts.length ? parts : [''];
};
const statHeaders = ['Test number', 'Name', 'Family', 'Unit', 'Channel', 'Series', 'Total', 'Valid', 'Excluded', 'Pass', 'Fail', 'Unknown', 'Mean', 'Median', 'Population sigma', 'Minimum', 'Maximum', 'Low limit', 'High limit', 'Cpk', 'Cpk unavailable reason', 'Low specification', 'High specification', 'Changing specifications'];
function statRow(test, series) {
  const s = series.stats;
  return [test.number, test.name, test.family, test.unit, test.channel, series.label, s.total, s.count, s.excluded, s.pass, s.fail, s.unknown,
    s.mean, s.median, s.stdev, s.min, s.max, s.lsl, s.usl, s.cpk, s.cpkReason, s.lowSpec, s.highSpec, s.changingSpecs];
}
const observationHeaders = ['Source ID', 'PIR sequence', 'Group', 'Head', 'Site', 'Part ID', 'Record sequence', 'Result ordinal', 'Family', 'Test number', 'Test name', 'Channel', 'Value (base units; FTR is status byte)', 'Unit', 'Low limit', 'High limit', 'TEST_FLG', 'PARM_FLG', 'Original R4 bits'];
async function* deviceObservations(view, options) {
  let after = [0, -1];
  do {
    view.context.checkCancelled();
    const page = readDevice(view, { ...options.device, after, limit: 100 });
    for (const row of page.items) yield [page.attempt.dataset_id, page.attempt.id, view.selection.groups[page.attempt.group_id].name,
      page.attempt.head, page.attempt.site, page.attempt.part_id, row.seq, row.ordinal, row.family, row.number, row.test_name, row.channel,
      row.value, row.unit, row.low, row.high, row.test_flags, row.parm_flags, row.raw_bits];
    after = page.nextAfter; await new Promise((done) => setTimeout(done, 0));
  } while (after);
}
async function writeDeviceCsv(sink, view, options) {
  const encoder = new TextEncoder(); let count = 0;
  const cell = (value) => {
    let output = value == null ? '' : String(value);
    // CSV has no cell type. Neutralize spreadsheet formulas only in text cells;
    // the XLSX equivalent preserves the original string using inline strings.
    if (typeof value === 'string' && /^[\s]*[=+@-]|^[\t\r\n]/.test(value)) output = `'${output}`;
    return `"${output.replaceAll('"', '""')}"`;
  };
  try {
    await sink.write(encoder.encode('\uFEFF' + observationHeaders.map(cell).join(',') + '\r\n'));
    for await (const row of deviceObservations(view, options)) {
      await sink.write(encoder.encode(row.map(cell).join(',') + '\r\n')); count++;
    }
    await sink.close(); return { rows: count, format: 'csv' };
  } catch (error) { await sink.abort(error).catch(() => {}); throw error; }
}
async function* analyses(view, options) {
  for (const testKey of options.tests) {
    view.context.checkCancelled();
    yield await analyzeTest(view, { testKey, bins: options.bins ?? 30, seriesBy: options.seriesBy ?? 'aggregate', includeAggregate: options.includeAggregate });
  }
}
async function* information(view, options) {
  yield ['Report generated (UTC)', new Date().toISOString()];
  yield ['Population', JSON.stringify(view.selection)];
  yield ['Settings', JSON.stringify(options.settings ?? {})];
  yield ['Method', 'Base STDF units; finite flag-valid measurements; valid failures included; population sigma; exact median; Cpk withheld for changing/missing limits or zero spread.'];
  yield ['Trend', 'Display uses first/last/min/max reduction; histogram and statistics use the full eligible population.'];
  const info = await overview(view);
  for (const source of info.sources) {
    yield ['Source', source.name, source.datasetId]; yield ['SHA-256', source.sha256]; yield ['Source bytes', source.sourceBytes];
    for (const row of source.metadata) for (const [field, value] of Object.entries(row.fields)) {
      const parts = chunks(value); for (let i = 0; i < parts.length; i++) yield [source.name, row.seq, field, i + 1, parts.length, parts[i]];
    }
  }
}
async function* devices(view, options) {
  for await (const d of iterateReportDevices(view, { tests: options.tests })) {
    yield [view.selection.groups[d.group_id].name, d.source_name, d.dataset_id, d.id, d.x_index, d.part_id, d.part_text, d.head, d.site,
      d.part_flags, d.retired === 1, d.num_tests, d.test_time, d.hard_bin, d.soft_bin, d.wafer_id, d.x === -32768 ? null : d.x, d.y === -32768 ? null : d.y,
      ...options.tests.map((key) => (d.testResults[key] ?? []).map((r) => r.value === null ? `bits:${r.raw_bits ?? 'none'} flags:${r.test_flags}` : `${r.value} [flags:${r.test_flags}]`).join('; '))];
  }
}
async function* statistics(view, options) {
  for await (const data of analyses(view, options)) for (const series of data.series) yield statRow(data.test, series);
}
async function* trends(view, options) {
  for await (const data of analyses(view, options)) for (const series of data.series) {
    yield ['SUMMARY', ...statRow(data.test, series)];
    yield ['Displayed points', series.label, 'Attempt index', 'Value', 'Low limit', 'High limit', 'Source ID', 'PIR sequence', 'Record sequence', 'Result ordinal', 'Reduced'];
    for (const p of series.points) yield ['POINT', series.label, p.x, p.value, p.lsl, p.usl, p.datasetId, p.deviceId, p.seq, p.ordinal, series.reduced];
  }
}
async function* histograms(view, options) {
  for await (const data of analyses(view, options)) for (const series of data.series) for (const bin of series.bins) {
    yield [data.test.number, data.test.name, data.test.unit, data.test.channel, series.label, bin.low, bin.high, bin.last ? 'Closed upper endpoint' : 'Open upper endpoint', bin.count];
  }
}
async function* bins(view, options) {
  for (const kind of ['hard', 'soft']) {
    const chart = await binChart(view, { kind, seriesBy: options.seriesBy });
    for (const series of chart.series) for (const bin of series.bins) yield [kind, series.label, bin.number, bin.name, bin.count, bin.percent, bin.passFail, bin.passed, bin.failed, bin.unknown];
  }
}
async function* wafers(view, options) {
  const all = listWafers(view).items;
  const keys = options.waferKeys ?? all.map((w) => w.key);
  if (!Array.isArray(keys) || keys.length > 128) invalid('Export at most 128 wafer maps at a time.');
  for (const waferKey of keys) {
    const map = await waferMap(view, { waferKey });
    for (const die of map.dies) yield [map.stacked ? 'Stacked failed attempts' : map.wafer.name, map.wafer?.sourceName ?? 'Selected groups',
      map.wafer?.group ?? null, die.x, die.y, die.bin, die.failed, die.attempts, die.ambiguous, die.bins.join(';'), map.orientation.posX, map.orientation.posY, map.orientation.dieAspectRatio];
  }
}
async function* datalog(view) {
  for (const source of view.sources) {
    let after = 0;
    for (;;) {
      view.context.checkCancelled();
      const records = rowsBounded(view.db, `SELECT id,seq,type,subtype,device_id,json FROM ${source.alias}.metadata WHERE id>? AND type=50 AND subtype IN(10,30) ORDER BY id LIMIT 100`, [after]);
      if (!records.length) break;
      for (const record of records) {
        const parts = chunks(JSON.parse(record.json));
        for (let i = 0; i < parts.length; i++) yield [source.cache.dataset.name, source.datasetId, record.seq, record.type, record.subtype, record.device_id, i + 1, parts.length, parts[i]];
      }
      after = records.at(-1).id;
      await new Promise((done) => setTimeout(done, 0));
    }
  }
}

async function* convertedRecords(store, view, options) {
  const id = datasetId(options.datasetId ?? view.sources[0].datasetId);
  if (!view.caches.has(id)) invalid('Choose a source in this workspace.');
  const runtime = await loadParser(), opened = await store.access(id);
  let statement;
  try {
    const from = boundedInteger(options.fromSeq ?? 1, 1, opened.manifest.counts.records, 'First record');
    const to = boundedInteger(options.toSeq ?? opened.manifest.counts.records, from, opened.manifest.counts.records, 'Last record');
    statement = opened.db.prepare('SELECT seq,offset,length,type,subtype FROM records WHERE seq BETWEEN ? AND ? ORDER BY seq'); statement.bind([from, to]);
    let block = new Uint8Array(), start = 0, count = 0;
    while (statement.step()) {
      view.context.checkCancelled(); const r = statement.get({});
      if (r.offset < start || r.offset + r.length > start + block.length) {
        start = r.offset; block = new Uint8Array(await opened.file.slice(start, start + Math.max(65536, r.length)).arrayBuffer());
      }
      const bytes = block.subarray(r.offset - start, r.offset - start + r.length), decoded = JSON.parse(runtime.decode_record(bytes, opened.manifest.byteOrder));
      const jsonParts = chunks(decoded.fields), rawParts = options.includeRawHex === false ? [] : chunks(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
      yield [r.seq, r.offset, r.length, r.type, r.subtype, decoded.name, jsonParts.length, rawParts.length, ...jsonParts, ...rawParts];
      if (++count % 4096 === 0) { view.context.progress({ phase: 'record-conversion', rows: count, totalRows: to - from + 1 }); await new Promise((done) => setTimeout(done, 0)); }
    }
  } finally { statement?.finalize(); opened.db.close(); }
}

/** Generate a complete report into a disposable file, then return its download. */
export async function runViewerReport(store, message, context) {
  const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY, { create: true });
  if (message.action === 'release') {
    if (typeof message.token !== 'string' || !/^[0-9a-f-]{36}\.(xlsx|csv)$/.test(message.token)) invalid('Invalid report token.');
    try { await directory.removeEntry(message.token); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    return { released: true };
  }
  const options = message.options ?? {}, tests = options.tests ?? [];
  if (options.kind !== undefined && !['report', 'records', 'device', 'deviceCsv'].includes(options.kind)) invalid('Choose a supported report format.');
  if (['device', 'deviceCsv'].includes(options.kind) && (!options.device || typeof options.device !== 'object')) invalid('Choose a device attempt to export.');
  if (!Array.isArray(tests) || tests.length > 12) invalid('Choose up to twelve tests for a report.');
  tests.forEach(parseTestKey);
  const sections = options.sections ?? REPORT_SECTIONS;
  if (!Array.isArray(sections) || new Set(sections).size !== sections.length || sections.some((s) => !REPORT_SECTIONS.includes(s))) invalid('Choose supported report sections.');
  const view = await openViewerContext(store, message.selection, context);
  const extension = options.kind === 'deviceCsv' ? 'csv' : 'xlsx';
  const token = `${crypto.randomUUID()}.${extension}`; let writable;
  try {
    const spec = { ...options, tests }, definitions = {
      'File Info': { rows: information(view, spec), headers: ['Property / source', 'Value / sequence', 'Field / source ID', 'Part', 'Parts', 'Content'] },
      'DUT Summary': { rows: devices(view, spec), headers: ['Group', 'Source', 'Source ID', 'PIR sequence', 'Attempt index', 'Part ID', 'Part text', 'Head', 'Site', 'Part flags', 'Superseded', 'Tests', 'Test time (ms)', 'Hard bin', 'Soft bin', 'Wafer record', 'X', 'Y', ...tests.map((key) => { const t = parseTestKey(key); return `${t.number} ${t.name} ${t.channel} (${t.unit})`; })] },
      'Trend Chart': { rows: trends(view, spec), headers: ['Row kind', 'Statistics / displayed points (full counts in summary)'] },
      'Histogram': { rows: histograms(view, spec), headers: ['Test', 'Name', 'Unit', 'Channel', 'Series', 'Low edge', 'High edge', 'Upper endpoint', 'Count'] },
      'Bin Chart': { rows: bins(view, spec), headers: ['Kind', 'Series', 'Bin', 'Name', 'Count', 'Percent', 'Pass/fail', 'Passed', 'Failed', 'Unknown'] },
      'Wafer Map': { rows: wafers(view, spec), headers: ['Wafer', 'Source', 'Group', 'X', 'Y', 'Last soft bin', 'Failed attempts', 'Attempts', 'Mixed bins', 'All bins', 'Positive X', 'Positive Y', 'Die aspect'] },
      'Test Statistics': { rows: statistics(view, spec), headers: statHeaders },
      'GDR & DTR Summary': { rows: datalog(view), headers: ['Source', 'Source ID', 'Sequence', 'Type', 'Subtype', 'PIR context', 'Part', 'Parts', 'Typed record JSON'] },
    };
    const sheets = options.kind === 'records' ? [
      { name: 'Source and method', rows: information(view, spec) },
      { name: 'STDF records', headers: ['Sequence', 'Offset', 'Bytes', 'Type', 'Subtype', 'Record', 'JSON chunk count', 'Hex chunk count', 'Concatenate next N JSON chunks, followed by M raw-hex chunks'], rows: convertedRecords(store, view, spec) },
    ] : ['device', 'deviceCsv'].includes(options.kind) ? [
      { name: 'Device observations', headers: observationHeaders, rows: deviceObservations(view, spec), freezeRows: 1, autoFilter: true },
    ] : sections.map((name) => ({ name, ...definitions[name], freezeRows: 1, autoFilter: true }));
    if (!sheets.length) invalid('Choose at least one report section.');
    const images = options.images ?? [];
    if (!Array.isArray(images) || images.length > 128 || images.reduce((sum, image) => sum + (image.blob?.size ?? LIMIT), 0) > 64 * 1024 * 1024) invalid('Report chart images exceed the 64 MiB / 128 image limit.');
    const handle = await directory.getFileHandle(token, { create: true }); writable = await handle.createWritable();
    let bytes = 0;
    const sink = { async write(chunk) { context.checkCancelled(); bytes += chunk.byteLength; if (bytes > LIMIT) invalid('Report exceeds 16 GiB. Export fewer sources, tests or record sequences.'); await writable.write(chunk); }, close() { context.checkCancelled(); return writable.close(); }, abort: (error) => writable.abort(error) };
    const report = options.kind === 'deviceCsv' ? await writeDeviceCsv(sink, view, spec) : await writeWorkbook({ writable: sink, sheets, images, context });
    return { file: await handle.getFile(), filename: options.kind === 'records' ? 'stdf-records.xlsx' : ['device', 'deviceCsv'].includes(options.kind) ? `device-${options.device.deviceId}.${extension}` : 'semidata-report.xlsx', token, report };
  } catch (error) {
    await writable?.abort().catch(() => {}); await directory.removeEntry(token).catch(() => {}); throw error;
  } finally { view.close(); }
}
