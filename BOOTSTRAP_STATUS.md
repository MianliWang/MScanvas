# Bootstrap status

**Updated:** 2026-08-07

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

The source-reconciled runtime result is capability-specific. Discovery/build identity is A. Metadata, summary/counts, derived TIC/filtering, scan listing, selected spectrum, overall conversion and mzML conversion are B with named parser/scientific limits. mzXML is C because the tested multi-source fixture lost one of four spectra despite exit 0. BPC, repeated navigation, large arrays, progress, real cancellation, locale stability and vendor RAW coverage were all D at that date. **Corrected 2026-08-07: vendor RAW is no longer D for one family.** Thermo Scientific RAW, single file, has since been converted from a lawful fixture on the installed 3.0.26013 build and admitted privately; see the M3.0.3 section below. Every other rating in this paragraph is still the M0 result. The M0 provider decision is therefore still incomplete, but it is no longer blocked by unavailable isolation or absent open-format runtime evidence. See the [M0 ProteoWizard spike report](docs/spikes/M0_PROTEOWIZARD_SPIKE.md).

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
414 passing tests across 14 files. The new Rust coverage is the
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

**Mutations.** The cumulative total is 154 named mutations, each introduced,
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
application-code head `e49cc7922c81a3d426fce7d60915542699c32653`, the
direct-add duplicate-feedback repair adds one more: replacing the shared
dataset label with the bare filename makes the exact collision-context test
fail while the ordinary no-context case remains protected. It was restored,
bringing the cumulative total to 154. The frontend suite then passed all 414
tests and the required all-targets Rust run passed 504 with 7 ignored and none
failed, 511 listed in total. The last native rendered measurements, which the
later text-only projection does not invalidate or repeat, are recorded below.

Final validation at that head passed `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `cargo fmt --all --check`, workspace Clippy with warnings denied,
the workspace Rust tests, `python -B scripts/check_repo.py` and `git diff
--check`.

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

A later live P2 found that direct-file duplicate feedback discarded a context
Rust had already supplied. When two live rows were both called `sample.mzML`,
the duplicate outcome named the correct existing row and carried its
`relativeContext`, but `describeAddResult` rendered only `fileName`. Direct-add
details now use the same dataset-label formatter as the Run identity and
retained Preview action, so the notice identifies `sample.mzML, batch-2` while
the ordinary no-context sentence is unchanged. One pure formatter-path test
and one rendered App test drive a fake two-row roster through mocked Add files,
assert the exact context, keep the roster at two rows and start no preview.
This changes no Rust, API, filesystem or picker behavior; no native dialog was
reopened.

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

The later direct-add duplicate-label repair at
`e49cc7922c81a3d426fce7d60915542699c32653` changes only the bounded notice
text. Its App test renders the complete notice from a fake two-row roster and a
mocked Add files result; the pure-function test independently pins the exact
label, and restoring the old bare-filename expression kills that test. Because
neither the native command path nor layout changed, the accepted Tauri runs
above remain the native and layout evidence, and the picker was not reopened.

## Windows Explorer drag-and-drop, 2026-08-02

M1.5 is implemented at final application-code head
`75fb9dd6d091c351239c5dff7bc386bdaafafaa6`. The registered Tauri surface is
exactly thirteen narrow commands. The main-window capability permissions array
remains empty, no `core:event` permission was added, and the frontend imports
neither `@tauri-apps/api/event` nor a `tauri://drag-*` event. Cargo and package
manifests and lockfiles are unchanged.

Explorer paths enter only the Rust-owned `WindowEvent::DragDrop` adapter for the
`main` window. The locked `tauri-runtime-wry 2.11.4` routing contract is pinned
by a source test: the configured window-content WebView synthesizes
`WindowEvent::DragDrop`, rather than the child-WebView event path. The callback
normalizes Enter, Over, Leave and Drop without formatting the native event or
its position, makes only an atomic reservation, retains at most the first 1,024
roots while keeping the true item count, and offloads every dispatch before any
lock, Channel send or filesystem work. Over is silent and ticketed workers
cannot reorder an older Enter after Leave. Main-document page-load start also
advances that event ticket: tests reserve old-document Enter and Leave
dispatches, start the replacement document, claim its subscriber, and then run
the queued work without changing the replacement Channel's single idle state.
Tauri's main-frame document-created initialization script gives every JavaScript
realm a fresh 128-bit opaque drop authority in a sealed, non-enumerable global.
It carries no path or generation and is sent only in this command's private
invoke header, never in a DTO or Channel update.

The frontend installs one replaceable `tauri::ipc::Channel` subscriber through
the two-phase `subscribe_workspace_drop_updates` command. Begin accepts no
Channel and idempotently returns the one pending current-document reservation;
Claim must provide that exact reservation and Tauri's typed nested
`JavaScriptChannelId`. Old, wrong and replayed claims fail closed, a wrong claim
does not consume the valid slot, and page-load start clears both reservation and
subscriber. Rust retains at most one of each. The production transport serializes
the complete Begin-to-Claim registration, and only a successful Claim sends the
current snapshot. Before each phase Rust rejects non-main Webviews, challenges
the current realm through `eval_with_callback`, and then rechecks the captured
native document epoch under the hub lock. A delayed old-realm header, malformed
or missing authority, callback timeout, or navigation between challenge and
commit fails closed without consuming the replacement document's pending slot.
Rust sends a closed, path-free union with a monotonic sequence and mandatory
`failed { operationId, error }`; actual Tauri Channel tests capture the
serialized idle, hovering, importing, busy, completed and reload ordering.
Replacement leaves exactly one subscriber, and send failure removes only the
matching failed subscriber without aborting ingestion.

Real Windows filesystem tests cover direct files, multiple folders, mixed root
order, hard-link identity deduplication and both root and nested junctions. A
drop uses one 1,024-root limit and one entries, directories and candidates
ledger across the whole gesture; direct files spend candidate allowance and
each folder restarts depth at zero. Successful and failed discovery roots debit
the same ledger: a path-free `DiscoveryUsage` records entries materialized before
enumeration or parse failure, and every later root receives only the remainder.
Valid candidates discovered before a failure are retained. Classification and
commit recheck filesystem identity without following reparse points. A
three-layer containment mutation proved that weakening attribute parsing,
no-follow opening and child identity checking together would admit the outside
`outside.mzML`; the restored test refuses it and records only an aggregate
skipped count.

Concurrency tests prove that expansion holds neither workspace nor mutation
locks, a busy storm occupies one bounded coalescing bit, and a second Drop is
reported busy before the first operation's terminal update rather than replacing
it. Add files, Add folder and roster reads wait for an active drop. Remove,
Clear, and native main-document page-load start supersede it; late work cannot
install a roster or notice. Page load also clears the pending subscription and
active subscriber before a replacement document can claim. Frontend registration
settles before the current attempt reads the authoritative roster. A subscription
failure has its own truthful, retryable notice, still reads the roster, and keeps
both picker actions usable; successful Retry reads the roster again. Stale and
StrictMode attempts cannot apply state. An ownerless completion recovers through
the roster without creating a notice or preview. Frontend ownership checks adopt
one matching terminal only, preserve the current query, sort, surviving row state
and active preview, union newly added handles into the live selection, and set
roving focus and range anchor to the first newly added handle. They start at most
one preview only when Rust says the prior workspace was empty. Collision-only
context affects neither search nor sort. Shared entry/directory limit notices
name the collective drop ledger rather than blaming one folder.

The final automated suites at final application-code head
`75fb9dd6d091c351239c5dff7bc386bdaafafaa6` passed 551 Rust tests
(544 passed, 7 ignored, 0 failed) and 464 frontend tests across 17 files. The
wire/privacy contracts enumerate every forbidden path-bearing field, keep
candidate paths in private Rust types with manual opaque `Debug`, and bound a
notice to three basename-only details. Mutation evidence killed the original 36
required faults plus 19 repair faults, with one targeted discriminating test per
reachable mutant, and restored every target hash and worktree status afterwards.
The first repair set removes current-document reservation ownership, PageLoad
queued-event invalidation, failed-root usage debit, subscription-before-roster
ordering, subscription-error separation, focus ownership cancellation,
pointer/keyboard distinction, and Begin-to-Claim serialization. The second set
removes the current-realm challenge, Begin/Claim epoch rechecks, per-subscription
realm authority capture, first-added Drop focus, shared-ledger notice wording,
the main-Webview gate, and the initialization script's safe concatenation
separator. The third set forces a singular hover count through the plural label
and independently restores entries and directories notices that require
multiple folders instead of naming the drop-wide ledger. Mutations 11, 32 and
both forms of 33 were rerun after their authority paths changed. A first
candidate for 11 and a field-only epoch candidate were
equivalent under the restored guards and were recorded rather than counted. In
particular, mutation 24 proved a stale terminal cannot install a roster, mutation
25 proved it cannot replace the notice, and mutation 29 proved collision context
cannot reorder equal filenames. No compile error, zero-test run or timeout was
counted as a kill.

Rendered verification used an ephemeral external Vite harness importing the
exact production App, PreviewWorkspace and CSS with a fake implementation of
the same path-free transport. At exact application-code head
`79f31a4a308cce3675eed4a4294a3a7f18ebfdd5`, Chrome 150.0.7871.187 passed
333/333 assertions across 32 states and captured 32 screenshots; four
representative screenshots were visually inspected. The states cover
connecting, a long subscription-unavailable error, recovered loaded idle,
hovering, importing, completed, keyboard-owned and pointer-owned focus
transitions, target removal, and first-added-row focus and range anchoring.

| Viewport | Workspace | Roster (scroll max/reached) | Table | Spectrum panel (scroll max/reached) | Plot |
| --- | --- | --- | --- | --- | --- |
| 900x700 | 900x611 | 882x132 (204/204) | 882x69.77 | 884x110.22 (524/524) | 858x220 |
| 960x640 | 960x551 | 942x132 (204/204) | 942x59 | 944x60.98 (564/564) | 918x220 |
| 1366x768 | 1366x679 | 348.98x56 (280/280) | 989.02x293.34 | 991.02x304.64 (329/329) | 965.02x220 |
| 1920x1080 | 1920x991 | 493.88x197.80 (138/138) | 1398.13x460.22 | 1400.13x449.77 (99/99) | 1374.13x220 |

At every viewport, all nine table columns had a maximum header/data position or
width delta of 0 px, both document overflow axes were 0, and roster and spectrum
scrolling reached the measured endpoint. Hovering and importing overlays matched
the viewport exactly, were `aria-hidden`, used `pointer-events: none`, and never
won hit testing. The permanent live region remained path-free. A 799-character
subscription error wrapped without disabling either picker. Keyboard Add
activation recovered focus only when still owned; removing a newer target
prevented focus theft; keyboard Dismiss and Retry handed focus to Add files while
pointer activation did not. Each viewport also proved that Drop moved data focus
to the first newly added row and made that row the Shift-range anchor.

The run recorded zero console warnings or errors, zero page errors, zero request
failures, zero HTTP responses at or above 400, and zero product mismatches. Its
temporary report SHA-256 was
`8E833FC862AA54AC6512D1CDC63288278130C29AAB085630DF4372D54DF436C4`;
Chrome, Vite, port 41791, the verified junction and the temporary directory were
all closed or removed.

At final application-code head
`75fb9dd6d091c351239c5dff7bc386bdaafafaa6`, a focused third-repair rendered run
then passed 49/49 assertions across four consecutive 900x700 states and four
directly inspected screenshots. It proved singular `1 dropped item`, plural
`2 dropped items`, a busy rejection that retained the importing overlay, and an
incomplete no-result notice whose visible and permanent live-region text named
both shared limits as `this drop reached` without requiring multiple folders.
Every overlay again measured exactly `(0, 0, 900, 700)`, was `aria-hidden`, used
`pointer-events: none`, had no interactive descendants, lost the center hit
test, and produced zero document overflow. After adding a data favicon to the
external harness, the only remediation run recorded zero console warnings or
errors, page errors, request failures, and HTTP responses at or above 400. All
four screenshots were inspected; Chrome, Vite, port 5173, in-memory screenshots
and the temporary directory were then closed or removed. The preceding attempt,
whose resource URL was not captured, failed the strict console gate on one 404
and is not counted as evidence.

No physical Windows Explorer mouse gesture was performed. Native adapter,
filesystem, Channel and rendered behavior are automated evidence with distinct
boundaries. The per-document authority challenge is supported by locked
Tauri/Wry source and initialization-order inspection plus deterministic source,
epoch and frontend-header tests; the mock WebView does not execute
`eval_with_callback`. This record therefore treats neither that contract proof
nor the external rendered projection as a physical gesture or native end-to-end
run. No acquisition content was read and no ProteoWizard process was started for
this work.

## M3.0 mzML conversion boundary, 2026-08-06

The conversion sequence that until now existed only inside
`examples/m0_proteowizard_spike.rs` now also exists as library code.
`mscanvas-proteowizard` owns one immutable plan, one staged execution and one
no-clobber finalization, and `ADR 0009` records the decision. The spike is
unchanged and still runs its own sequence straight at the final output name;
two sequences with different output-safety postures coexist, and retiring the
harness is a later decision.

Three things were missing rather than merely unassembled, and each is closed
here.

There was no typed plan. `(input, output directory, output name, format,
compression policy, scan limits)` were threaded by hand across four call sites,
and two of them could disagree without anything noticing: the compression the
integrity check assumed and the `--zlib` the backend actually received were
independent facts, and the limits that read the source and the limits that
judged the output were chosen separately. A plan now fixes all of them at once,
and the source's own limits are the ones its output is judged by.

There was no temporary-then-final output lifecycle anywhere in the repository.
The plan pointed `msconvert` straight at the name a successful conversion takes,
so a partial write, a lossy output or a rejected document would have been left
in the user's output directory under exactly that name, distinguishable only by
a filename suffix convention. Each run now creates a private staging directory
inside the destination root, exclusively — an existing one is refused untouched
rather than adopted, because it may belong to a run still in flight — and points
the backend there. The final name is taken only after the produced document
passes the integrity contract, by `MoveFileExW` without
`MOVEFILE_REPLACE_EXISTING`, which fails rather than replaces. Everything else
is discarded with the staging directory. A destination that appears while the
run is in flight keeps its contents and the run fails.

That private directory also buys a real check rather than only tidiness. The
integrity contract has always required the output directory to hold exactly one
planned entry, which is why the spike kept a stricter empty-directory
precondition than the library it called. Enclosing the run makes that
requirement meaningful instead of unenforceable: an extra file the backend
emitted is now detected rather than lost among the user's own files.

And a source was a path. It is now an object that can only be obtained by
opening a real file, refusing anything that is not a regular file,
canonicalizing it, binding it to its filesystem identity, hashing it and reading
it as mzML. A file named `.mzML` that is not mzML does not produce one. Exactly
one source kind is expressible, with no vendor or directory variant present even
as an unconstructed enum variant, which is the rule ADR 0006 already applies to
the workspace registry.

Two absences are deliberate. There is no cancellation: real backend
cancellation and partial-output behavior are rated **D**, the only measured
conversion completed in `136 ms` below the safe-attempt threshold, and the
controlled Job Object tests are process-contract evidence. And there is no
overwrite: the conflict policy is fail or skip, with no third variant to select.

The run is also bound to the acquisition the plan admitted. The command builder
reads the source's identity from its path again, so before anything is created
or launched the run rechecks the recorded identity, byte length and hash. Review
found that without it, a source replaced or rewritten between planning and
running would be converted, and the post-run comparison would notice only by
rejecting a conversion that should never have happened — and not even that if the
original were restored before it looked, since the integrity scanner never
decodes an array payload.

The destination root is admitted the same way. A plan records its filesystem
identity, and the run refuses to create or finalize anything under a path that
now resolves to a different directory — a plan can outlive the folder the user
chose, and a queue makes that ordinary. A name the naming rule accepts is also
refused when the staging name built from it would exceed a filesystem name
component, so that is a plan-time refusal rather than an opaque failure once a
run is under way.

The boundary converts mzML to mzML. That is not the product goal; it is what the
evidence permits. The source/output comparison needs mzML source facts, so
applying it to a source that could not be read that way and calling the result a
fidelity check is precisely what this boundary refuses to do. No lawful vendor
RAW fixture exists or is authorized in this repository, vendor coverage is rated
**D**, and no vendor source posture may be added before that changes.

Nothing here is reachable from the product. No Tauri command was added or
changed, no transfer object, capability or frontend file was touched, no
dependency moved, and the registered command surface is still exactly thirteen.
Two crate-private visibilities widened — the output-file-name validator and the
bound-help capability parser — and no public API was removed.

Validation on the exact head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets`, `python -B scripts/check_repo.py`,
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

Twenty-eight tests were added, all deterministic and none reaching a backend: a
substituted runner receives the real planned command, so what it writes and
where is decided by the boundary under test rather than by the test. They cover
the derived name and the fixed plan; the argv the backend is given and that it
points at the staging directory rather than the destination root; a finalized
conversion landing beside an unrelated file that is left alone; an existing
destination under both policies, with the backend never launched and the
existing bytes unchanged; an existing staging target left exactly as it was; a
non-zero exit leaving its partial write out of the destination root; a launch
failure reported without the executable it names; a lossy output, an empty
output, no output at all, an extra output, and a source replaced under the run,
each rejected before the final name; a destination taken mid-run keeping its
contents; a source that is a directory, that is absent, or that is named `.mzML`
without being mzML; a source rewritten, replaced or removed between planning and
running; a destination root replaced or removed between them; an output name that
leaves no room for a staging name; a destination root that is missing or is a
file; distinct
path-free identifiers across every failure, plan error, source rejection and
policy; a run that did not complete never being finalized; the backend facts
projected on both a success and a rejection; a name with a space and non-ASCII
characters surviving the wide-string conversion end to end; a panic in the
substituted runner still discarding the staging directory; a capture-failure
stream label a substituted runner set to a path being projected onto a closed
set rather than rendered; and a staging directory that cannot be removed being
reported beside the primary outcome rather than instead of it, proved by holding
the staged file open with a share mode that refuses deletion. Twenty-seven run
on every platform; the residue proof is Windows-only, as the mechanism it
exercises is.

Refusing an existing staging area is right, and on its own it is also a trap:
one cleanup failure would leave a deterministically named directory that makes
every later run of that plan refuse, and a path-free failure cannot say which
name to remove. The plan therefore offers an explicit way out that the caller
invokes when it decides no run is in flight; nothing adopts a staging area
silently.

That way out is bounded by ownership rather than by name, because deleting a
tree on the strength of a name is how unrelated data gets destroyed. The marker
itself is created exclusively and follows nothing: the staging directory is new,
but it sits in a root another process may write to, and a plain write would have
followed a link planted at the marker's name and truncated whatever it pointed
at — which could be an output the user already had, or the acquisition itself. A staging
area carries a marker written as it is created, and a directory without it is
refused untouched however it is named. The marker is why the staging area has an
inner directory the backend writes into: the integrity contract requires the
output directory to hold exactly one planned entry, so the marker owns the
staging root and the backend owns one level below. Teardown removes the output
first and the marker last — the reverse order was written first, and the Windows
residue test caught it: cleanup destroyed the ownership proof before failing, so
the residue it reported would have been permanently unreclaimable. Review found
the tail of the same fault — removing the root is itself the step that can fail
once the marker is already gone — and an empty directory is now reclaimable as
well, not because emptiness proves ownership but because removing an empty
directory destroys nothing.

A source named `acquisition.raw` that reads as mzML is converted to
`acquisition.mzML`, which pins both halves of the naming rule at once: the
extension does not decide what a source is, and the format decides what the
output is called.

Rendered QA was not required and not performed: no frontend file, transfer
object, command signature, capability or user-facing string changed.
ProteoWizard was not executed and the desktop application was not launched. No
scientific acquisition was used as a fixture; the mzML documents in these tests
are generated in the test itself.

## M3.0.1 handle-bound conversion finalization, 2026-08-06

ADR 0009 recorded a window between judging a conversion output and giving it its
final name. The judgement described a file and let it go; finalization then
moved whatever the staged path resolved to. Anything with write access to the
destination root could substitute a different document in between, and the run
would report the facts of the document it read while the other one took the
name. That window is closed.

Validation now hands back the object rather than a description of it.
`verify_mzml_conversion_retaining_output` opens the staged output once, with the
access a rename needs, scans it and hashes it through that one handle, and
returns a `ValidatedConversionOutput` that owns it. Both readings coming from
one handle is itself a repair: the previous path told `mzml::inspect_file` to
open the name, then told the digest to open the name again, so even the hash and
the facts were not provably about the same object. `ValidatedConversionOutput`
has no constructor that takes a path, no `Clone`, and an opaque `Debug`.

Finalization consumes that value and renames the object the handle names, with
`SetFileInformationByHandle` and `FileRenameInfo`. On Windows the staged path is
never resolved again and does not need to still mean anything; outside Windows
the standard library offers no object-bound rename, so that platform still links
from the staged name and the narrower guarantee is stated rather than glossed.
Consuming is also what makes an object finalizable once, at compile time rather
than by a flag.

The target end could not be bound the same way, and the reason is measured
rather than assumed. `FILE_RENAME_INFO` carries a `RootDirectory` handle that the
NT contract resolves the new name against, which would make the target
object-bound too. Against this stack kernel32 refuses every non-null
`RootDirectory` form with `ERROR_INVALID_PARAMETER`, including with the exact
access mask the driver documentation recommends — which is why the standard
library also always passes null. `a_root_directory_relative_rename_is_unavailable`
keeps that measurement in the suite, so the day it stops being true is visible.
The target is instead bound by holding the admitted destination root open for the
run *without delete sharing*: the directory cannot be renamed or removed while a
conversion is in flight, so the canonical path the final name is formed from
cannot be made to denote a different directory. It costs the user the ability to
rename or remove that one directory for the duration of a run, which is recorded
rather than hidden.

`ReplaceIfExists` stays false. An occupied final name fails with
`ERROR_ALREADY_EXISTS` whatever holds it, and the conflict policy is still fail
or skip with no overwrite to select.

One ordering became load-bearing: the validated object is released on every
path, including a failed rename, before the staging area is torn down. A handle
retained inside a directory being removed would turn every failure into residue.

The separate cleanup-by-path window ADR 0009 records is **not** closed by this
work and is now the first follow-up.

No source posture, format, queue, cancellation, progress, persistence, transfer
object, command, capability or frontend file changed. No dependency was added,
removed or moved; the rename is a hand-declared `kernel32` export in the same
style as the crate's existing Job Object and file-identity bindings, and all
unsafe code in the conversion boundary lives in one module.

Validation on the exact head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets` (252 proteowizard library tests,
up from 243), `python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`.

Thirteen tests were added, all deterministic and none reaching a backend. A
private seam opens the one interval the claim is about — after the judgement,
before the final name — and the tests act inside it.

The load-bearing pair replaces the staged path after validation. Moving the
validated object aside and writing a different, perfectly valid mzML document at
its name finalizes the object that was judged, proved by a hard-link witness
bound to it before the substitution: a write through the witness appears in the
finalized file, so it is the same object and not merely the same bytes, and the
replacement is discarded with the staging area. Unlinking the staged name
instead leaves the validated object delete-pending, which Windows will not
rename, so that attack ends in a typed finalization failure with nothing in the
destination root — the other acceptable outcome, and the reason both are tested
rather than one.

The rest cover a normal conversion finalizing the same object it validated, with
the reported byte length matching the finalized file; the same end to end under a
name with a space and non-ASCII characters, which is where a wide-string bug
would live; a destination taken after validation by a file, by a directory and by
a hard link, each keeping its name and contents; the destination root refusing to
be renamed out from under a run, and a root that cannot be held refusing the run
before anything is inspected, created or launched; a failed finalization
producing no result, no residue and no staging remains; the renameable open
reading what it opened and refusing a directory or an absent path; the final-name
guard refusing every multi-component and rooted spelling; a held object refusing
a concurrent writer while still admitting a reader; and a validated output
rendering neither a path, a name nor a handle, then releasing its object on
drop.

Review changed the design in two places. Binding the rename to the object
settles which object is finalized, not what is in it: write sharing on the
retained handle would have let another process modify the object between the
scan and the rename, so the bytes taking the final name would not have been the
bytes that were judged. Write sharing is now withheld for as long as the run
holds the object, and an existing writer makes the open fail instead. Read and
delete sharing stay — a reader cannot invalidate a judgement, and refusing
deletion would cost a scanner or a backup agent its access for no correctness
gain, because finalization follows the handle rather than the name. The destination root was originally
pinned *after* the identity check, which left a window between the two — and the
work in it includes rehashing the whole source, which is not a moment. The root
is now held first and judged second: a pinned directory cannot be renamed or
removed, so the check that follows decides about the object the run will actually
use. Review also found the pin's cost understated. Windows refuses to rename any
ancestor of a held directory, so a run locks the destination root and every
folder above it for its duration; that is now recorded rather than left to be
discovered.

Ten mutations were introduced one at a time against this head. Seven were
caught:
reopening the output by path before renaming it, and renaming a handle reopened
after the scan, both fail the substitution tests; `ReplaceIfExists = TRUE` fails
three no-clobber tests; accepting a multi-component final name fails the guard
test; sharing deletion on the destination root fails the pin test; pinning the root
after the identity check instead of before fails the root-change test; and
restoring write sharing on the retained object fails the concurrent-writer
test.

Three were not, and the reasons are recorded rather than smoothed over.
Discarding the scanned handle and reopening the same path *inside* validation is
invisible to every test here, because the reopen happens before any seam exists
and the path still resolves to the same object at that instant; what stands
against it is structure rather than a test — the scanned handle is threaded out
of the scanner by ownership, so substituting another means visibly discarding it.
Changing finalization to borrow rather than consume cannot be caught at runtime
at all, because the single-finalization guarantee is move semantics; that
mutation does not compile without adding a handle clone. And the renameable
open's no-follow flag and its post-open recheck survive removal, because
exercising either needs a symlink — privileged to create on Windows — or a swap
timed inside the open. Both branches are inherited unchanged from the ordinary
guard beside them, whose equivalents this repository has never tested either.

Rendered QA was not required and not performed: no frontend file, transfer
object, command signature, capability or user-facing string changed.
ProteoWizard was not executed, no vendor fixture was requested or used, and the
mzML documents in these tests are generated in the test itself.

## M3.0.2 identity-bound staging cleanup, 2026-08-07

ADR 0009 recorded one safety window still open after handle-bound finalization:
teardown and reclamation proved that a path named an MSCanvas staging area, and
then deleted through that path. `remove_dir_all` widened the gap to every
component of every child — each name resolved again at the moment it was
unlinked, long after anything had been verified — and the staging guard held no
handle at all, only a `PathBuf`. That window is closed on Windows.

Nothing in staging teardown deletes a name now. A directory is listed through
the handle that already holds it; each child is opened following nothing, proved
to be the object that listing described, and held; deletion is a disposition set
on that handle. One engine serves both entry points, which differ only in how
the root object is obtained.

`OwnedStagingArea` replaces the old guard. It opens the staging root, the output
directory and the ownership marker as it creates them and holds all three for
the run, each without delete sharing, so none can be renamed or replaced while
the run depends on them; teardown consumes those handles rather than looking
anything up. It is RAII, not cloneable, has an opaque `Debug`, and carries an
explicit state — active, finished, cleaned, residue. An unwind runs the same
object-bound teardown through `Drop`, never the path-recursive form, precisely
because `Drop` cannot report what it finds.

Reclamation has none of that evidence, because the run that created the area is
gone. It opens the staging root once, following nothing, and every judgement
afterwards is about that object: the listing comes from its handle, and the
marker is opened, proved to be the entry that was listed, and read through that
same handle before it is believed. The admitted marker object is carried into
teardown, so its name is never resolved twice.

Three measured facts shaped the algorithm, and one of them contradicted the
first design. A directory with any child refuses deletion with
`ERROR_DIR_NOT_EMPTY`; a name marked for deletion does not leave its parent
until the handle marking it closes, on this stack even under POSIX semantics;
and `OpenFileById` works and returns an identity that matches the enumeration
exactly. The last one was not adopted: it resolves volume-wide rather than
relative to the parent, so a child moved out of the tree between listing and
open would still be found — and deleted — outside the boundary. Opening by name
inside a pinned parent and proving identity refuses that case instead.

