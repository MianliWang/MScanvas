# M0 ProteoWizard technical spike

- **Status:** Blocked/incomplete; official portable provenance and archive safety verified, but no existing isolated Windows environment was available
- **Date:** 2026-07-24
- **Starting commit:** `595b6885e2550967ab9af5da1449296e04f49117`
- **Target branch:** `spike/m0-proteowizard`
- **Architecture decision:** Deferred; `msaccess` is not accepted for implementation, but it is not rejected

## Executive result

Phase 0 passed on the required Windows-native toolchain. The continuation preflight preserved the validated uncommitted M0 work on `spike/m0-proteowizard`: `HEAD`, the required base and the existing `origin/main` remote-tracking ref all resolved to `595b6885e2550967ab9af5da1449296e04f49117`; ahead/behind was `0/0`; the index was empty; and no unrelated change or prohibited backend artifact was present. Bounded backend discovery still found no host-installed `msconvert.exe` or `msaccess.exe`.

The earlier official Windows x64 MSI remained prohibited after Windows reported it as `NotSigned`; it was not executed or installed. Under the narrower continuation authorization, the official download page's `Windows 64-bit tar.bz2` selection, its `bt83.xml` release record and the site's own JavaScript resolver established the portable artifact URL without URL guessing. The portable archive downloaded with HTTP `200`, zero redirects, a byte length of `97,078,806` and SHA-256 `A0B92B40456E080B1CB5CBEDAE0B95664F43FE3B723972FE388A60E0341564E2`.

All 265 archive members were enumerated before extraction. The archive had no absolute, drive-qualified, UNC, parent-traversal or alternate-data-stream path; no duplicate normalized path; and no link or other non-file/non-directory entry. Extraction remained inside a fresh temporary root with no reparse point. The distribution contained one `msconvert.exe` and one `msaccess.exe`; neither target executable was Authenticode-signed. A private inventory covered all 20 executables and 191 DLLs: 80 binaries had valid signatures and 131 were unsigned. Microsoft Defender was registered but its scanner reported `Product/Feature disabled`, so no antimalware result is claimed.

Windows Sandbox was not enabled or runnable, and enabling it was forbidden. The host also had no Hyper-V VM provider and no existing Windows VMware guest; its registered VMware guests were non-Windows. No other supported hypervisor was available. The fail-clean isolation gate therefore stopped before any portable executable, fixture, help probe or backend operation was staged or run.

Windows Installer metadata contains a residual ProteoWizard version string, `3.0.26013`, but its product state is `ABSENT`. That is evidence of stale installer registration only. It is not an installed version, an executable discovery result, or proof that either command can run.

The spike therefore establishes portable provenance, archive/binary identity and tested adapter/process contracts, but it provides no executable-reported build identity or measured evidence for metadata preview, TIC/BPC, spectrum extraction, conversion, real-backend cancellation, output parsing, locale stability or vendor-format coverage. ADR 0003 remains proposed, and every runtime capability remains status D (still unverified).

## Scope and evidence rules

This report covers only the M0 technical questions around:

- deterministic discovery and version probing;
- narrow `msaccess` preview operations;
- typed `msconvert` conversion planning;
- process capture, cancellation and failure classification;
- fixture provenance and the evidence still required for an architectural decision.

It does not claim a production UI, persistent queue, stable CLI, general plugin system, analysis workflow, installer, or bundled ProteoWizard distribution. A code path or mock test is not reported as real ProteoWizard behavior.

Any explicitly authorized local acquisition belongs under the ignored `local-data/proteowizard/` convention. Every harness run must use a fresh empty directory under ignored `local-output/proteowizard-spike/`; the harness rejects a non-empty output directory before backend data-operation execution so unmeasured backend overwrite behavior is never relied upon.

## Sanitized environment

| Item | Verified value |
| --- | --- |
| Operating system | Windows native, Microsoft Windows `10.0.26200` |
| Shell | PowerShell `7.6.3` |
| Node.js | `v22.15.1`; satisfies repository Node 22 contract (`>=22.13.0 <23`) |
| pnpm | `11.15.1` exact |
| Rust compiler | `rustc 1.97.1 (8bab26f4f 2026-07-14)` |
| Cargo | `1.97.1` |
| Python | `3.14.3` |
| GitHub CLI | Authenticated; account identity omitted from this sanitized report |
| ProteoWizard | Host backend unavailable; portable archive statically inventoried but not executed; no executable-reported version |

