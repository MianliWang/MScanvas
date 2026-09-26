"""Provisions the development runtime the targeted MS1 recipe runs in.

    python -B scripts/provision_targeted_ms1_runtime.py

M9.1 runs one fixed adapter in the CPython 3.13.15 embeddable runtime with
pyopenms 3.5.0 that M9.0 measured. This builds that runtime again under
``.tmp/m91-runtime/`` from material M9.0 already verified, and from nothing
else: no download, no package resolution and no pip.

What is checked, file by file, before the manifest is written:

- every top-level file equals its member of the embed zip, whose SHA-256 is the
  one M9.0 recorded, except ``python313._pth``, which must be that member's
  lines with LF endings plus exactly one ``site-packages`` line;
- every file a wheel carries equals that wheel's member, and every wheel's
  SHA-256 is the one the M9.0 hash lock names;
- the files pip wrote itself (``INSTALLER``, ``REQUESTED``, ``RECORD`` and the
  console launchers under ``bin/``) are listed as such: each is checked against
  the installed ``RECORD`` where it carries a hash, and ``RECORD`` itself cannot
  be checked against any download;
- nothing else exists. Bytecode written by earlier imports is not copied, and
  the application launches the interpreter with ``-B`` so none is written.

The manifest is canonical JSON with LF endings. Its SHA-256 is the value the
application pins; a runtime whose manifest or files differ is refused.

A development provision, not a release bundle: redistributing this runtime is
an owner decision M9.1 does not make.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
M90 = ROOT / ".tmp" / "m90-evidence"
SOURCE = M90 / "runtime" / "cpython-3.13.15-embed"
EMBED_ZIP = M90 / "downloads" / "python-3.13.15-embed-amd64.zip"
WHEELS = M90 / "wheels"
LOCK = ROOT / "experiments" / "m9_0" / "runtime" / "requirements-cp313-win_amd64.lock.txt"
M90_MANIFEST = ROOT / "experiments" / "m9_0" / "manifest.json"
TARGET_ROOT = ROOT / ".tmp" / "m91-runtime"
TARGET = TARGET_ROOT / "cpython-3.13.15-embed"
MANIFEST = TARGET_ROOT / "runtime-manifest.json"
REPORT = TARGET_ROOT / "provision-report.json"

MANIFEST_SCHEMA = "mscanvas.analysisRuntimeManifest/1"
RUNTIME_NAME = "cpython-3.13.15-embed-amd64+pyopenms-3.5.0"
PIP_WRITTEN = {"INSTALLER", "REQUESTED", "RECORD"}


class Refused(Exception):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def record_hash(value: str) -> str:
    """A RECORD ``sha256=<urlsafe base64>`` field, as lower-case hex."""
    algorithm, _, encoded = value.partition("=")
    if algorithm != "sha256":
        raise Refused(f"unexpected RECORD hash algorithm {algorithm!r}")
    return base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).hex()


def expected_download_digests() -> tuple[str, dict[str, str]]:
    m90 = json.loads(M90_MANIFEST.read_text(encoding="utf-8"))
    embed = m90["runtime"]["sha256_measured"]
    wheels = {}
    for line in LOCK.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([A-Za-z0-9_.-]+)==(\S+) --hash=sha256:([0-9a-f]{64})", line.strip())
        if match:
            wheels[match.group(1).lower().replace("_", "-")] = match.group(3)
    return embed, wheels


def verified_downloads() -> tuple[zipfile.ZipFile, list[zipfile.ZipFile]]:
    embed_digest, wheel_digests = expected_download_digests()
    if sha256_file(EMBED_ZIP) != embed_digest:
        raise Refused("the embed zip is not the one M9.0 verified")
    wheels = []
    for wheel in sorted(WHEELS.glob("*.whl")):
        name = wheel.name.split("-")[0].lower().replace("_", "-")
        if wheel_digests.get(name) != sha256_file(wheel):
            raise Refused(f"{wheel.name} is not the wheel the hash lock names")
        wheels.append(zipfile.ZipFile(wheel))
    if len(wheels) != len(wheel_digests):
        raise Refused("the wheel set differs from the hash lock")
    return zipfile.ZipFile(EMBED_ZIP), wheels


def expected_files() -> dict[str, tuple[str, str]]:
    """Every file the runtime may hold: relative path -> (sha256, provenance)."""
    embed, wheels = verified_downloads()
    expected: dict[str, tuple[str, str]] = {}
    for member in embed.infolist():
        if member.is_dir():
            continue
        data = embed.read(member)
        if member.filename == "python313._pth":
            # M9.0 rewrote the shipped CRLF file with LF endings when it added
            # the line; that is the whole modification, and it is checked here.
            lines = data.decode("ascii").replace("\r\n", "\n").split("\n")
            if "." not in lines:
                raise Refused("the embed ._pth has no '.' line to extend")
            lines.insert(lines.index(".") + 1, "site-packages")
            expected[member.filename] = (sha256_bytes("\n".join(lines).encode("ascii")), "embedZipModified")
        else:
            expected[member.filename] = (sha256_bytes(data), "embedZip")
    for wheel in wheels:
        for member in wheel.infolist():
            if member.is_dir() or member.filename.endswith(".dist-info/RECORD"):
                continue
            # --target installs a wheel's data directory beside its packages.
            relative = re.sub(r"^[^/]+\.data/data/", "", member.filename)
            if relative.startswith(".") or ".data/" in relative:
                raise Refused(f"unexpected wheel data member {member.filename}")
            path = f"site-packages/{relative}"
            if path in expected:
                raise Refused(f"two downloads provide {path}")
            expected[path] = (sha256_bytes(wheel.read(member)), "wheel")
    # What pip wrote itself: checked against the installed RECORD where hashed.
    for record in sorted((SOURCE / "site-packages").glob("*.dist-info/RECORD")):
        for row in record.read_text(encoding="utf-8").splitlines():
            if not row.strip():
                continue
            name, digest, _size = row.rsplit(",", 2)
            if name.startswith("../../"):
                name = name[len("../../"):]
            path = f"site-packages/{name}"
            base = name.rsplit("/", 1)[-1]
            generated = name.startswith("bin/") or (".dist-info/" in name and base in PIP_WRITTEN)
            if not generated:
                if path not in expected:
                    raise Refused(f"RECORD lists {path}, which no download provides")
                if digest and record_hash(digest) != expected[path][0]:
                    raise Refused(f"RECORD disagrees with the wheel about {path}")
                continue
            if base == "RECORD":
                expected[path] = (sha256_file(SOURCE / path), "pipRecordUnverifiable")
            else:
                expected[path] = (record_hash(digest), "pipGenerated")
    return expected


def installed_files(root: Path) -> dict[str, Path]:
    found = {}
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        relative = path.relative_to(root).as_posix()
        if "__pycache__/" in relative:
            continue
        found[relative] = path
    return found


def main() -> int:
    if not SOURCE.is_dir():
        raise Refused("the M9.0 runtime is missing; nothing else may provide it")
    expected = expected_files()
    source = installed_files(SOURCE)
    if set(source) != set(expected):
        raise Refused(f"the M9.0 runtime differs from its downloads: "
                      f"extra {sorted(set(source) - set(expected))[:5]}, "
                      f"missing {sorted(set(expected) - set(source))[:5]}")
    if TARGET.exists():
        print(f"{TARGET} exists; verifying it instead of copying")
    else:
        TARGET_ROOT.mkdir(parents=True, exist_ok=True)
        shutil.copytree(SOURCE, TARGET, ignore=shutil.ignore_patterns("__pycache__"))
    target = installed_files(TARGET)
    pycache = [p for p in TARGET.rglob("__pycache__")]
    if pycache or set(target) != set(expected):
        raise Refused("the provisioned runtime holds files the downloads do not account for")
    entries = []
    counts: dict[str, int] = {}
    for relative in sorted(expected):
        digest, provenance = expected[relative]
        measured = sha256_file(target[relative])
        if measured != digest:
            raise Refused(f"{relative} does not match {provenance}")
        entries.append({"path": relative, "bytes": target[relative].stat().st_size,
                        "sha256": measured.upper(), "provenance": provenance})
        counts[provenance] = counts.get(provenance, 0) + 1
    manifest = {"schema": MANIFEST_SCHEMA, "runtime": RUNTIME_NAME, "files": entries}
    data = (json.dumps(manifest, indent=1, sort_keys=True) + "\n").encode("utf-8")
    MANIFEST.write_bytes(data)
    digest = sha256_bytes(data).upper()
    report = {"manifest": MANIFEST.relative_to(ROOT).as_posix(), "manifestSha256": digest,
              "files": len(entries), "bytes": sum(e["bytes"] for e in entries),
              "provenance": counts, "bytecodeCopied": False}
    REPORT.write_bytes((json.dumps(report, indent=1, sort_keys=True) + "\n").encode("utf-8"))
    print(json.dumps(report, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as refusal:
        print(f"refused: {refusal}", file=sys.stderr)
        sys.exit(1)
