import { openViewerContext, rowsBounded } from './viewer-context.js';
import { overview, listViewerTests, listDevices, readDevice, readMetadata } from './viewer-tables.js';
import { analyzeTest } from './viewer-analysis.js';
import { binChart, listWafers, waferMap } from './viewer-maps.js';
import { boundedInteger, datasetId, invalid } from './viewer-model.js';
import { loadParser } from './import-source.js';

export async function runViewerQuery(store, message, context) {
  const options = message.options ?? {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('Viewer options must be an object.');
  const actions = ['prepare', 'overview', 'tests', 'devices', 'device', 'analyze', 'bins', 'wafers', 'wafer', 'records', 'record', 'rawRecords', 'advanced'];
  if (!actions.includes(message.action)) invalid('Unknown viewer operation.');
  const view = await openViewerContext(store, message.selection, context);
  try {
    switch (message.action) {
      case 'advanced': {
        const { runAdvancedQuery } = await import('./viewer-advanced-queries.js');
        return await runAdvancedQuery(view, options);
      }
      case 'prepare': return { sources: [...view.caches.values()].map(({ dataset, manifest, reused }) => ({ dataset, manifest, reused })) };
      case 'overview': return await overview(view);
      case 'tests': return listViewerTests(view, options);
      case 'devices': return await listDevices(view, options);
      case 'device': return readDevice(view, options);
      case 'analyze': return await analyzeTest(view, options);
      case 'bins': return await binChart(view, options);
      case 'wafers': return listWafers(view);
      case 'wafer': return await waferMap(view, options);
      case 'records': return readMetadata(view, options);
      case 'record':
      case 'rawRecords': {
        const id = datasetId(options.datasetId);
        if (!view.caches.has(id)) invalid('Source is outside this workspace.');
        const opened = await store.access(id);
        try {
          if (message.action === 'rawRecords') {
            const after = boundedInteger(options.after ?? 0, 0, Number.MAX_SAFE_INTEGER, 'Record cursor');
            const limit = boundedInteger(options.limit ?? 100, 1, 1000, 'Page size');
            const filters = ['seq>?'], args = [after];
            for (const field of ['type', 'subtype']) if (options[field] != null) {
              filters.push(`${field}=?`); args.push(boundedInteger(options[field], 0, 255, `Record ${field}`));
            }
            const items = rowsBounded(opened.db, `SELECT seq,offset,length,type,subtype,device_id FROM records WHERE ${filters.join(' AND ')} ORDER BY seq LIMIT ?`, [...args, limit + 1]);
            let more = items.length > limit; if (more) items.pop();
            if(options.decode===true){
              const runtime=await loadParser();let bytes=0,read=0;
              for(const record of items){
                context.checkCancelled();
                const raw=new Uint8Array(await opened.file.slice(record.offset,record.offset+record.length).arrayBuffer());
                const json=runtime.decode_record(raw,opened.manifest.byteOrder);
                if(bytes+json.length*2>2*1024*1024){more=true;break;}
                bytes+=json.length*2;record.decoded=JSON.parse(json);read++;
              }
              if(!read&&items.length)invalid('A decoded record exceeds the page response limit. Open it individually.');
              items.length=read;
            }
            return { items, nextAfter: more ? items.at(-1).seq : null };
          }
          const seq = boundedInteger(options.seq, 1, Number.MAX_SAFE_INTEGER, 'Record sequence');
          const record = opened.db.selectObject('SELECT seq,offset,length,type,subtype,device_id FROM records WHERE seq=?', [seq]);
          if (!record || record.offset < 0 || record.length < 4 || record.length > 65539 || record.offset + record.length > opened.file.size) invalid('Record is outside the retained source.');
          const bytes = new Uint8Array(await opened.file.slice(record.offset, record.offset + record.length).arrayBuffer());
          const runtime = await loadParser();
          return { record, decoded: JSON.parse(runtime.decode_record(bytes, opened.manifest.byteOrder)), bytes: bytes.buffer };
        } finally { opened.db.close(); }
      }
    }
  } finally { view.close(); }
}
