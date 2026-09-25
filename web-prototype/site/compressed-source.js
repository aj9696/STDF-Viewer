import { MAX_SOURCE_BYTES, libraryError } from "./dataset-schema.js";

const CHUNK_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_ZSTD_WINDOW_BYTES = 32 * 1024 * 1024;
const TEMP_DIRECTORY = "semidata-decompression-v1";
let codecsPromise;
// MessageChannel yields to worker messages without nested setTimeout's 4 ms
// clamp, which would add roughly a minute per GiB at 64 KiB output boundaries.
const yieldTask = (() => {
  const channel = new MessageChannel(), waiting = [];
  channel.port1.onmessage = () => waiting.shift()?.();
  return () => new Promise((resolve) => { waiting.push(resolve); channel.port2.postMessage(null); });
})();
const bad = (message) => libraryError("INVALID_COMPRESSED_SOURCE", message);
const limit = () => libraryError("SOURCE_TOO_LARGE", "Compressed input and expanded STDF must each be at most 2 GiB.");
async function codecs() {
  return codecsPromise ??= import("./vendor/compression.js").then((value) => {
    value.configure({ useWebWorkers: false, useCompressionStream: true, chunkSize: CHUNK_BYTES });
    return value;
  });
}
function rawName(name) {
  const base = name.replace(/\.(gz|bz2|zip)$/i, "");
  return /\.(stdf|std|stf)$/i.test(base) ? base : `${base}.stdf`;
}
function checkFile(file) {
  if (!(file instanceof File) || !file.size || file.name.length > 1024 || /[\\/\0]/.test(file.name)) {
    throw libraryError("INVALID_SOURCE", "Choose a nonempty STDF file with a valid filename.");
  }
  if (file.size > MAX_SOURCE_BYTES) throw limit();
}
async function readBytes(file, start, length) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > file.size) {
    throw bad("Compressed data ended before its declared structure was complete.");
  }
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}
function le32(bytes, offset = 0) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

// OPFS handles are only used inside a dedicated worker. Each invocation owns a
// random child directory; no source snapshot or other invocation is overwritten.
async function outputFile(directory, name, context, onBytes) {
  const handle = await directory.getFileHandle(name, { create: true });
  let access = await handle.createSyncAccessHandle(), size = 0;
  return {
    get size() { return size; },
    write(bytes) {
      if (!(bytes instanceof Uint8Array)) throw bad("Decoder returned invalid bytes.");
      if (size + bytes.length > MAX_SOURCE_BYTES) throw limit();
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        context.checkCancelled();
        const part = bytes.subarray(offset, offset + CHUNK_BYTES);
        if (access.write(part, { at: size }) !== part.length) throw libraryError("STORAGE_ERROR", "Expanded STDF write was incomplete.");
        onBytes?.(part); size += part.length;
      }
    },
    async finish() {
      access.flush(); access.close(); access = null;
      const result = await handle.getFile();
      if (result.size !== size) throw libraryError("STORAGE_ERROR", "Expanded STDF size changed while preparing it.");
      return result;
    },
    close() { access?.close(); access = null; },
  };
}

async function gzip(file, output, context) {
  const { ZStream, zlibInflateInit2, zlibInflate, zlibInflateEnd, zlibInflateReset } = await codecs();
  const stream = new ZStream(), buffer = new Uint8Array(CHUNK_BYTES);
  // windowBits=31 accepts gzip only and verifies each member's CRC and ISIZE.
  // Low-level bounded output lets cancellation run even for highly compressed
  // input. Native DecompressionStream rejects concatenated gzip members.
  if (zlibInflateInit2(stream, 31) !== 0) throw bad("GZIP decoder could not initialize.");
  let offset = 0, finished = false;
  try {
    while (true) {
      context.checkCancelled();
      if (!stream.avail_in && offset < file.size) {
        stream.input = await readBytes(file, offset, Math.min(CHUNK_BYTES, file.size - offset));
        stream.next_in = 0; stream.avail_in = stream.input.length; offset += stream.input.length;
      }
      if (finished) {
        if (!stream.avail_in && offset === file.size) break;
        if (zlibInflateReset(stream) !== 0) throw bad("GZIP member reset failed.");
        finished = false;
      }
      const before = stream.avail_in;
      stream.output = buffer; stream.next_out = 0; stream.avail_out = buffer.length;
      const status = zlibInflate(stream, 0);
      if (status !== 0 && status !== 1 && status !== -5) throw bad(`GZIP data is invalid: ${stream.msg || status}.`);
      output.write(buffer.subarray(0, stream.next_out));
      finished = status === 1;
      if (!finished && !stream.next_out && before === stream.avail_in) throw bad("GZIP stream is truncated or cannot make progress.");
      context.progress({ phase: "decompressing", completedBytes: offset - stream.avail_in, totalBytes: file.size, expandedBytes: output.size });
      await yieldTask();
    }
  } finally { zlibInflateEnd(stream); }
}

