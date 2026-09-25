import { scopeWhere, eachRow, rowsBounded } from './viewer-context.js';
import { deviceFilter } from './viewer-tables.js';
import { invalid, boundedInteger, datasetId, deviceOutcome } from './viewer-model.js';

export async function binChart(view, options) {
  const kind = options.kind ?? 'soft'; if (!['hard', 'soft'].includes(kind)) invalid('Choose hardware or software bins.');
  const column = `${kind}_bin`, scope = scopeWhere(view.selection), bySite = options.seriesBy === 'site';
  const labels = new Map(), prefix = kind === 'hard' ? 'HBIN' : 'SBIN';
  for (const source of view.sources) {
    const metadata = rowsBounded(view.db, `SELECT json FROM ${source.alias}.metadata WHERE type=1 AND subtype=? LIMIT 65537`, [kind === 'hard' ? 40 : 50], 8 * 1024 * 1024);
    for (const row of metadata) {
      const fields = JSON.parse(row.json), name = fields[`${prefix}_NAM`];
      if (!name) continue;
      const key = JSON.stringify([source.source, fields.HEAD_NUM, fields.SITE_NUM, fields[`${prefix}_NUM`]]);
      if (!labels.has(key)) {
        if (labels.size >= 65536) invalid('This selection contains too many bin declarations. Select fewer sources.');
        labels.set(key, new Set());
      }
      labels.get(key).add(name);
    }
  }
  const buckets = new Map();
  await eachRow(view, `SELECT d.source,d.group_id,d.head,d.site,d.${column} number,d.part_flags FROM v_devices d WHERE ${scope.sql} AND d.${column}!=65535`, scope.bind, (row) => {
    const site = bySite ? row.site : null, key = JSON.stringify([row.group_id, row.head, site, row.number]);
    if (!buckets.has(key)) {
      if (buckets.size >= 65536) invalid('Select fewer sources or sites for the bin chart.');
      buckets.set(key, { group_id: row.group_id, head: row.head, site, number: row.number, count: 0, passed: 0, failed: 0, names: new Set() });
    }
    const bucket = buckets.get(key); bucket.count++;
    bucket.passed += deviceOutcome(row.part_flags) === 'pass' ? 1 : 0;
    bucket.failed += deviceOutcome(row.part_flags) === 'fail' ? 1 : 0;
    // 255 is the summary/all-heads or all-sites designation. Labels from an
    // unrelated source, head or site must never bleed into this population.
    for (const head of new Set([row.head, 255])) for (const site of new Set([row.site, 255])) {
      for (const name of labels.get(JSON.stringify([row.source, head, site, row.number])) ?? []) bucket.names.add(name);
    }
  });
  const rows = [...buckets.values()].sort((a, b) => a.group_id - b.group_id || a.head - b.head || a.site - b.site || a.number - b.number);
  const series = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.group_id, row.head, row.site]);
    if (!series.has(key)) {
      if (series.size >= 64) invalid('Select fewer heads/sites for the bin chart.');
      series.set(key, { key, group: row.group_id, head: row.head, site: row.site,
        label: `${view.selection.groups[row.group_id].name} · Head ${row.head} · ${row.site === null ? 'All selected sites' : `Site ${row.site}`}`, total: 0, bins: [] });
    }
    const item = series.get(key); item.total += row.count;
    item.bins.push({ number: row.number, name: [...row.names].join(' / ') || `Bin ${row.number}`, count: row.count,
      passFail: row.passed === row.count ? 'P' : row.failed === row.count ? 'F' : 'U', passed: row.passed, failed: row.failed, unknown: row.count - row.passed - row.failed });
  }
  for (const item of series.values()) for (const bin of item.bins) bin.percent = item.total ? 100 * bin.count / item.total : 0;
  return { kind, series: [...series.values()], warnings: ['Counts use selected device attempts. Unrecorded bin 65535 is excluded from bin percentages.'] };
}

function orientation(fields = {}) {
  return { posX: fields.POS_X === 'L' ? 'L' : 'R', posY: fields.POS_Y === 'D' ? 'D' : 'U', flat: fields.WF_FLAT ?? 'unknown',
    dieAspectRatio: fields.DIE_WID > 0 && fields.DIE_HT > 0 ? fields.DIE_WID / fields.DIE_HT : 1, fields };
}
export function listWafers(view) {
  const wafers = [];
  for (const source of view.sources) {
    const rows = rowsBounded(view.db, `SELECT seq,subtype,json FROM ${source.alias}.metadata WHERE type=2 ORDER BY seq LIMIT 10001`, [], 8 * 1024 * 1024);
    if (rows.length > 10000) invalid('This source contains more than 10,000 wafer metadata records.');
    let geometry = {}, byHead = new Map();
    for (const row of rows) {
      const fields = JSON.parse(row.json);
      if (row.subtype === 30) {
        geometry = fields;
        for (const item of byHead.values()) item.orientation = orientation(geometry);
      }
      if (row.subtype === 10) {
        const item = { key: JSON.stringify([source.datasetId, row.seq, source.groupId]), datasetId: source.datasetId, id: row.seq,
          group: source.groupId, source: source.source, head: fields.HEAD_NUM, name: fields.WAFER_ID || `Wafer at record ${row.seq}`,
          sourceName: source.cache.dataset.name, orientation: orientation(geometry), fields };
        byHead.set(fields.HEAD_NUM, item); wafers.push(item);
      }
      if (row.subtype === 20 && byHead.has(fields.HEAD_NUM)) {
        const item = byHead.get(fields.HEAD_NUM);
        if (fields.WAFER_ID) item.name = fields.WAFER_ID;
        item.finish = fields;
      }
    }
  }
  return { items: wafers };
}

