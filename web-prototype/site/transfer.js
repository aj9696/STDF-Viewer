// Portable package framing. Names in a manifest are metadata, never paths.
const MAGIC = "SDPKG001";
const HEADER_LIMIT = 64 * 1024;
const PACKAGE_LIMIT = 8 * 1024 ** 3;
const DEFAULT_CHUNK = 64 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isDigest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function validateHeader(header) {
  if (!isObject(header) || header.formatVersion !== 1) {
    fail("INCOMPATIBLE", "Unsupported library package format version.");
  }
  const { manifest, sourceBytes, databaseBytes } = header;
  if (!isObject(manifest) || manifest.schemaVersion !== 1 || manifest.parserVersion !== "retained-v1") {
    fail("INCOMPATIBLE", "Unsupported dataset schema or parser version.");
  }
  const source = manifest.source;
  if (!isCount(sourceBytes) || sourceBytes < 1 || !isCount(databaseBytes) ||
      databaseBytes < 512 || databaseBytes % 512 !== 0 ||
      sourceBytes + databaseBytes > PACKAGE_LIMIT || !isObject(source) ||
      source.size !== sourceBytes || !isDigest(source.sha256) ||
      typeof source.name !== "string" || source.name.length < 1 || source.name.length > 1024 ||
      typeof source.relativePath !== "string" || source.relativePath.length < 1 || source.relativePath.length > 4096 ||
      !["little", "big"].includes(manifest.byteOrder) || !isObject(manifest.coverage) ||
      !isObject(manifest.counts) ||
      !["records", "measurements", "devices", "definitions"].every((key) => isCount(manifest.counts[key]))) {
    fail("INVALID_PACKAGE", "Invalid library package sizes or manifest.");
  }
  return header;
}

function validateFile(file) {
  if (!file || !isCount(file.size) || file.size > PACKAGE_LIMIT || typeof file.slice !== "function") {
    fail("INVALID_PACKAGE", "Select a library package no larger than 8 GiB.");
  }
}

async function readBytes(file, start, end) {
  const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
  if (bytes.byteLength !== end - start) fail("INVALID_PACKAGE", "Package was truncated or changed while reading.");
  return bytes;
}

/** Inspect framing and versions only. Hash verification is a separate pass. */
export async function inspectPackage(file) {
  validateFile(file);
  if (file.size < 12 + 2 + 1 + 512 + 64) fail("INVALID_PACKAGE", "Library package is truncated.");
  const prefix = await readBytes(file, 0, 12);
  if (!prefix.subarray(0, 8).every((byte, index) => byte === MAGIC.charCodeAt(index))) {
    fail("INVALID_PACKAGE", "This file is not a supported library package.");
  }
  const headerBytes = new DataView(prefix.buffer, prefix.byteOffset, 12).getUint32(8, true);
  if (headerBytes < 2 || headerBytes > HEADER_LIMIT || 12 + headerBytes + 64 > file.size) {
    fail("INVALID_PACKAGE", "Invalid library package header length.");
  }
  let header;
  try { header = JSON.parse(decoder.decode(await readBytes(file, 12, 12 + headerBytes))); }
  catch { fail("INVALID_PACKAGE", "Library package header is not valid UTF-8 JSON."); }
  validateHeader(header);
  const sourceOffset = 12 + headerBytes;
  const databaseOffset = sourceOffset + header.sourceBytes;
  const footerOffset = databaseOffset + header.databaseBytes;
  if (footerOffset + 64 !== file.size) fail("INVALID_PACKAGE", "Library package size does not match its header.");
  return { header, sourceOffset, databaseOffset, footerOffset, packageBytes: file.size };
}

function options({ chunkBytes = DEFAULT_CHUNK, checkCancelled = () => {}, onProgress = () => {} }) {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 512 || chunkBytes > 1024 * 1024 ||
      typeof checkCancelled !== "function" || typeof onProgress !== "function") {
    fail("INVALID_REQUEST", "Transfer chunks must be 512 bytes–1 MiB and callbacks must be functions.");
  }
  return { chunkBytes, checkCancelled, onProgress };
}

