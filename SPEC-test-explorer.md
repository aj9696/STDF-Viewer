# Test Explorer

Module: browser-ui, consuming additive browser-library queries. Authorized as
the first basic exploration phase on 2026-09-24. The engineer requested simple
features and autonomous implementation unless a material decision needs input.
This extends the existing capability map; no new storage module is needed.

## Objective and scope

From a saved dataset, an engineer opens Test Explorer, searches PTR tests by
number/name, inspects recorded declarations and pages through observations.
Success means useful inspection without rereading STDF or moving the entire
measurement table into JavaScript. Preserve the existing local library and UI.

This phase includes one dataset, test-number navigation, literal search, raw
declarations, result/flag/attempt inspection and durable-dataset reopen. It does
not calculate histograms, capability, yield or PAT, merge retests, infer defaults,
apply scale exponents or define cross-file test identity. Those remain future
features. A test-number group is a navigation bucket, not a claim that its
declarations form one comparable statistical population.

## Query contract

Add methods to DataLibraryClient and dispatch them inside the existing owner
worker. Protocol/schema remain version 1; existing requests are unchanged.
Completed dataset databases remain read-only. SQL parameters must be bound.
Access uses LibraryStore.access, preserving unavailable/recovery behavior.

| Method | Inputs | Output |
| --- | --- | --- |
| `listTests(id, options)` | `query=''` string <=128 characters; `after=null` or uint32; `limit=50`, 1–100 | `{items:[{test_number,name,definition_count}],nextAfter,totalTests,matchedTests}` |
| `getTest(id, testNumber)` | uint32, including zero | `{test_number,measurementCount,definitionCount}`; NOT_FOUND for an absent test |
| `readTestDefinitions(id,testNumber,options)` | `after=0` nonnegative safe integer; `limit=25`, 1–100 | `{items,nextAfter}`; original definition columns including metadata_json, ordered by id |
| `readTestMeasurements(id,testNumber,options)` | `after=0` nonnegative safe integer; `limit=100`, 1–1000 | `{items,nextAfter}`; original measurement columns plus `part_id`, `hard_bin`, `soft_bin`, `part_flags`, ordered by seq |

All cursor pages return at most 2 MiB of JSON row data and look ahead to decide
nextAfter. Short pages are not necessarily the end. Inputs outside the contract
reject INVALID_REQUEST, including NaN, fractions and non-string searches.
Absent-test row pages may return empty; getTest distinguishes absence.

listTests groups only the at-most-20,000 declarations by test_number. `name` is
the lexicographically first nonempty recorded name or null; definition_count is
the full group's count. Literal substring search matches decimal test number or
any declaration's recorded name. SQLite ASCII case folding applies; Unicode
characters match literally. `%`, `_` and quotes are literal, not wildcards/SQL.
Search first selects matching numbers; returning a group does not hide its other
declarations. totalTests counts all groups; matchedTests counts matching groups
independently of cursor position. Null cursor includes test number zero.

getTest counts observations using the existing measurements_test index; listTests
does not scan or count the measurement table. Measurement paging uses the same
(test_number,seq) index and joins attempt metadata by device primary key. No new
index/schema, migration, cache database or retained-source rewrite.

## Interface and rendering

Add `site/explore.html?dataset=<id>`, `explorer.js`, `explorer-view.js` and
`explorer.css`, reusing the existing app.css workspace shell. Add an **Explore
tests** link to the dataset overview; navigate in the same tab so pagehide
releases the library owner. The explorer opens its own client. Reload preserves
dataset selection through the URL; browser Back and back/forward-cache return
must reopen safely. No source selection is needed for saved data.

Use a searchable test list and a straightforward detail pane. Render 50 test
groups, 25 declarations and 100 observations per UI page. Search is submitted
explicitly; Prev/Next uses returned cursors. Controls are disabled during each
serialized operation. Back-to-library navigation can always abandon read work.
Missing/invalid dataset URLs and BUSY/unavailable/worker errors provide clear
recovery actions. Worker termination cannot leave indefinitely enabled controls
or a permanently loading view.

