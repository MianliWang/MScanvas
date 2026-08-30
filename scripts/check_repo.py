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

    Also pinned: the re-entry gate names the exact measured executable digest.
    The whole point of that gate is that a build is admitted by identity rather
    than by resembling a measured one, and a gate that named no identity would
    be the defect it exists to prevent.
    """
    spike = ROOT / "docs/spikes/M5_XIC_SOURCE_EVIDENCE.md"
    if not spike.is_file():
        return
    text = spike.read_text(encoding="utf-8")

    # The pattern locates the declaration; it does not decide whether what it
    # found is a route outcome. That is the closed vocabulary's job, below.
    outcomes = re.findall(r"\*\*Route outcome: `([A-Z_][A-Z0-9_]*)`\.\*\*", text)
    if len(outcomes) != 1:
        fail(
            f"docs/spikes/M5_XIC_SOURCE_EVIDENCE.md declares {len(outcomes)} route outcomes, "
            "not 1. The spike is where the measurement lives, so it has to state exactly one "
            "answer for the status documents to agree with",
            errors,
        )
        return
    outcome = outcomes[0]
    if outcome not in XIC_ROUTE_OUTCOMES:
        fail(
            f"docs/spikes/M5_XIC_SOURCE_EVIDENCE.md declares route outcome `{outcome}`, which "
            f"is not one of the {len(XIC_ROUTE_OUTCOMES)} the route defines "
            f"({', '.join(f'`{name}`' for name in sorted(XIC_ROUTE_OUTCOMES))}). A token that "
            "resembles an outcome is not one, and the status documents would agree with it "
            "just as readily",
            errors,
        )
        return
    # By exclusion from the closed set rather than by an `else`, so an unknown
    # token can never be handed the opposite outcome's name. The unpacking
    # asserts what the vocabulary promises: exactly one other outcome.
    (superseded,) = XIC_ROUTE_OUTCOMES - {outcome}

    _validate_the_reentry_gate_names_the_measured_digest(text, errors)

    for name in ("ROADMAP.md", "BOOTSTRAP_STATUS.md"):
        document = ROOT / name
        if not document.is_file():
            continue
        body = document.read_text(encoding="utf-8")

        # Only where the document states M5.4's *own* status: its slice section,
        # and the bullets that open with the slice's name.
        #
        # Deliberately not every paragraph mentioning M5.4. The route-lock prose
        # written before the measurement discusses both branches as they were
        # then planned -- including that an M5 without a real installation
        # "cannot reach an `XIC_SOURCE_ADMITTED` outcome at all" -- and that is
        # correct history rather than a claim about what was found.
        regions = _status_claims_about(body, "M5.4")

        # Existence is asked of the current regions, for the reason the
        # docstring gives: elsewhere in these documents the token is history.
        if not regions:
            fail(
                f"{name} states no M5.4 status of its own. The spike holds the measurement, "
                "and a status document that never states the slice's status cannot be "
                "checked against it",
                errors,
            )
        elif not any(f"`{outcome}`" in region for _, region in regions):
            fail(
                f"{name} does not state M5.4's measured outcome `{outcome}` in any current "
                "M5.4 status region. A mention elsewhere in the document does not carry it: "
                "historical planning prose names both branches, and a reader meeting the "
                "current section has no way to tell which sentence is the answer",
                errors,
            )

        for number, region in regions:
            # A record that says a conclusion was withdrawn has to be able to
            # name the conclusion it withdrew. Only an *unmarked* mention is a
            # claim; the marker has to sit on the same line as the token, so a
            # withdrawal elsewhere in a long section cannot license a stale
            # sentence further down.
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
                    f"{name}:{number} reports M5.4 as `{superseded}`, which the spike "
                    f"supersedes with `{outcome}`. A withdrawn conclusion left standing in a "
                    "status document is the one way this record can mislead",
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

    Nothing here reads prose for tone, and nothing pins a snapshot of it.
    """
    for name in CURRENT_STATUS_DOCUMENTS:
        source = ROOT / name
        if not source.is_file():
            continue
        text = source.read_text(encoding="utf-8").lower()
        for opening in MISSING_LIST_OPENINGS:
            at = text.find(opening)
            if at == -1:
                continue
            end = text.find("\n\n", at)
            listed = text[at:] if end == -1 else text[at:end]
            for capability, why in SHIPPED_CAPABILITIES:
                if capability in listed:
                    fail(
                        f"{name}: {opening!r} still lists {capability!r}, which is "
                        f"implemented -- {why}. A reader planning the next slice from "
                        "this section would treat finished behaviour as outstanding",
                        errors,
                    )

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