async function bzip(file, output, context) {
  const { Bunzip } = await codecs();
  const reader = new FileReaderSync();
  const input = new Bunzip.Stream();
  let position = 0, cached = new Uint8Array(), cacheStart = 0;
  input.readByte = () => {
    if (position >= file.size) throw bad("BZIP2 data is truncated.");
    if (position < cacheStart || position >= cacheStart + cached.length) {
      context.checkCancelled(); cacheStart = position;
      cached = new Uint8Array(reader.readAsArrayBuffer(file.slice(position, position + CHUNK_BYTES)));
      if (!cached.length) throw bad("BZIP2 data ended unexpectedly.");
    }
    return cached[position++ - cacheStart];
  };
  const pending = new Uint8Array(CHUNK_BYTES);
  let used = 0;
  const flush = () => { if (used) output.write(pending.subarray(0, used)); used = 0; };
  do {
    const bz = new Bunzip(input, {});
    while (bz._init_block()) {
      // Asynchronous adaptation of seek-bzip 2.0.0 _read_bunzip (MIT). The
      // upstream decoder verifies each block and the combined stream CRC, but
      // drains an entire block synchronously. Yield each 64 KiB, including RLE
      // blocks whose expanded output can be much larger than their 900 KiB BWT.
      let positionInBlock = bz.writePos, current = bz.writeCurrent, run = bz.writeRun;
      for (let count = bz.writeCount; count > 0; --count) {
        const previous = current, encoded = bz.dbuf[positionInBlock];
        current = encoded & 255; positionInBlock = encoded >>> 8;
        let copies = 1, byte = current;
        if (run++ === 3) { copies = current; byte = previous; current = -1; }
        bz.blockCRC.updateCRCRun(byte, copies);
        while (copies--) {
          pending[used++] = byte;
          if (used === pending.length) {
            flush();
            context.progress({ phase: "decompressing", completedBytes: position, totalBytes: file.size, expandedBytes: output.size });
            await yieldTask(); context.checkCancelled();
          }
        }
        if (current !== previous) run = 0;
      }
      flush();
      if (bz.blockCRC.getCRC() !== bz.targetBlockCRC) throw bad("BZIP2 block checksum does not match.");
      context.progress({ phase: "decompressing", completedBytes: position, totalBytes: file.size, expandedBytes: output.size });
      await yieldTask(); context.checkCancelled();
    }
    if ((bz.reader.read(32) >>> 0) !== bz.streamCRC) throw bad("BZIP2 stream checksum does not match.");
    if (bz.reader.hasByte && (bz.reader.curByte & ((1 << (8 - bz.reader.bitOffset)) - 1))) throw bad("BZIP2 padding is invalid.");
    // A subsequent BZh header is a concatenated stream; any other trailing data
    // is rejected by the next constructor. EOF before the trailer always fails.
  } while (position < file.size);
}