The identity a child must match is the full 128-bit file identity together with
the volume serial. The listing supplies it directly because enumeration uses the
extended directory class; the older class reports 64 bits whose relationship to
the 128-bit form is NTFS product behavior rather than contract. Records are
walked with checked arithmetic — including a minimum forward step, without which
a malformed chain re-parses the same bytes — and read unaligned, since drivers
have been observed to violate the documented entry alignment. `.` and `..` are
skipped.

Reparse entries are refused, never followed and never removed. Deleting the link
alone would be safe, but a junction inside an area MSCanvas created is evidence
that something else has been there. The rule applies first to the staging name
itself: the root is opened without following a link and refused if the object it
reaches is one. A staging root holding anything besides the marker and the output
directory is refused the same way, untouched, and stays refused until whoever put
that entry there removes it.

The two entry points differ in one more way than how they obtain the root, and
it is a difference in authority. A live run removes only the objects it created
and has held ever since; an entry under an expected name that the run does not
hold got there some other way, and automatic cleanup refuses it rather than
deleting data on the strength of a name it recognises. Reclamation has no
retained objects to appeal to, so its authority is the admitted marker, which
vouches for the entries the admitted root listed. Retention starts at creation
rather than at first success: the marker object is held before anything is
written into it, so a write that fails part-way leaves teardown holding the very
file this run created rather than an entry it could only refuse.

Deletion is post-order and the handle ordering is load-bearing: every child is
disposed and closed before its parent is asked to go. The disposition asks for
POSIX semantics first, because that is the only form under which closing this
handle is enough to free the name, and falls back to the older class on
filesystems that do not implement it. The marker goes after everything else and
before the root, so an interrupted teardown leaves the proof a later attempt
needs rather than a nameless obstruction — and the root is listed once more,
after the output tree has gone and before the marker is touched, so that anything
which arrived in the meantime stops the teardown with the proof still in place. A
far narrower interval remains between that listing and the calls that follow it;
it is not claimed to be closed, and what is closed is the one that spanned an
entire tree's removal.

Two named limits bound an arbitrary backend tree — depth 64 and 65,536 entries
per directory — traversed with an explicit stack rather than recursion.
Exceeding either leaves residue and deletes no unverified remainder. Teardown
refuses no volume in advance: the conversion guarantee is local-only, but that is
a decision for destination admission, before a staging area exists and before the
backend runs. Making it in teardown gets the worst of both — everything is
already written, reclamation applies the same test and refuses the same way, and
the deterministic staging name is blocked for good. A volume that cannot support
the calls fails them, and a failed call is reclaimable residue. Nothing yet
refuses a remote destination up front, and that is recorded as open rather than
implied to be handled.

`StagingResidue` gained five path-free reasons with stable identifiers —
identity changed, reparse point, foreign entry, traversal limit, not enumerable
— and `StagingReclaimError` gained two that carry a residue, one for a teardown
that stopped part-way and one for a root that could not be admitted at all, plus
a detailed identifier that reaches into either. No published identifier changed:
an owned tree that a lock or a permission refused is the one reclamation failure
this crate already reported, and it keeps the variant, and therefore the
identifier, it was published with. Cleanup residue still never replaces the
conversion outcome.

What is not closed, stated rather than implied: the marker proves MSCanvas wrote
a file of that name and content, not that *this plan* wrote it. Anything able to
create a file in the destination root can forge one. Making it unforgeable is an
authenticated-ownership decision this slice deliberately does not take. What
changed is that a forged marker can now only cause the deletion of objects that
were individually opened, identity-checked and found to be exactly the entries
the admitted root listed. Non-Windows keeps the narrower path-based teardown and
does not claim equivalence; no dependency was added to imitate it.

No source posture, format, queue, cancellation, progress, persistence, transfer
object, command, capability or frontend file changed. All unsafe code for
teardown is in one module, hand-declared against `kernel32` in the same style as
the crate's existing Job Object, file-identity and rename bindings.

Validation on the exact head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets` (273 proteowizard library tests,
up from 256), `python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`.

Seventeen tests were added, all deterministic and none reaching a backend. A seam
fires after each directory is listed and before anything that listing named is
opened, which is the one interval the claim is about.

The load-bearing pair attacks that interval. The admitted staging root cannot be
renamed away — the attempt is refused with a sharing violation — and a plausible
impostor beside it, carrying a valid-looking marker and unrelated data, is
untouched while the admitted object is removed. A child replaced after it was
listed, by a file, by a directory, or by a hard link to an object outside the
tree, is refused with an identity mismatch in every case; the outside object is
intact, the tree is not removed, and the ownership proof survives for a later
attempt.

The rest cover an arbitrary nested backend tree removed whole; a backend failure
that left a sidecar directory still leaving the destination root clean; post-
order with the marker outliving the tree it vouches for; a junction planted in
the owned tree refused and never followed, with its target intact; reclamation
across absent, owned, empty, repeated and crashed-run cases; a marker that is
missing, wrong, a directory or a link trusted in none of those forms; a foreign
entry stopping teardown without being deleted; an unwind tearing down by object;
a cleanup that cannot finish keeping the primary outcome, reporting residue, and
staying reclaimable once the obstruction clears; and every residue and reclaim
reason rendering without a path or a handle.

Five tests came out of review rather than implementation. Three answer findings
raised on the pull request itself: a live run refusing to remove an output
directory it never held; an entry arriving in the staging root mid-teardown
stopping the teardown with the ownership marker still in place rather than
spent; and a marker this run created but never filled in still being this run's
to remove. That last one is the observable consequence of holding the marker
before writing it; the ordering inside `populate` that produces it is structural
and is not independently mutation-detectable. The other two came out of the
whole-diff review. A
link planted at the staging name, with a fully convincing owned-looking area on
the other side of it, is refused and never reclaimed through: the review found
that nothing defended the staging name itself, and that deleting the one flag
which happened to defend it passed every test then in the suite. And the two
deletion semantics the algorithm rests on are now pinned by measurement, in the
same way finalization pins the rename it cannot use — a directory with any child
refuses deletion, and a name marked for deletion leaves its parent when the
marking handle closes.

Twelve mutations were introduced one at a time against this head; eleven were
caught. Restoring path-based `remove_dir_all` fails five tests; removing the
child identity comparison fails the replacement test; following a reparse child
fails the junction test; deleting the marker first fails six; granting delete
sharing on the staging root fails the root-replacement test; swallowing residue
fails four; ignoring a foreign entry fails its test; and never disposing nested
directories fails five; and opening the staging root without
`FILE_FLAG_OPEN_REPARSE_POINT` — the mutation that survived the whole suite
before the review — fails the link-at-the-staging-name test; dropping the
retained-object requirement fails the unheld-output test; and dropping the second
root listing fails the arrived-mid-teardown test. The twelfth —
dropping the root handle and immediately
reopening it — is genuinely equivalent: the reopen acquires the same object and
the same pin, so no observable behavior changes, and it is recorded as
equivalent rather than as a gap.

Rendered QA was not required and not performed: no frontend file, transfer
object, command signature, capability or user-facing string changed.
ProteoWizard was not executed, no vendor fixture was requested or used, and the
mzML documents in these tests are generated in the test itself.

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
- Measure what `msconvert` itself does to an existing output. The M0
  existing-output case was refused by MSCanvas before launch, so the backend's
  own overwrite behavior has never been observed. The M3.0 conversion boundary
  does not depend on it — the backend only ever writes into a private staging
  directory — and must not start depending on it.
- ~~Measure whether `msconvert` writes anything into its working directory besides
  the output it was asked for. The M3.0 boundary requires the staging directory
  to hold exactly one planned entry, so a scratch or sidecar file would reject a
  faithful conversion. Required before that boundary is reachable from the
  product.~~ **Measured 2026-08-07 (M3.0.3), and again 2026-08-10 (M3.10) for the
  multi-output case**, on the installed build; the record is
  [ADR 0009](docs/architecture/adr/0009-mzml-conversion-execution-boundary.md)'s
  struck-through gate. Left standing here until M6.0's audit found it: a closed
  measurement listed as required is the one way this section can mislead the
  slice that reads it. The narrower half that survived it — the same question for
  a **non-mzML output format** — was **measured by M6.2 on 2026-09-02**: across
  twenty-nine cases into fresh empty directories — four of which produce mzXML,
  `X1`, `X2`, `X4` and `X5`, one of them letting the backend name its own output
  — every directory afterwards held exactly one entry. Nothing in this bullet is outstanding. See
  [M6.2's evidence document](docs/spikes/M6_MSCONVERT_CAPABILITY_EVIDENCE.md).

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

## M3.0.3 first evidenced vendor RAW source, 2026-08-07

ADR 0009 recorded two open evidence gates that this slice closes. There was no
lawful vendor fixture, so no vendor source posture could exist; and nobody had
measured whether `msconvert` writes anything besides its output, which is what
the boundary's exactly-one-entry rule depends on. Both were measured on a real
installed backend against a real acquisition.

The fixture is ProteoWizard's own `FT-HCD-MSX.raw`, pinned at commit
`8f945db3`, 78,309 bytes, SHA-256 `b3d97b38…dd7b`, covered by the repository's
root Apache-2.0 licence — the same instrument this repository already relies on
for the tiny mzML control, verified again at that commit with no NOTICE and no
per-directory licence to complicate it. It is a single-scan extraction the
ProteoWizard maintainer authored and committed to his own project, not a
biological or clinical acquisition. It is not tracked, and it was deleted after
the measurements. The full provenance, licence basis and lawful-use reasoning
are in `docs/spikes/M3_VENDOR_RAW_EVIDENCE.md`; the decision is
`docs/architecture/adr/0010-first-vendor-raw-source-admission.md`.

Three families were evaluated. Bruker and Waters are directory acquisitions with
no file signature at all — their readers probe for named members inside a
directory — so admitting either means the whole evidence list ADR 0007 requires
before a directory family may be recognised. Thermo RAW is a single regular file
and reuses the object model the mzML posture already established, which is why
it is first.

Recognition is the file's own 18-byte header: `01 A1` followed by `Finnigan` in
UTF-16LE, read from the object through the no-follow guard's handle. It is the
same header ProteoWizard's `Reader_Thermo` matches on, and that reader consults
no name. The extension is a filter in front of it rather than the recognition,
and it is there because of a measurement: the installed vendor library refuses
the very same object under another extension, exiting non-zero and producing
nothing. Both halves are refused at admission — a `.raw` file holding filler,
and a correctly signed file named otherwise — so a suffix never creates a
source.

One measurement changed the design. The Thermo reader cannot open the Windows
extended-length path this crate binds identity to: it answers `Corrupt RAW file`
and exits non-zero for the exact object it converts under a plain spelling,
while ProteoWizard's open-format reader accepts either. The argv source spelling
is therefore a per-family decision, and a plain spelling is derived,
re-resolved, and required to carry the admitted filesystem identity before it is
used. mzML keeps the spelling every earlier measurement was recorded with.

A run holds the acquisition rather than merely checking it: opened before the
recheck, hashed through that handle, and held until the output has been judged,
granting read sharing and withholding write and delete. Checking and then not
holding leaves the interval a check exists to close, and for an output-only
posture nothing else would catch a source rewritten under the run and restored
before the recheck — identity, length and digest would all match while the
document came from bytes nothing admitted. Withholding delete closes the same
hole from the other side, because the backend resolves a name. Both readers
tolerate the hold, measured rather than assumed. The cost is stated: for the
duration of a conversion the user cannot modify, rename or delete the
acquisition being converted, and outside Windows there is no mandatory share
mode so the guarantee is narrower.

Validation for a vendor source is output-only and the result says so.
`ConversionSourceFacts` split into the object facts every source has — identity,
length, digest — and the mzML reading only some sources have, so a vendor source
carries nothing to pretend a comparison with. `ValidConversion` gained a
validation mode and a third property set: the eleven comparison properties are
recorded as *inapplicable* rather than unverified, because they were never
questions this pair could be asked, and `is_fully_verified` answers false for
every output-only result whatever its sets contain. What a vendor run does
establish is the source object unchanged, the output's declared list counts and
array lengths present and consistent, no array declared non-empty without a
payload, every record saying what its arrays are — m/z and intensity for a
spectrum, time and intensity for a chromatogram — every record saying how its
arrays are encoded and not claiming they are both compressed and uncompressed,
every spectrum saying which MS level it is and none claiming to be both profile
and centroid, its index sequences consecutive, and the requested compression
honoured. Saying
what an array is does not say how to read it, and a record giving two
compression answers at once is worse than a wrong one: the compressed-array
count is satisfied, so only looking for the contradiction finds it. Both checks
are record-level and are documented as such rather than named for more than they
do: the scanner keeps the union of what a record's arrays declared, not the
per-array assignment, so a record whose first array claims both roles while its
second claims none passes. That residual gap is recorded with the other scanner
facts rather than papered over by a property name. Array roles are worth
separating from the comparison they resemble: comparing them against a source
needs the source and stays inapplicable, while an output that never says what
its arrays are is one nothing downstream can read, and it answers for that
alone. A list holding records while declaring no count
has omitted an attribute its schema requires: survivable under a comparison,
where the observed counts on both sides still answer the question, and a
rejection here, because recording it as verified would assert something the
document declined to state. An output holding no spectra and no chromatograms at all is refused before any
of that, because every structural check is a statement about records and passes
vacuously over a document that has none; a comparison never reaches the case,
since the source's counts would already disagree. It does not distinguish an
absent list from one declaring `count="0"` — that needs a fact the scanner does
not record, and both are refused regardless. A document that says it holds peaks
and holds none is refused for the same reason, whether the arrays are present and empty or
absent altogether — the second being the quieter case, because with no arrays
there is nothing for a payload check to find empty and nothing for a compression
check to find uncompressed: the comparison path catches that by finding the
source's payloads where the output has none, and with no source the
self-contradiction is what remains. A peakless record — zero declared length,
empty payload — stays legitimate, because the M0 evidence corrected an earlier
contract for refusing exactly that. The mzML comparison is untouched.

Support is bound to the build it was measured on. Installed help now yields a
provider build — release and source revision — parsed from the same complete
capture every other capability fact comes from and with discovery's own parsing,
so a capability decision and a discovery report cannot disagree. A vendor family
runs only on a listed build, refused before a staging area exists, and widening
is adding a measured row rather than relaxing a check. A row names three things:
the release, the source revision, and the digest of the `msconvert.exe` the
conversion actually ran against. Two strings out of a help banner say what a
build calls itself, and an installation with the vendor libraries missing or
replaced answers both identically; discovery already hashes the executable
either side of its probe, so binding the row to the artifact costs nothing. The
vendor libraries themselves are not opened or hashed, and that is recorded as
open rather than implied.

Measured result, on release `3.0.26013` revision `47b13cf`, from one complete
two-stage run of both fixtures on the final tree rather than carried forward
across the review rounds: the layout stage
produced exactly one entry carrying the planned name, 28,661 bytes, no sidecar,
index, log or scratch file, and the mzML control did the same. The boundary run
finalized in `output_only` mode with an `indexedmzML` output of one spectrum and
one chromatogram, no cleanup residue, exactly one file in the destination root,
and `fully_verified=false`. The output digest is deliberately not pinned:
`msconvert` records the source location inside the document, so the same
acquisition converted from a different directory produces different bytes.

`examples/conversion_source_evidence.rs` is the reusable harness. Its
`--diagnostics` destination is a base path with one no-clobber file per stage: a
single shared destination let the second stage truncate the first one's
evidence, and a caller one keystroke away from typing the acquisition's path
would have had it truncated instead. An existing file is refused, so is a path
that resolves to the acquisition, and a diagnostics write that fails is raised
rather than dropped — a run reporting `finalized` while silently failing to save
what the caller asked for is the harness lying about what it did. Diagnostics inside the workspace are refused, because the workspace is emptied
when the harness returns and an exception in a cleanup is how the thing it was
meant to remove survives. The workspace is held before it is judged empty, not
after: checking and then opening leaves the interval between them, and
everything downstream would bind to whatever the name meant at the end of it.
The layout
stage runs its command directly rather than through `run_conversion`, so it
takes its own hold on the acquisition and rechecks the admitted digest either
side of the measurement; without that, layout evidence could describe a run over
bytes the admitted source never had. The workspace is held open without delete
sharing for the whole run, because the harness deletes its contents recursively
by resolving a path, and a workspace renamed away and replaced between the
stages and the cleanup would have had it deleting somebody else's directory —
the same path-versus-object mistake the staging cleanup slice existed to remove.
A workspace it cannot empty is reported alongside whatever else failed rather
than instead of it, because a backend failure is exactly when residue is most
likely and what would be left behind is a converted document named after the
acquisition. It plans with
the same planner and the same per-family spelling the boundary uses, reports the
layout the backend produced before anything cleans it up, then runs the whole
boundary. It prints shapes only — extension, kind, byte length, whether a name
is the planned one — and never a name derived from an acquisition. Raw backend
streams go to an explicitly requested local file with a stated deletion
obligation, and everything the harness creates in its workspace is removed
before it returns.

Sixteen tests were added — fifteen that run and one explicitly ignored — all
deterministic and none reaching a backend. The ignored one is the real-fixture
run, so a machine without the fixture and the backend is told the claim went
unchecked rather than shown a green run. They cover signature recognition in
both directions, extension filtering including case, a directory and a junction
at a source name, a source rewritten before the run and one rewritten during it,
every output postcondition an output-only contract can fail, the build gate
across four wrong builds, the spelling decision, and that nothing renders a path.

Fifteen mutations were introduced one at a time; twelve were caught. Removing
the signature check, comparing the extension case-sensitively, and reporting a
too-short file as an inspection failure each fail the recognition test; claiming
a source comparison for a vendor result fails the mode test; ignoring an extra
output entry fails three; dropping the vendor source revalidation fails the
rewritten-during-the-run test; accepting an unevidenced build and ignoring the
source revision each fail the gate tests; finalizing partial output fails its
test; skipping the output-only index-sequence or compression checks fails the
output-contract test; and keeping the extended-length spelling for the vendor
family fails the spelling test.

Three survived, and each is recorded rather than papered over. Removing the
posture check from vendor admission is **equivalent**: the guard's own open
repeats the same refusal, so the two are redundant by construction. Using the
derived plain spelling without re-resolving it is defence-in-depth against a
Windows path that normalizes to a different object, and an attempt to construct
one with a trailing-space directory component did not diverge on this build —
the check stays, and the test that would have justified it was removed rather
than left asserting something it did not demonstrate. Reading the signature from
a second handle instead of the one the digest is computed through needs a writer
to change the file between two adjacent reads; there is no seam for that and
adding one to production code for it is not worth what it would buy.

Validation on the exact head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets` (288 proteowizard library tests,
up from 273), `python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`, `git diff --check`.

Nothing user-visible changed. No Tauri command, transfer object, frontend file,
capability, queue, progress, cancellation, retry or persistence, and no
dependency. Users cannot convert a RAW file after this slice; the posture is
private Rust reachable only from inside the crate.

Rendered QA was not required and not performed: the diff contains no frontend
file, transfer object, command signature, capability or user-facing string.

## M3.0.4 private workspace-to-conversion path, 2026-08-07

Two boundaries existed and did not touch. The session owned datasets — a
registry keyed by filesystem identity, an accepted file holding its object open,
an opaque handle the webview receives instead of a path — and accepted only
mzML. The conversion boundary owned runs — signature admission, an immutable
plan, private staging, one execution path, an integrity contract, and since
M3.0.3 one named vendor family gated on the exact build it was measured on — and
accepted only a path. This slice joins them, once, privately, with no surface.

A path is not a dataset. Resolving a handle to a path and handing the path over
would give up every guarantee the session exists to keep, at the moment it
matters most. So the join is made on the object: `ConversionSource` now reports
the volume serial and file id it was admitted with, the session compares that
against the identity its own inspection established, and a conversion is refused
unless the two admissions name one object. No path-bearing internal was made
public to do it.

`AcceptedFile` now records which family it was accepted as, and every use of a
dataset re-applies that rule rather than the one this boundary happens to run
first. ADR 0006 had forbidden such a variant outright while the only evidence
was for mzML, on the ground that a variant which exists is a claim the data
behind it is understood — and said such a claim needs its own evidence and its
own decision. Both now exist, so the condition was met rather than waived; ADR
0006 is amended to say so.

The coordinator's order is the design. The epoch is claimed before the wait; the
backend gate is taken with no workspace lock held; the epoch is rechecked after
the wait; the file is revalidated under its recorded family; the build is
checked against the recorded evidence before anything is pinned or created; the
file is pinned and only then re-admitted, so the identity comparison closes the
window between revalidation and the pin *before an output could exist*; and the
run is stamped with the generation the gate guard carries. Preview and
conversion serialize through the one existing gate, in both directions.

Twenty-seven deterministic tests cover it, none needing a local ProteoWizard,
and one ignored test collects the real end-to-end evidence on demand.
Ten mutations of the load-bearing decisions were applied one at a time and all
ten were refused. One initially survived — removing the session's hold on the
source — because the crate independently pins and re-identifies the source
during a run; the hold is kept and now has the test that shows what it uniquely
decides, which is refusing an acquisition another program is still writing.

The real end-to-end conversion was run on the implementation head, on the
evidenced build (release `3.0.26013`, revision `47b13cf`, `msconvert.exe`
SHA-256 `9BB6F5D5…D590BD`, verified before the run), beginning from workspace
dataset handle `file-0` rather than from any harness. `FT-HCD-MSX.raw`
(78,309 bytes, SHA-256 `b3d97b38…dd7b`) finalized as `FT-HCD-MSX.mzML`,
28,655 bytes, SHA-256 `6CE2ACE6…D8648C`, 1 spectrum and 1 chromatogram, exit 0
in 663 ms, exactly one file in the destination, no sidecars, no staging residue.
Validation was output-only: 9 verified, 0 unverified, 11 inapplicable, and not
fully verified — which is the honest answer for a source that was never read as
mzML. The acquisition and the output were deleted afterwards. No vendor data is
committed.

`mscanvas-proteowizard` gained a `test-support` feature, off by default and
enabled only as a dev-dependency of the desktop crate. The coordinator takes
capability evidence by value and every production route to one runs a real
executable, so without it no deterministic test of this path could exist at all.
Widening the constructor to an ordinary public one was rejected: it would make
forged evidence reachable from the shipped binary, which is what the build gate
above it exists to prevent. No dependency and no lock file changed.

Review caught that declaring the feature is not by itself a barrier:
`cargo build --all-features` turns on every feature a manifest declares, and
Cargo offers no way to exempt one, so the original claim that no shipped build
could carry it was false. It is now enforced twice — `scripts/check_repo.py`
refuses any manifest that enables the feature outside `[dev-dependencies]`, and
the crate refuses to compile with it on in an optimized build, which is the only
property that distinguishes a build users receive.

