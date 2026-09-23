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
references a payload that was not already whole. Save As never deletes a store:
a destination store that already exists is refused.
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


def save_as(src: Path, dst: Path, copy=shutil.copytree) -> list[str]:
    """Copy every available payload into a store the new document owns, verified, before publishing it.

    Returns the artifacts carried forward as unavailable: a payload already missing or
    corrupt in the source cannot be made whole by copying, and its record stays in history.
    An existing destination store is never deleted, whoever it seems to belong to.
    """
    doc = json.loads(src.read_text(encoding="utf-8"))
    if dst.exists():
        raise FileExistsError("Save As refuses an existing destination")
    dst_store = store_of(dst)
    if dst_store.exists():
        raise FileExistsError(f"{dst_store.name} already exists; choose another name or remove it yourself")
    status = check_payloads(src)["artifacts"]
    unavailable = [a for a, st in status.items() if st != "available"]
    pending = dst.with_name(f".{dst_store.name}.{uuid.uuid4().hex}.pending")
    pending.mkdir()
    try:
        for art in doc["artifacts"]:
            ref = art["payload"]
            if art["artifact_id"] in unavailable:
                continue
            source = store_of(src) / ref["artifact_id"]
            target = pending / ref["artifact_id"]
            copy(source, target)
            if sha256(target / "manifest.json") != ref["manifest_sha256"] or any(
                    sha256(target / n) != m["sha256"] for n, m in ref["files"].items()):
                raise OSError(f"payload {ref['artifact_id']} did not copy whole")
        write_json_atomically(pending / ".owner.json", {"project_id": doc["project_id"]})
        os.rename(pending, dst_store)  # rename, not replace: a store that appeared meanwhile is refused
    except Exception:
        shutil.rmtree(pending, ignore_errors=True)
        raise
    tmp = dst.with_name(f".{dst.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8", newline="\n")
    try:
        os.rename(tmp, dst)  # refuse-existing publish; identifiers unchanged, locators rebased by M8's rule
    except OSError:
        tmp.unlink()
        raise
    return unavailable


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

    # S6a: a payload already missing in the source is carried forward as unavailable, not invented.
    carried_dst = work / "carried" / "study-carried.mscanvas"
    carried_dst.parent.mkdir()
    carried = save_as(doc_path, carried_dst)
    log["S6a_unavailable_carried_forward"] = dict(check_payloads(carried_dst),
                                                  reported_unavailable=[a == ref["artifact_id"] for a in carried])
    assert log["S6a_unavailable_carried_forward"]["artifacts"][ref["artifact_id"]] == "payload_missing"

    # S6b: a copy of an available payload that does not verify publishes nothing and leaves nothing.
    good_src = copy_path
    failed_dst = work / "failed" / "study-failed.mscanvas"
    failed_dst.parent.mkdir()

    def damaging_copy(source, target):
        shutil.copytree(source, target)
        (target / "rows.jsonl").write_bytes(b"{}\n")

    try:
        save_as(good_src, failed_dst, copy=damaging_copy)
        raise AssertionError("Save As published an incomplete copy")
    except OSError as exc:
        log["S6b_failed_copy"] = {"error": str(exc).replace(ref["artifact_id"], "<artifact>"),
                                  "document_published": failed_dst.exists(),
                                  "store_published": store_of(failed_dst).exists(),
                                  "leftovers": sorted(p.name for p in failed_dst.parent.iterdir())}
    assert log["S6b_failed_copy"] == dict(log["S6b_failed_copy"], document_published=False, store_published=False,
                                          leftovers=[])

    # S7: a store left at the destination by an interrupted Save As is refused, never deleted.
    interrupted = work / "interrupted" / "study-2.mscanvas"
    interrupted.parent.mkdir()
    shutil.copytree(store_of(copy_path), store_of(interrupted))
    try:
        save_as(copy_path, interrupted)
        raise AssertionError("Save As replaced an existing store")
    except FileExistsError:
        log["S7_leftover_store_refused"] = {"document_published": interrupted.exists(),
                                            "store_kept": store_of(interrupted).exists()}
    assert log["S7_leftover_store_refused"] == {"document_published": False, "store_kept": True}

    # S8: a destination store that belongs to another project is refused.
    other = work / "other" / "study-3.mscanvas"
    other.parent.mkdir()
    store_of(other).mkdir()
    write_json_atomically(store_of(other) / ".owner.json", {"project_id": str(uuid.uuid4())})
    try:
        save_as(copy_path, other)
        raise AssertionError("Save As took over another project's store")
    except FileExistsError:
        log["S8_foreign_store_refused"] = {"document_published": other.exists()}
    assert not other.exists()

    log["payload_bytes"] = {n: m["bytes"] for n, m in ref["files"].items()}
    (root / "storage.json").write_text(json.dumps(log, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(log, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
