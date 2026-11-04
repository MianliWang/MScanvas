"""Hashed revision of PX.3's harness.py for candidate C' (ADR 0071, X2).

The frozen harness.py hard-codes B's executable and its build folder, and writes
into its own archive. This revision runs the same 73 rows of the same ledger on
one given build and writes elsewhere. compare(), peak() and js() are harness.py's
own, and canonical() is oracle.py's, imported unchanged after their digests are
checked. Nothing in the archive is written, bytecode included: run with python -B.

  harness_x2.py identity --exe EXE --repo REPO --out BUILD
  harness_x2.py run --px3 PX3 --build BUILD --out EVIDENCE
"""
import argparse
import ctypes
import hashlib
import importlib
import json
import os
import pathlib
import platform
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

sys.dont_write_bytecode = True

FROZEN_HARNESS_SHA256 = "ae03b603b045337e4c12d30ef610e79633b943d53b1d4ef63bf4c35df3027eb2"
FROZEN_ORACLE_SHA256 = "61743961ad7462e136163bb198d15590027ede50bd04c1bbd143409ade4b635f"
WATCHDOG_SECONDS = 300
HERE = pathlib.Path(__file__).resolve().parent


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def load_frozen(px3):
    """The frozen comparator, from the archive, byte-identical or not at all."""
    assert sha(px3 / "harness.py") == FROZEN_HARNESS_SHA256, "harness.py changed"
    assert sha(px3 / "oracle.py") == FROZEN_ORACLE_SHA256, "oracle.py changed"
    sys.path.insert(0, str(px3))
    return importlib.import_module("harness"), importlib.import_module("oracle")


def runner_hashes():
    return {path.name: sha(path) for path in sorted(HERE.glob("*.py"))}


class MemoryStatus(ctypes.Structure):
    _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
        (name, ctypes.c_ulonglong)
        for name in (
            "ullTotalPhys",
            "ullAvailPhys",
            "ullTotalPageFile",
            "ullAvailPageFile",
            "ullTotalVirtual",
            "ullAvailVirtual",
            "ullAvailExtendedVirtual",
        )
    ]


def memory_now():
    status = MemoryStatus()
    status.dwLength = ctypes.sizeof(status)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
    return dict(
        load_percent=status.dwMemoryLoad,
        available_bytes=status.ullAvailPhys,
        total_bytes=status.ullTotalPhys,
    )


def emergency_stop():
    """A run cut short here is not a result: it is rerun whole in a new folder."""
    now = memory_now()
    if now["available_bytes"] < 4 * 1024**3 or now["load_percent"] >= 90:
        raise SystemExit(f"memory emergency stop: {now}")


def host():
    return dict(
        platform=platform.platform(),
        processor=platform.processor(),
        python=sys.version,
        logical_cpus=os.cpu_count(),
        memory=memory_now(),
    )


def identity(args):
    """Binds a build to its source by content, so a later docs commit does not unbind it."""
    repo = args.repo.resolve()
    sources = [repo / "Cargo.toml", repo / "Cargo.lock", repo / "crates/proteowizard/Cargo.toml"]
    sources += sorted((repo / "crates/proteowizard/src").rglob("*.rs"))
    sources += [repo / "crates/proteowizard/examples/xic_candidate.rs"]
    lines = "".join(f"{sha(path)}  {path.relative_to(repo).as_posix()}\n" for path in sources)
    git = lambda *argv: subprocess.run(
        ["git", "-C", str(repo), *argv], capture_output=True, text=True, check=True
    ).stdout.strip()
    tool = lambda *argv: subprocess.run(argv, capture_output=True, text=True, check=True).stdout.strip()
    args.out.mkdir(parents=True, exist_ok=False)
    shutil.copy2(args.exe, args.out / "xic_candidate.exe")
    (args.out / "source-manifest.txt").write_text(lines, encoding="utf-8", newline="\n")
    dump(
        args.out / "identity.json",
        dict(
            binary_sha256=sha(args.out / "xic_candidate.exe"),
            source_manifest_sha256=hashlib.sha256(lines.encode()).hexdigest(),
            built_at_commit=git("rev-parse", "HEAD"),
            uncommitted_source=git("status", "--porcelain", "--", "Cargo.toml", "Cargo.lock", "crates/proteowizard"),
            profile="release",
            command="cargo build -p mscanvas-proteowizard --release --example xic_candidate --locked",
            rustc=tool("rustc", "-vV"),
            cargo=tool("cargo", "-V"),
            created_utc=datetime.now(timezone.utc).isoformat(),
        ),
    )
    print(json.dumps(dict(binary_sha256=sha(args.out / "xic_candidate.exe"))))


