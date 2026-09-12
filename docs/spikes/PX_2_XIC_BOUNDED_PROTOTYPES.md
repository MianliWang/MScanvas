# PX.2 — Direction B bounded prototype

Baseline: `12f807231c01188e0ca985e7954a6380be94963e` (published PX.1, PR #114).
Executed: 2026-09-12. **B-only experiment, separately authorized by the owner.**
Route authority: [ADR 0046](../architecture/adr/0046-post-m6-xic-provider-runtime-route-lock.md).
API findings: [PX.1](PX_1_XIC_PROVIDER_API_AUDIT.md).

**B expressed the query on the named synthetic fixtures below:** source metadata
plus `mzdata` arrays produced per-scan inclusive window point sums and distinct
absence/refusal observations. This completes the authorized PX.2 B-only prototype
scope on publication. It is neither a production provider choice nor PX.3's
comparative evidence. **A remains VIABLE / NOT PROTOTYPED / NOT REJECTED.** C's
PX.1 disposition is unchanged: not viable as defined, because its premise was
that the product already decoded these arrays.

The experiment is a standalone Cargo package outside every product worktree.
This change publishes Markdown only. No production dependency, scanner, worker,
IPC type, fixture, manifest, lockfile, UI or toolchain was changed.

## Exact execution identity

The scratch package declares only:

```toml
mzdata = { version = "=0.66.6", default-features = false, features = ["mzml", "miniz_oxide"] }
quick-xml = { version = "=0.41.0", default-features = false }
serde = { version = "=1.0.229", features = ["derive"] }
serde_json = "=1.0.151"
```

The three metadata/serialization libraries use the product's already locked
versions. `mzdata` is the registry package, with its registry checksum retained
in the scratch lock. Its `.cargo_vcs_info.json` names audited commit
`4927c4e9845386239af1b4313436927354644e93` **and `dirty: true`**. That marker is
not treated as proof of identical bytes: downloaded `reader.rs`, `mod.rs` and
`Cargo.toml.orig` were compared with that commit. They are equal after CRLF/LF
normalization; raw byte hashes differ and are retained. This verifies the
relevant reader/API/feature correspondence, not every file in the distribution.

**Ordinary dependency resolution initially did not build.** It selected the four
required `mzdata-*` companion crates at `0.66.7`; `mzdata 0.66.6` then failed with
`E0004`, because `IsolationWindowState::NoIsolation` was not covered. Cargo exited
`101`. The scratch lock now fixes `mzdata-spectrum`, `mzdata-meta`,
`mzdata-bindata` and `mzdata-param` to **0.66.6**, using `cargo update -p NAME
--precise 0.66.6` within upstream's declared ranges. No reader was patched,
replaced or updated. Both the failed initial lock and successful final lock are
retained. Reproduction must use the final lock rather than freshly resolve it.

| Bound identity | Value |
| --- | --- |
| Final Cargo.lock SHA256 | `9863e066c2574d699a39d0c36ea62a83c5037a3dd3f78dec6e076c43c8863e01` |
| Executed prototype source SHA256 | `0446e631935c929fdea4c410fb1d0471322ac95b34553398d275b49a2747e506` |
| Executable SHA256 | `a3bf478477aa493db3b616dfea707bf4587119b1863867e3e77c2e7f6ab1d719` |
| Toolchain | Existing Rust/Cargo **1.97.1**, `x86_64-pc-windows-msvc`, dev build with debug information |
| Enabled mzdata features | `mzml`, `miniz_oxide`, and `checksum` required by `mzml`; default features off |
| Concrete Windows normal/build tree | **61 registry packages**, plus the scratch package; exact versions and feature edges retained |

The feature graph was inspected before each build. Vendor readers, acquisition
networking, optional extra formats, signal processing, parallelism, HDF5 and
dynamic loading are off. `flate2 1.1.10` uses `rust_backend`/`miniz_oxide` and
its default `runtime_detection`; no native zlib backend is activated. Cargo
metadata/lock resolution includes inactive dependencies: for example `zlib-rs`
appears there but is absent from the active Windows normal/build tree and build.
Neither that larger list nor PX.1's direct-declaration count is the linked
dependency count. Required build scripts ran through normal tool approval.

## The executed path

Each invocation reads its small fixture once into an immutable `Box<[u8]>`.
The project-owned XML projection and a separate `mzdata` reader cursor borrow
that same allocation. After evaluation, the exact allocation is copied to an
owned evidence file; the harness checks its SHA256 against the fixture. No
reader reopens a pathname. The XML projection reaches EOF before querying;
`metadata_bytes_consumed` reports that completed snapshot length, **not an
independent byte counter**. The candidate's counted `Read` wrapper records bytes
delivered. For the direct fixture both values equal its byte length; delivery
includes buffering and does not assert interpretation of every byte by mzdata.

The metadata projection references the attribute/event mechanism in
`crates/proteowizard/src/mzml.rs` at the baseline, with attribution in the scratch
source. It retains source index/id, MS-level declaration presence/value,
representation, source RT value and original value string, array roles, and all
three unit attributes as nullable strings. XML attribute normalization is
explicit: `custom &amp; unit` becomes `custom & unit`; this is not lexical byte
preservation. Group definitions are retained by ID and expanded at immediate
spectrum, scan and array use sites. A descendant precursor MS-level marker does
not become the spectrum's declaration. Contradictory declarations and unresolved
references refuse the query; no direct-versus-reference precedence is invented.

The candidate uses **Lazy** array access. Its complete `(index, id)` key set is
checked against the metadata set; duplicate, missing, extra or conflicting
identity refuses the query. Rows are emitted in source order, without RT joins
or post-filter renumbering. Unique source array roles are checked against the
candidate's roles before the selected scan's array access. Both arrays use
`DataArray::to_f64()` according to their dtype, avoiding the convenience
`intensities()` path that narrows to f32. That is a **source-path fact**; these
dyadic fixtures do not establish general f64 fidelity or detect every narrowing.

MS-level absence and exclusion are decided before array decoding. An absent
array is `NoUsableArrays`; an undecodable pair is `Unreadable`. The first run
found that this pinned decoder **panics on invalid base64**. The adapter now
catches a panic only around array decoding and retains its stderr diagnostic,
producing `Unreadable` without a sum. The original exit-101 query evidence is
retained. This is an experimental containment measure, not a production worker
or cancellation guarantee.

The query explicitly supplies MS level **1** and closed window **[100, 102]**.
It sums stored in-window intensities in array order using binary64 addition,
with point count and selected input positions. Profile output is labelled
**point sum**, never integrated area. Bounds must be finite and ordered; there
is no smoothing, centroiding, interpolation, unit conversion or fallback.

## Pre-run answers and observed results

`generate.py` constructs fresh deterministic, zlib-compressed little-endian
binary64 mzML inputs within ADR 0046's synthetic families/invalid derivatives.
No inherited bytes or digest are claimed, and no acquisition was downloaded.
`expected.json` and the literal assertions in `proof.py` existed before the
first candidate query. The former's SHA256 is
`5e3e67267045f028a38c40a0b2bcd668b879d2bc7f5b10f333f764294da7559c`.
Neither imports the Rust query or calculates its expected result from candidate
output. The decisive finite dyadic values and sums are exactly checkable without
a tolerance. This does not choose XIC-S3's general arithmetic/agreement policy.

The eight-scan direct fixture has this pre-established answer. Positions are
zero-based input-array positions. Source order is retained even where RT goes
backwards or repeats.

| Source index / id | RT, source seconds | Expected and observed observation |
| --- | --- | --- |
| 0 / scan=1 | 120 | Unsorted m/z `[102,99,100,101,103]`, intensities `[1/4,8,1/8,1/2,16]`: positions **0,2,3**, count **3**, sum **7/8**; both endpoints included |
| 1 / scan=2 | 60 | Positions **0,1**, count **2**, sum **2^-19 = 0.0000019073486328125**, strictly positive |
| 2 / scan=3 | 120 | Position **0**, count **1**, sum **0**: a measured zero |
| 3 / scan=4 | 180 | No positions, count **0**, sum **0**: an empty window |
| 4 / scan=5 | 120 | Declared MS2 and corrupt payload: **ExcludedByMsLevel**, zero decode attempts |
| 5 / scan=6 | 120 | No declared MS level and corrupt payload: **MsLevelUndeclared**, zero decode attempts; candidate default `0` is diagnostic only |
| 6 / scan=7 | 120 | Missing intensity array: **NoUsableArrays**, no sum |
| 7 / scan=8 | 120 | Undecodable pair: **Unreadable**, no sum |

All eight source scans are observed. The result reports **three coverage gaps**
and `complete=false`; the excluded scan is not a gap. The first row retains
**120 seconds**, while candidate normalized RT is observed as **2 minutes** and
is not substituted. A separate missing-RT copy retains its measurement and
absent RT, with a coverage gap rather than a silent dropped scan.

| Focused fixture or intervention | Pre-run oracle and observed outcome |
| --- | --- |
| `referenced` | Valid group references supply MS level, profile representation, RT and both array roles/units at their use sites; positions 0,1, count 2, sum **3/8**, source RT **120 seconds** |
| `absent` | All three axes uniformly omit all unit attributes: values preserved and units unreported; count 2, sum **3/8**, no inferred unit |
| `unknown` | Nonempty `PX2:unknown` remains declared, with name/CV reference retained after XML normalization; sum **3/8** |
| `incomplete_mz_empty`, `incomplete_rt_space`, `incomplete_int_name` | Three independent single-scan copies: whole-query incomplete-unit refusal, retaining respectively empty accession, whitespace accession, or name-only declaration |
| `unresolved`, `contradictory`, `mixed_mz` | Whole-query refusal for missing reference, conflicting MS levels, or declared/absent m/z units; no fabricated zero |
| `truncated`; reversed and NaN bounds | Whole-query refusal, never a complete prefix or empty measurement |
| Injected wrong candidate ID | Exact correspondence gate refuses; no positional join repairs it |
| Candidate normalized metadata substituted | The unchanged direct-fixture oracle fails: RT becomes 2 instead of 120, and source-undeclared level becomes excluded. This reversal is not an accepted result |
| Repeated normal direct invocation | Complete semantic stdout agrees **byte for byte**; stderr/PIDs, host data and command timing remain separate |

This is **7 focused test groups / 17 process invocations over 12 fresh fixture
files**, not seventeen independent scientific fixtures. Final build and proof
commands exit **0**, with frozen Cargo dependencies. Each query has a 30-second
deadline, the proof harness 300 seconds, and builds 600 seconds; all completed
without timeout. The evidence retains actual command exits and the earlier
failures. Exit success alone is never the oracle.

## Evidence, reproduction and limits

The local retained archive is **`px2-b-evidence.zip`**, SHA256
`ca5b0b5af6d3c8d4f814f797a896de6439765ce713c4dfe7ed5105235a7f88a9`
(947,692 bytes; 205 entries, verified against its file manifest). Its location
and closeout records are in the task's
local HANDOFF. The archive contains scratch source, both locks, manifests,
generator, fixture bytes/hashes, the pre-run answers, proof harness, experimental
output schema, exact dependency/feature trees, registry/upstream comparisons,
command logs/exits, semantic outputs and after-query snapshot captures. Executable
identity is recorded; the task's local build is retained. Private machine paths
are confined to local evidence, not this repository record.

From an extracted copy, with the already approved packages cached, run:

```text
python -B run.py build-reproduce 600 cargo +1.97.1 build --frozen
python -B run.py proof-reproduce 300 python -B proof.py
```

**NOT RUN:** the full thirty-case future matrix (including the other twelve
incomplete-unit derivatives), representative MS1 acquisitions, general numeric
agreement/input-domain proof, nonfinite-intensity policy selection, performance
or memory measurements, indexedmzML/prefixed-namespace coverage or multiple
`scanList/scan` entries within one spectrum,
production Missing/partial recovery, filesystem rewrite races, cancellation,
bounded-memory service behavior, UI/native QA or provider A. The small projection
explicitly refuses unsupported roots and more than one `scanList/scan` entry
within a spectrum; it supports the multi-spectrum files tested above. It is not
an mzML schema validator. S3/S4 remain PX.3's; the other ADR decision owners are
unchanged.

The existing [issue #112](https://github.com/MianliWang/MScanvas/issues/112) owner
and the M6.6–M6.9 native campaign's **NOT RE-RUN** status remain unchanged. This
record adds no acceptance requirement to M6 and starts no M7 work.

**PX.3 NOT STARTED; separate authorization and evaluation-scope confirmation
required. XIC PROVIDER NOT ADMITTED; PRODUCTION XIC NOT IMPLEMENTED.
M6 COMPLETE; M7 NOT STARTED.**
