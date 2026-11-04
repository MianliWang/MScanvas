"""New rows beside the frozen matrix: integer arrays (ADR 0071 open question 2).

The frozen oracle decodes floats only and answers ReferenceUnavailable for anything
else, so no frozen row reaches an integer array. The owner's answer of 2026-11-03
refuses an integer array with a value above 2^53 as Unreadable and asks for new rows
with an independent reference. These are those rows. They are not added to the 77.

The reference below uses the Python standard library alone and reads only the
fixture's bytes. It imports no candidate code. Each row also states its expected
state and sum by hand, and `freeze` refuses to write answers that disagree with the
hand. The rule that a value is judged by its magnitude, so that -(2^53 + 1) and 2^60
are refused too, is the reading built into #207: as built, not an owner decision.

  integer_rows.py freeze --out DIR [--supersedes EARLIER/INTEGER-FROZEN.json]
  integer_rows.py run --px3 PX3 --build BUILD --dir DIR --out EVIDENCE
"""
import argparse
import base64
import hashlib
import json
import math
import pathlib
import struct
import sys
import xml.etree.ElementTree as ET
import zlib
from datetime import datetime, timezone
from fractions import Fraction

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import harness_x2 as x2

N = "{http://psi.hupo.org/ms/mzml}"
LIMIT = 2**53
MAX = Fraction.from_float(sys.float_info.max)
DATA_TYPES = {
    "MS:1000523": ("d", "64-bit float"),
    "MS:1000521": ("f", "32-bit float"),
    "MS:1000522": ("q", "64-bit integer"),
    "MS:1000519": ("i", "32-bit integer"),
}
ROLES = {"MS:1000514": "Mz", "MS:1000515": "Intensity"}
HEAD = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0" id="x2-integer">'
    '<cvList count="2"><cv id="MS" fullName="PSI-MS" version="4.1" URI="urn:x2:MS"/>'
    '<cv id="UO" fullName="Unit Ontology" version="1" URI="urn:x2:UO"/></cvList>'
    '<fileDescription><fileContent><cvParam cvRef="MS" accession="MS:1000579" name="MS1 spectrum" value=""/></fileContent></fileDescription>'
    '<softwareList count="1"><software id="x2" version="0.1"><cvParam cvRef="MS" accession="MS:1000799" name="custom unreleased software tool" value=""/></software></softwareList>'
    '<instrumentConfigurationList count="1"><instrumentConfiguration id="IC1"/></instrumentConfigurationList>'
    '<dataProcessingList count="1"><dataProcessing id="DP1"><processingMethod order="0" softwareRef="x2"><cvParam cvRef="MS" accession="MS:1000544" name="Conversion to mzML" value=""/></processingMethod></dataProcessing></dataProcessingList>'
    '<run id="run1" defaultInstrumentConfigurationRef="IC1">'
)
FLOAT_MZ = ("MS:1000523", [99.0, 100.0, 101.0, 103.0])
I64 = "MS:1000522"
I32 = "MS:1000519"
UNREADABLE_REASON = "integer_beyond_2_pow_53"


def payload(role, name, unit, data_type, values, compressed):
    code, type_name = DATA_TYPES[data_type]
    raw = struct.pack("<" + code * len(values), *values)
    encoded = base64.b64encode(zlib.compress(raw, 6) if compressed else raw).decode()
    compression = ('MS:1000574" name="zlib compression"' if compressed else 'MS:1000576" name="no compression"')
    return (
        f'<binaryDataArray encodedLength="{len(encoded)}">'
        f'<cvParam cvRef="MS" accession="{role}" name="{name}" value="" {unit}/>'
        f'<cvParam cvRef="MS" accession="{data_type}" name="{type_name}" value=""/>'
        f'<cvParam cvRef="MS" accession="{compression} value=""/>'
        f"<binary>{encoded}</binary></binaryDataArray>"
    )


def spectrum(at, intensity, data_type=I64, mz=FLOAT_MZ, level=1, compressed=True):
    mz_type, mz_values = mz
    return (
        f'<spectrum index="{at}" id="scan={at + 1}" defaultArrayLength="{len(mz_values)}">'
        f'<cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="{level}"/>'
        '<cvParam cvRef="MS" accession="MS:1000127" name="centroid spectrum" value=""/>'
        '<scanList count="1"><cvParam cvRef="MS" accession="MS:1000795" name="no combination" value=""/>'
        f'<scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{60 * (at + 1)}" unitAccession="UO:0000010" unitName="second" unitCvRef="UO"/></scan></scanList>'
        '<binaryDataArrayList count="2">'
        + payload("MS:1000514", "m/z array", 'unitAccession="MS:1000040" unitName="m/z" unitCvRef="MS"', mz_type, mz_values, compressed)
        + payload("MS:1000515", "intensity array", 'unitAccession="MS:1000131" unitName="number of detector counts" unitCvRef="MS"', data_type, intensity, compressed)
        + "</binaryDataArrayList></spectrum>"
    )


