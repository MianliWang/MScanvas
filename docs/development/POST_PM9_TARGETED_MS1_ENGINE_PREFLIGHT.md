# Post-PM9 targeted-MS1 engine preflight

Date: 2026-10-20. Status: **STATIC PREFLIGHT RECORDED; ENGINE EXECUTION
PENDING / NOT RUN**.

This record prepares a separate, development-runtime qualification. It does
not mark the runtime ready, establish an engine result, or qualify an installed
product. The current authorization covers static inspection only. Permission
for ProteoWizard probes and existing-fixture reading/conversion in the native
campaign does not authorize a pyOpenMS worker. No runtime, adapter, engine,
provider, test, typecheck, build, download or provisioning command was run for
this record. The standing resource refusal remains in force; memory was not
polled or treated as a reason to lower its admission line.

The contracts are [M9 closure](../product/M9_CLOSURE.md), especially §§3.1,
3.3, 10 and 11, and the current [supervisor](../../apps/desktop/src-tauri/src/targeted_ms1.rs),
[recipe](../../apps/desktop/src-tauri/src/project/recipe.rs),
[runtime tests](../../apps/desktop/src-tauri/src/targeted_ms1/tests.rs) and
[batch tests](../../apps/desktop/src-tauri/src/targeted_ms1/tests/batch.rs).
The separate [native qualification](POST_PM9_NATIVE_QUALIFICATION.md) does
not turn its rendering or provider evidence into engine evidence.

## 1. Source and evidence identity

- Inspected checkout: `D:\Github repo\MScanvas`.
- HEAD: `959a74fc693a2ed63fe847f50fe63c76d9c2229f`.
- Frozen PM9 production candidate: `30b855f23fc8b391e10221954dfa1278a9863db5`;
  PM9 tests: `e94fb16`; closeout record: `959a74f`.
- The worktree contains concurrent, uncommitted native/Tauri test repairs and
  qualification documents. It is not a clean, executed engine candidate.
- A read-only comparison against `30b855f` found no changes under
  `apps/desktop/src-tauri/src/targeted_ms1.rs`, `targeted_ms1/`,
  `project/recipe.rs` or `scripts/provision_targeted_ms1_runtime.py`.
- No current Cargo test executable was attributed or executed. A future run
  must name its actual source tree and built test executable; an older artifact
  cannot be assumed to contain this source.

The native e2e binary and the engine have different build requirements.
`Supervisor::development()` locates the runtime through the checkout only
under `debug_assertions`; the non-debug `development_scratch()` returns
`None` (`targeted_ms1.rs:188–202`). An optimized `e2e`/release build therefore
has no development recipe executor even when these runtime files exist beside
the checkout. Native 150% rendering acceptance cannot close this engine item.
The proposed Rust commands below use the default test profile, without
`--release`; a future application-path check must explicitly identify a build
whose debug assertions and development-runtime route are enabled.

## 2. Existing runtime files, read without execution

The existing JSON files were parsed and hashed. `Get-FileHash -Algorithm
SHA256` read the selected files sequentially; it did not load their modules.
The manifest's entry count and byte sum were calculated from its JSON.

| Item | Observed bytes | Observed SHA-256 |
| --- | ---: | --- |
| `.tmp/m91-runtime/runtime-manifest.json` | 912,829 | `6A3EB44A4611DB6B906F43B0278F67BB2B6996DDC7871BF614812E2CAC29B295` |
| `.tmp/m91-runtime/provision-report.json` | 341 | `6D411CF207B40B9D8F97B523D34652A0A08D11E0169CC8BEBE8349BA189D5B7D` |
| `apps/desktop/src-tauri/src/targeted_ms1/adapter_v1.py` | 30,433 | `ED3F7FBD772DE9489A4AFFF86CF3AC0A0D598690C16BB2C6CB87716021AFB0AC` |

The manifest hash equals `recipe::RUNTIME_MANIFEST_SHA256` and M9 closure's
record. Its schema is `mscanvas.analysisRuntimeManifest/1`; its runtime name is
`cpython-3.13.15-embed-amd64+pyopenms-3.5.0`. It lists **4,628 entries totaling
348,698,831 bytes**. The provision report names the same manifest hash, file
count and byte count, and reports `bytecodeCopied: false`. Its provenance
counts are `embedZip: 33`, `embedZipModified: 1`, `pipGenerated: 34`,
`pipRecordUnverifiable: 14`, and `wheel: 4546`. These are the existing report's
claims; no download archive, wheel provenance or provisioning action was
reverified in this preflight. The report's own hash is an observed identity,
not an additional application pin.

