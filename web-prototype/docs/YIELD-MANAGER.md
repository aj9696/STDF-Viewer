# Yield Manager

Status: implemented and locally qualified, 2026-10-19.

## Purpose and scope

Review lots, yield by recorded file start time, and failing bins. The first
release works with the files selected in the viewer workspace. It uses the
existing local SQLite library and requires no server or database migration.

The user selected this workflow as the first priority. Galaxy's
[Yield-Man overview](https://www.galaxysemi.com/products/yield-man) describes
production dashboards with drill-down and automated reporting. This release
implements local review and device drill-down. Scheduled collection, alerts,
genealogy and automated reports are separate future capabilities.

## Engineer workflow

1. Open files from the Library.
2. Use **Files & groups** to set the comparison groups and source order.
3. Open **Yield Manager**.
4. Find a lot or sort the table by yield or count.
5. Select a lot to see its failing bins, sites and source files.
6. Select a count to open the devices that contribute to it.
7. Use **Help** to read the calculation and scope rules.

The viewer supports up to eight distinct source files and eight groups per
workspace. Yield Manager does not scan every file in the Library. A source can
belong to more than one group, so there is no grand total across groups.

## Population and calculation rules

- Counts describe device attempts, not individual test executions.
- Pass, fail and unknown use the existing PRR outcome rules.
- Yield = passed / (passed + failed). Unknown outcomes are shown separately.
  If no attempt has a known outcome, yield is unavailable, not zero.
- Files, groups, head/site filters and the current/all attempt policy apply.
  Test selection, test-display rules and chart-series settings do not change
  these device counts.
- A lot row is identified by group, product, program, revision, flow, test
  stage, sublot and lot ID. Missing lot IDs remain separate per source.
- Product/program metadata comes from MIR. The stage is MIR.TEST_COD;
  tester is NODE_NAM, falling back to TSTR_TYP. Empty metadata stays unknown.
- Current attempts follow the viewer's existing STDF replacement rules and
  ordered source groups. They do not establish first-pass or final yield.
  Cross-file replacement matches head, site and part ID; it does not validate
  lot/product genealogy. Put independent lots in separate groups when using
  Current attempts. A warning identifies mixed metadata within a group.
- Time points show source-file yield at MIR.START_T in UTC. MRR.FINISH_T is
  retained as source metadata. There is no per-device wall-clock time here.
  Missing start times remain in the source table and are not plotted.
- Failing bins count failed device attempts only. Their percentages use all
  failed attempts in the lot, including unrecorded bins. STDF bin 65535 is
  labelled unrecorded. A bin number alone does not determine pass or fail.

## Provider contract

`viewer('advanced', selection, {kind: 'yieldManager'})` returns
`{method: 'yield-manager-v1', files, warnings, reviewGroups}`. Each file/group row includes
its source identity, lot/program metadata, start/finish times, total, passed,
failed, unknown, fractional yield, site counts and hardware/software bin counts.

The provider streams indexed device rows. It does not scan test observations.
The response permits 4,096 site buckets, 32,768 bin buckets across both bin
families, and 4 MiB of UTF-8 JSON. Exceeding a bound
fails with an actionable error instead of silently truncating counts.
Cancellation yields no partial result that could appear to be complete.

Device drill-down adds validated `datasetIds`, `group` and optional `outcome`,
bin or site predicates to the existing device query. It preserves the original
workspace selection and its source order. Removing later sources from the
selection would incorrectly change which earlier attempts were retired.

## UI and state

The lot table leads the view. Search, sorting and group/product filters use the
completed summary in memory. Selecting a lot reveals failing bins, site results
and a UTC time plot with an accessible source table. Groups and cohorts are
never joined by a trend line. The view has no yield target or alarm status.

The summary is cleared when source groups, heads, sites or the attempt policy
change. A failed or cancelled request is not cached. Returning from a device
drill-down reuses the current summary. The active tab persists in the existing
workspace; temporary lot/search controls are session-local.

`reviewGroups` contains the group indexes with mixed or missing cohort metadata
under Current attempts. These groups receive a visible warning; routine method
notes remain in the Scope notes disclosure.

Bin and site detail tables page through 50 rows at a time. The lot and source
tables are bounded by the existing selection limit: at most 64 file/group
entries. Scope notes are available in a disclosure. The SVG time plot supports
mouse and keyboard selection, with the same records available in a source
table. It is not part of the viewer's canvas PNG export API; that API returns
only chart handles with an image exporter. Existing report exports are unchanged.

## Acceptance and validation

- Source totals agree with Devices under current/all and head/site filters.
- Shared labels with different products/revisions and missing lot IDs do not
  merge. Overlapping groups have no combined total.
- Count, bin and site drill-downs retain later-source replacement semantics.
- Unknown outcomes and bin 65535 remain visible; zero denominators are null.
- Actual recorded times determine the timeline; missing dates are not invented.
- Provider cancellation and bounded responses are checked without observations.
- Chrome and Edge cover tab integration, cache invalidation, sorting, drill-down,
  help, reload and narrow layout. Shared viewer/help regressions remain green.

Verification results and release provenance are recorded after execution in
`VIEWER-VALIDATION.md` and `DEPLOYMENT.md`.
