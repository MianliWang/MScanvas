#!/usr/bin/env python3
"""Validate the dependency-free structural contracts of the MSCanvas repository."""

from __future__ import annotations

import importlib.util
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
# surely as a word does. What follows it must be a word, and that is what
# separates a broken message from deliberate column alignment — the simulated
# help fixtures align with runs of spaces before a `:`, never before a word.
# Which escapes may precede a run is decided per match, in `_reflowed_gap`,
# rather than by a lookbehind here.
#
# A `{` opens a word too. A format placeholder is interpolated into the
# sentence and reads as whatever it names, so a run before `{inside}` is the
# same broken sentence as a run before a letter — and that is the shape the
# defect took the second time, in a disclosure a figure writes into its own
# `<desc>`, which this rule read straight past. `{{` is excluded because it is
# not a placeholder: it renders one literal brace, which is punctuation and
# aligns in a column exactly as `:` does.
#
# Residual, stated rather than implied: a sentence reflowed onto one line whose
# next word is a number is not caught. Its two-line form is, by the newline
# rule above, and that is the form the defect actually takes.
INLINE_RUN_RE = re.compile(r"[^\s][ ]{2,}(?:[A-Za-z]|\{(?!\{))")
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


def validate_inline_run_rule(errors: list[str]) -> None:
    """The inline-run rule's own discrimination, checked rather than assumed.

    All of this rule's value is in where it draws one line: a run of spaces
    before a word is a sentence that lost its continuation, and a run before a
    punctuation mark is a fixture aligning a column. Both directions cost
    something, and they cost differently. Widening it turns the aligned
    fixtures red, which is loud and gets fixed. Narrowing it goes quiet — and
    that is the failure that actually happened: the rule was written for a run
    before a letter, a second instance arrived before a `{`, and nothing said
    anything until the malformed sentence had shipped inside an exported
    figure's description.

    So the fixtures below are the rule's contract rather than an illustration
    of it. They run through `_reflowed_gap`, which is the decision the check
    actually makes, not the bare pattern.

    Here rather than in a test file because this repository has no Python test
    surface, and adding one is a dependency decision this check does not get to
    make on its own.
    """
    caught = [
        # The instance that shipped: a lost continuation before a placeholder.
        "points to {}, {};                      {inside} of them lie inside",
        # The original shape, before a plain word.
        "the commands                      MSCanvas needs.",
        # An escaped quote still ends a cut sentence.
        'Select \\"OK\\"    to continue.',
    ]
    ignored = [
        # Deliberate column alignment: a run before a punctuation mark.
        "--filter        : keep only matching rows",
        # `{{` renders one literal brace, which aligns like any punctuation.
        "total         {{",
        # An escaped newline or tab legitimately precedes indentation.
        "\\n     indented backend output",
        "\\t     indented backend output",
        # An ordinary sentence.
        "One space between words, and one after a full stop.",
    ]
    for fixture in caught:
        if not _reflowed_gap(fixture):
            fail(
                "the inline-run rule no longer catches a lost continuation in "
                f"{fixture!r}",
                errors,
            )
    for fixture in ignored:
        if _reflowed_gap(fixture):
            fail(
                f"the inline-run rule now reports deliberate spacing in {fixture!r}",
                errors,
            )


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


def _gated_lines(lines: list[str], gate: str) -> set[int]:
    """Which lines sit under a `cfg` attribute.

    An attribute gates the item that follows it, and that item is not always one
    line: a gated builder statement runs through a chain of calls and a closure
    before its semicolon, and the mention that matters is inside the closure.
    So the region runs from the attribute to wherever the item actually ends --
    the brace depth returning to where it started, on a line that closes
    something.

    Checking only the line directly beneath the attribute would be a rule the
    code cannot follow, and a rule nobody can follow is a rule that gets
    deleted.
    """
    gated: set[int] = set()
    depth = 0
    pending = False
    inside = False
    opened_at = 0
    for number, line in enumerate(lines, start=1):
        stripped = line.strip()
        change = line.count("{") - line.count("}")
        if stripped == gate:
            gated.add(number)
            pending = True
            continue
        if pending and not stripped:
            continue
        if pending:
            pending = False
            inside = True
            opened_at = depth
        if inside:
            gated.add(number)
            depth += change
            if depth <= opened_at and (
                stripped.endswith(";") or stripped.endswith("}") or stripped.endswith("},")
            ):
                inside = False
            continue
        depth += change
    return gated


def validate_e2e_capability_never_ships(errors: list[str]) -> None:
    """The rendered-QA IPC boundary must never reach a shipped build.

    Under the `e2e` feature the desktop crate appends one initialization script
    that can answer the application's own commands from a table the page can
    write. That is the whole point of it during a rendered test, and it is
    exactly the capability a shipped binary must not carry: anything running in
    the document could use it to make the interface believe whatever it liked.

    Three things keep it out, and all three are one edit away from not doing so.
    The feature must stay off by default. Every reference to the script must sit
    directly under the `cfg` that gates it, because a reference that drifts out
    from under the attribute compiles into every build without any other symptom.
    And the boundary's own marker names must appear nowhere in the production
    frontend, whose bundle ships whether the feature is on or not.

    Checked here rather than remembered, because a binary that carries this and
    a binary that does not look the same from the outside.
    """
    gate = '#[cfg(feature = "e2e")]'
    markers = (
        "__mscanvasIpcTable__",
        "__mscanvasIpcCalls__",
        "__mscanvasIpcSeed__",
        "__mscanvasBoundary__",
        "__mscanvasConsole__",
    )
    # Names that must sit under the gate wherever they are written, and must
    # never reach the registration list. The synthetic spectrum is not a
    # command: there is nothing for a webview to call, and the registration list
    # is byte-identical in every build. That is the property here.
    seeded = ("e2e_seed", "seed_spectrum_for_e2e", "install_seeded_spectrum")

    manifest = ROOT / "apps" / "desktop" / "src-tauri" / "Cargo.toml"
    if manifest.is_file():
        section = None
        for number, line in enumerate(
            manifest.read_text(encoding="utf-8").splitlines(), start=1
        ):
            stripped = line.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                section = stripped.strip("[]")
                continue
            if section != "features" or not stripped.startswith("default"):
                continue
            if "e2e" in stripped:
                errors.append(
                    f"apps/desktop/src-tauri/Cargo.toml:{number} enables the e2e "
                    "feature by default; the rendered-QA IPC boundary would ship"
                )

    source = ROOT / "apps" / "desktop" / "src-tauri" / "src"
    host = source / "lib.rs"
    if host.is_file():
        text = host.read_text(encoding="utf-8")
        registered = text.partition("generate_handler![")[2].partition("]")[0]
        for name in seeded:
            if name in registered:
                errors.append(
                    f"apps/desktop/src-tauri/src/lib.rs registers {name} as a command; the "
                    "synthetic spectrum is installed at startup under the e2e feature and "
                    "is deliberately not callable from any document"
                )

    watched = ("e2e_boundary.js", "E2E_IPC_BOUNDARY_SCRIPT", *seeded)
    for rust in sorted(source.glob("**/*.rs")):
        # The module that *is* the seed is gated at its declaration, which the
        # scan below sees where that declaration is written; inside it every
        # mention is already behind that gate.
        if rust.name == "e2e_seed.rs":
            continue
        lines = rust.read_text(encoding="utf-8").splitlines()
        gated = _gated_lines(lines, gate)
        for number, line in enumerate(lines, start=1):
            if not any(name in line for name in watched):
                continue
            if line.lstrip().startswith("//"):
                continue
            if number not in gated:
                relative = rust.relative_to(ROOT).as_posix()
                errors.append(
                    f"{relative}:{number} names test-only rendered-QA machinery outside "
                    f"{gate}; it must not reach a shipped build"
                )

    frontend = ROOT / "apps" / "desktop" / "src"
    markers = (*markers, *seeded)
    for candidate in sorted(frontend.glob("**/*")):
        if not candidate.is_file() or candidate.suffix not in {
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".css",
            ".html",
        }:
            continue
        content = candidate.read_text(encoding="utf-8")
        for marker in markers:
            if marker in content:
                relative = candidate.relative_to(ROOT).as_posix()
                errors.append(
                    f"{relative} names {marker}; the rendered-QA IPC boundary must "
                    "stay out of the production frontend, which ships either way"
                )

    package = ROOT / "apps" / "desktop" / "package.json"
    if package.is_file():
        declared = json.loads(package.read_text(encoding="utf-8"))
        for name in sorted(declared.get("dependencies", {})):
            if name.startswith("@wdio/") or name in {"webdriverio", "tsx"}:
                errors.append(
                    f"apps/desktop/package.json declares {name} as a production "
                    "dependency; the rendered-QA harness is a dev dependency of the "
                    "repository, not of the application"
                )


def validate_clipboard_stays_write_only(errors: list[str]) -> None:
    """This application may put a figure on the clipboard and may not read one.

    `Copy plot` builds its pixels in Rust and hands them to the plugin's Rust
    API. The webview never receives an image and never needs one, so it is
    granted no clipboard capability at all -- Tauri denies every plugin command
    that a capability does not list, and `capabilities/default.json` lists none.

    That posture is worth checking rather than remembering, because it is one
    line away from not holding. A clipboard *read* would be a window onto
    whatever the user last copied from somewhere else, which a scientific tool
    has no business seeing; a generic write command reachable from the document
    would let anything running there replace what the user copied. And the
    JavaScript guest plugin is how both usually arrive, so it must not become a
    dependency of the application either.
    """
    for capability in sorted((ROOT / "apps" / "desktop" / "src-tauri" / "capabilities").glob("*.json")):
        declared = json.loads(capability.read_text(encoding="utf-8"))
        relative = capability.relative_to(ROOT).as_posix()
        for permission in declared.get("permissions", []):
            name = permission if isinstance(permission, str) else permission.get("identifier", "")
            if "clipboard" in name:
                errors.append(
                    f"{relative} grants {name}; the webview is given no clipboard "
                    "capability, and the image is written from Rust"
                )

    package = ROOT / "apps" / "desktop" / "package.json"
    if package.is_file():
        declared = json.loads(package.read_text(encoding="utf-8"))
        for section in ("dependencies", "devDependencies"):
            for name in sorted(declared.get(section, {})):
                if "clipboard" in name:
                    errors.append(
                        f"apps/desktop/package.json declares {name} in {section}; the "
                        "clipboard is reached from Rust, and a guest plugin here would "
                        "be a clipboard surface inside the document"
                    )


def validate_no_font_is_bundled_or_fetched(errors: list[str]) -> None:
    """A figure's typography comes from the machine, not from this repository.

    Rasterizing text needs a real typeface, and there are two wrong ways to get
    one: ship a font file, which is a third-party binary with its own licence
    inside a repository that vendors none, or fetch one at runtime, which makes
    an exported figure depend on a network this application never uses. The
    right way is the platform's own font database, and the honest failure when
    that resolves nothing is to refuse the raster formats and keep SVG.

    Checked here because both wrong ways look like small conveniences.
    """
    skip = {"node_modules", "target", ".git", "dist"}
    for candidate in sorted(ROOT.glob("**/*")):
        if any(part in skip for part in candidate.parts) or not candidate.is_file():
            continue
        if candidate.suffix.lower() in {".ttf", ".otf", ".ttc", ".woff", ".woff2", ".eot"}:
            errors.append(
                f"{candidate.relative_to(ROOT).as_posix()} is a font file; figure text is "
                "drawn with the fonts the machine already has"
            )

    for source in sorted((ROOT / "apps" / "desktop" / "src").glob("**/*")):
        if not source.is_file() or source.suffix not in {".ts", ".tsx", ".css", ".html"}:
            continue
        content = source.read_text(encoding="utf-8")
        for marker in ("fonts.googleapis.com", "fonts.gstatic.com", "@font-face"):
            if marker in content:
                errors.append(
                    f"{source.relative_to(ROOT).as_posix()} references {marker}; a figure's "
                    "typography must not depend on a network request"
                )


def validate_every_raster_entry_point_asks_the_budget(errors: list[str]) -> None:
    """Both ways of asking for pixels ask whether they will fit first.

    A figure this application will happily describe as a vector -- 20,000 by
    20,000 -- is 400 megapixels as RGBA, about 1.6 GiB, and the honest answer to
    a request for one is a refusal rather than an exhausted machine. The PNG
    export asked. `Copy plot` did not, and the omission survived a review round
    because the two paths validate independently and nothing said they had to
    agree.

    So the rule is written down: every command that turns wire settings into
    pixels calls `Self::raster_budget` on the way. A guard rather than a type
    because the check has to happen before anything is allocated, which is a
    property of where the call is, not of what it returns.
    """
    source = ROOT / "apps" / "desktop" / "src-tauri" / "src" / "preview" / "service.rs"
    if not source.is_file():
        return
    content = source.read_text(encoding="utf-8")
    for command in ("begin_spectrum_export", "copy_spectrum_plot"):
        start = content.find(f"pub fn {command}(")
        if start < 0:
            errors.append(
                f"preview/service.rs no longer defines {command}; the raster budget "
                "guard cannot see whether the pixels are still bounded"
            )
            continue
        end = content.find("\n    pub fn ", start + 1)
        body = content[start : end if end > 0 else len(content)]
        if "Self::raster_budget(" not in body:
            errors.append(
                f"preview/service.rs::{command} does not call Self::raster_budget; a "
                "figure the vector contract allows can be hundreds of megapixels, and "
                "the refusal has to happen before the pixmap is allocated"
            )


# One column-zero Rust function definition, for the free-function scan below.
FREE_FN_RE = re.compile(r"(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?fn (\w+)")


def functions_naming(content: str, needle: str) -> set[str]:
    """Every function in one Rust file whose body mentions `needle`.

    A line at column zero ends whatever function was open, so a struct's own
    field declarations are not attributed to the function above them.

    Shared by the two rules that pin an export-slot invariant to the shape of
    the API rather than to a test: asking which functions can reach a field is
    the same question in both, and two copies of the scan could answer it
    differently.
    """
    owners: set[str] = set()
    current: str | None = None
    for line in content.split("\n"):
        if line and not line.startswith(" "):
            current = None
            continue
        defined = re.match(r"    (?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?fn (\w+)", line)
        if defined:
            current = defined.group(1)
        elif current is not None and needle in line:
            owners.add(current)
    return owners


def validate_the_chromatogram_authority_has_one_installation_path(
    errors: list[str],
) -> None:
    """Which preview owns the chromatogram is asked and acted on in one step.

    There is one chromatogram a session may export, and only the newest preview
    open may install it. The defect that rule exists to close is not the
    comparison being wrong -- it is the comparison being *separated* from what it
    decides: read "am I still the latest open", let the slot go, and install
    afterwards, and a newer open begins in the gap while the older completion
    still wins.

    A test cannot show this. The gap a split would open is narrower than a
    thread wake, so any test claiming to catch it would be claiming scheduling
    luck as evidence. What actually closes it is the shape of the API, and that
    is what is checked here:

    - `install_chromatogram` is private, so no call site outside `export.rs` can
      install without first proving it may;
    - the only functions that read `latest_preview_open` are the one that
      advances it and the one that compares *and* mutates under the same `&mut
      self` -- so the slot never answers a question it does not also act on.

    The second rule is deliberately not a list of forbidden names. Any new way
    to ask the question on its own has to read that field, whatever it is
    called, and that is what fails here.
    """
    preview = ROOT / "apps" / "desktop" / "src-tauri" / "src" / "preview"
    export = preview / "export.rs"
    if not export.is_file():
        return
    content = export.read_text(encoding="utf-8")

    if not re.search(r"\n    fn install_chromatogram\(", content):
        errors.append(
            "preview/export.rs no longer defines a private `install_chromatogram`; "
            "an installer reachable from outside the module can be called without "
            "the ownership comparison that decides whether it may run"
        )

    for path in sorted(preview.rglob("*.rs")):
        if path.name == "export.rs":
            continue
        if ".install_chromatogram(" in path.read_text(encoding="utf-8"):
            errors.append(
                f"{path.relative_to(ROOT).as_posix()} calls .install_chromatogram() "
                "directly; every installation goes through "
                "reconcile_preview_chromatogram, which is where the preview-open "
                "ticket is checked"
            )

    owners = functions_naming(content, "latest_preview_open")

    # `default` builds the slot and assigns the field its initial ticket, which
    # is the one thing that is neither a question nor an answer to one.
    expected = {"default", "begin_preview_open", "reconcile_preview_chromatogram"}
    if owners != expected:
        errors.append(
            "preview/export.rs: the functions naming `latest_preview_open` are "
            f"{sorted(owners)}, not {sorted(expected)}. The ownership test and the "
            "installation have to stay one operation on one `&mut` borrow -- a "
            "function that only reports whether a ticket is current lets a caller "
            "check under one slot acquisition, release it, and install under "
            "another, which is the race the ticket exists to close"
        )


def validate_the_linked_pair_is_bound_in_one_operation(errors: list[str]) -> None:
    """A linked figure reads both of its sources without letting go in between.

    A linked two-panel figure is one claim about two retained sources: that they
    describe the same scan of the same run, at the same moment. Reading the
    chromatogram token under one acquisition of the export slot, releasing it,
    and reading the spectrum token under another would let the pair describe two
    different instants -- a preview replaced between the two lookups, a selection
    superseded -- which is the one thing the figure says it does not do.

    No test can catch that. It needs a preview open or a spectrum install to land
    inside a window of a few instructions, so anything claiming to catch it would
    be claiming scheduling luck as evidence. What closes it is the shape of the
    API and of the type, and most of that shape the compiler already enforces:
    `LinkedPair` lives in its own module with private fields, so the only way to
    make one -- anywhere in `export.rs`, and a fortiori in any sibling module --
    is `LinkedPair::new`, which is visible to `export` alone.

    What no compiler can say is *which* function inside `export` may call it, and
    that is what is pinned here, together with the shape the compiler's guarantee
    rests on:

    - the two single-source readers stay private to `export.rs`, so no call site
      outside the module can read one of a pair's halves on its own at all;
    - the paired bind stays private, and the only functions calling it are the
      two operations that complete it under their own `&mut self`;
    - `LinkedPair`'s fields stay private and `LinkedPair::new` stays visible to
      `export` alone, which is what makes it the only way in;
    - exactly one function calls it, and it is the one that proves the two
      sources are one scan.

    None of these is a list of forbidden callers. Any new way to read one half
    alone has to call one of those two readers, and any new pair has to come
    through that constructor, whatever the caller is named.

    This replaced a rule that counted `LinkedPair` followed by a brace. That
    could not tell a construction from `let LinkedPair { .. } = pair` or from an
    `impl LinkedPair` block, so it failed on correct code -- while a constructor
    spelled another way would have walked straight past it.
    """
    preview = ROOT / "apps" / "desktop" / "src-tauri" / "src" / "preview"
    export = preview / "export.rs"
    if not export.is_file():
        return
    content = export.read_text(encoding="utf-8")

    for reader in ("spectrum_for", "chromatogram_for"):
        if not re.search(rf"\n    fn {reader}\(", content):
            errors.append(
                f"preview/export.rs no longer defines a private `{reader}`; a reader "
                "reachable from outside the module lets a caller take one of a linked "
                "figure's two sources under one acquisition of the export slot and the "
                "other under a second, which is the race the paired bind exists to close"
            )

    for path in sorted(preview.rglob("*.rs")):
        if path.name == "export.rs":
            continue
        text = path.read_text(encoding="utf-8")
        for reader in ("spectrum_for(", "chromatogram_for("):
            if f".{reader}" in text:
                errors.append(
                    f"{path.relative_to(ROOT).as_posix()} calls .{reader}) directly; the "
                    "single-source readers stay private to export.rs so a pair cannot be "
                    "assembled from two separate acquisitions of the export slot"
                )
        if "LinkedPair::new(" in text:
            errors.append(
                f"{path.relative_to(ROOT).as_posix()} calls LinkedPair::new(); the "
                "constructor is visible to export.rs alone so that a pair can only be "
                "made where both sources were read together"
            )

    if not re.search(r"\n    fn linked_pair\(", content):
        errors.append(
            "preview/export.rs no longer defines a private `linked_pair`; the operation "
            "that proves two retained sources are one scan is the module's own, and a "
            "reachable one is one a caller could take apart"
        )

    # Its callers, which are the two operations that complete a bind. The
    # definition itself does not name itself, so it is pinned above instead.
    # `.linked_pair(` rather than `self.linked_pair(`: rustfmt puts the receiver
    # on its own line when the call is long, and the owner is the same either way.
    owners = functions_naming(content, ".linked_pair(")
    expected = {"begin_linked_figure", "begin_linked_figure_copy"}
    if owners != expected:
        errors.append(
            "preview/export.rs: the functions calling `linked_pair` are "
            f"{sorted(owners)}, not {sorted(expected)}. Everything a linked figure is "
            "about is decided in that one operation, under the one `&mut self` its "
            "caller holds -- a second way in is a second place the pair could be "
            "assembled from two different moments"
        )

    _validate_linked_pair_has_one_constructor(content, errors)


def _validate_linked_pair_has_one_constructor(content: str, errors: list[str]) -> None:
    """`LinkedPair::new` is the only way in, and one function walks through it.

    The first half is the compiler's: private fields inside `mod linked_pair`
    mean a struct literal is a compile error everywhere else, so what is checked
    here is that the shape which produces that guarantee is still there. The
    second half is not something a type can express, so it is checked directly.
    """
    module = re.search(r"\nmod linked_pair \{(.*?)\n}\n", content, re.DOTALL)
    if module is None:
        errors.append(
            "preview/export.rs no longer keeps `LinkedPair` in its own `mod linked_pair`; "
            "that module is what makes the fields private to it and `LinkedPair::new` the "
            "only way a pair can be made"
        )
        return
    body = module.group(1)

    fields = re.search(r"struct LinkedPair \{(.*?)\n    \}", body, re.DOTALL)
    if fields is None:
        errors.append(
            "preview/export.rs: `mod linked_pair` no longer declares `struct LinkedPair`"
        )
    elif "pub" in fields.group(1):
        errors.append(
            "preview/export.rs: `LinkedPair` declares a public field. Its fields are "
            "private to `mod linked_pair` so that a struct literal is a compile error "
            "everywhere else, which is what makes `LinkedPair::new` the only way in"
        )

    if not re.search(r"\n        pub\(super\) const fn new\(", body):
        errors.append(
            "preview/export.rs: `LinkedPair::new` is no longer `pub(super)`. Widening it "
            "would let a sibling module of `preview` assemble two snapshots it read "
            "separately into something that claims they were read together"
        )

    builders = functions_naming(content, "LinkedPair::new(")
    expected = {"linked_pair"}
    if builders != expected:
        errors.append(
            "preview/export.rs: the functions calling `LinkedPair::new` are "
            f"{sorted(builders)}, not {sorted(expected)}. A pair built anywhere but the "
            "operation that proves it is one scan is a pair nothing proved"
        )

    _validate_linked_pair_module_adds_no_route(body, errors)


# Every method `mod linked_pair` is known to declare.
#
# A closed list rather than a shape, because the whole question this rule asks is
# *which* functions exist: a construction route added here is exactly a function
# that was not here before, and a rule that accepted any shape could not say so.
# Adding an ordinary accessor means adding its name below, which is a visible
# decision rather than a silent one.
LINKED_PAIR_METHODS = {
    "new",
    "chromatogram",
    "spectrum",
    "selected_index",
    "selected_retention_time",
    "range",
    "into_parts",
}


