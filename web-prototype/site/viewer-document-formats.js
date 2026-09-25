import { ZipWriter, TextReader, BlobReader } from './vendor/compression.js';
import { writeWorkbook } from './xlsx-writer.js';

const encoder = new TextEncoder(), DIRECTORY = 'semidata-document-exports-v1';
const MAX_BYTES = 128 * 1024 * 1024;
const clean = value => String(value ?? '').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const xml = value => clean(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

export function normalizeReportLayout(input = {}) {
  const pageWidthMm = input.pageWidthMm ?? 210, pageHeightMm = input.pageHeightMm ?? 297, imageWidthPx = input.imageWidthPx ?? 1200;
  if (!Number.isFinite(pageWidthMm) || pageWidthMm < 148 || pageWidthMm > 420 || !Number.isFinite(pageHeightMm) || pageHeightMm < 148 || pageHeightMm > 594) throw Error('Report pages require a width of 148–420 mm and height of 148–594 mm.');
  if (!Number.isInteger(imageWidthPx) || imageWidthPx < 800 || imageWidthPx > 2400 || Math.round(imageWidthPx * pageHeightMm / pageWidthMm) > 4800) throw Error('Report image width must be 800–2,400 pixels and page height at most 4,800 pixels.');
  return { pageWidthMm, pageHeightMm, imageWidthPx };
}

export function validateDocumentReport(report) {
  if (!report || typeof report.title !== 'string' || !report.title.trim() || report.title.length > 200) throw Error('Report title must contain 1–200 characters.');
  if (!Array.isArray(report.sections) || !report.sections.length || report.sections.length > 128) throw Error('Choose 1–128 report sections.');
  normalizeReportLayout(report.layout);
  let characters = report.title.length, rows = 0, imageBytes = 0;
  for (const section of report.sections) {
    characters += clean(section.title).length;
    if (section.paragraphs && (!Array.isArray(section.paragraphs) || section.paragraphs.length > 1000)) throw Error('Too many report paragraphs.');
    for (const paragraph of section.paragraphs ?? []) characters += clean(paragraph).length;
    if (section.table) {
      const { headers, rows: entries } = section.table;
      if (!Array.isArray(headers) || !headers.length || headers.length > 12 || !Array.isArray(entries)) throw Error('Report tables require 1–12 columns.');
      rows += entries.length; characters += headers.reduce((sum, value) => sum + clean(value).length, 0);
      for (const row of entries) {
        if (!Array.isArray(row) || row.length !== headers.length) throw Error('Report rows must match their column count.');
        characters += row.reduce((sum, value) => sum + clean(value).length, 0);
      }
    }
    if (section.image) {
      if (!(section.image instanceof Blob) || !['image/png', 'image/jpeg'].includes(section.image.type)) throw Error('Charts must be PNG or JPEG images.');
      imageBytes += section.image.size;
    }
  }
  if (characters > 1000000 || rows > 5000 || imageBytes > 64 * 1024 * 1024) throw Error('Report exceeds one million characters, 5,000 summary rows or 64 MiB of charts. Narrow the report scope.');
  return { characters, rows, imageBytes };
}

function wrap(ctx, text, width) {
  const result = [];
  for (const paragraph of clean(text).split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/u)) {
      if (ctx.measureText(line + word).width <= width) { line += word; continue; }
      if (line.trim()) { result.push(line.trimEnd()); line = ''; }
      if (ctx.measureText(word).width <= width) { line = word.trimStart(); continue; }
      for (const character of word) {
        if (ctx.measureText(line + character).width > width && line) { result.push(line); line = ''; }
        line += character;
      }
    }
    result.push(line.trimEnd());
  }
  return result;
}
const canvasBlob = (canvas, type) => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Could not render report page.')), type, 0.94));

