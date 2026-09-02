#!/usr/bin/env python3
"""Runs the M6.2 measurement ledger against an installed `msconvert`.

This is the half that spawns a process, and it is a separate file for that
reason. [`msconvert_evidence.py`](msconvert_evidence.py) describes the cases and
reads the outputs, and it has to stay a pure function of bytes or it could not be
used to check the thing that produced them. This module is what turns that
description into 29 conversions and one normalized report.

**It exists because "the operator ran the published argv" was not reproducible.**
M6.2's first evidence record named its cases in prose, and prose miscounted: it
claimed six mzXML runs against four and named twenty-eight of twenty-nine cases.
Nothing failed, because nothing could. The ledger makes the set data, and this
driver makes the set executable, so the numbers a record states are the numbers a
run produced.

What it guarantees, in order:

1. the three fixtures are regenerated and match their recorded SHA-256s;
2. the installed executable matches the identity the evidence is bound to,
   checked **before and again after** the whole run -- a binary swapped
   mid-measurement would otherwise inherit observations it never made;
3. every case runs in a **fresh empty directory**, so anything besides the
   requested output is visible rather than assumed absent;
4. argv is passed as a list and never as a shell string;
5. the produced document is read back by the shared inspector;
6. the emitted report carries no absolute path, and the working tree is removed
   once the facts are captured.

Standard library only, and no network.

    python -B scripts/msconvert_evidence_run.py --report m62-run.json
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent


def _evidence_module() -> Any:
    """The sibling module, loaded by path so this works from any directory."""
    spec = importlib.util.spec_from_file_location(
        "msconvert_evidence", HERE / "msconvert_evidence.py"
    )
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise RuntimeError("cannot load msconvert_evidence.py beside this script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


EV = _evidence_module()

#: Where this repository's own discovery searches, and nowhere else.
DISCOVERY_ROOT_VARIABLE = "LOCALAPPDATA"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def find_msconvert(explicit: Path | None) -> Path:
    """The installed executable, named by the operator or discovered.

    Discovery looks only where the application's own discovery looks. Nothing
    about the located path is recorded in the report.
    """
    if explicit is not None:
        if not explicit.is_file():
            raise SystemExit(f"no msconvert at the path given: {explicit.name}")
        return explicit
    root = os.environ.get(DISCOVERY_ROOT_VARIABLE)
    if not root:
        raise SystemExit(
            f"{DISCOVERY_ROOT_VARIABLE} is unset, so there is nowhere to discover "
            "msconvert; pass --msconvert"
        )
    found = sorted((Path(root) / "Apps").glob("**/msconvert.exe"))
    if not found:
        raise SystemExit("no msconvert.exe under the discovery root; pass --msconvert")
    if len(found) > 1:
        raise SystemExit(
            f"{len(found)} msconvert.exe under the discovery root. Evidence binds to one "
            "executable, so name it with --msconvert"
        )
    return found[0]


def executable_identity(msconvert: Path) -> dict[str, Any]:
    """Byte length, digest and the build's own footer, read fresh each time."""
    completed = subprocess.run(
        [str(msconvert), "--help"], capture_output=True, check=False
    )
    banner = completed.stdout.decode("utf-8", "replace")
    release = re.search(r"ProteoWizard release:\s*(.+)", banner)
    build = re.search(r"Build date:\s*(.+)", banner)
    return {
        "bytes": msconvert.stat().st_size,
        "sha256": digest(msconvert),
        "release": release.group(1).strip() if release else None,
        "build_date": build.group(1).strip() if build else None,
        "help_bytes": len(completed.stdout),
        "help_sha256": hashlib.sha256(completed.stdout).hexdigest().upper(),
    }


def identity_mismatch(observed: dict[str, Any]) -> list[str]:
    """Every way the installed executable is not the one the evidence covers."""
    expected = EV.EXECUTABLE_IDENTITY
    problems: list[str] = []
    for field in ("bytes", "sha256", "release", "build_date"):
        if observed[field] != expected[field]:
            problems.append(
                f"{field}: expected {expected[field]!r}, observed {observed[field]!r}"
            )
    return problems


