#!/usr/bin/env python3
"""M9.0 round two: a narrowed-domain confirmation, frozen before it runs.

Round one (``protocol.py``) stays the scored result; nothing here re-scores it.
Round two asks whether the adapter's narrowing -- refusing MS1 spectra that share
a retention time, cross-checking the reader's spectrum count, and typing the
engine's all-absent failure -- closes the failures round one found, on fixtures
no run has seen: a new seed and new target placements.

Two tolerances here were learned from round one and are labelled ``post-hoc``
wherever they are used: a chromatogram value or raw area must equal the binary32
rounding of the exact sum to within one binary32 unit in the last place (the
engine stores both as binary32), and a formula-derived ion m/z must agree to
1e-5 Da (the engine's element table carries N and O to six decimals). Checks
using them are not independent confirmation of round one.

Pre-registered questions whose answer is not known in advance:

* Does a *near*-duplicate retention time (1e-3 s or 1e-6 s apart) inside a peak
  also cause a false negative? If so, strict increase is not a sufficient guard.
* Does an exact duplicate *outside* any peak (but inside a target window) cause a
  false negative? If not, refusing every duplicate is broader than the defect.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import protocol as p1  # noqa: E402

# ------------------------------------------------------------------ targets and elution

TARGETS = {
    "pc2": {"formula": "C8H10N4O2", "rt_s": 72.0, "half_s": 20.0},  # caffeine
    "absent2": {"formula": "C8H9NO2", "rt_s": 72.0, "half_s": 20.0},  # paracetamol, no signal
    "bnd2": {"formula": "C12H18O5", "mass": 242.1154, "rt_s": 140.0, "half_s": 15.0},
    "two2": {"formula": "C9H11NO2", "rt_s": 190.0, "half_s": 25.0},  # phenylalanine
    "tyr_near3": {"formula": "C9H11NO3", "rt_s": 40.0, "half_s": 15.0},  # tyrosine
    "trp_near6": {"formula": "C11H12N2O2", "rt_s": 160.0, "half_s": 12.0},  # tryptophan
    "pc": dict(p1.TARGETS["pos_control"]),
    "absent": dict(p1.TARGETS["absent"]),
}
COMPONENTS = {
    "strict": [("pc2", 72.0, 8.0e5, 0.10), ("bnd2", 140.0, 2.0e5, 0.12), ("two2", 178.0, 5.0e5, 0.10),
               ("two2", 202.0, 2.5e5, 0.10), ("tyr_near3", 40.0, 3.0e5, 0.10), ("trp_near6", 160.0, 3.0e5, 0.12)],
    "single": [("pc", 60.0, 1.0e6, 0.10)],
}


def mz_of(name: str) -> float:
    t = TARGETS[name]
    return p1.ion_mz(t.get("mass", p1.neutral_mono_mass(t["formula"])))


def build(kind: str, seed: int, *, dup_at=None, near=None, empty_at=None, ms2_every=None) -> list[dict]:
    """Scans in file order. `near` maps a grid time to the offset of an inserted MS1 twin."""
    rng = random.Random(seed)
    comps = COMPONENTS[kind]
    names = sorted({c[0] for c in comps})
    interferer = "pc2" if kind == "strict" else "pc"
    probe = "bnd2" if kind == "strict" else None
    centres = [p1.trace_mz(mz_of(n), i) for n in TARGETS for i in (0, 1)]
    end = 220.0 if kind == "strict" else 100.0
    grid, t = [], 0.0
    while t <= end + 1e-9:
        grid.append(round(t, 4))
        t = round(t + (0.7 if kind == "strict" and 30.0 <= t < 34.9 else 0.5), 4)

    def ms1(rt: float, empty: bool = False) -> dict:
        pts = []
        if not empty:
            for name, apex, height, ratio in comps:
                for trace, h in ((0, height), (1, height * ratio)):
                    v = h * math.exp(-((rt - apex) ** 2) / (2 * p1.SIGMA_S**2))
                    if v >= 1.0:
                        pts.append((p1.trace_mz(mz_of(name), trace) * (1 + rng.uniform(-1.5, 1.5) * 1e-6), v))
            for name in names:
                for trace in (0, 1):
                    if rng.random() < 0.6:
                        pts.append((p1.trace_mz(mz_of(name), trace) * (1 + rng.uniform(-3, 3) * 1e-6),
                                    rng.uniform(50.0, 300.0)))
            if probe and 125.0 <= rt <= 155.0:
                for trace in (0, 1):
                    lo, hi = p1.open_window(p1.trace_mz(mz_of(probe), trace), 2 * p1.HALF_WIDTH_PPM)
                    pts += [(lo, 7777.0), (math.nextafter(lo, math.inf), 11.0),
                            (hi, 7777.0), (math.nextafter(hi, -math.inf), 13.0)]
            apex = next(c[1] for c in comps if c[0] == interferer)
            pts.append((mz_of(interferer) * (1 + 7.5e-6),
                        4.0e7 * math.exp(-((rt - apex) ** 2) / (2 * p1.SIGMA_S**2)) + 1.0))
            late = 4.0e7 * math.exp(-((rt - (apex + 38.0)) ** 2) / (2 * p1.SIGMA_S**2))
            if late >= 1.0:
                pts.append((mz_of(interferer) * (1 + 0.5e-6), late))
            for _ in range(20):
                mz = rng.uniform(100.0, 400.0)
                if not any(abs(mz - c) <= c * 20e-6 for c in centres):
                    pts.append((mz, rng.uniform(1.0e3, 1.0e5)))
            pts.sort()
        return {"ms_level": 1, "rt_s": rt, "polarity": "positive", "points": pts}

    scans = []
    for n, rt in enumerate(grid):
        scans.append(ms1(rt))
        if dup_at is not None and rt == dup_at:
            scans.append(ms1(rt))
        if near and rt in near:
            scans.append(ms1(round(rt + near[rt], 7)))
        if empty_at is not None and rt == empty_at:
            scans.append(ms1(round(rt + 0.25, 4), empty=True))
        if ms2_every and n % ms2_every == ms2_every - 1:
            scans.append({"ms_level": 2, "rt_s": round(rt + 0.05, 4), "polarity": "positive",
                          "precursor_mz": mz_of(interferer), "points": [(mz_of(interferer), 1.0e8)]})
    for i, s in enumerate(scans):
        s["index"], s["id"] = i, f"scan={i + 1}"
    return scans


def fixtures() -> dict:
    strict = build("strict", 93, near={39.9: 1e-3, 159.9: 1e-6}, empty_at=75.4, ms2_every=7)
    plain = build("single", 96)
    return {
        "r2_strict": {"scans": strict, "bits": 64, "kw": {}},
        "r2_dup_outside_peak": {"scans": build("single", 94, dup_at=45.0), "bits": 64, "kw": {}},
        "r2_dup_in_peak": {"scans": build("single", 95, dup_at=60.0), "bits": 64, "kw": {}},
        "r2_plain": {"scans": plain, "bits": 64, "kw": {}},
        "r2_prefixed": {"scans": plain, "bits": 64, "kw": {"prefix": "ms"}},
    }


def generate(out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, fx in fixtures().items():
        data = p1.write_mzml(fx["scans"], **fx["kw"])
        for scan, got in zip(fx["scans"], p1.decode_mzml(data)):
            assert got["mz"] == p1.stored([m for m, _ in scan["points"]], 64)
            assert got["int"] == p1.stored([i for _, i in scan["points"]], 64)
        (out / f"{name}.mzML").write_bytes(data)
        manifest[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    (out / "fixtures.json").write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8",
                                       newline="\n")
    return manifest


def request_targets(names: list[str]) -> list[dict]:
    return [{"target_id": n, "formula": TARGETS[n]["formula"], "neutral_mass": TARGETS[n].get("mass"), "charge": 1,
             "rt_s": TARGETS[n]["rt_s"], "rt_half_width_s": TARGETS[n]["half_s"]} for n in names]


STRICT = ["pc2", "absent2", "bnd2", "two2", "tyr_near3", "trp_near6"]
CASES = [
    {"id": "r2_strict", "fixture": "r2_strict", "targets": STRICT,
     "expect": {"pc2": {"DETECTED"}, "absent2": {"NOT_DETECTED"}, "bnd2": {"DETECTED"},
                "two2": {"DETECTED_AMBIGUOUS"}, "tyr_near3": {"DETECTED"}, "trp_near6": {"DETECTED"}}},
    {"id": "r2_subset", "fixture": "r2_strict", "targets": ["pc2", "bnd2"],
     "expect": {"pc2": {"DETECTED"}, "bnd2": {"DETECTED"}}, "raw_area_equals": "r2_strict"},
    {"id": "r2_dup_refused", "fixture": "r2_dup_outside_peak", "targets": ["pc"],
     "expect": {"_run": {"refused"}, "_code": "SOURCE_RT_NOT_STRICTLY_INCREASING"}},
    {"id": "r2_dup_outside_peak_measured", "fixture": "r2_dup_outside_peak", "targets": ["pc"],
     "experiment": {"accept_duplicate_rt": True}, "expect": {"pc": {"DETECTED"}}},
    # Replicates round one's finding on a fresh fixture; the expectation comes from round one.
    {"id": "r2_dup_in_peak_measured", "fixture": "r2_dup_in_peak", "targets": ["pc"],
     "experiment": {"accept_duplicate_rt": True}, "expect": {"pc": {"NOT_DETECTED"}}},
    {"id": "r2_plain", "fixture": "r2_plain", "targets": ["pc"], "expect": {"pc": {"DETECTED"}}},
    {"id": "r2_prefixed", "fixture": "r2_prefixed", "targets": ["pc"],
     "expect": {"_run": {"failed"}, "_code": "SOURCE_READ_INCOMPLETE"}},
    {"id": "r2_absent_only", "fixture": "r2_plain", "targets": ["absent"],
     "expect": {"_run": {"failed"}, "_code": "ENGINE_NO_CANDIDATES"}},
    # Round-one fixtures under the narrowed adapter (regression of the guards, not new science).
    {"id": "r2_r1_main", "fixture": "r1:main", "targets": ["pos_control"], "r1_targets": True,
     "expect": {"_run": {"refused"}, "_code": "SOURCE_RT_NOT_STRICTLY_INCREASING"}},
    {"id": "r2_r1_prefixed", "fixture": "r1:fmt_prefixed", "targets": ["pos_control"], "r1_targets": True,
     "expect": {"_run": {"failed"}, "_code": "SOURCE_READ_INCOMPLETE"}},
    {"id": "r2_r1_fmt_plain", "fixture": "r1:fmt_plain", "targets": ["pos_control"], "r1_targets": True,
     "expect": {"pos_control": {"DETECTED"}}},
]

# ------------------------------------------------------------------ evaluation


def f32(x: float) -> float:
    return struct.unpack("<f", struct.pack("<f", x))[0]


def f32_ulp(x: float) -> float:
    bits = struct.unpack("<I", struct.pack("<f", abs(x)))[0]
    return struct.unpack("<f", struct.pack("<I", bits + 1))[0] - abs(f32(x))


def within_one_f32_ulp(got: float, exact: float) -> bool:
    want = f32(exact)
    return abs(got - want) <= f32_ulp(want)


def oracle_xic(scans: list, name: str, trace: int, targets: dict) -> list[dict]:
    t = targets[name]
    lo, hi = p1.open_window(p1.trace_mz(p1.ion_mz(t.get("mass", p1.neutral_mono_mass(t["formula"]))), trace),
                            2 * p1.HALF_WIDTH_PPM)
    out = []
    for s in scans:
        if s["ms_level"] == 1 and s["points"] and t["rt_s"] - t["half_s"] <= s["rt_s"] <= t["rt_s"] + t["half_s"]:
            out.append({"id": s["id"], "rt_s": s["rt_s"],
                        "value": math.fsum(i for m, i in s["points"] if lo < m < hi)})
    return out


def evaluate(root: Path, r1_root: Path) -> list[dict]:
    rows: list[dict] = []
    fx = fixtures()
    r1_fx = p1.fixture_set()
    raw = {}
    for case in CASES:
        cid, run = case["id"], root / "runs" / case["id"]
        attempt = json.loads((run / "attempt.json").read_text(encoding="utf-8"))
        allowed = case["expect"].get("_run", {"completed"})
        code_ok = attempt["code"] == case["expect"].get("_code", attempt["code"])
        p1._check(rows, cid, "run_status", attempt["status"] in allowed and code_ok,
                  f"status={attempt['status']} code={attempt['code']}", "contract")
        pub = run / "published" / "result.json"
        if not pub.exists():
            continue
        result = json.loads(pub.read_text(encoding="utf-8"))
        by_id = {r["target_id"]: r for r in result["targets"]}
        if case.get("r1_targets"):
            scans, targets = r1_fx[case["fixture"][3:]]["scans"], p1.TARGETS
        else:
            scans, targets = fx[case["fixture"]]["scans"], TARGETS
        evidence = {}
        for line in (run / "published" / "evidence.jsonl").read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            evidence[(e["target_id"], e["trace"])] = e["points"]
        for name in case["targets"]:
            row = by_id[name]
            if name in case["expect"]:
                p1._check(rows, cid, f"{name}.outcome", row["outcome"] in case["expect"][name],
                          f"got={row['outcome']} want={sorted(case['expect'][name])}")
            t = targets[name]
            want_mz = p1.ion_mz(t.get("mass", p1.neutral_mono_mass(t["formula"])))
            p1._check(rows, cid, f"{name}.ion_mz", abs(row["ion"]["mz"][0] - want_mz) <= (0.0 if "mass" in t else 1e-5),
                      f"engine={row['ion']['mz'][0]!r} oracle={want_mz!r}", "oracle" if "mass" in t else "post-hoc")
            xics = [oracle_xic(scans, name, tr, targets) for tr in (0, 1)]
            for tr in (0, 1):
                got, want = evidence[(name, tr)], xics[tr]
                ok = ([g[1] for g in got] == [w["id"] for w in want] and all(g[2] == w["rt_s"] for g, w in zip(got, want))
                      and all(within_one_f32_ulp(g[3], w["value"]) for g, w in zip(got, want)))
                p1._check(rows, cid, f"{name}.xic{tr}", ok, f"points engine={len(got)} oracle={len(want)}", "post-hoc")
            p1._check(rows, cid, f"{name}.signal_in_window_disclosed",
                      row["signal"]["in_window"] == any(w["value"] > 0 for x in xics for w in x),
                      f"in_window={row['signal']['in_window']}", "semantics")
            f = row["feature"]
            if not f:
                continue
            raw[(cid, name)] = f["raw_area"]
            exact = math.fsum(w["value"] for x in xics for w in x if f["left_s"] <= w["rt_s"] <= f["right_s"])
            p1._check(rows, cid, f"{name}.raw_area", within_one_f32_ulp(f["raw_area"], exact),
                      f"engine={f['raw_area']!r} exact={exact!r}", "post-hoc")
            comps = [c for c in COMPONENTS["strict"] + COMPONENTS["single"] if c[0] == name]
            comps += [(name, 60.0, 0, 0)] if name == "pos_control" else []
            if comps:
                near = min(abs(f["rt_s"] - c[1]) for c in comps)
                p1._check(rows, cid, f"{name}.apex", near <= p1.TOL["apex_abs_s"], f"nearest_diff={near:.4f}")
            if name == "two2":
                p1._check(rows, cid, "two2.candidates_reported", len(row["candidates"]) >= 2,
                          f"candidates={len(row['candidates'])}")
    for (cid, name), value in raw.items():
        ref = next((c.get("raw_area_equals") for c in CASES if c["id"] == cid), None)
        if ref and (ref, name) in raw:
            p1._check(rows, cid, f"{name}.raw_area_batch_independent", value == raw[(ref, name)],
                      f"{value!r} vs {raw[(ref, name)]!r}", "semantics")
    manifest = json.loads((root / "fixtures" / "fixtures.json").read_text(encoding="utf-8"))
    for name, meta in manifest.items():
        ok = hashlib.sha256((root / "fixtures" / f"{name}.mzML").read_bytes()).hexdigest() == meta["sha256"]
        p1._check(rows, "fixtures", f"{name}.digest", ok, meta["sha256"][:16], "contract")
    return rows


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "generate":
        print(json.dumps(generate(Path(argv[2])), indent=1))
        return 0
    if len(argv) == 4 and argv[1] == "evaluate":
        rows = evaluate(Path(argv[2]), Path(argv[3]))
        Path(argv[2], "checks.json").write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8", newline="\n")
        for r in rows:
            print(f"{r['result']:4} {r['kind']:10} {r['case']:30} {r['check']:36} {r['detail']}")
        print(f"{sum(r['result'] == 'PASS' for r in rows)} PASS / {sum(r['result'] == 'FAIL' for r in rows)} FAIL")
        return 0
    print("usage: protocol_r2.py generate <dir> | evaluate <round2-root> <round1-root>")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