export async function waferMap(view, options) {
  const stacked = options.waferKey === 'stacked'; let selected;
  if (!stacked) {
    let key; try { key = JSON.parse(options.waferKey); } catch { invalid('Choose a wafer.'); }
    if (!Array.isArray(key) || key.length !== 3) invalid('Choose a wafer.');
    datasetId(key[0]); boundedInteger(key[1], 1, Number.MAX_SAFE_INTEGER, 'Wafer');
    boundedInteger(key[2], 0, view.selection.groups.length - 1, 'Group');
    selected = listWafers(view).items.find((w) => w.datasetId === key[0] && w.id === key[1] && w.group === key[2]);
    if (!selected) invalid('Wafer is outside this workspace.');
  }
  const filter = deviceFilter(view, { wafer: stacked ? 'stacked' : { datasetId: selected.datasetId, id: selected.id }, group: selected?.group ?? options.group });
  const conditions = [filter.sql, 'd.x!=-32768', 'd.y!=-32768', 'd.wafer_id IS NOT NULL'], bind = [...filter.bind];
  if (options.bounds) for (const axis of ['x', 'y']) {
    const values = options.bounds[axis];
    if (!Array.isArray(values) || values.length !== 2) invalid('Map bounds require X and Y intervals.');
    values.forEach((n) => boundedInteger(n, -32767, 32767, 'Coordinate'));
    if (values[0] > values[1]) invalid('Invalid wafer viewport.');
    conditions.push(`d.${axis} BETWEEN ? AND ?`); bind.push(...values);
  }
  const cells = new Map(), binTotals = new Map(), outcomes = { passed:0, failed:0, unknown:0 }; let attempts = 0, coordinateBins = 0;
  // Counts are commutative. Track the last attempt explicitly, avoiding a
  // population-sized SQLite TEMP sort before the bounded coordinate guard.
  await eachRow(view, `SELECT d.x,d.y,d.soft_bin,d.part_flags,d.id,d.dataset_id,d.source,d.prr_seq FROM v_devices d WHERE ${conditions.join(' AND ')}`, bind, (row) => {
    const key = `${row.x}/${row.y}`;
    if (!cells.has(key)) {
      if (cells.size >= 50000) invalid('This map exceeds 50,000 coordinates. Select a wafer or a smaller X/Y viewport.');
      cells.set(key, { x: row.x, y: row.y, count: 0, failed: 0, attempts: 0, bin: row.soft_bin, bins: new Set(), lastSource: -1, lastPrr: -1 });
    }
    const cell = cells.get(key); cell.attempts++; attempts++;
    const outcome = deviceOutcome(row.part_flags), field = { pass:'passed', fail:'failed', unknown:'unknown' }[outcome]; outcomes[field]++;
    if (!binTotals.has(row.soft_bin)) binTotals.set(row.soft_bin,{number:row.soft_bin,count:0,passed:0,failed:0,unknown:0});
    const bin = binTotals.get(row.soft_bin); bin.count++; bin[field]++;
    cell.failed += deviceOutcome(row.part_flags) === 'fail' ? 1 : 0;
    cell.count = stacked ? cell.failed : cell.attempts;
    if (!cell.bins.has(row.soft_bin)) {
      if (++coordinateBins > 200000) invalid('This map exceeds 200,000 coordinate/bin combinations. Select fewer wafers or a smaller viewport.');
      cell.bins.add(row.soft_bin);
    }
    if (row.source > cell.lastSource || row.source === cell.lastSource && row.prr_seq > cell.lastPrr) {
      cell.lastSource = row.source; cell.lastPrr = row.prr_seq;
      cell.bin = row.soft_bin; cell.datasetId = row.dataset_id; cell.deviceId = row.id;
    }
  });
  return { stacked, wafer: selected ?? null, orientation: selected?.orientation ?? orientation(), attempts,
    summary: { attempts, coordinates:cells.size,...outcomes,yield:outcomes.passed+outcomes.failed?outcomes.passed/(outcomes.passed+outcomes.failed):null },
    binSummary:[...binTotals.values()].sort((a,b)=>a.number-b.number),
    dies: [...cells.values()].map(({ bins, lastSource, lastPrr, ...cell }) => ({ ...cell, bins: [...bins], ambiguous: bins.size > 1 })),
    warnings: [
      ...(stacked ? ['Stacked colors count failed attempts across the selected wafers; coordinates stay in recorded die space.'] : []),
      ...([...cells.values()].some((c) => c.attempts > 1) && !stacked ? ['Multiple selected attempts occupy some coordinates. Color uses the last selected attempt; drilldown retains every matching attempt.'] : []),
    ] };
}
