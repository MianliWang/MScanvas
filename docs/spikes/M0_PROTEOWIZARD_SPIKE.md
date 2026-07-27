# M0 ProteoWizard technical spike

- **Status:** Bounded open-format runtime evidence and M0C Slice 1 preview contracts complete; the provider decision remains capability-specific and M0 is incomplete
- **Date:** 2026-07-24
- **Starting commit:** `595b6885e2550967ab9af5da1449296e04f49117`
- **Target branch:** `spike/m0-proteowizard`
- **Architecture decision:** Partial; `msaccess` is a viable bounded provider for some preview operations, with named B/C/D gaps below
- **Contract-only update:** 2026-07-26; no additional ProteoWizard execution

## Executive result

Phase 0 passed on the required Windows-native toolchain. The continuation preflight preserved the validated M0 work on `spike/m0-proteowizard` from required base `595b6885e2550967ab9af5da1449296e04f49117`; no unrelated change, dependency change, license change or prohibited backend artifact was present. Bounded host discovery still found no installed `msconvert.exe` or `msaccess.exe`.

The earlier official Windows x64 MSI remained prohibited after Windows reported it as `NotSigned`; it was not executed or installed. Under the narrower continuation authorization, the official download page's `Windows 64-bit tar.bz2` selection, its `bt83.xml` release record and the site's own JavaScript resolver established the portable artifact URL without URL guessing. The portable archive downloaded with HTTP `200`, zero redirects, a byte length of `97,078,806` and SHA-256 `A0B92B40456E080B1CB5CBEDAE0B95664F43FE3B723972FE388A60E0341564E2`.

All 265 archive members were enumerated before extraction. The archive had no absolute, drive-qualified, UNC, parent-traversal or alternate-data-stream path; no duplicate normalized path; and no link or other non-file/non-directory entry. Extraction remained inside a fresh temporary root with no reparse point. The distribution contained one `msconvert.exe` and one `msaccess.exe`; neither target executable was Authenticode-signed. A private inventory covered all 20 executables and 191 DLLs: 80 binaries had valid signatures and 131 were unsigned. Microsoft Defender was registered but its scanner reported `Product/Feature disabled`, so no antimalware result is claimed.

The local Windows Sandbox/VM gate remained unavailable without an unauthorized host change. The bounded continuation therefore used a fresh GitHub-hosted `windows-2025` disposable VM, not the development host. Exact public inputs and the hash-verified harness bundle were downloaded before execution. Three exact-path outbound-block firewall rules were verified in `ActiveStore`; all active profiles were enabled; and the unsigned tools and harness then ran as a temporary, non-elevated standard user with a five-key environment, protected inputs and scoped writable directories. Independent cleanup proved no owned process, rule, profile, user, logon-deny right, runtime root or private cleanup state remained.

Windows Installer metadata contains a residual ProteoWizard version string, `3.0.26013`, but its product state is `ABSENT`. That is evidence of stale installer registration only. It is not an installed version, an executable discovery result, or proof that either command can run.

