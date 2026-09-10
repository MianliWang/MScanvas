# CNV-D2 — source-qualified centroiding admission

**Outcome: `CNV_D2_SOURCE_QUALIFIED`.** The two `UnscopedDefaultCentroiding`
rows now say which source families their evidence was taken on, and the product
stops offering them for the families it does not cover. **No combination was
admitted and none was excluded**; the nine measured rows and the thirty-nine the
cross-product excludes are M6.2's and are unchanged.

This is a prerequisite repair under
[CNV-D2](../architecture/adr/0043-conversion-completion-route.md#cnv-d2--processing-intent),
not an M6 slice. It renumbers nothing.

## What was wrong

[M6.10](../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md#one-shipped-claim-repaired)
measured that on a lawful Thermo acquisition the bare `peakPicking` filter these
two rows lower to selects the **vendor** picker, which the requested-processing
contract then refuses — after the provider has already run. Three facts made
that reachable:

- both rows are evidenced by M6.2 cases measured on **generated mzML fixtures**;
- the visible workflow converts **only** vendor acquisitions, because mzML is
  not convertible there;
- the catalog judged each row against the installed **grammar** alone, with no
  source dimension anywhere.

So the product offered a combination whose evidence covered no source a user
could convert. On the one family measured it fails; on the other two nobody has
measured anything, which is a different thing and is recorded as one.

## What changed

**One question, answered once, beside the evidence authority it qualifies.**
`EvidenceSourceDomain` distinguishes a measurement that generalizes from one
that does not, and `ConversionIntent::evidence_covers_source` is the only place
it is asked. Nothing infers a family from a filename, a display label, a path
spelling, an error string or a caller-supplied flag; the typed source identity
the boundary already carries is the input.

| Row | Domain | Why |
| --- | --- | --- |
| The seven writer-side rows | `AnyAdmittedSource` | Output format, numeric precision, compression and MS-level population are decided by the **writer** and act on whatever spectra the reader produced |
| The two `UnscopedDefaultCentroiding` rows | `MeasuredOn([MzmlFile])` | Peak picking is decided by the **reader**. CNV-D2 records the provider selecting vendor centroiding by a `dynamic_cast` on the immediately inner spectrum list |

**The same answer reaches every consumer**, and there is no second source
taxonomy to drift from the first:

| Consumer | Where it refuses |
| --- | --- |
| `ConversionPlan::to_mzml` | First, before a name is derived, before the destination root is canonicalized or inspected, and before anything is staged |
| `run_admitted_multi_output_conversion` | Before the source object is captured, so no pin, no staging area and no provider process |
| The desktop `BEGIN` preflight | Before queue commitment, before a destination picker opens and before any folder is created |
| The Rust-authored catalog | Derived from the families the visible workflow converts, asked through the same rule |

**The catalog keeps all nine rows** so a retained selection still has an
identity, and gains a third answer rather than a second meaning for the old one:

- `available`;
- `unsupported_by_installation` — this build's grammar cannot express the row,
  and another ProteoWizard release could;
- `not_evidenced_for_conversion_sources` — the build is fine and the combination
  is one MSCanvas measured; no source this product converts is one that
  measurement was taken on.

The two refusals are carried separately all the way to the sentence beside the
control, because a reader told to try another build would find one that behaves
identically. Each sentence is about the **combination**, never about an axis
value.

**Recovery is the ordinary one.** A retained centroiding selection stays visible
as an unavailable combination and is not silently reset; no other axis moves.
`NoAdditionalCentroiding` is one processing step away and available, so the
existing one-axis route applies and the explicit reset control stays absent —
offering it beside a working control would claim a dead end that is not there.

## What deliberately did not change

- **The integrity contract.** A vendor-picker output still fails the
  requested-processing comparison. Qualifying admission is not weakening
  validation, and the tests that pin the mismatch are untouched and passing.
- **The other seven rows, `SHIPPED`, and every stable intent identity.**
- **The measured composition vocabulary.** Nine admitted, thirty-nine excluded.
- **No source family was added**, no vendor algorithm was exercised, and no
  dependency was added. mzML conversion is **not** added to the desktop roster:
  the mzML combinations are retained through the existing crate APIs, which is
  where they were measured.
- **Shimadzu LCD and SCIEX WIFF are not measured failures.** They are withheld
  because the reader-sensitive evidence is absent. Missing acquisitions do not
  block a restriction whose whole content is to withhold what was never measured.

## Evidence

| Claim | How it is held |
| --- | --- |
| Every row states its domain, and only the centroiding rows are narrowed | `each_admitted_row_states_the_sources_its_evidence_covers`, `seven_rows_cover_every_family_and_two_cover_only_mzml` |
| Each affected intent against every source family | `evidence_applicability_is_answered_per_row_and_per_source_family`, over an exhaustive family list |
| `SHIPPED` still covers every family | `the_shipped_posture_still_covers_every_source_family` |
| The vocabulary is unchanged | `the_measured_vocabulary_is_unchanged_by_source_qualification` — nine admitted, thirty-nine excluded, recounted from the cross-product |
| A vendor source is refused **before any side effect** | `a_vendor_source_cannot_be_planned_under_an_intent_measured_only_on_mzml`, asserting the destination directory is still empty afterwards |
| The refusal is about the intent, not the family | `the_same_vendor_source_still_plans_under_an_intent_whose_evidence_covers_it` |
| mzML keeps what was measured | `an_mzml_source_keeps_the_measured_centroiding_combination` |
| Absent evidence is not a measured failure | `a_shimadzu_source_is_refused_for_absent_evidence_rather_than_a_measured_failure` |
| The set lifecycle cannot be used to evade it | `the_set_lifecycle_refuses_an_intent_measured_only_on_mzml`, asserting a provider call count of zero and an empty destination |
| The two refusals stay two sentences | `a_missing_axis_flag_takes_only_the_rows_that_emit_it`, now filtered on the reason rather than on unavailability |
| The surface refuses at combination level and recovers by one axis | The `a combination this product has no source evidence for` suite |
| Widening or narrowing a domain is detectable | `_validate_one_admitted_rows_source_domain` in `scripts/check_repo.py`, proved against both reversions in isolated copies |

**What was not exercised for this repair.** No rendered four-viewport sweep and
no native desktop harness run were taken, at the owner's direction, because the
conversion surface is expected to change substantially in later work. The
repair's behaviour is held by the unit and boundary evidence above, and the
frontend and Rust suites and repository validation all pass. **Nothing here is
attributed to rendered or native evidence that was not produced.**

No additional provider measurement was needed: a restriction founded on absent
admission does not require running the readers whose behaviour is unmeasured.

## What this leaves open

- **Whether the two combinations could be admitted for a vendor family** is
  unanswered and stays that way. It needs a reader-sensitive measurement per
  family, and a decision about what the requested-processing contract should
  say about a vendor picker. Owner: a later slice under CNV-D2.
- **M6's closure is unchanged by this record.** Criterion 2 and condition A were
  reported unproved by the draft closure audit; whether this repair discharges
  them is that audit's call to make on the new baseline, not this record's.
