# M9.0 — targeted MS1 route evidence

Status: **M9.0 LOCAL ROUTE VALIDATION COMPLETE — CONDITIONAL RECOMMENDATION / NO
ROUTE ADMITTED.** Date: 2026-09-23. The decision, the conditions and the M9.1
contract are in the [route decision and handoff](../product/M9_1_TARGETED_MS1_HANDOFF.md);
this record holds what was measured.

SOURCE UNPUBLISHED · M8 LOCAL IMPLEMENTATION COMPLETE · M9 IN PROGRESS — M9.1
NOT STARTED · M7.6 RELEASE QUALIFICATION DEFERRED / INCOMPLETE · PROTEOWIZARD
HOLD UNCHANGED · PUBLIC BETA NOT RELEASED; M10 NOT STARTED

## The task measured

Given an explicitly selected mzML acquisition and a target list with unambiguous
chemical and retention-time definitions, obtain target-specific signal and
candidate results that a user can inspect, with traceable inputs, parameters and
implementation identity, and honest absent, ambiguous and failed outcomes. Not
identification, not a validated quantitative assay, not untargeted feature
detection, and not general XIC admission.

## Identity

| Binding | Value |
| --- | --- |
| Start (M8 closure, documentation-only successor of code candidate `597d08dca374875bd95c48e06d73b1eb3c152d8a`) | `97392e97e615fd606c62470be995df2b17b6bbc1`, tree `b385798ac9bef1e976de205e8b85aaee5bb0d96a` |
| Branch | `feat/m9.0-targeted-ms1-route-validation` |
| Round-one protocol, frozen before any engine run | `d4165b9dbb1c504339c8d009210b9829ac0c0840`, amended twice before scoring (`d9a3d0e51350f466cc238a666a6607d81becfaab`, `8704abc9b87ff34ac65da94b67c91d40ddafaef5`); scored file SHA-256 `ac8a0be2b32d32fb13ec7bf8c069088f6c824339ff799ea19ab65d51359afc85` |
| Round-one tested tree | `5030b674c22a09cd27cddd0a8d80a2f7b97843a0`, tree `fd8fcef28a52fb38b88a591910a927b8eb19c0b9`; worker SHA-256 `ce68cfa82ea381d563babbc887ae7a45282a1ce0b88070641394724b64389c7e`, recorded in every scored attempt |
| Round-two protocol and tested tree | `847936cc04fc1416c7f1c8a13537799e1cfea78e`, tree `03c409bc333d418e36f654c5c83c4e1c4d806741`; protocol SHA-256 `82dbb6dd2acae04606009ffd124a977723eb7ed2d109cd47815f40c47b1a1c3d`, worker `859611e40115c8c2fcf05c414036e1521b352e1e0f527d49c613c87af0ff6aa8` |

Every package, file digest, source blob and fixture digest is in the one
[provenance manifest](../../experiments/m9_0/manifest.json). Scratch outputs live
under the ignored `.tmp/m90-evidence/` and are not published.

## Candidates

| Candidate | Disposition |
| --- | --- |
| **A** — `pyopenms==3.5.0`, `cp313-win_amd64`, in the CPython 3.13.15 Windows embeddable runtime | **Executed.** 26 round-one cases, 11 round-two cases, diagnostics, relocation |
| **B** — the matching TOPP tool from `OpenMS-3.5.0-Win64.exe` | **`NOT_EXECUTED_DEPLOYMENT_BLOCKED`.** The pinned installer template (`cmake/Windows/NSIS.template.in` at the tag) includes `Section "Proteowizard"` from `THIRDPARTY/pwiz-bin` by default, so fetching the asset transfers a ProteoWizard copy under the standing HOLD. The built asset was not downloaded, so its actual contents are not asserted; no available tool was shown to extract NSIS either. Source reading of the TOPP tool is recorded below and is not a TOPP execution |

A and B share one engine. Where this record compares A with OpenMS's own
recorded output, that is adapter consistency, not independent science.