The following paths are relative to
`.tmp/m91-runtime/cpython-3.13.15-embed/`. Each selected file exists, has the
listed length and hash, matches its manifest entry, and was not marked as a
reparse point by its own file attributes at inspection.

| Runtime file | Bytes | Observed SHA-256 |
| --- | ---: | --- |
| `python.exe` | 105,696 | `85B71D8C6EC1905935F74BE0C9869AAE198D00E98F39DF699EC66F9C5A84CECD` |
| `python313.dll` | 6,135,008 | `E820BF024EFD2B56BB2B82791E6B6DDC7303F070F8E72CBA7637482A8A906238` |
| `python313._pth` | 89 | `637563FB7049AA6C603EE7D510D80D7C7DDB4997ED3E22BC8D76FB951C37687E` |
| `site-packages/pyopenms/__init__.py` | 4,800 | `CE54A61ED408E8508DACCD9B4B0020B7C67B64AE5D5193795B3B334BC29E72BD` |
| `site-packages/pyopenms/_pyopenms_1.cp313-win_amd64.pyd` | 3,040,768 | `48D9F718FA6A3186F05973A4E0D362B46362FCB94D4AF96668B4829277CD36D7` |
| `site-packages/pyopenms/OpenMS.dll` | 29,507,584 | `77AA30273C00C5F06BDB17ED28CDCF7764D062F254B7E216B6CAA09A4B84C66D` |
| `site-packages/pyopenms/OpenSwathAlgo.dll` | 122,880 | `23910A2B5FD29241B9ED97024A73BD977A3B86154823C4EF3D0128668E5EF48B` |
| `site-packages/pyopenms/Qt6Core.dll` | 6,159,496 | `0CC62E841959FB8F6D366EA116C6F6BBC273E30F0EF90D8AA2E4ADEB81FD63F8` |

The executable's Windows version resource says `3.13.15`; this is file
metadata, not a successful interpreter or import result. The two runtime-root
directories had ordinary directory attributes. The resolved runtime path is
ASCII, including the space in `Github repo`. This is within the source's ASCII
path constraint; it is not a measurement that OpenMS accepts the path here.

The 18-key `FIXED_ENGINE_PROFILE` was reconstructed from the Rust `concat!`
literal without compiling or importing anything: 477 UTF-8 bytes, SHA-256
`ACA2C008B7FA312C42B59DE88F872EFC45BBB65545281B57163C0B181A958AF4`, matching
M9 closure. The adapter digest also matches closure. The contract expects
`FeatureFinderAlgorithmMetaboIdent`, pyOpenMS `3.5.0`, OpenMS revision
`c1370fb`; none of those engine self-reports was obtained in this session.

**Limit of this inspection:** only the eight selected runtime files were
hashed. The remaining entries, complete tree membership and all nested
reparse points were not reverified. `runtime_present()` checks only the pinned
manifest and existence of `python.exe` (`targeted_ms1.rs:850–864`); it is not
full runtime verification either. Before each launch, production
`verify_runtime()` checks every entry's length/hash, rejects extra or missing
files and rejects links/reparse points in its traversal (`:875–939`). That
code was read, not invoked here. Module loading, required loaded-module
reports, DLL compatibility and engine output remain unproved.

## 3. Existing real-runtime test entry points

These commands are **deferred examples, not commands run or authorized by this
record**. Start only after explicit engine-execution authorization and the
standing resource gate admits the run. Do not inherit PM9's browser-shard
amendment or native-provider permission. Do not download or reprovision the
runtime automatically if an identity check fails.

The first supported-source vertical case is a small, named entry point:

```text
cargo test -p mscanvas-desktop --lib targeted_ms1::tests::a_supported_source_travels_the_whole_path_and_survives_save_reopen_and_save_as -- --ignored --exact --test-threads=1 --nocapture
```

The existing complete ignored targeted scope is:

```text
cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored --test-threads=1 --nocapture
```

This second command includes supervisor fault cases and measurements as well
as scientific engine cases; it must not be reported as an engine-only count.
`cargo test ... --lib targeted_ms1` without `--ignored` covers the ordinary
fake-executor/domain tests and excludes these opt-in executions. Neither
command is a substitute for attributing a future native application journey.