Validation on the final head: `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `git diff --check`.

Nothing user-visible changed. No Tauri command, transfer object, frontend file,
capability, button, menu action, output-folder picker, queue, progress,
cancellation, retry or persistence. Ingestion is still mzML-only: the picker,
folder discovery and the Explorer drop all refuse a vendor acquisition, and the
suite asserts it. The path is compiled into the shipped binary and unreachable
from it; every item on it carries a stated `expect(dead_code)` under
`cfg(not(test))` pointing at
`docs/architecture/adr/0011-private-workspace-conversion-path.md`.

Rendered QA was not required and not performed: the diff contains no frontend
file, transfer object, command signature, capability or user-facing string.

## M3.1 first visible Thermo RAW conversion, 2026-08-07

The conversion boundary had everything except a way in. M3.0.4 joined it to the
workspace and stopped there on purpose: private, no command behind it, every
item carrying a stated `expect(dead_code)`. This slice is that surface and
nothing beyond it.

The exact claim is narrow and the narrowness is the point. `Add files…` admits
regular `.mzML` and one evidenced Thermo Scientific RAW family, recognized by
its 18-byte signature rather than its name; one focused Thermo row converts to
mzML, one at a time, on one exact ProteoWizard build. Folder ingestion and
Explorer drop are untouched and remain mzML-only, because both walk a tree the
user did not enumerate and admitting a vendor family from a walk is a wider
claim than admitting one they named. No second `Add RAW…` button was added: the
user's question is "add this acquisition", not "which reader opens it". The
command behind the action was renamed `choose_workspace_files`, because
`choose_mzml_files` had become a name that said something false.

Every roster row now carries a required, closed `sourceKind`, and Rust refuses
`open_mzml_preview` for a vendor row rather than leaving it to a disabled
button. An automatic first preview reads the first newly added *mzML* row, never
simply the first row, so a mixed batch into an empty workspace still costs one
process and a batch of acquisitions costs none.

Conversion acts on the focused row, never on the selection, and its primary
action lives in the conversion panel beside the summary it acts on rather than
as a sixth roster button — partly discoverability, partly that the roster's
280px floor is derived from five buttons wrapping to three lines and a sixth
would move that arithmetic, the narrow-window budget and four pinned tests
without making anything easier to find. Moving focus to a vendor row does not
disturb an mzML preview already on screen.

The destination is a third Rust-owned native folder picker, and remote roots are
refused at admission rather than discovered by a cleanup that cannot finish:
ADR 0009's finalization and cleanup guarantees are local Windows guarantees, and
refusing early is the difference between "we will not write there" and "we wrote
there and cannot tell you what state it is in".

The two-phase reservation copies the folder-import shape for the reason that one
already gives, and proves the calling document with the authority the drop
subscription established. State is one slot — `idle`, `awaitingDestination`,
`running`, one terminal report — read rather than pushed, which is what makes
reload recovery fall out instead of being built. A second conversion is refused,
not enqueued. Rust enforces every concurrency rule: adding, clearing, a new
preview and a native drop are refused while one runs, the converting row cannot
be removed while every other row still can, and searching, sorting and reading
the list stay available. There is no Cancel button and the panel says why; there
is no percentage because nothing measures one.

Deterministic coverage: 356 Rust tests and 476 frontend tests, none needing an
installation or a WebView. ADR 0011's open binding gate is closed from both
ends — a run given `msaccess` capability evidence cannot express a conversion,
and a source-contract test pins that the production provider binds `msconvert`
for conversion and `msaccess` for preview with exactly two bindings.

The real end-to-end conversion ran on the implementation head through the
product path — `add_files`, then the reservation the destination picker claims —
on the evidenced build (release `3.0.26013`, revision `47b13cf`, `msconvert.exe`
SHA-256 `9BB6F5D5…D590BD`, verified first). `FT-HCD-MSX.raw` (78,309 bytes,
SHA-256 `b3d97b38…dd7b`) was admitted as dataset `file-0` of family
`thermo_raw` and finalized as `FT-HCD-MSX.mzML`, 28,655 bytes, SHA-256
`6CE2ACE6…D8648C`, 1 spectrum and 1 chromatogram, exit 0 in 568 ms, exactly one
file in the destination, no sidecars, no staging residue. Validation was
output-only: 9 verified, 0 unverified, 11 inapplicable, and not fully verified.
The serialized update names no path. The acquisition and the output were deleted
afterwards; no vendor data is committed.

Validation on the final head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `git diff --check`.

No queue, cancellation, progress percentage, retry, persistence, mzXML,
overwrite, second vendor family, directory-formatted acquisition support, output
auto-import or output auto-preview. No dependency and no capability was added.

## M3.2 serial Thermo RAW conversion queue, 2026-08-08

The one-conversion slot became a bounded, serial, session-scoped queue. A single
focused conversion is now a queue of one rather than a second protocol beside it:
`WorkspaceConversionStateDto::{Completed, Failed}` are gone, folded into one
`Terminal` whose queue says which items did which.

Selecting Thermo RAW rows shows the ordered list that would run — in the roster's
visible order, after the user's search and sort — with the mzML name each item
would write and how many selected rows are excluded for already being mzML. Two
items that would write one name are refused during planning, before a picker
opens and before anything is created, because the conflict policy answers a
question about the folder and not about the queue.

The bound is **16**, enforced in Rust, reported to the interface as the plan's
capacity, and refused with `queue_too_large`. It was chosen for one reason and
recorded in the ADR: the queue is serial and cannot be cancelled, so whatever is
started is waited out. At one to three minutes per real acquisition that is
roughly sixteen to fifty minutes of unstoppable work — deliberate, and far below
the 1,024-row workspace capacity, so "select everything and convert" is refused by
a rule rather than accepted into an hours-long run.

One folder, admitted once under ADR 0012's rules and retained as an *object*: the
volume serial number and 128-bit file ID are read from the handle admission
already holds, and a retry re-admits the name and refuses with
`queue_destination_changed` unless it reaches the same object. One provider
binding and one evidence question for the whole queue, and the backend lane held
from the first item to the last — not because the busy slot needs it for previews,
which it already refuses, but for the callers it does not refuse, such as a
backend recheck.

A failure belongs to its item. The queue continues, nothing already finalized is
undone, and a run that finalized nothing names no output file. `Retry` reruns only
what Rust classifies as retryable, in place, at the same folder and policy, and
counts the attempt.

The retry classifier is **total over the boundary's failure types, matched by
type rather than by identifier**. Matching by type means the compiler refuses to
build when the crate gains a variant; matching by string would also have been
wrong, because `source_not_rehashed` is emitted by two variants at two phases and
the identifiers are therefore not a partition. What it says is narrow: a
destination root that exists but would not open, and an acquisition that exists
but could not be read (`file_unreadable`, and `source_in_use` for the same
physical condition through the other open). Everything else answers no. The M0
spike's `Retryability` contract was not inherited — it classifies only
`ProcessError`/`ProcessOutput`, where it speaks to this path it says
`AfterCorrection`, and its `Retryable` arms come from an unmeasured catch-all.

Deterministic coverage: 381 Rust tests and 494 frontend tests, none needing an
installation or a WebView.

Thirteen focused mutations were applied one at a time. Eleven died against the
suite as written. Two survived and were closed rather than argued away: sorting
the queue back into registry insertion order survived because the order test added
its acquisitions in the order it queued them, and releasing the backend lane
between items survived because every interleaving the concurrency test tried was
already refused by the busy slot. Both tests were strengthened and both mutations
now die.

The real queue ran on the implementation head through the product path —
`add_files`, then the reservation the destination picker claims — on the evidenced
build (release `3.0.26013`, revision `47b13cf`, `msconvert.exe` SHA-256
`9BB6F5D5…D590BD`, verified first). Three distinct copies of `FT-HCD-MSX.raw`
(78,309 bytes, SHA-256 `B3D97B38…DD7B`) were admitted as `alpha.raw`,
`bravo.raw`, `charlie.raw` and queued as `charlie`, `alpha`, `bravo` — an order
the workspace does not hold. All three finalized in that order at one attempt
each, producing 28,652 / 28,646 / 28,646 bytes with distinct digests, 1 spectrum
and 1 chromatogram each, exactly three files in the destination, no sidecars and
no staging residue; validation was output-only on every item, 9 verified, 0
unverified, 11 inapplicable, none fully verified. Serial execution was measured
twice: peak 1 concurrent `msconvert.exe` across 4 samples, and 2,057 ms of wall
time against 1,614 ms of summed backend time. Failure isolation was measured on
the same build by occupying the middle item's output name: `one.mzML` finalized,
`two` failed `destination_exists` with no process, no output name, no residue and
not retryable, `three.mzML` finalized, and the occupying file was unchanged byte
for byte. The serialized updates name no path. The acquisition, the copies and
the outputs were deleted afterwards; no vendor data is committed.

Validation on the final head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `git diff --check`.

No cancellation, progress percentage, parallel conversion, app-restart
persistence, mzXML, overwrite, second vendor family, directory-formatted
acquisition support, output auto-import or output auto-preview. No dependency and
no capability was added.

## Private ProteoWizard conversion cancellation, 2026-08-08

Real backend cancellation and partial-output behaviour were rated **D** from M0
onward, because the only measured conversion completed in `136 ms`. They are now
measured, and a private cancellation primitive sits beneath the visible queue.
Nothing a user can reach starts a cancellable conversion, and the queue is still
uncancellable and still says so.

Everything cancellation needs had been built since M0 and none of it was
reachable: the process boundary owned a Windows Job Object with
`KILL_ON_JOB_CLOSE`, a `CancellationToken` and `TerminateJobObject`, and proved
process-tree termination against a controlled parent-and-grandchild tree — but
`ProcessRunner` had one entry point, `SystemProcessRunner::run` always passed a
token nobody held, and `run_conversion` could not request anything.

`ConversionCancellation` is created per attempt and taken by value, and it is not
`Clone`, so one request belongs to one attempt and cannot be reset, reused or
aimed at a second run; a second use is a use-after-move rather than a rule.
`CancellationRequest` is the clonable handle a caller keeps and can only request
with. Both render an opaque `Debug` and neither serializes.
`ProcessRunner::run_cancellable` is one defaulted method: the default keeps the
only guarantee a runner can keep without owning supervision — a request already
made launches nothing — and then delegates, so a substituted runner can never
report a mid-run cancellation it did not perform. `SystemProcessRunner` overrides
it with the reviewed `execute_cancellable`. No dependency was added and no second
subprocess implementation exists.

`run_conversion_cancellable` reports `Cancelled` only when the owned job
confirmed no surviving process. A request that could not be confirmed is a
distinct `CancellationFailed` carrying the process boundary's own typed reason,
with cleanup residue kept separate; a natural exit, a natural backend failure and
a launch failure each keep the reason true of them; and `run_conversion` is
unchanged for every caller that supplies none. `ConversionRunOutcome` was
deliberately not widened, so nothing that matches it exhaustively — the queue,
the desktop boundary — acquired a state to classify, and no cancelled outcome was
silently marked retryable.

Six real scenarios ran on the evidenced build (release `3.0.26013`, revision
`47b13cf`, `msconvert.exe` SHA-256 `9BB6F5D5…D590BD`, verified by the library's
own gate, which refuses any other installation). The lawful `78,309`-byte Thermo
fixture converts in about half a second, so a bounded mzML workload was generated
outside the repository — `3,000` spectra of `500` peaks, `36,014,923` bytes, no
personal or proprietary content, deleted with the workspace — and it converts to
a finalized `12,283,969`-byte output in `1,116 ms` of backend time through the
unchanged boundary.

A request made before an attempt launched no process and created no staging area.
Early and mid-write requests terminated the owned tree with `STATUS_CANCELLED` in
`69`–`73 ms`, leaving zero surviving owned processes. The mid-write run was
terminated with `95,363` bytes of partial document on disk; the race run
`9` bytes short of the finished size. Every cancelled run left the
destination root empty, removed the partial document by identity-bound cleanup
with no residue, and finalized nothing. The evidenced Thermo reader was terminated too, once it had created its staged
output, after `468 ms`.

The partial-output measurement changed what private staging means here. This
build writes its output **directly under the planned name and grows it in
place** — no `.part`, `.partial` or `.tmp` suffix appeared in any observation, so
a partial output is indistinguishable from a finished one by name. Pointed at the
destination root, this backend would leave a truncated `.mzML` under exactly the
name a good conversion takes. Every observation held exactly one staging entry:
no sidecar, index, log or scratch file, even mid-write.

One ordering rule, decided by observation order inside the supervision loop, and
both halves are measured. A request observed while the process is still running
makes successful job termination decisive, whatever exit status the racing
process then reports — a run cancelled at the moment its conversion was due to
finish has been observed to report `Cancelled` with an exit code of `0`, the
process having finished inside the window between `try_wait` and
`TerminateJobObject`, with nothing finalized either way. A completion already observed makes the run an ordinary
exit, proved deterministically by a runner that issues the request only after the
real process has returned: `finalized`, one output, no residue. Only one is ever
reported.

Validation on the final head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets` (319 ProteoWizard tests, up from
297), `python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`, `git diff --check`. Ordinary CI runs no backend and
downloads nothing; the real evidence is an explicit developer-only example.

Fifteen mutations were applied one at a time and each was caught by the test
written for it: the system runner ignoring its token; the default runner
ignoring a request already made; the parent killed while the owned job is left
alone; a cancellation reported before the owned tree is confirmed empty; a
natural exit relabelled cancelled because a request was pending; a partial
staged document reaching finalization; identity-bound cleanup skipped after a
cancellation; a termination failure reported as a cancellation; both pre-launch
refusals dropped; absent owned-job accounting accepted as a confirmed
cancellation; a refusal inside the runner claiming a backend ran; and a refusal
reporting an empty owned job instead of no job; and a refusal described as a
terminated process; the executor no longer asking before it spawns; and one capture thread giving up
on its pipe. One of
the first nine survived
on first application — dropping the refusal between the source rehash and
staging creation broke no destination but made the run claim a backend had run
when none had — and the test naming that property was written rather than the
mutation argued away. The last six exist because review found the holes they
close, across six rounds; each now has a test that dies without the fix. Two intended mutations are
structurally unreachable and recorded as such: a cancellation object controlling a
second run does not compile, and a raw process identifier cannot be exposed
because `ProcessOutput` has never carried one.

Rendered QA was not required and not performed: no frontend file, transfer
object, Tauri command, capability or user-facing string changed. The downloaded
fixture, the generated workload, every converted output and every scratch
directory were removed; no child process survived any scenario. See
[ADR 0014](docs/architecture/adr/0014-proteowizard-cancellation-evidence.md) and
the [M3.3 evidence record](docs/spikes/M3_CANCELLATION_EVIDENCE.md).

No cancellation UI, Tauri command, transfer object, queue semantics, progress
percentage, parallel conversion, second vendor family or dependency was added.
The product semantics for cancelling one item, continuing, or cancelling a whole
queue remain undecided.

## User-visible queue stop, 2026-08-08

The serial conversion queue can be stopped. ADR 0013 recorded "no cancellation"
as its largest open gate — sixteen items is up to roughly an hour a user cannot
interrupt — and refused a control until real termination and partial-output
behaviour were measured. ADR 0014 measured both; this exposes the private
primitive as one queue-level action.

`Stop queue` requests cancellation of the attempt under way, begins no item after
it, keeps every finalized output where it is, cleans the current staging area
through the existing object-bound teardown, marks untouched items `not run`, and
reaches one terminal state. It is deliberately not called *Cancel*: it ends the
whole queue and undoes nothing already written, and the panel says both halves
before it is pressed. There is no confirmation dialog, no pause, no resume, no
per-item cancellation and still no percentage.

The race rule is ADR 0014's, unchanged. Observation order inside the supervision
loop decides the current item, so a conversion that completed before the request
was accepted keeps its ordinary result rather than being relabelled. Nothing
predicts which while a stop is in flight; the interface says only that no further
item will start and that the current conversion may still finish on its own.

Authority reuses the retry model exactly: the operation identifier the caller is
looking at plus proof of being the current document. A reload may stop the queue
it recovered; a replaced document may not stop its replacement's work. An idle
slot, an open picker, a stale identifier and a finished queue all answer with one
path-free refusal, and a repeated stop is idempotent. The queue slot holds a
monotonic stop flag for the life of one operation and at most one request-only
handle bound to an exact operation, item and attempt, released when that exact
attempt settles. The state moves under the slot lock; the cancellation is asked
outside it, so the interface keeps answering while a process ends.

An unconfirmed termination is neither cancelled nor an ordinary failure. The
process boundary's `CancellationFailed` proves nothing about survivors, so the
queue ends as `stop_failed` and the session enters backend quarantine: preview,
spectrum load, conversion, retry and installation change are all refused, the
roster stays readable and searchable, and the interface says to restart MSCanvas.
The flag is set once and never cleared — nothing in the session can establish
that the lost process ended — and no process recheck is invented, because the
boundary exposes no identifier that would make one meaningful. A stopped or
stop-failed queue is terminal and is never retried in place, even when it holds a
failure a retry would otherwise take.

Real product-path evidence ran on the evidenced build (release `3.0.26013`,
revision `47b13cf`, `msconvert.exe` SHA-256 `9BB6F5D5…D590BD`) with three copies
of the lawful `FT-HCD-MSX.raw` fixture (78,309 bytes, SHA-256 `B3D97B38…DD7B`)
admitted as `alpha.raw`, `bravo.raw` and `charlie.raw` through the production
Add-files path and stopped through the production command boundary.

- **Confirmed cancellation.** The stop was issued once the first item had
  created its staged output. Request to terminal state: `60 ms`. The item became
  `cancelled` with the tree confirmed gone and a partial output observed; the
  other two became `not run`; zero outputs were finalized; no staging residue;
  the destination folder was empty afterwards; the session still trusted the
  backend; the stopped queue refused a retry.
- **Completed output retained.** The stop was issued once the queue's own state
  said one item had finalized. `alpha.mzML` (28,637 bytes, 1 spectrum, 1
  chromatogram, output-only validation, nine verified properties) stayed in the
  folder and was the only thing in it. The second item was `cancelled` having
  launched no process — the stop landed between it being marked running and its
  process existing — and the third was `not run`.
- **Cancellation failure** is deterministic rather than real, through a
  substituted process boundary that either refuses termination or reports
  surviving owned processes. Both produce `stop_failed`, launch no later item,
  quarantine the backend and refuse every subsequent backend operation while
  leaving the roster usable.

Automated UI evidence is jsdom with CSSOM, which is the strongest route this
repository has: there is no browser harness, and none was added. No pixel or
paint is claimed. What is asserted is production structure, exact user-visible
copy, accessible descriptions, which controls are offered and disabled, live-region
text, focus, and the CSSOM rules for the new item states — across the running,
stopping, stopped and stop-failed states, a repeated request, reload into both
stopping and stopped, queued/converting search pinning, and the three checked
viewports.

Validation on the final head: `cargo fmt --all --check`,
`cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`,
`cargo test --locked --workspace --all-targets` (391 desktop tests, up from 381),
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
(505 frontend tests, up from 494), `pnpm build`, `git diff --check`.

Ten mutations were applied one at a time and each was caught by the test written
for it: the queue continuing after a stop; a prevented item marked failed rather
than not run; a natural success relabelled cancelled; an unconfirmed termination
reported as a cancellation; the quarantine omitted; a stopped queue offering
Retry failed; the stop command accepting a document that is not the current one;
an old attempt handle reachable by a later stop; a cancelled item left retryable;
and a stop rolling back what had already finished. Two of the ten survived first
application and are recorded with their repair: a stopped queue with no retryable
failure never reached the retry gate, and a mismatched attempt release was
unobservable with one worker settling one attempt before binding the next. Both
now have a test that names the property directly. One intended mutation is
structurally unreachable: `ItemOutcome::Stopped` carries no report, so a
cancelled item cannot claim it produced a file.

No dependency and no capability was added. `stop_workspace_conversion_queue` is
the nineteenth registered command and takes only an operation identifier. No
resume, no per-item cancellation, no persistence, no parallelism, no overwrite,
no mzXML, no second vendor family and no output auto-import.

## Explicit converted-output adoption, 2026-08-09

A terminal conversion queue now offers its finalized mzML outputs, and the user
adds them. Nothing is adopted because a conversion finished, and nothing is
previewed as a result.

**Why the action is more than a shortcut for `Add files…`.** MSCanvas made these
files, measured them, and can keep hold of the objects. Between finalization and
the moment the user asks, the final name is an ordinary name in a writable
folder: it can be given to a different object, and the object it named can be
deleted and its file id reissued. So the question adoption answers is not "is
there an mzML file called this?" but "is the file about to enter the workspace
the exact object this queue finalized, still holding the bytes that were
validated?".

Both halves are required and neither implies the other. Identity alone admits a
file rewritten in place; a digest alone admits any copy. The object those
questions are asked of is the object the registry is about to hold — the accepted
file's own lease — so there is no gap between the proof and the thing proved, and
a writer-excluding hold spans the reading so the answer cannot go stale while it
is being given.

**What finalization now keeps.** It used to release the object it had just
renamed. It now reopens that object *from its own handle* — `ReOpenFile` names an
object rather than a path, so it is the same object by construction — with the
same fully permissive sharing the workspace's own leases use, and releases the
renaming handle immediately. That handle withholds write sharing, and keeping it
would have quietly forbidden the user from writing to their own finished file;
three existing finalization tests caught exactly that and pass unchanged against
the reopen. The retention buys one thing and no more: the object cannot cease to
exist while it is held, so its identity cannot be reissued.

**Partial success, in queue order.** One output that is missing, replaced,
modified, unreadable or no longer valid does not stop the others. Outcomes are
closed and path-free: `added`, `alreadyInWorkspace`, or `refused` carrying
`output_missing`, `output_changed`, `output_unreadable`, `output_not_mzml` or
`workspace_full`. Registry semantics are the existing ones — duplicate before
capacity, the existing row returned with its original origin, and no identifier
consumed by a duplicate, a refusal or a full workspace.

**Linearization.** Adoption hashes files, so it reserves a workspace generation
under the mutation gate, releases it, checks and accepts outside every lock, then
requires that generation and the queue to still be current before committing. A
mutation that wins in between adds nothing at all and answers
`adoption_superseded`, which is retryable because the outputs are still there. A
reload participates in the same order, so an abandoned document cannot add rows
its replacement never learns about.

**Stopped, stop-failed and quarantined.** A stopped or stop-failed queue keeps
whatever it finalized and remains adoptable; only `finalized` items are eligible.
Quarantine does not block adoption, because adoption launches no process, and
adoption does not clear quarantine — an adopted row may enter the workspace and
still not be previewable.

**No persistence.** Tickets are session-scoped and bounded by the queue's sixteen
items. Replacing the queue drops them, which closes handles and does nothing to
the files; after a restart the outputs are ordinary mzML files and `Add files…`
reaches them. The panel says so before it is needed.

No dependency and no capability was added.
`adopt_workspace_conversion_outputs` is the twentieth registered command and
takes only an operation identifier. No path, destination, filesystem identity,
raw handle or adoption token crosses the boundary. No auto-import, no
auto-preview, no persistent provenance, no filesystem watching, no queue resume,
no per-item cancellation, no parallelism, no overwrite, no mzXML and no second
vendor family.

## Redacted conversion diagnostics export, 2026-08-09

A failed conversion said a stable identifier and a sentence. What would have been
diagnosable is what `msconvert` printed, and that is exactly what named the
acquisition, the folder, the staging area and the installation — so ADR 0009 had
always dropped it when the run returned.

**Where redaction happens.** Inside `run_staged`, while the plan, the staging
area and the executable are still in scope. The captured bytes go out of scope
with the run that made them, so nothing downstream holds raw process output and
nothing downstream could redact it if it did: by then the paths are gone. The
queue retains one bounded, redacted excerpt per stream and only for an attempt
that failed.

**Two mechanisms, composed.** `Redactor` removes every spelling of the paths this
run knows — case, separators, dot segments, extended-length and UNC prefixes,
Windows short and long names — and now counts what it replaced.
`absolute_path_start`, the general shape test that had been the preview DTO's
private path scrubber, moves into the crate so there is one owner of that rule;
the DTO delegates to it unchanged. After exact-token redaction the shape test
runs on exactly the string that would be written, and an excerpt that still looks
like it names an absolute local path is withheld entirely with
`residual_absolute_path` in its place.

One false positive is forgiven and only one: a separator directly after a
placeholder is the remainder of a path whose root was already replaced, so
`<destination>\run.mzML` is kept. A drive letter or a `file:` URL after a
placeholder is not a tail and still withholds the excerpt. Without the exemption
almost every useful excerpt would be suppressed; broader than a separator, a leak
would pass.

**Bounds.** 32 KiB per stream after decoding and redaction, at most one
diagnostic per queue item — the queue's own sixteen — and 2 MiB for the whole
document, measured in memory including its trailing newline before anything is
created. Over the bound is `diagnostics_too_large` and writes nothing: half a
JSON document is a file no reader can open. The process boundary's 8 MiB capture
limit is unchanged and was not raised to enlarge the export.

**Schema.** One versioned document, `mscanvas.conversion-diagnostics` version 1,
serialized by hand because no production dependency renders JSON and adding one
for two hundred bytes of structure would be the wrong trade. Field order is fixed
by the code that writes it, so two exports of an unchanged queue are byte
identical. Streams are declared `prefix`, `withheld` or `none`, and each carries
total bytes, captured bytes, both truncation flags separately, whether decoding
was lossy, and the replacement count. The redaction section reports counts and
never the values.

**Writing.** The crate gains the writer it never had: a private sibling created
exclusively, filled, flushed, synced, then renamed **by handle** with
`ReplaceIfExists` false, and removed through that same handle on any failure. So
the object published is the object written, an occupied name is a refusal that
replaced nothing, and a cleanup failure is reported beside the primary one rather
than folded into it. The folder goes through the destination admission that
already refuses UNC, remote volumes, reparse points and non-directories.

**Authority.** Two commands in the two-phase shape the destination picker
established: a reservation issued synchronously and bound to the document, the
terminal queue and which settling of it, consumed before `GetSaveFileNameW` is
dispatched. A replaced document's unclaimed reservation is released; an export
already writing completes and stores its result for the replacement to read.

**Relationships.** An export and an adoption both own the terminal queue and Rust
runs one at a time. While an export is in flight, retry, adoption, a new queue and
every workspace mutation are refused; roster reads, search, sort, selection and an
open preview are not. It takes no backend gate and launches no process, so
quarantine does not block it and it does not clear one.

**What crosses IPC.** Whether an export is available, how many items it would
describe, whether one is running, and — after one — a basename, a byte length, a
SHA-256 and an item count. No document, no excerpt, no path, no directory.

No dependency and no capability was added. The two new commands are the
twenty-first and twenty-second. No upload, no telemetry, no clipboard, no support
workflow, no diagnostics history, no logging framework, and no claim that an
exported file is anonymous or safe to share unreviewed.

## Second evidenced vendor source family: Shimadzu LabSolutions LCD, 2026-08-09

ADR 0010 admitted one vendor family and left open whether its posture generalised
or was Thermo-shaped. It generalises, with one correction, and this slice records
both. Nothing user-visible converts the new family.

**Why the first rule was not enough.** A Shimadzu `.lcd` and a SCIEX `.wiff`
begin with the same eight bytes: both are Microsoft compound files, and
`D0 CF 11 E0 A1 B1 1A E1` names the container rather than the vendor — measured
on real fixtures of both. ADR 0010's rule applied unchanged would admit a `.wiff`
renamed `.lcd`, and the backend then launches, writes nothing and exits `1` with
`[ShimadzuReader::ctor] LoadData error: E_UNSUPPORTEDFILE`. Following ADR 0010
would have produced exactly the deferral ADR 0010 forbids. ProteoWizard gave no
help: `Reader_Shimadzu::identify` and `Reader_ABI::identify` both test the
filename and ignore the bytes they are handed.

**What recognises the family.** One step inserted into the shared admission body
after the signature comparison and before the rewind, through the same pinned
handle: the entry names in the compound file's first directory sector must
include `Method File Property`, `GUMM_Information` and `LSS Raw Data`, exactly
and case-sensitively. Skipped entirely for families whose leading bytes are the
recognition on their own, and dispatched by a function total over the enum, so a
family added later has to answer rather than inherit. The reader is a little over
two hundred lines before its tests, and reads a header and one sector — no FAT
walk, no tree traversal, no stream opened, no content decoded, every ambiguity a
refusal, the seek bounded. No dependency was added.

**Why not SCIEX WIFF.** It was investigated first and refused on a measured
fact. `Reader_ABI::read` pushes one `MSDataPtr` per sample, and pwiz's own
committed reference outputs are ten `.mzML` files for one input acquisition. A
one-source/one-output conversion plan cannot represent that, so the gate was
recorded instead of the plan being bent around it.

**What was measured.** Two lawful fixtures from ProteoWizard's Apache-2.0
repository at a pinned commit, downloaded outside the repository and deleted
afterwards. On release `3.0.26013` revision `47b13cf` with the executable digest
ADR 0010 already pinned: each converts to exactly one `mzML`, no sidecars, no
partial-output names, byte-identical on repeat. `finalized`, `output_only`,
`is_fully_verified` false, no residue. One fixture produced zero spectra and 144
chromatograms and was finalized correctly — a chromatogram-only acquisition is a
real acquisition, and no rule was weakened to accept it.

**The build table gained a row, not a wider row.** Both entries name the same
build, because both families were measured on the same installation, but a row
is a family converted on a build — a build that reads one vendor's files is not
evidence about another vendor's library beside it in the same binary. No
vendor-library identity is claimed; this repository does not hash those DLLs.

**Scope.** No picker entry, no workspace row, no conversion action, no queue
support, no Tauri command, no DTO, no capability, no frontend code. One arm was
added to the desktop crate's rejection mapping because that match is exhaustive;
it reports what the neighbouring signature refusal reports and no workspace path
can reach it. See
[ADR 0018](docs/architecture/adr/0018-shimadzu-labsolutions-lcd-source-admission.md)
and [the M3.7 evidence record](docs/spikes/M3_NEXT_VENDOR_EVIDENCE.md).

## Private workspace Shimadzu LCD conversion, 2026-08-10

ADR 0018 established what a LabSolutions `.lcd` is. This establishes that the
product can hold one: a workspace row with an identity, a lease and a recorded
family, carried whole into the conversion boundary and back. Nothing a user can
click does any of it.

**Two decisions, kept apart.** ADR 0006 refused to let a source-family type exist
while the only evidence was for mzML, on the ground that a variant which exists
is a claim the data behind it is understood -- and said such a claim needs its
own decision. ADR 0011 made the same split for Thermo: private path first,
surface later. The gap this closes is exactly the one that was left: the crate
could convert an LCD from a path, and nothing could convert one from a dataset.

**Internal family.** `DatasetSourceKind::ShimadzuLcd`, decided at admission and
stored on the accepted dataset beside the identity and the lease. Every mapping
over it is total at compile time -- preview eligibility, queue eligibility, wire
projection, diagnostics identifier, conversion-source kind, revalidation
dispatch -- and none has a fallback that could treat it as Thermo or mzML.
Duplicate admission keeps the row it already has.

**No recognition is duplicated, and here that matters more than usual.** The
desktop crate holds no compound-file magic, no sector geometry, no root-storage
rule, no marker names and no build strings; `accept_shimadzu_lcd_file` delegates
to `ConversionSource::open_shimadzu_lcd_file` and adds only the session's own
inspection and the identity lease. A `.lcd` and a `.wiff` begin with the same
eight bytes, so a second spelling of that rule would be a second rule the moment
either changed.

**Private, and asserted to be.** `accept_workspace_file` does not consult the
LCD extension, so a `.lcd` the user picks still reaches mzML admission and is
still refused by name. The one operation that admits the family is compiled out
of the shipped binary. The picker, folder import, Explorer drop, visible queue
and preview each refuse it in a test, and the command registration list is
asserted not to name it.

**One inert wire member.** `DatasetSourceKindDto` gains `shimadzu_lcd`, with a
TypeScript member and a roster label beside it. Structural rather than product:
every row carries a family and the projection is total over what Rust can admit.
Reporting such a row as another family would make the roster lie; an unknown
member would make every row's family a guess. It grants no ingestion, no queue
eligibility and no action.

**Real evidence, from a handle.** Both lawful fixtures re-acquired, digests
re-verified, admitted through the private service and converted on the evidenced
build. One mzML each, no sidecars, no residue, `output_only`, not fully
verified. The second produced **0 spectra and 144 chromatograms** and finalized
-- a real acquisition shape, and the deterministic suite now states both that
and its converse, that a document with no records at all is refused.

Nine focused mutations, all red. No dependency, no capability, no command, no
queue or cancellation change, no diagnostics or adoption change, and no rendered
QA needed because no user-visible behaviour changed. See
[ADR 0019](docs/architecture/adr/0019-private-shimadzu-workspace-conversion.md).

## First visible Shimadzu LCD workflow, 2026-08-10

ADR 0018 measured the family, ADR 0019 carried it through the workspace
privately, and this makes the product claim: `Add files…` admits evidenced
Shimadzu LabSolutions LCD beside mzML and Thermo RAW, and the one serial queue
converts it — alone or mixed with Thermo, in visible order.

**What widened, exactly.** The picker filter covers `*.lcd` and the Add-files
routing sends the extension to the family's own admission; the extension only
routes, and the container rule in the crate is what admits, so renamed and
malformed compound files are refused at add time. `is_convertible` says yes for
both vendor families through one Rust predicate and one frontend helper. The
queue plan item carries its `sourceKind`, snapshotted at plan time. Copy is
family-aware: homogeneous queues name their exact family, mixed queues count
per family, plan rows label their own, and the roster label is the precise
"Shimadzu LabSolutions LCD".

**What deliberately did not widen.** Folder ingestion and Explorer Drop remain
regular-mzML-only — no vendor recognition runs during traversal, so a walked
`.lcd` is not even a rejection — and the distinction is pinned in tests and in
ADR 0020. No direct vendor preview; the automatic first preview still reads at
most the first newly added mzML row. No SCIEX WIFF, no multi-output model, no
directory acquisitions, no second queue or lane, no new command: the count
stays at 22.

