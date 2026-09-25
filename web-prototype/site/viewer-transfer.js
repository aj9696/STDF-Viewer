// Workspace packages contain verified library packages and declarative UI state.
import { BlobReader, ZipReader, ZipWriter, TextReader } from './vendor/compression.js';
import { runOperation } from './library-operations.js';
import { inspectPackage } from './transfer.js';
import { libraryError } from './dataset-schema.js';
import { validateSelection, parseTestKey, datasetId } from './viewer-model.js';

const DIRECTORY = 'semidata-viewer-exports-v1';
const MANIFEST_LIMIT = 128 * 1024, PACKAGE_LIMIT = 8 * 1024 ** 3, WORKSPACE_LIMIT = 64 * 1024 ** 3;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(sdworkspace|sdlibrary)$/;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const fail = (message) => { throw libraryError('INVALID_WORKSPACE', message); };
const directory = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY, { create: true });
const sourceIds = (state) => [...new Set(state.selection.groups.flatMap((group) => group.datasetIds))];
const hooksFor = (context) => ({ checkCancelled: () => context?.checkCancelled?.(), progress: (value) => context?.progress?.(value) });
async function remove(dir, token) { try { await dir.removeEntry(token); } catch (error) { if (error.name !== 'NotFoundError') throw error; } }

