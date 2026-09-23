#!/usr/bin/env python3
"""M9.1 entry probes: engine and filesystem facts M9.0 left unmeasured.

    python -B experiments/m9_1/probes.py

Run once, before the product code that relies on the answers, against the
runtime ``scripts/provision_targeted_ms1_runtime.py`` builds. Writes only under
``.tmp/m91-jobs/probes/`` and never into the runtime: every interpreter launch
carries ``-B``.

Four questions:

1. **Pin, hash and link.** With the source open for reading, sharing reads only
   and not following a reparse point, can the bytes be hashed through that same
   handle, a hard link be made to it from an ASCII directory, the link be shown
   to be the pinned object, and the engine read through the link -- with the
   source under a CJK directory name? What do a write open of the source and a
   removal of the link answer while the pin is held?
2. **An all-absent batch of several targets.** Which exception, of which Python
   type, with which text; and are the library and the extracted chromatograms
   still readable after it? Asked twice, to see whether the answer is stable.
3. **No valid fit.** Can a small fixture make every fit in a run invalid, so
   that the engine discards every feature after its target was marked found?
4. **A partner of a target at a spectrum edge.** Can a target be suppressed by,
   or share with, a target whose chromatogram meets the extractor's edge defect?

Each engine question is asked of the engine directly (``engine_probe.py``) and
of M9.0's final adapter, so the native observation and the adapter's typing are
both recorded. Standard library only.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import math
import os
import random
import shutil
import subprocess
import sys
from ctypes import wintypes
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "experiments" / "m9_0"))
import protocol  # noqa: E402

RUNTIME = ROOT / ".tmp" / "m91-runtime" / "cpython-3.13.15-embed"
OUT = ROOT / ".tmp" / "m91-jobs" / "probes"
M90_WORKER = ROOT / "experiments" / "m9_0" / "worker_pyopenms.py"
CAFFEINE = "C8H10N4O2"


# ------------------------------------------------------------------ fixtures


def gauss(rt: float, apex: float, height: float, sigma: float = 2.5) -> float:
    return height * math.exp(-((rt - apex) ** 2) / (2 * sigma**2))


def scans_of(rts: list[float], points_at) -> list[dict]:
    return [{"index": i, "id": f"scan={i + 1}", "ms_level": 1, "rt_s": rt, "polarity": "positive",
             "points": sorted(points_at(rt))} for i, rt in enumerate(rts)]


def grid(end_s: float, step: float = 0.5) -> list[float]:
    return [round(i * step, 4) for i in range(int(end_s / step) + 1)]


def matrix(rng: random.Random, rt: float, *, ceiling: bool = True) -> list[tuple[float, float]]:
    """Twenty matrix peaks well below the targets, and one above them all.

    The peak above keeps every target trace off the spectrum's last position,
    which is where the extractor's measured double count happens; a fixture
    that wants that defect leaves it out.
    """
    pts = [(rng.uniform(100.0, 180.0), rng.uniform(1.0e3, 1.0e5)) for _ in range(20)]
    if ceiling:
        pts.append((450.0 + rng.uniform(0.0, 1.0), rng.uniform(1.0e3, 1.0e4)))
    return pts


def component(mz0: float, rt: float, height: float, shape, m1_ratio: float = 0.1,
              m0_ppm: float = 0.5, m1_ppm: float = 0.5) -> list[tuple[float, float]]:
    out = []
    for trace, h, ppm in ((0, height, m0_ppm), (1, height * m1_ratio, m1_ppm)):
        value = shape(rt) * h
        if value >= 1.0:
            out.append((protocol.trace_mz(mz0, trace) * (1 + ppm * 1e-6), value))
    return out


def caffeine_mz() -> float:
    return protocol.ion_mz(protocol.neutral_mono_mass(CAFFEINE))


def target(tid: str, formula: str, rt: float, half: float, mass=None) -> dict:
    return {"target_id": tid, "formula": formula, "neutral_mass": mass, "charge": 1, "rt_s": rt,
            "rt_half_width_s": half}


def fixtures() -> dict[str, dict]:
    mz = caffeine_mz()
    out: dict[str, dict] = {}

    # The M9.0 format fixture: one clean caffeine peak at 60 s, interferents, matrix.
    out["plain"] = {"scans": protocol.build_spectra("format", seed=91),
                    "targets": [target("pos_control", CAFFEINE, 60.0, 20.0),
                                target("absent", "C8H9NO2", 60.0, 20.0)]}
    out["all_absent"] = {"scans": out["plain"]["scans"],
                         "targets": [target("absent", "C8H9NO2", 60.0, 20.0),
                                     target("adenine", "C5H5N5", 40.0, 10.0),
                                     target("tyrosine", "C9H11NO3", 80.0, 10.0)]}

    # 3a. The peak is still rising when the acquisition ends: a Gaussian fit to
    # a rising half peak centres after the last scan, outside the feature.
    rng = random.Random(911)
    out["nvf_cut_at_end"] = {
        "scans": scans_of(grid(100.0), lambda rt: matrix(rng, rt) + component(mz, rt, 1e6, lambda t: gauss(t, 103.0, 1.0))),
        "targets": [target("cut", CAFFEINE, 96.0, 8.0)]}
    # 3b. A plateau with steep sides: a Gaussian fitted to it stays high at the
    # feature's own boundaries.
    rng_b = random.Random(912)
    out["nvf_plateau"] = {
        "scans": scans_of(grid(120.0), lambda rt: matrix(rng_b, rt) + component(
            mz, rt, 1e6, lambda t: 1.0 if 50.0 <= t <= 70.0 else gauss(t, 50.0 if t < 50 else 70.0, 1.0, 0.4))),
        "targets": [target("plateau", CAFFEINE, 60.0, 25.0)]}
    # 3c. A peak whose area is below the model's minimum, among matrix peaks.
    rng_c = random.Random(913)
    out["nvf_tiny"] = {
        "scans": scans_of(grid(120.0), lambda rt: matrix(rng_c, rt) + component(mz, rt, 0.3, lambda t: gauss(t, 60.0, 1.0), m1_ratio=1.0)),
        "targets": [target("tiny", CAFFEINE, 60.0, 20.0)]}

    # 4. Two targets of one ion (isomers) over one peak. Before 64 s a matrix
    # peak sits above the ion, so no target trace is ever last; after 64 s it
    # does not, and the M+1 trace's observed peak lies just below its m/z, which
    # is the extractor's measured double-count condition. `early` sees only the
    # clean spectra; `late` sees the defective ones, and its expected time is
    # the closer to the apex, so it should win the overlap.
    rng_d = random.Random(914)

    def related(rt: float) -> list[tuple[float, float]]:
        pts = matrix(rng_d, rt, ceiling=rt <= 64.0)
        return pts + component(mz, rt, 1e6, lambda t: gauss(t, 60.0, 1.0), m1_ppm=-1.0)

    out["related_edge"] = {"scans": scans_of(grid(120.0), related),
                           "targets": [target("early", CAFFEINE, 54.0, 10.0),
                                       target("late", CAFFEINE, 65.0, 15.0)]}

    # Round two, after round one showed the engine annotates an overlap only
    # between features of equal (integer) intensity and removes any other loser
    # silently. 4b: both targets expect 60 s and see the same whole peak, so
    # their features are identical and one is shared; only `wide`'s window
    # reaches 82-88 s, where the ceiling peak is gone and an M+1-only blip just
    # below its trace m/z is the last peak -- the double-count condition.
    rng_e = random.Random(915)

    def shared(rt: float) -> list[tuple[float, float]]:
        pts = matrix(rng_e, rt, ceiling=rt <= 80.0) + component(mz, rt, 1e6, lambda t: gauss(t, 60.0, 1.0))
        if 82.0 <= rt <= 88.0:
            pts.append((protocol.trace_mz(mz, 1) * (1 - 1e-6), 500.0))
        return pts

    out["related_shared"] = {"scans": scans_of(grid(120.0), shared),
                             "targets": [target("narrow", CAFFEINE, 60.0, 20.0),
                                         target("wide", CAFFEINE, 60.0, 30.0)]}
    # 3d/3e. A clean peak whose RT window ends 2.0 or 2.5 s after the apex: the
    # feature's region is cut by the window, and a Gaussian fitted inside it is
    # still above half its height at the cut (status 4, right side out of
    # bounds) -- if the peak is picked at all.
    for label, end in (("nvf_window_cut_2_0", 62.0), ("nvf_window_cut_2_5", 62.5)):
        rng_f = random.Random(916)
        out[label] = {"scans": scans_of(grid(120.0), lambda rt, r=rng_f: matrix(r, rt) + component(
            mz, rt, 1e6, lambda t: gauss(t, 60.0, 1.0))),
                      "targets": [target("cut", CAFFEINE, (40.0 + end) / 2, (end - 40.0) / 2)]}
    # 3f. The tiny peak again, now written without the synthetic instrument's
    # one-count threshold: a fitted area near 0.6 is below the model minimum.
    rng_g = random.Random(917)

    def tiny(rt: float) -> list[tuple[float, float]]:
        v = gauss(rt, 60.0, 0.1)
        extra = [(protocol.trace_mz(mz, 0) * (1 + 0.5e-6), v), (protocol.trace_mz(mz, 1) * (1 + 0.5e-6), v * 0.1)]
        return matrix(rng_g, rt) + ([p for p in extra if p[1] > 1e-6])

    out["nvf_tiny_unthresholded"] = {"scans": scans_of(grid(120.0), tiny),
                                     "targets": [target("tiny", CAFFEINE, 60.0, 20.0)]}
    # 3g. The same cut peak beside one clean, validly fitting partner: whether
    # the cut feature survives should now depend on the other target.
    rng_h = random.Random(916)
    phe = protocol.ion_mz(protocol.neutral_mono_mass("C9H11NO2"))
    out["nvf_window_cut_with_partner"] = {
        "scans": scans_of(grid(120.0), lambda rt: matrix(rng_h, rt) + component(mz, rt, 1e6, lambda t: gauss(t, 60.0, 1.0))
                          + component(phe, rt, 5e5, lambda t: gauss(t, 100.0, 1.0))),
        "targets": [target("cut", CAFFEINE, 51.0, 11.0), target("partner", "C9H11NO2", 100.0, 15.0)]}
    return out


# ------------------------------------------------------------------ launches


def worker_env(run_dir: Path) -> dict:
    home, tmp = run_dir / "home", run_dir / "tmp"
    home.mkdir(parents=True, exist_ok=True)
    tmp.mkdir(parents=True, exist_ok=True)
    system_root = os.environ.get("SYSTEMROOT", r"C:\Windows")
    return {"SYSTEMROOT": system_root, "WINDIR": system_root, "TEMP": str(tmp), "TMP": str(tmp),
            "OPENMS_HOME_PATH": str(home), "OMP_NUM_THREADS": "1",
            "PATH": os.pathsep.join([str(RUNTIME), str(Path(system_root, "System32"))])}


def launch(script: Path, args: list[str], run_dir: Path) -> dict:
    argv = [str(RUNTIME / "python.exe"), "-I", "-B", "-X", "utf8", str(script), *args]
    done = subprocess.run(argv, cwd=run_dir, env=worker_env(run_dir), capture_output=True,
                          stdin=subprocess.DEVNULL, timeout=600)
    return {"exit": done.returncode, "stdout_tail": done.stdout.decode("utf-8", "replace")[-600:],
            "stderr_tail": done.stderr.decode("utf-8", "replace")[-600:]}


def engine(name: str, source: Path, targets: list[dict], suffix: str = "") -> dict:
    run_dir = OUT / "engine" / f"{name}{suffix}"
    shutil.rmtree(run_dir, ignore_errors=True)
    run_dir.mkdir(parents=True)
    request = {"source": str(source), "targets": targets,
               "parameters": {"mz_half_width_ppm": 5.0, "expected_peak_width_s": 6.0}}
    (run_dir / "request.json").write_text(json.dumps(request), encoding="utf-8", newline="\n")
    launched = launch(HERE / "engine_probe.py", [str(run_dir / "request.json"), str(run_dir)], run_dir)
    report = run_dir / "engine.json"
    return {"launch": launched, "engine": json.loads(report.read_text(encoding="utf-8")) if report.exists() else None}


def adapter(name: str, source: Path, targets: list[dict]) -> dict:
    run_dir = OUT / "adapter" / name
    shutil.rmtree(run_dir, ignore_errors=True)
    staging = run_dir / "staging"
    staging.mkdir(parents=True)
    data = source.read_bytes()
    request = {"schema": "mscanvas.m9_0.targeted_ms1.request/0", "run_id": name,
               "source": {"path": str(source), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()},
               "targets": targets, "parameters": {"mz_half_width_ppm": 5.0, "expected_peak_width_s": 6.0},
               "experiment": {}}
    (run_dir / "request.json").write_text(json.dumps(request), encoding="utf-8", newline="\n")
    launched = launch(M90_WORKER, [str(run_dir / "request.json"), str(staging)], run_dir)
    outcome = json.loads((staging / "outcome.json").read_text(encoding="utf-8"))
    rows = None
    if (staging / "result.json").exists():
        result = json.loads((staging / "result.json").read_text(encoding="utf-8"))
        rows = {r["target_id"]: {"outcome": r["outcome"], "relations": r["relations"],
                                 "candidates": None if r["candidates"] is None else len(r["candidates"]),
                                 "model_status": ((r["feature"] or {}).get("model") or {}).get("status"),
                                 "in_window": (r["signal"] or {}).get("in_window")}
                for r in result["targets"]}
    return {"exit": launched["exit"], "status": outcome["status"], "code": outcome["code"],
            "message": outcome["message"], "rows": rows}


# ------------------------------------------------------------------ pin, hash and link

GENERIC_READ, GENERIC_WRITE, FILE_READ_ATTRIBUTES = 0x80000000, 0x40000000, 0x80
SHARE_READ, SHARE_ALL = 0x1, 0x7
OPEN_EXISTING = 3
OPEN_REPARSE_POINT = 0x00200000
INVALID = wintypes.HANDLE(-1).value

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.CreateFileW.restype = wintypes.HANDLE
kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                 wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
kernel32.ReadFile.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
                              wintypes.LPVOID]
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CreateHardLinkW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPVOID]
kernel32.DeleteFileW.argtypes = [wintypes.LPCWSTR]
kernel32.MoveFileW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
kernel32.SetFilePointerEx.argtypes = [wintypes.HANDLE, ctypes.c_longlong, wintypes.LPVOID, wintypes.DWORD]
kernel32.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]


class FileIdInfo(ctypes.Structure):
    _fields_ = [("volume", ctypes.c_ulonglong), ("file_id", ctypes.c_ubyte * 16)]


def open_handle(path: Path, access: int, share: int, flags: int = 0):
    handle = kernel32.CreateFileW(str(path), access, share, None, OPEN_EXISTING, flags, None)
    if handle in (None, INVALID):
        return None, ctypes.get_last_error()
    return handle, 0


def identity(handle) -> tuple[int, str] | None:
    info = FileIdInfo()
    if not kernel32.GetFileInformationByHandleEx(handle, 0x12, ctypes.byref(info), ctypes.sizeof(info)):
        return None
    return info.volume, bytes(info.file_id).hex()


def hash_handle(handle) -> tuple[int, str]:
    digest, total = hashlib.sha256(), 0
    buffer = ctypes.create_string_buffer(1 << 16)
    read = wintypes.DWORD()
    while kernel32.ReadFile(handle, buffer, len(buffer), ctypes.byref(read), None) and read.value:
        digest.update(buffer.raw[: read.value])
        total += read.value
    return total, digest.hexdigest()


def pin_and_link(fixture: dict) -> dict:
    cjk = OUT / "数据 目录"
    shutil.rmtree(cjk, ignore_errors=True)
    cjk.mkdir(parents=True)
    source = cjk / "样品 plain.mzML"
    data = protocol.write_mzml(fixture["scans"])
    source.write_bytes(data)
    expected = (len(data), hashlib.sha256(data).hexdigest())
    link_dir = OUT / "link"
    shutil.rmtree(link_dir, ignore_errors=True)
    link_dir.mkdir(parents=True)
    link = link_dir / "source.mzML"
    record: dict = {"source_path_is_ascii": str(source).isascii(), "link_path_is_ascii": str(link).isascii()}
    pin, error = open_handle(source, GENERIC_READ, SHARE_READ, OPEN_REPARSE_POINT)
    record["pin_error"] = error
    if pin is None:
        return record
    try:
        pinned = identity(pin)
        record["hash_through_pin"] = hash_handle(pin)
        record["hash_matches_bytes_written"] = tuple(record["hash_through_pin"]) == expected
        record["create_link_ok"] = bool(kernel32.CreateHardLinkW(str(link), str(source), None))
        record["create_link_error"] = 0 if record["create_link_ok"] else ctypes.get_last_error()
        probe, error = open_handle(link, FILE_READ_ATTRIBUTES, SHARE_ALL, OPEN_REPARSE_POINT)
        record["link_open_error"] = error
        if probe is not None:
            record["link_is_pinned_object"] = identity(probe) == pinned and pinned is not None
            kernel32.CloseHandle(probe)
        writer, error = open_handle(source, GENERIC_WRITE, SHARE_ALL)
        record["write_open_of_source_while_pinned"] = "opened" if writer else f"refused {error}"
        if writer:
            kernel32.CloseHandle(writer)
        writer, error = open_handle(link, GENERIC_WRITE, SHARE_ALL)
        record["write_open_of_link_while_pinned"] = "opened" if writer else f"refused {error}"
        if writer:
            kernel32.CloseHandle(writer)
        record["engine_through_link"] = engine("through_link", link, fixture["targets"])
        record["adapter_through_link"] = adapter("through_link", link, fixture["targets"])
        moved = source.with_name(source.name + ".moved")
        renamed = bool(kernel32.MoveFileW(str(source), str(moved)))
        record["rename_source_while_pinned"] = "renamed" if renamed else f"refused {ctypes.get_last_error()}"
        if renamed:
            kernel32.MoveFileW(str(moved), str(source))
        deleted = bool(kernel32.DeleteFileW(str(link)))
        record["delete_link_while_pinned"] = "deleted" if deleted else f"refused {ctypes.get_last_error()}"
        deleted = bool(kernel32.DeleteFileW(str(source)))
        record["delete_source_name_while_pinned"] = "deleted" if deleted else f"refused {ctypes.get_last_error()}"
        # With a POSIX-semantics delete the name goes at once and the object
        # lives on while a handle is open; asked through the handle still held.
        record["pinned_bytes_after_name_delete"] = (
            kernel32.SetFilePointerEx(pin, ctypes.c_longlong(0), None, 0) and hash_handle(pin)) if deleted else None
    finally:
        kernel32.CloseHandle(pin)
    if link.exists():
        record["delete_link_after_release"] = "deleted" if kernel32.DeleteFileW(str(link)) else \
            f"refused {ctypes.get_last_error()}"
    record["source_name_exists_after_release"] = source.exists()
    if source.exists():
        after = source.read_bytes()
        record["source_intact"] = (len(after), hashlib.sha256(after).hexdigest()) == expected
    else:  # a probe file, deleted by the probe above; written again for the next question
        source.write_bytes(data)
    direct = engine("direct_cjk", source, fixture["targets"])
    record["direct_cjk_path_engine"] = {"report_written": direct["engine"] is not None,
                                        "stdout_tail": direct["launch"]["stdout_tail"][-300:],
                                        "stderr_tail": direct["launch"]["stderr_tail"][-300:]}
    return record


# ------------------------------------------------------------------ main


def main() -> int:
    if not (RUNTIME / "python.exe").exists():
        print("provision the runtime first", file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    fx = fixtures()
    files = {}
    (OUT / "fixtures").mkdir(exist_ok=True)
    for name, spec in fx.items():
        path = OUT / "fixtures" / f"{name}.mzML"
        path.write_bytes(protocol.write_mzml(spec["scans"]))
        files[name] = path
    report: dict = {"runtime": str(RUNTIME.relative_to(ROOT))}
    report["pin_and_link"] = pin_and_link(fx["plain"])
    report["plain"] = {"engine": engine("plain", files["plain"], fx["plain"]["targets"]),
                       "adapter": adapter("plain", files["plain"], fx["plain"]["targets"])}
    report["all_absent"] = {
        "engine_first": engine("all_absent", files["all_absent"], fx["all_absent"]["targets"], "-1"),
        "engine_second": engine("all_absent", files["all_absent"], fx["all_absent"]["targets"], "-2"),
        "adapter": adapter("all_absent", files["all_absent"], fx["all_absent"]["targets"])}
    for name in ("nvf_cut_at_end", "nvf_plateau", "nvf_tiny", "related_edge", "related_shared",
                 "nvf_window_cut_2_0", "nvf_window_cut_2_5", "nvf_tiny_unthresholded",
                 "nvf_window_cut_with_partner"):
        report[name] = {"engine": engine(name, files[name], fx[name]["targets"]),
                        "adapter": adapter(name, files[name], fx[name]["targets"])}
    text = json.dumps(report, indent=1, ensure_ascii=False, default=str) + "\n"
    (OUT / "probes.json").write_text(text, encoding="utf-8", newline="\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