**Mixed queues.** One queue, one destination, one policy, one serial lane. Each
item revalidates under its recorded family; the provider-evidence gate is asked
per distinct family — opportunistically before the destination picker (only
when the backend lane is free, because a queue has always been admittable while
a preview holds the lane) and authoritatively at execution, replacing a
hard-coded Thermo constant. Cross-family output-name collisions — `sample.raw`
and `sample.lcd` both planning `sample.mzML` — are refused by the existing
folded rule before the picker opens, whatever the policy.

**Real evidence on the exact evidenced build.** Both lawful LCD fixtures and
the Thermo fixture, digests re-verified: the production picker path admitted
all three in order and refused a renamed-WIFF control; a mixed queue converted
serially to three mzML files, no sidecars, no residue, output-only and not
fully verified throughout, the 0-spectra/144-chromatogram shape intact;
adoption added three ordinary mzML rows; and a product Stop against a running
real Shimadzu conversion cancelled it with the owned process tree confirmed
empty and an empty destination.

Ten focused mutations red; one recorded equivalent (swapping the folder
import's acceptance function is unobservable because discovery proposes only
mzML candidates — the discovery filter is the guarded seam, and widening it is
caught). UI evidence is jsdom + CSSOM: production components, copy,
accessibility and CSS contracts, no pixel claims. See
[ADR 0020](docs/architecture/adr/0020-first-visible-shimadzu-lcd-workflow.md).

## Private multi-output conversion lifecycle, 2026-08-10

ADR 0018 refused to force the measured SCIEX topology into the single-output
plan and recorded the gate; this builds the model that closes the model half of
it. One logical source, one backend run, a bounded set of mzML documents —
implemented as `conversion_run::output_set`, reusing the process boundary,
staging ownership, scanner, handle-bound finalizer and identity-bound cleanup,
with no second implementation of any of them. No source family is admitted:
there is no WIFF variant anywhere, no recognition, no provider row, and the
entry point is an evidence function over a Rust-owned path.

**The sharpened motivation.** New measurements show even a single-sample WIFF
cannot use the single-output plan: `msconvert` names the output itself
(`PressureTrace1.wiff` → `PressureTrace1-6500SysSuit1269.mzML`). Backend-
authoritative naming, not output count, is what makes the lifecycle necessary.

**The model.** Names are discovered from private staging after the run — the
directory is the sole authority. Discovery is bounded
(`MAX_CONVERSION_OUTPUTS_PER_SOURCE = 24`, more than double the measured ten,
deliberately no existing capacity constant) and refuses sidecars, non-regular
members, partial names, unsafe names and Windows-folded duplicates whole.
Ordering is stable filename order, recorded as application ordering rather
than sample order. Every member validates — writer-denied open, fail-closed
scan, hash through the held object, output-only judgement — before the first
publishes. Conflicts are knowable only after the work: Fail refuses the set on
any occupied name; Skip skips only the whole group and refuses a strict-subset
conflict as mixed. Publication is one handle-bound no-clobber rename at a
time, honestly non-atomic: a mid-set failure yields an explicit
`PartiallyFinalized` naming the kept prefix, the failed member and the
unpublished remainder — no rollback of the user's published files, staged
remainder cleaned, residue separate. Each published member is retained as the
existing `FinalizedOutput`, collected beside the path-free report.

**Real evidence, on the exact evidenced build.** Both lawful re-acquirable
WIFFs are single-sample; the ten-output Enolase input is not in the pinned
tree — recorded honestly, with the multi-member real-backend run left as the
admission slice's gate. What was measured end to end: backend-chosen names
discovered, a chromatogram-only real output (0 spectra / 41 chromatograms)
validated and finalized, a 29.6 MB / 2,235-spectrum output validated and
finalized, repeat runs naming the same set, and the companion-less failure —
exit 1 *with partial output left behind* — refused and cleaned by the
lifecycle. The `.wiff.scan` companion is required, which is a source-topology
fact the admission slice owns. Output digests embed source location and are
not recorded as portable facts.

The single-output boundary is untouched and still refuses a second output or a
sidecar. Ten focused mutations — publish-before-validate, sidecar ignored,
bound removed, folded duplicate accepted, Fail/Skip partial publication,
partial collapsed to ordinary failure, rollback, staging never cleaned,
single-output accepting two — all red. See
[ADR 0021](docs/architecture/adr/0021-private-multi-output-conversion-lifecycle.md)
and [the M3.10 evidence record](docs/spikes/M3_MULTI_OUTPUT_EVIDENCE.md).

## Private SCIEX WIFF source admission, 2026-08-11

Both gates ADR 0021 left open are closed, and one new one is opened honestly.
`ConversionSourceKind::SciexWiffBundle` is a real source family — recognised,
bound, provider-evidenced, converting through the existing output-set
lifecycle — and no user can reach it. `DatasetSourceKind`, its DTO, the
TypeScript union, Add files…, folder ingestion, Explorer Drop, the queue and
every Tauri command are untouched; the two arms added to the desktop crate's
exhaustive matches reuse existing codes and existing message strings, because
inventing copy for an unreachable family would be inventing the surface.

**The acquisition is not one file, and that is measured, not assumed.** A SCIEX
source is a `<name>.wiff` and the `<name>.wiff.scan` beside it. Remove the
companion and the backend does not refuse cleanly: it exits 1 *and leaves one
truncated document per sample behind* — ten of them for the ten-sample fixture,
about a seventh the size of the real outputs and each well-formed enough to
open. So `CommandSpec::source_identity` is now a bounded `SourceIdentitySet`,
the pre-spawn check confirms **every** member, and the admitted run reopens,
posture-checks, length-checks, digest-checks and holds each member for the whole
run. A companion never appears in the argv; nothing else would ever look at it.

**Recognition is the container's contents and the companion's own bytes.**
Upstream's `Reader_ABI::identify` consults the file name and nothing else, with
an unanswered `// TODO: check header signature?` above it. A `.wiff` shares its
first eight bytes with a LabSolutions `.lcd`, so four entry names in the
compound-file directory are required — disjoint from the LabSolutions set, so
no object satisfies both rules — and the companion is recognised by its own
32-byte prefix because it is not a compound file at all. The companion's name is
derived from the admitted primary and never searched for: upstream's own test
data has a `.wiff.scan` whose primary is a `.wiff2`, beside two unrelated
`.wiff` files. `.wiff2` is refused at the extension filter.

**The multi-sample gate, closed on a real acquisition.** The M3.10 record said
the ten-sample Enolase input was absent from the pwiz tree; that was true of the
commit it pinned and not generally — the file was deleted with a test-data
tarball in 2019 and restored upstream in 2022. Pinned at the restore commit
(Apache-2.0, 3.9 MB), it converts on the evidenced build to **ten mzML
documents**, one per sample under backend-chosen names, `fully_finalized`, same
basename set on a second run, no residue. Both single-sample fixtures convert
the same way. A third provider row, not a widened one.

**The staging-membership gate, decided and closed.** No shipped executable of
this build enumerates samples before conversion — `readIds` is library-only,
`--runIndexSet` selects by index, `msaccess` needs a full read — so the expected
set is genuinely unknowable in advance. But the backend states each document on
its own stdout, over a pipe only its process tree can write to, so the
discovered set must now equal the declared set or the whole set is refused. That
restores the property ADR 0021 recorded as lost. It compares names rather than
counts (the declared bytes are UTF-8, byte-identical to the on-disk name — checked
with a non-ASCII name), fails closed on an absent, truncated or unreadable
declaration, and is bound to the build the provider row pins by digest.

**The gate this opens.** `Reader_ABI::read` catches a per-sample failure, logs
it and continues — so an acquisition whose samples partly fail produces fewer
documents, declares exactly those fewer, and exits zero. Declaration and
discovery agree and both are short, and nothing here can tell that from a
complete conversion without parsing vendor internals this reader refuses to
parse. Recorded as a gate on any user-facing surface rather than papered over.

Twelve focused mutations, each removing one guard, all red — including one that
survived the first pass, because the conversion-level test caught a replaced
companion at admission and left the pre-spawn recheck deletable; the test that
kills it aims at the process boundary where the guard lives. See
[ADR 0022](docs/architecture/adr/0022-sciex-wiff-source-admission.md) and
[the M3.11 evidence record](docs/spikes/M3_SCIEX_WIFF_EVIDENCE.md).

## Private workspace SCIEX WIFF bundle conversion, 2026-08-11

ADR 0022 admitted the source family at the crate boundary. Nothing connected it
to a workspace dataset, and the workspace could not have held one: every dataset
was exactly one filesystem object, and that assumption *was* the aggregate, the
duplicate rule, the revalidation contract and the roster's idea of how big a
dataset is.

**One `DatasetId` now represents one whole acquisition.** `AcceptedFile` carries
the other objects it is made of, each with its own canonical path, identity,
lease and digest, empty for every single-object family. No second registry row
for the companion, no side map, no SCIEX-only workspace — each of those would
put one acquisition in two places and leave every later question with two
answers to keep in step.

**Duplicate identity is the whole acquisition.** The registry keys on the
primary's filesystem identity plus its companions', in bind order, which for
every existing family is the one identity it always was. The same bundle is one
row; the same `.wiff` with a *different object* under the companion's name is a
different acquisition, because handing back the first row would give the user a
dataset bound to a companion that is no longer there. Duplicate still precedes
capacity, and neither a duplicate nor a rejection spends an id.

**A bundle remembers what each member held.** A lease keeps an object from being
replaced and deliberately permits a writer, so the bytes under a leased name can
change while name, object and identity all stay what they were. For a primary
that is caught later, when the conversion boundary rehashes what it pins. For a
companion nothing catches it, because nothing else in this boundary ever looks
at one — so the workspace records the digests the crate already computed, and
revalidation compares identity, name **and** content member for member.

**The coordinator keeps the single-output path's order step for step** — claim,
unlocked wait, epoch recheck, revalidate, bind, evidence gate, pin, admit, run,
stamp — and differs in pinning every member and holding them all for the run.
Its result is a new path-free report rather than a widened
`WorkspaceConversionReport`, whose singular `output_file_name`/`output`/
`validation` do not survive a backend that names its own outputs. All four ADR
0021 group outcomes are preserved, partial finalization kept whole rather than
collapsed into "nothing happened" when five of ten files are the user's.

**The completeness gate is stated, not closed.** `Reader_ABI` can fail a sample,
log it, continue, declare only what it wrote and exit zero — so
`declared == discovered` does not prove every sample converted. `fully_finalized`
means every member of the *admitted output set* was validated and published, and
nothing more. The report carries no completeness field at all: no
`all_samples_converted`, no `source_complete`, and no positive variant that no
evidence could produce. A test searches the report's own rendering for one, so a
field added later fails there rather than in review. **The next product-visible
SCIEX slice stays blocked until this is closed with evidence.**

**Real evidence, from a workspace handle.** All three lawful acquisitions
admitted through the private service and converted from their `DatasetId` on the
evidenced build: ten members from Enolase and one each from the other two, every
run `fully_finalized`, two bound source objects each, output-only validation and
`is_fully_verified` false throughout, retained finalized objects equal to the
published count, no residue, and a rendered report carrying no path or identity.

Nothing a user can do reaches any of it: the picker does not route `.wiff`,
folder discovery and the Explorer drop stay regular-mzML-only, the visible queue
refuses the family as a whole-request refusal, it is not previewable, and the
command list is asserted unchanged. The inert `sciex_wiff` wire member exists
for the reason ADR 0019 gave `shimadzu_lcd` one: the roster projection is total
over what Rust can admit.

> **Superseded on 2026-08-12.** The picker routes `.wiff` and the queue takes
> the family — see *First visible SCIEX WIFF workflow* at the foot of this
> record. Folder discovery, the Explorer drop and direct preview are the three
> parts of the paragraph above that are still true.

A staleness refusal has to leave a way out: revalidation refuses a row whose
members were rewritten in place and says to open the acquisition again, and
opening it again reaches the duplicate lookup with unchanged identities. So a
matching identity with differing digests **rebinds** the existing row rather
than handing it back. Without that the instruction is a loop.

Fourteen focused mutations, thirteen red. The survivor is recorded rather than
hidden — removing the coordinator's own companion locks leaves the suite green,
because the interval they protect has no seam a deterministic test can reach
while the interval they overlap is already held by the crate. Two further
mutations were considered and not run, with reasons. See
[ADR 0023](docs/architecture/adr/0023-private-workspace-sciex-wiff-conversion.md)
and [the M3.12 evidence record](docs/spikes/M3_WORKSPACE_SCIEX_WIFF_EVIDENCE.md).

## SCIEX per-sample completeness, 2026-08-11

ADR 0022 recorded a gap and would not close it by assertion: the reader can fail
one sample, log it, continue, declare only what it wrote, and exit 0 — so
declaration equal to discovery proved nothing about the acquisition. That gap is
now measured, not reasoned about. Zeroing **one sample's own streams** inside a
copy of the real ten-sample acquisition, with container, FAT, directory and the
other nine samples byte-identical, makes the backend exit 0, declare nine, write
nine, and lose the tenth in silence. The pre-slice boundary called that
`fully_finalized`.

**A source-side manifest was looked for first and does not exist.** No shipped
executable enumerates a WIFF's samples without converting it: `msaccess -x
metadata` takes the single-run overload and reports an empty sample list,
`--verbose` adds nothing, `--runIndexSet` filters the vector the reader already
returned — so it counts samples that read *successfully*, which is the question
— and no command-line tool calls `readIds` at all.

**So the proof runs the other way: nothing was lost.** At the evidenced source
revision the loop is `for i in 1..=getSampleCount()` with one
`catch (exception&)` that emits its marker unconditionally before continuing;
anything it does not catch fails the whole file. Every zeroable per-sample
stream was broken in turn and **no silent skip was observed** — one marker per
lost sample, none otherwise.

**But an error-stream audit is necessary and not sufficient, and tracing the
driver is what showed it.** Two paths lose a sample saying nothing at all: a
sample whose name is a substring of the file's basename shares an output path
and is silently overwritten — reproduced with **no corruption, only a file
name**: ten declarations, nine files, exit 0, empty stderr — and a sample whose
index comes out empty writes a record-free document. Both were already refused,
by the declared-set comparison ADR 0022 added against injected members and by
output-only validation. Completeness is therefore a conjunction of five links,
of which this slice owns two.

**The positive state is a typestate, not a boolean.** Only the examination can
produce a `NoSampleLoss`, and only that can become an
`EstablishedSampleCompleteness`, which carries the proof method, the count and
the exact executable digest. There is no `bool fully_converted` anywhere.

**Enforced before publication** — after the backend exits, before discovery,
validation or any destination name. It is the only point where refusing costs
nothing: found later, the choice would be between telling the user their
acquisition converted when it did not and deleting files they already have.
An incomplete run publishes zero members.

`fully_finalized` keeps ADR 0021's meaning. Completeness sits beside it, is
asked only of the family whose backend can lose part of an acquisition without
saying so, and is `None` for every other family rather than a value they must
fabricate.

**Real evidence.** All three lawful acquisitions establish completeness through
a workspace handle (10, 1, 1). Both damaged acquisitions — the zeroed sample and
the colliding names — are refused before publication with **zero** files
written, where the pre-slice boundary published nine and reported success.
Eight focused mutations, all red.

**Still not claimed:** fidelity, and samples the reader never identified —
`getSampleCount()` is `getSampleNames().size()` and the reconciliation against
the vendor's own count is commented out upstream, beneath a note that some files
have more samples than names. That is an upstream defect this boundary cannot
measure around, and it is recorded rather than smoothed over. SCIEX stays
invisible: output-set adoption does not exist yet. See
[ADR 0024](docs/architecture/adr/0024-sciex-sample-completeness.md) and
[the M3.13 evidence record](docs/spikes/M3_SCIEX_COMPLETENESS_EVIDENCE.md).

## Private SCIEX output-set adoption, 2026-08-11

A SCIEX acquisition converts to as many as twenty-four mzML files and the
workspace had no way to take them. ADR 0016's adoption already did the hard
part — exact object *and* exact validated bytes per output, one refusal not
abandoning the rest, duplicate before capacity, hashing outside the workspace
lock, a reserved generation so a workspace that moved on gets nothing — and it
already processed several outputs in one attempt, because a queue finalizes
several items. The mismatch was cardinality and only cardinality.

**So the engine was lifted, not rewritten.** The ordered multi-candidate
machinery that was inline in `adopt_conversion_outputs` is now two functions
that both paths call. The evidence that visible behaviour did not change is that
the tests pinning it pass untouched. No second verifier, no second hashing, no
second duplicate engine, no second commit protocol.

**The set ticket wraps member tickets rather than replacing them**, so nothing
about how one output is proved differs because there are ten. It is minted from
the retained objects at the moment the conversion ends, taking them by value:
there is no path in it from a name back to a file, which is the point.

**Eligibility is `FullyFinalized` *and* established sample completeness**, plus
a report and a set of objects that pair one-to-one in order. Never inferred from
a non-empty retained set.

**A partially finalized conversion gets no ticket, deliberately.** Its published
members are real files the user owns; nothing rolls them back, deletes them or
hides them, and they open the way any other mzML on disk opens. Packaging the
prefix under an action named for the acquisition's output set would make a
conversion that stopped halfway read as one that finished. That is a different
thing from a partial *adoption* — a complete set whose members the workspace
could not all take — and the two are kept apart in the code and in ADR 0025.

**Every adopted member is an ordinary `Mzml` row**, by construction rather than
by assignment: adoption admits each candidate through the workspace's own mzML
admission. No converted-output family, no automatic preview, no backend gate, no
command. The whole path is compiled out of the shipped binary, like the
conversion that feeds it.

**Real evidence.** The ten-sample Enolase acquisition, digests verified,
converted on the evidenced build to ten published members with completeness
established, then adopted: ten `added` in publication order, eleven workspace
rows (the acquisition still one bundle row), every adopted row `mzml`, no
preview anywhere, no path in the ticket's or the result's rendering, and a
second adoption reporting all ten as already present.

Eight focused mutations, seven red. The survivor — a superseded adoption allowed
to commit — guards a window one file hash wide that a single-threaded suite
cannot move the workspace inside, and is recorded rather than papered over; two
further mutations from the brief were considered and not run, with reasons. See
[ADR 0025](docs/architecture/adr/0025-private-sciex-output-set-adoption.md) and
[the M3.14 evidence record](docs/spikes/M3_SCIEX_OUTPUT_SET_ADOPTION_EVIDENCE.md).

## Private SCIEX serial-queue integration, 2026-08-12

One SCIEX acquisition now runs as one item of the *existing* serial conversion
queue, whatever number of documents its backend writes. The queue could not
represent it before, and the reason was one field: every item carried one output
filename, derived from the row's own name before the destination picker opened.
That is true of Thermo and Shimadzu and it is what the queue-internal collision
rule is built on. It is false of SCIEX.

**The cardinality is named rather than assumed.** `ItemOutputTopology` is
`KnownSingle`, which owns its name from the moment the queue is planned, or
`BackendNamedSet`, which owns nothing until it has published because until then
nobody knows what it will be called. Two named cases, not `Option<String>`,
because `None` would have to mean unknown, absent, failed and multi-output at
once. **No name is derived for a set from anything** — not the acquisition's
stem, not the sample count, not the sample names.

**The set variant is compiled out of the shipped binary, and that is the privacy
claim rather than a consequence of one.** No visible surface admits a SCIEX row,
so none can build such an item, and a build without the variant cannot represent
one at all. The visible transfer object, its stable identifiers and the frontend
are untouched.

**One queue, one slot, one backend lane, two cardinalities.** No SCIEX queue,
worker, busy flag, retry slot, cancellation registry or diagnostics subsystem.
`convert_queue_item` gained one arm chosen by topology and by nothing else, and
it calls the existing multi-output lifecycle with the existing cancellation
object. Ten documents are the item's *result*: one item, one process, one
`Finalized` row, and every count the queue reports stays a count of sources.

**A queue-internal name collision is not a destination conflict.** A set's
discovered names meet the queue's own claims at a gate the lifecycle asks
outward, after every member is validated and *before* the destination is
inspected. That ordering is the decision: a name an earlier item already
published is an ordinary file by the time the preflight looks, so the conflict
policy would answer for it — under `Skip` by calling somebody else's output this
acquisition's own already-converted result. It is now its own typed,
non-retryable outcome that publishes none of the set's members, bounded at
sixteen items × twenty-four documents = 384 names, over the repository's one
Windows folding helper.

**A partially finalized set is `Failed` and never retryable**, its prefix kept
as the user's files. Stop, Retry, quarantine and the diagnostics export are the
existing ones; one source stays one diagnostic item, a set's `outputFileName` is
`null` rather than fabricated, and the extra facts it carries are counts and
stable identifiers with no member basename anywhere.

**Two M3.14 evidence repairs came with it.** The test named for partial
finalization occupied a destination name *before* the run, which the whole-set
preflight refuses with nothing published — the opposite of a partial result. It
is renamed for what it measures, and a real `PartiallyFinalized` is now driven
through a publication seam. Output-set capacity is measured directly rather than
inherited from the shared registry's own tests.

**Real evidence.** The ten-sample Enolase acquisition through the private queue,
not the direct-conversion shortcut: one item, one launch, `fully_finalized`,
completeness `sample_count` 10, one ticket over ten members, ten `added`, eleven
workspace rows with the acquisition still one bundle row, no preview, path-free
renderings, and a repeat adoption reporting all ten as already present.

Eleven focused mutations, eight red. Three survivors are classified rather than
worked around, and one of them found a real defect while it was being
classified: a refusal or a stop cleared the single-output report but not the
group report, so a later attempt could have been described by the set attempt
before it. See
[ADR 0026](docs/architecture/adr/0026-private-sciex-serial-queue-integration.md)
and
[the M3.15 evidence record](docs/spikes/M3_SCIEX_PRIVATE_QUEUE_INTEGRATION_EVIDENCE.md).


## First visible SCIEX WIFF workflow, 2026-08-12

`Add files…` admits a SCIEX WIFF acquisition. Everything ADRs 0022–0026
measured is now measured about something a user can do.

**The extension routes; it never recognises.** A `.wiff` candidate goes to the
existing evidenced bundle admission and to nothing else — the container
structure, the derived companion name, the companion's own signature, both
leases and the order-and-count comparison are exactly where they were. A name
that proposed a family and failed it is a refusal rather than a second guess at
the family its bytes match. The picker offers `*.wiff` and deliberately not
`*.wiff.scan`: the companion is half an acquisition, never a row, and selecting
it alone says which file to select instead. The three companion refusals stopped
sharing one sentence, because two of them are fixable and collapsing them cost
the only actionable answer this boundary has for a bundle.

**The wire stopped assuming one named output per item.** `ItemOutputTopology`
left `#[cfg(test)]`, and what replaced the privacy claim is narrower: a row
reaches the set arm only by having been through its own evidenced family
admission and by that family declaring that its backend names its own outputs.
On the wire it is a discriminated union rather than a `String`, so the empty
string that used to stand for a set is unrepresentable rather than avoided — a
renderer must choose an arm to draw anything. The latest attempt's result is
discriminated the same way, so a group report and a single report cannot both be
present. Thermo and Shimadzu wire behaviour is unchanged in meaning, asserted by
the contract pin.

**One action, two cardinalities.** No second command, planner, worker or
adoption engine. A set authority is *expanded* into the member tickets it was
minted with, inside the existing engine, never rebuilt from a filename — and the
expansion refuses a ticket of another session. Every adoption outcome now names
an item **and** a member, and the offer became a count of output files: one
finalized Thermo item offers one, one finalized ten-member SCIEX acquisition
offers ten.

**The partial-finalization question is decided.** A partially finalized
acquisition is not eligible for complete output-set adoption, its prefix is kept
as the user's files, and the item says how many were finalized, how many were
not, that the files remain in the destination folder, and that they can be added
individually later. It is not labelled `Finalized`, is offered no retry, and must
never read as "Nothing was converted" — which is the sentence a zero offer
naturally produces and is false here.

**The walking surfaces did not move, and now say so under test.** A folder
holding both halves of a bundle discovers only the mzML; both halves dropped
directly stay unsupported; and neither module names this family at all. For a
bundle the gap is wider than for a single object: pairing a `.wiff` with
whatever sits beside it in a folder is a decision a traversal has no evidence to
make, and upstream's own test data contains a `.wiff.scan` whose primary is a
`.wiff2` in the same directory as two unrelated `.wiff` files.

**Real evidence.** The ten-sample Enolase acquisition through the
production-visible path — the picker's own routing, the visible planner, the
visible queue, the visible adoption. One row of 3,944,804 bytes (primary plus
companion), one item, `fully_finalized`, completeness `sample_count` 10, ten
`added`, eleven workspace rows with the acquisition still one bundle row, no
preview, path-free `Debug` and path-free serialized wire, and a repeat adoption
reporting all ten as already present. Both fixture digests and the executable's
were recomputed and matched exactly before use; everything was deleted after
measurement.

Twelve focused mutations, twelve red. One survived first — adding a member
basename to the diagnostics export — because the privacy test pinned the debug
renderings and left the export, which is the document that actually gets sent
somewhere, asserted only on the fields it happened to know about. It is now
asserted over the whole serialized document. See
[ADR 0027](docs/architecture/adr/0027-first-visible-sciex-wiff-workflow.md)
and
[the M3.16 evidence record](docs/spikes/M3_VISIBLE_SCIEX_WIFF_WORKFLOW_EVIDENCE.md).


## Figure renderer and semantic specification foundation, 2026-08-13

The renderer-selection gate the figure model has carried since it was written is
closed, against measured scenes rather than examples.

**Selected: one semantic contract, two renderers.** The screen keeps its
repository-owned TypeScript SVG, unchanged. Export is repository-owned Rust over
`FigureSpec`. They share semantics and not drawing code, which is the point
rather than a compromise. **No production dependency was added in either
language.**

**Two facts decided it, and neither was a timing.** The screen was already
enough: a 500,000-point spectrum renders to *one* `<path>` and 10-11 DOM
elements, the same as a 20,000-point one, because the component reduces to 900
columns and emits one path. A library would have replaced a working renderer
with a dependency. And export cannot be the screen: serializing the mounted DOM
was measured exporting **942 of 500,000 points — 0.19% — silently**, with the
application's class names, no colour of its own, no dimensions and no accessible
title.

**Observable Plot was installed, measured and removed.** Its simple output is
byte-deterministic, so the blanket claim against it would have been wrong; what
is true is narrower and worse. Clipped plots are not reproducible — clip ids come
from a module-level counter — and a visible-domain figure is exactly a clipped
plot. It emits no `<title>` or `<desc>`, needs jsdom to run headless, and costs
**+86.87 kB gzip, +99.2%** of the shipped JavaScript. The build reproduced the
baseline content hash after removal.

**The contract replaced a scaffold rather than revising a contract.**
`mscanvas-plot-spec` had no dependant anywhere in the workspace and no
serialized instance, so there was no version 1 to preserve. What replaced it
makes `Unreported` a third spectrum representation rather than a missing
boolean, keeps an unreported unit apart from a dimensionless one, states whether
a series is full source or a disclosed reduction, preserves negative intensity,
and refuses mismatched lengths, non-finite coordinates and unordered data at one
boundary — refuses rather than sorts, because sorting would decide the file
meant something else.

The renderer joins only established profile data. Joining centroid peaks would
draw intensity at m/z values nobody measured; joining unreported points would
assert the representation while drawing it.

**Nothing visible was added by M4.0.** PNG is planned for **M4.2** on `resvg`
(Apache-2.0 OR MIT, verified against crates.io) called from Rust, which avoids
the MPL-2.0 Node binding and sharp's LGPL prebuilts. It is still unadded.

Timings moved by up to 4.6x across four runs on one loaded laptop while the byte
counts stayed identical, which is why they did not choose the renderer. See
[ADR 0028](docs/architecture/adr/0028-figure-renderer-and-semantic-specification.md)
and
[the M4.0 evidence record](docs/spikes/M4_FIGURE_RENDERER_SELECTION_EVIDENCE.md).

### M4.1 — first visible spectrum figure and data export

The selected mzML spectrum can now be exported: `Export SVG…`, `Export CSV…` and
`Export TSV…` in the `Selected spectrum` panel, once a spectrum has loaded. A
spectrum that loaded with no peaks is exportable too, and produces an honest
empty figure.

