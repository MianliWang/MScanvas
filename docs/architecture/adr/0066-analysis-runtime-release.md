# ADR 0066 — Releasing the analysis runtime (CPython and pyOpenMS)

Status: **Accepted**, 2026-11-04, by this record's reading of B-1 and the roadmap and
no wider than the owner's answers, both in the block of that date below. Engine:
pyOpenMS 3.6.0 without Qt on CPython 3.14
([decision 8](#8-engine-and-interpreter-the-owners-rule-on-cpython-314)). Proposed
2026-10-30. Not implemented: nothing here is built, and this status approves no
shipping, release, upload, window or outbound message. What the owner did not answer,
in the blocks below or in a note under a decision, is still the recommendation of
2026-10-30.

> **Owner decision B-1, 2026-10-30** ([OWNER_DECISIONS_V511.md](../../development/OWNER_DECISIONS_V511.md),
> B-1). Decisions 1 and 2 are accepted: a separate, verified runtime package
> beside each release, which the user installs, per machine under
> `%ProgramFiles%\MSCanvas Analysis Runtime\<digest>\`, with the work area
> under `%ProgramData%\MSCanvas\work\<user SID>\`. Every fix to a shipped
> runtime component is an application release (decisions 3 and 5). This
> answers open questions 1, 2, 6 and 8, and question 9 by asking for a
> reading, as recorded [under them](#open-questions-for-the-owner). Question 3
> stays open, with a working default. Questions 4 (B-3), 5 and 7 (B-2) stay
> open, and so does question 10, which no owner decision carries yet. The
> record therefore stays Proposed; B-2 is decided before it is accepted.

> **The owner's answers, 2026-11-03** (decision table version 2026-11-03.2).
> The ids are those of
> [OWNER_DECISIONS_V511.md](../../development/OWNER_DECISIONS_V511.md); its
> section 1d holds the answers (PR #212, merged on 2026-11-04 as `a13d367b`).
> With B-1 above, all ten questions now have an answer
> ([marked under each](#open-questions-for-the-owner)).
>
> - **Question 3: RT-1,** require elevation and add the route when someone
>   needs it. Decision 2's alternative is not built, wherever the text below
>   names it.
> - **Question 4: B-3.1,** tier 3; **B-3.2,** strip the HMDB and Modomics files;
>   **B-3.3,** do not ship matplotlib and Pillow, and delete the experiment
>   lock. This confirms the departure from the recorded Pillow 13.0.0 route, so
>   "deleted or bumped" below now reads "deleted".
> - **Question 5: B-2.2,** use 3.6.0 without Qt (none in its wheel by decision 8's
>   informal check), valid only if the probe passes.
> - **Question 7: B-2.1,** 3.6.0 before release, if the probe passes.
> - **If the probe fails: CK-2,** ship 3.5.0 first and obtain a legal opinion on
>   Qt first. No release without that opinion; its time and cost are unknown.
> - **Question 10: B-2.3,** CPython 3.14, the newest embeddable.
> - **The MSVC copies (question 9): RT-3,** no release until the reading exists.
>   Who reads and how long it takes are not recorded. It blocks the release on
>   either branch, not development.
> - **CK-1 and dependencies:** the first analysis runtime carries no matchms,
>   and no answer approves a new dependency ([decision 10](#10-dependency-approval-and-provisioning)).
>
> **The status stayed Proposed that day.** B-1 and the roadmap's phase 0 exit say
> the record is accepted with its engine version, and the 3.6.0 probe (A-03) had
> not run. [Decision 8](#8-engine-and-interpreter-the-owners-rule-on-cpython-314)
> states the rule, and [what still blocks a release](#what-still-blocks-a-release)
> is listed after the questions. Each 3.6.0 statement added on 2026-11-03 is
> labelled unmeasured or as decision 8's informal check, and the dated note under
> the [engine table](#engine-version) labels those of 2026-10-30. The probe's
> numbers stand beside them, dated 2026-11-04.
>
> **Dated text stays as written.** The B-1 block above and the passages the
> owner answered keep their words, with a dated note beside them. Only decision
> 8's heading and engine paragraph, which B-2.1 replaced, and the mark on decision
> 6's Qt row were changed. Decisions 3 and 5 beyond "every fix is an application
> release", decision 4 beyond its contents and the experiment lock's fate (the
> release lock's mechanics, for one), decision 6 beyond its Qt and MSVC rows,
> decision 7 beyond question 6, decision 8's interpreter alternatives (3.13.17, a
> source build), decision 9 and decision 11 were not asked: they are the text of
> 2026-10-30, not an owner decision.

> **Accepted, 2026-11-04, and no wider than the answers.** B-1 says B-2 is decided
> before this record is accepted, and the roadmap's phase 0 exit says it is accepted
> with its engine version. Both now hold, so the status follows those two lines: a
> reading, not an owner decision. The owner wrote no separate "accepted" for this
> record. What the owner decided:
>
> - **B-1 (2026-10-30):** the block above: decisions 1 and 2, every fix to a shipped
>   component an application release, and questions 6, 8 and 9.
> - **B-2 (2026-11-03):** B-2.1 and B-2.2, pyOpenMS 3.6.0 without Qt if the probe
>   passes; B-2.3, CPython 3.14, the newest embeddable.
> - **B-3 (2026-11-03):** tier 3, without the HMDB and Modomics files and without
>   matplotlib and Pillow, and the experiment lock deleted.
> - **RT-1 and RT-3 (2026-11-03):** require elevation; no release until the MSVC
>   reading exists. RT-3-WHEN (2026-11-04) fixes when it is drafted: after the
>   probe's result, shown to the owner first.
> - **CK-1 (2026-11-03):** the first analysis runtime carries no matchms.
> - **CK-2 (2026-11-03), its branch not taken:** the fallback stays recorded in
>   decision 8, and the Qt opinion is not needed for this runtime.
> - **LIB-1 (2026-11-04):** the owner accepts libiconv's terms, treating it as
>   possibly linked. That is what makes the probe's pass condition hold (decision 8).
> - **Ask 2 (2026-11-04):** the probe's four artefacts for the development runtime
>   and U1 (A-07), with a lock committed. A-03, the same day, approved them for the
>   probe and the AppContainer measurement in a temporary directory (decision 10).
> - **D1 (2026-11-04):** #168, the bump of the experiment lock to Pillow 13.0.0, was
>   closed. Wherever the text below names that bump as a route, B-3.3 and D1 have
>   ended it. D1 dismisses no alert: the Pillow alerts stay open until the lock is
>   deleted.
>
> **What was not asked stays as the block above says:** the text of 2026-10-30, not
> an owner decision, and this status does not change that. LIB-1 adds decision 6's
> libiconv row to what was answered, and nothing else joins. That block lists
> decisions. [Alternatives rejected](#alternatives-rejected) was not asked either,
> beyond what B-1 and CK-1 chose, so "rejected" there is the recommendation's word and
> not the owner's.
>
> **Accepted does not approve shipping.** Ask 3 (A-05) stays open, and so does
> everything under [what still blocks a release](#what-still-blocks-a-release). No
> answer here approves a release, an upload, a window or a message. Ask 2 does not
> accept the nine numbers that ANA-004 moved on 3.6.0: A-07 finds out why and
> reports them (decision 8).
>
> **What changed on this date.** Of the text of 2026-10-30, only the status line at
> the top. Text added on 2026-11-03 that these results overtook is corrected or
> dated where it stands: it recorded the answers and was not itself accepted. The
> 3.6.0 numbers come from the probe's record,
> [RUNTIME_360_PROBE.md](../../spikes/RUNTIME_360_PROBE.md), each cited to its
> section. They measure one scratch copy, and what they do not show is in its
> [section 10](../../spikes/RUNTIME_360_PROBE.md#10-what-this-does-not-show).

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
*2026-11-04:* the [3.6.0 probe's record](../../spikes/RUNTIME_360_PROBE.md) joins them.

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
   *2026-11-04:* on the branch decision 8 names, the probe's shape holds three wheels
   and the embeddable (decision 4's note), and `nanobind-backend` and pyOpenMS 3.6.0 are
   not in this lock. What ships is ask 3 (decision 10).
6. **Security alerts.** 41 open Dependabot alerts are Pillow in the runtime
   lock (in the alert list exported on 2026-10-29: 5 critical, 23 high,
   13 medium, each fixed in Pillow 13.0.0). The owner
   kept them open on 2026-10-30, to be fixed "when that runtime is next
   provisioned and before any release ships the runtime"; `DEPENDENCY_POLICY.md`
   names the fix as the Pillow 13.0.0 wheel.
   *2026-11-04:* that route is left (B-3.3), and #168, the bump, was closed (D1) with
   no alert dismissed. The alerts stay open until the experiment lock is deleted, in
   the change that commits A-07's lock (ask 2).
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
   *2026-11-04:* Qt 6.8.3 and `zlib.dll` belong to the 3.5.0 branch, which is not taken:
   neither is in the probe's shape (decision 6's 3.6.0 rows).

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

*2026-11-03:* this table's 3.6.0 column, decision 4's "3.6.0 adds
`HMDB2StructMapping.tsv`" and option 3 of the LGPL-3 question are the research of
2026-10-30. They were unmeasured that day; see
[decision 8's informal check](#8-engine-and-interpreter-the-owners-rule-on-cpython-314).

*2026-11-04:* what the probe measured for the 3.6.0 column, in the shape that would
ship. The table above keeps its words.

| Row | Measured | Left unmeasured |
| --- | --- | --- |
| Qualification | `adapter_v1.py` completes unedited. Both outcomes match the pinned runtime's, and 9 of 1,043 numbers break the 1e-6 rule, all in the `DETECTED` row: the bounds move in by 0.5 s on each side and `rawArea` falls by 0.18 %. The supervisor would refuse the result until two adapter edits and its own pins change ([sections 6.1](../../spikes/RUNTIME_360_PROBE.md#61-the-edits) and [6.2](../../spikes/RUNTIME_360_PROBE.md#62-the-comparison)). On a variant of the protocol's `main` fixture, a target with no `neutralMass` goes from `DETECTED_AMBIGUOUS` to `DETECTED` ([section 6.3](../../spikes/RUNTIME_360_PROBE.md#63-beyond-the-adrs-request-the-protocols-other-fixtures)) | The M9.0 protocol, the supervisor itself and the cause: A-07's ([section 10](../../spikes/RUNTIME_360_PROBE.md#10-what-this-does-not-show)) |
| Qt (LGPL-3) | None: no Qt DLL, no Qt import in any of the 76 native files, 0 `Qt6` and 0 `QString` in `OpenMS.dll` ([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)), and no `Qt6*` module loaded ([section 7](../../spikes/RUNTIME_360_PROBE.md#7-what-loads)) | — |
| Vendor code | 14 Thermo files left out: the folder's 12 and the 2 outside it ([section 4](../../spikes/RUNTIME_360_PROBE.md#4-the-shape)). 0 Thermo-named files remain, 0 of the 76 native files has a CLR header, and no Thermo module, `hostfxr` or `coreclr` loaded. `OpenMS.dll` keeps the bridge's code (102 `Thermo` and 13 `hostfxr` strings), which was not exercised ([section 7](../../spikes/RUNTIME_360_PROBE.md#7-what-loads)) | RAW input with the bridge missing ([section 10](../../spikes/RUNTIME_360_PROBE.md#10-what-this-does-not-show)) |
| Network-capable code | In `OpenMS.dll`: `libcurl 8.20.0`, and OpenSSL read as 3.6.4 from a bare string beside its source paths and from upstream's build log. The AWS SDK leaves **no marker**, which does not show that it is absent, and that log installs it ([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)). `OpenMS.dll` imports `WS2_32.dll`, `IPHLPAPI.DLL`, `Secur32.dll`, `CRYPT32.dll` and `ncrypt.dll`. `socket`, `_socket`, `select`, `subprocess`, `ssl` and `_ssl` are not loaded; `urllib` is ([section 7](../../spikes/RUNTIME_360_PROBE.md#7-what-loads)) | Whether the engine's network code can be reached, and any confinement ([sections 7](../../spikes/RUNTIME_360_PROBE.md#7-what-loads) and [10](../../spikes/RUNTIME_360_PROBE.md#10-what-this-does-not-show)) |
| Other | `nanobind-backend` 1.0.0, by digest ([section 3](../../spikes/RUNTIME_360_PROBE.md#3-the-four-artefacts)). libiconv: NOT SHOWN ([section 8](../../spikes/RUNTIME_360_PROBE.md#8-libiconv)), and its terms accepted (LIB-1, decision 6). `FeatureGroupingAlgorithmKD` and `MapAlignmentAlgorithmPoseClustering` ran; `MapAlignmentAlgorithmKD` has no 3.6.0 binding and is not a planned class ([section 5.2](../../spikes/RUNTIME_360_PROBE.md#52-the-26-classes)) | Those classes did not run on 3.5.0 ([section 5.3](../../spikes/RUNTIME_360_PROBE.md#53-u1-on-both-engines)), so #10157 and #10148 are not shown |

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

*2026-11-04:* the probe ran CPython 3.14.10, the SHA-256 of fact 8, with `libcrypto-3.dll`
and `libssl-3.dll` 3.5.9
([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)), and
these wheels: `pyopenms-3.6.0-cp311-abi3-win_amd64.whl`,
`nanobind_backend-1.0.0-cp314-cp314-win_amd64.whl` and
`numpy-2.5.3-cp314-cp314-win_amd64.whl`
([section 3](../../spikes/RUNTIME_360_PROBE.md#3-the-four-artefacts)). So ANA-004
completes on 3.14 in that shape. The M9.0 protocol stays A-07's, and which of the
interpreter or the engine moved its numbers is not separated
([section 6.2](../../spikes/RUNTIME_360_PROBE.md#62-the-comparison)). The cp314 builds
of the other versions in this section were not run or inventoried: that branch is
not taken (decision 8).

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

*2026-11-04:* "recommended" is this heading's word of 2026-10-30. What the owner
decided is marked under each decision or, for decisions 3 and 5, in the B-1 block at
the top, and the block of 2026-11-04 says how far the status reaches.

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

> **Decided by the owner, 2026-10-30 (B-1).** B1, as written: a separate,
> verified runtime package beside each release, which the user installs. The
> application downloads nothing.

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

> **Decided by the owner, 2026-10-30 (B-1).** The location is accepted as
> written: per machine under Program Files, with the work area under
> ProgramData by user SID. The alternative above is not built for now. Until
> the owner answers question 3, a user without administrator rights is
> required to elevate; the user-folder route is added when such a user needs
> it.

> **Answered by the owner, 2026-11-03 (RT-1, question 3).** Require elevation,
> and add the route when someone needs it. The alternative above is not built.
> The cost the owner was shown: while the package is unsigned, UAC shows an
> unknown publisher and a site's policy may refuse; without an administrator
> there is no analysis.

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

> **Answered by the owner, 2026-11-03 (B-3.1, B-3.2, B-3.3, question 4).** Tier 3,
> without the HMDB and Modomics files, and without matplotlib and Pillow. B-3.3
> confirms the departure from the recorded Pillow route, and of "deleted or bumped"
> it takes "deleted". The experiment lock goes in the same change as the release
> lock that replaces it. It is not deleted here:
> `scripts/provision_targeted_ms1_runtime.py` still reads it.
>
> The cost the owner was shown: agreement measured on one synthetic file and two
> targets; compressed, only about 8 MB below the tier before it; a longer exclusion
> list, re-measured with each new version or interpreter; no metabolite library out
> of the box, so an accurate-mass search
> needs a database the user chooses; matplotlib excluded by hand, because pyOpenMS
> declares it; and a development environment that can no longer be reproduced from
> the old lock.
>
> *2026-11-04 (ask 2, D1):* the lock that replaces it is A-07's: a lock file for the
> four approved artefacts is committed, and the experiment lock goes in that same
> change. #168, the bump of that lock to Pillow 13.0.0, was closed on this date, and
> no alert was dismissed: the Pillow alerts stay open until the lock is deleted. Not
> built.

> **What 3.6.0's shape also leaves out, on the branch decision 8 names.** The paths
> (under `pyopenms/`) and the metadata below them are from the informal check's copy
> of the wheel, and the next note gives what the probe's shape left out:
>
> - the whole `share/OpenMS/openms_thermo_bridge/` folder (the Thermo
>   RawFileReader assemblies, which AGENTS.md forbids vendoring);
> - `share/OpenMS/LICENSES/ThermoRawFileReader-License.doc`, the licence of those
>   assemblies, which lies outside that folder and needs its own exclusion;
> - `share/OpenMS/LICENSES/vcpkg/openms-thermo-bridge.txt` (1,583 B), also outside
>   that folder: the bridge's own BSD 3-Clause text, headed by the `.doc`'s name and
>   first bytes. These two are the only Thermo-named files outside it, and decision
>   6's 3.6.0 rows take the notices file that names them. The owner's answer names
>   the folder: leaving out these two is a reading, not an owner decision;
> - `share/OpenMS/CHEMISTRY/HMDB2StructMapping.tsv` (49,085,948 B), beside
>   `HMDBMappingFile.tsv` and both Modomics files, which that wheel also carries.
>
> `CV/brenda.obo` stays, and its terms stay a precondition. The `Qt6Network.dll`
> bullet above holds only on the fail branch, which is not taken. 3.6.0 still declares
> matplotlib, adds `nanobind-backend` and makes pandas an extra (informal check). Every
> count, byte figure and "no difference" above is for the cp313 3.5.0 runtime; the
> next note has the probe's.

> **The shape the probe measured, 2026-11-04**
> ([section 4](../../spikes/RUNTIME_360_PROBE.md#4-the-shape),
> [section 9.1](../../spikes/RUNTIME_360_PROBE.md#91-size-and-verification)):
> **621 files, 130,632,028 B, about 33.3 MB compressed** (33,255,864 B, the same LZMA2
> estimate), against 1,790 files, 149,664,787 B and 35,547,248 B above. The last three
> SHA-256 passes over every file took 0.65 to 0.78 s, and every set recorded falls
> between 0.54 s and 3.81 s, the slowest on a busier host; the cost at the installed
> location stays unmeasured. It holds the four artefacts of
> [section 3](../../spikes/RUNTIME_360_PROBE.md#3-the-four-artefacts) and nothing else:
> no pandas, python-dateutil, six or tzdata, no matplotlib stack and no Qt. Left out of
> the wheels:
>
> - the Thermo files: the folder (12 files, 1,769,201 B) and the two above (54,319 B);
> - the HMDB and Modomics files (B-3.2): four files, 51,534,530 B;
> - tiers 2 and 3: `*.pyi` (320 files, 3,386,731 B), one `*.cpp` (6,012 B) and every
>   `tests/` folder (383 files, 6,456,159 B);
> - **the probe's readings, not owner decisions:** `pyopenms/plotting.py` (21,046 B),
>   which tier 1 removes, and the three wheels' `.dist-info/RECORD` (125,373 B).
>
> `CV/brenda.obo` (932,031 B) is kept, because the mzML reader needs it on 3.6.0 too.
> So is the rest of `share/OpenMS`, with `THIRD-PARTY-NOTICES.txt` unedited (decision
> 6). The copy's manifest digest, `50e723ad41aa3857ae812670eea529356d6ade1cb9e24a3f1447b187f5856b83`,
> names that scratch copy: it is no pin and no release manifest, and delivery step 1
> still builds one.
>
> **What B-3 rests on.** 26 of the 26 planned classes ran in this shape on synthetic
> data, with matplotlib, PIL and pandas never loaded
> ([section 5.2](../../spikes/RUNTIME_360_PROBE.md#52-the-26-classes),
> [section 7](../../spikes/RUNTIME_360_PROBE.md#7-what-loads)). Quality was not judged.
> `AccurateMassSearchEngine`'s defaults raise here, because the HMDB files are out, and
> it ran on a scratch database. The other half of A-03, the planned classes on 3.5.0
> without matplotlib and Pillow, did not run
> ([section 11](../../spikes/RUNTIME_360_PROBE.md#11-what-did-not-run)): it runs on a
> failure, and CK-2 is not taken.

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

> **On the branch decision 8 names, 2026-11-03.** A fix in a library linked into
> `OpenMS.dll` waits for a pyOpenMS wheel that carries it, and a newer interpreter
> does not bring it. Two sources join the list above on this branch: OpenSSL's
> vulnerabilities page, now also for the copy linked into `OpenMS.dll`, and curl's
> security advisories. Qt's advisories apply only on the fail branch, which is not
> taken. This note applies decision 5 to B-2.1's linked libraries: a reading, not an
> owner decision.
>
> *2026-11-04, the versions, from the probe's
> [section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries):*
> `libcurl 8.20.0`; OpenSSL 3.6.4, with no version banner in the DLL, read from a bare
> string beside its source paths and from upstream's build log (the 13 advisories are
> the decision page's and were not counted here). The embeddable's own `libcrypto-3.dll`
> is 3.5.9 and loads on the adapter's path through `hashlib`; `libssl-3.dll` does not
> load ([section 7](../../spikes/RUNTIME_360_PROBE.md#7-what-loads)). The probe found no
> SBOM or link map of this build from upstream
> ([section 8](../../spikes/RUNTIME_360_PROBE.md#8-libiconv)), so the SBOM above has
> only that partial inventory to start from: a reading, not an owner decision.

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
| **Fail branch only (CK-2).** Qt 6.8.3 (`Qt6Core.dll`, `Qt6Network.dll`), with the third-party code Qt compiles in (at least PCRE2 in `Qt6Core.dll`: `PCRE2` and `pcre2_` strings) | **LGPL-3.0**; PCRE2 BSD-3-Clause with its exception; the rest per Qt's attributions | not in the wheel; Qt's list is the `qt_attribution.json` files of qtbase v6.8.3 for Core and Network | the LGPL-3.0 **and** GPL-3.0 texts (LGPL-3 §4(b): "Accompany the Combined Work with a copy of the GNU GPL and this license document"), the notice, a source offer for Qt 6.8.3, a notice for each attributed component; the replaceability question below |
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

**3.6.0 rows, the branch decision 8 names (added 2026-11-03; the probe's column,
2026-11-04).** The table and scans above describe 3.5.0. On this branch their rows
for Qt, pandas, python-dateutil, six, tzdata and `zlib.dll` do not apply: none of
those files is in the shape
([sections 9.1](../../spikes/RUNTIME_360_PROBE.md#91-size-and-verification) and
[9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)). Reading these
rows against that shape is a reading, not an owner decision: what ships is ask 3
(decision 10). The informal check's column comes from PyPI and from its copy of the
3.6.0 wheel: `share/OpenMS/THIRD-PARTY-NOTICES.txt` and `share/OpenMS/LICENSES/`. The
notices say "This installation of OpenMS contains the third-party software listed
below", which does not show what is linked into `OpenMS.dll`. Upstream's comment says a
listing holds "the license text of every vcpkg port of the target triplet", and goes on
"An installation carries the code of each port": a statement about ports in general, and
no record of any one port in this DLL
([section 8](../../spikes/RUNTIME_360_PROBE.md#8-libiconv)). So none of these rows is
a licence conclusion. The probe's column is not every port: the notices list 156
entries, upstream's build log installs 155 packages, and only the libraries of
[section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries) were
looked for. The licence slice settles them.

| Component | What the informal check read | What the probe read | Status |
| --- | --- | --- | --- |
| curl | listed in the notices, text in `LICENSES/vcpkg/curl.txt` | in `OpenMS.dll`: `libcurl 8.20.0`; build log: `curl[core,non-http,ssl,sspi]` 8.20.0#1 ([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)) | **open**: the notice |
| The AWS SDK (`aws-sdk-cpp`, `aws-c-*`) | listed in the notices, text in `LICENSES/vcpkg/` | **no marker** in `OpenMS.dll`: 0 for `amazonaws`, `X-Amz`, `S3FileSystem`, `InitializeS3`, `Aws`, `aws-sdk`, `aws-crt`, `aws-c-`. Build log: `aws-sdk-cpp` 1.11.800, `aws-crt-cpp` 0.39.1 ([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)) | **not shown** either way: this does not show that it is absent. Linkage and notice open |
| OpenSSL, linked into `OpenMS.dll` | listed in the notices, text in `LICENSES/vcpkg/openssl.txt`; 3.6.4 on the decision page | no `OpenSSL 3.x` banner; a bare `3.6.4` between OpenSSL's source paths, and 9 paths under `buildtrees\openssl\`; build log: 3.6.4#1 ([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)) | **open**: the notice; this is apart from the embeddable's own copy, 3.5.9 (fact 8) |
| `nanobind-backend` 1.0.0 | a new declared dependency of 3.6.0; PyPI shows no licence field, only a BSD classifier | no licence file: its `.dist-info` holds `DELVEWHEEL`, `METADATA` and `WHEEL`, and `METADATA` has only the classifier ([section 9.4](../../spikes/RUNTIME_360_PROBE.md#94-notices)) | **open**: which licence text ships with it; approved for development and not for shipping (decision 10) |
| COIN-OR | `LICENSES/vcpkg/coin-or-clp.txt` and its neighbours; `coin-or-clp.txt` is EPL 2.0, where the 3.5.0 contrib list says EPL 1.0 | `Cbc` in `OpenMS.dll`, no version; build log: `coin-or-cbc` 2024-06-04#1, `coin-or-clp` 2023-02-01#1 ([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)) | **open**: which COIN-OR libraries are linked, and the notice and source pointer their terms ask for |
| libiconv | listed in the notices, text in `LICENSES/vcpkg/libiconv.txt`; the DLL has 0 `iconv` strings and no such import, which does not prove the absence of a static link | **NOT SHOWN:** no import, string or alias name in the 76 native files, no SBOM or link map of this build, and upstream's statements point both ways; its build installed `libiconv` 1.18 for `libxml2[core,iconv,zlib]` ([section 8](../../spikes/RUNTIME_360_PROBE.md#8-libiconv)) | **terms accepted, treated as possibly linked** (LIB-1, below). How a static link's relink term is met is open |
| The MSVC copies | not inventoried for 3.6.0 | seven files: five at 14.51.36247.0, and one `msvcp140` at 14.40.33810.0 in each of `nanobind_backend.libs` and `numpy.libs`, one digest. Two `msvcp140` versions load in one process ([section 9.3](../../spikes/RUNTIME_360_PROBE.md#93-every-msvc-runtime-copy)) | **open**: RT-3's reading applies on this branch too |
| The other libraries | not inventoried for 3.6.0 | [section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)'s table, and `_arrow_zerocopy.pyd` (7,720,448 B), a static Arrow with zlib and bzip2, never loaded | **open**: the licence slice; a port missing from that table says nothing about that port |
| `openms-thermo-bridge`'s native half | the notices' entry [25], text in `LICENSES/vcpkg/openms-thermo-bridge.txt`, which decision 4's note leaves out | its files are left out; `OpenMS.dll` keeps the bridge's code, 102 `Thermo` and 13 `hostfxr` strings ([section 7](../../spikes/RUNTIME_360_PROBE.md#7-what-loads)), with `get_hostfxr_path` from `nethost`; build log: 0.3.1 ([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)) | **open**: the wheel's notices, read for this row, say "The native bridge library links nethost". That the native half is in this DLL is a reading, with no link map, and no licence conclusion. The BSD 3-Clause text's clause 2 says "Redistributions in binary form must reproduce the above copyright notice", and with that file out the text is only entry [25] of the notices file below, headed by the `.doc`'s name and first bytes. If the licence slice finds it linked, the generated notices keep the BSD text, without that heading |
| `share/OpenMS/THIRD-PARTY-NOTICES.txt` itself | lists `Thermo RawFileReader` with the `.doc`, and `openms-thermo-bridge` with texts [25] and [47]; [47] is `openms_thermo_bridge/managed/THIRD-PARTY-NOTICES.txt`, inside the folder decision 4 leaves out | 522,059 B, left in the copy unedited, so it declares what the copy does not hold; `LICENSES/` keeps 157 files ([section 9.4](../../spikes/RUNTIME_360_PROBE.md#94-notices)) | **open**: whether this file is left out, revised or replaced by the generated notices, so that the package does not declare what it does not ship |

> **LIB-1, the owner, 2026-11-04: "选A" ("option A").** The owner accepts libiconv's
> terms, treating it as possibly linked. A release carries the LGPL-2.1 text and
> notice. If it is statically linked, a user must be able to replace the library and
> relink, and how is settled before a release (the licence slice). The reading of
> LGPL-2.1 given with the options was the assistant's, not legal advice. Whether
> libiconv is linked stays not shown, and this record does not say it is not.

> **Fail branch only, 2026-11-03.** The Qt row above and the question below apply
> only if the probe fails: CK-2 then ships 3.5.0 first and obtains a legal opinion
> on Qt first, with no release without it. On the pass branch B-2.2 takes option
> 3, because the 3.6.0 wheel has no Qt (informal check). The recommendation below
> (option 1, otherwise option 2) is the text of 2026-10-30, not an owner decision.
> CK-2 does not say what happens if the opinion goes against the manifest refusal,
> and option 2 was neither chosen nor rejected.
>
> *2026-11-04 (LIB-1):* that branch is not taken, so the Qt row and the question below
> do not apply to this runtime, and the Qt opinion is not needed for it. They stay as
> the record of the branch. Option 3 holds: the probe's shape has no Qt
> ([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)).

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

> **Decided by the owner, 2026-10-30 (B-1, question 6).** An AppContainer
> worker is a release blocker only if A-06's measurement shows that it can be
> enforced without administrator rights. Otherwise a release ships with the
> stated limit and the measured mitigations: the Job additions, the
> environment variable and the firewall rule above.

> *2026-11-04, from the probe, for A-06's measurement; not an owner decision.* On the
> probe's host the adapter's process opens
> `C:\Program Files\Common Files\SSL\openssl.cnf`, a path compiled into
> `libcrypto-3.dll`, because that file exists there
> ([section 7](../../spikes/RUNTIME_360_PROBE.md#7-what-loads)). The engine also looks
> for its data in other locations before the copy, and at the two the run tried, a
> file put there wins
> ([section 7.1](../../spikes/RUNTIME_360_PROBE.md#71-where-the-engine-looks-for-its-data)).
> Whether either can change a result on an installed machine is unmeasured, and the
> record claims no attack.

### 8. Engine and interpreter: the owner's rule, on CPython 3.14

**The branch, 2026-11-04: pyOpenMS 3.6.0 without Qt, on CPython 3.14, leaving out
the Thermo folder.** The owner's rule below names it: the probe shows the first half
of its pass condition, and LIB-1 settles the second. CPython 3.14.10 is the newest
3.14 embeddable on that date, the one the probe measured and the one ask 2 approves
for development. What a release ships is B-2.3's newest embeddable when the package
is built, and shipping is ask 3, which stays open (decision 10).

> **LIB-1, the owner, 2026-11-04: "选A" ("option A").** The owner accepts libiconv's
> terms, treating it as possibly linked (decision 6). So "libiconv is shown not to be
> linked or its terms are accepted" holds by its second half, the pass condition
> holds, and B-2.1 and B-2.2 apply. CK-2's fallback is not taken, and the Qt opinion
> is not needed for this runtime. It does not cover ask 2, which the owner answered
> apart, ask 3, RT-3's MSVC reading, any release or any message to upstream. Asking
> upstream first, option B, stays available before a release, and each message needs
> the owner's go-ahead.

**The rule (the owner, 2026-11-03: B-2.1, B-2.2, B-2.3, CK-2).** The 3.6.0 probe
(A-03) decides the branch. Its pass condition is the roadmap's section 7: "Every
planned class runs without the Thermo folder, and libiconv is shown not to be
linked or its terms are accepted". The verdicts in the
[probe's record](../../spikes/RUNTIME_360_PROBE.md), which stay as measured:

| Part of the pass condition | Verdict |
| --- | --- |
| "Every planned class runs" | **PASS**: 26 of 26, on synthetic data ([section 5.2](../../spikes/RUNTIME_360_PROBE.md#52-the-26-classes)) |
| "without the Thermo folder" | **PASS** ([section 7](../../spikes/RUNTIME_360_PROBE.md#7-what-loads)); no RAW file was read |
| "libiconv is shown not to be linked" | **NOT SHOWN** ([section 8](../../spikes/RUNTIME_360_PROBE.md#8-libiconv)) |
| "or its terms are accepted" | **NOT SHOWN** in the record, which left it to the owner; LIB-1 answers it |

- **Pass, the branch taken:** pyOpenMS 3.6.0 on CPython 3.14, leaving out the Thermo
  folder (decision 4). No Qt ships, by the probe's inventory
  ([section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries)),
  and the LGPL-3 question does not arise (decision 6). The cost the owner was shown
  (B-2.1, which B-2.2 takes in full): leaving out the Thermo folder; a port and
  re-qualification of 3–5 slices (A-07, the decision page's estimate, not a
  measurement); a new dependency, `nanobind-backend`, that needs approval (decision
  10: approved on 2026-11-04 for development, not for shipping); and curl, the
  AWS SDK and OpenSSL 3.6.4 linked in (decision 6). B-2.2 adds that
  whether libiconv is linked is undecided, and it stays not shown. The probe found
  markers for curl and OpenSSL and none for the AWS SDK, which does not show that the
  SDK is absent.
- **Fail, not taken:** pyOpenMS 3.5.0 on CPython 3.14, with the legal opinion on Qt
  before any release. There is no release without that opinion, and its time and cost
  are unknown. As B-2 records, the bump is then decided before U2. This stays
  recorded as CK-2's fallback, which is not taken (LIB-1). The other half of A-03,
  which belongs to this branch, did not run
  ([section 11](../../spikes/RUNTIME_360_PROBE.md#11-what-did-not-run)).

**On either branch the interpreter changes,** because ANA-004 is qualified on
3.13.15 only. So the new manifest and the full M9.0 qualification of delivery
step 1 apply on both. The roadmap's A-07 row says that with 3.5.0 the item drops;
that holds for the port to 3.6.0's bindings, not for this qualification. On the
branch taken, A-07 stays.

**What the probe found for A-07, 2026-11-04.** None of it is the M9.0 qualification
([section 10](../../spikes/RUNTIME_360_PROBE.md#10-what-this-does-not-show)).

- **The adapter** completes unedited on 3.6.0. The supervisor, read and not run, would
  refuse the result until `resolved_profile` writes booleans as words and `KEY_MODULES`
  names the moved DLLs, and until `REQUIRED_MODULES`, `ENGINE_VERSION`, `ENGINE_REVISION`
  (`5d5cbff`, where the pin is `c1370fb`) and `RUNTIME_MANIFEST_SHA256` change. That
  list is a floor ([section 6.1](../../spikes/RUNTIME_360_PROBE.md#61-the-edits)).
- **ANA-004's numbers change.** On one fixture and two targets, 9 of 1,043 numbers
  break the 1e-6 rule, all in the `DETECTED` row: `leftS` 52.5 to 53.0, `rightS` 67.5
  to 67.0, `rawArea` 13765864.0 to 13740743.0. The cause is not separated
  ([section 6.2](../../spikes/RUNTIME_360_PROBE.md#62-the-comparison)). Ask 2 does not
  accept them: A-07 finds out why and reports.
- **An outcome can change too.** On a variant of the protocol's `main` fixture, a
  target with no `neutralMass` goes from `DETECTED_AMBIGUOUS` to `DETECTED`, and model
  status depends on which targets share the batch, on both engines
  ([section 6.3](../../spikes/RUNTIME_360_PROBE.md#63-beyond-the-adrs-request-the-protocols-other-fixtures)).
- **U1's chain** gives the same 51 features on three synthetic files, with no difference
  in RT, m/z or intensity. The call forms changed, and four classes have new parameters
  ([section 5.3](../../spikes/RUNTIME_360_PROBE.md#53-u1-on-both-engines)).

The recommendation of 2026-10-30, 3.5.0 first with the bump decided before
alignment and linking, was not taken: B-2.1 replaces it.

**The interpreter, as recommended and answered by B-2.3.** The next paragraph and
its list are the text of 2026-10-30. In them, "it" is the engine the rule names, and
"the same pyOpenMS, numpy and pandas versions" holds on the fail branch only, and so
does "no wheel change" in its last bullet. On the branch taken the wheels are the ones
the probe measured, with no pandas
([section 3](../../spikes/RUNTIME_360_PROBE.md#3-the-four-artefacts)), and what ships is
ask 3: a reading, not an owner decision. `pyopenms-3.6.0-cp311-abi3-win_amd64.whl` is the
only Windows wheel. On that branch 3.13.17 would need another embeddable and cp313 builds
of numpy and `nanobind-backend`, which ask 2 does not approve. The list's
"whether ANA-004 runs on cp314 at all is unmeasured" is answered for that shape by
[section 6.1](../../spikes/RUNTIME_360_PROBE.md#61-the-edits); the M9.0 protocol still
has not run.

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

**The informal check of 2026-11-03, before the probe.** On
2026-11-03 a scratch environment (uv's CPython 3.14.6, unslimmed, the Thermo folder
removed, one synthetic file; not committed) imported pyOpenMS 3.6.0 and ran U1's
three steps: 3,929 features, the same count as 3.5.0, with a largest relative
difference of 4.99e-7. matplotlib, PIL and pandas were not loaded. The 3.5.0 call
`mtd.run(exp,tr,0)`, in U1's chain, raised
`TypeError: run(): incompatible function arguments`, so U1's measurement script
needs a change. `adapter_v1.py` makes no such call. In the wheel the check found no
Qt DLL, no Qt import in the OpenMS DLL and 0 `Qt6` or `QString` strings. ANA-004 and
the other planned classes did not run, and this environment is not the shipping
shape. The probe's numbers above replace it wherever they differ.

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
  *2026-11-04:* `tauri.conf.json` now declares `installer-hooks.nsh` (DEF-2, the view
  cache only). The work-area removal and the runtime notice are not in it and are not
  built: the hook here and under Consequences would be additions to that file.
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

> **Decided by the owner, 2026-10-30 (B-1, question 8).** The hash-pinned
> shipped wheels and the release-workflow change are approved with this
> record, effective at the first runtime release (A-05). Nothing ships before
> then. Which wheels ship still depends on B-2 (questions 5 and 7), B-3
> (question 4) and question 10.

> **The answers of 2026-11-03: no answer approves a new dependency.** pyOpenMS 3.6.0
> and its backend are asked for when the work starts. A reading, not an owner
> decision: this decision and B-1 question 8 cannot be read to cover that pair.
> There are three separate asks:
>
> 1. the probe's wheels (A-03). **Approved 2026-11-04,** "批准 A-03" ("approve A-03"):
>    four artefacts, in a temporary directory, for the probe and the AppContainer
>    measurement, with no lock committed and nothing shipped;
> 2. the same artefacts for the development runtime (A-07 and U1). **Approved
>    2026-11-04,** "批准" ("approved"): `pyopenms==3.6.0`, `nanobind-backend==1.0.0`,
>    the CPython 3.14.10 embeddable and `numpy==2.5.3`'s cp314 wheel. A lock file for
>    them is committed, the experiment lock goes in the same change, and nothing ships.
>    Not approved: a fifth package, or another version or tag;
> 3. shipping (A-05). **Open.** The answer lists "shipping (ask 3, A-05)" among what
>    ask 2 does not approve, and this record's status does not answer it. B-1 question
>    8's approval above is not withdrawn. Whether it already covers numpy 2.5.3's cp314
>    wheel, a version ANA-004 was qualified on, is not settled here: a reading, not an
>    owner decision.
>
> B-3.3 answers "(open question 4)" above: the experiment lock is deleted, not
> bumped. *2026-11-04 (D1):* #168, that bump, was closed, and no alert was dismissed.
> The Pillow alerts stay open until the lock is deleted.

> **CK-1, 2026-11-03.** The first analysis runtime does not carry matchms and stays
> free of Pillow, so B-3.1 and B-3.3 do not change. matchms arrives with the runtime
> of library matching (A-25). That release grows about 122 MB compressed and 487 MB
> unpacked (measured as a separate programme, not an installer delta), existing
> targeted MS1 plans must rebind to it, and Pillow fixes need a new release from
> then on.

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
  *2026-11-04:* that is 3.5.0, the branch not taken. The probe's shape has no Qt
  (decision 8).
- **Bundling more packages now** (scipy, scikit-learn, matchms, statsmodels).
  The statistics plan runs in Rust; each package is a separate approval and a
  new manifest.
  *2026-11-03 (CK-1):* this holds for the first runtime. matchms arrives with the
  runtime of library matching (A-25) and is asked for when that work starts
  (decision 10).

## Consequences

- No pyOpenMS function reaches a user until this lands; Rust-only analysis
  does not wait for it.
- Every runtime change, a security fix included, is an application release and
  re-reviews plans (`PlanNotCurrent`); stored results are unaffected.
- The application stays a per-user install; analysis users install a second,
  elevated package once per runtime version.
- Shipping tier 3 ends the Pillow alerts for what ships, once the release lock
  replaces the experiment lock and that lock is deleted or bumped.
  *2026-11-04:* it is deleted, not bumped (B-3.3; #168 closed, D1, with no alert
  dismissed), and in the change that commits A-07's lock (ask 2), not the release
  lock's. The alerts stay open until then.
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

*2026-11-04:* the first two are applied with this status, in
[`ANALYSIS_WORKERS.md`](../ANALYSIS_WORKERS.md#packaging-gate) and the
[M9 closure's remaining limits](../../product/M9_CLOSURE.md#13-remaining-limits).
`THIRD_PARTY_NOTICES.md` and `scripts/generate_notices.py` stay until the release that
ships the package. The experiment lock is deleted, not bumped (B-3.3; #168 closed,
D1), in the change that commits A-07's lock (ask 2); neither that change nor the
provisioning script's is made here.

## Open questions for the owner

> **Owner decision B-1, 2026-10-30.** Answered: 1 (B1), 2 (as recommended),
> 6 (a blocker only if A-06 shows the container can be enforced without
> administrator rights), 8 (approved, effective at the first runtime release)
> and 9 (a reading is asked for, with B-2's Qt reading if that is still
> needed; the reading itself is open and blocks A-05, not development).
> Open: 3 (working default: require elevation), 4 (B-3), 5 and 7 (B-2), and
> 10, which no owner decision carries yet.

> **The owner's answers, 2026-11-03.** Every question below now has an answer,
> marked under it with its id. The answers on the engine hold under decision 8's
> rule. *2026-11-04:* the probe has reported and LIB-1 settles the rule's libiconv
> line, so they hold: 3.6.0 without Qt, with CK-2 not taken.

1. **Distribution.** A separate runtime package the user downloads (B1,
   recommended; elevation for analysis users only, with UAC's
   unknown-publisher prompt while unsigned), the same package downloaded by
   the application (B2), or inside the application installer (A, 36–55 MB more
   and elevation for every user)?

   *Answered 2026-10-30: B-1, B1.*
2. **Location.** Per machine under Program Files with an elevated runtime
   installer (recommended), with the work area under ProgramData by user SID?

   *Answered 2026-10-30: B-1, as recommended.*
3. **Without administrator rights.** Offer a user-chosen ASCII folder with a
   protected DACL (which reopens the verification gap and needs a per-user
   pointer and an AppContainer entry), or require elevation?

   *Answered 2026-11-03: RT-1, require elevation; add the route when someone
   needs it.*
4. **Contents.** Ship tier 3 and leave out `HMDBMappingFile.tsv` and the two
   Modomics files (all recommended; 1,790 files, ANA-004 matches the full
   runtime on the one fixture measured)? Two preconditions: `brenda.obo` cannot
   be left out (the mzML reader needs it), so its terms must be confirmed, and
   the data files whose file states no terms are resolved by the licence
   slice. Tier 3 removes Pillow instead of bumping it to 13.0.0, unlike the
   recorded route; confirm, and delete or bump the experiment lock in the same
   change?

   *Answered 2026-11-03: B-3.1, tier 3; B-3.2, strip the HMDB and Modomics files;
   B-3.3, do not ship matplotlib and Pillow, and delete the experiment lock. The
   two preconditions remain, under "What still blocks a release".*
5. **Qt LGPL-3.** Ask for a legal reading of the manifest refusal against
   §4(d)(1); if it does not hold, build the declared-modified-runtime mode, or
   move to 3.6.0 without Qt?

   *Answered 2026-11-03: B-2.2, use 3.6.0 without Qt, valid only if the probe
   passes; CK-2 if it fails, with a legal opinion on Qt first. 2026-11-04: it holds
   (LIB-1), and CK-2's branch is not taken.*
6. **Network confinement.** Is an AppContainer worker a release requirement,
   or may a release ship with the firewall rule and a stated limit if the
   measurement fails?

   *Answered 2026-10-30: B-1, a blocker only if A-06 shows the container can be
   enforced without administrator rights.*
7. **Engine version.** 3.5.0 for the first runtime release (recommended), with
   the bump decided before alignment and linking?

   *Answered 2026-11-03: B-2.1, 3.6.0 before release, if the probe passes; CK-2 if
   it fails. 2026-11-04: it holds (LIB-1), and CK-2's branch is not taken.*
8. **Dependencies.** Approve the shipped wheels as production dependencies,
   and the release-workflow change that builds the package?

   *Answered 2026-10-30: B-1, approved, effective at the first runtime release.
   2026-11-03: no answer approves a new dependency (decision 10). 2026-11-04: A-03
   and ask 2 approve four artefacts, for the probe and the development runtime, and
   shipping (ask 3) stays open (decision 10).*
9. **MSVC runtime copies.** Ask for a reading on redistributing the MSVC DLLs
   that the OpenMS, numpy and pandas builds carry?

   *Answered 2026-10-30: B-1, a reading is asked for. 2026-11-03: RT-3, no release
   until the reading exists. The reading itself is not in. 2026-11-04: RT-3-WHEN, it
   is drafted after the probe's result and shown to the owner first.*
10. **Interpreter.** Move the runtime to CPython 3.14 with the cp314 wheels
    and re-qualify ANA-004 on it (recommended), stay on 3.13 with its last
    binary build 3.13.17, or build CPython from source?

    *Answered 2026-11-03: B-2.3, CPython 3.14, the newest embeddable. 3.14.10 on
    2026-11-04 (decision 8).*

### What still blocks a release

*2026-11-04:* the probe (A-03) has reported and comes off this list. So does the
legal opinion on Qt, whose branch is not taken (decision 8). The rest is open, and
this record's status answers none of it.

- **The approval to ship (ask 3, A-05).** It is not given (decision 10).
- **The MSVC reading (RT-3).** No release until it exists. The probe's
  [section 9.3](../../spikes/RUNTIME_360_PROBE.md#93-every-msvc-runtime-copy) lists the
  seven copies for it, with two `msvcp140` versions loaded in one process, and which of
  two identical copies loads depends on import order, so both count as possibly loaded.
  RT-3-WHEN sets the draft after the probe's result, shown to the owner first, and each
  message goes only on the owner's go-ahead for that message. Who gives the reading and
  how long it takes are not recorded. It does not block development.
- **How a static link's relink term is met (LIB-1).** If libiconv is statically linked,
  a user must be able to replace the library and relink; how is settled in the licence
  slice, before a release, with the LGPL-2.1 text and notice in the package. Only a link
  map would settle whether it is linked, and only upstream can publish the map of the
  shipped DLL ([section 8](../../spikes/RUNTIME_360_PROBE.md#8-libiconv)). Asking is
  option B, and each message needs the owner's go-ahead.
- **The licence slice's other items,** from the probe's sections 8 and 9:
  - whether the other listed ports are linked, which is the same question as libiconv's:
    the AWS SDK leaves no marker, and `libxml2` is the one route to libiconv that was
    found ([section 8](../../spikes/RUNTIME_360_PROBE.md#8-libiconv)); the notices list
    156 entries, and only the table of
    [section 9.2](../../spikes/RUNTIME_360_PROBE.md#92-the-bundled-native-libraries) was
    looked for;
  - the notices and source pointers for what that table states: curl 8.20.0, OpenSSL
    3.6.4, Arrow and Parquet 24.0.0, Xerces-C 3.3.0, SQLite, libsvm, zlib 1.3.2, bzip2
    1.0.8, the .NET host, the Thermo bridge's native half (its row in decision 6) and
    COIN-OR (EPL 2.0 in its `LICENSES/vcpkg` text);
  - `pyopenms/_arrow_zerocopy.pyd` (7,720,448 B), never loaded, with a static Arrow, zlib
    and bzip2;
  - `libtommath.dll` in the embeddable, named in neither the SPDX file on python.org nor
    `LICENSE.txt`;
  - the two OpenBLAS copies, numpy's and the one in `OpenMS.dll`, with different versions
    stated for them;
  - `nanobind-backend`, which carries no licence file, and `THIRD-PARTY-NOTICES.txt`,
    which declares what the copy does not hold, while `LICENSES/` keeps 157 files
    ([section 9.4](../../spikes/RUNTIME_360_PROBE.md#94-notices)).
- **`CV/brenda.obo`'s terms and the data files whose file states no terms**
  (decision 4's licence slice).
- **ANA-004's qualification on the new manifest (A-07, delivery step 1).** The M9.0
  protocol has not run on these binaries, and the owner has not accepted the numbers the
  probe saw move (decision 8). What happens if that qualification fails, or the owner
  does not accept those numbers, is not decided: CK-2 answers a failed probe only, and
  decision 8's 3.13.17 alternative is the text of 2026-10-30, "only by the owner's
  decision", on wheels ask 2 does not approve.
- **The package and its installed qualification (A-05, delivery steps 3 and 5).** Not
  built. The probe measured neither the installed location nor a clean machine
  ([section 10](../../spikes/RUNTIME_360_PROBE.md#10-what-this-does-not-show)). The
  qualification needs an idle-desktop window, with SmartScreen and antivirus behaviour
  ([the roadmap's section 7](../../development/ROADMAP_V511_AND_ANALYSIS.md#7-measurement-and-evidence-gates)).
  The owner provides that window, and no answer here approves it.
- **A-06's result under B-1 question 6.** Whether the measurement shows that the
  AppContainer can be enforced without administrator rights is unknown, and the
  answer decides whether the container blocks the release. The probe's findings for that
  measurement are under [decision 7](#7-confinement).
