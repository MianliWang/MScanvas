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
4. every case runs from **one pinned working directory**, created empty and
   enumerated afterwards, so a file written beside the caller rather than into
   `--outdir` is visible too -- and the report is written outside it, so the
   driver's own file is not one of the entries this measurement is about;
5. argv is passed as a list and never as a shell string;
6. the produced document is read back by the shared inspector, and every case's
   exit status, output name and directory contents are compared against the row
   that asked for them;
7. the emitted report carries no absolute path, and the working tree is removed
   once the facts are captured.

**M6.10 rewrote the checks rather than adding to them.** M6.2 recorded that
`verify()` re-answered the confirmations that slice owed and not the bases its
classifications rested on, and enumerated the gaps: one spectrum and one array
for the picker, ids and not values for the MS-level filters, `P1`/`P2` run and
never shaped, `K5`/`K6` and `K12` run and never compared, one array of one
spectrum for compression, a posture copied rather than compared, and a working
directory nothing pinned. Every one of those is closed, and an equality taken
over an array that decoded to nothing is now a disagreement rather than a
vacuous pass.

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
        # Resolved here, not left as given. Every conversion now starts in the
        # pinned working directory, so a relative path that resolved for the
        # identity check would fail to launch once the run began -- the option
        # would pass its first use and break on its second.
        return explicit.resolve()
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


