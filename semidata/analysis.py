"""Population selection and scalar PTR analysis, independent of HTTP and UI."""

from contextlib import closing
import json
import math
import sqlite3
import statistics

MAX_ROWS = 500_000
MAX_DATASETS = 20


def validate_ids(ids):
    if (not isinstance(ids, list) or not 1 <= len(ids) <= MAX_DATASETS
            or any(not isinstance(i, str) or not i for i in ids)):
        raise ValueError("Select between 1 and 20 datasets.")
    if len(set(ids)) != len(ids):
        raise ValueError("Dataset selection contains duplicate IDs.")
    return ids


def validate_selection(selection):
    if not isinstance(selection, dict):
        raise ValueError("A measurement selection is required.")
    ids = validate_ids(selection.get("dataset_ids"))
    try:
        key = json.loads(selection.get("test_key", ""))
    except (TypeError, json.JSONDecodeError):
        raise ValueError("Choose a scalar test from the test list.") from None
    if (not isinstance(key, list) or len(key) != 3 or type(key[0]) is not int
            or not 0 <= key[0] <= 0xFFFFFFFF
            or any(not isinstance(v, str) for v in key[1:])):
        raise ValueError("Invalid test identity.")
    site = selection.get("site")
    if site is not None and (type(site) is not int or not 0 <= site <= 255):
        raise ValueError("Site must be a number from 0 to 255 or all sites.")
    attempts = selection.get("attempts", "current")
    if attempts not in ("current", "all"):
        raise ValueError("Attempt policy must be current or all.")
    return {"dataset_ids": ids, "test_key": json.dumps(key, separators=(",", ":")),
            "site": site, "attempts": attempts}


def source_connection(library, dataset_id):
    path = library.database_path(dataset_id).resolve()
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.text_factory = lambda b: b.decode("utf-8", errors="replace")
    return connection


def list_tests(library, dataset_ids):
    tests, sites = {}, set()
    for dataset_id in validate_ids(dataset_ids):
        with closing(source_connection(library, dataset_id)) as connection:
            for row in connection.execute(
                    "SELECT TEST_NUM, TEST_NAME, COALESCE(Unit,'') FROM Test_Info WHERE recHeader=10"):
                key = json.dumps(list(row), separators=(",", ":"))
                item = tests.setdefault(key, {"key": key, "number": row[0],
                                             "name": row[1], "unit": row[2], "datasets": []})
                item["datasets"].append(dataset_id)
            sites.update(row[0] for row in connection.execute(
                "SELECT DISTINCT SITE_NUM FROM Dut_Info WHERE SITE_NUM IS NOT NULL"))
    return {"tests": sorted(tests.values(), key=lambda t: (t["number"], t["name"], t["unit"])),
            "sites": sorted(sites)}


def is_valid(value, test_flag, parm_flag):
    # Alarm, invalid/unreliable result, timeout, not executed, aborted;
    # plus parametric scale/drift/oscillation errors. Pass/fail is independent.
    return (value is not None and math.isfinite(value)
            and test_flag is not None and not test_flag & 0x3F
            and parm_flag is not None and not parm_flag & 0x07)


def is_eligible(row):
    return (row["valid"] and row["test_flag"] & 0xC0 == 0
            and row["part_flag"] is not None and row["part_flag"] & 0x1C == 0)


