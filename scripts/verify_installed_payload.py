#!/usr/bin/env python3
"""Verify an installed Tauri executable against the compiled pre-bundle one.

The bundler rewrites a single token in the executable while packaging, so the
installed file never equals the compiled artifact the candidate manifest
records. This derives the expected payload from the pre-bundle binary by
reproducing exactly that rewrite, then compares complete hashes.

Identities kept apart, because they are different objects:

  1 pre-bundle    the compiled `target/release` executable (what the manifest records)
  2 payload       1 after the bundler's rewrite -- DERIVED here, never extracted
  3 installer     the NSIS container (compared elsewhere, by its own digest)
  4 installed     what is actually on disk in the guest

Bound to the pinned bundler, not upstream HEAD: `@tauri-apps/cli` 2.11.4 carries
exactly three token literals -- the `UNK` placeholder plus the `MSI` and `NSS`
targets -- beside the format string "Patching {} with bundle type information:"
from `crates/tauri-bundler/src/bundle.rs`.

Offsets are 0-based byte offsets from the start of the file.
"""

from __future__ import annotations

import argparse
import hashlib
import sys

PREFIX = b"__TAURI_BUNDLE_TYPE_VAR_"
PLACEHOLDER = b"UNK"
KNOWN_TYPES = (b"NSS", b"MSI")


class PayloadError(Exception):
    """The pre-bundle binary is not in a state this rewrite can be applied to."""


def derive_payload(pre: bytes, bundle_type: bytes) -> tuple[bytes, int]:
    """Return (payload, token_offset) for `pre` rewritten to `bundle_type`.

    Rewrites the one placeholder occurrence in place. Never a replace-all: if
    the token appears anything other than exactly once the rewrite is ambiguous
    and we refuse rather than guess which one the bundler would have patched.
    """
    if len(bundle_type) != len(PLACEHOLDER):
        raise PayloadError(
            f"bundle type {bundle_type!r} is {len(bundle_type)} bytes, "
            f"must be {len(PLACEHOLDER)} so the length is preserved"
        )

    token = PREFIX + PLACEHOLDER
    offsets = []
    at = pre.find(token)
    while at >= 0:
        offsets.append(at)
        at = pre.find(token, at + 1)

    if len(offsets) != 1:
        raise PayloadError(
            f"expected exactly 1 occurrence of {token!r}, found {len(offsets)} at {offsets}"
        )

    off = offsets[0]
    cut = off + len(PREFIX)
    payload = pre[:cut] + bundle_type + pre[cut + len(PLACEHOLDER):]
    if len(payload) != len(pre):
        raise PayloadError("rewrite changed the file length")
    return payload, off


def differing_offsets(a: bytes, b: bytes) -> list[int]:
    """Every byte offset at which `a` and `b` differ."""
    if len(a) != len(b):
        raise PayloadError(f"length mismatch: {len(a)} vs {len(b)}")
    return [i for i in range(len(a)) if a[i] != b[i]]


def verify(pre: bytes, bundle_type: bytes, expected_sha256: str) -> dict:
    """Derive the payload and check it is the installed file, exactly.

    Fails on any difference outside the rewritten token. "Only a few bytes
    differ" is not a pass -- an unsigned candidate gives us no other way to
    tell a bundler rewrite from tampering, so the difference has to be
    precisely the one the pinned bundler makes and nothing else.
    """
    payload, off = derive_payload(pre, bundle_type)
    cut = off + len(PREFIX)
    allowed = set(range(cut, cut + len(PLACEHOLDER)))

    actual = set(differing_offsets(pre, payload))
    unexpected = sorted(actual - allowed)
    if unexpected:
        raise PayloadError(f"rewrite touched bytes outside the token: {unexpected[:8]}")

    got = hashlib.sha256(payload).hexdigest()
    return {
        "token_offset": off,
        "rewritten_offsets": sorted(allowed),
        "derived_sha256": got,
        "expected_sha256": expected_sha256,
        "match": got == expected_sha256.lower(),
        "bytes": len(payload),
    }


def _controls(pre: bytes, expected: str) -> int:
    """Positive and negative controls, so a pass means the check can also fail."""
    failures = 0

    def check(name: str, condition: bool, detail: str = "") -> None:
        nonlocal failures
        ok = "PASS" if condition else "FAIL"
        if not condition:
            failures += 1
        print(f"  [{ok}] {name}{(' -- ' + detail) if detail else ''}")

    print("controls:")

    # Positive: the genuine derivation reproduces the installed file.
    res = verify(pre, b"NSS", expected)
    check("positive: NSS derivation matches the installed digest", res["match"],
          f"derived {res['derived_sha256'][:16]}...")

    # Negative: a byte changed outside the token must be rejected.
    payload, off = derive_payload(pre, b"NSS")
    victim = 0 if off != 0 else len(payload) - 1
    tampered = bytearray(payload)
    tampered[victim] ^= 0xFF
    tampered_sha = hashlib.sha256(bytes(tampered)).hexdigest()
    check("negative: a byte flipped outside the token no longer matches",
          tampered_sha != expected, f"offset {victim}")

    # Negative: the wrong bundle type must not satisfy an NSIS-installed digest.
    msi = verify(pre, b"MSI", expected)
    check("negative: MSI derivation rejected against an NSIS install",
          not msi["match"], f"derived {msi['derived_sha256'][:16]}...")

    # Negative: an ambiguous binary (token twice) must refuse, not guess.
    doubled = pre + PREFIX + PLACEHOLDER
    try:
        derive_payload(doubled, b"NSS")
        check("negative: ambiguous token count refused", False, "no error raised")
    except PayloadError as exc:
        check("negative: ambiguous token count refused", "found 2" in str(exc))

    # Negative: a wrong-length bundle type must refuse rather than resize.
    try:
        derive_payload(pre, b"NSIS")
        check("negative: wrong-length bundle type refused", False, "no error raised")
    except PayloadError:
        check("negative: wrong-length bundle type refused", True)

    return failures


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pre-bundle", required=True,
                    help="compiled target/release executable (identity 1)")
    ap.add_argument("--expect-installed", required=True,
                    help="SHA-256 actually observed on the installed file (identity 4)")
    ap.add_argument("--bundle-type", default="NSS", choices=[t.decode() for t in KNOWN_TYPES],
                    help="bundler target; NSS is NSIS")
    ap.add_argument("--controls", action="store_true",
                    help="also run the positive and negative controls")
    args = ap.parse_args()

    pre = open(args.pre_bundle, "rb").read()
    print(f"pre-bundle : {args.pre_bundle}")
    print(f"  bytes    : {len(pre)}")
    print(f"  sha256   : {hashlib.sha256(pre).hexdigest()}")

    try:
        res = verify(pre, args.bundle_type.encode(), args.expect_installed)
    except PayloadError as exc:
        print(f"REFUSED: {exc}")
        return 2

    print(f"token      : offset {res['token_offset']} (0-based), "
          f"rewritten bytes {res['rewritten_offsets']}")
    print(f"derived    : {res['derived_sha256']}   <- DERIVED, not extracted")
    print(f"installed  : {res['expected_sha256']}")
    print(f"verdict    : {'MATCH' if res['match'] else 'MISMATCH'}")

    failures = _controls(pre, args.expect_installed.lower()) if args.controls else 0

    if not res["match"]:
        return 1
    if failures:
        print(f"{failures} control(s) failed")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