def run_case(
    case: Any, msconvert: Path, fixtures: Path, work: Path, provider_cwd: Path
) -> dict[str, Any]:
    """One conversion, in a directory that did not exist a moment ago.

    Two directories are watched rather than one. `--outdir` is where the output
    is asked for; `provider_cwd` is where the process is actually started, and a
    file written beside the caller instead of into the output directory would be
    invisible to a driver that enumerated only the first. M6.2 measured that by
    hand and recorded that the tooling did not pin it; this pins it.
    """
    out = work / "out" / case.case
    out.mkdir(parents=True)
    fixture = fixtures / case.fixture
    argv = [str(msconvert), str(fixture), *case.arguments, "--outdir", str(out)]
    if case.output_name is not None:
        argv += ["--outfile", case.output_name]
    # A list, never a string. The boundary this repository defends everywhere
    # else is defended here too, even though this side is a developer tool.
    completed = subprocess.run(
        argv, capture_output=True, check=False, shell=False, cwd=str(provider_cwd)
    )

    entries = sorted(path.name for path in out.iterdir())
    record: dict[str, Any] = {
        "case": case.case,
        "family": case.family,
        "fixture": case.fixture,
        "argv": normalized_argv(case, fixture, out),
        "output_format": case.output_format,
        "expected_output_name": case.output_name,
        "posture": case.posture,
        "expected_exit": expected_exit(case),
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


def expected_exit(case: Any) -> int:
    """The exit status a case's declared posture states, as a number.

    The ledger states a posture in the record's own words, and until now only
    two cases had that posture compared against anything. Parsed here rather
    than re-listed, so a posture that changes changes the comparison with it.
    """
    posture = case.posture.strip()
    if posture.startswith("exit "):
        return int(posture[len("exit ") :].split(",")[0].strip())
    raise ValueError(f"{case.case} declares a posture with no exit status: {posture!r}")


def case_defects(case: Any, record: dict[str, Any]) -> list[str]:
    """Everything one run did that its own ledger row did not describe.

    Posture, output naming and directory contents, checked per case rather than
    summarized. The old driver copied `posture` into the report and compared it
    for two of twenty-nine cases; naming and directory contents were counted but
    never held against what the row asked for.
    """
    found: list[str] = []
    if record["exit"] != record["expected_exit"]:
        found.append(
            f"{case.case} exited {record['exit']} against its declared posture "
            f"{case.posture!r}"
        )
    produced = record.get("output_name")
    if case.output_name is not None and produced != case.output_name:
        found.append(
            f"{case.case} asked for {case.output_name!r} and produced {produced!r}"
        )
    if produced is not None and not produced.lower().endswith(
        f".{case.output_format.lower()}"
    ):
        found.append(
            f"{case.case} declares {case.output_format} and produced {produced!r}"
        )
    entries = record["directory_entries"]
    if entries != ([produced] if produced is not None else []):
        found.append(
            f"{case.case} left {entries!r} in its output directory, not exactly its "
            f"one output"
        )
    inspected = record.get("inspected")
    if inspected is not None and inspected["format"] != case.output_format:
        found.append(
            f"{case.case} declares {case.output_format} and its output reads as "
            f"{inspected['format']}"
        )
    return found


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
        # The run-level declaration, carried beside the count actually written.
        # A report that held only one of the two could not distinguish a short
        # document from an honest one.
        "declared_spectrum_count": facts["declared_spectrum_count"],
        "defects": facts["defects"],
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


def declared_int(value: Any) -> int | None:
    """A declared length as a number, or `None` where the document did not give one.

    Reported as a disagreement rather than raised. A driver that crashes on a
    malformed attribute stops the run instead of recording the defect.
    """
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def spectrum_ids(work: Path, case: str) -> list[str]:
    document = next((work / "out" / case).glob("*.mz*"))
    return [s["id"] for s in EV.inspect(document)["spectra"]]


def verify(results: dict[str, dict[str, Any]], work: Path) -> list[dict[str, Any]]:
    """Every claim the record makes that a rerun can independently re-answer.

    M6.2 recorded exactly what this function was and was not. Its thirty-three
    checks were the confirmations that slice had to reproduce; they were not the
    bases its classifications rested on, and review enumerated gap after gap --
    a picker check reading one spectrum and one array, MS-level checks comparing
    ids and not values, `P1` and `P2` run and never shaped, `K5`/`K6` and `K12`
    run and never compared, compression read from one array of one spectrum, and
    a posture copied into the report rather than compared.

    Every one of those is closed here, and closed the same way: over **every**
    relevant spectrum and **both** arrays, against two references computed from
    the fixture rather than from the output -- the source `float64` value and its
    exact `binary32` image. An equality taken over an empty array would pass
    vacuously, so every array a comparison reads is recorded and an empty one is
    a disagreement in its own right.
    """
    import struct

    def f32(value: float) -> float:
        return struct.unpack("<f", struct.pack("<f", value))[0]

    plan = EV.spectra_plan()
    unflanked = EV.spectra_plan(flanked=False)
    checks: list[dict[str, Any]] = []
    empty: list[str] = []

    def note(name: str, expected: Any, observed: Any) -> None:
        checks.append(
            {
                "check": name,
                "expected": expected,
                "observed": observed,
                "agrees": expected == observed,
            }
        )

    def values(case: str, index: int, kind: str) -> list[float]:
        """One decoded array, with an empty one recorded rather than compared.

        This is the non-vacuity rule. `all(x == y for ...)` over arrays that
        decoded to nothing is a universal quantifier over an empty set, and it
        agrees with anything.
        """
        got = decoded(work, case, index, kind)
        if not got:
            empty.append(f"{case}[{index}].{kind}")
        return got

    def ids(case: str) -> list[str]:
        """Surviving spectrum ids, with an empty document recorded rather than compared.

        The same non-vacuity rule `values()` applies. Two documents that returned
        no spectra at all agree with each other, and an equality between them
        would read as a measurement.
        """
        found = spectrum_ids(work, case)
        if not found:
            empty.append(f"{case}.spectra")
        return found

    def source(index: int, kind: str) -> list[float]:
        return list(plan[index]["mz" if kind == "mz" else "intensity"])

    def shape(case: str, kind: str) -> str:
        """Which of the two independent references a whole document equals."""
        got = [values(case, i, kind) for i in range(len(plan))]
        exact = all(got[i] == source(i, kind) for i in range(len(plan)))
        narrowed = all(
            got[i] == [f32(v) for v in source(i, kind)] for i in range(len(plan))
        )
        return "exact float64" if exact else ("float32 image" if narrowed else "neither")

    # ---------------------------------------------------------------- precision
    #
    # Every declared posture, both arrays. `P1` and `P2` were run by the old
    # driver and shaped by nothing.
    for case, expected_mz, expected_intensity in (
        ("D1", "exact float64", "float32 image"),
        ("P4", "exact float64", "exact float64"),
        ("P3", "float32 image", "float32 image"),
        ("P1", "exact float64", "exact float64"),
        ("P2", "float32 image", "float32 image"),
        ("P5", "float32 image", "exact float64"),
    ):
        note(f"{case}, m/z", expected_mz, shape(case, "mz"))
        note(f"{case}, intensity", expected_intensity, shape(case, "intensity"))

    # ------------------------------------------------------------- compression
    #
    # Across every array of every spectrum rather than the first array of the
    # first spectrum, which is what the old check read.
    def declared_compression(case: str) -> list[str]:
        return sorted(
            {
                array["compression"]
                for spectrum in results[case]["inspected"]["spectra"]
                for array in spectrum["arrays"]
            }
        )

    note("compression default declared, every array", ["zlib"], declared_compression("D1"))
    note("--zlib declared, every array", ["zlib"], declared_compression("C1"))
    note("--zlib=off declared, every array", ["none"], declared_compression("C2"))
    note(
        "zlib on and off decode identically at fixed precision",
        True,
        all(
            values("C1", i, kind) == values("C2", i, kind)
            for i in range(len(plan))
            for kind in ("mz", "intensity")
        ),
    )

    # --------------------------------------------------------- MS-level population
    #
    # The surviving spectra compared by value in both arrays, not by id alone.
    every_id = [str(entry["id"]) for entry in plan]
    note("MS1 only keeps", ["scan=1", "scan=3"], ids("L1"))
    note("MS2 only keeps", ["scan=2", "scan=4"], ids("L2"))
    # Anchored to the fixture as well as to each other, for the same reason the
    # order pair is: two documents that both lost everything agree.
    note("explicit all keeps every spectrum", every_id, ids("L4"))
    note("omitted all matches explicit all", ids("L3"), ids("L4"))
    for case, kept in (("L1", (0, 2)), ("L2", (1, 3))):
        note(
            f"{case} retains both arrays of every surviving spectrum unchanged",
            True,
            all(
                values(case, position, kind) == source(index, kind)
                for position, index in enumerate(kept)
                for kind in ("mz", "intensity")
            ),
        )

    # ------------------------------------------------------------- peak picking
    #
    # The apexes are derived from the fixture plan rather than from any output:
    # each profile peak is one contiguous block whose middle point is its
    # maximum, so the reference is a fact about the source.
    span = len(EV.PROFILE_OFFSETS)

    def source_apexes(index: int) -> list[tuple[float, float]]:
        mz = source(index, "mz")
        intensity = source(index, "intensity")
        return [
            (mz[start + span // 2], intensity[start + span // 2])
            for start in range(0, len(mz), span)
        ]

    def nonzero(case: str, index: int) -> list[tuple[float, float]]:
        mz = values(case, index, "mz")
        intensity = values(case, index, "intensity")
        return [(m, v) for m, v in zip(mz, intensity) if v != 0.0]

    note(
        "the default picker recovers every apex, m/z and intensity, in every spectrum",
        [source_apexes(i) for i in range(len(plan))],
        [nonzero("K1", i) for i in range(len(plan))],
    )
    note(
        "cwt returns one peak of the three-peak spectrum",
        1,
        len(nonzero("K2", 2)),
    )
    note(
        "vendor produces the default picker's arrays",
        [values("K1", i, k) for i in range(len(plan)) for k in ("mz", "intensity")],
        [values("K3", i, k) for i in range(len(plan)) for k in ("mz", "intensity")],
    )
    note(
        "vendor request on an open source is recorded as the local-maximum picker",
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
    # `K8` is what makes `K7` a fact about the algorithm rather than about the
    # fixture, so its output is read rather than only its exit status.
    note(
        "the default picker centroids every spectrum of the unflanked fixture",
        (len(unflanked), [True] * len(unflanked)),
        (
            results["K8"]["inspected"]["spectrum_count"],
            [s["centroided"] for s in results["K8"]["inspected"]["spectra"]],
        ),
    )
    # `K10` ran in every prior round and was compared by nobody. Its scope names
    # both levels, so unlike `K4` it must centroid all of them -- and on this
    # fixture `cwt` must lose the same peaks it loses in `K2`.
    note(
        "an explicit 1-2 scope centroids both levels",
        [True, True, True, True],
        [s["centroided"] for s in results["K10"]["inspected"]["spectra"]],
    )
    note(
        "cwt under an explicit scope returns what cwt returns",
        [values("K2", i, k) for i in range(len(plan)) for k in ("mz", "intensity")],
        [values("K10", i, k) for i in range(len(plan)) for k in ("mz", "intensity")],
    )

    # ------------------------------------------------------ interaction and ordering
    #
    # `K5`/`K6` and `K12` were both run by the old driver and compared by nobody.
    # Anchored to the fixture on both sides, not only to each other. Compared
    # against each other alone, "the order does not matter" and "neither filter
    # did anything" are the same observation: if `msLevel 2` stopped filtering,
    # both would return all four spectra and both checks would agree.
    ms2_ids = ["scan=2", "scan=4"]
    note("K5 keeps exactly the MS2 spectra", ms2_ids, ids("K5"))
    note("K6 keeps exactly the MS2 spectra", ms2_ids, ids("K6"))
    order_pair = range(len(ms2_ids))
    note(
        "the order pair returns the same values in both arrays",
        [values("K5", i, k) for i in order_pair for k in ("mz", "intensity")],
        [values("K6", i, k) for i in order_pair for k in ("mz", "intensity")],
    )
    # Anchored to an independent result, because the comparison above holds just
    # as well if the picker silently did nothing on both sides. `K2` runs the
    # same `peakPicking cwt` over the whole document, so its MS2 spectra are what
    # a correctly composed K5 and K6 must contain -- the population filter
    # selects them, the picker decides their contents, and only this check reads
    # the second half.
    ms2_from_k2 = [values("K2", i, k) for i in (1, 3) for k in ("mz", "intensity")]
    for case in ("K5", "K6"):
        note(
            f"{case} carries the picker's MS2 spectra, not the source's",
            ms2_from_k2,
            [values(case, i, k) for i in order_pair for k in ("mz", "intensity")],
        )
    note(
        "and the picker changed those spectra",
        True,
        ms2_from_k2 != [source(i, k) for i in (1, 3) for k in ("mz", "intensity")],
    )
    note(
        "a global --32 narrows what a filter rewrote, every value",
        [[f32(v) for v in values("K1", i, k)] for i in range(len(plan)) for k in ("mz", "intensity")],
        [values("K12", i, k) for i in range(len(plan)) for k in ("mz", "intensity")],
    )
    note(
        "K12 declares 32 bits on every array",
        [32],
        sorted(
            {
                array["bits"]
                for spectrum in results["K12"]["inspected"]["spectra"]
                for array in spectrum["arrays"]
            }
        ),
    )
    note(
        "K12 keeps K1's entry counts",
        [s["declared_length"] for s in results["K1"]["inspected"]["spectra"]],
        [s["declared_length"] for s in results["K12"]["inspected"]["spectra"]],
    )

    # -------------------------------------------------------------------- mzXML
    #
    # The run-level declaration read beside the elements actually written, which
    # is the check the old harness did not have and the reason `X2`'s drop
    # reproduced while its misdeclaration did not.
    note("mzXML single-source keeps", 4, results["X1"]["inspected"]["spectrum_count"])
    note("mzXML multi-source keeps", 2, results["X2"]["inspected"]["spectrum_count"])
    note("mzML control on the same document keeps", 4, results["X3"]["inspected"]["spectrum_count"])
    note("mzXML multi-source survivors", ["1", "4"], ids("X2"))
    note(
        "mzXML multi-source declares a scan count it did not write",
        ("4", 2),
        (
            results["X2"]["inspected"]["declared_spectrum_count"],
            results["X2"]["inspected"]["spectrum_count"],
        ),
    )
    note(
        "the single-source mzXML cases declare what they wrote",
        [(str(4), 4)] * 3,
        [
            (
                results[case]["inspected"]["declared_spectrum_count"],
                results[case]["inspected"]["spectrum_count"],
            )
            for case in ("X1", "X4", "X5")
        ],
    )
    # The two unfiltered single-source mzXML cases, both compared against the
    # fixture. `X5` is deliberately absent: it runs a picker, so its arrays are
    # the picked apexes and its point counts are `4, 1, 7, 1` rather than the
    # source's `14, 7, 21, 7`. Reading it as faithful would be reading the
    # picker's output as the source's.
    for case in ("X1", "X4"):
        note(
            f"{case} preserves both arrays of every spectrum exactly",
            True,
            all(
                values(case, i, kind) == source(i, kind)
                for i in range(len(plan))
                for kind in ("mz", "intensity")
            ),
        )
    note(
        "X5 carries the picker's apexes, m/z and intensity, not the source's points",
        [source_apexes(i) for i in range(len(plan))],
        [nonzero("X5", i) for i in range(len(plan))],
    )
    # The declared lengths, on both sides of the comparison the record makes:
    # `X1` carries the source's point counts and `X5` carries the picker's. The
    # surplus of `X5`'s over its apex counts is the default picker's
    # zero-intensity padding, which is why the two figures differ and why the
    # record states both.
    #
    # An earlier revision named this check for `X5` and read `X1`, so both sides
    # held the source's numbers and it could not fail -- the exact shape it was
    # added to guard against.
    def declared(case: str) -> list[int | None]:
        return [
            declared_int(spectrum["declared_length"])
            for spectrum in results[case]["inspected"]["spectra"]
        ]

    note(
        "X1 declares the source's point counts",
        [len(source(i, "mz")) for i in range(len(plan))],
        declared("X1"),
    )
    # The one literal here, and it is deliberate: this is the figure the record
    # states about `X5`, so the check is against the record rather than against
    # another derivation of the same output.
    note("X5 declares the picker's, and they are the record's", [4, 1, 7, 1], declared("X5"))
    note(
        "X5's apex counts sit under its declared lengths, the surplus being padding",
        [True] * len(plan),
        [len(source_apexes(i)) <= (declared("X5")[i] or 0) for i in range(len(plan))],
    )

    # ------------------------------------------------- structural health per case
    #
    # A document whose numbers agree is not thereby a well-formed document. Every
    # case that parsed is required to carry no structural defect, and the one
    # document that legitimately does carries exactly the defect it is evidence
    # of.
    # The complement of the check below, and the reason it is here: the health
    # check reads only cases that produced an `inspected` block, so a second case
    # whose output stopped parsing would be dropped from it silently and the run
    # would still report agreement.
    note(
        "K7 is the only case whose output does not read back",
        ["K7"],
        sorted(
            result["case"] for result in results.values() if not result.get("inspected")
        ),
    )
    note(
        "every parsed output but X2 is structurally clean",
        [],
        sorted(
            result["case"]
            for result in results.values()
            if result.get("inspected")
            and result["case"] != "X2"
            and result["inspected"]["defects"]
        ),
    )
    note(
        "X2's only structural defect is its run-level misdeclaration",
        ["msRun declares scanCount=4 over 2 scan elements"],
        results["X2"]["inspected"]["defects"],
    )
    note(
        "the unflanked fixture converts cleanly with no filter",
        (
            len(unflanked),
            [False] * len(unflanked),
            [len(entry["mz"]) for entry in unflanked],
        ),
        (
            results["K9"]["inspected"]["spectrum_count"],
            [s["centroided"] for s in results["K9"]["inspected"]["spectra"]],
            [int(s["declared_length"]) for s in results["K9"]["inspected"]["spectra"]],
        ),
    )
    note("the refused run's output does not parse", "ParseError", results["K7"].get("inspect_error"))

    # ----------------------------------------------------- posture, naming, set
    note(
        "every case's exit, output name and directory contents match its row",
        [],
        [
            defect
            for case in EV.CASES
            for defect in case_defects(case, results[case.case])
        ],
    )
    # Derived from the ledger on one side and from what was actually written on
    # the other. Comparing the ledger's derivation against a copy of itself --
    # which is what reading `result["output_format"]` did -- could not fail.
    note("mzXML-producing cases", list(EV.mzxml_cases()), sorted(
        result["case"]
        for result in results.values()
        if str(result.get("output_name", "")).lower().endswith(".mzxml")
    ))
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

    note("no comparison above was taken over an empty array", [], sorted(set(empty)))
    # Every ledger case reached a process and came back with a result. Comparing
    # `len(EV.CASES)` against the length of a dict built by iterating `EV.CASES`
    # could not fail; comparing the ids against the outputs that exist can.
    note(
        "every ledger case ran and produced a document",
        [case.case for case in EV.CASES],
        sorted(
            (result["case"] for result in results.values() if "output_name" in result),
            key=[case.case for case in EV.CASES].index,
        ),
    )
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
        # The process working directory, pinned and created empty.
        #
        # Counting entries in `--outdir` cannot see a file written beside the
        # *caller* instead, which is a different place and an easy one to miss.
        # M6.2 asked that question by running the whole set from a directory made
        # for the purpose and recorded that the driver did not pin it; it does
        # now, and the report is written outside every directory the provider is
        # observed in so that the driver's own file is not one of the entries
        # this measurement is about.
        provider_cwd = work / "cwd"
        provider_cwd.mkdir()
        # The report is outside this directory structurally rather than by a
        # check: `work` is a temporary tree created a line ago under a random
        # name, so no `--report` path an operator can type is inside it. An
        # assertion here would be unfalsifiable, and `python -O` would strip it
        # anyway -- neither is evidence. If a `--work` option is ever added, the
        # property stops being structural and needs a real check.
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

        results = {
            case.case: run_case(case, msconvert, fixtures, work, provider_cwd)
            for case in EV.CASES
        }
        checks = verify(results, work)
        # Asked after the whole set rather than per case: a provider that wrote
        # beside its caller once would leave the entry there for the rest of the
        # run, and one enumeration of a directory nothing else touched is the
        # complete answer.
        working_directory_entries = sorted(path.name for path in provider_cwd.iterdir())
        checks.append(
            {
                "check": "the provider wrote nothing to its own working directory",
                "expected": [],
                "observed": working_directory_entries,
                "agrees": working_directory_entries == [],
            }
        )
        after = executable_identity(msconvert)

    disagreed = [check for check in checks if not check["agrees"]]
    report = {
        "case_count": len(results),
        "mzxml_cases": list(EV.mzxml_cases()),
        "fixtures": fixture_facts,
        "executable_before": before,
        "executable_after": after,
        "executable_stable": before == after,
        "working_directory_entries": working_directory_entries,
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
