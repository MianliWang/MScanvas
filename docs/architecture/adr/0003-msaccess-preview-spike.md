# ADR 0003 — Spike external ProteoWizard access for initial RAW preview

- Status: Accepted for M1–M2 preview navigation with named limits; remaining capabilities gated
- Date: 2026-07-22; representative evidence 2026-07-27

## Context

The viewer needs metadata, TIC/BPC and individual spectra without implementing vendor readers or immediately embedding the ProteoWizard C++ API.

## Decision

M0 will evaluate `msaccess` or another documented ProteoWizard command route as the first preview provider. This is not accepted as the permanent architecture until latency, output stability, cancellation and large-file behavior are measured.

## Exit criteria

- metadata, TIC/BPC and one selected spectrum are retrievable from representative data;
- first useful preview latency is acceptable;
- parsing is testable with lawful fixtures;
- repeated scan navigation does not spawn an unusable number of expensive processes;
- failure and cancellation are diagnosable.

If the spike fails, compare temporary open-format indexing or a narrow native reader bridge.

## Bounded spike result — 2026-07-24

The first bounded Windows pass found no runnable `msconvert.exe` or `msaccess.exe` on `PATH` or in the reviewed normal installation roots, and read the retained Windows Installer version record with `ProductState = ABSENT` as residual metadata rather than an installed version. **Corrected 2026-07-27: the host did have a working ProteoWizard 3.0.26013**, installed where the reviewed roots did not reach, and the retained version record matched it exactly. See the correction section below.

Explicit authorization was later granted to download and install the current official Windows x64 vendor-reader build. The exact official `3.0.26204` / `a09eea9` MSI was downloaded and hashed, with no redirect, but Windows reported Authenticode `NotSigned` and no signer. The mandatory trust gate stopped before execution, installer UI, elevation or installation; no alternate installer or unofficial source was tried. This advertised artifact identity is not an installed or executable-reported version.

The narrower portable continuation then verified the official download page, its `bt83` release record and its own S3 resolver for the matching Windows x86_64 `3.0.26204` / `a09eea9` tarball. The `97,078,806`-byte archive had SHA-256 `A0B92B40456E080B1CB5CBEDAE0B95664F43FE3B723972FE388A60E0341564E2`, no redirects, and no unsafe archive path, duplicate normalized path, link or extraction escape. Static inventory found exactly one `msconvert.exe` and one `msaccess.exe`; both were unsigned. No portable binary was executed on the host.

The local isolation gate stopped fail-clean without changing Windows features. A later exact-head evidence workflow used an ephemeral GitHub-hosted `windows-2025` VM. The unsigned portable tools ran only as a temporary non-elevated standard user after exact archive/fixture/executable hashes, scoped ACLs/environment, an owned Windows Job and three exact-program outbound blocks were verified. Independent cleanup proved the process tree, firewall rules, user/profile/logon right, runtime root and private state absent. No source checkout was present in the runtime job.