def document(*spectra):
    return (
        HEAD
        + f'<spectrumList count="{len(spectra)}" defaultDataProcessingRef="DP1">'
        + "".join(spectra)
        + "</spectrumList></run></mzML>"
    ).encode()


def measured(total, points):
    return ("Measured", float(total), points)


def unreadable(role="Intensity"):
    return ("Unreadable", role)


# id, document, expected states by scan, worked by hand.
ROWS = [
    # An exact sum of 2^53 + 1 lies halfway, and rounds to the even neighbour, 2^53.
    ("int64_at_limit_sum_ties_to_even", document(spectrum(0, [7, LIMIT, 1, 9])), [measured(2**53, 2)]),
    # 2^53 + 3 lies halfway between 2^53 + 2 and 2^53 + 4, whose mantissa is even.
    ("int64_at_limit_sum_rounds_up", document(spectrum(0, [0, LIMIT, 3, 0])), [measured(2**53 + 4, 2)]),
    ("int64_negative_at_limit", document(spectrum(0, [0, -LIMIT, 0, 0])), [measured(-(2**53), 2)]),
    # f64 cannot hold this one.
    ("int64_above_limit_odd", document(spectrum(0, [0, LIMIT + 1, 0, 0])), [unreadable()]),
    # f64 can hold these. They are refused by size, as #207 reads the answer.
    ("int64_above_limit_even", document(spectrum(0, [0, LIMIT + 2, 0, 0])), [unreadable()]),
    ("int64_two_to_60", document(spectrum(0, [0, 2**60, 0, 0])), [unreadable()]),
    ("int64_max", document(spectrum(0, [0, 2**63 - 1, 0, 0])), [unreadable()]),
    # Negatives, by magnitude: as built, not an owner decision.
    ("int64_negative_above_limit_odd", document(spectrum(0, [0, -(LIMIT + 1), 0, 0])), [unreadable()]),
    ("int64_negative_above_limit_even", document(spectrum(0, [0, -(LIMIT + 2), 0, 0])), [unreadable()]),
    ("int64_min", document(spectrum(0, [0, -(2**63), 0, 0])), [unreadable()]),
    # Position 0 lies outside [100, 102]. The refusal is the array's, in or out of the window.
    ("int64_above_limit_outside_window", document(spectrum(0, [2**60, 1, 1, 0])), [unreadable()]),
    ("int64_above_limit_uncompressed", document(spectrum(0, [0, LIMIT + 2, 0, 0], compressed=False)), [unreadable()]),
    # An m/z array is judged first and by the same rule.
    ("int64_mz_above_limit", document(spectrum(0, [1.0, 2.0, 4.0, 8.0], "MS:1000523", (I64, [99, 100, LIMIT + 2, 103]))), [unreadable("Mz")]),
    ("int64_mz_within_limit", document(spectrum(0, [1.0, 2.0, 4.0, 8.0], "MS:1000523", (I64, [99, 100, 101, 103]))), [measured(6, 2)]),
    # Below every limit: both extremes in the window, summing to -1.
    ("int32_extremes", document(spectrum(0, [0, 2**31 - 1, -(2**31), 0], I32)), [measured(-1, 2)]),
    # One scan's refusal is that scan's gap, and its neighbours are still measured.
    ("int64_one_scan_of_three", document(spectrum(0, [0, 5, 6, 0]), spectrum(1, [0, 2**60, 6, 0]), spectrum(2, [0, 7, 8, 0])), [measured(11, 2), unreadable(), measured(15, 2)]),
    # An MS2 scan is excluded on declared metadata, and its arrays are not decoded.
    ("int64_above_limit_on_excluded_level", document(spectrum(0, [0, 5, 6, 0]), spectrum(1, [0, 2**60, 0, 0], level=2)), [measured(11, 2), ("ExcludedByMsLevel",)]),
]
QUERY = ["1", "100", "102"]


def bits(value):
    return struct.pack(">d", value).hex()


def unit_of(attributes):
    return dict(unit_accession=attributes.get("unitAccession"), unit_name=attributes.get("unitName"), unit_cv_ref=attributes.get("unitCvRef"))


def params(element):
    return [dict(attributes=dict(child.attrib), origin="direct") for child in element if child.tag == N + "cvParam"]


def pick(found, codes):
    return next((p["attributes"] for p in found if p["attributes"].get("accession") in codes), None)


