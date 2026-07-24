#!/usr/bin/env python3
"""Validate the dependency-free structural contracts of the MSCanvas repository."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]

PINNED_NODE = "22.23.1"
SUPPORTED_NODE = ">=22.13.0 <23"
MINIMUM_NODE = "22.13.0"
PINNED_PNPM = "11.15.1"
PINNED_RUST = "1.97.1"

REQUIRED = [
    "PROJECT_PROPOSAL.md",
    "AGENTS.md",
    "README.md",
    "LICENSE",
    "Cargo.toml",
    "Cargo.lock",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".node-version",
    "apps/desktop/src-tauri/icons/source.svg",
    "apps/desktop/src-tauri/icons/icon.ico",
    "apps/desktop/src-tauri/icons/icon.png",
    "docs/product/FEATURE_CATALOG.md",
    "docs/product/PRIMARY_WORKFLOWS.md",
    "docs/ux/UX_PROCESS.md",
    "docs/architecture/ARCHITECTURE.md",
    ".codex/config.toml",
    ".codex/rules/default.rules",
]

JSON_GLOBS = ["**/*.json"]
TOML_GLOBS = ["**/*.toml"]
MARKDOWN_GLOBS = ["**/*.md"]
LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")


def fail(message: str, errors: list[str]) -> None:
    errors.append(message)


def validate_required(errors: list[str]) -> None:
    for relative in REQUIRED:
        if not (ROOT / relative).exists():
            fail(f"missing required path: {relative}", errors)


def validate_json(errors: list[str]) -> None:
    for pattern in JSON_GLOBS:
        for path in ROOT.glob(pattern):
            if any(part in {"node_modules", "target", ".git"} for part in path.parts):
                continue
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                fail(f"invalid JSON {path.relative_to(ROOT)}: {exc}", errors)


def validate_toml(errors: list[str]) -> None:
    for pattern in TOML_GLOBS:
        for path in ROOT.glob(pattern):
            if any(part in {"node_modules", "target", ".git"} for part in path.parts):
                continue
            try:
                tomllib.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                fail(f"invalid TOML {path.relative_to(ROOT)}: {exc}", errors)


def validate_skill_frontmatter(errors: list[str]) -> None:
    for path in ROOT.glob(".agents/skills/*/SKILL.md"):
        text = path.read_text(encoding="utf-8")
        if not text.startswith("---\n"):
            fail(f"missing YAML frontmatter: {path.relative_to(ROOT)}", errors)
            continue
        try:
            _, frontmatter, _ = text.split("---", 2)
        except ValueError:
            fail(f"unterminated YAML frontmatter: {path.relative_to(ROOT)}", errors)
            continue
        if not re.search(r"(?m)^name:\s*\S+", frontmatter):
            fail(f"skill frontmatter missing name: {path.relative_to(ROOT)}", errors)
        if not re.search(r"(?m)^description:\s*\S+", frontmatter):
            fail(f"skill frontmatter missing description: {path.relative_to(ROOT)}", errors)


def validate_markdown_links(errors: list[str]) -> None:
    for pattern in MARKDOWN_GLOBS:
        for path in ROOT.glob(pattern):
            if any(part in {"node_modules", "target", ".git"} for part in path.parts):
                continue
            text = path.read_text(encoding="utf-8")
            for target in LINK_RE.findall(text):
                target = target.strip().split("#", 1)[0]
                if not target or target.startswith(("http://", "https://", "mailto:")):
                    continue
                target = unquote(target)
                candidate = (path.parent / target).resolve()
                try:
                    candidate.relative_to(ROOT.resolve())
                except ValueError:
                    fail(f"link escapes repository in {path.relative_to(ROOT)}: {target}", errors)
                    continue
                if not candidate.exists():
                    fail(f"broken relative link in {path.relative_to(ROOT)}: {target}", errors)


def validate_project_contract(errors: list[str]) -> None:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if package.get("packageManager") != f"pnpm@{PINNED_PNPM}":
        fail(f"root packageManager must remain pinned to pnpm@{PINNED_PNPM}", errors)

    engines = package.get("engines", {})
    if engines.get("node") != SUPPORTED_NODE:
        fail(f"root Node engine must remain {SUPPORTED_NODE}", errors)
    if engines.get("pnpm") != PINNED_PNPM:
        fail(f"root pnpm engine must remain exactly {PINNED_PNPM}", errors)

    node_version = (ROOT / ".node-version").read_text(encoding="utf-8").strip()
    if node_version != PINNED_NODE:
        fail(f".node-version must remain pinned to {PINNED_NODE}", errors)

    rust_toolchain = tomllib.loads((ROOT / "rust-toolchain.toml").read_text(encoding="utf-8"))
    if rust_toolchain.get("toolchain", {}).get("channel") != PINNED_RUST:
        fail(f"rust-toolchain.toml must remain pinned to {PINNED_RUST}", errors)

    desktop_package = json.loads(
        (ROOT / "apps/desktop/package.json").read_text(encoding="utf-8")
    )
    node_types = desktop_package.get("devDependencies", {}).get("@types/node", "")
    match = re.match(r"^[~^]?(\d+)", node_types)
    if match is None or int(match.group(1)) != int(PINNED_NODE.split(".", 1)[0]):
        fail("@types/node major must match the pinned Node runtime major", errors)

    required_pins = {
        ".github/workflows/frontend.yml": [
            "node-version-file: .node-version",
            f"pnpm@{PINNED_PNPM}",
            "pnpm install --frozen-lockfile",
            "pnpm lint",
        ],
        ".github/workflows/windows-smoke.yml": [
            "node-version-file: .node-version",
            f"pnpm@{PINNED_PNPM}",
            "pnpm install --frozen-lockfile",
        ],
        ".github/workflows/rust.yml": [
            f"cargo +{PINNED_RUST} clippy --locked",
            f"cargo +{PINNED_RUST} test --locked",
        ],
        "scripts/bootstrap.ps1": [
            f'$MinimumNodeVersion = [version]"{MINIMUM_NODE}"',
            '$NodeMajorVersion = 22',
            f'$PnpmVersion = "{PINNED_PNPM}"',
            f'$RustToolchain = "{PINNED_RUST}"',
            "Assert-NativeSuccess",
            "pnpm install --frozen-lockfile",
            "clippy --locked",
            "test --locked",
        ],
    }
    for relative, snippets in required_pins.items():
        text = (ROOT / relative).read_text(encoding="utf-8")
        for snippet in snippets:
            if snippet not in text:
                fail(f"missing bootstrap contract in {relative}: {snippet}", errors)
        if "--no-frozen-lockfile" in text:
            fail(f"non-frozen pnpm install is forbidden in {relative}", errors)
        if "corepack prepare" in text:
            fail(f"stale bundled Corepack activation is forbidden in {relative}", errors)

    capability = json.loads(
        (ROOT / "apps/desktop/src-tauri/capabilities/default.json").read_text(
            encoding="utf-8"
        )
    )
    if capability.get("permissions"):
        fail("the mock shell must not expose unused Tauri core API permissions", errors)

    config = tomllib.loads((ROOT / ".codex/config.toml").read_text(encoding="utf-8"))
    if int(config.get("project_doc_max_bytes", 0)) < (ROOT / "PROJECT_PROPOSAL.md").stat().st_size:
        fail("Codex project_doc_max_bytes is smaller than PROJECT_PROPOSAL.md", errors)

    proposal = (ROOT / "PROJECT_PROPOSAL.md").read_text(encoding="utf-8")
    if "MSCanvas" not in proposal or "Product & Engineering Source of Truth" not in proposal:
        fail("PROJECT_PROPOSAL.md does not identify the MSCanvas source-of-truth contract", errors)


def main() -> int:
    errors: list[str] = []
    validate_required(errors)
    if not errors:
        validate_json(errors)
        validate_toml(errors)
        validate_skill_frontmatter(errors)
        validate_markdown_links(errors)
        validate_project_contract(errors)

    if errors:
        print("Repository validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Repository validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
