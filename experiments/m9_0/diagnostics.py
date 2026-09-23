#!/usr/bin/env python3
"""M9.0 post-hoc diagnostics: explain the scored failures without re-scoring them.

    python diagnostics.py <scratch-root>

Everything here was written after the scored matrix was observed. It changes no
case, expectation or tolerance in ``protocol.py`` and no check result in
``checks.json``; it only asks narrower questions about why a check failed, and
writes ``diagnostics.json``. Each finding states whether it *explains* a
failure or *changes* a design decision -- never that a failure became a pass.
"""

from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import controller  # noqa: E402
import protocol  # noqa: E402


def f32(x: float) -> float:
    return struct.unpack("<f", struct.pack("<f", x))[0]


def binary32_consistency(root: Path) -> dict:
    """Is every engine XIC value and raw area exactly the binary32 rounding of the oracle's exact sum?"""
    fixtures = protocol.fixture_set()
    points = equal = 0
    worst_rel = 0.0
    areas = []
    for case in protocol.CASES:
        pub = root / "runs" / case["id"] / "published"
        if case["fixture"] not in fixtures or not (pub / "result.json").exists():
            continue
        fx = fixtures[case["fixture"]]
        result = json.loads((pub / "result.json").read_text(encoding="utf-8"))
        evidence = {}
        for line in (pub / "evidence.jsonl").read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            evidence[(e["target_id"], e["trace"])] = e["points"]
        for row in result["targets"]:
            xics = [protocol.oracle_xic(fx["scans"], fx["bits"], row["target_id"], t, fx.get("rt_scale")) for t in (0, 1)]
            for t in (0, 1):
                for got, want in zip(evidence[(row["target_id"], t)], xics[t]):
                    points += 1
                    equal += got[3] == f32(want["value"])
                    if want["value"]:
                        worst_rel = max(worst_rel, abs(got[3] - want["value"]) / want["value"])
            if row["feature"] and row["outcome"] != "SHARED":
                f = row["feature"]
                exact = protocol.oracle_area(xics, f["left_s"], f["right_s"])
                areas.append({"case": case["id"], "target": row["target_id"], "engine": f["raw_area"],
                              "oracle_exact": exact, "engine_equals_f32_of_exact": f["raw_area"] == f32(exact)})
    return {"xic_points": points, "xic_points_equal_to_binary32_of_exact_sum": equal,
            "worst_relative_difference": worst_rel, "raw_areas": areas}


def element_table() -> dict:
    """Recompute two ions from the element masses the engine itself reports (explanation only, not scored)."""
    import pyopenms as oms  # noqa: PLC0415

    mono = {e: oms.EmpiricalFormula(e).getMonoWeight() for e in protocol.MONO}
    out = {"engine_element_masses": mono, "ame2016": protocol.MONO}
    for name in ("truncated", "pos_control"):
        counts = protocol.parse_formula(protocol.TARGETS[name]["formula"])
        out[name] = {"ion_mz_from_engine_elements": protocol.ion_mz(sum(mono[e] * n for e, n in counts.items())),
                     "ion_mz_ame2016": protocol.target_mz(name)}
    return out


def run_variant(root: Path, name: str, scans: list, targets: list[str], **case_extra) -> dict:
    (root / "fixtures").mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(scans):
        s["index"], s["id"] = i, f"scan={i + 1}"
    (root / "fixtures" / f"{name}.mzML").write_bytes(protocol.write_mzml(scans))
    attempt = controller.run_case({"id": name, "fixture": name, "targets": targets, "expect": {}, **case_extra}, root)
    out = {"status": attempt["status"], "code": attempt["code"], "wall_s": attempt["wall_s"]}
    pub = root / "runs" / name / "published" / "result.json"
    if pub.exists():
        rows = json.loads(pub.read_text(encoding="utf-8"))["targets"]
        out["outcomes"] = {r["target_id"]: r["outcome"] for r in rows}
        out["candidates"] = {r["target_id"]: None if r["candidates"] is None else len(r["candidates"]) for r in rows}
    return out


def detection_isolation(root: Path) -> dict:
    """Remove one peculiarity of the main fixture at a time and see which restores detection."""
    base = protocol.build_spectra("main", seed=90)
    grid = protocol.rt_grid
    protocol.rt_grid = lambda end, uneven: grid(end, False)
    uniform = protocol.build_spectra("main", seed=90)
    protocol.rt_grid = grid
    dup = [i for i, s in enumerate(base) if s["ms_level"] == 1 and s["rt_s"] == 60.0][1]
    empty = next(i for i, s in enumerate(base) if s["ms_level"] == 1 and not s["points"])
    keep = ["pos_control", "boundary"]  # `boundary` keeps a feature in every run (zero features crash the engine)
    variants = {
        "v0_main_unmodified": [dict(s) for s in base],
        "v1_without_duplicate_rt": [dict(s) for i, s in enumerate(base) if i != dup],
        "v2_without_empty_scan": [dict(s) for i, s in enumerate(base) if i != empty],
        "v3_without_ms2": [dict(s) for s in base if s["ms_level"] == 1],
        "v4_uniform_spacing": [dict(s) for s in uniform],
        "v5_duplicate_rt_only": [dict(s) for s in uniform if s["ms_level"] == 1 and s["points"]],
        "v6_none_of_the_four": [dict(s) for s in uniform if s["ms_level"] == 1 and s["points"]],
    }
    # v5 keeps the duplicate-RT scan and removes the other three; v6 removes all four.
    variants["v6_none_of_the_four"] = [s for i, s in enumerate(variants["v6_none_of_the_four"])
                                       if not (s["rt_s"] == 60.0 and i > 0 and
                                               variants["v6_none_of_the_four"][i - 1]["rt_s"] == 60.0)]
    return {name: run_variant(root, f"diag_{name}", scans, keep) for name, scans in variants.items()}


