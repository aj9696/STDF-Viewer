import math
import unittest
from unittest.mock import Mock, patch

from semidata.pat import csv_text, fit_limits, preview, public_result


class PatTests(unittest.TestCase):
    def test_sigma_hand_computable_reference(self):
        center, spread, lower, upper = fit_limits([-1, 1] * 15, "sigma", 3)
        self.assertEqual(center, 0)
        self.assertAlmostEqual(spread, math.sqrt(30 / 29))
        self.assertAlmostEqual(lower, -3 * spread)
        self.assertAlmostEqual(upper, 3 * spread)

    def test_screen_keeps_equal_limits_and_excludes_ineligible_measurements(self):
        _, _, lower, upper = fit_limits([-1, 1] * 15, "sigma", 3)
        def point(value, eligible=True):
            return {"value": value, "eligible": eligible, "dataset_id": "eval",
                    "dataset": "evaluation", "part_id": str(value), "dut_index": 1,
                    "site": 1, "head": 1, "wafer": 1, "x": 0, "y": 0}
        reference = [point(v) for v in [-1, 1] * 15]
        evaluation = [point(lower), point(upper), point(lower - 0.01),
                      point(upper + 0.01), point(100, eligible=False)]
        library = Mock()
        library.dataset.side_effect = lambda i: {"id": i}
        payload = {"selection": {"dataset_ids": ["eval"], "test_key": '[1,"VDD","V"]'},
                   "reference_ids": ["ref"], "method": "sigma", "k": 3}
        with patch("semidata.pat.measurements", side_effect=[(evaluation, []), (reference, [])]):
            result = preview(library, payload)
        self.assertEqual(result["flagged_count"], 2)
        self.assertEqual(result["evaluated_count"], 4)
        self.assertEqual(result["excluded_count"], 1)
        self.assertEqual([r["value"] for r in result["flagged"]], [lower - 0.01, upper + 0.01])

    def test_robust_mad_is_not_distorted_by_one_extreme_value(self):
        center, spread, _, upper = fit_limits([-1, 0, 1] * 10 + [1000], "mad", 3)
        self.assertEqual(center, 0)
        self.assertAlmostEqual(spread, 1.4826)
        self.assertLess(upper, 5)

    def test_invalid_or_insufficient_population(self):
        for values, method, k in [([1] * 30, "sigma", 3), ([1, 2], "sigma", 3),
                                 (list(range(30)), "sigma", float("nan")),
                                 (list(range(30)), "mad", True),
                                 (list(range(30)), "sigma", 10**1000),
                                 (list(range(30)), "invalid", 3)]:
            with self.assertRaises(ValueError):
                fit_limits(values, method, k)

    def test_csv_keeps_numeric_negatives_and_neutralizes_text_formulas(self):
        result = {"id": "run1", "recipe": {"method": "mad", "k": 3},
                  "lower": -3, "upper": 3, "unit": "V", "flagged": [
                      {"dataset": "=CMD()", "part_id": "@bad", "value": -4}]}
        exported = csv_text(result)
        self.assertIn("'=CMD()", exported)
        self.assertIn("'@bad", exported)
        self.assertIn(",-4", exported)

    def test_preview_limit_does_not_mutate_full_evidence(self):
        evidence = {"flagged": [{}] * 1001}
        response = public_result(evidence)
        self.assertEqual(len(response["flagged"]), 1000)
        self.assertEqual(len(evidence["flagged"]), 1001)
        self.assertTrue(response["flagged_truncated"])
