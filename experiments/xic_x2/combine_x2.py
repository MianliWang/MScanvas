"""The 77-row ledger of one build, from harness_x2.py and run_supplement_x2.py.

Refuses to combine two builds: the protocol forbids splicing them into one matrix.

  combine_x2.py --main EVIDENCE/main --supplement EVIDENCE/supplement --out EVIDENCE
"""
import argparse
import json
import pathlib
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import harness_x2 as x2


def main(args):
    x2.require(not (args.out / "COMBINED.json").exists(), "a combined ledger is already there")
    first = json.loads((args.main / "SUMMARY.json").read_text(encoding="utf-8"))
    second = json.loads((args.supplement / "SUMMARY.json").read_text(encoding="utf-8"))
    x2.require(first["identity"]["binary_sha256"] == second["identity"]["binary_sha256"], "two builds")
    x2.require(not first["identity"]["uncommitted_source"] and not first["identity"]["mutation"], "a mutation or a build from uncommitted source")
    filled = {row["id"]: row for row in second["rows"]}
    rows = []
    for row in first["rows"]:
        if row["id"] in filled:
            x2.require(row["status"] == "MISSING", row["id"])
            row = {**row, **filled.pop(row["id"])}
            row.pop("reason", None)
        rows.append(row)
    x2.require(not filled, sorted(filled))
    counts = dict(
        rows=len(rows),
        named_cases=sum(bool(row.get("named_case")) for row in rows),
        passed=sum(row["status"] == "PASS" for row in rows),
        failed=sum(row["status"] == "FAIL" for row in rows),
        missing=sum(row["status"] == "MISSING" for row in rows),
        invocations=sum(row.get("invocations", 0) for row in rows),
        repeat_groups=sum(row.get("invocations", 0) > 1 for row in rows),
        repeat_groups_agreeing=sum(row.get("invocations", 0) > 1 and row.get("repeat_agreement") is True for row in rows),
    )
    x2.dump(args.out / "COMBINED.json", dict(identity=first["identity"], runners=x2.runner_hashes(), counts=counts, rows=rows))
    table = ["| Ledger row | ADR named case | Subjects | Status | Runs |", "| --- | --- | --- | --- | --- |"]
    for row in rows:
        subjects = ",".join(str(s) for s in row["subjects"])
        table.append(f"| `{row['id']}` | {row.get('named_case') or 'supplemental / inherited'} | {subjects} | {row['status']} | {row.get('invocations', 0)} |")
    (args.out / "ledger-table.md").write_text("\n".join(table) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(counts))
    print(json.dumps([row for row in rows if row["status"] != "PASS"]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--main", type=pathlib.Path, required=True)
    parser.add_argument("--supplement", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    main(parser.parse_args())
