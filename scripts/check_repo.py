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
    "docs/development/DEPENDENCY_POLICY.md",
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

    dependabot = (ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
    for snippet in [
        "version-update:semver-minor",
        "version-update:semver-patch",
        "applies-to: version-updates",
    ]:
        if snippet not in dependabot:
            fail(f"missing Dependabot policy contract: {snippet}", errors)
    if "version-update:semver-major" in dependabot:
        fail("automated Dependabot major version updates require deliberate review", errors)

    config = tomllib.loads((ROOT / ".codex/config.toml").read_text(encoding="utf-8"))
    if int(config.get("project_doc_max_bytes", 0)) < (ROOT / "PROJECT_PROPOSAL.md").stat().st_size:
        fail("Codex project_doc_max_bytes is smaller than PROJECT_PROPOSAL.md", errors)

    proposal = (ROOT / "PROJECT_PROPOSAL.md").read_text(encoding="utf-8")
    if "MSCanvas" not in proposal or "Product & Engineering Source of Truth" not in proposal:
        fail("PROJECT_PROPOSAL.md does not identify the MSCanvas source-of-truth contract", errors)


CONTINUATION_RE = re.compile(r"\\\n[ \t]*")
INLINE_RUN_RE = re.compile(r"(?<!\\)[A-Za-z,.][ ]{2,}[A-Za-z]")
# A sentence cut across lines. Not merely "contains a newline": a multi-line
# template holding CSS breaks after `{` and `;`, which is deliberate, while a
# message that lost its continuation breaks after a word.
SENTENCE_BREAK_RE = re.compile(r"[A-Za-z,.]\n")
BACKTICK = chr(96)
# Stands in for an excluded `${...}`. Removing an interpolation outright would
# join the spaces on either side of it and manufacture the very run of spaces
# this check looks for.
INTERPOLATION = chr(1)
# After one of these, or at the start of an interpolation, a slash opens a
# pattern rather than dividing. A pattern matters because it can hold a brace,
# and a brace counted as structure closes the interpolation early.
REGEX_MAY_FOLLOW = "([{,;:?=!&|+-*%~^<>"


def _quoted(text: str, start: int, quote: str) -> tuple[str, int]:
    """Reads a simple quoted string. `start` is just past the opening quote."""
    index = start
    length = len(text)
    while index < length:
        if text[index] == "\\":
            index += 2
            continue
        if text[index] == quote:
            break
        index += 1
    return text[start:index], index + 1


def _skip_regex(text: str, start: int) -> int | None:
    """Reads a regex literal opened at `start`. None if it does not close."""
    index = start + 1
    length = len(text)
    in_class = False
    while index < length:
        character = text[index]
        if character == "\\":
            index += 2
            continue
        if character == "\n":
            return None
        if character == "[":
            in_class = True
        elif character == "]":
            in_class = False
        elif character == "/" and not in_class:
            return index + 1
        index += 1
    return None


def _template(text: str, start: int):
    """Reads a template literal, skipping `${...}` but scanning inside it.

    The interpolation holds code, not message text, so its contents are excluded
    from what gets judged; a newline inside `${}` is formatting, not a broken
    sentence. Literals nested in there are still returned, because a template
    inside an interpolation is exactly where a broken message can hide.

    Returns None when the literal does not close, or when the scanner meets
    something it cannot read confidently. A scanner that has lost its place
    reports nothing rather than reporting confidently about the wrong text.
    """
    parts: list[str] = []
    nested: list[tuple[int, str]] = []
    index = start
    length = len(text)
    while index < length:
        character = text[index]
        if character == "\\":
            parts.append(text[index : index + 2])
            index += 2
            continue
        if character == BACKTICK:
            return "".join(parts), index + 1, nested
        if character == "$" and index + 1 < length and text[index + 1] == "{":
            depth = 1
            index += 2
            previous = ""
            closed = False
            while index < length:
                inner = text[index]
                if inner == "/" and index + 1 < length and text[index + 1] == "/":
                    end = text.find("\n", index)
                    index = length if end == -1 else end
                    continue
                if inner == "/" and index + 1 < length and text[index + 1] == "*":
                    end = text.find("*/", index + 2)
                    if end == -1:
                        return None
                    index = end + 2
                    continue
                if inner == "/" and (previous == "" or previous in REGEX_MAY_FOLLOW):
                    end = _skip_regex(text, index)
                    if end is None:
                        return None
                    index = end
                    previous = ")"
                    continue
                if inner == BACKTICK:
                    scanned = _template(text, index + 1)
                    if scanned is None:
                        return None
                    content, index, deeper = scanned
                    nested.append((index, content))
                    nested.extend(deeper)
                    previous = ")"
                    continue
                if inner in {'"', "'"}:
                    content, index = _quoted(text, index + 1, inner)
                    if inner == '"':
                        nested.append((index, content))
                    previous = ")"
                    continue
                if inner == "{":
                    depth += 1
                elif inner == "}":
                    depth -= 1
                    if depth == 0:
                        parts.append(INTERPOLATION)
                        index += 1
                        closed = True
                        break
                if not inner.isspace():
                    previous = inner
                index += 1
            if not closed:
                return None
            continue
        parts.append(character)
        index += 1
    return None


def _string_literals(text: str, rust: bool) -> list[tuple[int, str]]:
    """Yields (offset, source text) for every string literal that can hold prose.

    Scanned rather than matched line by line. A string that lost its line
    continuation is still a valid literal spanning two physical lines, so a
    per-line regex sees neither a complete literal nor the defect, which is
    exactly the case this check exists for.

    Raw strings are skipped because their contents are deliberate. Quoting
    differs by language. In Rust an apostrophe opens a character literal or a
    lifetime. In TypeScript it would open a string, but it is not treated as one
    here: prose and JSX text are full of apostrophes, and one of them opens a
    literal that swallows the rest of the file. Prettier pins this repository to
    double quotes, so nothing is lost by scanning only those and the template
    literals TypeScript also has.
    """
    literals: list[tuple[int, str]] = []
    index = 0
    length = len(text)
    while index < length:
        character = text[index]

        if character == "/" and index + 1 < length:
            following = text[index + 1]
            if following == "/":
                end = text.find("\n", index)
                index = length if end == -1 else end
                continue
            if following == "*":
                end = text.find("*/", index + 2)
                index = length if end == -1 else end + 2
                continue

        if rust and character == "r" and index + 1 < length:
            hashes = 0
            probe = index + 1
            while probe < length and text[probe] == "#":
                hashes += 1
                probe += 1
            if probe < length and text[probe] == '"':
                terminator = '"' + "#" * hashes
                end = text.find(terminator, probe + 1)
                index = length if end == -1 else end + len(terminator)
                continue

        # `b'"'` in the path scanner would otherwise open a string that swallows
        # the rest of the file. A lifetime never closes, so it is stepped over.
        if rust and character == "'":
            if index + 1 < length and text[index + 1] == "\\":
                closing = text.find("'", index + 2)
                index = length if closing == -1 else closing + 1
                continue
            if index + 2 < length and text[index + 2] == "'":
                index += 3
                continue
            index += 1
            continue

        if not rust and character == BACKTICK:
            start = index + 1
            scanned = _template(text, start)
            if scanned is None:
                # Lost the thread. Report nothing about this file rather than
                # report confidently about text the scanner has misread.
                return []
            content, index, nested = scanned
            literals.append((start, content))
            literals.extend(nested)
            continue

        if character == '"':
            start = index + 1
            content, index = _quoted(text, start, '"')
            literals.append((start, content))
            continue

        index += 1

    return literals


def validate_user_facing_strings(errors: list[str]) -> None:
    """Catches a lost line continuation inside a user-facing message.

    A string split across lines ends with a backslash, which removes the newline
    and the next line's indentation. Lose the backslash and the indentation
    stays in the message: six shipped strings read "...the commands
    <35 spaces> MSCanvas needs." Nothing caught them, because the code compiled,
    passed Clippy and produced no warning.

    Two shapes, because the defect has two. Removing the backslash from a
    wrapped literal leaves a valid literal that still spans two lines, with the
    newline and indentation now inside the message. Reflowing that onto one line
    leaves a run of spaces between two words. Neither is intentional in a
    message, and the first is the one a per-line check cannot see.
    """
    for directory in ("crates", "apps"):
        root = ROOT / directory
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.suffix not in {".rs", ".ts", ".tsx"} or not path.is_file():
                continue
            if "target" in path.parts or "node_modules" in path.parts:
                continue
            text = path.read_text(encoding="utf-8")
            relative = path.relative_to(ROOT).as_posix()
            for offset, source in _string_literals(text, path.suffix == ".rs"):
                # Apply the continuation the compiler applies before judging
                # what the message actually contains.
                content = CONTINUATION_RE.sub("", source)
                number = text.count("\n", 0, offset) + 1
                if SENTENCE_BREAK_RE.search(content):
                    fail(
                        f"{relative}:{number} has a string literal whose sentence continues "
                        "on the next line with no continuation, so the newline and the "
                        "indentation are in the message",
                        errors,
                    )
                elif INLINE_RUN_RE.search(content):
                    fail(
                        f"{relative}:{number} has a run of spaces inside a string literal, "
                        "which is what a lost line continuation looks like",
                        errors,
                    )


def main() -> int:
    errors: list[str] = []
    validate_required(errors)
    if not errors:
        validate_json(errors)
        validate_toml(errors)
        validate_skill_frontmatter(errors)
        validate_markdown_links(errors)
        validate_project_contract(errors)
        validate_user_facing_strings(errors)

    if errors:
        print("Repository validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Repository validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