def _validate_linked_pair_module_adds_no_route(body: str, errors: list[str]) -> None:
    """No second way to make a pair is hidden inside `mod linked_pair` itself.

    The check above reads the whole file through `functions_naming`, which
    recognises a definition at exactly four spaces. `mod linked_pair` sits at
    column zero, so its `impl` block is at four and every method inside it is at
    eight -- and a wrapper added *there* was therefore not seen as its own
    function at all, leaving `builders` describing a file that had gained a
    route. M4.4 recorded that blind spot; this closes it, for this rule only.

    Two things are pinned, because inside this module there are two ways in.
    `LinkedPair::new` is one, and it is checked by name. The other is a struct
    literal, which is a compile error *everywhere else* precisely because the
    fields are private to this module -- so here, and only here, it is legal.
    Both are held to the one function that may perform them.
    """
    declared = set(re.findall(r"\bfn (\w+)\s*\(", body))
    if declared != LINKED_PAIR_METHODS:
        added = sorted(declared - LINKED_PAIR_METHODS)
        removed = sorted(LINKED_PAIR_METHODS - declared)
        errors.append(
            f"preview/export.rs: `mod linked_pair` declares {sorted(declared)}, not "
            f"{sorted(LINKED_PAIR_METHODS)} (added: {added}; removed: {removed}). Every "
            "function in this module can reach the private fields, so a new one is a new "
            "way to make a pair until it is read and listed in LINKED_PAIR_METHODS"
        )

    # The constructor, called from inside the module it is defined in. Its own
    # definition is `fn new(`, which neither spelling matches.
    for call in ("LinkedPair::new(", "Self::new("):
        if call in body:
            errors.append(
                f"preview/export.rs: `mod linked_pair` calls `{call.rstrip('(')}` inside "
                "itself. The one authorized caller is the operation that proves the two "
                "sources are one scan, and it is outside this module"
            )

    # The struct literal, which the private fields make legal here and nowhere
    # else. Exactly one, and it is the one `new` performs.
    #
    # Counted as `Self {` rather than as `LinkedPair {`, which is the mistake the
    # rule this replaced made in the other direction: the type's own name appears
    # in its declaration and in its `impl` header, and neither of those builds
    # anything. `Self {` inside this module is a construction and nothing else --
    # there is one type here for `Self` to mean.
    #
    # Except after `->`, where it is the return type of a function that has not
    # built anything yet. Excluded rather than subtracted, so a second
    # constructor is counted whether or not it happens to return `Self`.
    literals = len(re.findall(r"(?<!-> )\bSelf \{", body))
    if literals != 1:
        errors.append(
            f"preview/export.rs: `mod linked_pair` builds {literals} `Self` struct "
            "literals, not 1. The private fields make a literal legal inside this module "
            "and a compile error outside it, so every one of them here is a constructor"
        )




def validate_drawability_is_settled_in_one_place(errors: list[str]) -> None:
    """A projection reuses the source verdict rather than re-establishing it.

    Drawability is a property of the immutable retained spectrum, so it is
    settled once when that spectrum is retained and carried with it. A viewport
    projection then costs a search for the window plus the window's own points.
    Re-asking the scientific predicate inside the projection path puts the whole
    source back into every request, which is the defect this pins closed: a
    narrow zoom of a large spectrum used to cost as much as the whole of it.

    A counting test proves the *number* of settlements per retained snapshot.
    What that test cannot see is a projection reaching past the seam to call the
    predicate itself, so which functions may call it is checked here -- the same
    thing `validate_the_linked_pair_is_bound_in_one_operation` does for a
    constructor no compiler can restrict further.

    Two callers, and they differ in kind. `settle_viewport_domain` is the
    settlement point, reached once per retained snapshot. `spectrum_panel`
    settles for the figure it is building, which is a one-shot export rather
    than an interactive path, so paying there is paying once for one document.
    """
    projection = (ROOT / "apps/desktop/src-tauri/src/preview/projection.rs").read_text(
        encoding="utf-8"
    )
    export = (ROOT / "apps/desktop/src-tauri/src/preview/export.rs").read_text(
        encoding="utf-8"
    )

    for module, source, expected in (
        ("projection.rs", projection, {"settle_viewport_domain"}),
        ("export.rs", export, {"spectrum_panel"}),
    ):
        callers = _free_functions_naming(source, "measurement_domains(")
        if callers != expected:
            fail(
                f"preview/{module}: the functions calling `measurement_domains` are "
                f"{sorted(callers)}, not {sorted(expected)}. Drawability is settled once "
                "for a retained spectrum and carried with it; a projection that asks "
                "again puts the whole source back into every window",
                errors,
            )

    body = projection.split("\npub(super) fn project(", 1)
    if len(body) == 2:
        window = body[1].split("\n}\n", 1)[0]
        if "measurement_domains" in window or "settle_viewport_domain" in window:
            fail(
                "preview/projection.rs: `project` settles the source verdict itself. It "
                "takes the settled verdict as an argument precisely so a window's cost "
                "does not include rediscovering that the spectrum is drawable",
                errors,
            )


def _free_functions_naming(content: str, needle: str) -> set[str]:
    """Every column-zero `fn` in one file whose body mentions `needle`.

    `functions_naming` above recognises a definition at exactly four spaces,
    which is what an `impl` method looks like. The two functions this rule is
    about are free functions at column zero, so they get their own scan rather
    than a loosened shared one that would change what the other rules see.
    """
    owners: set[str] = set()
    current: str | None = None
    for line in content.split("\n"):
        defined = FREE_FN_RE.match(line)
        if defined:
            current = defined.group(1)
        elif line.startswith("}"):
            current = None
        elif current is not None and needle in line:
            owners.add(current)
    return owners


# What the newest status section may not deny, by the subject it is about.
#
# One entry per milestone whose own section could contradict itself. The key is
# matched against the section's title, case-insensitively, and the phrases are
# the ways that milestone's capability has actually been denied in this file --
# so a new section inherits the rule by being titled after its subject rather
# than by anyone remembering to extend a list.
STATUS_SUBJECTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "chromatogram export",
        (
            "chromatogram data or figure\nexport",
            "chromatogram data or figure export",
            "current-range export of anything",
            "the export is not built",
        ),
    ),
    (
        "linked two-panel figure",
        (
            "linked chromatogram + selected-spectrum two-panel figure",
            "linked chromatogram + spectrum figure template",
            "no linked two-panel figure",
            "the linked two-panel figure (FIG-006)",
            "there is no linked figure",
        ),
    ),
)


def validate_a_spectrum_range_is_resolved_in_one_place(errors: list[str]) -> None:
    """A range comes from the retained snapshot, and a drawing cannot become one.

    Three facts, and each is a different way M5.3 could have gone wrong.

    **The export module cannot see a screen projection.** `ScreenProjection` is
    the bounded drawing a viewport receives, and substituting it for the science
    is the one mistake a range export makes easiest -- the two are arrays of the
    same shape about the same spectrum. `preview/export.rs` writes every
    scientific document and does not name the type at all, so the substitution
    is not something to remember not to do.

    **One resolver, reached from two places.** `SpectrumSnapshot::resolve` is
    where a requested range is agreed to against the retained source, and the
    only functions that may reach it are the two that bind an export: one for a
    save and one for a copy. A third caller would be a second place a window
    could be agreed to differently -- and the reason to check it here rather than
    in a test is that a test can only see the answers, never how many places
    produced them.

    **The panel builder takes no range.** ADR 0036's rule that the linked
    figure's lower panel is the complete selected spectrum is preserved by
    `spectrum_panel`'s signature: there is nothing for a range chooser to pass
    it. A parameter added here would make that rule a convention again.
    """
    whole = (ROOT / "apps/desktop/src-tauri/src/preview/export.rs").read_text(
        encoding="utf-8"
    )
    # Production only. A test may resolve a range for itself -- that is what a
    # test of a resolver does -- and counting those would make this rule about
    # how the suite is written rather than about who may agree a window.
    export = whole.split("\n#[cfg(test)]\nmod tests {", 1)[0]

    if "ScreenProjection" in export:
        fail(
            "preview/export.rs names `ScreenProjection`. That type is the bounded drawing "
            "a viewport receives, and this module writes scientific documents -- a range "
            "export reads the complete retained source and the committed window, never "
            "the arrays a screen was given",
            errors,
        )

    # Method-level rather than free-function: both binders are methods of the
    # export slot, so this is the four-space scan rather than the column-zero one.
    resolvers = functions_naming(export, ".resolve(request)")
    # The five binders, on both axes. A spectrum's two reach
    # `SpectrumSnapshot::resolve`; the chromatogram's three reach its own
    # source's, which is a different type over a different axis -- and the fact
    # that one scan cannot be told from the other by this needle is exactly why
    # the two spectrum binders are also required by name below.
    expected = {
        "begin",
        "begin_copy",
        "begin_chromatogram",
        "begin_chromatogram_copy",
        "begin_linked_figure",
        "linked_pair",
    }
    unexpected = resolvers - expected
    if unexpected:
        fail(
            f"preview/export.rs: {sorted(unexpected)} resolve a range. A window is agreed "
            "to against the retained source where an export is bound, and a second place "
            "to agree one is a second answer to what a document covers",
            errors,
        )
    for required in ("begin", "begin_copy"):
        if required not in resolvers:
            fail(
                f"preview/export.rs::{required} no longer resolves its range. Resolving "
                "anywhere but at BEGIN would let a viewport that moved while a dialog was "
                "open change what is written",
                errors,
            )

    if not re.search(
        r"\npub\(super\) fn spectrum_panel\(spectrum: &SelectedSpectrumResult\)", export
    ):
        fail(
            "preview/export.rs: `spectrum_panel` no longer takes exactly one spectrum and "
            "nothing else. It is the panel the linked two-panel figure's lower half is "
            "built from, and ADR 0036 says that half is the complete selected spectrum -- "
            "a range parameter here is how a spectrum's own export scope would reach it",
            errors,
        )


def validate_the_current_status_section_has_one_answer(errors: list[str]) -> None:
    """The newest status section does not deny what it just described.

    `BOOTSTRAP_STATUS.md` is a log: each section describes what was true when it
    was written, and older sections must keep saying a capability was absent
    then, because it was. What cannot happen is one section saying both. The
    M4.3 section described the chromatogram's exports at length and then listed
    "chromatogram data or figure export" and "current-range export of anything"
    among what is still not implemented, which left the repository's own status
    document unusable as a basis for planning: whichever half a reader trusted,
    the other one contradicted it.

    So this checks the **current** section only -- the last `## ` heading -- and
    only for claims that the thing the section is about does not exist. Nothing
    here reads prose for tone or pins a snapshot of it; a section is free to say
    anything except that its own subject is unbuilt.

    The subjects are a table rather than one hard-coded topic. A rule that only
    knew about the chromatogram went dormant the moment a later milestone
    appended its own section -- which is exactly when the same mistake becomes
    available again, and to a section nobody has reviewed yet.
    """
    source = ROOT / "BOOTSTRAP_STATUS.md"
    if not source.is_file():
        return
    sections = source.read_text(encoding="utf-8").split("\n## ")
    if len(sections) < 2:
        return
    current = sections[-1]
    title = current.split("\n", 1)[0].strip()

    for subject, denials in STATUS_SUBJECTS:
        if subject not in title.lower():
            continue
        for denial in denials:
            if denial in current:
                errors.append(
                    f"BOOTSTRAP_STATUS.md: the current section ({title!r}) describes the "
                    f"{subject} and also says {denial!r}. A status document that answers "
                    "a milestone question both ways cannot be the basis for the next "
                    "one; correct the current section rather than the historical ones"
                )

# The documents that describe the product as it stands, rather than as it was.
#
# Named individually rather than globbed, because the distinction this rule
# rests on is not one a path pattern can make: an ADR records what was true when
# it was accepted and `BOOTSTRAP_STATUS.md` is a log of the same kind, and both
# are supposed to go on saying a capability was absent then, because it was.
CURRENT_STATUS_DOCUMENTS: tuple[str, ...] = (
    "ROADMAP.md",
    "docs/product/FEATURE_CATALOG.md",
    "docs/product/PRIMARY_WORKFLOWS.md",
    "README.md",
)

# The sentences a shipped capability makes false, and the openings that make a
# sentence a claim about what is missing.
#
# Matched inside those lists only. A status page has to be able to *name* a
# capability in order to say it was delivered, so a bare mention proves nothing;
# what is checked is the capability appearing in a paragraph that begins by
# saying what the product does not do.
SHIPPED_CAPABILITIES: tuple[tuple[str, str], ...] = (
    ("spectrum zoom and pan", "M5.2 made the selected spectrum's m/z range zoom, pan and reset"),
    ("spectrum zoom/pan", "M5.2 made the selected spectrum's m/z range zoom, pan and reset"),
    (
        "cancelling one item of a queue while the rest carry on",
        "M6.8 shipped `Stop this file`, which ends the conversion under way and "
        "leaves the queue running",
    ),
    (
        "cancelling one item while the rest carry on",
        "M6.8 shipped `Stop this file`, which ends the conversion under way and "
        "leaves the queue running",
    ),
    (
        "skipping a queued item",
        "M6.8 shipped a per-row `Skip`, which settles a waiting item without "
        "converting it",
    ),
    (
        "skipping a queued conversion",
        "M6.8 shipped a per-row `Skip`, which settles a waiting item without "
        "converting it",
    ),
)

MISSING_LIST_OPENINGS: tuple[str, ...] = (
    "still unimplemented across the viewer:",
    "still missing from the acquisition view:",
    "not implemented yet:",
)


# The M5 route defines exactly two outcomes, and there is no third. A token that
# merely looks like one is not one: `XIC_SOURCE_REFUSEDD` would otherwise be
# accepted as authoritative wherever the spike and the status documents happened
# to agree on the misspelling, and the opposite-outcome derivation below would
# then name a real outcome as the withdrawn one.
XIC_ROUTE_OUTCOMES: frozenset[str] = frozenset(
    {
        "XIC_SOURCE_ADMITTED",
        "XIC_SOURCE_REFUSED",
    }
)


def _route_outcome(text: str, errors: list[str] | None = None) -> str | None:
    """The spike's declared route outcome, if it is one the route defines.

    One reader, because two would be two answers. The pattern locates the
    declaration; it does not decide whether what it found is a route outcome --
    that is the closed vocabulary's job. Callers that own the reporting pass
    `errors`; callers that only need the value pass nothing and get `None`,
    because the failure has already been reported by then.
    """
    outcomes = re.findall(r"\*\*Route outcome: `([A-Z_][A-Z0-9_]*)`\.\*\*", text)
    if len(outcomes) != 1:
        if errors is not None:
            fail(
                f"docs/spikes/M5_XIC_SOURCE_EVIDENCE.md declares {len(outcomes)} route "
                "outcomes, not 1. The spike is where the measurement lives, so it has to "
                "state exactly one answer for the status documents to agree with",
                errors,
            )
        return None
    outcome = outcomes[0]
    if outcome not in XIC_ROUTE_OUTCOMES:
        if errors is not None:
            fail(
                f"docs/spikes/M5_XIC_SOURCE_EVIDENCE.md declares route outcome `{outcome}`, "
                f"which is not one of the {len(XIC_ROUTE_OUTCOMES)} the route defines "
                f"({', '.join(f'`{name}`' for name in sorted(XIC_ROUTE_OUTCOMES))}). A token "
                "that resembles an outcome is not one, and the status documents would agree "
                "with it just as readily",
                errors,
            )
        return None
    return outcome


def _acceptance_row_for_view_007(body: str, errors: list[str]) -> list[tuple[int, str]]:
    """The `VIEW-007` row of the viewer acceptance table, as one governed region.

    A reader checks a feature against this row, so it states the outcome on its
    own account rather than as a summary of the implementation note further
    down. Located through the table rather than by searching the file, so a
    mention in some other feature's row could never satisfy it.
    """
    where = "docs/product/FEATURE_CATALOG.md acceptance table"
    table = _first_markdown_table(body, "## Acquisition overview and viewer")
    if table is None:
        fail(
            f"{where}: no feature table follows `## Acquisition overview and viewer`. The "
            "`VIEW-007` row is where the product states this feature's current status",
            errors,
        )
        return []
    header, rows = _table_header_and_body(table)
    at = _column_index(header, "ID", where, errors)
    if at is None:
        return []
    matching = [row for row in rows if _bare(row[at]) == "VIEW-007"]
    if len(matching) != 1:
        fail(
            f"{where}: {len(matching)} rows carry the id `VIEW-007`, not 1. The acceptance "
            "table states each feature's status once",
            errors,
        )
        return []
    row = matching[0]
    if len(row) != len(header):
        fail(
            f"{where}: the `VIEW-007` row has {len(row)} cells where the header has "
            f"{len(header)}. A ragged row shifts the acceptance summary onto another column",
            errors,
        )
        return []
    numbered = [
        index + 1
        for index, line in enumerate(body.split("\n"))
        if line.strip().startswith("| VIEW-007 |")
    ]
    return [(numbered[0] if len(numbered) == 1 else 0, " | ".join(row))]


# Every current repository surface that authoritatively states M5.4's outcome,
# each under the identity it actually uses. The roadmap and the append-only log
# state the slice's own status under `M5.4`; the feature catalogue states the
# same answer under the product identity `VIEW-007`, because that is what a
# reader checks a feature against -- and it states it twice, in the acceptance
# row and in the implementation note, which are two current assertions rather
# than one and its summary.
ROUTE_STATUS_SURFACES: tuple[tuple[str, str, object], ...] = (
    ("ROADMAP.md", "M5.4", None),
    ("BOOTSTRAP_STATUS.md", "M5.4", None),
    ("docs/product/FEATURE_CATALOG.md", "VIEW-007", _acceptance_row_for_view_007),
)


def _route_status_regions(errors: list[str]) -> list[tuple[str, int, str]]:
    """Where each governed document states the route outcome, with its line.

    Document-specific authority decides what counts as a current region; the
    validator then applies one law to all of them, so no outcome token is
    written down per document.
    """
    found: list[tuple[str, int, str]] = []
    for name, anchor, extra in ROUTE_STATUS_SURFACES:
        document = ROOT / name
        if not document.is_file():
            continue
        body = document.read_text(encoding="utf-8")
        regions = list(_status_claims_about(body, anchor))
        if extra is not None:
            regions.extend(extra(body, errors))
        if not regions:
            fail(
                f"{name} states no `{anchor}` status of its own. The spike holds the "
                "measurement, and a status document that never states the outcome cannot be "
                "checked against it",
                errors,
            )
            continue
        found.extend((name, number, region) for number, region in regions)
    return found


def validate_the_xic_route_outcome_has_one_answer(errors: list[str]) -> None:
    """Every status document reports the route outcome the spike measured.

    M5.4 is an evidence slice, so almost everything it produces is prose, and
    prose is exactly what drifts. The failure this closes is concrete and
    happened once already in this repository's history: a slice's conclusion was
    revised, and one status document went on asserting the withdrawn one. A
    reader meeting that document has no way to know which sentence is current.

    The spike is the authority -- it holds the measurement -- so the rule is that
    the two current-status documents agree with it rather than that all three say
    some fixed string. Revising the outcome stays a one-line edit in the spike;
    what stops being possible is revising it *there only*.

    Both halves are scoped to where a document states M5.4's own status. That is
    not a refinement, it is the rule: these documents are append-only, so a
    whole-file search for the outcome asks only whether the token appears
    anywhere, and route-lock prose written before the measurement names both
    branches. Deleting the current conclusion outright would leave that history
    to satisfy the check.

    Three documents state that outcome, not two, and they do not share one
    anchor: `FEATURE_CATALOG.md` states it under the product identity
    `VIEW-007`, in an acceptance row and an implementation note. Each governed
    region answers for itself, so a correct acceptance row cannot cover for a
    note that has drifted, or the reverse.

    Also pinned: the re-entry gate names the exact measured executable digest.
    The whole point of that gate is that a build is admitted by identity rather
    than by resembling a measured one, and a gate that named no identity would
    be the defect it exists to prevent.
    """
    spike = ROOT / "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md"
    if not spike.is_file():
        return
    text = spike.read_text(encoding="utf-8")

    outcome = _route_outcome(text, errors)
    if outcome is None:
        return
    # By exclusion from the closed set rather than by an `else`, so an unknown
    # token can never be handed the opposite outcome's name. The unpacking
    # asserts what the vocabulary promises: exactly one other outcome.
    (superseded,) = XIC_ROUTE_OUTCOMES - {outcome}

    _validate_the_reentry_gate_names_the_measured_digest(text, errors)

    # Only where a document states the outcome as its *own* current status --
    # the slice section, the bullets opening with the slice's name, and the
    # feature catalogue's `VIEW-007` row and note.
    #
    # Deliberately not every paragraph mentioning M5.4. The route-lock prose
    # written before the measurement discusses both branches as they were then
    # planned -- including that an M5 without a real installation "cannot reach
    # an `XIC_SOURCE_ADMITTED` outcome at all" -- and that is correct history
    # rather than a claim about what was found.
    #
    # One law per region rather than per document: the feature catalogue makes
    # two independent current assertions, and one of them being right must not
    # license the other to drift.
    for name, number, region in _route_status_regions(errors):
        if f"`{outcome}`" not in region:
            fail(
                f"{name}:{number} does not state M5.4's measured outcome `{outcome}`. A "
                "mention elsewhere in the document does not carry it: historical planning "
                "prose names both branches, and a reader meeting this one has no way to tell "
                "which sentence is the answer",
                errors,
            )

        # A record that says a conclusion was withdrawn has to be able to name
        # the conclusion it withdrew. Only an *unmarked* mention is a claim; the
        # marker has to sit on the same line as the token, so a withdrawal
        # elsewhere in a long section cannot license a stale sentence further
        # down.
        stale = [
            line
            for line in region.split("\n")
            if f"`{superseded}`" in line
            and not any(
                marker in line.lower()
                for marker in ("withdraw", "supersede", "earlier candidate", "no longer")
            )
        ]
        if stale:
            fail(
                f"{name}:{number} reports M5.4 as `{superseded}`, which the spike supersedes "
                f"with `{outcome}`. A withdrawn conclusion left standing in a status document "
                "is the one way this record can mislead",
                errors,
            )


def _validate_the_reentry_gate_names_the_measured_digest(
    text: str, errors: list[str]
) -> None:
    """The re-entry gate repeats the digest the measured-build table records.

    One source of documentary truth and one consistency check: the digest is
    read out of the evidence table rather than written down a second time here,
    so a rebuild measured against a different executable is a one-line edit in
    the spike and this rule follows it.

    The word `SHA-256` is not an executable identity. A gate that said only
    "the exact SHA-256" would pass a text search while naming nothing, and the
    whole point of the rule it enforces is that a build is admitted by identity
    rather than by resembling a measured one.

    Fails closed on every way the pair can stop meaning anything: no table
    digest, an ambiguous set of them, a value that is not 64 hex characters, no
    gate section, or a gate that does not repeat that exact value. Hex case is
    not treated as semantic, which is the convention `Sha256Digest` already
    uses.
    """
    build = _section(text, "## Measured ProteoWizard build")
    if build is None:
        fail(
            "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md has no `## Measured ProteoWizard build` "
            "section, so there is no measured executable identity for the re-entry gate to "
            "repeat",
            errors,
        )
        return

    # The one row that names the executable this evidence belongs to. Anchored
    # on `msaccess.exe` and `SHA-256` together, so the sibling `msconvert.exe`
    # row and the release strings cannot be mistaken for it.
    digests = {
        found.upper()
        for line in build.split("\n")
        if "msaccess.exe" in line and "SHA-256" in line
        for found in re.findall(r"\b([0-9a-fA-F]{64})\b", line)
    }
    if len(digests) != 1:
        fail(
            "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md: the measured-build table names "
            f"{len(digests)} `msaccess.exe` SHA-256 values, not 1. The re-entry gate is "
            "checked against that table, so exactly one measured identity has to be "
            "readable from it",
            errors,
        )
        return
    measured = digests.pop()

    gate = _section(text, "## The XIC re-entry gate")
    if gate is None:
        fail(
            "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md has no `## The XIC re-entry gate` section. "
            "A refusal that records no re-entry condition leaves the next attempt with nothing "
            "to satisfy",
            errors,
        )
        return

    # Set equality, not membership. The gate names the identities that fresh
    # evidence covers, and this record covers exactly one executable. A gate
    # reading "this digest or that one" would admit a build nobody measured --
    # which is the move the rule exists to forbid -- while still containing the
    # measured value. Comparing normalized values, so restating the same
    # identity more than once is not a second identity.
    named = {found.upper() for found in re.findall(r"\b([0-9a-fA-F]{64})\b", gate)}
    if measured not in named:
        fail(
            "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md: the re-entry gate does not name the "
            f"measured `msaccess.exe` digest `{measured[:8]}...{measured[-4:]}` that the "
            "measured-build table records. Scientific evidence is transferable only to an "
            "executable identity the evidence covers, and the word `SHA-256` is not an "
            "identity",
            errors,
        )
    unevidenced = sorted(named - {measured})
    if unevidenced:
        noun = "identity" if len(unevidenced) == 1 else "identities"
        fail(
            f"docs/spikes/M5_XIC_SOURCE_EVIDENCE.md: the re-entry gate names {len(unevidenced)} "
            f"executable {noun} this record holds no evidence for -- "
            + ", ".join(f"`{value[:8]}...{value[-4:]}`" for value in unevidenced)
            + ". The gate admits an executable the evidence covers, not a shortlist that "
            "happens to include it; a further build becomes eligible by being measured, not "
            "by being listed alongside one that was",
            errors,
        )


