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

**The nine measured combinations, against the sources this product actually
converts.** Read out of the table rather than restated: the evidence column is
each row's M6.2 case identifier, and the last column is what
`evidence_covers_source` answers for the three vendor families the visible
workflow accepts.

| # | Processing | Spectra | Precision | Compression | M6.2 evidence | Domain | Offered in the vendor workflow |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | No additional centroiding | All | m/z 64 · int 32 | zlib | D1 | Any | Yes — this is `SHIPPED` |
| 2 | No additional centroiding | All | m/z 64 · int 64 | zlib | P4, P1, L3, C1 | Any | Yes |
| 3 | No additional centroiding | All | m/z 32 · int 32 | zlib | P3, P2 | Any | Yes |
| 4 | No additional centroiding | All | m/z 32 · int 64 | zlib | P5 | Any | Yes |
| 5 | No additional centroiding | All | m/z 64 · int 64 | none | C2 | Any | Yes |
| 6 | No additional centroiding | MS1 only | m/z 64 · int 64 | zlib | L1 | Any | Yes |
| 7 | No additional centroiding | MS2 only | m/z 64 · int 64 | zlib | L2 | Any | Yes |
| 8 | Unscoped default centroiding | All | m/z 64 · int 64 | zlib | K1, K8 | mzML only | **No** — measured on mzML, and mzML is not convertible here |
| 9 | Unscoped default centroiding | All | m/z 32 · int 32 | zlib | K12 | mzML only | **No** — same |

Seven of nine, on every one of Thermo RAW, Shimadzu LCD and SCIEX WIFF — and
**offered** only as far as the installed grammar reaches, exactly as before. On a
narrow build fewer than seven run, and those are refused as
`unsupported_by_installation`, which is the other sentence. The two withheld rows keep their identity,
stay in the catalog, and say `not_evidenced_for_conversion_sources` rather than
sharing the installation's sentence. **Nothing was admitted and nothing was
excluded**: rows 1–9 and the thirty-nine the cross-product refuses are M6.2's.

**The same answer reaches every consumer**, and there is no second source
taxonomy to drift from the first:

| Consumer | Where it refuses |
| --- | --- |
| `ConversionPlan::to_mzml` | First, before a name is derived, before the destination root is canonicalized or inspected, and before anything is staged |
| `run_admitted_multi_output_conversion` | Before the source object is captured, so no pin, no staging area and no provider process |
| The desktop `BEGIN` preflight | Inside the first plan pass, ahead of the receipt proof, the workspace mutation gate and `ConversionQueue::new` — so before queue commitment, before a destination picker opens and before any folder is created |
| The desktop plan command | At the catalog, through `RowAdmission`'s third answer, so a plan names the evidence rather than the build |
| The Rust-authored catalog | Derived from the families the visible workflow converts, asked through the same rule |

**The catalog keeps all nine rows** so a retained selection still has an
identity, and gains a third answer rather than a second meaning for the old one:

- `available`;
- `unsupported_by_installation` — this build's grammar cannot express the row,
  and another ProteoWizard release could;
- `not_evidenced_for_conversion_sources` — the combination is one MSCanvas
  measured, and no source this product converts is one that measurement was
  taken on.

The third answer says nothing about the installation in either direction, and
deliberately: the catalog asks applicability **before** it asks the grammar, so a
build that also could not express the row still reports this one. That is the
right way round, because the reader's remedy is the same either way and it is not
a different ProteoWizard release.

The two refusals are carried separately to every sentence a reader meets — the
note beside the control, the banner above the groups, the plan area and the
explanation of a disabled `Convert` — because a reader told to try another build
would find one that behaves identically. Each sentence is about the
**combination**, never about an axis value.

**Recovery is the ordinary one.** The reader cannot choose the withheld
combination, no other axis moves when they try, and `NoAdditionalCentroiding` is
already selected and available — so the existing one-axis route applies and the
explicit reset control stays absent. Offering it beside a working control would
claim a dead end that is not there.