export async function renderDocumentPages(report, { checkCancelled = () => {}, onProgress = () => {} } = {}) {
  validateDocumentReport(report);
  const layout = normalizeReportLayout(report.layout), PAGE = { width: layout.pageWidthMm * 1200 / 210, height: layout.pageHeightMm * 1200 / 210, margin: 84 };
  PAGE.bottom = PAGE.height - 117; const maxChartHeight = Math.min(630, PAGE.bottom - 240);
  const canvas = document.createElement('canvas'); canvas.width = layout.imageWidthPx; canvas.height = Math.round(layout.imageWidthPx * layout.pageHeightMm / layout.pageWidthMm);
  const ctx = canvas.getContext('2d'), pages = []; ctx.scale(canvas.width / PAGE.width, canvas.height / PAGE.height); let y = 0, bytes = 0;
  const start = () => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE.width, PAGE.height); ctx.textBaseline = 'top';
    ctx.font = '20px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#606a77';
    ctx.fillText('SEMIDATA   /   TEST DATA REPORT', PAGE.margin, 40); y = 100;
  };
  const flush = async () => {
    checkCancelled();
    if (pages.length >= 100) throw Error('Report exceeds 100 pages. Narrow its sections or scope.');
    ctx.font = '18px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#67717d';
    ctx.fillText(clean(report.createdAt ?? '').slice(0, 19).replace('T', ' ') + ' UTC', PAGE.margin, PAGE.height - 73);
    ctx.textAlign = 'right'; ctx.fillText(String(pages.length + 1), PAGE.width - PAGE.margin, PAGE.height - 73); ctx.textAlign = 'left';
    const png = await canvasBlob(canvas, 'image/png'), jpeg = await canvasBlob(canvas, 'image/jpeg');
    bytes += png.size + jpeg.size; if (bytes > MAX_BYTES) throw Error('Rendered report pages exceed 128 MiB. Narrow the report scope.');
    pages.push({ png, jpeg, width: canvas.width, height: canvas.height });
    onProgress({ phase: 'document-pages', pages: pages.length }); await tick(); checkCancelled(); start();
  };
  const room = async height => { if (y + height > PAGE.bottom) await flush(); };
  const paragraph = async (text, size = 22, bold = false, color = '#172331') => {
    ctx.font = `${bold ? '600 ' : ''}${size}px "Segoe UI", Arial, sans-serif`;
    const lines = wrap(ctx, text, PAGE.width - 2 * PAGE.margin), height = Math.ceil(size * 1.4);
    for (const line of lines) { await room(height); ctx.font = `${bold ? '600 ' : ''}${size}px "Segoe UI", Arial, sans-serif`; ctx.fillStyle = color; ctx.fillText(line, PAGE.margin, y); y += height; }
    y += 10;
  };
  start();
  await paragraph(report.title, 42, true); await paragraph(report.scope ?? 'Current selection', 22, false, '#526273');
  for (const section of report.sections) {
    checkCancelled();
    let headingRoom = 130;
    if (section.image) { const bitmap = await createImageBitmap(section.image); headingRoom = 100 + Math.min((PAGE.width - 2 * PAGE.margin) * bitmap.height / bitmap.width, maxChartHeight); bitmap.close(); }
    await room(headingRoom); await paragraph(section.title, 30, true);
    for (const text of section.paragraphs ?? []) await paragraph(text);
    if (section.table) {
      const { headers, rows } = section.table, width = (PAGE.width - 2 * PAGE.margin) / headers.length, font = headers.length > 7 ? 17 : 20, lineHeight = font + 8;
      const rowLines = values => { ctx.font = `${font}px "Segoe UI", Arial, sans-serif`; return values.map(value => wrap(ctx, value, width - 20)); };
      const headerLines = rowLines(headers), headerHeight = Math.max(...headerLines.map(lines => lines.length)) * lineHeight + 18;
      if (headerHeight > PAGE.bottom - 160) throw Error('A report table header is too tall for a page. Shorten its labels.');
      const paint = (lines, startLine, count, header = false) => {
        const height = count * lineHeight + 18;
        ctx.fillStyle = header ? '#edf2f6' : '#ffffff'; ctx.fillRect(PAGE.margin, y, width * headers.length, height);
        ctx.strokeStyle = '#dce2e8'; ctx.lineWidth = 1; ctx.strokeRect(PAGE.margin, y, width * headers.length, height);
        ctx.fillStyle = '#172331'; ctx.font = `${header ? '600 ' : ''}${font}px "Segoe UI", Arial, sans-serif`;
        lines.forEach((column, index) => column.slice(startLine, startLine + count).forEach((line, offset) => ctx.fillText(line, PAGE.margin + index * width + 10, y + 9 + offset * lineHeight)));
        y += height;
      };
      await room(headerHeight + 50); paint(headerLines, 0, Math.max(...headerLines.map(lines => lines.length)), true);
      for (const row of rows) {
        const lines = rowLines(row), count = Math.max(...lines.map(column => column.length)); let offset = 0;
        while (offset < count) {
          if (PAGE.bottom - y < lineHeight + 18) { await flush(); paint(headerLines, 0, Math.max(...headerLines.map(column => column.length)), true); }
          const take = Math.min(count - offset, Math.floor((PAGE.bottom - y - 18) / lineHeight));
          paint(lines, offset, take); offset += take;
          if (offset < count) { await flush(); paint(headerLines, 0, Math.max(...headerLines.map(column => column.length)), true); }
        }
      }
      y += 20;
    }
    if (section.image) {
      const bitmap = await createImageBitmap(section.image);
      try {
        const scale = Math.min((PAGE.width - 2 * PAGE.margin) / bitmap.width, maxChartHeight / bitmap.height), width = bitmap.width * scale, height = bitmap.height * scale;
        await room(height + 20); ctx.drawImage(bitmap, PAGE.margin + (PAGE.width - 2 * PAGE.margin - width) / 2, y, width, height); y += height + 20;
      } finally { bitmap.close(); }
    }
  }
  await flush(); canvas.width = canvas.height = 1; return pages;
}