def _first_markdown_table(text: str, heading: str) -> list[list[str]] | None:
    """The first pipe-table following one heading, as rows of stripped cells.

    Deliberately not a markdown parser. Two repository-owned structures are
    read by this: ADR 0037's candidate-dimension table and the spike's
    candidate-standard matrix. Both are plain pipe tables whose cells contain no
    pipes, and both follow a heading this repository controls.
    """
    start = text.find(heading)
    if start < 0:
        return None
    rows: list[list[str]] = []
    for line in text[start + len(heading) :].split("\n"):
        stripped = line.strip()
        if stripped.startswith("|"):
            # An escaped pipe is content, not a cell boundary. The live
            # candidate inventory quotes signatures containing `<a\\|b>`, and
            # splitting naively makes those rows look ragged.
            rows.append(
                [
                    cell.strip().replace("\\|", "|")
                    for cell in re.split(r"(?<!\\)\|", stripped.strip("|"))
                ]
            )
        elif rows:
            break
    return rows or None


def _table_header_and_body(rows: list[list[str]]) -> tuple[list[str], list[list[str]]]:
    """A pipe table's header cells and its data rows.

    The alignment rule is the only row made entirely of dashes and colons; the
    row before it is the header and everything after it is data.
    """
    for index, row in enumerate(rows):
        if row and all(cell and set(cell) <= set("-: ") for cell in row):
            return (rows[index - 1] if index else []), rows[index + 1 :]
    return [], []


def _bare(cell: str) -> str:
    """A cell's identity without the markup it is presented in."""
    return cell.strip().strip("*").strip("`").strip()


# Every state a candidate may end in. Three, and there is no fourth: a candidate
# was measured and admitted, measured and rejected, or excluded by its own
# declared signature without being measured. A token that merely resembles one
# of these is not one, and `EXCLUDED_BY_SIGNATURED` would otherwise pass as a
# terminal state nobody defined.
XIC_CANDIDATE_FINAL_STATES: frozenset[str] = frozenset(
    {
        "MEASURED_ADMITTED",
        "MEASURED_REJECTED",
        "EXCLUDED_BY_SIGNATURE",
    }
)

# The states that mean a candidate had to be measured, and therefore has to be
# answered across every dimension of the standard. Derived rather than written
# out again, so the two vocabularies cannot drift apart. The candidates
# themselves are read from the document; only the vocabulary is fixed, because
# it is what "was measured" means.
MEASURED_STATES: frozenset[str] = XIC_CANDIDATE_FINAL_STATES - {"EXCLUDED_BY_SIGNATURE"}

# M6.2's own vocabulary. Deliberately a different set from M5.4's, because the
# question is different: M5.4 could close a candidate on its declared signature
# alone, and a capability slice cannot -- an option that parses has established
# nothing about what it did. So there is no signature-only state here, and
# `EVIDENCE_BLOCKED` exists in its place for the case M5.4 never met: an
# operation whose measurement needs an input this repository may not lawfully
# hold.
M62_CANDIDATE_FINAL_STATES: frozenset[str] = frozenset(
    {
        "MEASURED_ADMISSIBLE",
        "MEASURED_REJECTED",
        "EVIDENCE_BLOCKED",
    }
)

# Two outcomes, and no third. Either the slice measured the installed build
# against its candidates, or it could not and says so.
M62_ROUTE_OUTCOMES: frozenset[str] = frozenset(
    {
        "MSCONVERT_CAPABILITY_MEASURED",
        "MSCONVERT_CAPABILITY_EVIDENCE_BLOCKED",
    }
)

M63_INTENT = "crates/proteowizard/src/intent.rs"

#: How many combinations the five axes span, and how many the evidence admits.
#: Stated here as well as in the module so a widened table has to be widened
#: deliberately in two places rather than drifting in one.
M63_CROSS_PRODUCT = 48
M63_ADMITTED_ROWS = 9

#: The one shape a picker filter may take in an admitted row's evidence.
#:
#: M6.2 measured that `peakPicking msLevel=<set>` with no picker token silently
#: centroids every level while exiting 0, and that every named picker token is
#: either rejected or blocked. So the bare filter is the only measured form, and
#: a row citing any other is citing something that does not mean what it reads.
M63_ADMITTED_PICKER_FILTER = "peakPicking"

#: The MS-level filter forms that mean "every level".
#:
#: The omission and the explicit open range, which M6.2 measured byte-identical
#: (L3 against L4). Nothing else: a bounded range is a different population.
M63_ALL_LEVEL_FILTERS: frozenset[tuple[str, ...]] = frozenset({(), ("msLevel 1-",)})

#: What each precision value requires of the flags a case was measured with.
#:
#: Alternatives, because a width can be asked for globally or per array and M6.2
#: measured both spellings. An empty alternative means *no* precision flag: that
#: is what `Mz64Intensity32` is, and it is the provider's default rather than
#: anything MSCanvas states -- which is the finding that put precision on M6.2's
#: candidate list in the first place.
M63_PRECISION_EVIDENCE: dict[str, tuple[frozenset[str], ...]] = {
    "Mz64Intensity32": (frozenset(),),
    "Mz64Intensity64": (frozenset({"--64"}), frozenset({"--mz64", "--inten64"})),
    "Mz32Intensity32": (frozenset({"--32"}), frozenset({"--mz32", "--inten32"})),
    "Mz32Intensity64": (frozenset({"--mz32", "--inten64"}),),
}

#: The flags each precision value contradicts.
#:
#: Present as well as the alternatives above because a spelling can be satisfied
#: while another flag says the opposite: `--64 --inten32` contains `--64` and is
#: the mixed posture, not the 64-bit one. Absent here for `Mz64Intensity32`,
#: whose whole requirement is that no precision flag was given at all.
M63_PRECISION_CONTRADICTIONS: dict[str, frozenset[str]] = {
    "Mz64Intensity32": frozenset(),
    "Mz64Intensity64": frozenset({"--32", "--mz32", "--inten32"}),
    "Mz32Intensity32": frozenset({"--64", "--mz64", "--inten64"}),
    "Mz32Intensity64": frozenset({"--32", "--64", "--mz64", "--inten32"}),
}

#: Every precision flag the installed grammar exposes, so "no precision flag"
#: is decided against a closed list rather than against a prefix.
M63_PRECISION_FLAGS: frozenset[str] = frozenset(
    {"--32", "--64", "--mz32", "--mz64", "--inten32", "--inten64"}
)

#: How compression appears in a measured argv. `--zlib` is the provider default,
#: so a case that names neither measured compression *on*.
M63_COMPRESSION_OFF = "--zlib=off"

M63_INTENT_ROW = re.compile(
    r"AdmittedIntent\s*\{\s*"
    r"intent:\s*ConversionIntent\s*\{\s*"
    r"format:\s*OutputFormat::(?P<format>\w+),\s*"
    r"processing:\s*ProcessingIntent::(?P<processing>\w+),\s*"
    r"population:\s*SpectrumPopulation::(?P<population>\w+),\s*"
    r"precision:\s*NumericPrecision::(?P<precision>\w+),\s*"
    r"compression:\s*CompressionIntent::(?P<compression>\w+),\s*"
    r"\},\s*"
    r'evidence:\s*"(?P<evidence>[^"]*)",\s*'
    r"\}",
)


M610_RECORD = "docs/spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md"

# The four routes criterion 11 closes, and the set is closed. Pinned here rather
# than counted from the document, because a record that lost a row would
# otherwise be checked against itself and agree.
M610_ROUTES: tuple[str, ...] = (
    "CNV-002 mzXML output",
    "Vendor-format direct preview",
    "Any further vendor family",
    "VIEW-007 conditional XIC re-entry",
)

# The only dispositions criterion 11 accepts. Criterion 11 itself is never
# refused or evidence-blocked; these are the *inner* states a route may end in.
M610_DISPOSITIONS: frozenset[str] = frozenset(
    {
        "ADMITTED",
        "REFUSED_WITH_EVIDENCE",
        "EVIDENCE_BLOCKED",
    }
)

# Tokens that describe a route as still open. None is terminal, and an undisposed
# route is the one outcome this slice exists to prevent -- so a ledger that ends
# a route on any of them fails rather than reads.
M610_NON_TERMINAL: tuple[str, ...] = (
    "PENDING",
    "DEFERRED_WITH_OWNER",
    "NOT_TRIGGERED",
)

# The named route-specific outcomes that already existed, and the route each
# belongs to. They are preserved and mapped rather than replaced: a competing
# status invented beside CNV-D1's or M5.4's would be a second vocabulary for one
# answer.
M610_NAMED_OUTCOMES: tuple[tuple[str, str], ...] = (
    ("CNV-002 mzXML output", "MZXML_REFUSED"),
    ("VIEW-007 conditional XIC re-entry", "XIC_SOURCE_REFUSED"),
)

M610_ROUTE_OUTCOMES: frozenset[str] = frozenset({"SIDE_ROUTES_DISPOSITIONED"})

M62_SPIKE = "docs/spikes/M6_MSCONVERT_CAPABILITY_EVIDENCE.md"
M62_ROUTE = "docs/architecture/adr/0043-conversion-completion-route.md"

# The exact sentence M6.0 left behind, which counted a measured question and a
# non-candidate as two outstanding gates. Matched as the requirement it was, not
# as the phrase: the corrected acceptance has to be able to say the words in
# order to withdraw them.
M62_STALE_ACCEPTANCE = "The two pending measurements are performed"

# The conditional side-output obligation has exactly two honest endings, and
# they are required as tokens rather than as prose. A substring search for
# "triggered" passes on "whether the condition was triggered is still pending",
# which is the one answer the obligation rules out.
M62_SIDE_OUTPUT_DISPOSITIONS: frozenset[str] = frozenset(
    {
        "TRIGGERED_AND_MEASURED",
        "NOT_TRIGGERED",
    }
)

# The measurement set M6.2's evidence *is*, pinned here so that changing it is a
# deliberate act rather than an edit nobody notices.
#
# It is pinned because prose could not hold it. The first M6.2 record claimed six
# mzXML runs where four exist, and named twenty-eight of twenty-nine cases, and
# every table in the document was internally consistent throughout -- the counts
# were sentences, and sentences agree with whatever is around them. These
# constants and the committed ledger are two independent statements of the same
# set, and the evidence document is checked against both.
M62_EXPECTED_CASES: tuple[str, ...] = (
    "D1",
    "P1", "P2", "P3", "P4", "P5",
    "C1", "C2",
    "L1", "L2", "L3", "L4",
    "K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8", "K9", "K10", "K11", "K12",
    "X1", "X2", "X3", "X4", "X5",
)

#: The cases that produce mzXML, and the one that is the mzML control.
M62_EXPECTED_MZXML_CASES: tuple[str, ...] = ("X1", "X2", "X4", "X5")
M62_MZML_CONTROL = "X3"

#: The claim that shipped the miscount, refused as the assertion it was rather
#: than as the words it used. A record has to be able to *describe* the error it
#: corrected -- this one does, a few lines above its case table -- so the rule
#: matches the sentence that asserts the wrong count and nothing else. The
#: structural checks below would catch a wrong count anyway; this makes the
#: specific regression unmistakable.
M62_MISCOUNT = "six mzXML runs"


def _column_index(header: list[str], name: str, where: str, errors: list[str]) -> int | None:
    """One named column of a table, or a failure saying it is not there."""
    found = [index for index, cell in enumerate(header) if _bare(cell) == name]
    if len(found) != 1:
        fail(
            f"{where}: the table has {len(found)} `{name}` columns, not 1. The column is read "
            "by repository validation, so it has to be identifiable",
            errors,
        )
        return None
    return found[0]


def validate_one_candidate_evidence_dimension_vocabulary(errors: list[str]) -> None:
    """The M5.4 matrix answers exactly the dimensions ADR 0037 requires.

    Two documents, one vocabulary, and the split is deliberate: the ADR decides
    what a candidate must be measured across, and the spike holds the answers.
    Nothing connected them, and the failure that follows from that is not
    hypothetical -- the ADR required duplicate-retention-time behaviour, the
    matrix had no such row, and a refusal condition still described the matrix
    as discharging the whole standard.

    Set equality rather than containment, in both directions. A missing
    dimension is an unanswered requirement. An extra one is a dimension nobody
    agreed to, which is how `Synthetic run`, `Representative run` and `Outcome`
    came to pad the matrix while a real dimension was absent and the row count
    still looked plausible.

    The same argument closes the other axis. Candidate columns are read from the
    spike's own final classification -- every candidate whose recorded state
    means it had to be measured -- rather than written down a second time here,
    so a candidate cannot leave the matrix while its classification still says
    it was measured, and one cannot appear that nothing measured. Deleting a
    whole column used to pass: the rows were intact, and rows were all this
    checked.

    The intended failure mode is that amending the ADR's table breaks this rule
    until the evidence owner classifies the new dimension for every candidate.
    Nothing here reads what a cell says: presence and shape are structure, and
    whether an answer is any good stays a matter for review.
    """
    adr = ROOT / "docs/architecture/adr/0037-viewer-completion-route.md"
    spike = ROOT / "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md"
    if not adr.is_file() or not spike.is_file():
        return

    required = _first_markdown_table(
        adr.read_text(encoding="utf-8"), "#### M5.4 candidate evidence dimensions"
    )
    if required is None:
        fail(
            "docs/architecture/adr/0037-viewer-completion-route.md has no "
            "`#### M5.4 candidate evidence dimensions` table. It is the route's own statement "
            "of what a candidate must be measured across, and the spike's matrix is checked "
            "against it",
            errors,
        )
        return
    spike_text = spike.read_text(encoding="utf-8")
    answered = _first_markdown_table(spike_text, "## Candidate-standard matrix")
    if answered is None:
        fail(
            "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md has no `## Candidate-standard matrix` table. "
            "The refusal's third condition is discharged by that matrix rather than by prose, "
            "so it has to exist",
            errors,
        )
        return
    # The ADR numbers its rows, so the dimension is the second column; the
    # matrix leads with the dimension and then one column per candidate.
    _, required_body = _table_header_and_body(required)
    names = [row[1] for row in required_body if len(row) > 1]
    header, body = _table_header_and_body(answered)
    rows = [row[0] for row in body if row]

    for label, values, where in (
        ("ADR 0037", names, "docs/architecture/adr/0037-viewer-completion-route.md"),
        ("the spike matrix", rows, "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md"),
    ):
        if not values:
            fail(
                f"{where}: the candidate-dimension table has no rows. An empty vocabulary "
                "would let the other side say anything",
                errors,
            )
            return
        repeated = sorted({value for value in values if values.count(value) > 1})
        if repeated:
            fail(
                f"{where}: {label} names {', '.join(repr(value) for value in repeated)} more "
                "than once. A dimension answered twice is two answers with nothing deciding "
                "between them",
                errors,
            )
            return

    missing = sorted(set(names) - set(rows))
    if missing:
        fail(
            "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md: the candidate-standard matrix does not "
            f"answer {', '.join(repr(value) for value in missing)}, which ADR 0037 requires of "
            "every measured candidate. An unanswered dimension is not discharged by the "
            "matrix, whatever the refusal conditions say",
            errors,
        )
    extra = sorted(set(rows) - set(names))
    if extra:
        fail(
            "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md: the candidate-standard matrix answers "
            f"{', '.join(repr(value) for value in extra)}, which ADR 0037 does not define as a "
            "candidate evidence dimension. Rows the standard never asked for make the matrix "
            "look complete while a required dimension is missing",
            errors,
        )

    measured = _validate_every_installed_candidate_has_one_final_state(spike_text, errors)
    if measured is not None:
        _validate_the_matrix_covers_every_measured_candidate(measured, header, body, errors)


def _validate_every_installed_candidate_has_one_final_state(
    spike_text: str, errors: list[str]
) -> set[str] | None:
    """Every declared candidate is classified once, in a state the route defines.

    Refusal conditions 2 and 4 -- every live installed candidate was classified,
    and every unmeasured one is excluded explicitly by its signature -- rest
    entirely on this table, and nothing checked it. A candidate could leave the
    classification, or take a state nobody defined, and the canonical check
    stayed silent while the matrix obligation quietly shrank with it.

    So the inventory and the classification are held equal as sets, the state
    is required to be one of three, and the measured set is derived only after
    both hold. Returns that set, or `None` when the classification cannot be
    trusted to derive it from.

    What the `Basis` cell argues is not read. That a candidate has a basis at
    all is structure; whether the argument is any good is review's.
    """
    spike = "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md"

    inventory = _first_markdown_table(spike_text, "## Live candidate inventory")
    if inventory is None:
        fail(
            f"{spike} has no `## Live candidate inventory` table. It is the record of what the "
            "measured build declares, and the classification is checked against it",
            errors,
        )
        return None
    inventory_header, inventory_rows = _table_header_and_body(inventory)
    at = _column_index(inventory_header, "Candidate", f"{spike} live candidate inventory", errors)
    if at is None:
        return None
    declared = [_bare(row[at]) for row in inventory_rows if len(row) > at]
    if len(declared) != len(inventory_rows) or not all(declared):
        fail(
            f"{spike}: the live candidate inventory has a row with no candidate. A row that "
            "names nothing cannot be classified",
            errors,
        )
        return None
    repeated = sorted({value for value in declared if declared.count(value) > 1})
    if repeated:
        fail(
            f"{spike}: the live candidate inventory declares "
            f"{', '.join(repr(value) for value in repeated)} more than once. The build declares "
            "a command once",
            errors,
        )
        return None
    if not declared:
        fail(
            f"{spike}: the live candidate inventory declares no candidate, so nothing could be "
            "classified and the refusal would have nothing to be complete about",
            errors,
        )
        return None

    classification = _first_markdown_table(spike_text, "## Final classification")
    if classification is None:
        fail(
            f"{spike} has no `## Final classification` table. It is where a candidate's state "
            "is recorded, and the matrix's columns are checked against it",
            errors,
        )
        return None
    header, rows = _table_header_and_body(classification)
    where = f"{spike} final classification"
    columns = {
        name: _column_index(header, name, where, errors)
        for name in ("Candidate", "State", "Basis")
    }
    if any(index is None for index in columns.values()):
        return None
    ragged = [row for row in rows if len(row) != len(header)]
    if ragged:
        fail(
            f"{spike}: {len(ragged)} row(s) of the final classification have a cell count the "
            f"header's {len(header)} does not match. A ragged row shifts a candidate's state "
            "onto the wrong column",
            errors,
        )
        return None
    blank = [
        (_bare(row[columns["Candidate"]]) or "<unnamed>", name)
        for row in rows
        for name in ("Candidate", "State", "Basis")
        if not row[columns[name]].strip()
    ]
    if blank:
        fail(
            f"{spike}: the final classification leaves "
            + ", ".join(f"{candidate} without a {name}" for candidate, name in blank)
            + ". A candidate is classified by naming it, its state, and why",
            errors,
        )
        return None

    classified = [_bare(row[columns["Candidate"]]) for row in rows]
    repeated = sorted({value for value in classified if classified.count(value) > 1})
    if repeated:
        fail(
            f"{spike}: the final classification lists "
            f"{', '.join(repr(value) for value in repeated)} more than once. A candidate with "
            "two states has no state",
            errors,
        )
        return None

    states = {
        _bare(row[columns["Candidate"]]): _bare(row[columns["State"]]) for row in rows
    }
    invalid = sorted(
        (candidate, state)
        for candidate, state in states.items()
        if state not in XIC_CANDIDATE_FINAL_STATES
    )
    if invalid:
        fail(
            f"{spike}: the final classification ends "
            + ", ".join(f"{candidate} in `{state}`" for candidate, state in invalid)
            + f", which is not one of the {len(XIC_CANDIDATE_FINAL_STATES)} states a candidate "
            "may end in ("
            + ", ".join(f"`{name}`" for name in sorted(XIC_CANDIDATE_FINAL_STATES))
            + "). A token that resembles a terminal state is not one",
            errors,
        )
        return None

    unclassified = sorted(set(declared) - set(classified))
    if unclassified:
        fail(
            f"{spike}: the live candidate inventory declares "
            f"{', '.join(repr(value) for value in unclassified)} with no final classification. "
            "An installed candidate left in no state is the one thing the refusal's second "
            "condition rules out",
            errors,
        )
    undeclared = sorted(set(classified) - set(declared))
    if undeclared:
        fail(
            f"{spike}: the final classification records "
            f"{', '.join(repr(value) for value in undeclared)}, which the live candidate "
            "inventory does not declare. A candidate the build never offered cannot have been "
            "classified from it",
            errors,
        )
    if unclassified or undeclared:
        return None

    # The route outcome and the candidate states are both finite now, so their
    # minimum agreement is checkable. Nothing about *which* source to choose is
    # decided here -- that is D4's, and it stays a product question.
    outcome = _route_outcome(spike_text)
    admitted = sorted(
        candidate for candidate, state in states.items() if state == "MEASURED_ADMITTED"
    )
    if outcome == "XIC_SOURCE_REFUSED" and admitted:
        fail(
            f"{spike}: the route outcome is `XIC_SOURCE_REFUSED` while "
            f"{', '.join(repr(value) for value in admitted)} is classified `MEASURED_ADMITTED`. "
            "A refusal means no candidate was admitted; one of the two is wrong, and a reader "
            "cannot tell which",
            errors,
        )
        return None
    if outcome == "XIC_SOURCE_ADMITTED" and not admitted:
        fail(
            f"{spike}: the route outcome is `XIC_SOURCE_ADMITTED` while no candidate is "
            "classified `MEASURED_ADMITTED`. An admission names the source it admitted",
            errors,
        )
        return None

    return {candidate for candidate, state in states.items() if state in MEASURED_STATES}