DOM contract: `explorer-title`, `explorer-dataset`, `explorer-status`,
`explorer-error`, `explorer-error-text`, `explorer-retry`, `test-search` (form),
`test-query`, `test-search-submit`, `test-count`, `tests-body`, `tests-previous`,
`tests-next`, `test-empty`, `test-detail`, `selected-test`, `test-summary`,
`definitions-body`, `definitions-page`, `definitions-previous`,
`definitions-next`, `measurements-body`, `measurements-page`,
`measurements-previous`, `measurements-next`. Test buttons carry data-test-number.

Declaration fields show recorded name, units, low/high limits, result/limit
scale exponents and OPT_FLAG. Omitted fields display **Not recorded**; explicitly
empty strings display **(empty)**. Presence is determined from PRESENT_FIELDS;
float bit fields retain NaN/infinity/signed zero. Explain that recorded fields
are not resolved effective limits; flags/defaults/scaling have not been applied.
Unknown or malformed metadata must be visibly identified without script errors.

Observation rows show source sequence, attempt ID, part ID, head/site, recorded
result, declaration ID, TEST_FLG and PARM_FLG. Decode result_bits for IEEE-754
special values; never conflate null with zero or filter failed/flagged results.
Use plain text cells, native buttons, focus visibility and horizontally scrolling
tables within a responsive page. No charts, animations or new UI framework.

## Structure and style

- `site/test-queries.js`: validated, bounded read-only worker queries.
- `site/data-worker.js` and `data-client.js`: additive dispatch/adapter methods.
- `site/explore.html`, `explorer.js`, `explorer-view.js`, `explorer.css`: UI.
- `scripts/make-explorer-fixtures.py`, `explorer-check.mjs`: independent goldens
  and isolated desktop-browser query/UI checks.
- `docs/TEST-EXPLORER.md` under web-prototype: user guide and evidence scope.

Follow two-space JavaScript indentation, named helpers and text-safe rendering:
```js
const cell = document.createElement('td');
cell.textContent = value === '' ? '(empty)' : String(value);
```
Keep SQL/OPFS out of UI code. Use existing dependencies only.

## Verification and execution slices

1. Commit the contract; implement additive query methods and independently
   verify real SQLite outputs, paging, input validation and query plans.
2. Build the simple UI against that contract; run actual import -> explore ->
   search -> page -> reload/back flows in isolated Chrome/Edge profiles.
3. Independently review correctness/lifecycle/text safety, fix findings, check
   desktop/narrow visuals, record evidence and update the feature status.

Key cases: test zero and uint32 maximum; renamed/omitted/empty declarations;
changed units/limits; repeated attempts; multiple heads on one site; signed zero,
NaN/infinities; invalid flags retained; search injection/wildcards; sparse cursors;
catalog >50 groups, >25 declarations and >100 observations; no-PTR dataset;
unsupported/busy/unavailable/error states and browser Back; no full-table
measurement scan. Compare little/big-endian independent known values.

Commands from repository root:
```powershell
node --check web-prototype/site/test-queries.js
node --check web-prototype/site/explorer.js
node --check web-prototype/site/explorer-view.js
node web-prototype/scripts/explorer-check.mjs chrome
node web-prototype/scripts/explorer-check.mjs msedge
node web-prototype/scripts/frontend-check.mjs chrome
node web-prototype/scripts/frontend-check.mjs msedge
git diff --check
```

Always preserve sources/databases, bound reads and document limitations. Routine
interface choices and additive reads are authorized. Ask only if implementation
requires a new analytical policy, destructive action, incompatible storage change
or another material product choice. Never invent measurements, upload test data,
silently fill absent STDF fields, or relabel attempts as unique physical devices.
