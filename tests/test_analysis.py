import math
import json
import unittest

from semidata.analysis import describe, histogram, is_eligible, is_valid, validate_selection


def row(value, **overrides):
    return {"value": value, "valid": True, "lsl": 0, "usl": 10,
            "test_flag": 0, "part_flag": 0, **overrides}


class AnalysisTests(unittest.TestCase):
    def test_sample_statistics_and_cpk(self):
        result = describe([row(v) for v in [2, 4, 6, 8]])
        self.assertEqual(result["mean"], 5)
        self.assertEqual(result["median"], 5)
        self.assertAlmostEqual(result["stdev"], math.sqrt(20 / 3))
        self.assertAlmostEqual(result["cpk"], 5 / (3 * math.sqrt(20 / 3)))

    def test_changed_limits_and_zero_variance_have_no_cpk(self):
        self.assertIsNone(describe([row(2), row(4, usl=20)])["cpk"])
        self.assertIsNone(describe([row(2), row(2)])["cpk"])

    def test_nonfinite_limits_are_json_null_without_losing_valid_statistics(self):
        result = describe([row(v, lsl=-math.inf) for v in [2, 4, 6]])
        self.assertEqual(result["mean"], 4)
        self.assertIsNone(result["lsl"])
        self.assertEqual(result["usl"], 10)
        self.assertIsNone(result["cpk"])
        json.dumps(result, allow_nan=False)

    def test_bad_measurements_excluded_but_known_fail_values_are_valid(self):
        for flag in [1, 2, 4, 8, 16, 32]:
            self.assertFalse(is_valid(1.0, flag, 0))
        for flag in [1, 2, 4]:
            self.assertFalse(is_valid(1.0, 0, flag))
        self.assertFalse(is_valid(float("nan"), 0, 0))
        self.assertFalse(is_valid(None, 0, 0))
        self.assertTrue(is_valid(1, 128, 0))
        self.assertFalse(is_eligible(row(1, test_flag=128)))
        self.assertFalse(is_eligible(row(1, test_flag=64)))
        for flag in [4, 8, 16]:
            self.assertFalse(is_eligible(row(1, part_flag=flag)))

    def test_histogram_accounts_for_every_point_including_maximum(self):
        hist = histogram([1, 2, 3, 4], 2)
        self.assertEqual([b["count"] for b in hist], [2, 2])
        self.assertEqual(histogram([3, 3])[0]["count"], 2)

    def test_selection_rejects_duplicate_datasets_and_invalid_sites(self):
        selection = {"dataset_ids": ["a"], "test_key": '[1,"VDD","V"]'}
        self.assertEqual(validate_selection(selection)["attempts"], "current")
        for change in [{"dataset_ids": ["a", "a"]}, {"site": True}, {"test_key": "bad"},
                       {"test_key": json.dumps([10**1000, "VDD", "V"])}]:
            with self.assertRaises(ValueError):
                validate_selection({**selection, **change})