**What the milestone is actually about is where the bytes come from.** The
webview receives at most `MAX_SPECTRUM_POINTS` of each array, because that
projection carries a drawing. The complete `SelectedSpectrumResult` stays in
Rust, in one session slot behind an `Arc`, and the webview receives an opaque
token naming it. An export command names a spectrum and never carries one, so a
file cannot silently become the transferred prefix — a defect that would have
appeared only on the large spectra a user most wants exported. A token from an
earlier selection is refused rather than rebound to whatever is loaded now.

The figure and the data document are siblings over that one source: one panel,
one measurement series, `DataScope::FullSource`, no visible domain, with
representation and units carried across as the `Unreported` states the backend
actually reports. Spectrum CSV/TSV schema v1 is a `#` metadata preamble, a
header row and one record per source point, with values that round-trip the
parsed `f64` bit for bit.

Rust owns the path throughout. Each action writes one file through a native
dialog that replaces nothing, publishing through a private sibling renamed by
handle; a dismissed dialog is an outcome rather than an error, and no path
crosses to React in either direction.

Both M4.1 entry blockers were closed first: a negative is called visibly below zero
only where it is drawn there, and a panel must declare at least one series.

**FIG-003** is implemented for the selected spectrum at full range. **FIG-004**
is partial — selected-spectrum CSV/TSV only, no chromatogram data export.
**FIG-001**, **FIG-002** and **FIG-006** through **FIG-008** remain
unimplemented, and **FIG-005** has no user-selectable theme. See
[ADR 0029](docs/architecture/adr/0029-first-visible-spectrum-figure-and-data-export.md).

### M4.2 — PNG, Copy plot and figure settings

The selected spectrum can now be exported as PNG and copied to the clipboard,
and the figure all three formats draw is a size and a theme the user chooses.

PNG is not a second renderer. It is the same `FigureSpec`, through the same
deterministic SVG, put on a pixel grid: `resvg` parses the document this
application already writes, and the encoder records the requested physical
resolution. `Copy plot` is that path stopped one step earlier, at the RGBA
buffer — a test asserts the copy's pixels and the PNG's decoded pixels are
byte-identical. Two renderers would be two answers to what the figure says.

Width and height are the final dimensions; a user who asks for 1200 × 640
receives 1200 × 640. DPI is physical-resolution metadata, written to `pHYs`, and
multiplies nothing — it reaches neither the SVG nor the data documents, and a
test pins that CSV and TSV come out byte-identical while the figure is drawn at
three different sizes, resolutions and themes. The defaults are the figure M4.1
shipped.

The raster formats carry their own budget of 32 megapixels, asked before
anything is allocated: a vector document can honestly describe a 20,000 × 20,000
figure and a raster one has to hold it at four bytes a pixel. DPI is closed at
72 and 1200.

Typography comes from the machine. A rasterizer that cannot resolve a font does
not fail — it draws everything except the words — so the question is asked before
rendering and answered with a typed refusal that points at SVG, which needs no
typeface because it keeps the text as text. No font is vendored and none is
fetched.

The clipboard is write-only. The pixels are built and handed over entirely in
Rust; the interface never receives an image, and no capability grants this
application the ability to read a clipboard.

The M4.1 snapshot-lifecycle debt is closed with it. Revocation is now Rust's
decision, taken at the event, over six paths — including one found while writing
the tests: choosing another file through the single-file picker empties the whole
workspace without going through the clear path. Every lifecycle test asserts two
separate things: that the old token is refused, and that a `Weak` fails to
upgrade. Only the second proves the arrays were released.

**FIG-001** is implemented as `Copy plot` from the scientific export renderer.
**FIG-002** is implemented for the full selected spectrum. **FIG-003** is
implemented and now configurable by size and theme. **FIG-004** is still partial
— selected-spectrum CSV/TSV only. **FIG-005** is implemented, Light and Dark.
**FIG-006** through **FIG-008** remain unimplemented, and there is no
current-range or chromatogram export. See
[ADR 0030](docs/architecture/adr/0030-png-copy-plot-and-figure-settings.md).

## Viewer Closure R1 — the visible linked TIC/BPC viewer, 2026-08-23

`VIEW-002`, `VIEW-005` and `VIEW-006` are implemented. The viewer column is
three linked panels: the run's shape over retention time, the scans it is made
of, and the one scan the user chose.

**R0 decided the semantics; this slice is the wiring.** Every rule that looks
like a decision here was taken in
[ADR 0032](docs/architecture/adr/0032-viewer-interaction-and-viewport-state.md)
as pure code with no React, no DOM and no timers — what a viewport is, when a
hover stops being true, who allocates a selection revision, which of two viewport
authorities wins, and where a visible value range comes from.
[ADR 0033](docs/architecture/adr/0033-visible-linked-tic-bpc-viewer.md) records
only the visible adapter over it.

**TIC and BPC are per-scan values projected from the loaded spectrum table.**
Each scan's own total ion current and base peak intensity, at its own retention
time. Not a stored chromatogram record, and the visible caption says so. **No
Rust production change, no new preview operation, no new backend query, no cache,
no dependency.** Nothing here claims the standalone `msaccess` TIC query
succeeded; ADR 0003's posture is unchanged. Retention time and intensity are
displayed as unreported, because nothing that crosses the boundary establishes
either.

**One selected scan, in one place.** The workspace's own `selectedIndex` is gone;
the reducer's selection is the authority and every reader is a projection of it.
Three surfaces commit through one operation, after every existing request guard,
and the reducer allocates the revision. A repeat still in flight allocates
neither a revision nor a second ProteoWizard process; the same scan committed
again after its read settled is a new commit that linked views may reveal for.
The existing per-request token still decides which backend reply may be shown —
two race mechanisms, two questions, deliberately not merged.

**A truncated preview draws no chromatogram at all.** A prefix drawn as a
chromatogram is a picture of a shorter experiment than the one that happened. The
scan table beside it stays usable and says that the end of its loaded rows is not
the end of the run.

### What the rendered evidence establishes

**Frontend suite: 830 tests**, up from 739. The clipped-extent regression is
reproduced at the visible component — a 9,000,000 peak at RT 9 outside a 10–13
viewport must not label the axis, and the interpolated height where the line
crosses the edge must, because it is on screen.

**Browser QA: 30 rendered cases** at 1366×768, 1920×1080 and 960×640, with real
hover, click, wheel, drag, keyboard and table interaction. Three are new and each
pins a finding at the layer that produced it: a wheel gesture losing to a
selection committed before its debounce fires, with the stale timer then allowed
to fire rather than cancelled; a hover dropped by the axis moving under it and
re-established by the next pointer frame, beside its companion showing a clamped
gesture keeps one; and reveal geometry measured against real rectangles rather
than through WebDriver's own `scrollIntoView`, which places a target at the
container's top edge and therefore under a sticky header. Zero newly introduced
console errors, warnings, unhandled rejections or uncaught exceptions.

**Scale QA at the measured representative 36,319 scans.** Observations on this
machine, not thresholds: 21 rendered table rows, 1 trace path, 1,921 drawn
vertices, 15 SVG nodes, about 0.6 s from activation to a drawn viewer and about
0.2 s from click to a selected row. Structure is what is asserted — the table
stays windowed, the trace stays one path with a bounded vertex count, a click
still resolves against every scan, and neither pointer motion nor any viewport
change asks the backend for anything.

**Real-Tauri QA: 5 cases** in WebView2 inside the real Rust process, with
`load_selected_spectrum` left real — the chromatogram drawn from the document's
own preview, both traces toggled, a click crossing the production IPC boundary
with the right index and settling into a typed outcome, `Previous scan` and
`Next scan` on the same transport, and the viewport moving without a single IPC
call.

**Live ProteoWizard evidence: NOT RUN.** No usable installation and no lawfully
acquired pinned mzML fixture were available in this environment, and the
representative 208 MiB acquisition was deliberately not downloaded for ceremony.
Nothing in this slice depends on one: the viewer's source is the spectrum table
the existing preview already transfers, and no backend command was added or
changed.

### Layout, measured rather than assumed

At 1366×768 and again at 960×640: the chromatogram floors at 186px (a 60px header
of two control groups and a 124px body — padding, the 52px the plot floors at,
the axis caption's two lines and the readout), the scan table at 122px (a 60px
header beside its two buttons, the 30px sticky column header and one complete
30px row), and the selected spectrum at 202px. With two 8px gaps that is 526px
against a column that measures 478px, so the viewer column owns a scrollbar and
scrolls by about 48px. That is the honest trade for a third linked view in a
shell that is exactly the window's height; giving each panel a share and letting
the shortest clip hides controls rather than moving them.

### The visible adapter, closed separately

The first delivery of this slice ran to a fourth review round. Its last finding
was that the viewport control group advertised `Zoom in` and `Zoom out` as
available where pressing them changed nothing: at full range — the state the
viewer opens in — and in both directions for a run whose scans share one
retention time. Beside them `Reset range` computed its own disabled state and
told the truth, which is what made the group inconsistent rather than merely
quiet.

That pull request was frozen at its reviewed head as evidence rather than patched
a fifth time, and **Viewer Closure R1.1** was branched directly from that exact
head so the whole slice arrives together rather than as a replayed history.

R1.1 replaces three separate availability answers with one rule: **a visible
viewport action is available exactly when applying it would change the effective
rendered domain.** Every boundary follows without being named. The comparison is
between rendered domains rather than between the arithmetic's own output, and
that distinction is load-bearing: canonical clamping recovers a low edge as
`full.high - span`, which rounds, so a run of 0.0125 to 453.9875 comes back as
0.012499999999988631 — a change by the naive comparison, and no change at all
once the reducer has committed it. Asking what the reducer would render removes
the question instead of approximating it, and needs no epsilon.

### The wheel, released at the boundary

R1.1's pull request was frozen at its reviewed head in turn, and **Viewer Closure
R1.2** was branched directly from that head. Its round-2 review found one real,
reachable problem of the same family a layer down: the chromatogram cancelled the
browser's default action for every non-zero wheel delta, including where
canonical arithmetic proves the viewport cannot move. Measured above, the viewer
column scrolls by about 48px at 1366×768 — so a reader at full range turning the
wheel over the plot to reach the scan table got no zoom, because there is none to
give, and no scroll either, because the event had already been claimed.

R1.2 makes ownership a consequence of the same rule the buttons follow:
**MSCanvas may claim a wheel event only when applying it through the canonical
interaction contract would change the effective rendered domain.** Both planners
now share one projection. A gesture is projected through its *settle* before the
comparison, because an unsettled gesture keeps the clamped range it holds while a
committed one is normalised, and it is exactly there that the 0.0125 run's
recovered low edge would have re-created the defect inside its own repair. Where
the viewer does not claim the notch it also dispatches nothing: an input it did
not consume leaves no gesture and no epoch behind.

The evidence stops where the harness does, and that is recorded rather than
glossed. `WheelEvent.defaultPrevented` is asserted in a real browser against the
built bundle at every boundary and every productive notch, and `.viewer-stack` is
measured to have somewhere to scroll to. That an uncancelled wheel then scrolls
it is the browser's own contract: a WebDriver-dispatched wheel is not a user
gesture and performs no native scroll, so no test here claims one did. Touch
scrolling over the plot remains statically suppressed by `touch-action: none`,
which is a declared intent rather than a per-event claim, and deciding what a
touch drag over a chromatogram means is product semantics this slice does not
open.

### The wheel, read rather than counted

R1.2's pull request was frozen at its reviewed head in turn, and **Viewer Closure
R1.3** was branched directly from it. Its whole-diff review found one real,
reachable problem in the same adapter, a layer beneath ownership: the wheel read
the sign of `deltaY` and nothing else, applying a fixed 0.85 step to every
non-zero event. `deltaMode` never reached the viewport at all, and -1, -20 and
-240 pixels produced the identical candidate range from the same state and
anchor.

The consequence is that zoom rate was a property of packetisation rather than of
the gesture. Measured on this branch before the repair: 57 events took the viewer
from the whole run to the narrowest viewport, whatever those events carried. A
device that reports one gesture as a stream of small deltas therefore compounded
0.85 per event and reached maximum zoom almost immediately, while a device
reporting the same travel as a few large deltas barely moved.

R1.3 normalizes the event before using it — `deltaY` scaled by a coefficient for
its `deltaMode`, then an exponential map — so that the factor of a sum is the
product of the factors, and cutting one gesture into more events cannot change
where it lands. Eighty one-pixel events now ask for 2^-0.16 of the span rather
than 0.85^80 of it. An unknown `deltaMode` fails open rather than being read as
pixels, and `ctrlKey` is given no meaning: inferring a trackpad pinch from a
modifier is a guess about hardware, and pinch semantics belong with the touch
work already deferred to M5.

What is not claimed is device parity. That would need a physical mouse and a
physical precision touchpad measured on real hardware, and no such measurement
was made here: the input shapes in the tests are deterministic synthetic streams,
recorded as shapes rather than as hardware.

## M4.3 — chromatogram export and range scope, 2026-08-24

The visible viewer draws a chromatogram from the spectrum table it was given.
M4.3 makes that run exportable as a scientific document without letting the
drawing become the authority.

**Where the numbers come from.** The complete per-scan facts Rust retained when
the preview was read, shared by handle rather than copied. Not the rows the
webview received, which are a bounded prefix; not the clipped or reduced
polyline; not an SVG path. Nothing rereads the file and nothing launches a
backend process, and no `PreviewOperation::Tic` exists to issue.

**A truncated viewer has no chromatogram export.** Rust holds more rows than the
webview receives, and that is precisely why the export eligibility is the
visible model's rather than "whatever Rust happens to have": complete,
non-empty, finite retention times and intensities, and a unit posture this build
can name.

**Full run or current range.** Full needs no range from the interface at all.
Current carries the viewer's committed domain and nothing else -- not the range
a wheel or a drag is transiently showing -- and a viewer that has committed
nothing has no narrower range, which resolves to the whole run while staying a
current-range export. A range outside the run is refused rather than clamped.

**Figure and data are siblings.** Both are built from one snapshot and one
resolved range, and neither is read from the other. A data document contains
scans, edges included, in retention-time-then-table-position order, always with
both measured columns; a figure carries the complete source series and declares
a window, so it can draw a segment crossing a range that holds no scans at all.
A range with no scans is a successful export of no records.

**Two contract extensions the figure needed.** A panel may now declare a visible
value domain -- the range actually displayed, which does not claim the values
outside it do not exist -- so a nine-million peak at another retention time
cannot flatten the window a reader asked for. And a second measured series has
its own role, `secondary_measurement`, drawn dashed as well as in its own
colour, because a total ion current and a base peak intensity are two
measurements rather than a measurement and a baseline. `plot-spec`'s schema
version is 2 accordingly: every wire shape is `deny_unknown_fields`, so a
version 1 reader genuinely cannot decode what this build writes.

**One scientific export lane** now serves both surfaces, so two save dialogs
cannot be open at once and a clipboard rasterization cannot race a file write.
Because the lane is one, the interface says so once: a single derived
`scientificExportBusy` projection closes both panels' figure, data and copy
controls while either surface owns the lane, rather than leaving the other
visibly live to reach Rust and come back refused. Availability is all that is
shared -- each surface keeps its own result, status message and token binding,
and neither panel is hidden while the other runs.

**A data document has no figure settings.** CSV and TSV are not drawn, so
width, height, theme, PNG DPI and the raster budget are never validation inputs
to a chromatogram data export -- the format is read first, and a reservation for
a data document carries no `FigureRenderSettings` at all. The panel already left
those actions available when a figure setting was unusable, correctly, because
none of them reaches a list of numbers; Rust now means the same thing. The
figure formats keep every check they had, in the order they had it.

**Which preview open owns the chromatogram** is a separate question from which
read may commit facts for a dataset, and it now has its own answer. The
per-dataset request epoch cannot order two opens of two *different* files --
each is the newest request for its own dataset -- so every preview open takes a
session-global ticket at its beginning, which revokes the previous chromatogram
at that moment rather than when the new read returns. The ownership test and the
snapshot installation happen in one critical section of the export slot, so a
completion the session has passed can neither install nor revoke, and a newer
open that fails leaves no chromatogram rather than resurrecting the old one --
exactly what the webview does with the preview itself. An export already claimed
still finishes from the snapshot it began on.

The ticket is taken at **intent** rather than at success: after Rust has proved
the request names an existing, previewable mzML row, and before anything that
can refuse for a reason of the moment -- a backend that stopped being trusted, a
conversion that took the slot. The webview has already replaced what was on
screen by then and shows a refusal rather than restoring it, so a read refused
at those gates must still revoke, or Rust would go on naming a run nothing is
showing. A malformed handle, an unknown dataset and a vendor row revoke nothing:
none of them is a preview attempt.

### Still not implemented

The linked chromatogram + selected-spectrum two-panel figure, current-range
export of a *selected spectrum*, XIC, spectrum zoom and pan, multi-layer
comparison, a saved `FigureSpec`, a figure composer, vendor-format direct
preview and a preview cache.

Not on this list any more, because this milestone is what built them: the
chromatogram's SVG, PNG, `Copy plot`, CSV and TSV, over the full run or the
current range. `ViewerInteractionState.committedDomain` is no longer an
authority waiting for a consumer -- the chromatogram's current-range export
consumes it.

## M4.4 — the linked two-panel figure, 2026-08-26

The run on screen and the scan selected in it are now one exportable document:
two ordered panels, the chromatogram above marked at that scan, and the scan's
complete spectrum below. SVG, PNG and `Copy plot`. **FIG-006 is implemented**,
and M4 is complete.

**No third source, and no third token.** Both halves were already separately
exportable. What this slice decides is what it means to say they describe the
same thing, and the answer is an *operation* rather than an identity: a pair
bound when the export begins, never rebound, alive exactly as long as that
operation is. A separately installed linked identity would have been a fourth
thing to keep in step with three others, and would have answered the question
when it was installed rather than when the figure is drawn.

**One acquisition, one moment.** Both tokens are read, ownership proved, the
exact row found, the range resolved, containment checked, visibility checked and
the height checked — all under the one `&mut` the caller holds. Reading one
token, letting go, and reading the other would let the pair describe two
different instants, which is the one thing this figure claims it does not do. No
test can catch that: it needs an install to land inside a window of a few
instructions, so anything claiming to catch it would be claiming scheduling luck.
What closes it is the shape of the API, and `check_repo.py` now pins that shape —
the two single-source readers are private to the module, the paired bind is
private and has exactly two callers, and `LinkedPair` is constructed once.

**Same dataset is necessary and not sufficient.** The selected spectrum has to be
a scan of *this* retained table, reconciled by identity at its index rather than
found by position alone. A table whose reported indices are not a gapless
ascending run puts a different scan at every position after a gap, and nothing in
the format promises they are — so a lookup that stopped at "is there a row here"
would draw a marker at a scan nobody selected.

**Retention time is a coordinate, not an identity.** Scans may share one. A
lookup by time in a run with two scans at 20.4 would find the first, and no
assertion about the marker's *position* could notice, because both are at the
same position. So the pair is found by identity, the marker is placed at the
matched row's own number, and the figure's words name the marked scan by its
index. Nothing the interface holds can move that marker: the payload crossing
`invoke` carries no retention time at all, and that payload is now pinned at the
adapter that produces it.

**A selected scan outside the range is a refusal.** Selecting a scan and then
panning away from it is an ordinary thing to do. Widening the range back, moving
the viewer, or settling a gesture to make the export work would each export
something other than what was asked for. Edges count as inside and there is no
epsilon. The interface says so before a dialog could open, and names both fixes —
choose Full run, or bring the scan back into the range — but that sentence is
guidance: Rust decides it again against the retained row.

**The lower panel is always the whole spectrum.** A chromatogram range is a
statement about where a scan sits in a run, not about which of its peaks are
real. Narrowing the spectrum to it would answer a question nobody asked by
discarding data nobody asked to lose.

**No contract change.** The renderer has carried a `Vec<PanelSpec>` since ADR
0028 and this is its first two-panel use; `plot_spec::SCHEMA_VERSION` stays 2. The
two-panel minimum height is the contract's own arithmetic — the chrome a figure
always needs plus one panel's minimum for each panel it holds, which is 260 —
asked at the export boundary so a figure that could not be built never opens a
dialog. The one-panel floor of 180 is untouched, and both single-source exports
still begin at 259.

**One lane, three surfaces.** `ClaimedExport::LinkedFigure` joins the two existing
variants rather than adding a lane. Each save command names the kind it is for and
checks that kind *before* the lane is marked claimed — marking it on the way to
refusing would leave the lane committed with no dialog, no writer and nothing to
cancel it, and every later scientific export of the session refused until the
application was restarted. All nine reservation/claim combinations are pinned.

**Availability is shared; results are not.** A running linked operation is bound
to both tokens, and replacing either makes `namesVisiblePair` false: the lane
stays held because Rust is still writing, the running label stops claiming this
pair is the one being written, and the landed answer is discarded rather than
published beside a pair it is not about. That holds for a success, a cancellation
and a failure alike — and a failure carries the part of the answer a user has to
act on, which is exactly what must not appear beside the wrong pair.

**No combined table.** A linked data document would have to interleave one record
per scan with one record per point under one header, or drop the link to avoid
it. Neither is a file that says what it is, so the linked surface offers drawings
only and the two single-source exports keep their own data documents.

### What the rendered evidence establishes

**Rust: 1,262 tests**, up from 1,220. **Frontend: 1,051 tests**, up from 1,007.
**Browser QA: 126 cases** across all six spec files at 1366×768, 960×640 and
1920×1080 — every one of the eight export actions inside everything that clips,
inside the viewport, and the thing `elementFromPoint` hands a click to; a real
click dispatching the operation it names; the three views in their own bands; the
plot still reachable and still operable; no console error, warning, unhandled
rejection or uncaught exception. **Real-Tauri QA: 12 cases**, eleven executed and one skipped.
**Fifteen mutations**, applied one at a time and restored byte-for-byte.

The sharpest of the rendered claims is one arithmetic coincidence: the document
is given a preview of six rows running to 0.0625 and no retention time for the
scan it selects, while Rust's seeded run begins at 0.10 — so the range that is
accepted and the range that is refused differ exactly at 0.10, a number this side
does not hold and never sent.

**Zero delta.** The single-panel SVG documents are pinned as bytes in
`fixtures/plot-golden`, generated on canonical main before `spectrum_panel` and
`chromatogram_panel` were factored out and byte-identical after it.

### Layout, measured rather than assumed

The linked section shows one sentence at a time — the reason while it cannot be
used, the description once it can. A reader who cannot act needs the first; a
reader who can needs the second, and neither is served by being shown the other's
underneath their own.

The measurement is the height the open export surface gains, taken in the state
where the three actions are live:

| | 1366×768 | 960×640 | 1920×1080 |
| --- | ---: | ---: | ---: |
| one sentence | 116px | 116px | 96px |
| two stacked paragraphs | 163px | 163px | 122px |

Below 1920 the description wraps to a second line, which is why the two narrower
viewports cost the same and the widest costs less. At 1366×768 the viewer column
is 614px and the surface starts at 189px, so the difference decides whether the
plot's top edge is still inside the column with the surface open.

Either way the surface leaves the plot below its panel's own fold, which is the
trade M4.3 measured and accepted when the surface got its own scroll owner. That
is asserted rather than assumed: at all three viewports the plot is revealed by
the product's own scroll owner, hit-testable at the centre of the part actually
painted, and still zooms on a real wheel over it.

### Two things the measuring turned up

