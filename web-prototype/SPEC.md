# Spec: bounded browser STDF parsing proof of concept

## Objective and acceptance
Prove that the actual `rust-stdf = 1.1.0` record views can run inside a browser
worker and process a raw STDF file without loading the whole file into memory or
creating a JavaScript object for every record. Keep the current product untouched.
The engineer selects a local file, sees progress, can cancel, and receives record
counts, PTR flags, per-test numeric summaries, and a deterministic fingerprint.
Success means equivalent results for arbitrary chunk boundaries, native and WASM
parity, clear errors for malformed/truncated input, and a working static browser
demo. This is a parser experiment, not the persistent analysis/PAT product.

## Scope and interface
- Raw STDF v4, IEEE little- and big-endian FAR only. Compression is rejected.
- Worker reads 4 MiB `File.slice()` chunks sequentially. `push(bytes)` copies one
  chunk into WASM; Rust retains at most one incomplete record (65,539 bytes),
  bounded summaries, and counters. No complete-file ArrayBuffer or result array.
- `Parser.push(Uint8Array)`: process a bounded chunk or throw an offset-bearing
  error. `Parser.finish()`: reject partial records and return summary JSON.
  `Parser.progress()`: small JSON containing bytes, records, PTR count, and buffer
  metrics. `free()` releases the parser; cancelling terminates its worker.
- Summary uses a versioned shape and an ordered 64-bit semantic PTR digest. This
  is an equivalence check, not a cryptographic identity or security mechanism.
- PTR numeric summaries exclude invalid flags/nonfinite values, but count every
  flag combination and retain raw IEEE bits in the digest. Failing but valid
  tests remain in numeric summaries. No PRR-based PAT eligibility is implied.
- Preserve raw values/units plus effective result scale explicitly. Omitted
  optional PTR metadata inherits the first value for that test number; explicitly
  changed metadata starts a separate summary. No inferred SI-prefix rewriting.
- Respect `OPT_FLAG` bit 0 for invalid result-scale values. An empty/omitted unit
  uses the first PTR's unit. Raw statistics remain in base units; display mean is
  `mean_raw × 10^result_scale`, labeled explicitly as `10^-result_scale × unit`.
- Producer compatibility: a PTR ending immediately after RESULT (12 payload
  bytes) uses its test number's sole preceding PTR identity. Multiple preceding
  PTR identities (including empty names) make it ambiguous and fail the scan. An
  explicitly present empty name remains empty. Without a preceding PTR identity,
  identity stays unknown. Non-PTR records do not establish this identity. This
  is a compatibility policy, not a standard optional default for TEST_TXT.
- Summary state is limited to 20,000 test/metadata groups. Exceeding it fails
  clearly; no silent truncation. Unique flags have only 65,536 combinations.

## Structure and commands
`rust/src/lib.rs` contains framing and summaries; `rust/src/bin/native.rs` is the
same engine as a native check. `site/` contains the worker UI and generated `pkg/`.
`scripts/` contains bounded reference/parity checks; `README.md` explains operation.

From repository root (PowerShell):
```powershell
. .venv/runtime-environment.ps1
./web-prototype/build.ps1
cargo test --manifest-path web-prototype/rust/Cargo.toml
node web-prototype/scripts/check.mjs <file.stdf>
.venv/Scripts/python.exe -m http.server 8766 --bind 127.0.0.1 --directory web-prototype/site
```

## Implementation plan and verification
1. Frame complete records from arbitrary chunks and use upstream borrowed views.
   Unit-check split headers/bodies, little/big endian, invalid/truncated PTRs.
2. Compile native and WASM from the same Rust source. Compare structured summaries
   with the Node harness and an independent small Python raw-record reference.
3. Add file selection, progress, cancel, and report UI. Parent verifies in browser.
4. Coordinate timed runs with the parent to avoid concurrent benchmarking. Report
   measured files and environment; make no unmeasured huge-file speed claims.

## Code style and boundaries
Use `cargo fmt`, named structures, small parser methods, and plain JS modules.
```rust
if body.len() < 12 {
    return Err(format!("PTR at byte {offset} has no complete fixed fields"));
}
```
Always document semantic limits and preserve error state after failure. Existing
product files and the upstream parser crate are read-only. No global toolchain
changes, cloud upload, database replacement, runtime CDN, or production claims.

## Integration findings before coding
Upstream `StdfReader` requires synchronous `BufRead + Seek` and rewinds after FAR.
A browser `File` is asynchronous, so use a small framing adapter around the
upstream `StdfRecordView::read_from_bytes` API instead of making the complete file
seekable in memory. Default rust-stdf features include native compression; disable
default features for this raw-file proof. `wasm-bindgen` crate and CLI versions
must match; pin both to 0.2.128.
