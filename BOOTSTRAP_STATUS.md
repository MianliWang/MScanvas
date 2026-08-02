# Bootstrap status

**Updated:** 2026-07-30

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
lease keeps it alive. Windows-specific coverage is gated on `#[cfg(windows)]`,
and there is nothing to gate elsewhere: only Windows holds a file handle, so
only Windows has the guarantee to prove, and CI builds no other target anyway.
No scientific acquisition is used as a fixture. Rendered QA was not
required and not performed: nothing the user can see changed. ProteoWizard was
not executed and the desktop application was not launched.

## First user-visible multi-file workspace, 2026-07-30

The registry M1.0–M1.1.5 built is now a list the user can see and curate. Four
typed commands reach it — read the roster, show the native picker and add
everything chosen, remove named rows, empty the session — and the single-file
picker command is retired rather than kept beside its replacement. No command
accepts a path, the main window's capability set is still empty, and the webview
still receives an opaque handle and a display name and nothing else.

The Windows picker gained `OFN_ALLOWMULTISELECT` beside the flags it already had,
and a parser for the documented multi-string answer: one absolute path for a
single file, a directory and one bare name per file for several. A component
that cannot be what its position says it is, and an answer with no final
terminator, are refused rather than joined into paths nobody chose; an answer
that did not fit is a typed failure rather than a shorter selection that looks
whole.

A session is bounded to 1,024 datasets, because every Windows row owns a live
identity lease and every mutation answers with the whole roster. Duplicates are
decided before capacity, so a file already in a full workspace is still a
duplicate, and nothing the session refuses spends an identifier.

One defect the previous slice recorded as unreachable is closed first, because
the roster is what makes it reachable: an open now claims the same per-dataset
request epoch a selected spectrum claims. A newer request for one dataset makes
an older open of it stale at both ends — one still waiting for the backend gate
never launches, and one that had already started records nothing and answers
`selection_superseded` rather than returning a preview as though it were current.
Beginning an open also drops what the previous open recorded, so a reopen that
fails leaves no table rows behind for a later spectrum to be reconciled against.
Work on one dataset supersedes nothing in another.

Reading is explicit and bounded. Moving around the roster, changing the
selection, adding files, removing rows and emptying the list start no backend
work at all; adding into a session that had nothing in it reads the first row
that arrived and nothing else, so one picker operation is one process rather
than one per file; and a second activation waits until the current viewer
request settles. The frontend's single boolean open marker was replaced by a
token-and-handle marker plus a count of unsettled viewer requests, so a stale
reply can neither overwrite a newer preview nor report the backend lane idle
while its own process is still running.