def scrub(text: str, work: Path) -> str:
    """Every filesystem path out of a diagnostic, leaving the diagnostic.

    The working directory first, because it is the one that would otherwise
    appear in full; then any remaining drive-lettered or UNC path, because a
    backend is free to mention one this driver never chose.
    """
    cleaned = text.replace(str(work), "<work>").replace(str(work).replace("\\", "/"), "<work>")
    cleaned = re.sub(r"[A-Za-z]:[\\/][^\s\"'<>|]*", "<path>", cleaned)
    cleaned = re.sub(r"\\\\[^\s\"'<>|]+", "<path>", cleaned)
    return cleaned


def normalized_argv(case: Any, fixture: Path, out: Path) -> list[str]:
    """The argv a reader can compare, with the two runtime paths named."""
    argv = [f"<fixtures>/{fixture.name}", *case.arguments, "--outdir", "<outdir>"]
    if case.output_name is not None:
        argv += ["--outfile", case.output_name]
    return argv


def run_case(case: Any, msconvert: Path, fixtures: Path, work: Path) -> dict[str, Any]:
    """One conversion, in a directory that did not exist a moment ago."""
    out = work / "out" / case.case
    out.mkdir(parents=True)
    fixture = fixtures / case.fixture
    argv = [str(msconvert), str(fixture), *case.arguments, "--outdir", str(out)]
    if case.output_name is not None:
        argv += ["--outfile", case.output_name]
    # A list, never a string. The boundary this repository defends everywhere
    # else is defended here too, even though this side is a developer tool.
    completed = subprocess.run(argv, capture_output=True, check=False, shell=False)

    entries = sorted(path.name for path in out.iterdir())
    record: dict[str, Any] = {
        "case": case.case,
        "family": case.family,
        "fixture": case.fixture,
        "argv": normalized_argv(case, fixture, out),
        "output_format": case.output_format,
        "posture": case.posture,
        "purpose": case.purpose,
        "exit": completed.returncode,
        "stdout_bytes": len(completed.stdout),
        "stderr_bytes": len(completed.stderr),
        "stderr_excerpt": scrub(
            completed.stderr.decode("utf-8", "replace"), work
        ).strip()[:400],
        "directory_entry_count": len(entries),
        "directory_entries": entries,
    }

    produced = [
        path for path in out.iterdir() if path.suffix.lower() in (".mzml", ".mzxml")
    ]
    if produced:
        target = produced[0]
        record["output_name"] = target.name
        record["output_bytes"] = target.stat().st_size
        try:
            facts = EV.inspect(target)
        except Exception as error:  # noqa: BLE001 - a partial document is a result
            record["inspect_error"] = type(error).__name__
        else:
            record["inspected"] = summarize(facts)
    return record


def summarize(facts: dict[str, Any]) -> dict[str, Any]:
    """The bounded facts a report may carry, rather than every decoded value.

    Array values are reduced to a digest plus their first and last entries: the
    report has to stay comparable and readable, and the checks that need whole
    arrays compute them from this run rather than from the file.
    """
    spectra = []
    for spectrum in facts["spectra"]:
        arrays = []
        for array in spectrum["arrays"]:
            values = array.get("values") or []
            arrays.append(
                {
                    "kind": array["kind"],
                    "bits": array["bits"],
                    "compression": array["compression"],
                    "length": array["length"],
                    "malformed": array.get("malformed"),
                    "first": repr(values[0]) if values else None,
                    "last": repr(values[-1]) if values else None,
                    "values_sha256": hashlib.sha256(
                        repr([repr(v) for v in values]).encode("utf-8")
                    ).hexdigest().upper()[:16],
                }
            )
        spectra.append(
            {
                "id": spectrum["id"],
                "ms_level": spectrum["ms_level"],
                "centroided": spectrum["centroided"],
                "declared_length": spectrum["declared_length"],
                "length_disagreement": spectrum.get("length_disagreement"),
                "arrays": arrays,
            }
        )
    return {
        "format": facts["format"],
        "spectrum_count": facts["spectrum_count"],
        "source_file_count": len(facts["source_files"]),
        "processing": [
            {"software": method["software"], "cv": [c["name"] for c in method.get("cv", [])],
             "user": [u["name"] for u in method.get("user", [])]}
            for method in facts["processing_methods"]
        ],
        "spectra": spectra,
    }


# ------------------------------------------------------------------- checks
#
# The confirmations the evidence record stands on, recomputed from this run.
# They are here rather than in a separate analysis so that a reproduction cannot
# quietly disagree with the record while still reporting "29 cases ran".