## Runtime and packages

- **Interpreter.** `python-3.13.15-embed-amd64.zip` from python.org, 11,009,825
  bytes, SHA-256 matches the python.org release API; OpenPGP signature good from
  the key python.org names for Windows binaries (web of trust not established);
  Authenticode valid on all ten binaries. The only change is one `site-packages`
  line in `python313._pth`; `import site` stays off.
- **Packages.** One resolution with pip in download/`--target` modes (its own
  installation untouched) into a hash lock of fourteen wheels, all equal to their
  PyPI digests; the named pyOpenMS wheel matches the expected
  `51c5944366a2efb4a9f393da875f91e390dcd2dba5ccf736421ab322e4345747`. Execution
  never invokes pip. Installed size 352 MB, of which 117 MB is generated `.cpp`
  source in the pyOpenMS wheel; importing the engine loads numpy, pandas and
  dateutil but not matplotlib, Pillow or fontTools.
- **Isolation.** Isolated mode with the environment ignored; a decoy module in the
  working directory and a decoy `PYTHONPATH`/`PYTHONHOME` were not used; the
  worker ran with an allow-listed environment (`PATH` = runtime and System32,
  `OPENMS_HOME_PATH` and `TEMP` inside the run); zero loaded modules came from
  outside the runtime or System32; `~/.OpenMS` was not created. This shows
  independence from user site-packages and the working directory. It is not a
  network sandbox: no network use is intended and none is enforced.
- **Engine identity.** OpenMS self-reports revision `c1370fb`, not the tag commit
  `c49149d47d6fcc76d1271d87d3a7fad15d2219de`. The two diverge from
  `8f874ef28c2e36806496f8e757404e71c77eb524`; neither side changes a source file
  read here, and the wheel side updates the `contrib` submodule.
- **Licences.** OpenMS is BSD-3-Clause. The wheel carries no licence or notice
  file while bundling Qt6Core, Qt6Network, zlib, the MSVC runtime and OpenMS's
  statically linked contrib libraries. Enough for local experiment use;
  redistribution terms are unresolved.

## Engine semantics and maturity, from the pinned source

`src/topp/FeatureFinderMetaboIdent.cpp` says **"This tool is still experimental!"**.

| Semantic | Engine behaviour | Consequence |
| --- | --- | --- |
| Ion | `(M + z * 1.0072764667710) / abs(z)`; no other adduct; scan polarity never checked | Charge +1 `[M+H]+` only; polarity is the adapter's to enforce |
| m/z window | `extract:mz_window` is a **full** width, read as ppm when `>= 1` and as Da below 1; a point counts inside the **open** interval | The request takes a half-width in ppm, at least 0.5; this differs from the M5/PX XIC contract's closed interval |
| RT window | Closed interval of **full** range `RetentionTimeRange`; a range of 0 silently becomes the global `extract:rt_window` | Half-width required and positive; the global window is set to twice the largest half-width |
| Spectra | TOPP loads MS1 only; the algorithm class also keeps MS1 only; an empty spectrum yields **no point**, not a zero | Evidence maps each point to its spectrum by file order |
| Quantity | `raw_intensity` = sum of raw chromatogram points in `[leftWidth, rightWidth]`, all traces, no baseline | Primary quantity; a discrete point sum, not an area in intensity x s |
| Model | Gaussian fit; its validity uses a median z-score of widths **across the run**; a failed fit is **imputed** from a regression over the other features (or zeroed with `no_imputation`) | The engine's `intensity` depends on the other targets in the request |
| Selection | Candidates in the window are reduced to one per target by peak-edge distance, then intensity; overlapping features of different targets are reduced to one | Ambiguity is silent in the engine's output; the adapter reads `candidates_out`, `alt_PeptideRef` and `overlap_removed` to disclose it |
| TOPP extras | Overrides `EMGScoring:init_mom=true`; skips short or duplicate target lines with exit 0; **contacts `http://openms-update.cs.uni-tuebingen.de/check/` with tool, version and platform unless `OPENMS_DISABLE_UPDATE_CHECK` is set**, writing `~/.OpenMS/<tool>.ver` | The algorithm class used by A never reaches this path |