Machine names, user-profile paths, environment dumps, acquisition names and sample identifiers are intentionally omitted.

## Official installer trust gate — fail-clean result

| Evidence | Verified result |
| --- | --- |
| Official selection page | [`https://proteowizard.sourceforge.io/download.html`](https://proteowizard.sourceforge.io/download.html), Windows 64-bit installer with vendor-file support except T2D |
| Official release record | [`https://proteowizard.sourceforge.io/releases/bt83.xml`](https://proteowizard.sourceforge.io/releases/bt83.xml) |
| Exact artifact URL | [`https://mc-tca-01.s3.us-west-2.amazonaws.com/ProteoWizard/bt83/4105969/pwiz-setup-3.0.26204.a09eea9-x86_64.msi`](https://mc-tca-01.s3.us-west-2.amazonaws.com/ProteoWizard/bt83/4105969/pwiz-setup-3.0.26204.a09eea9-x86_64.msi) |
| Filename | `pwiz-setup-3.0.26204.a09eea9-x86_64.msi` |
| Advertised identity | Release `3.0.26204`; build `a09eea9`; TeamCity build `4105969` |
| HTTP result | `200`; final response URI exactly matched the artifact URL; no redirect; `91,484,065` bytes |
| SHA-256 | `022D917131940CD1E9F7B1A52AC0C00F1332F11AE4B4B96F2C74B0D17297AFE5` |
| Windows Authenticode | `NotSigned`; signer/publisher and timestamper absent |
| Installer execution | **NOT RUN**; the missing signature triggered the required pre-execution stop |
| Installer UI/license/elevation | **NOT REACHED**; no installer terms were accepted and no administrator elevation occurred |
| Bundle/telemetry/install-location review | **NOT REACHED**; the signature stop preceded those installer checks |
| Post-stop state | No installation, alternate installer or unofficial source was attempted; the unexecuted MSI remains in user temporary storage outside the repository and is not tracked |

The advertised `3.0.26204` artifact identity is download metadata only. It must not be reported as an installed or executable-reported ProteoWizard version. It is separate from the older residual `3.0.26013` Windows Installer record whose `ProductState` is `ABSENT`.

## Official portable artifact and archive safety

The portable URL was derived from three mutually consistent official records:

1. the [ProteoWizard download page](https://proteowizard.sourceforge.io/download.html) labels selection value `bt83` as `Windows 64-bit tar.bz2 (able to convert vendor files except T2D)`;
2. the official [`bt83.xml` release record](https://proteowizard.sourceforge.io/releases/bt83.xml) names TeamCity build `4105969` and exact artifact `pwiz-bin-windows-x86_64-vc145-release-3_0_26204_a09eea9.tar.bz2`;
3. the download page's own [`main.js` resolver](https://proteowizard.sourceforge.io/js/main.js) maps that release record to the `mc-tca-01.s3.us-west-2.amazonaws.com/ProteoWizard/...` artifact path.

| Evidence | Verified result |
| --- | --- |
| Exact artifact URL | [`https://mc-tca-01.s3.us-west-2.amazonaws.com/ProteoWizard/bt83/4105969/pwiz-bin-windows-x86_64-vc145-release-3_0_26204_a09eea9.tar.bz2`](https://mc-tca-01.s3.us-west-2.amazonaws.com/ProteoWizard/bt83/4105969/pwiz-bin-windows-x86_64-vc145-release-3_0_26204_a09eea9.tar.bz2) |
| Advertised identity | Release `3.0.26204`; commit/build `a09eea9`; TeamCity build `4105969`; VC `14.5` x86_64 release build |
| HTTP result | `200`; zero redirects; final response URI exactly matched the official resolver URL |
| Content | `application/bz2`; `97,078,806` bytes; downloaded `2026-07-24T06:37:31Z` |
| SHA-256 | `A0B92B40456E080B1CB5CBEDAE0B95664F43FE3B723972FE388A60E0341564E2` |
| Official checksum | None published in the selection page or `bt83.xml` release record |
| Archive listing | `bsdtar 3.8.4`; 265 members; listing completed without archive error |
| Path/type safety | No absolute/drive/UNC/parent/ADS path, duplicate normalized path, symlink, hard link or other special entry |
| Extraction containment | 264 extracted items; zero outside the fresh root; zero reparse points |
| Portable contents | 20 executables, 191 DLLs, 14 `.config`, 12 `.xml`, 7 `.manifest` and expected schema/vendor-license support files |
| Antimalware scan | Unavailable: Microsoft Defender was registered but its scanner reported `Product/Feature disabled` and `0x80004005`, including with remediation disabled |

The complete private binary inventory contains relative path, size, SHA-256, Authenticode status, signer/timestamper and available version-resource fields for every executable and DLL. Its summary is:

| Binary | Size | SHA-256 | Authenticode |
| --- | ---: | --- | --- |
| `msconvert.exe` | `13,412,864` bytes | `4FEB0BA85D29E701234608CC502DF480DE1BC6C0DD2F715E4C12CB0FDEBB8087` | `NotSigned`; no signer or timestamper |
| `msaccess.exe` | `13,645,824` bytes | `71AEAE17FD55F58023DC104DEFC32CE6C6FDFEFC4E8068FCCFA1906E9C22CB38` | `NotSigned`; no signer or timestamper |
| All `.exe`/`.dll` files | 211 binaries | Inventory CSV SHA-256 `7A54F99D829B5B9552D0469FBE769679482C9ECA7311957FEE17784F8107599D` | 80 `Valid`; 131 `NotSigned` |

Unsigned portable executables were authorized only inside an existing isolated Windows environment. They were never launched on the development host.

## Isolation availability — fail-clean blocker

No authorized isolation environment was available:

| Check | Result |
| --- | --- |
| Windows Sandbox executable | `WindowsSandbox.exe` and `WindowsSandboxClient.exe` absent |
| Windows Sandbox feature state | Component packages had `CurrentState = 64` (staged payload, not installed/enabled); no optional-feature state key |
| Feature change | Not attempted; enabling Windows Sandbox/Hyper-V was forbidden |
| Hyper-V | `Get-VM` unavailable; `vmms` absent; `root/virtualization/v2` provider absent |
| VMware Workstation | Installed; zero running VMs; only two unique registered guest configurations, both non-Windows |
| VirtualBox/QEMU/other reviewed local managers | No runnable manager found |
| Existing disposable Windows VM | None |

The available VMware guests were not repurposed because they were not Windows environments and the Goal prohibited WSL or other platform substitution. No repository, profile, credential or portable binary was mapped into any guest.

## Phase 0 baseline

Before edits, local `main` and `origin/main` both resolved to `595b6885e2550967ab9af5da1449296e04f49117`, ahead/behind was `0/0`, the worktree and index were clean, and `origin/main` was the only remote branch apart from the symbolic `origin/HEAD` reference. The target branch was created only after the baseline passed.

| Command | Result |
| --- | --- |
| `python -B scripts/check_repo.py` | Passed |
| `pnpm install --frozen-lockfile --strict-peer-dependencies` | Passed; lockfile already up to date |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 1 file, 2 tests |
| `pnpm build` | Passed |
| `cargo fmt --all --check` | Passed |
| `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings` | Passed |
| `cargo test --locked --workspace --all-targets` | Passed: 5 tests |

This baseline predates the spike implementation. It does not validate later code changes or real ProteoWizard behavior.

### Continuation preservation snapshot

Before the portable continuation, the branch was still `spike/m0-proteowizard` at the required starting commit, with the same `origin/main` remote-tracking identity and no staged content. The five modified and seven untracked paths were all reviewed as M0 spike work; no dependency manifest, lockfile, `LICENSE`, generated backend artifact or unrelated user change was present. `git diff --check` passed.

A private inventory outside the repository recorded the branch, commit identities, modified/untracked paths, timestamp and SHA-256 `55573450b86c29d2795715f68e52fcbe4493a101d7f680d606b760379fa9e2c4` for the exact tracked `git diff --binary` byte stream. Private temporary roots are intentionally omitted from this report.

## Backend discovery evidence

Discovery was bounded to installed-program metadata, exact executable resolution on `PATH`, and reviewed normal installation roots such as `%ProgramFiles%` and their platform equivalents. No drive-wide or acquisition-data search was performed.

| Evidence | Observation | Interpretation |
| --- | --- | --- |
| Explicit configured location | None supplied for preflight | No configured-home or configured-executable candidate could be tested |
| `PATH` | Neither exact executable resolved | No `PATH` candidate |
| Reviewed common installation roots | Neither executable found | No common-root candidate |
| Windows Installer metadata | Residual version `3.0.26013`; `ProductState = ABSENT` | Stale registration, not an installed backend |
| Official installer candidate | Advertised `3.0.26204`; SHA-256 recorded; Authenticode `NotSigned` | Downloaded but unexecuted and uninstalled; mandatory host-install trust gate failed |
| Official portable candidate | Advertised `3.0.26204` / `a09eea9`; archive and target executable hashes recorded | Provenance/archive safety verified; executable use blocked by unavailable isolation |
| `msconvert.exe` | Not found | Conversion executable unavailable |
| `msaccess.exe` | Not found | Preview executable unavailable |
| Verified ProteoWizard release/build | None | Cannot be inferred from MSI metadata |

The correct host availability state remains `unavailable`. The extracted portable paths are artifact-inventory evidence only and were deliberately excluded from host discovery and execution. A future positive result must stage both tools in an authorized isolated Windows environment, prove they belong to one distribution, launch them directly there, and derive release/build data from their own output.

## Installed command surfaces and real operations

No portable or installed command surface was inspected. The portable executables existed only in a temporary host extraction used for static inventory, and the isolation gate prohibited launching them on the host.

| Command or operation | Status | Reason |
| --- | --- | --- |
| `msconvert.exe --help` | **NOT RUN** | No authorized isolated Windows environment |
| `msaccess.exe --help` | **NOT RUN** | No authorized isolated Windows environment |
| Executable release/build probe | **NOT RUN** | Portable execution prohibited on host; no sandbox/Windows VM |
| `msaccess` metadata | **NOT RUN** | Isolation gate stopped before fixture acquisition or backend execution |
| `msaccess` run summary/counts | **NOT RUN** | Isolation gate stopped before fixture acquisition or backend execution |
| `msaccess` spectrum table | **NOT RUN** | Isolation gate stopped before fixture acquisition or backend execution |
| `msaccess` TIC | **NOT RUN** | Isolation gate stopped before fixture acquisition or backend execution |
| `msaccess` BPC | **NOT RUN** | Installed/portable runtime interface not inspected |
| `msaccess` selected-spectrum arrays | **NOT RUN** | Isolation gate stopped before fixture acquisition or backend execution |
| `msaccess` unavailable-scan case | **NOT RUN** | Isolation gate stopped before fixture acquisition or backend execution |
| `msconvert` mzML/mzXML | **NOT RUN** | Isolation gate stopped before fixture acquisition or backend execution |
| Compression and output-conflict cases | **NOT RUN** | No authorized isolated Windows environment |
| Malformed/unsupported input | **NOT RUN** | No authorized isolated Windows environment |
| Real process-tree cancellation | **NOT RUN** | No authorized isolated environment; the tiny fixture would also likely complete too quickly |
| Locale-sensitivity comparison | **NOT RUN** | No backend output exists |

Consequently there are no real-operation cold/warm timings, scientific output sizes/hashes, backend exit codes, parser results, stderr characteristics, locale findings, progress observations or partial-output observations. The `12.2`-second archive transfer is network provenance evidence, not backend performance. Historical online documentation is useful for orientation only; executable help/usage from the isolated portable build must remain authoritative before any argv is treated as supported.

## Open-format fixture candidate

The repository does not currently track a scientific mzML/mzXML fixture. The reviewed candidate is ProteoWizard's synthetic `tiny.pwiz.1.1.mzML` example:

- pinned source: <https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/example_data/tiny.pwiz.1.1.mzML>
- pinned raw URL: <https://raw.githubusercontent.com/ProteoWizard/pwiz/a09eea91209131f6aa487f7316647fc536188c19/example_data/tiny.pwiz.1.1.mzML>
- size: `25,072` bytes;
- SHA-256: `711ac14b666f14817c208bd4d39b738e96ac827574c4639d8f8f6eebbfde9c83`;
- license basis: ProteoWizard's pinned root Apache-2.0 license permits reproduction and distribution; the example-data writer carries the same license;
- provenance: synthetic in-memory ProteoWizard `examples::initializeTiny` test data, not a vendor or biological acquisition;
- structure: four spectra with MS levels `1, 2, 1, 1`, two chromatograms, m/z and intensity arrays, TIC data, and profile/centroid markers.

The candidate has not been downloaded or committed in this spike state.

| Suitable structural coverage | Not suitable evidence |
| --- | --- |
| Open-format metadata and count smoke checks | Vendor-reader availability or correctness |
| MS-level distribution and RT/TIC structure | A stored BPC chromatogram |
| One selected spectrum with m/z/intensity arrays | Conversion fidelity or archival equivalence |
| Deterministic unavailable-scan request | Realistic latency, memory or large-array transfer |
| Profile/centroid metadata parsing | Real-backend cancellation or partial outputs |
| CI-safe parser and argv fixtures | Scientific suitability or biological representativeness |

Acquisition must use the pinned raw URL, followed by exact size and SHA-256 verification before the unchanged bytes are considered for tracking. Attribution and provenance must remain adjacent to the fixture.

## Code-contract intent

The spike implementation is intended to keep all backend authority in Rust and preserve these invariants:

- discovery order is explicit configured home/executable, exact `PATH`, then reviewed common roots;
- `msconvert.exe` and `msaccess.exe` must resolve to one installation and report matching release and build-date identities;
- processes are spawned directly with typed argv values, never through a shell command string;
- configured, input and output paths are resolved to canonical absolute paths before planning, so changing the backend working directory cannot reinterpret them;
- Unicode and space-containing paths remain individual operating-system string arguments;
- stdout, stderr, exit code, elapsed time and termination state are captured separately; each diagnostic stream is fully drained but retained only up to an 8 MiB prefix with total-byte and truncation metadata;
- installed-help probes have a 15-second deadline and owned-process cancellation rather than an unbounded blocking wait;
- bounded raw probe prefixes are retained, and non-probe harness modes reject either truncated help stream before requiring every option/query marker used by the typed plan to appear in the complete installed `--help` capture;
- reportable diagnostics redact the exact configured input/output and profile-path spellings, with Windows alias limitations recorded below;
- after successful Job assignment, cancellation targets only processes attached to the owned Windows Job; the assignment race below remains;
- the harness does not write to or delete source acquisitions, and output is rejected when it equals or is nested inside a directory-formatted input; real backend behavior remains unverified;
- the spike harness refuses to execute against a non-empty output directory rather than relying on unverified backend overwrite behavior;
- conversion planning has an explicit output format and output directory and does not insert a peak-picking filter for the no-additional-centroiding intent;
- backend failures receive a stable normalized kind and summary; raw technical detail remains sensitive and is redacted before printing or sharing.

The current typed intent covers metadata, run summary, spectrum table, TIC with an optional MS-level filter, one spectrum by index, and mzML/mzXML conversion with zlib. These mappings are provisional until compared against the installed build's help output. Their presence in code is not evidence that a real installed build accepts the arguments or produces stable machine-readable output.

### Provisional typed argv

Every row below is an argv plan, not a shell command. Paths remain individual `OsString` values, quoted display below is only used to show query arguments that contain spaces, and no row has been executed against ProteoWizard in this environment.

| Operation | Tool | Planned argv after executable |
| --- | --- | --- |
| Installed help/release probe | `msconvert.exe` and `msaccess.exe` | `--help` |
| Metadata | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `metadata` |
| Run summary | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `"run_summary delimiter=tab"` |
| Spectrum table | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `"spectrum_table delimiter=tab"` |
| TIC | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `"tic delimiter=tab"`; typed plans may append `--filter`, `"msLevel <N>"` |
| Spectrum by zero-based index | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `"binary index=<N> precision=8"` |
| mzML conversion | `msconvert.exe` | `<input>`, `--mzML`, `--zlib`, `--outdir`, `<fresh-output-dir>` |
| mzXML conversion | `msconvert.exe` | `<input>`, `--mzXML`, `--zlib`, `--outdir`, `<fresh-output-dir>` |

The developer-only invocation shape is `cargo run --locked -p mscanvas-proteowizard --example m0_proteowizard_spike -- --mode <mode> [explicit options]`. It is intentionally unstable. Non-probe modes require captured installed help to contain every operation-specific marker before the harness builds or executes the plan.

## Phase findings

| Phase | Evidence-backed status |
| --- | --- |
| Portable provenance | Official selection/release/resolver chain, archive hash, static binary identity and Authenticode inventory verified |
| Isolation | Blocked: Windows Sandbox not enabled and no existing disposable Windows VM |
| Discovery/version | Negative host discovery observed; portable executable-reported identity unverified because execution was prohibited outside isolation |
| Developer harness | Live negative probe passed: sanitized `backend_not_found`, exit 1; real backend execution not run |
| Installed command surfaces | Not run; isolation blocker |
| Open-format smoke | Candidate identified and licensed; phase ordering stopped before file acquisition |
| Vendor RAW smoke | Not run; real vendor RAW was explicitly outside this Goal |
| Conversion | Not run; no mzML/mzXML, conflict, permission or malformed-input evidence |
| Progress | Unverified; no real backend output was available to determine whether either tool exposes reliable progress |
| Cancellation | Controlled Windows Job Object tests passed both while the root remained alive and after it exited with a surviving descendant; real backend not run |
| Failure classification | Stable contract tests passed; locale-dependent stderr semantics intentionally remain generic and real mapping is unverified |
| Architecture decision | D for all runtime capabilities; insufficient measurements for option A, B or C |

## Conversion and representation findings

No conversion was performed. The typed planner's absence of a peak-picking filter proves only the planned argv invariant; it does not prove that a backend performed no additional centroiding or that output representation matches input representation.

No generated mzML/mzXML was inspected for CV metadata, profile/centroid representation, compression, mixed-representation behavior or backend output conflicts. The harness's fresh-empty-directory preflight is a spike safety boundary, not evidence about ProteoWizard's own conflict semantics, and it does not replace a later transactional output design. No converted open format is claimed to be a lossless archival replacement for a source acquisition.

## Cancellation and process-tree findings

No real ProteoWizard cancellation was attempted, so backend child-process behavior, termination latency and partial-output behavior remain unknown. Controlled Windows tests launched a parent plus grandchild inside an owned Job Object and proved end-to-end `cancelled` classification while the root remained alive. Root-exits-first tests proved later cancellation observation and zero remaining Job processes. The two subprocess entry-point tests are intentionally ignored during ordinary discovery; the supervising tests invoke them directly.

Stable Rust's `std::process::Command` still has a narrow spawn-to-job-assignment race because it does not expose suspended creation or a job-list process attribute. The controlled helper waits until assignment before creating its child, so it validates owned-tree termination but does not prove a race-free production spawn invariant.

The continuation hardened the post-root-exit edge offline. When cancellation is first observed after the root exits, successful Job termination now starts a fresh bounded empty-Job drain deadline instead of reusing an already expired pre-cancellation deadline. A deterministic late-cancellation test proves cancellation remains observed rather than becoming a timeout-derived supervision error, while a real controlled surviving descendant still returns `TimedOut` when no cancellation occurs. This is process-contract evidence only, not a real ProteoWizard cancellation claim.

The spike must not infer real-backend cancellation success from a mock. A later run needs a backend operation long enough to interrupt safely, and it must inspect partial output without deleting source data.

## Failure-classification matrix

Each normalized failure carries a stable kind, a concise summary, technical detail, retryability and suggested corrective action. Technical detail is retained for diagnostics but must not be the only user-facing message.

| Stable kind | User-facing summary | Retryability | Suggested action | Evidence status |
| --- | --- | --- | --- | --- |
| `backend_not_found` | ProteoWizard is not available | After correction | Install separately or select a valid installation folder | Negative discovery observed; positive recovery unverified |
| `msconvert_missing` | Converter is missing | After correction | Select/repair one installation containing both tools | Contract only |
| `msaccess_missing` | Preview tool is missing | After correction | Select/repair one installation containing both tools | Contract only |
| `version_probe_failed` | Version self-test failed | After correction | Check the selected installation and runtime prerequisites | Contract only |
| `backend_launch_failed` | Backend could not be started | After correction | Check the executable, Windows runtime and installation | Contract test only |
| `unsupported_input` | Backend cannot read the input | Not retryable unchanged | Confirm format and licensed reader availability | Contract only |
| `permission_denied` | Windows denied a required path | After correction | Choose readable input and writable output, then retry | Contract only |
| `output_conflict` | Requested output already exists | After correction | Choose another output or resolve conflict explicitly | Contract only |
| `unwritable_output_directory` | Backend cannot write to output | After correction | Choose an existing writable output folder | Contract only |
| `backend_non_zero_exit` | Backend stopped with an error | Retryable after review | Preserve diagnostics, correct input/settings, and retry | Contract test only; remains primary until installed locale/output are measured |
| `malformed_parse_output` | Output cannot be interpreted | Not retryable unchanged | Preserve build/operation detail and report incompatibility | Contract only |
| `cancelled` | Operation was cancelled | Retryable | Inspect any partial output, then retry when ready | Controlled process-tree test passed; real backend unverified |
| `partial_output_present` | Incomplete output remains | After correction | Keep source unchanged and explicitly relocate/remove partial output | Contract only |
| `unexpected_internal_error` | MSCanvas could not supervise the backend | Retryable after review | Preserve diagnostics and inspect installation/process state | Contract only |

`partial_output_present` may also accompany another primary failure rather than erasing it. Real backend messages, exit codes and retry behavior are unverified.

## Per-capability architecture status

No global `msaccess` decision is justified. Status meanings are A (sufficient), B (partially sufficient with named limits), C (unsuitable) and D (still unverified).

| Capability | Status | Evidence and measured characteristics | Parsing/scientific limitation | Proposed owner |
| --- | --- | --- | --- | --- |
| Discovery/build identity | **D** | Official portable archive and static executable hashes verified; no executable-reported identity or help timing | Download metadata cannot substitute for runtime identity | ProteoWizard adapter |
| Metadata | **D** | No operation, schema, latency or output volume measured | Fields, units, locale and open/vendor parity unknown | ProteoWizard adapter candidate |
| Run summary/counts | **D** | No counts, MS-level distribution or RT range measured | Provisional `run_summary` mapping unconfirmed | ProteoWizard adapter candidate |
| TIC | **D** | No trace, timing or numeric output measured | Delimiter, units, MS-level filtering and correctness unknown | ProteoWizard adapter candidate |
| BPC | **D** | No runtime capability discovery | Fixture does not contain a stored BPC; computation/interface behavior unknown | ProteoWizard adapter candidate, otherwise deferred provider evaluation |
| Scan listing | **D** | No row schema, paging/size or latency measured | Index/native-ID relationship and locale stability unknown | ProteoWizard adapter candidate |
| Selected spectrum | **D** | No arrays or representative spectrum measured | Precision, units, profile/centroid representation and native-ID semantics unknown | ProteoWizard adapter candidate |
| Repeated interactive navigation | **D** | No repeated process latency or cache behavior measured | Tiny fixture cannot establish realistic navigation suitability | Deferred until provider timing; likely Rust cache/provider boundary |
| Large-array transfer | **D** | No realistic array size, copy count, memory or output-volume measurement | Tiny fixture is structurally useful only | Rust cache/reader boundary; provider undecided |
| mzML/mzXML conversion | **D** | No scientific output, compression, conflict or failure case produced | No fidelity, representation or archival-equivalence claim | ProteoWizard adapter |
| Progress | **D** | No stdout/stderr progress token, channel or cadence observed | Elapsed time must not be presented as backend progress | ProteoWizard adapter plus shared Rust run state |
| Cancellation | **D** | Controlled Job Object contract tests only; no real backend timing or partial output | Mock process-tree evidence is not backend evidence | Shared Rust executor plus ProteoWizard adapter |
| Vendor-format coverage | **D** | Not run by explicit Goal boundary | Open mzML cannot establish proprietary-reader support | ProteoWizard adapter candidate, deferred |

Options A, B and C all remain open. No alternative parser or native bridge should be added during this evidence gap.

## Privacy, security and licensing

- No proprietary acquisition, ProteoWizard binary, DLL, SDK or vendor reader was placed in or committed to the repository. The portable archive and its extracted contents remained in private temporary storage for static safety/inventory checks only.
- No acquisition directory was searched, and no vendor phase was simulated.
- Paths in this report are environment-variable or generic paths; profile and sample identifiers are omitted.
- The application contract retains typed argv and direct process spawning; React receives no shell or unrestricted filesystem access.
- Diagnostic output must redact local profile, input and output paths before it becomes shareable.
- Raw probe/process output and normalized technical detail are sensitive internal diagnostics; only the explicit redacted reportable projection may be shared with UI/log/report surfaces. The current exact-path redactor is not a proof against every Windows alias form, so real-backend evidence must still be reviewed before publication.
- Installed-help validation must also fail closed if its bounded stdout or stderr capture is truncated; finding required markers in a truncated installed-help capture is insufficient evidence for this validation gate.
- The harness itself requires a dedicated fresh empty ignored output directory and does not delete source acquisition data; real backend behavior remains unverified.
- Any production ProteoWizard backend remains separately supplied/licensed by the user unless a later distribution ADR explicitly changes that policy; no current host installation was verified.
- The downloaded official installer remains unexecuted outside the repository. The portable archive was downloaded and statically inventoried but not executed. No installer, archive, executable, DLL, SDK, license payload or vendor component is tracked or redistributed.
- No repository, user profile, credential, token, browser state or unrelated drive was exposed to a guest.
- A Defender scan was attempted with remediation disabled, but the registered product reported its scanning feature disabled; archive provenance and safe extraction do not imply a malware-clean claim.
- The proposed tiny mzML fixture is Apache-2.0 synthetic test data with pinned provenance; it is not yet tracked.
- MSCanvas source acquisitions remain read-only, and workspace removal never means source-data deletion.

## Explicitly untested and blockers

The following blockers prevent completion of M0 evidence:

1. Windows Sandbox is not enabled/runnable, and enabling it was explicitly unauthorized.
2. No already available disposable Windows VM exists; the installed VMware inventory contains only non-Windows guests.
3. Portable execution is authorized only inside one of those isolated Windows environments, so the statically inventoried `msconvert.exe` and `msaccess.exe` cannot be launched on this host.
4. Installed/portable help, executable-reported release/build identity and locale behavior therefore remain unavailable.
5. The lawful open-format fixture was not acquired because the fail-clean isolation gate precedes fixture acquisition and staging.
6. Real vendor RAW testing was explicitly outside this Goal.
7. No real preview, conversion, backend failure, cancellation or partial-output measurement exists.
8. Large-file latency, memory, process and repeated-navigation behavior remain entirely unmeasured.

## Recommended next vertical slice

The next slice should be **provision an approved disposable Windows evidence environment, then run the pinned open-format matrix**, not UI or a second provider:

1. Separately authorize and prepare an already enabled Windows Sandbox or a genuinely disposable Windows VM; this Goal did not authorize changing host optional features or repurposing non-Windows guests.
2. Re-verify the same portable archive hash, stage only its extracted distribution plus the minimal harness and pinned fixture, and disable guest networking before execution.
3. Capture both executables' complete non-truncated help and executable-reported release/build identity before accepting any provisional argv.
4. Acquire the pinned synthetic mzML fixture, verify its exact size and SHA-256, and keep generated outputs outside the repository.
5. Run metadata, counts, MS-level distribution, RT/TIC, BPC capability discovery, scan table, one spectrum, unavailable-scan and mzML/mzXML conversion cases with cold/warm timing, output hashes, locale and failure evidence.
6. Attempt real cancellation only if an operation is safely interruptible. Keep vendor coverage and realistic large-file performance as separate later gates.
7. Decide metadata, TIC, scan-list, spectrum, conversion, progress and cancellation capabilities independently as A/B/C/D.

## Implementation validation evidence

The continuation's targeted offline corrections passed before the final publication gate:

| Command | Result |
| --- | --- |
| `cargo test --locked -p mscanvas-proteowizard --all-targets` | Passed: 28 library tests plus 5 harness tests; 2 controlled subprocess entry points intentionally ignored |
| `cargo clippy --locked -p mscanvas-proteowizard --all-targets --all-features -- -D warnings` | Passed |
| `cargo fmt --all --check` | Passed |

The earlier pre-continuation repository-wide evidence was:

| Command | Result |
| --- | --- |
| `cargo test --locked -p mscanvas-proteowizard --all-targets` | Passed: 29 tests; 2 controlled subprocess entry points intentionally ignored (26 library plus 3 harness tests) |
| `cargo clippy --locked -p mscanvas-proteowizard --all-targets --all-features -- -D warnings` | Passed |
| `cargo fmt --all --check` | Passed |
| `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings` | Passed |
| `cargo test --locked --workspace --all-targets` | Passed: 32 tests; 2 controlled subprocess entry points intentionally ignored |
| `python -B scripts/check_repo.py` | Passed |
| `pnpm install --frozen-lockfile --strict-peer-dependencies` | Passed; lockfile already up to date |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 1 file, 2 tests |
| `pnpm build` | Passed |
| `pnpm tauri build --no-bundle` | Passed; built an ignored Windows release executable |
| Live harness `--mode probe` | Expected negative host result: sanitized `backend_not_found`, exit 1, no local path in output |
| `git diff --check` plus explicit untracked-file whitespace scan | Passed |

These results validated the preserved pre-continuation contents. The fail-clean publication path additionally requires the Goal's complete final Windows validation suite against the final worktree before either focused commit is created. Actual final command results and commit SHAs are reported in the final Goal handoff so the tracked report does not require a self-referential follow-up commit.

Publication scope is exactly two focused commits—implementation first, evidence documentation second—followed by a non-force push of `spike/m0-proteowizard`. This Goal explicitly forbids pull-request creation and merge, so no PR placeholder or PR result belongs in this report.
