# ADR 0070 — Computation over the arrays the project-owned mzML reader decodes

Status: **Accepted (2026-10-30)**, by the owner's decision U7 recorded under
[Owner decision, 2026-10-30](#owner-decision-2026-10-30). Decisions 1 and 2
are U7's recommendation, option (a). Decision 3 is added here and is
[open question 1](#open-questions). Nothing here is implemented, and this ADR
alone admits no computation: each one needs its own record (decision 1).
Plan: [owner decisions](../../development/OWNER_DECISIONS_V511.md), U7;
[roadmap](../../development/ROADMAP_V511_AND_ANALYSIS.md), N-13 and N-14.
Amends: [ADR 0056](0056-project-owned-mzml-reader-for-viewing.md), decisions
4 and 7 (a note in each).
Related: [0028](0028-figure-renderer-and-semantic-specification.md),
[0046](0046-post-m6-xic-provider-runtime-route-lock.md),
[0056](0056-project-owned-mzml-reader-for-viewing.md),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md);
ADR 0068 (proposed in PR #183).
Sources: the XIC evaluation (`XIC_EVALUATION.md`, sections 5–9 and 11) and
the analysis research synthesis (`SYNTHESIS.md`, section 5.2), both in the
planning workspace, not in the repository.

## Context

**ADR 0056 keeps computation out of the reader.** Its decision 7: "Any
computation over the decoded arrays is an algorithm, and it needs its own
record." Its decision 1 lists "any computation over the decoded arrays (XIC,
summed spectra, peak picking)" as out of scope, and its decision 4 bounds what
an open retains: "1,000,000 rows and offsets, and never arrays." The reader
decodes the arrays of one selected spectrum per call.

**Planned functions compute over many spectra:**

- the XIC (VIEW-007): a sum of stored intensities inside an m/z window, per
  scan. On 2026-10-30 the owner chose its re-entry through a new scope record,
  X0 (X-1), and its first-scope semantics (X-2);
- the RT × m/z map: the greatest stored intensity per cell of a bounded
  raster. ADR 0068 (Proposed) is its record;
- the run summary's retention times at cumulative base-peak intensity,
  computed from the declared base-peak values the table pass reads, under a
  short record (R-1, part 2 (c));
- later, a summed spectrum.

Without one decision for the class, each of them would amend ADR 0056's
decision 7 and its retention rule again (U7's option (b)), or stay refused
(option (c)).

## Decisions

### 1. Projections of stored values are admitted, one record each

- **The class.** MSCanvas may compute, in Rust, over the m/z and intensity
  arrays that ADR 0056's reader decodes, and over the per-spectrum values it
  reads (R-1's retention times are the first such case).
- **Its limit.** U7 admits these computations because they "are simple
  projections of documented values (a sum inside a window, a statistic per
  bin), not reimplemented mature algorithms". So the class is selections,
  counts, sums, extrema and similar statistics of stored values, within a
  window, bin or set of spectra that the record defines. It does not admit
  centroiding, peak picking, smoothing, baseline or noise estimation, feature
  detection, deisotoping or any other mature algorithm. For those, AGENTS.md's
  rule stands: reuse a mature backend, and reimplement one only under its own
  written decision.
- **One record per computation, before its code merges.** The record fixes the
  computation's semantics and its tests. Its scope is its limit, as ADR 0056
  decision 7 says of that ADR. A computation no record names stays refused.
- **A record is accepted as any ADR is.** It does not reopen the class or
  decision 2, and needs no further amendment of ADR 0056.

### 2. A bounded, cancellable pass may run and keep only its result

This amends ADR 0056 decision 4's "never arrays", and the reader's rule that
it decodes the arrays of one selected spectrum per call. X-1 accepted the same
amendment for the XIC (XIC evaluation, section 11, item 1).

- **A pass** reads many spectra of one file, up to all of them, and decodes
  each one's arrays under ADR 0056 decision 2's caps and decision 1's
  refusals.
- **Bounded.** It holds the decoded arrays of one spectrum at a time (at most
  decision 2's 128 MiB) and drops them before the next. Beside them it holds
  its result, whose maximum size its record states. A record that needs more
  spectra at once amends this decision.
- **Cancellable.** It checks for cancellation between spectra. A cancelled
  pass never returns a result presented as complete.
- **Keeps only its result.** No decoded array outlives its spectrum's step in
  the pass. No cache, index or copy of stored values is kept, in memory or on
  disk. That would be the XIC evaluation's option 3 (section 9), which X-1 did
  not choose; it needs its own decision.
- **Unchanged:** the open's table pass, the selected read, the preview state
  and its lifetime (ADR 0056 decision 4), and what admits and serializes a
  read (ADR 0056 decision 3, ADR 0057). Which lane a pass takes, and how it
  interleaves with selected reads, is its record's: X0's for the XIC (X-1,
  section 11, item 12).

### 3. What each record states (open question 1)

Each record answers these in its own words. The list is drawn from the XIC
evaluation (sections 5–8) and ADR 0068, and chooses no answer for any record.

1. **Input.** Which spectra (MS level; polarity once the reader reports it).
   Which traversal: the table's offsets through the selected read, as ADR 0068
   does, or a sibling pass with its own required values, as the XIC evaluation
   proposes. Which of ADR 0056's open refusals stand in front of it.
2. **Operands and bounds.** Typed operands, checked in Rust before any
   spectrum is read. Non-finite, reversed or overflowing bounds are refused.
   The resolved bounds are kept exactly (shortest round-trip decimals) in the
   result, the export and the caption, never rounded.
3. **Units.** As each array and scan declares them, never converted: nothing
   converts between seconds and minutes. An undeclared unit stays not
   reported. The record states its rule for mixed or partly declared units.
4. **Profile and centroid.** The declared representation is carried, not
   verified, and nothing is centroided. The record names its quantity for
   each representation and for an undeclared one, and says what mixing them
   does. Nothing is called an area unless it is one; a profile point sum is
   not (ADR 0046).
5. **No invented values.** An empty window or bin has no value; it is not
   zero. A measured zero and a negative intensity are values. Nothing is
   interpolated, smoothed or filled, and a gap is never joined. A spectrum the
   computation cannot use is either a stated gap or a whole refusal, as the
   record says, and never skipped silently. Refusals are typed and scoped, and
   there is no fallback to `msaccess` or another reader.
6. **Arithmetic.** The operation and its precision (for example the XIC's
   exact sum, XIC-S3), and what a non-finite or unrepresentable value does.
7. **Retention.** The result's maximum size, where it is kept and when it
   ends.
8. **Running.** Cancellation and supersession between spectra; the source
   generation checked before and after the pass; progress as spectra read out
   of the table's count, never an estimated time.
9. **Provenance.** The result names its source and generation, its record,
   the operands as typed and as resolved, the representation and units, and
   the counts of spectra used, excluded and refused. Its exports carry the
   same.
10. **Export.** Whether export is in scope. If it is, through the shared
    semantic figure specification (ADR 0028) and the existing no-overwrite
    export path, with a data document that carries item 9. The webview
    receives a bounded projection of the result, never decoded arrays.
11. **Evidence.** Fixtures with an independent reference, and time and memory
    measured on a real file with a release build. Practicality is judged on
    the measured numbers, with no threshold set in advance (ADR 0046's PX.4
    rule).

## Records under this decision

| Computation | Record | State |
| --- | --- | --- |
| RT × m/z map: the greatest stored intensity per cell of a bounded raster | ADR 0068, PR #183 (`be/map2d`) | Proposed. Its acceptance is N-14, and MAP-1 is open. It reads one MS1 spectrum at a time through the selected read and keeps the raster, so it fits decision 2 as written |
| XIC: a per-scan sum of stored intensities inside an m/z window | The X0 scope record (N-13) | Not written. X-1 and X-2 decided its scope; this ADR does not restate it |
| Retention times at 25, 50 and 75% of cumulative base-peak intensity, from the declared base-peak values | A short record, N-B1's last slice (R-1, part 2 (c)) | Not written. Until it is accepted and matched to `msaccess` on a recorded fixture (HR-1), the times stay `msaccess`'s (R-1, part 2 (a)) |
| Summed spectrum | None | Later (U7) |

The owner-decisions list says the umbrella decision "is written with N-13
(X0)". It is written here on its own instead, so that X0 and ADR 0068 both
stand under it.

## What this amends

- **ADR 0056 decision 4.** The preview state still retains no arrays. A pass
  under decision 2 may decode the arrays of many spectra, one at a time, and
  keep only its result (a note there).
- **ADR 0056 decision 7.** The records it asks for are written under this ADR
  (a note there).
- **Not changed now:** `crates/proteowizard/AGENTS.md` ("only the m/z and
  intensity arrays of one selected spectrum"; "Never ... compute from the
  arrays") and the `mzml_reader.rs` module comment. They stay true until a
  record's code lands (open question 2).

## Consequences

- No code changes here, and no dependency is needed.
- The owner is asked once about the class and the retention rule, and each
  record still fixes its own semantics and tests.
- A projection can still mislead: a profile point sum read as an abundance, or
  a greatest value per cell read as a sum. Each record carries its quantity's
  name (decision 3, items 4 and 9).

## Alternatives rejected

- **Records only, the owner asked each time (U7 (b)).** The XIC and the map
  would amend the same invariant twice, in parallel.
- **No computation over arrays (U7 (c)).** The XIC and the map stay refused.
- **A precomputed index of stored values (XIC evaluation, option 3).** About
  400 MB for the R0 profile file (an estimate). Held in memory it breaks "never
  arrays"; on disk it is a persistence model that ADR 0046 §4 refuses for this
  route. It waits for a measured need.

## Owner decision, 2026-10-30

**Decision U7.** Shown the list of the decisions that block work now, the
owner replied verbatim "全部按推荐，继续" ("all as recommended, continue").
That accepts U7's recommendation, option (a), and answers its question in
two parts:

1. **One umbrella decision:** yes. Project-owned computations over the
   reader's decoded arrays are admitted, each with its own per-algorithm
   record: the XIC's per-scan sum, the MS1 map's binning and, later, a summed
   spectrum (decision 1).
2. **The retention invariant:** amended, so that a bounded, cancellable full
   pass may run and keep only its result (decision 2).

The same reply accepted X-1, which takes the XIC evaluation's section 11,
item 1 as recommended: this written decision, with the reader's
one-selected-spectrum decode rule amended. It also accepted R-1, which puts
the base-peak retention times under a short record of this kind.

Not decided by U7, and still open: the two questions below; MAP-1 and ADR
0068's acceptance (N-14); the XIC's X0 record, and X-3; R-1's record for the
retention times.

## Open questions

Added by this ADR; U7 does not answer them.

1. **Decision 3's list.** Is it the minimum that each record states?
   Recommended: yes. It chooses no answer for any record, and ADR 0068 and the
   XIC evaluation already answer most of it.
2. **The crate's guidance.** `crates/proteowizard/AGENTS.md` says the reader
   decodes "only the m/z and intensity arrays of one selected spectrum" and
   must never "compute from the arrays". Recommended: keep both lines until
   the first record's code lands, and change them in that slice to name this
   ADR and that record, so the guidance never admits a computation that no
   record names.
