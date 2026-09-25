// A deliberately small OOXML writer: values are literals, and rows stream to ZIP.
import { BlobReader, ZipWriter, TextReader } from './vendor/compression.js';
import { libraryError } from './dataset-schema.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const encoder = new TextEncoder();
const MAX_ROWS = 1048576, MAX_COLUMNS = 16384, MAX_TEXT = 32767;
const fail = (message) => { throw libraryError('INVALID_REPORT', message); };
const escapeXml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function cellText(value) {
  if (value.length > MAX_TEXT) fail('An Excel cell exceeds 32,767 characters. Narrow the report before exporting.');
  // OOXML escape sequences are meaningful even in inlineString. Protect literal
  // sequences before representing characters XML 1.0 cannot carry directly.
  return escapeXml(value.replace(/_x[0-9a-f]{4}_/gi, (v) => '_x005F_' + v.slice(1))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, (v) => `_x${v.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}_`)
    .replace(/[\ud800-\udfff]/gu, '\ufffd')).replaceAll('\r', '&#13;');
}
function columnName(index) {
  let result = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
function nextName(value, index, used) {
  let base = String(value ?? `Sheet ${index + 1}`).replace(/[\[\]:*?/\\\x00-\x1f\ufffe\uffff]/g, '_').trim().replace(/^'+|'+$/g, '').trim().slice(0, 31).replace(/^'+|'+$/g, '') || `Sheet ${index + 1}`;
  if (base.toLowerCase() === 'history') base = 'History_';
  let name = base, suffix = 1;
  while (used.has(name.toLowerCase())) { const tail = ` (${++suffix})`; name = base.slice(0, 31 - tail.length) + tail; }
  used.add(name.toLowerCase()); return name;
}
function nonnegativeInteger(value, maximum, label) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) fail(`Invalid ${label}.`);
  return value;
}
const tick = () => new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
  channel.port2.postMessage(null);
});

function readableText(parts, context) {
  const iterator = parts[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      try { context.checkCancelled(); const item = await iterator.next(); if (item.done) controller.close(); else controller.enqueue(encoder.encode(item.value)); }
      catch (error) { controller.error(error); await iterator.return?.(); }
    },
    async cancel() { await iterator.return?.(); },
  });
}
function rowXml(row, number, header = false) {
  if (!Array.isArray(row) || row.length > MAX_COLUMNS) fail('An Excel row must contain no more than 16,384 columns.');
  let rowBytes = 0;
  const cells = row.map((value, column) => {
    if (value == null) return '';
    const address = columnName(column) + number, style = header ? ' s="1"' : '';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('Excel numeric cells must be finite. Format NaN and infinity as text explicitly.');
      return `<c r="${address}"${style}><v>${Object.is(value, -0) ? '-0' : value}</v></c>`;
    }
    if (typeof value === 'boolean') return `<c r="${address}" t="b"${style}><v>${Number(value)}</v></c>`;
    if (typeof value !== 'string') fail('Excel cells accept strings, finite numbers, booleans, or null.');
    const text = cellText(value);
    rowBytes += encoder.encode(text).length;
    if (rowBytes > 1024 * 1024) fail('Excel row text exceeds the 1 MiB budget. Narrow its columns or text.');
    return `<c r="${address}" t="inlineStr"${style}><is><t xml:space="preserve">${text}</t></is></c>`;
  });
  return `<row r="${number}">${cells.join('')}</row>`;
}
async function* sheetXml(sheet, number, result, hasImages, context) {
  const freeze = nonnegativeInteger(sheet.freezeRows ?? (sheet.headers ? 1 : 0), MAX_ROWS - 1, 'frozen row count');
  yield `${XML}<worksheet xmlns="${NS}" xmlns:r="${REL}"><sheetViews><sheetView workbookViewId="0">${freeze ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/>` : ''}</sheetView></sheetViews><sheetData>`;
  let count = 0, columns = 0, batch = '', batchBytes = 0;
  const append = (row, header) => {
    if (++count > MAX_ROWS) fail('An Excel sheet exceeds 1,048,576 rows, including its header. Narrow or split the report before exporting.');
    const xml = rowXml(row, count, header); columns = Math.max(columns, row.length); return xml;
  };
  if (sheet.headers) yield append(sheet.headers, true);
  try {
    for await (const row of sheet.rows) {
      context.checkCancelled();
      const xml = append(row, false);
      // One row is capped separately below; ordinary rows are batched to 64 KiB.
      const size = encoder.encode(xml).length;
      if (size > 2 * 1024 * 1024) fail('An Excel row exceeds the 2 MiB export budget. Narrow its columns or text.');
      if (batchBytes + size > 65536 && batch) { yield batch; batch = ''; batchBytes = 0; }
      batch += xml; batchBytes += size;
      if (count % 1024 === 0) { context.progress({ phase: 'report', sheet: number, rows: count }); await tick(); }
    }
    if (batch) yield batch;
    yield `</sheetData>${sheet.autoFilter && count && columns ? `<autoFilter ref="A1:${columnName(columns - 1)}${count}"/>` : ''}${hasImages ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
    result.rows = count; result.columns = columns;
  } finally { context.checkCancelled(); }
}