Validation on the exact head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets` (130 desktop tests, up from 100),
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
(154 across ten files, up from 88), `pnpm build`. `pnpm lint` and `pnpm typecheck`
remain the same `tsc -b` invocation; this repository has no separate linter.

Thirty mutations were introduced one at a time against this head and every one
was caught by the test written for it: capacity decided before duplicates; an
identifier spent on a duplicate, a rejection or a full workspace; additions
prepended rather than appended; a rejected candidate named by its whole path;
emptying the workspace reaching only its first row; a repeated handle removing
twice; the roster stating a capacity of its own; beginning an open keeping what
the previous one recorded; an open committing without rechecking its epoch; an
open that waited its turn launching anyway; a picker answer with no terminator
read as a whole selection; a later component that is really a path joined anyway;
a first component that is not absolute accepted; adding to a non-empty session
stealing the row being read; a batch leaving the previous selection in place; a
removed row still counting as the row being read; focus recovery never looking
backwards; a Shift press dragging the anchor; Ctrl only ever adding; Shift with
an arrow not extending; a missing source reported as an ordinary failure; a
notice listing every item it has; a second activation not bounded by the one
running; a settling request reporting the lane idle whatever else is running;
every added file being read rather than the first of an empty session; removing
any row taking the preview with it; a failed read saying nothing about the row it
failed on; a stale open reply applied to whatever is on screen; a roster read
never adopted; and a failed roster read replacing the rows with an empty list.

### Rendered check of the workspace roster

Run against `pnpm tauri dev` on Windows 11 at 150% display scaling, on the exact
application-code head, with a real ProteoWizard 3.0.26013 and two authorized
local acquisitions of about 208 MB each. They were reached through neutral hard
links in a working directory outside the repository, which was deleted
afterwards; the acquisitions themselves were not modified and are still there.
No fixture name, path or scientific value is recorded here.

The application was driven through the WebView2 debugging protocol: pointer
presses and key presses were dispatched into the page's own input pipeline and
hit-tested against the element they were aimed at, and every command the
interface issued was counted at the IPC transport. The two native dialogs cannot
be reached that way, so the picker's file-name field and its Open button were
driven directly as the windows they are, and the folder picker was cancelled with
a real Escape.

- **One picker operation, two files.** Two rows in the order they were chosen,
  both selected, the first focused, holding the roving tab stop and marked as the
  one being shown. Exactly two commands were issued: `choose_mzml_files` and one
  `open_mzml_preview`. Not one path, drive letter or UNC prefix appears anywhere
  in the document; the two path shapes the acquisition's own metadata records are
  redacted to `<path>`.
- **The webview reloaded.** Rust still held both rows, and the list came back with
  neither of them selected and neither being shown: a workspace is what the
  session holds, and a reload is not a request to read anything.
- **A duplicate.** The same acquisition added again under a second name produced
  no new row and no read; the notice named the row the user already has, by the
  name it was registered under rather than the name it was just given. Two other
  files added in the same operation arrived normally, and a `.mzXML` typed into
  the picker was refused by its own filename with the reason for it — the files
  accepted beside it stayed accepted.
- **Selection, with a real pointer and a real keyboard.** Plain click, Ctrl-click,
  Shift-click over a range, ArrowUp, ArrowDown, Space, Home, End, Shift+Arrow and
  Ctrl+A each did what a file list does, and across all of them the interface
  issued no command whatsoever. Enter on the focused row issued exactly one
  `open_mzml_preview`.
- **Switching.** Focusing another row read nothing and left the summary naming
  the row still on screen; `Preview focused` then read that row, moved the marker
  and replaced the summary. No stale reply from the first read overwrote it.
- **Removing and clearing.** Removing two rows that were not the one on screen
  left the preview alone and said "Removed 2 files from the list. The files on
  disk were not changed."; removing the row that was on screen cleared the
  preview, read nothing in its place, and left the tab stop on the row that took
  its position; `Clear list` emptied the session without a restart and put the
  keyboard on `Add files…`. Every fixture file was still on disk afterwards, at
  its original size.
- **Issue #24.** `documentElement.scrollWidth` equals `clientWidth` and
  `body.scrollWidth` equals `body.clientWidth` at all three viewports, and the
  document does not scroll vertically either.
- **Issue #25.** Opening the backend folder picker and cancelling it returned the
  keyboard to `Choose folder…` with its focus ring visible, left the verdict as
  it was, and left the workspace and the preview untouched.
- **Issue #29.** At the narrowest viewport the spectrum table is horizontally
  scrollable by 217 CSS pixels; at scroll offsets 0, 109 and 217 every column
  label sits at exactly the same horizontal position as the values beneath it —
  maximum drift zero — with the header row pinned to the top of the scroller.
- **Spectrum keyboard.** Two arrow presses moved the focused row and issued
  nothing; Enter issued exactly one `load_selected_spectrum` and selected the row
  it was on.
- **Console and logs.** The WebView2 console held the three known development
  messages from a `tauri dev` session — two Vite connection lines and the React
  DevTools notice — and nothing else. No page error and no unhandled rejection.
  The Rust/Tauri output held its ordinary build and watch banner; the Vite output
  held its ordinary ready line.

The rendered check found one defect, which is repaired in this branch. Stacked at
896x475 CSS pixels the workspace column got a fraction of an already short
window, the roster's header, actions and the summary of the batch that had just
arrived used all of it, and the list came out at zero height with four rows in
it — rows that exist, are announced to a screen reader, and cannot be reached by
pointer or keyboard. The panel now has a minimum height that is its own chrome
plus room to be a list, the stacked track has a floor to match, and the account
of the last workspace action moved out of the roster panel into the shell
notices, where a summary that grows with the batch no longer takes its height
from the list it is describing. Measured after the repair, at native 900x700
(586x430 CSS), at 1362x743 CSS and at 1906x1043 CSS, the list holds two, two and
two of two rows with its own scrolling for more, and no viewport overflows the
document in either axis.

One flow was not reproduced: the backend being unavailable. Making a real
ProteoWizard installation unusable means changing the machine this check runs on,
and the folder picker offers no way to name a folder without one. It is covered
by automated tests instead — adding files with no usable backend leaves the
roster fully usable, reads nothing, and says that ProteoWizard is needed to read
a file rather than to curate the list.

One crash was seen, three times, and was chased until it could be reproduced on
demand. The application exits with `0xc000041d` — `STATUS_FATAL_USER_CALLBACK_
EXCEPTION`, an exception escaping a window-procedure callback the kernel
invoked — while the file picker is being driven. It never printed a Rust panic,
not even under `RUST_BACKTRACE=full`, and never reached the Windows application
log, which is consistent with an exception that never passes through Rust at
all.

What separates the runs that crash from the runs that do not is the harness, not
the product. To make a modal picker appear in front, this check sent a synthetic
`ALT` keystroke to whatever window held the foreground and then called
`SetForegroundWindow` across the process boundary, immediately before the dialog
was asked for. Every one of the three crashes came from a run that did that. The
foreground window at the time was recorded on the reproducing run: the Windows
lock screen. Removing those two calls and driving the same dialog by posting
`WM_SETTEXT` and `WM_COMMAND` to it, eleven consecutive picker operations across
three application launches all left the process alive. Putting the two calls
back reproduced the exit on the first attempt.

So the recorded finding is about the check: injecting keyboard input and a
cross-process foreground change into a locked desktop, and then opening a modal
common dialog there, can take the process down. That is not a state a user can
be in — a file picker cannot be operated on a locked screen — and no code path
in this change is implicated: `choose_mzml_files` and `parse_selection` have no
panic in them, every slice index is provably in range, and the crash leaves no
Rust unwind. The harness no longer makes the foreground change, and the rendered
evidence below was collected without it.

### What review found in the roster, 2026-07-30

Two whole-diff reviews — one on the security and boundary side, one on the
interface, accessibility and async side — produced seven findings, each then put
to two independent skeptics: one asked to refute it, one asked to write out a
reproducing sequence and check every step against the code. Six survived and are
repaired here; one was refuted by both, and the reason is recorded below.

The blocking one. Removing rows decided whether to take the preview off the
screen from the row it had captured *before* the request was sent. Curating
stays live while a removal is in flight, so the user can start reading another
file in that gap — and the reply then cleared the reading they had just started,
leaving its row saying "Reading…" for the rest of the session, because the
open's own reply was rejected on token order before it could say otherwise. It
now asks what the viewer actually belongs to at the moment it is answered.

Two were a row claiming a preview nobody can see. The reducer marked the first
file of a newly filled session as the one being shown whether or not a read
started, so on a machine with no ProteoWizard a row announced "Showing" beside a
file nothing had opened, while the viewer beside it said to install
ProteoWizard; the same marker also survived a backend change that had just
discarded what that row read. Which row is being read is now said where a read
begins, and the marker follows what the row actually holds — so the row keeps
its place as the one an explicit re-read acts on without claiming anything is on
screen for it.

Three were about what is said and to whom. The account of a workspace action was
announced only through a live region that arrived together with its text, which
is the shape screen readers routinely miss, and with a preview loaded no other
region's text changes when rows are added or removed — so a removal, including
its statement that the files on disk were not changed, could be silent. It is
now announced through a region mounted for the life of the application. The list
of per-item details keyed on its own text, which two names for one acquisition
make identical. And the roster stated "No files in this session yet" before it
had asked what the session holds, which is the one claim it cannot make: Rust
keeps the workspace across a reload of this window.

The refuted one was a variant of the duplicate-key finding whose reproduction
needed two files of the same name from two different folders in one batch. The
picker's multi-selection answer is one directory followed by bare names, and the
parser refuses anything else, so that batch cannot exist — the surviving variant
reaches the same key collision through two names for one file in one folder,
which can.

Each repair is pinned by a test that fails without it, verified by mutation:
the removal deciding from a handle captured before it was sent; the marker
ignoring whether anything was read; a read no longer saying which row it belongs
to; the notice list keying on its own text; the empty state claiming emptiness
while the list is being read; and the summary announced nowhere that already
existed. The duplicate-key repair is watched through the console, because
rendering two children with one key is something React complains about rather
than something a user sees.

Validation after the repairs: `pnpm lint`, `pnpm typecheck`, `pnpm test` (161
tests across ten files), `pnpm build`, `python -B scripts/check_repo.py`,
`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`.
The rendered check was run again on the repaired head from a clean start: one
picker operation with three files gave three rows and one `open_mzml_preview`;
click, Ctrl-click, Home, Shift+Arrow and Ctrl+A issued no command at all; Enter
issued exactly one; removing a row that was not being read left the preview up
and removing the one that was took it away and read nothing in its place;
clearing put the keyboard on `Add files…`; both polite regions were present with
the workspace summary in the one that had been mounted all along; and no
viewport overflowed the document in either axis. Console and page errors were
empty.

### Two further review rounds over the repairs themselves, 2026-07-30

The repairs were reviewed twice more on the same terms — every finding put to
one skeptic asked to refute it and one asked to reproduce it step by step. Five
findings survived the second round and four the third, and the third round's
were mostly defects introduced by the second round's repairs, which is the
reason for running a review over a repair at all.

The second round. `Clear list` read the count it announces after its own reply
rather than before its request, so it could report a number from a workspace
that had already changed; two mutations could be in flight at once, letting an
older reply's roster snapshot overwrite a newer one's; a workspace action that
repeated the one before it produced the same sentence and so was announced
nowhere; the visible notice said its unlisted items were "listed on screen",
which is the opposite of what it means; the roster's empty state said "the
workspace is empty" after the read that would have told it had failed; and a row
could carry the active accent bar with no glyph beside it, which is colour
carrying meaning alone.

The third round, over those repairs. The alternating character added to make a
repeated announcement announceable was a *sibling* text node, so React left the
sentence node untouched and the only mutation was a space appearing or
disappearing — a `childList` change the region's default `aria-relevant` does
not announce in one direction, and a collapsible trailing space that Blink drops
from the accessibility tree in the other. The repeated action was still
announced nowhere; the test that was supposed to hold it asserted `textContent`,
which jsdom reports without any of the CSS collapsing a browser applies, so it
passed on a difference no screen reader would ever see. The alternation now
lives inside the sentence and is a non-breaking space, which CSS keeps. The
spoken account also claimed "N more are not listed" while enumerating none of
them — a count belonging to the visible list, which is the half that stopped
short — and now says only the totals. The one-mutation-at-a-time gate turned out
to be one-directional: `Add files…` waited for a removal or a clear, but neither
waited for an add, and an add holds the picker *and* the registration behind it.
And a roster read that failed on mount was permanent, so the workspace went on
reporting that its list could not be read long after an action had established
what it holds.

Each repair in both rounds is pinned by a test that fails without it, verified by
mutation — eleven mutations across the two rounds, each reintroducing exactly one
defect, all caught. Two mutations survived their first attempt and are worth
recording: one asserted a live region's text by joining both regions together,
which passed whether or not the region under test had changed at all, and one
tested an equivalence rather than the original defect. Both tests were replaced
rather than the mutations dropped.

Validation on the final head: `cargo fmt --all --check`, `cargo clippy --locked
--workspace --all-targets -- -D warnings`, `cargo test --locked --workspace
--all-targets` (215 tests), `python -B scripts/check_repo.py`, `pnpm lint`,
`pnpm typecheck`, `pnpm test` (168 tests across ten files), `pnpm build`. The
rendered check was run once more on that head, without the foreground injection
described above: one picker operation with three files gave three rows and one
`open_mzml_preview`; pointer and keyboard selection issued no command; Enter
issued exactly one; removal and clearing behaved as before; the console and page
errors were empty; and at CSS viewports of 886x663, 1366x753 and 1920x1065 the
roster list measured 69, 97 and 262 pixels tall, holding two, three and three of
three rows with its own scrolling for the rest, with no viewport overflowing the
document in either axis and the spectrum table never forcing the page sideways.

## Rendered check of workspace search and sort, 2026-07-31

Run on the exact final application-code head, against a real ProteoWizard
3.0.26013 on Windows, in an unlocked session — the input desktop was confirmed
to be `Default` before anything was driven, and none of the foreground
injection that took the process down during M1.2 was used at any point.

The roster was fifteen neutral working copies outside the repository: one hard
link to an authorized local acquisition, renamed, and fourteen small files that
carry the name the boundary accepts and no acquisition, so they can be listed
without ever being read. Between them they cover numeric ordering
(`Sample-2` against `Sample-10`, `Standard-3` against `Standard-21`), case
(`qc_pool-1` against `QC_pool-2`), a diacritic, a full-width Unicode name, a
name far too long for its column, and sizes from 1 KiB to 212.7 MiB. No path,
real name or scientific value is recorded here.

**What the search does.** `qc` found four rows of fifteen; `QC_POOL` found three,
which is the same comparison with the case that decides nothing; the full-width
query `ｑｃ` found the same four as `qc`, including the full-width name, which is
NFKC doing the only job it is there for; `stÖrung` found `Störung-Messung`. The
count reported is the count of matches — `2 matches of 15 files; 1 selected or
active file kept visible` — never the number of rows on screen.

**What it does not hide.** With a preview open on `QC_pool-2` and a query that
does not match it, its row stayed on screen saying `Showing — outside search`.
Rows selected before a search stayed, saying `Selected — outside search`. A row
being read said `Reading — outside search`. A row satisfying several of those at
once appeared once and was counted once. And a query matching nothing while
three rows were kept said `0 matches of 15 files; 3 selected or active files
kept visible` rather than anything about the workspace being empty; with nothing
kept, the list gave way to `No files match this search` over `13 files are in
this session. Clear the search to see them again.`, with `Clear search` and all
four roster actions still there.

**What the sort does.** All five modes were exercised with a preview open.
`Added order` reproduced Rust's list exactly; `Name A–Z` gave
`Blank-1, Blank-2, blank-10` and `Sample-2, Sample-10` and `Standard-3,
Standard-21`, which is case deciding nothing and numbers reading as numbers;
`Name Z–A` reversed it; the two size orders ran 1 KiB to 212.7 MiB and back. The
preview stayed up through every one of them.

**What all of it cost.** Five queries, five sort changes, a Shift range, a
Shift+Arrow extension and `Ctrl+A` issued **no Tauri command at all**. That is
measured rather than assumed, and the measurement was itself checked: the first
counter this check installed — wrapping `__TAURI_INTERNALS__.invoke` — recorded
nothing whatsoever, because the property is non-writable and the assignment
failed silently, and a counter that cannot count would have made every zero in
this section meaningless. The count that stands is taken at `window.fetch`, the
custom-protocol hop every command actually leaves through, and it was proved to
count by recording `inspect_backend` from a backend re-check before any of the
figures above were taken. Over a whole document, the commands issued were
`inspect_backend`, `get_workspace_roster`, `inspect_backend`,
`get_workspace_roster` at start-up — the pair twice, which is React's
development-mode double effect — and one `open_mzml_preview` for the one file
that was explicitly read. Nothing else.

**Selection, keyboard and focus.** Sorted by name and narrowed to `a`, a
Shift range spanned the visible run and skipped the rows the query was hiding —
including one that sits inside the range in Rust's order and outside it on
screen. Shift+Arrow extended along the visible order. `Ctrl+A` selected 11 of 11
visible rows and no hidden one. Deselecting a row that a search was keeping on
screen made it disappear from under the keyboard; focus moved to the nearest
row still visible, and when none was, to the search box. Focus was never
observed on the document body. Clearing the search from its button put the
keyboard back in the search box.

**Adding, removing, clearing and reloading.** With a query and a non-default
sort in place, adding two non-matching files kept both, selected, labelled
`Selected — outside search`; the query, the sort and the open preview were all
unchanged, and nothing was read automatically into a session that already held
files. Removing them left the hidden rows nobody had selected untouched and the
view exactly as it was. `Clear list` emptied the whole session rather than the
two rows the search was showing, reset the query and the sort, returned the
keyboard to `Add files…`, and left all fifteen files on disk. Reloading the
webview brought back the roster Rust still held with no query, `Added order`,
and no preview started on its own.

**Viewports.** At native 900x700 (886x663 CSS), at 1366x773 CSS and at 1920x1085
CSS, the document overflowed in neither axis, the search and sort controls fitted
without overflowing their row at 39px tall in every case, the spectrum table
never forced the page sideways, and the roster list measured 82px, 66px and
231px — two, two and eight whole rows of thirteen, scrolling for the rest. The
two-row floor is met at every size. The list is the same height it was before
this change at the reference viewport (66px against 67px), which is the point of
raising the panel's minimum by exactly what the controls cost rather than
letting them take it out of the list.

**Console and logs.** The WebView2 console held the three known development
messages and nothing else: two Vite connection lines and the React DevTools
notice. No page error and no unhandled rejection, recorded from a listener
installed before the document's first script rather than sampled afterwards. The
Rust/Tauri and Vite output contained no line matching error, panic or warning.
No path appeared anywhere in the rendered document.

**Regressions.** M1.2 multi-selection, issue #24 containment (no horizontal
overflow at any of the three viewports), issue #25 folder-picker focus
restoration and issue #29 table-header alignment were all still holding.

One flow was not reproduced: a backend that is unavailable. It is covered by
automated tests instead, which is the same answer M1.2 gave for the same reason.

### What review found in the projection, 2026-07-31

Two whole-diff reviews — one on state and asynchrony, one on accessibility and
layout — produced findings that were each put to two independent skeptics, one
asked to refute and one asked to write out a reproducing sequence and check
every step against the code. Ten survived, several of them the same defect seen
from two sides, and all are repaired here. One further finding came from the
repository's automated reviewer.

**The blocking one, and it was this change's own doing.** The focus recovery a
projection needs — a row can leave the list while the keyboard is on it — asked
whether the keyboard had *ever* been in the list. That stays true long after the
user has walked out of it, and `Add files…` is disabled for the picker's whole
lifetime, which blurs that button to the document body. The roster then pulled
the keyboard into itself, and the button waiting for its own restoration never
got it: the defect issue #25 fixed, reintroduced. It now remembers which row
held the keyboard and recovers only when that row has left the projection, which
is the only case it exists for. Confirmed rendered: with the keyboard in the
list, pressing `Add files…` and cancelling the dialog now returns focus to
`Add files…`.

**A search was suppressing what a row said about its file.** The view reason and
the row state shared one label slot and the reason won, so a row that was
`Replaced`, `Missing` or `Could not be read` stopped saying so the moment a
query kept it visible. A row now carries both — and the accessible name carries
a separator between them, because a row's name is its text content run together
and a reader would otherwise hear "Could not be readSelected — outside search".

**The panel floor was arithmetic over a row that does not exist.** 228px assumed
the roster's four actions on one line. In the sidebar they wrap to two, which
they already did before this change, so at those widths the list was left with
under two rows. The search summary moved into the header line, which exists
either way and already truncates, and the floor was recomputed over what the
panel actually holds. Measured afterwards at the width where the actions wrap:
the panel sits exactly on its 240px floor, the actions take 91px, and the list
gets exactly 56px — two whole rows, which is what the floor is for.

**And the file name could be squeezed to nothing.** A grid `auto` track takes
its max-content width before a flexible one gets any, so a row carrying two
labels left the name 0px wide — measured, not inferred. Lowering the notes
track's minimum was not enough, because that is a floor and the problem was the
ceiling; the name has a floor of its own now, and remeasuring gave it 72px with
the notes ellipsised beside it.

The rest: removing every selected row under a search fell back to selecting the
nearest survivor in Rust's order, very often a row the query excludes, which
then appeared in the filtered view marked selected — that affordance now applies
only when no search is narrowing the view; clearing a search was announced by
nothing, because removing a live region's text announces nothing under the
default `aria-relevant`; the search's own explanations took a text colour of
about 3.5:1 against the panel, for the one thing on screen that says why an
excluded row is there; and a search that matched nothing left the roster with no
focused row at all, so clearing it brought the rows back with `Preview focused`
still disabled and Enter and Space doing nothing until an arrow was pressed.

One residual of the blocking repair was found by the automated reviewer and is
repaired too: the record of which row held the keyboard was never cleared when
the keyboard left the list, and an addition replaces the selection, so a kept
row a user had tabbed away from could leave the projection during the very
picker request whose restoration must not be taken. It is now cleared on the way
out — but only when the keyboard genuinely went somewhere, which is what a
`relatedTarget` outside the list means. A `relatedTarget` of `null` is what an
unmounting row looks like, and that is the case the record exists for.

jsdom cannot answer which of those a browser actually reports, so the rendered
check was asked instead. Unpinning a focused row in WebView2 produced two
`focusout` events, one naming another row inside the list and one `null`;
neither clears the record, and focus ended on the row that took the vanished
one's place rather than on the body.

Nine further mutations cover these repairs and all nine are caught. Two were
replaced after surviving: one mutated a grid track and one a colour token, and
neither is observable in jsdom, so both are now pinned through the CSSOM the way
the narrow-layout rules already were. Two mutations are recorded as equivalent
rather than caught. Clearing the record on a `focusout` that names nothing has
no test that can reach it, because jsdom fires no `focusout` when a focused node
is removed; the rendered check above covers the behaviour instead. And
remembering the roster's logical focused handle instead of
the row that actually took the keyboard cannot diverge through the interface,
because clicking a row sets the logical focus in the same event that moves the
keyboard to it. The more precise expression is kept anyway.

Validation on the repaired head: `cargo fmt --all --check`, `cargo clippy
--locked --workspace --all-targets --all-features -- -D warnings`, `cargo test
--locked --workspace --all-targets` (215 tests), `python -B
scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (265 tests
across eleven files), `pnpm build`.

