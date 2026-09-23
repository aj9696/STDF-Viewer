# Specification: workbench

## Objective
Deliver a local application that a test engineer can run, evaluate, and report
issues against without editing code or installing a database server.

## Interface
Library → Explore → PAT Lab → Saved runs; a contextual guide provides the
evaluation script and limitations. Shared selection is visible on each analysis.
Show busy states, actionable errors, empty states, population counts, units,
and provenance. No external CDN/assets, telemetry, or cloud services.

## Runtime
Python 3.13, upstream Rust extension, stdlib loopback HTTP server, plain
HTML/CSS/JavaScript. The original PyQt viewer remains its own entry point.
`python -m semidata --workspace ./workspace --port 8765` opens the application.
`--no-browser` enables automated checks. A Windows script wraps launch; clean
environment setup is documented in the installation and native build guides.

## Security and boundaries
Bind 127.0.0.1 only. Validate Host, same-origin writes, JSON bodies, and a
per-process token. Restrict served paths to explicit static/doc allowlists.
Never interpolate imported strings into HTML. Serve no arbitrary local files.
This local server is not an authenticated multiuser deployment.

## Verification
Python unit/integration tests; Node syntax checks; actual browser walk-through
with STDF.io generated data; documented findings and limitations.

## Documentation standard
README is the entry point. Maintain installation, engineer guide, calculation
reference, architecture/decisions, API contract, contributing guide, changelog,
and release verification. Document current behavior separately from roadmap.
