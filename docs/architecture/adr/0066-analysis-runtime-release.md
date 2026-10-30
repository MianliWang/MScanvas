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

**What is open.** The M9 closure's remaining limits, the after-beta-1 plan
(7.1) and `ANALYSIS_WORKERS.md`'s packaging gate leave these for "a release
that ships the runtime":

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
   (`tauri.conf.json`) installs below `%LOCALAPPDATA%`, which contains the
   Windows user name. A Chinese user name makes that path non-ASCII.
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
   Shipping the runtime makes its 14 wheels production dependencies under
   AGENTS.md's dependency policy.
6. **Security alerts.** 41 open Dependabot alerts are Pillow in the runtime
   lock (in the alert list exported on 2026-10-29: 5 critical, 23 high,
   13 medium, each fixed in Pillow 13.0.0). The owner
   kept them open on 2026-10-30, to be fixed "when that runtime is next
   provisioned and before any release ships the runtime".

## Measurements (2026-10-30)

**Method.** The provisioned runtime in the main checkout was copied into a
scratch folder with an ASCII path and checked against the pin first: the
manifest's SHA-256 equals `RUNTIME_MANIFEST_SHA256`, and all 4,628 files
match their entries, with nothing extra or missing. Nothing was re-provisioned,
and the main checkout's runtime was only read. Every run below used the
reviewed adapter (`adapter_v1.py` from `origin/main` at `7ac5a219`, SHA-256
`ed3f7fbd…21afb0ac`), launched the way the supervisor launches it: argv
`python.exe -I -B -X utf8 adapter_v1.py request.json out`, an emptied
environment with `PATH` (the runtime, `System32`, Windows), `SystemRoot`,
`WINDIR`, `TEMP` and `TMP` in the attempt's `tmp`, `OPENMS_HOME_PATH` in its
`home`, and `OMP_NUM_THREADS=1`. The request was a schema-1 request with two
targets (`C8H10N4O2`, `C8H9NO2`, RT 60 s ± 20 s, 5 ppm, 6 s) on M9.0's
synthetic fixture `fmt_plain.mzML` (387,661 bytes, `2f4489d1…`). The runs were
not inside a Job object. Scripts and outputs are in the maintainer's scratch
folder, not committed.

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
digits of computed m/z), so a tier is counted as equal when every key, word and
status matches and every number is within 1e-6 relative.

| Copy | Removed | Files | Bytes | Compressed (estimate) | Adapter | Against the full copy |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Full | — | 4,628 | 348,698,831 | 55,460,860 | `completed` | 8.8e-8 between its own two runs |
| Tier 1 | matplotlib, `mpl_toolkits`, `pylab.py`, Pillow, fontTools, contourpy, cycler, kiwisolver, pyparsing, packaging (each with its `.dist-info`), `bin/` (6 launcher `.exe`), `share/man`, `pyopenms/plotting.py` | 3,426 | 296,245,907 | 43,923,548 | `completed` | equal (7.96e-8) |
| Tier 2 | tier 1 + `pyopenms/*.cpp` and `pyopenms/*.pyi` | 3,408 | 172,239,655 | — | `completed` | equal (7.96e-8) |
| Tier 3 | tier 2 + every `tests/` folder in numpy and pandas | 1,793 | 152,113,369 | 35,819,244 | `completed` | equal (no difference in this run) |
| Without HMDB | `pyopenms/share/OpenMS/CHEMISTRY/HMDBMappingFile.tsv` (2,217,569 B) | 4,627 | 346,481,262 | — | `completed` | equal (7.96e-8) |
| Without `Qt6Network.dll` | that DLL (1,755,784 B) | 4,627 | 346,943,047 | — | **`failed`**, `INTERNAL` | — |