function validateJson(value, depth = 0) {
  if (depth > 12) fail('Workspace state is nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) validateJson(item, depth + 1); return; }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Workspace state contains a reserved property.');
      validateJson(item, depth + 1);
    }
    return;
  }
  fail('Workspace state must contain JSON values only.');
}
/** Preserve bounded settings without executing or interpreting their values. */
export function validateWorkspaceState(input) {
  validateJson(input);
  if (!input || Array.isArray(input) || typeof input !== 'object') fail('Workspace state is missing.');
  if (encoder.encode(JSON.stringify(input)).length > MANIFEST_LIMIT - 8192) fail('Workspace state exceeds its size limit.');
  const state = JSON.parse(JSON.stringify(input));
  state.selection = validateSelection(state.selection);
  const ids = new Set(sourceIds(state));
  for (const field of ['tests', 'selectedTests']) {
    if (!Array.isArray(state[field] ?? []) || (state[field]?.length ?? 0) > 12) fail('A workspace supports no more than twelve selected tests.');
    for (const key of state[field] ?? []) {
      const parsed = parseTestKey(key);
      if (parsed.identity !== 'resolved' && !ids.has(parsed.identity.slice(0, 36))) fail('A selected unresolved test refers to a source outside this workspace.');
    }
  }
  return state;
}
function manifestFor(state, sources) {
  const manifest = { format: 'semidata-workspace', version: 1, state, sources };
  const text = JSON.stringify(manifest);
  if (encoder.encode(text).length > MANIFEST_LIMIT) fail('Workspace manifest exceeds 128 KiB.');
  return text;
}
function validateManifest(value) {
  if (!value || value.format !== 'semidata-workspace' || value.version !== 1) fail('This is not a supported SemiData workspace (version 1).');
  const state = validateWorkspaceState(value.state), ids = sourceIds(state);
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 8 || value.sources.length !== ids.length) fail('Workspace source inventory does not match its selection.');
  const members = new Set(), seen = new Set();
  for (const source of value.sources) {
    datasetId(source?.oldDatasetId);
    if (!ids.includes(source.oldDatasetId) || seen.has(source.oldDatasetId) || typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.sha256) || !/^sources\/[0-7]\.sdlibrary$/.test(source.member) || members.has(source.member)) fail('Invalid or repeated workspace source.');
    seen.add(source.oldDatasetId); members.add(source.member);
  }
  return { state, sources: value.sources };
}
function remapState(state, map) {
  const result = { ...state, selection: { ...state.selection, groups: state.selection.groups.map((group) => ({ ...group, datasetIds: group.datasetIds.map((id) => map[id]) })) } };
  for (const field of ['tests', 'selectedTests']) if (state[field]) result[field] = state[field].map((key) => {
      const fields = JSON.parse(key);
      if (fields[5] !== 'resolved') fields[5] = map[fields[5].slice(0, 36)] + fields[5].slice(36);
      return JSON.stringify(fields);
    });
  return result;
}
async function save(store, state, context) {
  state = validateWorkspaceState(state);
  const dir = await directory(), token = `${crypto.randomUUID()}.sdworkspace`;
  const exports = [], sources = [];
  let writable, bytes = 0, completed = false;
  try {
    writable = await (await dir.getFileHandle(token, { create: true })).createWritable();
    const sink = new WritableStream({ async write(chunk) {
      context.checkCancelled(); bytes += chunk.byteLength;
      if (bytes > WORKSPACE_LIMIT) fail('Workspace exceeds the 64 GiB package limit.');
      await writable.write(chunk);
    } });
    const zip = new ZipWriter(sink, { level: 0, zip64: true, useWebWorkers: false, bufferedWrite: false, preventClose: true });
    for (const [index, id] of sourceIds(state).entries()) {
      context.checkCancelled();
      const exported = await runOperation(store, { type: 'exportDataset', datasetId: id }, context);
      exports.push(exported.exportToken);
      if (exported.file.size > PACKAGE_LIMIT) fail('A saved source package exceeds 8 GiB.');
      const { header } = await inspectPackage(exported.file), member = `sources/${index}.sdlibrary`;
      await zip.add(member, new BlobReader(exported.file), { level: 0 });
      sources.push({ oldDatasetId: id, sha256: header.manifest.source.sha256, member });
      context.progress({ phase: 'save-workspace', completedSources: index + 1, totalSources: sourceIds(state).length, completedBytes: bytes });
      // Once ZIP owns a complete streamed copy, release this intermediate package.
      await runOperation(store, { type: 'releaseExport', exportToken: exported.exportToken }, context);
      exports.pop();
    }
    await zip.add('manifest.json', new TextReader(manifestFor(state, sources)), { level: 0 });
    await zip.close(); context.checkCancelled(); await writable.close(); writable = null;
    const file = await (await dir.getFileHandle(token)).getFile(); completed = true;
    return { file, filename: 'workspace.sdworkspace', token, bytes: file.size, sourceCount: sources.length };
  } finally {
    try { await writable?.abort(); } catch { /* Remove the failed artifact below. */ }
    for (const exportToken of exports) await runOperation(store, { type: 'releaseExport', exportToken }, context).catch(() => {});
    if (!completed) await remove(dir, token);
  }
}
class BoundedReader extends BlobReader {
  async readUint8Array(offset, length) {
    if (length > 1024 * 1024) fail('Workspace ZIP metadata exceeds its read budget.');
    return super.readUint8Array(offset, length);
  }
}
function validateEntry(entry) {
  const mode = entry.unixMode ?? ((entry.externalFileAttributes >>> 16) & 0xffff);
  if (entry.directory || entry.encrypted || entry.compressionMethod !== 0 || mode && (mode & 0xf000) && (mode & 0xf000) !== 0x8000 || entry.filename.length > 128 || !Number.isSafeInteger(entry.uncompressedSize) || entry.compressedSize !== entry.uncompressedSize) fail('Workspace entries must be unencrypted regular ZIP STORE files.');
}
async function extract(entry, writable, maximum, context) {
  let count = 0;
  await entry.getData(new WritableStream({ async write(bytes) {
    context.checkCancelled(); count += bytes.byteLength;
    if (count > maximum || count > entry.uncompressedSize) fail('Workspace entry exceeds its declared size.');
    await writable.write(bytes);
  } }), { checkCrc32: true, checkOverlappingEntry: true, useWebWorkers: false });
  if (count !== entry.uncompressedSize) fail('Workspace entry was truncated.');
  context.checkCancelled();
}
async function restore(store, file, context) {
  if (!(file instanceof File) || file.size > WORKSPACE_LIMIT || file.size < 22) fail('Choose a .sdworkspace package no larger than 64 GiB. Native desktop .db sessions are not compatible.');
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (signature[0] !== 80 || signature[1] !== 75 || signature[2] !== 3 || signature[3] !== 4) fail('Choose a .sdworkspace package. Native desktop .db sessions are not compatible.');
  const reader = new ZipReader(new BoundedReader(file), { strictness: 'strict', filenameValidation: 'tolerant', useWebWorkers: false });
  const dir = await directory(), completedDatasetIds = [], map = Object.create(null);
  let currentToken, currentWritable, restored = 0, reused = 0;
  try {
    const entries = new Map(); let total = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      context.checkCancelled(); validateEntry(entry);
      if (entries.size >= 9 || entries.has(entry.filename) || !/^(manifest\.json|sources\/[0-7]\.sdlibrary)$/.test(entry.filename)) fail('Workspace contains unexpected or repeated ZIP members.');
      if (entry.uncompressedSize > (entry.filename === 'manifest.json' ? MANIFEST_LIMIT : PACKAGE_LIMIT) || (total += entry.uncompressedSize) > WORKSPACE_LIMIT) fail('Workspace entries exceed the size budget.');
      entries.set(entry.filename, entry);
    }
    const manifestEntry = entries.get('manifest.json');
    if (!manifestEntry) fail('Workspace manifest is missing.');
    const chunks = [];
    await extract(manifestEntry, { write(bytes) { chunks.push(bytes.slice()); } }, MANIFEST_LIMIT, context);
    let manifest;
    try { manifest = JSON.parse(decoder.decode(await new Blob(chunks).arrayBuffer())); } catch { fail('Workspace manifest is not valid UTF-8 JSON.'); }
    const validated = validateManifest(manifest);
    if (entries.size !== validated.sources.length + 1 || validated.sources.some((source) => !entries.has(source.member))) fail('Workspace source inventory does not match its ZIP members.');
    for (const [index, source] of validated.sources.entries()) {
      context.checkCancelled();
      currentToken = `${crypto.randomUUID()}.sdlibrary`;
      const handle = await dir.getFileHandle(currentToken, { create: true });
      currentWritable = await handle.createWritable();
      await extract(entries.get(source.member), currentWritable, PACKAGE_LIMIT, context);
      await currentWritable.close(); currentWritable = null;
      const packageFile = await handle.getFile(), { header } = await inspectPackage(packageFile);
      if (header.manifest.source.sha256 !== source.sha256) fail('Workspace source checksum differs from its package manifest.');
      // Existing restore verifies both checksums and the retained schema/database
      // even when the library already contains a matching source hash.
      const result = await runOperation(store, { type: 'restorePackage', file: packageFile }, context);
      map[source.oldDatasetId] = result.dataset.id; completedDatasetIds.push(result.dataset.id);
      if (result.duplicate) reused++; else restored++;
      await remove(dir, currentToken); currentToken = null;
      context.progress({ phase: 'restore-workspace', completedSources: index + 1, totalSources: validated.sources.length });
    }
    context.checkCancelled();
    return { state: validateWorkspaceState(remapState(validated.state, map)), datasetMap: { ...map }, restored, reused };
  } catch (error) {
    const wrapped = libraryError(typeof error.code === 'string' ? error.code : 'INVALID_WORKSPACE', `${error.message} Workspace state was not applied.${completedDatasetIds.length ? ` ${completedDatasetIds.length} completed source(s) remain in the library.` : ''}`);
    wrapped.completedDatasetIds = [...completedDatasetIds]; throw wrapped;
  } finally {
    try { await currentWritable?.abort(); } catch { /* Remove the staging entry below. */ }
    if (currentToken) await remove(dir, currentToken);
    await reader.close();
  }
}

/** Call only while this worker holds the exclusive library lock. */
export async function cleanupViewerTransfers() {
  const dir = await directory(); let removed = 0;
  for await (const [name, handle] of dir.entries()) if (handle.kind === 'file' && TOKEN.test(name)) { await remove(dir, name); removed++; }
  return { removed };
}
export async function runViewerTransfer(store, message, context) {
  const hooks = hooksFor(context); hooks.checkCancelled();
  switch (message.action) {
    case 'saveSession': return save(store, message.state, hooks);
    case 'restoreSession': return restore(store, message.file, hooks);
    case 'release': {
      if (typeof message.token !== 'string' || !TOKEN.test(message.token) || !message.token.endsWith('.sdworkspace')) throw libraryError('INVALID_REQUEST', 'Invalid workspace export token.');
      await remove(await directory(), message.token); return { released: true };
    }
    default: throw libraryError('INVALID_REQUEST', 'Unknown workspace transfer action.');
  }
}