The rendered check was re-run in full on that head. Labels are associated by
`for` and named exactly `Search files` and `Sort files`, with the clear action
outside the label it would otherwise have renamed. The picker restoration holds
with the keyboard starting in the list. Five queries, five sorts, a range and
`Ctrl+A` issued no command, counted through a hook proved to count first.
Clearing a search now says `All 15 files listed.` where it previously said
nothing. At CSS viewports of 886x663, 1226x723, 1366x773 and 1920x1085 the
document overflowed in neither axis, the view controls fitted their row at a
fixed 39px, and the list held three, two, two and eight whole rows. The console
held the three known development messages and nothing else, with no page error
and no unhandled rejection. The only line matching error, panic or warning in
the Rust output is the non-zero exit this check itself produced by terminating
the process at the end.

### Two findings after the first repaired head, 2026-07-31

The automated reviewer raised two more against `9b40660`, both valid and both
repaired.

**Removal recovery was following the wrong list.** Removing the focused row
looked its neighbour up in Rust's insertion order, then handed that row the
keyboard and the fallback selection. Under a sort or a query the user is not
looking at that order. Sorted by name a roster reads `alpha-2, bravo-9, charlie,
delta-2, delta-10, echo` while Rust holds `delta-10` before `delta-2`, so
removing `charlie` sent the keyboard to a row the user was not near, and a run
of removals jumped about rather than walking down the list. The survivor now
comes from the projection as it stood immediately before the removal, which is
the rule ADR 0006 already stated. With no query and `Added order` the projection
*is* Rust's list, so nothing about the unfiltered case changes.