Useful named cases in the current source include:

| Question | Existing function and source location |
| --- | --- |
| Supported source, real result, save/reopen/Save As | `a_supported_source_travels_the_whole_path_and_survives_save_reopen_and_save_as`, `tests.rs:493` |
| Repeated numerical/categorical result | `a_repeated_run_is_categorically_identical_and_numerically_within_the_declared_tolerance`, `tests.rs:2822` |
| Source on another volume, verified copy and cleanup | `a_source_on_another_volume_runs_through_a_verified_copy_that_does_not_outlive_it`, `tests.rs:3055` |
| Cancellation terminates a real worker | `a_cancel_during_a_real_run_terminates_the_worker_and_publishes_nothing`, `tests.rs:4117` |
| Signal summary agrees with evidence | `a_worker_whose_signal_summary_contradicts_its_evidence_publishes_nothing`, `tests.rs:4313` |
| Stored result reuse with an unavailable executor and source moved aside | `a_real_result_is_read_after_reopen_and_save_as_with_neither_the_runtime_nor_the_source`, `tests.rs:4516` |
| Sequential mixed link/copy batch and retained results | `a_batch_of_linked_and_copied_members_runs_one_worker_at_a_time_and_leaves_no_scratch`, `tests/batch.rs:1355` |
| One changed/malformed member does not consume other members | `a_changed_and_a_malformed_member_fail_on_their_own_and_the_others_complete`, `tests/batch.rs:1642` |
| Stop a batch without starting another member | `stopping_a_real_batch_terminates_the_member_worker_and_starts_no_other`, `tests/batch.rs:1715` |

The current source contains **34 ignored declarations**: 29 in `tests.rs`
and three in `tests/batch.rs` carry the pinned-runtime reason; two more are
measurements. This is a static Windows-source inventory, not a test-binary
listing or executed count. Some pinned-runtime cases use intentional sleeper,
malformed-output or other alternative adapter programs; the ignore reason
alone does not establish that every case executes the scientific engine.

M9 closure's [historical evidence](../spikes/M9_CLOSURE_EVIDENCE.md) records
33 ignored cases on its named older candidates. Commit `03effab` subsequently
added the signal-summary consistency test. Keep the historical result tied to
that historical source; do not copy its count or PASS onto this candidate.

The two measurements also need separate accounting:

- `measure_a_verified_copy_between_volumes` (`tests.rs:3526`) performs a copy
  measurement, not an engine analysis. Without `MSCANVAS_M93_MEASURE` it prints
  `MSCANVAS_M93_MEASURE is not set; nothing measured` and returns. The variable
  was absent in this preflight. A successful ignored-suite aggregate must not
  be described as that measurement having occurred. Opting in requires an
  explicitly approved, owned large-fixture read and its extra resource/output
  plan; output is written under `test-results/m9.3/measure/`.
- `measure_how_many_of_the_largest_batches_one_project_document_holds`
  (`tests/batch.rs:1129`) uses a fake executor and measures document growth;
  it is not engine evidence.

## 4. Serial execution and isolation conditions

The batch source explicitly requires `--test-threads=1`
(`tests/batch.rs:1219–1221`): tests compare the shared attempts root before and
after a run. Serial tests within one process are insufficient if another Cargo
test process, debug application or worker uses the same root. The future
engine group must own that root for the duration and run without overlapping
targeted-runtime sessions. The request to parallelize other possible work does
not make these shared-state tests safe to shard.

The current source's write surfaces are:

| Surface | Ownership and required handling |
| --- | --- |
| `.tmp/m91-jobs/tests/<label>-<pid>-<counter>/` | `WorkArea` writes synthetic mzML, project documents and payload stores here, on the repository's volume; its `Drop` removes only its own directory (`tests.rs:370–412`). Preserve necessary run evidence outside this auto-cleaned area. |
| `.tmp/m91-jobs/attempts/` | Shared production supervisor attempts, with owner/lease-based recovery. Snapshot its names before and after, and retain process identities. Do not delete unknown leftovers or rename a refused run to obscure it. This read-only preflight found the root present with zero immediate entries; it performed no cleanup. |
| System temporary directory | `project::tests::Scratch` creates `mscanvas-project-<label>-<pid>-<counter>` directories and removes its own directories on drop (`project/tests.rs:27–66`). Cross-volume scenarios deliberately put sources here. Use a separately owned parent on the required other volume for a future process-local temp environment. |
| Project-adjacent `<name>.mscanvas.payloads/` | Managed result payloads and the project documents are test-owned beneath the directories above, not user projects. Their rows/evidence are the assertions' inputs. |
| Future evidence directory | Use a new run/group name under the qualification's owned evidence root. Keep stdout/stderr, exact argv and filters, exit codes, per-test outcomes, source/binary/runtime identities, process tree, admission/refusal and cleanup observations. No such executed evidence was created here. |

