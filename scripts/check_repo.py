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

REQUIRED = [
    "PROJECT_PROPOSAL.md",
    "AGENTS.md",
    "README.md",
    "LICENSE",
    "Cargo.toml",
    "package.json",
    "pnpm-workspace.yaml",
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
    if package.get("packageManager") != "pnpm@11.15.1":
        fail("root packageManager must remain pinned to pnpm@11.15.1 until intentionally updated", errors)

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
