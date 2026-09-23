#!/usr/bin/env python3
"""M9.0 host-side controller: runs the fixed worker as a supervised child process.

    python controller.py run <scratch-root> [case-id ...]
    python controller.py evaluate <scratch-root>

The controller owns what the future Rust supervisor will own: the typed request
built from a case, the fixed argv, an allow-listed environment, one child at a
time, cancellation and a wall-clock budget, resource observation, and the
publication decision. A result is published only when the child exited 0, wrote
a ``completed`` outcome, and its result parses and names this run; otherwise the
staging directory is kept as failed scratch and nothing is published.

Limits actually enforced here: wall-clock timeout, termination of the owned
child through its process handle, and a minimal environment. Not enforced:
memory, CPU, filesystem or network confinement -- the worker is a fixed,
reviewed adapter, not untrusted code, and this is not a sandbox. Standard
library only.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import protocol  # noqa: E402

RUNTIME = Path(os.environ.get("M90_RUNTIME", HERE.parents[1] / ".tmp/m90-evidence/runtime/cpython-3.13.15-embed"))
UPSTREAM = HERE.parents[1] / ".tmp/m90-evidence/data/openms-regression"
DEFAULT_TIMEOUT_S = 600.0
LOG_KEEP = 64 * 1024


class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
        (n, ctypes.c_size_t) for n in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                                       "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                                       "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]


def process_usage(handle: int) -> dict:
    pmc = PROCESS_MEMORY_COUNTERS()
    pmc.cb = ctypes.sizeof(pmc)
    ok = ctypes.WinDLL("psapi").GetProcessMemoryInfo(wintypes.HANDLE(handle), ctypes.byref(pmc), pmc.cb)
    times = [wintypes.FILETIME() for _ in range(4)]
    ctypes.WinDLL("kernel32").GetProcessTimes(wintypes.HANDLE(handle), *[ctypes.byref(t) for t in times])
    cpu = sum(((t.dwHighDateTime << 32) | t.dwLowDateTime) / 1e7 for t in times[2:])
    return {"peak_working_set_bytes": pmc.PeakWorkingSetSize if ok else None,
            "peak_pagefile_bytes": pmc.PeakPagefileUsage if ok else None, "cpu_s": round(cpu, 3)}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounded(path: Path) -> dict:
    data = path.read_bytes() if path.exists() else b""
    kept = data if len(data) <= 2 * LOG_KEEP else data[:LOG_KEEP] + b"\n...[truncated]...\n" + data[-LOG_KEEP:]
    path.write_bytes(kept)
    return {"bytes": len(data), "kept_bytes": len(kept), "sha256": hashlib.sha256(data).hexdigest()}


def worker_env(run_dir: Path) -> dict:
    home, tmp = run_dir / "home", run_dir / "tmp"
    home.mkdir(exist_ok=True)
    tmp.mkdir(exist_ok=True)
    system_root = os.environ.get("SYSTEMROOT", r"C:\Windows")
    return {"SYSTEMROOT": system_root, "WINDIR": system_root, "TEMP": str(tmp), "TMP": str(tmp),
            "OPENMS_HOME_PATH": str(home), "OMP_NUM_THREADS": "1",
            "PATH": os.pathsep.join([str(RUNTIME), str(Path(system_root, "System32"))])}


def publish(staging: Path, run_dir: Path, run_id: str, exit_code: int) -> tuple[bool, str]:
    """Publish only a complete, parseable result of this run; never a partial one."""
    outcome_path = staging / "outcome.json"
    if exit_code != 0:
        return False, f"exit code {exit_code}"
    if not outcome_path.exists():
        return False, "no outcome record"
    try:
        outcome = json.loads(outcome_path.read_text(encoding="utf-8"))
        result = json.loads((staging / "result.json").read_text(encoding="utf-8"))
        evidence = (staging / "evidence.jsonl").read_text(encoding="utf-8").splitlines()
        [json.loads(line) for line in evidence]
    except (OSError, ValueError) as exc:
        return False, f"result does not validate: {type(exc).__name__}"
    if outcome.get("status") != "completed":
        return False, f"outcome is {outcome.get('status')}"
    if result.get("run_id") != run_id or result.get("schema") != "mscanvas.m9_0.targeted_ms1.result/0":
        return False, "result names another run or schema"
    pending = run_dir / "published.tmp"
    shutil.rmtree(pending, ignore_errors=True)
    pending.mkdir()
    manifest = {}
    for name in ("result.json", "evidence.jsonl"):
        shutil.copy2(staging / name, pending / name)
        manifest[name] = {"bytes": (pending / name).stat().st_size, "sha256": sha256(pending / name)}
    (pending / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8", newline="\n")
    os.replace(pending, run_dir / "published")  # one rename makes the whole set visible
    return True, "published"


def run_case(case: dict, root: Path) -> dict:
    run_dir = root / "runs" / case["id"]
    if run_dir.exists():
        shutil.rmtree(run_dir)
    staging = run_dir / "staging"
    staging.mkdir(parents=True)
    if case["fixture"] == "upstream":
        source = UPSTREAM / "FeatureFinderMetaboIdent_1_input.mzML"
        targets = protocol.upstream_targets((UPSTREAM / "FeatureFinderMetaboIdent_1_input.tsv").read_text(
            encoding="utf-8"), case["upstream_half_s"])
    else:
        source = root / "fixtures" / f"{case['fixture']}.mzML"
        targets = protocol.request_targets(case["targets"])
    request = protocol.apply_mutation(protocol.build_request(case, source, targets), case.get("mutate", {}))
    request_path = run_dir / "request.json"
    request_path.write_text(json.dumps(request, indent=1) + "\n", encoding="utf-8", newline="\n")
    argv = [str(RUNTIME / "python.exe"), "-X", "utf8", "-I", str(HERE / "worker_pyopenms.py"),
            str(request_path), str(staging)]
    env = worker_env(run_dir)
    control = case.get("control", {})
    timeout_s = control.get("timeout_s", DEFAULT_TIMEOUT_S)
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    with open(staging / "stdout.log", "wb") as out, open(staging / "stderr.log", "wb") as err:
        proc = subprocess.Popen(argv, cwd=run_dir, env=env, stdout=out, stderr=err, stdin=subprocess.DEVNULL,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        cancel = {}
        while proc.poll() is None:
            elapsed = time.perf_counter() - t0
            phase = control.get("cancel_on_phase")
            if phase and "due_at_s" not in cancel and (staging / "events.jsonl").exists():
                # A line being written may be incomplete; a substring test tolerates that.
                if f'"phase": "{phase}"' in (staging / "events.jsonl").read_text(encoding="utf-8"):
                    cancel["phase_seen_at_s"] = round(elapsed, 3)
                    cancel["due_at_s"] = elapsed + control.get("cancel_delay_s", 0.0)
            reason = None
            if "due_at_s" in cancel and elapsed >= cancel["due_at_s"] and "requested_at_s" not in cancel:
                reason = "cancelled"
            elif elapsed >= timeout_s and "requested_at_s" not in cancel:
                reason = "timeout"
            if reason:
                cancel.update(reason=reason, requested_at_s=round(elapsed, 3))
                if proc.poll() is None:  # never terminate a process that has already exited
                    proc.terminate()  # TerminateProcess on this child's own handle
                    cancel["terminate_called_at_s"] = round(time.perf_counter() - t0, 3)
            time.sleep(0.02)
        exit_code = proc.wait()
        wall = time.perf_counter() - t0
        usage = process_usage(int(proc._handle))  # noqa: SLF001 -- the handle is the owned child's
    if cancel:
        cancel["exit_observed_at_s"] = round(wall, 3)
    published, why = publish(staging, run_dir, request["run_id"], exit_code)
    outcome = {}
    if (staging / "outcome.json").exists():
        outcome = json.loads((staging / "outcome.json").read_text(encoding="utf-8"))
    if published:
        status = "completed"
    elif cancel.get("terminate_called_at_s") is not None:
        status = cancel["reason"]
    elif exit_code == 3 and outcome.get("status") == "refused":
        status = "refused"
    else:
        status = "failed"
    code = outcome.get("code") if outcome else ("TERMINATED" if cancel else "WORKER_CRASHED")
    attempt = {
        "case": case["id"], "run_id": request["run_id"], "status": status, "code": code,
        "message": outcome.get("message"), "publication": why, "exit_code": exit_code,
        "argv": argv, "env": env, "started_utc": started.isoformat(), "wall_s": round(wall, 3),
        "control": cancel, **usage,
        "logs": {"stdout": bounded(staging / "stdout.log"), "stderr": bounded(staging / "stderr.log")},
        "staging_files": sorted(p.name for p in staging.iterdir()),
        "published_bytes": sum(p.stat().st_size for p in (run_dir / "published").iterdir()) if published else 0,
        "protocol_sha256": sha256(HERE / "protocol.py"), "worker_sha256": sha256(HERE / "worker_pyopenms.py"),
    }
    (run_dir / "attempt.json").write_text(json.dumps(attempt, indent=1) + "\n", encoding="utf-8", newline="\n")
    return attempt


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[1] == "run":
        root = Path(argv[2]).resolve()
        wanted = argv[3:]
        home_marker = Path.home() / ".OpenMS"
        before = home_marker.exists()
        for case in protocol.CASES:
            if wanted and case["id"] not in wanted:
                continue
            a = run_case(case, root)
            print(f"{a['case']:22} {a['status']:9} {str(a['code']):36} exit={a['exit_code']:<3} "
                  f"wall={a['wall_s']:7.2f}s peak_ws={(a['peak_working_set_bytes'] or 0) / 2**20:7.1f}MiB")
        print(f"~/.OpenMS existed before={before} after={home_marker.exists()}")
        return 0
    if len(argv) == 3 and argv[1] == "evaluate":
        root = Path(argv[2]).resolve()
        return protocol.main(["protocol.py", "evaluate", str(root / "runs"), str(root / "fixtures"),
                              str(UPSTREAM / "FeatureFinderMetaboIdent_1_output.featureXML")])
    print(__doc__.split("\n\n")[1])
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