def decode(element, found):
    codes = {p["attributes"].get("accession") for p in found}
    code, _ = DATA_TYPES[next(iter(codes & DATA_TYPES.keys()))]
    raw = base64.b64decode("".join((element.find(N + "binary").text or "").split()), validate=True)
    if "MS:1000574" in codes:
        raw = zlib.decompress(raw)
    width = struct.calcsize(code)
    values = list(struct.unpack("<" + code * (len(raw) // width), raw))
    beyond = code == "q" and any(abs(value) > LIMIT for value in values)
    return values, beyond


def exact(value):
    return Fraction(value) if isinstance(value, int) else Fraction.from_float(value)


def derive(data, query):
    """The whole answer in the shape the frozen comparator reads, from the bytes alone."""
    level, low, high = int(query[0]), float(query[1]), float(query[2])
    root = ET.fromstring(data)
    metadata = []
    rows = []
    unread = []
    gaps = 0
    for element in root.findall(N + "run/" + N + "spectrumList/" + N + "spectrum"):
        spectrum_params = params(element)
        declared = int(pick(spectrum_params, ["MS:1000511"])["value"])
        representation = "Profile" if pick(spectrum_params, ["MS:1000128"]) else "Centroid"
        scan_params = [p for scan in element.findall(N + "scanList/" + N + "scan") for p in params(scan)]
        time = pick(scan_params, ["MS:1000016"])
        arrays = []
        payloads = {}
        for array in element.findall(N + "binaryDataArrayList/" + N + "binaryDataArray"):
            found = params(array)
            role = pick(found, list(ROLES))
            arrays.append(dict(role=ROLES[role["accession"]], unit=unit_of(role), parameters=found))
            payloads[ROLES[role["accession"]]] = (array, found)
        index, sid = int(element.attrib["index"]), element.attrib["id"]
        metadata.append(dict(index=index, id=sid, default_array_length=int(element.attrib["defaultArrayLength"]), ms_level=declared, representation=representation, rt_value=float(time["value"]), rt_source_value=time["value"], rt_unit=unit_of(time), spectrum_parameters=spectrum_params, scan_parameters=scan_params, arrays=arrays))
        observation = {}
        attempts = 0
        if declared != level:
            state = "ExcludedByMsLevel"
        else:
            attempts = 1
            mz, mz_beyond = decode(*payloads["Mz"])
            if mz_beyond:
                state = "Unreadable"
                unread.append(dict(index=index, role="Mz", reason=UNREADABLE_REASON))
            else:
                intensity, intensity_beyond = decode(*payloads["Intensity"])
                if intensity_beyond:
                    state = "Unreadable"
                    unread.append(dict(index=index, role="Intensity", reason=UNREADABLE_REASON))
                else:
                    positions = [at for at, value in enumerate(mz) if low <= value <= high]
                    total = sum((exact(intensity[at]) for at in positions), Fraction(0))
                    x2.require(abs(total) <= MAX, "an integer row beyond the finite range")
                    value = float(total) if total else 0.0
                    state = "Measured"
                    observation.update(sum=value, sum_bits=bits(value), points_in_window=len(positions), positions=positions, intensity_unit=next(a["unit"] for a in arrays if a["role"] == "Intensity"), quantity="point_sum")
        observation["state"] = state
        gap = state != "ExcludedByMsLevel" and state != "Measured"
        gaps += int(gap)
        rows.append(dict(index=index, id=sid, rt=float(time["value"]), rt_unit=unit_of(time), ms_level=declared, representation=representation, observation=observation, coverage_gap=gap, decode_attempts=attempts))
    return dict(status="Evaluated", complete=gaps == 0, all_source_scans_observed=True, coverage_gaps=gaps, source_metadata=metadata, rows=rows, query=dict(ms_level=level, low=low, high=high)), unread


def agrees_with_hand(answer, unread, hand):
    states = []
    for row in answer["rows"]:
        observation = row["observation"]
        if observation["state"] == "Measured":
            states.append(("Measured", observation["sum"], observation["points_in_window"]))
        elif observation["state"] == "Unreadable":
            states.append(("Unreadable", next(u["role"] for u in unread if u["index"] == row["index"])))
        else:
            states.append((observation["state"],))
    return states == hand and all(math.isfinite(s[1]) for s in states if s[0] == "Measured")


def freeze(args):
    out = args.out
    (out / "inputs").mkdir(parents=True, exist_ok=False)
    ledger = []
    answers = {}
    for row_id, data, hand in ROWS:
        path = out / "inputs" / (row_id + ".mzML")
        path.write_bytes(data)
        answer, unread = derive(data, QUERY)
        x2.require(agrees_with_hand(answer, unread, hand), (row_id, answer["rows"], hand))
        answers[row_id] = dict(answer=answer, unreadable=unread)
        ledger.append(dict(id=row_id, file=path.name, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), query=QUERY, expectation="semantic", mode="normal", repeats=2))
    x2.dump(out / "integer-ledger.json", ledger)
    x2.dump(out / "integer-answers.json", answers)
    files = {name: x2.sha(out / name) for name in ["integer-ledger.json", "integer-answers.json"]}
    files.update({"inputs/" + r["file"]: r["sha256"] for r in ledger})
    record = dict(frozen_utc=datetime.now(timezone.utc).isoformat(), reference_sha256=x2.sha(__file__), files=files)
    if args.supersedes:
        # A revision of the runner only: every input and answer is the first freeze's.
        earlier = json.loads(args.supersedes.read_text(encoding="utf-8"))
        x2.require(earlier["files"] == files, "the revision changes an input or an answer")
        record["supersedes_sha256"] = x2.sha(args.supersedes)
    x2.dump(out / "INTEGER-FROZEN.json", record)
    print(json.dumps(dict(rows=len(ledger), frozen_sha256=x2.sha(out / "INTEGER-FROZEN.json"))))


def run(args):
    harness, oracle = x2.load_frozen(args.px3)
    exe, build = x2.load_build(args.build)
    frozen = json.loads((args.dir / "INTEGER-FROZEN.json").read_text(encoding="utf-8"))
    for name, digest in frozen["files"].items():
        x2.require(x2.sha(args.dir / name) == digest, (name, "frozen binding changed"))
    x2.require(frozen["reference_sha256"] == x2.sha(__file__), "the reference changed after its freeze")
    ledger = json.loads((args.dir / "integer-ledger.json").read_text(encoding="utf-8"))
    answers = json.loads((args.dir / "integer-answers.json").read_text(encoding="utf-8"))
    args.out.mkdir(parents=True, exist_ok=False)
    results = []
    for row in ledger:
        science = []
        runs = []
        for repeat in range(row["repeats"]):
            x2.emergency_stop()
            folder = args.out / (row["id"] + "-" + str(repeat + 1))
            folder.mkdir()
            capture = folder / "snapshot.mzML"
            diagnostics = x2.invoke(harness, exe, args.dir / "inputs" / row["file"], row["query"], capture, row["mode"], folder)
            errors = []
            try:
                if diagnostics["exit_code"] != 0:
                    raise ValueError("candidate_exit_" + str(diagnostics["exit_code"]))
                actual = json.loads((folder / "stdout.json").read_text(encoding="utf-8"))
                errors = harness.compare(answers[row["id"]]["answer"], actual, row["expectation"])
                # Not in the frozen shape: which array, and why.
                if actual.get("disclosures", {}).get("unreadable") != answers[row["id"]]["unreadable"]:
                    errors.append("unreadable role or reason differs")
                canonical = harness.js(oracle.canonical(actual))
                (folder / "science.json").write_bytes(canonical)
                science.append(hashlib.sha256(canonical).hexdigest())
            except Exception as error:
                errors = [type(error).__name__ + ":" + str(error)]
            if not capture.exists() or x2.sha(capture) != row["sha256"]:
                errors.append("same immutable snapshot capture mismatch or absent")
            status = "PASS" if not errors else "FAIL"
            x2.dump(folder / "result.json", dict(row=row["id"], build=build, frozen_sha256=x2.sha(args.dir / "INTEGER-FROZEN.json"), runners=x2.runner_hashes(), diagnostics=diagnostics, status=status, errors=errors))
            runs.append(status)
        repeat_ok = len(science) == row["repeats"] and len(set(science)) == 1
        results.append(dict(id=row["id"], status="PASS" if all(s == "PASS" for s in runs) and repeat_ok else "FAIL", repeat_agreement=repeat_ok, invocations=len(runs)))
    summary = dict(revision="integer_rows", identity=build, rows=results, counts=dict(rows=len(results), passed=sum(r["status"] == "PASS" for r in results), failed=sum(r["status"] == "FAIL" for r in results), invocations=sum(r["invocations"] for r in results)))
    x2.dump(args.out / "SUMMARY.json", summary)
    print(json.dumps(summary["counts"]))
    print(json.dumps([r for r in results if r["status"] != "PASS"]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("freeze")
    make.add_argument("--out", type=pathlib.Path, required=True)
    make.add_argument("--supersedes", type=pathlib.Path)
    make.set_defaults(handler=freeze)
    score = commands.add_parser("run")
    score.add_argument("--px3", type=pathlib.Path, required=True)
    score.add_argument("--build", type=pathlib.Path, required=True)
    score.add_argument("--dir", type=pathlib.Path, required=True)
    score.add_argument("--out", type=pathlib.Path, required=True)
    score.set_defaults(handler=run)
    arguments = parser.parse_args()
    arguments.handler(arguments)