**The match count could not be read.** While a query hides rows that line is the
only visible account of how much of the session is out of sight, and it
inherited the header note's tertiary colour: measured in the rendered
application in the light theme, `rgb(127, 138, 156)` on `rgb(255, 255, 255)` at
11px is 3.49:1, under AA. It has a selector of its own now, applied only while a
query is actually hiding something — measured again after the repair,
`rgb(91, 103, 122)` on white is **5.73:1**, and in the dark theme
`rgb(169, 181, 198)` on `rgb(21, 30, 44)` is **8.06:1**.

What that repair deliberately does not do is worth stating plainly, because a
later reviewer found the gap and was right about the facts. Unsearched, the same
line still reads at 3.49:1 in the light theme, and it is not redundant text: it
carries the session's capacity, which appears nowhere else, and the only
statement that removing a row leaves the file alone that a user sees *before*
pressing the button. The generic `.panel-header p` rule remains tertiary for
that line, the spectrum panel and the spectrum table's caption. A later M1.4.1
preview-identity repair adds one deliberately scoped exception:
`.preview-file-identity` uses the secondary token because it identifies which
acquisition every value in the Run panel describes. Tests pin both the exception
and the unchanged generic rule. That exception does not imply the other
non-redundant tertiary text is readable; this milestone fixed the text it added
and leaves the remaining debt recorded rather than quietly implied to be fine.

Nine reducer tests hold the first — built on rows whose insertion, name and size
orders disagree everywhere, so every one of them fails outright if the lookup
goes back to insertion order — and two hold the second. All six mutations over
the two repairs are caught, insertion-order lookup, the post-removal roster, the
tertiary token, the missing selector and the class applied in the wrong states
among them.

Rendered on the repaired head, with the fixture set chosen so the three orders
disagree. Name ascending, removing the middle row moved the keyboard to the row
that took its position rather than to the insertion-order neighbour; size
ascending at the last visible row looked backwards; name descending behaved the
same; and under a query the keyboard went to the next match rather than to a
hidden neighbour, with no hidden row selected and every hidden row still held by
Rust afterwards. Each removal issued exactly one command,
`remove_workspace_datasets`, and no preview.

One thing about that check is worth recording because it looked like a defect
and was not. DOM focus recovery is invisible while the application window is not
the active window: Chromium dispatches no focus event at all, so the component
never learns which row held the keyboard and focus stays on the body. Asking the
debugger to focus its own page — not the foreground injection that took the
process down in M1.2 — made the whole sequence appear: `focusout` naming
nothing as the row unmounted, then `focusin` on the row that replaced it.

At CSS viewports of 586x430, 1366x768 and 1920x1080 the document overflowed in
neither axis, the view controls fitted their row at a fixed 39px, the summary
was visible and clear of the controls, and the list held three whole rows of
three. Search and sort still issued no command; a Shift range and `Ctrl+A`
covered the visible rows and no hidden one; a reload brought the roster back
with no query, `Added order` and no preview of its own. The console held the
three known development messages, with no page error and no unhandled
rejection. The only error-matching line in the Rust output is the non-zero exit
this check itself caused by terminating the process.

## Private folder-discovery foundation, 2026-07-31

**MSCanvas cannot add a folder after this change.** What exists is the
traversal a folder action will need, settled and tested before anything can
reach it: [ADR 0007](docs/architecture/adr/0007-logical-acquisition-discovery-and-folder-traversal.md)
and a private Rust module. No Tauri command, transfer object, capability,
frontend method, picker or visible action was added or modified; the module is
reachable from nothing but its own tests, which is why it carries an explicit
`dead_code` expectation that M1.4.1 will have to remove.

