#!/usr/bin/env python3
"""Deterministic fixtures and an independent reader for `msconvert` evidence.

Two jobs, and they are deliberately the same tool. `generate` writes the mzML
sources an evidence slice measures against; `inspect` reads a document back and
reports what is actually in it. Neither spawns a backend: the measurement itself
is an operator running the exact argv the evidence record publishes, and this
side of it stays a pure function of bytes so that what it says about an output
cannot depend on how the output was produced.

**The decoder is the point.** A conversion that reports exit `0` has established
nothing scientific, and a document that declares `64-bit float` in a `cvParam`
has established only what it declares. So `inspect` decodes the binary arrays
itself -- base64, then optional zlib, then IEEE-754 at the declared width and
byte order -- and reports the numbers. An evidence record can then compare those
numbers against values it computed independently, which is the only way to tell
a preserved value from a re-declared one.

**It refuses rather than rounds.** A payload that is not a whole number of values
at its declared width is reported as `malformed` and decodes to nothing; a
spectrum whose stored array length disagrees with the length it declares is
reported as `length_disagreement`. Truncating to the nearest whole value would
let a torn array come back looking like a shorter healthy one, and every numeric
claim an evidence record makes is a claim about what this function returned.

Standard library only, and no network. Both fixtures are a pure function of the
constants in this file, so the recorded SHA-256s are reproducible from the
repository rather than from an operator's directory.
"""

from __future__ import annotations

import argparse
import base64
import json
import struct
import sys
import zlib
from pathlib import Path
from xml.etree import ElementTree

MZML_NS = "http://psi.hupo.org/ms/mzml"

# ---------------------------------------------------------------- fixture data
#
# Values are chosen so that binary32 and binary64 disagree observably. A round
# number such as 500.0 is exactly representable in both, and a precision
# measurement taken on one would pass whatever the encoder did -- which is the
# way a precision claim gets made without being tested.

#: m/z values, none exactly representable in binary32.
PEAK_CENTRES = (300.12345678901234, 500.98765432109876, 700.55555555555554)

#: Intensity magnitudes, likewise inexact in binary32.
PEAK_HEIGHTS = (1234.5678901234567, 20345.678901234567, 987.65432109876543)

#: How far each profile point sits from its peak centre, in m/z.
PROFILE_OFFSETS = (-0.03, -0.02, -0.01, 0.0, 0.01, 0.02, 0.03)

#: The shape of a profile peak, as a fraction of its height.
#:
#: One unambiguous maximum, so a centroiding algorithm has exactly one answer to
#: give -- and **zero at both flanks**, which is not decoration. ProteoWizard's
#: wavelet picker refuses a spectrum whose peak profiles are not separated by
#: zeros (`CwtPeakDetector::getScales`), so a fixture without them cannot
#: measure that algorithm at all: it measures the fixture.
PROFILE_SHAPE = (0.0, 0.2, 0.6, 1.0, 0.6, 0.2, 0.0)


def profile_peak(
    centre: float, height: float, flanked: bool = True
) -> tuple[list[float], list[float]]:
    """One profile peak around a single unambiguous maximum.

    `flanked` keeps the zero at each end. Dropping it is what the third fixture
    is for: an algorithm that refuses unflanked data has to be measured refusing
    it, and a fixture that always satisfies the precondition can only ever
    report success.
    """
    offsets = PROFILE_OFFSETS if flanked else PROFILE_OFFSETS[1:-1]
    shape = PROFILE_SHAPE if flanked else PROFILE_SHAPE[1:-1]
    mzs = [centre + offset for offset in offsets]
    intensities = [height * fraction for fraction in shape]
    return mzs, intensities


