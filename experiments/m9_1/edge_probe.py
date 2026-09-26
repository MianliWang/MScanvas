"""M9.1 review probe: the extractor's first-peak omission, by how many peaks lie below.

Run inside the provisioned runtime with a fixed argv::

    python.exe -I -B -X utf8 edge_probe.py <out.json>

The M9.0 guard flags an in-window first peak as lost only when two or more
peaks lie below the trace m/z, because the one measured fixture had two. This
asks the one-below case directly. Each case builds MS1 spectra in memory whose
M-trace window holds the spectrum's first peak, runs the fixed profile's
extraction for one target, and compares every extracted M-trace point with the
exact sum of the in-window intensities of its spectrum. Nothing is interpreted
here; the adapter's guard is set from what this records.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

PROTON = 1.007276466771
PPM = 1.0e-6
HALF_WIDTH_PPM = 5.0


def gauss(rt: float) -> float:
    return 1.0e6 * math.exp(-((rt - 60.0) ** 2) / (2 * 2.5**2))


def main(argv: list[str]) -> int:
    import pyopenms as oms  # noqa: PLC0415

    mz = oms.EmpiricalFormula("C8H10N4O2").getMonoWeight() + PROTON
    lo, hi = mz * (1 - HALF_WIDTH_PPM * PPM), mz * (1 + HALF_WIDTH_PPM * PPM)
    # Each case: the peaks of one spectrum at retention time `rt`, as
    # (m/z, intensity). A ceiling peak at 450 keeps the trace off the last
    # position, which is the other, separately measured defect.
    cases = {
        # The M peak is the first peak and sits above the trace m/z: none below.
        "below0": lambda rt: [(mz * (1 + 1 * PPM), gauss(rt)), (450.0, 1.0e3)],
        # The M peak is the first peak and sits below the trace m/z: one below.
        "below1": lambda rt: [(mz * (1 - 1 * PPM), gauss(rt)), (450.0, 1.0e3)],
        # Two in-window peaks below the trace m/z, the first of them first: the
        # case M9.0 measured.
        "below2": lambda rt: [(mz * (1 - 3 * PPM), 0.25 * gauss(rt)), (mz * (1 - 1 * PPM), gauss(rt)),
                              (450.0, 1.0e3)],
        # One peak below, but far outside the window: a control.
        "below1_far": lambda rt: [(150.0, 1.0e3), (mz * (1 + 1 * PPM), gauss(rt)), (450.0, 1.0e3)],
    }
    report: dict = {"pyopenms": oms.__version__, "openms_revision": oms.VersionInfo.getRevision(),
                    "trace_mz": mz, "window_open": [lo, hi], "cases": {}}
    for name, peaks_at in cases.items():
        exp = oms.MSExperiment()
        rts = [round(i * 0.5, 4) for i in range(int(120 / 0.5) + 1)]
        expected = []
        for rt in rts:
            peaks = sorted((p for p in peaks_at(rt) if p[1] >= 1.0), key=lambda p: p[0])
            if not peaks:
                peaks = [(450.0, 1.0e3)]
            spectrum = oms.MSSpectrum()
            spectrum.setMSLevel(1)
            spectrum.setRT(rt)
            spectrum.setType(oms.SpectrumSettings.SpectrumType.CENTROID)
            spectrum.set_peaks(([p[0] for p in peaks], [p[1] for p in peaks]))
            exp.addSpectrum(spectrum)
            # The binary32 values the spectrum stores, summed in binary64 --
            # the extractor's own arithmetic as M9.0 recorded it.
            stored = spectrum.get_peaks()
            expected.append(math.fsum(float(v) for m, v in zip(*stored) if lo < m < hi))
        exp.updateRanges()
        ff = oms.FeatureFinderAlgorithmMetaboIdent()
        params = ff.getParameters()
        params.setValue("extract:mz_window", 2 * HALF_WIDTH_PPM)
        params.setValue("extract:rt_window", 60.0)
        params.setValue("extract:n_isotopes", 2)
        params.setValue("extract:isotope_pmin", 0.0)
        params.setValue("detect:peak_width", 6.0)
        ff.setParameters(params)
        ff.setMSData(exp)
        compound = oms.FeatureFinderMetaboIdentCompound("t", "C8H10N4O2", 0.0, [1], [60.0], [60.0], [0.0])
        fmap = oms.FeatureMap()
        raised = None
        try:
            ff.run([compound], fmap, "edge_probe")
        except Exception as exc:  # noqa: BLE001 -- recorded, not handled
            raised = f"{type(exc).__name__}: {exc}"
        chroms = ff.getChromatograms().getChromatograms()
        m0 = [c for c in chroms if c.getNativeID().endswith("_i0")]
        points = {}
        if m0:
            chrom = m0[0]
            points = {round(chrom[i].getRT(), 4): chrom[i].getIntensity() for i in range(chrom.size())}
        by_rt = dict(zip(rts, expected))
        compared = [(rt, by_rt[rt], value) for rt, value in points.items() if rt in by_rt]
        in_peak = [c for c in compared if c[1] > 0]
        report["cases"][name] = {
            "raised": raised,
            "extracted_points": len(points),
            "points_with_signal": len(in_peak),
            "equal": sum(1 for _, want, got in in_peak if got == want),
            "zero_where_signal": sum(1 for _, want, got in in_peak if got == 0 and want > 0),
            "other": [(rt, want, got) for rt, want, got in in_peak if got not in (want, 0)][:5],
            "apex": [(rt, want, got) for rt, want, got in compared if rt == 60.0],
        }
    Path(argv[1]).write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