async function streamRange(file, start, end, settings, consume) {
  for (let offset = start; offset < end; offset += settings.chunkBytes) {
    settings.checkCancelled();
    const bytes = await readBytes(file, offset, Math.min(offset + settings.chunkBytes, end));
    await consume(bytes);
  }
  settings.checkCancelled();
}

function finishHash(hasher) {
  const digest = hasher.finish();
  if (!isDigest(digest)) fail("TRANSFER_ERROR", "Hasher did not return a SHA-256 hex digest.");
  return digest;
}

function releaseHash(hasher) {
  try { hasher?.free(); } catch { /* Retain the original transfer error. */ }
}

function validateSqlitePrefix(bytes) {
  const expected = "SQLite format 3\0";
  if (bytes.length < 16 || !bytes.subarray(0, 16).every((byte, index) => byte === expected.charCodeAt(index))) {
    fail("INVALID_PACKAGE", "Package database has no SQLite file header.");
  }
}

async function verify(optionsInput) {
  const { file, createHasher } = optionsInput;
  const settings = options(optionsInput);
  settings.checkCancelled();
  const inspected = await inspectPackage(file);
  let packageHasher, sourceHasher, completedBytes = 0;
  const consume = (bytes) => {
    packageHasher.update(bytes);
    completedBytes += bytes.byteLength;
    settings.onProgress({ phase: "verify", completedBytes, totalBytes: file.size });
  };
  try {
    packageHasher = createHasher();
    sourceHasher = createHasher();
    await streamRange(file, 0, inspected.sourceOffset, settings, consume);
    await streamRange(file, inspected.sourceOffset, inspected.databaseOffset, settings, (bytes) => {
      sourceHasher.update(bytes); consume(bytes);
    });
    if (finishHash(sourceHasher) !== inspected.header.manifest.source.sha256) {
      fail("INVALID_PACKAGE", "Package source digest does not match.");
    }
    let firstPage = true;
    await streamRange(file, inspected.databaseOffset, inspected.footerOffset, settings, (bytes) => {
      if (firstPage) { validateSqlitePrefix(bytes); firstPage = false; }
      consume(bytes);
    });
    const footer = await readBytes(file, inspected.footerOffset, file.size);
    // Decode only ASCII hex, avoiding decoder exceptions with untrusted footer bytes.
    if (!footer.every((byte) => (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)) ||
        finishHash(packageHasher) !== String.fromCharCode(...footer)) {
      fail("INVALID_PACKAGE", "Library package checksum does not match.");
    }
    settings.checkCancelled();
    settings.onProgress({ phase: "verify", completedBytes: file.size, totalBytes: file.size });
    return inspected;
  } finally { releaseHash(sourceHasher); releaseHash(packageHasher); }
}

/** Verify checksums and framing without creating or modifying output artifacts. */
export async function verifyPackage(input) {
  return (await verify(input)).header;
}