def load_build(build):
    identity_record = json.loads((build / "identity.json").read_text(encoding="utf-8"))
    exe = build / "xic_candidate.exe"
    assert sha(exe) == identity_record["binary_sha256"], "the build changed"
    return exe, identity_record


def invoke(harness, exe, path, query, capture, mode, folder):
    """One candidate process, as the frozen runners time and measure it."""
    argv = [str(exe), str(path), *query, str(capture), mode]
    started = time.perf_counter()
    timed_out = False
    observed = []
    with (folder / "stdout.json").open("wb") as stdout, (folder / "stderr.txt").open("wb") as stderr:
        process = subprocess.Popen(argv, stdout=stdout, stderr=stderr, cwd=folder)
        while True:
            memory = harness.peak(process)
            if memory is not None:
                observed.append(memory)
            try:
                code = process.wait(timeout=0.02)
                break
            except subprocess.TimeoutExpired:
                if time.perf_counter() - started > WATCHDOG_SECONDS:
                    timed_out = True
                    process.kill()
                    code = process.wait(timeout=30)
                    break
        final_peak = harness.peak(process)
    elapsed = time.perf_counter() - started
    return dict(
        argv=argv,
        exit_code=code,
        timed_out=timed_out,
        wall_seconds=elapsed,
        pid=process.pid,
        peak_working_set_final_bytes=final_peak,
        last_observed_os_high_water_bytes=max(observed) if observed else None,
        stdout_bytes=(folder / "stdout.json").stat().st_size,
        snapshot_bytes=capture.stat().st_size if capture.exists() else None,
    )


