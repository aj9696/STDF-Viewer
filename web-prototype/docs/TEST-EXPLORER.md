# Test Explorer: recorded test inspection

Status: local engineering preview, 2026-09-24. Test Explorer reads one saved
dataset's PTR declarations and observations. It does not reparse the source or
load the full measurement table into the page. The browser checks and their
qualification limits are recorded below.

The feature contract is [SPEC-test-explorer.md](../../SPEC-test-explorer.md).
For storage and the complete API, see [FRONTEND-CONTRACT.md](FRONTEND-CONTRACT.md).

## Try it as a test engineer

Build and serve the existing application using the
[README instructions](../README.md#run-the-library-foundation).

1. Open [Data library](http://127.0.0.1:8766/app.html) in the browser/profile that
   holds your saved datasets. Import an STDF if the library is empty.
2. Select a dataset's filename to open its overview, then select **Explore tests**.
   The same tab opens `explore.html?dataset=<saved-id>` and releases the library
   screen's connection. A source file does not need to be selected again.
3. Enter part of a test number or recorded name and select **Search**, or press
   Enter. Clear the input and submit again to show all test numbers.
4. Select a test number. Review its recorded declarations and observations.
   Each section has independent **Previous** and **Next** controls.
5. Use **Back to library** to return to the catalog. Reloading the explorer keeps
   the dataset from its URL, but starts with the full test list and no selected
   test. The search, selected test and page positions are not saved sessions.

The test list shows 50 groups per page. Declaration pages request 25 rows and
observation pages request 100. The backend may return shorter pages to respect
its byte budget; the controls follow its returned cursor. Tables scroll within
their panels on narrow screens and can receive keyboard focus for scrolling.
Selecting a test moves keyboard focus to its detail heading. Search and paging
restore a usable focus position when their requests finish.

## What the displayed values mean

| Display | Meaning |
| --- | --- |
| Test number | A navigation group within this source. It is not a cross-file identifier or a guarantee of one comparable measurement population. |
| Test-list name | The lexicographically first nonempty recorded name in the group. Search considers all recorded names, not only this label. |
| Declaration count | Number of retained distinct declarations for that test number, including changed names, units, limits or other declaration fields. |
| Observation count | All saved PTR measurement rows for the test number, including repeats and rows with failure/validity flags. |
| Declaration ID | Connects an observation to its recorded declaration. It does not represent a resolved set of effective limits. |
| Source sequence | Position of the PTR in the original source record sequence. Gaps between observation sequence numbers are normal. |
| Attempt ID | The retained device attempt, not a unique physical part. Repeated tests of the same Part ID remain separate attempts. |
| Head / site | Recorded tester head and site; the same site number on different heads is not collapsed. |

Declarations show name, units, low/high limits, `RES_SCAL`, `LLM_SCAL`,
`HLM_SCAL` and `OPT_FLAG`. Presence comes from retained `PRESENT_FIELDS`:
**Not recorded** means the field was omitted, while **(empty)** means its
recorded string was explicitly empty. Unknown or malformed declaration metadata
gets a visible error row rather than plausible default values.

Results and floating-point limits are decoded from their retained IEEE-754
32-bit patterns. `-0`, `NaN`, `Infinity` and `-Infinity` are displayed explicitly.
A value such as `0.10000000149011612` is the stored binary32 value rendered as a
JavaScript number; it is not extra measurement precision. Observation result
cells include the exact hexadecimal bits in their hover title. The API retains
those bits, including NaN payloads, regardless of the displayed numeric text.

`TEST_FLG`, `PARM_FLG` and `OPT_FLAG` are shown as hexadecimal recorded flags.
No flag mask, result-validity filter, inherited default or scale exponent is
applied. Seeing a low/high limit does not establish that its validity flags make
it an applicable limit. Seeing a result does not classify the part as passing.

Only PTR has normalized measurement rows in this version. MPR/FTR and other
families remain available as retained source/context according to the manifest;
they do not appear as PTR tests here. A dataset with no PTR rows has an explicit
empty-test message. Nothing is silently converted into an equivalent test.

## Search, errors and persistence

Search is a literal substring match against decimal test numbers and any name
in a group. `%`, `_` and quotes are ordinary characters. SQLite folds ASCII case
for matching; Unicode characters otherwise match literally. The maximum search
length is 128 JavaScript string code units. A matching name does not remove
other declarations from the returned group or reduce its declaration count.

The library permits one owning tab. If another page has it open, close that
connection and select **Try again**. Missing or invalid dataset links direct you
back to Data library. Unavailable saved data directs you to Library tools for
inspection or package recovery. Read failures stop further requests until retry;
they never reset storage or replace a saved dataset. A retry reopens the dataset
and resets the explorer's transient selection and paging state.

Navigating away can abandon a read. The page terminates its worker on `pagehide`
and reopens on a back/forward-cache return. Completed sources and databases stay
unchanged. Keep the same app origin and browser profile to return to this
library. This feature adds no backup format or offline-startup guarantee.

## Implementation contract

| File | Responsibility |
| --- | --- |
| `site/explore.html` | Test list, accessible tables, status and recovery actions |
| `site/explorer.css` | Explorer layout within the existing library workspace shell |
| `site/explorer.js` | Serialized reads, cursor history, selection and page lifecycle |
| `site/explorer-view.js` | Text-safe rendering, declaration presence/type checks and float-bit formatting |
| `site/test-queries.js` | Validated, bounded read-only SQLite queries in the owner worker |
| `site/data-client.js`, `site/data-worker.js` | Four additive methods and dispatch; protocol version remains 1 |
| `scripts/make-explorer-fixtures.py` | Independently encoded little/big-endian known-answer sources |
| `scripts/explorer-check.mjs` | Isolated browser query plans, known-answer rows and user workflows |
| `scripts/explorer-format-check.mjs` | Special float values, omitted/empty fields and malformed metadata |

The four methods are `listTests`, `getTest`, `readTestDefinitions` and
`readTestMeasurements`; their exact inputs/results are in the
[query contract](FRONTEND-CONTRACT.md#test-inspection-queries).
The test list groups declarations only. It does not scan measurements for each
list item. All four queries enforce a 20,000-declaration maximum per dataset,
checking both the manifest and a bounded probe for a 20,001st stored row. This
also applies to restored packages; an over-limit dataset remains available in
Library tools rather than being rewritten or reset.

The selected-test count traverses only that test's matching entries in the
existing `measurements_test` index. It is not a cached or constant-time count:
its work scales with that selected test's observations, without counting every
other test. Observation pages use `(test_number, seq)` with a device-primary-key join.
Completed datasets remain read-only. There is no schema migration, new index,
measurement cache, additional runtime dependency or frontend SQL access.

## Verification and qualification

From the repository root, after building the current WASM/SQLite assets:

```powershell
node --check web-prototype/site/test-queries.js
node --check web-prototype/site/explorer.js
node --check web-prototype/site/explorer-view.js
node web-prototype/scripts/explorer-format-check.mjs
node web-prototype/scripts/explorer-check.mjs chrome --queries-only
node web-prototype/scripts/explorer-check.mjs chrome
node web-prototype/scripts/explorer-check.mjs msedge
node web-prototype/scripts/frontend-check.mjs chrome
node web-prototype/scripts/frontend-check.mjs msedge
git diff --check
```

The browser harness uses the installed browser, Node.js 22+, the repository's
Python environment and generated synthetic STDFs. Its profiles and reports live
under ignored `web-prototype/results/explorer-*` directories; it does not operate
the engineer's browser profile. Test-only instrumentation inspects actual SQLite
query plans and injects specific fault/large-metadata cases. Those cases are
separate from the real imported-fixture workflow.

Chrome 153.0.8010.48 and Edge 153.0.4234.48 each passed **13 grouped explorer
checks**, with zero page errors. The existing library-home suite also passed
all **15 grouped checks** in each browser. Reports, fixture hashes and deduplicated
executed query plans are preserved in the [evidence record](../evidence/test-explorer.json).

| Evidence | Verified scope |
| --- | --- |
| Independent source fixtures and real SQLite | Both byte orders; 58 test groups, 120 declarations and 212 observations; zero/max test numbers; exact recorded fields, raw bits, flags and attempt joins; literal search; cursor and input bounds; no-PTR source |
| Actual page workflows | Same-tab overview link; test list pages 50/8; declaration pages 25/25/13; observations 100/55; keyboard focus; hostile text; search, reload, Back, second-tab BUSY and retry |
| Explicit test-only cases | 2 MiB Unicode row budget; 20,001 stored declarations despite a smaller manifest; malformed/unknown metadata; worker failure and unsupported/unavailable states |
| Executed SQL plans | Measurement pages use `measurements_test`; attempt joins use the device primary key; search reads declarations; selected-test counts use the covering index |
| Formatting and visual review | IEEE-754 special values/subnormal; omitted versus empty; invalid metadata types; embedded-browser evaluation dataset; desktop and 390px layouts |

Temporary test mutations were restored and the original dataset/source verified.
The engineer's saved evaluation dataset remained intact. Narrow viewport checks
establish layout behavior, not mobile OPFS support. Large-dataset query latency
was not benchmarked; this slice adds no import-throughput or analytical accuracy
claim. Existing import/transfer evidence remains in
[LIBRARY-VALIDATION.md](../LIBRARY-VALIDATION.md).

Histograms, capability, yield, PAT, retest consolidation, effective limits and
cross-file comparisons remain separate features. Before implementing them,
specify population selection, validity flags, scale/default handling and attempt
policies with the engineer. Raw inspection does not approve those decisions.