def spectra_plan(flanked: bool = True) -> list[dict[str, object]]:
    """The primary fixture's spectra, as data rather than as XML.

    Four spectra, two MS1 and two MS2, so an MS-level selection has a population
    to be exactly right or exactly wrong about. Peak counts differ per spectrum,
    so a filter that returned the right *number* of spectra with the wrong ones
    in it is still visible.
    """
    plan: list[dict[str, object]] = []
    # index 0 -- MS1, two peaks.
    mz0: list[float] = []
    inten0: list[float] = []
    for centre, height in zip(PEAK_CENTRES[:2], PEAK_HEIGHTS[:2]):
        mzs, intensities = profile_peak(centre, height, flanked)
        mz0 += mzs
        inten0 += intensities
    plan.append(
        {"id": "scan=1", "ms_level": 1, "rt": 60.0, "mz": mz0, "intensity": inten0}
    )
    # index 1 -- MS2 of the first MS1 peak, one peak.
    mz1, inten1 = profile_peak(PEAK_CENTRES[0], PEAK_HEIGHTS[2], flanked)
    plan.append(
        {
            "id": "scan=2",
            "ms_level": 2,
            "rt": 70.0,
            "mz": mz1,
            "intensity": inten1,
            "precursor_mz": PEAK_CENTRES[0],
        }
    )
    # index 2 -- MS1, three peaks.
    mz2: list[float] = []
    inten2: list[float] = []
    for centre, height in zip(PEAK_CENTRES, PEAK_HEIGHTS):
        mzs, intensities = profile_peak(centre, height, flanked)
        mz2 += mzs
        inten2 += intensities
    plan.append(
        {"id": "scan=3", "ms_level": 1, "rt": 80.0, "mz": mz2, "intensity": inten2}
    )
    # index 3 -- MS2 of the second MS1 peak, one peak.
    mz3, inten3 = profile_peak(PEAK_CENTRES[1], PEAK_HEIGHTS[0], flanked)
    plan.append(
        {
            "id": "scan=4",
            "ms_level": 2,
            "rt": 90.0,
            "mz": mz3,
            "intensity": inten3,
            "precursor_mz": PEAK_CENTRES[1],
        }
    )
    return plan


def encode(values: list[float]) -> str:
    """64-bit little-endian doubles, uncompressed, so the bytes are the values."""
    return base64.b64encode(struct.pack(f"<{len(values)}d", *values)).decode("ascii")


def binary_array(values: list[float], kind: str) -> str:
    unit = (
        ' unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z"'
        if kind == "mz"
        else ' unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts"'
    )
    accession = "MS:1000514" if kind == "mz" else "MS:1000515"
    name = "m/z array" if kind == "mz" else "intensity array"
    payload = encode(values)
    return (
        f'          <binaryDataArray encodedLength="{len(payload)}">\n'
        '            <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>\n'
        '            <cvParam cvRef="MS" accession="MS:1000576" name="no compression" value=""/>\n'
        f'            <cvParam cvRef="MS" accession="{accession}" name="{name}" value=""{unit}/>\n'
        f"            <binary>{payload}</binary>\n"
        "          </binaryDataArray>\n"
    )