async function zstd(file, output, context) {
  const { ZstdDecoder, createXXHash64 } = await codecs();
  let start = 0;
  while (start < file.size) {
    context.checkCancelled();
    const prefix = await readBytes(file, start, Math.min(18, file.size - start));
    if (prefix.length < 4) throw bad("Zstandard frame is truncated.");
    const magic = le32(prefix);
    if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
      if (prefix.length < 8) throw bad("Zstandard skippable frame is truncated.");
      start += 8 + le32(prefix, 4);
      if (start > file.size) throw bad("Zstandard skippable frame exceeds its input.");
      continue;
    }
    if (magic !== 0xfd2fb528 || prefix.length < 6) throw bad("Invalid Zstandard frame header.");
    const flags = prefix[4], single = !!(flags & 32), checksum = !!(flags & 4);
    if (flags & 8) throw bad("Reserved Zstandard frame bit is set.");
    const dictionaryBytes = [0, 1, 2, 4][flags & 3];
    let position = 5 + (single ? 0 : 1);
    if (prefix.subarray(position, position + dictionaryBytes).some((byte) => byte)) {
      throw libraryError("UNSUPPORTED_COMPRESSION", "Zstandard dictionaries are not supported.");
    }
    position += dictionaryBytes;
    const sizeBytes = [single ? 1 : 0, 2, 4, 8][flags >>> 6];
    if (prefix.length < position + sizeBytes) throw bad("Zstandard frame size is truncated.");
    let declaredSize = 0;
    for (let index = sizeBytes - 1; index >= 0; --index) declaredSize = declaredSize * 256 + prefix[position + index];
    if (sizeBytes === 2) declaredSize += 256;
    if (declaredSize > MAX_SOURCE_BYTES) throw limit();
    const window = single ? declaredSize : 2 ** (10 + (prefix[5] >>> 3)) * (1 + (prefix[5] & 7) / 8);
    if (window > MAX_ZSTD_WINDOW_BYTES) {
      throw libraryError("UNSUPPORTED_COMPRESSION", "This Zstandard file needs more than the supported 32 MiB decoding window.");
    }
    let end = start + position + sizeBytes, last = false, blocks = 0;
    // Scan only block headers first. fzstd allocates from the frame header, so
    // establish the memory bound and exact frame/trailer boundary before decode.
    while (!last) {
      const header = await readBytes(file, end, 3);
      const value = header[0] | header[1] << 8 | header[2] << 16;
      last = !!(value & 1); const type = (value >>> 1) & 3, size = value >>> 3;
      if (type === 3 || size > 128 * 1024) throw bad("Invalid Zstandard block header.");
      end += 3 + (type === 1 ? 1 : size);
      if (end > file.size) throw bad("Zstandard block is truncated.");
      if (++blocks % 128 === 0) { await yieldTask(); context.checkCancelled(); }
    }
    const expectedChecksum = checksum ? le32(await readBytes(file, end, 4)) : null;
    if (checksum) end += 4;
    const hash = checksum ? await createXXHash64() : null;
    const before = output.size;
    const decoder = new ZstdDecoder((chunk) => { output.write(chunk); hash?.update(chunk); });
    for (let offset = start; offset < end; offset += CHUNK_BYTES) {
      context.checkCancelled();
      decoder.push(await readBytes(file, offset, Math.min(CHUNK_BYTES, end - offset)), offset + CHUNK_BYTES >= end);
      context.progress({ phase: "decompressing", completedBytes: Math.min(offset + CHUNK_BYTES, end), totalBytes: file.size, expandedBytes: output.size });
      await yieldTask();
    }
    if (sizeBytes && output.size - before !== declaredSize) throw bad("Zstandard frame size does not match.");
    if (hash && (Number.parseInt(hash.digest().slice(-8), 16) >>> 0) !== expectedChecksum) throw bad("Zstandard frame checksum does not match.");
    start = end;
  }
}

