# Contributing to SemiData

Start with CAPABILITIES.md, the four SPEC-*.md files, docs/architecture.md, and
docs/methods.md. These describe the current release, its boundaries, and the
engineering semantics. Tasks and verification checkpoints live in tasks/.

## Development

Follow docs/installation.md and docs/runtime-build.md. Use Python 3.13 and the
local source-built Rust extension. After Rust changes, reinstall the extension;
editing .rs files does not replace an already loaded Python binary.

```
.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check semidata/static/app.js
node --check semidata/static/charts.js
node --check semidata/static/format.js
.venv\Scripts\python.exe -m compileall -q semidata
git diff --check
```

Run cargo tests and formatting checks when modifying Rust; use the compiler
environment described in runtime-build.md. Exercise the browser after UI/API
changes. CI builds the native extension and runs the workbench regressions.

## Standards

- Keep public behavior documented and functions focused. Add type hints to new
  module boundaries; use plain dictionaries only where the API contract defines
  their exact shape. No calculation copies in JavaScript.
- Use parameterized SQL and escape all imported text in the interface.
- Reject unsupported or ambiguous inputs clearly; never manufacture passing
  flags, units, limits, or successful parse results.
- Test results, populations, persistence, and failure paths rather than private
  helper implementation details. Known-answer numerical cases are essential.
- Include documentation and an acceptance test with behavior changes. Separate
  speculative roadmap work from implemented features.
- Do not commit production STDF, customer identifiers, workspace databases,
  credentials, virtual environments, compiler caches, or build outputs.

## Reporting an issue

Use the feedback template in docs/engineer-guide.md. State the version, selected
test/population, expected outcome, actual result, and reproducible steps. Prefer
a synthetic file and generator recipe. Do not post proprietary test data.

## Licensing and attribution

This fork retains the upstream GPL v3 license and credits Noon Chen. New
workbench code is distributed under that license. The workbench uses original
text/CSS/SVG interface elements, not the upstream noncommercial icon set.
The original viewer's icons retain their separate CC BY-NC 4.0 notice.
Review dependency and asset licenses before adding or redistributing them.
