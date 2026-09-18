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

# Every licence family this inventory knows how to describe an obligation for.
# A declared licence outside this set stops generation rather than landing in
# the table as an unremarked row: an inventory that quietly accepts anything is
# not a compliance record. Non-SPDX spellings (`/` for `OR`) are included
# because packages really declare them.
KNOWN_LICENCE_TERMS = {
    "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD",
    "Zlib", "MPL-2.0", "BSL-1.0", "Unicode-3.0", "Unlicense", "CC0-1.0",
    "ISC", "CDLA-Permissive-2.0",
}

# Why an MPL-2.0 crate is in a mass-spectrometry application at all. Recorded
# because it is the first question a reviewer asks.
MPL_ARRIVAL = {
    "option-ext": "tauri -> dirs -> dirs-sys",
}

# Packages that are not dependencies of anything shipped, yet whose own text
# ends up inside a shipped artifact. A build tool that emits a licence banner
# into its output is distributing that banner, so the obligation travels with
# the output even though the tool itself never ships.
#
# Declared explicitly rather than discovered, because each one is a judgement:
# what exactly ships, and under what licence.
BUILD_TOOLS_WHOSE_OUTPUT_SHIPS = {
    "tailwindcss": {
        "version": "4.3.3",
        "licence": "MIT",
        "what_ships": "the generated stylesheet, including its MIT banner and "
        "the verbatim Preflight base styles",
    },
}


def licence_terms(expression: str) -> set[str]:
    """The individual licence identifiers named in a declared expression."""
    return {
        stripped
        for term in re.split(r"\s+(?:OR|AND)\s+|[/()]", expression)
        if (stripped := term.strip())
    }

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


def parse_row(line: str) -> tuple[str | None, str, str]:
    """One `{p}|{l}|{r}` row, or a `None` package for a row that is not third-party.

    cargo marks a repeated subtree with `(*)`, a proc-macro with `(proc-macro)`
    and a path dependency with its directory. None of those belong in a package
    identity, and leaving them in splits one package into several rows.
    """
    if "|" not in line:
        return None, "", ""
    fields = line.split("|")
    package, licence = fields[0], fields[1] if len(fields) > 1 else ""
    repository = fields[2].strip() if len(fields) > 2 else ""
    package = re.sub(r"\s*\(\*\)\s*$", "", package).strip()
    package = re.sub(r"\s*\((?:[A-Za-z]:|/)[^)]*\)\s*$", "", package).strip()
    package = re.sub(r"\s*\(proc-macro\)\s*$", "", package).strip()
    licence = re.sub(r"\s*\(\*\)\s*$", "", licence).strip()
    if not package or package.startswith("mscanvas-"):
        return None, "", ""
    return package, licence or "UNDECLARED", repository


def shipped_crates() -> tuple[dict[str, set[str]], dict[str, str]]:
    """Crates reachable from the desktop binary on Windows, normal edges only."""
    output = run(
        [
            "cargo", "tree",
            "-p", "mscanvas-desktop",
            "--target", TARGET,
            "--prefix", "none",
            # `no-proc-macro` matters more than it looks. Without it, `normal`
            # descends into proc-macro crates' own dependency trees, which are
            # compiled for the host and never linked into the shipped binary.
            # That pulled in the whole `tauri-codegen` subtree -- 72 extra
            # packages, including four MPL-2.0 crates that do not ship at all.
            "-e", "normal,no-proc-macro",
            "-f", "{p}|{l}|{r}",
        ]
    )
    by_licence: dict[str, set[str]] = defaultdict(set)
    repositories: dict[str, str] = {}
    for line in output.splitlines():
        package, licence, repository = parse_row(line)
        if package is not None:
            by_licence[licence].add(package)
            if repository:
                repositories.setdefault(package, repository)
    return by_licence, repositories


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


def render(crates: dict[str, set[str]], frontend: dict[str, set[str]], repositories: dict[str, str]) -> str:
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
            "- **MPL-2.0 source availability.** MPL-2.0 section 3.2 requires the source",
            "  of the covered files to be available to recipients of a binary. The exact",
            "  shipped versions are named below, each with a location that serves that",
            "  source: the crates.io page for the version, which offers the published",
            "  `.crate` archive, and the upstream repository the package declares.",
            "  Availability is what discharges the obligation; the fact that this project",
            "  modifies none of these files is additional, not a substitute for it.",
            "  Each arrives transitively through Tauri rather than being chosen here.",
            "",
            "  | Crate and shipped version | Source for that version | Upstream repository | Reached through |",
            "  | --- | --- | --- | --- |",
        ]
        for package in source_offer:
            name, _, version = package.partition(" v")
            crates_io = f"https://crates.io/crates/{name}/{version}"
            repository = repositories.get(package, "not declared")
            lines.append(
                f"  | `{package}` | <{crates_io}> | <{repository}> | "
                f"{MPL_ARRIVAL.get(name, 'unrecorded')} |"
            )
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
        "Production dependencies of `@mscanvas/desktop`. Vite bundles what is imported "
        "rather than what is declared, so this is the declared set; the generator "
        "separately fails if a shipped asset names a package not covered here.",
        frontend,
    )
    lines += [
        "### Build tools whose output ships",
        "",
        "These are not dependencies of the application. They run at build time and are "
        "listed because their own text ends up inside a shipped artifact, which is "
        "distribution of that text.",
        "",
        "| Tool | Version | Licence | What actually ships |",
        "| --- | --- | --- | --- |",
    ]
    for tool, facts in sorted(BUILD_TOOLS_WHOSE_OUTPUT_SHIPS.items()):
        lines.append(
            f"| `{tool}` | {facts['version']} | `{facts['licence']}` | {facts['what_ships']} |"
        )
    lines.append("")
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