async function unzip(file, directory, output, context, crc) {
  const { BlobReader, ZipReader } = await codecs();
  class BoundedBlobReader extends BlobReader {
    async readUint8Array(offset, length, ...rest) {
      if (length > MAX_METADATA_BYTES) throw bad("ZIP metadata exceeds the supported 1 MiB bound.");
      context.checkCancelled();
      return super.readUint8Array(offset, length, ...rest);
    }
  }
  const reader = new ZipReader(new BoundedBlobReader(file), { strictness: "strict", filenameValidation: "tolerant", useWebWorkers: false });
  let packed;
  try {
    const entries = await reader.getEntries();
    if (entries.length !== 1) throw bad("ZIP must contain exactly one regular file.");
    const entry = entries[0], mode = (entry.externalFileAttributes >>> 16) & 0o170000;
    if (entry.directory || entry.symlink || (mode && mode !== 0o100000) || (entry.externalFileAttributes & 0x18)) {
      throw bad("ZIP must contain one regular file, without directories or links.");
    }
    if (entry.encrypted) throw bad("Encrypted ZIP files are not supported.");
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > MAX_SOURCE_BYTES || entry.compressedSize > MAX_SOURCE_BYTES) throw limit();
    if (![0, 8, 12, 93].includes(entry.compressionMethod)) {
      throw libraryError("UNSUPPORTED_COMPRESSION", `ZIP compression method ${entry.compressionMethod} is not supported. Use STORE, DEFLATE, BZIP2, or Zstandard.`);
    }
    const custom = entry.compressionMethod === 12 || entry.compressionMethod === 93;
    const destination = custom ? packed = await outputFile(directory, "compressed-entry", context) : output;
    let consumed = 0, total = entry.compressedSize;
    await entry.getData(new WritableStream({ async write(bytes) {
      destination.write(bytes);
      context.progress({ phase: "decompressing", completedBytes: consumed, totalBytes: total, expandedBytes: output.size });
      await yieldTask(); context.checkCancelled();
    } }), {
      checkCrc32: !custom, passThrough: custom, strictness: "strict", useWebWorkers: false,
      onprogress(completedBytes, totalBytes) { consumed = completedBytes; total = totalBytes; },
    });
    if (custom) {
      const payload = await packed.finish();
      if (payload.size !== entry.compressedSize) throw bad("ZIP compressed size does not match.");
      await (entry.compressionMethod === 12 ? bzip(payload, output, context) : zstd(payload, output, context));
    }
    if (output.size !== entry.uncompressedSize || (crc.get() >>> 0) !== entry.crc32) throw bad("ZIP expanded size or CRC-32 checksum does not match.");
  } finally { packed?.close(); await reader.close(); }
}

/** Prepare raw STDF for import inside the library worker; caller must finally cleanup(). */
export async function prepareSource(file, context) {
  checkFile(file); context.checkCancelled();
  const first = await readBytes(file, 0, Math.min(6, file.size));
  const isGzip = first[0] === 0x1f && first[1] === 0x8b;
  const isBzip = first[0] === 0x42 && first[1] === 0x5a && first[2] === 0x68;
  const isZip = first[0] === 0x50 && first[1] === 0x4b;
  if (!isGzip && !isBzip && !isZip) {
    if (/\.(gz|bz2|zip)$/i.test(file.name) && !(first[2] === 0 && first[3] === 10 && first[5] === 4)) {
      throw bad("The selected compressed file has no recognized compression or STDF header.");
    }
    return { file: file.name === rawName(file.name) ? file : new File([file], rawName(file.name), { lastModified: file.lastModified }), cleanup: async () => {} };
  }
  if (typeof FileReaderSync === "undefined" || !navigator.storage?.getDirectory) {
    throw libraryError("UNSUPPORTED", "Compressed imports require a browser worker with local file storage.");
  }
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(TEMP_DIRECTORY, { create: true });
  const name = crypto.randomUUID(), directory = await root.getDirectoryHandle(name, { create: true });
  let output, cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    output?.close();
    await root.removeEntry(name, { recursive: true });
    cleaned = true;
  };
  try {
    const { Crc32 } = await codecs();
    const crc = new Crc32();
    output = await outputFile(directory, "expanded.stdf", context, (bytes) => crc.append(bytes));
    context.progress({ phase: "decompressing", completedBytes: 0, totalBytes: file.size, expandedBytes: 0 });
    if (isGzip) await gzip(file, output, context);
    else if (isBzip) await bzip(file, output, context);
    else await unzip(file, directory, output, context, crc);
    context.checkCancelled();
    if (!output.size) throw bad("Compressed input contains no STDF bytes.");
    const expanded = await output.finish();
    return { file: new File([expanded], rawName(file.name), { lastModified: file.lastModified }), cleanup };
  } catch (error) {
    await cleanup();
    if (typeof error.code === "string") throw error;
    throw libraryError(error.name === "QuotaExceededError" ? "QUOTA_EXCEEDED" : "INVALID_COMPRESSED_SOURCE", `Could not expand this file: ${error.message ?? error}`);
  }
}

/** Call only while holding the exclusive library lock; children are disposable. */
export async function cleanupDecompressionStaging(root) {
  let directory;
  try { directory = await root.getDirectoryHandle(TEMP_DIRECTORY); }
  catch (error) { if (error.name === 'NotFoundError') return 0; throw error; }
  let removed = 0;
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === 'directory' && /^[0-9a-f-]{36}$/.test(name)) {
      await directory.removeEntry(name, { recursive: true }); removed++;
    }
    if (removed >= 10000) break;
  }
  return removed;
}