function reportReceipt(report) {
  return { format: 'semidata-document-report', version: 1, createdAt: report.createdAt, title: report.title, scope: report.scope,
    provenance: report.provenance, layout: normalizeReportLayout(report.layout), sections: report.sections.map(({ image, ...section }) => ({ ...section, chartIncluded: Boolean(image) })),
    presentation: 'PDF and page images are rasterized for Unicode fidelity. Word text and tables are editable. Source measurements are not embedded unless explicitly shown in a section.' };
}

async function writePdf(sink, report, pages) {
  const layout = normalizeReportLayout(report.layout), pageWidth = layout.pageWidthMm * 72 / 25.4, pageHeight = layout.pageHeightMm * 72 / 25.4;
  const objects = [null, null, null], add = body => { objects.push(body); return objects.length - 1; }, pageIds = [];
  for (const page of pages) {
    const image = add([`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.size} >>\nstream\n`, page.jpeg, '\nendstream']);
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`, stream = add(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  const receipt = encoder.encode(JSON.stringify(reportReceipt(report), null, 2));
  const attachment = add([`<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length ${receipt.length} >>\nstream\n`, receipt, '\nendstream']);
  const file = add(`<< /Type /Filespec /F (report-receipt.json) /EF << /F ${attachment} 0 R >> >>`);
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(report-receipt.json) ${file} 0 R] >> >> >>`;
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`;
  const offsets = [0]; let position = 0;
  const write = async value => { const data = typeof value === 'string' ? encoder.encode(value) : value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value; await sink.write(data); position += data.length; };
  await write('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = position; await write(`${i} 0 obj\n`);
    for (const part of Array.isArray(objects[i]) ? objects[i] : [objects[i]]) await write(part);
    await write('\nendobj\n');
  }
  const xref = position;
  await write(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

const paragraphXml = (value, style = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${style === 'Heading1' || style === 'Title' ? '<w:keepNext/><w:keepLines/>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
function tableXml(table, availableWidth = 10000) {
  const width = Math.floor(availableWidth / table.headers.length), row = (values, header) => `<w:tr><w:trPr><w:cantSplit/>${header ? '<w:tblHeader/>' : ''}</w:trPr>${values.map(value => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:fill="EDF2F6"/>' : ''}</w:tcPr>${paragraphXml(value, header ? 'TableHeader' : 'TableText')}</w:tc>`).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${availableWidth}" w:type="dxa"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(edge => `<w:${edge} w:val="single" w:sz="4" w:color="DCE2E8"/>`).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${table.headers.map(() => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${row(table.headers, true)}${table.rows.map(values => row(values, false)).join('')}</w:tbl>`;
}
async function writeDocx(sink, report) {
  const layout = normalizeReportLayout(report.layout), pageWidth = Math.round(layout.pageWidthMm * 1440 / 25.4), pageHeight = Math.round(layout.pageHeightMm * 1440 / 25.4), contentWidth = pageWidth - 1800;
  const zip = new ZipWriter(new WritableStream({ write: data => sink.write(data) }), { level: 0, useWebWorkers: false, bufferedWrite: false, preventClose: true });
  const text = (path, data) => zip.add(path, new TextReader(data), { level: 0 });
  const relationships = [], blocks = [paragraphXml(report.title, 'Title'), paragraphXml(report.scope), paragraphXml(`Generated ${report.createdAt}`)]; let imageIndex = 0;
  for (const section of report.sections) {
    const imageOnly = section.image && !section.table && !section.paragraphs?.length;
    if (!imageOnly) blocks.push(paragraphXml(section.title, 'Heading1'), ...(section.paragraphs ?? []).map(value => paragraphXml(value)));
    if (section.table) blocks.push(tableXml(section.table, contentWidth));
    if (section.image) {
      const bitmap = await createImageBitmap(section.image), scale = Math.min((contentWidth - 120) * 635 / bitmap.width, Math.min(6800000, (pageHeight - 3300) * 635) / bitmap.height), width = Math.round(scale * bitmap.width), height = Math.round(scale * bitmap.height); bitmap.close();
      const number = ++imageIndex, extension = section.image.type === 'image/png' ? 'png' : 'jpg', target = `media/image${number}.${extension}`;
      relationships.push(`<Relationship Id="image${number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`);
      await zip.add(`word/${target}`, new BlobReader(section.image), { level: 0 });
      // Keep the caption and drawing in one paragraph: some Word-compatible
      // renderers ignore keepNext between a heading and an image paragraph.
      const caption = imageOnly ? `<w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>${xml(section.title)}</w:t><w:br/></w:r>` : '';
      blocks.push(`<w:p><w:pPr><w:keepLines/><w:spacing w:before="240" w:after="180"/></w:pPr>${caption}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${number}" name="Chart ${number}" descr="${xml(section.title)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${number}" name="Chart ${number}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image${number}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    }
  }
  const ns = 'http://schemas.openxmlformats.org/';
  await text('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
  await text('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="doc" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  await text('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="styles" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="footer" Type="${ns}officeDocument/2006/relationships/footer" Target="footer.xml"/>${relationships.join('')}</Relationships>`);
  await text('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="${ns}wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Malgun Gothic"/><w:sz w:val="22"/><w:color w:val="172331"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:keepNext/><w:spacing w:after="180"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="TableText"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="TableHeader"/><w:basedOn w:val="TableText"/><w:rPr><w:b/><w:sz w:val="18"/></w:rPr></w:style></w:styles>`);
  await text('word/footer.xml', `<?xml version="1.0"?><w:ftr xmlns:w="${ns}wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`);
  await text('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${ns}wordprocessingml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships" xmlns:wp="${ns}drawingml/2006/wordprocessingDrawing" xmlns:a="${ns}drawingml/2006/main" xmlns:pic="${ns}drawingml/2006/picture"><w:body>${blocks.join('')}<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="${pageWidth}" w:h="${pageHeight}"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="420" w:footer="420"/></w:sectPr></w:body></w:document>`);
  await text('report-receipt.json', JSON.stringify(reportReceipt(report), null, 2)); await zip.close();
}

async function writeSummaryWorkbook(sink, report, checkCancelled, onProgress) {
  if (report.sections.length > 63) throw Error('Excel summary reports support up to 63 sections plus provenance. Select fewer sections.');
  const sheets = [], images = [];
  for (const section of report.sections) {
    checkCancelled();
    const rows = (section.paragraphs ?? []).map(paragraph => [paragraph]);
    if (section.table) rows.push([], section.table.headers, ...section.table.rows);
    const sheet = sheets.length, columns = section.table?.headers.length ?? 1;
    sheets.push({ name: section.title, headers: [section.title], rows, freezeRows: 1, wrapText: true, columnWidths: Array.from({ length: columns }, (_, index) => index === 0 ? 48 : 24) });
    if (section.image) {
      let blob = section.image;
      const bitmap = await createImageBitmap(blob), width = Math.min(bitmap.width, 1040), height = bitmap.height * width / bitmap.width;
      try {
        if (blob.type !== 'image/png') {
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.round(height); canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); blob = await canvasBlob(canvas, 'image/png'); canvas.width = canvas.height = 1;
        }
      } finally { bitmap.close(); }
      images.push({ sheet, blob, anchor: { column: 0, row: rows.length + 2, width, height } });
    }
  }
  const receipt = reportReceipt(report), json = JSON.stringify(receipt), rows = [['Title', report.title], ['Created UTC', report.createdAt], ['Scope', report.scope], ['Contents', 'Selected report summaries and charts. Complete source measurements remain in the local library.'], ['Layout', JSON.stringify(receipt.layout)], ['Selection', JSON.stringify(report.provenance?.selection ?? null)]];
  for (const source of report.provenance?.sources ?? []) rows.push(['Source', source.name, source.datasetId, source.sha256]);
  // Split at UTF-16 boundaries without separating a surrogate pair. Consumers
  // can concatenate these cells to recover the complete, exact report receipt.
  for (let start = 0, part = 1; start < json.length; part++) {
    let end = Math.min(start + 30000, json.length); if (end < json.length && /[\ud800-\udbff]/.test(json[end - 1])) end--;
    rows.push([`Receipt JSON ${part}`, json.slice(start, end)]); start = end;
  }
  sheets.push({ name: 'Provenance', headers: ['Field', 'Value', 'Source ID', 'SHA-256'], rows, freezeRows: 1, wrapText: true, columnWidths: [28, 60, 42, 68] });
  await writeWorkbook({ writable: { write: data => sink.write(data), close: async () => {}, abort: async () => {} }, sheets, images, zip64: false, context: { checkCancelled, progress: onProgress } });
}

export async function createDocumentExports(report, { formats = ['pdf'], checkCancelled = () => {}, onProgress = () => {} } = {}) {
  validateDocumentReport(report);
  if (!Array.isArray(formats) || !formats.length || formats.length > 5 || new Set(formats).size !== formats.length || formats.some(format => !['pdf', 'docx', 'png', 'jpg', 'xlsx'].includes(format))) throw Error('Choose PDF, Word, PNG, JPEG or Excel summary.');
  checkCancelled(); const root = await navigator.storage.getDirectory(), directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
  const pages = formats.some(format => ['pdf', 'png', 'jpg'].includes(format)) ? await renderDocumentPages(report, { checkCancelled, onProgress }) : [];
  const files = [], tokens = [], receipt = { ...reportReceipt(report), files: [] };
  try {
    for (const format of formats) {
      checkCancelled(); const extension = ['png', 'jpg'].includes(format) && pages.length > 1 ? 'zip' : format;
      const token = `${crypto.randomUUID()}.${extension}`; tokens.push(token);
      const handle = await directory.getFileHandle(token, { create: true }), writable = await handle.createWritable(); let bytes = 0;
      const sink = { async write(data) { checkCancelled(); bytes += data.size ?? data.byteLength; if (bytes > MAX_BYTES) throw Error('A generated document exceeds 128 MiB.'); await writable.write(data); } };
      try {
        if (format === 'pdf') await writePdf(sink, report, pages);
        else if (format === 'docx') await writeDocx(sink, report);
        else if (format === 'xlsx') await writeSummaryWorkbook(sink, report, checkCancelled, onProgress);
        else if (pages.length === 1) await sink.write(format === 'png' ? pages[0].png : pages[0].jpeg);
        else {
          const zip = new ZipWriter(new WritableStream({ write: data => sink.write(data) }), { level: 0, useWebWorkers: false, bufferedWrite: false, preventClose: true });
          for (const [index, page] of pages.entries()) await zip.add(`page-${String(index + 1).padStart(3, '0')}.${format}`, new BlobReader(format === 'png' ? page.png : page.jpeg), { level: 0 });
          await zip.add('report-receipt.json', new TextReader(JSON.stringify(reportReceipt(report), null, 2)), { level: 0 }); await zip.close();
        }
        checkCancelled(); await writable.close(); checkCancelled();
      } catch (error) { try { await writable.abort(); } catch {} throw error; }
      const stem = clean(report.filenameStem ?? 'report').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100).replace(/[. ]+$/g, '') || 'report';
      const file = await handle.getFile(), filename = `semidata-${stem}-${format}.${extension}`;
      files.push({ file, filename, token, format, pages: ['docx', 'xlsx'].includes(format) ? null : pages.length });
      receipt.files.push({ filename, format, bytes: file.size, pages: ['docx', 'xlsx'].includes(format) ? null : pages.length });
      onProgress({ phase: 'document-format', completed: files.length, total: formats.length }); await tick();
    }
    checkCancelled(); return { files, receipt };
  } catch (error) {
    for (const token of tokens) try { await directory.removeEntry(token); } catch {}
    throw error;
  }
}

/** A batch publishes links only after every requested scope/format completes. */
export async function createDocumentBatch(tasks, options = {}) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 16 || tasks.some(task => typeof task !== 'function')) throw Error('Choose one to sixteen report scopes.');
  const files = [], reports = [], checkCancelled = options.checkCancelled ?? (() => {});
  try {
    for (const [index, task] of tasks.entries()) {
      checkCancelled(); const report = await task(); checkCancelled();
      const result = await createDocumentExports(report, options); files.push(...result.files); reports.push(result.receipt);
      options.onProgress?.({ phase: 'document-batch', completed: index + 1, total: tasks.length });
    }
    checkCancelled(); return { files, receipt: { format: 'semidata-document-batch', version: 1, createdAt: new Date().toISOString(), reports, files: reports.flatMap(report => report.files) } };
  } catch (error) {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY, { create: true });
    for (const file of files) try { await directory.removeEntry(file.token); } catch {}
    throw error;
  }
}
