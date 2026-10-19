# Cloudflare Pages deployment

SemiData ships as static HTML, JavaScript and WebAssembly. Cloudflare serves
the application; parsing, SQLite databases and source snapshots stay in each
visitor's browser. The Pages project is `semidata`, with production address
`https://semidata.pages.dev/`. No Pages Functions, server database or custom
domain is required.

## Build and package

Use Node.js 22+, Git and the Rust environment described in the
[browser build guide](../README.md). On the prepared Windows workstation,
run these commands from the repository root:

```powershell
npm.cmd --prefix web-prototype ci --ignore-scripts
npm.cmd --prefix web-prototype run build:storage
npm.cmd --prefix web-prototype run build:vendor
./web-prototype/build.ps1 -SkipNative
npm.cmd --prefix web-prototype run package:pages
```

The package is `web-prototype/dist/pages/`. Commit and push the source before
making the final package: `/release.json` records the commit, corresponding
source URL, tracked-worktree status and SHA-256 of every packaged asset except
itself. `sourceDirty` must be `false` for a release. Re-run `package:pages` after
committing. The generated directory is ignored by Git and replaced on each run.

The packager copies tracked `site/` files and explicitly named generated
parser, SQLite and compression assets. It verifies WASM validity and the
pinned SQLite/compression versions and manifest hashes. It also collects
license texts from the offline Cargo dependency graph, so the packages fetched
by the Rust build must still be in Cargo's cache. These checks do not rebuild
the parser or prove that an old binary matches changed Rust source; always run
the build steps for the release checkout first.

Only the package directory is published. Local databases, uploaded engineering
data, test results, the source workspace and credentials are not inputs to the
packager. The five tracked STDF examples are generated demonstration data.

| Deployed path | Contents |
| --- | --- |
| `/` and `/app.html` | Data library |
| `/viewer.html` | Data viewer |
| `/parser.html` | Summary parser lab |
| `/release.json` | Source revision and asset hashes |
| `/NOTICE.txt`, `/LICENSE.txt` | Attribution, source link and GPL license |
| `/sqlite/NOTICE.txt`, `/vendor/NOTICE.txt`, `/THIRD-PARTY-RUST-NOTICES.txt` | Dependency notices |

The deployment copy changes the root entry page; the local `site/index.html`
parser lab remains unchanged. `_headers` requests cache revalidation for all
assets because their filenames are not content-versioned. This avoids reusing
stale modules after a refresh; it cannot replace JavaScript already executing
in an open tab. Ask testers to finish operations and reload after an update.

## Publish

In **Cloudflare → Workers & Pages → semidata**, create a deployment, select
**Production**, and upload `web-prototype/dist/pages/`. Alternatively, create
a ZIP containing the directory's contents at its root:

```powershell
Compress-Archive -Path ./web-prototype/dist/pages/* -DestinationPath ./web-prototype/dist/semidata-pages.zip -Force
```

Upload the ZIP, check that `index.html`, `_headers`, `pkg/`, `sqlite/` and
`vendor/` appear at the top level, then select **Save and Deploy**. Do not upload
the repository or `web-prototype/` directory.

Wrangler is also supported after its separate account login. For an explicitly
named preview deployment, run from the repository root:

```powershell
npx wrangler pages deploy web-prototype/dist/pages --project-name semidata --branch release-check
```

For production through Wrangler, use the project's configured production
branch in `--branch`; the current Git branch is otherwise used automatically.
Keep the stable production URL as the address testers bookmark. A unique
deployment URL or preview hostname has a separate browser library.