**A drag that was never a drag.** M4.3's `does not export the range a gesture is
still holding` computed a pointer position from the plot's *layout* box. The
export surface pushes the plot below its panel's fold and the panel clips, so
measured at 1366×768 on the M4.3 surface that point landed on a `<span>` of the
panel below: the gesture never started and every assertion held vacuously. It now
reveals the plot through the product's own scroll owner first, asserts the
transient caption differs from the committed one, and skips the automatic pointer
release so "has not been released" is a fact rather than a race against a 120ms
debounce.

**A seed whose halves were different scans.** The rendered seed's table numbered
its scans from one while its spectrum called itself nineteen. Both halves worked
perfectly alone and nothing had ever asked them to be one scan, so no linked
figure could have been made from the seeded session at all. The table's first row
is now the spectrum's own row, and the seed asserts the two reconcile before
either is installed.

### Not run, and why

**The native save dialog.** It does not appear inside the automated WebView2
session on this machine, and all five pre-existing M4.2 native cases fail there
in the same way. Product code was not changed to automate it. What it would show
is proved at the Rust boundary instead: the dialog's own facts, a path-free
suggested name, an SVG refused under `.png` and a PNG under `.svg`, `.PNG`
accepted, a name already taken refused with the existing file untouched, and no
residue left by any refusal.

**`Copy plot`'s finished outcome on the real WebView.** This Windows session's
clipboard cannot be opened by any process, so the case skips loudly and prints
why. The clipboard path itself is exercised in Rust.

**Different owners, and a row that does not reconcile, on the real WebView.** The
seeded session holds one dataset and one spectrum; reaching a second of either
needs a real ProteoWizard installation. Both are proved at the Rust boundary,
through the whole service.

**Live ProteoWizard evidence: NOT RUN.**

### Still not implemented

A saved `FigureSpec`, a figure composer, current-range export of a *selected
spectrum*, XIC, spectrum zoom and pan, multi-layer comparison, vendor-format
direct preview and a preview cache.

Not on this list any more, because this milestone is what built it: the linked
two-panel figure of the chromatogram and the selected scan, as SVG, PNG and
`Copy plot`, over the full run or the current range. See
[ADR 0036](docs/architecture/adr/0036-linked-chromatogram-spectrum-figure.md).

## M5.0 — Viewer Completion route lock, 2026-08-27

Documentation only. No Rust behaviour, no React behaviour, no backend operation,
no reducer, no export, no dependency and no lockfile changed with this slice.

M4 closed at `b77e5e8` with the linked two-panel figure. The sequence that
followed it in `ROADMAP.md` was written before the viewer existed and sent the
project from figure export straight to public-beta hardening and then to an
artifact model — hardening and persisting a scientific viewing workflow that was
still missing several of its own capabilities. This slice replaces that sequence
with the product priority, and fixes the exact route for M5. See
[ADR 0037](docs/architecture/adr/0037-viewer-completion-route.md).

**M5 Viewer Completion, M6 Conversion Completion, M7 UI/UX and public product
hardening, M8 artifact/run/QC foundation, M9 first analysis recipes, M10
automation.** M0 to M4 are unchanged in meaning and stay closed. The former M5
to M8 had not started; their content moves rather than being discarded.

### The audit was taken from the implementation, not the roadmap

Nine known gaps, each classified from what the code does.

| Gap | Classification | The evidence |
| --- | --- | --- |
| Spectrum zoom/pan/reset | **M5**, where a domain is admissible | `StickSpectrum.tsx` is a pure function of the transferred arrays and holds no state; `ViewerInteractionState` carries exactly one domain, and it is a `RetentionTimeDomain`. There is no m/z viewport anywhere. Required does not mean universal: `SeriesSpec::new` answers a non-ascending m/z array with `SpecError::SourceNotOrdered`, which mzML permits and nothing here sorts, so that spectrum gets an explicit refusal rather than an invented domain. |
| Selected-spectrum current-range export | **M5**, after the viewport and only where one exists | `spectrum_panel` builds one series at `DataScope::FullSource` and never calls `with_visible_domain`; `RangeRequest` exists for the chromatogram alone. A range chooser on that surface has nothing to refer to until a committed m/z viewport exists — and for a spectrum with no admissible domain there is no `Current` scope at all, while its full-source CSV and TSV are unchanged. |
| XIC (VIEW-007) | **M5**, behind an evidence gate with two valid outcomes | `PreviewOperation::Tic` exists, is capability-gated and is parsed — and is never issued. Its required signature already declares `mz=<mzLow>[,<mzHigh>]`, and the M0 spike recorded a `sic` query in the installed help. Neither has ever been run as an XIC, and `sic` has no signature, parser or measurement here at all. |
| XIC linked selection | **M5** where XIC is admitted, with no new authority | One `Selection` with one monotonic revision, consumed through `consumeSelection`. `TicPoint` already carries a `SpectrumIdentity`, so an XIC point names a scan through the existing commit path. |
| Selection-availability affordance | **M5** | `spectrumSelectionAvailable` reaches `canSelectPreviousScan` and `canSelectNextScan` and nothing else; `PreviewWorkspace.tsx` passes a bare `onSelect` to both the plot and the table. M5 adds more selectable surfaces, so the rule is settled before the set grows. |
| Multi-layer comparison (VIEW-008) | **Deferred — M8 then M9** | The application holds one preview by contract, in both layers: the frontend `PreviewState` holds one `Preview`, and Rust's open ticket states there is only one chromatogram the user is looking at and only one that may be exported. `FigureSpec` has style roles for quantities and no identity for a source. Two runs' intensities need a normalization this product has not admitted. A selected scan *of a layer* is a wider type than the one every linked view consumes. |
| Touch gestures | **Deferred — M7** | `.chromatogram-svg { touch-action: none }` is static rather than a per-event claim. Not required for any M5 capability's correctness: every M5 control is reachable by pointer and by keyboard. |
| Bounded preview cache | **Deferred — M7, and only on a measurement** | There is none, recorded as a position rather than an omission. The M0 spike measured 24 deterministic indices over three passes on a 36,319-spectrum file at p50 `164 ms`, p95 `186`–`194 ms`, max `199 ms`, with no degradation by index position or repetition. Nothing in M5 argues for one: a spectrum viewport reads nothing, and an XIC is one backend operation per XIC rather than one per scan. |
| Vendor direct preview | **Deferred — M6, behind its own evidence slice** | `open_preview` refuses a non-previewable row with `dataset_not_previewable()`. Conversion support is not direct-preview support: the conversion evidence proves `msconvert` writes a correct mzML and says nothing about whether `msaccess` can answer preview queries against a vendor acquisition. |

### What the route refuses to invent

**A pseudo-XIC.** `SpectrumRow` carries a base peak m/z, a base peak intensity,
a total ion current and a precursor m/z per scan — enough to *look* like an XIC
and not one. Selecting the scans whose base peak falls in a window, at their
base peak intensity, returns zero for every scan that carries signal in the
window under a taller peak elsewhere, which is where an analyst is most often
looking. An XIC needs intensity as a function of m/z inside each scan, and no
per-scan summary is that. The only route short of a new operation is the
`binary` query: this repository's typed `SpectrumByIndex` asks for one index, so
that is 36,319 backend processes for the measured representative acquisition,
and the range form the backend's grammar declares — never issued or measured
here — refuses itself on size, because one operation's output is bounded at 8 MiB
and refused whole above it while a run's complete binary at the requested
precision is orders of magnitude past that. **M5.4 is a dedicated evidence slice**, and it has an explicit
refusal path rather than an assumed outcome. On `XIC_SOURCE_ADMITTED` M5.5 and
M5.6 run and M5 exits with a visible XIC inside the one linked selection. On
`XIC_SOURCE_REFUSED` they are `NOT_APPLICABLE`, M5.7 runs against the existing
surfaces, the refusal and its measurement are recorded, VIEW-007 is reassigned to
a named owner and re-entry gate, and the milestone still closes. In that outcome
**`M5 COMPLETE` does not mean XIC exists.** What may not happen under either
outcome is XIC shipping from a source the evidence did not establish.

**A second scan-selection authority.** An XIC's x axis is retention time, over
the same run, so it consumes `ViewerInteractionState` rather than owning a
second one.

**A current-range scope with nothing behind it.** The selected-spectrum range
export comes after the viewport, not beside it — and only where a viewport exists.

**A prefix presented as the whole source.** `MAX_SPECTRUM_POINTS` bounds one
transfer, so a large spectrum reaches the webview as a prefix marked `truncated`.
A viewport whose domain spans the complete source while its data stops at that
prefix would pan into blank space over peaks Rust is holding and the export
writes. **A bound on transfer is not permission to present a prefix as the whole
source.** So M5.1 owns a bounded, viewport-scoped **screen projection** of the
complete retained snapshot: reset draws a bounded overview of the whole admitted
domain, zooming re-projects the source rather than re-zooming the overview, and a
viewport change asks Rust to project a snapshot it already holds rather than
re-reading the acquisition or launching ProteoWizard. The projection is a
drawing — it may reduce, it selects real observations, it invents nothing, and
**scientific export never derives from it.**

**A viewport bought by sorting the measurement.** mzML does not require an ordered
m/z array and nothing here sorts one: `SeriesSpec::new` refuses a non-ascending
`x` as `SpecError::SourceNotOrdered`, `Domain::new` refuses the inverted pair its
first and last would make, and the existing figure refusal is already recorded in
`preview/dto.rs` with CSV/TSV named as the route out. **A valid scientific source
need not be renderable.** Where the contract cannot admit a domain without
changing the source, M5 refuses the viewport and the `Current` scope rather than
reordering, min/maxing or interpolating the measurement to manufacture one. Valid
source data, figure admissibility, viewport-domain admissibility, full-source
export and current-range export are five different questions, and M5 answers them
separately.

**A chromatogram's clipping rule on a stick spectrum.** M4.3's boundary segment
belongs to a polyline. `crates/plot-spec/src/svg.rs` filters discrete marks
instead, and says why — *inventing one at the boundary would draw intensity at an
m/z nobody measured* — so for the `Unreported` representation this product
actually receives, a window holding no reported peak is a figure and a data
document that are **both** empty. Only a representation authoritatively
established as continuous profile samples could admit an interpolated boundary,
and M5.3 must not require one universally.

**An XIC export.** M5 builds the visible trace and no artifact: no XIC SVG, PNG,
CSV or TSV, and no claim that one exists. Every adopted XIC decision is carried
by the visible trace contract instead. A reusable XIC export belongs to M9.

**A viewport whose domain the export source does not have.** The screen and the
export renderer disagree about a spectrum's m/z domain on purpose today —
`StickSpectrum` widens the drawn domain to cover the reported `mzLow`/`mzHigh`
*and* the transferred points, while `domain_of` takes the first and last of a
series the figure contract has **already admitted as ordered**, and documents why
it refuses the reported pair. A viewport over the wider one could commit a range
Rust then refuses as `OutsideSource`, which is the defect class `clampDomain`'s
own comment records for retention time. ADR 0037 fixes the constraint rather than
leaving it to the slice — and states what happens where no series is admitted at
all, which is the paragraph above.

### Five product decisions, surfaced instead of guessed

Recorded as `USER_DECISION_REQUIRED` in ADR 0037, each with its options, its
consequences and a recommended default where the evidence supports one: how the
reader expresses the m/z window and in what unit; which MS levels an XIC covers;
what is aggregated inside the window; which backend query is the source; and
where the XIC is drawn and against which value axis. An adopted answer is carried
by the **visible trace contract** — M5 writes no XIC document for it to appear
in.

The unit question is the sharpest of them. The backend takes an **absolute**
window, and this product reports no unit for a spectrum's values at all —
`SelectedSpectrumResult.value_units` is `UnitState::NotEmitted` and the panel
renders "Value units: Not reported" — so a ppm tolerance would be a conversion
MSCanvas performs, against values whose unit the file never reported.

### UI/UX principles frozen, and nothing redesigned

Eight principles are frozen in ADR 0037 so the controls M5 adds do not grow
inconsistently before M7 consolidates them: action hierarchy, disabled and
unavailable posture, loading/busy/result posture, viewer panel ownership,
keyboard equivalence, accessible naming and live-region rules, the responsive
evidence targets 1920×1080 / 1366×768 / 960×640, and the accepted scroll
ownership. Nothing is restyled, no design-system dependency is introduced, the
component architecture is untouched, and the workspace and conversion surfaces
are not entered.

### Carried forward from M4, truthfully

M4 is complete and is not reopened. Its environment residuals stand as recorded:
the native save dialog is not automated inside the automated WebView2 session on
this machine and its boundary rules are proved in Rust instead; `Copy plot`'s
finished outcome is not proved on the real WebView because this Windows
session's clipboard cannot be opened by any process; different-owner and
non-reconciling-row linked cases are proved at the Rust boundary only; and
**live ProteoWizard evidence was NOT RUN for M4.4**.

The last of those is the one M5 must act on rather than merely record. **M5.4
requires a live measured run**, so an M5 executing on a machine with no real
ProteoWizard installation cannot reach an `XIC_SOURCE_ADMITTED` outcome at all,
and must stop at that slice rather than substitute a fixture for a measurement or
record a refusal it did not measure.

### Four M4.4 confirmation findings, inherited rather than closed

M4.4's final confirmation review recorded four findings. They did not block M4
completion, **none has been repaired**, and each is carried here as explicit
debt. This slice changes no production code and repairs none of them; what it
does is give each an owning M5 slice. All four were re-confirmed against
`b77e5e8` while the route was written.

| # | Finding | Owner |
| --- | --- | --- |
| P3-1 | `_validate_linked_pair_has_one_constructor` asks `functions_naming` which functions call `LinkedPair::new`, and that helper recognises a definition only at exactly four spaces of indentation. `mod linked_pair` is at column zero, so its methods sit at eight — a wrapper added inside the module would not be seen as its own function. **No current production bypass**: the private fields still make a struct literal a compile error elsewhere, `LinkedPair::new` is still `pub(super)`, and the cross-file direct-reader rules are unchanged. The debt is a repository rule weaker than it reads. | **M5.3 — closed**, with mutation evidence: see the M5.3 section below |
| P3-2 | The first comment above the linked section in `ChromatogramExportPanel.tsx` still describes the `42ba0a2`-era single-element live region. `8efdd59` replaced that shape with two elements, which the comment immediately below describes correctly; the two now disagree about the code they sit on. | **M5.7** |
| P3-3 | When the linked section cannot be used, the refusal sentence is in the accessibility tree twice — once as the visible paragraph the three buttons point `aria-describedby` at, once as the hidden `aria-live` region's content. `visually-hidden` removes an element from the page, not from the tree. **This is not the announcement defect `42ba0a2` and `8efdd59` closed, and must not be described as fixed.** | **M5.7** |
| P3-4 | In `usePreviewWorkspace.ts` the block documenting `scientificExportBusy` is separated from it by the `useState<LinkedFigureExportState>` declaration M4.4 introduced. Third instance of one insertion mistake: `42ba0a2` moved two stranded comments, `8efdd59` corrected one of those moves, and neither found this. | **M5.3 — closed** |

None of the four is a reason to reopen M4.

### One factual correction

M4.4's frontend test count is **1,051**, measured on `b77e5e8` — 43 files, 1,051
tests. The M4.4 section above and ADR 0036 said 1,050, which was the count before
the closure round `8efdd59` added one, and both are corrected in place. Rust is
1,262, which was already right. Nothing else about M4.4's evidence changes and no
milestone claim moves.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`
(1,262 passing), `python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`,
`pnpm test` (1,051 passing), `pnpm build` and `git diff --check`. The product
baseline is unchanged because no product code was touched.

## M5.1 — the spectrum viewport authority and screen-projection foundation, 2026-08-28

The first production slice of Viewer Completion, and deliberately invisible. No
zoom, pan or reset control, no wheel or drag, no loading or error surface: M5.1
proves the state machine and the source boundary M5.2 will stand on. See
[ADR 0038](docs/architecture/adr/0038-spectrum-viewport-authority-and-screen-projection.md).

### Two questions Rust answers, and the webview does not

**Does this spectrum have a viewport?** It needs an authoritative finite forward
m/z domain, and the figure contract cannot always establish one — mzML does not
require an ordered m/z array and nothing here sorts one.

**What does one window look like?** The complete spectrum Rust retains is the
scientific source, and `MAX_SPECTRUM_POINTS` bounds what one transfer carries, so
a viewport spanning the whole source while its data stopped at that prefix would
draw blank space over peaks this session is holding.

Neither is answerable in the webview: the arrays arrive bounded, and
`mzLow`/`mzHigh` are the separately reported pair `domain_of` documents its
refusal of. Both answers come from Rust, over the snapshot the export lane
already retains.

### One admissibility rule, shared rather than reimplemented

`SeriesSpec::new`'s coordinate validation is factored into
`validate_measurement_coordinates`, which the constructor itself calls and the
viewport calls on borrowed slices — same rules, same order, same errors, no copy
of the spectrum to ask the question. So the domain a viewport navigates *is* the
domain the figure draws over, and a second more permissive reader does not exist
to drift from it.

**A refusal is about drawability, never about the source.** An unordered
spectrum stays selected, is drawn by the panel as before, and still exports as
CSV and TSV. Nothing is sorted, reordered, normalised or interpolated.

### One identity, two readers

The viewport resolves the **same** retained-spectrum token the export lane does:
no second cache, no second scientific source, no second lifetime. Staleness and
revocation come free from `spectrum_for`. `SpectrumExportToken` is renamed
`RetainedSpectrumToken` to say what it identifies rather than which consumer came
first; the wire field stays `exportToken`, because what it names has not changed.
A projection takes **no export lane** — a reader may pan while a file is written.

### The bounded projection

`retained snapshot → committed window → bounded projection → React`. A window
outside the source is **refused rather than clamped**. Under
`MAX_PROJECTION_POINTS` the drawing is exact; over it, a deterministic reduction
keeps each column's greatest non-negative and deepest negative **measured**
observation at the m/z the source measured it — `StickSpectrum`'s posture, both
signs, no invented value. The bound is 900 columns × 2 = **1,800 points**, named
rather than implied, and `MAX_SPECTRUM_POINTS` is **not** raised to avoid it.

**Empty is success**; **partial is refused** — a bounded reduction is complete
screen coverage, so a projection is a complete drawing, an explicit empty one, or
a typed failure.

### The screen is never the science

There is no `screen projection → export` path: `ScreenProjection` exists only as
the return of `project_spectrum` and no document writer sees it. Committing a
viewport leaves a full-source export byte-for-byte identical, and that is tested
rather than asserted.

### A different spectrum is a different viewport context

The pure model is separate from `ViewerInteractionState`, and `MzDomain` is
nominally distinct from `RetentionTimeDomain` so the substitution does not
compile. A committed selection change starts a new context: the previous
absolute window is not preserved, not intersected, not clamped in. Redelivery of
the same token resets nothing. A stale success **and** a stale failure are both
no-ops by identity, so correctness never rests on a callback being cancelled in
time.

### What the evidence establishes

**Rust: 1,293 tests**, up from 1,262. **Frontend: 1,087 tests**, up from 1,051.

**One measured finding, recorded rather than assumed.** `MAX_SPECTRUM_POINTS`
truncation is **not reachable through the text parser** — one formatted point is
about twenty-five bytes, so `MAX_PREVIEW_TEXT_BYTES` refuses a spectrum that
large first. The retained-source property is proved over spectra built directly,
and a service test pins the reachability so a later reader need not rediscover
it.

**Seven mutations**, applied one at a time and restored byte-for-byte: the
frontend prefix used as the source domain; an outside-source window clamped
rather than refused; a reduction emitting a value the source did not measure; an
unordered spectrum admitted anyway; a stale token answered; a selection change
inheriting the previous window; and a stale projection answer accepted. Each
failed the check aimed at it.

### Not built, and by design

Every visible control, the loading and error surfaces, and the gesture adapters
are M5.2. The `Current`-range export that will consume the committed window is
M5.3. The four inherited M4.4 P3s remain unresolved, owned by M5.3 and M5.7.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build` and `git diff --check`, each run directly and each exiting zero.

## M5.2 — the visible spectrum viewport, 2026-08-28

M5.1's viewport made reachable, and nothing more. Wheel, drag, keyboard and
three buttons over the selected-spectrum panel; every asynchronous state the
projection can be in, said in words that tell it from every other one; and an
honest absence where the figure contract cannot give a spectrum an m/z domain.
See [ADR 0039](docs/architecture/adr/0039-visible-spectrum-viewport-adapter.md).

**No Rust file changed and no command was added.** M5.1's published boundary was
sufficient, which is the outcome a published boundary is supposed to have.

### The reducer is the session's, not the panel's

ADR 0038's gesture epoch and projection generation are monotonic across the
session, never per spectrum, because their whole job is to tell a late answer
about the spectrum just replaced from a current one about the spectrum now
selected. A reducer created when a component mounts restarts them when that
component mounts -- and this panel unmounts its plot on every selection, since a
spectrum load passes through `loading`. So the instance lives in
`usePreviewWorkspace`, beside the one `ViewerInteractionState`.

The cost is stated rather than hidden: the selected-spectrum panel now
re-renders per frame during a drag over its own plot, where before no
interaction state reached it at all. The memo still keeps the chromatogram's
hover out, which is what it was for.

### `idle` is the whole request rule

There is no list of places that must remember to ask Rust for a drawing. `idle`
is the contract's own word for *this viewport has a window and no drawing that
answers it*, and exactly the transitions that change the committed window leave
it there. One effect asks whenever the state is `ready` and the projection is
`idle`. A gesture leaves the projection alone, so a drag asks for nothing until
it settles. Retry is the same call with a new generation.

### The drawing is never ahead of the axes

A committed window whose drawing has not arrived draws its axes and **no
points**, and says so. The alternative -- swapping the plot for a placeholder --
takes the focusable element out of the document mid-interaction and leaves the
wheel listener bound to a node no longer in it. Four drawing states are named in
the type rather than inferred, so a caption cannot claim something the picture
does not support.

### One rule for every input

ADR 0033's R1.2 wheel rule is applied unchanged, and now governs keys as well: a
viewport key is claimed only where the transition it names was productive, so at
a boundary it falls through to the panel that scrolls. `touch-action: pan-y`
rather than `none`, because this panel is a scroll container inside another one
and taking every touch would remove the only way to reach the rest of it; a
vertical drag arrives as a pointer cancel, which the contract already abandons.

### A real defect found, in this slice's own arithmetic

**Zooming out at full range does not always land back on the full range.** The
zoom holds an anchor and scales both edges away from it, and recovering the
edges of a range from its centre does not round back to where it started: for a
spectrum of m/z 110.3 to 500 it produces a low of 110.30000000000001, whose span
is smaller than the source's by one part in ten thousand million million.
`isFullMzDomain` compares edges, so the reducer commits that as a *subrange* --
leaving `Zoom out` still offering to do it again and the wheel still claimed for
it. Measured over 121 plausible m/z domains: **nine at the centre anchor a button
uses, and twenty-one -- about one in six -- at some anchor a wheel can land on.**

Projecting the gesture through its settle, which is what the retention-time
planner does, turns out to change no verdict at all -- `committedForm` answers
`null` only where the window already equals the source by value, which is where
the unsettled comparison already said unchanged. So the answer here is upstream
of the rounding: a zoom asking for at least the whole spectrum **is** the whole
spectrum, and one asking for no more than the narrowest window that spectrum has
**is** that window, built where it already sits. Both are limits `clampMzDomain`
already enforces, stated exactly instead of arrived at by subtraction.

The narrow limit was got wrong once on the way, and the review round caught it:
refusing the last step is also inert at the floor, but it left `Zoom in` disabled
while the contract would still have narrowed the window, which is the same
availability rule broken in the direction nobody notices.

**The retention-time axis has the same arithmetic and is not fixed here.** That
is `viewportAction.ts`'s and ADR 0033's, its evidence is the chromatogram's, and
folding it into this slice would change a shipped surface M5.2 has no rendered
evidence for. Recorded as P3 for whichever slice next owns that planner.

### Two sentences that quietly became false

A truncated spectrum was described by a notice saying *only the drawing is
limited to the first N points*, and by an accessible summary saying *the drawing
covers the first N of those points*. Both were true of a panel with no viewport
and neither is true where one exists, because every committed range is drawn
from the complete spectrum Rust retained. Leaving them would have made the
panel's own words contradict the milestone for the reader most affected by it --
someone panning past the end of the prefix while being told the drawing stops
there. Both now branch on whether the spectrum has a viewport; the no-viewport
wording is untouched.

### What the evidence establishes

**Frontend: 1,313 tests**, up from 1,093. **Rust: 1,303, unchanged** -- no Rust
file was edited, which is the claim this slice most wanted to be able to make.
**Rendered browser QA: 178 tests across seven spec files**, covering every
availability state -- admitted and actionable, admitted and inert, and refused --
at 1920x1080, 1366x768 and 960x640, with the keyboard order walked by real Tab
presses rather than read off an attribute. **Real-Tauri QA: 49 tests across
seven spec files**, with `project_selected_spectrum` left live against the real
process wherever the case is about the boundary rather than about the shell.

**Thirty-seven mutations**, applied one at a time and restored byte-for-byte with
the hash checked after each. Thirty-two failed the check aimed at them: a wheel
always claimed and a wheel never claimed; a control offered where the reducer would
render nothing new; the previous drawing kept under a newly committed range; a
drawing asked for on every pointer frame; a stale drawing accepted; a refused
viewport taking a domain from the transferred arrays; a gesture's range drawn as
though committed; the drawing's own points deciding the range it is drawn over; a
pan accumulated from frame deltas; a second pointer taking the press from the
first; a press keeping its window across a spectrum change; both limits removed
so the candidate is the raw arithmetic again, and the narrow limit put back the
way that stops one step short; the caption reading Rust's reduction flag; a
failed range captioned as one still on its way; and an empty plot claiming every
intensity is the same.

Then the closure round's seven: the caption's reason, pan saturation removed per
direction for each of its two consumers, per-frame React publication, and a
transient transform surviving a render, plus two status documents put back the
way they contradicted the slice. Then the cross-axis round's five: each of the
four modifier guards removed in turn, and `shiftKey` added to the shared
predicate, which is the mistake that would silently disable the ordinary `+`.
Then this round's three: the old focusability rule restored, and focusability
decided by one action and by every action instead of by any.

**Five survived, and each is an equivalent mutant rather than coverage this
slice lacks** -- three of them provably so:

- recording a failure message the contract refused, since the message is read
  back by the contract's own generation and a stale one could not reach the
  screen even if it were stored;
- `pannedTo`'s two internal branches, whose resting guard and edge-landing
  construction each close the flush case on their own, measured over 400,000
  random windows;
- exposing the keyboard handler on an inert surface, which is unobservable by
  construction: the surface is non-focusable exactly where no action is
  productive, and the handler claims and dispatches nothing exactly there. It is
  kept as the explicit form of the rule rather than as behaviour;
- deciding focusability from `full.low !== full.high`, which agrees with the
  planner for every reachable state because zooming in is productive for any
  domain with width -- measured across widths from 1e-9 to 1e9 and three
  committed windows each. What keeps the two from drifting apart is asking the
  planner, and making the action set a `Record` the compiler checks, rather than
  a test that cannot yet tell them apart.

**Eleven real defects were found by evidence rather than by reading**, and all
are repaired above. Four in the first round: the full-range rounding that left `Zoom out` enabled and
swallowed the wheel; a press held across a spectrum change starting a gesture on
the new spectrum at the old one's range; a caption claiming every observation was
drawn when this plot's own 900-column reduction had just dropped some; and a
failed range captioned as a drawing still on its way, which for a non-retryable
refusal never went away.

And four the second round found, three of them in the first round's own repairs:
the replacement caption blaming a shortage of columns the drawing usually has
plenty of; a pan at a saturated edge still reporting a real action, because the
two exact limits had been stated for zoom only; every pointer frame publishing
through React, which `apps/desktop/AGENTS.md` names directly and which put the
panel's whole reduction on the pointer-frame path; and four current status
documents still describing spectrum zoom and pan as something the product does
not do. The last of those now has a repository guard of its own, because a
status page that goes stale is the one kind of document nothing else notices.

And two in the third, both on the shared surface described below: a
Ctrl-modified wheel claimed as viewport zoom, and Ctrl/Meta/Alt-modified
accelerators claimed as viewport navigation -- on *both* plots, which is why the
repair reaches the chromatogram.

And one in the fourth, which the panel had already got right everywhere else. A
spectrum whose points all report one m/z is admitted, `ready` and truthfully
drawn, and every viewport action over it is inert: three disabled buttons, an
unclaimed wheel, an unclaimed key, a drag that starts no gesture. The drawing was
still a tab stop, because focusability asked whether a viewport *existed* rather
than whether it could *move* -- two questions with the same answer for a refused
spectrum and a different one here. **An admitted viewport is not automatically an
actionable one.** Focusability now comes from `hasProductiveSpectrumViewportAction`,
which asks the same M5.2 planner that already governs button availability, key
claiming, wheel claiming and whether a drag begins, over the whole action set
rather than the three with buttons. The description stays: what range is on
screen and what the drawing is doing are still true of an inert viewport, and are
exactly what a reader who cannot act on it still needs.

### The rule that turned out not to be about m/z

A third round found that **both plots claimed inputs the window already owns**.
Ctrl+wheel over either one zoomed its axis and cancelled the event; Ctrl+0 with
either one focused reset a scientific range and swallowed the accelerator.
Neither adapter was wrong about what the input would do; both were wrong about
whose it was. So this is a shared viewer defect, and the chromatogram is
repaired here beside the spectrum -- two plots that disagree about which
keystrokes the window still owns is exactly the drift nobody notices.

It supersedes a decision that was correct when it was made. ADR 0033 gave
`ctrlKey` no meaning because reading it as a trackpad pinch is a guess about
hardware, and **that reasoning is not reversed**: nothing classifies a device,
no pinch semantics were added, touch stays deferred. What changed is evidence
about the *host*. WebView2 enables its zoom controls by default and names
Ctrl+Plus, Ctrl+Minus and Ctrl+mouse wheel as the inputs they use, and this
repository disables none of it -- checked against `tauri.conf.json` and the Rust
window setup rather than assumed. The question is not what device sent the
event, which a viewer cannot answer, but whether the input is already spoken
for, which it can: a Ctrl-modified wheel, and a Ctrl-, Meta- or Alt-modified
key, are the host's.

Shift is deliberately not on that list. On common layouts `+` *is* Shift+`=`, so
rejecting Shift would disable the ordinary zoom shortcut while protecting no
accelerator; Ctrl+Shift+`+` is still released, because Ctrl is there. Modified
*wheels* other than Ctrl keep ADR 0033's original answer, and its test now pins
that against Shift rather than against Ctrl.

`viewer/hostInputOwnership.ts` holds the policy for both plots. Sharing it makes
them no more one authority than sharing `wheelInput.ts` does -- it decides
nothing about a range and has no axis in it -- and the reducers, state machines
and domain brands stay exactly as separate as they were. What is *not* shared:
the chromatogram still claims any key it recognises whether or not the
transition is productive. That is its slice's question, and this one did not
answer it.

**What the rendered evidence can and cannot say.** Both suites drive these
inputs and read `defaultPrevented` off the real DOM, which establishes that
MSCanvas does not claim the event and so leaves the host's documented
accelerator path available. Neither establishes that the WebView then zoomed: a
dispatched event is not a user gesture, and no OS-level input synthesis was
added for this. The specs say so in place rather than letting a green check
imply more than it measured.

### Not built, and by design

The selected spectrum's `Current`-range export is **M5.3, and no part of it was
started**: no range chooser, no scope, no command, and no path from a screen
projection to a document. The four inherited M4.4 P3s remain unresolved, owned
by M5.3 and M5.7, and M5.1's `projection.rs` rustdoc P3 is carried unchanged --
this slice did not edit that scientific boundary at all.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build` and `git diff --check`, each run directly and each exiting zero,
plus `pnpm e2e:typecheck`, `pnpm e2e:browser`, `pnpm e2e:build` and
`pnpm e2e:tauri`.
## M5.3 — selected-spectrum `Current range` export, 2026-08-29

A selected spectrum already exported as SVG, PNG, `Copy plot`, CSV and TSV over
its complete retained source. This slice adds a **range** to those five outputs
and no format to the spectrum: where M5.1 admitted an m/z viewport and M5.2 made
it reachable, the same outputs are also available over the window that viewport
has committed to. See
[ADR 0040](docs/architecture/adr/0040-spectrum-range-export.md).

### Where the range comes from, and where it cannot come from

`SpectrumSnapshot::resolve` is the one resolver, and every format reaches its
range through it. Its authority is the complete arrays Rust retained plus the
`ViewportDomain` settled when they were retained — never the transferred prefix,
never the backend's separately reported `mz_low`/`mz_high` pair, and never the
bounded screen projection. That last substitution is the one this slice existed
to make impossible, and the types do most of the work: `ScreenProjection` is only
ever the return of `project_spectrum`, no document writer sees one, and
`preview/export.rs` does not import it.

Two typed refusals, both path-free and both in m/z words rather than the
chromatogram's. A window outside the source is **refused, not clamped**. A
`Current` range asked of a spectrum whose viewport the figure contract refuses is
its own refusal rather than a full-source export wearing that name — nothing is
sorted, and neither the reported bounds nor a first/last or min/max of the array
is used to manufacture the domain the contract declined to establish.

### Full is a different shape from Current

`ResolvedSpectrumRange` is `Full` or `Current(Domain)`. `Full` carries no bounds,
and that is load-bearing: a full-source export never asks the viewport question,
which is what keeps CSV and TSV writing for the unordered m/z array mzML permits
and nothing here sorts.

