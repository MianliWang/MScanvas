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
# The same defect reflowed onto one line. What precedes the run is not
# restricted to a letter: a digit or a closing bracket ends a cut sentence as
# surely as a word does. What follows it still must be a letter, and that is
# what separates a broken message from deliberate column alignment — the
# simulated help fixtures align with runs of spaces before a `:`, never before
# a word. Which escapes may precede a run is decided per match, in
# `_reflowed_gap`, rather than by a lookbehind here.
#
# Residual, stated rather than implied: a sentence reflowed onto one line whose
# next word is a number is not caught. Its two-line form is, by the newline
# rule above, and that is the form the defect actually takes.
INLINE_RUN_RE = re.compile(r"[^\s][ ]{2,}[A-Za-z]")
# Any newline left in an ordinary literal once continuations are applied. Rust
# spells a deliberate newline `\n`, and content that is genuinely multi-line
# lives in a raw string, which this does not read. So a newline surviving here
# is a continuation that went missing, whatever character precedes it: a digit
# or a closing bracket ends a cut sentence as surely as a letter does.
EMBEDDED_NEWLINE_RE = re.compile(r"\n")


def _rust_string_literals(text: str) -> list[tuple[int, str]]:
    """Yields (offset, source text) for every ordinary Rust string literal.

    Scanned rather than matched line by line. A string that lost its line
    continuation is still a valid literal spanning two physical lines, so a
    per-line regex sees neither a complete literal nor the defect, which is
    exactly the case this check exists for.

    Raw strings are skipped: they carry no escapes, so whatever is in them is
    deliberate. Character literals are stepped over because `b'"'` in the path
    scanner would otherwise open a string that swallows the rest of the file,
    and a lifetime is stepped over because its quote never closes.
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
                # Rust nests block comments, so the first `*/` need not close
                # the outer one. Stopping there would read commented-out code as
                # live source and can fail the gate on text that is not compiled.
                depth = 1
                probe = index + 2
                while probe < length and depth:
                    if text.startswith("/*", probe):
                        depth += 1
                        probe += 2
                    elif text.startswith("*/", probe):
                        depth -= 1
                        probe += 2
                    else:
                        probe += 1
                index = probe
                continue

        if character == "r" and index + 1 < length:
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

        if character == "'":
            if index + 1 < length and text[index + 1] == "\\":
                closing = text.find("'", index + 2)
                index = length if closing == -1 else closing + 1
                continue
            if index + 2 < length and text[index + 2] == "'":
                index += 3
                continue
            index += 1
            continue

        if character == '"':
            start = index + 1
            probe = start
            while probe < length:
                if text[probe] == "\\":
                    probe += 2
                    continue
                if text[probe] == '"':
                    break
                probe += 1
            literals.append((start, text[start:probe]))
            index = probe + 1
            continue

        index += 1

    return literals


def _reflowed_gap(content: str) -> bool:
    """Whether a run of spaces is a continuation that went missing.

    Decided per match rather than by a lookbehind in the pattern. Only an
    escaped newline or tab legitimately precedes indentation, and they do so
    in the simulated command output the fixtures carry. Excluding every
    escaped character instead, which a lookbehind on the backslash does, throws
    away real cases: the quote in `Select \"OK\"    to continue.` is escaped,
    and the gap after it is exactly the defect.
    """
    for match in INLINE_RUN_RE.finditer(content):
        start = match.start()
        if start > 0 and content[start - 1] == chr(92) and content[start] in "nt":
            continue
        return True
    return False


def validate_user_facing_strings(errors: list[str]) -> None:
    """Catches a lost line continuation inside a user-facing Rust message.

    A string split across lines ends with a backslash, which removes the newline
    and the next line's indentation. Lose the backslash and the indentation stays
    in the message: six shipped strings read "...the commands <35 spaces>
    MSCanvas needs." Nothing caught them, because the code compiled, passed
    Clippy and produced no warning.

    Two shapes, because the defect has two. Removing the backslash from a wrapped
    literal leaves a valid literal that still spans two lines, with the newline
    and indentation now inside the message. Reflowing that onto one line leaves a
    run of spaces between two words. The first is the one a per-line check cannot
    see.

    Rust only, deliberately. TypeScript has the same defect, but finding it needs
    a scanner that can tell a regular expression from a division, and that is
    decided by grammar rather than by the preceding character. An attempt here
    met a new lexical case on each reading — template nesting, a brace inside a
    pattern, a pattern after a keyword, a backtick inside a pattern — and its
    failure mode was to lose synchronisation and silently skip a whole file,
    which is a worse thing for a check to do than to not cover a language. Rust
    needs none of that: no regular expression literals, no interpolation, no
    division ambiguity. Covering TypeScript belongs in a linter that parses it;
    this repository has none today, and adding one is a dependency decision.
    """
    root = ROOT / "crates"
    roots = [root, ROOT / "apps"]
    for directory in roots:
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*.rs")):
            if not path.is_file() or "target" in path.parts:
                continue
            text = path.read_text(encoding="utf-8")
            relative = path.relative_to(ROOT).as_posix()
            for offset, source in _rust_string_literals(text):
                # Apply the continuation the compiler applies before judging what
                # the message actually contains.
                content = CONTINUATION_RE.sub("", source)
                number = text.count("\n", 0, offset) + 1
                if EMBEDDED_NEWLINE_RE.search(content):
                    fail(
                        f"{relative}:{number} has a string literal whose sentence continues "
                        "on the next line with no continuation, so the newline and the "
                        "indentation are in the message",
                        errors,
                    )
                elif _reflowed_gap(content):
                    fail(
                        f"{relative}:{number} has a run of spaces inside a string literal, "
                        "which is what a lost line continuation looks like",
                        errors,
                    )


def validate_test_support_stays_a_dev_dependency(errors: list[str]) -> None:
    """The forged-capability constructor must never reach a shipped build.

    `mscanvas-proteowizard`'s `test-support` feature exposes a constructor that
    builds capability evidence from help text no discovery probe bound to an
    executable. A conversion is gated on evidence that names one release, one
    revision and one executable digest, and that gate is worth exactly as much
    as the impossibility of forging its input. Enabling the feature from an
    ordinary dependency would put the forgery in the binary users run.

    Checked here rather than remembered, because the change that would break it
    is a one-word edit in a manifest.
    """
    for manifest in sorted(ROOT.glob("**/Cargo.toml")):
        if any(
            part in {"node_modules", "target", ".git"} for part in manifest.parts
        ):
            continue
        section = None
        for number, line in enumerate(
            manifest.read_text(encoding="utf-8").splitlines(), start=1
        ):
            stripped = line.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                section = stripped.strip("[]")
                continue
            if "test-support" not in stripped or stripped.startswith("#"):
                continue
            if section == "features":
                continue
            if section is None or not section.endswith("dev-dependencies"):
                relative = manifest.relative_to(ROOT).as_posix()
                errors.append(
                    f"{relative}:{number} enables the test-support feature outside "
                    f"[dev-dependencies] (section: {section or 'none'}); it must not "
                    "reach a shipped build"
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
        validate_test_support_stays_a_dev_dependency(errors)

    if errors:
        print("Repository validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Repository validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
