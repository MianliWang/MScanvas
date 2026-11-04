#!/usr/bin/env python3
"""What the X2 record and ADR 0072 say, against their own tables and the retained runs.

    python -B experiments/xic_x2/tests/test_record.py
    MSCANVAS_X2_EVIDENCE=D:/MSCanvas-X2-20261104 python -B experiments/xic_x2/tests/test_record.py

The retained runs are local, so without the variable those cases are reported as
skipped. Run by hand, like the runners: nothing in CI reads this. It sits in its own
folder because the runners record the digest of every `*.py` beside them. The manifest
and compiler-pin cases mean something only until this PR merges: a later change to those
files fails them and owes nothing.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import statistics
import subprocess
import unittest

REPO = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = os.environ.get("MSCANVAS_X2_EVIDENCE")
ALTERNATING = [f"final-5/alternating/{name}" for name in ("1-final-4-build", "2-final-5-build", "3-final-4-build", "4-final-5-build")]


def prose(path: str) -> str:
    return " ".join((REPO / path).read_text(encoding="utf-8").split())


X2_TEXT = (REPO / "docs/spikes/XIC_X2_CANDIDATE_EVIDENCE.md").read_text(encoding="utf-8")
X2 = prose("docs/spikes/XIC_X2_CANDIDATE_EVIDENCE.md")
ADR = prose("docs/architecture/adr/0072-xic-candidate-decision-x3.md")


def runner_table() -> dict[str, str]:
    return dict(re.findall(r"\| `experiments/xic_x2/(\w+\.py)` \| `([0-9a-f]{64})` \|", X2_TEXT))


def timings(row: str) -> list[list[float]]:
    line = next(line for line in X2_TEXT.splitlines() if line.startswith(f"| {row} |"))
    return [[float(value) for value in cell.split(" / ")] for cell in line.strip(" |").split("|")[-3:]]


class Record(unittest.TestCase):
    def test_a_rerun_records_the_tables_runner_digests(self) -> None:
        # As harness_x2.runner_hashes() reads them: every *.py beside the runners.
        beside = (REPO / "experiments/xic_x2").glob("*.py")
        self.assertEqual({path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in beside}, runner_table())

    def test_the_record_names_this_trees_source_manifest(self) -> None:
        # As harness_x2.identity() lists it. Until this PR merges, a merge that changes one of these files owes a rerun.
        paths = [REPO / "Cargo.toml", REPO / "Cargo.lock", REPO / "crates/proteowizard/Cargo.toml"]
        paths += sorted((REPO / "crates/proteowizard/src").rglob("*.rs"))
        paths += [REPO / "crates/proteowizard/examples/xic_candidate.rs"]
        lines = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(REPO).as_posix()}\n" for path in paths)
        self.assertIn(f"`{hashlib.sha256(lines.encode()).hexdigest()}`", X2_TEXT)

    def test_the_compiler_pin_the_manifest_leaves_out_is_the_records(self) -> None:
        # A new compiler owes a rerun too, until this PR merges, and the manifest case cannot see it.
        rustc = re.search(r"rustc (\S+)", X2_TEXT).group(1)
        self.assertIn(f'channel = "{rustc}"', (REPO / "rust-toolchain.toml").read_text(encoding="utf-8"))

    def test_a_named_commit_this_branch_does_not_hold_is_said_to_be_unpushed(self) -> None:
        # A reader of the PR has the branch, not this machine's reflog.
        for text in (X2, ADR):
            for sentence in re.split(r"(?<=\.) ", text):
                for commit in re.findall(r"`([0-9a-f]{8})`", sentence):
                    held = subprocess.run(["git", "merge-base", "--is-ancestor", commit, "HEAD"], cwd=REPO, capture_output=True)
                    self.assertTrue(held.returncode == 0 or "never pushed" in sentence, sentence)

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
            (X2, "Baseline: `origin/main` at", "Started from `origin/main` at `9f98504e`"),
            (X2, "They were built from", "The four mutations were built from `abc6b443`"),
            (X2, "Each runner checks them again", "No runner hashes the two archives again"),
        ):
            self.assertNotIn(gone, text)
            self.assertIn(present, text)
        self.assertIn("compare the manifest and `science.json`", X2)
        self.assertIn("one helper's body", X2)
        self.assertIn("its source was not kept", X2)
        self.assertIn("draws its own time axis", ADR)

    def test_the_notes_this_pr_owed_leave_accepted_text_alone(self) -> None:
        row = "| XIC: a per-scan sum of stored intensities inside an m/z window | The X0 scope record (N-13) | Not written. X-1 and X-2 decided its scope; this ADR does not restate it |"
        self.assertIn(row, (REPO / "docs/architecture/adr/0070-computation-over-decoded-arrays.md").read_text(encoding="utf-8"))
        self.assertIn("the second row speaks of 2026-10-30", prose("docs/architecture/adr/0070-computation-over-decoded-arrays.md"))
        self.assertIn("X2 has run", prose("docs/architecture/adr/0071-xic-re-entry-and-its-first-version.md"))
        self.assertIn("Status: **Proposed (2026-11-04).**", ADR)


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
            self.assertTrue(failed)
            self.assertEqual(sum(code == 3 for code in failed), count, mutation)
            self.assertTrue(all(code in (0, 3) for code in failed))

    def test_read_back_counts_and_digests(self) -> None:
        table = runner_table()
        self.assertEqual(len(table), 5)
        records = [self.records(f"final-5/{folder}") for folder in ("main", "supplement", "integer-scored")]
        self.assertEqual([len(group) for group in records], [143, 10, 34])
        for group in records:
            for record in group:
                self.assertEqual(record.get("runners") or record["binding"]["runners"], table)
        for folder in ("final-3/observations", "final-3/observations-2", "final-5/observations", *ALTERNATING):
            summary = json.loads(pathlib.Path(EVIDENCE, folder, "OBSERVATIONS.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["runners"], table)

    def test_the_scored_build_is_the_records_and_its_science_is_the_previous_runs(self) -> None:
        identity = json.loads(pathlib.Path(EVIDENCE, "final-5/build/identity.json").read_text(encoding="utf-8"))
        self.assertIn(f"`{identity['binary_sha256']}`", X2_TEXT)
        self.assertIn(f"`{identity['source_manifest_sha256']}`", X2_TEXT)
        self.assertIn(f"the scored build is at `{identity['built_at_commit'][:8]}`", X2)
        self.assertIn(identity["rustc"].splitlines()[0], X2_TEXT)
        scored = [path for folder in ("main", "supplement", "integer-scored") for path in pathlib.Path(EVIDENCE, "final-5", folder).glob("*/science.json")]
        self.assertEqual(len(scored), 187)
        for path in scored:
            earlier = pathlib.Path(EVIDENCE, "final-4", *path.parts[-3:])
            self.assertEqual(path.read_bytes(), earlier.read_bytes(), path)

    def test_the_comparison_is_what_the_record_says(self) -> None:
        result = json.loads(pathlib.Path(EVIDENCE, "final-5/COMPARISON-TO-FINAL-4.json").read_text(encoding="utf-8"))
        self.assertEqual(len(result["manifest_lines_differing"]), 7)
        self.assertTrue(all(line.startswith("crates/proteowizard/src/") for line in result["manifest_lines_differing"]))
        self.assertEqual(result["science_differ"] + result["science_missing"] + result["science_only_in_final_5"], [])
        self.assertTrue(result["text_section_differs"])
        for build in ("final_4", "final_5"):
            self.assertIn(f"{result['sections']['.text'][build]['virtual_size']:,}", X2)
            self.assertIn(f"{result['executable_bytes'][build]:,}", X2)

    def test_the_sets_on_the_scored_build_are_the_tables(self) -> None:
        scored = json.loads(pathlib.Path(EVIDENCE, "final-5/build/identity.json").read_text(encoding="utf-8"))["binary_sha256"]
        peaks = []
        for folder in ("final-5/observations", *ALTERNATING):
            summary = json.loads(pathlib.Path(EVIDENCE, folder, "OBSERVATIONS.json").read_text(encoding="utf-8"))
            build = summary["identity"]["binary_sha256"]
            self.assertEqual(build == scored, "final-4" not in folder, folder)
            line = next(line for line in X2_TEXT.splitlines() if line.startswith(f"| `{folder.removeprefix('final-5/')}` |"))
            self.assertIn(f"`{build[:8]}…`", line)
            seconds = {}
            for observation in summary["observations"]:
                seconds.setdefault(observation["source"]["name"], []).append(observation["result"]["pass_wall_seconds"])
                if build == scored and observation["source"]["name"].startswith("r0"):
                    peaks.append(observation["peak_working_set_final_bytes"])
            for values in seconds.values():
                self.assertIn(" / ".join(f"{value:.3f}" for value in values), line)
            if build == scored:
                self.assertIn(f"{statistics.mean(seconds['r0_narrow']):.3f} against {statistics.mean(seconds['r0_whole']):.3f} s", X2)
        self.assertIn(f"{min(peaks):,} to {max(peaks):,} bytes", X2)

    def test_earlier_builds_are_at_the_commits_named(self) -> None:
        for folder in ("superseded-1", "superseded-2", "superseded-3"):
            identity = json.loads(pathlib.Path(EVIDENCE, folder, "build/identity.json").read_text(encoding="utf-8"))
            self.assertIn(f"`{identity['binary_sha256'][:8]}…` is at `{identity['built_at_commit'][:8]}`", X2)

    def test_unsampled_sets_are_all_listed(self) -> None:
        for folder, build in (("superseded-1", "02690522"), ("superseded-2", "541880b9"), ("superseded-3", "73266bea")):
            summary = json.loads(pathlib.Path(EVIDENCE, folder, "observations/OBSERVATIONS.json").read_text(encoding="utf-8"))
            seconds = [o["result"]["pass_wall_seconds"] for o in summary["observations"] if o["source"]["name"].startswith("r0")]
            self.assertIn(f"{min(seconds):.3f}–{max(seconds):.3f} s on `{build}…`", X2)


if __name__ == "__main__":
    unittest.main()