**Exact scope.** Recursive discovery of mzML *files* under one chosen folder,
returning private candidates. Directory-formatted acquisitions are recognized
as nothing: there is no vendor enum, no `.d` or `.raw` case and no unconstructed
future variant waiting to be filled in, because this repository has no evidence
it can convert one and a taxonomy is a claim. Discovery accepts nothing, leases
nothing, registers nothing and never runs the acceptance boundary — every
candidate is re-opened, re-identified and re-decided by `accept_mzml_file` when
a later slice offers it.

**Root authority and reparse posture.** A chosen root is opened as a live
directory handle and enumerated through that handle, so entries describe the
object the walk is standing in rather than whatever a path string resolves to
on the next read. Containment is not a path-prefix test — path canonicalization
would answer a question about text, and the question is about objects. A root
that is itself a reparse point is refused outright. Every child entry carrying a
reparse tag — junction, symbolic link, mount point, cloud placeholder alike, no
tag whitelist — is skipped and counted, and its subtree is never enumerated. A
child directory is opened with `FILE_FLAG_OPEN_REPARSE_POINT` and its 128-bit
identity compared against what its parent enumerated, so a name re-pointed
between those two moments is refused rather than descended into. Hidden, System
and dot-prefixed *ordinary* entries are not skipped: a user who pointed at a
folder asked for what is in it, and skipping by name or attribute would silently
omit their data. UNC, mapped and remote roots are refused twice — once from the
path, before any network round trip, and once from the opened handle, which
catches the case the path cannot show: an ordinary-looking local path that
reaches a share through a linked directory along the way.

**Budgets and order.** Four named limits bound the walk — depth 32, entries
200,000, directories 20,000 and candidates 1,024 (the workspace capacity, so
discovery never proposes more files than a session could hold). Reaching one
truncates and says which, keeping what was already found; a result reports
incompleteness once, covering limits, skipped reparse entries and unreadable
subtrees together. The entry limit bounds what a scan costs rather than only
what it counts: the walk asks its source for no more entries than it can still
afford, so a directory holding millions of names is not read whole before the
first one is looked at. Order is this application's rather than the filesystem's: a
level's own files precede the files below it, each group sorted by UTF-16 code
unit, ordinal and not case-folded, so the same tree discovers the same way twice
on any machine. The traversal is an explicit stack, not recursion — how much
native stack the process uses is not a decision a directory tree gets to make.

**Windows-only, and why.** Off Windows the entry point returns
`platform_unavailable` rather than a weaker walk. The guarantees above rest on a
no-following open and a stable file identity, which this project has no
dependency-free way to obtain elsewhere; ADR 0006 made the same call about
identity leases for the same reason.

**Privacy.** Nothing path-bearing prints a path. A candidate's `Debug` is
`<opaque-discovered-candidate>`, an error's is its kind alone, and a summary is
counts. Each candidate keeps its location under the chosen root so that two
files called `sample.mzML` can be told apart later — ADR 0007 approves showing
that relative context only when names actually collide.

**Tests.** 213 tests in the desktop crate, 83 of them discovery, counted with
`cargo test --lib -- --list` rather than from a name filter — a filter on
"discovery" answers higher, because two tests elsewhere have the word in their
names. The 83 are 35 policy tests against a fake filesystem that can present a
cycle, answer in a different order every time, or hand back a child that is no
longer itself; 17 record-decoding tests over malformed `FILE_ID_EXTD_DIR_INFO`
buffers; and 31 against real `%TEMP%` trees on NTFS, two of which are ignored by
default because they need the local administrative share. The central claim is
one of those — a junction planted in the chosen folder,
pointing at a directory outside it, yields the inside file only, one counted
reparse skip and one directory entered. A junction as the root is refused. A
child directory deleted and re-created under the same name between enumeration
and open is refused by identity, as is one replaced by a junction or by a file.
Every budget is exercised one under, exactly at and one past its limit, and the
entry budget additionally for what it makes the source spend rather than only
for what it counts. A 6,000-deep chain is walked to the bottom without a call
stack. What discovery offers is handed to the real `accept_mzml_file`, which
takes all of it and refuses the one name discovery passed over. No real
acquisition, vendor data or user folder was touched, and no ProteoWizard process
was started: discovery never reaches the backend at all.

**Mutations.** All 24 named mutations were introduced, run and restored, along
with eight more written for the repairs that review produced; none was
committed. Every one is caught by a discriminating test, including the four that
only a real filesystem can answer — root reparse accepted, hidden directory
skipped, System directory skipped and child identity mismatch ignored — and the
recursive rewrite, which overflows its stack on the 6,000-deep chain. Two of the
thirty-two are caught only by tests that are ignored by default, because they
need the local administrative share; on a machine without it those two mutations
would survive, and the run says so by reporting the tests as ignored rather than
passing them.

The remote check is why that sentence is written carefully. It shipped in the
first repair round asking for a 116-byte structure at 88 bytes, and Windows
validates a declared length before it consults the object. Measured here: at 88
bytes the call is refused with `ERROR_BAD_LENGTH` for a local directory and for
the loopback administrative share alike, so a check reading "did it answer" said
"local" about everything and did nothing whatsoever. At the documented 116 bytes
that local directory answers `ERROR_INVALID_PARAMETER` and the share succeeds,
which is the distinction the check is entitled to read. Review found this, not a
test — and then found that the first fix for it pinned only that the primitive
answers correctly, leaving "and the root open actually asks it" still uncovered,
which a second mutation confirmed by deleting the call and staying green. Both
are covered now: the size by telling the two refusal reasons apart on any
ordinary local folder, and the wiring by walking a relative root while the
process stands on the share, which is the one spelling a remote root can have
that the path test is designed to let through.

**Rendered QA was exempted, and honestly so.** This change has no rendered
state to check: no pixel, no DOM node and no command changes. Every claim above
is a Rust test on this machine. The rendered evidence for folder ingestion is
owed by M1.4.1, when there is finally a button to press.

## Visible mzML folder ingestion, 2026-07-31

**MSCanvas can now add a folder.** `Add mzML folder…` is the fifth workspace
action, and it is the M1.4.0 traversal made reachable and nothing else: the
walk, its budgets, its ordering and its refusal of every reparse entry are
unchanged. What this slice adds is the commit around that walk, the boundary it
answers across, and the interface over it.

**Two commands, no path in either direction.** Folder ingestion brings the
registered surface to twelve commands. Synchronous
`begin_mzml_folder_import` records or reuses one current-generation baseline
and returns its path-free reservation DTO. Asynchronous
`choose_mzml_folder(reservationId)` consumes and validates that exact ID before
showing the native picker on the main thread with the title
`Choose a folder containing .mzML files`; it answers with a roster, one outcome
per candidate in discovery order, and how the scan itself went. A dismissed
picker answers `None`, which is an ordinary outcome and deliberately not an
empty result. The webview never supplies or receives a path or parent. The only
additional value exchanged with it is a session-scoped, opaque-but-not-secret,
single-use reservation correlation ID — not a filesystem capability,
generation or internal token —
and the main window's capability set is still empty. The picker itself is now
one shared helper with two callers, so the installation picker and the folder
picker cannot drift apart in their flags.

On Windows that helper is the Explorer-style Common Item Dialog, `IFileDialog`
with `FOS_PICKFOLDERS`, rather than the legacy tree picker. It
accepts an absolute path pasted into its address bar, is owned by the main
window, requires one existing filesystem folder, leaves shell links unresolved
and does not add the choice to Recent. Only the exact Windows cancelled
`HRESULT` becomes `None`; every other setup, display or result failure remains a
typed, path-free error. COM initialization and task-allocated result storage are
balanced on every exit. The selected path still exists only inside Rust. The
target-specific direct dependency is the already-locked `windows = 0.61.3`, so
this adds no crate version and no Tauri capability.

**No backend fan-out, ever.** A folder of a thousand files costs a thousand
filesystem inspections and no processes. Reading is still explicit and still at
most one file — the first row of a session Rust says was empty. Whether it was
empty is decided from the authoritative reply rather than from the list on
screen, because a reloaded window can show nothing while Rust still holds rows.

