#!/usr/bin/env python3
"""M9.0 review-closure checks: focused measurements for the independent review's findings.

    python review_checks.py <scratch-root> <label>

Written after the review; changes no scored result of either round. Each check
answers one finding and writes into ``review-checks-<label>.json``. Run once with
the adapter as reviewed (label ``before``) and once after its corrections
(label ``after``).
"""

from __future__ import annotations

import ctypes
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
from ctypes import wintypes
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import controller  # noqa: E402
import protocol  # noqa: E402


def f32(x: float) -> float:
    return struct.unpack("<f", struct.pack("<f", x))[0]


def ulp_distance(a: float, b: float) -> int:
    ia, ib = (struct.unpack("<i", struct.pack("<f", v))[0] for v in (a, b))
    return abs(ia - ib)


def target(name: str, formula: str, rt: float, half: float) -> dict:
    return {"target_id": name, "formula": formula, "neutral_mass": None, "charge": 1, "rt_s": rt,
            "rt_half_width_s": half}


def scans_from(points_at) -> list[dict]:
    out = []
    for i in range(201):
        rt = round(i * 0.5, 4)
        out.append({"index": i, "id": f"scan={i + 1}", "ms_level": 1, "rt_s": rt, "polarity": "positive",
                    "points": sorted(points_at(rt))})
    return out


def run(root: Path, name: str, scans: list, targets: list[dict], data: bytes | None = None) -> dict:
    (root / "fixtures").mkdir(parents=True, exist_ok=True)
    src = root / "fixtures" / f"{name}.mzML"
    src.write_bytes(data if data is not None else protocol.write_mzml(scans))
    a = controller.run_case({"id": name, "fixture": name, "targets": [], "expect": {}}, root, src, targets)
    out = {"status": a["status"], "code": a["code"], "message": a["message"]}
    pub = root / "runs" / name / "published"
    if (pub / "result.json").exists():
        rows = json.loads((pub / "result.json").read_text(encoding="utf-8"))["targets"]
        out["rows"] = {r["target_id"]: {"outcome": r["outcome"], "relations": r["relations"],
                                        "candidates": None if r["candidates"] is None else len(r["candidates"]),
                                        "model": (r["feature"] or {}).get("model"),
                                        "source": (r["feature"] or {}).get("engine_intensity_source")} for r in rows}
        out["evidence"] = [json.loads(x) for x in (pub / "evidence.jsonl").read_text(encoding="utf-8").splitlines()]
    return out


def gauss(rt: float, apex: float, h: float) -> float:
    return h * math.exp(-((rt - apex) ** 2) / (2 * 2.5**2))


def extraction_edges(root: Path) -> dict:
    """Spectra whose last or first peak lies inside a window (reviewer finding 3)."""
    m0 = protocol.target_mz("pos_control")
    m1 = protocol.trace_mz(m0, 1)
    tgt = [target("edge", "C8H10N4O2", 50.0, 20.0)]

    def a(rt):  # every peak below the M+1 m/z; the spectrum's last peak is in the M+1 window
        v = float(round(gauss(rt, 50.0, 1e5)))
        return [(m0 * (1 + 1e-6), v), (m1 * (1 - 2e-6), float(round(v * 0.1)))] if v >= 1 else []

    def b(rt):  # the spectrum's first two peaks are in the M window, below its m/z
        v = float(round(gauss(rt, 50.0, 1e5)))
        return ([(m0 * (1 - 3e-6), 300.0), (m0 * (1 - 1e-6), v), (m0 * (1 + 2e-6), 200.0), (m1 * (1 + 1e-6), 50.0)]
                if v >= 1 else [])

    out = {}
    for name, fn, trace in (("edge_last_peak", a, 1), ("edge_first_peak", b, 0)):
        scans = scans_from(fn)
        got = run(root, name, scans, tgt)
        lo, hi = protocol.open_window(protocol.trace_mz(m0, trace), 10.0)
        ev = next((e for e in got.get("evidence", []) if e["trace"] == trace), None)
        tally = {"equal": 0, "last_peak_counted_twice": 0, "first_peak_omitted": 0, "other": 0}
        for p in ev["points"] if ev else []:
            s = scans[p[0]]
            inside = [f32(i) for m, i in s["points"] if lo < m < hi]
            exact = math.fsum(inside)
            if p[3] == exact or p[3] == f32(exact):
                tally["equal"] += 1
            elif s["points"] and lo < s["points"][-1][0] < hi and p[3] in (exact + inside[-1], f32(exact + inside[-1])):
                tally["last_peak_counted_twice"] += 1
            elif s["points"] and lo < s["points"][0][0] < hi and p[3] in (exact - inside[0], f32(exact - inside[0])):
                tally["first_peak_omitted"] += 1
            else:
                tally["other"] += 1
        out[name] = {"status": got["status"], "code": got["code"], "trace": trace, "points": tally,
                     "outcome": (got.get("rows") or {}).get("edge")}
    return out


def no_valid_fit(root: Path) -> dict:
    """Only candidates whose elution-model fit fails (reviewer finding 2)."""
    tiny, strong = protocol.target_mz("pos_control"), protocol.target_mz("absent")

    def pts(rt):
        out = []
        for mz, h in ((tiny, 0.1), (strong, 1e5)):
            for tr, f in ((0, 1.0), (1, 0.1)):
                v = gauss(rt, 50.0, h * f)
                if v >= 0.001:
                    out.append((protocol.trace_mz(mz, tr), v))
        return out

    scans = scans_from(pts)
    solo = run(root, "fit_tiny_only", scans, [target("tiny", "C8H10N4O2", 50.0, 20.0)])
    both = run(root, "fit_tiny_with_strong", scans, [target("tiny", "C8H10N4O2", 50.0, 20.0),
                                                     target("strong", "C8H9NO2", 50.0, 20.0)])
    for r in (solo, both):
        r.pop("evidence", None)
    return {"tiny_only": solo, "tiny_with_strong": both}