## Oracle and matrix

The [round-one protocol](../../experiments/m9_0/protocol.py) writes its own mzML
with the standard library, reads the stored arrays back with an independent
decoder, and computes every expected value from the fixture specification. Check
classes: `oracle` (independent), `semantics`, `contract`, `wrapper-agreement`
(engine against itself), `upstream-recorded` (against OpenMS's own regression
record) and `informational`. Round two's [protocol](../../experiments/m9_0/protocol_r2.py)
adds `post-hoc` for tolerances learned from round one.

**Round one, scored: 166 PASS / 63 FAIL** (26 cases; 14 fixtures).

| Failure class | Count | What it shows |
| --- | --- | --- |
| Chromatogram values and raw areas outside the declared 1e-9 relative tolerance | 52 | The engine stores both as **binary32**. Diagnostics: 2,618 of 2,878 points equal the binary32 rounding of the exact sum and the rest are one unit away; every raw area equals it exactly; point counts, spectrum identities and times match. The exact-boundary probes (7777 at the open ends) were never counted, which confirms the open interval |
| Positive control `NOT_DETECTED` in the main fixture (3 cases) | 3 | **Two MS1 spectra sharing one retention time inside a peak silence a strong, clean peak.** Removing only that pair restores detection; keeping only it reproduces the miss; the empty spectrum, MS2 interleaving and uneven spacing are innocent |
| Truncated peak `NOT_DETECTED` (3 cases) | 3 | An apex 1 s inside the window's end yields no candidate; widening the window to 165–185 s detects it. The fit-rejection branch was therefore not reached by this fixture |
| Formula-derived ion m/z off by 1.5e-6 Da | 3 | The engine's table carries N and O to six decimals (14.003074, 15.994915); about 6 ppb |
| Namespace-prefixed mzML | 1 | The reader returns **zero spectra without error**; an independent count finds 201 |
| `ctl_timeout` never timed out | 1 | A run in which **no target has any candidate makes the engine raise** after selection, so the whole run fails; the timeout path was measured separately |

Passing highlights: absent target reported `NOT_DETECTED` with an all-zero
window; a strong coeluting peak 7.5 ppm off and a same-m/z peak outside the RT
window never contributed; two peaks for one target disclosed as
`DETECTED_AMBIGUOUS` with both candidates; one peak for two isomer targets
disclosed as `DETECTED` + `SUPPRESSED_BY_OVERLAP`; distinct spectra with shared
times kept distinct; minutes converted to seconds; unsorted arrays sorted by the
reader with correct sums; 32-bit/no-compression and indexed files equal to the
plain file; capturing candidates did not change any selection; every request and
domain refusal refused before the engine; truncated and non-mzML inputs failed
and published nothing; cancellation observed as exit 1 with nothing published.
**Upstream-recorded agreement:** on OpenMS's `FeatureFinderMetaboIdent_1` input,
with that test's parameters and the TOPP overrides, all six features and the one
unassigned target equal the recorded output under its FuzzyDiff rule. That input
declares every spectrum profile, so the case lifted only that refusal through a
recorded experiment flag; it is not evidence for profile support. The adapter
also shows the recorded "unassigned" `very_similar_to_inosine` to be
`SUPPRESSED_BY_OVERLAP`, not absent.

**Round two, narrowed domain: 93 PASS / 1 FAIL** (11 cases, new seed and
placements). The adapter now refuses equal MS1 times, fails a read whose
spectrum count disagrees with an independent namespace-aware count, types the
all-absent failure as `ENGINE_NO_CANDIDATES`, and discloses whether a window held
signal. Answers to its pre-registered questions: near-duplicate times 1e-3 s and
1e-6 s apart inside a peak **do not** cause a miss; an exact duplicate outside
the peak but inside the window **does not** either, so refusing every duplicate is
broader than the defect. Raw areas were identical with fewer targets in the run.
The one failure is a pre-registration error of mine: a single-target in-peak
duplicate case expected a completed run, but no candidate meant
`ENGINE_NO_CANDIDATES` — which is itself the replication.