def _validate_the_matrix_covers_every_measured_candidate(
    measured: set[str],
    header: list[str],
    body: list[list[str]],
    errors: list[str],
) -> None:
    """The matrix's columns are the candidates the classification says were measured.

    Read from the record rather than restated: a candidate list written here
    would be a second authority, and the point of the rule is that there is one.
    A signature-excluded candidate needs no column, because its exclusion is
    closed without measuring it.
    """
    spike = "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md"
    if not measured:
        fail(
            f"{spike}: the final classification records no measured candidate, so the "
            "candidate-standard matrix would have nothing to be complete about",
            errors,
        )
        return

    columns = [_bare(cell) for cell in header[1:]]
    if not columns or not all(columns):
        fail(
            f"{spike}: the candidate-standard matrix header names no candidate columns. The "
            "matrix is what discharges the refusal's third condition, and it discharges "
            "nothing without them",
            errors,
        )
        return
    duplicated = sorted({value for value in columns if columns.count(value) > 1})
    if duplicated:
        fail(
            f"{spike}: the candidate-standard matrix has "
            f"{', '.join(repr(value) for value in duplicated)} in more than one column. Two "
            "columns for one candidate are two answers with nothing deciding between them",
            errors,
        )
        return

    absent = sorted(measured - set(columns))
    if absent:
        fail(
            f"{spike}: the candidate-standard matrix has no column for "
            f"{', '.join(repr(value) for value in absent)}, which the final classification "
            "records as measured. A measured candidate that leaves the matrix takes its "
            "unanswered dimensions with it, and the row count still looks right",
            errors,
        )
    unmeasured = sorted(set(columns) - measured)
    if unmeasured:
        fail(
            f"{spike}: the candidate-standard matrix has a column for "
            f"{', '.join(repr(value) for value in unmeasured)}, which the final classification "
            "does not record as measured. A column nothing measured is a claim the evidence "
            "does not carry",
            errors,
        )
    if absent or unmeasured:
        return

    # Rectangular, and every intersection answered. What the answer says is not
    # read here; that a pair was answered at all is structure.
    for row in body:
        if len(row) != len(header):
            fail(
                f"{spike}: the candidate-standard matrix row {row[0]!r} has {len(row)} cells "
                f"where the header has {len(header)}. A ragged row silently shifts every "
                "answer after the gap onto the wrong candidate",
                errors,
            )
            return
    blank = [
        (row[0], columns[position])
        for row in body
        for position, cell in enumerate(row[1:])
        if not cell.strip()
    ]
    if blank:
        fail(
            f"{spike}: the candidate-standard matrix leaves "
            + ", ".join(f"{candidate} on {dimension!r}" for dimension, candidate in blank)
            + " unanswered. Every measured candidate is answered on every required dimension, "
            "as a located result or an explicit `NOT_APPLICABLE` with its reason",
            errors,
        )


def _msconvert_ledger(errors: list[str]) -> object | None:
    """The committed case ledger, imported rather than parsed.

    It is Python beside this file, so reading it as data is both exact and
    cheaper than re-describing it here. The module is pure -- it generates
    fixtures and reads documents and spawns nothing -- so importing it from a
    validator costs nothing and risks nothing.
    """
    source = ROOT / "scripts/msconvert_evidence.py"
    if not source.is_file():
        fail(
            "scripts/msconvert_evidence.py is missing. It holds the M6.2 case ledger, and "
            "the evidence record's counts are checked against it rather than against a "
            "sentence",
            errors,
        )
        return None
    spec = importlib.util.spec_from_file_location("_m62_ledger", source)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _validate_the_msconvert_case_ledger(spike_text: str, errors: list[str]) -> None:
    """The measurement set is data, and the record agrees with it.

    Three statements of one set, held equal: the constants above, the committed
    ledger, and the evidence document's own case table. Any two agreeing while
    the third drifts is exactly how a record comes to claim a run that never
    happened, or to lose one that did.
    """
    ledger = _msconvert_ledger(errors)
    if ledger is None:
        return

    defects = ledger.ledger_defects()
    if defects:
        for defect in defects:
            fail(f"scripts/msconvert_evidence.py: the M6.2 case ledger is malformed -- {defect}", errors)
        return

    declared = tuple(case.case for case in ledger.CASES)
    if declared != M62_EXPECTED_CASES:
        missing = sorted(set(M62_EXPECTED_CASES) - set(declared))
        extra = sorted(set(declared) - set(M62_EXPECTED_CASES))
        detail = []
        if missing:
            detail.append("missing " + ", ".join(repr(name) for name in missing))
        if extra:
            detail.append("has " + ", ".join(repr(name) for name in extra))
        if not detail:
            detail.append("lists them in a different order")
        fail(
            f"scripts/msconvert_evidence.py: the M6.2 case ledger {'; '.join(detail)}. "
            f"M6.2's evidence rests on exactly {len(M62_EXPECTED_CASES)} measured cases, and a "
            "set that shrinks silently takes its conclusions with it",
            errors,
        )
        return

    produced = tuple(ledger.mzxml_cases())
    if produced != M62_EXPECTED_MZXML_CASES:
        fail(
            f"scripts/msconvert_evidence.py: the ledger's mzXML-producing cases are "
            f"{list(produced)}, not {list(M62_EXPECTED_MZXML_CASES)}. This is the count the "
            "record got wrong once -- it said six against four -- so it is derived from the "
            "ledger and pinned here rather than written in a sentence",
            errors,
        )
        return

    control = next(
        (case for case in ledger.CASES if case.case == M62_MZML_CONTROL), None
    )
    if control is None or control.output_format != "mzML":
        fail(
            f"scripts/msconvert_evidence.py: `{M62_MZML_CONTROL}` is not an mzML case. It is "
            "the control that makes a spectrum missing from `X2` the mzXML writer's doing "
            "rather than the reader's, and a control that changed format would prove nothing",
            errors,
        )
        return

    if M62_MISCOUNT in spike_text:
        fail(
            f"{M62_SPIKE} says {M62_MISCOUNT!r} again. There are "
            f"{len(M62_EXPECTED_MZXML_CASES)} mzXML-producing cases -- "
            + ", ".join(f"`{name}`" for name in M62_EXPECTED_MZXML_CASES)
            + " -- and the miscount it replaced was the defect that made this ledger "
            "necessary",
            errors,
        )

    _validate_the_record_carries_every_ledger_field(ledger, declared, spike_text, errors)


def _validate_the_record_carries_every_ledger_field(
    ledger: object, declared: tuple[str, ...], spike_text: str, errors: list[str]
) -> None:
    """The record's case table and the committed ledger agree on **every** field.

    This is M6.10's correction, and the size of what it replaced is the reason
    for it. M6.2's guard compared two of a case's seven declared fields -- its id
    and its output format -- so a row could name the wrong fixture, the wrong
    argv, the wrong output name or a posture the run never had, and read as
    agreeing with the ledger it contradicted. M6.2 verified all seven by hand
    and recorded that the guard did not.

    The comparison is against text the ledger itself renders, not against a
    second description of the formatting written here. A validator that
    re-described the markup would be a second spelling of the ledger, free to
    agree with a document the ledger does not.

    Nothing below reads what a row argues. That a row says what the ledger says
    is structure; whether the measurement behind it was any good stays a matter
    for review.
    """
    table = _first_markdown_table(spike_text, "### The measured cases")
    if table is None:
        fail(
            f"{M62_SPIKE} has no `### The measured cases` table. It is the record's copy of "
            "the committed ledger, and without it every count in the document is a sentence "
            "again",
            errors,
        )
        return
    header, body = _table_header_and_body(table)
    expected_header = [name for name, _ in ledger.RECORD_COLUMNS]
    if [cell.strip() for cell in header] != expected_header:
        fail(
            f"{M62_SPIKE}: the measured-cases table names columns "
            f"{[cell.strip() for cell in header]}, not the ledger's record contract "
            f"{expected_header}. Every column is a field the rows are compared on, so a "
            "renamed or missing one silently stops that field being checked",
            errors,
        )
        return
    listed = tuple(_bare(row[0]) for row in body if row)
    if listed != declared:
        missing = sorted(set(declared) - set(listed))
        extra = sorted(set(listed) - set(declared))
        detail = []
        if missing:
            detail.append("omits " + ", ".join(repr(name) for name in missing))
        if extra:
            detail.append("adds " + ", ".join(repr(name) for name in extra))
        if not detail:
            detail.append("lists them in a different order")
        fail(
            f"{M62_SPIKE}: the measured-cases table {'; '.join(detail)} against the committed "
            "ledger. The record named twenty-eight of twenty-nine cases once, and nothing "
            "caught it because nothing compared the two",
            errors,
        )
        return

    disagreements: list[str] = []
    for case, row in zip(ledger.CASES, body):
        if len(row) != len(expected_header):
            disagreements.append(
                f"`{case.case}` has {len(row)} cells where the contract has "
                f"{len(expected_header)}"
            )
            continue
        for (column, _), expected, found in zip(
            ledger.RECORD_COLUMNS, ledger.record_row(case), row
        ):
            if expected != found.strip():
                disagreements.append(
                    f"`{case.case}` gives {column} as {found.strip()!r} where the ledger "
                    f"says {expected!r}"
                )
    if disagreements:
        fail(
            f"{M62_SPIKE}: the measured-cases table disagrees with the committed ledger -- "
            + "; ".join(disagreements)
            + ". A row that states a fixture, an argv, an output name or a posture the "
            "ledger does not is a measurement the record describes and nothing performed",
            errors,
        )


def validate_the_admitted_intent_table_cites_measurements_that_support_it(
    errors: list[str],
) -> None:
    """M6.3's admitted table names M6.2 cases, and the cases say what it claims.

    The whole point of `ConversionIntent` is that an intent may only name a
    semantic the installed build was measured performing. The type enforces the
    *shape* of that rule -- five values in, `Option<Self>` out -- and cannot
    enforce its content: nothing in Rust stops a row being added with an
    evidence string that names a case which measured something else, or nothing
    at all.

    So the two files are held against each other. Every row of
    `ConversionIntent::ADMITTED` names at least one case; every named case
    exists in the committed M6.2 ledger, produced mzML, and exited zero; and
    every case a row names must have been run with argv consistent with the
    combination the row claims -- the required tokens present and the
    contradicting ones absent, in *every* case the row cites rather than in one
    of them.

    That last rule is what catches the failure this validator exists for. A row
    claiming `NoCompression` while citing a case that ran `--zlib` is not a
    typo; it is the composition graph being widened by assertion, which is
    precisely what M6.2 was run to prevent.

    Nothing here reads whether a measurement was any good. That a row rests on a
    run that did what the row says is structure; whether the run established the
    conclusion stays a matter for review.
    """
    intent_path = ROOT / M63_INTENT
    if not intent_path.is_file():
        fail(
            f"{M63_INTENT} is missing. It holds the admitted-intent table, which is the "
            "only thing standing between M6.2's incomplete composition graph and a free "
            "cross-product of its axes",
            errors,
        )
        return
    intent_text = intent_path.read_text(encoding="utf-8")

    rows = [match.groupdict() for match in M63_INTENT_ROW.finditer(intent_text)]
    if len(rows) != M63_ADMITTED_ROWS:
        fail(
            f"{M63_INTENT} declares {len(rows)} admitted combinations, not "
            f"{M63_ADMITTED_ROWS}. The table is the compatibility rule; a row appearing or "
            "disappearing without this constant moving is the rule changing silently",
            errors,
        )
        return
    if f"[AdmittedIntent; {M63_ADMITTED_ROWS}]" not in intent_text:
        fail(
            f"{M63_INTENT} does not declare `ADMITTED` as `[AdmittedIntent; "
            f"{M63_ADMITTED_ROWS}]`. The array length is what makes a dropped row a compile "
            "error rather than a quieter table",
            errors,
        )

    ledger = _msconvert_ledger(errors)
    if ledger is None:
        return
    if ledger.ledger_defects():
        # Already reported in full by the M6.2 validator; a malformed ledger
        # cannot support any statement about what it measured.
        return
    cases = {case.case: case for case in ledger.CASES}

    seen: set[tuple[str, ...]] = set()
    for row in rows:
        combination = (
            row["format"],
            row["processing"],
            row["population"],
            row["precision"],
            row["compression"],
        )
        if combination in seen:
            fail(
                f"{M63_INTENT} lists the combination {'+'.join(combination)} twice. A "
                "combination admitted twice is a lookup whose answer depends on which row "
                "is reached first",
                errors,
            )
        seen.add(combination)

        named = [name.strip() for name in row["evidence"].split(",") if name.strip()]
        if not named:
            fail(
                f"{M63_INTENT} admits {'+'.join(combination)} without naming any evidence. "
                "A row with no case behind it is the assertion this table exists to refuse",
                errors,
            )
            continue

        for name in named:
            case = cases.get(name)
            if case is None:
                fail(
                    f"{M63_INTENT} admits {'+'.join(combination)} on case {name!r}, which is "
                    "not in the M6.2 ledger. An intent may only name a semantic the build "
                    "was measured performing, and there is no such measurement",
                    errors,
                )
                continue
            if case.output_format != "mzML":
                fail(
                    f"{M63_INTENT} admits {'+'.join(combination)} on case {name!r}, which "
                    f"produced {case.output_format}. No admitted intent names that format",
                    errors,
                )
            if case.posture != "exit 0":
                fail(
                    f"{M63_INTENT} admits {'+'.join(combination)} on case {name!r}, whose "
                    f"measured posture is {case.posture!r}. A run that did not complete "
                    "admits nothing",
                    errors,
                )
            _validate_one_admitted_row_against_its_case(combination, name, case, errors)


def _msconvert_case_semantics(
    arguments: tuple[str, ...],
) -> tuple[frozenset[str], tuple[str, ...], tuple[str, ...]]:
    """What one measured argv actually asked for.

    Walked rather than searched, because a filter crosses the boundary as two
    tokens -- `--filter` and its whole argument -- and substring matching would
    find `msLevel 1` inside `msLevel 1-`, which is a different measurement, and
    would miss `peakPicking cwt` when looking for a picker.
    """
    flags: set[str] = set()
    pickers: list[str] = []
    levels: list[str] = []
    index = 0
    while index < len(arguments):
        token = arguments[index]
        if token == "--filter":
            index += 1
            if index >= len(arguments):
                break
            argument = arguments[index]
            if argument.startswith("peakPicking"):
                pickers.append(argument)
            elif argument.startswith("msLevel"):
                levels.append(argument)
        else:
            flags.add(token)
        index += 1
    return frozenset(flags), tuple(pickers), tuple(levels)


def _validate_one_admitted_row_against_its_case(
    combination: tuple[str, ...],
    name: str,
    case: object,
    errors: list[str],
) -> None:
    """One admitted row, against the argv of one case said to admit it.

    Four questions, one per axis that argv can answer, each decided against what
    the case actually ran rather than against a token appearing anywhere in it.
    The format is checked by the caller, which reads the ledger's own declared
    output format instead.
    """
    _, processing, population, precision, compression = combination
    flags, pickers, levels = _msconvert_case_semantics(tuple(case.arguments))

    def refuse(detail: str) -> None:
        fail(
            f"{M63_INTENT} admits {'+'.join(combination)} on case {name!r}, {detail}",
            errors,
        )

    if processing == "NoAdditionalCentroiding":
        if pickers:
            refuse(
                f"which ran the picker filter(s) {list(pickers)}. A row that asks this "
                "boundary to add nothing may not rest on a run that picked peaks"
            )
    elif processing == "UnscopedDefaultCentroiding":
        if list(pickers) != [M63_ADMITTED_PICKER_FILTER]:
            refuse(
                f"whose picker filters are {list(pickers)}, not "
                f"[{M63_ADMITTED_PICKER_FILTER!r}]. The bare filter is the only measured "
                "form: a picker token is rejected or blocked, and an `msLevel=` scope "
                "without one is silently discarded while exiting 0"
            )
    else:
        refuse(
            f"naming the processing value {processing!r}, which this guard has no evidence "
            "rule for. A new axis value is a new claim about what was measured, and it may "
            "not reach the admitted table unstated"
        )

    if population == "All":
        if levels not in M63_ALL_LEVEL_FILTERS:
            refuse(
                f"which ran the MS-level filter(s) {list(levels)}. A row that asks for every "
                "spectrum may not rest on a run that dropped some"
            )
    elif population in {"Ms1Only", "Ms2Only"}:
        wanted = f"msLevel {population[2]}"
        if list(levels) != [wanted]:
            refuse(
                f"whose MS-level filters are {list(levels)}, not [{wanted!r}]. The row "
                "claims a population that case did not select"
            )
    else:
        refuse(
            f"naming the population value {population!r}, which this guard has no evidence "
            "rule for"
        )

    alternatives = M63_PRECISION_EVIDENCE.get(precision)
    if alternatives is None:
        refuse(
            f"naming the precision value {precision!r}, which this guard has no evidence "
            "rule for"
        )
    else:
        stated = flags & M63_PRECISION_FLAGS
        contradicting = stated & M63_PRECISION_CONTRADICTIONS[precision]
        if (
            not any(alternative <= stated for alternative in alternatives)
            or (alternatives == (frozenset(),) and stated)
            or contradicting
        ):
            spellings = " or ".join(
                "no precision flag" if not alternative else " ".join(sorted(alternative))
                for alternative in alternatives
            )
            refuse(
                f"which ran {sorted(stated) if stated else 'no precision flag'} rather than "
                f"{spellings}. The row claims a width that case did not ask for"
            )

    off = M63_COMPRESSION_OFF in flags
    if compression == "Zlib":
        if off:
            refuse(
                f"which ran {M63_COMPRESSION_OFF!r}. That case measured the opposite of what "
                "the row claims"
            )
    elif compression == "NoCompression":
        if not off:
            refuse(
                f"which never ran {M63_COMPRESSION_OFF!r}. `--zlib` is the provider's "
                "default, so a case that does not turn it off measured compression on"
            )
    else:
        refuse(
            f"naming the compression value {compression!r}, which this guard has no evidence "
            "rule for"
        )


def validate_the_msconvert_capability_evidence_is_closed(errors: list[str]) -> None:
    """M6.2's candidate set is finite, closed, and answered across one standard.

    The same split M5.4 uses: the route decides what a candidate must be
    measured across, and the spike holds the answers. What is new is why the
    closure needs guarding at all. M6.0 shipped this route with **numeric
    precision missing from the finite inventory**, and nothing failed -- the
    remaining candidates were all present, every cell was filled, and the table
    looked complete. A reader planning M6.3 from it would have typed an intent
    whose precision half nobody had measured, and the provider's default would
    have gone on answering a question MSCanvas never asked.

    So precision is required by name rather than left to the inventory's own
    good sense, and the rest of the closure is checked the way M5.4's is:
    inventory and classification held equal as sets, states drawn from a closed
    vocabulary, one row per candidate in the matrix, and no blank intersection.

    Two further rules exist because M6.0 also found the route asserting work
    that was either done or not M6.2's. The stale two-pending-measurements
    acceptance may not return, and existing-output overwrite may not reappear as
    a candidate -- ADR 0009 sends the provider only into private staging, so no
    measurement of it could authorize a destructive product decision, and
    CNV-D4 does not wait on one.

    Nothing here reads what a cell argues. That a pair was answered is
    structure; whether the answer is any good stays a matter for review.
    """
    spike_path = ROOT / M62_SPIKE
    route_path = ROOT / M62_ROUTE
    if not spike_path.is_file() or not route_path.is_file():
        return
    spike_text = spike_path.read_text(encoding="utf-8")
    route_text = route_path.read_text(encoding="utf-8")

    _validate_the_msconvert_route_acceptance_is_current(route_text, errors)
    _validate_the_msconvert_case_ledger(spike_text, errors)

    required = _first_markdown_table(route_text, "#### M6.2 candidate evidence dimensions")
    if required is None:
        fail(
            f"{M62_ROUTE} has no `#### M6.2 candidate evidence dimensions` table. It is the "
            "route's own statement of what a capability candidate must be measured across, "
            "and the evidence record's matrix is checked against it",
            errors,
        )
        return
    _, required_body = _table_header_and_body(required)
    dimensions = [row[1] for row in required_body if len(row) > 1]

    matrix = _first_markdown_table(spike_text, "## Candidate-standard matrix")
    if matrix is None:
        fail(
            f"{M62_SPIKE} has no `## Candidate-standard matrix` table. The route's acceptance "
            "is discharged by that matrix rather than by prose, so it has to exist",
            errors,
        )
        return
    header, body = _table_header_and_body(matrix)
    # M6.2's matrix is the transpose of M5.4's: one row per candidate, one
    # column per dimension, because twelve candidates across nine dimensions is
    # unreadable the other way round. The obligation is identical.
    answered = [_bare(cell) for cell in header[1:]]

    for label, values, where in (
        ("the route", dimensions, M62_ROUTE),
        ("the evidence matrix", answered, M62_SPIKE),
    ):
        if not values or not all(values):
            fail(
                f"{where}: the M6.2 candidate-dimension vocabulary has an empty entry. An "
                "empty vocabulary would let the other side say anything",
                errors,
            )
            return
        repeated = sorted({value for value in values if values.count(value) > 1})
        if repeated:
            fail(
                f"{where}: {label} names {', '.join(repr(value) for value in repeated)} more "
                "than once. A dimension answered twice is two answers with nothing deciding "
                "between them",
                errors,
            )
            return

    missing = sorted(set(dimensions) - set(answered))
    if missing:
        fail(
            f"{M62_SPIKE}: the candidate-standard matrix does not answer "
            f"{', '.join(repr(value) for value in missing)}, which {M62_ROUTE} requires of "
            "every M6.2 candidate. An unanswered dimension is not discharged by the matrix, "
            "whatever the route outcome says",
            errors,
        )
    extra = sorted(set(answered) - set(dimensions))
    if extra:
        fail(
            f"{M62_SPIKE}: the candidate-standard matrix answers "
            f"{', '.join(repr(value) for value in extra)}, which {M62_ROUTE} does not define "
            "as an M6.2 candidate evidence dimension. Columns the standard never asked for "
            "make the matrix look complete while a required one is missing",
            errors,
        )
    if missing or extra:
        return

    classified = _validate_every_msconvert_candidate_has_one_final_state(spike_text, errors)
    if classified is not None:
        _validate_the_msconvert_matrix_covers_every_candidate(classified, header, body, errors)

    outcomes = re.findall(r"\*\*Route outcome: `([A-Z_][A-Z0-9_]*)`\.\*\*", spike_text)
    if len(outcomes) != 1:
        fail(
            f"{M62_SPIKE} declares {len(outcomes)} route outcomes, not 1. The evidence record "
            "is where the measurement lives, so it states exactly one answer",
            errors,
        )
    elif outcomes[0] not in M62_ROUTE_OUTCOMES:
        fail(
            f"{M62_SPIKE} declares route outcome `{outcomes[0]}`, which is not one of the "
            f"{len(M62_ROUTE_OUTCOMES)} M6.2 defines ("
            + ", ".join(f"`{name}`" for name in sorted(M62_ROUTE_OUTCOMES))
            + "). A token that resembles an outcome is not one",
            errors,
        )

    # The conditional obligation has exactly two honest dispositions, and
    # "pending" is neither.
    side_output = _section(spike_text, "### Working-directory side output")
    if side_output is None:
        fail(
            f"{M62_SPIKE} has no `### Working-directory side output` section. The non-mzML "
            "side-output question is owed a disposition -- measured, or not triggered with "
            "its reason -- and a record that omits the section states neither",
            errors,
        )
    else:
        declared = sorted(
            name for name in M62_SIDE_OUTPUT_DISPOSITIONS if name in side_output
        )
        if len(declared) != 1:
            fail(
                f"{M62_SPIKE}: the working-directory side-output section declares "
                f"{len(declared)} of the {len(M62_SIDE_OUTPUT_DISPOSITIONS)} dispositions it "
                "may end in ("
                + ", ".join(f"`{name}`" for name in sorted(M62_SIDE_OUTPUT_DISPOSITIONS))
                + "). The obligation is conditional on a non-mzML format still being a viable "
                "admission candidate, and which of those held is the whole content of the "
                "answer -- prose that merely discusses whether it was triggered is the one "
                "ending it rules out",
                errors,
            )



