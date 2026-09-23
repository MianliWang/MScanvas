#!/usr/bin/env python3
"""The controller's publication rule against staging directories that contain output files.

    python test_controller_publish.py

No engine, no process and no timing: each case hand-builds a staging directory
in a temporary folder and asks ``controller.publish`` whether it may publish.
Only the last case, whole and consistent, may.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import controller  # noqa: E402

RESULT = {"schema": "mscanvas.m9_0.targeted_ms1.result/0", "run_id": "run-a", "targets": []}
EVIDENCE = '{"target_id": "t", "trace": 0, "points": []}\n'


def staging(root: Path, *, outcome="completed", result=RESULT, evidence=EVIDENCE) -> Path:
    s = root / "staging"
    s.mkdir(parents=True)
    if outcome is not None:
        (s / "outcome.json").write_text(json.dumps({"status": outcome}), encoding="utf-8")
    (s / "result.json").write_text(json.dumps(result), encoding="utf-8")
    (s / "evidence.jsonl").write_text(evidence, encoding="utf-8")
    return s


class PublicationRule(unittest.TestCase):
    def check(self, exit_code: int, **kw) -> tuple[bool, str, bool]:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            published, why = controller.publish(staging(root, **kw), root, "run-a", exit_code)
            return published, why, (root / "published").exists()

    def test_files_present_but_nonzero_exit(self):
        self.assertEqual(self.check(4)[::2], (False, False))

    def test_zero_exit_without_outcome(self):
        self.assertEqual(self.check(0, outcome=None)[::2], (False, False))

    def test_zero_exit_with_truncated_evidence(self):
        self.assertEqual(self.check(0, evidence='{"target_id": "t", "tra')[::2], (False, False))

    def test_completed_outcome_naming_another_run(self):
        self.assertEqual(self.check(0, result=dict(RESULT, run_id="run-b"))[::2], (False, False))

    def test_outcome_not_completed(self):
        self.assertEqual(self.check(0, outcome="failed")[::2], (False, False))

    def test_whole_result_is_published(self):
        self.assertEqual(self.check(0)[::2], (True, True))


if __name__ == "__main__":
    unittest.main(verbosity=2)
