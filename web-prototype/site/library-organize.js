export const LIBRARY_SELECTION_LIMIT = 8;

export function testMetadata(dataset) {
  const raw = dataset.test_metadata ?? {};
  return { ...raw, startTime: Number.isFinite(raw.startTime) && raw.startTime > 0 ? raw.startTime : null,
    partNumber: raw.partNumber || '', lotId: raw.lotId || '', sublotId: raw.sublotId || '',
    program: raw.program || '', revision: raw.revision || '', tester: raw.tester || '' };
}
export function testDate(dataset, detailed = false) {
  const value = testMetadata(dataset).startTime;
  if (value === null) return null;
  const iso = new Date(value * 1000).toISOString();
  return detailed ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : iso.slice(0, 10);
}
export function libraryGroup(dataset, groupBy) {
  const metadata = testMetadata(dataset);
  const value = groupBy === 'date' ? testDate(dataset) : groupBy === 'part' ? metadata.partNumber : groupBy === 'lot' ? metadata.lotId : '';
  const missing = !value;
  return { key: JSON.stringify([groupBy, value || null]), value: value || '', missing,
    label: value || ({ date: 'No test date', part: 'No part number', lot: 'No lot ID' }[groupBy] ?? '') };
}
function missingLast(a, b, compare) {
  if (a === null || a === '') return b === null || b === '' ? 0 : 1;
  if (b === null || b === '') return -1;
  return compare(a, b);
}
export function organizeDatasets(datasets, { query = '', sort = 'test-newest', groupBy = 'date' } = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rows = datasets.filter(dataset => {
    const metadata = testMetadata(dataset);
    const haystack = [dataset.name, dataset.relative_path, testDate(dataset), metadata.partNumber, metadata.lotId,
      metadata.sublotId, metadata.program, metadata.revision, metadata.tester].join('\n').toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  });
  return rows.sort((a, b) => {
    const left = testMetadata(a), right = testMetadata(b);
    if (groupBy !== 'none') {
      const ag = libraryGroup(a, groupBy), bg = libraryGroup(b, groupBy);
      const groupOrder = missingLast(ag.value, bg.value, (x, y) => groupBy === 'date' && sort !== 'test-oldest' ? y.localeCompare(x) : x.localeCompare(y));
      if (groupOrder) return groupOrder;
    }
    let order;
    if (sort === 'name') order = a.name.localeCompare(b.name);
    else if (sort === 'size') order = b.source_bytes - a.source_bytes;
    else if (sort === 'part' || sort === 'lot') order = missingLast(left[sort === 'part' ? 'partNumber' : 'lotId'], right[sort === 'part' ? 'partNumber' : 'lotId'], (x, y) => x.localeCompare(y));
    else if (sort === 'newest') order = b.created_at.localeCompare(a.created_at);
    else order = missingLast(left.startTime, right.startTime, (x, y) => sort === 'test-oldest' ? x - y : y - x);
    return order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
export function groupDatasets(rows, groupBy) {
  const groups = new Map();
  for (const dataset of rows) {
    const group = libraryGroup(dataset, groupBy);
    if (!groups.has(group.key)) groups.set(group.key, { ...group, items: [] });
    groups.get(group.key).items.push(dataset);
  }
  return groups;
}
export function selectLibraryFiles(selectedIds, ids, datasets) {
  const readyIds = new Set(datasets.filter(item => item.status === 'ready').map(item => item.id));
  const next = new Set([...selectedIds].filter(id => readyIds.has(id)));
  for (const id of ids) {
    if (!readyIds.has(id)) throw new Error('Only ready files can open in the Viewer.');
    next.add(id);
  }
  if (next.size > LIBRARY_SELECTION_LIMIT) throw new Error(`Select up to ${LIBRARY_SELECTION_LIMIT} files.`);
  return next;
}
