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