def validate_the_m610_side_routes_are_all_terminal(errors: list[str]) -> None:
    """Four conditional routes, each ending in a state criterion 11 accepts.

    Exit criterion 11 is the one place in M6 where the obligation is to *answer*
    rather than to admit. It passes when the closed set of four routes is
    completely dispositioned and not before, so what has to be guarded is not
    which answer a route reached but that it reached one at all -- and that the
    word it reached is a terminal one rather than a token that merely sounds
    like a decision.

    Four properties:

    1. The record exists, states exactly one route outcome, and carries the
       terminal ledger as a table rather than as prose. A checker that cannot
       find the table fails; it does not pass quietly, which is the failure mode
       this whole family of guards was corrected for.
    2. The ledger's rows are exactly the four closed routes, once each.
    3. Every route's disposition is one of the three criterion 11 defines, and no
       route ends on `PENDING`, `DEFERRED_WITH_OWNER` or `NOT_TRIGGERED`.
    4. The two routes that inherit a named outcome still name it, so CNV-D1's
       and M5.4's vocabularies are mapped rather than replaced.

    Nothing here reads whether a disposition is *justified*. That a route was
    answered is structure; whether the evidence supports the answer stays a
    matter for review.
    """
    record_path = ROOT / M610_RECORD
    if not record_path.is_file():
        fail(
            f"{M610_RECORD} is missing. It is M6.10's owning ledger and the only place exit "
            "criterion 11 is answered from; without it four conditional routes are open and "
            "nothing says so",
            errors,
        )
        return
    _check_the_m610_ledger(record_path.read_text(encoding="utf-8"), errors)


def _check_the_m610_ledger(record_text: str, errors: list[str]) -> None:
    """The four properties above, over one record's text.

    Split from its caller so the proofs below can run it against copies that
    break it. A guard nobody has seen fail is not yet evidence of anything.
    """
    outcomes = re.findall(r"\*\*Route outcome: `([A-Z_][A-Z0-9_]*)`\.\*\*", record_text)
    if len(outcomes) != 1:
        fail(
            f"{M610_RECORD} declares {len(outcomes)} route outcomes, not 1. The record states "
            "exactly one answer for itself",
            errors,
        )
    elif outcomes[0] not in M610_ROUTE_OUTCOMES:
        fail(
            f"{M610_RECORD} declares route outcome `{outcomes[0]}`, which is not one M6.10 "
            "defines (" + ", ".join(f"`{name}`" for name in sorted(M610_ROUTE_OUTCOMES))
            + "). A token that resembles an outcome is not one",
            errors,
        )

    table = _first_markdown_table(record_text, "## The terminal ledger")
    if table is None:
        fail(
            f"{M610_RECORD} has no `## The terminal ledger` table. The dispositions are the "
            "record's whole content, and prose that discusses them is not a ledger",
            errors,
        )
        return
    header, body = _table_header_and_body(table)
    where = f"{M610_RECORD} terminal ledger"
    columns = {
        name: _column_index(header, name, where, errors)
        for name in ("Route", "Shipped availability today", "Disposition")
    }
    if any(index is None for index in columns.values()):
        return

    ragged = [row for row in body if len(row) != len(header)]
    if ragged:
        fail(
            f"{M610_RECORD}: {len(ragged)} row(s) of the terminal ledger have a cell count "
            f"the header's {len(header)} does not match. A ragged row shifts a route's "
            "disposition onto the wrong column",
            errors,
        )
        return

    listed = [_bare(row[columns["Route"]]) for row in body]
    if listed != list(M610_ROUTES):
        missing = sorted(set(M610_ROUTES) - set(listed))
        extra = sorted(set(listed) - set(M610_ROUTES))
        detail = []
        if missing:
            detail.append("omits " + ", ".join(repr(name) for name in missing))
        if extra:
            detail.append("adds " + ", ".join(repr(name) for name in extra))
        if not detail:
            detail.append("lists them in a different order")
        fail(
            f"{M610_RECORD}: the terminal ledger {'; '.join(detail)} against the closed set "
            "of four conditional routes. A route that leaves the ledger is a question the "
            "next milestone inherits without knowing it has",
            errors,
        )
        return

    for row in body:
        route = _bare(row[columns["Route"]])
        disposition = _bare(row[columns["Disposition"]])
        if disposition not in M610_DISPOSITIONS:
            opened = [name for name in M610_NON_TERMINAL if name in disposition]
            because = (
                f" `{opened[0]}` is not terminal; it is the ending criterion 11 exists to "
                "prevent."
                if opened
                else ""
            )
            fail(
                f"{M610_RECORD}: the route {route!r} ends {disposition!r}, which is not one "
                "of the three dispositions criterion 11 accepts ("
                + ", ".join(f"`{name}`" for name in sorted(M610_DISPOSITIONS))
                + f").{because} Reaching one is required; being admitted is not",
                errors,
            )
        if not _bare(row[columns["Shipped availability today"]]):
            fail(
                f"{M610_RECORD}: the route {route!r} states no shipped availability. A "
                "disposition and what the product actually offers are two facts, and a "
                "record that gives only the first invites the other to be inferred from it",
                errors,
            )

    dispositions = {_bare(row[columns["Route"]]): row for row in body}
    for route, named in M610_NAMED_OUTCOMES:
        row = dispositions.get(route)
        if row is not None and not any(named in cell for cell in row):
            fail(
                f"{M610_RECORD}: the route {route!r} does not name `{named}`, the outcome it "
                "already had. A criterion 11 disposition maps an existing named outcome; it "
                "does not replace it with a competing status",
                errors,
            )


# One mutation per decision the tooling claims to make, written as the smallest
# edit that would defeat it. Each is (name, before, after) against the M6.2
# record's text; the guard must report every one.
M62_RECORD_MUTATIONS: tuple[tuple[str, str, str], ...] = (
    (
        "a row names a fixture the case never converted",
        "| `X2` | format | `m62-multisource.mzML` |",
        "| `X2` | format | `m62-profile.mzML` |",
    ),
    (
        "a row states argv the case never ran",
        "| `P5` | precision | `m62-profile.mzML` | `--mz32` `--inten64` |",
        "| `P5` | precision | `m62-profile.mzML` | `--mz64` `--inten64` |",
    ),
    (
        "a row states an output name the case did not ask for",
        "| `X4` | format | `m62-profile.mzML` | `--mzXML` `--64` | mzXML | *backend-named* |",
        "| `X4` | format | `m62-profile.mzML` | `--mzXML` `--64` | mzXML | `out.mzXML` |",
    ),
    (
        "a failing case is recorded as a successful one",
        "exit 1, unterminated partial output |",
        "exit 0 |",
    ),
    (
        "a column the rows are compared on is renamed away",
        "| Case | Family | Fixture | Arguments between source and `--outdir` |",
        "| Case | Family | Source | Arguments between source and `--outdir` |",
    ),
)

# The same, against M6.10's own ledger.
M610_LEDGER_MUTATIONS: tuple[tuple[str, str, str], ...] = (
    (
        "a route ends on a token that is not terminal",
        "| **`REFUSED_WITH_EVIDENCE`** | CNV-D1's **`MZXML_REFUSED`** |",
        "| **`PENDING`** | CNV-D1's **`MZXML_REFUSED`** |",
    ),
    (
        "a route is deferred to an owner instead of answered",
        "| **`EVIDENCE_BLOCKED`** | — (criterion 11 vocabulary only) |",
        "| **`DEFERRED_WITH_OWNER`** | — (criterion 11 vocabulary only) |",
    ),
    (
        "a route's inherited named outcome is replaced by a competing status",
        "M5.4's **`XIC_SOURCE_REFUSED`**, retained",
        "**`XIC_ROUTE_CLOSED`**",
    ),
    (
        "the ledger stops saying what the product actually offers",
        "| **Unavailable.** `open_preview` refuses a non-previewable family with `dataset_not_previewable` before any backend runs |",
        "|  |",
    ),
    (
        "the ledger becomes prose",
        "## The terminal ledger",
        "## The terminal narrative",
    ),
)


def validate_the_evidence_tooling_detects_what_it_claims(errors: list[str]) -> None:
    """The M6.10 tooling is run against inputs it is supposed to refuse.

    Three checks are proved here, and the reason is the same for all of them:
    M6.2 shipped an inspector whose *silence* was mistaken for a certificate,
    and a guard that compared two of a case's seven fields while its own
    docstring described the ledger as checked. Neither failure was visible,
    because neither check had ever been seen to fail.

    So each decision is exercised against the smallest input that would defeat
    it -- a payload with a character outside the base64 alphabet, a spectrum
    missing a required array, a run-level count standing over the wrong number
    of elements, a case row stating a fixture or a posture the ledger does not,
    and a route ending on a word that is not terminal. This is a proof that the
    checks discriminate, not a competition to find bypasses: each mutation is
    one decision, and there is no reward for adding a sixth spelling of one that
    is already covered.

    The controls matter as much as the mutations. An unmodified document must
    pass, or a failure below would prove only that the copy was broken.
    """
    import struct
    import tempfile

    ledger = _msconvert_ledger(errors)
    if ledger is None:
        return

    # ---------------------------------------------------------- the inspector
    with tempfile.TemporaryDirectory(prefix="mscanvas-evidence-tooling-") as scratch:
        room = Path(scratch)
        try:
            ledger.generate(room / "fixtures")
        except Exception as error:  # noqa: BLE001 - a generator that cannot run is the finding
            fail(
                f"scripts/msconvert_evidence.py cannot generate its fixtures, so nothing "
                f"below proves anything about the inspector: {type(error).__name__}",
                errors,
            )
            return
        healthy = (room / "fixtures" / "m62-profile.mzML").read_text(encoding="utf-8")

        def defects_of(name: str, text: str) -> list[str] | None:
            target = room / f"{name}.mzML"
            target.write_text(text, encoding="utf-8", newline="")
            try:
                return list(ledger.inspect(target)["defects"])
            except Exception:  # noqa: BLE001 - a document that does not parse is a result
                return None

        control = defects_of("control", healthy)
        if control is None or control:
            fail(
                "the M6.2 inspector reports a defect in the fixture it generates itself, so "
                f"its refusals below prove nothing: {control}",
                errors,
            )
            return

        # Characters outside the base64 alphabet, inserted **four at a time** so
        # the payload's length stays a multiple of four. That is the isolating
        # mutation: one stray character is caught by the length rule instead, and
        # a proof that passed through the length rule would say nothing about
        # strict validation. Four are dropped silently by a non-validating
        # decoder, which returns the original bytes and reads as healthy -- the
        # exact case M6.2 recorded and could not detect.
        at = healthy.index("<binary>") + len("<binary>")
        stray = defects_of("stray", healthy[:at] + "$$$$" + healthy[at:])
        if not stray or not any("base64" in defect for defect in stray):
            fail(
                "the M6.2 inspector accepts a binary payload carrying a character outside "
                f"the base64 alphabet: {stray}. Discarding it silently is the gap M6.2 "
                "recorded and M6.10 owns",
                errors,
            )

        # A spectrum that carries only one of the two required arrays.
        one_array = re.sub(
            r" {10}<binaryDataArray encodedLength=.*?</binaryDataArray>\n",
            "",
            healthy,
            count=1,
            flags=re.S,
        )
        missing = defects_of("missing", one_array)
        if one_array == healthy:
            fail(
                "the M6.2 inspector proof cannot remove an array from the generated fixture, "
                "so the missing-array decision is unexercised",
                errors,
            )
        elif not missing or not any("carries no" in defect for defect in missing):
            fail(
                "the M6.2 inspector reports a spectrum missing a required array as healthy: "
                f"{missing}. No malformed flag and no length disagreement is exactly how M6.2 "
                "found it",
                errors,
            )

        # A run-level count standing over a different number of elements: the
        # mzML twin of the `msRun/@scanCount` misdeclaration `X2` writes.
        miscounted = defects_of(
            "miscounted", healthy.replace('<spectrumList count="4"', '<spectrumList count="7"', 1)
        )
        if not miscounted or not any("declares count=7" in defect for defect in miscounted):
            fail(
                "the M6.2 inspector does not report a run-level count standing over a "
                f"different number of spectrum elements: {miscounted}. A consumer trusting "
                "that count reads a short document as a complete conversion",
                errors,
            )

        # A declared per-spectrum length the stored arrays do not have.
        mislengthed = defects_of(
            "mislengthed", healthy.replace('defaultArrayLength="14"', 'defaultArrayLength="17"', 1)
        )
        if not mislengthed or not any("declares 17 values" in defect for defect in mislengthed):
            fail(
                "the M6.2 inspector does not report a spectrum declaring one length and "
                f"storing another: {mislengthed}",
                errors,
            )

        # The same run-level rule on the format it was written for. A small
        # hand-built document, because producing one needs the provider and this
        # check is about the reader.
        payload = base64_of(struct.pack(">2d", 300.0, 100.0))
        mzxml = (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<mzXML xmlns="http://sashimi.sourceforge.net/schema_revision/mzXML_3.2">\n'
            '  <msRun scanCount="4">\n'
            '    <scan num="1" msLevel="1" peaksCount="1" retentionTime="PT60S">\n'
            '      <peaks precision="64" byteOrder="network" contentType="m/z-int" '
            f'compressionType="none">{payload}</peaks>\n'
            "    </scan>\n"
            "  </msRun>\n"
            "</mzXML>\n"
        )
        target = room / "declared.mzXML"
        target.write_text(mzxml, encoding="utf-8", newline="")
        try:
            reported = list(ledger.inspect(target)["defects"])
        except Exception as error:  # noqa: BLE001
            reported = [f"<did not parse: {type(error).__name__}>"]
        if not any("scanCount=4" in defect for defect in reported):
            fail(
                "the M6.2 inspector does not read `msRun/@scanCount` beside the scan elements "
                f"actually written: {reported}. This is the exact misdeclaration `X2` produces, "
                "and the reason its drop reproduced through the old harness while its hollow "
                "count did not",
                errors,
            )

    # ------------------------------------------- the ledger / record contract
    spike_path = ROOT / M62_SPIKE
    if spike_path.is_file():
        spike_text = spike_path.read_text(encoding="utf-8")
        declared = tuple(case.case for case in ledger.CASES)
        control = []
        _validate_the_record_carries_every_ledger_field(ledger, declared, spike_text, control)
        if control:
            fail(
                "the ledger/record contract fails against the unmodified record, so its "
                f"proofs below mean nothing: {control[0]}",
                errors,
            )
        else:
            for name, before, after in M62_RECORD_MUTATIONS:
                if spike_text.count(before) != 1:
                    fail(
                        f"the ledger/record contract cannot prove it detects '{name}': its "
                        f"anchor no longer appears exactly once in {M62_SPIKE}",
                        errors,
                    )
                    continue
                detected: list[str] = []
                _validate_the_record_carries_every_ledger_field(
                    ledger, declared, spike_text.replace(before, after), detected
                )
                if not detected:
                    fail(
                        f"the ledger/record contract does not detect '{name}'; a record may "
                        "therefore describe a measurement nothing performed",
                        errors,
                    )

    # -------------------------------------------------- the M6.10 disposition
    record_path = ROOT / M610_RECORD
    if record_path.is_file():
        record_text = record_path.read_text(encoding="utf-8")
        control = []
        _check_the_m610_ledger(record_text, control)
        if control:
            fail(
                "the M6.10 terminal-ledger guard fails against the unmodified record, so its "
                f"proofs below mean nothing: {control[0]}",
                errors,
            )
            return
        for name, before, after in M610_LEDGER_MUTATIONS:
            if record_text.count(before) != 1:
                fail(
                    f"the M6.10 terminal-ledger guard cannot prove it detects '{name}': its "
                    f"anchor no longer appears exactly once in {M610_RECORD}",
                    errors,
                )
                continue
            detected = []
            _check_the_m610_ledger(record_text.replace(before, after), detected)
            if not detected:
                fail(
                    f"the M6.10 terminal-ledger guard does not detect '{name}'; a route could "
                    "therefore be left open while the record reads as closed",
                    errors,
                )


def base64_of(payload: bytes) -> str:
    """Standard base64, for the small documents the proofs above hand-build."""
    import base64

    return base64.b64encode(payload).decode("ascii")

def _validate_the_msconvert_route_acceptance_is_current(
    route_text: str, errors: list[str]
) -> None:
    """The two corrections M6.0 handed M6.2, held closed."""
    if M62_STALE_ACCEPTANCE in route_text:
        fail(
            f"{M62_ROUTE}: the M6.2 acceptance requires "
            f"{M62_STALE_ACCEPTANCE!r} again. It counted two outstanding gates where there "
            "were none: what `msconvert` does to an existing output is not a candidate and "
            "authorizes no product decision, and the side-output question was measured on "
            "2026-08-07 and 2026-08-10. Only the non-mzML half survives, and only "
            "conditionally",
            errors,
        )
    section = _section(route_text, "### M6.2 — `msconvert` capability and evidence")
    if section is None:
        fail(
            f"{M62_ROUTE} has no `### M6.2` slice section, so its candidate list and "
            "acceptance cannot be checked",
            errors,
        )
        return
    # The candidate sentence itself, not the section. The section will always
    # mention precision -- the paragraph explaining why it was missing is right
    # underneath -- so a section-wide search would pass over the exact deletion
    # this guard exists for.
    marker = "Candidates are the settings M6 might admit:"
    at = section.find(marker)
    listed = "" if at < 0 else section[at : section.find("\n\n", at)]
    if at < 0:
        fail(
            f"{M62_ROUTE}: the M6.2 slice no longer states which settings M6 might admit. "
            "That sentence is the finite inventory the evidence record is checked against",
            errors,
        )
    elif "precision" not in listed.lower():
        fail(
            f"{M62_ROUTE}: the M6.2 slice's candidate list no longer names numeric "
            "precision. It was missing once already, and the consequence is not cosmetic: "
            "CNV-D2 makes precision a separate and prior decision from compression, so a "
            "list without it lets M6.3 type an intent whose precision half nobody measured",
            errors,
        )


def _validate_every_msconvert_candidate_has_one_final_state(
    spike_text: str, errors: list[str]
) -> set[str] | None:
    """Every declared candidate is classified once, in a state M6.2 defines.

    Inventory and classification are held equal as sets, so a candidate cannot
    leave the record while its measurements stay, and one cannot appear that
    nothing measured. Precision is additionally required by name, because that
    is the omission this guard exists for.
    """
    inventory = _first_markdown_table(spike_text, "## Live candidate inventory")
    if inventory is None:
        fail(
            f"{M62_SPIKE} has no `## Live candidate inventory` table. It is the record of "
            "what the measured build declares, and the classification is checked against it",
            errors,
        )
        return None
    inventory_header, inventory_rows = _table_header_and_body(inventory)
    at = _column_index(
        inventory_header, "Candidate", f"{M62_SPIKE} live candidate inventory", errors
    )
    if at is None:
        return None
    declared = [_bare(row[at]) for row in inventory_rows if len(row) > at]
    if len(declared) != len(inventory_rows) or not all(declared):
        fail(
            f"{M62_SPIKE}: the live candidate inventory has a row with no candidate. A row "
            "that names nothing cannot be classified",
            errors,
        )
        return None
    repeated = sorted({value for value in declared if declared.count(value) > 1})
    if repeated:
        fail(
            f"{M62_SPIKE}: the live candidate inventory declares "
            f"{', '.join(repr(value) for value in repeated)} more than once. A candidate "
            "named twice is two candidates or none",
            errors,
        )
        return None

    # The M6.0 omission, guarded by name. Three because the route requires the
    # provider's no-flag default *and* the explicit modes, and because the
    # default treats m/z and intensity differently -- one row could not carry
    # that.
    precision = [name for name in declared if "precision" in name.lower()]
    if len(precision) < 3:
        fail(
            f"{M62_SPIKE}: the live candidate inventory names {len(precision)} numeric "
            "precision candidate(s). M6.2 owes the provider's no-flag default and every "
            "explicit precision mode the installed grammar exposes, recorded separately for "
            "m/z and for intensity -- the default is mixed, and one row cannot say so",
            errors,
        )
        return None
    if not any("default" in name.lower() for name in precision):
        fail(
            f"{M62_SPIKE}: no numeric precision candidate names the provider's default. "
            "MSCanvas issues no precision flag, so the default is the semantic it actually "
            "ships, and an inventory of explicit modes alone measures everything except what "
            "the product does",
            errors,
        )
        return None
    forbidden = [name for name in declared if "overwrite" in name.lower()]
    if forbidden:
        fail(
            f"{M62_SPIKE}: the live candidate inventory declares "
            f"{', '.join(repr(value) for value in forbidden)}. What `msconvert` does to an "
            "existing output is not an M6.2 candidate: ADR 0009 sends the provider only into "
            "private staging and refuses before launch where the final target exists, so the "
            "provider never meets that file and the answer could not authorize CNV-D4",
            errors,
        )
        return None

    classification = _first_markdown_table(spike_text, "## Final classification")
    if classification is None:
        fail(
            f"{M62_SPIKE} has no `## Final classification` table. It is where a candidate's "
            "state is recorded, and the matrix's rows are checked against it",
            errors,
        )
        return None
    header, rows = _table_header_and_body(classification)
    where = f"{M62_SPIKE} final classification"
    columns = {
        name: _column_index(header, name, where, errors)
        for name in ("Candidate", "State", "Basis")
    }
    if any(index is None for index in columns.values()):
        return None
    ragged = [row for row in rows if len(row) != len(header)]
    if ragged:
        fail(
            f"{M62_SPIKE}: {len(ragged)} row(s) of the final classification have a cell count "
            f"the header's {len(header)} does not match. A ragged row shifts a candidate's "
            "state onto the wrong column",
            errors,
        )
        return None
    blank = [
        (_bare(row[columns["Candidate"]]) or "<unnamed>", name)
        for row in rows
        for name in ("Candidate", "State", "Basis")
        if not row[columns[name]].strip()
    ]
    if blank:
        fail(
            f"{M62_SPIKE}: the final classification leaves "
            + ", ".join(f"{candidate} without a {name}" for candidate, name in blank)
            + ". A candidate is classified by naming it, its state, and why",
            errors,
        )
        return None

    classified = [_bare(row[columns["Candidate"]]) for row in rows]
    repeated = sorted({value for value in classified if classified.count(value) > 1})
    if repeated:
        fail(
            f"{M62_SPIKE}: the final classification lists "
            f"{', '.join(repr(value) for value in repeated)} more than once. A candidate with "
            "two states has no state",
            errors,
        )
        return None

    states = {_bare(row[columns["Candidate"]]): _bare(row[columns["State"]]) for row in rows}
    invalid = sorted(
        (candidate, state)
        for candidate, state in states.items()
        if state not in M62_CANDIDATE_FINAL_STATES
    )
    if invalid:
        fail(
            f"{M62_SPIKE}: the final classification ends "
            + ", ".join(f"{candidate} in `{state}`" for candidate, state in invalid)
            + f", which is not one of the {len(M62_CANDIDATE_FINAL_STATES)} states an M6.2 "
            "candidate may end in ("
            + ", ".join(f"`{name}`" for name in sorted(M62_CANDIDATE_FINAL_STATES))
            + "). A capability candidate has no signature-only exit: an option that parses "
            "has established nothing about what it did",
            errors,
        )
        return None

    unclassified = sorted(set(declared) - set(classified))
    if unclassified:
        fail(
            f"{M62_SPIKE}: the live candidate inventory declares "
            f"{', '.join(repr(value) for value in unclassified)} with no final "
            "classification. A candidate left in no state is exactly what "
            "`EVIDENCE_BLOCKED` exists to avoid having to fake",
            errors,
        )
        return None
    undeclared = sorted(set(classified) - set(declared))
    if undeclared:
        fail(
            f"{M62_SPIKE}: the final classification records "
            f"{', '.join(repr(value) for value in undeclared)}, which the live candidate "
            "inventory does not declare. A state for something the build never declared is a "
            "claim about an option that is not there",
            errors,
        )
        return None
    return set(classified)