**A retained selection on a withheld row is defence in depth, not a journey.**
The banner, the plan area and the disabled `Convert` all read the row's own
answer rather than the boolean beside it, so none of them can tell a reader that
their installation cannot run a combination it runs perfectly well. That state is
**not reachable in the shipped product**: the catalog withholds these rows from
the first read under every installation, the control is disabled, and the initial
selection is the shipped posture. The tests that cover it say so, and the code is
there so the sentence is right the first time a catalog does carry both refusals
at once.

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
| A vendor source cannot be planned under it at all | `a_vendor_source_cannot_be_planned_under_an_intent_measured_only_on_mzml` |
| The refusal is about the intent, not the family | `the_same_vendor_source_still_plans_under_an_intent_whose_evidence_covers_it` |
| mzML keeps what was measured | `an_mzml_source_keeps_the_measured_centroiding_combination` |
| Absent evidence is not a measured failure | `a_shimadzu_source_is_refused_for_absent_evidence_rather_than_a_measured_failure` |
| The set lifecycle cannot be used to evade it | `the_set_lifecycle_refuses_an_intent_measured_only_on_mzml`, asserting a provider call count of zero and an empty destination |
| The two refusals stay two sentences | `a_missing_axis_flag_takes_only_the_rows_that_emit_it`, now filtered on the reason rather than on unavailability |
| The refusal precedes any look at the destination | `the_applicability_refusal_precedes_every_look_at_the_destination`, planning against a root that does not exist and still getting the applicability error rather than `DestinationRootNotInspectable`. An empty existing directory would prove nothing: `to_mzml` creates nothing there under any ordering |
| `BEGIN` refuses before it commits anything | `begin_refuses_a_vendor_queue_under_an_intent_measured_only_on_mzml`: the slot is still idle, so nothing was reserved, and the backend resolution count is unchanged — `prove_begin` is what resolves it, so an unchanged count places the refusal ahead of the receipt proof, the mutation gate and `ConversionQueue::new`. `an_accepted_begin_does_resolve_the_backend` keeps that second assertion from being vacuous. A destination count and a launch count are deliberately *not* asserted: `BEGIN` carries no destination and launches nothing under any ordering |
| `BEGIN` still admits what the evidence covers | `begin_still_reserves_a_vendor_queue_under_an_intent_whose_evidence_covers_it` |
| A plan names the evidence rather than the build | `a_plan_for_an_intent_measured_only_on_mzml_names_the_evidence_not_the_build`. `RowAdmission` carries three answers, so the catalog's distinction survives the one call that used to flatten it |
| The discriminator is on the wire, not only in Rust | `the_catalog_wire_states_which_of_the_three_answers_each_row_got`, serializing a real configuration read through the production DTO and finding all three answers in one snapshot |
| The surface refuses at combination level and recovers by one axis | The `a combination this product has no source evidence for` suite |
| A retained selection is told which refusal applies | `names the source-evidence refusal for a retained selection, not the installation`, and `selectionRefusal` beside `selectionIsUnavailable` |
| The family lists agree with their index functions | `the_family_list_and_its_index_agree` in the crate and `the_dataset_family_list_and_its_index_agree` on the desktop side. **Not an exhaustiveness proof, and not claimed as one**: each sizes its coverage from the array under test, so a family absent from the array is absent from the loop. What a new variant gets is a *compile error* in the index function, which is a prompt to list it; Rust cannot enumerate variants without a derive macro and none was added. A family missing from the desktop list is refused rather than admitted, so the residual fails closed |
| A later reader-sensitive processing is classified correctly | The guard and the crate tests key on *asking for a picker* — any processing other than `NoAdditionalCentroiding` — rather than on one variant's name, so a scoped MS-level preset added under CNV-005 would be required to carry a measured domain instead of tripping the writer-side rule |
| Widening or narrowing a domain is detectable | `_validate_one_admitted_rows_source_domain` in `scripts/check_repo.py`, re-proved on the final candidate against both reversions — a centroiding row widened to `AnyAdmittedSource` and a writer-side row narrowed to mzML — each caught with the row named, and `intent.rs` restored to a matching SHA-256 afterwards |
| The guard survives a domain naming two families | The row pattern matches a single-line domain, a two-family single-line domain, **and the `rustfmt`-wrapped form this repository's `max_width = 100` would actually produce**, without running on into the next row. A narrower pattern made the row stop matching and reported a table that had lost a row — a true-sounding message about the wrong thing |

