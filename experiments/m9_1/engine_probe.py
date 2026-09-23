"""M9.1 engine probe: what FeatureFinderAlgorithmMetaboIdent itself reports.

Run only by ``probes.py``, inside the provisioned runtime, with a fixed argv::

    python.exe -I -B -X utf8 engine_probe.py <request.json> <out-dir>

It applies the M9.0 adapter's fixed profile and records the engine's native
observations without interpreting them: whether ``run`` raised, and with which
Python type and text; whether the library and the extracted chromatograms are
still readable afterwards; every candidate the engine wrote; and every feature
with its model status and overlap annotations. It publishes nothing and decides
no outcome -- that is the adapter's job, and this exists to measure what the
adapter may rely on.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path


def meta(obj, key):
    if not obj.metaValueExists(key):
        return None
    value = obj.getMetaValue(key)
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, list):
        return [v.decode("utf-8") if isinstance(v, bytes) else v for v in value]
    return value


def text(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


def main(argv: list[str]) -> int:
    request = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    out = Path(argv[2])
    import pyopenms as oms  # noqa: PLC0415

    report: dict = {"pyopenms": oms.__version__, "openms_revision": oms.VersionInfo.getRevision()}
    exp = oms.MSExperiment()
    oms.MzMLFile().load(request["source"], exp)
    report["spectra"] = exp.size()
    params = request["parameters"]
    targets = request["targets"]
    candidates_path = out / "candidates.featureXML"
    ff = oms.FeatureFinderAlgorithmMetaboIdent()
    engine = ff.getParameters()
    profile = {
        "candidates_out": str(candidates_path),
        "extract:mz_window": 2 * params["mz_half_width_ppm"],
        "extract:rt_window": 2 * max(t["rt_half_width_s"] for t in targets),
        "extract:n_isotopes": 2,
        "extract:isotope_pmin": 0.0,
        "detect:peak_width": params["expected_peak_width_s"],
        "detect:min_peak_width": 0.2,
        "detect:signal_to_noise": 0.8,
        "model:type": "symmetric",
        "model:no_imputation": "false",
        "EMGScoring:max_iteration": 100,
        "EMGScoring:init_mom": "true",
    }
    for key, value in profile.items():
        engine.setValue(key, value)
    ff.setParameters(engine)
    compounds = [oms.FeatureFinderMetaboIdentCompound(
        t["target_id"], t["formula"], 0.0, [1], [t["rt_s"]], [2 * t["rt_half_width_s"]], [0.0]) for t in targets]
    ff.setMSData(exp)
    fmap = oms.FeatureMap()
    try:
        ff.run(compounds, fmap, request["source"])
        report["raised"] = None
    except Exception as exc:  # noqa: BLE001 -- recorded, not handled
        report["raised"] = {
            "type": f"{type(exc).__module__}.{type(exc).__qualname__}",
            "mro": [f"{c.__module__}.{c.__qualname__}" for c in type(exc).__mro__],
            "message": str(exc),
            "args": [str(a) for a in exc.args],
            "traceback_tail": traceback.format_exc().splitlines()[-3:],
        }
    try:
        library = ff.getLibrary()
        report["library"] = {
            "compounds": sorted(text(meta(c, "name")) for c in library.getCompounds()),
            "transitions": len(library.getTransitions()),
        }
    except Exception as exc:  # noqa: BLE001
        report["library"] = {"error": f"{type(exc).__name__}: {exc}"}
    try:
        chroms = ff.getChromatograms().getChromatograms()
        report["chromatograms"] = [{"native_id": text(c.getNativeID()), "points": c.size(),
                                    "max": max((c[i].getIntensity() for i in range(c.size())), default=0.0)}
                                   for c in chroms]
    except Exception as exc:  # noqa: BLE001
        report["chromatograms"] = {"error": f"{type(exc).__name__}: {exc}"}
    if candidates_path.exists():
        cmap = oms.FeatureMap()
        oms.FeatureXMLFile().load(str(candidates_path), cmap)
        report["candidates"] = [{"ref": meta(f, "PeptideRef"), "rt_s": f.getRT(),
                                 "left_s": meta(f, "leftWidth"), "right_s": meta(f, "rightWidth"),
                                 "intensity": f.getIntensity()} for f in cmap]
    else:
        report["candidates"] = None
    report["features"] = [{"ref": meta(f, "PeptideRef"), "alt": meta(f, "alt_PeptideRef"),
                           "overlap_removed": meta(f, "overlap_removed"), "rt_s": f.getRT(),
                           "left_s": meta(f, "leftWidth"), "right_s": meta(f, "rightWidth"),
                           "raw_intensity": meta(f, "raw_intensity"), "model_status": meta(f, "model_status"),
                           "model_area": meta(f, "model_area"), "intensity": f.getIntensity()} for f in fmap]
    report["unassigned"] = sorted(meta(u, "PeptideRef") for u in fmap.getUnassignedPeptideIdentifications())
    (out / "engine.json").write_text(json.dumps(report, indent=1, default=str) + "\n", encoding="utf-8",
                                     newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