def _validate_the_msconvert_matrix_covers_every_candidate(
    classified: set[str],
    header: list[str],
    body: list[list[str]],
    errors: list[str],
) -> None:
    """The matrix's rows are the candidates the classification records.

    Every one of them, with no signature-only exemption: an M6.2 candidate is
    answered across the standard whatever state it ends in, because
    `EVIDENCE_BLOCKED` is a conclusion about a measurement and still owes the
    dimensions it could answer.
    """
    rows = [_bare(row[0]) for row in body if row]
    if not rows or not all(rows):
        fail(
            f"{M62_SPIKE}: the candidate-standard matrix has a row that names no candidate. "
            "A row for nothing answers nothing",
            errors,
        )
        return
    duplicated = sorted({value for value in rows if rows.count(value) > 1})
    if duplicated:
        fail(
            f"{M62_SPIKE}: the candidate-standard matrix has "
            f"{', '.join(repr(value) for value in duplicated)} in more than one row. Two rows "
            "for one candidate are two answers with nothing deciding between them",
            errors,
        )
        return

    absent = sorted(classified - set(rows))
    if absent:
        fail(
            f"{M62_SPIKE}: the candidate-standard matrix has no row for "
            f"{', '.join(repr(value) for value in absent)}, which the final classification "
            "records. A classified candidate that leaves the matrix takes its unanswered "
            "dimensions with it, and the column count still looks right",
            errors,
        )
    unclassified = sorted(set(rows) - classified)
    if unclassified:
        fail(
            f"{M62_SPIKE}: the candidate-standard matrix has a row for "
            f"{', '.join(repr(value) for value in unclassified)}, which the final "
            "classification does not record. A row nothing classified is a claim the evidence "
            "does not carry",
            errors,
        )
    if absent or unclassified:
        return

    for row in body:
        if len(row) != len(header):
            fail(
                f"{M62_SPIKE}: the candidate-standard matrix row {row[0]!r} has {len(row)} "
                f"cells where the header has {len(header)}. A ragged row silently shifts "
                "every answer after the gap onto the wrong dimension",
                errors,
            )
            return
    dimensions = [_bare(cell) for cell in header[1:]]
    blank = [
        (_bare(row[0]), dimensions[position])
        for row in body
        for position, cell in enumerate(row[1:])
        if not cell.strip()
    ]
    if blank:
        fail(
            f"{M62_SPIKE}: the candidate-standard matrix leaves "
            + ", ".join(f"{candidate} on {dimension!r}" for candidate, dimension in blank)
            + " unanswered. Every candidate is answered on every required dimension, as a "
            "located result or an explicit `NOT_APPLICABLE` with its reason",
            errors,
        )


def _section(text: str, heading: str) -> str | None:
    """One `##` section of a markdown document, heading included."""
    start = text.find(heading)
    if start < 0:
        return None
    after = text.find("\n## ", start + len(heading))
    return text[start:] if after < 0 else text[start:after]


def _status_claims_about(text: str, slice_name: str) -> list[tuple[int, str]]:
    """Where a status document states one slice's own outcome.

    Two shapes, which is what these documents actually use: a `## <slice>`
    section in the append-only log, and a top-level bullet opening with the
    slice's name in the roadmap's status and slice lists.

    A bullet is collected with its continuation lines rather than as a
    paragraph, because a markdown list separated by no blank lines is a single
    paragraph and the outcome routinely sits on a bullet's second line.
    """
    found: list[tuple[int, str]] = []
    lines = text.split("\n")
    starts = (f"- {slice_name}", f"- **{slice_name}")
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith(f"## {slice_name}"):
            end = index + 1
            while end < len(lines) and not lines[end].startswith("## "):
                end += 1
            found.append((index + 1, "\n".join(lines[index:end])))
            index = end
            continue
        if line.startswith(starts):
            end = index + 1
            # Continuation lines are indented; a new bullet or a blank line ends
            # this one.
            while end < len(lines) and lines[end].startswith(" "):
                end += 1
            found.append((index + 1, "\n".join(lines[index:end])))
            index = end
            continue
        index += 1
    return found


def validate_current_status_documents_describe_the_shipped_product(
    errors: list[str],
) -> None:
    """A capability that ships is not still listed among what the product lacks.

    This is the one class of document that goes wrong silently. Nothing fails to
    compile when a milestone lands and a summary describing it as future is left
    alone, and the reader who is hurt by it is the one planning the next slice
    from exactly those sections. M5.2 hit it: the roadmap closed the slice in one
    section while calling M5 "not started" a few lines above, and
    `FEATURE_CATALOG.md` still listed spectrum zoom and pan among what the viewer
    does not do.

    Two rules, and both are narrow on purpose. A shipped capability may not
    appear inside a paragraph that begins by naming what is missing. And the
    milestone's own summary may not call itself unstarted while its slices are
    recorded complete -- checked against the roadmap's M5 section, which is where
    that contradiction was.

    **M6.8 is the second instance, and it widened the scan.** `README.md` listed
    "cancelling one item of a queue while the rest carry on" among what is not
    implemented in the same slice that implemented it. The scan also read only
    the *first* occurrence of each opening in a document, so a page that says
    what is missing in two places was checked in one — and the second list is
    exactly where a sentence survives the milestone that fixed the first.

    Nothing here reads prose for tone, and nothing pins a snapshot of it.
    """
    for name in CURRENT_STATUS_DOCUMENTS:
        source = ROOT / name
        if not source.is_file():
            continue
        text = source.read_text(encoding="utf-8").lower()
        for opening in MISSING_LIST_OPENINGS:
            at = text.find(opening)
            while at != -1:
                end = text.find("\n\n", at)
                listed = text[at:] if end == -1 else text[at:end]
                for capability, why in SHIPPED_CAPABILITIES:
                    if capability in listed:
                        fail(
                            f"{name}:{text.count(chr(10), 0, at) + 1} {opening!r} still "
                            f"lists {capability!r}, which is implemented -- {why}. A "
                            "reader planning the next slice from this section would "
                            "treat finished behaviour as outstanding",
                            errors,
                        )
                at = text.find(opening, at + len(opening))

    roadmap = ROOT / "ROADMAP.md"
    if not roadmap.is_file():
        return
    text = roadmap.read_text(encoding="utf-8")
    heading = "## M5 — Viewer Completion"
    at = text.find(heading)
    if at == -1:
        return
    end = text.find("\n## ", at + len(heading))
    section = text[at:] if end == -1 else text[at:end]
    if "Not started" in section and "M5.2 — **complete**" in section:
        fail(
            "ROADMAP.md: the M5 section records M5.2 as complete and also calls the "
            "milestone not started. A status document that answers the same question "
            "both ways cannot be the basis for the next slice",
            errors,
        )



# The one place a confirmed process tree may be decided, and the one place the
# vocabulary that expresses it may be defined. Both are checked to exist rather
# than assumed, so a rename that moved them somewhere else fails here instead of
# silently disabling this validator.
CLAIM_ORIGIN = "crates/proteowizard/src/process.rs"
CLAIM_VOCABULARY = "crates/proteowizard/src/conversion_run.rs"
CLAIM_WIRE = "apps/desktop/src/features/mzml-preview/contracts.ts"
CLAIM_DISPOSITIONS = ("none_launched", "confirmed_gone", "unconfirmed")
# The boolean this milestone removed. It answered `true` both for a tree that
# was confirmed gone and for a run that launched nothing, so a reader given only
# `true` could not tell a claim about a process that existed from a statement
# that none did.
RETIRED_CLAIM_SPELLINGS = ("tree_termination_confirmed", "treeTerminationConfirmed")

# The two members that carry the affirmative claim, by their bare names.
#
# Matched as bare identifiers rather than as qualified paths, because a
# qualified path is the one spelling an import removes. `use ... as Alias`,
# `use ...::{Member}` and `use ...::Member as Other` all put the member behind
# a name a path check cannot follow — and every one of them still has to write
# the member's own name on the `use` line to get it.
# The members that carry the claim, and where each may not be named.
#
# `ConfirmedGone` is the claim itself. It is `non_exhaustive`, so the compiler
# already refuses it outside the crate that decides it; this covers that crate,
# where the compiler cannot.
#
# `EstablishedBeforeExecution` is an *input* to the derivation rather than the
# claim, and the crate that owns the launch path states it in the launch path
# and models it in its own fixtures. What must not happen is a consumer stating
# it, because a consumer that can state when ownership began can feed the
# derivation a run that did not earn its answer.
CLAIM_MEMBERS = (
    ("ConfirmedGone", ("crates/**/*.rs", "apps/desktop/src-tauri/src/**/*.rs")),
    (
        "EstablishedBeforeExecution",
        ("crates/**/*.rs", "apps/desktop/src-tauri/src/**/*.rs"),
    ),
)

# The one call that mints the affirmative member from a run.
#
# `ProcessOutput` is the report a `ProcessRunner` returns, so every consumer
# that substitutes a runner must be able to build one — which means a consumer
# can build one that did not happen and hand it to the derivation. The
# compiler cannot tell those apart and neither can a type. What it can be is
# *contained*: only the boundary that supervises a real process may ask.
CLAIM_DERIVATION = "OwnedTreeDisposition::of"
# The type itself, under any spelling a file can give it. A file that never
# names it cannot be deriving from it, and one that does is asked about every
# `of` call it makes.
CLAIM_VOCABULARY_TYPE = "OwnedTreeDisposition"
# Every name a file can reach the type by: the type itself, an import renamed
# with `as`, and a local type alias. Matching a qualified path saw only the
# first, which is the one spelling an import removes -- a reviewer derived the
# disposition through `use ... as Disposition` and the rule did not see it.
# Matching *any* `X::of(` instead would be wrong the other way: this repository
# has several unrelated `of` constructors.
_DERIVATION_ALIASES = (
    re.compile(r"\bOwnedTreeDisposition\s+as\s+([A-Za-z_][A-Za-z0-9_]*)"),
    re.compile(
        r"\btype\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[A-Za-z0-9_:]*OwnedTreeDisposition\s*;"
    ),
)


_DERIVATION_NAMES: dict[Path, frozenset[str]] = {}


def _derivation_names(root: Path) -> frozenset[str]:
    """Every name `OwnedTreeDisposition::of` can be written under, crate-wide.

    Computed over every Rust source rather than per file, because a re-export
    renames the type somewhere else entirely: `pub use ... as Judgement;` in a
    crate root lets a consumer write `Judgement::of(output)` in a file that
    never contains the original name at all.
    """
    cached = _DERIVATION_NAMES.get(root)
    if cached is not None:
        return cached
    names = {CLAIM_VOCABULARY_TYPE}
    for glob in CLAIM_RUST_GLOBS:
        for path in sorted(root.glob(glob)):
            text = path.read_text(encoding="utf-8")
            for pattern in _DERIVATION_ALIASES:
                names.update(pattern.findall(text))
    frozen = frozenset(names)
    _DERIVATION_NAMES[root] = frozen
    return frozen


_UNICODE_ESCAPE = re.compile(r"\\u\{([0-9A-Fa-f]{1,6})\}")
_HEX_ESCAPE = re.compile(r"\\x([0-9A-Fa-f]{2})")


def _writes_the_identifier(line: str) -> bool:
    """Whether this line writes the claim's identifier, however it is spelled.

    Compared as a *value*. It was compared as the raw substring `"confirmed_gone"`,
    and Rust has several spellings of that same `&str` which contain no such
    text: `"confirmed_gon\\u{65}"`, a literal split by a line continuation, and
    `concat!("confirmed", "_gone")`. Each is the guard's own bypass proof in a
    different alphabet.
    """
    decoded = CONTINUATION_RE.sub("", line)
    decoded = _UNICODE_ESCAPE.sub(
        lambda found: chr(int(found.group(1), 16)), decoded
    )
    decoded = _HEX_ESCAPE.sub(lambda found: chr(int(found.group(1), 16)), decoded)
    # A `concat!` of adjacent pieces is one string to the compiler, so the
    # quotes and separators between them are not part of the value.
    joined = re.sub(r'"\s*,?\s*"', "", decoded)
    # Inside a literal, not anywhere on the line: `owned_tree_confirmed_gone`
    # is the conjunction's own name and says nothing on the wire.
    return any(
        CLAIM_STABLE_ID in literal
        for candidate in (decoded, joined)
        for literal in re.findall(r'"([^"]*)"', candidate)
    )


# Every entry point that returns the judgement from a `ProcessOutput`. The
# second is the `test-support` one added when the production derivation became
# `pub(crate)`; a rule that watched only `of` could not see a production caller
# reaching the test entry, and both PR Rust jobs compile with the feature on.
CLAIM_DERIVATION_ENTRIES = ("of", "of_supervised_run_for_test")


def _derivation_call(name: str) -> re.Pattern[str]:
    """A call to `of` on this name, however the path is written.

    Tolerant of the qualified-type form `<Path::Name>::of(..)` and of newlines
    inside the path, which is how two compiling spellings walked past a
    substring test on one stripped line.
    """
    entries = "|".join(re.escape(entry) for entry in CLAIM_DERIVATION_ENTRIES)
    return re.compile(
        r"\b" + re.escape(name) + r"\s*>?\s*::\s*(?:" + entries + r")\s*\("
    )
# The crate that creates the process and watches it end. Two lifecycles inside
# it derive the judgement, and both supervise a real run; nothing outside it may.
CLAIM_DERIVATION_SCOPE = "crates/proteowizard/src/"
# Where the claim travels once it leaves the type: the wire, the diagnostics
# payload and anything rendered. A string is not a member and no compiler
# refuses it, so the identifier itself is watched.
CLAIM_STABLE_ID = "confirmed_gone"

# Where a description of this claim can live. Every file that carries the
# vocabulary, the states derived from it, or the wire it crosses.
# Where a description of this claim can live. **Globs rather than a file list**,
# because a list is a snapshot: the version that named seven files could not see
# an item-state table in an ADR asserting a confirmed tree for a state also
# reached by a run that launched nothing, and could not see a user-facing label
# in a component. Documents are included because ADR 0043's own contract names
# documentation as a carrier of this claim.
CLAIM_DESCRIPTION_GLOBS = (
    "crates/proteowizard/src/**/*.rs",
    "apps/desktop/src-tauri/src/**/*.rs",
    # Recursive, and over the whole frontend source rather than one folder. The
    # reason globs replaced a file list was that a user-facing label lives in a
    # component; a non-recursive glob over one directory is the same snapshot
    # with a wider name.
    "apps/desktop/src/**/*.ts",
    "apps/desktop/src/**/*.tsx",
    "docs/architecture/adr/*.md",
    "docs/product/*.md",
    "docs/ux/*.md",
)

# What it means to assert, in prose, that a process tree which existed was
# observed gone.
CONFIRMED_TREE_PHRASES = (
    "tree confirmed gone",
    "tree was confirmed gone",
    "tree survived",
    "process tree confirmed",
    "owned process tree was confirmed",
    "with the process tree confirmed",
    "no process of the owned tree",
)
# What makes such a phrase admissible in a description that also covers the
# other sense: the reader is given both rather than one presented as the whole.
BOTH_SENSE_PHRASES = (
    "nothing was launched",
    "launched nothing",
    "none_launched",
    "no process was created",
    "never started one",
    "there was no tree",
)
# The few symbols whose meaning really is only the narrow claim, so a
# description of one may assert it without qualification.
#
# **An allowlist of what may claim, not a list of what must be checked.** The
# first version listed the sites to inspect, which is a snapshot: it passed
# while three other descriptions asserted a confirmed tree, one of them on a
# public API arm reached by a run that launched nothing. Inverting it makes a
# description that nobody thought about an error by default.
NARROW_CLAIM_SYMBOLS = (
    "ConfirmedGone",
    "confirms_a_terminated_tree",
    "owned_tree_confirmed_gone",
    "EstablishedBeforeExecution",
    "covers_every_descendant",
    "surviving_processes",
    "CancellationFailure",
    "NotTerminated",
)

# Everything the guard reads, and therefore everything a bypass proof has to be
# able to edit. The document globs are here because the description rule reads
# state tables in documents: without them the pristine copy held no markdown at
# all, every bypass proof passed, and deleting the document rule outright would
# have left the suite green. A rule the self-proof cannot exercise is a rule
# nothing is checking.
CLAIM_CODE_GLOBS = (
    "crates/**/*.rs",
    "apps/desktop/src-tauri/src/**/*.rs",
    "apps/desktop/src/**/*.ts",
    "apps/desktop/src/**/*.tsx",
    "e2e/**/*.ts",
)
CLAIM_SOURCE_GLOBS = CLAIM_CODE_GLOBS + (
    # The manifests, so a copy of these sources still knows which files Cargo
    # compiles as integration-test targets. Without them the bypass suite's
    # pristine tree reads a downstream consumer test as production code.
    "crates/*/Cargo.toml",
    "docs/architecture/adr/*.md",
    "docs/product/*.md",
    "docs/ux/*.md",
)
CLAIM_RUST_GLOBS = ("crates/**/*.rs", "apps/desktop/src-tauri/src/**/*.rs")


# A `#[cfg(test)]` attribute and the file module it declares. Attributes stack
# and a doc comment may sit between, so the declaration is looked for over the
# next few lines rather than only the next one.
_TEST_CFG = re.compile(r"^\s*#\[cfg\((?:all\()?\s*test\b")
_TEST_MODULE_DECLARATION = re.compile(
    r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)\s*;"
)
# The same declaration wherever it appears on a line, for counting how many
# times a module is declared at all. `r#service` is `service`; a reviewer used
# exactly that to keep a production module out of the plain-declaration set.
_ANY_MODULE_DECLARATION = re.compile(
    r"\bmod\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)\s*;"
)
# The two ways a file becomes part of the product without its name saying so.
_PATH_ATTRIBUTE = re.compile(r'#\[\s*path\s*=\s*"([^"]+)"\s*\]')
_INCLUDE = re.compile(r'\binclude!\s*\(\s*"([^"]+)"\s*\)')
_DECLARED_TEST_MODULES: dict[Path, frozenset[Path]] = {}
_PRODUCTION_MODULES: dict[Path, frozenset[Path]] = {}


def _declared_test_modules(root: Path) -> frozenset[Path]:
    """Every file the sources declare as compiled for tests only.

    A test source is one the crate *says* is a test source: some module writes
    `#[cfg(test)] mod <name>;` above it. Two simpler rules were both wrong, in
    opposite directions, and this one exists because of them.

    `"tests" in path.parts or path.stem == "tests"` took a directory name for
    the fact, so a production module at `preview/tests/forged.rs` was exempt for
    being called tests.

    Reading the file for `#[test]` or `#[cfg(test)]` was worse. Nearly every
    production module in this repository ends in an inline `#[cfg(test)] mod
    tests`, so that exemption covered `service.rs`, `conversion.rs` and
    `output_set.rs` — the files this guard exists to check — and eight of its
    own bypass proofs stopped being detected. A guard that exempts the boundary
    is not a guard, and the bypass suite is what said so.

    Only the *declaration* is read. A file that merely contains tests is still
    production if nothing declares it as a test module, and a `#[cfg(test)] mod
    hostile;` naming a file that does not exist exempts nothing.

    **And a module declared for production stays production, whatever else
    declares it.** The scan reads text, not syntax, so a raw string literal
    holding `#[cfg(test)]\nmod service;` reads as a declaration — a reviewer
    demonstrated exactly that, six lines in a file this guard already reads,
    exempting all 8,303 lines of `service.rs`. Every module that is compiled at
    all is declared somewhere without `#[cfg(test)]`, so subtracting the plain
    declarations answers it without parsing Rust: a file the crate builds into
    the product cannot become a test by being named again.
    """
    cached = _DECLARED_TEST_MODULES.get(root)
    if cached is not None:
        return cached
    declared: set[Path] = set()
    plain: set[Path] = set()
    for glob in CLAIM_RUST_GLOBS:
        for path in sorted(root.glob(glob)):
            # Read as code. A declaration written inside a raw string is not
            # a declaration, and a reviewer exempted all 8,303 lines of
            # `service.rs` by writing one there.
            source = path.read_text(encoding="utf-8")
            lines = _code_only(source.splitlines())
            owner = (
                path.parent
                if path.stem in ("mod", "lib", "main")
                else path.parent / path.stem
            )

            def files_for(name: str, owner: Path = owner) -> list[Path]:
                return [
                    candidate
                    for candidate in (owner / f"{name}.rs", owner / name / "mod.rs")
                    if candidate.is_file()
                ]

            # The attribute sits on its own line above the declaration, so
            # which declarations it covers is found first and the rest are the
            # plain ones. Reading each line on its own would have made every
            # `#[cfg(test)] mod tests;` its own plain declaration too, and the
            # subtraction below would then have cancelled every exemption.
            attributed: set[int] = set()
            for index, line in enumerate(lines):
                if _TEST_CFG.match(line) is None:
                    continue
                for offset, follower in enumerate(lines[index + 1 : index + 4]):
                    stripped = follower.strip()
                    if not stripped or stripped.startswith(("//", "#[")):
                        continue
                    if _TEST_MODULE_DECLARATION.match(follower) is not None:
                        attributed.add(index + 1 + offset)
                    break
            for index, line in enumerate(lines):
                found = _TEST_MODULE_DECLARATION.match(line)
                if found is None:
                    continue
                if index in attributed:
                    declared.update(files_for(found.group(1)))
                else:
                    # Declared without the attribute: this module is part of the
                    # product wherever else its name appears.
                    plain.update(files_for(found.group(1)))
            # And the same question asked over the file as one text, so a
            # declaration whose `mod` and whose name are on different lines
            # still counts as one. Matching per line meant `\s+` could not
            # cross a newline, and a reviewer split a declaration in two to keep
            # a production module out of this set. What is being decided is
            # whether a module is part of the product, and a shape nobody
            # anticipated must not answer "no".
            # A module compiled under a name the filesystem does not carry.
            # `files_for` resolves by convention, so `#[path = "forged.rs"] mod
            # forged_impl;` left `plain` empty while a `#[cfg(test)] mod
            # forged;` beside it exempted the very file the product compiles.
            # The same for `include!`, which has no module name at all.
            for reference in _PATH_ATTRIBUTE.findall(source) + _INCLUDE.findall(source):
                for base in (owner, path.parent):
                    candidate = base / reference
                    if candidate.is_file():
                        plain.add(candidate.resolve())
            joined = "\n".join(lines)
            for match in _ANY_MODULE_DECLARATION.finditer(joined):
                at = joined.count("\n", 0, match.start())
                # Governed by a `#[cfg(test)]` if one stands above it with
                # nothing but attributes and blank lines between -- comments are
                # already scrubbed to nothing.
                governed = at in attributed
                if not governed:
                    back = at - 1
                    while back >= 0 and back >= at - 3:
                        above = lines[back].strip()
                        if _TEST_CFG.match(lines[back]) is not None:
                            governed = True
                            break
                        if above and not above.startswith("#["):
                            break
                        back -= 1
                if not governed:
                    plain.update(files_for(match.group(1)))
    frozen = frozenset(
        {path for path in declared if path.resolve() not in plain} - plain
    )
    _DECLARED_TEST_MODULES[root] = frozen
    _PRODUCTION_MODULES[root] = frozenset(plain)
    return frozen


def _production_modules(root: Path) -> frozenset[Path]:
    """Resolved paths some file compiles into the product.

    Populated by `_declared_test_modules`, which is where the declarations are
    read. Asked separately because *both* test exemptions have to answer to it:
    a file is not a test because of where it sits if the crate also builds it.
    """
    if root not in _PRODUCTION_MODULES:
        _declared_test_modules(root)
    return _PRODUCTION_MODULES[root]


def _consume_string(line: str, index: int) -> tuple[int, bool]:
    """Walk an open ordinary string literal, saying whether it is still open.

    A `\\` at the end of a line continues the literal onto the next one, which
    is how `"\\` + newline + `#[cfg(test)]` reads as code to a scanner that
    forgets at the line break.
    """
    length = len(line)
    while index < length:
        if line[index] == "\\":
            if index + 1 >= length:
                # The line ends inside an escape: the literal continues.
                return length, True
            index += 2
            continue
        if line[index] == '"':
            return index + 1, False
        index += 1
    return length, True