def faims(root: Path) -> dict:
    """Negative FAIMS compensation voltages on every scan (reviewer finding 12)."""
    data = (root.parent / "round2/fixtures/r2_plain.mzML").read_bytes().decode("utf-8")
    counter = iter(range(10**6))
    data = re.sub("<scan>", lambda _: '<scan><cvParam cvRef="MS" accession="MS:1001581" name="FAIMS compensation '
                  f'voltage" value="{-45 if next(counter) % 2 else -60}" unitCvRef="UO" unitAccession="UO:0000218" '
                  'unitName="volt"/>', data)
    got = run(root, "faims_negative_cv", [], [target("pc", "C8H10N4O2", 60.0, 20.0)], data.encode("utf-8"))
    got.pop("evidence", None)
    return got


def pinned_hardlink(root: Path) -> dict:
    """Pin a CJK-path source, link it from an ASCII directory, read the link with the worker (finding 1)."""
    src = root.parent / "relocation" / "数据 目录" / "样品 r2_plain.mzML"
    link_dir = root / "ascii-link"
    shutil.rmtree(link_dir, ignore_errors=True)
    link_dir.mkdir(parents=True)
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateFileW.restype = wintypes.HANDLE
    k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD,
                                wintypes.DWORD, wintypes.HANDLE]
    handle = k32.CreateFileW(str(src), 0x80000000, 0x1, None, 3, 0, None)  # GENERIC_READ, FILE_SHARE_READ only
    out = {"pin_opened": handle not in (None, wintypes.HANDLE(-1).value)}
    try:
        try:
            os.link(src, link_dir / "source.mzML")
            out["hard_link_while_pinned"] = "created"
        except OSError as exc:
            out["hard_link_while_pinned"] = f"refused: winerror {exc.winerror}"
            return out
        a = controller.run_case({"id": "pinned_link", "fixture": "x", "targets": [], "expect": {}}, root,
                                link_dir / "source.mzML", [target("pc", "C8H10N4O2", 60.0, 20.0)])
        out["worker_read_through_link"] = {"status": a["status"], "code": a["code"]}
        try:
            with open(src, "r+b"):
                out["write_open_of_source_while_pinned"] = "allowed"
        except OSError as exc:
            out["write_open_of_source_while_pinned"] = f"refused: winerror {exc.winerror}"
    finally:
        k32.CloseHandle(handle)
    os.unlink(link_dir / "source.mzML")
    out["source_still_present_after_link_removed"] = src.exists()
    return out


def decoy_isolation(root: Path) -> dict:
    decoy = root.parent / "decoy"
    code = ("import json, sys, pyopenms, numpy; print(json.dumps({'pyopenms': pyopenms.__file__, "
            "'numpy': numpy.__file__, 'path': sys.path, 'isolated': sys.flags.isolated}))")
    env = dict(os.environ, PYTHONPATH=str(decoy), PYTHONHOME=str(decoy), PYTHONUSERBASE=str(decoy))
    p = subprocess.run([str(controller.RUNTIME / "python.exe"), "-X", "utf8", "-I", "-c", code], cwd=decoy, env=env,
                       capture_output=True, text=True, encoding="utf-8")
    report = json.loads(p.stdout.strip().splitlines()[-1])
    report["decoys"] = sorted(x.name for x in decoy.iterdir())
    report["decoy_imported"] = any(str(decoy) in report[k] for k in ("pyopenms", "numpy"))
    return report


def round_one_precision(root: Path) -> dict:
    """Round one's chromatogram values against the binary32-intensity sum, in binary32 units."""
    fixtures = protocol.fixture_set()
    hist = {"0": 0, "1": 0, "more": 0}
    for case in protocol.CASES:
        pub = root.parent / "runs" / case["id"] / "published"
        if case["fixture"] not in fixtures or not (pub / "evidence.jsonl").exists():
            continue
        fx = fixtures[case["fixture"]]
        for line in (pub / "evidence.jsonl").read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            t = protocol.TARGETS[e["target_id"]]
            lo, hi = protocol.open_window(protocol.trace_mz(protocol.target_mz(e["target_id"]), e["trace"]), 10.0)
            for p in e["points"]:
                s = fx["scans"][p[0]]
                mz = protocol.stored([m for m, _ in s["points"]], fx["bits"])
                inten = [f32(i) for i in protocol.stored([i for _, i in s["points"]], fx["bits"])]
                want = f32(math.fsum(i for m, i in zip(mz, inten) if lo < m < hi))
                d = ulp_distance(p[3], want)
                hist[str(d) if d < 2 else "more"] += 1
            del t
    return {"ulp_distance_to_binary32_of_sum_of_binary32_intensities": hist}


def main(argv: list[str]) -> int:
    scratch, label = Path(argv[1]).resolve(), argv[2]
    root = scratch / f"review-{label}"
    shutil.rmtree(root, ignore_errors=True)
    report = {"extraction_edges": extraction_edges(root), "no_valid_fit": no_valid_fit(root), "faims": faims(root)}
    if label == "before":
        report.update(pinned_hardlink=pinned_hardlink(root), decoy_isolation=decoy_isolation(root),
                      round_one_precision=round_one_precision(root))
    (scratch / f"review-checks-{label}.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n",
                                                         encoding="utf-8", newline="\n")
    print(json.dumps(report, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
