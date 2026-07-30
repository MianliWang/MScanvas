# Bootstrap status

**Updated:** 2026-07-29

**Canonical repository:** [`MianliWang/MScanvas`](https://github.com/MianliWang/MScanvas)

**Visibility:** Private

**Default branch:** `main`

## Completed

- Repository structure created.
- Product proposal installed as the root product and engineering source of truth.
- React/Vite/Tauri source skeleton created with an explicitly mocked M0 UI state.
- Rust workspace and three initial library crates created.
- Product, UX, architecture and ADR documents created.
- Root and nested `AGENTS.md` files created.
- Five repo-local Codex skills created.
- GitHub issue templates, Dependabot configuration and CI workflows created.
- Dependency-free repository validation completed.
- GitHub repository created at `MianliWang/MScanvas`.
- Initial source tree synchronized to the `main` branch.
- Deterministic Node, pnpm and Rust versions documented and enforced by repository
  validation.
- `pnpm-lock.yaml` and `Cargo.lock` generated and committed for frozen/locked use.
- Frontend lint, typecheck, tests and production build verified on Windows.
- Rust format, Clippy and workspace tests verified on Windows.
- Tauri's Windows icon prerequisite repaired and a release desktop executable built.
- The mock shell's main-window capability audited and narrowed to no Tauri core API
  permissions.

The original local bootstrap commit is documented in
[`docs/development/INITIALIZATION_REPORT.md`](docs/development/INITIALIZATION_REPORT.md).
The GitHub commit SHA may differ because the source tree was transferred through the
GitHub API after the remote repository was created.

## Verified toolchain

| Component | Repository contract | First verified local runtime |
| --- | --- | --- |
| Node.js | `22.23.1` in `.node-version`; minimum `22.13.0` | `22.15.1` |
| pnpm | `11.15.1` | `11.15.1` |
| Rust | `1.97.1` with rustfmt and Clippy | `1.97.1` |
| Python | dependency-free repository checker | `3.14.3` |

CI reads the exact Node version from `.node-version`. Local bootstrap accepts newer
compatible Node 22 releases while enforcing pnpm and Rust exactly.

## Bootstrap failures repaired

- GitHub Actions could not activate pnpm because the Corepack bundled with the old
  Node pin rejected pnpm's current signing key. CI and bootstrap now install the
  exact pnpm version through npm and verify it before use.
- Rust CI reached Tauri's build script before Clippy and failed because the required
  Windows icon did not exist. A repository-owned neutral source icon plus generated
  PNG/ICO outputs now make the desktop build deterministic. The artwork is a
  bootstrap placeholder, not final product branding.
- Once dependency installation was unblocked, the frontend exposed real bootstrap
  defects in Vitest setup and an obsolete explicit esbuild minifier selection. The
  tests now import their APIs and clean up deterministically, and Vite uses its
  built-in Oxc minifier.

No Rust source lint suppression or Clippy weakening was required.

## M0 ProteoWizard bounded evidence on 2026-07-24

The Rust adapter now has structural contracts for deterministic configured/`PATH`/reviewed-root discovery, matching-tool release/build probes, canonical absolute paths, typed `msaccess` and `msconvert` argv, bounded redacted diagnostics, normalized failures, direct process capture and Windows-owned process-tree cancellation. An unstable developer-only harness exposes the spike operations without creating a stable CLI contract, rejects output inside directory acquisitions and requires a fresh empty ignored output directory.

Targeted validation after the offline help/cancellation hardening passed with:

| Command | Result |
| --- | --- |
| `cargo test --locked -p mscanvas-proteowizard --all-targets` | Passed: 33 tests; 2 controlled subprocess entry points intentionally ignored |
| `cargo clippy --locked -p mscanvas-proteowizard --all-targets --all-features -- -D warnings` | Passed |

That targeted table is code-contract and controlled-process evidence. A later exact-head disposable-VM run established the bounded real-backend behavior summarized below; the preserved pre-continuation repository-wide validation remains historical rather than evidence for the final tree.

Repository-wide validation passed with:

| Command | Result |
| --- | --- |
| `cargo fmt --all --check` | Passed |
| `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings` | Passed |
| `cargo test --locked --workspace --all-targets` | Passed: 32 tests; 2 controlled subprocess entry points intentionally ignored |
| `python -B scripts/check_repo.py` | Passed |
| `pnpm install --frozen-lockfile --strict-peer-dependencies` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 2 frontend tests |
| `pnpm build` | Passed |
| `pnpm tauri build --no-bundle` | Passed; produced an ignored Windows release executable |
| `git diff --check` | Passed |

Bounded local discovery found no runnable host-installed `msconvert.exe` or `msaccess.exe`. Windows Installer metadata reports a ProteoWizard version record with `ProductState = ABSENT`. **Corrected 2026-07-27: that discovery result was a false negative and that version record was not residual.** ProteoWizard 3.0.26013 was installed on this host the whole time, under `%LOCALAPPDATA%\Apps`, which discovery did not search. See "Host ProteoWizard was installed and not found" below. After explicit download and installation authorization, the exact official Windows x64 MSI (`3.0.26204` / `a09eea9`) was downloaded outside the repository and hashed, but Windows reported Authenticode `NotSigned` with no signer. The mandatory host-install trust gate stopped before execution, installer UI, elevation or installation, and no alternate installer or unofficial source was tried.

A narrower continuation verified the matching official Windows x86_64 portable archive through the ProteoWizard selection page, `bt83` release record and site-owned S3 resolver. The `97,078,806`-byte archive has SHA-256 `A0B92B40456E080B1CB5CBEDAE0B95664F43FE3B723972FE388A60E0341564E2`. All 265 archive members passed path/type checks before extraction, extraction stayed inside a fresh temporary root, and a private inventory covered all 20 executables and 191 DLLs. The target `msconvert.exe` and `msaccess.exe` were both unsigned.

The local Windows Sandbox/VM gate stopped without changing optional features. Exact run [`30129182032`](https://github.com/MianliWang/MScanvas/actions/runs/30129182032) later used an ephemeral GitHub-hosted `windows-2025` VM and executed commit `f0d7957fbbe129263a9a89684b6ce549b1b3a086`. The unsigned portable tools ran only as a temporary non-elevated standard user with protected inputs, scoped writable paths, exact-program outbound blocks and owned-process supervision. The fixture/archive/executable identities, complete help, 12 operation records and complete teardown were verified; the sanitized artifact ZIP independently matched SHA-256 `8A07BBDBA9C195A311A00658A9FC7F086E83B6DA3943F41B12B90BC2ED23E927`.

The source-reconciled runtime result is capability-specific. Discovery/build identity is A. Metadata, summary/counts, derived TIC/filtering, scan listing, selected spectrum, overall conversion and mzML conversion are B with named parser/scientific limits. mzXML is C because the tested multi-source fixture lost one of four spectra despite exit 0. BPC, repeated navigation, large arrays, progress, real cancellation, locale stability and vendor RAW coverage remain D. The M0 provider decision is therefore still incomplete, but it is no longer blocked by unavailable isolation or absent open-format runtime evidence. See the [M0 ProteoWizard spike report](docs/spikes/M0_PROTEOWIZARD_SPIKE.md).

## M0C Slice 1 preview integrity contracts on 2026-07-26

The ProteoWizard Rust library now owns typed parsers and an operation-specific
interpreter for the evidence-backed preview subset: metadata, run summary, spectrum
table, derived TIC and one selected spectrum. Metadata preserves section and field
order, retains unrecognized field content as opaque data and assigns no scientific
meaning beyond the measured structure. Retention-time values carry an explicit unknown
unit when the backend does not emit one; this slice does not assume or normalize them to
seconds.

TIC points retain their source spectrum indices and backend order and are labeled as
derived/recomputed summed intensity rather than a stored chromatogram. A separate
retention-time-ordered projection leaves the source ordering intact. Canonical spectrum
identity retains the zero-based index and every raw representation, reconciles exact
numeric display IDs with exact `scan=<N>` native IDs and reported scan numbers, rejects
conflicts and keeps unrecognized native-ID forms opaque.

The interpreter treats exit 0 plus no generated output as typed `NoResult` only for a
selected-spectrum request whose stdout/stderr captures are complete and empty.
Diagnostic-bearing or incomplete no-output cases remain unclassified. Required preview
outputs instead fail closed when missing, empty, malformed or unexpectedly multiple, and
backend/process failures remain separate from semantic output interpretation.
Unsupported-input-like exit 0 behavior remains conservative and unclassified unless a
stable structural marker exists; English stderr is not a protocol.

This was a contract-only slice. It did not execute ProteoWizard, add or update a
dependency, change UI or Tauri behavior, or change conversion semantics. M0C remains
incomplete: Slice 2 must add mzML conversion semantic integrity and representative
open-format navigation/scale measurements. BPC, real-backend cancellation, alternate
locale and vendor-format coverage remain separate gates.

## M0C Slice 2A mzML conversion integrity on 2026-07-26

mzML conversion integrity is now a typed library contract. The developer harness
previously printed `conversion_output.xml_validation=deferred_to_evidence_orchestrator`,
which meant the only structural check of a converted file lived in a temporary PowerShell
evidence script rather than in MSCanvas.

The ProteoWizard crate owns a bounded mzML inspector that refuses document type
declarations and undeclared entities, resolves no external reference, never base64-decodes
or decompresses a binary array, and fails closed on explicit document-byte, single-text-run,
depth, element, attribute, name, value, spectrum and chromatogram limits. Array point
counts come from the declarative `defaultArrayLength` attribute, so the decompression-bomb
class is removed by construction. Controlled-vocabulary facts are recognized by accession
and scoped to their immediate parent element, so an aggregate `fileContent` marker is never
mistaken for per-spectrum representation.

Conversions are compared against source facts captured before the backend ran and
recaptured afterwards, covering filesystem identity, byte length, content hash and typed
mzML facts. Required invariants cover spectrum and chromatogram counts, MS-level
distribution, per-record binary-array counts, roles, declared point counts and payload
presence, precursor counts, consecutive index sequences, recognized scan-number agreement,
output internal consistency and the requested zlib compression policy. Numeric-encoding markers, the
`indexedmzML` wrapper, byte length, newly emitted representation markers and retention-time
unit markers stay descriptive, because the recorded evidence already shows a faithful run
can produce them. Vocabulary-derived facts and native identity degrade to unverified rather
than failing when an indirect parameter group or an opaque identifier form makes them
unestablishable.

The harness now consumes those contracts and no longer owns entry fingerprinting, output
validation or a duplicated format-to-extension mapping. Supervised runs additionally report
the peak committed memory charged to the owned Windows Job Object as an advisory
observation for the later scale measurements.

This slice did not execute ProteoWizard, change UI or Tauri behavior, enable mzXML or BPC,
implement a cache, or add a stable CLI contract. It added one explicitly approved
production dependency, `quick-xml` `=0.41.0` with default features disabled, scoped to the
bounded mzML scanner; that crate and its only required transitive dependency were already
resolved in `Cargo.lock` through `tauri`, so the dependency graph gained no crate. No
A/B/C/D rating is upgraded. M0C Slice 2B still owes representative open-format navigation
and scale measurements.

## M0C Slice 2B representative navigation and scale evidence on 2026-07-27

One representative public acquisition was measured in isolation on an ephemeral
GitHub-hosted `windows-2025` VM: PRIDE `PXD081190`, `208,408,454` bytes, license
`Creative Commons Public Domain (CC0)`. A separate acquire-and-attest run
([`30239606441`](https://github.com/MianliWang/MScanvas/actions/runs/30239606441)) re-queried
the live PRIDE record, downloaded the file once with no redirect allowance, recorded SHA-256
`262D1178303CD934223239D5D93A3B842DCA69DA09CEF58E95A39B950D26B7E8` and discarded the payload
without executing anything. Only then was that hash pinned, and the measurement run
([`30239989762`](https://github.com/MianliWang/MScanvas/actions/runs/30239989762), commit
`96334600b45fb5910f1372934e430c91435685e8`) refused to start without it.

The file is `indexedmzML` with `36,319` MS2 spectra, no chromatograms and declared point
counts from `10` to `399`. The library scanner read all `208 MB` in `844 ms`.
Selected-spectrum retrieval cost `163`–`198` ms of backend time regardless of index
position, and twenty-four deterministic indices repeated over three passes held a backend
p50 of `164` ms, p95 between `186` and `194` ms and a maximum of `199` ms. Access did not
degrade with position or repetition and later passes were not faster. Every timing and
memory figure is a single observation on a shared two-core runner and is advisory; no
threshold was created and no cache exists in this slice.

mzML conversion of the representative file returned `ConversionIntegrityOutcome::Valid`
with thirteen of fourteen properties verified, the exception being the opaque native
identifier form the canonical identity contract deliberately leaves unverified. An
independent .NET XmlReader pass agreed on validity and on both counts. The tiny control also
returned `Valid` with vocabulary-derived properties correctly degraded to unverified,
because that fixture reaches them through a `referenceableParamGroup`. Both converted
outputs were re-inspected and then navigated successfully.

The 8 MiB preview parser cap was deliberately left unchanged and was not reached: the
complete spectrum table for `36,319` spectra was `4,013,391` bytes and parsed in `40 ms`.
No API change was warranted.

One correction came out of the evidence. Selecting a legitimately peakless spectrum on
ProteoWizard's own reference fixture was falsely rejected as malformed; a spectrum with no
peaks is now a valid result with empty arrays, while declared-count disagreements remain
count mismatches and the no-result state remains distinct. The `tic` query returned exit 0
with no generated output on the representative acquisition, which the typed contract refused
to treat as success; that is a recorded capability limit, not a defect.

Sanitized evidence was independently downloaded and manually audited: the representative
acquisition name, its prefix, drive-letter and UNC paths, runner identity, workflow
environment variables, credentials and raw scientific arrays were all absent, and teardown
attested all ten proofs including acquired fixtures and generated conversion outputs. The
temporary evidence workflow and orchestration script were removed from the tree afterwards.

ADR 0003 moves from proposed to accepted for M1–M2 preview navigation with named limits.
MS1 and chromatogram behavior, TIC and BPC from representative data, vendor RAW, mzXML,
alternate locales, real cancellation and any preview cache remain outside that acceptance.

## M1-M2 first mzML preview workspace on 2026-07-27

The desktop application now has one real path through the product instead of a
mock shell. A local `.mzML` file can be opened, its metadata, run summary and
spectrum list read, one spectrum selected, and that spectrum drawn. Everything
displayed comes from the file through the merged M0C preview contracts.

The webview may ask exactly six things and parses no backend output. Rust owns
the absolute path, invokes the native pickers through `comdlg32` and `shell32`
rather than a dialog plugin so the main-window capability set stays empty, and
decides file acceptance including symlink and reparse-point rejection. The
frontend receives an opaque session handle and a display name.

Two of the six choose which ProteoWizard is used: a folder picker, and a way
back to automatic discovery. The choice lasts for the session and is never
written to disk. Automatic discovery searches `PATH` and the locations an
installer writes; a chosen folder looks wherever it is told, which is narrower
than either only because it applies to one session and is never stored. The webview names no path in either
direction — it asks for a picker, and receives a verdict that states which
installation it describes.

The transfer objects preserve what the backend actually reported. Retention
times carry an explicit unknown unit, an absent chromatogram count stays absent
rather than becoming zero, selected-spectrum representation and array units stay
unreported, and a spectrum with no peaks is a spectrum rather than a missing
result. Error detail is a stable structural identifier, not backend prose, and
metadata lines are redacted both for the opened path and for any remaining
absolute-path shape the document itself recorded.

The mock acquisition list, mock conversion inspector, mock run queue and mock
total ion chromatogram were deleted rather than migrated. The spectrum plot is
repository-owned SVG drawn as sticks, with no charting library and no new
dependency; the only lockfile change in this slice is two intra-workspace
dependency edges.

Validation passed with:

| Command | Result |
| --- | --- |
| `cargo fmt --all --check` | Passed |
| `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings` | Passed |
| `cargo test --locked --workspace --all-targets` | Passed; 19 desktop preview tests among them |
| `python -B scripts/check_repo.py` | Passed |
| `pnpm install --frozen-lockfile --strict-peer-dependencies` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 19 frontend tests |
| `pnpm build` | Passed |
| `git diff --check` | Passed |

Timings recorded in the workspace are descriptive observations on the running
machine. They are not budgets, no threshold derives from them, and no cache was
added to improve them. Total ion chromatogram, base peak chromatogram,
chromatogram UI, mzXML, vendor acquisitions, the conversion workflow, queueing,
retry, progress, real cancellation and any preview cache remain outside this
slice. See [ADR 0005](docs/architecture/adr/0005-mzml-preview-boundary.md).

## Windows validation completed on 2026-07-23

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed (2 frontend tests) |
| `pnpm build` | Passed |
| `cargo fmt --all --check` | Passed |
| `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings` | Passed |
| `cargo test --locked --workspace --all-targets` | Passed (5 Rust tests) |
| `python -B scripts/check_repo.py` | Passed |
| `pwsh -NoProfile -File .\\scripts\\bootstrap.ps1` | Passed end to end |
| `pnpm tauri build --no-bundle` | Passed; produced a Windows release executable |

The desktop executable was built but not launched. This record therefore does not
claim a rendered Windows runtime smoke test.

### Rendered Windows runtime check, 2026-07-27

`pnpm tauri dev` was launched and the window was inspected on Windows 11 at
2100×1300 physical pixels on a 3840×2160 display at 150% scaling, during the
first mzML preview slice. The shell, the backend-availability banner and the
no-file state render correctly and the window carries no document scrollbars.
Three layout defects were found and fixed by that check; see the ADR 0005
slice for what they were.

The check is partial and this record does not claim more than it covers. The
loaded-preview, selected-spectrum, empty-spectrum and file-picker states were
not exercised against a real backend during that slice; they were covered by
automated rendered tests only.

**Corrected 2026-07-27.** This record previously gave the reason as "the host
has no ProteoWizard installation and no local mzML file". Both halves were
false. ProteoWizard 3.0.26013 was installed and eleven local `.mzML`
acquisitions were present. What was missing was not a backend but the ability
to find one: discovery did not search the directory the per-user installer uses.
The five screenshots taken during that check all show the backend-unavailable
banner, and every one of them is a picture of that defect rather than of an
absent installation.

## Host ProteoWizard was installed and not found, 2026-07-27

MSCanvas reported `backend_not_found` on this development host while
ProteoWizard 3.0.26013 (revision `47b13cf`, built Jan 13 2026) was installed and
working. Both executables were present and answered `--help`. Discovery reached
neither.

`DiscoveryEnvironment::from_process` scanned `%ProgramFiles%` for versioned
`ProteoWizard*` directories but added only two exact literals under
`%LOCALAPPDATA%`: `Programs\ProteoWizard` and `ProteoWizard`. The per-user
installer writes to `%LOCALAPPDATA%\Apps\ProteoWizard <version> 64-bit`, which
no branch reached. The rule that would have found it had already been written
and was applied to one container only.

The evidence was available and was explained away. Windows Installer metadata
reported version `3.0.26013` — exactly the installed version — and this record
and the M0 spike both filed it as residual registration for an absent product.
It was the installed product.

Corrected by `fix: find a per-user ProteoWizard installation` and
`fix: search a newer ProteoWizard release before an older one`. The second is a
separate defect found while reviewing the first: the versioned directories were
ordered as text, so `3.0.9134` sorted above `3.0.26013` and a machine with both
would have run the older one. Discovery returns a single candidate with no
fallback, so that order decides which binaries execute.

After the fix, on the same machine with nothing added to `PATH`:
`availability=Available`, `source=CommonInstallRoot`, `release=3.0.26013`,
`same_installation=true`.

## Real-acquisition measurements, 2026-07-27

Eleven local mzML acquisitions were read only, never copied into the repository,
and no file name, sample identifier, compound identifier or m/z value from them
appears in this repository. One 208.5 MiB acquisition was measured through the
spike harness against the host installation.

| Operation | Backend | Peak owned-job memory | Result |
| --- | --- | --- | --- |
| Metadata | 233 ms | 35.8 MB | 5 sections |
| Run summary | 4,148 ms | 141.0 MB | 26,431 spectra |
| Spectrum table | 5,440 ms | 141.1 MB | 26,431 rows; 2,894,911 generated bytes; 24 ms to parse |
| Selected spectrum, first index | 281 ms | 35.7 MB | 17 points |
| Selected spectrum, middle index | 231 ms | 35.8 MB | 214 points |
| Selected spectrum, last valid index | 261 ms | 35.8 MB | 100 points |
| Selected spectrum, first index past the end | 211 ms | 35.7 MB | typed no-result, `spectrum_unavailable` |

These are single observations on one machine and one file. They are not a
latency budget and nothing derives a threshold from them.

Two facts worth keeping. The out-of-range index returned the typed no-result the
desktop boundary depends on, against a real backend rather than a substituted
provider. And the spectrum table for 26,431 spectra occupied 2.76 MiB of the
8 MiB output ceiling — 109.5 bytes per row, so the ceiling is reached at roughly
76,600 spectra. `MAX_SPECTRUM_TABLE_ROWS` is 100,000, which this backend's row
format cannot reach: the byte ceiling refuses the whole preview before the row
bound could disclose a truncated prefix. An acquisition beyond about 76,600
spectra is refused rather than partially shown.

## Rendered check against a real acquisition, 2026-07-27

The loaded-preview and selected-spectrum states were exercised against the host
installation and a real 208.5 MiB acquisition at 3048x1523 and at 1280x760.
Window contents were captured with `PrintWindow` and `PW_RENDERFULLCONTENT`,
which renders the window itself rather than the screen, so no other application
can appear in a capture.

The check found one layout defect and it is fixed: the selected-spectrum facts,
the plot caption and the identifiers heading were painted on top of the stick
spectrum. It appears only when the panel is shorter than the plot's minimum
height, which needs a loaded spectrum to reach.

It also confirmed that path redaction works on real input rather than on
invented cases. The acquisition's metadata carries the absolute path the
instrument wrote it to, on a drive this machine does not have; the panel shows
`<path>` for both `sourceFile` locations.

Still not exercised: the empty-spectrum state, and the native file picker as a
captured state. A file was opened through the picker, so it works; the dialog
itself was not captured.

## Rendered check of backend installation selection, 2026-07-28

The installation-selection workflow was exercised interactively on Windows
against a real ProteoWizard installation, on the exact feature head
`01389e91b4ae178c4f9b625f8599c7831130a0e6`, which merged to canonical `main` as
`a225835213d6286a3fc7b6803283da758d5e0104`.

Covered: choosing a valid installation folder; cancelling the picker from the
automatic state and from the chosen state; an invalid folder; returning to
automatic discovery from the chosen-available and chosen-unavailable states;
switching installation with a file open; the selected file being retained and
explicitly reopened without the picker reappearing; busy feedback while the
probes run; keyboard activation of `Choose folder…` and Escape cancellation; the
application window returning to the foreground; `1366×768`, `2560×1600` and
`900×700`; the WebView2 console; and the Rust and Vite process logs.

Observed: a chosen folder reports an available verdict carrying its release and
build, and states that the verdict describes a chosen installation. No backend
path appears anywhere in the interface. Cancelling the picker leaves the
rendered state unchanged. An invalid folder gives a specific reason with no path
and no operating-system message. Switching installation discards the
backend-derived facts, keeps the selected file, and offers an explicit reopen
rather than rereading on its own. No product error, warning or panic appeared;
the development favicon `404` is a Vite development artifact rather than a
product error.

Two defects were found during this check and deliberately left out of that
change, each tracked as its own issue:

- the workspace overflows horizontally at `900×700`, empty-state text is clipped
  and the primary action is pushed outside the visible viewport. It reproduced
  after the affected interface files were restored to their `origin/main`
  versions, so it predates the installation-selection work. Tracked as issue
  #24. Remeasured on 2026-07-29: of the three observations here, only the
  clipped text still reproduced, and the record below says what was found and
  what was repaired.
- disabling the focused banner control for the picker's lifetime removes DOM
  focus, and re-enabling it does not restore focus, so a keyboard user loses
  their place after cancelling. The stick-plot caption also reads `1 sticks`
  when the column reduction yields a single stick. Tracked as issue #25, and
  repaired on 2026-07-29; see the record below.

Neither follow-up invalidates the resolved-backend-identity or
session-only-selection outcome. Every control remains reachable by Tab, the
window keeps the foreground, no path is disclosed, and no reading is mixed
across installations.

## Rendered check of picker focus restoration, 2026-07-29

Issue #25 was implemented and checked interactively on Windows against the
ProteoWizard installation the application found through its own discovery path.
The check was run first on the application code introduced by `fix: restore
focus after the native picker closes` (`a49831887c07d0f11074ec5d7a6b61e2c888a8c0`),
and then again in full after each of the two review repairs, last on
`989470a5ac87e97c2165a695e68109a0a23dc53b`, which is the final commit in this
change to touch application code. The documentation commits change none of it.

Covered at `1366×768`: `Tab` reaching `Choose folder…` with a visible focus
ring; `Enter` opening the native folder dialog, which owned the foreground;
`Escape` cancelling it; the application window regaining the foreground;
`document.activeElement` being that same control again; the focus ring being
present again; a following `Enter` reopening the dialog immediately; and a
second `Escape` restoring focus again. The same path was exercised for
`Choose a different folder…` in the chosen-folder-unavailable state, reached by
choosing a folder that holds no installation.

Observed: while a request was outstanding, `document.activeElement` was the
document body and the banner said the installation was being checked, so
nothing was restored early. Cancelling left the verdict, its release, its build
and its origin exactly as they were. Neither `Search automatically` nor
`Check again` claimed the keyboard after it finished, and a successful folder
choice that removed the control it started from focused nothing and raised no
error. The pre-existing `Open mzML…` file-picker focus behaviour is unchanged.

Two outcomes that are not cancellations were checked as well, because they
decide whether the trigger the picker was opened from is still that trigger.
Choosing a second folder that also holds no installation replaces the verdict
but leaves `Choose a different folder…` exactly where it was, and the keyboard
returned to it with its ring. Choosing an unusable folder from the automatic
state renames that same button node to `Search automatically`, and nothing was
focused — which is the point, since `Search automatically` is one `Enter` away
from undoing the choice that had just landed.

The last rerun covered the first interaction after startup deliberately. Review
found that an effect queued by an earlier commit could consume the remembered
trigger between the press and the dialog, because it carries the `busy` of the
render that queued it; the automated tests showed it as a flake rather than as a
failure, at four failures in twenty-four runs. That is fixed, and the rendered
path was rerun from a fresh application start to exercise exactly that timing.

Smoke checks: `1920×1080` repeated the whole cancel-and-restore path with the
same result; `900×700` reached the chooser by keyboard and restored focus after
cancellation with no new focus or control-state problem. Issue #24 is not
repaired by this change, was not investigated further, and this record claims no
layout correctness at `900×700`.

The WebView2 console held four entries, every one a development artefact: the
Vite favicon `404`, two Vite client connection messages and the React DevTools
notice. No product error, warning, exception or unhandled rejection appeared,
and the Rust/Tauri and Vite process output added nothing during the session. No
acquisition was opened, so no fixture, path or scientific value was involved;
the singular `1 stick` caption is covered by automated tests instead.

## Rendered check of the narrow desktop layout, 2026-07-29

Issue #24 was measured, repaired and rechecked interactively on Windows at 150%
display scaling (`AppliedDPI` 144, `devicePixelRatio` 1.5). Baseline on
`7e0a6390ba2c930378456e1eb476f7ab4d051922`; the application code was checked
first on `650de82cbbf783ec84297b385caee2fcecb5701e` and again after the review
repair described below. Documentation commits change none of that code.

The issue names a `900×700` window. That is the native outer size, and at this
scaling it is a CSS viewport of `586×430`, which is the number the layout
actually answers to. The application's own minimum window is 960 logical pixels
wide, so this viewport is narrower than a user can reach by dragging; it was
produced deliberately, and `tauri.conf.json` was left alone because at the real
minimum nothing overflowed or clipped either.

Two of the three reported symptoms did not reproduce on the baseline. With no
file open, `documentElement.scrollWidth` equalled `clientWidth` at every width
tested down to a CSS viewport of 360, `body` likewise, and `Open mzML…` stayed
inside the viewport. The document min-width had already gone on 2026-07-27 and
the single-column rule at `1120px` and narrower keeps the two-column track
minimums from forcing the document wider.

What did reproduce is the clipped text. With a file open, the spectrum table's
panel header was 667 CSS pixels of content in a 569-pixel panel and its
sentence was cut mid-word at the panel edge. The header asks for an ellipsis and
never got one: the block holding the heading and that line is a flex child,
which does not shrink below its own content, so the line was never given a width
to truncate to. The block may now give ground.

A second narrow-width clip was found in review and repaired with it. The action
that offers the retained file says that file's name, and a name with nothing in
it a line may break at made that action wider than its panel: measured at this
viewport, a 118-character name produced a button 982 pixels wide against a
570-pixel panel, clipped at both ends because the empty state centres it. Such
a label may now break, and the same measurement gives 513 pixels and no
clipping, while an ordinary label is untouched.

After the fix, at CSS viewports `586×430`, `1366×768` and `1920×1080`, in the
empty state and with an acquisition open: `documentElement.scrollWidth` equals
`clientWidth`, `body.scrollWidth` equals `body.clientWidth`, each panel's own
header fits its panel and stays inside the viewport, and the header ellipsis
engages where truncation is needed. The spectrum table keeps its own horizontal
scroller inside its panel, which is containment rather than document overflow;
its column header row is not part of that scroller, so at this width the
right-hand column labels stay out of view while their values scroll. That is a
separate defect, tracked on its own and not repaired here. `Tab` reaches
`Open mzML…`, `Check again` and `Choose folder…` in that order with a visible
focus ring at the narrow viewport, a pointer click lands in the window, and the
issue #25 picker focus restoration still works there.

The WebView2 console held the same four development artefacts and nothing else;
the Rust/Tauri and Vite output added nothing during the session. The acquisition
used for the loaded-state check was read through a neutral working copy outside
the repository, which was deleted afterwards, so no fixture name, path or
scientific value appears here. Window captures were not used as evidence in this
session: the measuring process ran without per-monitor DPI awareness, which
crops them, so every claim above is a measurement.

## Rendered check of the spectrum-table column labels, 2026-07-29

Issue #29 — the table's column header row sitting outside the element that
scrolls it — was measured, repaired and rechecked interactively on Windows at
150% display scaling (`AppliedDPI` 144, `devicePixelRatio` 1.5). Baseline on
`3429bd49fa7da6b3452c965065155103e46f5e02`, final application code on
`2e16fe543181059aff540166b3fc316829cd24ea`, which is the last commit here to
touch application code; the check was run on `49acfdc…` first and again after
the review repair described below. Documentation commits change none of it. Native outer `900×700` is a CSS viewport of
`586×430` at this scaling, and the CSS viewport is what the layout answers to.

Baseline, with an acquisition open at that viewport: the scrolling viewport
measured 553 wide against 760 of content while the header row measured 569 and
did not scroll. At `scrollLeft` 0 the two agreed; at 104 the header was 104
pixels adrift and `Total ion current` showed values with no label; at the
maximum, 207, both `Total ion current` and `Precursor m/z` did, and their
labels could not be brought into view at any scroll position.

After the fix, at the same viewport and the same three positions — 0, 109 and
217 — the largest difference between any column label's left edge and its
values' left edge was **0 pixels**, and the set of visible labels equalled the
set of visible values at each position, `Total ion current` and `Precursor m/z`
included. `1366×768` and `1920×1080` need no horizontal scrolling at all and
measured the same zero difference. Scrolled down to 400 and 900 pixels the
header stayed at the top of the viewport, still aligned, with the rendered row
window advancing and holding no duplicate or blank rows.

Only one element in the table now scrolls, and the header is not it. The header
is sticky with an opaque background and wins the paint order against the rows
passing under it. Keyboard: `Tab` reaches a row in five stops with a visible
focus ring, the arrows move focus without selecting, `Enter` selects, and a row
reached with the arrows is never left behind the sticky header or below the
viewport — checked at the right-hand scroll position as well as the left. The
nine columns, their order, their labels and their values are unchanged;
`aria-rowcount`, `aria-colcount`, the single header row, the row roles and the
single roving tab stop are unchanged.

Review found the one thing moving the header inside the scroller cost, and it
is repaired in `2e16fe543181059aff540166b3fc316829cd24ea`. Bringing a focused
row into view is the browser's to do, and it treats a row that is already half
behind the header as near enough: at a scroll position where the roving tab
stop was partly covered, focusing it moved nothing and left 20 pixels of the
row, and of its focus ring, beneath the labels. With the header's row reserved
through `scroll-padding-top`, the same measurement lands the row on the
header's bottom edge — measured at seven scroll positions, none behind it.

Issue #24 containment did not regress: `documentElement.scrollWidth` equals
`clientWidth` and `body.scrollWidth` equals `body.clientWidth` at all three
viewports, with the table's own scrolling inside its panel. Issue #25 did not
regress: `Choose folder…`, `Enter`, `Escape` returns the keyboard to that
control with its focus ring, leaving the verdict as it was.

The WebView2 console held the same four development artefacts and nothing else,
and the Rust/Tauri and Vite output added nothing during the session. The
selected-spectrum panel did not draw for the acquisition used here: it reported
that the spectrum list and the spectrum disagree about which scan the row is,
which is the reconciliation this application performs in Rust declining to show
one beside the other. It reported the same for every row tried, no console entry
accompanied it, and nothing in this change touches that path. Whether the file
itself is at fault was not investigated; it is recorded because it was seen, not
as a finding about the backend. The acquisition was read through a neutral
working copy outside the repository, deleted afterwards, so no fixture name,
path or scientific value appears here.

## Accepted-file identity hardening, 2026-07-30

An accepted mzML file is now bound to the complete Windows file identity: the
64-bit volume serial and all sixteen file-ID bytes of `FILE_ID_INFO`, obtained
through `GetFileInformationByHandleEx`. It previously used the 64-bit index from
`GetFileInformationByHandle`, which is narrower than the identity the
ProteoWizard source boundary in `crates/proteowizard` has always bound, and a
comment in the desktop code wrongly said the two were the same information. A
filesystem that cannot supply the identity is refused exactly as before rather
than falling back to the old index or to the path.

This is a prerequisite for M1 duplicate detection rather than a feature: with
one accepted file at a time, a truncated identity can at most miss a
replacement, but as the key deciding whether two chosen files are the same
acquisition it could merge two distinct ones into a single workspace row.

Nothing else changed. The same canonical resolution, regular-file and
reparse-point rejection, per-use revalidation, handle format, Tauri commands,
transfer objects and frontend behaviour; no multi-dataset registry, no
duplicate detection and no ADR 0006 yet. The identity is private, is not
serialisable and prints as `<opaque-file-identity>`.

The backend tool identity shares that capture, and review found what the
widening cost it: on a volume that answers with no identity at all, both
readings are `None`, and two unknowns agreeing used to satisfy the metadata
fast path — so a tool replaced in place with its length and timestamp preserved
was called unchanged. The recorded digest now decides in that case, which is
the rule the equality beside it already stated.

Validation on the exact head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets` (75 desktop tests, seven of them
new), `python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`. The new coverage includes a real Windows hard link
and a delete-and-recreate at one path whose original is kept alive by a second
name, both through the production acceptance path and neither using a
scientific acquisition. Rendered QA was not required and not performed: no
frontend file, transfer object, command signature, capability or user-facing
string changed. ProteoWizard was not executed.

## Multi-dataset registry foundation, 2026-07-30

ADR 0006 records the M1 multi-dataset workspace boundary, and the Rust side of
that boundary now exists. A session owns an ordered `DatasetRegistry` of
accepted mzML datasets keyed by the Windows filesystem identity the previous
slice widened, with monotonic session-scoped identifiers that are never reused,
insertion order, typed add and revocation outcomes, and a per-dataset runtime
state holding a request epoch and either no preview or a complete one.

Nothing about this is reachable from the product. No Tauri command was added or
changed, no transfer object changed, no capability changed and no frontend file
was touched. `accept_file` still empties the workspace before registering, so
the session holds exactly one dataset and the webview holds exactly one
`file-N` handle, unchanged in spelling and in lifetime. The entry point that
adds a second dataset is compiled out of the shipped binary under `cfg(test)`:
until the roster interface exists, a file the user cannot see, curate or remove
would be a capability they never asked for and could not withdraw.

Two defects a roster would otherwise have shipped with are closed. Spectrum
supersession was one session-wide ticket, so a request in one dataset would have
cancelled a request the user was still waiting for in another; it is now a
per-dataset epoch. Preview facts lived in two maps written one after the other,
which made a recorded generation with no rows, and rows with no record of which
backend produced them, both representable; they now commit together under one
lock, and an open that finishes after its dataset was revoked records nothing
rather than leaving state under an identifier nothing can reach. Independent
review closed three more: a preview was recorded before the results it needs
were known to be present, so a batch short of one result left facts behind that
the caller was then refused; a spectrum request cloned the whole recorded table
— one entry per spectrum of the acquisition — while holding both the workspace
lock and the backend gate; and the identifier allocator could in principle wrap,
which is now a checked increment. The preview-recording repair matters because
the provider contract does not promise that the *i*-th attempt answers the
*i*-th operation, and a batch of the right length that is short of a required
result is exactly what that permits.

ADR 0006 also records two limits this slice does not close, each unreachable in
the product for its own reason. A filesystem may hand a deleted file's identity
to a new file, and only a live handle per dataset would prevent that being read
as a duplicate — unreachable because the picker empties the workspace before it
registers, so no duplicate check ever runs against a stale row. And two opens of
one dataset are serialised at the backend gate but not at the commit, so the
later commit wins whether or not it ran last — unreachable because the frontend
disables the picker while an open is in flight and never has two outstanding.

Boundary behaviour is deliberately unchanged where a user can reach it. A
request still waiting for its turn on a replaced selection still fails with
`selection_superseded`; a stale handle still fails with `unknown_file_handle`;
work that had already started is still not cancelled and its caller is still
answered.

Three differences are reachable only by a race or by a handle the application
never issued, and independent review found all three:

- A spectrum request for an unknown handle is now refused before it waits for
  the backend gate, instead of after. It used to claim a session-wide ticket
  first, so a request for a dead handle could supersede a live one, and a dead
  handle raced against a newer request answered `selection_superseded` rather
  than `unknown_file_handle`.
- The table rows a spectrum is reconciled against are now snapshotted with the
  rest of that dataset's preview facts, before the read, instead of being read
  again after it. A spectrum racing an `open_preview` commit could previously
  find no rows and skip reconciliation entirely.
- `file-00`, `file-+0` and `file-007` used to be refused as unknown handles and,
  for a moment during this work, would have reached `file-0`; the handle parser
  now requires the spelling the session issued.

Validation on the exact head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets` (90 desktop tests, up from 75:
sixteen test names added and one removed, one of the additions being the
single-slot registry's revocation test rewritten against the registry that
replaced it), `python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`.

Eighteen mutations were introduced one at a time against this exact head, and
each was caught by the test written for it: a duplicate minting a second
identifier; the allocator rewinding when the workspace is emptied; revocation
leaving the identity index behind; revocation leaving the request epoch and
preview facts behind; emptying the workspace reaching only its first dataset;
removal losing insertion order; an accepted file's debug output carrying the
path; the session's own debug output carrying a filesystem identity, an
installation path, or a native spectrum identifier; one session-wide request
ticket; a late reply recreating preview state; one preview record for the whole
session; reconciliation rows taken from another dataset; the picker accumulating
datasets; a handle parser that accepts spellings the session never issued; a
preview recorded before its required results were known to be present; and an
installation change rereading every dataset it invalidates.

Duplicate detection is proven with a real Windows hard link, taken through the
production acceptance path and then into the `cfg(test)` entry point, since no
production caller adds a second dataset. That coverage is Windows-only, as the
identity it decides on is. No scientific acquisition is used as a fixture.
Rendered QA was not required and not performed: nothing the user can see
changed. ProteoWizard was not executed.

## Registered dataset identities pinned, 2026-07-30

Every registered dataset now holds a live handle on the file it names, for
exactly as long as its registry row exists. The previous slice recorded the gap
this closes: a filesystem identity names an object only while that object is
alive, so a dataset that was added and then deleted could have its identity
handed to an unrelated acquisition, and the registry — which decides duplicates
by identity — would report that acquisition as a duplicate of a row naming
something else. Two distinct acquisitions on one workspace row is a
scientific-correctness failure, and it becomes reachable the moment the M1.2
roster lets a session hold several datasets. This is the prerequisite, not the
roster.

The handle is the one the accepted-file inspection already opened, kept rather
than dropped, so the identity and the hold that keeps it the file's own come
from the same inspection of the same object. Its share mode is unchanged and
deliberately permissive — read, write and delete — so renaming, deleting and
replacing a file MSCanvas lists all remain the user's to do. That is also what
makes the guarantee work rather than what weakens it: because the old object
stays alive, a replacement at the same path is alive at the same moment, and two
objects alive at once cannot share an identity, so the replacement is added as a
dataset of its own instead of matched to the row it displaced. The lease is a
lifetime and nothing else: every use still canonicalises the path, reopens it,
reruns acceptance and compares the canonical path, the identity and the source
generation, and a name that now points elsewhere is refused exactly as before.

Revocation and clearing release the lease with the row, a duplicate addition
drops the handle it arrived with rather than keeping a second one, and the
picker accepts and leases the replacement before it lets the previous selection
go — so a path the picker refuses leaves the selection and its hold exactly as
they were, and there is no window in which a released identity is free for the
file being accepted to be given.

One cost is paid and is recorded rather than left to be found, after automated
review raised it and it was measured. The lease asks for read access, and
Windows will not grant a later open whose own share mode refuses to share that
read, so a program that opens the file offering no sharing at all is refused
while a row names it. Measured against this head: an ordinary reader, a writer
that shares reads — which is what an in-place edit does — a rename and a delete
all still succeed while the lease is held; only the no-sharing open is refused,
with `ERROR_SHARING_VIOLATION`. The suggested repair, narrowing the lease to an
access mask the sharing rules exempt, was not taken here: it would stop the
lease being the handle the identity was read through, which is the property that
leaves no interval between establishing an identity and holding the object that
owns it, and it would remove the rule the release proofs use to ask the
operating system whether a handle is still open. ADR 0006 records it as a
separate decision for M1.2, where a roster of several held files is what makes
it worth the evidence.

Nothing the user can reach changed. No Tauri command was added or changed, no
transfer object, capability or frontend file was touched, no dependency moved,
the `file-N` handle spelling is unchanged, and the session still holds exactly
one dataset. The lease is private, is not serialisable, exposes no raw handle
and prints as `<opaque-identity-lease>`. ADR 0006 is amended rather than
superseded: the paragraphs deferring this to M1.2 are replaced by an *Identity
lifetime* decision, and the two alternatives that were weighed and refused —
rechecking the recorded file instead of holding it, and a lease that forbids
deletion — are recorded with it.

Validation on the exact head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets` (100 desktop tests, up from 90),
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`.

Nine mutations were introduced one at a time against this exact head, and each
was caught by the test written for it: an accepted file holding something other
than the object it names; registration letting the hold go the moment it stores
the row; a duplicate keeping the handle it arrived with; a revoked row's hold
outliving the row (twice, once for the row itself and once for a row revoked
while a read of it was still running); the picker emptying the workspace before
accepting the replacement; emptying the workspace reaching only its first row; a
lease whose debug output prints its raw handle; and a lease opened without
sharing deletion, which four existing tests caught because it stops the user
replacing their own file.

Three further findings came out of automated review, and all three were real.
Two were about the non-Windows path and are settled together, by that path
taking no hold at all. The first attempt gave it an owned descriptor, opened by
a second resolution of the name; review pointed out that a rename between the
two would record an identity no descriptor was keeping alive — the failure this
slice removes, moved rather than closed — and then that reading identity from
the descriptor instead still left a worse hazard, because std offers no
non-blocking open and a path replaced by a FIFO between the posture check and
the open would block the selection for as long as no writer arrives. Introducing
a way to hang in order to pin an identity nothing claims to pin is the wrong
trade, so that platform is back to exactly what it did before this slice, the
lease type stays uniform so the registry never branches on platform, and the
guarantee, the coverage and the claim are all Windows. A non-Windows lease needs
a non-blocking no-following open, which needs a dependency this project has not
taken; ADR 0006 records it there.

The third is about when a lease is released. A revoked row lets its own hold go
immediately, but a read that was already under way holds the file itself for as
long as it runs — it is reading it, and ADR 0006 has always said running work is
not cancelled. So the object is released when that request finishes rather than
when the row goes, and nothing outlives the request. That is now stated in the
ADR, in the code, and asserted at both ends by the late-reply test: held while
the read runs, released once it returns.

The release proofs are of two kinds and both are deterministic. One asks this
process, through a weak reference that holds nothing open itself, whether every
holder of a lease has let go. The other asks Windows, by requesting the file
while offering no sharing at all — a request the system grants only when nothing
else has the object open, decided by the share rules rather than by timing. The
identity-recycling scenario is exercised against the real filesystem: a
registered file is renamed away, a different acquisition is written at its former
name, and the original's last name is then removed, so nothing but the registry's
lease keeps it alive. Windows-specific coverage is gated on `#[cfg(windows)]`;
other platforms hold an owned file handle for the same reason and claim no part
of the Windows identity guarantee, which CI does not exercise because it runs on
Windows only. No scientific acquisition is used as a fixture. Rendered QA was not
required and not performed: nothing the user can see changed. ProteoWizard was
not executed and the desktop application was not launched.

## Validation completed during repository initialization

- Required-file and source-of-truth contract checks.
- JSON and TOML parsing.
- GitHub workflow and issue-template YAML parsing.
- Repo-local skill frontmatter checks.
- Relative Markdown-link checks.
- Git whitespace and object-integrity checks.
- ZIP extraction and Git bundle clone verification.

## Intentionally pending

- Exercise the empty-spectrum state, and capture the native file picker as a
  rendered state, against a real ProteoWizard installation on Windows. The
  shell, no-backend, backend-available, loaded-preview and selected-spectrum
  states were checked on 2026-07-27, and the backend installation-selection
  workflow including the native folder picker on 2026-07-28; see "Rendered check
  against a real acquisition" and "Rendered check of backend installation
  selection" for what those checks covered and what they did not.
- Complete the remaining ProteoWizard provider gates: MS1 and chromatogram behavior, TIC
  and BPC from representative data, real cancellation, alternate-locale parsing and
  separately authorized vendor coverage. The typed preview-result/canonical-identity
  boundary, the mzML conversion-integrity contract, the bounded open-format disposable-VM
  matrix and the representative navigation and scale measurements are complete.

## First verified-bootstrap checklist

- [x] Create `MianliWang/MScanvas` on GitHub.
- [x] Synchronize the initialized source tree to `main`.
- [x] Install pnpm and the Rust toolchain declared by this repository.
- [x] Run `pnpm install` and commit `pnpm-lock.yaml`.
- [x] Run `cargo generate-lockfile` and commit `Cargo.lock`.
- [x] Run all frontend and Rust checks.
- [x] Run `pnpm tauri dev` on Windows against a real ProteoWizard installation; the
  empty-spectrum state and a captured native file picker remain unchecked.
- [x] Confirm Tauri capability configuration remains minimal.
- [x] Complete the M0 ProteoWizard provider decision for preview navigation; ADR 0003 is
  accepted for M1–M2 with named limits. MS1/chromatogram behavior, TIC and BPC from
  representative data, cancellation, locale and vendor gates remain separately open.
- [x] Protect `main` after the first green CI run. The `Protect main` repository
  ruleset requires the Frontend, Rust and Repository quality checks, requires the
  branch to be up to date, requires review threads to be resolved, and forbids
  force-pushes and branch deletion.