async function imageMetadata(images, sheets) {
  if (!Array.isArray(images) || images.length > 256) fail('A workbook supports no more than 256 PNG images.');
  let bytes = 0;
  const output = [];
  for (const [index, image] of images.entries()) {
    let sheet = image.sheet;
    if (typeof sheet === 'string') sheet = sheets.findIndex((candidate) => candidate.name === sheet);
    if (!Number.isInteger(sheet) || sheet < 0 || sheet >= sheets.length) fail('An image references an unknown worksheet.');
    if (!(image.blob instanceof Blob) || image.blob.size < 24 || (bytes += image.blob.size) > 64 * 1024 * 1024) fail('Workbook PNG images exceed the 64 MiB budget or are invalid.');
    const head = new Uint8Array(await image.blob.slice(0, 24).arrayBuffer());
    if (![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every((b, n) => head[n] === b)) fail('Report images must be PNG files with an IHDR header.');
    const view = new DataView(head.buffer), anchor = image.anchor ?? {};
    const width = anchor.width ?? view.getUint32(16), height = anchor.height ?? view.getUint32(20);
    if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 100000)) fail('Invalid PNG image dimensions.');
    output.push({ ...image, sheet, index: index + 1, column: nonnegativeInteger(anchor.column ?? 0, MAX_COLUMNS - 1, 'image column'), row: nonnegativeInteger(anchor.row ?? 0, MAX_ROWS - 1, 'image row'), width, height });
  }
  return output;
}
function drawingXml(images) {
  return `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">${images.map((image) => `<xdr:oneCellAnchor><xdr:from><xdr:col>${image.column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${image.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(image.width * 9525)}" cy="${Math.round(image.height * 9525)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${image.index}" name="Chart ${image.index}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${image.index}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`).join('')}</xdr:wsDr>`;
}
const relationships = (items) => `${XML}<Relationships xmlns="${PACKAGE_REL}">${items.map(({ id, type, target }) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${escapeXml(target)}"/>`).join('')}</Relationships>`;

/** Close writable only on success; abort it on any validation, cancellation, or I/O error. */
export async function writeWorkbook({ writable, sheets, images = [], context = {} }) {
  const hooks = { checkCancelled: () => context.checkCancelled?.(), progress: (event) => context.progress?.(event) };
  let bytes = 0;
  try {
    hooks.checkCancelled();
    if (!writable || typeof writable.write !== 'function' || typeof writable.close !== 'function' || typeof writable.abort !== 'function') fail('Provide a writable file stream supporting write, close, and abort.');
    if (!Array.isArray(sheets) || !sheets.length || sheets.length > 64 || sheets.some((sheet) => !sheet || !sheet.rows?.[Symbol.asyncIterator] && !sheet.rows?.[Symbol.iterator])) fail('Choose one to 64 worksheets with iterable rows.');
    const names = [], usedNames = new Set(), pictures = await imageMetadata(images, sheets), results = [];
    const sink = new WritableStream({ async write(chunk) { hooks.checkCancelled(); bytes += chunk.byteLength; if (bytes > 64 * 1024 ** 3) fail('Workbook exceeds the 64 GiB output limit.'); await writable.write(chunk); } });
    const zip = new ZipWriter(sink, { level: 0, useWebWorkers: false, zip64: true, bufferedWrite: false, preventClose: true });
    const addText = (path, text) => zip.add(path, new TextReader(text), { level: 0 });
    await addText('_rels/.rels', relationships([{ id: 'rId1', type: 'officeDocument', target: 'xl/workbook.xml' }]));
    await addText('xl/styles.xml', `${XML}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    const drawings = [];
    for (const [i, sheet] of sheets.entries()) {
      hooks.checkCancelled();
      const iterator = sheet.rows[Symbol.asyncIterator]?.() ?? sheet.rows[Symbol.iterator]();
      let next = await iterator.next(), part = 0;
      try {
        do {
          if (results.length >= 1024) fail('Workbook exceeds 1,024 physical worksheets after splitting.');
          const number = results.length + 1, name = nextName(sheet.name, i, usedNames);
          const result = { name, sourceSheet: i, part: ++part }; names.push(name); results.push(result);
          const capacity = MAX_ROWS - (sheet.headers ? 1 : 0);
          async function* rows() {
            let count = 0;
            while (!next.done && count++ < capacity) { yield next.value; next = await iterator.next(); }
          }
          const localImages = part === 1 ? pictures.filter((image) => image.sheet === i) : [];
          await zip.add(`xl/worksheets/sheet${number}.xml`, readableText(sheetXml({ ...sheet, rows: rows() }, number, result, localImages.length > 0, hooks), hooks), { level: 0 });
          if (localImages.length) {
            drawings.push(number);
            await addText(`xl/worksheets/_rels/sheet${number}.xml.rels`, relationships([{ id: 'rId1', type: 'drawing', target: `../drawings/drawing${number}.xml` }]));
            await addText(`xl/drawings/drawing${number}.xml`, drawingXml(localImages));
            await addText(`xl/drawings/_rels/drawing${number}.xml.rels`, relationships(localImages.map((image) => ({ id: `rId${image.index}`, type: 'image', target: `../media/image${image.index}.png` }))));
          }
        } while (!next.done);
      } finally { await iterator.return?.(); }
    }
    await addText('xl/workbook.xml', `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
    await addText('xl/_rels/workbook.xml.rels', relationships([...results.map((_, i) => ({ id: `rId${i + 1}`, type: 'worksheet', target: `worksheets/sheet${i + 1}.xml` })), { id: 'rIdStyles', type: 'styles', target: 'styles.xml' }]));
    for (const image of pictures) await zip.add(`xl/media/image${image.index}.png`, new BlobReader(image.blob), { level: 0 });
    const override = (path, kind) => `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${kind}+xml"/>`;
    await addText('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${pictures.length ? '<Default Extension="png" ContentType="image/png"/>' : ''}${override('xl/workbook.xml', 'spreadsheetml.sheet.main')}${override('xl/styles.xml', 'spreadsheetml.styles')}${results.map((_, i) => override(`xl/worksheets/sheet${i + 1}.xml`, 'spreadsheetml.worksheet')).join('')}${drawings.map((i) => override(`xl/drawings/drawing${i}.xml`, 'drawing')).join('')}</Types>`);
    await zip.close(); hooks.checkCancelled(); await writable.close();
    return { bytes, sheets: results, images: pictures.length };
  } catch (error) { try { await writable?.abort?.(error); } catch { /* Preserve the original cause. */ } throw error; }
}
