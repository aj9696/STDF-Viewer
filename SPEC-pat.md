# Specification: pat

## Objective
An engineer evaluates an explainable statistical screen, saves the experiment,
and exports its affected-device evidence without changing production test data.

## Contract and acceptance
- Two single-pass methods: mean ± k sample SD; median ± k × 1.4826 MAD.
- k must be finite and 0.5–10; minimum eligible reference population 30.
- Reference is a chosen dataset selection or the evaluated population itself.
- Fit and evaluate only valid test results on known passing DUTs with known
  passing test flags. Report excluded counts. Zero dispersion is an error.
- Boundary-equal values pass. Only values strictly outside limits are flagged.
- Persist exact recipe, source IDs/hashes, population policy, calculated bounds,
  engine version, summary, and affected-device rows. Preserve input data.
- CSV export is derived from the persisted run, not current UI state.
- Label results as engineering experiments; do not claim AEC-Q001 compliance,
  validated DPAT, production rebinning, or release authorization.

## Structure / verification
`semidata/pat.py`; `tests/test_pat.py`; depends on analysis/data-library.
Verify hand-computable screens, robust outliers, invalid k, insufficient n,
zero dispersion, boundary inclusion, and save/reload reproducibility.
