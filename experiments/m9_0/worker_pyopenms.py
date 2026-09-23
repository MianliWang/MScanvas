#!/usr/bin/env python3
"""M9.0 route A: a fixed pyOpenMS adapter for targeted MS1 signal/candidate detection.

Invoked only by ``controller.py`` with a fixed argv::

    python.exe -X utf8 -I worker_pyopenms.py <request.json> <staging-dir>

It reads one typed request, refuses anything outside the declared domain before
the engine sees it, runs ``FeatureFinderAlgorithmMetaboIdent`` with the fixed
profile below, and writes its result into the staging directory. It never
publishes: publication is the controller's decision. Every run ends with an
``outcome.json`` whose status is ``completed``, ``refused`` or ``failed``; a
missing outcome means the process did not finish.

The request carries no command, class path, expression or free parameter bag;
the engine configuration is fixed here and recorded in full in every result.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import math
import os
import re
import sys
import time
from ctypes import wintypes
from pathlib import Path
from xml.parsers import expat

MZML_NS = "http://psi.hupo.org/ms/mzml"

EXIT_COMPLETED, EXIT_REFUSED, EXIT_FAILED = 0, 3, 4
T0 = time.perf_counter()


class Stop(Exception):
    def __init__(self, status: str, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def refuse(code: str, message: str) -> Stop:
    return Stop("refused", code, message)


def fail(code: str, message: str) -> Stop:
    return Stop("failed", code, message)


class Staging:
    def __init__(self, root: Path):
        self.root = root
        self.events = open(root / "events.jsonl", "a", encoding="utf-8", newline="\n")

    def event(self, phase: str, **extra) -> None:
        self.events.write(json.dumps({"t_s": round(time.perf_counter() - T0, 4), "phase": phase, **extra}) + "\n")
        self.events.flush()

    def write_json(self, name: str, value) -> None:
        data = json.dumps(value, indent=1, allow_nan=False) + "\n"
        (self.root / name).write_text(data, encoding="utf-8", newline="\n")


# ------------------------------------------------------------------ request


def _reject_constant(token: str):
    raise refuse("REQUEST_INVALID", f"non-finite number {token} in request")


def _finite(value, what: str, low: float | None = None, high: float | None = None, low_open: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise refuse("REQUEST_INVALID", f"{what} must be a finite number")
    if low is not None and (value <= low if low_open else value < low):
        raise refuse("PARAMETER_OUT_OF_DOMAIN", f"{what}={value} is below the admitted range")
    if high is not None and value > high:
        raise refuse("PARAMETER_OUT_OF_DOMAIN", f"{what}={value} is above the admitted range")
    return float(value)


FORMULA = re.compile(r"(?:[A-Z][a-z]?\d*)+")
TARGET_ID = re.compile(r"[^\x00-\x1f\x7f]{1,64}")


def load_request(path: Path) -> dict:
    try:
        req = json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)
    except Stop:
        raise
    except (OSError, ValueError) as exc:
        raise refuse("REQUEST_INVALID", f"request is not strict JSON: {exc}") from None
    if req.get("schema") != "mscanvas.m9_0.targeted_ms1.request/0":
        raise refuse("REQUEST_INVALID", "unknown request schema")
    if set(req) - {"schema", "run_id", "source", "targets", "parameters", "experiment"}:
        raise refuse("REQUEST_INVALID", "unknown request field")
    params = req.get("parameters", {})
    if set(params) != {"mz_half_width_ppm", "expected_peak_width_s"}:
        raise refuse("REQUEST_INVALID", "parameters must be exactly mz_half_width_ppm and expected_peak_width_s")
    # The engine reads a window below 1 as Da/Th rather than ppm, so a full window
    # under 1 ppm (half-width under 0.5 ppm) would silently change unit.
    _finite(params["mz_half_width_ppm"], "mz_half_width_ppm", 0.5, 50.0)
    _finite(params["expected_peak_width_s"], "expected_peak_width_s", 0.0, 600.0, low_open=True)
    targets = req.get("targets")
    if not isinstance(targets, list) or not 1 <= len(targets) <= 1000:
        raise refuse("REQUEST_INVALID", "targets must be a list of 1..1000 entries")
    seen = set()
    for t in targets:
        if set(t) != {"target_id", "formula", "neutral_mass", "charge", "rt_s", "rt_half_width_s"}:
            raise refuse("REQUEST_INVALID", "target fields must be exactly the declared six")
        if not isinstance(t["target_id"], str) or not TARGET_ID.fullmatch(t["target_id"]):
            raise refuse("TARGET_INVALID", "target_id must be 1..64 printable characters")
        if t["target_id"] in seen:
            raise refuse("DUPLICATE_TARGET", "target_id values must be unique")
        seen.add(t["target_id"])
        if not isinstance(t["formula"], str) or not FORMULA.fullmatch(t["formula"]):
            raise refuse("TARGET_INVALID", f"formula of {t['target_id']!r} is not a plain sum formula")
        if t["neutral_mass"] is not None:
            _finite(t["neutral_mass"], "neutral_mass", 0.0, 5000.0, low_open=True)
        if t["charge"] != 1 or isinstance(t["charge"], bool):
            raise refuse("PARAMETER_OUT_OF_DOMAIN", "only charge +1 ([M+H]+) is in the measured domain")
        _finite(t["rt_s"], "rt_s", 0.0)
        # A zero range would make the engine substitute its global window silently.
        _finite(t["rt_half_width_s"], "rt_half_width_s", 0.0, 3600.0, low_open=True)
    src = req.get("source", {})
    if set(src) != {"path", "bytes", "sha256"} or not re.fullmatch(r"[0-9a-f]{64}", str(src.get("sha256"))):
        raise refuse("REQUEST_INVALID", "source must name path, bytes and sha256")
    exp = req.get("experiment", {})
    if set(exp) - {"capture_candidates", "accept_profile", "accept_duplicate_rt"}:
        raise refuse("REQUEST_INVALID", "unknown experiment flag")
    return req


def count_spectra(path: Path) -> int:
    """Count mzML spectrum elements by namespace, independently of the engine's reader."""
    count = 0

    def start(name, _attrs):
        nonlocal count
        count += name == f"{MZML_NS} spectrum"

    parser = expat.ParserCreate(namespace_separator=" ")
    parser.StartElementHandler = start
    try:
        with open(path, "rb") as f:
            parser.ParseFile(f)
    except expat.ExpatError:
        return -1
    return count