Cloudflare Direct Upload supports dashboard uploads and custom CI using
Wrangler. Switching this project to Cloudflare's built-in Git integration
requires a new Pages project. See the [Direct Upload guide](https://developers.cloudflare.com/pages/get-started/direct-upload/)
and [headers reference](https://developers.cloudflare.com/pages/configuration/headers/).

## Verify a release

1. Open the production URL in current Chrome or Edge. Confirm the library
   opens, with no module, WASM or storage errors.
2. Choose **Try example data**, import a scenario and open it in the viewer.
   Check a histogram, device table and wafer map where that scenario has data.
3. Reload at the same address/profile and confirm the imported example remains.
4. Save a workspace and restore it in an isolated browser profile. This also
   checks the transfer path that engineers need for backups.
5. Check `/release.json` against the intended commit, WASM responses use
   `application/wasm`, assets revalidate, and nonexistent paths return 404.

These are deployment smoke checks. They do not replace the
[method qualification and performance record](VIEWER-VALIDATION.md).

## First public evaluation

This release exposes the existing engineering evaluation build: the library,
viewer, engineering studies, reversible source editing and reports. Small
examples let visitors try it without their own STDF. Scope and known gaps are
recorded in the [tools guide](TOOLS.md) and
[manual coverage matrix](../../docs/dlog-coverage.md); hosting does not expand
the qualified analysis scope or establish large-file analysis performance.

Browser storage belongs to the exact scheme, hostname, port and browser profile.
The localhost library does not automatically appear on `semidata.pages.dev`.
Export a `.sdworkspace` or `.sdlibrary` package at the old address and restore
it at the new address. The same applies when moving to a custom domain.
Clearing site data, removing a profile or browser storage eviction can remove
the local library; persistence requests are not backups. Keep exported copies
of important work. Deployment rollback restores application assets, not local
databases, and must be checked for compatibility with stored schema versions.

## Published release verification — 2026-09-25

The first production deployment at [semidata.pages.dev](https://semidata.pages.dev/)
serves revision [`3f703a9`](https://github.com/aj9696/STDF-Viewer/commit/3f703a9860df76faff5762daf83a6b40949f70fe),
with `sourceDirty: false`: 104 packaged files, 3,752,867 bytes before ZIP compression.
The public root, library, viewer, parser WASM, SQLite WASM, library module and
attribution file matched their packaged SHA-256 values. Both WASM responses used
`application/wasm`; application assets returned `Cache-Control: no-cache` and
a nonexistent route returned HTTP 404.

An isolated Chrome profile passed example import (48 devices), two-file
comparison (96 devices), chart rendering, workspace download, and persistence
after a full browser restart. A fresh profile restored the workspace with the
same source hashes and device totals. The run observed no JavaScript errors,
failed requests or off-origin application requests. This is a small-fixture
deployment check, not a large-file performance qualification.

## UI refinement production release — 2026-10-18

The Library/viewer refinement is implemented and locally qualified in Chrome and
Edge; see the dated [validation record](VIEWER-VALIDATION.md). The static Pages
packager passes with 104 files and a clean source revision. Its generated
`dist/pages/release.json` identifies the exact packaged commit; the upload ZIP
is `dist/semidata-pages.zip`. Both are ignored build artifacts and contain app
assets plus the existing synthetic examples, not an engineer's browser library.

After the user restored the Cloudflare session, production deployment
`bda111ab-334d-437e-ba0d-ba62dedc9fd2` succeeded at 20:03 America/Chicago on
2026-10-18. The stable [public app](https://semidata.pages.dev/) serves revision
[`69d4e51`](https://github.com/aj9696/STDF-Viewer/commit/69d4e51042a8447f29a9f296381476f2e716f923)
with `sourceDirty: false`. The uploaded package contains 104 files and
3,779,080 bytes before ZIP compression. ZIP SHA-256:
`95df4879927eb0800a917399c163b283dd60b3cfdf432d81f659fc67c3372ed9`.

Independent Chrome and Edge smoke checks passed against the stable public
origin. All 102 public manifest assets matched their packaged SHA-256 and byte
length; `release.json` separately matched the prepared manifest. `_headers` is
deployment configuration, not a public asset. Its `Cache-Control: no-cache` and
`X-Content-Type-Options: nosniff` effects were verified, along with both WASM MIME
types and a missing route returning HTTP 404.

Both browser runs imported the 48-device clean example, compared two sources
with 96 devices, found all 15 tools in five groups, and exercised the new
Workspace controls and Escape focus restoration. Downloaded workspaces retained
the exact source hashes and comparison state after a full browser restart,
restore into a fresh profile through Library, and a subsequent page reload.
There were no JavaScript errors, failed application requests or off-origin
application requests during these checks.

Local evidence is in `results/release-smoke-chrome-1792371862187/` and
`results/release-smoke-msedge-1792371890402/`, each containing `results.json`,
`comparison.png`, `restored.png` and the test workspace. Cloudflare confirmation
is saved as `results/ui-refinement-deployment-success.jpg`. These checks use
synthetic data in disposable profiles; they do not establish new large-file
performance or inspect an engineer's private library. Existing local libraries
remain tied to their original origin/profile. Documentation commits after
`69d4e51` record this release and do not imply another asset deployment.

## Taste visual release — 2026-10-18

Cloudflare production deployment `765efdcb-224c-4f57-8bb4-fb512de7ef97` published
the visual update to [SemiData](https://semidata.pages.dev/). The stable origin
was verified at 20:59 America/Chicago, serving source revision
[`7fecc60`](https://github.com/aj9696/STDF-Viewer/commit/7fecc60bdf1db2fca29c109cbb397373be574d49)
with `sourceDirty: false`.

The prepared directory contains 113 files and 4,089,973 bytes. After running
`package:pages`, `Compress-Archive` rebuilt `dist/semidata-pages.zip`; its 113
entries were compared byte-for-byte with `dist/pages` before upload. ZIP size:
1,515,365 bytes. SHA-256:
`c593f358cd26e250d6bcdf387ae39c3389625e7b877056b5d10f4d303eb87e3f`.
The dashboard confirmed 113/113 files uploaded and deployment success.

Separate Chrome and Edge checks against the public origin verified all 111 public
manifest assets by hash/size and `release.json` separately. `_headers` is consumed
as deployment configuration. WOFF2, SVG and WASM MIME types, cache/no-sniff headers
and missing-route 404 behavior pass. All five bundled IBM Plex faces load from
this origin; computed Library and Viewer typography uses the intended families.
No application request goes to a third-party font service.

Both browsers passed the 48-device import, 96-device site comparison, all 15 tool
entries, workspace download, full browser restart, fresh-profile restoration and
reload persistence. Original source hashes match. No JavaScript errors or failed
application requests were recorded. Desktop/mobile screenshots were inspected.

Evidence: `results/release-smoke-chrome-1792375150298/` and
`results/release-smoke-msedge-1792375150299/`. Cloudflare confirmation is saved in
`results/taste-deployment-success.jpg`. These use synthetic data in disposable
profiles. Existing user font preferences are retained; the release does not
migrate or upload an engineer's local library. Documentation-only commits after
`7fecc60` record this deployment without changing its asset revision.