## What was and was not exercised

**Taken.** `cargo fmt --all --check`, `cargo clippy --workspace --all-targets
--all-features -D warnings`, `cargo test --workspace` (1 555 passed, 23 ignored,
0 failed), `pnpm lint`, `pnpm typecheck`, `pnpm test` (70 files, 1 694 passed),
`pnpm build`, `pnpm e2e:typecheck` and `python scripts/check_repo.py`.

**The rendered flow, and where each part of it was measured.** The
conversion-settings browser suite was run in the shipped bundle; **21 cases
passed**, of which four are this repair's. The suite as a whole is not a
single-viewport run — it already carried a three-target layout loop for an
earlier notice — so the statement below is per case rather than per suite.

- **The behavioural case runs once, at 1366×768**: the withheld combination is
  not runnable, its sentence is about the combination and is *not* the grammar
  sentence, every other axis keeps the choice the reader made, the refused
  control is out of the tab order while the way out takes focus, the note is
  neither clipped nor a cause of sideways scrolling, and the console is clean.
- **The layout of the new note is measured at all three responsive targets** —
  1920×1080, 1366×768 and 960×640 — because ADR 0043's milestone-wide
  **condition B** asks that every M6 control satisfy the inherited interaction
  principles at all three, and this repair adds a notice variant to an M6
  control. That condition is not relaxed here, and the same spec file's existing
  notice loop is the precedent followed. Only the layout question is repeated;
  the behaviour is not re-measured three times.

**Not taken, and not claimed.**

- **No four-viewport sweep, and no re-run of the suite at large.** Viewport work
  was held to the one notice this change adds, at the owner's direction, because
  the conversion surface is expected to change substantially in later work. No
  layout defect was observed in the changed surface.
- **The M6.6–M6.9 native campaign: NOT RE-RUN.** Not passed, not waived, and
  **not equivalent to the browser-mocked evidence above**, which replaces the
  Tauri boundary at `invoke` and can say nothing about a native window. What
  supports omitting it is diff inspection rather than substitution. The change
  adds **four production refusal sites** — `ConversionPlan::to_mzml`, the
  output-set lifecycle, the desktop `plan_items` and the catalog admission the
  plan command reads — plus a `ConversionPlanError` variant, a
  `MultiOutputFailure` variant, a `RowAvailability` variant, a `RowAdmission`
  variant, a DTO error kind, a new field on the catalog row DTO, a third
  plan-block reason with the eighteenth unavailable-reason beside it, and four
  rendered sentences. It touches **no** process
  supervision, cancellation, native dialog or focus plumbing, filesystem
  identity, cleanup or finalization, provider argv or algorithm, and no
  dependency manifest. **Next owner: the production UI/integration slice that
  next touches this path.** No old binary evidence is attributed to the changed
  source.
- **No real-provider smoke**, and none is owed: a restriction founded on absent
  admission does not require running the readers whose behaviour is unmeasured.

**Nothing here is attributed to rendered or native evidence that was not
produced.**

## What this leaves open

- **Whether the two combinations could be admitted for a vendor family** is
  unanswered and stays that way. It needs a reader-sensitive measurement per
  family, and a decision about what the requested-processing contract should
  say about a vendor picker. Owner: a later slice under CNV-D2.
- **M6's closure is unchanged by this record.** Criterion 2 and condition A were
  reported unproved by the draft closure audit; whether this repair discharges
  them is that audit's call to make on the new baseline, not this record's.