def measurements(library, selection):
    """Read a bounded population; identifiers are scoped by dataset + DUT index."""
    selection = validate_selection(selection)
    number, name, unit = json.loads(selection["test_key"])
    rows, warnings = [], []
    for dataset_id in selection["dataset_ids"]:
        dataset = library.dataset(dataset_id)
        with closing(source_connection(library, dataset_id)) as connection:
            if "PARM_FLAG" not in {r[1] for r in connection.execute("PRAGMA table_info(PTR_Data)")}:
                raise ValueError("This import predates parametric flag preservation. Use a new workspace and reimport it.")
            tests = connection.execute(
                "SELECT TEST_ID,LLimit,HLimit FROM Test_Info "
                "WHERE recHeader=10 AND TEST_NUM=? AND TEST_NAME=? AND COALESCE(Unit,'')=?",
                (number, name, unit)).fetchall()
            if not tests:
                warnings.append(f"{dataset['name']}: selected test is absent.")
            for test in tests:
                dynamic = connection.execute("SELECT 1 FROM Dynamic_Limits WHERE TEST_ID=? LIMIT 1",
                                             (test["TEST_ID"],)).fetchone() is not None
                if dynamic:
                    warnings.append(f"{dataset['name']}: dynamic limits present; Cpk is withheld.")
                sql = """SELECT p.DUTIndex dut_index,p.RESULT value,p.TEST_FLAG test_flag,
                    p.PARM_FLAG parm_flag,d.Flag part_flag,d.PartID part_id,d.SITE_NUM site,
                    d.HEAD_NUM head,d.WaferIndex wafer,d.XCOORD x,d.YCOORD y
                    FROM PTR_Data p JOIN Dut_Info d ON p.DUTIndex=d.DUTIndex
                    WHERE p.TEST_ID=?"""
                params = [test["TEST_ID"]]
                if selection["attempts"] == "current":
                    sql += " AND d.Supersede=0"
                if selection["site"] is not None:
                    sql += " AND d.SITE_NUM=?"
                    params.append(selection["site"])
                sql += " ORDER BY p.DUTIndex LIMIT ?"
                params.append(MAX_ROWS - len(rows) + 1)
                for item in connection.execute(sql, params):
                    row = dict(item)
                    row.update(dataset_id=dataset_id, dataset=dataset["name"], lot=dataset["lot"],
                               lsl=test["LLimit"] if not dynamic else None,
                               usl=test["HLimit"] if not dynamic else None)
                    row["valid"] = is_valid(row["value"], row["test_flag"], row["parm_flag"])
                    row["eligible"] = is_eligible(row)
                    rows.append(row)
                if len(rows) > MAX_ROWS:
                    raise ValueError("Selection exceeds 500,000 measurements. Select fewer datasets or one site.")
    return rows, list(dict.fromkeys(warnings))


def describe(rows):
    values = [r["value"] for r in rows if r["valid"]]
    result = dict.fromkeys(("mean", "median", "stdev", "min", "max", "lsl", "usl", "cpk"))
    result["count"] = len(values)
    if not values:
        return result
    mean = statistics.fmean(values)
    spread = statistics.stdev(values) if len(values) > 1 else None
    result.update(mean=mean, median=statistics.median(values), stdev=spread,
                  min=min(values), max=max(values))
    limits = {(r["lsl"], r["usl"]) for r in rows if r["valid"]}
    if len(limits) == 1:
        low, high = next(iter(limits))
        low = low if low is not None and math.isfinite(low) else None
        high = high if high is not None and math.isfinite(high) else None
        result.update(lsl=low, usl=high)
        if (spread and low is not None and high is not None
                and math.isfinite(low) and math.isfinite(high) and low < high):
            result["cpk"] = min(high - mean, mean - low) / (3 * spread)
    return result


def histogram(values, bins=24):
    if not values:
        return []
    low, high = min(values), max(values)
    if low == high:
        return [{"low": low, "high": high, "count": len(values)}]
    width = (high - low) / bins
    counts = [0] * bins
    for value in values:
        counts[min(bins - 1, int((value - low) / width))] += 1
    return [{"low": low + i * width, "high": low + (i + 1) * width, "count": count}
            for i, count in enumerate(counts)]


def analyze(library, selection):
    selection = validate_selection(selection)
    rows, warnings = measurements(library, selection)
    valid = [r for r in rows if r["valid"]]
    number, name, unit = json.loads(selection["test_key"])
    groups = []
    for dataset_id in selection["dataset_ids"]:
        dataset = library.dataset(dataset_id)
        group = [r for r in rows if r["dataset_id"] == dataset_id]
        groups.append({"dataset_id": dataset_id, "name": dataset["name"], "lot": dataset["lot"],
                       **describe(group)})
    if len({(r["lsl"], r["usl"]) for r in valid}) > 1:
        warnings.append("Limits differ across this population; combined Cpk is withheld.")
    if not valid:
        warnings.append("No usable scalar results match this population.")
    step = max(1, math.ceil(len(valid) / 800))
    points = [{"index": i + 1, "value": r["value"], "dataset_id": r["dataset_id"],
               "part_id": r["part_id"], "site": r["site"]} for i, r in enumerate(valid) if i % step == 0]
    warnings.append("Attempt identities are local to each file; no cross-file retest consolidation.")
    return {"test": {"number": number, "name": name, "unit": unit},
            "population": {"total": len(rows), "valid": len(valid), "excluded": len(rows) - len(valid)},
            "stats": describe(rows), "groups": groups, "histogram": histogram([r["value"] for r in valid]),
            "points": points, "points_total": len(valid), "points_sampled": step > 1, "warnings": warnings}
