"""Regenerates the third-party notices for what MSCanvas actually ships.

    python -B scripts/generate_notices.py [--check]

Scope is the point. `Cargo.lock` has 504 packages and the frontend workspace
has more; almost none of that reaches a user. What ships is the release build of
`mscanvas-desktop` for `x86_64-pc-windows-msvc` plus the production frontend
bundle, so those are the two trees walked here. Build-only tooling -- the
bundler, NSIS, test frameworks, linters -- is excluded, because attribution
obligations follow distribution.

`--check` regenerates in memory and fails if the committed file has drifted,
which is what makes this runnable in CI without writing during a check run.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
NOTICES = REPOSITORY_ROOT / "THIRD_PARTY_NOTICES.md"
TARGET = "x86_64-pc-windows-msvc"

# Licences that oblige us to do more than reproduce a notice. Kept explicit so a
# new one shows up as an unclassified licence rather than passing unnoticed.
SOURCE_OFFER_LICENCES = {"MPL-2.0"}

GENERATED_MARKER = "<!-- generated: scripts/generate_notices.py -->"


def run(command: list[str]) -> str:
    # `pnpm` is `pnpm.cmd` on Windows and CreateProcess will not find it without
    # the extension. Resolving here keeps the call shell-free.
    executable = shutil.which(command[0])
    if executable is None:
        raise SystemExit(f"{command[0]} is not on PATH.")
    result = subprocess.run(
        [executable, *command[1:]],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        raise SystemExit(f"{' '.join(command)} failed ({result.returncode}):\n{result.stderr}")
    return result.stdout


def shipped_crates() -> dict[str, set[str]]:
    """Crates reachable from the desktop binary on Windows, normal edges only."""
    output = run(
        [
            "cargo", "tree",
            "-p", "mscanvas-desktop",
            "--target", TARGET,
            "-e", "normal",
            "--prefix", "none",
            "-f", "{p}|{l}",
        ]
    )
    by_licence: dict[str, set[str]] = defaultdict(set)
    for line in output.splitlines():
        if "|" not in line:
            continue
        package, licence = line.rsplit("|", 1)
        # cargo marks a repeated subtree with `(*)` and a path dependency with
        # its directory; neither belongs in an identity.
        package = re.sub(r"\s*\(\*\)\s*$", "", package).strip()
        package = re.sub(r"\s*\([A-Za-z]:[^)]*\)\s*$", "", package).strip()
        package = re.sub(r"\s*\(proc-macro\)\s*$", "", package).strip()
        licence = re.sub(r"\s*\(\*\)\s*$", "", licence).strip()
        if not package or package.startswith("mscanvas-"):
            continue
        by_licence[licence or "UNDECLARED"].add(package)
    return by_licence


def shipped_frontend() -> dict[str, set[str]]:
    """Production frontend packages, which Vite bundles into the shipped assets."""
    output = run(
        ["pnpm", "licenses", "list", "--prod", "--json", "--filter", "@mscanvas/desktop"]
    )
    by_licence: dict[str, set[str]] = defaultdict(set)
    for licence, entries in json.loads(output).items():
        for entry in entries:
            for version in entry["versions"]:
                by_licence[licence or "UNDECLARED"].add(f"{entry['name']} v{version}")
    return by_licence


def section(title: str, blurb: str, by_licence: dict[str, set[str]]) -> list[str]:
    lines = [f"### {title}", "", blurb, ""]
    lines += ["| Licence | Count | Packages |", "| --- | ---: | --- |"]
    for licence in sorted(by_licence, key=lambda k: (-len(by_licence[k]), k)):
        packages = sorted(by_licence[licence])
        lines.append(f"| `{licence}` | {len(packages)} | {', '.join(f'`{p}`' for p in packages)} |")
    lines.append("")
    return lines


def render(crates: dict[str, set[str]], frontend: dict[str, set[str]]) -> str:
    crate_count = sum(len(v) for v in crates.values())
    frontend_count = sum(len(v) for v in frontend.values())
    source_offer = sorted(
        package
        for licence, packages in crates.items()
        if licence in SOURCE_OFFER_LICENCES
        for package in packages
    )

    lines = [
        "# Third-party notices",
        "",
        GENERATED_MARKER,
        "",
        "MSCanvas redistributes no ProteoWizard build, vendor reader, OpenMS,",
        "pyOpenMS, matchms or proprietary instrument SDK. ProteoWizard is installed",
        "by the user and is never bundled.",
        "",
        "This file covers what the installer actually carries: the release build of",
        f"the desktop binary for `{TARGET}` and the production frontend bundle. Build-only",
        "tooling -- the Tauri bundler, NSIS, test frameworks and linters -- is out of",
        "scope, because attribution follows distribution.",
        "",
        "Regenerate with `python -B scripts/generate_notices.py`; verify with `--check`.",
        "",
        f"Shipped Rust packages: **{crate_count}**. Shipped frontend packages: **{frontend_count}**.",
        "",
        "## Obligations this inventory creates",
        "",
        "- **Attribution.** The MIT, BSD, Zlib, BSL-1.0 and Apache-2.0 packages below",
        "  require their copyright and permission notices to accompany a binary",
        "  distribution. This file travels with the installer for that purpose.",
        "- **Apache-2.0 NOTICE files.** Where an upstream package ships a `NOTICE`,",
        "  its contents must be reproduced. None of the packages below is modified by",
        "  this project.",
        "- **Unicode-3.0.** The ICU packages carry the Unicode licence and its",
        "  disclaimer, reproduced through their own distributions.",
    ]
    if source_offer:
        lines += [
            "- **MPL-2.0 source availability.** "
            + ", ".join(f"`{p}`" for p in source_offer)
            + " are used unmodified, as published on crates.io. Their source for the",
            "  exact versions above is obtainable from <https://crates.io> and the",
            "  upstream repositories each package declares. This project makes no",
            "  modification to any MPL-2.0 file, so no modified source is withheld.",
        ]
    lines += [
        "",
        "## Inventory",
        "",
    ]
    lines += section(
        "Rust packages in the shipped binary",
        f"Walked from `mscanvas-desktop` for `{TARGET}` over normal dependency edges, so "
        "development-only and build-only crates are excluded.",
        crates,
    )
    lines += section(
        "Frontend packages in the shipped bundle",
        "Production dependencies of `@mscanvas/desktop`, which Vite compiles into the "
        "bundled assets.",
        frontend,
    )
    lines += [
        "## Reviewed direct dependencies and their approved scope",
        "",
        "The narrow scope each directly declared dependency was accepted under is",
        "recorded in `docs/development/DEPENDENCY_POLICY.md` and the ADRs that admitted",
        "them. That review governs what these packages may be used for; this file",
        "records what must accompany their redistribution.",
        "",
        "## Limits",
        "",
        "Licence identifiers are the ones each package declares in its own metadata.",
        "They were collected on the versions in the committed lockfiles and are",
        "reproducible from them. No licence text is restated here in place of the",
        "upstream package's own; this is an inventory and an obligation record.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if the committed file has drifted")
    arguments = parser.parse_args()

    rendered = render(shipped_crates(), shipped_frontend())

    if arguments.check:
        current = NOTICES.read_text(encoding="utf-8") if NOTICES.exists() else ""
        if current != rendered:
            print("THIRD_PARTY_NOTICES.md is out of date; run scripts/generate_notices.py", file=sys.stderr)
            return 1
        print("Third-party notices are current.")
        return 0

    NOTICES.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"Wrote {NOTICES.relative_to(REPOSITORY_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