def _code_only(lines: list[str]) -> list[str]:
    """Each line with its comments, strings, chars and raw strings removed.

    Brace counting has to be over code. A `{` inside a comment or a literal is
    not a body, and a reviewer opened a 160-line skip region over production
    `service.rs` with a single comment line reading ``// only `mod tests {`
    below needs this``. The same scrubbing is what makes a module declaration
    written inside a raw string stop being a declaration at all.

    Indentation and structure are preserved so the result lines up with the
    original line numbers; only the contents that are not code are dropped.
    """
    scrubbed: list[str] = []
    # Rust nests block comments, so a depth is required rather than a flag: the
    # first `*/` need not close the outer one, and a scanner that stops there
    # reads commented-out text as live source. `_rust_string_literals` in this
    # file already counts depth for the same reason; the claim guard's scanner
    # did not, and a reviewer armed a skip region with `/*/**/#[cfg(test)]*/`
    # on one line.
    comment_depth = 0
    # An ordinary string stays open across lines -- a `\` at the end of a line
    # continues it. Only raw strings carried state at first, so a literal
    # holding `#[cfg(test)]` on its own line forged both halves of the
    # declaration test at once.
    in_string = False
    raw_hashes: int | None = None
    for line in lines:
        kept: list[str] = []
        index = 0
        length = len(line)
        while index < length:
            if comment_depth > 0:
                if line.startswith("/*", index):
                    comment_depth += 1
                    index += 2
                elif line.startswith("*/", index):
                    comment_depth -= 1
                    index += 2
                else:
                    index += 1
                continue
            if raw_hashes is not None:
                closing = '"' + "#" * raw_hashes
                at = line.find(closing, index)
                if at == -1:
                    index = length
                else:
                    raw_hashes = None
                    index = at + len(closing)
                continue
            if in_string:
                index, in_string = _consume_string(line, index)
                continue
            if line.startswith("//", index):
                break
            if line.startswith("/*", index):
                comment_depth = 1
                index += 2
                continue
            character = line[index]
            if character == "r" and index + 1 < length and line[index + 1] in '#"':
                cursor = index + 1
                hashes = 0
                while cursor < length and line[cursor] == "#":
                    hashes += 1
                    cursor += 1
                if cursor < length and line[cursor] == '"':
                    raw_hashes = hashes
                    index = cursor + 1
                    continue
            if character == '"':
                index, in_string = _consume_string(line, index + 1)
                continue
            if character == "'":
                # A character literal, or a lifetime. A lifetime has no closing
                # quote, and dropping it would swallow the rest of the line.
                # The escape forms matter: `'\u{7b}'` holds a brace, and
                # stepping two characters past the backslash lands inside it.
                cursor = index + 1
                if cursor < length and line[cursor] == "\\":
                    cursor += 2
                    while cursor < length and line[cursor] != "'":
                        cursor += 1
                elif cursor < length:
                    cursor += 1
                if cursor < length and line[cursor] == "'":
                    index = cursor + 1
                    continue
                kept.append(character)
                index += 1
                continue
            kept.append(character)
            index += 1
        scrubbed.append("".join(kept))
    return scrubbed


_TEST_ONLY_LINES: dict[Path, frozenset[int]] = {}


def _test_only_lines(path: Path) -> frozenset[int]:
    """The line numbers a file compiles only for tests, by its own attributes.

    A file module is not the only place tests live. Most modules here end in an
    inline `#[cfg(test)] mod tests { .. }`, and the fixtures inside it build the
    `ProcessOutput` values the boundary would otherwise be the only source of.

    **Bounded by the matching brace, counted over code.** The left margin was
    the bound at first, on the argument that a brace inside a literal is always
    indented. It is not an argument that survives contact: a reviewer opened a
    160-line region over production `service.rs` with one comment line
    containing a brace. Comments and literals are scrubbed out first now, and
    the region ends where its own depth returns to zero rather than at the first
    left-margin `}`.

    **Whether the item opens a region at all is decided by the first terminator,
    not by the first brace.** An earlier version looked for `{` before it looked
    for `;`, so `#[cfg(test)] use a::{B, C};` — an ordinary braced import, and
    what rustfmt produces the moment a second name is imported — armed a region
    that ran to the next column-zero `}`. A reviewer demonstrated it against
    `service.rs`, where that one-line edit hid 158 lines of production code from
    rules 5, 6 and 7 at once. A statement that closes its own braces and ends in
    `;` is a statement; only an item still holding a brace open at the end of a
    line has a body.

    A `#[cfg(test)] mod tests;` opens no region here — it names another file, and
    `_declared_test_modules` is what reads that.

    Only column zero counts. A `#[cfg(test)]` on an indented helper leaves that
    helper checked. Nothing in this repository needs the wider exemption, and
    the narrower one is the one that can be justified from the text.
    """
    cached = _TEST_ONLY_LINES.get(path)
    if cached is not None:
        return cached
    lines = path.read_text(encoding="utf-8").splitlines()
    code = _code_only(lines)
    inside: set[int] = set()
    index = 0
    while index < len(code):
        # **The attribute is read as code too.** The brace counter was scrubbed
        # and this line was left raw, so `/*` `#[cfg(test)]` `*/` armed a region
        # from inside a block comment -- the same attack as the round before,
        # one line further up. And the scan starts *at* the attribute rather
        # than after it, because `#[cfg(test)] fn _t() {}` written on one line
        # would otherwise leave its own braces unread and take the next item's.
        if not code[index].startswith(("#[cfg(test)]", "#[cfg(all(test")):
            index += 1
            continue
        cursor = index
        depth = 0
        opened = False
        finished = False
        # Where the balancing brace sits on its line, so what follows it can be
        # looked at. A region is line-granular and a Rust item ends at a
        # *column*: everything written after the closing brace on the same line
        # is production code, and exempting the whole line handed it away. A
        # reviewer replaced one existing `}` with `} pub(super) const FORGED:
        # ... = ConfirmedGone;` and nothing read it.
        trailing = ""
        while cursor < len(code) and not finished:
            for position, character in enumerate(code[cursor]):
                if character == "{":
                    depth += 1
                    opened = True
                elif character == "}":
                    depth -= 1
                    if opened and depth == 0:
                        finished = True
                        trailing = code[cursor][position + 1 :]
                        break
                elif character == ";" and depth == 0 and not opened:
                    # A statement, not an item with a body. `#[cfg(test)] mod
                    # tests;` and `#[cfg(test)] use a::{B, C};` both end here.
                    finished = True
                    break
            if finished:
                break
            cursor += 1
        if not opened or cursor >= len(code):
            index += 1
            continue
        # The closing line is exempt only when the brace is the last code on it.
        last = cursor + 2 if trailing.strip() == "" else cursor + 1
        inside.update(range(index + 1, last))
        index = max(cursor, index) + 1
    frozen = frozenset(inside)
    _TEST_ONLY_LINES[path] = frozen
    return frozen


_MARKDOWN_ROW_CELL = re.compile(r"^\|([^|]*)\|")
_RUST_DECLARED_HEAD = re.compile(r"^[^(){}=,;]*")


def _defined_symbol(line: str, markdown: bool) -> str:
    """The name a description is a description *of*.

    A table row defines whatever its first cell names; a Rust item defines
    whatever stands before its parameters, body or initialiser. Reading the
    whole line instead let anything else on it -- a trailing comment, a
    parenthetical -- carry an exemption the definition had not earned.
    """
    if markdown:
        found = _MARKDOWN_ROW_CELL.match(line)
        return found.group(1) if found else ""
    return _RUST_DECLARED_HEAD.match(line.split("//")[0]).group(0)


def _is_integration_test_target(path: Path) -> bool:
    """Whether Cargo compiles this file as an integration test.

    `<crate>/tests/*.rs`, where `<crate>` is the directory holding `Cargo.toml`.
    That is Cargo's own target convention rather than a name chosen inside a
    source file, which is what keeps it out of the hole the path-based exemption
    used to have: `src/preview/tests/forged.rs` is a module of the library and
    is not matched here, because its crate root is two directories further up.

    An integration test links the crate as an external consumer, so it is
    exactly where the *consumer* half of the claim boundary has to be written.
    """
    parent = path.parent
    return (
        parent.name == "tests"
        and (parent.parent / "Cargo.toml").is_file()
        and (parent.parent / "src").is_dir()
    )


def _is_test_source(path: Path, root: Path) -> bool:
    """Whether this file exists to test the boundary rather than to be it.

    Negative fixtures have to be able to build a disposition production code may
    not, and a guard that refused them would be a guard against testing the
    claim at all. What makes a file one is the declaration that compiles it for
    tests only, which `_declared_test_modules` reads.
    """
    # The `#[path]` subtraction applies to both exemptions. It was written for
            # the declared-module one and the integration-test branch was placed
            # in front of it, so `#[path = "../tests/forged.rs"] mod forged;` in a
            # crate root compiled a `tests/` file into the library while the name
            # of its directory exempted it. A reviewer demonstrated it.
    if path.resolve() in _production_modules(root):
        return False
    return _is_integration_test_target(path) or path in _declared_test_modules(root)


def _check_the_cancellation_claim(root: Path, errors: list[str]) -> None:
    """The claim guard itself, against any tree.

    Taking the root as an argument is what lets the guard be proved: the
    bypasses below run it against copies that deliberately break it.
    """
    origin = root / CLAIM_ORIGIN
    vocabulary = root / CLAIM_VOCABULARY
    if not origin.is_file() or not vocabulary.is_file():
        errors.append(
            f"{CLAIM_ORIGIN} or {CLAIM_VOCABULARY} is missing; the cancellation "
            "claim guard cannot establish where the judgement is made"
        )
        return

    origin_text = origin.read_text(encoding="utf-8")
    vocabulary_text = vocabulary.read_text(encoding="utf-8")

    # 1. One conjunction, and it reads both halves.
    definitions = origin_text.count("fn owned_tree_confirmed_gone")
    if definitions != 1:
        errors.append(
            f"{CLAIM_ORIGIN} defines owned_tree_confirmed_gone {definitions} times; "
            "the claim that an owned process tree is gone has exactly one origin"
        )
    else:
        body = origin_text.partition("fn owned_tree_confirmed_gone")[2]
        body = body.split("\n    }", 1)[0]
        if "covers_every_descendant" not in body or "final_active_processes" not in body:
            errors.append(
                f"{CLAIM_ORIGIN} decides owned_tree_confirmed_gone without reading both "
                "an empty owned job and ownership established before execution; an empty "
                "job is an empty tree only where ownership preceded execution"
            )

    derivations = vocabulary_text.count("const fn of(output: &ProcessOutput)")
    if derivations != 1:
        errors.append(
            f"{CLAIM_VOCABULARY} derives OwnedTreeDisposition from a run {derivations} "
            "times; both conversion lifecycles must read one judgement rather than each "
            "deciding for itself"
        )

    # 2. Rule 6 below subsumes what a check over qualified paths could do here.
    #    It is written against bare member names across whole files, which is
    #    the only form an import cannot rewrite, so a narrower path check beside
    #    it would only be a second thing to keep in step.

    # 3. One vocabulary, agreed across the layers that carry it.
    #
    #    Read out of the vocabulary's own `stable_id` arms rather than by asking
    #    whether each expected identifier appears somewhere in the file. That
    #    filter could only ever produce a subset, so "the set differs" meant
    #    exactly "one is missing" and a *fourth* disposition the wire had never
    #    heard of would have passed — which is what a reviewer found when
    #    neutralising the comparison changed nothing.
    stable_id_arms = ""
    implementation = vocabulary_text.find("impl OwnedTreeDisposition {")
    if implementation == -1:
        errors.append(
            f"{CLAIM_VOCABULARY} has no `impl OwnedTreeDisposition`; the identifiers the "
            "claim travels as cannot be read"
        )
    else:
        opening = vocabulary_text.find("fn stable_id(", implementation)
        closing = vocabulary_text.find("\n    }", opening) if opening != -1 else -1
        if opening == -1 or closing == -1:
            errors.append(
                f"{CLAIM_VOCABULARY} no longer gives OwnedTreeDisposition a `stable_id`; "
                "the identifiers the claim travels as cannot be read"
            )
        else:
            stable_id_arms = vocabulary_text[opening:closing]
    rust_members = set(re.findall(r'=> "([A-Za-z0-9_]+)"', stable_id_arms))
    if rust_members != set(CLAIM_DISPOSITIONS):
        missing = ", ".join(sorted(set(CLAIM_DISPOSITIONS) - rust_members)) or "none"
        extra = ", ".join(sorted(rust_members - set(CLAIM_DISPOSITIONS))) or "none"
        errors.append(
            f"{CLAIM_VOCABULARY} publishes a different set of disposition identifiers "
            f"than the wire knows: missing {missing}, unexpected {extra}. The "
            "dispositions a stop can reach are a contract, not a convenience"
        )

    contract = root / CLAIM_WIRE
    if not contract.is_file():
        errors.append(
            f"{CLAIM_WIRE} is missing; the wire side of the cancellation claim "
            "cannot be checked"
        )
    else:
        contract_text = contract.read_text(encoding="utf-8")
        # The union's own members, read the way the Rust side is read. Filtering
        # a known list on both sides made this a comparison of two subsets of
        # one constant rather than of the layers against each other: a rename
        # carried out in step showed up here instead of at the rule that pins
        # the names, and a member either side invented alone could not show up
        # at all.
        wire_union = re.search(
            r"export type ConversionOwnedTreeDisposition\s*=(.*?);",
            contract_text,
            re.S,
        )
        wire_members = set(
            re.findall(r'"([A-Za-z0-9_]+)"', wire_union.group(1) if wire_union else "")
        )
        if wire_union is None:
            errors.append(
                f"{CLAIM_WIRE} no longer declares ConversionOwnedTreeDisposition as a "
                "union; the wire side of the claim cannot be read"
            )
        if wire_members != rust_members:
            errors.append(
                f"{CLAIM_WIRE} carries {sorted(wire_members)} where Rust publishes "
                f"{sorted(rust_members)}; a consumer that knows only some of the "
                "dispositions has re-created the conflation the three replaced"
            )

    # 5. Nothing may describe itself as a confirmed process tree unless that is
    #    all it means.
    #
    #    **An allowlist of what may claim, not a list of sites to inspect.** The
    #    first version listed six sites; it passed while three other
    #    descriptions asserted a confirmed tree, one of them on a public API arm
    #    reached by a run that launched nothing. Inverting it makes a
    #    description nobody thought about an error by default.
    #
    #    Prose is the fallible half of this guard and is written down as such.
    #    A synonym nobody listed still passes, which is why the affirmative
    #    member is `non_exhaustive` rather than merely watched: the compiler
    #    carries the claim, and this carries the wording.
    described_files = sorted(
        {
            candidate
            for glob in CLAIM_DESCRIPTION_GLOBS
            for candidate in root.glob(glob)
        }
    )
    if not described_files:
        errors.append(
            "the cancellation claim guard found no descriptions to read; its globs no "
            "longer match this repository"
        )
    for target in described_files:
        relative = target.relative_to(root).as_posix()
        # A test may describe the claim in order to assert it, and a test file
        # that could not would be a guard against testing the boundary.
        if ".test." in target.name or (
            target.suffix == ".rs" and _is_test_source(target, root)
        ):
            continue
        lines = target.read_text(encoding="utf-8").splitlines()
        markdown = relative.endswith(".md")
        block: list[str] = []
        block_at = 0
        for number, line in enumerate(lines, start=1):
            stripped = line.strip()
            # In a document the definitions are the state tables, and a table
            # row is read as a description of whatever its first cell names.
            #
            # **Prose is not read, deliberately.** The first version of this
            # rule read every line of every ADR and product document and
            # reported eleven hits. One was the defect it was written for — the
            # `cancelled` row of ADR 0015 asserting a confirmed process tree for
            # a state a run that launched nothing also reaches. The other ten
            # were prose doing what prose is for: an amendment quoting the
            # superseded sentence, a route contract *forbidding* the claim, and
            # a record of one measured run that did launch a process. A rule
            # satisfied only by rewording honest sentences trains the writer to
            # dodge it, so it reads the definitions and leaves the narrative.
            if markdown:
                if not stripped.startswith("|"):
                    continue
                # **The row alone, and no neighbours.** A window was read at
                # first, so that an amendment under a table could qualify the
                # row above it. What it actually did was let one row's honest
                # qualification exempt every row within three lines: with
                # `cancelled` naming both senses, a reviewer rewrote the
                # `notRun` and `cancellationFailed` rows beside it into
                # confirmed-tree claims and neither was detected. A definition
                # has to carry its own meaning, because a reader who quotes one
                # row quotes one row.
                described = " ".join(stripped.lower().split())
                block_at = number
            elif (
                stripped.startswith("///")
                or stripped.startswith("//")
                or stripped.startswith("*")
                # `#[doc = "..."]` renders as a doc comment and reads as one.
                # Collecting only the slash forms left the same claim sayable
                # in the same place under a different spelling.
                or stripped.startswith("#[doc")
            ):
                if not block:
                    block_at = number
                block.append(stripped.lstrip("/*").strip())
                continue
            elif not block:
                continue
            else:
                described = " ".join(" ".join(block).lower().split())
                block = []
            if not any(phrase in described for phrase in CONFIRMED_TREE_PHRASES):
                continue
            if any(phrase in described for phrase in BOTH_SENSE_PHRASES):
                continue
            # **Against the symbol being defined, not against the line.** It
            # was the whole line, so any mention anywhere exempted the
            # description above it: a reviewer appended `(\`surviving_processes\`:
            # none)` to a state-table row and `// contrast NotTerminated` to an
            # item, and both descriptions could then assert a confirmed tree.
            # What may claim is a symbol that *means* the narrow claim, so what
            # is read is the name, not its neighbours.
            #
            # Case-folded on both sides, because a row is lowercased before it
            # is read and half the allowlist is `CamelCase`.
            subject = _defined_symbol(stripped, markdown).lower()
            if any(symbol.lower() in subject for symbol in NARROW_CLAIM_SYMBOLS):
                continue
            asserted = next(
                phrase for phrase in CONFIRMED_TREE_PHRASES if phrase in described
            )
            errors.append(
                f"{relative}:{block_at} describes `{stripped[:60]}` as {asserted!r} without "
                "naming the other sense a stop can leave nothing running in; only a symbol "
                "that means the narrow claim alone may assert it"
            )

    # 6. The members that carry the claim may not be named outside the two files
    #    that own them, under any spelling.
    #
    #    Matched as bare identifiers, because a qualified path is the spelling
    #    an import removes: `use ... as Alias`, `use ...::{Member}` and
    #    `use ...::Member as Other` all defeat a path check, and every one of
    #    them still writes the member's own name on the `use` line.
    #
    #    Outside this crate the compiler already refuses `ConfirmedGone`. This
    #    covers the crate that defines it, and covers the ownership assertion,
    #    which is an ordinary constructible value.
    #
    #    **Every line of every file, with no attempt to skip test regions.** An
    #    earlier version walked each file to find `#[cfg(test)]` blocks and read
    #    only what was left; it twice turned out to be skipping production code
    #    instead, and a check that quietly stops reading is worse than one that
    #    reads too much. Whole files need no such walk: the only places that may
    #    legitimately name a member are the two that own it and files that are
    #    tests outright, and both are named rather than inferred.
    for member, scope in CLAIM_MEMBERS:
        for path in sorted(
            candidate for glob in scope for candidate in root.glob(glob)
        ):
            relative = path.relative_to(root).as_posix()
            if _is_test_source(path, root) or relative in (
                CLAIM_ORIGIN,
                CLAIM_VOCABULARY,
            ):
                continue
            test_only = _test_only_lines(path)
            for number, line in enumerate(
                path.read_text(encoding="utf-8").splitlines(), start=1
            ):
                stripped = line.strip()
                if stripped.startswith("//") or number in test_only:
                    continue
                if re.search(rf"\b{member}\b", stripped) is None:
                    continue
                errors.append(
                    f"{relative}:{number} names {member}; the members that carry the "
                    "claim belong to the boundary that decides them, and a caller "
                    "that can write one can assert a terminated process tree"
                )

    # 7. The claim's two remaining routes out of the type.
    #
    #    `ProcessOutput` is what a substituted runner returns, so every consumer
    #    can build one — including one that did not happen. No type can tell
    #    those apart, so the *asking* is contained instead: only the crate that
    #    creates and supervises the process may derive a disposition from one.
    #
    #    The scope is that crate rather than one file, because there are two
    #    lifecycles inside it — a single output and a set of them — and both
    #    supervise a real run. Naming one file would have been a snapshot that
    #    the multi-output lifecycle already contradicted. What the rule refuses
    #    is a *consumer* minting the judgement: the desktop crate substitutes
    #    backends, so a `ProcessOutput` reaching it need not have happened.
    #
    #    And once the judgement leaves the type it is a string. `owned_tree` is
    #    a `String` on the wire and in the diagnostics payload, and writing the
    #    identifier by hand is a claim no compiler refuses.
    for glob in CLAIM_RUST_GLOBS:
        for path in sorted(root.glob(glob)):
            relative = path.relative_to(root).as_posix()
            if _is_test_source(path, root):
                continue
            test_only = _test_only_lines(path)
            text = path.read_text(encoding="utf-8")
            # **Over the file, not line by line.** `<Type>::of(x)` and a path
            # split across two lines both compile and neither is a substring of
            # one stripped line -- the same class of evasion the module
            # declarations were repaired for a round earlier, applied to one
            # rule and not the other.
            for name in _derivation_names(root):
                for found in _derivation_call(name).finditer(text):
                    number = text.count("\n", 0, found.start()) + 1
                    if number in test_only or relative.startswith(
                        CLAIM_DERIVATION_SCOPE
                    ):
                        continue
                    errors.append(
                        f"{relative}:{number} derives a disposition from a run; only "
                        f"{CLAIM_DERIVATION_SCOPE} supervises one, and a consumer that can "
                        f"substitute a backend can build a "
                        f"{CLAIM_VOCABULARY_TYPE} input that did not happen"
                    )
            for number, line in enumerate(text.splitlines(), start=1):
                stripped = line.strip()
                if stripped.startswith("//") or number in test_only:
                    continue
                # Matched as a *call* rather than as a qualified path, for
                # the reason rule 6 gives about members: `use ... as Alias` is
                # the one spelling a path check cannot see, and a reviewer
                # derived the disposition through exactly that. Any `X::of(` in
                # a file that knows this type at all is the question, because
                # nothing else in this repository names an `of` constructor.
                if _writes_the_identifier(stripped) and relative != CLAIM_VOCABULARY:
                    errors.append(
                        f"{relative}:{number} writes the identifier {CLAIM_STABLE_ID!r}; the "
                        "claim leaves the type as a string, and a string written by hand is "
                        "a claim no compiler refuses"
                    )

    # 4. The retired boolean stays retired in code. Documents may quote it as
    #    history -- ADR 0017 and the M6.8 record both have to name the field
    #    that left in order to say it left -- so this rule reads code alone.
    for glob in CLAIM_CODE_GLOBS:
        for path in sorted(root.glob(glob)):
            relative = path.relative_to(root).as_posix()
            text = path.read_text(encoding="utf-8")
            for spelling in RETIRED_CLAIM_SPELLINGS:
                if spelling not in text:
                    continue
                for number, line in enumerate(text.splitlines(), start=1):
                    if spelling in line:
                        errors.append(
                            f"{relative}:{number} reintroduces {spelling}; it asserted a "
                            "terminated process tree for a run that never started one, "
                            "and the three-member disposition replaced it"
                        )