def digest(path: Path) -> tuple[int, str]:
    h, n = hashlib.sha256(), 0
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
            n += len(chunk)
    return n, h.hexdigest()


# ------------------------------------------------------------------ runtime identity


def loaded_modules() -> list[dict]:
    psapi, kernel32 = ctypes.WinDLL("psapi"), ctypes.WinDLL("kernel32")
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.EnumProcessModules.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.HMODULE), wintypes.DWORD,
                                         ctypes.POINTER(wintypes.DWORD)]
    psapi.GetModuleFileNameExW.argtypes = [wintypes.HANDLE, wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    proc = kernel32.GetCurrentProcess()
    mods = (wintypes.HMODULE * 2048)()
    needed = wintypes.DWORD()
    psapi.EnumProcessModules(proc, mods, ctypes.sizeof(mods), ctypes.byref(needed))
    out = []
    for h in mods[: needed.value // ctypes.sizeof(wintypes.HMODULE)]:
        buf = ctypes.create_unicode_buffer(1024)
        psapi.GetModuleFileNameExW(proc, h, buf, 1024)
        out.append(buf.value)
    return sorted(out, key=str.lower)


def runtime_identity(oms) -> dict:
    runtime_dir = Path(sys.executable).parent
    mods = loaded_modules()
    key = [m for m in mods if Path(m).name.lower() in {"openms.dll", "openswathalgo.dll", "qt6core.dll",
                                                       "vcruntime140.dll", "msvcp140.dll", "python313.dll"}]
    return {
        "python": {"version": sys.version, "executable": sys.executable, "flags": {
            "isolated": sys.flags.isolated, "ignore_environment": sys.flags.ignore_environment,
            "no_user_site": sys.flags.no_user_site, "utf8_mode": sys.flags.utf8_mode}, "path": sys.path},
        "pyopenms": {"version": oms.__version__, "file": oms.__file__},
        "openms": {"version": oms.VersionInfo.getVersion(), "revision": oms.VersionInfo.getRevision(),
                   "build_time": oms.VersionInfo.getTime()},
        "environment": {k: os.environ.get(k) for k in ("OPENMS_DATA_PATH", "OPENMS_HOME_PATH", "OMP_NUM_THREADS",
                                                        "PATH", "TEMP", "TMP")},
        "key_modules": [{"path": m, "bytes": os.path.getsize(m), "sha256": digest(Path(m))[1]} for m in key],
        "modules_outside_runtime_or_system": [m for m in mods if not m.lower().startswith(
            (str(runtime_dir).lower(), os.environ.get("SYSTEMROOT", r"C:\Windows").lower()))],
        "module_count": len(mods),
    }


# ------------------------------------------------------------------ engine


def profile(params: dict, targets: list[dict], candidates_out: str) -> dict:
    return {
        "candidates_out": candidates_out,
        "extract:mz_window": 2 * params["mz_half_width_ppm"],
        "extract:rt_window": 2 * max(t["rt_half_width_s"] for t in targets),
        "extract:n_isotopes": 2,
        "extract:isotope_pmin": 0.0,
        "detect:peak_width": params["expected_peak_width_s"],
        "detect:min_peak_width": 0.2,
        "detect:signal_to_noise": 0.8,
        "model:type": "symmetric",
        "model:no_imputation": "false",
        "EMGScoring:max_iteration": 100,  # the TOPP tool's two overrides of the algorithm defaults
        "EMGScoring:init_mom": "true",
    }


def check_source(oms, exp, accept_profile: bool, accept_duplicate_rt: bool) -> list:
    ms1 = [s for s in exp if s.getMSLevel() == 1]
    if not ms1:
        raise refuse("SOURCE_NO_MS1", "the source contains no MS1 spectrum")
    centroid = oms.SpectrumSettings.SpectrumType.CENTROID
    if not accept_profile and any(s.getType() != centroid for s in ms1):
        raise refuse("SOURCE_NOT_CENTROID", "every MS1 spectrum must be declared centroided; none is converted")
    polarities = {s.getInstrumentSettings().getPolarity() for s in ms1}
    if len(polarities) > 1:
        raise refuse("SOURCE_MIXED_POLARITY", "MS1 spectra declare more than one polarity")
    if polarities != {oms.IonSource.Polarity.POSITIVE}:
        raise refuse("SOURCE_POLARITY_UNSUPPORTED", "only positive-mode MS1 is in the measured domain")
    previous = -math.inf
    for s in ms1:
        rt = s.getRT()
        if not math.isfinite(rt) or rt < 0 or rt < previous:
            raise refuse("SOURCE_RT_UNDECLARED_OR_NONMONOTONIC",
                         f"MS1 retention time of {s.getNativeID()} is {rt}, after {previous}")
        # Round one measured a silent false negative when two MS1 spectra share a
        # retention time inside a peak, so equal times are refused, not reported.
        if rt == previous and not accept_duplicate_rt:
            raise refuse("SOURCE_RT_NOT_STRICTLY_INCREASING",
                         f"MS1 spectra share the retention time {rt} ({s.getNativeID()})")
        previous = rt
        if s.getDriftTime() >= 0 or s.getFloatDataArrays():
            raise refuse("SOURCE_ION_MOBILITY_UNSUPPORTED", "ion mobility or extra arrays are outside the domain")
        if not s.isSorted():
            raise refuse("SOURCE_UNSORTED_MZ", f"{s.getNativeID()} has unsorted m/z")
        mz, inten = s.get_peaks()
        if not all(math.isfinite(v) for v in mz) or not all(math.isfinite(v) for v in inten):
            raise refuse("SOURCE_NONFINITE", f"{s.getNativeID()} carries a non-finite value")
    return ms1


def meta(obj, key: str):
    if not obj.metaValueExists(key):
        return None
    value = obj.getMetaValue(key)
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, list):
        return [v.decode("utf-8") if isinstance(v, bytes) else v for v in value]
    return value


def finite_or_none(value):
    return value if isinstance(value, (int, float)) and math.isfinite(value) else None


def feature_record(f) -> dict:
    status = meta(f, "model_status") or "none"
    if status.startswith("0"):
        source = "model_area"
    else:
        source = "imputed_from_run_regression"  # model:no_imputation is false in the fixed profile
    return {
        "rt_s": f.getRT(), "left_s": meta(f, "leftWidth"), "right_s": meta(f, "rightWidth"),
        "raw_area": meta(f, "raw_intensity"),
        "model": {"status": status, "area": finite_or_none(meta(f, "model_area")),
                  "fwhm_s": finite_or_none(meta(f, "model_FWHM"))},
        "engine_intensity": finite_or_none(f.getIntensity()),
        "engine_intensity_finite": math.isfinite(f.getIntensity()),
        "engine_intensity_source": source,
        "mz_reported": f.getMZ(),  # the theoretical PrecursorMZ, not an observed m/z
    }


def run(req: dict, staging: Staging) -> dict:
    src = Path(req["source"]["path"])
    try:
        before = digest(src)
    except OSError as exc:
        raise fail("SOURCE_UNREADABLE", f"cannot read the source: {exc.strerror}") from None
    if before != (req["source"]["bytes"], req["source"]["sha256"]):
        raise refuse("SOURCE_CHANGED", "the source content is not the version the plan names")
    staging.event("import_engine")
    import pyopenms as oms  # noqa: PLC0415 -- deliberately after the request is admitted

    for t in req["targets"]:
        try:
            ef = oms.EmpiricalFormula(t["formula"])
        except Exception:  # noqa: BLE001 -- the binding raises RuntimeError subclasses
            raise refuse("TARGET_INVALID", f"the engine cannot parse the formula of {t['target_id']!r}") from None
        if ef.getMonoWeight() <= 0:
            raise refuse("TARGET_INVALID", f"formula of {t['target_id']!r} has no mass")
    staging.event("load_source")
    exp = oms.MSExperiment()
    try:
        oms.MzMLFile().load(str(src), exp)
    except Exception as exc:  # noqa: BLE001
        raise fail("SOURCE_UNREADABLE", f"the mzML reader failed: {str(exc)[:300]}") from None
    if digest(src) != before:
        raise refuse("SOURCE_CHANGED_DURING_READ", "the source changed while it was read")
    # The reader returns an empty experiment, without error, for a legal
    # namespace-prefixed document; an independent count catches any short read.
    declared = count_spectra(src)
    if declared != exp.size():
        raise fail("SOURCE_READ_INCOMPLETE", f"the reader returned {exp.size()} of {declared} spectra")
    exp_index = {s.getNativeID(): i for i, s in enumerate(exp)}
    flags = req.get("experiment", {})
    ms1 = check_source(oms, exp, flags.get("accept_profile", False), flags.get("accept_duplicate_rt", False))

    staging.event("engine_run")
    capture = req.get("experiment", {}).get("capture_candidates", True)
    cand_path = staging.root / "candidates.featureXML"
    ff = oms.FeatureFinderAlgorithmMetaboIdent()
    params = ff.getParameters()
    for key, value in profile(req["parameters"], req["targets"], str(cand_path) if capture else "").items():
        params.setValue(key, value)
    ff.setParameters(params)
    compounds = [oms.FeatureFinderMetaboIdentCompound(
        t["target_id"], t["formula"], t["neutral_mass"] or 0.0, [1], [t["rt_s"]], [2 * t["rt_half_width_s"]], [0.0])
        for t in req["targets"]]
    ff.setMSData(exp)
    fmap = oms.FeatureMap()
    try:
        ff.run(compounds, fmap, str(src))
    except Exception as exc:  # noqa: BLE001
        if capture and cand_path.exists():
            empty = oms.FeatureMap()
            oms.FeatureXMLFile().load(str(cand_path), empty)
            if empty.size() == 0:  # measured: the engine raises when no target has any candidate
                raise fail("ENGINE_NO_CANDIDATES", "no target produced a candidate; the engine cannot "
                           "report an all-absent run") from None
        raise fail("ENGINE_ERROR", f"the engine raised: {str(exc)[:300]}") from None
    staging.event("collect")
    resolved = ff.getParameters()
    engine_parameters = {(k.decode() if isinstance(k, bytes) else k): resolved.getValue(k) for k in resolved.keys()}

    # Assay identity: the library compound whose `name` is the target_id.
    library = ff.getLibrary()
    assay_of, ion_of = {}, {}
    for c in library.getCompounds():
        assay_of[meta(c, "name")] = c.id.decode() if isinstance(c.id, bytes) else c.id
    for tr in library.getTransitions():
        ref = tr.getCompoundRef()
        ref = ref.decode() if isinstance(ref, bytes) else ref
        ion_of.setdefault(ref, []).append((tr.getNativeID(), tr.getProductMZ(), tr.getLibraryIntensity()))
    chroms = {}
    for ch in ff.getChromatograms().getChromatograms():
        rt, inten = ch.get_peaks()
        nid = ch.getNativeID()
        chroms[nid.decode() if isinstance(nid, bytes) else nid] = (list(map(float, rt)), list(map(float, inten)))

    candidates = None
    if capture:
        cmap = oms.FeatureMap()
        oms.FeatureXMLFile().load(str(cand_path), cmap)
        candidates = {}
        for f in cmap:
            candidates.setdefault(meta(f, "PeptideRef"), []).append(
                {"rt_s": f.getRT(), "left_s": meta(f, "leftWidth"), "right_s": meta(f, "rightWidth"),
                 "raw_area": f.getIntensity()})

    features = list(fmap)
    by_ref, alt_of, suppressed_by = {}, {}, {}
    for f in features:
        ref = meta(f, "PeptideRef")
        by_ref[ref] = f
        for alt in meta(f, "alt_PeptideRef") or []:
            alt_of[alt] = ref
        for removed in meta(f, "overlap_removed") or []:
            suppressed_by.setdefault(removed.rsplit(" (RT ", 1)[0], ref)
    unassigned = {meta(u, "PeptideRef") for u in fmap.getUnassignedPeptideIdentifications()}
    target_of_ref = {v: k for k, v in assay_of.items()}

    rows, evidence = [], []
    for t in req["targets"]:
        tid = t["target_id"]
        ref = assay_of.get(tid)
        row = {"target_id": tid, "assay_ref": ref, "outcome": "FAILED", "ion": None, "windows": None,
               "signal": None, "feature": None, "candidates": None, "relations": {}}
        rows.append(row)
        if ref is None or ref not in ion_of:
            row["relations"]["failure"] = "target absent from the engine library"
            continue
        traces = sorted(ion_of[ref], key=lambda x: x[1])
        half_da = [mz * 2 * req["parameters"]["mz_half_width_ppm"] / 2.0 * 1.0e-6 for _, mz, _ in traces]
        start, end = t["rt_s"] - t["rt_half_width_s"], t["rt_s"] + t["rt_half_width_s"]
        row["ion"] = {"charge": 1, "adduct": "[M+H]+", "mz": [mz for _, mz, _ in traces],
                      "isotope_probability": [p for _, _, p in traces]}
        row["windows"] = {"rt_closed_s": [start, end],
                          "mz_open": [[mz - h, mz + h] for (_, mz, _), h in zip(traces, half_da)]}
        # Map chromatogram points to spectra the way the extractor visits them:
        # MS1 in file order, empty spectra skipped, closed RT interval.
        visited = [s for s in ms1 if s.size() > 0 and start <= s.getRT() <= end]
        sums, maxima = [], []
        for trace, (nid, mz, _) in enumerate(traces):
            nid = nid.decode() if isinstance(nid, bytes) else nid
            rts, values = chroms.get(nid, ([], []))
            if len(rts) != len(visited) or any(r != s.getRT() for r, s in zip(rts, visited)):
                raise fail("EVIDENCE_MAPPING_MISMATCH", f"chromatogram {nid} does not map onto the visited spectra")
            evidence.append({"target_id": tid, "trace": trace, "mz": mz,
                             "points": [[exp_index[s.getNativeID()], s.getNativeID(), r, v]
                                        for s, r, v in zip(visited, rts, values)]})
            sums.append(math.fsum(values))
            maxima.append(max(values, default=0.0))
        row["signal"] = {"points": len(visited), "sum": sums, "max": maxima, "in_window": any(m > 0 for m in maxima)}
        row["candidates"] = None if candidates is None else candidates.get(ref, [])
        own = by_ref.get(ref)
        shared_into = alt_of.get(ref)
        if own is not None:
            row["feature"] = feature_record(own)
            alts = meta(own, "alt_PeptideRef") or []
            if alts:
                row["outcome"] = "SHARED"
                row["relations"]["shared_with"] = [target_of_ref.get(a, a) for a in alts]
            elif candidates is not None and len(row["candidates"]) >= 2:
                row["outcome"] = "DETECTED_AMBIGUOUS"
            else:
                row["outcome"] = "DETECTED"
            removed = meta(own, "overlap_removed") or []
            if removed:
                row["relations"]["overlap_removed"] = removed
        elif shared_into is not None:
            row["outcome"] = "SHARED"
            row["feature"] = feature_record(by_ref[shared_into])
            row["relations"]["shared_with"] = [target_of_ref.get(shared_into, shared_into)]
        elif ref in suppressed_by:
            row["outcome"] = "SUPPRESSED_BY_OVERLAP"
            row["relations"]["suppressed_by"] = target_of_ref.get(suppressed_by[ref], suppressed_by[ref])
        elif ref in unassigned:
            row["outcome"] = "NOT_DETECTED"
        else:
            row["relations"]["failure"] = "target neither in features nor unassigned"
    engine_features = [{"label": meta(f, "label"), "rt_s": f.getRT(), "mz": f.getMZ(),
                        "intensity": finite_or_none(f.getIntensity()), "refs": [meta(f, "PeptideRef")] +
                        (meta(f, "alt_PeptideRef") or [])} for f in features]
    engine_unassigned = sorted(meta(u, "label") for u in fmap.getUnassignedPeptideIdentifications())
    return {"rows": rows, "evidence": evidence, "engine_parameters": engine_parameters,
            "engine_features": engine_features, "engine_unassigned": engine_unassigned,
            "source": {"bytes": before[0], "sha256": before[1], "spectra": exp.size(), "ms1_spectra": len(ms1)},
            "runtime": runtime_identity(oms)}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        return 2
    staging = Staging(Path(argv[2]))
    staging.event("start", pid=os.getpid())
    status, code, message = "failed", "INTERNAL", ""
    try:
        req = load_request(Path(argv[1]))
        staging.event("request_admitted")
        result = run(req, staging)
        staging.event("write_result")
        doc = {"schema": "mscanvas.m9_0.targeted_ms1.result/0", "run_id": req["run_id"], "request": req,
               "source": result["source"], "engine_parameters": result["engine_parameters"],
               "runtime": result["runtime"], "targets": result["rows"],
               "engine_features": result["engine_features"], "engine_unassigned": result["engine_unassigned"]}
        staging.write_json("result.json", doc)
        with open(staging.root / "evidence.jsonl", "w", encoding="utf-8", newline="\n") as f:
            for line in result["evidence"]:
                f.write(json.dumps(line, allow_nan=False) + "\n")
        status, code = "completed", "OK"
    except Stop as stop:
        status, code, message = stop.status, stop.code, stop.message
    except Exception as exc:  # noqa: BLE001 -- anything unforeseen is a failure, never a success
        status, code, message = "failed", "INTERNAL", f"{type(exc).__name__}: {str(exc)[:300]}"
    staging.event("end", status=status, code=code)
    staging.write_json("outcome.json", {"status": status, "code": code, "message": message,
                                        "elapsed_s": round(time.perf_counter() - T0, 4)})
    return {"completed": EXIT_COMPLETED, "refused": EXIT_REFUSED}.get(status, EXIT_FAILED)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