## Diagnostics beyond the matrix

Written after round one and changing no scored result
([diagnostics](../../experiments/m9_0/diagnostics.py)):

- **Run-to-run reproducibility.** Repeating `main` gave identical features,
  boundaries, raw areas and chromatogram values, but formula-derived ion m/z and
  isotope probabilities differed in the last bits (for example
  `195.08765278577098` / `195.087652785771`). A mass-given target was identical.
- **Batch dependence.** The same `boundary` peak's fit was `5 (width too large)`
  and imputed in one run and `0 (valid)` in a smaller run; its raw area was the
  same in both. The imputed intensity also moved by 0.5 between two runs that
  differed only in candidate capture.
- **Score contamination.** The engine's `masserror_ppm` reported +7.38 ppm for a
  signal jittered within ±1.5 ppm: it looked at the out-of-window interferent.
- **Paths.** The host's ANSI code page is 936. A runtime copied to another ASCII
  location reproduced the original rows exactly; a source path with CJK
  characters fails the reader (`IO error`); a runtime under a CJK path makes
  OpenMS exit fatally for lack of its shared data; writing `candidates_out` to a
  CJK path fails. A hard link in an ASCII directory and in-memory loading both
  read a CJK-path source; 8.3 names are not available on this volume.

## Resource observations

These describe tiny fixtures on this host and promise nothing about product
performance. Completed runs (14): wall 0.69 s median (0.74 s max) including
interpreter start and a warm engine import of about 0.5 s (2.8 s on the first,
cold import); peak working set 102 MiB median, 111 MiB max. Refusals before the
engine import: 0.09 s, 20 MiB. A 156 MB, 6-million-point file reached a 658 MiB
peak working set before the all-absent failure at 2.7 s. Cancellation during
loading: request at 1.198 s, termination called at 1.199 s, exit observed at
1.219 s; timeout at 1.0 s: exit observed 21 ms later. Published payloads: 13 KB
for one target, 49 KB for six, 115 KB for the eight regression targets.

## Storage prototype

The [storage prototype](../../experiments/m9_0/storage_proto.py) published a real
round-two result into a store beside a stand-in document and exercised: publish
and save; publish without save (reported as unreferenced, not deleted); a payload
truncated (`payload_corrupt`) and removed (`payload_missing`); Save As copying and
verifying every referenced payload while keeping identifiers and leaving the
unsaved orphan behind; a failed copy that published neither document nor store and
left nothing; a retry after an interrupted Save As; and a store owned by another
project refused. Plain renames on one NTFS volume; no durability claim.

## Inspection artifact

`report.py` writes `.tmp/m90-evidence/report/index.html` (SHA-256
`b61051e5695565a088af050bbf249e734caced3442de230df9630eaa78b3c9af`) from the
published results: identity, parameters and runtime per run, the row table, and
per target the engine's extracted M and M+1 points with picked and candidate
bounds. It was rendered headless in Edge at 1366 and 960 px. It is a local
developer file, not an application route, and draws nothing from the fixture
specification.

## Checkpoint

| Item | State |
| --- | --- |
| A executed, both rounds scored | Done |
| B | Not executed: deployment blocked by the HOLD |
| Owner decisions | Listed in the [handoff](../product/M9_1_TARGETED_MS1_HANDOFF.md#deliberately-deferred) |
| Production code, manifests, locks, schema 3 | Unchanged |
| Raw evidence | `.tmp/m90-evidence/` (`runs/checks.json` `48f47149…`, `round2/checks.json` `64c8c4d5…`, `diagnostics.json` `6392a274…`, `relocation.json` `7876f37c…`, `storage.json` `4ce1473a…`); first failed attempt kept under `first-failures/` |