def decoded(work: Path, case: str, index: int, kind: str) -> list[float]:
    document = next((work / "out" / case).glob("*.mz*"))
    facts = EV.inspect(document)
    arrays = {a["kind"]: a["values"] for a in facts["spectra"][index]["arrays"]}
    return arrays[kind]


def spectrum_ids(work: Path, case: str) -> list[str]:
    document = next((work / "out" / case).glob("*.mz*"))
    return [s["id"] for s in EV.inspect(document)["spectra"]]


def verify(results: dict[str, dict[str, Any]], work: Path) -> list[dict[str, Any]]:
    """Every claim the record makes that a rerun can independently re-answer."""
    import struct

    def f32(value: float) -> float:
        return struct.unpack("<f", struct.pack("<f", value))[0]

    plan = EV.spectra_plan()
    checks: list[dict[str, Any]] = []

    def note(name: str, expected: Any, observed: Any) -> None:
        checks.append(
            {
                "check": name,
                "expected": expected,
                "observed": observed,
                "agrees": expected == observed,
            }
        )

    def shape(case: str, kind: str) -> str:
        exact = all(
            decoded(work, case, i, kind) == plan[i]["mz" if kind == "mz" else "intensity"]
            for i in range(len(plan))
        )
        narrowed = all(
            decoded(work, case, i, kind)
            == [f32(v) for v in plan[i]["mz" if kind == "mz" else "intensity"]]
            for i in range(len(plan))
        )
        return "exact float64" if exact else ("float32 image" if narrowed else "neither")

    note("precision default, m/z", "exact float64", shape("D1", "mz"))
    note("precision default, intensity", "float32 image", shape("D1", "intensity"))
    note("--64, m/z", "exact float64", shape("P4", "mz"))
    note("--64, intensity", "exact float64", shape("P4", "intensity"))
    note("--32, m/z", "float32 image", shape("P3", "mz"))
    note("--32, intensity", "float32 image", shape("P3", "intensity"))
    note("--mz32 --inten64, m/z", "float32 image", shape("P5", "mz"))
    note("--mz32 --inten64, intensity", "exact float64", shape("P5", "intensity"))

    note(
        "compression default declared",
        "zlib",
        results["D1"]["inspected"]["spectra"][0]["arrays"][0]["compression"],
    )
    note(
        "--zlib=off declared",
        "none",
        results["C2"]["inspected"]["spectra"][0]["arrays"][0]["compression"],
    )
    note(
        "zlib on and off decode identically at fixed precision",
        True,
        all(
            decoded(work, "C1", i, kind) == decoded(work, "C2", i, kind)
            for i in range(len(plan))
            for kind in ("mz", "intensity")
        ),
    )

    note("MS1 only keeps", ["scan=1", "scan=3"], spectrum_ids(work, "L1"))
    note("MS2 only keeps", ["scan=2", "scan=4"], spectrum_ids(work, "L2"))
    note(
        "explicit all matches omitted all",
        spectrum_ids(work, "L3"),
        spectrum_ids(work, "L4"),
    )

    def nonzero(case: str, index: int) -> list[float]:
        mz = decoded(work, case, index, "mz")
        intensity = decoded(work, case, index, "intensity")
        return [m for m, v in zip(mz, intensity) if v != 0.0]

    centres = list(EV.PEAK_CENTRES)
    note("default picker recovers every apex of the 3-peak spectrum", centres, nonzero("K1", 2))
    note("cwt returns one peak of that spectrum", 1, len(nonzero("K2", 2)))
    note(
        "vendor produces the default picker's arrays",
        [decoded(work, "K1", i, k) for i in range(len(plan)) for k in ("mz", "intensity")],
        [decoded(work, "K3", i, k) for i in range(len(plan)) for k in ("mz", "intensity")],
    )
    note(
        "vendor request is recorded as the local-maximum picker",
        True,
        any(
            "local maximum" in name
            for method in results["K3"]["inspected"]["processing"]
            for name in method["user"]
        ),
    )
    note(
        "scope without a picker token centroids every level",
        [True, True, True, True],
        [s["centroided"] for s in results["K11"]["inspected"]["spectra"]],
    )
    note(
        "scope with a picker token leaves MS1 profile",
        [False, True, False, True],
        [s["centroided"] for s in results["K4"]["inspected"]["spectra"]],
    )
    note("cwt refuses unflanked input", 1, results["K7"]["exit"])
    note("the default picker accepts that same input", 0, results["K8"]["exit"])

    note("mzXML single-source keeps", 4, results["X1"]["inspected"]["spectrum_count"])
    note("mzXML multi-source keeps", 2, results["X2"]["inspected"]["spectrum_count"])
    note("mzML control on the same document keeps", 4, results["X3"]["inspected"]["spectrum_count"])
    note("mzXML multi-source survivors", ["1", "4"], spectrum_ids(work, "X2"))

    note("every case produced exactly one entry", [], [
        result["case"]
        for result in results.values()
        if result["directory_entry_count"] != 1
    ])
    note("mzXML-producing cases", list(EV.mzxml_cases()), [
        result["case"] for result in results.values() if result["output_format"] == "mzXML"
    ])
    # Size *relations*, never absolute sizes. `msconvert` stamps its own command
    # line into an mzML output, so every mzML byte count moves with the length
    # of the paths the operator happened to use; the relation does not.
    note(
        "compressed output is smaller than uncompressed at the same precision",
        True,
        results["C1"]["output_bytes"] < results["C2"]["output_bytes"],
    )
    note(
        "the refused run's partial output is a fraction of the baseline's",
        True,
        results["K7"]["output_bytes"] < results["K9"]["output_bytes"] / 2,
    )
    note("the refused run's output does not parse", "ParseError", results["K7"].get("inspect_error"))
    note(
        "the unflanked fixture converts cleanly with no filter",
        (4, [False, False, False, False]),
        (
            results["K9"]["inspected"]["spectrum_count"],
            [s["centroided"] for s in results["K9"]["inspected"]["spectra"]],
        ),
    )

    note("cases run", len(EV.CASES), len(results))
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--msconvert", type=Path, default=None, help="the executable to measure"
    )
    parser.add_argument(
        "--report", type=Path, required=True, help="where the normalized result is written"
    )
    args = parser.parse_args()

    defects = EV.ledger_defects()
    if defects:
        for defect in defects:
            print(f"ledger: {defect}", file=sys.stderr)
        return 1

    msconvert = find_msconvert(args.msconvert)
    before = executable_identity(msconvert)
    mismatch = identity_mismatch(before)
    if mismatch:
        print(
            "the installed executable is not the one this evidence is bound to:",
            file=sys.stderr,
        )
        for line in mismatch:
            print(f"  {line}", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory(prefix="m62-") as scratch:
        work = Path(scratch)
        fixtures = work / "fixtures"
        written = EV.generate(fixtures)
        fixture_facts = {}
        for name, size in written:
            path = fixtures / name
            fixture_facts[name] = {"bytes": size, "sha256": digest(path)}
            expected_size, expected_digest = EV.FIXTURE_IDENTITIES[name]
            if size != expected_size or fixture_facts[name]["sha256"] != expected_digest:
                print(f"{name} did not regenerate to its recorded identity", file=sys.stderr)
                return 1

        results = {case.case: run_case(case, msconvert, fixtures, work) for case in EV.CASES}
        checks = verify(results, work)
        after = executable_identity(msconvert)

    disagreed = [check for check in checks if not check["agrees"]]
    report = {
        "case_count": len(results),
        "mzxml_cases": list(EV.mzxml_cases()),
        "fixtures": fixture_facts,
        "executable_before": before,
        "executable_after": after,
        "executable_stable": before == after,
        "checks": checks,
        "disagreements": len(disagreed),
        "results": list(results.values()),
    }
    args.report.write_text(json.dumps(report, indent=1, sort_keys=False), encoding="utf-8")

    print(f"cases run              : {report['case_count']}")
    print(f"mzXML-producing cases  : {len(report['mzxml_cases'])} {report['mzxml_cases']}")
    print(f"executable stable      : {report['executable_stable']}")
    print(f"checks                 : {len(checks) - len(disagreed)}/{len(checks)} agree")
    for check in disagreed:
        print(f"  DISAGREES {check['check']}: expected {check['expected']!r}, "
              f"observed {check['observed']!r}")
    return 1 if disagreed or not report["executable_stable"] else 0


if __name__ == "__main__":
    sys.exit(main())
