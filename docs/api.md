# Local API contract — 0.1

Base `/api`. JSON uses snake_case. Errors are `{"error":{"code":"...",
"message":"..."}}`; invalid input 400, absent resource 404, conflict 409,
unexpected server failure 500. No nonfinite JSON numbers; unavailable statistics
are `null`. API is local and experimental; version is returned in state.

Writes require `Content-Type: application/json`, same origin if Origin is supplied,
and `X-SemiData-Token` from state. Host must match loopback server. No CORS.

## State and library
- `GET /state`: `{version, token, workspace, datasets: [Dataset], runs: [RunSummary]}`.
  Lists the most recent 200 datasets/runs; bounded evaluation release.
- `POST /imports` body `{path: string}`: `{dataset: Dataset, duplicate: bool}`.
  Single local path; UI may submit paths one at a time. May take time; UI shows busy.
- `POST /demo` body `{}`: imports bundled deterministic synthetic fixtures,
  returns `{datasets: [Dataset]}`; repeated call deduplicates.
- `GET /tests?datasets=id1,id2`: `{tests:[{key,number,name,unit,datasets}], sites:[int]}`.
  `key` is a JSON string encoding `[test_number,test_name,stored_unit]`.

Dataset = `{id,name,sha256,lot,product,started_at,imported_at,dut_count,
test_count,measurements,pass_count,bytes,parse_seconds,warnings:[string]}`.
`measurements` counts scalar PTR rows. Counts/metadata are source-level.

## Analysis
`POST /analysis` with Selection:
`{dataset_ids:[string], test_key:string, site: int|null, attempts:"current"|"all"}`.
Maximum 20 datasets and 500,000 selected measurement rows.

Response `{test:{number,name,unit}, population:{total,valid,excluded},
stats:{count,mean,median,stdev,min,max,lsl,usl,cpk},
groups:[{dataset_id,name,lot,count,mean,stdev,min,max,lsl,usl,cpk}],
histogram:[{low,high,count}], points:[{index,value,dataset_id,part_id,site}],
points_total, points_sampled, warnings:[string]}`. Max 800 plot points.
Statistics include valid measurements from passing and failing DUTs; PAT applies
its stricter eligible population rule. `current` excludes upstream Supersede=1
only within each file, never merges identities across files.

## PAT
`POST /pat/preview` body `{selection:Selection, reference_ids:[string],
method:"sigma"|"mad", k:number, name:string}`. Empty reference_ids uses selection.
`POST /runs` same body recalculates and persists an immutable result.

Preview/Run = `{id?:string,created_at?:string,name,engine_version,recipe,
reference_count,evaluated_count,excluded_count,flagged_count,flagged_percent,
center,spread,lower,upper,unit,flagged:[{dataset_id,dataset,part_id,dut_index,
site,head,wafer,x,y,value}],warnings:[string],sources:[Dataset]}`.
Preview/API lists first 1,000 flagged rows plus `flagged_truncated`; saved storage
and CSV retain all flagged rows. Percent denominator is evaluated eligible rows.

RunSummary = `{id,name,created_at,method,flagged_count,evaluated_count}`.
`GET /runs/<id>` returns persisted Run. `GET /runs/<id>/csv` downloads all flagged
rows with fixed columns and formula-safe text. Saving is intentionally not
idempotent: each successful POST creates a new experiment; UI disables repeat
clicks and refreshes history after a save. Imports deduplicate by source hash.