Exact run [`30129182032`](https://github.com/MianliWang/MScanvas/actions/runs/30129182032), attempt 1, executed commit `f0d7957fbbe129263a9a89684b6ce549b1b3a086`. Both jobs and every cleanup/publication gate passed. Its sanitized evidence ZIP, artifact `8610469338`, was independently downloaded and matched GitHub's SHA-256 `8A07BBDBA9C195A311A00658A9FC7F086E83B6DA3943F41B12B90BC2ED23E927`; it contained only `summary.json` (`86,744` bytes, SHA-256 `23F9371378CE2E868C0534E7CA2F8985EA5FC7E12D929509A2096025D483C3B4`) and `summary.md` (`1,525` bytes, SHA-256 `1E8935B074181ADDB92BBC3698EA79060F39E2D7D029D2527458E62CFC59EABF`). Both passed source/run identity and forbidden-content review.

The evidence workflow was fail-clean throughout its short lifetime:

| Run / source | Result | Backend boundary |
| --- | --- | --- |
| `30085456902` / `4aa1df9` | Official tar root-anchor handling was too strict; no sanitized runtime artifact | stopped before extraction/backend execution |
| `30127083665` / `e39ed19` | `install_exact_firewall_blocks` / `firewall_rule_verification_failed`; corrected raw `UInt16[]` enforcement-state validation | stopped before standard-user/backend execution |
| `30128295076` / `7ec68e3` | `capture_complete_help_and_identity` / `unexpected_orchestration_failure`; valid zero-byte `msaccess` stdout was rejected by PowerShell binding | firewall and standard-user proof passed; no data operation ran |
| `30129182032` / `f0d7957` | success; 12 operations, complete teardown and sanitized publication | full bounded matrix completed |

The measured result is deliberately mixed. Complete help confirmed the current typed argv. Metadata, counts, TIC, filtered TIC, scan listing and selected-spectrum extraction produced parseable evidence on the four-spectrum synthetic fixture. mzML conversion passed structural/count/zlib checks. mzXML conversion returned exit 0 but serialized only three of four spectra, so it is unsuitable without mandatory integrity validation. `msaccess` also returned exit 0 with no output both for an unavailable spectrum and for an unsupported text input, showing that process exit alone is not semantic success. BPC, repeated navigation, large arrays, timestamped progress, real cancellation, a second locale and vendor RAW coverage remain D. ADR 0003 therefore remains proposed with per-capability A/B/C/D decisions rather than one global answer.

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
| Development-host ProteoWizard | Unavailable; no portable executable was launched locally |
| Isolated evidence VM | GitHub-hosted `windows-2025`; Windows Server 2025 Datacenter `10.0.26100`, image `win25-vs2026` `20260714.173.1`, AMD64, 2 logical processors, `8,584,425,472` physical-memory bytes, `en-US` |
| Isolated ProteoWizard | `msconvert` reported `3.0.26204 (a09eea9)`; `msaccess` reported `3.0.26204`; both came from the same hash-verified portable distribution |

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

The isolated run revalidated the exact target executable hashes but did not repeat Authenticode inspection; its `authenticodeStatus` is therefore `not_checked`. The `NotSigned` finding above comes from the earlier static host inventory of those hash-identical files.

Unsigned portable executables were authorized only inside an existing isolated Windows environment. They were never launched on the development host.

## Isolation environment and teardown

The local availability audit remains relevant historical evidence: Windows Sandbox was not enabled, Hyper-V was unavailable, and the existing VMware guests were non-Windows. No feature was enabled, no guest was repurposed, and no host security or installation state was changed.

The authorized runtime evidence used an ephemeral GitHub-hosted Windows VM. The workflow checkout existed only in the build job. The runtime job downloaded an exact artifact ID containing only the release harness, evidence script and SHA-256-verified manifest; verified every payload hash; then downloaded the two pinned public inputs. Within the runtime layout, the temporary standard-user token had read access to the staged portable distribution, fixture and harness and write access only to scoped output/evidence/temp directories. The repository workspace and internal bundle were protected from that token.

The internal bundle was artifact `8610442271`, GitHub service digest `D625B8D5403DA90AE0823A4717B4E76E3D513A3A07EA6F6E98FB2DC233FABCE3`, with verified manifest SHA-256 `20126647391E9A3CCCC01E2401670BC37D6824B268A698F839AECFC55288E3DE`. The runtime job selected that exact artifact ID and did not perform a source checkout.

Before the first unsigned portable process started, the runner verified:

- the temporary account was not elevated or in Administrators/Remote Desktop Users;
- integrity RID was `8192` (medium), no profile was loaded and remote interactive logon was denied;
- the child environment contained only `SystemRoot`, `WINDIR`, `TEMP`, `TMP` and `PATH`, with scoped temp/path values and no sensitive runner environment;
- exactly three outbound `Block`, `Profile Any`, enabled, exact-program rules existed for `msconvert.exe`, `msaccess.exe` and the harness;
- raw firewall enforcement values were limited to enforced/inactive-profile states with at least one enforced active profile; `MpsSvc` was running and the active `Public` profile was enabled;
- the Windows Job was assigned before process resume and configured to kill owned descendants on close.

After the matrix, an independent always-run cleanup step attested all owned processes absent, all three firewall rules absent, temporary profile/user/logon right absent, runtime root absent and private cleanup state removed. The sanitized publication step then revalidated an exact two-file allowlist and removed its staging directory.

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
| Official portable candidate | Advertised `3.0.26204` / `a09eea9`; archive and target executable hashes recorded | Re-verified and executed only in the disposable evidence VM |
| Host `msconvert.exe` | Not found | No local conversion executable |
| Host `msaccess.exe` | Not found | No local preview executable |
| Isolated `msconvert.exe` | `3.0.26204 (a09eea9)`; build date `Jul 23 2026 20:22:10` | Complete exit-0 help plus executable-reported identity |
| Isolated `msaccess.exe` | `3.0.26204`; source revision not emitted; build date `Jul 23 2026 20:17:52` | Complete expected exit-1 help; compatible pair established by one verified distribution and normalized release |

The correct development-host availability state remains `unavailable`; isolated evidence is not a host installation. Runtime identity is derived from the tools' own complete help/probe output, not from the MSI or download filename. `msaccess` did not emit source revision, so the report does not fabricate one.

## Installed command surfaces and real operations

Complete, non-truncated help from the exact portable build was the authority for argv reconciliation:

| Probe | Exit | Elapsed | stdout | stderr | Complete capture SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| `msconvert.exe --help` | `0` (expected) | `97 ms` | `35,188` bytes | `2` bytes | stdout `811153E5FB0536250037E93FEFAE806EF11F84F981196C5AD30EE88CB22CD975`; stderr `7EB70257593DA06F682A3DDDA54A9D260D4FC514F645237F5CA74B08F8DA61A6` |
| `msaccess.exe --help` | `1` (expected usage behavior) | `88 ms` | `0` bytes | `28,873` bytes | stdout `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`; stderr `9797DD029683FD2C3E84519D877C926484323122DB8E858E6E52028C5846983D` |

The installed help declared `metadata`, `run_summary`, `spectrum_table`, `binary`, `slice`, `tic`, `sic` and `image`, plus required `--outdir`, `--exec`, `--filter` and `msLevel <mslevels>` grammar. It did not declare a literal BPC query. All current typed mappings were confirmed; no argv correction was required.

Each data operation used a fresh output directory and one harness invocation. “Harness” includes discovery/help validation and orchestration overhead; “backend” is the measured child-operation duration. These are single tiny-fixture observations, not cold/warm or realistic performance measurements.

| Operation | Exit backend/harness | Harness / backend ms | Output | Evidence-backed result |
| --- | --- | ---: | --- | --- |
| Metadata | `0 / 0` | `385 / 139` | `2,538`-byte `.txt`; SHA-256 `B3FAB73EEE8374447D7AF55712002B3CD0AA0B89C8E5D71119C9A2BA87261837` | 89-line output contained exactly the five required metadata sections; values intentionally not retained |
| Run summary | `0 / 0` | `332 / 112` | complete `383`-byte stdout; SHA-256 `68C937A6F467DA06CB4A720E78D1E56DBE070FDE8A90AF6D1A0B13E5F056050C` | 4 spectra: MS1 `3`, MS2 `1`; RT range `0..359`; no chromatogram count or RT unit emitted |
| Spectrum table | `0 / 0` | `349 / 130` | `529`-byte TSV; SHA-256 `71A93D1A05D4A942A82DA77D9C57376B742646D376028E9CAA48F75CEEE74A3E` | 4 rows and matching MS-level counts; IDs are abbreviated and RT is formatted to two decimals |
| TIC | `0 / 0` | `378 / 140` | `264`-byte TSV; SHA-256 `7BF8E0585FAF998226739E8603C5048639B89A9EC65E73DBEA223EE3F339E951` | 4 index-ordered rows; RT range `0..359.43`; summed-intensity range `0..120` |
| TIC, `msLevel 2` | `0 / 0` | `526 / 205` | `114`-byte TSV; SHA-256 `8DB74160F8F3CBB1D564D00BE0D6362A6864D7BB495EE03F99BDC805941A8F03` | exactly 1 MS2 row at RT `359.43`, summed intensity `110` |
| Spectrum index 0 | `0 / 0` | `526 / 202` | `900`-byte text; SHA-256 `FED32D55AAC7258EFE220906D66C7BCFFE9517650E796F84FEB025280FE34C0A` | 15 m/z/intensity pairs, matching lengths, requested precision bound honored; units and representation not emitted |
| Unavailable maximum index | `0 / 0` | `492 / 142` | no output | observational not-found behavior: exit 0 with zero files |
| Convert mzML | `0 / 0` | `363 / 136` | `25,273` bytes; SHA-256 `96266517129FFD5B0B62B274E7234F473656EC80F6D9D8CF9C3B7CF408D0BB44` | secure XML validation passed; 4 spectra, 2 chromatograms, all 12 binary arrays zlib-compressed |
| Convert mzXML | `0 / 0` | `361 / 166` | `4,076` bytes; SHA-256 `5D18819E2266C47D41566FA7F012A81D237F779D90B9240F860F82717254B968` | well-formed and compressed, but only 3 of 4 spectra and no chromatograms; integrity gate failed |
| Unsupported text input | `0 / 0` | `280 / 90` | no output; backend stderr `203` bytes | process exit 0 was not semantic success; exact normalized failure category remains unverified |
| Existing-output contract | `not launched / 1` | `199 / n/a` | the `19`-byte sentinel remained unchanged | MSCanvas preflight rejected the non-empty directory; no ProteoWizard overwrite claim |
| Unwritable output | `1 / 1` | `339 / 133` | no output | generic `backend_non_zero_exit`; no locale-sensitive permission category inferred |

The TIC rows are spectrum-index ordered rather than RT sorted. ProteoWizard's pinned [`RegionTIC.cpp`](https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/pwiz/analysis/passive/RegionTIC.cpp#L145-L156) reports a sum of the binary intensities, not the fixture's stored TIC CV value, so the result is a derived/recomputed trace that must be labeled as such. The selected-spectrum table row used abbreviated ID `19`, while binary output used raw ID `scan=19` plus scan number 19. Pinned [`SpectrumTable.cpp`](https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/pwiz/analysis/passive/SpectrumTable.cpp#L169-L176) and [`SpectrumBinaryData.cpp`](https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/pwiz/analysis/passive/SpectrumBinaryData.cpp#L153-L161) confirm those are two formatter representations of the same index-0 spectrum; a future parser must canonicalize them rather than exact-compare raw strings.

## Verified open-format fixture

The repository does not track a scientific mzML/mzXML fixture. The isolated run downloaded ProteoWizard's synthetic `tiny.pwiz.1.1.mzML` example directly from the pinned commit and required its exact identity before execution:

- pinned source: <https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/example_data/tiny.pwiz.1.1.mzML>
- pinned raw URL: <https://raw.githubusercontent.com/ProteoWizard/pwiz/a09eea91209131f6aa487f7316647fc536188c19/example_data/tiny.pwiz.1.1.mzML>
- size: `25,072` bytes;
- SHA-256: `711ac14b666f14817c208bd4d39b738e96ac827574c4639d8f8f6eebbfde9c83`;
- license basis: ProteoWizard's pinned root Apache-2.0 license permits reproduction and distribution; the example-data writer carries the same license;
- provenance: synthetic in-memory ProteoWizard `examples::initializeTiny` test data, not a vendor or biological acquisition;
- structure: four spectra with MS levels `1, 2, 1, 1`, two chromatograms, m/z and intensity arrays, TIC data, and profile/centroid markers.

The disposable runner observed an exact `25,072`-byte/SHA-256 match before use and again after the matrix. The fixture was not committed or returned as generated scientific data.

| Suitable structural coverage | Not suitable evidence |
| --- | --- |
| Open-format metadata and count smoke checks | Vendor-reader availability or correctness |
| MS-level distribution and RT/TIC structure | A stored BPC chromatogram |
| One selected spectrum with m/z/intensity arrays | Conversion fidelity or archival equivalence |
| Deterministic unavailable-scan request | Realistic latency, memory or large-array transfer |
| Profile/centroid metadata parsing | Real-backend cancellation or partial outputs |
| CI-safe parser and argv fixtures | Scientific suitability or biological representativeness |

Any future acquisition must still use the pinned raw URL and repeat the exact size/SHA-256 gate. Attribution and provenance must remain adjacent if the unchanged fixture is ever separately approved for tracking.

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
- the harness does not write to or delete source acquisitions, and output is rejected when it equals or is nested inside a directory-formatted input;
- the spike harness refuses to execute against a non-empty output directory; the isolated sentinel case proved this pre-execution contract, not ProteoWizard overwrite behavior;
- conversion planning has an explicit output format and output directory and does not insert a peak-picking filter for the no-additional-centroiding intent;
- backend failures receive a stable normalized kind and summary; raw technical detail remains sensitive and is redacted before printing or sharing.

The current typed intent covers metadata, run summary, spectrum table, TIC with an optional MS-level filter, one spectrum by index, and mzML/mzXML conversion with zlib. Complete help from the exact isolated build confirmed these spellings and positional rules. The measured output limitations below remain separate from argv support.

### Help-confirmed typed argv

Every row below is an argv plan, not a shell command. Paths remained individual `OsString` values, and quoted display is only used to show query arguments containing spaces. Each data row was executed once against the exact isolated portable build.

| Operation | Tool | Help-confirmed argv after executable |
| --- | --- | --- |
| Installed help/release probe | `msconvert.exe` and `msaccess.exe` | `--help` |
| Metadata | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `metadata` |
| Run summary | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `"run_summary delimiter=tab"` |
| Spectrum table | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `"spectrum_table delimiter=tab"` |
| TIC | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `"tic delimiter=tab"`; typed plans may append `--filter`, `"msLevel <N>"` |
| Spectrum by zero-based index | `msaccess.exe` | `<input>`, `--outdir`, `<fresh-output-dir>`, `--exec`, `"binary index=<N> precision=8"` |
| mzML conversion | `msconvert.exe` | `<input>`, `--mzML`, `--zlib`, `--outdir`, `<fresh-output-dir>` |
| mzXML conversion | `msconvert.exe` | `<input>`, `--mzXML`, `--zlib`, `--outdir`, `<fresh-output-dir>` |

The negative-operation sanitized variants were equally explicit:

| Case | Sanitized difference from the table above |
| --- | --- |
| Unavailable spectrum | Spectrum argv with `binary index=18446744073709551615 precision=8` and `<output-root>/spectrum_unavailable` |
| Unsupported input | Metadata argv with input `<fixture:unsupported>` and `<output-root>/unsupported_input` |
| Existing-output contract | mzML conversion argv targeting `<output-root>/output_conflict_contract`; rejected before backend launch |
| Unwritable output | mzML conversion argv targeting `<output-root>/unwritable_output` |

The developer-only invocation shape is `cargo run --locked -p mscanvas-proteowizard --example m0_proteowizard_spike -- --mode <mode> [explicit options]`. It is intentionally unstable. Non-probe modes require captured installed help to contain every operation-specific marker before the harness builds or executes the plan.

## Phase findings

| Phase | Evidence-backed status |
| --- | --- |
| Portable provenance | Official selection/release/resolver chain, archive hash and static binary/AuthentiCode inventory verified; exact runtime extraction hashes matched |
| Isolation | Disposable `windows-2025` VM, standard-user token, scoped ACLs/environment, exact-path outbound blocks and complete teardown verified |
| Discovery/version | Host remained unavailable; isolated same-distribution pair and executable-reported normalized release `3.0.26204` verified |
| Developer harness | Real isolated help, metadata, summary, table, TIC, spectrum, conversion and bounded failure cases recorded |
| Installed command surfaces | Complete, non-truncated help validated every used query/option; literal BPC absent |
| Open-format smoke | Exact pinned fixture hash/size verified before and after 12 recorded operations |
| Vendor RAW smoke | Not run; real vendor RAW was explicitly outside this Goal |
| Conversion | mzML passed external structure/count/zlib validation; mzXML exit 0 lost one spectrum and failed integrity parity |
| Progress | D: stream cadence was not timestamped; elapsed time was not relabeled as progress |
| Cancellation | D: the `136 ms` mzML operation was below the safe cancellation threshold; controlled Job tests remain contract evidence only |
| Failure classification | Exit 0 proved insufficient for semantic success; unknown/locale-sensitive stderr remains generic pending a typed preview-result interpreter |
| Architecture decision | Mixed A/B/C/D; see the capability table rather than one global `msaccess` verdict |

## Conversion and representation findings

Both conversions used `--zlib`, an explicit fresh output directory and no peak-picking filter. The latter proves only argv intent; it does not prove absence of backend-internal representation changes.

The mzML output was well-formed `indexedmzML`, retained all 4 spectra and 2 chromatograms, and marked all 12 binary arrays as zlib-compressed. Aggregate profile and centroid markers remained present. The input exposed only 64-bit array encodings, while output exposed both 32- and 64-bit encodings, so precision preservation and losslessness are explicitly not claimed. Profile/centroid comparison is descriptive and does not prove per-spectrum representation equivalence.

The mzXML output was well formed and all 3 serialized peak arrays were zlib-compressed, but it contained only 3 of the fixture's 4 spectra and no chromatograms. The chromatogram loss is expected for this format; the spectrum loss is not accepted. Pinned [`Serializer_mzXML.cpp`](https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/pwiz/data/msdata/Serializer_mzXML.cpp#L779-L787) shows that this multi-source fixture's spectrum whose source differs from the run default is skipped. This is demonstrated data loss for the tested input, not a claim that every mzXML conversion loses a spectrum. mzXML therefore remains C and must be gated behind mandatory source/output count validation or remain unsupported in the first release.

The existing-output case was rejected by MSCanvas before backend launch, so no ProteoWizard overwrite behavior was measured. No converted file is treated as a lossless archival replacement for source acquisition data, and no generated output is tracked.

## Cancellation and process-tree findings

No real ProteoWizard cancellation was attempted. The measured mzML child operation completed in `136 ms`, below the evidence harness's `500 ms` safe-attempt threshold, so backend cancellation latency and partial-output behavior remain unknown. Controlled Windows tests launched a parent plus grandchild inside an owned Job Object and proved end-to-end `cancelled` classification while the root remained alive. Root-exits-first tests proved later cancellation observation and zero remaining Job processes. The two subprocess entry-point tests are intentionally ignored during ordinary discovery; the supervising tests invoke them directly.

Stable Rust's `std::process::Command` still has a narrow spawn-to-job-assignment race because it does not expose suspended creation or a job-list process attribute. The controlled helper waits until assignment before creating its child, so it validates owned-tree termination but does not prove a race-free production spawn invariant.

The continuation hardened the post-root-exit edge offline. When cancellation is first observed after the root exits, successful Job termination now starts a fresh bounded empty-Job drain deadline instead of reusing an already expired pre-cancellation deadline. A deterministic late-cancellation test proves cancellation remains observed rather than becoming a timeout-derived supervision error, while a real controlled surviving descendant still returns `TimedOut` when no cancellation occurs. This is process-contract evidence only, not a real ProteoWizard cancellation claim.

The spike does not infer real-backend cancellation success from those contracts. A later representative operation must be long enough to interrupt safely and must inspect partial output without deleting source data.

## Progress, locale and diagnostic findings

The disposable runner culture and UI culture were both `en-US`. Exact numeric parsing, delimiter/header checks and structured cross-checks succeeded for that locale only; no second culture was changed or inferred, so universal locale stability is D.

Every help and operation stream was fully drained, its retained and total byte counts matched, and no stream was truncated. Reportable diagnostic retention stayed under the 8 MiB per-stream cap; raw help, raw backend streams and row-level scientific excerpts were not uploaded. The output included no timestamped stream samples, stable percentages or cadence evidence, so no backend-progress parser is claimed. Harness elapsed time is not presented as progress.

The unsupported-input and unavailable-spectrum results demonstrate why diagnostics must remain subordinate to typed operation postconditions: both exited 0 without generated output, while only the unsupported input emitted stderr. A locale/build-specific stderr match would collapse two distinct outcomes and is not accepted.

## Failure-classification matrix

Each normalized failure carries a stable kind, a concise summary, technical detail, retryability and suggested corrective action. Technical detail is retained for diagnostics but must not be the only user-facing message.

| Stable kind | User-facing summary | Retryability | Suggested action | Evidence status |
| --- | --- | --- | --- | --- |
| `backend_not_found` | ProteoWizard is not available | After correction | Install separately or select a valid installation folder | Negative discovery observed; positive recovery unverified |
| `msconvert_missing` | Converter is missing | After correction | Select/repair one installation containing both tools | Contract only |
| `msaccess_missing` | Preview tool is missing | After correction | Select/repair one installation containing both tools | Contract only |
| `version_probe_failed` | Version self-test failed | After correction | Check the selected installation and runtime prerequisites | Contract only |
| `backend_launch_failed` | Backend could not be started | After correction | Check the executable, Windows runtime and installation | Contract test only |
| `unsupported_input` | Backend cannot read the input | Not retryable unchanged | Confirm format and licensed reader availability | Stable contract exists, but the real unsupported case exited 0 with stderr/no output and cannot yet be mapped safely |
| `permission_denied` | Windows denied a required path | After correction | Choose readable input and writable output, then retry | Contract only |
| `output_conflict` | Requested output already exists | After correction | Choose another output or resolve conflict explicitly | MSCanvas pre-execution sentinel contract observed; backend conflict semantics not run |
| `unwritable_output_directory` | Backend cannot write to output | After correction | Choose an existing writable output folder | Stable contract only; real en-US stderr was deliberately not promoted to this category |
| `backend_non_zero_exit` | Backend stopped with an error | Retryable after review | Preserve diagnostics, correct input/settings, and retry | Real unwritable-output operation observed exit 1/no output; conservative generic category retained |
| `malformed_parse_output` | Output cannot be interpreted | Not retryable unchanged | Preserve build/operation detail and report incompatibility | Contract only |
| `cancelled` | Operation was cancelled | Retryable | Inspect any partial output, then retry when ready | Controlled process-tree test passed; real backend unverified |
| `partial_output_present` | Incomplete output remains | After correction | Keep source unchanged and explicitly relocate/remove partial output | Contract only |
| `unexpected_internal_error` | MSCanvas could not supervise the backend | Retryable after review | Preserve diagnostics and inspect installation/process state | Contract only |

`partial_output_present` may also accompany another primary failure rather than erasing it. Process success (`Exited` plus code 0) is not operation-level semantic success: metadata/TIC/conversion require expected parseable output, while the deliberately unavailable spectrum is a typed no-output observation. A future preview-result executor must encode those postconditions without matching one build's English stderr.

## Per-capability architecture status

No global `msaccess` decision is justified. Status meanings are A (sufficient), B (partially sufficient with named limits), C (unsuitable) and D (still unverified). The artifact's automatic assessment exact-compared abbreviated table ID `19` with raw binary ID `scan=19`, and did not distinguish recomputed TIC from stored TIC metadata. Post-run review of pinned ProteoWizard source corrected those derived ratings without changing any measured field, file hash or operation result.

| Capability | Status | Evidence and measured characteristics | Parsing/scientific limitation | Proposed owner |
| --- | --- | --- | --- | --- |
| Discovery/build identity | **A** | Exact archive/executable hashes, complete help and compatible executable-reported release were verified in isolation | Evidence covers this portable open-format build, not host installation or vendor readers | ProteoWizard adapter |
| Metadata | **B** | Exit 0; 89-line result with five required sections; `139 ms` backend | Values were intentionally not retained; field semantics, locale and vendor parity remain unverified | ProteoWizard adapter |
| Run summary/counts | **B** | 4 spectra, MS1 `3`, MS2 `1`, RT `0..359`; `112 ms` backend | No chromatogram count or RT unit; RT/BPI fields are rounded/specialized, not generic quartiles | ProteoWizard adapter |
| TIC | **B** | 4-row TSV and exact digest; `140 ms` backend | Derived sum-intensity, index ordered rather than RT sorted; one tiny `en-US` fixture | ProteoWizard adapter, with explicit derived-TIC semantics and RT normalization |
| Filtered TIC | **B** | `msLevel 2` produced exactly the one expected row; `205 ms` backend | Same derived-TIC and tiny-fixture limits | ProteoWizard adapter |
| BPC | **D** | Literal BPC query absent from complete installed help | Equivalent computation/provider route not evaluated | Another provider to evaluate later or deferred computation |
| Scan listing | **B** | 4-row exact schema/count/MS-level result; `130 ms` backend | IDs are abbreviated and RT is rounded to two decimals; pagination/large-file behavior unknown | ProteoWizard adapter with canonical identity model |
| Selected spectrum | **B** | Index 0 returned 15 aligned pairs at requested precision; `202 ms` backend | Query omits units and profile/centroid; abbreviated/raw ID forms require canonicalization | ProteoWizard adapter after typed result parser/cross-check |
| Repeated interactive navigation | **D** | Not run | One process per click may be unsuitable; no cache/reuse measurement | Deferred; Rust cache/provider boundary |
| Large-array transfer | **D** | Not run | Tiny fixture cannot establish memory/copy/output-volume behavior | Deferred; Rust cache/reader boundary |
| Conversion overall | **B** | Format-specific XML/count/zlib validation recorded | Tiny open-format fixture only; no fidelity, archival or vendor claim | ProteoWizard conversion adapter with mandatory output validation |
| mzML conversion | **B** | 4 spectra/2 chromatograms; all 12 arrays zlib; `136 ms` backend | Mixed 32/64-bit output versus 64-bit-only input; only descriptive representation comparison | ProteoWizard conversion adapter |
| mzXML conversion | **C** | Exit 0 and compressed XML, but only 3 of 4 spectra | Demonstrated multi-source spectrum loss plus expected chromatogram loss | Unsupported in first release unless guarded by strict integrity checks |
| Progress | **D** | Streams captured, but cadence was not timestamped | No stable machine-readable progress claim | Unsupported initially; adapter plus shared run state later |
| Cancellation | **D** | Real operation too fast; controlled owned-Job tests only | No backend cancellation/partial-output observation | Shared Rust executor; backend evidence deferred |
| Locale stability | **D** | Only `en-US` was run | No cross-locale delimiter/decimal/error evidence | Deferred parser validation |
| Vendor-format coverage | **D** | Excluded by explicit scope | Open mzML cannot establish proprietary-reader support | Deferred ProteoWizard adapter evaluation |

The next product slice may use these B capabilities only behind typed parse/output-integrity contracts. It should not add a second backend merely to erase the remaining evidence gaps.

## Privacy, security and licensing

- No proprietary acquisition, ProteoWizard binary, DLL, SDK or vendor reader was placed in or committed to the repository. Portable material remains outside the repository and Git history; runner copies were cleaned, while private host staging and retention-managed Actions artifacts are reported separately rather than claimed deleted.
- No acquisition directory was searched, and no vendor phase was simulated.
- Paths in this report are environment-variable or generic paths; profile and sample identifiers are omitted.
- The application contract retains typed argv and direct process spawning; React receives no shell or unrestricted filesystem access.
- Diagnostic output must redact local profile, input and output paths before it becomes shareable.
- Raw probe/process output and normalized technical detail are sensitive internal diagnostics; only the explicit redacted projection may be shared. The published pair retained structured counts/ranges/hashes, not raw help, row-level scientific output or backend streams, and passed an independent forbidden-content scan.
- Installed-help validation must also fail closed if its bounded stdout or stderr capture is truncated; finding required markers in a truncated installed-help capture is insufficient evidence for this validation gate.
- The harness requires a dedicated fresh empty output directory and never deletes source acquisition data. The isolated sentinel case confirmed its fail-closed conflict preflight.
- Any production ProteoWizard backend remains separately supplied/licensed by the user unless a later distribution ADR explicitly changes that policy; no current host installation was verified.
- The downloaded official installer remains unexecuted outside the repository. The unsigned portable build ran only under the disposable VM controls above. No installer, archive, executable, DLL, SDK, license payload or vendor component is tracked or redistributed.
- The runtime job performed no source checkout and exposed no development-host repository, profile, credential, browser state or unrelated drive to the temporary standard-user token.
- A Defender scan was attempted with remediation disabled, but the registered product reported its scanning feature disabled; archive provenance and safe extraction do not imply a malware-clean claim.
- The pinned Apache-2.0 synthetic mzML fixture was hash-verified and used transiently; it is not tracked.
- MSCanvas source acquisitions remain read-only, and workspace removal never means source-data deletion.

## Explicitly untested and blockers

The bounded open-format matrix is complete, but these gaps still block a global provider/production-readiness decision:

1. BPC has no literal installed-help query and no equivalent route was evaluated.
2. Repeated navigation, cache strategy, realistic first-preview latency, large arrays and memory/copy behavior were not measured.
3. Real cancellation and partial-output behavior were not measurable because the tiny conversion completed in `136 ms`.
4. Only `en-US` was run; cross-locale numeric, delimiter and error stability remains unverified.
5. Metadata values were intentionally not retained; selected-spectrum units and profile/centroid state were not emitted.
6. `msaccess` uses different abbreviated/raw identifier forms across table/binary commands, requiring a canonical identity contract.
7. Exit 0 can mean usable output, typed no-result or unusable unsupported input; operation-specific semantic postconditions do not yet exist in a durable preview executor.
8. mzXML lost one spectrum from this multi-source fixture and is C without mandatory integrity checks.
9. Vendor RAW correctness, licensed-reader availability and vendor-specific metadata remain unverified by explicit scope.
10. The isolated build is not installed on the development host and no distribution/installer decision was made.

## Recommended next vertical slice (recorded 2026-07-24)

At the end of the bounded runtime evidence Goal, the recommended next slice was **M0C: a typed open-format preview-result boundary with semantic integrity gates**, not vendor UI claims or a second backend:

1. Define typed Rust results for metadata, summary, derived TIC, scan rows, selected spectrum and typed unavailable-spectrum outcomes.
2. Require operation-specific parseable output after process exit 0; keep typed no-result distinct from malformed/unsupported input.
3. Canonicalize abbreviated/raw spectrum identity while retaining zero-based index and scan number, normalize RT to seconds and make index order versus display sort explicit.
4. Label the measured TIC as recomputed sum intensity; keep BPC unavailable rather than substituting it silently.
5. Require source/output spectrum/chromatogram counts and explicit numeric-precision policy for conversion. Keep mzXML disabled initially; retain mzML as B rather than archival/lossless output.
6. Add deterministic tests using an explicitly approved lawful fixture or minimal parser fixtures. Then measure repeated navigation and a representative lawful large open-format file before committing to one-process-per-action UX.
7. Expose only the validated subset through a narrow Tauri operation and render loading, empty, typed unavailable and error states when the provider contract is ready.

Vendor RAW coverage, BPC strategy, real cancellation, alternate locale and distribution remain later explicit gates.

The subsequent contract audit superseded only the recommendation to normalize RT to
seconds: the measured output did not emit an RT unit, so Slice 1 preserves an explicit
unknown unit instead. The dated contract result is recorded below.

## Implementation validation evidence

The successful exact-head evidence run supplied these remote gates:

| Gate | Result |
| --- | --- |
| Build/attest job `89599655093` | Passed checkout identity, pinned Rust setup, targeted tests, strict focused Clippy, format, release harness build, deterministic orchestration self-tests, exact bundle construction and upload |
| Runtime job `89599908550` | Passed exact-artifact download/manifest verification, isolated collection, independent cleanup, sanitized allowlist revalidation/upload and staging removal |
| Evidence run identity | Run `30129182032`, attempt 1, push event, exact source `f0d7957fbbe129263a9a89684b6ce549b1b3a086` |
| Sanitized artifact | ID `8610469338`; service and independently downloaded ZIP SHA-256 `8A07BBDBA9C195A311A00658A9FC7F086E83B6DA3943F41B12B90BC2ED23E927`; exact two-file allowlist |

This remote run validates the marker commit and measured backend evidence, not later documentation or workflow removal. The Goal's final Windows suite is run against the final worktree only after every evidence-driven edit and temporary workflow file removal. Its command-by-command results and the final commit identities belong in the final Goal handoff, avoiding a self-referential report rewrite after validation.

No pull request, merge, release, tag or force-push is part of this Goal.

## M0C Slice 1 contract-only update — 2026-07-26

This section records the later Rust/library slice. It does not modify or extend the
runtime evidence, hashes, timings, operation records or A/B/C/D ratings above, and no
ProteoWizard executable was run for this update.

### Typed preview boundary

The evidence-backed preview operations now have typed parsers and an operation-specific
interpreter for metadata, run summary, spectrum table, derived TIC and selected spectrum.
Metadata preserves section order and opaque ordered field content, including unknown
fields, without assigning scientific meaning to values that were not retained in the
runtime evidence. Retention-time values preserve their emitted numeric values and carry
an explicit unknown unit when no unit is present.

TIC points carry their source spectrum indices and preserve backend/source order. Their
semantic origin is explicitly derived/recomputed summed intensity, not a stored TIC
chromatogram. A separate retention-time-ordered projection retains the source indices and
does not mutate the source-order series.

Canonical spectrum identity preserves the zero-based index and all raw display/native
representations. It reconciles only recognized exact forms: a numeric display ID such as
`19`, a native ID such as `scan=19` and an explicitly reported scan number. Conflicting
scan numbers fail closed, while unknown native-ID forms remain opaque rather than being
rejected or coerced.

### Operation-specific interpretation

The interpreter combines the requested preview operation, process result and captured
output manifest instead of treating exit status as the operation result. Exit 0 plus no
generated output becomes typed `NoResult` only for selected-spectrum lookup when stdout
and stderr were captured completely and are both empty. Diagnostic-bearing or incomplete
no-output behavior remains unclassified. Required preview operations reject missing,
empty, malformed or unexpectedly multiple outputs; non-zero exit and
launch/cancellation failures remain distinct from parser failures.

Unsupported-input-like exit 0 plus stderr/no output is not successful metadata and is not
classified by matching English prose. It remains conservative and unclassified unless a
future stable structural marker establishes a narrower category.

### Scope boundary and remaining work

This slice added no production or development dependency and changed no UI, Tauri,
workspace, queue or conversion behavior. It did not enable BPC or mzXML and did not add a
stable CLI contract. The existing conversion evidence and gates remain exactly as
recorded above.

M0C remains incomplete. Slice 2 should implement mzML conversion semantic integrity,
including source/output spectrum and chromatogram count checks and an explicit numeric
precision policy, then measure repeated navigation and representative lawful open-format
scale/large-array behavior. BPC strategy, real-backend cancellation and partial-output
behavior, alternate-locale parsing and vendor-format coverage remain separate explicit
gates.

## M0C Slice 2A contract-only update — 2026-07-26

This section records the mzML conversion-integrity library slice. It does not modify or
extend the runtime evidence, hashes, timings, operation records or A/B/C/D ratings above,
and no ProteoWizard executable was run for this update.

### Conversion integrity moved into the product

Before this slice, the harness printed
`conversion_output.xml_validation=deferred_to_evidence_orchestrator`: the only structural
check of a converted file lived in the temporary PowerShell evidence script, not in
MSCanvas. The ProteoWizard crate now owns a bounded mzML inspector and a typed
source-versus-output integrity comparison, and the harness consumes them.

The inspector refuses any document type declaration and any general reference other than
the five predefined entities and numeric character references, so no external or custom
entity is resolved. It never base64-decodes and never decompresses a binary array: array
point counts come from the declarative `defaultArrayLength` attribute, which removes the
decompression-bomb class by construction instead of bounding it. Documents are read
through a byte-counting reader that fails closed on document-byte and single-text-run
limits before the bytes are buffered, and on depth, element, attribute, name, value,
spectrum and chromatogram limits while scanning.

Controlled-vocabulary facts are recognized by accession only and scoped to their immediate
parent element. The earlier PowerShell validator counted profile and centroid markers
document-wide, which conflates the aggregate `fileContent` declaration with per-spectrum
representation; the Rust contract does not.

### Required, advisory and unverified properties

Required invariants are the ones a faithful mzML conversion cannot violate: spectrum and
chromatogram counts, MS-level distribution, per-record binary-array counts, roles and
declared point counts, precursor counts, consecutive index sequences, recognized
scan-number agreement, an internally consistent output, and the requested zlib compression
policy on every output array. Source identity, byte length and SHA-256 are captured before
the conversion and recaptured afterwards, so a source rewritten in place with the same
length is detected.

Descriptive-only observations never fail a conversion: numeric-encoding markers, the
`indexedmzML` wrapper, byte length, added or removed representation markers, retention-time
unit markers, and a source whose own declared list count disagrees with its content. The
already-recorded 64-bit-only input to mixed 32/64-bit output conversion is exactly why
numeric precision is not a hard invariant.

Two properties degrade to unverified rather than failing. Vocabulary-derived facts degrade
when either document reaches them through a `referenceableParamGroup`, and native identity
degrades when either side uses a form the Slice 1 canonical identity contract leaves
opaque. The common Thermo `controllerType=... scan=N` form is opaque under that contract,
so treating unverified-ness as a failure would have rejected every real conversion. A gate
that needs the stronger statement asserts that no property remained unverified.

The contract does not claim byte-for-byte equivalence, general losslessness or vendor
fidelity, and it never fails a conversion for a legal serialization difference. A
deterministic re-serialization test pins that attribute order, `cvParam` order, whitespace,
self-closing form, comments, processing instructions and the index wrapper all produce
identical comparable facts.

### Slice 2A scope boundary and remaining work

Source-versus-output comparison applies only when the source is itself mzML. A vendor
acquisition has no comparable mzML facts, so the harness records that limitation and
inspects the output alone instead of implying an equivalence it cannot establish.

Supervised runs now also report the peak committed memory charged to the owned Windows Job
Object. It is an advisory observation for the later scale measurements, not a supervision
result.

This slice added one approved production dependency, `quick-xml` `=0.41.0` with default
features disabled, scoped to the bounded mzML scanner. That crate and its only required
transitive dependency were already present in `Cargo.lock` through `tauri`, so the
dependency graph gained no crate. No UI, Tauri, workspace, queue or backend-invocation
behavior changed; mzXML and BPC remain unavailable; no stable CLI contract was added.

M0C Slice 2B remains outstanding: representative lawful open-format navigation and scale
measurements, including repeated navigation and post-conversion reinspection at real scale.
BPC strategy, real-backend cancellation and partial-output behavior, alternate-locale
parsing and vendor-format coverage remain separate explicit gates.
