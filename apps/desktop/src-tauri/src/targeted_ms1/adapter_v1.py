"""MSCanvas targeted MS1 adapter, recipe version 1.

The one program the application's analysis worker runs. The supervisor writes
these bytes into an attempt's work directory, checks their digest, and starts
the pinned runtime with a fixed argv::

    python.exe -I -B -X utf8 adapter_v1.py <request.json> <out-dir>

It reads one typed request, refuses anything outside the recipe's measured
domain before the engine sees it, runs ``FeatureFinderAlgorithmMetaboIdent``
with the fixed profile below, and writes its answer into ``<out-dir>``. It
publishes nothing: the supervisor validates every line before anything is kept.

Every run ends with an ``outcome.json`` whose status is ``completed``,
``refused`` or ``failed``; a missing outcome means the process did not finish.
A completed run also writes ``result.json`` (what the attempt established),
``rows.jsonl`` (one row per target, in request order) and ``evidence.jsonl``
(the engine's extracted points per target and trace).

The request carries no command, class path, expression or parameter bag. The
engine sees target identifiers minted by the application, never user text.
Nothing here opens a network connection.

Derived from the M9.0 route-A adapter (``experiments/m9_0/worker_pyopenms.py``
at worker SHA-256 ``55624cfc...``); every guard that adapter measured stays.
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
REQUEST_SCHEMA = "mscanvas.targetedMs1.request/1"
RESULT_SCHEMA = "mscanvas.targetedMs1.result/1"
MAX_TARGETS = 200
# The one exception the engine was measured to raise when no target in the
# batch has any candidate (M9.0, and again at M9.1 entry, stable across runs).
EMPTY_SELECTION_MESSAGE = "Empty or uninitalized range object. Did you forget to call updateRanges()?"

EXIT_COMPLETED, EXIT_REFUSED, EXIT_FAILED = 0, 3, 4
T0 = time.perf_counter()

# The fixed engine profile: every parameter the recipe relies on, with the
# value the engine must hold after resolving it. The supervisor compares the
# values reported back against its own copy.
FIXED_PROFILE = {
    "EMGScoring:init_mom": "true",
    "EMGScoring:max_iteration": 100,
    "debug": 0,
    "detect:min_peak_width": 0.2,
    "detect:signal_to_noise": 0.8,
    "extract:im_window": 0.0,
    "extract:isotope_pmin": 0.0,
    "extract:n_isotopes": 2,
    "faims:merge_features": "true",
    "model:add_zeros": 0.2,
    "model:check:asymmetry": 10.0,
    "model:check:boundaries": 0.5,
    "model:check:min_area": 1.0,
    "model:check:width": 10.0,
    "model:each_trace": "false",
    "model:no_imputation": "false",
    "model:type": "symmetric",
    "model:unweighted_fit": "false",
}
# Set explicitly: the TOPP tool's two overrides of the algorithm defaults and
# the choices the recipe makes. The rest are verified as the engine's defaults.
SET_BY_ADAPTER = ("EMGScoring:init_mom", "EMGScoring:max_iteration", "detect:min_peak_width",
                  "detect:signal_to_noise", "extract:isotope_pmin", "extract:n_isotopes",
                  "model:no_imputation", "model:type")
KEY_MODULES = {"python313.dll", "vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "openms.dll",
               "openswathalgo.dll", "qt6core.dll"}


class Stop(Exception):
    def __init__(self, status: str, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def refuse(code: str, message: str) -> Stop:
    return Stop("refused", code, message)


def fail(code: str, message: str) -> Stop:
    return Stop("failed", code, message)


class Out:
    def __init__(self, root: Path):
        self.root = root
        self.events = open(root / "events.jsonl", "a", encoding="utf-8", newline="\n")

    def event(self, phase: str, **extra) -> None:
        self.events.write(json.dumps({"tS": round(time.perf_counter() - T0, 4), "phase": phase, **extra}) + "\n")
        self.events.flush()

    def write_json(self, name: str, value) -> None:
        (self.root / name).write_text(json.dumps(value, allow_nan=False, separators=(",", ":")) + "\n",
                                      encoding="utf-8", newline="\n")

    def write_lines(self, name: str, values) -> None:
        with open(self.root / name, "w", encoding="utf-8", newline="\n") as handle:
            for value in values:
                handle.write(json.dumps(value, allow_nan=False, separators=(",", ":")) + "\n")


# ------------------------------------------------------------------ request


def _reject_constant(token: str):
    raise refuse("REQUEST_INVALID", f"non-finite number {token} in request")


def _finite(value, what: str, low=None, high=None, low_open: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise refuse("REQUEST_INVALID", f"{what} must be a finite number")
    if low is not None and (value <= low if low_open else value < low):
        raise refuse("PARAMETER_OUT_OF_DOMAIN", f"{what}={value} is below the admitted range")
    if high is not None and value > high:
        raise refuse("PARAMETER_OUT_OF_DOMAIN", f"{what}={value} is above the admitted range")
    return float(value)


FORMULA = re.compile(r"(?:[A-Z][a-z]?(?:[1-9][0-9]{0,3})?)+")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
DIGEST = re.compile(r"[0-9a-fA-F]{64}")


def load_request(path: Path) -> dict:
    try:
        req = json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)
    except Stop:
        raise
    except (OSError, ValueError) as exc:
        raise refuse("REQUEST_INVALID", f"request is not strict JSON: {exc}") from None
    if not isinstance(req, dict) or req.get("schema") != REQUEST_SCHEMA:
        raise refuse("REQUEST_INVALID", "unknown request schema")
    if set(req) != {"schema", "attemptId", "source", "parameters", "targets"}:
        raise refuse("REQUEST_INVALID", "request fields must be exactly the declared five")
    if not isinstance(req["attemptId"], str) or not UUID.fullmatch(req["attemptId"]):
        raise refuse("REQUEST_INVALID", "attemptId must be a UUID")
    params = req["parameters"]
    if not isinstance(params, dict) or set(params) != {"mzHalfWidthPpm", "expectedPeakWidthS"}:
        raise refuse("REQUEST_INVALID", "parameters must be exactly mzHalfWidthPpm and expectedPeakWidthS")
    # The engine reads a window below 1 as Da rather than ppm, so a full window
    # under 1 ppm (half-width under 0.5 ppm) would silently change unit.
    _finite(params["mzHalfWidthPpm"], "mzHalfWidthPpm", 0.5, 50.0)
    _finite(params["expectedPeakWidthS"], "expectedPeakWidthS", 0.0, 600.0, low_open=True)
    targets = req["targets"]
    if not isinstance(targets, list) or not 1 <= len(targets) <= MAX_TARGETS:
        raise refuse("REQUEST_INVALID", f"targets must be a list of 1..{MAX_TARGETS} entries")
    seen = set()
    for t in targets:
        if not isinstance(t, dict) or set(t) != {"targetId", "formula", "neutralMass", "rtS", "rtHalfWidthS"}:
            raise refuse("REQUEST_INVALID", "target fields must be exactly the declared five")
        if not isinstance(t["targetId"], str) or not UUID.fullmatch(t["targetId"]):
            raise refuse("TARGET_INVALID", "targetId must be a UUID")
        if t["targetId"] in seen:
            raise refuse("DUPLICATE_TARGET", "targetId values must be unique")
        seen.add(t["targetId"])
        if not isinstance(t["formula"], str) or not FORMULA.fullmatch(t["formula"]) or len(t["formula"]) > 100:
            raise refuse("TARGET_INVALID", "a formula is not a plain sum formula")
        if t["neutralMass"] is not None:
            _finite(t["neutralMass"], "neutralMass", 0.0, 5000.0, low_open=True)
        _finite(t["rtS"], "rtS", 0.0, 86400.0)
        # A zero range would make the engine substitute its global window silently.
        _finite(t["rtHalfWidthS"], "rtHalfWidthS", 0.0, 3600.0, low_open=True)
    src = req["source"]
    if not isinstance(src, dict) or set(src) != {"path", "byteLength", "sha256"}:
        raise refuse("REQUEST_INVALID", "source must name path, byteLength and sha256")
    if not isinstance(src["path"], str) or not src["path"].isascii():
        raise refuse("REQUEST_INVALID", "the source path handed to the engine must be ASCII")
    if not isinstance(src["byteLength"], int) or isinstance(src["byteLength"], bool) or src["byteLength"] < 0:
        raise refuse("REQUEST_INVALID", "byteLength must be a non-negative integer")
    if not isinstance(src["sha256"], str) or not DIGEST.fullmatch(src["sha256"]):
        raise refuse("REQUEST_INVALID", "sha256 must be 64 hexadecimal characters")
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


# ------------------------------------------------------------------ runtime


def loaded_modules() -> list[str]:
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


def runtime_report(oms) -> dict:
    """What the loaded runtime is, without a single absolute path.

    Module digests are taken from the files at the loaded paths after loading,
    not from memory. Only names below the runtime directory are reported; any
    module from outside both it and the Windows directory is counted.
    """
    runtime_dir = Path(sys.executable).parent.resolve()
    system_root = Path(os.environ.get("SYSTEMROOT", r"C:\Windows")).resolve()
    modules, outside = [], 0
    for module in loaded_modules():
        path = Path(module).resolve()
        if path.is_relative_to(runtime_dir):
            relative = path.relative_to(runtime_dir).as_posix()
            if path.name.lower() in KEY_MODULES or (path.suffix.lower() == ".pyd" and "pyopenms" in relative):
                modules.append({"name": relative, "sha256": digest(path)[1]})
        elif not path.is_relative_to(system_root):
            outside += 1
    return {
        "python": sys.version.split()[0],
        "pyopenms": oms.__version__,
        "openms": oms.VersionInfo.getVersion(),
        "openmsRevision": oms.VersionInfo.getRevision(),
        "openmsBuildTime": oms.VersionInfo.getTime(),
        "flags": {"isolated": sys.flags.isolated, "ignoreEnvironment": sys.flags.ignore_environment,
                  "noUserSite": sys.flags.no_user_site, "dontWriteBytecode": sys.flags.dont_write_bytecode,
                  "utf8Mode": sys.flags.utf8_mode},
        "sysPathInsideRuntime": all(Path(p).resolve().is_relative_to(runtime_dir) for p in sys.path if p),
        "modulesOutsideRuntimeOrSystem": outside,
        "loadedModules": sorted(modules, key=lambda m: m["name"].lower()),
    }


# ------------------------------------------------------------------ engine


def text(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


def meta(obj, key: str):
    if not obj.metaValueExists(key):
        return None
    value = obj.getMetaValue(key)
    if isinstance(value, list):
        return [text(v) for v in value]
    return text(value)


def finite_or_none(value):
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else None


def check_source(oms, exp) -> list:
    ms1 = [s for s in exp if s.getMSLevel() == 1]
    if not ms1:
        raise refuse("SOURCE_NO_MS1", "the source contains no MS1 spectrum")
    centroid = oms.SpectrumSettings.SpectrumType.CENTROID
    if any(s.getType() != centroid for s in ms1):
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
            raise refuse("SOURCE_RT_UNDECLARED_OR_NONMONOTONIC", f"an MS1 retention time is {rt}, after {previous}")
        # M9.0 measured a silent false negative when two MS1 spectra share a
        # retention time inside a peak, so equal times are refused, not reported.
        if rt == previous:
            raise refuse("SOURCE_RT_NOT_STRICTLY_INCREASING", f"MS1 spectra share the retention time {rt}")
        previous = rt
        # FAIMS compensation voltages are negative drift times with their own unit.
        if s.getDriftTimeUnit() != oms.DriftTimeUnit.NONE or s.getDriftTime() != -1.0 or s.getFloatDataArrays():
            raise refuse("SOURCE_ION_MOBILITY_UNSUPPORTED", "ion mobility, FAIMS or extra arrays are outside the domain")
        if not s.isSorted():
            raise refuse("SOURCE_UNSORTED_MZ", "an MS1 spectrum has unsorted m/z")
        mz, inten = s.get_peaks()
        if not all(math.isfinite(v) for v in mz) or not all(math.isfinite(v) for v in inten):
            raise refuse("SOURCE_NONFINITE", "an MS1 spectrum carries a non-finite value")
    return ms1


def feature_record(f) -> dict:
    status = meta(f, "model_status") or "none"
    return {
        "apexRtS": f.getRT(), "leftS": float(meta(f, "leftWidth")), "rightS": float(meta(f, "rightWidth")),
        "rawArea": float(meta(f, "raw_intensity")),
        "modelStatus": status,
        "modelArea": finite_or_none(meta(f, "model_area")),
        "modelFwhmS": finite_or_none(meta(f, "model_FWHM")),
        "engineIntensity": finite_or_none(f.getIntensity()),
        # model:no_imputation is false in the fixed profile: a feature whose own
        # fit is not valid carries an intensity imputed from the others.
        "engineIntensitySource": "modelArea" if status.startswith("0") else "imputedFromRunRegression",
    }


def resolved_profile(ff, candidates_path: Path) -> dict:
    resolved = ff.getParameters()
    values = {}
    for key in list(FIXED_PROFILE) + ["extract:mz_window", "extract:rt_window", "detect:peak_width"]:
        values[key] = text(resolved.getValue(key))
    values["candidatesCaptured"] = text(resolved.getValue("candidates_out")) == str(candidates_path)
    return values


def no_candidate_recovery(exc: Exception, cand_path: Path, oms, ff, targets: list[dict]) -> bool:
    """Whether a raise is the engine's measured empty-selection error, and nothing else.

    Every condition is positive evidence, and all must hold: the exception is
    the one measured type with the one measured text; the engine wrote its
    candidate file and it holds no candidate at all; and the library and the
    extracted chromatograms are whole for every target of the batch. Anything
    short of that is a failure, never a run of absences.
    """
    if type(exc) is not RuntimeError or str(exc) != EMPTY_SELECTION_MESSAGE:
        return False
    if not cand_path.exists():
        return False
    candidates = oms.FeatureMap()
    try:
        oms.FeatureXMLFile().load(str(cand_path), candidates)
    except Exception:  # noqa: BLE001 -- an unreadable candidate file is no evidence
        return False
    if candidates.size() != 0:
        return False
    library = ff.getLibrary()
    names = {text(meta(c, "name")) for c in library.getCompounds()}
    if names != {t["targetId"] for t in targets}:
        return False
    transitions = len(library.getTransitions())
    return transitions == 2 * len(targets) and len(ff.getChromatograms().getChromatograms()) == transitions


def run(req: dict, out: Out) -> dict:
    src = Path(req["source"]["path"])
    expected = (req["source"]["byteLength"], req["source"]["sha256"].lower())
    try:
        before = digest(src)
    except OSError as exc:
        raise fail("SOURCE_UNREADABLE", f"cannot read the source: {exc.strerror}") from None
    if before != expected:
        raise refuse("SOURCE_CHANGED", "the source content is not the version the plan names")
    out.event("import_engine")
    import pyopenms as oms  # noqa: PLC0415 -- deliberately after the request is admitted

    for t in req["targets"]:
        try:
            ef = oms.EmpiricalFormula(t["formula"])
        except Exception:  # noqa: BLE001 -- the binding raises RuntimeError subclasses
            raise refuse("TARGET_INVALID", "the engine cannot parse a target formula") from None
        if ef.getMonoWeight() <= 0:
            raise refuse("TARGET_INVALID", "a target formula has no mass")
    out.event("load_source")
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
    out.event("check_source")
    # Each MS1 spectrum with its position in the file: evidence names spectra
    # by that position, never by a native identifier a file may repeat.
    ms1 = [(i, s) for i, s in enumerate(exp) if s.getMSLevel() == 1]
    check_source(oms, [s for _, s in ms1])

    out.event("engine_run")
    params_in = req["parameters"]
    targets = req["targets"]
    cand_path = out.root / "candidates.featureXML"
    ff = oms.FeatureFinderAlgorithmMetaboIdent()
    params = ff.getParameters()
    for key in SET_BY_ADAPTER:
        params.setValue(key, FIXED_PROFILE[key])
    params.setValue("candidates_out", str(cand_path))
    params.setValue("extract:mz_window", 2 * params_in["mzHalfWidthPpm"])
    params.setValue("extract:rt_window", 2 * max(t["rtHalfWidthS"] for t in targets))
    params.setValue("detect:peak_width", params_in["expectedPeakWidthS"])
    ff.setParameters(params)
    compounds = [oms.FeatureFinderMetaboIdentCompound(
        t["targetId"], t["formula"], t["neutralMass"] or 0.0, [1], [t["rtS"]], [2 * t["rtHalfWidthS"]], [0.0])
        for t in targets]
    ff.setMSData(exp)
    fmap = oms.FeatureMap()
    recovered = False
    try:
        ff.run(compounds, fmap, str(src))
    except Exception as exc:  # noqa: BLE001
        if no_candidate_recovery(exc, cand_path, oms, ff, targets):
            recovered = True
        elif cand_path.exists():
            raise fail("ENGINE_NO_CANDIDATES" if str(exc) == EMPTY_SELECTION_MESSAGE else "ENGINE_ERROR",
                       f"the engine raised: {str(exc)[:300]}") from None
        else:
            raise fail("ENGINE_ERROR", f"the engine raised: {str(exc)[:300]}") from None
    out.event("collect")
    profile = resolved_profile(ff, cand_path)

    # Assay identity: the library compound whose `name` is the target's identifier.
    library = ff.getLibrary()
    assay_of, ion_of = {}, {}
    for c in library.getCompounds():
        assay_of[text(meta(c, "name"))] = text(c.id)
    for tr in library.getTransitions():
        ion_of.setdefault(text(tr.getCompoundRef()), []).append(
            (text(tr.getNativeID()), tr.getProductMZ(), tr.getLibraryIntensity()))
    target_of_ref = {v: k for k, v in assay_of.items()}
    chroms = {}
    for ch in ff.getChromatograms().getChromatograms():
        # Per peak, not get_peaks(): the array accessor returns binary32
        # intensities, while the engine holds binary64 sums of them.
        chroms[text(ch.getNativeID())] = ([ch[i].getRT() for i in range(ch.size())],
                                          [ch[i].getIntensity() for i in range(ch.size())])

    cmap = oms.FeatureMap()
    oms.FeatureXMLFile().load(str(cand_path), cmap)
    candidates_of = {}
    for f in cmap:
        candidates_of.setdefault(meta(f, "PeptideRef"), []).append(
            {"apexRtS": f.getRT(), "leftS": float(meta(f, "leftWidth")), "rightS": float(meta(f, "rightWidth")),
             "rawArea": float(f.getIntensity())})

    features = [] if recovered else list(fmap)
    by_ref, alt_of, suppressed_by = {}, {}, {}
    for f in features:
        ref = meta(f, "PeptideRef")
        by_ref[ref] = f
        for alt in meta(f, "alt_PeptideRef") or []:
            alt_of[alt] = ref
        for removed in meta(f, "overlap_removed") or []:
            suppressed_by.setdefault(removed.rsplit(" (RT ", 1)[0], ref)
    unassigned = set() if recovered else {meta(u, "PeptideRef") for u in fmap.getUnassignedPeptideIdentifications()}

    def target_of(ref: str) -> str:
        tid = target_of_ref.get(ref)
        if tid is None:
            raise fail("EVIDENCE_MAPPING_MISMATCH", "an engine relation names no target of this batch")
        return tid

    rows, evidence = [], []
    peaks_of: dict[int, tuple] = {}  # each visited spectrum's arrays, fetched once
    for t in targets:
        tid = t["targetId"]
        ref = assay_of.get(tid)
        row = {"targetId": tid, "outcome": "FAILED", "failureReason": None, "edgeTraceCount": 0, "ion": None,
               "windows": None, "signal": None, "feature": None, "candidates": [], "overlapWinner": False,
               "relations": {"sharedWith": [], "suppressedBy": None, "overlapRemoved": []},
               "recoveredFromEmptySelection": False}
        rows.append(row)
        if ref is None or ref not in ion_of:
            row["failureReason"] = "TARGET_ABSENT_FROM_ENGINE_LIBRARY"
            continue
        traces = sorted(ion_of[ref], key=lambda x: x[1])
        full_ppm = 2 * params_in["mzHalfWidthPpm"]  # the engine's own operation order below
        bounds = [(mz - mz * full_ppm / 2.0 * 1.0e-6, mz + mz * full_ppm / 2.0 * 1.0e-6) for _, mz, _ in traces]
        start, end = t["rtS"] - t["rtHalfWidthS"], t["rtS"] + t["rtHalfWidthS"]
        row["ion"] = {"adduct": "[M+H]+", "charge": 1, "mzTheoretical": [mz for _, mz, _ in traces],
                      "isotopeProbability": [p for _, _, p in traces]}
        row["windows"] = {"rtClosedS": [start, end], "mzOpen": [list(b) for b in bounds]}
        # Map chromatogram points to spectra the way the extractor visits them:
        # MS1 in file order, empty spectra skipped, closed RT interval.
        visited = [(i, s) for i, s in ms1 if s.size() > 0 and start <= s.getRT() <= end]
        sums, maxima, edge = [], [], 0
        for trace, (nid, mz, _) in enumerate(traces):
            lo, hi = bounds[trace]
            for i, s in visited:  # measured extractor defects at a spectrum's first and last peak
                mzs, ints = peaks_of.setdefault(i, s.get_peaks())
                below = int(mzs.searchsorted(mz, "left"))  # the extractor's own lower_bound
                last_twice = below == len(mzs) and lo < mzs[-1] < hi and ints[-1] != 0
                first_lost = below >= 2 and lo < mzs[0] < hi and ints[0] != 0
                edge += bool(last_twice or first_lost)
            rts, values = chroms.get(nid, ([], []))
            if len(rts) != len(visited) or any(r != s.getRT() for r, (_, s) in zip(rts, visited)):
                raise fail("EVIDENCE_MAPPING_MISMATCH", "a chromatogram does not map onto the visited spectra")
            evidence.append({"targetId": tid, "trace": trace, "mzTheoretical": mz,
                             "points": [[i, r, v] for (i, _), r, v in zip(visited, rts, values)]})
            sums.append(math.fsum(values))
            maxima.append(max(values, default=0.0))
        row["signal"] = {"points": len(visited), "sum": sums, "max": maxima,
                         "anyNonzeroPoint": any(m > 0 for m in maxima)}
        row["candidates"] = candidates_of.get(ref, [])
        if not visited:
            # No MS1 spectrum with peaks lies in the window, so nothing was
            # measured there: an absence would be a claim about nothing.
            row["failureReason"] = "WINDOW_WITHOUT_MS1_PEAKS"
            row["recoveredFromEmptySelection"] = recovered
            continue
        if edge:
            row["failureReason"] = "EXTRACTION_AT_SPECTRUM_EDGE"
            row["edgeTraceCount"] = edge
            row["recoveredFromEmptySelection"] = recovered
            continue
        own = by_ref.get(ref)
        shared_into = alt_of.get(ref)
        if own is not None:
            removed = [target_of(r.rsplit(" (RT ", 1)[0]) for r in meta(own, "overlap_removed") or []]
            row["relations"]["overlapRemoved"] = removed
            row["overlapWinner"] = bool(removed)
            alts = meta(own, "alt_PeptideRef") or []
            if alts:
                row["outcome"] = "SHARED"
                row["feature"] = feature_record(own)
                row["relations"]["sharedWith"] = [target_of(a) for a in alts]
            elif len(row["candidates"]) >= 2:
                row["outcome"] = "DETECTED_AMBIGUOUS"
                row["feature"] = feature_record(own)
            elif len(row["candidates"]) == 1:
                row["outcome"] = "DETECTED"
                row["feature"] = feature_record(own)
            else:  # a feature with no candidate behind it is not an answer the engine gives
                row["failureReason"] = "TARGET_UNACCOUNTED"
        elif shared_into is not None:
            row["outcome"] = "SHARED"
            row["feature"] = feature_record(by_ref[shared_into])
            row["relations"]["sharedWith"] = [target_of(shared_into)]
        elif ref in suppressed_by:
            row["outcome"] = "SUPPRESSED_BY_OVERLAP"
            row["relations"]["suppressedBy"] = target_of(suppressed_by[ref])
        elif recovered and not row["candidates"]:
            row["outcome"] = "NOT_DETECTED"
            row["recoveredFromEmptySelection"] = True
        elif ref in unassigned and not row["candidates"]:
            row["outcome"] = "NOT_DETECTED"
        elif ref in unassigned:
            # The engine removed this target's selection without annotating it:
            # measured when overlapping features of different intensity meet.
            row["failureReason"] = "CANDIDATES_WITHOUT_FEATURE"
        elif row["candidates"]:
            # With no valid fit in the run the engine discards every feature
            # after the targets were marked found (triggered at M9.1 entry).
            row["failureReason"] = "ENGINE_DISCARDED_NO_VALID_FIT"
        else:
            row["failureReason"] = "TARGET_UNACCOUNTED"
    # A shared or suppressing feature cannot stand for a target whose partner's
    # chromatogram met the extractor's edge defect.
    flagged = {r["targetId"] for r in rows if r["failureReason"] == "EXTRACTION_AT_SPECTRUM_EDGE"}
    for r in rows:
        related = set(r["relations"]["sharedWith"]) | {r["relations"]["suppressedBy"]}
        if r["targetId"] not in flagged and r["outcome"] in ("SHARED", "SUPPRESSED_BY_OVERLAP") and related & flagged:
            r["outcome"], r["feature"] = "FAILED", None
            r["failureReason"] = "RELATED_TARGET_AT_SPECTRUM_EDGE"
    return {"rows": rows, "evidence": evidence, "profile": profile, "recovered": recovered,
            "source": {"byteLength": before[0], "sha256": before[1], "spectra": exp.size(), "ms1Spectra": len(ms1)},
            "runtime": runtime_report(oms)}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        return 2
    out = Out(Path(argv[2]))
    out.event("start")
    status, code, message = "failed", "INTERNAL", ""
    try:
        req = load_request(Path(argv[1]))
        out.event("request_admitted")
        result = run(req, out)
        out.event("write_result")
        out.write_lines("rows.jsonl", result["rows"])
        out.write_lines("evidence.jsonl", result["evidence"])
        out.write_json("result.json", {
            "schema": RESULT_SCHEMA, "attemptId": req["attemptId"], "source": result["source"],
            "engineProfile": result["profile"], "runtime": result["runtime"],
            "noCandidateRecovery": result["recovered"]})
        status, code = "completed", "OK"
    except Stop as stop:
        status, code, message = stop.status, stop.code, stop.message
    except Exception as exc:  # noqa: BLE001 -- anything unforeseen is a failure, never a success
        status, code, message = "failed", "INTERNAL", f"{type(exc).__name__}: {str(exc)[:300]}"
    out.event("end", status=status, code=code)
    out.write_json("outcome.json", {"status": status, "code": code, "message": message,
                                    "elapsedS": round(time.perf_counter() - T0, 4)})
    return {"completed": EXIT_COMPLETED, "refused": EXIT_REFUSED}.get(status, EXIT_FAILED)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