def spectrum_xml(index: int, entry: dict[str, object], source_file_ref: str | None) -> str:
    mz = entry["mz"]
    intensity = entry["intensity"]
    assert isinstance(mz, list) and isinstance(intensity, list)
    ms_level = entry["ms_level"]
    level_param = (
        'MS:1000579" name="MS1 spectrum'
        if ms_level == 1
        else 'MS:1000580" name="MSn spectrum'
    )
    ref = "" if source_file_ref is None else f' sourceFileRef="{source_file_ref}"'
    precursor = ""
    if "precursor_mz" in entry:
        precursor = (
            '        <precursorList count="1">\n'
            "          <precursor>\n"
            '            <selectedIonList count="1">\n'
            "              <selectedIon>\n"
            '                <cvParam cvRef="MS" accession="MS:1000744" name="selected ion m/z"'
            f' value="{entry["precursor_mz"]!r}" unitCvRef="MS" unitAccession="MS:1000040"'
            ' unitName="m/z"/>\n'
            "              </selectedIon>\n"
            "            </selectedIonList>\n"
            "            <activation>\n"
            '              <cvParam cvRef="MS" accession="MS:1000133"'
            ' name="collision-induced dissociation" value=""/>\n'
            "            </activation>\n"
            "          </precursor>\n"
            "        </precursorList>\n"
        )
    return (
        f'      <spectrum index="{index}" id="{entry["id"]}"'
        f' defaultArrayLength="{len(mz)}"{ref}>\n'
        f'        <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="{ms_level}"/>\n'
        f'        <cvParam cvRef="MS" accession="{level_param}" value=""/>\n'
        '        <cvParam cvRef="MS" accession="MS:1000128" name="profile spectrum" value=""/>\n'
        '        <scanList count="1">\n'
        '          <cvParam cvRef="MS" accession="MS:1000795" name="no combination" value=""/>\n'
        "          <scan>\n"
        '            <cvParam cvRef="MS" accession="MS:1000016" name="scan start time"'
        f' value="{entry["rt"]!r}" unitCvRef="UO" unitAccession="UO:0000010" unitName="second"/>\n'
        "          </scan>\n"
        "        </scanList>\n"
        f"{precursor}"
        '        <binaryDataArrayList count="2">\n'
        f"{binary_array(mz, 'mz')}"
        f"{binary_array(intensity, 'intensity')}"
        "        </binaryDataArrayList>\n"
        "      </spectrum>\n"
    )


def source_file_xml(identifier: str, name: str) -> str:
    return (
        f'      <sourceFile id="{identifier}" name="{name}" location="file:///fixtures">\n'
        '        <cvParam cvRef="MS" accession="MS:1000584" name="mzML format" value=""/>\n'
        '        <cvParam cvRef="MS" accession="MS:1000776"'
        ' name="scan number only nativeID format" value=""/>\n'
        "      </sourceFile>\n"
    )


def document(
    run_id: str, source_files: list[tuple[str, str]], spectra: list[str]
) -> str:
    files = "".join(source_file_xml(identifier, name) for identifier, name in source_files)
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<mzML xmlns="http://psi.hupo.org/ms/mzml"'
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
        ' xsi:schemaLocation="http://psi.hupo.org/ms/mzml'
        ' http://psidev.info/files/ms/mzML/xsd/mzML1.1.0.xsd"'
        f' version="1.1.0" id="{run_id}">\n'
        '  <cvList count="2">\n'
        '    <cv id="MS" fullName="Proteomics Standards Initiative Mass Spectrometry Ontology"'
        ' version="4.1.0" URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/>\n'
        '    <cv id="UO" fullName="Unit Ontology" version="09:04:2014"'
        ' URI="https://raw.githubusercontent.com/bio-ontology-research-group/unit-ontology/master/unit.obo"/>\n'
        "  </cvList>\n"
        "  <fileDescription>\n"
        "    <fileContent>\n"
        '      <cvParam cvRef="MS" accession="MS:1000579" name="MS1 spectrum" value=""/>\n'
        '      <cvParam cvRef="MS" accession="MS:1000580" name="MSn spectrum" value=""/>\n'
        "    </fileContent>\n"
        f'    <sourceFileList count="{len(source_files)}">\n'
        f"{files}"
        "    </sourceFileList>\n"
        "  </fileDescription>\n"
        '  <softwareList count="1">\n'
        '    <software id="mscanvas_fixture" version="1">\n'
        '      <cvParam cvRef="MS" accession="MS:1000799"'
        ' name="custom unreleased software tool" value=""/>\n'
        "    </software>\n"
        "  </softwareList>\n"
        '  <instrumentConfigurationList count="1">\n'
        '    <instrumentConfiguration id="IC1">\n'
        '      <cvParam cvRef="MS" accession="MS:1000031" name="instrument model" value=""/>\n'
        "    </instrumentConfiguration>\n"
        "  </instrumentConfigurationList>\n"
        '  <dataProcessingList count="1">\n'
        '    <dataProcessing id="DP1">\n'
        '      <processingMethod order="0" softwareRef="mscanvas_fixture">\n'
        '        <cvParam cvRef="MS" accession="MS:1000544" name="Conversion to mzML" value=""/>\n'
        "      </processingMethod>\n"
        "    </dataProcessing>\n"
        "  </dataProcessingList>\n"
        f'  <run id="{run_id}" defaultInstrumentConfigurationRef="IC1"'
        f' defaultSourceFileRef="{source_files[0][0]}">\n'
        f'    <spectrumList count="{len(spectra)}" defaultDataProcessingRef="DP1">\n'
        f"{''.join(spectra)}"
        "    </spectrumList>\n"
        "  </run>\n"
        "</mzML>\n"
    )


