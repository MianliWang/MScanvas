# ADR 0066 — Releasing the analysis runtime (CPython and pyOpenMS)

Status: **Proposed**, 2026-10-30. Not accepted and not implemented. Every
decision below is a recommendation with its alternatives; the owner decides
([open questions](#open-questions-for-the-owner)).
Related: [0002](0002-external-proteowizard.md),
[0046](0046-post-m6-xic-provider-runtime-route-lock.md),
[0047](0047-first-windows-beta-scope-and-implementation-route.md),
[0048](0048-stored-targeted-result-reuse-and-export.md),
[0049](0049-content-bound-execution-snapshot.md),
[0050](0050-sequential-batch-of-independent-targeted-plans.md),
[0059](0059-vendor-format-strategy-official-readers-thermo-first.md).
Evidence: [M9.0 route evidence](../../spikes/M9_0_TARGETED_MS1_ROUTE_EVIDENCE.md),
[M9.4 batch evidence](../../spikes/M9_4_TARGETED_MS1_BATCH_EVIDENCE.md),
the [M9 closure](../../product/M9_CLOSURE.md) and the measurements of
2026-10-30 [below](#measurements-2026-10-30), made on a scratch copy and not
committed. The analysis research synthesis of 2026-10-30 (written for the
owner, not committed) names this record as the first step of every pyOpenMS
function.

> **This is not legal advice.** The licence statements below are readings of
> the licence files shipped in the runtime and of the upstream texts, made so
> that the owner knows what needs a decision or a lawyer.

## Context

**One analysis exists, and no user can run it.** ANA-004, the experimental
targeted-MS1 recipe, runs a fixed adapter
(`apps/desktop/src-tauri/src/targeted_ms1/adapter_v1.py`) in CPython 3.13.15
(the Windows embeddable build) with `pyopenms==3.5.0` and the 13 other wheels
of `experiments/m9_0/runtime/requirements-cp313-win_amd64.lock.txt`.
`scripts/provision_targeted_ms1_runtime.py` builds that runtime offline from
M9.0's verified downloads into `.tmp/m91-runtime/` of a development checkout,
and writes a canonical manifest whose SHA-256 the application compiles in as
`recipe::RUNTIME_MANIFEST_SHA256`
(`6A3EB44A4611DB6B906F43B0278F67BB2B6996DDC7871BF614812E2CAC29B295`; 4,628
files, 348,698,831 bytes). A release build has no runtime location, so beta 1
answers every plan review with `recipeUnavailable`
([ADR 0047](0047-first-windows-beta-scope-and-implementation-route.md#targeted-ms1-runtime)).

**The owner's direction of 2026-10-30 makes this the critical path.** Analysis
is to be planned and built. Every function that runs in pyOpenMS (ANA-004,
untargeted feature detection, alignment and linking, gap filling, adduct
grouping, library annotation, GNPS export) needs a runtime that ships. Work
that runs in Rust only (statistics on a feature table, sample metadata, scan
browsing, the 2D map) does not.

**What is open.** ADR 0047's targeted-MS1 runtime section keeps the M9
closure's remaining limits open "for a release that ships the runtime"; the
after-beta-1 plan (7.1) leaves them for "before any release ships the
runtime", and `ANALYSIS_WORKERS.md`'s packaging gate lists what to evaluate
"Before bundling a Python environment". Open are:

- packaging, an installer and an update path;
- redistribution and licence qualification;
- filesystem and network confinement of the worker;
- an ASCII location: "the engine fails on a non-ASCII runtime path". M9.0
  measured that a runtime under a CJK path makes OpenMS exit "for lack of its
  shared data" (`relocation.json`, case `cjk_runtime_ascii_source`:
  `WORKER_CRASHED`, exit 1).

**Facts that constrain every option:**

1. **The manifest digest is compiled in.** A runtime whose manifest differs is
   refused (`runtimeUnverified`), and a plan recorded under another digest
   answers `PlanNotCurrent`. Any change to the runtime, a security fix
   included, is therefore an application release.
2. **The application installs per user.** NSIS `installMode: currentUser`
   (`tauri.conf.json`) installs to `%LOCALAPPDATA%\MSCanvas\` by default
   ([beta-1 installed check](../../release/beta-1/INSTALLED_CHECK.md)), which
   contains the Windows user name. A Chinese user name makes that path
   non-ASCII. The installer's folder page lets a user pick another folder, but
   nothing makes them pick an ASCII one.
3. **The work area must be ASCII too.** The worker is given ASCII names only:
   its attempt directory, its `TEMP`, its `OPENMS_HOME_PATH` and the hard link
   or verified copy of the source ([ADR 0049](0049-content-bound-execution-snapshot.md)).
   In development they live under `.tmp/m91-jobs/attempts`; a release has none.
4. **Every launch verifies every file.** `verify_runtime` hashes all 4,628
   files before each worker starts, up to 16 times in one batch.
5. **The repository says the runtime is not shipped.** The lock's header says
   "Not a production dependency; never installed into the application", and
   `THIRD_PARTY_NOTICES.md` says MSCanvas "redistributes no ProteoWizard build,
   vendor reader, OpenMS, pyOpenMS, matchms or proprietary instrument SDK".
   Shipping the runtime makes the wheels it ships production dependencies under
   AGENTS.md's dependency policy: six of the lock's 14 under decision 4
   (`pyopenms`, `numpy`, `pandas`, `python-dateutil`, `six`, `tzdata`).
6. **Security alerts.** 41 open Dependabot alerts are Pillow in the runtime
   lock (in the alert list exported on 2026-10-29: 5 critical, 23 high,
   13 medium, each fixed in Pillow 13.0.0). The owner
   kept them open on 2026-10-30, to be fixed "when that runtime is next
   provisioned and before any release ships the runtime"; `DEPENDENCY_POLICY.md`
   names the fix as the Pillow 13.0.0 wheel.
7. **The pinned interpreter line has no more binaries.** PEP 719: "Around the
   time of the release of 3.15.0 final, the final 3.13 bugfix update was
   released. After that, it is expected that security updates (source only)
   will be released". Its schedule lists 3.13.16 (2026-10-01) as the "Final
   regular bugfix release with binary installers", then, under "Source-only
   security fix releases", 3.13.17 (2026-10-21, "exceptionally with binary
   installers") and 3.13.18 (2026-10-25). python.org's Windows page has
   embeddable packages up to 3.13.17 and no 3.13.18 entry; its
   `ftp/python/3.13.18/` folder holds only source tarballs, and the
   embeddable's URL there answers 404 (checked 2026-10-30). The pinned 3.13.15
   is two binary releases behind, and a later 3.13 security fix arrives only
   as source.
8. **The pinned build's OpenSSL is unsupported.** Its `libcrypto-3.dll`, on the
   engine's load path (the probe below), and `libssl-3.dll` are FileVersion
   3.0.21. OpenSSL's release strategy: "Versions 3.0, 1.1.1 and 1.0.2 are no
   longer supported", and "Version 3.5 will be supported until 2030-04-08
   (LTS)". Measured on 2026-10-30: the 3.13.17 embeddable (SHA-256
   `9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38`) and the
   3.14.10 embeddable (SHA-256
   `90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159`), each
   equal to the SHA-256 on its python.org release page, both carry
   `libcrypto-3.dll` and `libssl-3.dll` 3.5.9.
9. **Dependabot reads only the pip lock.** The embeddable interpreter and what
   it carries (OpenSSL, `sqlite3.dll` 3.50.4.0, libffi and others), Qt 6.8.3,
   `zlib.dll` 1.3.1, OpenBLAS and the libraries statically linked into
   `OpenMS.dll` are in no lock, so no alert ever names them.

## Measurements (2026-10-30)

**Method.** The provisioned runtime in the main checkout was copied into a
scratch folder with an ASCII path and checked against the pin first: the
manifest's SHA-256 equals `RUNTIME_MANIFEST_SHA256`, and all 4,628 files
match their entries, with nothing extra or missing. Nothing was re-provisioned,
and the main checkout's runtime was only read. Every run below used the
reviewed adapter (`adapter_v1.py` from `origin/main` at `7ac5a219`, SHA-256
`ed3f7fbd772de9489a4afff86cf3ac0a0d598690c16bb2c6cb87716021afb0ac`), launched
the way the supervisor launches it: argv
`python.exe -I -B -X utf8 adapter_v1.py request.json out`, an emptied
environment with `PATH` (the runtime, `System32`, Windows), `SystemRoot`,
`WINDIR`, `TEMP` and `TMP` in the attempt's `tmp`, `OPENMS_HOME_PATH` in its
`home`, and `OMP_NUM_THREADS=1`. The request (`request.json`, UTF-8, LF):

- `schema` `mscanvas.targetedMs1.request/1`, `attemptId`
  `00000000-0000-4000-8000-000000000001`;
- `source`: `path` (the fixture's absolute path with forward slashes),
  `byteLength` and `sha256` of the fixture;
- `parameters`: `mzHalfWidthPpm` 5.0 (a half-width in ppm) and
  `expectedPeakWidthS` 6.0;
- `targets`, two, each with `neutralMass` `null` (mass from the formula),
  `rtS` 60.0 and `rtHalfWidthS` 20.0: `targetId`
  `00000000-0000-4000-8000-0000000000a1`, `formula` `C8H10N4O2` (outcome
  `DETECTED` in every completed run), and `targetId`
  `00000000-0000-4000-8000-0000000000a2`, `formula` `C8H9NO2`
  (`NOT_DETECTED` in every completed run).

The source was M9.0's synthetic fixture `fmt_plain.mzML`, generated by
`fixture_set()["fmt_plain"]` in `experiments/m9_0/protocol.py` (387,661 bytes,
SHA-256 `2f4489d143f04e639534c25caf403fd30d09e7926989dfb263f45e84d12004bc`).
The runs were not inside a Job object. Each copy below is the verified runtime
minus the files its row names; each row that starts from another copy was made
from that copy by removing the files it adds. The measurement scripts and
outputs stayed in the maintainer's scratch folder and are not committed: this
record is documentation only, and the method and exclusion lists here are what
a re-run needs.

### Size by package

From the manifest's own byte counts (largest first; each row includes the
package's files, not its `.dist-info`):

| Package | Files | Bytes |
| --- | ---: | ---: |
| `pyopenms` (of which generated `.cpp`: 8 files, 122,263,371 B) | 200 | 197,045,871 |
| `pandas` (of which `tests/`: 1,122 files, 13,086,431 B) | 1,561 | 34,140,529 |
| `matplotlib` | 556 | 22,430,072 |
| CPython embeddable (interpreter, stdlib zip, its DLLs) | 34 | 21,337,159 |
| `numpy.libs` (OpenBLAS, one MSVC runtime copy) | 2 | 21,164,112 |
| `numpy` (of which `tests/`: 493 files, 7,039,855 B) | 921 | 20,556,794 |
| `PIL` (Pillow) | 114 | 14,639,417 |
| `fontTools` | 355 | 11,716,833 |
| `mpl_toolkits`, `bin` launchers, `contourpy`, `pandas.libs`, `tzdata`, `packaging`, `pyparsing`, `dateutil`, `kiwisolver`, `cycler`, `six`, `share`, `pylab.py` | 766 | 4,643,579 |
| 14 `.dist-info` folders | 119 | 1,024,465 |
| **Total** | **4,628** | **348,698,831** |

### What the engine path loads

A probe in the same runtime imported `pyopenms`, read the fixture with
`MzMLFile`, built `FeatureFinderAlgorithmMetaboIdent` and listed what was then
loaded:

- **Python packages:** `pyopenms`, `numpy`, `pandas`, `dateutil` and `six`,
  plus the standard library. **Never loaded:** `matplotlib`, `PIL`,
  `fontTools`, `contourpy`, `cycler`, `kiwisolver`, `pyparsing`, `packaging`.
  Only `pyopenms/plotting.py` imports matplotlib, and `pyopenms/__init__.py`
  does not import it.
- **Loaded although the adapter never opens a connection:** `socket`,
  `_socket`, `select`, `urllib` and `subprocess` (from the import chain of
  pandas and pyOpenMS). Confinement cannot rest on "no network code is
  loaded".
- **Native modules:** besides `python.exe`, 16 DLLs and 74 extension modules
  from the runtime (all eight `_pyopenms_*.pyd`, `OpenMS.dll`,
  `OpenSwathAlgo.dll`, `Qt6Core.dll`, **`Qt6Network.dll`**, `zlib.dll`, the
  numpy and pandas extension modules, OpenBLAS, the MSVC runtime DLLs,
  `libcrypto-3.dll`), and 45 from the Windows directory. `libssl-3.dll` was
  not loaded. Tier 3 below loads the same set.

### Slimmed copies

Each tier is a copy of the verified runtime with files removed, run once with
the adapter. Two runs of the unmodified copy differ by at most 8.8e-8 relative
(the binary32 drift M9.0 recorded, here in `isotopeProbability` and the last
digits of computed m/z), so a copy counts as a match when every key, word and
status matches and every number is within 1e-6 relative. A match is evidence
for this one fixture and these two targets only, one run per copy; it is not
bit-for-bit identity and not a general qualification.

| Copy | Removed | Files | Bytes | Compressed (estimate) | Adapter | Against the full copy |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Full | — | 4,628 | 348,698,831 | 55,460,860 | `completed` | 8.8e-8 between its own two runs |
| Tier 1 | matplotlib, `mpl_toolkits`, `pylab.py`, Pillow, fontTools, contourpy, cycler, kiwisolver, pyparsing, packaging (each with its `.dist-info`), `bin/` (6 launcher `.exe`), `share/man`, `pyopenms/plotting.py` | 3,426 | 296,245,907 | 43,923,548 | `completed` | match (largest 7.96e-8) |
| Tier 2 | tier 1 + `pyopenms/*.cpp` and `pyopenms/*.pyi` | 3,408 | 172,239,655 | — | `completed` | match (largest 7.96e-8) |
| Tier 3 | tier 2 + every `tests/` folder in numpy and pandas | 1,793 | 152,113,369 | 35,819,244 | `completed` | match (no difference in this run) |
| Without HMDB | `pyopenms/share/OpenMS/CHEMISTRY/HMDBMappingFile.tsv` (2,217,569 B) | 4,627 | 346,481,262 | — | `completed` | match (largest 7.96e-8) |
| Tier 3 without HMDB | tier 3 + `HMDBMappingFile.tsv` | 1,792 | 149,895,800 | 35,566,420 | `completed` | match (largest 8.84e-8) |
| Tier 3 without HMDB and Modomics (decision 4) | tier 3 without HMDB + `CHEMISTRY/Modomics.json` and `CHEMISTRY/Modomics.tsv` (231,013 B) | 1,790 | 149,664,787 | 35,547,248 | `completed` | match (no difference in this run) |
| The same without BRENDA | tier 3 without HMDB + both Modomics files + `CV/brenda.obo` (932,031 B) | 1,789 | 148,732,756 | — | **`failed`**, `SOURCE_UNREADABLE` | — |
| Without `Qt6Network.dll` | that DLL (1,755,784 B) | 4,627 | 346,943,047 | — | **`failed`**, `INTERNAL` | — |

The `Qt6Network.dll` copy failed at import, with the Windows message in the
host's language: `ImportError: DLL load failed while importing _pyopenms_1:
找不到指定的模块。` ("the specified module could not be found"). Qt's network
library is therefore a load-time dependency of `OpenMS.dll` in 3.5.0 and cannot
be removed to reduce the network surface.

The copy without `brenda.obo` failed with the outcome message `the mzML reader
failed: the file '/CV/brenda.obo' could not be found`: the mzML reader loads
that controlled vocabulary, so a data file cannot be assumed unused because no
recipe names it. Each exclusion is measured.

"Compressed" tars the copy's files (no directory entries; pax format; sorted
by relative path; mtimes and modes as copied) and compresses the stream with
LZMA2 (xz, preset 6, 8 MiB dictionary), counting the compressed bytes. That
approximates the increment of an NSIS installer, whose Tauri default is solid
LZMA with an 8 MB dictionary; it is not a built installer. Generated source
and test suites compress well: the 144 MB that tier 3 removes beyond tier 1
save only 8.1 MB compressed.

### Verification cost

A SHA-256 pass over every file of the full copy, by Python's `hashlib`, took
58.5 s directly after the copy and 7.4–22.1 s on six later passes (two of them
over the main checkout's runtime on another volume); the same pass over tier 3
took 3.0–4.1 s on three passes. In memory the same interpreter hashes at about
1.2 GB/s, so the time goes to opening and reading 4,628 files, not to
hashing. M9.4 recorded 9.0–10.2 s for a whole three-member batch, each member
verifying the runtime before launch, on the development checkout's volume, so
the cost depends on the volume and on whatever scans files as they are opened.
The cost at the installed location is **unmeasured**; fewer files reduce it.

## Options

### Distribution

| | A. In the application installer | B. A separate, verified runtime package | C. User-installed Python |
| --- | --- | --- | --- |
| What the user does | nothing extra | installs a second package from the same release, once | installs CPython 3.13 and `pip install pyopenms==3.5.0`, then points MSCanvas at it |
| Size | installer from 6,469,906 B to about 62 MB (full) or about 42 MB (tier 3), estimated from the compressed column, for every user, including those who never run analysis | the same bytes, only for users who want analysis | none shipped |
| ASCII location | inherits the per-user install path below `%LOCALAPPDATA%`, non-ASCII for a non-ASCII user name, unless the runtime is placed elsewhere; the application installer would then need elevation or a second location | its own location, chosen for the runtime (decision 2), while the application stays a per-user, unelevated install; the runtime package itself needs elevation, from analysis users only, and while unsigned it shows UAC's unknown-publisher prompt, which an organisation's policy may refuse | the user's choice; nothing guarantees ASCII |
| Integrity | the manifest pin, as today | the manifest pin, as today, plus the package's published SHA-256 and build attestation | **none**: a user's environment cannot match a pinned manifest, so the identity guarantee of ANA-004 (the pinned digest in every plan) is lost |
| Updates | every runtime fix is an application release (fact 1) | the same: a runtime fix is an application release with a matching package | the user's, untracked; the result names an engine nobody can reproduce |
| Licence notices | MSCanvas's installer carries them | the runtime package carries them | the user's installation carries them; MSCanvas redistributes nothing |
| Support cost | lowest for the user, highest download | one more step, documented | highest: versions, wheels, paths, PATH, antivirus, user support |

B has two variants, which differ only in who downloads the package. **B1:**
the user downloads it from the release page and runs it (recommended,
decision 1). **B2:** the application downloads and installs it when the user
asks. B2 is not a silent update if the user starts it and the package is
checked against the pinned digest before anything is installed, but it gives
MSCanvas a network client and a download feature it does not have today, each
with its own decision and, likely, a new dependency.

C fails the recipe's own contract: a plan's identity is the manifest digest,
and a user environment has none MSCanvas can pin. It also fails the packaging
gate's rule that a user-managed environment is "not an unexplained consumer
requirement". It stays useful to a developer only.

### Engine version

| | 3.5.0 (pinned) | 3.6.0, without the Thermo files | Wait for 3.7.0 |
| --- | --- | --- | --- |
| Qualification | ANA-004 is qualified on it | ANA-004 re-qualified (nanobind API, exceptions, binary32 behaviour) | unknown |
| Qt (LGPL-3) | `Qt6Core.dll` 6.8.3 and `Qt6Network.dll` 6.8.3, both loaded | none | unknown |
| Vendor code | none | `share/OpenMS/openms_thermo_bridge/` (Thermo RawFileReader) must be left out, and that it still works without it must be measured; AGENTS.md forbids shipping it | unknown |
| Network-capable code | Qt6Network; Python's `socket`, `_ssl` | libcurl, the AWS SDK and OpenSSL linked into `OpenMS.dll` (research string scan) | unknown |
| Other | the extractor-edge defect (#10673) stays typed `FAILED` | KD linking and PoseClustering fixes (#10157, #10148); a new, unpinned `nanobind-backend` dependency; libiconv (LGPL-2.1) listed in its notices, linking unconfirmed | #10673 fixed; no release date |

### Interpreter

PyPI has `win_amd64` wheels of the pinned `pyopenms` 3.5.0, `numpy` 2.5.3 and
`pandas` 3.0.6 for both cp313 and cp314
(`pyopenms-3.5.0-cp314-cp314-win_amd64.whl` was uploaded 2025-12-11);
`python-dateutil`, `six` and `tzdata` are pure-Python wheels. Their contents
on cp314 (native libraries, sizes) are not inventoried yet (decision 4).

| | 3.13.15 (pinned) | 3.13.17 | 3.14 (3.14.10 today) | Built from source |
| --- | --- | --- | --- | --- |
| Official binaries | two binary releases behind (fact 7) | the last 3.13 build with binaries; 3.13.18 is already source only | binary bugfix releases about every two months until about 3.16.0 (PEP 745: "approximately 24 months", 3.14.16 expected 2027-10-05) | MSCanvas builds every security release itself |
| OpenSSL | 3.0.21, unsupported (fact 8) | 3.5.9, supported to 2030-04-08 | 3.5.9 in 3.14.10 | MSCanvas chooses and builds it |
| Wheels | as today | as today (cp313) | the cp314 builds of the same versions | as the chosen line |
| Qualification | ANA-004 qualified | new manifest, ANA-004 re-run | new manifest, new binaries: ANA-004 re-qualified (M9.0 protocol); whether it runs is **unmeasured** | as the chosen line, plus a build toolchain and its own security duty |

Every line closes its binary releases about two years after its first release,
so a shipped runtime has to move to the next line before that, and only when
pyOpenMS publishes wheels for it.

### Contents

- **The full runtime**, as provisioned.
- **Tier 1**: no matplotlib stack. It removes Pillow, so the 41 alerts no longer
  apply to what ships.
- **Tier 3**: tier 1 without generated source, stubs and test suites.
  ANA-004's results in it match the full runtime's within 1e-6 relative, with
  or without the HMDB file, on one synthetic fixture and two targets (one
  `DETECTED`, one `NOT_DETECTED`).

pyOpenMS 3.5.0 declares `matplotlib>=3.5` in `Requires-Dist`, so the slimmed
runtime is a manifest-level exclusion, not something pip would produce. An
import of `pyopenms.plotting` fails in it; no recipe imports that module.

## Decisions (recommended)

### 1. Distribution: a separate, verified runtime package the user downloads (B1)

The runtime is published as a second installer, **"MSCanvas analysis
runtime"**, attached to the same GitHub release as the application, built by
the same workflow, with its SHA-256 published and a build-provenance
attestation, under the same signing posture as the application (unsigned with
published checksums until signing is decided).

- The application does not download it. MSCanvas has no download feature and
  no network operation of its own; adding one is a new capability with its own
  decision. A user who wants analysis downloads the package from the release
  page, as they download the application, which also works on an offline
  machine.
- The application finds the runtime only at the location decision 2 fixes,
  under the digest it pins (or, under decision 2's alternative, in the one
  folder its fixed pointer names). Nothing else is searched: no `PATH`, no
  registry lookup of other Pythons, no user-chosen interpreter.
- The package needs elevation (decision 2), from analysis users only. While it
  is unsigned, UAC shows an unknown publisher, and an organisation's policy may
  refuse to elevate an unsigned program; such users need an administrator or
  decision 2's alternative.
- When it is missing, the plan review says so (`recipeUnavailable`, as today)
  and names the package to install.

**Why not A.** Every user pays 36–55 MB more (estimate) for a feature most of
them may not use yet, and the per-user installer would need elevation, or a
second location, to give the runtime an ASCII path. B leaves the application's
install mode and contents as they are, adding only an uninstaller hook and a
notice (decision 9), and asks for elevation only from analysis users. If the
owner prefers one download, A works with the same location rule (decision 2),
at the cost of elevation for every user.

### 2. Location: per machine, under Program Files, named by digest

- **Runtime:** `%ProgramFiles%\MSCanvas Analysis Runtime\<first 16 hex digits of
  the manifest SHA-256>\`, installed by an elevated (per-machine) NSIS package.
  - The folder name `Program Files` is ASCII on every display language of
    Windows (only its displayed name is translated); the installer and the
    application still check that the full path is ASCII and refuse with a
    typed error if it is not (an administrator can move `%ProgramFiles%`).
  - Only administrators can write there, which closes the gap between the
    pre-launch verification and the launch that a user-writable folder leaves
    open.
  - Windows grants "ALL APPLICATION PACKAGES" read and execute on it, inherited
    by everything below (`icacls` on this machine: `(RX)` and
    `(OI)(CI)(IO)(GR,GE)`), which an AppContainer worker needs (decision 7).
- **Work area:** `%ProgramData%\MSCanvas\work\<user SID>\`, created by the
  application on first use with a protected DACL (the user, SYSTEM,
  Administrators). A folder that exists with another owner or a wider DACL is
  a typed refusal, never a reason to use another folder.
  - `icacls` on this machine: `C:\ProgramData` lets Users create folders
    (`(CI)(WD,AD,WEA,WA)`) and gives the creator full control, others read; the
    drive root gives Authenticated Users Modify on everything created below it
    (`(OI)(CI)(IO)(M)`). A folder at `C:\` would therefore need its DACL set
    explicitly; ProgramData plus the owner checks is the smaller rule.
  - The elevated runtime installer creates `%ProgramData%\MSCanvas\` and its
    `work\` itself, owned by Administrators with a protected DACL: Users may
    create a folder in `work\` but own only what they create, and may not
    delete or rename another's. Because Users can create
    `%ProgramData%\MSCanvas` before the installer runs, an existing `MSCanvas`
    or `work` folder whose owner is not Administrators or SYSTEM, or that is a
    reparse point, makes the installer stop with a message naming the folder
    and its owner; it never adopts or reuses it.
  - Before every use the application checks owner, DACL and "not a reparse
    point" at every level from `%ProgramData%\MSCanvas` down to `<SID>`, not
    only at `<SID>`.
  - Another user can still create `work\<your SID>` first, since Users may
    create folders in `work\`. The application then refuses with a typed error
    whose message names the recovery: run the runtime package's Repair
    (elevated), which removes every `work\<SID>` folder whose owner is not
    that SID. A work area holds only attempt scratch, never source data or
    stored results, so removing it loses nothing of the user's.
  - The SID is ASCII; the user name never appears in the path.
  - The hard-link route of ADR 0049 needs the work area on the source's
    volume. Sources on other volumes take the verified-copy route, as today.

**Alternative for users without administrator rights:** a user-chosen folder
whose full path is ASCII, created by the runtime installer with a protected
DACL. It is offered only when elevation is refused, and the user picks it; it
is never chosen silently (open question 3). Its costs:

- **The verification gap reopens.** The folder is writable by the user, so
  anything running as the user can change a file between the pre-launch
  verification and the launch.
- **An explicit AppContainer entry.** "ALL APPLICATION PACKAGES" read and
  execute is inherited only under Program Files; the installer must add that
  entry to the chosen folder for decision 7's container.
- **A locator.** The application must learn the folder. The runtime installer
  writes one fixed per-user pointer (for example a value under
  `HKCU\Software\MSCanvas\AnalysisRuntime`) naming it; the application reads
  only that value, never searches, and applies the same digest, manifest,
  ASCII, owner and DACL checks to the folder it names. Because the user can
  edit the pointer, it only ever selects a folder, never vouches for it.

### 3. Integrity: the pinned manifest, and nothing silent

- The package carries the canonical manifest. The installer extracts into a
  staging folder beside the target, verifies every file against the manifest
  and the manifest against the digest the package was built for, and only
  then publishes the folder by a rename that never replaces an existing one.
- NSIS has no built-in SHA-256, so that check is a small project-owned
  verifier (built from the application's `verify_runtime` code) that the
  package carries and runs from its staging folder, signed with the package
  once signing is decided. A third-party NSIS plugin would be a new dependency
  and is not proposed.
- The application keeps verifying every file before every launch, as today.
  The installed location's cost is measured in the qualification slice; a
  cheaper check (for example once per session on an administrator-only
  folder) would be its own decision.
- **Never a silent update.** The application never fetches, patches or swaps
  a runtime. A new runtime arrives only as a new package the user installs,
  and only an application build that pins its digest uses it.

### 4. Contents: tier 3, without the HMDB and Modomics files

- Ship tier 3: no matplotlib stack, no generated `.cpp`, no `.pyi`, no numpy or
  pandas test suites.
- Leave out `HMDBMappingFile.tsv`, the only HMDB file in the 3.5.0 manifest
  (3.6.0 adds `HMDB2StructMapping.tsv`, 49 MB). ANA-004 does not read it
  (measured). The HMDB terms ([hmdb.ca/citing](https://hmdb.ca/citing)) say
  that "use and re-distribution of the data, in whole or in part, for
  commercial purposes requires explicit permission of the authors"; the site
  refused direct fetches, so that wording came through a search result and is
  still to be checked at the source. MSCanvas is Apache-2.0, open to commercial
  users. A later accurate-mass search takes a user-supplied database.
- Leave out `CHEMISTRY/Modomics.json` and `CHEMISTRY/Modomics.tsv` (RNA
  modifications from the MODOMICS database) unless their terms are confirmed.
  The `.tsv` says only "Data used with permission.", a permission given to
  OpenMS that a redistributor cannot rely on; the `.json` states nothing, and
  the MODOMICS site asks for a citation and states no licence. ANA-004's
  results are the same without them (measured, table above).
- Keep `CV/brenda.obo`: the mzML reader does not start without it (measured).
  Its file states no terms; OBO Foundry lists the BRENDA Tissue Ontology as
  CC BY 4.0, so the licence slice confirms that this applies to the shipped
  2008 export and adds the attribution (decision 6). Shipping tier 3 depends
  on that check.
- Measured as one copy (tier 3 without HMDB and Modomics): 1,790 files,
  149,664,787 bytes, about 35.5 MB compressed; the adapter's rows, evidence,
  outcome and loaded modules match the full runtime's within 1e-6 relative
  (no difference in this run) on the one fixture and two targets above.
- These figures are for the cp313 runtime that exists today. Under decision 8
  the cp314 wheels are re-inventoried in delivery step 1: the same exclusion
  rules, a new manifest and new counts, and a check that their native
  libraries (Qt, the MSVC runtime, OpenBLAS) are the ones decision 6 lists.
- Keep `Qt6Network.dll`: the engine does not load without it.
- The release lock lists only the shipped wheels, installed without their
  declared dependencies, and the provisioning script records the exclusions
  and fails if an excluded package reappears. Changing the lock is also what
  ends the Pillow alerts: Dependabot reads the lock, not the manifest. The
  alerts come from the experiment lock
  (`experiments/m9_0/runtime/requirements-cp313-win_amd64.lock.txt`, still read
  by `scripts/provision_targeted_ms1_runtime.py`), so they close only when that
  file is deleted or bumped to Pillow 13.0.0 in the same change.
- Removing Pillow rather than bumping it departs from the owner's recorded
  route ("Pillow at the next runtime re-provisioning", with the 13.0.0 wheel
  named in `DEPENDENCY_POLICY.md`) and needs the owner's confirmation (open
  question 4).
- The other `share/OpenMS` data files with terms written in them are listed in
  decision 6. Those whose file states no terms (`CHEMISTRY/PSI-MOD.obo`,
  `CV/unimod.obo`, `CV/unit.obo`, `CV/quality.obo`, `CV/goslim_goa.obo`,
  `CV/qc-cv.obo`, `CV/qc-cv-legacy.obo`, `CV/psi-mzdata.obo` and the rest of
  `share/OpenMS`: the other `CHEMISTRY` and `SCHEMAS` files, `MAPPING`,
  `NUXL`, `SCRIPTS`, `TOOLS`, `XSL` and the smaller folders) are unresolved: the
  licence slice finds each one's terms at its source and measures, as above,
  whether one without usable terms can be left out.

### 5. Updates and security alerts

- **Where alerts come from.** Dependabot covers only the release lock
  (fact 9). Each other source is watched by the maintainer named for it in the
  release checklist:
  - CPython and what its embeddable carries (OpenSSL, SQLite, libffi, zlib,
    expat): python.org's security announcements and the chosen line's release
    schedule;
  - OpenSSL itself: OpenSSL's vulnerabilities page, to know when a CPython
    release must be taken early;
  - Qt 6.8.3: Qt's security advisories;
  - OpenMS and its statically linked libraries: OpenMS releases and advisories;
  - all of these together: the runtime package carries an SBOM (each component
    and version of decision 6, generated with the notices), and a scheduled
    scan checks it against a public vulnerability database. The scanning tool
    is its own decision; no dependency is approved here.
- An alert is triaged against what ships and what loads (the probe above).
  - An alert on a package that is not shipped is closed by the lock change.
  - An alert on a loaded component (CPython and its OpenSSL, numpy, pandas,
    OpenBLAS, Qt, OpenMS and its statically linked libraries) is fixed by a new
    runtime and an application release that pins it. Critical ones do not wait
    for the next planned release.
  - MSCanvas does not rebuild CPython, OpenMS or Qt. A fix in the interpreter
    arrives with an official binary release of the shipped line (decision 8);
    a fix in Qt, OpenMS or a library linked into it waits for a pyOpenMS wheel
    that carries it, and until then the alert stays open with that reason
    recorded.
- A new runtime installs beside the old one (digest-named folders). An
  application rolled back to an earlier build finds the runtime it pins.
- Plans recorded under the old digest answer `PlanNotCurrent` and are
  re-reviewed; stored results stay readable without any runtime, as today.
- **Alternative, not recommended now:** an application that accepts a list of
  manifest digests, so a runtime fix could ship without an application release.
  It weakens "one runtime identity per build" and the plan binding, and needs
  its own design.

### 6. Licence notices for every component

The runtime package carries `ANALYSIS_RUNTIME_NOTICES.md`, generated by a
sibling of `scripts/generate_notices.py` from the files in the runtime plus
texts MSCanvas must supply. `THIRD_PARTY_NOTICES.md` points to it, and its
sentence that MSCanvas "redistributes no … OpenMS, pyOpenMS" changes in the
release that ships the package.

| Component (in tier 3) | Licence | Source of the text | Obligation and status |
| --- | --- | --- | --- |
| CPython embeddable (3.13.15 today; the shipped line per decision 8), with its bzip2, libffi, OpenSSL (Apache-2.0), SQLite, zlib, expat and others | PSF and the listed licences | the shipped embeddable's `LICENSE.txt` | reproduce it |
| MSVC runtime: `vcruntime140*`, `msvcp140*`, `concrt140`, `vcomp140` (14.44) in `pyopenms/`, `msvcp140` copies in `numpy.libs` and `pandas.libs`, and CPython's own | Microsoft Visual Studio redistributable terms | CPython's `LICENSE.txt` states the terms for its copies; the others carry none | **open**: whether MSCanvas may redistribute the copies built by OpenMS, numpy and pandas under the terms that bound their builders needs a reading |
| OpenMS 3.5.0 (`OpenMS.dll`, `OpenSwathAlgo.dll`, `_pyopenms_*.pyd`) | BSD-3-Clause | not in the wheel (its `dist-info` has no licence file; `share/OpenMS/THIRDPARTY/ReadMe.txt` says the folder is "only … filled by our packaging scripts") | MSCanvas writes the notice and disclaimer from upstream `LICENSE` |
| Statically linked into `OpenMS.dll` (contrib list at the 3.5.0 submodule pin, the 3.5.0 source tree's `src/openms/extern/`, and a string scan): Boost, Xerces-C, COIN-OR Cbc/Clp, Eigen, SQLite, bzip2, Arrow/Parquet, IsoSpec, nlohmann_json, yaml-cpp, zstd, evergreen, zlib, **libSVM** (its model-file keywords `c_svc`, `nu_svr`, `kernel_type`, `nr_class`, `total_sv` are in the DLL), **GTE**, Wild Magic's successor (`@gte@@` symbols); to confirm by SBOM: SQLiteCpp (`@SQLite@@`), eol-bspline, tool_description_lib, Quadtree, simde | per library, to confirm against each upstream at the linked version. Known: Boost and GTE BSL-1.0, Xerces-C and Arrow Apache-2.0, COIN-OR **EPL** (1.0 in the 3.5.0 contrib list), Eigen **MPL-2.0**, SQLite public domain, libSVM BSD-3-Clause, SQLiteCpp MIT, zlib and bzip2 their own permissive licences; the rest permissive per the research lane | upstream, per library | notices; EPL §3 and MPL-2.0 §3.2 require telling users how to get the source (a pointer to the exact upstream release); the exact list and versions need the OpenMS build's SBOM or link map |
| Qt 6.8.3 (`Qt6Core.dll`, `Qt6Network.dll`), with the third-party code Qt compiles in (at least PCRE2 in `Qt6Core.dll`: `PCRE2` and `pcre2_` strings) | **LGPL-3.0**; PCRE2 BSD-3-Clause with its exception; the rest per Qt's attributions | not in the wheel; Qt's list is the `qt_attribution.json` files of qtbase v6.8.3 for Core and Network | the LGPL-3.0 **and** GPL-3.0 texts (LGPL-3 §4(b): "Accompany the Combined Work with a copy of the GNU GPL and this license document"), the notice, a source offer for Qt 6.8.3, a notice for each attributed component; the replaceability question below |
| `zlib.dll` 1.3.1 | zlib | not in the wheel | notice |
| numpy 2.5.3 with OpenBLAS, LAPACK and the GCC runtime library in `numpy.libs` | BSD-3-Clause, 0BSD, MIT, Zlib, CC0-1.0; OpenBLAS BSD-3-Clause; LAPACK BSD-3-Clause-Open-MPI; GCC runtime GPL-3.0-or-later WITH GCC-exception-3.1 | numpy's `dist-info/licenses/` | reproduce them; the GCC exception covers the statically linked runtime |
| pandas 3.0.6, with the code it carries from other projects | BSD-3-Clause, and per component | its `dist-info/LICENSE` has only pandas's own 31-line BSD-3 text, while its code points elsewhere (`pandas/io/clipboard/__init__.py`: "Licence at LICENSES/PYPERCLIP_LICENSE"); the wheel has no `LICENSES/` folder | reproduce pandas's licence and the whole `LICENSES/` folder of upstream pandas v3.0.6: `BOTTLENECK_LICENCE`, `DATEUTIL_LICENSE`, `HAVEN_LICENSE`, `HAVEN_MIT`, `KLIB_LICENSE`, `MUSL_LICENSE`, `NUMPY_LICENSE`, `PACKAGING_LICENSE`, `PSF_LICENSE`, `PYPERCLIP_LICENSE`, `PYUPGRADE_LICENSE`, `SAS7BDAT_LICENSE`, `ULTRAJSON_LICENSE` (shipping all 13 costs nothing and avoids sorting test-only ones out) |
| python-dateutil 2.9.0.post0, six 1.17.0, tzdata 2026.4 | Apache-2.0 and BSD-3-Clause (its `LICENSE`: "The above BSD License Applies to all code, even that also covered by Apache 2.0"); MIT; Apache-2.0 | each `dist-info` | reproduce them |
| OpenMS data with terms in the file: `CV/psi-ms.obo`; `CHEMISTRY/XLMOD.obo`; `CHEMISTRY/unimod.xml`; six `SCHEMAS/*.xsd` (FuGElight 1.0.0, mzIdentML 1.0.0 and 1.1.0, mzQCML 0.0.5, mzQuantML 1.0.0-rc2, qcML 0.0.7) | CC BY 4.0 ("This work is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) license."); CC BY 3.0 Unported; the Design Science License ("Copyright (C) 2002-2006 Unimod"); CC BY 2.0 | the files' own headers; the licence texts upstream | attribution and the licence or its URI for each CC BY file; the Design Science License text, which the `unimod.xml` header calls "accompanying" and the wheel does not carry |
| `CV/brenda.obo` (BRENDA Tissue Ontology, 2008 export) | CC BY 4.0 per OBO Foundry's registry entry; the file states none | OBO Foundry's BTO page | attribution; **open**: confirm that the registry's licence covers this export (decision 4) |

Not shipped, so no notice: HMDB data (`HMDBMappingFile.tsv`, HMDB terms,
decision 4), the Modomics files (decision 4) and the matplotlib stack removed
in tier 1. The data files whose file states no terms are unresolved
(decision 4).

Not linked into `OpenMS.dll` 3.5.0, by the same scan, so no notice: **GLPK**
(GPL-3.0 in the contrib list; the DLL has no `glp_` symbol and carries the
string "GLPK is not available"); HDF5 (no `HDF5Connector`, `H5open` or
`H5Fcreate`; the `H5…` hits are chemical formulas); Kiss FFT and Wild Magic
(no marker, and neither is in the 3.5.0 source tree); the contrib list's
QT5Base and QT5SVG (3.5.0 uses Qt 6, above). OpenMP comes from MSVC's
`vcomp140.dll`, covered by the MSVC row, not from LLVM's. A header-only library
(Eigen, simde, nlohmann_json) leaves no string, so a zero count proves nothing
for those; the SBOM or link map decides.

**The LGPL-3 question.** LGPL-3 §4(d)(1) allows a shared-library mechanism
that "will operate properly with a modified version of the Library that is
interface-compatible with the Linked Version". The supervisor refuses to
launch when `Qt6Core.dll` differs from the manifest. Whether that refusal
conflicts with the user's right to swap the library is a legal reading, not an
engineering one. The options:

1. **Keep the refusal; document the route.** Ship the LGPL-3.0 and GPL-3.0
   texts, the notices and a Qt 6.8.3 source offer, and state that a modified
   Qt makes MSCanvas refuse the runtime while the user stays free to run
   OpenMS with it outside MSCanvas. Cheapest; depends on the legal reading.
2. **A declared modified runtime.** The user marks the runtime as modified;
   MSCanvas records the swapped files' digests in the run and marks every
   result from it as produced by a modified runtime, never as the pinned
   engine. Honours replaceability without a silent fallback; costs a schema
   word and interface work.
3. **No Qt.** Ship 3.6.0 (no Qt), with its own costs (the version table).

Recommendation: option 1 for the first release **if** a legal reading accepts
it; option 2 otherwise. Open question 5.

### 7. Confinement

What a Job object can and cannot do: the current Job (kill on close, one
active process, 4 GiB, below-normal priority) already stops the worker from
starting any child process, but no Job limit blocks a socket.

- **Before the release (code, no measurement needed):**
  - add the Job UI restrictions (desktop, display settings, exit Windows,
    global atoms, user handles, clipboard read and write, system parameters)
    and `JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION`, so a crash never waits on
    an error dialog;
  - add `OPENMS_DISABLE_UPDATE_CHECK=1` to the worker's environment. M9.0 found
    the update check only in TOPP tools, which no recipe runs; this is defence
    in depth for new entry points.
- **Network and filesystem: an AppContainer, after a measurement.** A worker
  started in an AppContainer with no capabilities has no network access and
  can open only what grants the container access. That is both missing
  confinements at once, without administrator rights at run time.
  - The runtime under Program Files is readable by default (decision 2); the
    attempt directory needs an access entry for the container.
  - The ADR 0049 hard link shares the source file's security descriptor, so
    the container cannot read it unless the user's own file is changed, which
    MSCanvas must not do. OpenMS opens its input by path, so inside a
    container the verified-copy route (one full read and a copy per attempt)
    would be the only route.
  - Unmeasured: whether CPython, numpy and pyOpenMS run in an AppContainer at
    all, and what the copy route costs on multi-GB sources.
- **Interim defence in depth:** the elevated runtime installer adds an
  outbound-block Windows Firewall rule for the runtime's `python.exe`. It only
  works while Windows Defender Firewall is the active firewall, so it is not
  a confinement claim. A rule matches one program path, so there is one rule
  per digest folder, named after the digest: install and repair add it,
  uninstalling that digest removes it (decision 9).

Recommendation: the release needs the Job additions, the environment variable
and the AppContainer measurement. If the engine cannot run in an
AppContainer, the owner decides whether to ship with the firewall rule and a
stated limit (open question 6).

### 8. Engine and interpreter: pyOpenMS 3.5.0 on CPython 3.14

Ship pyOpenMS 3.5.0: ANA-004 is qualified on it, and nothing in the first
untargeted slice (single-file feature detection) depends on a 3.6.0 fix.
Decide the bump before alignment and linking, where #10157 and #10148 matter.
A bump means a new manifest, an application release, ANA-004 re-qualification
and, for 3.6.0, leaving out and measuring without the Thermo folder.

Ship it on **CPython 3.14** (the newest 3.14 embeddable when the package is
built, 3.14.10 today) with the cp314 wheels of the same pyOpenMS, numpy and
pandas versions, not on the pinned 3.13.15
([interpreter options](#interpreter)):

- 3.13.15 ships an unsupported OpenSSL (fact 8) and is two binary releases
  behind; 3.13.17 fixes OpenSSL but is the last 3.13 build, and 3.13.18 was
  already source only four days later. 3.14 has official binaries until about
  October 2027.
- Delivery step 1 already builds a new manifest and re-runs ANA-004, because
  tier 3 changes the digest. With 3.14 that step becomes the full M9.0
  qualification protocol on the new binaries, including the binary32 drift
  check; whether ANA-004 runs on cp314 at all is unmeasured.
- The runtime follows the 3.14 line's security releases (decision 5) and moves
  to the next line before 3.14's binaries end, when pyOpenMS has wheels for it.
- **Alternatives:** 3.13.17 if the 3.14 qualification fails (no wheel change,
  but a dead end for interpreter fixes, and only by the owner's decision, never
  as a fallback); building CPython from source, rejected for now because it
  gives MSCanvas a build toolchain and a security duty for the interpreter.

### 9. Uninstall and repair

- **Uninstall.** The runtime package has its own entry in Installed apps and
  removes only its digest folders and each one's firewall rule (decision 7).
  It never touches projects, sources, stored results or any work area.
- **The application's uninstaller** does not remove the per-machine runtime
  (it has no elevation) and says how to remove it. Its "delete the
  application data" option also removes the current user's work area. Today
  that option covers only the application's own data
  (`%LOCALAPPDATA%\org.mscanvas.desktop` and its registry key, per the beta-1
  install and support guide) and `tauri.conf.json` declares no installer
  hooks, so both need a new NSIS hook in the application installer (New code,
  under Consequences).
- **Repair.** A failed pre-launch verification already answers
  `runtimeUnverified`. Its message names the repair: run the runtime package
  again and choose Repair. Repair extracts into staging, verifies, removes the
  damaged digest folder and publishes the verified one by rename. It never
  overwrites files in place and never downloads anything. It also re-adds the
  digest's firewall rule if missing, and removes every `work\<SID>` folder
  whose owner is not that SID (decision 2).
- **Several application builds.** Each pins one digest. The runtime package
  lists the digest folders present; removing one that the installed
  application pins asks first.
- Stored results stay readable after the runtime is removed (M9 contract).

### 10. Dependency approval and provisioning

Shipping makes the shipped wheels production dependencies, so the owner
approves them with this record's rationale: they are the versions ANA-004 was
qualified on (as cp314 builds under decision 8), pinned by hash. The release
lock (decision 4) replaces the experiment lock: in the same change the
experiment lock is deleted, or bumped to Pillow 13.0.0 if the owner keeps it
for development (open question 4), so that its 41 alerts close.
Provisioning becomes a release-workflow step that builds the package and its
manifest offline from the hash-locked wheels; a release-workflow change also
needs the owner's approval.

### 11. Delivery order

1. **Provisioning and contents:** the release lock on the chosen interpreter
   (decision 8), tier 3 and the exclusion check, the new manifest digest,
   ANA-004 re-qualified on it.
2. **Notices:** the notices generator, `ANALYSIS_RUNTIME_NOTICES.md`, the
   upstream texts and source offers, the legal readings of decision 6.
3. **Package and location:** the elevated runtime installer, the ASCII and
   DACL checks, the release build's runtime and work-area locations, repair
   and uninstall.
4. **Confinement:** the Job additions and environment variable, then the
   AppContainer measurement.
5. **Installed qualification:** ANA-004 on the installed runtime in a user
   account whose name is not ASCII, with sources on another volume, under a
   standard user; verification time; uninstall and repair.

## Alternatives rejected

- **User-installed Python (C).** It cannot be pinned, so results lose their
  engine identity; it is the packaging gate's "unexplained consumer
  requirement".
- **Download by the application (B2), for the first release.** A new network
  capability and probably a new dependency, for a step a release page already
  serves. It can follow later if users ask for it.
- **A per-user runtime below `%LOCALAPPDATA%`.** Non-ASCII for non-ASCII user
  names; the engine fails there (measured in M9.0).
- **Relying on 8.3 short names or a UTF-8 code page.** M9.0 found 8.3 names
  unavailable on its volume, and the UTF-8 code page is unmeasured; neither is
  under MSCanvas's control.
- **Removing `Qt6Network.dll` to shrink the network surface.** Measured: the
  engine does not load without it.
- **Bundling more packages now** (scipy, scikit-learn, matchms, statsmodels).
  The statistics plan runs in Rust; each package is a separate approval and a
  new manifest.

## Consequences

- No pyOpenMS function reaches a user until this lands; Rust-only analysis
  does not wait for it.
- Every runtime change, a security fix included, is an application release and
  re-reviews plans (`PlanNotCurrent`); stored results are unaffected.
- The application stays a per-user install; analysis users install a second,
  elevated package once per runtime version.
- Shipping tier 3 ends the Pillow alerts for what ships, once the release lock
  replaces the experiment lock and that lock is deleted or bumped.
- The runtime's interpreter line has a binary horizon of about two years, so a
  line move (and its re-qualification) recurs.
- New code: the release build's runtime and work-area locations, the ASCII and
  owner checks, the Job additions, the notices generator, the runtime
  installer and its workflow step, the installer's project-owned SHA-256
  verifier (decision 3), and the application uninstaller's NSIS hook for the
  work area and the runtime notice (decision 9). Each is a slice with tests.

## What this amends, if accepted

- `ANALYSIS_WORKERS.md`: the packaging gate is answered by this record.
- The M9 closure's remaining limits: runtime packaging, licence qualification,
  installer and update path, and the ASCII location rows point here.
- `THIRD_PARTY_NOTICES.md` and `scripts/generate_notices.py`: the runtime
  notices, in the release that ships the package.
- The experiment lock and the provisioning script: replaced by the release
  lock and its build step; the experiment lock is deleted or bumped to Pillow
  13.0.0 in the same change (decision 10).
- ADR 0047's targeted-MS1 runtime section stays true for beta 1; the release
  that ships the package records its own scope.

## Open questions for the owner

1. **Distribution.** A separate runtime package the user downloads (B1,
   recommended; elevation for analysis users only, with UAC's
   unknown-publisher prompt while unsigned), the same package downloaded by
   the application (B2), or inside the application installer (A, 36–55 MB more
   and elevation for every user)?
2. **Location.** Per machine under Program Files with an elevated runtime
   installer (recommended), with the work area under ProgramData by user SID?
3. **Without administrator rights.** Offer a user-chosen ASCII folder with a
   protected DACL (which reopens the verification gap and needs a per-user
   pointer and an AppContainer entry), or require elevation?
4. **Contents.** Ship tier 3 and leave out `HMDBMappingFile.tsv` and the two
   Modomics files (all recommended; 1,790 files, ANA-004 matches the full
   runtime on the one fixture measured)? Two preconditions: `brenda.obo` cannot
   be left out (the mzML reader needs it), so its terms must be confirmed, and
   the data files whose file states no terms are resolved by the licence
   slice. Tier 3 removes Pillow instead of bumping it to 13.0.0, unlike the
   recorded route; confirm, and delete or bump the experiment lock in the same
   change?
5. **Qt LGPL-3.** Ask for a legal reading of the manifest refusal against
   §4(d)(1); if it does not hold, build the declared-modified-runtime mode, or
   move to 3.6.0 without Qt?
6. **Network confinement.** Is an AppContainer worker a release requirement,
   or may a release ship with the firewall rule and a stated limit if the
   measurement fails?
7. **Engine version.** 3.5.0 for the first runtime release (recommended), with
   the bump decided before alignment and linking?
8. **Dependencies.** Approve the shipped wheels as production dependencies,
   and the release-workflow change that builds the package?
9. **MSVC runtime copies.** Ask for a reading on redistributing the MSVC DLLs
   that the OpenMS, numpy and pandas builds carry?
10. **Interpreter.** Move the runtime to CPython 3.14 with the cp314 wheels
    and re-qualify ANA-004 on it (recommended), stay on 3.13 with its last
    binary build 3.13.17, or build CPython from source?
