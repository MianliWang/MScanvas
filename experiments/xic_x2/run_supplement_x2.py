"""Hashed revision of PX.3's run-supplement.py for candidate C' (ADR 0071, X2).

The same four rows, the same frozen answers and the same comparison as the frozen
run-supplement.py, on the build harness_x2.py runs, writing outside the archive.

  run_supplement_x2.py --px3 PX3 --reps REPS --build BUILD --out EVIDENCE
"""
import argparse
import hashlib
import json
import pathlib
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import harness_x2 as x2


def main(args):
    harness, oracle = x2.load_frozen(args.px3)
    R = args.reps
    exe, build = x2.load_build(args.build)
    freeze = json.loads((R / "protocol/SUPPLEMENT-FROZEN.json").read_text())
    for name, digest in freeze["files"].items():
        x2.require(x2.sha(R / name) == digest, (name, "frozen binding changed"))
    x2.require(freeze["candidate_supplement_invocations_before_freeze"] == 0, "the supplement was run before its freeze")
    rows = json.loads((R / "protocol/supplement-ledger.json").read_text())
    answers = json.loads((R / "protocol/supplement-answers.json").read_text())
    out = args.out
    out.mkdir(parents=True, exist_ok=False)
    summary = []
    allruns = []
    for row in rows:
        path = R / "inputs" / row["file"]
        x2.require(x2.sha(path) == row["sha256"], (row["id"], "source identity changed"))
        sciences = []
        runs = []
        for repeat in range(row["repeats"]):
            x2.emergency_stop()
            run_id = row["id"] + "-" + str(repeat + 1)
            folder = out / run_id
            folder.mkdir()
            snapshot = folder / "snapshot.mzML"
            binding = dict(
                run_id=run_id,
                source_sha256=row["sha256"],
                candidate=build,
                original_protocol_sha256=x2.sha(R / "protocol/PROTOCOL.md"),
                original_ledger_sha256=x2.sha(R / "protocol/case-ledger.json"),
                oracle_sha256=x2.sha(R / "oracle.py"),
                supplement_freeze_sha256=x2.sha(R / "protocol/SUPPLEMENT-FROZEN.json"),
                supplement_answers_sha256=x2.sha(R / "protocol/supplement-answers.json"),
                runners=x2.runner_hashes(),
                query=row["query"],
                mode=row["mode"],
                created_utc=datetime.now(timezone.utc).isoformat(),
            )
            diagnostics = x2.invoke(harness, exe, path, row["query"], snapshot, row["mode"], folder)
            diagnostics["host"] = x2.host()
            scientific_errors = []
            operational_errors = []
            if diagnostics["timed_out"]:
                operational_errors.append("Operational watchdog termination; not numerical failure")
            if diagnostics["exit_code"] != 0:
                operational_errors.append("Candidate nonzero exit " + str(diagnostics["exit_code"]))
            try:
                actual = json.loads((folder / "stdout.json").read_text(encoding="utf-8"))
                if not isinstance(actual, dict):
                    raise ValueError("candidate_not_object")
                scientific_errors = harness.compare(answers[row["id"]], actual, row["expectation"])
                canonical = harness.js(oracle.canonical(actual))
                (folder / "science.json").write_bytes(canonical)
                sciences.append(hashlib.sha256(canonical).hexdigest())
                diagnostics["pass_wall_seconds"] = actual.get("pass_wall_seconds")
                del actual, canonical
            except Exception as error:
                operational_errors.append("Missing or malformed candidate result: " + type(error).__name__ + ":" + str(error))
            if not snapshot.exists() or x2.sha(snapshot) != row["sha256"]:
                operational_errors.append("Same snapshot identity absent or mismatched")
            if row["resource_observation"] and diagnostics["peak_working_set_final_bytes"] is None:
                operational_errors.append("Required OS peak working set unavailable")
            status = "OPERATIONAL_FAILURE" if operational_errors else "FAIL" if scientific_errors else "PASS"
            record = dict(binding=binding, diagnostics=diagnostics, status=status, scientific_errors=scientific_errors[:50], scientific_error_count=len(scientific_errors), operational_errors=operational_errors)
            x2.dump(folder / "result.json", record)
            allruns.append(record)
            runs.append(status)
            print(json.dumps(dict(run_id=run_id, status=status, wall_seconds=diagnostics["wall_seconds"], peak_working_set_final_bytes=diagnostics["peak_working_set_final_bytes"], scientific_errors=scientific_errors[:4], operational_errors=operational_errors)), flush=True)
        repeat_ok = len(sciences) == row["repeats"] and len(set(sciences)) == 1
        status = "MISSING" if "OPERATIONAL_FAILURE" in runs else "PASS" if all(s == "PASS" for s in runs) and repeat_ok else "FAIL"
        summary.append(dict(id=row["id"], status=status, repeat_agreement=repeat_ok, invocations=len(runs), source_sha256=row["sha256"], query=row["query"], expected_scans=len(answers[row["id"]].get("rows", [])), resource_observation=row["resource_observation"]))
    x2.dump(
        out / "SUMMARY.json",
        dict(
            revision="run_supplement_x2",
            identity=build,
            rows=summary,
            counts=dict(
                rows=len(rows),
                invocations=len(allruns),
                passed=sum(r["status"] == "PASS" for r in summary),
                failed=sum(r["status"] == "FAIL" for r in summary),
                missing=sum(r["status"] == "MISSING" for r in summary),
            ),
        ),
    )
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--px3", type=pathlib.Path, required=True)
    parser.add_argument("--reps", type=pathlib.Path, required=True)
    parser.add_argument("--build", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    main(parser.parse_args())