def run(args):
    harness, oracle = load_frozen(args.px3)
    R = args.px3
    exe, build = load_build(args.build)
    freeze = json.loads((R / "protocol/FROZEN.json").read_text(encoding="utf-8"))
    for name, digest in freeze["files"].items():
        assert sha(R / name) == digest, (name, "protocol changed")
    ledger = json.loads((R / "protocol/case-ledger.json").read_text())
    answers = json.loads((R / "protocol/oracle-answers.json").read_text())
    # File-specific later acquisitions have separately frozen answers and operand binding.
    assert sha(R / "protocol/acquisitions.json") == freeze["acquisition_reference_sha256"]
    entries = json.loads((R / "protocol/acquisitions.json").read_text())
    for row in ledger:
        if row["id"] in entries:
            row.update(entries[row["id"]]["ledger"])
            answers[row["id"]] = entries[row["id"]]["answer"]
    del entries
    out = args.out
    out.mkdir(parents=True, exist_ok=False)
    results = []
    invocations = []
    for row in ledger:
        path = R / "inputs" / row["file"] if row.get("file") else None
        if answers.get(row["id"], {}).get("status") == "ReferenceUnavailable":
            results.append(dict(id=row["id"], status="MISSING", reason="independent_reference_unavailable", named_case=row["named_case"], subjects=row["subjects"]))
            continue
        if row.get("availability") or path is None or not path.exists() or row["id"] not in answers:
            results.append(dict(id=row["id"], status="MISSING", reason=row.get("availability", "source_or_reference_missing"), named_case=row["named_case"], subjects=row["subjects"]))
            continue
        source_sha = sha(path)
        if source_sha != row["sha256"]:
            results.append(dict(id=row["id"], status="MISSING", reason="source_identity_mismatch", named_case=row["named_case"], subjects=row["subjects"]))
            continue
        science = []
        runs = []
        for repeat in range(row["repeats"]):
            emergency_stop()
            run_id = row["id"] + "-" + str(repeat + 1)
            folder = out / run_id
            folder.mkdir()
            capture = folder / "snapshot.mzML"
            binding = dict(
                run_id=run_id,
                source_sha256=source_sha,
                build=build,
                protocol_sha256=sha(R / "protocol/PROTOCOL.md"),
                oracle_sha256=sha(R / "oracle.py"),
                ledger_sha256=sha(R / "protocol/case-ledger.json"),
                freeze_sha256=sha(R / "protocol/FROZEN.json"),
                runners=runner_hashes(),
                query=row["query"],
                mode=row["mode"],
                created_utc=datetime.now(timezone.utc).isoformat(),
            )
            diagnostics = invoke(harness, exe, path, row["query"], capture, row["mode"], folder)
            diagnostics["host"] = host()
            errors = []
            try:
                if diagnostics["exit_code"] != 0:
                    raise ValueError("candidate_exit_" + str(diagnostics["exit_code"]))
                actual = json.loads((folder / "stdout.json").read_text(encoding="utf-8"))
                if not isinstance(actual, dict):
                    raise ValueError("candidate_not_object")
                errors = harness.compare(answers[row["id"]], actual, row["expectation"])
                canonical = harness.js(oracle.canonical(actual))
                (folder / "science.json").write_bytes(canonical)
                science.append(hashlib.sha256(canonical).hexdigest())
                if row["expectation"] == "must_disagree":
                    errors = [] if errors and actual.get("status") == "Evaluated" else ["fault did not produce a scored scientific disagreement"]
                del actual, canonical
            except Exception as error:
                errors = [type(error).__name__ + ":" + str(error)]
            if not capture.exists() or sha(capture) != source_sha:
                errors.append("same immutable snapshot capture mismatch or absent")
            if diagnostics["timed_out"]:
                errors.append("operational timeout; not numerical failure")
            status = "PASS" if not errors else "FAIL"
            record = dict(binding=binding, diagnostics=diagnostics, status=status, errors=errors[:50], error_count=len(errors))
            dump(folder / "result.json", record)
            invocations.append(record)
            runs.append(status)
        repeat_ok = len(science) == row["repeats"] and len(set(science)) == 1
        if row["repeats"] == 1:
            repeat_ok = True
        results.append(
            dict(
                id=row["id"],
                status="PASS" if all(x == "PASS" for x in runs) and repeat_ok else "FAIL",
                repeat_agreement=repeat_ok,
                named_case=row["named_case"],
                subjects=row["subjects"],
                invocations=len(runs),
                expected_scans=len(answers[row["id"]].get("source_metadata", answers[row["id"]].get("rows", []))),
            )
        )
    summary = dict(
        revision="harness_x2",
        identity=build,
        rows=results,
        counts=dict(
            ledger_rows=len(ledger),
            named_cases=sum(bool(r["named_case"]) for r in ledger),
            files=len({r["file"] for r in ledger if r.get("file")}),
            invocations=len(invocations),
            passed=sum(r["status"] == "PASS" for r in results),
            failed=sum(r["status"] == "FAIL" for r in results),
            missing=sum(r["status"] == "MISSING" for r in results),
            expected_available_scans=sum(r.get("expected_scans", 0) for r in results),
        ),
    )
    dump(out / "SUMMARY.json", summary)
    print(json.dumps(summary["counts"]))
    print(json.dumps([r for r in results if r["status"] != "PASS"]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("identity")
    make.add_argument("--exe", type=pathlib.Path, required=True)
    make.add_argument("--repo", type=pathlib.Path, required=True)
    make.add_argument("--out", type=pathlib.Path, required=True)
    make.set_defaults(handler=identity)
    score = commands.add_parser("run")
    score.add_argument("--px3", type=pathlib.Path, required=True)
    score.add_argument("--build", type=pathlib.Path, required=True)
    score.add_argument("--out", type=pathlib.Path, required=True)
    score.set_defaults(handler=run)
    arguments = parser.parse_args()
    arguments.handler(arguments)