At inspection, `TEMP` and `TMP` both named the per-user temp directory on `C:`
(`C:\Users\<user>\AppData\Local\Temp`), while the checkout/work area is on `D:`.
Drive letters alone are not proof of distinct volume identities. The
cross-volume cases call `directory_volume` and `object_identity` and assert
that the measured IDs differ (`tests.rs:3012–3019`); those checks were not run.
Do not relocate the system-temp fixture area onto the checkout volume merely
to consolidate artifacts. The contract covers measured local-volume behavior;
it does not qualify FAT/exFAT, network shares or removable media by analogy.

The fixtures for the existing cases are generated by Rust (`Scan`, `mzml`,
`plain`, `two_peaks`, `nothing`, and deliberately invalid variants), not by
reading the ProteoWizard native campaign's vendor fixture. The opt-in large
copy measurement is the explicit exception. Source acquisitions stay
read-only; no provider conversion or centroiding is implicit in these tests.

The supervisor's launch is the typed argv array
`python.exe -I -B -X utf8 adapter_v1.py request.json out`, in an ASCII attempt
directory. `process_command()` clears inherited environment; the Windows
minimum supplies `SystemRoot`, `WINDIR`, a bounded `PATH`, and temporary
directories. The targeted supervisor overrides `TEMP`, `TMP` and
`OPENMS_HOME_PATH` with attempt-owned directories and fixes
`OMP_NUM_THREADS=1` (`targeted_ms1.rs:351–381`, `process.rs:1156–1204`). It uses
a 600-second normal budget and a 4-GiB worker Job limit; a kernel Job limits
the worker to one process at below-normal priority. These limits are source
contracts, not resource-admission waivers or measurements from this preflight.
They do not implement filesystem or network confinement (M9 closure §3.3).

## 5. Conditions for future engine evidence

Before an authorized run, record the exact checkout tree and any diff, build
profile/features, test executable hash/bytes, interpreter identity, adapter
digest, runtime manifest digest, selected test names and fixture-generation
source. Meet the standing memory admission rule with a fresh reading at that
run's start; a refusal ends that proposed group without waiting/polling.
The PM9 browser stop-line exception does not apply to Cargo or this engine.

An attempt must complete production full-runtime verification, report the
expected engine version/revision/profile and manifest-matched required loaded
modules, bind the source bytes to its plan, validate rows/evidence, and observe
the worker's exit. Preserve cancellation/failure/cleanup outcomes separately
from completed scientific findings. The required DLLs above are requirements
on the worker's later self-report; hashing them now does not prove they loaded.

Keep these unresolved states explicit:

| Item | Current disposition |
| --- | --- |
| Pinned manifest, adapter and canonical profile identity | Static hashes recorded above; no execution inference. |
| Eight selected runtime files | Length/hash match their manifest entries; whole-tree verification not performed. |
| Runtime interpreter, DLL loading and pyOpenMS import | **NOT RUN**. |
| Engine scientific/cancellation/batch tests on the post-PM9 candidate | **PENDING / NOT RUN**. |
| Actual cross-volume IDs, hard-link/copy execution and cleanup | **PENDING / NOT RUN**. |
| Optional large-copy measurement | **NOT RUN**; no fixture variable was supplied. |
| Native application journey backed by this development engine | **PENDING**; requires an explicitly identified compatible build and execution authority. |
| Packaged runtime, installer/release qualification, redistribution and public beta | Not established by this work; remain outside this development-runtime preflight. |

M9 remains a bounded, experimental positive-mode centroided-MS1 recipe. Its
source and result semantics, and its lack of packaged-runtime qualification,
remain those of M9 closure; this preparation changes none of them.
