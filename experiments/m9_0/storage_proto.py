#!/usr/bin/env python3
"""M9.0 storage feasibility prototype: external result payloads beside a project document.

    python storage_proto.py <scratch-root>

A feasibility check of the ordering proposed for M9.1, on task-owned copies of
real experiment outputs. It is not production filesystem qualification: it uses
plain renames on one local NTFS volume and proves no crash or power-loss
durability. The document here is a stand-in for the schema-4 draft, not schema 3.

Layout: ``<name>.mscanvas`` and its managed store ``<name>.mscanvas.payloads/``.
The store holds one immutable directory per published result artifact, named by
its ArtifactId, with a ``manifest.json`` of file digests, plus ``.staging/`` for
attempts in progress and an ``.owner.json`` naming the project.

Ordering: stage -> validate -> publish the payload directory by one rename ->
reference it from the in-memory document -> Save publishes the document by
temporary + rename. A crash between payload publication and Save leaves an
unreferenced payload, which an open reports and never deletes; a document never
references a payload that was not already whole.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import uuid
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def store_of(document: Path) -> Path:
    return document.with_name(document.name + ".payloads")


def write_json_atomically(path: Path, value) -> None:
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(value, indent=1) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, path)  # the published name is always one whole document or the previous one


def ensure_store(document: Path, project_id: str) -> Path:
    store = store_of(document)
    owner = store / ".owner.json"
    if store.exists():
        if not owner.exists() or json.loads(owner.read_text(encoding="utf-8"))["project_id"] != project_id:
            raise PermissionError(f"{store.name} exists and is not this project's store")
        return store
    store.mkdir()
    write_json_atomically(owner, {"project_id": project_id})
    return store


def publish_payload(document: Path, project_id: str, files: dict[str, Path]) -> dict:
    """Stage, validate and publish one result payload; return the reference a record would carry."""
    store = ensure_store(document, project_id)
    artifact_id = str(uuid.uuid4())
    staging = store / ".staging" / artifact_id
    staging.mkdir(parents=True)
    manifest = {}
    for name, src in files.items():
        shutil.copy2(src, staging / name)
        manifest[name] = {"bytes": (staging / name).stat().st_size, "sha256": sha256(staging / name)}
    for line in (staging / "rows.jsonl").read_text(encoding="utf-8").splitlines():
        json.loads(line)  # validation: a payload that does not parse is never published
    write_json_atomically(staging / "manifest.json", manifest)
    os.replace(staging, store / artifact_id)
    return {"artifact_id": artifact_id, "manifest_sha256": sha256(store / artifact_id / "manifest.json"),
            "files": manifest}


def check_payloads(document: Path) -> dict:
    """What an open reports: each referenced payload whole, missing or corrupt; unreferenced ones listed."""
    doc = json.loads(document.read_text(encoding="utf-8"))
    store = store_of(document)
    report = {}
    for art in doc["artifacts"]:
        folder = store / art["payload"]["artifact_id"]
        status = "available"
        manifest = folder / "manifest.json"
        if not manifest.exists() or sha256(manifest) != art["payload"]["manifest_sha256"]:
            status = "payload_missing" if not manifest.exists() else "payload_corrupt"
        else:
            for name, meta in art["payload"]["files"].items():
                if not (folder / name).exists():
                    status = "payload_missing"
                elif sha256(folder / name) != meta["sha256"]:
                    status = "payload_corrupt"
        report[art["artifact_id"]] = status
    referenced = {a["payload"]["artifact_id"] for a in doc["artifacts"]}
    present = {p.name for p in store.iterdir() if p.is_dir() and not p.name.startswith(".")} if store.exists() else set()
    return {"artifacts": report, "unreferenced_payloads": sorted(present - referenced)}


def save_as(src: Path, dst: Path) -> None:
    """Copy every referenced payload into a store the new document owns, verified, before publishing it."""
    doc = json.loads(src.read_text(encoding="utf-8"))
    if dst.exists():
        raise FileExistsError("Save As refuses an existing destination")
    dst_store = store_of(dst)
    if dst_store.exists():
        owner = dst_store / ".owner.json"
        leftover = owner.exists() and json.loads(owner.read_text(encoding="utf-8"))["project_id"] == doc["project_id"]
        if not leftover:
            raise PermissionError(f"{dst_store.name} exists and is not this project's store")
        shutil.rmtree(dst_store)  # a store this project left behind by an interrupted Save As, with no document
    pending = dst.with_name(f".{dst_store.name}.{uuid.uuid4().hex}.pending")
    pending.mkdir()
    try:
        for art in doc["artifacts"]:
            ref = art["payload"]
            source = store_of(src) / ref["artifact_id"]
            target = pending / ref["artifact_id"]
            shutil.copytree(source, target)
            if sha256(target / "manifest.json") != ref["manifest_sha256"] or any(
                    sha256(target / n) != m["sha256"] for n, m in ref["files"].items()):
                raise OSError(f"payload {ref['artifact_id']} did not copy whole")
        write_json_atomically(pending / ".owner.json", {"project_id": doc["project_id"]})
    except Exception:
        shutil.rmtree(pending, ignore_errors=True)
        raise
    os.replace(pending, dst_store)
    write_json_atomically(dst, doc)  # identifiers unchanged; source locators are rebased by M8's own rule


def main(argv: list[str]) -> int:
    root = Path(argv[1]).resolve()
    work = root / "storage"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    run = root / "round2" / "runs" / "r2_strict" / "published"
    result = json.loads((run / "result.json").read_text(encoding="utf-8"))
    rows = work / "rows.jsonl"
    rows.write_text("".join(json.dumps(r) + "\n" for r in result["targets"]), encoding="utf-8", newline="\n")
    files = {"rows.jsonl": rows, "evidence.jsonl": run / "evidence.jsonl"}
    doc_path = work / "study.mscanvas"
    project_id = str(uuid.uuid4())
    base = {"schema": "draft-4", "project_id": project_id, "runs": [], "artifacts": []}
    write_json_atomically(doc_path, base)
    log = {}

    # S1: publish, reference, save, reopen.
    ref = publish_payload(doc_path, project_id, files)
    doc = dict(base, runs=[{"run_id": str(uuid.uuid4()), "status": "completed", "produced": [ref["artifact_id"]]}],
               artifacts=[{"artifact_id": ref["artifact_id"], "kind": "targetedMs1ResultV1", "payload": ref}])
    write_json_atomically(doc_path, doc)
    log["S1_saved_and_reopened"] = check_payloads(doc_path)
    assert set(log["S1_saved_and_reopened"]["artifacts"].values()) == {"available"}

    # S2: a second result is published but the session ends before Save.
    orphan = publish_payload(doc_path, project_id, files)
    log["S2_published_not_saved"] = check_payloads(doc_path)
    assert log["S2_published_not_saved"]["unreferenced_payloads"] == [orphan["artifact_id"]]

    # S5: Save As copies and verifies payloads, keeps identifiers, then publishes.
    copy_path = work / "copy" / "study-copy.mscanvas"
    copy_path.parent.mkdir()
    save_as(doc_path, copy_path)
    copied = json.loads(copy_path.read_text(encoding="utf-8"))
    log["S5_save_as"] = dict(check_payloads(copy_path), same_ids=copied["artifacts"] == doc["artifacts"])
    assert log["S5_save_as"]["same_ids"] and set(log["S5_save_as"]["artifacts"].values()) == {"available"}
    assert log["S5_save_as"]["unreferenced_payloads"] == []  # the unsaved orphan is not carried

    # S3 / S4: a payload removed or altered behind the application's back.
    store = store_of(doc_path) / ref["artifact_id"]
    (store / "evidence.jsonl").write_bytes((store / "evidence.jsonl").read_bytes()[:-10])
    log["S4_corrupt"] = check_payloads(doc_path)
    assert log["S4_corrupt"]["artifacts"][ref["artifact_id"]] == "payload_corrupt"
    (store / "evidence.jsonl").unlink()
    log["S3_missing"] = check_payloads(doc_path)
    assert log["S3_missing"]["artifacts"][ref["artifact_id"]] == "payload_missing"

    # S6: Save As from a project whose payload is incomplete publishes nothing.
    failed_dst = work / "failed" / "study-failed.mscanvas"
    failed_dst.parent.mkdir()
    try:
        save_as(doc_path, failed_dst)
        raise AssertionError("Save As published an incomplete copy")
    except OSError as exc:
        log["S6_failed_copy"] = {"error": str(exc).replace(ref["artifact_id"], "<artifact>"),
                                 "document_published": failed_dst.exists(),
                                 "store_published": store_of(failed_dst).exists(),
                                 "leftovers": sorted(p.name for p in failed_dst.parent.iterdir())}
    assert log["S6_failed_copy"] == dict(log["S6_failed_copy"], document_published=False, store_published=False,
                                         leftovers=[])

    # S7: a Save As interrupted after its store was renamed, before its document: retry recognises the leftover.
    interrupted = work / "interrupted" / "study-2.mscanvas"
    interrupted.parent.mkdir()
    copy_store = store_of(copy_path)
    shutil.copytree(copy_store, store_of(interrupted))
    save_as(copy_path, interrupted)
    log["S7_retry_after_interrupt"] = check_payloads(interrupted)
    assert set(log["S7_retry_after_interrupt"]["artifacts"].values()) == {"available"}

    # S8: a destination store that belongs to another project is refused.
    other = work / "other" / "study-3.mscanvas"
    other.parent.mkdir()
    store_of(other).mkdir()
    write_json_atomically(store_of(other) / ".owner.json", {"project_id": str(uuid.uuid4())})
    try:
        save_as(copy_path, other)
        raise AssertionError("Save As took over another project's store")
    except PermissionError:
        log["S8_foreign_store_refused"] = {"document_published": other.exists()}
    assert not other.exists()

    log["payload_bytes"] = {n: m["bytes"] for n, m in ref["files"].items()}
    (root / "storage.json").write_text(json.dumps(log, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(log, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