Exact run [`30129182032`](https://github.com/MianliWang/MScanvas/actions/runs/30129182032) at `f0d7957fbbe129263a9a89684b6ce549b1b3a086` passed both jobs and every cleanup/publication gate. Complete help confirmed the typed argv and executable-reported normalized release `3.0.26204`; `msconvert` also emitted revision `a09eea9`, while `msaccess` did not emit a revision. The verified four-spectrum/two-chromatogram synthetic mzML fixture produced parseable metadata, summary, spectrum table, derived TIC, filtered TIC and one selected spectrum. One-shot backend durations were 90–205 ms and do not establish representative latency.

The decision is capability-specific:

- **A:** discovery/build identity for this verified portable pair.
- **B:** metadata; summary/counts; derived TIC and MS-level filtering; scan listing; selected-spectrum extraction; overall conversion and mzML conversion, each with the limitations in the spike report.
- **C:** mzXML conversion for the tested multi-source fixture, because exit 0 serialized only 3 of 4 spectra; it is unsuitable without mandatory integrity validation.
- **D:** BPC, repeated navigation, large arrays, progress, real cancellation, locale stability and vendor-format coverage.

The table formatter abbreviates spectrum IDs while binary output uses raw IDs; the measured `19` and `scan=19` refer to the same index-0/scan-19 spectrum. A durable adapter must canonicalize identity rather than exact-compare formatter strings. The `tic` query sums binary intensities and emits index order, so it must be labeled as a derived/recomputed TIC and normalized for RT display rather than silently treated as a stored TIC chromatogram.

Process exit status is also insufficient as an operation result. `msaccess` returned exit 0/no output for both a deliberately unavailable index and an unsupported text input; only the latter emitted stderr. A typed preview executor must distinguish expected no-result from missing/malformed required output without relying on one locale's error text.

The code-contract portion validated fail-closed canonical-path discovery/planning, matching release/build identity checks, bounded diagnostic capture and Windows Job Object cancellation with a controlled parent/grandchild process tree, including root-exits-first and late-cancellation cases. Non-probe harness operations reject truncated help before requiring exact option/query markers, reject output inside directory-formatted inputs and require a fresh empty output directory. Those controlled cancellation tests do not substitute for a real ProteoWizard cancellation observation.

The detailed evidence and explicit not-run matrix are recorded in the [M0 ProteoWizard spike report](../../spikes/M0_PROTEOWIZARD_SPIKE.md).

## M0C Slice 1 contract result — 2026-07-26

The evidence-backed preview subset now has typed Rust parsers and an operation-specific
interpreter. Metadata parsing preserves the measured section order and opaque ordered
field content without inventing field semantics. Run-summary, spectrum-table, derived-TIC
and selected-spectrum outputs retain their measured structural distinctions, while
retention-time units remain explicitly unknown whenever the backend did not emit a unit.

TIC remains a derived/recomputed summed-intensity series. Its points preserve source
spectrum indices and backend order, with a separate retention-time-ordered projection
that does not mutate the source view. Canonical spectrum identity preserves every raw
representation and the zero-based index, reconciles only exact numeric display IDs,
exact `scan=<N>` native IDs and explicit scan numbers, rejects contradictory scan
numbers and leaves other native-ID forms opaque.

The interpreter permits exit 0 plus zero output files to become typed `NoResult` only
for the selected-spectrum operation when both diagnostic streams were captured
completely and are empty. Diagnostic-bearing or incomplete no-output behavior remains
unclassified. Missing, empty, malformed or extra output for a required preview operation
is a semantic failure, while non-zero exit and process launch/cancellation failures
remain separate. Unsupported-input-like exit 0 behavior is not classified from English
stderr and remains conservative when no stable structural marker exists.

This slice did not execute ProteoWizard, change dependencies, add UI or Tauri behavior,
or change conversion behavior. It adds contract and deterministic fixture evidence only;
none of the bounded runtime observations or A/B/C/D ratings above are upgraded.

## M0C Slice 2A contract result — 2026-07-26

mzML conversion integrity is now a typed library contract instead of a check deferred to a
temporary evidence orchestrator. The adapter owns a bounded mzML inspector that refuses
document type declarations and undeclared entities, never base64-decodes or decompresses a
binary array, and fails closed on explicit document, text-run, depth, element, attribute
and record limits. Controlled-vocabulary facts are recognized by accession and scoped to
their immediate parent, so an aggregate `fileContent` marker is no longer conflated with
per-spectrum representation.

A conversion is compared against source facts captured before it ran and recaptured after,
covering filesystem identity, byte length and content hash, so a source changed during the
conversion is observable. Required invariants are spectrum and chromatogram counts,
MS-level distribution, per-record binary-array counts, roles, declared point counts and
payload presence, precursor counts, consecutive index sequences, recognized scan-number
agreement, output internal consistency and the requested zlib compression policy.

Numeric-encoding markers, the `indexedmzML` wrapper, byte length, representation markers the
source never emitted, retention-time unit markers and a source's own inconsistent declared
count are descriptive observations, never failures. Vocabulary-derived facts and native
identity degrade to unverified when a `referenceableParamGroup` or an opaque identifier
form makes them unestablishable; failing on unverified-ness would reject the common Thermo
native identifier form and therefore every real conversion.

No claim of byte-for-byte equivalence, general losslessness or vendor fidelity is made, and
no legal serialization difference fails a conversion. Source-versus-output comparison
applies only to an mzML source; a vendor acquisition is recorded as not comparable rather
than implied equivalent.

This slice did not execute ProteoWizard, change UI or Tauri behavior, enable mzXML or BPC,
or add a stable CLI contract. It added one approved production dependency, `quick-xml`
`=0.41.0` with default features disabled, scoped to the bounded scanner; the crate was
already in the lockfile through `tauri`, so no crate entered the dependency graph. None of
the bounded runtime observations or A/B/C/D ratings above are upgraded.

## M0C Slice 2B representative evidence — 2026-07-27

One representative public acquisition was measured in isolation: PRIDE `PXD081190`,
`208,408,454` bytes, CC0, SHA-256 pinned by a separate acquire-and-attest run before any
measurement. It is `indexedmzML` with `36,319` MS2 spectra, no chromatograms, and declared
point counts from `10` to `399`.

Selected-spectrum retrieval cost `163`–`198` ms of backend time regardless of index
position, and twenty-four deterministic indices repeated over three passes held a backend
p50 of `164` ms with p95 between `186` and `194` ms and a maximum of `199` ms. Access did
not degrade with position or repetition, and later passes were not faster. One process per
navigation step is therefore viable for this file without a cache; no cache exists in this
slice and none of these numbers may be attributed to one. Every timing is a single
observation on a shared two-core hosted runner and is advisory.

mzML conversion of the representative file returned `ConversionIntegrityOutcome::Valid`
with thirteen of fourteen properties verified, the exception being the opaque native
identifier form the canonical identity contract deliberately leaves unverified. An
independent .NET XmlReader pass agreed on validity and on both counts. The tiny control
also returned `Valid`, with vocabulary-derived properties correctly degraded to unverified
because that fixture reaches them through a `referenceableParamGroup`. Numeric precision
and byte length differing remained advisory. Both converted outputs were re-inspected and
then navigated successfully.

The 8 MiB preview parser cap was left unchanged and not reached: the complete spectrum
table for `36,319` spectra was `4,013,391` bytes and parsed in `40 ms`.

Two limits were observed rather than assumed. The `tic` query returned exit 0 with no
generated output on this acquisition, which the typed contract refused to treat as success;
that is a capability observation, not a defect. And selecting a legitimately peakless
spectrum was falsely rejected as malformed, which was corrected so that a spectrum with no
peaks is a valid result with empty arrays.

### Exit-criteria decision

- **Met:** metadata and one selected spectrum are retrievable from representative data;
  parsing is testable with lawful fixtures; repeated scan navigation does not spawn an
  unusable number of expensive processes; failure is diagnosable through typed results.
- **Partially met:** first useful preview latency is acceptable for selected-spectrum
  navigation on this file, but whole-run operations cost seconds and only one file was
  measured.
- **Not met:** TIC/BPC from representative data — BPC has no installed query and `tic`
  produced nothing here; cancellation remains undiagnosed against a real backend.

The status therefore moves from proposed to **accepted for M1–M2 preview navigation with
named limits**: metadata, run summary, spectrum table, selected-spectrum navigation and
mzML conversion behind the typed integrity contract. TIC, BPC, mzXML, vendor formats,
alternate locales and cancellation stay outside that acceptance.

## Next evidence gate

Remaining gates are TIC and BPC from representative data, real backend cancellation and
partial-output behavior, alternate-locale parsing, vendor-format coverage, and MS1 and
chromatogram behavior, which this MS2-only acquisition could not exercise. A preview cache
remains a separate design decision and is not implied by these measurements.

## Correction: the host backend was present, 2026-07-27

The 2026-07-24 conclusion that this development host had no usable ProteoWizard
was wrong. ProteoWizard 3.0.26013 was installed under `%LOCALAPPDATA%\Apps`,
which was not one of the reviewed installation roots, so discovery returned
`backend_not_found` and every host-scoped conclusion in this ADR followed from
that.

This does not change any decision recorded here. The typed preview contracts,
the canonical-identity reconciliation, the disposable-VM evidence and the
representative-scale measurements were all obtained without relying on a host
installation, and none of them is weakened by one being present. What changes is
the confidence attached to discovery itself: a negative host-discovery result
was treated as evidence that the failure path behaves correctly, and it was
instead evidence of a defect in discovery.

The defect is fixed on `fix/per-user-proteowizard-discovery`, together with a
release-ordering defect found while reviewing it. Discovery now finds the
per-user installation on the affected machine.

One gate this closes and one it does not. Metadata, the run summary, the
spectrum table and selected spectra have now been exercised against a real
backend on a real 208.5 MiB acquisition, including the first index past the end,
which returned the typed no-result the desktop boundary depends on. TIC and BPC
from representative data, real backend cancellation, alternate-locale parsing
and vendor coverage remain open exactly as recorded above.