**The scan holds no lock, and cannot arrive late.** A workspace mutation
generation lives behind the gate that already serialised one mutation against
another. The synchronous begin command records the current generation only as
a baseline in one bounded pending `Option`; it does not advance it, and another
begin at the same generation idempotently returns the same correlation ID. The
asynchronous chooser consumes and validates that exact ID before the picker,
then atomically advances the generation and creates the Rust-only import token.
The scan carries that token while holding nothing, takes the gate back without
advancing it, and commits only if the token still names the current generation;
otherwise it answers `import_superseded`, accepts nothing, leases nothing and
spends no dataset identifier.

Adding files, a successful folder claim, removing rows, emptying the list and
native main-webview `PageLoadEvent::Started` advance the generation. The native
event is the reload authority because it occurs before the replacement document
can issue IPC; no FIFO ordering between old and new fetches is assumed. A
delayed old begin cannot advance the generation, replace a live
same-generation reservation or supersede a token already claimed by the new
document. A delayed old roster request is a pure snapshot and has no side
effect. `get_workspace_roster` still takes the mutation gate so it sees a batch
wholly before or wholly after commit, but it does not advance the generation.
What cannot happen is a window adopting a roster and then receiving rows owned
by the document it replaced.

**A candidate is a proposal, and acceptance re-decides it.** Each candidate now
carries the 128-bit identity its parent directory reported in the same
enumeration record as its name, and ingestion compares that against the identity
acceptance resolves. A mismatch is refused with `folder_candidate_changed` and
the rest of the batch continues. This is what carries the walk's containment
proof across to the object being registered: containment was proved for the
object discovery found, and between the walk and acceptance a name can be made
to mean a different file.

**Two files of one name say where they are, and only then.** ADR 0006's
path-privacy section is amended deliberately for exactly one case. A row carries
a relative context only while two or more live rows share its final filename;
it is recomputed over the whole roster every time one is built, so it appears
when a colliding row arrives and goes when that row leaves. It never contains a
drive, a UNC prefix, an absolute path, `..` or the chosen root's own name; it is
bounded at 128 characters and truncated from the shallow end, because the
deepest component is the one that disambiguates. A directly picked file says
`Added directly` rather than being given an invented location. Two rows that
would say the same words are told apart by the session's own identifier, which
is already the handle the webview holds. It is display only: never searched,
never a sort key, never part of identity, never persisted.

Outcomes are described after the whole batch rather than as each file is
accepted, and that is the same fact from the other side: the second
`sample.mzML` is the reason the first one has a context at all, so an outcome
described mid-batch would carry none while the roster beside it carried one.

**What the interface does while an import runs.** The folder action keeps its
own name, `Add mzML folder…`, and carries `aria-busy`; the shell shows
`Folder import in progress…` and a permanently mounted live region says MSCanvas
is waiting for a folder selection *or* scanning the chosen folder and that the
duration is not known. One sentence for both phases, because the flag is set
before the native dialog opens and no folder has been chosen yet. No percentage
is shown, because nothing has counted the tree.

Adding files, adding a folder again and explicitly reading the list back all
wait. The roster command is now a pure, gate-linearised snapshot rather than a
workspace decision; it waits because a mid-scan loading state and a snapshot
whose usefulness depends on commit order add no recovery path. The folder reply
or an owed reconciliation already supplies the authoritative answer.
**Removing rows and emptying the list do not**, but they make different
promises. `Clear list` is offered even over an empty list while an import is
pending. When its command succeeds, it is the reliable way out of a folder
chosen by mistake and the final workspace is empty whether it linearises before
claim, after claim but before commit, or after commit. `Remove selected` remains
usable to manage rows already on screen, but it is not cancellation. If removal
reaches the gate before exact claim, the baseline becomes stale and the picker
does not open. If claim wins first, removal advances beyond the token and the
older import cannot commit. If the import commits first, the removal acts only
on the handles it was given and its authoritative roster can therefore retain
newly imported rows. In no order can a late folder reply overwrite the later
mutation's roster. The request suppresses that reply as soon as it begins, so a
committed import cannot transiently restore rows or launch a preview while the
later action is still pending. If the action rejects, the webview does not infer
that Rust was unchanged; it reads the authoritative roster after both operations
settle, removes any preview whose row is no longer present, and keeps the typed
action error visible. Beginning another mutation also invalidates any older
roster reply before it can reach the screen.

Searching, sorting, selecting and reading a file already in the session stay live
too — a scan launches no process, and there is no honest reason to take the
viewer away for a filesystem walk. A selection built while the scan runs survives
it, is pruned against the authoritative roster, and the new rows join it rather
than replacing it. Keyboard focus returns to whichever acquisition action was
used, never to the other one, and never over a control the user reached for
meanwhile; emptying the list mid-import holds that debt until `Add files…` is
usable again rather than paying it into a disabled control.

**Honest incompleteness.** The transferred summary carries `complete`, the
skipped-reparse count, the inaccessible-entry count and which named limits were
reached — and deliberately not how many entries were inspected or how many
directories were entered, which describe the shape of the user's tree. "No mzML
files were found in that folder" is said only by a scan that described the whole
folder; a scan that stopped short says "No files were added, and the scan was
incomplete" instead.

**Tests.** The required `--all-targets` workspace run lists 511 Rust tests: 504
pass, 7 are ignored and none fail. Seventeen are passing example-harness tests;
the remaining 494 are the workspace libraries. The core crate accounts for 2
passing tests; the desktop library for 271, with 269 passing and 2 ignored
because they need the local administrative share; plot-spec for 1 passing test;
and ProteoWizard for 220, with 215 passing and 5 ignored controlled subprocess
entry points. A controlled subprocess self-call that reports 1 passed and 219
filtered is part of that run and is not counted a second time. The frontend has
412 passing tests across 14 files. The new Rust coverage is the
discovery-to-acceptance identity join, both native page-load/commit orderings, a
scan superseded by page-load start or an emptied list, a scan that survives a
pure roster snapshot, exact single-use reservation claiming,
same-generation begin reuse, stale-slot replacement, delayed old begin and
roster requests, the bounded pending `Option`, collision context appearing and
disappearing, the shallow-end truncation, every discovery refusal mapping to a
kind of its own, a real junction under a real chosen folder yielding nothing
from the other side, the twelve-command boundary, and that the scan limits and
summary fields are spelled on the Rust side the way the frontend's contract
file reads them — in both directions, including the private values that must
not be there. The concurrency tests are driven by channels around a controlled
walk rather than by sleeping. No real acquisition, vendor data or user folder
was touched, and no ProteoWizard process was started.

Nineteen Windows-dialog tests additionally cover the inherited/required/refused
option policy, exact owner, ordered setup and result calls, exact cancel versus
failure classification, missing and malformed result paths, path-free errors,
and a production-call/legacy-retirement guard. The final frontend cases cover
the dispatch-to-reservation barrier for both Clear and Remove, terminal cleanup,
stale acknowledgement ownership, exact correlation payload, begin failure, and
out-of-order callers sharing one live reservation. They also cover all sides of
the overlapping-clear error rule: `import_superseded` and claim-stage
`invalid_folder_import_reservation` stay silent after this window's later
mutation, while an independent scan failure remains actionable. Four more pin
the transient folder-retry focus handoff: keyboard activation returns to the
durable folder action after settlement without waiting for an observable
disabled commit, an activation that did not own keyboard focus takes none, and
a destination chosen meanwhile keeps it without leaving a stale debt.

