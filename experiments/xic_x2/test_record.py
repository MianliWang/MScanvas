#!/usr/bin/env python3
"""What the X2 record and ADR 0072 say, against their own tables and the retained runs.

    python -B experiments/xic_x2/test_record.py
    MSCANVAS_X2_EVIDENCE=D:/MSCanvas-X2-20261104 python -B experiments/xic_x2/test_record.py

The retained runs are local, so without the variable those cases are reported as
skipped. Run by hand, like the runners here: nothing in CI reads this.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import statistics
import unittest

REPO = pathlib.Path(__file__).resolve().parents[2]
EVIDENCE = os.environ.get("MSCANVAS_X2_EVIDENCE")


def prose(path: str) -> str:
    return " ".join((REPO / path).read_text(encoding="utf-8").split())


X2_TEXT = (REPO / "docs/spikes/XIC_X2_CANDIDATE_EVIDENCE.md").read_text(encoding="utf-8")
X2 = prose("docs/spikes/XIC_X2_CANDIDATE_EVIDENCE.md")
ADR = prose("docs/architecture/adr/0072-xic-candidate-decision-x3.md")


def timings(row: str) -> list[list[float]]:
    line = next(line for line in X2_TEXT.splitlines() if line.startswith(f"| {row} |"))
    return [[float(value) for value in cell.split(" / ")] for cell in line.strip(" |").split("|")[-3:]]


class Record(unittest.TestCase):
    def test_window_width_is_stated_set_by_set_from_the_table(self) -> None:
        narrow = timings("R0 profile file, narrow window")
        whole = timings("R0 profile file, whole scan range")
        for low, high in zip(narrow[:2], whole[:2]):
            a, b = statistics.mean(low), statistics.mean(high)
            self.assertLess(abs(a - b), max(max(low) - min(low), max(high) - min(high)))
            self.assertIn(f"{a:.3f} against {b:.3f} s", X2)
        self.assertIn(f"{statistics.mean(narrow[2]):.2f} and {statistics.mean(whole[2]):.2f} s", X2)
        self.assertNotIn("cost no more than", X2)

    def test_positions_are_said_to_be_the_examples(self) -> None:
        self.assertIn("the positions the comparator reads are the example's", X2)
        self.assertIn("**Which points the engine chose.**", X2)
        self.assertIn("exit 3 from the example's cross-check", X2)

    def test_question_5_keeps_the_owners_judgment_a_judgment(self) -> None:
        question = ADR[ADR.index("5. **The integer readings.**") :]
        self.assertNotIn("has been seen", question)
        self.assertIn("a judgment and not a measurement", question)

    def test_iso_row_rests_on_decision_8_not_on_the_answer(self) -> None:
        self.assertNotIn("the rerun that answer asks for", X2)
        self.assertIn("as ADR 0071 decision 8 requires", X2)

    def test_smaller_corrections(self) -> None:
        for text, gone, present in (
            (ADR, "It adds a read of the whole file", "at least one more read of the whole file"),
            (X2, "which adds a read of the whole file", "at least one more read of the whole file"),
            (X2, "all 189 run records", "the 187 per-invocation records"),
            (ADR, "nothing calls the library", "no product code calls the library"),
        ):
            self.assertNotIn(gone, text)
            self.assertIn(present, text)
        self.assertIn("compare the manifest and `science.json`", X2)
        self.assertIn("one helper's body", X2)
        self.assertIn("its source was not kept", X2)
        self.assertIn("draws its own time axis", ADR)


@unittest.skipUnless(EVIDENCE, "MSCANVAS_X2_EVIDENCE is not set")
class RetainedRuns(unittest.TestCase):
    def records(self, folder: str) -> list[dict]:
        paths = sorted(pathlib.Path(EVIDENCE, folder).glob("*/result.json"))
        return [json.loads(path.read_text(encoding="utf-8")) for path in paths]

    def test_only_the_open_bound_fails_before_the_comparator(self) -> None:
        for mutation, count in (("m1_open_lower_bound", 43 + 14), ("m2_no_rounding", 0), ("m3_rt_units_unread", 0), ("m4_no_integer_size_rule", 0)):
            failed = [
                record["diagnostics"]["exit_code"]
                for folder in ("main", "integer-scored")
                for record in self.records(f"discrimination/{mutation}/{folder}")
                if record["status"] != "PASS"
            ]
            self.assertTrue(failed or mutation == "m4_no_integer_size_rule")
            self.assertEqual(sum(code == 3 for code in failed), count, mutation)
            self.assertTrue(all(code in (0, 3) for code in failed))

    def test_read_back_counts_and_digests(self) -> None:
        table = dict(re.findall(r"\| `experiments/xic_x2/(\w+\.py)` \| `([0-9a-f]{64})` \|", X2_TEXT))
        self.assertEqual(len(table), 5)
        records = [self.records(f"final-3/{folder}") for folder in ("main", "supplement", "integer-scored")]
        self.assertEqual([len(group) for group in records], [143, 10, 34])
        for group in records:
            for record in group:
                self.assertEqual(record.get("runners") or record["binding"]["runners"], table)
        for folder in ("observations", "observations-2"):
            summary = json.loads(pathlib.Path(EVIDENCE, "final-3", folder, "OBSERVATIONS.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["runners"], table)

    def test_unsampled_sets_are_all_listed(self) -> None:
        for folder, build in (("superseded-1", "02690522"), ("superseded-2", "541880b9"), ("superseded-3", "73266bea")):
            summary = json.loads(pathlib.Path(EVIDENCE, folder, "observations/OBSERVATIONS.json").read_text(encoding="utf-8"))
            seconds = [o["result"]["pass_wall_seconds"] for o in summary["observations"] if o["source"]["name"].startswith("r0")]
            self.assertIn(f"{min(seconds):.3f}–{max(seconds):.3f} s on `{build}…`", X2)


if __name__ == "__main__":
    unittest.main()
