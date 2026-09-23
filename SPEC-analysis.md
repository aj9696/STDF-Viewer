# Specification: analysis

## Objective
Compare a selected scalar parametric test across imported datasets and sites.

## Contract and acceptance
- Match tests by exact number, name, and stored unit; PTR only in 0.1.
- Return per-dataset mean, sample standard deviation, median, range, and Cpk
  only when limits are consistent, finite, and dispersion is nonzero.
- Never silently combine tests with different units.
- Population choices: all retained attempts or non-superseded attempts within
  each source. Neither implies cross-file final-device identity.
- Numeric population excludes nonfinite/unusable test results and reports counts.
- Include histogram and ordered measurement preview; cap browser output and label
  sampling. Statistics use the complete supported population.
- Resource guard: reject selections exceeding the documented measurement limit.

## Structure / verification
`semidata/analysis.py`; `tests/test_analysis.py`. Depend on data-library only.
Pure calculations use stdlib statistics/math with explicit sample SD (n−1).
Test known vectors, flag exclusions, mixed limits, missing tests, and populations.