**Mutations.** The cumulative total is 153 named mutations, each introduced,
run and restored; none was committed. The final concurrency work added 28 to
the prior 116. Eight exercise the frontend reservation barrier: Clear and Remove
guards, rendered `canMutate`, the synchronous pending ref, acknowledgement state
and ref release, terminal cleanup, and stale-ack ownership. Twenty exercise the
two-command and reload boundary: early, missing or terminal-only acknowledgement;
wrong correlation payload; asynchronous begin; claim after picker; wrong-ID or
replay slot consumption; missing baseline validation; same-generation begin
replacement; ghost begin generation advance; claim without generation advance;
missing invalid-overlap suppression; missing page hook; using
`PageLoadEvent::Finished`; a roster read that advances or omits the gate;
missing command registration; generation serialization; and an unbounded
reservation registry. Every new mutant was killed by a discriminating test,
restored, and followed by the final full suite. This statement does not claim a
per-mutant SHA check for the new batch.

The later stale-token preflight repair adds the 145th mutation: removing the
pre-scan generation guard makes the direct service test invoke its controlled
walk and return `folder_not_readable` instead of refusing with
`import_superseded`. Restoring the guard makes that test pass again while the
existing post-scan checks continue to cover mutations that arrive during the
walk.

Three further frontend mutants cover the later preview-identity repair, bringing
the cumulative total to 148. Each was killed by a discriminating test and
restored. The first constrained-layout repair adds three: the Run-panel floor,
the narrow workspace track and the narrow viewer tracks each have a mutant that
removes or under-allocates their minimum. All three were killed by their CSSOM
contract tests and restored, bringing the interim total to 151. The final
dual-notice repair adds two more: removing the narrow workspace's internal
vertical scroll makes its new exact contract test fail, while restoring the
loaded-viewer outer floor from 178px to zero makes three constrained-layout
tests fail. Both were restored, bringing the cumulative total to 153. At final
application-code head `238722ade4e073dfec7eef4e1c28696d0d95c7bf`, the
frontend suite passed all 412 tests and the required all-targets Rust run passed
504 with 7 ignored and none failed, 511 listed in total. The final rendered
measurements for that head are recorded below.

Validation through the stale-token preflight repair passed `pnpm lint`, `pnpm
typecheck`, `pnpm test`, `pnpm build`, `cargo fmt --all --check`, workspace
Clippy with warnings denied, the workspace Rust tests, and `python
scripts/check_repo.py`.

One survived its first run and is recorded here because the repair was to the
test rather than to the product: folding the collision context into the name
sort produced the same order as the correct comparator, because the fixture's
contexts happened to sort the same way the session held them. The fixture now
holds them in the opposite order, so the two comparators disagree and the
mutation is caught. Three further anchors had drifted after `rustfmt` reflowed
the lines they named; they were re-anchored and re-run rather than reported as
evidence.

**What review found.** The first review found three findings, each repaired with
its own test. The workspace list's own `Try reading it again` was the one route
to a roster snapshot that stayed enabled during an import. The read is now pure
and cannot supersede the scan, but the action still waits because an additional
loading state and commit-order-dependent snapshot provide no recovery the
folder result or reconciliation does not already provide. Reload ordering now
belongs solely to native page-load start. The shared folder dialog carried a
failure kind and message as parameters that both callers passed identically,
which suggested the two operations fail differently when they do not. And
nothing pinned the wire spelling of the scan limits or the summary's fields
between serde and the frontend's closed union, where a disagreement would be
silent in the worst way.

The empty-roster escape P2 found the path that mattered most: the roster hid
`Clear list`, and the hook rejected the same action, while the first folder
import was unresolved. The action is now present and enabled whenever a folder
request is pending. A successful empty clear advances the authoritative
workspace generation, leaves the final roster empty in either ordering, keeps
its notice through settlement and returns keyboard focus to `Add files…` only
when that control becomes usable.

A later live P2 found the one acquisition action outside the roster's focus
restoration path. Starting `Choose another folder` clears its error notice and
therefore removes the focused retry button. The shell now mints a one-shot token
before that removal only when the retry owns keyboard focus. The roster bridges
the token into its existing picker-restoration state machine, targets the
durable `Add mzML folder…` action, waits for it to become usable, restores with
`preventScroll`, and retires the debt without moving focus if the user chose
another destination meanwhile.

The reservation-ordering review found that dispatching one asynchronous folder
command did not prove Rust had polled it before the frontend re-enabled Clear or
Remove. The final protocol splits that boundary: synchronous begin stores a
current-generation baseline and returns its correlation ID; exact asynchronous
claim consumes and validates it, advances the generation and creates the
Rust-only token before dispatching the picker. Same-generation begins reuse one
bounded slot, so a delayed old begin cannot cancel a new import, and a delayed
old roster request is side-effect-free. Native main-webview
`PageLoadEvent::Started` is the authoritative reload edge, so no correctness
claim depends on FIFO delivery of old and new IPC fetches.

A subsequent live P2 found one avoidable cost after that ordering was already
safe: a token superseded while its picker was open still entered the bounded
folder walk before the commit-time generation check refused it. `import_folder`
now checks the token under the short mutation gate before touching the
filesystem, releases the gate for a live scan, and keeps the original check
afterward for decisions made during that scan. A direct old-webview test proves
that an already-stale token never invokes its controlled scan closure. This is
a Rust-only fail-closed path owned by a document that no longer exists; it
changes no picker or live rendered state, so the native dialog was not reopened.

The preview-identity P2 found a presentation gap in a contract Rust already
fulfilled. `PreviewDto.file` carried the collision-only `relativeContext`, but
the Run header rendered only `fileName` and size, so either of two acquisitions
called `sample.mzML`, when active, could still look like the other in the panel
that described its measurements. At preview-identity application-code head
`2a075ab9ff53ab2197989e1c340d677a08d64100`, the header and the retained
one-action Preview affordance use one shared dataset label. The header prefers
the current active roster row over the older preview snapshot, so adding the
second same-named row gives the open Run its context and removing that row takes
the context away without rereading the acquisition. The identity line alone
uses the secondary text token; the generic panel-header rule remains unchanged.
Three discriminating frontend tests cover the live-roster transition, the
shared recovery label and the scoped colour rule. This is a frontend projection
repair: it changes no picker, traversal, command or DTO. The native dialog was
not reopened for it. Its final routed rendered evidence is recorded below.

A final live P2 combined two states that the earlier constrained-layout run had
measured separately. At 960x640, a loaded preview kept the persistent backend
notice while an unresolved folder import added a second approximately 31px
notice. After the 58px top bar, those notices left about 520px for a workspace
whose complete narrow evidence contract needs 544px: 16px of padding, the
342px sidebar, the 8px row gap and a 178px viewer. Because the document and body
deliberately do not scroll, the bottom Selected spectrum panel was outside a
clipped ancestor even though its own 54px floor still existed. The repair keeps
both notices visible, gives the loaded viewer's outer track the complete 178px
floor (116px table, 8px gap and 54px selected-spectrum panel), and makes only
the narrow workspace the internal vertical recovery surface. It changes no
picker, folder traversal, backend, DTO or scientific state.

Earlier rendered QA used both permitted repair rounds. The first found that the late
typed `import_superseded` rejection still raised `The folder could not be added`
after a successful clear. Suppressing every overlapping folder rejection would
have hidden genuine discovery failures, however, because those can happen
before Rust reaches the generation gate. The final rule suppresses only typed
claim/commit refusals when this window made the later decision:
`import_superseded`, plus `invalid_folder_import_reservation` when a delayed old
begin replaced the now-stale slot. Both fail before an unsafe commit, while an
overlapping real picker or scan failure remains visible. Opposite-order and
ghost-begin frontend tests distinguish all sides of that rule.

**Final rendered Windows QA is complete for the current begin/claim
implementation.** The bound run was `m141-859e2ed-final2` at
`859e2ed36d3c699bc7e7c6f562127ad2a4c8db2b`, in the Windows Tauri executable
whose SHA-256 was
`746adde83594d500f6563194d86bdcfc2c3fec4bfa5ebf3089675a205f9cc59c`.
The real PID-owned Common Item Dialog was opened once from the keyboard and
once from a trusted pointer activation. Minimal native assistance consisted
only of pressing Esc in the modal. Both cancellations completed the exact
path-free pair -- `begin_mzml_folder_import {}` followed by
`choose_mzml_folder { reservationId }` -- with matching single-use IDs; all
four IPC records settled, neither request nor reply contained a path, both
chooser replies were `null`, and the empty workspace remained unchanged. The
keyboard path returned visible 2px focus to `Add mzML folder…`. No further
native-dialog repetition was used.