def generate(out: Path) -> list[tuple[str, int]]:
    """Both fixtures, written deterministically. Returns name and byte length."""
    out.mkdir(parents=True, exist_ok=True)
    plan = spectra_plan()

    profile = document(
        "m62_profile",
        [("SF1", "m62-profile-source")],
        [spectrum_xml(index, entry, None) for index, entry in enumerate(plan)],
    )

    # The second fixture exists for one dimension the first cannot reach: mzXML
    # drops a spectrum whose source file is not the run's default, and a
    # single-source document cannot exhibit that. Indices 1 and 3 are attributed
    # to the second source file, and they are not adjacent, so a drop is
    # distinguishable from a truncation.
    # The second source file is attributed to **one MS1 and one MS2** spectrum,
    # indices 1 and 2. A fixture that put it on both MS2 spectra would confound
    # the two hypotheses this fixture exists to separate: a format that drops by
    # source file and a format that drops by MS level would delete the same two
    # spectra, and either result would look like proof of the other.
    multi = document(
        "m62_multisource",
        [("SF1", "m62-multisource-first"), ("SF2", "m62-multisource-second")],
        [
            spectrum_xml(index, entry, "SF2" if index in (1, 2) else None)
            for index, entry in enumerate(plan)
        ],
    )

    # The third fixture is the same peaks with the flanking zeros removed, and it
    # exists to measure a refusal rather than a success. ProteoWizard's wavelet
    # picker requires zeros between peak profiles; without a source that lacks
    # them, "the algorithm ran" is the only answer the evidence could ever get.
    unflanked = spectra_plan(flanked=False)
    noflank = document(
        "m62_noflank",
        [("SF1", "m62-noflank-source")],
        [spectrum_xml(index, entry, None) for index, entry in enumerate(unflanked)],
    )

    written: list[tuple[str, int]] = []
    for name, text in (
        ("m62-profile.mzML", profile),
        ("m62-multisource.mzML", multi),
        ("m62-noflank.mzML", noflank),
    ):
        path = out / name
        path.write_bytes(text.encode("utf-8"))
        written.append((name, path.stat().st_size))
    return written


# ---------------------------------------------------------------- inspection

#: Accession to width in bits and `struct` code, for the two float encodings a
#: conforming mzML may declare.
FLOAT_ACCESSIONS = {"MS:1000523": (64, "d"), "MS:1000521": (32, "f")}
COMPRESSION_ACCESSIONS = {"MS:1000574": "zlib", "MS:1000576": "none"}
ARRAY_ACCESSIONS = {"MS:1000514": "mz", "MS:1000515": "intensity"}


def _params(element: ElementTree.Element) -> dict[str, str]:
    """Every `cvParam` accession directly under an element, mapped to its value."""
    found: dict[str, str] = {}
    for param in element.findall(f"{{{MZML_NS}}}cvParam"):
        accession = param.get("accession")
        if accession is not None:
            found[accession] = param.get("value", "")
    return found


