import { libraryError } from "./dataset-schema.js";

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
// Matches retained-v1's MAX_DEFINITIONS in rust/src/retained.rs. Restored
// databases must also respect the query bound, independent of manifest claims.
const MAX_DEFINITIONS = 20_000;
const encoder = new TextEncoder();

// Filter whole groups after aggregation: a matching declaration must not hide
// the group's other names or reduce its declaration count.
const TEST_GROUPS = `WITH test_groups AS (
  SELECT test_number, MIN(NULLIF(name, '')) AS name, COUNT(*) AS definition_count,
    MAX(instr(lower(COALESCE(name, '')), lower(?)) > 0
      OR instr(CAST(test_number AS TEXT), ?) > 0) AS matched
  FROM definitions GROUP BY test_number
)`;

function testNumber(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw libraryError("INVALID_REQUEST", "Test number must be an unsigned 32-bit integer.");
  }
  return value;
}

function pageLimit(value, fallback, maximum) {
  const limit = value === undefined ? fallback : value;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw libraryError("INVALID_REQUEST", `Page size must be an integer from 1 to ${maximum}.`);
  }
  return limit;
}

function rowCursor(value) {
  const after = value === undefined ? 0 : value;
  if (!Number.isSafeInteger(after) || after < 0) {
    throw libraryError("INVALID_REQUEST", "Row cursor must be a nonnegative safe integer.");
  }
  return after;
}

function readPage(db, sql, bind, key, limit) {
  const statement = db.prepare(sql);
  const items = [];
  let bytes = 2, more = false;
  try {
    statement.bind(bind);
    while (statement.step()) {
      if (items.length === limit) { more = true; break; }
      const row = statement.get({});
      const rowBytes = encoder.encode(JSON.stringify(row)).byteLength + (items.length ? 1 : 0);
      if (bytes + rowBytes > MAX_PAGE_BYTES) {
        if (!items.length) throw libraryError("CORRUPT", "Stored row exceeds the bounded read contract.");
        more = true;
        break;
      }
      items.push(row);
      bytes += rowBytes;
    }
  } finally { statement.finalize(); }
  return { items, nextAfter: more ? items.at(-1)[key] : null };
}

function listTests(db, message) {
  const query = message.query === undefined ? "" : message.query;
  if (typeof query !== "string" || query.length > 128) {
    throw libraryError("INVALID_REQUEST", "Test search must be a string of at most 128 characters.");
  }
  const after = message.after === undefined ? null : message.after;
  if (after !== null) testNumber(after);
  const limit = pageLimit(message.limit, 50, 100);
  // instr implements literal substring matching: %, _ and quotes are not SQL
  // wildcards. SQLite's built-in lower folds ASCII characters only.
  const counts = db.selectObject(`${TEST_GROUPS}
    SELECT COUNT(*) AS totalTests, COALESCE(SUM(matched), 0) AS matchedTests
    FROM test_groups`, [query, query]);
  const page = readPage(db, `${TEST_GROUPS}
    SELECT test_number, name, definition_count FROM test_groups
    WHERE matched=1 AND (? IS NULL OR test_number>?)
    ORDER BY test_number LIMIT ?`, [query, query, after, after, limit + 1], "test_number", limit);
  return { ...page, ...counts };
}

function getTest(db, message) {
  const number = testNumber(message.testNumber);
  const definitionCount = db.selectValue("SELECT COUNT(*) FROM definitions WHERE test_number=?", [number]);
  if (!definitionCount) throw libraryError("NOT_FOUND", "Test number is not present in this dataset.");
  const measurementCount = db.selectValue("SELECT COUNT(*) FROM measurements WHERE test_number=?", [number]);
  return { test_number: number, measurementCount, definitionCount };
}

function readTestDefinitions(db, message) {
  const number = testNumber(message.testNumber);
  const after = rowCursor(message.after), limit = pageLimit(message.limit, 25, 100);
  return readPage(db, "SELECT * FROM definitions WHERE test_number=? AND id>? ORDER BY id LIMIT ?",
    [number, after, limit + 1], "id", limit);
}

function readTestMeasurements(db, message) {
  const number = testNumber(message.testNumber);
  const after = rowCursor(message.after), limit = pageLimit(message.limit, 100, 1000);
  return readPage(db, `SELECT m.*, d.part_id, d.hard_bin, d.soft_bin, d.part_flags
    FROM measurements m LEFT JOIN devices d ON d.id=m.device_id
    WHERE m.test_number=? AND m.seq>? ORDER BY m.seq LIMIT ?`,
    [number, after, limit + 1], "seq", limit);
}

/** Additive inspection queries; sources and completed dataset databases stay read-only. */
export async function runTestQuery(store, message) {
  const handlers = { listTests, getTest, readTestDefinitions, readTestMeasurements };
  if (!Object.hasOwn(handlers, message.type)) throw libraryError("INVALID_REQUEST", "Unknown test query.");
  const opened = await store.access(message.datasetId);
  try {
    if (opened.manifest.counts.definitions > MAX_DEFINITIONS ||
      opened.db.selectValue('SELECT id FROM definitions LIMIT 1 OFFSET ?', [MAX_DEFINITIONS]) != null) {
      throw libraryError('LIBRARY_LIMIT', 'Test Explorer supports at most 20,000 recorded declarations per dataset. This dataset remains available in Library tools.');
    }
    return handlers[message.type](opened.db, message);
  }
  finally { opened.db.close(); }
}