def truncation(root: Path) -> dict:
    """The same truncated elution with the target window widened, then centred."""
    base = protocol.build_spectra("main", seed=90)
    out = {}
    for label, rt, half in (("declared_170_180", 175.0, 5.0), ("widened_165_185", 175.0, 10.0),
                            ("centred_on_apex_169_189", 179.0, 10.0)):
        saved = dict(protocol.TARGETS["truncated"])
        protocol.TARGETS["truncated"].update(rt_s=rt, half_s=half)
        try:
            out[label] = run_variant(root, f"diag_truncated_{label}", [dict(s) for s in base], ["truncated", "boundary"])
        finally:
            protocol.TARGETS["truncated"].clear()
            protocol.TARGETS["truncated"].update(saved)
    return out


def zero_candidates(root: Path) -> dict:
    """A run whose only target has no signal: does the engine report it, or raise?"""
    fmt = protocol.build_spectra("format", seed=91)
    return {"absent_only": run_variant(root, "diag_absent_only", [dict(s) for s in fmt], ["absent"]),
            "absent_with_positive": run_variant(root, "diag_absent_with_positive", [dict(s) for s in fmt],
                                                ["absent", "pos_control"])}


def determinism(root: Path) -> dict:
    """Run `main` again and compare every row and evidence line byte for byte (runtime paths aside)."""
    scored = root.parent
    first = json.loads((scored / "runs/main/published/result.json").read_text(encoding="utf-8"))
    evidence_first = (scored / "runs/main/published/evidence.jsonl").read_bytes()
    (root / "fixtures" / "main.mzML").write_bytes((scored / "fixtures" / "main.mzML").read_bytes())
    case = next(c for c in protocol.CASES if c["id"] == "main")
    controller.run_case(dict(case, id="diag_main_repeat"), root)
    second = json.loads((root / "runs/diag_main_repeat/published/result.json").read_text(encoding="utf-8"))
    evidence_second = (root / "runs/diag_main_repeat/published/evidence.jsonl").read_bytes()
    for doc in (first, second):
        for row in doc["targets"]:
            row.pop("assay_ref", None)
    return {"rows_identical": first["targets"] == second["targets"],
            "engine_features_identical": first["engine_features"] == second["engine_features"],
            "evidence_identical": hashlib.sha256(evidence_first).digest() == hashlib.sha256(evidence_second).digest()}


def prefixed_count(root: Path) -> dict:
    """An independent, namespace-aware spectrum count, which the reader's silent empty result can be checked against."""
    out = {}
    for name in ("fmt_plain", "fmt_prefixed", "fmt_indexed"):
        n = sum(1 for _, el in ElementTree.iterparse(root / "fixtures" / f"{name}.mzML")
                if el.tag == f"{{{protocol.MZML_NS}}}spectrum")
        out[name] = {"independent_spectrum_count": n}
    return out


def timeout_path(root: Path) -> dict:
    """The controller's wall-clock path, which the scored ctl_timeout never reached."""
    case = {"id": "diag_timeout_1s", "fixture": "ctl_large", "targets": ["pos_control"], "expect": {},
            "control": {"timeout_s": 1.0}}
    a = controller.run_case(case, root)
    return {k: a[k] for k in ("status", "code", "exit_code", "wall_s", "control", "peak_working_set_bytes",
                              "staging_files")}


def main(argv: list[str]) -> int:
    root = Path(argv[1]).resolve()
    diag_root = root / "diagnostics"
    if (diag_root / "fixtures").exists() is False:
        (diag_root / "fixtures").mkdir(parents=True)
    large = diag_root / "fixtures" / "ctl_large.mzML"
    if not large.exists():
        large.write_bytes((root / "fixtures" / "ctl_large.mzML").read_bytes())
    report = {
        "binary32": binary32_consistency(root),
        "element_table": element_table(),
        "prefixed_count": prefixed_count(root),
        "zero_candidates": zero_candidates(diag_root),
        "detection_isolation": detection_isolation(diag_root),
        "truncation": truncation(diag_root),
        "determinism": determinism(diag_root),
        "timeout_path": timeout_path(diag_root),
    }
    (root / "diagnostics.json").write_text(json.dumps(report, indent=1, default=str) + "\n", encoding="utf-8",
                                           newline="\n")
    print(json.dumps(report, indent=1, default=str)[:12000])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