def _decode_array(array: ElementTree.Element) -> dict[str, object]:
    params = _params(array)
    width = next(
        (FLOAT_ACCESSIONS[a] for a in params if a in FLOAT_ACCESSIONS), None
    )
    compression = next(
        (COMPRESSION_ACCESSIONS[a] for a in params if a in COMPRESSION_ACCESSIONS),
        "unknown",
    )
    kind = next((ARRAY_ACCESSIONS[a] for a in params if a in ARRAY_ACCESSIONS), "other")
    node = array.find(f"{{{MZML_NS}}}binary")
    raw = base64.b64decode((node.text or "") if node is not None else "")
    if compression == "zlib":
        raw = zlib.decompress(raw)
    values: list[float] = []
    malformed: str | None = None
    if width is None:
        malformed = "no float-width cvParam"
    else:
        bits, code = width
        stride = bits // 8
        # Refused rather than rounded down. Slicing to the nearest whole value
        # is how a truncated array comes back looking like a shorter healthy
        # one, and every numeric-fidelity claim in an evidence record is a claim
        # about what this function returned.
        if len(raw) % stride:
            malformed = (
                f"{len(raw)} decoded bytes is not a whole number of {bits}-bit values"
            )
        else:
            count = len(raw) // stride
            values = list(struct.unpack(f"<{count}{code}", raw))
    return {
        "kind": kind,
        "bits": None if width is None else width[0],
        "compression": compression,
        "encoded_bytes": len((node.text or "").strip()) if node is not None else 0,
        "decoded_bytes": len(raw),
        "length": len(values),
        "malformed": malformed,
        "values": values,
    }


def inspect_mzml(root: ElementTree.Element) -> dict[str, object]:
    run = root.find(f".//{{{MZML_NS}}}run")
    default_source = None if run is None else run.get("defaultSourceFileRef")
    sources = [
        {"id": element.get("id"), "name": element.get("name")}
        for element in root.findall(f".//{{{MZML_NS}}}sourceFile")
    ]
    processing: list[dict[str, object]] = []
    for method in root.findall(f".//{{{MZML_NS}}}processingMethod"):
        entry = {
            "order": method.get("order"),
            "software": method.get("softwareRef"),
            "cv": [
                {"accession": p.get("accession"), "name": p.get("name")}
                for p in method.findall(f"{{{MZML_NS}}}cvParam")
            ],
            "user": [
                {"name": p.get("name"), "value": p.get("value")}
                for p in method.findall(f"{{{MZML_NS}}}userParam")
            ],
        }
        processing.append(entry)

    spectra: list[dict[str, object]] = []
    for element in root.findall(f".//{{{MZML_NS}}}spectrum"):
        params = _params(element)
        arrays = [
            _decode_array(array)
            for array in element.findall(
                f"{{{MZML_NS}}}binaryDataArrayList/{{{MZML_NS}}}binaryDataArray"
            )
        ]
        rt = None
        scan = element.find(f"{{{MZML_NS}}}scanList/{{{MZML_NS}}}scan")
        if scan is not None:
            rt = _params(scan).get("MS:1000016")
        declared = element.get("defaultArrayLength")
        mismatched = [
            array["kind"]
            for array in arrays
            if declared is not None and array["length"] != int(declared)
        ]
        spectra.append(
            {
                "index": element.get("index"),
                "id": element.get("id"),
                "ms_level": params.get("MS:1000511"),
                # A spectrum that declares one length and stores another is the
                # per-spectrum form of a document declaring a scan count it did
                # not write. Reported rather than reconciled.
                "length_disagreement": mismatched or None,
                # MS:1000127 centroid spectrum, MS:1000128 profile spectrum.
                "centroided": "MS:1000127" in params,
                "profile": "MS:1000128" in params,
                "source_file_ref": element.get("sourceFileRef") or default_source,
                "declared_length": element.get("defaultArrayLength"),
                "retention_time": rt,
                "arrays": arrays,
            }
        )
    return {
        "format": "mzML",
        "source_files": sources,
        "default_source_file": default_source,
        "processing_methods": processing,
        "spectrum_count": len(spectra),
        "spectra": spectra,
    }