def validate_the_cancellation_claim_has_one_origin(errors: list[str]) -> None:
    """A confirmed process tree is decided once, and nothing else may assert it.

    The claim this guards is not a spelling. It is the assertion that every
    backend process a conversion owned is gone -- the one claim in this
    repository that is about the user's machine rather than about MSCanvas's own
    record-keeping. A stop that reports it wrongly invites the user to start
    more work beside a converter process nobody can account for.

    An earlier draft of the route named three sites and called them the list to
    check. That is the wrong instrument: the same semantic reaches item states,
    queue counts, cancellation facts, their mirrored wire fields, the
    diagnostics payload key and the session quarantine reason, so a slice could
    reword three of them, pass an enumerated check, and leave the rest asserting
    a confirmed tree. What follows is structural instead, and holds for a site
    nobody has written yet.

    Four properties:

    1. The conjunction that decides the claim is defined exactly once, at the
       process boundary, and it reads both halves -- an owned Job observed empty
       *and* ownership established before the backend executed. Either half
       alone is an observation, not the claim.
    2. `ConfirmedGone` -- the one member that asserts a terminated tree -- is
       constructed nowhere in production outside the vocabulary that derives it,
       and no production file outside the launch path states when ownership
       began. Producing the fail-closed member stays unrestricted: refusing to
       claim needs no permission.
    3. Every layer that carries the judgement carries all three members. A
       consumer that knows two of them has re-created the conflation this
       replaced, and the Rust identifiers and the TypeScript union are compared
       against each other rather than each against a copy of the list.
    4. The retired boolean does not come back in code.

    The guard is then proved against deliberate bypasses, because a check that
    has never been seen to fail is not yet evidence of anything.
    """
    _check_the_cancellation_claim(ROOT, errors)
    _validate_the_claim_guard_detects_bypasses(errors)


# Each bypass is a real way the claim could outgrow its evidence, written as the
# smallest edit that would do it. The guard must reject every one.
CLAIM_BYPASSES: tuple[tuple[str, str, str, str], ...] = (
    # The three import forms two independent reviewers demonstrated against an
    # earlier version of this guard, which matched a qualified path. A path is
    # the one spelling an import removes.
    (
        "the claim is reached under an alias",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::destination::admit_destination_root;",
        "use super::destination::admit_destination_root;\n"
        "use mscanvas_proteowizard::OwnedTreeDisposition as Disposition;\n"
        "const _FORGED: Disposition = Disposition::ConfirmedGone;",
    ),
    (
        "the claim is reached through a braced import",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::destination::admit_destination_root;",
        "use super::destination::admit_destination_root;\n"
        "use mscanvas_proteowizard::OwnedTreeDisposition::{ConfirmedGone};\n"
        "const _FORGED: mscanvas_proteowizard::OwnedTreeDisposition = ConfirmedGone;",
    ),
    (
        "ownership is stated through a braced import",
        "apps/desktop/src-tauri/src/preview/conversion.rs",
        "use super::backend::ConversionBackend;",
        "use super::backend::ConversionBackend;\n"
        "use mscanvas_proteowizard::TreeOwnership::{EstablishedBeforeExecution};\n"
        "const _CLAIMED: mscanvas_proteowizard::TreeOwnership = EstablishedBeforeExecution;",
    ),
    # A production claim hidden behind the file-based test-module idiom, which
    # an earlier version's line walk read as the start of a test region.
    (
        "a file-based test module hides a production claim",
        "apps/desktop/src-tauri/src/preview/conversion.rs",
        "use super::backend::ConversionBackend;",
        "#[cfg(test)]\nmod hostile;\n\n"
        "use super::backend::ConversionBackend;\n"
        "pub(super) const FORGED: mscanvas_proteowizard::OwnedTreeDisposition =\n"
        "    mscanvas_proteowizard::OwnedTreeDisposition::ConfirmedGone;",
    ),
    # The set-stop facts, which ADR 0043's audit baseline names and an earlier
    # site list did not contain.
    (
        "the set-stop facts are re-described as a confirmed tree",
        "crates/proteowizard/src/conversion_run/output_set.rs",
        "    /// A stop was requested and no backend process of this attempt survives.\n"
        "    ///\n"
        "    /// `owned_tree` says which of the two ways that is so, because \"nothing was\n"
        "    /// launched\" and \"a tree existed and is confirmed gone\" are different facts\n"
        "    /// and the queue must be able to report the one that happened.",
        "    /// A stop was requested and the owned process tree was confirmed gone.",
    ),
    (
        "a second producer asserts the claim",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "owned_tree: OwnedTreeDisposition::Unconfirmed,",
        "owned_tree: OwnedTreeDisposition::ConfirmedGone,",
    ),
    (
        "the conjunction drops its ownership half",
        CLAIM_ORIGIN,
        "self.tree_ownership.covers_every_descendant()\n            && matches!",
        "matches!",
    ),
    (
        "a second lifecycle derives the judgement for itself",
        CLAIM_VOCABULARY,
        "    pub(crate) const fn of(output: &ProcessOutput) -> Self {",
        "    pub(crate) const fn of(output: &ProcessOutput) -> Self { Self::ConfirmedGone }\n"
        "    pub(crate) const fn of(output: &ProcessOutput) -> Self {",
    ),
    (
        "a consumer knows only some of the dispositions",
        CLAIM_WIRE,
        '  | "unconfirmed";',
        "  ;",
    ),
    (
        "the retired boolean returns",
        CLAIM_WIRE,
        "  readonly ownedTree: ConversionOwnedTreeDisposition;",
        "  readonly treeTerminationConfirmed: boolean;",
    ),
    (
        "a both-sense description claims only a confirmed tree",
        "apps/desktop/src-tauri/src/preview/dto.rs",
        "    /// A stop settled this item and no backend process of it survives. No\n"
        "    /// output was finalized.\n"
        "    ///\n"
        "    /// **Two ways that is so, and this state is both**: a tree existed and was\n"
        "    /// confirmed gone, or nothing was launched for there to be one. The\n"
        "    /// cancellation facts' `ownedTree` says which. Describing this state as a\n"
        "    /// confirmed tree would claim one for a run that never started a process.\n"
        "    Cancelled,",
        "    /// The running conversion was stopped and its owned process tree was\n"
        "    /// confirmed gone. No output was finalized.\n"
        "    Cancelled,",
    ),
    (
        "the claim is reached through an import",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::destination::admit_destination_root;",
        "use super::destination::admit_destination_root;\n"
        "use mscanvas_proteowizard::OwnedTreeDisposition::ConfirmedGone;",
    ),
    # The two the delta review demonstrated against the closure itself.
    #
    # `<crate>/tests/*.rs` is a Cargo target convention, but `#[path]` in a crate
    # root can compile one of those files into the library — and the
    # integration-test exemption was placed in front of the subtraction written
    # to catch exactly that.
    (
        "a path attribute compiles an integration-test file into the library",
        "crates/proteowizard/src/lib.rs",
        "mod cancellation;",
        '#[path = "../tests/forged.rs"]\nmod forged;\nmod cancellation;',
        (
            "crates/proteowizard/tests/forged.rs",
            None,
            'pub const FORGED: &str = "confirmed_gone";\n',
        ),
    ),
    # The derivation gained a second entry name when the production one became
    # `pub(crate)`. A rule watching only `of` could not see a production caller
    # reaching the test entry, and both PR Rust jobs compile with the feature on.
    (
        "the derivation is reached through the test-support entry",
        "apps/desktop/src-tauri/src/preview/conversion.rs",
        "use super::backend::ConversionBackend;",
        "use super::backend::ConversionBackend;\n"
        "fn _forged(output: &mscanvas_proteowizard::ProcessOutput)\n"
        "    -> mscanvas_proteowizard::OwnedTreeDisposition {\n"
        "    mscanvas_proteowizard::OwnedTreeDisposition::of_supervised_run_for_test(output)\n"
        "}",
    ),
    # The three the eighth review demonstrated. The first is smaller than any
    # other proof here: one existing line changed, no line added.
    #
    # A region is line-granular and a Rust item ends at a *column*. Everything
    # written after the closing brace on the same line was exempt.
    (
        "a claim written after a region's closing brace",
        "apps/desktop/src-tauri/src/preview/conversion.rs",
        "    run_conversion(plan, &backend.capabilities, backend.runner)\n}",
        "    run_conversion(plan, &backend.capabilities, backend.runner)\n"
        "} pub(super) const FORGED: mscanvas_proteowizard::OwnedTreeDisposition = "
        "mscanvas_proteowizard::OwnedTreeDisposition::ConfirmedGone;",
    ),
    # A module the crate compiles under a name the filesystem does not carry.
    # `files_for` resolves by convention, so the plain-declaration subtraction
    # saw nothing and a `#[cfg(test)] mod` beside it exempted the file the
    # product actually builds.
    (
        "a path attribute compiles an exempted file into the product",
        "apps/desktop/src-tauri/src/preview/mod.rs",
        "pub mod service;",
        "#[cfg(test)]\nmod forged;\n"
        '#[path = "forged.rs"]\nmod forged_impl;\n'
        "pub mod service;",
        (
            "apps/desktop/src-tauri/src/preview/forged.rs",
            None,
            'pub(super) const FORGED: &str = "confirmed_gone";\n',
        ),
    ),
    # The identifier written as the same `&str` under an escape. Compared as raw
    # text, `"confirmed_gon\u{65}"` is not a substring of anything.
    (
        "the claim's identifier is written under an escape",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::destination::admit_destination_root;",
        "use super::destination::admit_destination_root;\n"
        'const _FORGED: &str = "confirmed_gon\\u{65}";',
    ),
    # The four the seventh review demonstrated. Each compiles, and each left the
    # guard passing.
    #
    # Rust nests block comments, so the first `*/` need not close the outer one.
    # The scanner stopped there and read commented-out text as live source --
    # the opposite direction from the scrubbing this file already gets right in
    # `_rust_string_literals`, and a whole region armed on one line.
    (
        "a nested block comment arms a skip region",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::destination::admit_destination_root;",
        "/*/**/#[cfg(test)]*/ fn _forged(o: &mscanvas_proteowizard::ProcessOutput) "
        '-> &\'static str { let _d = mscanvas_proteowizard::OwnedTreeDisposition::of(o); '
        '"confirmed_gone" }\n'
        "use super::destination::admit_destination_root;",
    ),
    # An ordinary string continued across a line break. Only raw strings carried
    # state, so a literal holding `#[cfg(test)]` on its own line forged the
    # attribute *and* kept the declaration out of the plain set at once --
    # aimed at a module no other proof anchors in, which is where the suite's
    # own coverage runs out.
    (
        "a continued string literal exempts an unanchored module",
        "crates/proteowizard/src/lib.rs",
        "mod cancellation;",
        '#[allow(dead_code)]\nconst _N: &str = "\\\n#[cfg(test)]";\nmod cancellation;',
        (
            "crates/proteowizard/src/cancellation.rs",
            "use crate::process::CancellationToken;",
            "use crate::process::CancellationToken;\n"
            'const _FORGED: &str = "confirmed_gone";',
        ),
    ),
    # The qualified-type spelling of a call, which is not a substring of the
    # unqualified one. Matching per stripped line could not see it; matching
    # over the file with a tolerant path can.
    (
        "the derivation is written in qualified-type form",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::conversion::conversion_source_kind;",
        "use super::conversion::conversion_source_kind;\n"
        "fn _forged(output: &mscanvas_proteowizard::ProcessOutput)\n"
        "    -> mscanvas_proteowizard::OwnedTreeDisposition {\n"
        "    <mscanvas_proteowizard::OwnedTreeDisposition>::of(output)\n"
        "}",
    ),
    # A narrow symbol mentioned anywhere on the line exempted the description
    # above it, so a state-table row could assert a confirmed tree by naming
    # one in passing. On a row no other proof anchors on.
    (
        "a symbol named in passing exempts a definition",
        "docs/architecture/adr/0015-user-visible-queue-stop.md",
        "| `notRun` | The queue never began it — no process, nothing created |",
        "| `notRun` | Stopped before it began, owned tree confirmed gone "
        "(`surviving_processes`: none) |",
    ),
    # The three the sixth review demonstrated. Each compiles, and each left the
    # guard passing.
    #
    # A `#[cfg(test)]` written inside a block comment. The brace counter was
    # scrubbed in round five and the line that *arms* a region was left raw, so
    # the same attack worked one line further up.
    (
        "a commented-out attribute arms a skip region",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::conversion::conversion_source_kind;",
        "/*\n#[cfg(test)]\n*/\n"
        "fn _forged(output: &mscanvas_proteowizard::ProcessOutput) -> &'static str {\n"
        "    let _disposition = mscanvas_proteowizard::OwnedTreeDisposition::of(output);\n"
        '    "confirmed_gone"\n'
        "}\n"
        "use super::conversion::conversion_source_kind;",
    ),
    # A declaration split across two lines. `\s+` cannot cross a newline in a
    # per-line match, so the plain-declaration subtraction did not see it and a
    # production module became a test module.
    (
        "a line-split declaration hides a production module",
        "apps/desktop/src-tauri/src/preview/mod.rs",
        "mod diagnostics;",
        "#[cfg(not(test))]\nmod\n    diagnostics;\n#[cfg(test)]\nmod diagnostics;",
        (
            "apps/desktop/src-tauri/src/preview/diagnostics.rs",
            "use super::conversion::{ValidationFacts, WorkspaceConversionReport};",
            "use super::conversion::{ValidationFacts, WorkspaceConversionReport};\n"
            'const _FORGED: &str = "confirmed_gone";',
        ),
    ),
    # The derivation reached under an alias, which is the one spelling a
    # qualified-path check cannot see -- the same lesson rule 6 already carried
    # about members, applied a round late to rule 7.
    (
        "the derivation is reached under an alias",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::destination::admit_destination_root;",
        "use super::destination::admit_destination_root;\n"
        "use mscanvas_proteowizard::OwnedTreeDisposition as Disposition;\n"
        "fn _forged(output: &mscanvas_proteowizard::ProcessOutput) -> Disposition {\n"
        "    Disposition::of(output)\n"
        "}",
    ),
    # The two the fifth review demonstrated, and the two rules it found nothing
    # was exercising.
    #
    # A comment containing a brace, between the attribute and the item it sits
    # on. The region walk counted braces over raw text, so this one line opened
    # a 160-line skip over production `service.rs`.
    (
        "a comment opens a skip region over production code",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "#[cfg(test)]\nuse mscanvas_proteowizard::ConflictPolicy;",
        "#[cfg(test)]\n// only `mod tests {` below needs this\n"
        "use mscanvas_proteowizard::ConflictPolicy;\n"
        'const _FORGED: &str = "confirmed_gone";',
    ),
    # A raw identifier. `mod r#service;` declares the same module the product
    # compiles, so subtracting plainly-declared modules missed it and the
    # string-literal declaration exempted the file again.
    (
        "a raw identifier hides a production module declaration",
        "apps/desktop/src-tauri/src/preview/mod.rs",
        "pub mod service;",
        '#[allow(dead_code)]\nconst _N: &str = r#"\n#[cfg(test)]\nmod service;\n"#;\n'
        "pub mod r#service;",
        (
            "apps/desktop/src-tauri/src/preview/service.rs",
            "use super::conversion::conversion_source_kind;",
            "use super::conversion::conversion_source_kind;\n"
            'const _FORGED: &str = "confirmed_gone";',
        ),
    ),
    # The conjunction defined twice. This is the guard's headline property and
    # nothing exercised it: neutralising the count left every proof green.
    (
        "the conjunction is defined a second time",
        CLAIM_ORIGIN,
        "    pub const fn owned_tree_confirmed_gone(&self) -> bool {",
        # The copy reads both halves, so the conjunction rule is satisfied by
        # it and only the count can refuse. A copy that read one half would
        # have proved the other rule instead.
        "    pub const fn owned_tree_confirmed_gone(&self) -> bool {\n"
        "        self.tree_ownership.covers_every_descendant()\n"
        "            && matches!(self.final_active_processes, Some(0))\n"
        "    }\n"
        "    pub const fn owned_tree_confirmed_gone(&self) -> bool {",
    ),
    # The Rust vocabulary and the wire union disagreeing. The existing wire
    # bypass edits the TypeScript side and is caught by a different rule, so
    # this one moves the Rust side instead.
    # A rename carried out on *both* sides. The two layers still agree with each
    # other, so the cross-comparison is satisfied and only the check against the
    # vocabulary this repository fixed can refuse it. Changing one side alone
    # would have proved the cross-comparison instead, which is already proved.
    (
        "both layers rename a disposition in step",
        CLAIM_VOCABULARY,
        '            Self::Unconfirmed => "unconfirmed",',
        '            Self::Unconfirmed => "undetermined",',
        (
            CLAIM_WIRE,
            '  | "unconfirmed";',
            '  | "undetermined";',
        ),
    ),
    # The two the fourth review demonstrated, each as the edit that won.
    #
    # A braced import under `#[cfg(test)]` -- what rustfmt writes the moment a
    # second name is imported -- armed a skip region that ran to the next
    # left-margin `}`, hiding 158 lines of production `service.rs` from three
    # rules at once.
    (
        "a braced test import arms a region over production code",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "#[cfg(test)]\nuse mscanvas_proteowizard::ConflictPolicy;",
        "#[cfg(test)]\nuse mscanvas_proteowizard::{ConflictPolicy, OpenFormat};\n"
        "const _FORGED: mscanvas_proteowizard::OwnedTreeDisposition =\n"
        "    mscanvas_proteowizard::OwnedTreeDisposition::ConfirmedGone;",
    ),
    # And a module declaration written inside a raw string, which made the
    # whole of production `service.rs` a test source.
    (
        "a module declaration inside a string exempts a production file",
        "apps/desktop/src-tauri/src/preview/mod.rs",
        "#[cfg(test)]\nmod tests;",
        '#[allow(dead_code)]\nconst _NOTE: &str = r#"\n#[cfg(test)]\nmod service;\n"#;\n\n'
        "#[cfg(test)]\nmod tests;",
        (
            "apps/desktop/src-tauri/src/preview/service.rs",
            "use super::conversion::conversion_source_kind;",
            "use super::conversion::conversion_source_kind;\n"
            "const _FORGED: mscanvas_proteowizard::OwnedTreeDisposition =\n"
            "    mscanvas_proteowizard::OwnedTreeDisposition::ConfirmedGone;",
        ),
    ),
    # The document rule, proved on the live defect that motivated it: the
    # shipping definition of an item state, narrowed back to the confirmed tree
    # alone. Without this the markdown branch was never exercised by a proof.
    (
        "a state table narrows a definition to a confirmed tree",
        "docs/architecture/adr/0015-user-visible-queue-stop.md",
        "| `cancelled` | Stopped with nothing finalized: either the owned tree was "
        "confirmed gone, or nothing was launched to be a tree |",
        "| `cancelled` | Stopped while running, owned tree confirmed gone, nothing "
        "finalized |",
    ),
    # And a row beside it, which the window this replaced exempted for having a
    # truthful neighbour.
    (
        "a neighbouring row inherits an exemption it did not earn",
        "docs/architecture/adr/0015-user-visible-queue-stop.md",
        "| `cancellationFailed` | Stopped while running, termination not confirmed |",
        "| `cancellationFailed` | Stopped while running, owned tree confirmed gone |",
    ),
    # The two rules M6.8 added, each with the edit it exists to refuse.
    (
        "a consumer derives the disposition for itself",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::destination::admit_destination_root;",
        "use super::destination::admit_destination_root;\n"
        "fn _forged(output: &mscanvas_proteowizard::ProcessOutput)\n"
        "    -> mscanvas_proteowizard::OwnedTreeDisposition {\n"
        "    mscanvas_proteowizard::OwnedTreeDisposition::of(output)\n"
        "}",
    ),
    (
        "the claim is written as a string",
        "apps/desktop/src-tauri/src/preview/service.rs",
        "use super::destination::admit_destination_root;",
        "use super::destination::admit_destination_root;\n"
        'const _FORGED: &str = "confirmed_gone";',
    ),
    (
        "a production file states when ownership began",
        "apps/desktop/src-tauri/src/preview/conversion.rs",
        "use super::backend::ConversionBackend;",
        "use super::backend::ConversionBackend;\n"
        "const _CLAIMED: mscanvas_proteowizard::TreeOwnership =\n"
        "    mscanvas_proteowizard::TreeOwnership::EstablishedBeforeExecution;",
    ),
)


def _validate_the_claim_guard_detects_bypasses(errors: list[str]) -> None:
    """Runs the guard against copies that break it, one bypass at a time.

    A temporary tree, never the worktree: a validation that edited the sources
    it was validating could leave the repository changed by having been checked.
    Only the handful of files the guard reads are copied, and each bypass gets
    its own tree so one cannot mask another.
    """
    import shutil
    import tempfile

    sources: list[Path] = []
    for glob in CLAIM_SOURCE_GLOBS:
        sources.extend(sorted(ROOT.glob(glob)))
    if not sources:
        errors.append(
            "the cancellation claim guard found no sources to check; its globs no "
            "longer match this repository"
        )
        return

    with tempfile.TemporaryDirectory(prefix="mscanvas-claim-guard-") as scratch:
        pristine = Path(scratch) / "pristine"
        for source in sources:
            target = pristine / source.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

        # The copy must pass, or every failure below would prove nothing about
        # the bypass and only that the copy was incomplete.
        control: list[str] = []
        _check_the_cancellation_claim(pristine, control)
        if control:
            errors.append(
                "the cancellation claim guard fails against an unmodified copy of the "
                f"sources it checks, so its bypass proofs are meaningless: {control[0]}"
            )
            return

        for index, bypass in enumerate(CLAIM_BYPASSES):
            name = bypass[0]
            # One bypass is one *edit* except where it cannot be: exempting a
            # file and forging a claim inside it are two files, and a proof that
            # could only touch one could not exercise that rule at all.
            edits = [bypass[1:4]] + ([bypass[4]] if len(bypass) > 4 else [])
            tree = Path(scratch) / f"bypass-{index}"
            shutil.copytree(pristine, tree)
            applied = True
            for relative, before, after in edits:
                target = tree / relative
                if before is None:
                    # A proof that needs a file the tree does not have: the
                    # module a `#[path]` attribute compiles is one nothing else
                    # references, so it has to be created rather than edited.
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(after, encoding="utf-8")
                    continue
                if not target.is_file():
                    errors.append(
                        f"the cancellation claim guard cannot prove it detects "
                        f"'{name}': {relative} is not among the files it reads"
                    )
                    applied = False
                    break
                text = target.read_text(encoding="utf-8")
                if text.count(before) != 1:
                    errors.append(
                        f"the cancellation claim guard cannot prove it detects "
                        f"'{name}': its anchor no longer appears exactly once in {relative}"
                    )
                    applied = False
                    break
                target.write_text(text.replace(before, after), encoding="utf-8")
            if not applied:
                continue
            detected: list[str] = []
            _check_the_cancellation_claim(tree, detected)
            if not detected:
                errors.append(
                    f"the cancellation claim guard does not detect '{name}'; a check "
                    "that cannot fail is not evidence that the claim has one origin"
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
        validate_inline_run_rule(errors)
        validate_user_facing_strings(errors)
        validate_test_support_stays_a_dev_dependency(errors)
        validate_e2e_capability_never_ships(errors)
        validate_clipboard_stays_write_only(errors)
        validate_no_font_is_bundled_or_fetched(errors)
        validate_every_raster_entry_point_asks_the_budget(errors)
        validate_the_chromatogram_authority_has_one_installation_path(errors)
        validate_the_linked_pair_is_bound_in_one_operation(errors)
        validate_the_current_status_section_has_one_answer(errors)
        validate_drawability_is_settled_in_one_place(errors)
        validate_a_spectrum_range_is_resolved_in_one_place(errors)
        validate_the_xic_route_outcome_has_one_answer(errors)
        validate_one_candidate_evidence_dimension_vocabulary(errors)
        validate_the_msconvert_capability_evidence_is_closed(errors)
        validate_the_m610_side_routes_are_all_terminal(errors)
        validate_the_evidence_tooling_detects_what_it_claims(errors)
        validate_the_admitted_intent_table_cites_measurements_that_support_it(errors)
        validate_the_cancellation_claim_has_one_origin(errors)
        validate_current_status_documents_describe_the_shipped_product(errors)

    if errors:
        print("Repository validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Repository validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
