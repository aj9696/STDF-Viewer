# Library organization and report device filters

Status: implementation, 2026-10-19.

## Requested workflows

Engineers must be able to find related source files by recorded test date, part
number and lot, then open a selection in Viewer. They must also be able to
exclude failed devices from exported reports without changing source data.

These are two independent capabilities sharing the existing local library.
Neither requires hosted test data, a new parser, or an immutable dataset schema
migration. Existing unfiltered reports remain the default.

## Library requirements

- Read MIR.START_T as test date in UTC, PART_TYP as part number, LOT_ID as lot,
  JOB_NAM/JOB_REV as test program/revision, and retain sublot and tester metadata.
  Never substitute import time for a missing test date.
- Derive metadata from bounded retained header records. Cache it separately as
  disposable local metadata. Existing datasets and restored packages work.
  A cache failure must not make an otherwise usable dataset unavailable.
- Default to newest recorded test date. Support grouping by test date, part
  number, lot or none, plus search across metadata and source names/paths.
  Missing values have explicit labels and sort after known dates.
- Keep the 1,000-dataset inventory and 25-file rendered page bounds.
- Select up to eight ready files across pages and filters. Show selected names
  and allow individual removal. Filtering must not silently clear a selection.
  Bulk group/page selection must not silently select a partial group at the cap.
- **Open in Viewer** reuses the existing multi-source URL and opens independent
  comparison groups. The user can explicitly combine sources and set their
  retest order through Files & groups. One-file navigation remains available.

## Report requirements

Offer **Report devices** in the investigation workbook and document Reports:

| Option | Included device attempts |
|---|---|
| All devices | Existing current/all, head/site and source/group scope |
| Exclude failed devices | Pass and unknown device outcomes |
| Passing devices only | Known pass outcomes only |

Device outcomes use PRR flags. A passing device can still contain a failed test
execution. The filter does not remove individual test failures independently.

Apply the same population to device rows, statistics, numeric charts, bins,
wafer maps, site summaries, device trends and report studies. Embedded images and
worksheet values must agree. Keep test eligibility and measurement flags intact.
Apply the outcome filter after replacement decisions: excluding a failed later
retest must not revive a superseded earlier passing attempt.

Report scope is ephemeral. `viewer(action, selection, {deviceOutcomes, ...})`
and `viewerReport(selection, {deviceOutcomes, ...})` accept `all`, `non-failed`,
or `pass`; omission means `all`. The viewer's saved selection and analysis cache
must not acquire the export filter. Source/workspace bytes are unchanged.

Filtered exports identify the device filter even when the summary/File Info
section is omitted. They describe a filtered population, not production yield.
Original source headers and recorded PCR totals stay clearly labelled as source
facts. Device-linked datalog records follow the filter; unassociated file notes
remain and can describe excluded devices. Parser context does not assert device
ownership for GDR/DTR records. Complete raw-record and individual-device exports do not silently apply
this report option.

## Implementation slices and acceptance

1. Add bounded, cached Library metadata with legacy/restore coverage.
2. Add grouping, metadata search and persistent cross-page multi-selection.
3. Add a shared ephemeral provider outcome scope and verify retest semantics.
4. Add report controls, filtered chart capture and visible export provenance.
5. Independently review, test Chrome/Edge, inspect responsive screenshots and
   generated report contents, update guides, then publish and verify the release.

Required cases: old/new imports; missing MIR/date/part number; no data cache
dependency; safe untrusted labels; selection across pages/filters; eight-file
cap; unavailable rows; reopen/reload; pass/fail/unknown mixtures; failed later
retests; matching chart/table counts; zero included devices; invalid options;
cancel/retry; default export compatibility; PDF/Word/Excel filter provenance.

Use small synthetic STDF fixtures and disposable browser profiles. Preserve the
user's existing library. Record executed checks separately from planned checks
in VIEWER-VALIDATION.md and deployment provenance in DEPLOYMENT.md.