def assert_known_licences(*inventories: dict[str, set[str]]) -> None:
    unknown: dict[str, set[str]] = defaultdict(set)
    for inventory in inventories:
        for expression, packages in inventory.items():
            for term in licence_terms(expression) - KNOWN_LICENCE_TERMS:
                unknown[term] |= packages
    if unknown:
        report = "\n".join(
            f"  {term}: {', '.join(sorted(packages))}" for term, packages in sorted(unknown.items())
        )
        raise SystemExit(
            "Unclassified licence term(s); decide the obligation and add it to "
            f"KNOWN_LICENCE_TERMS before shipping:\n{report}"
        )


def assert_frontend_banners_are_covered(frontend: dict[str, set[str]]) -> None:
    """Fails when a shipped asset names a package the inventory does not cover.

    Walking declared production dependencies misses a whole class: Vite bundles
    what is imported, not what is declared, and a build tool can emit its own
    licence banner into the output it generates. `tailwindcss` is a
    devDependency whose MIT banner and verbatim base styles ship inside the
    stylesheet, so no production-dependency walk would ever have found it.
    """
    dist = REPOSITORY_ROOT / "apps/desktop/dist"
    if not dist.is_dir():
        return

    banner = re.compile(r"([A-Za-z0-9@._/-]+)\s+v?\d[\w.+-]*\s*\|\s*[A-Za-z0-9.\- ]*Licen[cs]e")
    declared = {name.split(" v")[0] for packages in frontend.values() for name in packages}
    known = declared | set(BUILD_TOOLS_WHOSE_OUTPUT_SHIPS)

    uncovered: dict[str, str] = {}
    for asset in sorted(dist.rglob("*")):
        if not asset.is_file() or asset.suffix.lower() not in {".js", ".css", ".mjs"}:
            continue
        for match in banner.finditer(asset.read_text(encoding="utf-8", errors="replace")):
            package = match.group(1)
            if package not in known:
                uncovered.setdefault(package, f"{asset.relative_to(REPOSITORY_ROOT)}: {match.group(0)}")

    if uncovered:
        report = "\n".join(f"  {name}: {where}" for name, where in sorted(uncovered.items()))
        raise SystemExit(
            "A shipped frontend asset names a package the inventory does not cover.\n"
            "Decide its obligation and add it to BUILD_TOOLS_WHOSE_OUTPUT_SHIPS, or to the\n"
            "production dependencies if that is what it really is:\n" + report
        )


def selftest() -> None:
    """Guards the line parsing, which is where a package name gets mangled."""
    sample = [
        "serde v1.0.229|MIT OR Apache-2.0|https://github.com/serde-rs/serde",
        "serde v1.0.229|MIT OR Apache-2.0 (*)|https://github.com/serde-rs/serde",
        "serde_derive v1.0.229 (proc-macro)|MIT OR Apache-2.0|https://github.com/serde-rs/serde",
        "mscanvas-core v0.1.0 (D:\\Github repo\\MScanvas\\crates\\core)|Apache-2.0|",
        "cssparser v0.36.0|MPL-2.0|https://github.com/servo/rust-cssparser",
    ]
    parsed: dict[str, set[str]] = defaultdict(set)
    found: dict[str, str] = {}
    for line in sample:
        package, licence, repository = parse_row(line)
        if package is not None:
            parsed[licence].add(package)
            if repository:
                found.setdefault(package, repository)

    assert parsed["MIT OR Apache-2.0"] == {"serde v1.0.229", "serde_derive v1.0.229"}, parsed
    assert parsed["MPL-2.0"] == {"cssparser v0.36.0"}, parsed
    # An MPL crate without a usable source location would ship an unmet obligation.
    assert found["cssparser v0.36.0"] == "https://github.com/servo/rust-cssparser", found
    # The workspace's own crates are not third-party and must not be listed.
    assert "Apache-2.0" not in parsed, parsed
    # Deduplicated rows must collapse, not produce a second spelling.
    assert len(parsed) == 2, parsed

    # The banner pattern must match the real thing it was written for, or the
    # guard silently covers nothing. This is the literal text Tailwind emits.
    banner = re.compile(r"([A-Za-z0-9@._/-]+)\s+v?\d[\w.+-]*\s*\|\s*[A-Za-z0-9.\- ]*Licen[cs]e")
    real = "tailwindcss v4.3.3 | MIT License | https://tailwindcss.com"
    found = banner.search(real)
    assert found is not None and found.group(1) == "tailwindcss", real
    assert banner.search("/*! normalize.css v8.0.1 | MIT License | github.com */") is not None
    assert banner.search("just some minified code without a banner") is None

    assert licence_terms("MIT/Apache-2.0") == {"MIT", "Apache-2.0"}
    assert licence_terms("(MIT OR Apache-2.0) AND Unicode-3.0") == {"MIT", "Apache-2.0", "Unicode-3.0"}
    assert licence_terms("Unlicense OR MIT") == {"Unlicense", "MIT"}
    print("generate_notices selftest passed.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if the committed file has drifted")
    parser.add_argument("--selftest", action="store_true", help="check the row parsing and exit")
    arguments = parser.parse_args()

    if arguments.selftest:
        selftest()
        return 0

    crates, repositories = shipped_crates()
    frontend = shipped_frontend()
    assert_known_licences(crates, frontend)
    assert_frontend_banners_are_covered(frontend)
    rendered = render(crates, frontend, repositories)

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