The states after the picker were exercised in that same exact-head rendered
application through one-shot, typed Playwright routes at the live Tauri IPC
origin. Those routes are deliberately recorded as deterministic projection and
ordering evidence, not as another filesystem traversal: the real traversal,
identity and generation orders are the Rust tests above, while the route makes
the frontend receive each reviewed DTO/error ordering without opening the
native dialog again. The current empty-workspace escape was observed from both
sides of the acknowledgement barrier: `Clear list` was present but disabled
while begin was unresolved, became keyboard-reachable immediately after the
exact claim was dispatched, kept its 2px focus ring, and reported
`The workspace is empty. The pending folder import will not add files.` A stale
non-empty folder result released afterwards installed no row; `Add files…`
became the visible focused destination only when the import settled.

The remaining rendered states passed as a bounded set of checks:

- A five-row folder result rendered one incomplete-scan warning, one counted
  linked/special entry, and collision-only `batch-a` / `batch-b` context for the
  two `sample.mzML` rows. No context appeared on another row.
- The whole page had no horizontal document/body overflow, horizontally
  clipped control or framework overlay at the required 960x640, 1366x768 and
  1920x1080 rendered CSS viewports. The deterministic 128-row production
  `SpectrumTable` was also
  stressed at 760x768: its nine headers and cells had zero x-coordinate drift,
  the sticky header stayed at top, both internal scroll axes were exercised,
  rows remained virtualized with one roving tab stop, and neither scroll axis
  escaped to the document.
- Relative context matched neither search nor sort. A selected non-matching row
  remained pinned with its `outside search` explanation; all five sort modes
  stayed local and issued no IPC; equal filenames retained added order.
- A typed removal reply removed exactly its opaque handle, removed the obsolete
  collision context, moved visible keyboard focus to the surviving row at that
  position, and said that disk files were unchanged. Keyboard `Clear list`
  then emptied the authoritative roster and returned visible focus to
  `Add files…`.
- A typed folder failure exposed `Choose another folder` and `Dismiss`.
  Keyboard Dismiss restored the durable folder action; keyboard retry did not
  restore it while its exact chooser request was pending, then restored it on
  settlement.
- A failed Clear held its typed workspace error while the older import settled,
  suppressed the stale folder roster, waited for exactly one authoritative
  `get_workspace_roster {}` response, and restored `Add files…` focus only after
  that empty reconciliation arrived.

Every accepted rendered phase ended with zero warning/error console events,
zero page errors, zero visible path leaks and no framework overlay. The app was
reloaded after instrumentation; the real backend projection was again empty,
both acquisition actions were enabled, `aria-busy` was false and no QA marker
remained in the page. No real acquisition content was read; the routed folder
and preview commands did not reach ProteoWizard.

### Final preview-context and constrained-layout rendered evidence, 2026-08-02

The final projection/layout run was `m141-preview-2a075ab-final1` at
application-code head `2a075ab9ff53ab2197989e1c340d677a08d64100`, in the
Windows Tauri executable whose SHA-256 was
`1a1b418effc486a988576dcad1aa0bde7cf8b9cc09897ec11a49000aef46b9f6`.
The evidence JSON SHA-256 was
`7b124e5c5d505c38f6a0bd199a7fc4acddba6b60fd054edbaf232105fa68dcef`;
the bounded rendered helper SHA-256 was
`d6fce971fc340d8e2bbab590ee6c1e403b9bbdf6f1c56f9aefd1bf906863adc9`.
This run supersedes the earlier unmeasured preview-context projection and the
intermediate narrow-viewer allocation only. It neither supersedes nor repeats
the native-picker evidence from `m141-859e2ed-final2`: the picker was not
reopened.

The routed `PreviewDto.file.relativeContext` was `null`, while the current
active roster row carried `batch-1`. The Run identity's visible text and title
therefore read `sample.mzML, batch-1`. Focusing and selecting the same-named
`batch-2` row did not change that active Run. Removing `batch-2` made the Run
title `sample.mzML`, retained the populated spectrum grid and left the preview
open count at one. The routed command counts were two StrictMode-safe backend
inspections, two roster reads, one preview and one remove; the picker and
refused-call counts were both zero. No native dialog opened, no acquisition
content was read and ProteoWizard was not started.

The first 960x640 rendered inspection found a real pre-repair regression: the
280px narrow workspace track was already consumed by the roster's 280px floor,
and the 8px inter-panel gap left the Run panel only 1.33px high. The minimal
identity repair raised that track to 342px and gave the Run panel a 54px floor,
which contains its 52px header inside the panel's two 1px borders. The first
viewer repair used 108px/54px floors, but rendered measurement showed a 52px
table viewport: not enough to contain its 30px sticky header and one complete
30px row together. That intermediate result is diagnosis, not accepted
evidence. The final narrow viewer floors are 116px/54px.

At the final 960x640 light-theme state, the Run panel measured 54px and its
header 52px; the roster measured 280px and its scrolling list 134.33px; and the
viewer measured 185.33px. Within it, the table panel measured 116px, its
viewport 60px, its fully contained sticky header 30px and its fully contained
first row 30px. The selected-spectrum panel measured 61.32px. The Run identity
contrast was 5.728:1 in the light theme and 8.064:1 in the dark theme. At
1366x768 and 1920x1080 there was no horizontal document or body overflow.

The accepted run ended with zero console warnings or errors, zero page errors,
zero path leaks and no framework overlay. The one-shot route was removed, the
application was clean-reloaded, and no QA marker or synthetic handle remained.

### Final dual-notice constrained-workspace rendered evidence, 2026-08-02

The final typed run was `m141-notice-238722a-final2` at application-code head
`238722ade4e073dfec7eef4e1c28696d0d95c7bf`, in the Windows Tauri executable
whose SHA-256 was
`1a1b418effc486a988576dcad1aa0bde7cf8b9cc09897ec11a49000aef46b9f6`.
The bounded helper SHA-256 was
`6aaa298709ea26fae4120aaacfbfa6a70b172b3e316282e217b18d6c308262f6`;
the evidence JSON SHA-256 was
`39e3a706628a8813681a7cd96e5d6ee04d0ee37938be00b3031252e60d706137`.
This run adds the combined backend-notice/folder-progress state to the prior
preview-context evidence. It does not supersede or repeat the real native-picker
evidence from `m141-859e2ed-final2`: no native dialog was reopened.

At 960x640, with the loaded preview, persistent backend notice and unresolved
folder-import notice all present, the narrow workspace measured a 521px client
height and a 544px scroll height. Its measured maximum recovery scroll was
23.33px, and setting that exact scroll position exposed the complete internal
contract: a 178px viewer containing a 116px table panel and a 54px Selected
spectrum panel around their 8px gap. The table viewport remained 60px, with its
30px sticky header and one complete 30px row both contained, and the Run
identity remained complete. The workspace, document and body had no horizontal
overflow before or after recovery. The initial screenshot SHA-256 was
`13b9e1174902087335622a5d84be925d9c08278cc0817ecac1236acb86e838bf`;
the recovered screenshot SHA-256 was
`b86140fabd7980fc2fcaa8f3272f5553758fa15ee04cbfde69f7bab821a0e4ce`.

The routed command counts were `inspect=2`, `roster=2`, `open=1`, `begin=1`,
`choose=0`, `picker=0` and `refused=0`. The run ended with zero console warnings
or errors, zero page errors, zero visible path leaks and no framework overlay.
Its one-shot route was removed and the application clean-reloaded with no
synthetic handle retained. No acquisition content was read, ProteoWizard was
not started and no native picker was opened.

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