def inspect_mzxml(root: ElementTree.Element) -> dict[str, object]:
    namespace = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
    tag = (lambda name: f"{{{namespace}}}{name}") if namespace else (lambda name: name)
    sources = [
        {"id": element.get("fileName"), "name": element.get("fileName")}
        for element in root.findall(f".//{tag('parentFile')}")
    ]
    processing = [
        {
            "software": (
                lambda node: None
                if node is None
                else f"{node.get('name')} {node.get('version')}"
            )(element.find(tag("software"))),
            "centroided": element.get("centroided"),
            "user": [
                {"name": p.get("name"), "value": p.get("value")}
                for p in element.findall(tag("processingOperation"))
            ],
        }
        for element in root.findall(f".//{tag('dataProcessing')}")
    ]
    spectra: list[dict[str, object]] = []
    for element in root.findall(f".//{tag('scan')}"):
        peaks = element.find(tag("peaks"))
        values: list[float] = []
        bits = None
        compression = "none"
        malformed: str | None = None
        if peaks is not None:
            bits = int(peaks.get("precision", "32"))
            compression = peaks.get("compressionType", "none")
            raw = base64.b64decode(peaks.text or "")
            if compression == "zlib":
                raw = zlib.decompress(raw)
            code = "d" if bits == 64 else "f"
            stride = bits // 8
            # Refused rather than rounded down, and the pairing is checked as
            # well: mzXML interleaves m/z with intensity, so an odd number of
            # values is a torn spectrum however whole the byte count looks.
            if len(raw) % stride:
                malformed = (
                    f"{len(raw)} decoded bytes is not a whole number of {bits}-bit values"
                )
            else:
                count = len(raw) // stride
                if count % 2:
                    malformed = f"{count} values is not a whole number of m/z-intensity pairs"
                else:
                    # mzXML stores network byte order.
                    values = list(struct.unpack(f">{count}{code}", raw))
        declared = element.get("peaksCount")
        mismatched = (
            ["mz", "intensity"]
            if declared is not None and len(values[0::2]) != int(declared)
            else None
        )
        spectra.append(
            {
                "index": element.get("num"),
                "id": element.get("num"),
                "ms_level": element.get("msLevel"),
                "centroided": element.get("centroided"),
                "declared_length": declared,
                "length_disagreement": mismatched,
                "retention_time": element.get("retentionTime"),
                "arrays": [
                    {
                        "kind": "mz",
                        "bits": bits,
                        "compression": compression,
                        "length": len(values[0::2]),
                        "malformed": malformed,
                        "values": values[0::2],
                    },
                    {
                        "kind": "intensity",
                        "bits": bits,
                        "compression": compression,
                        "length": len(values[1::2]),
                        "malformed": malformed,
                        "values": values[1::2],
                    },
                ],
            }
        )
    return {
        "format": "mzXML",
        "source_files": sources,
        "default_source_file": None,
        "processing_methods": processing,
        "spectrum_count": len(spectra),
        "spectra": spectra,
    }


def inspect(path: Path) -> dict[str, object]:
    root = ElementTree.parse(path).getroot()
    tag = root.tag.rsplit("}", 1)[-1]
    if tag == "mzXML":
        return inspect_mzxml(root)
    if tag == "indexedmzML":
        inner = root.find(f"{{{MZML_NS}}}mzML")
        if inner is not None:
            root = inner
    return inspect_mzml(root)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    made = sub.add_parser("generate", help="write the deterministic mzML fixtures")
    made.add_argument("--out", required=True, type=Path)

    read = sub.add_parser("inspect", help="report what a converted document contains")
    read.add_argument("path", type=Path)
    read.add_argument(
        "--values",
        action="store_true",
        help="include every decoded array value rather than only their shape",
    )

    args = parser.parse_args()
    if args.command == "generate":
        for name, size in generate(args.out):
            print(f"{name}\t{size}")
        return 0

    facts = inspect(args.path)
    if not args.values:
        for spectrum in facts["spectra"]:  # type: ignore[index]
            for array in spectrum["arrays"]:  # type: ignore[index]
                array.pop("values", None)
    json.dump(facts, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