### What a range figure is, and what it is not

The same panel `spectrum_panel` already built, with a window declared on it. The
series is still the complete source at `DataScope::FullSource`; the full m/z and
value domains are still the source's own; the range decides what is drawn. An
off-window peak of nine million stays in the document and stays out of the value
axis of a window that does not contain it, because the visible value window is
computed from the observations that window actually holds **and zero** — a
stick's length is read from zero, so an axis without it would make every mark in
the window a lie about its own size.

The representation decides the filtering, and this is where the chromatogram's
rule deliberately does not carry across. A chromatogram is a polyline and clips
with an interpolated boundary height; a spectrum here is discrete marks, so the
figure draws only genuinely reported peaks inside the inclusive window and
invents nothing at either edge. **A data document invents no measurement at any
range under any representation.**

A current range covering the whole spectrum declares no window and canonicalizes
to the full-source figure.

### Two data schemas, and version 1 still means what it meant

Version 1 is frozen as the full-source document — the same source writes the same
bytes it always did. A range is version 2, carrying `range_scope`, the resolved
`range_low`/`range_high`, and `source_point_count` and `exported_point_count` as
**separate** keys, because in a ranged document those two numbers differ and one
`point_count` would leave a reader unable to tell whether the rows they hold are
all the spectrum has. One writer and one record loop serve both, so the two
cannot come to disagree about how a measurement is written.

Records are the source points satisfying `low <= mz <= high`, edges included, in
**source order**. Zero rows is a successful export, and a zero-width range is
valid.

### The range is fixed when the export begins

The claim carries it. A viewport that moves while the save dialog is open changes
neither the file nor the sentence that reports it, and the outcome carries the
range so the interface never reads it back from a viewport that has moved. The
range **note** beside that sentence does follow the viewport, because it
describes what the next export would cover — the difference is the point.

### The scope belongs to one spectrum's export context

Initial `full`; reset to `full` when a different spectrum is selected; `Current`
disappears with a viewport that stops being admitted and is not resurrected when
one is admitted again; ordinary zoom, pan and reset leave it alone. The effective
scope is derived rather than stored twice, so it cannot disagree with the reducer
for the one render in which a refusal arrives.

`Current` export is independent of whether the screen drawing is idle, loading,
ready, empty, retryably failed or not: a failed drawing is not empty science.

### The linked figure is unchanged

`spectrum_panel` takes no range, so there is nothing a spectrum's range chooser
could hand it. ADR 0036's rule that the lower panel is the complete selected
spectrum is preserved by the signature rather than by a convention, and the
linked export carries the chromatogram's range and no m/z at all.

### Two inherited M4.4 debts, closed

**P3-1 was reproduced before it was repaired.** An unauthorized constructor
nested inside `impl LinkedPair` passed `python -B scripts/check_repo.py` on this
branch's parent. The existing whole-file rule is untouched and no shared scanner
was loosened; what was added is a rule about `mod linked_pair` itself, where the
methods it declares are a closed list, `LinkedPair::new` and `Self::new` may not
be called inside the module that defines them, and exactly one `Self` struct
literal exists. Three mutations — the nested wrapper, the same route spelled
`Self::new`, and one bypassing the constructor with a struct literal — were
applied one at a time and restored byte for byte; the guard passed all three
before and each is now caught by two of the three rules independently.

**P3-4** is closed by moving the `scientificExportBusy` documentation block back
onto the declaration it describes, with no runtime change. The comment above the
three export-state declarations was corrected from "two states" to "three",
which had been false since M4.4 added the linked one.

### Not built, and by design

**No XIC work was started.** No operation, no capability gate, no parser, no
service path, no measurement, and no answer to XIC-D1 through D5. ProteoWizard
query capability is unchanged. M5.4 remains next and unstarted.

No second export lane was added. No linked data document was added. No production
QA hook was added. `MAX_SPECTRUM_POINTS` was not raised. The three P3s this slice
does not own — M4.4's stale linked comment and duplicated linked refusal, and
M5.1's `projection.rs` rustdoc — are carried unchanged.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build` and `git diff --check`, each run directly and each exiting zero,
plus `pnpm e2e:typecheck`, `pnpm e2e:browser`, `pnpm e2e:build` and
`pnpm e2e:tauri`.
## M5.4 — XIC source and capability evidence, 2026-08-29

An evidence slice. It implements no XIC and changed no production code; it
decides whether a defensible backend source exists and names the contract M5.5
would implement.

**The measurement record is
[`docs/spikes/M5_XIC_SOURCE_EVIDENCE.md`](docs/spikes/M5_XIC_SOURCE_EVIDENCE.md),
and it is the authority for every fact about the backend.** This entry carries
the outcome, what it binds to and what follows from it. It deliberately does not
restate the measurements: a result maintained in two places is a result that can
disagree with itself, and each review round of this slice found its errors in
the restatements rather than in the measurements.

### Outcome

**`XIC_SOURCE_REFUSED`.** No query this build offers can serve as a general XIC
scientific source.

An earlier candidate of this slice recorded `XIC_SOURCE_ADMITTED` for
`tic mz=`. That conclusion was **withdrawn** under a post-review authorization
after a measurement it had not made: the build serializes region intensities at
four fixed decimal places, and a legitimate positive signal below `0.00005` is
written as the same text as a true zero.

### The build the conclusion belongs to

ProteoWizard `3.0.26013 (47b13cf)`, build date `Jan 13 2026 14:42:37`, found
where this repository's own discovery searches. `msaccess` emits the release but
not the revision, so the revision comes from `msconvert` in the same
distribution and is corroborated by the installation directory name.

**This is not M0's build.** M0 measured `3.0.26204 (a09eea9)` in an isolated
runner, so no source-level semantic claim was carried across; every aggregation
citation in the spike is pinned to `47b13cf` and re-read.

### What was measured, and against what

Both pinned sources are external, hash-pinned and verified before execution;
neither payload is committed. The synthetic fixture is ProteoWizard's
`tiny.pwiz.1.1.mzML`; the representative is PRIDE `PXD081190`'s CC0
`BBM_506_P110_31_MIA_004_30_calibrated.mzML`, `208,408,454` bytes, `36,319` MS2
spectra — the same two M0 pinned, re-verified. Two further fixtures were
generated, because the pinned pair cannot reach two dimensions of the standard:
a positive sum below the serialization resolution, and two spectra sharing a
retention time.

The installed build declares **eight** analysis queries. Four — `metadata`,
`run_summary`, `spectrum_table`, `binary` — declare no m/z term at all and are
excluded by their own signature. The other four were measured, including `image`,
whose signature declares no parameters at all and was therefore too ambiguous to
argue away. **"To the same standard" is not asserted here**: it is discharged by
the spike's candidate-standard matrix, where every dimension of the standard is
either a located result or an explicit `NOT_APPLICABLE` with its reason, for each
of `tic`, `sic`, `slice` and `image`.

### Why the four were rejected — two grounds, not one

**`tic`, `sic` and `slice`** share a measured serialization defect: the build
writes region intensities with `fixed << setprecision(4)`, so a real in-window
sum below the fourth decimal is written as the same text a true zero produces,
and no precision control exists for that output. MSCanvas admits mzML generally
and holds no trustworthy minimum intensity scale that could rule such values out
before invoking, so an XIC built on it would render real low-intensity signal as
a flat zero line and be unable to say which it was showing. `tic` is rejected for
`LOSSY_INTENSITY_SERIALIZATION_DESTROYS_ZERO_NONZERO_DISTINCTION`; `sic` and
`slice` carry the identical loss plus further reasons of their own. The earlier
candidate's claim that `0.0000` is explicit no-signal behaviour is **withdrawn**:
it is either no signal or signal below resolution, and the output does not
distinguish them.

**`image` does not share that defect and is not rejected for it.** It renders a
pseudo-2D-gel, which carries no per-scan quantity and no result identity even
when it succeeds, and it produced no usable output on either pinned source — five
repeats of one identical invocation, every one exit `0` with no artifact and a
byte-identical diagnostic. It never produced an intensity column to serialize.
The two grounds are kept apart because a later build could repair one without
touching the other.

The spike also gives a cause for something this log left open: M0C's
"representative TIC: exit 0, no generated output" is a singular parabola fit,
reproduced and located.

### Capability contract

**No production code changed.** `InstalledHelpCapabilities::analysis_query`
already returns exact signatures, required/optional parameter facts and closed
value sets for `sic` and `slice` with no new parsing — `radiusUnits` admits
exactly `amu` and `ppm`. One test was added to pin that, because "the contract can
already express the candidate inventory" is worth checking rather than asserting.

### The decisions, under refusal

**D4 is not applicable.** ADR 0037 was amended by this slice: D4 is
`USER_DECISION_REQUIRED` only where the evidence admits **two or more** sources;
zero means refusal and there is nothing to choose. It admitted none.

D1, D2, D3 and D5 are moot for the same reason — M5.5 and M5.6 are
`NOT_APPLICABLE`, so none of them blocks reachable work. The evidence gathered
about each is preserved in the spike for whoever re-enters through the gate.

### The XIC re-entry gate

XIC is refused for **this executable**, not for all time. ADR 0037 now carries the
rule this slice needed:

> Scientific evidence is transferable only to an executable identity explicitly
> covered by that evidence.

Re-entry requires an exact `msaccess.exe` identity covered by fresh measurement,
plus the required exact capability grammar, plus a resolved numeric-fidelity
answer. A different digest is not admitted because its help looks the same. The
measured digest is recorded once, in the spike's re-entry gate, where repository
validation checks it against the build table it came from.

`ProviderBuild::is("3.0.26013", "47b13cf")` is **not** sufficient on its own for
this tool: this build's `msaccess` reports its release but not its revision, so a
revision-bearing check would not match the executable actually launched.

No XIC was implemented: no operation, no capability gate, no parser, no DTO, no
service command, no frontend, no cache, no export, no new selection authority,
and no `PreviewOperation` extension. No pseudo-XIC was substituted at any point,
and no approximation was built to rescue the refusal.

M5.5 = `NOT_APPLICABLE`. M5.6 = `NOT_APPLICABLE`. **M5.7 is next**, and it is
reachable: its predecessor on the refusal branch is M5.3, which is complete.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build` and `git diff --check`, each run directly and each exiting zero. No
browser or Tauri E2E was required: this slice has no frontend.

## M5.7 — selection-availability affordance consistency, 2026-08-30

One rule for how every viewer surface that commits a scan says it cannot right
now, applied to both of them at once. Frontend only: no Rust changed, and no XIC
was built. The durable rule is
[ADR 0041](docs/architecture/adr/0041-viewer-selection-availability.md); this
entry records what shipped and what it was proved with.

### The rule

`canStartSpectrumSelection` stays the one selection-start authority and its four
lane facts are unchanged. What it returns is now a projection rather than a
boolean — available, or unavailable with a reason and the sentence a reader is
shown — and the boolean is `status === "available"`. Every committing surface
reads that one value, so no component decides for itself what is wrong.

**Precedence names the fact that decides.** Nothing to select from; a check
owning the backend lane; a settled verdict needing the reader to act; a
conversion. The second ranks above the third because a check reports the backend
as not usable for as long as it runs, and reading that as a verdict tells a
reader their installation is broken every time it is looked at. That correction
was made after an existing scan-step test caught the first ordering.

**The lane is the queue slot, plus a dispatched retry.** `conversion.busy` also
covers an adoption and a diagnostics export, neither of which claims the guarded
ref -- each sets its own -- so the operation accepts a click through both, and a
surface that refused there would have said a conversion was running while a
diagnostics text file was being written. A retry is the other way round: it sets
the guarded ref itself and Rust reads `terminal` throughout the rerun, so the
slot's status never reports it. Both directions were found in review, and the
lane is now one predicate with a ref twin and a rendered twin. The `convert`
ref/render window is untouched and remains the named exception.

**A blocked selection blocks committing a scan, not reading the run.** Hover,
wheel zoom, drag pan, the keyboard viewport shortcuts, the range buttons, the
trace toggles, scrolling, virtualization and `Arrow`/`Page`/`Home`/`End` roving
focus all stay live. Neither surface is disabled and neither is made inert;
`aria-disabled` is on the rows, which cannot be activated, not on the grid, which
can still be navigated.

**One explanation, once.** The viewer states it in a permanent live region that
is empty while selection is available -- collapsed out of flow rather than with
`display: none`, which would take it out of the accessibility tree and leave it
arriving together with its first sentence -- and both surfaces point at it by
`aria-describedby`. It sits above the three measured panels in a flex
column rather than as a fourth grid row, which would have cost 8px of gap
permanently.

### The two inherited M4.4 P3 debts, closed

**P3-2.** The linked section's comment described one sentence in one element that
is a live region from the start; it had been two elements since the announcement
was repaired. Rewritten to the shape the file has.

**P3-3.** The linked refusal was in the accessibility tree twice — a visible
paragraph and a visually-hidden `aria-live` copy of it. One permanent live region
now carries the refusal visibly and empties on recovery, and the ordinary
description is a separate element rendered only when there is no refusal. One
occurrence in either state, announcement intact, and becoming usable stays
silent.

### Evidence

Frontend tests **1,378** (from 1,343), across the pure rule and its precedence,
each surface's blocked and preserved behaviour, and the assembled document —
where the single occurrence, both associations, the announcement, the absence of
any backend read, and recovery without a remount are asserted together.

Seven counterfactuals, each applied alone and restored byte-for-byte: the
chromatogram committing anyway, the table's row click and `Enter` committing
anyway, the chromatogram taking the viewport away along with selection, the
linked refusal duplicated back into a hidden copy, and -- after review -- either
empty region collapsed with `display: none` again, and the viewer's own rules
written into the stylesheet twice. All caught.

Rendered QA at 1920×1080, 1366×768 and 960×640: the explanation is legible, the
column keeps its width, all three panels stay present and nothing scrolls
sideways.

**Real WebView2 evidence, which M5.3 truthfully could not produce.** An official
`msedgedriver` 151.0.4129.107 was restored outside the repository, exactly
matching the installed WebView2 runtime 151.0.4129.107; Edge itself is
152.0.4191.53 and is not what the shell uses. No project dependency changed and
no driver is committed. The M5.7 suite passes in the compiled shell: the
explanation appears and is announced there, both surfaces send nothing across the
real IPC boundary while it stands, the run stays readable, and selection commits
again when the lane clears.

Three failures in the wider Tauri suite are **pre-existing and environmental**,
not this slice's: one figure-settings theme default, and two clipboard operations
that need a focused window. Each was reproduced on `main` with this slice stashed
and the binary rebuilt, and is reported rather than attributed here.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build` and `git diff --check`, each run directly and each exiting zero,
plus `pnpm e2e:typecheck`, `pnpm e2e:browser`, `pnpm e2e:build` and
`pnpm e2e:tauri`.

## M5.8 — Viewer Completion closure and handoff, 2026-08-30

The closure slice. **Documentation only**: no production Rust, no frontend, no
CSS, no new behaviour and no tests for new behaviour. The closure record is
[ADR 0042](docs/architecture/adr/0042-viewer-completion-closure-and-handoff.md),
which answers each exit criterion by citation; nothing is retold here.

Baseline `8a8fdacb54dde05cf8f761bc84f30a864cfbce25`.

### The eight exit criteria

| # | Criterion | Disposition |
| --- | --- | --- |
| 1 | Spectrum viewport, both paths | **PASS** |
| 2 | Selected-spectrum export, both paths | **PASS** |
| 3 | A visible XIC | **NOT_APPLICABLE** — evidence-gated refusal |
| 4 | XIC linked selection | **NOT_APPLICABLE** — `XIC_SOURCE_REFUSED` |
| 5 | Selection availability | **PASS** |
| 6 | Multi-layer comparison | **DEFERRED** — M8, then M9 |
| 7 | Bounded preview cache | **DEFERRED / OPTIMIZATION_ONLY** — M7, on measurement |
| 8 | Vendor-format direct preview | **DEFERRED / EVIDENCE_GATED** — M6 |

The three milestone-wide conditions pass.

**Criterion 5 required amending the route, and that is said rather than
implied.** It passes for the availability rule it is about, and does **not** claim
the `convert` ref/render window closed with it: `convert` claims the backend lane
as it dispatches and the rendered state follows only when the queue slot is read
back, so inside that interval an activation still does nothing without saying so.
ADR 0037 stated the criterion unconditionally and never mentioned the case, so
M5.8 **narrowed the criterion** — dated, in ADR 0037 where the criterion lives —
on the one ground that the window is not a viewer property: it belongs to
`convert` claiming a lane before the slot confirms it, every conversion-gated
control here has it, and it predates M5. **Owner: M6.** This is the only exit
criterion this closure changed rather than merely proved.

Condition A cost more than expected, and it cuts both ways. Nothing described an
unimplemented feature as implemented; four current product-facing passages
described **delivered** work as missing — the README's "what is next" and its
"not implemented yet" list, `PRIMARY_WORKFLOWS.md`, and a `FEATURE_CATALOG.md`
bullet found in review. All corrected.

### `XIC_SOURCE_REFUSED`, closed rather than passed over

M5.5 and M5.6 did not run. No pseudo-XIC was substituted, no XIC export exists,
and **`M5 COMPLETE` does not mean XIC exists.** Re-entry needs all three of the
spike's gate: an executable identity and capability grammar covered by fresh
evidence; a resolved numeric-fidelity answer; and **re-measurement of everything
the record establishes**, because the aggregation each query performs and the
singular-parabola abort are invisible in help text, so a build can match the
grammar and still be scientifically different. No executable inherits the
refusal's evidence because its help text resembles the measured one's.
**VIEW-007's owner is M6**, the milestone that measures this backend's
capabilities against a build; the gate is the condition, not the owner.

### Two record debts closed

**M5.4's deferred synthetic `slice` P2.** The matrix cell `synthetic 2,4` was the
only place that run appeared. The evidence was authenticated rather than copied:
`msaccess.exe` re-hashed to `85681B20…D1F4`, `tiny.pwiz.1.1.mzML` re-hashed to
`711ac14b…9c83`, and `slice mz=2,4 delimiter=tab` re-run — exit `0`, `543` bytes,
`8` rows, SHA-256
`fd279dbc0e3f1636d2d7f306c5d346aa657d13444cd32532bb067c0054a6ad6f`,
byte-identical to the preserved artifact. The synthetic no-signal case reproduces
too (`74` bytes, `9dfd5839…ab87`). No classification changed.

**ADR 0037's four inherited M4.4 debts.** The route still said none had been
repaired. Verified against `main`: **P3-1 and P3-4 closed by M5.3**, **P3-2 and
P3-3 closed by M5.7**. The findings are left as written and each carries its
disposition.

### Handoff

**M6** inherits the capability-evidence discipline M5.4 established and the
viewer/conversion lane boundary M5.7 froze, including the `convert` ref/render
window handed over open and described. **M7** inherits the interaction and
availability principles, plus chromatogram touch semantics and a bounded preview
cache. **M8/M9** own VIEW-008, and a reusable XIC artifact if XIC ever re-enters.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build` and `git diff --check`, each run directly and each exiting zero, plus
`pnpm e2e:typecheck`, `pnpm e2e:browser` (9 suites, 199 cases) and
`pnpm e2e:build`. Rust **1,350**; frontend **1,378**.

`pnpm e2e:tauri` was run as a regression inventory against M5.7's baseline, not
as new product evidence. M5.7 classified three environmental failures; this run
reproduced **two** of them, and the comparison is enumerated so the claim is
checkable:

| M5.7 baseline case | This run |
| --- | --- |
| `renders every figure control and the settings it starts at` — figure-settings theme default | fails, as before |
| `holds one scientific lane, whichever range is chosen` — clipboard | fails, as before |
| `reports the range Rust resolved for a real copy` — clipboard | **passed** |

The third passing is what a focus-dependent clipboard case does rather than
evidence that anything was fixed, and it is recorded as an observation rather
than a repair. The four M5.7 real-shell cases pass. **No new failure.** The suite
is not green and is not described as green.

## M6.0 — Conversion Completion orientation and route lock, 2026-09-01

The M6 route-lock slice. **Documentation only**: no production Rust, no
frontend, no CSS, no dependency change, no new behaviour and no tests for new
behaviour. The route record is
[ADR 0043](docs/architecture/adr/0043-conversion-completion-route.md), which
holds the gap audit, the twelve-slice graph, the nine decisions, the exit
criteria and the M7/M8 seams; nothing is retold here.

Baseline `0c23c59a9ba7ecba39ad6030fdd8c604c23a602b`, clean and level with
`origin/main`.

### The audit changed the shape of the milestone

`ROADMAP.md`'s four M6 bullets were written without a live audit of the
conversion code. Reading it changed the answer in both directions.

**Stronger than the backlog implied**, and therefore not M6 work: destinations
are admitted by Windows object identity — volume serial plus 128-bit file ID read
from a held handle — with reparse points, non-directories and remote volumes
refused before a plan exists, and a retry re-admits and refuses unless it reaches
the same object; finalization is handle-bound and taken only after the integrity
contract passes; termination is an owned Job Object with an emptiness check, not
a `kill()`; the item vocabulary already has eight states including three
different cancellation outcomes; progress already refuses a percentage in the DTO
itself; and vendor-family conversion is already gated on an exact
`msconvert.exe` digest by `EVIDENCED_PROVIDER_BUILDS`.

**Seventeen gaps** are recorded in the ADR. The concentration is in two places:
no `msconvert` capability has ever been measured beyond single- and multi-output
mzML with `--zlib`, and the conversion lane has no single availability authority.

### The M5 handoff still exists, and is worse than recorded

The `convert` ref/render window is live. `busyRef` is raised synchronously in the
click handler while `backendLaneBusy` and `busy` derive only from an arriving
slot read, so the window opens at the click and closes when the first read
carrying an owning status commits.

Three things M5's record did not say. **The divergence runs both ways** — the
handler guard is strictly narrower than the rendered `disabled` expression, so a
quarantine, an installation check and an unsettled workspace mutation each
disable the button while the handler would accept a dispatch. **A read can lower
a claim** — `applyUpdate` assigns `busyRef` unconditionally from the arriving
status. And **`canRetry` is computed and has no consumer**; the `Retry` control
answers to `canConvert` instead.

The defect is given one name here — **the conversion-lane availability
divergence** — because it was carried under two across five documents and no
tracking identity under either. **Owner: M6.1**, and M6.1 is first for that
reason.

### D-decisions, and where evidence is missing

Nine decisions, `CNV-D1` to `CNV-D9`, anchored to the `CNV-*` identities
`FEATURE_CATALOG.md` already carries. Statuses in the ADR. What matters for
planning: **four of the nine cannot be closed without a measurement nobody has
taken**, and one more turns on an architecture decision rather than on evidence.

**CNV-D4 is that one, and an earlier draft of this record had it wrong.** It said
the destructive question waited on measuring what `msconvert` does to an existing
output. It does not, and cannot: ADR 0009 sends the provider only into a private
staging directory, finalization is MSCanvas's own no-clobber rename, and where
the final target already exists **the backend never runs** — so the provider
never meets that file and no measurement of it could authorize a destructive
product decision. The real question is MSCanvas's: how an already-validated
object replaces an existing destination object without a failure losing the old
one. **Owner: M6.6**, terminal on `OVERWRITE_ADMITTED` or `OVERWRITE_REFUSED`,
and admitted only on a tested finalization contract. The provider fact stays
recorded but non-authoritative and off the critical path.

**Its sibling turned out to be closed, and the audit corrected itself.**
`## Intentionally pending` still lists "whether `msconvert` writes anything into
its working directory besides the output it was asked for" as required, but
M3.0.3 measured it on 2026-08-07 and M3.10 measured the multi-output case on
2026-08-10, both recorded in ADR 0009's own struck-through gate. What remains
open there is only a **non-mzML output format**, which makes it a consequence of
CNV-D1 rather than a standing debt. The stale bullet is corrected in place.

One decision is neither open nor closed but **contested**: `ConversionPlan`'s
conflict type says overwrite is excluded because ADR 0009 refuses to replace a
file this boundary did not create, while CNV-008 says overwrite requires explicit
confirmation and `PROJECT_PROPOSAL.md` §7.7 additionally lists an automatic
rename that exists nowhere. Two accepted documents disagree; M6.0 records that
rather than resolving it by preference. **Owner: M6.6**, and it waits on no
provider measurement — only on whether the Rust finalization contract can justify
a destructive publication.

### Queue capacity, stated accurately

`MAX_CONVERSION_QUEUE_ITEMS = 16` is a **wait-time judgement, not a memory
limit**, and the code says so. Nothing in the repository measures memory,
throughput or scaling against queue length. Its stated premise has gone stale —
the doc comment justifies 16 on the queue having "no cancellation", and a
queue-level stop has existed since ADR 0015. The queue stays finitely bounded
whatever value M6 lands on, and re-evaluating it is **M6.8's**, after
cancellation is understood.

### Cancellation: a strong mechanism, an unmade measurement, and an open window

Job Objects, `TerminateJobObject` and an emptiness check are implemented and
correct in shape. What has **not** been established is that a real `msconvert`
run is a *tree at all*: `surviving_processes == Some(0)` after termination is
satisfied trivially by a one-process run, `max_active_processes` is printed by
the M0 spike harness but recorded in no evidence document, absent from
`BackendRunFacts` and not reported by the cancellation harness, and the only
multi-process evidence is against a synthetic mock parent and grandchild — which
[ADR 0014](docs/architecture/adr/0014-proteowizard-cancellation-evidence.md)
states openly.

**And a measurement would not be enough on its own.** The child is spawned
*before* `AssignProcessToJobObject`, so a descendant created in that window
belongs to no Job — outside `TerminateJobObject` **and outside the count that
reports the Job empty**. A sample cannot observe a process nothing was counting,
so no number of representative runs closes it; the same holds for an assignment
failure, which degrades to a direct-child kill without being reclassified as
unconfirmed. The route therefore requires **three** things to agree — a
representative measurement, a structural ownership answer, and an **exhaustive
reconciliation of every claim** that asserts confirmed process-tree termination —
ending on one of two outcomes: `OWNERSHIP_STRUCTURALLY_CLOSED`, or
`OWNERSHIP_UNCONFIRMED` in which **a stop of a launched conversion does not
settle as a successful `Cancelled` at all** — it settles `CancellationFailed`,
the queue settles `StopFailed`, and the session is quarantined. An earlier draft
kept the success state and withdrew only the wording, on the grounds that the
alternative makes `Stop queue` less useful; that is a consequence, not evidence,
and [ADR 0014](docs/architecture/adr/0014-proteowizard-cancellation-evidence.md)
had already decided that a run which cannot establish the tree is gone gets
`CancellationFailed`. `NotStarted` is unaffected. The third is a semantic
contract with a repository guard behind it, not a list of symbols: the claim is
propagated across item states, queue counts, cancellation facts, mirrored wire
fields, diagnostics keys, set-stop facts and the quarantine reason, and an
enumeration would be correct only until the next surface was added. No
implementation is prescribed. **Owner: M6.8**, before any surface claims a tree
was terminated.

### XIC: no new identity at this baseline

The installed `msaccess.exe` hashes to `85681B20…D1F4` and the sibling
`msconvert.exe` to `9BB6F5D5…D590BD` — both byte-identical to what the M5.4
spike recorded, at the same 12,898,816 bytes for `msaccess`. **No new executable
identity is observed, so the conditional re-entry does not fire here.** The
trigger stays live for the rest of the milestone: the gate is the condition, not
the date, and M6.2 and M6.10 each re-observe what they measure against. The
formal Post-M6 XIC provider/runtime interlude is recorded in the ADR, is not an
M6 exit criterion, and is not scheduled by it.

### Residuals re-checked, and not absorbed

Three historical items, checked against the live tree rather than assumed, and
**none is M6-owned by any current authoritative document**. The `projection.rs`
rustdoc P3 exists only as two back-references and was never stated, so it cannot
be closed; the passing `validate_drawability_is_settled_in_one_place` guard over
that file is a different thing. The retention-time viewport rounding is **open**
with the placeholder owner "whichever slice next owns that planner", is still
live in `viewportAction.ts`, and belongs to the chromatogram planner rather than
to conversion. The spectrum `clipPath` is a deliberate implementation and the
transient transform is a repaired defect recorded as a killed mutation — neither
is a residual. M4.4's four P3s remain closed.

### One current-status correction