/** Export original source and stable SQLite pages to an awaited streaming sink. */
export async function exportPackage(input) {
  const { db, sourceFile, manifest, createHasher, writable } = input;
  const settings = options(input);
  let packageHasher, sourceHasher, statement, transaction = false;
  let bytesWritten = 0;
  try {
    settings.checkCancelled();
    validateFile(sourceFile);
    db.exec("BEGIN"); transaction = true;
    const pageSize = db.selectValue("PRAGMA page_size");
    const pageCount = db.selectValue("PRAGMA page_count");
    if (!Number.isInteger(pageSize) || pageSize < 512 || pageSize > 65536 ||
        (pageSize & (pageSize - 1)) !== 0 || !isCount(pageCount) || pageCount < 1) {
      fail("TRANSFER_ERROR", "SQLite returned an invalid page size or count.");
    }
    const databaseBytes = pageSize * pageCount;
    const headerText = JSON.stringify({ formatVersion: 1, manifest, sourceBytes: sourceFile.size, databaseBytes });
    const header = validateHeader(JSON.parse(headerText));
    const headerBytes = encoder.encode(headerText);
    const totalBytes = 12 + headerBytes.byteLength + sourceFile.size + databaseBytes + 64;
    if (headerBytes.byteLength > HEADER_LIMIT || totalBytes > PACKAGE_LIMIT) {
      fail("INVALID_PACKAGE", "Library package exceeds the header or 8 GiB package limit.");
    }
    packageHasher = createHasher(); sourceHasher = createHasher();
    const write = async (bytes, hash = true) => {
      for (let offset = 0; offset < bytes.byteLength; offset += settings.chunkBytes) {
        settings.checkCancelled();
        const chunk = bytes.subarray(offset, offset + settings.chunkBytes);
        if (hash) packageHasher.update(chunk);
        await writable.write(chunk);
        bytesWritten += chunk.byteLength;
        settings.onProgress({ phase: "export", completedBytes: bytesWritten, totalBytes });
      }
    };
    const prefix = new Uint8Array(12);
    prefix.set(encoder.encode(MAGIC));
    new DataView(prefix.buffer).setUint32(8, headerBytes.byteLength, true);
    await write(prefix); await write(headerBytes);
    await streamRange(sourceFile, 0, sourceFile.size, settings, async (bytes) => {
      sourceHasher.update(bytes); await write(bytes);
    });
    if (finishHash(sourceHasher) !== header.manifest.source.sha256) {
      fail("INVALID_PACKAGE", "Stored source digest does not match its manifest.");
    }
    statement = db.prepare("SELECT pgno, data FROM sqlite_dbpage('main') ORDER BY pgno");
    let pages = 0;
    while (statement.step()) {
      settings.checkCancelled();
      if (statement.get(0) !== ++pages || pages > pageCount) fail("TRANSFER_ERROR", "SQLite export pages are not sequential.");
      const page = statement.getBlob(1);
      if (!(page instanceof Uint8Array) || page.byteLength !== pageSize) fail("TRANSFER_ERROR", "SQLite export page has an invalid size.");
      if (pages === 1) validateSqlitePrefix(page);
      await write(page);
    }
    if (pages !== pageCount) fail("TRANSFER_ERROR", "SQLite export page count changed.");
    const sha256 = finishHash(packageHasher);
    await write(encoder.encode(sha256), false);
    settings.checkCancelled();
    await writable.close();
    return { bytes: bytesWritten, sha256 };
  } catch (error) {
    try { await writable?.abort(); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    try { statement?.finalize(); }
    finally {
      try { if (transaction) db.exec("ROLLBACK"); }
      finally { releaseHash(sourceHasher); releaseHash(packageHasher); }
    }
  }
}

/** Restore into new unpublished artifacts; the caller validates and publishes. */
export async function restorePackage(input) {
  const { file, pool, databaseName, sourceWritable } = input;
  try {
    const settings = options(input);
    if (typeof databaseName !== "string" || !/^\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(databaseName)) {
      fail("INVALID_REQUEST", "Restore requires a new absolute single-file database name.");
    }
    const refuseExisting = () => {
      if (pool.getFileNames().includes(databaseName)) fail("ALREADY_EXISTS", "Restore cannot overwrite an existing database.");
    };
    refuseExisting();
    const inspected = await verify(input);
    settings.checkCancelled();
    refuseExisting();
    let completedBytes = 0;
    const totalBytes = inspected.header.sourceBytes + inspected.header.databaseBytes;
    const report = (bytes) => {
      completedBytes += bytes;
      settings.onProgress({ phase: "restore", completedBytes, totalBytes });
    };
    await streamRange(file, inspected.sourceOffset, inspected.databaseOffset, settings, async (bytes) => {
      await sourceWritable.write(bytes); report(bytes.byteLength);
    });
    let offset = inspected.databaseOffset;
    const importedBytes = await pool.importDb(databaseName, async () => {
      settings.checkCancelled();
      if (offset === inspected.footerOffset) return undefined;
      const bytes = await readBytes(file, offset, Math.min(offset + settings.chunkBytes, inspected.footerOffset));
      offset += bytes.byteLength; report(bytes.byteLength);
      return bytes;
    });
    if (importedBytes !== inspected.header.databaseBytes || offset !== inspected.footerOffset) {
      fail("TRANSFER_ERROR", "Restored database byte count does not match its package.");
    }
    settings.checkCancelled();
    await sourceWritable.close();
    return inspected.header;
  } catch (error) {
    try { await sourceWritable?.abort(); } catch { /* Caller cleans up tracked staging artifacts. */ }
    throw error;
  }
}
