#!/usr/bin/env python3
"""M9.0 frozen protocol: fixtures, the independent oracle, the case matrix and its checks.

This file is committed before the first scored run, and its SHA-256 is the
protocol identity every result names. Nothing in it imports, calls or reads
output from OpenMS. The fixtures are written by the stdlib writer below, their
stored arrays are read back by an independent stdlib decoder, and every expected
number is computed from the fixture specification -- never from the tested
engine's output.

Task semantics, declared before observing any engine output
-----------------------------------------------------------

* Domain: one local mzML acquisition; centroided MS1 spectra with sorted m/z;
  one declared polarity (positive); no ion mobility or FAIMS; declared
  retention-time units (seconds, or minutes converted by the reader). Profile
  data, mixed polarity, missing MS1 and undeclared or non-monotonic retention
  time are refused, never converted.
* Target: a caller-owned stable ``target_id`` (unique), a neutral sum formula,
  an optional explicit neutral monoisotopic mass, charge ``+1`` and the ion
  ``[M+H]+`` only, an expected retention time in seconds and a *half-width* in
  seconds. The observed ion m/z is ``(M + z * PROTON_MASS_U) / |z|``; a neutral
  mass is never relabelled as m/z and no other adduct is assumed.
* Extraction (as read from the pinned engine source): each isotope trace ``i``
  (``i = 0, 1``; the engine's minimum is two traces) is extracted at
  ``mz_i = mz + i * C13C12_MASSDIFF_U / z``. A stored point contributes when its
  m/z lies in the **open** interval ``(mz_i - mz_i*w/2*1e-6, mz_i + mz_i*w/2*1e-6)``
  where ``w`` is the engine's full window in ppm, i.e. ``w = 2 * half_width_ppm``.
  A spectrum contributes a chromatogram point when its retention time lies in the
  **closed** interval ``[rt - h, rt + h]``; a spectrum with an empty m/z array
  contributes no point at all (not a zero). The value of a point is the plain
  sum of in-window intensities. This differs from the M5/PX XIC contract, which
  used a closed m/z interval and one state per scan; nothing here reinterprets it.
* Quantity: the engine's ``raw_intensity`` is the sum of raw (unsmoothed)
  chromatogram points in the closed interval ``[leftWidth, rightWidth]``, summed
  over the traces, with no baseline subtraction. It is a discrete point sum and
  is not in the same unit as the elution-model area (intensity x seconds); the
  two are never forced to agree. When the elution-model fit fails, the engine
  replaces its ``intensity`` with a value imputed from a regression over the
  *other* features of the same run (or zero with ``model:no_imputation``);
  neither is a measurement, and a result must say which one it carries.
* Rows: one row per target. Outcomes: ``DETECTED`` (one candidate, one feature),
  ``DETECTED_AMBIGUOUS`` (a feature, selected by the engine from two or more
  candidates in the window), ``SHARED`` (one feature carries two targets),
  ``SUPPRESSED_BY_OVERLAP`` (the target's feature was removed in favour of an
  overlapping feature of another target), ``NOT_DETECTED`` (the engine produced
  no candidate; this is not a zero abundance) and ``FAILED`` (the target did
  not reach the engine or cannot be accounted for). A refused or failed run
  publishes no rows at all.

* Engine configuration: fixed by the adapter, declared in ``ENGINE_PROFILE``
  below and checked against the parameters every completed result records. It
  equals the TOPP tool's configuration (algorithm defaults plus TOPP's two
  ``EMGScoring`` overrides), with the per-run values mapped from the request.
  The engine's global ``extract:rt_window`` is set to twice the largest target
  half-width, so its fallback window never substitutes for, or truncates, a
  target's own window.

Oracle classes. ``oracle`` checks compare against numbers computed here from the
fixture specification; ``semantics`` checks demonstrate a behaviour the result
model must disclose; ``contract`` checks concern publication and accounting;
``wrapper-agreement`` checks compare the engine with itself (other encodings or
flags) and are *not* independent evidence; ``upstream-recorded`` compares with an
output OpenMS recorded for its own regression test, which is not independent
either; ``informational`` checks are reported but carry no scientific claim.

Run ``python protocol.py generate <dir>`` to write every fixture with its
specification; ``python protocol.py evaluate <runs-dir> <fixtures-dir>`` to
score published results against the oracle. Standard library only, no network.
The stdlib XML parser here only ever reads fixtures this file wrote itself.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import random
import re
import struct
import sys
import zlib
from pathlib import Path
from xml.etree import ElementTree

MZML_NS = "http://psi.hupo.org/ms/mzml"

# Constants declared by OpenMS 3.5.0 (src/openms/include/OpenMS/CONCEPT/Constants.h
# at c49149d47d6fcc76d1271d87d3a7fad15d2219de). They are the *definition* of the
# ion m/z and the isotope spacing the recipe uses, not an output of the engine.
PROTON_MASS_U = 1.0072764667710
C13C12_MASSDIFF_U = 1.0033548378

# Monoisotopic masses (AME2016 / NIST), independent of the engine's element table.
MONO = {"C": 12.0, "H": 1.00782503223, "N": 14.00307400443, "O": 15.99491461957}

# ------------------------------------------------------------------ chemistry


def parse_formula(formula: str) -> dict[str, int]:
    if not re.fullmatch(r"(?:[A-Z][a-z]?\d*)+", formula):
        raise ValueError(f"not a sum formula: {formula!r}")
    counts: dict[str, int] = {}
    for symbol, count in re.findall(r"([A-Z][a-z]?)(\d*)", formula):
        if symbol not in MONO:
            raise ValueError(f"element outside the fixture table: {symbol}")
        counts[symbol] = counts.get(symbol, 0) + (int(count) if count else 1)
    return counts


def neutral_mono_mass(formula: str) -> float:
    return sum(MONO[e] * n for e, n in parse_formula(formula).items())


def ion_mz(neutral_mass: float, charge: int = 1) -> float:
    # Same operation order as FeatureFinderAlgorithmMetaboIdent::calculateMZ_.
    return (neutral_mass + charge * PROTON_MASS_U) / abs(charge)


def trace_mz(mz: float, trace: int, charge: int = 1) -> float:
    # Same expression as generateTransitions_: mz + |C13C12 * float(i) / z|.
    return mz + abs(C13C12_MASSDIFF_U * float(trace) / charge)


def open_window(mz: float, full_ppm: float) -> tuple[float, float]:
    # Same operation order as ChromatogramExtractorAlgorithm::extract_value_tophat.
    return (mz - mz * full_ppm / 2.0 * 1.0e-6, mz + mz * full_ppm / 2.0 * 1.0e-6)


# ------------------------------------------------------------------ targets
#
# Every signal-bearing target and every interferent is placed by the fixture
# specification below. ``true_apex_s`` is the ground truth the oracle knows.

TARGETS = {
    "pos_control": {"formula": "C8H10N4O2", "rt_s": 60.0, "half_s": 20.0},  # caffeine
    "absent": {"formula": "C8H9NO2", "rt_s": 60.0, "half_s": 20.0},  # paracetamol, no signal
    "boundary": {"formula": "C12H18O5", "mass": 242.1154, "rt_s": 120.0, "half_s": 15.0},
    "two_peaks": {"formula": "C9H11NO2", "rt_s": 120.0, "half_s": 25.0},  # phenylalanine
    "iso_a": {"formula": "C6H13NO2", "rt_s": 150.0, "half_s": 12.0},  # leucine/isoleucine
    "iso_b": {"formula": "C6H13NO2", "rt_s": 158.0, "half_s": 12.0},
    "truncated": {"formula": "C10H13N5O4", "rt_s": 175.0, "half_s": 5.0},  # adenosine
}

HALF_WIDTH_PPM = 5.0  # the recipe parameter; the engine receives 2 * 5 = 10 ppm full
EXPECTED_PEAK_WIDTH_S = 6.0
SIGMA_S = 2.5


def engine_profile(half_width_ppm: float, peak_width_s: float, max_half_s: float) -> dict:
    """The complete engine configuration the adapter must pass (values as the engine reports them)."""
    return {
        "candidates_out": "<staging>/candidates.featureXML",
        "debug": 0,
        "extract:mz_window": 2 * half_width_ppm,
        "extract:rt_window": 2 * max_half_s,
        "extract:im_window": 0.0,
        "extract:n_isotopes": 2,
        "extract:isotope_pmin": 0.0,
        "detect:peak_width": peak_width_s,
        "detect:min_peak_width": 0.2,
        "detect:signal_to_noise": 0.8,
        "model:type": "symmetric",
        "model:add_zeros": 0.2,
        "model:unweighted_fit": "false",
        "model:no_imputation": "false",
        "model:each_trace": "false",
        "model:check:min_area": 1.0,
        "model:check:boundaries": 0.5,
        "model:check:width": 10.0,
        "model:check:asymmetry": 10.0,
        "EMGScoring:max_iteration": 100,
        "EMGScoring:init_mom": "true",
        "faims:merge_features": "true",
    }


def target_mz(name: str) -> float:
    t = TARGETS[name]
    mass = t.get("mass", neutral_mono_mass(t["formula"]))
    return ion_mz(mass)


# Elution components: (target, apex_s, height, M+1 ratio). The oracle never
# needs these to predict the XIC -- it sums stored points -- but detection and
# location expectations are stated against them.
COMPONENTS_MAIN = [
    ("pos_control", 60.0, 1.0e6, 0.10),
    ("boundary", 120.0, 2.0e5, 0.12),
    ("two_peaks", 106.0, 3.0e5, 0.10),
    ("two_peaks", 134.0, 6.0e5, 0.10),
    ("iso_a", 154.0, 4.0e5, 0.07),  # iso_a and iso_b share one m/z and one peak
    ("truncated", 179.0, 3.0e5, 0.11),
]
COMPONENTS_FORMAT = [("pos_control", 60.0, 1.0e6, 0.10)]

# ------------------------------------------------------------------ fixture model


def rt_grid(end_s: float, uneven: bool) -> list[float]:
    rts, t = [], 0.0
    while t <= end_s + 1e-9:
        rts.append(round(t, 4))
        step = 0.9 if uneven and 54.0 <= t < 58.4 else 0.5
        t = round(t + step, 4)
    return rts


def _gauss(t: float, apex: float, height: float) -> float:
    return height * math.exp(-((t - apex) ** 2) / (2 * SIGMA_S**2))


def _near_any(mz: float, centres: list[float], ppm: float) -> bool:
    return any(abs(mz - c) <= c * ppm * 1e-6 for c in centres)


def build_spectra(kind: str, seed: int) -> list[dict]:
    """Return scans in file order: {id, ms_level, rt_s, polarity, points[(mz, int)]}."""
    rng = random.Random(seed)
    main = kind == "main"
    components = COMPONENTS_MAIN if main else COMPONENTS_FORMAT
    signal_targets = sorted({c[0] for c in components})
    centres = [trace_mz(target_mz(n), i) for n in TARGETS for i in (0, 1)]
    scans: list[dict] = []

    def ms1(rt: float, factor: float = 1.0, empty: bool = False) -> dict:
        pts: list[tuple[float, float]] = []
        if not empty:
            for name, apex, height, ratio in components:
                mz0 = target_mz(name)
                for trace, h in ((0, height), (1, height * ratio)):
                    value = _gauss(rt, apex, h) * factor
                    if value >= 1.0:  # centroid threshold of the synthetic instrument
                        jitter = rng.uniform(-1.5, 1.5) * 1e-6
                        pts.append((trace_mz(mz0, trace) * (1 + jitter), value))
            for name in signal_targets:  # low in-window baseline, never for `absent`
                mz0 = target_mz(name)
                for trace in (0, 1):
                    if rng.random() < 0.6:
                        pts.append((trace_mz(mz0, trace) * (1 + rng.uniform(-3, 3) * 1e-6),
                                    rng.uniform(50.0, 300.0)))
            if main and 105.0 <= rt <= 135.0:  # exact open-interval boundary probes
                for trace in (0, 1):
                    lo, hi = open_window(trace_mz(target_mz("boundary"), trace), 2 * HALF_WIDTH_PPM)
                    pts += [(lo, 7777.0), (math.nextafter(lo, math.inf), 11.0),
                            (hi, 7777.0), (math.nextafter(hi, -math.inf), 13.0)]
            pc = target_mz("pos_control")
            # Strong coeluting interferent just outside the +/-5 ppm window: a base-peak
            # or wider-window shortcut would pick it up.
            pts.append((pc * (1 + 7.5e-6), _gauss(rt, 60.0, 5.0e7) * factor + 1.0))
            # Same m/z as the positive control, outside its RT window.
            late = _gauss(rt, 95.0, 5.0e7)
            if late >= 1.0:
                pts.append((pc * (1 + 0.5e-6), late))
            for _ in range(20):  # matrix peaks away from every target window
                mz = rng.uniform(100.0, 400.0)
                if not _near_any(mz, centres, 20.0):
                    pts.append((mz, rng.uniform(1.0e3, 1.0e5)))
            pts.sort()
        return {"ms_level": 1, "rt_s": rt, "polarity": "positive", "points": pts}

    for n, rt in enumerate(rt_grid(200.0 if main else 100.0, uneven=main)):
        scans.append(ms1(rt))
        if main and rt == 60.0:
            scans.append(ms1(rt, factor=0.9))  # a distinct scan sharing the retention time
        if main and rt == 61.0:
            scans.append(ms1(61.25, empty=True))  # a scan with empty arrays
        if main and n % 10 == 9:  # interleaved MS2 carrying the target m/z, must be ignored
            frag = [(target_mz("pos_control"), 1.0e8), (138.0662, 5.0e5)]
            scans.append({"ms_level": 2, "rt_s": round(rt + 0.05, 4), "polarity": "positive",
                          "precursor_mz": target_mz("pos_control"), "points": frag})
    for index, scan in enumerate(scans):
        scan["index"] = index
        scan["id"] = f"scan={index + 1}"
    return scans


# ------------------------------------------------------------------ mzML writer


def _encode(values: list[float], bits: int, zlib_on: bool) -> str:
    raw = struct.pack(f"<{len(values)}{'d' if bits == 64 else 'f'}", *values)
    return base64.b64encode(zlib.compress(raw) if zlib_on else raw).decode("ascii")


def stored(values: list[float], bits: int) -> list[float]:
    if bits == 64:
        return list(values)
    return list(struct.unpack(f"<{len(values)}f", struct.pack(f"<{len(values)}f", *values)))


def write_mzml(scans: list[dict], *, bits: int = 64, zlib_on: bool = True, prefix: str = "",
               rt_unit: str = "second", indexed: bool = False, centroid: bool = True,
               polarity_override=None) -> bytes:
    p = f"{prefix}:" if prefix else ""
    xmlns = f'xmlns:{prefix}="{MZML_NS}"' if prefix else f'xmlns="{MZML_NS}"'
    float_cv = ('MS:1000523" name="64-bit float' if bits == 64 else 'MS:1000521" name="32-bit float')
    comp_cv = ('MS:1000574" name="zlib compression' if zlib_on else 'MS:1000576" name="no compression')
    unit = ('UO:0000010" unitName="second' if rt_unit == "second" else 'UO:0000031" unitName="minute')

    def cv(acc_name: str, value: str = "", extra: str = "") -> str:
        acc, name = acc_name.split('" name="')
        return f'<{p}cvParam cvRef="{acc.split(":")[0]}" accession="{acc}" name="{name}" value="{value}"{extra}/>'

    head = [
        '<?xml version="1.0" encoding="utf-8"?>\n',
        (f'<{p}indexedmzML {xmlns}>\n' if indexed else ""),
        (f'<{p}mzML version="1.1.0" id="m90_fixture">\n' if indexed else
         f'<{p}mzML {xmlns} version="1.1.0" id="m90_fixture">\n'),
        f'<{p}cvList count="2"><{p}cv id="MS" fullName="Proteomics Standards Initiative Mass Spectrometry Ontology" '
        f'URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/>'
        f'<{p}cv id="UO" fullName="Unit Ontology" URI="http://ontologies.berkeleybop.org/uo.obo"/></{p}cvList>\n',
        f'<{p}fileDescription><{p}fileContent>{cv("MS:1000579" + chr(34) + " name=" + chr(34) + "MS1 spectrum")}'
        f'</{p}fileContent></{p}fileDescription>\n',
        f'<{p}softwareList count="1"><{p}software id="m90_fixture" version="0">'
        f'{cv("MS:1000799" + chr(34) + " name=" + chr(34) + "custom unreleased software tool", "mscanvas-m9.0-fixture")}'
        f'</{p}software></{p}softwareList>\n',
        f'<{p}instrumentConfigurationList count="1"><{p}instrumentConfiguration id="IC1">'
        f'{cv("MS:1000031" + chr(34) + " name=" + chr(34) + "instrument model")}'
        f'</{p}instrumentConfiguration></{p}instrumentConfigurationList>\n',
        f'<{p}dataProcessingList count="1"><{p}dataProcessing id="DP1"><{p}processingMethod order="0" softwareRef="m90_fixture">'
        f'{cv("MS:1000544" + chr(34) + " name=" + chr(34) + "Conversion to mzML")}'
        f'</{p}processingMethod></{p}dataProcessing></{p}dataProcessingList>\n',
        f'<{p}run id="run1" defaultInstrumentConfigurationRef="IC1">\n',
        f'<{p}spectrumList count="{len(scans)}" defaultDataProcessingRef="DP1">\n',
    ]
    chunks = ["".join(head).encode("utf-8")]
    size = len(chunks[0])
    offsets: list[tuple[str, int]] = []
    q = chr(34)
    for scan in scans:
        mz = stored([m for m, _ in scan["points"]], bits)
        it = stored([i for _, i in scan["points"]], bits)
        pol = polarity_override(scan) if polarity_override else scan["polarity"]
        level = scan["ms_level"]
        rt_value = repr(scan["rt_s"]) if rt_unit == "second" else repr(scan["rt_s"] / 60.0)
        parts = [
            f'<{p}spectrum index="{scan["index"]}" id="{scan["id"]}" defaultArrayLength="{len(mz)}">',
            cv(f"MS:1000511{q} name={q}ms level", str(level)),
            cv(f"MS:1000579{q} name={q}MS1 spectrum") if level == 1 else cv(f"MS:1000580{q} name={q}MSn spectrum"),
            cv(f"MS:1000130{q} name={q}positive scan") if pol == "positive" else cv(f"MS:1000129{q} name={q}negative scan"),
            cv(f"MS:1000127{q} name={q}centroid spectrum") if centroid else cv(f"MS:1000128{q} name={q}profile spectrum"),
            f'<{p}scanList count="1">{cv(f"MS:1000795{q} name={q}no combination")}<{p}scan>',
        ]
        if scan.get("rt_s") is not None and not scan.get("omit_rt"):
            parts.append(cv(f"MS:1000016{q} name={q}scan start time", rt_value,
                            f' unitCvRef="UO" unitAccession="{unit}"'))
        parts.append(f"</{p}scan></{p}scanList>")
        if level == 2:
            parts.append(
                f'<{p}precursorList count="1"><{p}precursor><{p}selectedIonList count="1"><{p}selectedIon>'
                f'{cv(f"MS:1000744{q} name={q}selected ion m/z", repr(scan["precursor_mz"]))}'
                f'</{p}selectedIon></{p}selectedIonList><{p}activation>'
                f'{cv(f"MS:1000133{q} name={q}collision-induced dissociation")}</{p}activation>'
                f'</{p}precursor></{p}precursorList>')
        parts.append(f'<{p}binaryDataArrayList count="2">')
        for values, kind_cv, unit_cv in (
            (mz, f"MS:1000514{q} name={q}m/z array", ' unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"'),
            (it, f"MS:1000515{q} name={q}intensity array",
             ' unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts"'),
        ):
            payload = _encode(values, bits, zlib_on)
            parts.append(
                f'<{p}binaryDataArray encodedLength="{len(payload)}">'
                f'{cv(float_cv)}{cv(comp_cv)}{cv(kind_cv, "", unit_cv)}<{p}binary>{payload}</{p}binary></{p}binaryDataArray>')
        parts.append(f"</{p}binaryDataArrayList></{p}spectrum>\n")
        offsets.append((scan["id"], size))
        chunks.append("".join(parts).encode("utf-8"))
        size += len(chunks[-1])
    chunks.append(f"</{p}spectrumList>\n</{p}run>\n</{p}mzML>\n".encode("utf-8"))
    out = b"".join(chunks)
    if indexed:
        index_offset = len(out)
        body = f'<{p}indexList count="1">\n<{p}index name="spectrum">\n'
        body += "".join(f'<{p}offset idRef="{sid}">{off}</{p}offset>\n' for sid, off in offsets)
        body += f"</{p}index>\n</{p}indexList>\n<{p}indexListOffset>{index_offset}</{p}indexListOffset>\n<{p}fileChecksum>"
        out += body.encode("utf-8")
        out += hashlib.sha1(out).hexdigest().encode("ascii")
        out += f"</{p}fileChecksum>\n</{p}indexedmzML>\n".encode("utf-8")
    return out


# ------------------------------------------------------------------ independent decoder


def decode_mzml(data: bytes) -> list[dict]:
    """Decode every spectrum's arrays with the stdlib, for the writer's round-trip check."""
    root = ElementTree.fromstring(data)
    out = []
    for spec in root.iter(f"{{{MZML_NS}}}spectrum"):
        arrays = {}
        for bda in spec.iter(f"{{{MZML_NS}}}binaryDataArray"):
            accs = {c.get("accession") for c in bda.iter(f"{{{MZML_NS}}}cvParam")}
            raw = base64.b64decode(bda.find(f"{{{MZML_NS}}}binary").text or "")
            if "MS:1000574" in accs:
                raw = zlib.decompress(raw)
            fmt = "d" if "MS:1000523" in accs else "f"
            vals = list(struct.unpack(f"<{len(raw) // struct.calcsize(fmt)}{fmt}", raw))
            arrays["mz" if "MS:1000514" in accs else "int"] = vals
        out.append({"id": spec.get("id"), "mz": arrays["mz"], "int": arrays["int"]})
    return out


# ------------------------------------------------------------------ oracle


def oracle_xic(scans: list[dict], bits: int, name: str, trace: int, rt_scale=None) -> list[dict]:
    """Expected chromatogram points for one target trace, from the stored fixture values."""
    t = TARGETS[name]
    lo, hi = open_window(trace_mz(target_mz(name), trace), 2 * HALF_WIDTH_PPM)
    start, end = t["rt_s"] - t["half_s"], t["rt_s"] + t["half_s"]
    points = []
    for scan in scans:
        if scan["ms_level"] != 1 or not scan["points"]:
            continue
        rt = rt_scale(scan) if rt_scale else scan["rt_s"]
        if rt < start or rt > end:
            continue
        mz = stored([m for m, _ in scan["points"]], bits)
        it = stored([i for _, i in scan["points"]], bits)
        points.append({"id": scan["id"], "rt_s": rt,
                       "value": math.fsum(i for m, i in zip(mz, it) if lo < m < hi)})
    return points


def oracle_area(xics: list[list[dict]], left: float, right: float) -> float:
    return math.fsum(p["value"] for xic in xics for p in xic if left <= p["rt_s"] <= right)


# ------------------------------------------------------------------ fixtures


def fixture_set() -> dict[str, dict]:
    """Every fixture: its scans, encoding and the retention-time mapping the oracle uses."""
    main = build_spectra("main", seed=90)
    fmt = build_spectra("format", seed=91)
    minutes = lambda s: 60.0 * float(repr(s["rt_s"] / 60.0))  # noqa: E731 -- the reader's conversion
    unsorted = [dict(s, points=list(reversed(s["points"]))) for s in fmt]
    missing_rt = [dict(s, omit_rt=(s["index"] == 50)) for s in fmt]
    only_ms2 = [dict(s, ms_level=2, precursor_mz=target_mz("pos_control")) for s in fmt[:40]]
    return {
        "main": {"scans": main, "bits": 64, "kw": {}},
        "fmt_plain": {"scans": fmt, "bits": 64, "kw": {}},
        "fmt_32_none": {"scans": fmt, "bits": 32, "kw": {"bits": 32, "zlib_on": False}},
        "fmt_prefixed": {"scans": fmt, "bits": 64, "kw": {"prefix": "ms"}},
        "fmt_indexed": {"scans": fmt, "bits": 64, "kw": {"indexed": True}},
        "fmt_minutes": {"scans": fmt, "bits": 64, "kw": {"rt_unit": "minute"}, "rt_scale": minutes},
        "dom_profile": {"scans": fmt, "bits": 64, "kw": {"centroid": False}},
        "dom_mixed_polarity": {"scans": fmt, "bits": 64,
                               "kw": {"polarity_override": lambda s: "negative" if s["index"] % 2 else "positive"}},
        "dom_unsorted": {"scans": unsorted, "bits": 64, "kw": {}},
        "dom_missing_rt": {"scans": missing_rt, "bits": 64, "kw": {}},
        "dom_no_ms1": {"scans": only_ms2, "bits": 64, "kw": {}},
    }


def large_scans(n_scans: int = 20000, n_points: int = 300, seed: int = 92) -> list[dict]:
    """A deliberately heavy source for the cancellation and timeout smoke checks only."""
    rng = random.Random(seed)
    scans = []
    for index in range(n_scans):
        pts = sorted((rng.uniform(100.0, 1000.0), rng.uniform(1.0e3, 1.0e5)) for _ in range(n_points))
        scans.append({"index": index, "id": f"scan={index + 1}", "ms_level": 1, "rt_s": round(index * 0.1, 4),
                      "polarity": "positive", "points": pts})
    return scans


def generate(out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, fx in fixture_set().items():
        data = write_mzml(fx["scans"], **fx["kw"])
        decoded = decode_mzml(data)
        assert len(decoded) == len(fx["scans"])
        for scan, got in zip(fx["scans"], decoded):  # writer round-trip, independent of OpenMS
            assert got["id"] == scan["id"]
            assert got["mz"] == stored([m for m, _ in scan["points"]], fx["bits"])
            assert got["int"] == stored([i for _, i in scan["points"]], fx["bits"])
        (out_dir / f"{name}.mzML").write_bytes(data)
        manifest[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    data = write_mzml(large_scans(), zlib_on=False)
    (out_dir / "ctl_large.mzML").write_bytes(data)
    manifest["ctl_large"] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    good = (out_dir / "fmt_plain.mzML").read_bytes()
    derived = {"fmt_truncated": good[: int(len(good) * 0.55)], "fmt_not_mzml": b"this is not an mzML document\n"}
    for name, data in derived.items():
        (out_dir / f"{name}.mzML").write_bytes(data)
        manifest[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    (out_dir / "fixtures.json").write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n",
                                           encoding="utf-8", newline="\n")
    return manifest


# ------------------------------------------------------------------ cases and expectations
#
# `targets` names entries of TARGETS; `expect` holds the declared outcome per
# target, or a run-level status for refused/failed runs. Tolerances are global
# and fixed here; see TOL.

TOL = {
    "xic_rel": 1e-9,  # summation order only; stored values are identical
    "rt_abs": 1e-9,
    "mz_formula_abs": 1e-6,  # the engine's element table vs AME2016
    "apex_abs_s": 1.0,
    "area_rel": 1e-9,
    "capture_min": 0.80,
    "model_area_rel": 0.15,
    "upstream_ratio": 1.01,  # FuzzyDiff.ini at the pin: ratio 1.01 or absdiff 0.01
    "upstream_absdiff": 0.01,
}

MAIN_TARGETS = ["pos_control", "absent", "boundary", "two_peaks", "iso_a", "iso_b", "truncated"]
MAIN_EXPECT = {
    "pos_control": {"DETECTED"},
    "absent": {"NOT_DETECTED"},
    "boundary": {"DETECTED"},
    "two_peaks": {"DETECTED_AMBIGUOUS"},
    "iso_a": {"DETECTED", "DETECTED_AMBIGUOUS", "SHARED", "SUPPRESSED_BY_OVERLAP"},
    "iso_b": {"DETECTED", "DETECTED_AMBIGUOUS", "SHARED", "SUPPRESSED_BY_OVERLAP"},
    "truncated": {"DETECTED", "DETECTED_AMBIGUOUS"},
}
FMT_EXPECT = {"pos_control": {"DETECTED"}}

# Pre-run amendment 1 (before any engine execution): `main_no_candidates` exists to
# show that capturing candidates does not change the final selection. Without the
# capture the adapter cannot know a selection was ambiguous, so its expectation for
# `two_peaks` is the undisclosed `DETECTED`, and the candidate checks do not apply.
NO_CAPTURE_EXPECT = dict(MAIN_EXPECT, two_peaks={"DETECTED"})

CASES = [
    {"id": "main", "fixture": "main", "targets": MAIN_TARGETS, "expect": MAIN_EXPECT},
    {"id": "main_no_candidates", "fixture": "main", "targets": MAIN_TARGETS, "expect": NO_CAPTURE_EXPECT,
     "experiment": {"capture_candidates": False}, "same_selection_as": "main"},
    {"id": "truncated_other_batch", "fixture": "main", "targets": ["truncated", "pos_control", "boundary"],
     "expect": {k: MAIN_EXPECT[k] for k in ("truncated", "pos_control", "boundary")},
     "batch_dependence_vs": "main"},
    {"id": "truncated_solo", "fixture": "main", "targets": ["truncated"], "expect": {"_run": {"completed", "failed"}}},
    {"id": "fmt_plain", "fixture": "fmt_plain", "targets": ["pos_control"], "expect": FMT_EXPECT},
    {"id": "fmt_32_none", "fixture": "fmt_32_none", "targets": ["pos_control"], "expect": FMT_EXPECT},
    {"id": "fmt_prefixed", "fixture": "fmt_prefixed", "targets": ["pos_control"], "expect": FMT_EXPECT,
     "same_selection_as": "fmt_plain"},
    {"id": "fmt_indexed", "fixture": "fmt_indexed", "targets": ["pos_control"], "expect": FMT_EXPECT,
     "same_selection_as": "fmt_plain"},
    {"id": "fmt_minutes", "fixture": "fmt_minutes", "targets": ["pos_control"], "expect": FMT_EXPECT},
    {"id": "fmt_truncated", "fixture": "fmt_truncated", "targets": ["pos_control"], "expect": {"_run": {"failed"}}},
    {"id": "fmt_not_mzml", "fixture": "fmt_not_mzml", "targets": ["pos_control"], "expect": {"_run": {"failed"}}},
    {"id": "dom_profile", "fixture": "dom_profile", "targets": ["pos_control"], "expect": {"_run": {"refused"}}},
    {"id": "dom_mixed_polarity", "fixture": "dom_mixed_polarity", "targets": ["pos_control"],
     "expect": {"_run": {"refused"}}},
    # A reader that sorts on load, or an adapter that refuses, are both honest; a wrong XIC is not.
    {"id": "dom_unsorted", "fixture": "dom_unsorted", "targets": ["pos_control"],
     "expect": {"_run": {"completed", "refused"}, "pos_control": {"DETECTED"}}},
    {"id": "dom_missing_rt", "fixture": "dom_missing_rt", "targets": ["pos_control"], "expect": {"_run": {"refused"}}},
    {"id": "dom_no_ms1", "fixture": "dom_no_ms1", "targets": ["pos_control"], "expect": {"_run": {"refused"}}},
    # Request refusals: the adapter must refuse before the engine sees the request.
    {"id": "req_da_switch", "fixture": "fmt_plain", "targets": ["pos_control"], "expect": {"_run": {"refused"}},
     "mutate": {"parameters.mz_half_width_ppm": 0.4}},
    {"id": "req_zero_rt_window", "fixture": "fmt_plain", "targets": ["pos_control"], "expect": {"_run": {"refused"}},
     "mutate": {"targets.0.rt_half_width_s": 0.0}},
    {"id": "req_nonfinite", "fixture": "fmt_plain", "targets": ["pos_control"], "expect": {"_run": {"refused"}},
     "mutate": {"targets.0.rt_s": "NaN"}},
    {"id": "req_duplicate_id", "fixture": "fmt_plain", "targets": ["pos_control", "pos_control"],
     "expect": {"_run": {"refused"}}},
    {"id": "req_charge", "fixture": "fmt_plain", "targets": ["pos_control"], "expect": {"_run": {"refused"}},
     "mutate": {"targets.0.charge": 2}},
    {"id": "req_bad_formula", "fixture": "fmt_plain", "targets": ["pos_control"], "expect": {"_run": {"refused"}},
     "mutate": {"targets.0.formula": "C8H10N4O2Xx"}},
    {"id": "req_source_changed", "fixture": "fmt_plain", "targets": ["pos_control"], "expect": {"_run": {"refused"}},
     "mutate": {"source.sha256": "0" * 64}},
    # The upstream regression bundle, with the upstream test's own parameters:
    # -extract:mz_window 5 -extract:rt_window 20 -detect:peak_width 3 and TSV RT ranges of 0,
    # which the engine replaces by rt_window 20, i.e. a half-width of 10 s.
    {"id": "reg_upstream_1", "fixture": "upstream", "targets": "upstream-tsv", "expect": {"_run": {"completed"}},
     "parameters": {"mz_half_width_ppm": 2.5, "expected_peak_width_s": 3.0}, "upstream_half_s": 10.0},
    # Owned-process controls. Cancellation is requested once the worker reports the
    # source-loading phase; the timeout is a wall-clock budget from launch.
    {"id": "ctl_cancel", "fixture": "ctl_large", "targets": ["pos_control"], "expect": {"_run": {"cancelled"}},
     "control": {"cancel_on_phase": "load_source", "cancel_delay_s": 0.5}},
    {"id": "ctl_timeout", "fixture": "ctl_large", "targets": ["pos_control"], "expect": {"_run": {"timeout"}},
     "control": {"timeout_s": 3.0}},
]


def request_targets(names: list[str]) -> list[dict]:
    out = []
    for name in names:
        t = TARGETS[name]
        out.append({"target_id": name, "formula": t["formula"], "neutral_mass": t.get("mass"), "charge": 1,
                    "rt_s": t["rt_s"], "rt_half_width_s": t["half_s"]})
    return out


def upstream_targets(tsv_text: str, half_s: float) -> list[dict]:
    """Map the upstream TSV to request targets, refusing any row the mapping cannot carry."""
    lines = tsv_text.splitlines()
    assert lines[0].split("\t")[:7] == ["CompoundName", "SumFormula", "Mass", "Charge", "RetentionTime",
                                        "RetentionTimeRange", "IsoDistribution"]
    out = []
    for line in lines[1:]:
        if not line or line.startswith("#"):
            continue
        name, formula, mass, charge, rt, rt_range, iso = line.split("\t")[:7]
        assert float(mass) == 0 and charge == "1" and float(rt_range) == 0 and float(iso) == 0, line
        out.append({"target_id": name, "formula": formula, "neutral_mass": None, "charge": 1,
                    "rt_s": float(rt), "rt_half_width_s": half_s})
    return out


def build_request(case: dict, source: Path, targets: list[dict]) -> dict:
    data = source.read_bytes()
    params = case.get("parameters", {"mz_half_width_ppm": HALF_WIDTH_PPM,
                                     "expected_peak_width_s": EXPECTED_PEAK_WIDTH_S})
    return {"schema": "mscanvas.m9_0.targeted_ms1.request/0", "run_id": case["id"],
            "source": {"path": str(source), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()},
            "targets": targets, "parameters": dict(params), "experiment": case.get("experiment", {})}


def apply_mutation(request: dict, mutate: dict) -> dict:
    for dotted, value in mutate.items():
        node = request
        for key in dotted.split(".")[:-1]:
            node = node[int(key)] if key.isdigit() else node[key]
        node[dotted.split(".")[-1]] = float("nan") if value == "NaN" else value
    return request


# ------------------------------------------------------------------ evaluation


def _check(rows: list, case: str, name: str, ok: bool, detail: str, kind: str = "oracle") -> None:
    rows.append({"case": case, "check": name, "result": "PASS" if ok else "FAIL", "kind": kind, "detail": detail})


def _rel_ok(got: float, want: float, rel: float) -> bool:
    return abs(got - want) <= rel * max(1.0, abs(want))


def evaluate_case(case: dict, run_dir: Path, fixtures: dict, others: dict) -> list[dict]:
    rows: list[dict] = []
    cid = case["id"]
    outcome = json.loads((run_dir / "attempt.json").read_text(encoding="utf-8"))
    status = outcome["status"]
    allowed_status = case["expect"].get("_run", {"completed"})
    _check(rows, cid, "run_status", status in allowed_status,
           f"status={status} code={outcome.get('code')} allowed={sorted(allowed_status)}", "contract")
    published = run_dir / "published" / "result.json"
    _check(rows, cid, "published_only_when_completed", published.exists() == (status == "completed"),
           f"published={published.exists()}", "contract")
    if status != "completed":
        return rows
    result = json.loads(published.read_text(encoding="utf-8"))
    by_id = {r["target_id"]: r for r in result["targets"]}
    _check(rows, cid, "every_target_accounted", sorted(by_id) == sorted(set(case["targets"])),
           f"rows={sorted(by_id)}", "contract")
    if case["fixture"] not in fixtures:
        return rows
    fx = fixtures[case["fixture"]]
    evidence = {}
    for line in (run_dir / "published" / "evidence.jsonl").read_text(encoding="utf-8").splitlines():
        e = json.loads(line)
        evidence[(e["target_id"], e["trace"])] = e
    for name in case["targets"]:
        row = by_id.get(name)
        if row is None:
            continue
        want = case["expect"].get(name)
        if want:
            _check(rows, cid, f"{name}.outcome", row["outcome"] in want, f"got={row['outcome']} want={sorted(want)}")
        # m/z semantics: [M+H]+ from the declared neutral mass, never a relabelled neutral mass.
        t = TARGETS[name]
        exp_mz = target_mz(name)
        tol = 0.0 if "mass" in t else TOL["mz_formula_abs"]
        _check(rows, cid, f"{name}.ion_mz", abs(row["ion"]["mz"][0] - exp_mz) <= tol,
               f"engine={row['ion']['mz'][0]!r} oracle={exp_mz!r}")
        xics = []
        for trace in (0, 1):
            ox = oracle_xic(fx["scans"], fx["bits"], name, trace, fx.get("rt_scale"))
            xics.append(ox)
            ev = evidence.get((name, trace))
            if ev is None:
                _check(rows, cid, f"{name}.xic{trace}", False, "no evidence line")
                continue
            got = ev["points"]
            same_ids = [p[1] for p in got] == [p["id"] for p in ox]
            same_rt = all(abs(g[2] - o["rt_s"]) <= TOL["rt_abs"] for g, o in zip(got, ox))
            same_val = all(_rel_ok(g[3], o["value"], TOL["xic_rel"]) for g, o in zip(got, ox))
            worst = max((abs(g[3] - o["value"]) for g, o in zip(got, ox)), default=0.0)
            _check(rows, cid, f"{name}.xic{trace}", len(got) == len(ox) and same_ids and same_rt and same_val,
                   f"points engine={len(got)} oracle={len(ox)} ids={same_ids} rt={same_rt} "
                   f"values={same_val} max_abs_diff={worst:.3g}")
        feat = row.get("feature")
        if feat is None:
            continue
        area = oracle_area(xics, feat["left_s"], feat["right_s"])
        _check(rows, cid, f"{name}.raw_area", _rel_ok(feat["raw_area"], area, TOL["area_rel"]),
               f"engine={feat['raw_area']!r} oracle_over_engine_bounds={area!r}")
        _check(rows, cid, f"{name}.mz_reported_is_theoretical", feat["mz_reported"] == row["ion"]["mz"][0],
               f"feature_mz={feat['mz_reported']!r} ion_mz={row['ion']['mz'][0]!r}", "semantics")
        apexes = [c[1] for c in (COMPONENTS_MAIN if case["fixture"] == "main" else COMPONENTS_FORMAT)
                  if c[0] == ("iso_a" if name == "iso_b" else name)]
        if apexes:
            near = min(abs(feat["rt_s"] - a) for a in apexes)
            _check(rows, cid, f"{name}.apex", near <= TOL["apex_abs_s"],
                   f"engine_rt={feat['rt_s']:.4f} true_apexes={apexes} nearest_diff={near:.4f}")
        if name == "pos_control":
            total = math.fsum(p["value"] for x in xics for p in x)
            _check(rows, cid, "pos_control.capture", area / total >= TOL["capture_min"],
                   f"captured={area / total:.4f} of in-window signal")
            m = feat["model"]
            true_area = sum(h * SIGMA_S * math.sqrt(2 * math.pi) for h in (1.0e6, 1.0e5))
            if m["status"].startswith("0"):
                _check(rows, cid, "pos_control.model_area", _rel_ok(m["area"], true_area, TOL["model_area_rel"]),
                       f"model_area={m['area']:.6g} continuous_truth={true_area:.6g}", "informational")
        if name == "truncated":
            _check(rows, cid, "truncated.fit_rejected", not feat["model"]["status"].startswith("0"),
                   f"model_status={feat['model']['status']}")
            _check(rows, cid, "truncated.intensity_source_disclosed",
                   feat["engine_intensity_source"] in {"imputed_from_run_regression", "zero_after_failed_fit"},
                   f"source={feat['engine_intensity_source']} engine_intensity={feat['engine_intensity']!r}")
        if name == "two_peaks" and row["candidates"] is not None:
            _check(rows, cid, "two_peaks.candidates_reported", len(row["candidates"]) >= 2,
                   f"candidates={len(row['candidates'])}")
    if {"iso_a", "iso_b"} <= set(by_id):
        pair = (by_id["iso_a"]["outcome"], by_id["iso_b"]["outcome"])
        honest = not (pair[0] in {"DETECTED", "DETECTED_AMBIGUOUS"} and pair[1] in {"DETECTED", "DETECTED_AMBIGUOUS"})
        _check(rows, cid, "isomers.attribution_ambiguity_disclosed", honest, f"outcomes={pair}")
    ref = case.get("same_selection_as")
    if ref and ref in others:
        mine = {k: (v["feature"] or {}) for k, v in by_id.items()}
        theirs = {k: (v["feature"] or {}) for k, v in others[ref].items()}
        keys = ("rt_s", "left_s", "right_s", "raw_area")
        same = all(mine[k].get(x) == theirs.get(k, {}).get(x) for k in mine for x in keys)
        _check(rows, cid, f"selection_equals_{ref}", same, "rt/left/right/raw_area identical", "wrapper-agreement")
    ref = case.get("batch_dependence_vs")
    if ref and ref in others:
        a, b = by_id["truncated"]["feature"], others[ref]["truncated"]["feature"]
        if a and b:
            _check(rows, cid, "truncated.raw_area_batch_independent", a["raw_area"] == b["raw_area"],
                   f"{a['raw_area']!r} vs {b['raw_area']!r}", "semantics")
            _check(rows, cid, "truncated.engine_intensity_batch_dependent", a["engine_intensity"] != b["engine_intensity"],
                   f"{a['engine_intensity']!r} vs {b['engine_intensity']!r}", "semantics")
    return rows


def _fuzzy_equal(a: float, b: float) -> bool:
    if abs(a - b) <= TOL["upstream_absdiff"]:
        return True
    lo, hi = sorted((abs(a), abs(b)))
    return lo > 0 and (a > 0) == (b > 0) and hi / lo <= TOL["upstream_ratio"]


def recorded_features(featurexml: Path) -> tuple[list[dict], list[str]]:
    root = ElementTree.parse(featurexml).getroot()
    feats = []
    for f in root.find("featureList").findall("feature"):  # top level only; subordinates are traces
        pos = {p.get("dim"): float(p.text) for p in f.findall("position")}
        label = next((u.get("value") for u in f.findall("UserParam") if u.get("name") == "label"), None)
        feats.append({"label": label, "rt_s": pos["0"], "mz": pos["1"], "intensity": float(f.findtext("intensity"))})
    unassigned = []
    for u in root.iter("UnassignedPeptideIdentification"):
        unassigned += [p.get("value") for p in u.iter("UserParam") if p.get("name") == "label"]
    return feats, sorted(unassigned)


def evaluate_upstream(case: dict, run_dir: Path, recorded: Path) -> list[dict]:
    rows: list[dict] = []
    cid = case["id"]
    attempt = json.loads((run_dir / "attempt.json").read_text(encoding="utf-8"))
    _check(rows, cid, "run_status", attempt["status"] == "completed", f"status={attempt['status']}", "contract")
    res = run_dir / "published" / "result.json"
    if not res.exists():
        return rows
    result = json.loads(res.read_text(encoding="utf-8"))
    want, want_unassigned = recorded_features(recorded)
    got = [{"label": f["label"], "rt_s": f["rt_s"], "mz": f["mz"], "intensity": f["intensity"]}
           for f in result["engine_features"]]
    key = lambda f: (f["label"], f["rt_s"])  # noqa: E731
    want, got = sorted(want, key=key), sorted(got, key=key)
    _check(rows, cid, "feature_count", len(want) == len(got), f"engine={len(got)} recorded={len(want)}",
           "upstream-recorded")
    for w, g in zip(want, got):
        ok = w["label"] == g["label"] and all(_fuzzy_equal(g[k], w[k]) for k in ("rt_s", "mz", "intensity"))
        _check(rows, cid, f"feature[{w['label']}]", ok,
               f"rt {g['rt_s']:.4f}/{w['rt_s']:.4f} mz {g['mz']:.5f}/{w['mz']:.5f} "
               f"int {g['intensity']:.6g}/{w['intensity']:.6g}", "upstream-recorded")
    _check(rows, cid, "unassigned_targets", sorted(result["engine_unassigned"]) == want_unassigned,
           f"engine={sorted(result['engine_unassigned'])} recorded={want_unassigned}", "upstream-recorded")
    return rows


def check_engine_profile(case: dict, result: dict) -> list[dict]:
    rows: list[dict] = []
    params = case.get("parameters", {"mz_half_width_ppm": HALF_WIDTH_PPM, "expected_peak_width_s": EXPECTED_PEAK_WIDTH_S})
    halves = [t["rt_half_width_s"] for t in result["request"]["targets"]]
    want = engine_profile(params["mz_half_width_ppm"], params["expected_peak_width_s"], max(halves))
    got = dict(result["engine_parameters"])
    capture = case.get("experiment", {}).get("capture_candidates", True)
    cand = got.pop("candidates_out", None)
    want.pop("candidates_out")
    cand_ok = cand.endswith("candidates.featureXML") if capture else cand == ""
    diff = {k: (got.get(k), v) for k, v in want.items() if got.get(k) != v}
    extra = sorted(set(got) - set(want))
    _check(rows, case["id"], "engine_profile_matches_declaration", not diff and not extra and cand_ok,
           f"diff={diff} undeclared={extra} candidates_out={cand!r}", "contract")
    return rows


def evaluate(runs_dir: Path, fixtures_dir: Path, recorded: Path | None = None) -> list[dict]:
    fixtures = fixture_set()
    rows, published = [], {}
    for case in CASES:
        run_dir = runs_dir / case["id"]
        if not (run_dir / "attempt.json").exists():
            _check(rows, case["id"], "executed", False, "no attempt record", "contract")
            continue
        res = run_dir / "published" / "result.json"
        if res.exists():
            rows += check_engine_profile(case, json.loads(res.read_text(encoding="utf-8")))
        if case["fixture"] == "upstream":
            if recorded is not None:
                rows += evaluate_upstream(case, run_dir, recorded)
            continue
        rows += evaluate_case(case, run_dir, fixtures, published)
        res = run_dir / "published" / "result.json"
        if res.exists():
            published[case["id"]] = {r["target_id"]: r for r in json.loads(res.read_text(encoding="utf-8"))["targets"]}
    manifest = json.loads((fixtures_dir / "fixtures.json").read_text(encoding="utf-8"))
    for name, meta in manifest.items():
        data = (fixtures_dir / f"{name}.mzML").read_bytes()
        _check(rows, "fixtures", f"{name}.digest", hashlib.sha256(data).hexdigest() == meta["sha256"],
               meta["sha256"][:16], "contract")
    return rows


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "generate":
        print(json.dumps(generate(Path(argv[2])), indent=1, sort_keys=True))
        return 0
    if len(argv) in (4, 5) and argv[1] == "evaluate":
        rows = evaluate(Path(argv[2]), Path(argv[3]), Path(argv[4]) if len(argv) == 5 else None)
        Path(argv[2], "checks.json").write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8", newline="\n")
        failed = [r for r in rows if r["result"] == "FAIL"]
        for r in rows:
            print(f"{r['result']:4} {r['kind']:17} {r['case']:22} {r['check']:42} {r['detail']}")
        print(f"{len(rows) - len(failed)} PASS / {len(failed)} FAIL")
        return 0
    print(__doc__.split("\n\n")[0])
    print("usage: protocol.py generate <dir> | evaluate <runs-dir> <fixtures-dir>")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
