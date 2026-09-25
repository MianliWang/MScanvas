#!/usr/bin/env python3
"""What `build_candidate.ps1` records, and what it refuses, against a fixture repository.

    python -B scripts/test_build_candidate.py

Each case copies the script under test into a small committed git repository
and runs it with PowerShell 7. Nothing real is built: `pnpm`, `node`, `cargo`
and `rustc` resolve to stubs, because the child's PATH holds only the stub
directory, git's directory and the Windows system directories. `pnpm tauri
build` is the stub's, and it writes a fixed frontend, executable and installer
-- or fails, or leaves no frontend -- as each case asks. The real `dist`,
`target/release` and evidence directories are never touched.

What is proved is the script's own control flow: that a build records the
frontend the build produced rather than whatever was on disk before it, that a
failed or frontend-less build publishes no manifest, and that `-ManifestOnly`
refuses without a retained manifest whose source identity and artifacts match.
Whether `apps/desktop/dist` after a real build is what the bundler embedded is
a claim about the bundler, and nothing here makes it.

Set BUILD_CANDIDATE_SCRIPT to test another copy of the script, and
BUILD_CANDIDATE_TEST_ROOT to keep the fixtures in a directory of your choosing.
Windows only: the stubs are `.cmd` files.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = Path(os.environ.get("BUILD_CANDIDATE_SCRIPT", ROOT / "scripts" / "build_candidate.ps1"))
PWSH = shutil.which("pwsh")
GIT = shutil.which("git")

MANIFEST = "evidence/candidate-manifest.json"
EXECUTABLE = "target/release/mscanvas-desktop.exe"
INSTALLER = "target/release/bundle/nsis/MSCanvas_0.1.0_x64-setup.exe"

STUB = r'''
import os, pathlib, shutil, sys
tool, args = sys.argv[1], sys.argv[2:]
if args and args[-1] == "--version":
    if tool == "pnpm" and "tauri" in args:
        print("tauri-cli 2.0.0-stub")
    else:
        print({"node": "v22.13.0", "pnpm": "11.15.1", "cargo": "cargo 1.97.1", "rustc": "rustc 1.97.1"}[tool])
    sys.exit(0)
if tool == "pnpm" and args == ["tauri", "build"]:
    root = pathlib.Path(os.environ["FIXTURE_ROOT"])
    mode, tag = os.environ["STUB_BUILD"], os.environ.get("STUB_TAG", "new")
    dist = root / "apps" / "desktop" / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    if mode in ("frontend", "fail"):
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text(f"<html>{tag}</html>", encoding="utf-8")
        (dist / "assets" / f"app-{tag}.js").write_text(f"console.log('{tag}')", encoding="utf-8")
    elif mode == "empty-frontend":
        dist.mkdir(parents=True)
    if mode == "fail":
        print("stub build failed", file=sys.stderr)
        sys.exit(1)
    release = root / "target" / "release"
    (release / "bundle" / "nsis").mkdir(parents=True, exist_ok=True)
    (release / "mscanvas-desktop.exe").write_bytes(f"exe-{tag}".encode())
    (release / "bundle" / "nsis" / "MSCanvas_0.1.0_x64-setup.exe").write_bytes(f"installer-{tag}".encode())
    sys.exit(0)
print(f"unexpected stub call: {tool} {args}", file=sys.stderr)
sys.exit(97)
'''

FIXTURE_FILES = {
    "apps/desktop/src-tauri/tauri.conf.json": json.dumps(
        {
            "build": {"beforeBuildCommand": "pnpm build", "frontendDist": "../dist"},
            "bundle": {
                "licenseFile": "../../../LICENSE",
                "resources": {"../../../THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md"},
            },
        }
    ),
    "apps/desktop/src-tauri/Cargo.toml": "[package]\nname = \"fixture\"\n",
    "apps/desktop/src-tauri/capabilities/default.json": "{}\n",
    "apps/desktop/src-tauri/icons/icon.png": "icon\n",
    "apps/desktop/package.json": "{}\n",
    "package.json": "{}\n",
    "Cargo.toml": "[workspace]\n",
    "Cargo.lock": "# fixture\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "rust-toolchain.toml": "[toolchain]\nchannel = \"1.97.1\"\n",
    ".node-version": "22.13.0\n",
    "LICENSE": "fixture licence\n",
    "THIRD_PARTY_NOTICES.md": "fixture notices\n",
    ".gitignore": "apps/desktop/dist/\ntarget/\nevidence/\nlocalappdata/\n",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipUnless(os.name == "nt" and PWSH and GIT, "needs Windows, pwsh and git")
class BuildCandidate(unittest.TestCase):
    work: Path

    @classmethod
    def setUpClass(cls) -> None:
        kept = os.environ.get("BUILD_CANDIDATE_TEST_ROOT")
        if kept:
            cls.work = Path(kept).resolve()
            cls.work.mkdir(parents=True, exist_ok=True)
            cls.cleanup = False
        else:
            cls.work = Path(tempfile.mkdtemp(prefix="build-candidate-"))
            cls.cleanup = True
        stubs = cls.work / "bin"
        stubs.mkdir(exist_ok=True)
        (stubs / "stub_tool.py").write_text(STUB, encoding="utf-8")
        for tool in ("pnpm", "node", "cargo", "rustc"):
            (stubs / f"{tool}.cmd").write_text(
                f'@echo off\r\n"{sys.executable}" "{stubs / "stub_tool.py"}" {tool} %*\r\nexit /b %ERRORLEVEL%\r\n',
                encoding="utf-8",
            )
        system = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        cls.path = os.pathsep.join([str(stubs), str(Path(GIT).parent), str(system / "System32"), str(system)])
        # Nothing may reach a real tool: the stub is the only pnpm on the child's PATH.
        assert Path(shutil.which("pnpm", path=cls.path) or "").parent == stubs, "pnpm would escape the stubs"
        assert shutil.which("cargo", path=cls.path) and Path(shutil.which("cargo", path=cls.path)).parent == stubs

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.cleanup:
            shutil.rmtree(cls.work, ignore_errors=True)

    def fixture(self, name: str) -> Path:
        root = self.work / name
        if root.exists():
            shutil.rmtree(root)
        for relative, text in FIXTURE_FILES.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        (root / "scripts").mkdir()
        shutil.copyfile(SCRIPT, root / "scripts" / "build_candidate.ps1")
        for command in (
            ["init", "-q"],
            ["config", "core.autocrlf", "false"],
            ["config", "user.email", "fixture@example.invalid"],
            ["config", "user.name", "fixture"],
            ["add", "-A"],
            ["commit", "-q", "-m", "fixture"],
        ):
            subprocess.run([GIT, *command], cwd=root, check=True, capture_output=True)
        return root

    def run_script(self, root: Path, *args: str, build: str = "frontend", tag: str = "new") -> tuple[int, str]:
        env = {key: value for key, value in os.environ.items() if not key.upper().startswith(("MSCANVAS_", "TAURI_"))}
        env.update(
            PATH=self.path,
            FIXTURE_ROOT=str(root),
            STUB_BUILD=build,
            STUB_TAG=tag,
            LOCALAPPDATA=str(root / "localappdata"),
        )
        done = subprocess.run(
            [PWSH, "-NoProfile", "-NonInteractive", "-File", str(root / "scripts" / "build_candidate.ps1"),
             "-EvidenceRoot", "evidence", *args],
            cwd=root, env=env, capture_output=True, text=True, timeout=180,
        )
        return done.returncode, done.stdout + done.stderr

    def head(self, root: Path) -> str:
        return subprocess.run([GIT, "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True, text=True).stdout.strip()

    def manifest(self, root: Path) -> dict:
        return json.loads((root / MANIFEST).read_text(encoding="utf-8-sig"))

    def frontend(self, root: Path) -> dict[str, str]:
        return {entry["path"]: entry["sha256"] for entry in self.manifest(root)["frontendInputs"]}

    def generated(self, root: Path) -> dict[str, str]:
        dist = root / "apps" / "desktop" / "dist"
        return {path.relative_to(root).as_posix(): sha256(path) for path in dist.rglob("*") if path.is_file()}

    # -- a build records what the build produced ------------------------------

    def test_a_a_build_records_the_frontend_it_generated_not_the_one_before_it(self) -> None:
        root = self.fixture("a-old-frontend")
        old = root / "apps" / "desktop" / "dist"
        old.mkdir(parents=True)
        (old / "index.html").write_text("<html>old</html>", encoding="utf-8")
        (old / "old.js").write_text("console.log('old')", encoding="utf-8")
        stale = {"apps/desktop/dist/index.html": sha256(old / "index.html"), "apps/desktop/dist/old.js": sha256(old / "old.js")}

        code, output = self.run_script(root)

        self.assertEqual(code, 0, output)
        recorded = self.frontend(root)
        self.assertEqual(recorded, self.generated(root))
        self.assertIn("apps/desktop/dist/assets/app-new.js", recorded)
        self.assertNotIn("apps/desktop/dist/old.js", recorded)
        self.assertNotEqual(recorded["apps/desktop/dist/index.html"], stale["apps/desktop/dist/index.html"])
        self.assertIn("after the build", self.manifest(root)["frontendMeasured"])

    def test_b_a_build_records_a_frontend_that_did_not_exist_before_it(self) -> None:
        root = self.fixture("b-no-frontend-before")

        code, output = self.run_script(root)

        self.assertEqual(code, 0, output)
        self.assertEqual(self.frontend(root), self.generated(root))
        self.assertEqual(len(self.frontend(root)), 2)

    def test_c_a_failed_build_publishes_no_manifest_and_keeps_a_retained_one(self) -> None:
        with self.subTest("no manifest before"):
            root = self.fixture("c-failed-fresh")
            code, output = self.run_script(root, build="fail")
            self.assertNotEqual(code, 0, output)
            self.assertIn("pnpm tauri build failed with exit code 1", output)
            self.assertFalse((root / MANIFEST).exists())
        with self.subTest("a manifest retained from before"):
            root = self.fixture("c-failed-retained")
            retained = root / MANIFEST
            retained.parent.mkdir(parents=True)
            retained.write_bytes(b"RETAINED-SENTINEL")
            code, output = self.run_script(root, build="fail")
            self.assertNotEqual(code, 0, output)
            self.assertIn("pnpm tauri build failed with exit code 1", output)
            self.assertEqual(retained.read_bytes(), b"RETAINED-SENTINEL")

    def test_d_a_build_that_leaves_no_frontend_is_refused(self) -> None:
        for build in ("no-frontend", "empty-frontend"):
            with self.subTest(build):
                root = self.fixture(f"d-{build}")
                code, output = self.run_script(root, build=build)
                self.assertNotEqual(code, 0, output)
                self.assertIn("No compiled frontend under apps/desktop/dist", output)
                self.assertFalse((root / MANIFEST).exists())

    # -- a re-derivation needs the provenance it re-derives -------------------

    def built(self, name: str) -> tuple[Path, dict[str, str]]:
        """A fixture after one successful build, and its artifacts' digests."""
        root = self.fixture(name)
        code, output = self.run_script(root)
        self.assertEqual(code, 0, output)
        return root, {relative: sha256(root / relative) for relative in (EXECUTABLE, INSTALLER)}

    def assert_artifacts(self, root: Path, digests: dict[str, str]) -> None:
        for relative, digest in digests.items():
            self.assertEqual(sha256(root / relative), digest, relative)

    def test_e_manifest_only_without_a_retained_manifest_is_refused(self) -> None:
        for extra in ((), ("-AllowDirtyTree",)):
            with self.subTest(extra=extra):
                root, artifacts = self.built(f"e-missing{''.join(extra)}")
                (root / MANIFEST).unlink()
                code, output = self.run_script(root, "-ManifestOnly", *extra)
                self.assertNotEqual(code, 0, output)
                self.assertIn("ManifestOnly needs the retained candidate manifest", output)
                self.assertFalse((root / MANIFEST).exists())
                self.assert_artifacts(root, artifacts)

    def test_f_manifest_only_refuses_unusable_retained_provenance_and_keeps_it(self) -> None:
        def malformed(root: Path) -> None:
            (root / MANIFEST).write_text("{ not json", encoding="utf-8")

        def edited(**changes):
            def edit(root: Path) -> None:
                record = self.manifest(root)
                for key, value in changes.items():
                    if value is None:
                        record.pop(key)
                    else:
                        record[key] = value
                (root / MANIFEST).write_text(json.dumps(record), encoding="utf-8")
            return edit

        def other_installer(root: Path) -> None:
            (root / INSTALLER).write_bytes(b"installer-from-another-build")

        cases = {
            "malformed": (malformed, "cannot be read"),
            "other head": (edited(head="0" * 40), "The retained manifest was built at"),
            "no head": (edited(head=None), "does not record a valid head"),
            "other tree": (edited(tree="1" * 40), "The retained manifest was built from tree"),
            "no installer identity": (edited(installer=None), "does not record the installer"),
            "installer on disk differs": (other_installer, "does not match the retained manifest"),
        }
        for name, (spoil, reason) in cases.items():
            with self.subTest(name):
                root, _ = self.built("f-" + name.replace(" ", "-"))
                spoil(root)
                retained = (root / MANIFEST).read_bytes()
                artifacts = {relative: sha256(root / relative) for relative in (EXECUTABLE, INSTALLER)}
                code, output = self.run_script(root, "-ManifestOnly")
                self.assertNotEqual(code, 0, output)
                self.assertIn(reason, output)
                self.assertEqual((root / MANIFEST).read_bytes(), retained)
                self.assert_artifacts(root, artifacts)

    def test_g_manifest_only_rederives_when_the_retained_provenance_matches(self) -> None:
        root, artifacts = self.built("g-matching")
        built_at = self.head(root)

        code, output = self.run_script(root, "-ManifestOnly")

        self.assertEqual(code, 0, output)
        record = self.manifest(root)
        self.assertEqual(record["head"], built_at)
        self.assertEqual(record["command"], "(manifest re-derived; not rebuilt)")
        self.assertEqual(record["installer"]["sha256"], artifacts[INSTALLER])
        self.assertIn("not established", record["frontendMeasured"])
        self.assert_artifacts(root, artifacts)


if __name__ == "__main__":
    unittest.main(verbosity=2)
