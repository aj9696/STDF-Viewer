import { boundedInteger, invalid } from './viewer-model.js';

const LOCATIONS = {
  report: { directory: 'semidata-report-exports-v1', pattern: /^[0-9a-f-]{36}\.(xlsx|csv)$/ },
  workspace: { directory: 'semidata-viewer-exports-v1', pattern: /^[0-9a-f-]{36}\.(sdworkspace|sdlibrary)$/ },
};

/** Explicit inventory/cleanup only; a browser download may still hold a File. */
export async function runViewerDownloads(message, context) {
  const root = await navigator.storage.getDirectory();
  if (message.action === 'list') {
    const offset = boundedInteger(message.offset ?? 0, 0, 10000, 'Offset');
    const names = [];
    for (const [kind, location] of Object.entries(LOCATIONS)) {
      let directory;
      try { directory = await root.getDirectoryHandle(location.directory); }
      catch (error) { if (error.name === 'NotFoundError') continue; throw error; }
      for await (const [token, handle] of directory.entries()) {
        context.checkCancelled();
        if (handle.kind === 'file' && location.pattern.test(token)) names.push({ kind, token, handle });
        if (names.length > 10000) invalid('Generated-file inventory exceeds 10,000 entries.');
      }
    }
    names.sort((a, b) => a.token.localeCompare(b.token));
    const items = [];
    for (const entry of names.slice(offset, offset + 50)) {
      const file = await entry.handle.getFile();
      items.push({ kind: entry.kind, token: entry.token, bytes: file.size, lastModified: file.lastModified });
    }
    return { items, offset, total: names.length, nextOffset: offset + items.length < names.length ? offset + items.length : null };
  }
  const location = LOCATIONS[message.kind];
  if (!location || typeof message.token !== 'string' || !location.pattern.test(message.token)) invalid('Invalid generated-file identity.');
  let directory;
  try { directory = await root.getDirectoryHandle(location.directory); }
  catch (error) { if (message.action === 'release' && error.name === 'NotFoundError') return { released: true }; throw error; }
  if (message.action === 'release') {
    try { await directory.removeEntry(message.token); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    return { released: true };
  }
  if (message.action === 'get') return { file: await (await directory.getFileHandle(message.token)).getFile(), filename: message.token };
  invalid('Unknown generated-file operation.');
}