`FEATURE_CATALOG.md` said CNV-003's vendor-dataset-root rule is unexercisable
"because no vendor acquisition is recognized". That clause was written before
ADR 0010 admitted Thermo RAW and was carried unchanged through three vendor
admissions. The conclusion was right and the reason had gone stale: the rule is
unexercisable because **no admitted family is directory-shaped**. Corrected —
along with one further stale count found beside it, the same section's "named
limits" sentence saying *two* named vendor families where three are admitted and
evidenced. Nothing else in that file changed.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm e2e:typecheck` and `git diff --check`, each run directly and
each exiting zero. Rust **1,350**; frontend **1,378** across 49 files. Both counts
are unchanged from M5.8, as a slice that touches no code should leave them.

**`pnpm e2e:browser` did not run and is not described as green.** All nine spec
files failed at session creation with `This version of ChromeDriver only supports
Chrome version 152 / Current browser version is 151.0.7922.175` — zero specs
executed, so no application code was reached. Reproduced on `main` with this
slice stashed: identical failure, identical `0 passed, 9 failed`. It is a local
toolchain mismatch that predates this slice, is unrelated to it, and is not run
by CI, which executes lint, typecheck, unit tests, build, the Rust gates and
`check_repo.py`. Recorded as an environment blocker for whoever next needs a
rendered browser pass, which M6.1 will.

### What this slice does not do

It implements no M6 behaviour, admits no conversion setting, measures no backend
capability beyond hashing the two installed executables, changes no test, and
does not start M6.1.

## M6.1 — Conversion-lane authority, 2026-09-02

The first M6 implementation slice, closing the **conversion-lane availability
divergence** — G1 to G4 of the ADR 0043 audit, which are one defect under four
descriptions. The route record is
[ADR 0043](docs/architecture/adr/0043-conversion-completion-route.md); the shape
this slice applies is the one
[ADR 0041](docs/architecture/adr/0041-viewer-selection-availability.md) proved
for the viewer's selection lane.

Baseline `d471f5f31fa8f65c91941d6c86e34f3c33b0edac`, clean and level with
`origin/main`.

### One question had four answers

"May this conversion action execute now?" was decided in four places that could
not agree. `canConvert` in `PreviewWorkspace.tsx` was an ad-hoc conjunction of
five workspace facts; the guard inside `convert` read three refs and was
**strictly narrower**, so a quarantined backend, an installation check in flight
and an unsettled workspace mutation each greyed the control while the operation
itself would have accepted a dispatch that reached it another way. `busyRef` was
a third answer no render could see. `canRetry` was a fourth, computed and
consumed by nothing while `Retry` answered to `canConvert`.

**One `ConversionLane` now decides**, in `conversionAvailability.ts`: eight
authoritative facts — a session that has lost a converter process, an
installation check, a settled backend verdict, a conversion holding the lane, a
run being read, an adoption, a diagnostics export, an unsettled change to the
file list — and one `ConversionAction` discriminated by what the action would act
on. The result is `Available` or `Unavailable` with one of eleven stable reasons
and one message each. Precedence names the fact that decides rather than the
longest-lived one: a lost converter process first, because it is the only one
waiting does not clear; then a check, above usability rather than below it; then
the verdict; then the four things that end by themselves; and the target last,
because "select something to convert" said while a conversion is running is a
true sentence about the wrong problem.

`canStartConversion` and `canRetryConversion` are projections of that decision,
and both the operation and every control consume them. `canConvert` is gone.

### The ref/render window, and why a rendered flag alone could not close it

`busyRef` and `retrying` became one `ConversionDispatch` claim carrying the rows
it was dispatched with. `claimLane` writes the ref and the state together, so the
operation and the interface stop offering in the same commit as the click rather
than one of them waiting for a slot read that arrives only after Rust has
reserved the queue — which, for a conversion, is across a native folder picker.
The claim is the rendered twin a dispatched `convert` had never had, and
`retrying` and `converting` are projections of it rather than flags beside it.

The window that claim describes ends when the slot **reports the queue the
dispatch made**, and deliberately not when the slot stops owning the lane. Those
are different moments: the conversion command answers once, when the whole queue
is over, so a queue stopped from `running` leaves the claim held over a terminal
slot. Defined by the status alone the window reopened there and described a
stopped result as a conversion that was starting. The claim therefore records
which queue it replaces -- Rust names every queue, and a new queue is a new name
-- and the first read carrying a different name closes it. Found by review on the
candidate head, repaired under the slice's one authorized repair, and pinned.

Both halves are load-bearing and neither is sufficient. A rendered `disabled`
cannot close the interval between two activations inside one commit, because
nothing commits between them; a ref alone leaves the control advertising work the
operation will drop. VS Code ships the opposite choice and says so in its own
schema — enablement "does not prevent executing the command by other means" — and
for something that claims a backend lane and spawns a process, an explicit
refusal at dispatch is the only safe end of that window.

### A read may raise the lane; only a dispatch may free it

The sequence guard orders reads against each other and **cannot order a read
against a dispatch**, because a dispatch moves no sequence: only Rust advances
one, and only once it has seen the request. A read issued before the click and
answered after it is therefore newer than everything installed while still
describing a slot that has not heard of the conversion, and `applyUpdate`
assigned the claim from that status unconditionally.

The rule is now explicit and one-directional. An arriving update may raise the
lane from its status, and may never lower a claim this document is holding; a
claim is settled only by its own dispatch's reply or its failure. Releasing it
hands the lane back to the authoritative slot rather than to `false`, so a
release whose reply the sequence guard discarded — which happens whenever a poll
installed the same transition first — cannot leave the claim raised for the life
of the session.

### `Retry` is not `Convert` under another name

They share a lane and not a target. `retryAvailability` is evaluated from the
same lane and from this queue's own retryable count, and the control reads it.
`canRetry` is gone rather than rewired: a boolean sitting beside the decision
with nothing reading it is the shape G4 was. The two genuinely disagree in both directions: a
session holding no convertible row refuses a start and offers a rerun of the
queue that failed, and a finished queue whose failures another attempt would not
change refuses a rerun while a start is offered. Both are pinned, so accidental
equivalence cannot silently return from either side.

### What the reader is told

A refused control says why, once, in one live region the panel mounts before it
has anything to say and collapses out of flow — not out of the accessibility
tree — while it is empty. One element per *reason* rather than per control: the
two controls share a lane, so where one fact refuses both they point at one
sentence, and where the reasons genuinely differ each names its own. Nothing
backend-free is disabled by any of it; search, sort, keyboard row navigation and
every viewer interaction keep their own authorities.

The viewer's selection lane gained one fact for free. Its adapter carried a
comment naming the `convert` window as knowingly uncovered; the claim now covers
it, so a spectrum selection is refused during a dispatched conversion instead of
being advertised and silently dropped.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm e2e:typecheck` and `git diff --check`, each run directly on
the implementation head and each exiting zero. Rust **1,350**, unchanged — this
slice touches no Rust. Frontend **1,398** across 51 files, up from 1,378 across
49: `conversionAvailability.test.ts` adds 9 and `conversionLaneAuthority.test.tsx`
adds 11.

**Rendered QA ran and passed: 208 browser tests across all 10 spec files**,
including the 9 of the new `m6.1-conversion-availability.browser.e2e.ts`. The
four regressions the slice exists for were each confirmed to **fail** against the
mechanism they pin — the claim's synchronous half, the stale-read rule, the
retry decision and the dispatch guard were reverted one at a time and the
matching test failed each time — so the suite proves the production wiring rather
than its own mocks.

**On the browser environment.** M6.0 recorded `pnpm e2e:browser` as blocked by
`ChromeDriver only supports Chrome version 152 / Current browser version is
151.0.7922.175`. Re-observed live rather than inherited, and it is a **pending
Chrome update on the workstation**, not a toolchain mismatch: `152.0.7977.66/`
and `new_chrome.exe` are both fully present under
`C:\Program Files\Google\Chrome\Application`, while the launcher `chrome.exe`
is still `151.0.7922.175` because Chrome finalizes the swap only once every
Chrome process has exited, and this machine had an open browser session.
ChromeDriver resolves against the registry, sees 152, and refuses the 151
launcher. The suite was therefore run against the installed 152 binary through a
throwaway configuration that imports `e2e/wdio.browser.conf.ts` and overrides one
field — the browser binary — and which was deleted before the commit; no
repository file, dependency or spec was changed for it. **The blocker clears by
itself on the next Chrome restart**, and the repository configuration is
deliberately left alone: pinning a machine-specific binary path in the tree would
be wrong, and CI does not run this suite.

### Two residuals, observed and not absorbed

**The dispatch window can end early against a slot this document has never
read.** `stateRef` starts at `idle`, so a conversion dispatched before the
mount-time slot read lands records `replacing: null` -- and the read that then
arrives carrying a *restored* queue has an operation identifier that is not
`null`, so the claim is marked reported and the panel shows that restored queue
instead of "Starting the conversion…" for the length of the destination picker.
Found by review on the repaired head, and **not repaired**: this slice's one
authorized repair pass was spent on the finding above it.

Measured rather than argued, against the exact head: no M6.1 invariant breaks.
The claim itself is untouched, so `laneClaimed` stays true and the start control
stays withdrawn; the rerun control is offered and **refused**, carrying the
lane's own `conversion-running` sentence; and nothing further crosses the
boundary. The cost is one wrong sentence in a race, and it is still an
improvement on `main`, where that same window offered an *enabled* `Convert`.
**Severity P3.** **Owner: M6.4**, the first slice downstream that adds a control
needing this rule. The fix is one lane fact rather than a new mechanism -- a
conversion may not start against a lane this document has not observed, which is
the same rule this slice already applies to every other fact, with
`installedSequence` as its synchronous half.

**`Retry`'s display twin has the same shape and is not M6.1's.** `retrying` is
read by the panel and the live region as `retrying && state.status ===
"terminal"`, and the retry command likewise answers once, when the whole rerun is
over -- so a poll that installs the *finished* rerun before that command answers
leaves the panel saying "Retrying the failures…" over a queue that is done. It
predates this slice, is unchanged by it, and is a **progress-truthfulness**
defect rather than an availability one: the lane is correctly claimed throughout
and no control is offered that would be refused. The signal that would close it
is a different one from the conversion claim's -- a rerun keeps its queue's name
and advances `retryRound` -- so it is a separate fix, not a free ride on this
one. **Owner: M6.8**, which ADR 0043 gives truthful progress. Severity: P3, cosmetic
and self-clearing within one command round trip.

### What this slice does not do

It adds no setting and no `ConversionIntent`, no command and no queue-model
change; it changes no destination semantics, no queue membership or scope, no
cancellation behaviour, no conversion scientific semantics and no provider
evidence. It builds no generic command or permission framework — the lane is
conversion's own, not a registry — and it changes no viewer planner. It does not
start M6.2.

## M6.2 — `msconvert` capability and evidence, 2026-09-02

The milestone's evidence slice. **It implements nothing**: no setting, no
control, no argv change, no `ConversionIntent`, no new provider admission. What
it produces is one durable record of what the installed build was observed doing,
so that M6.3 can type only measured semantics. The record is
[M6.2's evidence document](docs/spikes/M6_MSCONVERT_CAPABILITY_EVIDENCE.md);
nothing is retold here that lives there.

Baseline `db4c48e5cc72ec6692aeb2fea74d3fe197d25b72`, clean and level with
`origin/main`.

### Route outcome

`MSCONVERT_CAPABILITY_MEASURED`. Twelve candidates, twelve terminal states, none
pending: nine `MEASURED_ADMISSIBLE`, two `MEASURED_REJECTED`, one
`EVIDENCE_BLOCKED` with what is missing and who owns it, plus one further item
blocked inside a candidate rather than as one of its own. **Two rejections and a
block are a complete outcome, not a failed one.** M6.2's job was to close the
candidate set honestly, and a candidate the build cannot be shown performing is
closed by saying so.

### The executable, and what does not transfer

`msconvert` release `3.0.26013 (47b13cf)`, build date `Jan 13 2026 14:42:37`,
`12,687,872` bytes, SHA-256 `9BB6F5D5…D590BD` — re-verified byte length, digest
and self-reported footer **after** the last measurement, so no binary that
replaced this one mid-run could have produced the observations. It is the same
digest `EVIDENCED_PROVIDER_BUILDS` already carries for three vendor families, and
**that changes nothing about what transfers**: those rows are evidence that this
build converted those acquisitions, not evidence about precision, centroiding or
mzXML. No row was added, removed or relaxed, and no production provider admission
changed.

### Three findings that change what later slices may assume

**The precision default is mixed, and nothing in this repository said so.**
Measured by decoding the output arrays and comparing them against two
independently computed references — the source `float64` value and its exact
`binary32` image. With no precision flag, m/z comes back exactly equal to the
source and intensity comes back exactly equal to its `binary32` image. The help
marks `--64` `[default]` and `--inten32` `[default]` in the same list, and a
reader taking either marker alone would have the wrong answer for one array.
**MSCanvas issues no precision flag, so every conversion this product has
performed has narrowed its intensities to 32 bits.** That is now a decision M6.3
types rather than one the provider's default takes.

**`--zlib` is already the default.** A run with no compression flag produces
arrays declared `zlib compression`. The unconditional `--zlib` in the argv
builder therefore selects what would have happened anyway, and `--zlib=off` is
what changes it. Compression and precision stayed separable under measurement:
holding `--64` fixed, zlib on and off decode to identical values across every
array of every spectrum, while the default and `--64` differ in intensity at the
same compression.

**mzXML fails the comparison CNV-002 is gated on.** On a document whose spectra
carry two source files, the mzXML writer kept only the two attributed to the
run's default source file — exit `0`, empty stderr, no counter — and then wrote
`msRun/@scanCount="4"` above the two `<scan>` elements it emitted. A consumer
trusting the declared count would read a two-spectrum document as a complete
four-spectrum conversion. The same document to mzML kept all four and preserved
their attribution, which is the control that makes this the writer's behaviour
rather than the reader's. **The disposition remains M6.10's**; M6.2 hands it a
measured refusal.

**`cwt` silently dropped real peaks.** Reading the decoded intensities beside the
m/z values separates two things a point count cannot. The default picker returned
every source peak apex **bit-identical in m/z and in intensity**, plus
zero-intensity padding entries at `apex ± 0.04` that carry no signal. `cwt`
emitted no padding and, on the three-peak spectrum, returned **one peak** — exit
`0`, empty stderr, no counter, on an input it had accepted. An algorithm that
discards signal a second algorithm recovers exactly, on the same input, has not
performed the operation that was asked for, and candidate 3 is rejected on that.
The rejection is **scoped to this evidence**: synthetic peaks seven points wide
may simply fall outside the wavelet detector's scales, so re-opening it needs a
representative profile acquisition rather than an argument.

A consequence worth carrying forward: **a point count is not a peak count.** An
integrity check comparing output array lengths against an expected peak count
would be wrong about a correct conversion.

### The consequence M6.3 has to read

**No scoped centroiding intent is constructible from admitted parts.** The scope
argument is positional after `<PickerType>` and is silently discarded without
one; the grammar admits only `cwt` or `vendor` as that token, and there is no
token for the default picker; `cwt` is rejected and `vendor` is blocked. So the
one admitted algorithm cannot be named, and the scope cannot be reached. M6.3 may
type unscoped centroiding on the default picker and **may not type "centroid MS2
only" or "centroid MS1+MS2" at all**. Both presets re-open on the same evidence
`cwt` needs — a representative profile acquisition — or on a lawful vendor
acquisition. Found by review; the record entailed it and did not say it, and now
says it.

### Two things measured that a careless slice would have got wrong

**`peakPicking msLevel=2` silently centroids every MS level.** `msLevel=` is
positional after `<PickerType>`, so with no picker token the argument is consumed
as the picker name, the build falls back to its local-maximum algorithm, and the
scope is discarded — while exiting `0`. The output records
`local maximum peak picker` and, unlike the correctly-scoped runs, carries no
`ms levels` userParam. **M6.3's argv mapping must always emit an explicit
`<PickerType>` before `msLevel=`.**

**`peakPicking vendor` substituted silently.** On an open source there is no
vendor reader; the request exited `0`, warned nothing, and produced output
identical to the default picker's in every respect except the recorded command
line. The substitution is invisible at the process boundary and visible only in
the output's own `userParam`, which names the implementation in **free text
rather than by CV accession** — all three selectors share `MS:1000035 peak
picking`. That is the channel M6.3's integrity comparison has to use, and it is
weaker than an accession.

### Fixtures, and why they are what they are

Three generated mzML documents, no acquisition, nothing proprietary, nothing
downloaded, and no absolute path committed. They are a pure function of
[`scripts/msconvert_evidence.py`](scripts/msconvert_evidence.py)'s constants and
were verified to regenerate byte-identically to the recorded SHA-256s.

The design decisions are the evidence's load-bearing part. Peak centres and
heights are **deliberately inexact in binary32**, because a measurement taken on
`500.0` would pass whatever the encoder did. The second source file is attributed
to **one MS1 and one MS2 spectrum**, because putting it on both MS2 spectra would
have made "drops by source file" and "drops by MS level" delete the same two
spectra and each look like proof of the other. And the third fixture exists
because the first version of the profile fixture had no flanking zeros, which
made ProteoWizard's wavelet picker refuse it — a fixture that could measure
nothing about `cwt` except that `cwt` rejected it. Every fixture was converted at
`--64 --mz64 --inten64` and decoded back **bit-identical** before any
transformation was judged against it.

### The two inherited P2 residuals, closed

**Numeric precision was missing from the route's finite candidate inventory.**
Closed: ADR 0043's M6.2 slice now names it, the evidence record measures the
provider default plus every explicit mode separately for m/z and intensity, and
`check_repo.py` refuses an inventory that carries fewer than three precision
candidates or none naming the default.

**The stale "two pending measurements" acceptance.** Closed: it counted a
non-candidate and a measured question as two outstanding gates. Existing-output
overwrite is **not a candidate, not a prerequisite, not a CNV-D4 authority and
not an M6.2 completion condition** — ADR 0009 sends the provider only into
private staging, so no measurement of it could authorize a destructive product
decision, and CNV-D4 is not reopened. The side-output half was measured in
M3.0.3 and M3.10; the non-mzML remainder was measured here. The acceptance now
reads as the conditional it always was, and the guard refuses the old sentence.

### The conditional side-output obligation

**Triggered, and measured.** mzXML remains a viable admission candidate for
single-source inputs, so the condition holds. All **twenty-nine** cases went
into fresh empty directories, and every directory afterwards held exactly one
entry — no sidecar, index, log or scratch entry.

**Four of the twenty-nine produce mzXML**: `X1`, `X2`, `X4` and `X5`, one of them
letting the backend name its own output. `X3` is the mzML control and is not one
of them. That count is derived from the committed case ledger rather than stated
in a sentence — an earlier version of this paragraph said *six*, which no case
list ever supported, and the guard now refuses a record that disagrees with the
ledger. The `cwt` failure case is the one to read carefully: it produced one
entry too, and that entry was the **unterminated partial** document rather than
an extra file.

### One repair, from review

Two P2 findings on the candidate head, both in this slice's own tooling and both
taken under the single authorized repair pass.

**The decoder truncated instead of refusing.** A binary payload that was not a
whole number of values at its declared width was sliced to the nearest complete
value, so a torn array would have come back looking like a shorter healthy one —
and every numeric claim in the record is a claim about what that decoder
returned. It now reports the payload as malformed and decodes nothing, checks the
mzXML pairing as well, and reports any spectrum whose stored length disagrees
with its declared length. Verified by truncating a fixture array by one byte
(refused, `0` values decoded) and by mislabelling a declared length (reported),
then re-reading all twenty-nine outputs: none malformed, none disagreeing. The
one exception corroborates a finding rather than contradicting it — the failed
`cwt` run's partial output **does not parse at all**, so what that failure leaves
behind is an unterminated document rather than a smaller valid one.

**The side-output disposition was checked by substring.** "Whether the condition
was triggered is still pending" contained `triggered` and would have passed,
which is the one ending the obligation rules out. The record now declares an
explicit `TRIGGERED_AND_MEASURED` or `NOT_TRIGGERED` token and the validator
requires exactly one of them.

### Residuals: the harness is an inspector, not a validator

Review found **four** instances of one property after the single authorized
repair pass had been spent, so all four are recorded rather than fixed, and they
are recorded as one item because they are one property. `inspect` reports what a
document contains; its silence is not a certificate of validity. It does not
validate base64 syntax, does not notice a spectrum missing an array entirely,
does not read mzXML's run-level `msRun/@scanCount`, and checks nothing structural
beyond width alignment and declared length. A fifth, in the guard rather than the
harness: the side-output disposition is matched against the section's prose
rather than against the declaration line, so `Disposition: PENDING` beside a
later mention of the valid token would satisfy it.

**None is load-bearing, and that was verified rather than asserted.** Every
numeric conclusion is a positive equality against two independently computed
references, and a wrong document fails that comparison rather than passing it.
Run against the fixture: removing the intensity array leaves every flag clean and
**fails** the record's own equality check, so the analysis catches it whatever the
flag says; inserting a stray `$` leaves every flag clean and **passes**, correctly
— dropping the character leaves the decoded bytes, and therefore the values,
unchanged. What the gaps cost is the ability to tell a corrupt document from a
healthy one, which this slice never needed.

**P3. Owner: M6.10**, the next slice to measure a non-mzML format, as one change
rather than five patches.

**More of the same family, in the runner and the guard.** Review enumerated
instance after instance across three rounds on the corrected head — they are not
counted here, because an exhaustive list goes stale and the property does not —
and they share one shape: **the driver's
thirty-three checks are the confirmations this slice was required to reproduce,
not every basis the classifications rest on.** No `cwd` is passed, so a
conversion inherits the caller's directory; `posture` is copied rather than
compared for twenty-seven cases; `K5`/`K6` run without being compared; the
default-picker check reads one spectrum and one array; the MS-level checks
compare ids and not arrays; `P1` and `P2` run without being shaped.

**Every one is a missing check, not a wrong result**, and each underlying fact
was verified directly rather than argued. The whole set re-run from a directory
created empty left only the driver's own report — **`msconvert` wrote nothing to
its process working directory across all twenty-nine cases** — with the worktree
unchanged. Every exit matched its declared posture, 29 / 29. All four spectra of
`K1` have every non-zero point bit-identical to its source apex in **both** m/z
and intensity. Both surviving spectra of `L1` and `L2` are **value-identical** to
the source in both arrays, which is stronger than the length comparison the first
analysis made. And `P1`/`P2` are exact `float64` and the exact `binary32` image
respectively, both arrays, all spectra.

Later rounds added three more of exactly the same kind, each verified the same
way: compression is declared consistently across all eight arrays of all four
spectra in `D1`, `C1` and `C2`; `K12`'s composition has the same peak counts as
`K1` with every value the exact `binary32` image; and all twenty-nine rows of the
record's case table agree with the ledger on all seven fields, not just the two
the guard compares.

**P3. Owner: M6.10**, as one pass over the runner and the guard rather than a
patch per instance. The evidence record states the distinction in its own words
and lists instances illustratively rather than exhaustively, so `33/33 agree` is
not read as "every basis re-verified" and the list cannot go stale.

### What the guard does not do, stated rather than left to be discovered

The guard's own limits, because a validator's reputation outruns it faster than
anything else in a repository.

**Two verified holes, both found by review and both P3.** A candidate deleted
from *all three* of the inventory, the classification and the matrix passes,
because those three are compared against each other and only precision is
additionally required against the route — reproduced with
`compression zlib off`. And the route outcome is checked for being one token
from a closed set, not for agreeing with the states beneath it, so flipping it to
`MSCONVERT_CAPABILITY_EVIDENCE_BLOCKED` while nine candidates remain
`MEASURED_ADMISSIBLE` passes. Neither is reachable from the record as committed;
both are things a later edit could do. **Owner: M6.10**, and the right shape is
to structure the route's candidate list and compare it to the classification the
way the dimension vocabulary already is, rather than special-casing a second
candidate.

**One obligation is deliberately not mechanised.** A guard against *describing
help or source reading as measured installed-build execution evidence* is a claim
about prose, and this repository's validators do not read prose — every one of
them says so, in the same words: whether an answer is any good stays a matter for
review. What is mechanised instead is the structure that claim lives in: the
evidence record must keep its candidate inventory, its classification, its matrix
and one route outcome, and the route must keep the candidate list and dimension
vocabulary those are checked against. **The rule itself is enforced by review**,
and it is written into the evidence record as its own section rather than into
`check_repo.py`. Recorded here so that a reader does not mistake the guard's
silence on it for coverage.

Two of the threads were resolved on the pull request before they had been read —
a mistake, corrected by reopening both, dispositioning them, and replying with
the classification before resolving them again. Recorded because a thread closed
without being read is indistinguishable from one that was answered.

### The correction, and the driver that makes it hold

Review caught the record claiming **six** mzXML runs where four exist, and naming
**28** of 29 cases. Both were true defects: the count was the sentence discharging
the side-output obligation, and the missing case was `K9`, the no-filter baseline
that makes `K7`'s partial output legible. Neither was reachable by any check,
because the cases lived in prose.

**The root fix is that the measurement set is now data and the data is
executable.** `scripts/msconvert_evidence.py` gained a `CASES` ledger — 29 rows,
each with its fixture, its exact argv tokens in order, its output format, its
naming mode, its expected posture and what it is for — plus the fixture and
executable identities the evidence is bound to. `scripts/msconvert_evidence_run.py`
runs it: regenerate the three fixtures and check them against their recorded
digests, check the installed executable against the bound identity, enumerate the
ledger, execute each case as an argv **list** into a **fresh empty directory**,
read the output back through the shared inspector, count directory entries,
recheck the executable afterwards, and emit a normalized report carrying no
absolute path. The working tree is a temporary directory and is removed once the
facts are captured.

**The whole set was re-run from it.** 29 cases, 29 directories each holding
exactly one entry, executable byte length and digest and release and build date
identical before and after, and **33 of 33 independent confirmations agreeing**
with the record. No candidate classification changed. `X4` and `X2` and the
fixtures reproduced byte-identically; the mzML outputs did not, and that is why
sizes are now stated as relations — `msconvert` stamps its command line into an
mzML document, so its byte count moves with the paths of the run that produced
it. The record's absolute mzML sizes were replaced with the relations the rerun
confirms.

**And the counts are structural now.** The guard holds three independent
statements of one set equal: pinned constants, the committed ledger, and the
record's own measured-cases table. It refuses a deleted `K9`, a duplicated id, a
thirtieth case, an `X3` that stops being the mzML control, a ledger row whose
declared format its arguments do not select, a record row disagreeing with the
ledger, a missing table, and the literal `six mzXML` regression. **Ten mutations
were applied one at a time and all ten were caught**, on top of the twelve
already covering the candidate closure.

### Repository guard

`check_repo.py` gains one focused validator on the M5.4 precedent: the route owns
the dimension vocabulary, the evidence record holds the answers, and the two are
held equal as sets. It refuses a dropped precision candidate, a missing default,
a candidate with no state or a state outside M6.2's three, a candidate that
leaves the matrix, a blank intersection, a second or undefined route outcome, a
reintroduced overwrite candidate, a missing side-output disposition, and the
stale acceptance sentence. **Twelve mutations were applied one at a time and all
twelve were caught**, each with its own message.

An earlier run of that mutation suite reported twelve catches falsely: a lost
backslash had left `check_repo.py` unparseable, so every mutation "failed" for
the same unrelated reason. Recorded because a green mutation suite that is green
for the wrong reason is worse than none.

### Validation

`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
--all-features -- -D warnings`, `cargo test --locked --workspace --all-targets`,
`python -B scripts/check_repo.py`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm e2e:typecheck` and `git diff --check`, each run directly on
the final head and each exiting zero. Rust **1,350** and frontend **1,398**,
both unchanged — a slice that touches no product code should move neither.

**Browser E2E was not run, and is not described as green.** This slice changes no
frontend file, no CSS and no rendered behaviour; the changed paths are one
evidence document, one evidence harness, one repository validator and four
records. `apps/desktop/AGENTS.md` requires a browser pass for *rendered UI work*,
and there is none here. Running it would have produced a number with nothing
behind it.

### What this slice does not do

It admits no setting, exposes no control, changes no argv builder, no DTO, no
wire vocabulary, no destination or cancellation behaviour, and no dependency or
lockfile. It does not decide MSCanvas's precision policy, does not make the mzXML
disposition, does not absorb M6.8's cancellation evidence, and does not start
M6.3.