The `Qt6Network.dll` copy failed at import, with the Windows message in the
host's language: `ImportError: DLL load failed while importing _pyopenms_1:
找不到指定的模块。` ("the specified module could not be found"). Qt's network
library is therefore a load-time dependency of `OpenMS.dll` in 3.5.0 and cannot
be removed to reduce the network surface.

"Compressed" tars the copy in sorted order and compresses it with LZMA2 (xz,
preset 6, 8 MiB dictionary). That approximates the increment of an NSIS
installer, whose Tauri default is solid LZMA with an 8 MB dictionary; it is
not a built installer. Generated source and test suites compress well: the
144 MB that tier 3 removes beyond tier 1 save only 8.1 MB compressed.

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
| ASCII location | inherits the per-user install path below `%LOCALAPPDATA%`, non-ASCII for a non-ASCII user name, unless the runtime is placed elsewhere; the application installer would then need elevation or a second location | its own location, chosen for the runtime (decision 2), while the application stays a per-user, unelevated install | the user's choice; nothing guarantees ASCII |
| Integrity | the manifest pin, as today | the manifest pin, as today, plus the package's published SHA-256 and build attestation | **none**: a user's environment cannot match a pinned manifest, so the identity guarantee of ANA-004 (the pinned digest in every plan) is lost |
| Updates | every runtime fix is an application release (fact 1) | the same: a runtime fix is an application release with a matching package | the user's, untracked; the result names an engine nobody can reproduce |
| Licence notices | MSCanvas's installer carries them | the runtime package carries them | the user's installation carries them; MSCanvas redistributes nothing |
| Support cost | lowest for the user, highest download | one more step, documented | highest: versions, wheels, paths, PATH, antivirus, user support |

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

### Contents

- **The full runtime**, as provisioned.
- **Tier 1**: no matplotlib stack. It removes Pillow, so the 41 alerts no longer
  apply to what ships.
- **Tier 3**: tier 1 without generated source, stubs and test suites. It is
  the smallest measured copy, and ANA-004's results in it equal the full
  runtime's.

pyOpenMS 3.5.0 declares `matplotlib>=3.5` in `Requires-Dist`, so the slimmed
runtime is a manifest-level exclusion, not something pip would produce. An
import of `pyopenms.plotting` fails in it; no recipe imports that module.

## Decisions (recommended)

### 1. Distribution: a separate, verified runtime package (B)

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
  under the digest it pins. Nothing else is searched: no `PATH`, no registry
  lookup of other Pythons, no user-chosen interpreter.
- When it is missing, the plan review says so (`recipeUnavailable`, as today)
  and names the package to install.

**Why not A.** Every user pays 36–55 MB more (estimate) for a feature most of
them may not use yet, and the per-user installer would need elevation, or a
second location, to give the runtime an ASCII path. B keeps the application
install unchanged. If the owner prefers one download, A works with the same
location rule (decision 2), at the cost of elevation for every user.

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
  Administrators) and its owner checked before every use. A folder that exists
  with another owner or a wider DACL is a typed refusal, never a reason to use
  another folder.
  - `icacls` on this machine: `C:\ProgramData` lets Users create folders
    (`(CI)(WD,AD,WEA,WA)`) and gives the creator full control, others read; the
    drive root gives Authenticated Users Modify on everything created below it
    (`(OI)(CI)(IO)(M)`). A folder at `C:\` would therefore need its DACL set
    explicitly; ProgramData plus the owner check is the smaller rule.
  - The elevated runtime installer creates `%ProgramData%\MSCanvas\work\`
    itself, with an explicit DACL, so that no user owns the parent of another
    user's work area.
  - The SID is ASCII; the user name never appears in the path.
  - The hard-link route of ADR 0049 needs the work area on the source's
    volume. Sources on other volumes take the verified-copy route, as today.

**Alternative for users without administrator rights:** a user-chosen folder
whose full path is ASCII, created by the runtime installer with a protected
DACL. It is offered only when elevation is refused, and the user picks it; it
is never chosen silently (open question 3).

### 3. Integrity: the pinned manifest, and nothing silent

- The package carries the canonical manifest. The installer extracts into a
  staging folder beside the target, verifies every file against the manifest
  and the manifest against the digest the package was built for, and only
  then publishes the folder by a rename that never replaces an existing one.
- The application keeps verifying every file before every launch, as today.
  The installed location's cost is measured in the qualification slice; a
  cheaper check (for example once per session on an administrator-only
  folder) would be its own decision.
- **Never a silent update.** The application never fetches, patches or swaps
  a runtime. A new runtime arrives only as a new package the user installs,
  and only an application build that pins its digest uses it.

### 4. Contents: tier 3, without the HMDB file

- Ship tier 3: no matplotlib stack, no generated `.cpp`, no `.pyi`, no numpy or
  pandas test suites. Measured: the adapter's rows, evidence, outcome and
  loaded modules equal the full runtime's; 1,793 files and 152,113,369 bytes.
- Leave out `HMDBMappingFile.tsv`. ANA-004 does not read it (measured). Its
  terms reportedly require the authors' permission for commercial
  redistribution (the wording is still unverified at the source), and MSCanvas
  is Apache-2.0, open to commercial users. A later accurate-mass search takes a
  user-supplied database.
- Keep `Qt6Network.dll`: the engine does not load without it.
- The release lock lists only the shipped wheels, installed without their
  declared dependencies, and the provisioning script records the exclusions
  and fails if an excluded package reappears. Changing the lock is also what
  ends the Pillow alerts: Dependabot reads the lock, not the manifest.
- The remaining `share/OpenMS` data (`CHEMISTRY`, `CV` and others) has not been
  audited for terms; the licence slice does it.

### 5. Updates and security alerts

- An alert is triaged against what ships and what loads (the probe above).
  - An alert on a package that is not shipped is closed by the lock change.
  - An alert on a loaded component (CPython and its OpenSSL, numpy, pandas,
    OpenBLAS, Qt, OpenMS and its statically linked libraries) is fixed by a new
    runtime and an application release that pins it. Critical ones do not wait
    for the next planned release.
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
| CPython 3.13.15 embeddable, with its bzip2, libffi, OpenSSL (Apache-2.0), SQLite, zlib, expat and others | PSF and the listed licences | the embeddable's `LICENSE.txt` | reproduce it |
| MSVC runtime: `vcruntime140*`, `msvcp140*`, `concrt140`, `vcomp140` (14.44) in `pyopenms/`, `msvcp140` copies in `numpy.libs` and `pandas.libs`, and CPython's own | Microsoft Visual Studio redistributable terms | CPython's `LICENSE.txt` states the terms for its copies; the others carry none | **open**: whether MSCanvas may redistribute the copies built by OpenMS, numpy and pandas under the terms that bound their builders needs a reading |
| OpenMS 3.5.0 (`OpenMS.dll`, `OpenSwathAlgo.dll`, `_pyopenms_*.pyd`) | BSD-3-Clause | not in the wheel (its `dist-info` has no licence file; `share/OpenMS/THIRDPARTY/ReadMe.txt` says the folder is "only … filled by our packaging scripts") | MSCanvas writes the notice and disclaimer from upstream `LICENSE` |
| Statically linked into `OpenMS.dll` (contrib list at the 3.5.0 submodule pin, and a string scan): Boost, Xerces-C, COIN-OR Cbc/Clp, Eigen, SQLite, bzip2, Arrow/Parquet, IsoSpec, nlohmann_json, yaml-cpp, zstd, evergreen, zlib | per library, to confirm against each upstream at the linked version. Known: Boost BSL-1.0, Xerces-C and Arrow Apache-2.0, COIN-OR **EPL** (1.0 in the 3.5.0 contrib list), Eigen **MPL-2.0**, SQLite public domain, zlib and bzip2 their own permissive licences; the rest permissive per the research lane | upstream, per library | notices; EPL §3 and MPL-2.0 §3.2 require telling users how to get the source (a pointer to the exact upstream release); the exact list and versions need the OpenMS build's SBOM or link map |
| Qt 6.8.3 (`Qt6Core.dll`, `Qt6Network.dll`) | **LGPL-3.0** | not in the wheel | licence text, notice, a source offer for Qt 6.8.3; the replaceability question below |
| `zlib.dll` 1.3.1 | zlib | not in the wheel | notice |
| numpy 2.5.3 with OpenBLAS, LAPACK and the GCC runtime library in `numpy.libs` | BSD-3-Clause, 0BSD, MIT, Zlib, CC0-1.0; OpenBLAS BSD-3-Clause; LAPACK BSD-3-Clause-Open-MPI; GCC runtime GPL-3.0-or-later WITH GCC-exception-3.1 | numpy's `dist-info/licenses/` | reproduce them; the GCC exception covers the statically linked runtime |
| pandas 3.0.6, python-dateutil 2.9.0.post0, six 1.17.0, tzdata 2026.4 | BSD-3-Clause; Apache-2.0 and BSD-3-Clause (its `LICENSE`: "The above BSD License Applies to all code, even that also covered by Apache 2.0"); MIT; Apache-2.0 | each `dist-info` | reproduce them |

**The LGPL-3 question.** LGPL-3 §4(d)(1) allows a shared-library mechanism
that "will operate properly with a modified version of the Library that is
interface-compatible with the Linked Version". The supervisor refuses to
launch when `Qt6Core.dll` differs from the manifest. Whether that refusal
conflicts with the user's right to swap the library is a legal reading, not an
engineering one. The options:

1. **Keep the refusal; document the route.** Ship the LGPL text, the notice and
   a Qt 6.8.3 source offer, and state that a modified Qt makes MSCanvas refuse
   the runtime while the user stays free to run OpenMS with it outside
   MSCanvas. Cheapest; depends on the legal reading.
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
  a confinement claim.

Recommendation: the release needs the Job additions, the environment variable
and the AppContainer measurement. If the engine cannot run in an
AppContainer, the owner decides whether to ship with the firewall rule and a
stated limit (open question 6).

### 8. Engine version: 3.5.0 for the first runtime release

Ship 3.5.0: ANA-004 is qualified on it, and nothing in the first untargeted
slice (single-file feature detection) depends on a 3.6.0 fix. Decide the bump
before alignment and linking, where #10157 and #10148 matter. A bump means a
new manifest, an application release, ANA-004 re-qualification and, for 3.6.0,
leaving out and measuring without the Thermo folder.

### 9. Uninstall and repair

- **Uninstall.** The runtime package has its own entry in Installed apps and
  removes only its digest folders. It never touches projects, sources, stored
  results or any work area. The application's uninstaller does not remove the
  per-machine runtime (it has no elevation) and says how to remove it.
  The application's "delete the application data" option removes the current
  user's work area.
- **Repair.** A failed pre-launch verification already answers
  `runtimeUnverified`. Its message names the repair: run the runtime package
  again and choose Repair. Repair extracts into staging, verifies, removes the
  damaged digest folder and publishes the verified one by rename. It never
  overwrites files in place and never downloads anything.
- **Several application builds.** Each pins one digest. The runtime package
  lists the digest folders present; removing one that the installed
  application pins asks first.
- Stored results stay readable after the runtime is removed (M9 contract).

### 10. Dependency approval and provisioning

Shipping makes the shipped wheels production dependencies, so the owner
approves them with this record's rationale: they are the engine ANA-004 was
qualified on, pinned by hash. The release lock (decision 4) replaces the
experiment lock's header; provisioning becomes a release-workflow step that
builds the package and its manifest offline from the hash-locked wheels; a
release-workflow change also needs the owner's approval.

### 11. Delivery order

1. **Provisioning and contents:** the release lock, tier 3 and the exclusion
   check, the new manifest digest, ANA-004 re-run on it.
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
- **Download by the application.** A new network capability, a new
  dependency and a silent-update risk, for a step a release page already
  serves.
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
- Shipping tier 3 ends the Pillow alerts for what ships, once the lock changes.
- New code: the release build's runtime and work-area locations, the ASCII and
  owner checks, the Job additions, the notices generator, the runtime
  installer and its workflow step. Each is a slice with tests.

## What this amends, if accepted

- `ANALYSIS_WORKERS.md`: the packaging gate is answered by this record.
- The M9 closure's remaining limits: runtime packaging, licence qualification,
  installer and update path, and the ASCII location rows point here.
- `THIRD_PARTY_NOTICES.md` and `scripts/generate_notices.py`: the runtime
  notices, in the release that ships the package.
- The experiment lock's header and the provisioning script: replaced by the
  release lock and its build step.
- ADR 0047's targeted-MS1 runtime section stays true for beta 1; the release
  that ships the package records its own scope.

## Open questions for the owner

1. **Distribution.** A separate runtime package (B, recommended) or inside the
   application installer (A, 36–55 MB more for every user, and elevation)?
2. **Location.** Per machine under Program Files with an elevated runtime
   installer (recommended), with the work area under ProgramData by user SID?
3. **Without administrator rights.** Offer a user-chosen ASCII folder with a
   protected DACL, or require elevation?
4. **Contents.** Ship tier 3 and leave out `HMDBMappingFile.tsv` (both
   recommended)?
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
