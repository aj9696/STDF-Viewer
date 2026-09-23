"""Reproducible, non-destructive statistical screening experiments."""

from contextlib import closing
import csv
from datetime import datetime, timezone
import io
import json
import math
import statistics
import uuid

from . import __version__
from .analysis import measurements, validate_ids, validate_selection

MIN_REFERENCE = 30


def fit_limits(values, method, k):
    if method not in ("sigma", "mad"):
        raise ValueError("Choose mean / sample SD or median / MAD.")
    if type(k) not in (int, float) or not 0.5 <= k <= 10 or not math.isfinite(k):
        raise ValueError("The multiplier must be between 0.5 and 10.")
    if len(values) < MIN_REFERENCE:
        raise ValueError("At least 30 valid, known-passing reference measurements are required.")
    if method == "sigma":
        center, spread = statistics.fmean(values), statistics.stdev(values)
    else:
        center = statistics.median(values)
        spread = 1.4826 * statistics.median([abs(value - center) for value in values])
    if not math.isfinite(spread) or spread <= 0:
        raise ValueError("Reference dispersion is zero. Choose another population or screening method.")
    return center, spread, center - k * spread, center + k * spread


def preview(library, payload):
    if not isinstance(payload, dict):
        raise ValueError("A PAT recipe is required.")
    selection = validate_selection(payload.get("selection"))
    reference_ids = payload.get("reference_ids", [])
    if not isinstance(reference_ids, list):
        raise ValueError("Reference datasets must be a list.")
    reference_ids = validate_ids(reference_ids or selection["dataset_ids"])
    method, k = payload.get("method", "sigma"), payload.get("k", 3)
    name = payload.get("name", "Untitled experiment")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120:
        raise ValueError("Experiment name must contain 1 to 120 characters.")
    evaluation, warnings = measurements(library, selection)
    if reference_ids == selection["dataset_ids"]:
        reference = evaluation
    else:
        reference, ref_warnings = measurements(library, {**selection, "dataset_ids": reference_ids})
        warnings.extend(ref_warnings)
    reference_values = [r["value"] for r in reference if r["eligible"]]
    center, spread, lower, upper = fit_limits(reference_values, method, k)
    eligible = [r for r in evaluation if r["eligible"]]
    if not eligible:
        raise ValueError("There are no valid, known-passing devices in the evaluation population.")
    flagged = []
    for row in eligible:
        if row["value"] < lower or row["value"] > upper:
            flagged.append({key: row[key] for key in ("dataset_id", "dataset", "part_id",
                           "dut_index", "site", "head", "wafer", "x", "y", "value")})
    sources = [library.dataset(i) for i in dict.fromkeys(selection["dataset_ids"] + reference_ids)]
    warnings.append("Engineering experiment only. No production bins or raw results are changed.")
    warnings.append("Single-pass population fit; no AEC qualification or iterative DPAT is implied.")
    warnings.append("Device identities are scoped to files; cross-file retests remain independent.")
    return {"name": name.strip(), "engine_version": __version__,
            "recipe": {"selection": selection, "reference_ids": reference_ids,
                       "method": method, "k": k, "minimum_reference": MIN_REFERENCE,
                       "eligibility": "finite-valid-PTR-and-known-pass-DUT-and-test-v1",
                       "limits_inclusive": True},
            "reference_count": len(reference_values),
            "reference_excluded": len(reference) - len(reference_values),
            "evaluated_count": len(eligible), "excluded_count": len(evaluation) - len(eligible),
            "flagged_count": len(flagged), "flagged_percent": 100 * len(flagged) / len(eligible),
            "center": center, "spread": spread, "lower": lower, "upper": upper,
            "unit": json.loads(selection["test_key"])[2], "flagged": flagged,
            "warnings": list(dict.fromkeys(warnings)), "sources": sources}


def public_result(result):
    return {**result, "flagged": result["flagged"][:1000],
            "flagged_truncated": len(result["flagged"]) > 1000}


class RunStore:
    def __init__(self, library):
        self.library = library
        with closing(library.connect()) as connection, connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS pat_runs (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, name TEXT NOT NULL,
                method TEXT NOT NULL, flagged_count INTEGER NOT NULL,
                evaluated_count INTEGER NOT NULL, result_json TEXT NOT NULL)""")

    def save(self, payload):
        result = preview(self.library, payload)
        result.update(id=uuid.uuid4().hex, created_at=datetime.now(timezone.utc).isoformat())
        encoded = json.dumps(result, allow_nan=False)
        with closing(self.library.connect()) as connection, connection:
            connection.execute("INSERT INTO pat_runs VALUES (?,?,?,?,?,?,?)", (
                result["id"], result["created_at"], result["name"], result["recipe"]["method"],
                result["flagged_count"], result["evaluated_count"], encoded))
        return result

    def list(self, limit=200):
        with closing(self.library.connect()) as connection:
            return [dict(row) for row in connection.execute(
                "SELECT id,created_at,name,method,flagged_count,evaluated_count "
                "FROM pat_runs ORDER BY created_at DESC LIMIT ?", (limit,))]

    def get(self, run_id):
        with closing(self.library.connect()) as connection:
            row = connection.execute("SELECT result_json FROM pat_runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError("Saved run was not found.")
        return json.loads(row[0])


def csv_text(result):
    output = io.StringIO(newline="")
    fields = ["run_id", "method", "k", "lower", "upper", "unit", "dataset_id", "dataset",
              "part_id", "dut_index", "site", "head", "wafer", "x", "y", "value"]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for row in result["flagged"]:
        record = {**row, "run_id": result["id"], "method": result["recipe"]["method"],
                  "k": result["recipe"]["k"], "lower": result["lower"],
                  "upper": result["upper"], "unit": result["unit"]}
        # Protect textual fields when a downloaded CSV is opened in Excel.
        for key, value in record.items():
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                record[key] = "'" + value
        writer.writerow(record)
    return output.getvalue()
