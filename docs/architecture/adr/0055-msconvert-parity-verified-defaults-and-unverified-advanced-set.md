# ADR 0055 — msconvert parity: verified defaults and an unverified advanced set

Status: **Proposed.** Date: 2026-10-28.
Related: [0002](0002-external-proteowizard.md),
[0024](0024-sciex-sample-completeness.md),
[0043](0043-conversion-completion-route.md),
[0044](0044-conversion-configuration-authority.md),
[0045](0045-conversion-completion-closure-and-handoff.md),
[0047](0047-first-windows-beta-scope-and-implementation-route.md#owner-decisions-at-publication-2026-10-28).
Evidence: [msconvert 3.0.26013 help capture](../../spikes/MSCONVERT_HELP_CAPTURE.md),
[option inventory](../../spikes/MSCONVERT_OPTION_INVENTORY.md),
[M6.2](../../spikes/M6_MSCONVERT_CAPABILITY_EVIDENCE.md),
[M6.10](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md).

## Context

**The conversion catalog is evidence-bound.** ADR 0043 made it a rule that a
setting exists only because the installed executable was measured doing what
the setting claims, not because `msconvert --help` lists it. M6.2 measured
twelve candidates on one build (3.0.26013, `msconvert.exe` SHA-256
`9BB6F5D5…90BD`). M6.3 typed what passed as a closed table of nine admitted
rows, out of the 48 combinations a free cross-product of five fixed axes allows.
The product therefore offers:

- one output format, mzML;
- four precision postures and zlib on or off;
- MS1-only or MS2-only population;
- default centroiding, which only mzML sources reach, and the visible
  workflow does not convert mzML.

Vendor families convert only on that one executable digest.

**The refusals are recorded and reasoned:**

- **mzXML** (CNV-D1, `MZXML_REFUSED`). On a two-source document the writer
  dropped every spectrum of the non-default source at exit 0 with empty stderr,
  under a header declaring all four (M6.10 case X2).
- **`peakPicking cwt`**. It silently returned one of three peaks, and it
  aborted with an unterminated document on unflanked input (M6.2).
- **Vendor centroiding** stays evidence-blocked. No lawful profile-mode
  vendor acquisition exists for it.
- **"Settings outside the admitted catalog"**, which the after-beta-1 plan
  lists as staying refused.

**The ProteoWizard hold.** Any run of a ProteoWizard executable needs the
owner's bounded release. The help text this ADR rests on was captured under
one such release, for the help only, and no conversion ran. Its digest equals
the one M6.2 recorded.

**The owner's direction of 2026-10-28** (option C, recorded in
[the after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#2-owner-decisions-2026-10-28)
and [ADR 0047](0047-first-windows-beta-scope-and-implementation-route.md#owner-decisions-at-publication-2026-10-28)):

- MSCanvas is to be no less capable than msconvert;
- verified settings stay the default;
- every other msconvert option is offered in an advanced set, labelled as not
  verified by MSCanvas;
- arguments are typed, never a free-text box;
- private staging, no overwrite and the output checks are kept;
- combinations known to lose data stay blocked.

That reverses the evidence-bound rule for the advanced set. This ADR states
how. It is about options, not builds: which builds may convert a vendor family
is unchanged, and is left as an [open question](#open-questions-for-the-owner).

**The distance to parity** is the
[option inventory](../../spikes/MSCONVERT_OPTION_INVENTORY.md). The help lists:

- 59 switches, ten of which choose the output format, and the positional
  filemasks;
- 39 spectrum filters and 2 chromatogram filters.

MSCanvas emits one format switch (`--mzML`), the precision and compression
switches its nine rows carry (`--64`, `--32`, `--mz32` with `--inten64`,
`--zlib` and `--zlib=off`), and two filters (`msLevel` and the gated default
picker). It offers no other switch.

## Decisions

### 1. Three tiers, and what "known to lose data" means

Every option of the verified build's help gets a tier. The inventory assigns
all 103 rows. A row's tier can depend on the combination and the source family:
`--64` is verified in its measured combinations and advanced otherwise, and
bare `peakPicking` is blocked on Thermo RAW. A row covered by another, such as
`-n/--numpressAll` or `analyzerType`, names the row that covers it.

- **Verified default.** Four conditions hold, and no label is shown:
  - ADR 0043's three admission questions (CNV-D2): the measured vocabulary
    contains the combination; the installed build can express it; and the
    measurement was taken on this kind of source;
  - and the executable is the verified build, `msconvert.exe` SHA-256
    `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD`, the
    identity ADR 0043's contract 3 binds every measured setting to.

  On any other build nothing is verified. The vendor families stay refused
  there, as today; an mzML source still converts, with every setting labelled.
- **Advanced.** The installed build's own help lists the option, and it is not
  blocked. It is offered labelled "not verified by MSCanvas" (decision 3),
  inside the envelope of decision 2.
- **Blocked.** Not offered. Each blocked row names its reason.

**Known to lose data** means all three of these:

- an outcome the user did not ask for;
- data present in the source missing or altered in the output, while the run
  reports success;
- either measured on the verified build, or stated by the help itself.

Loss the user asks for is different, and it is defined by effect, not by name.
An option is **lossy by request** when, as the help describes it, it removes,
merges or alters spectra, peaks, chromatograms, array values or metadata the
source holds. That covers every filter that selects spectra, the picker steps,
threshold, denoising, deisotoping, the refiners, truncation and numpress, and
switches such as `--ddaProcessing` and `--combineIonMobilitySpectra`. The
inventory marks it per row, and the step and the plan summary name the loss.
Numeric precision is the one exception: every row states it, and the check
verifies it on every array.

A format that keeps only part of a document says so in the format choice:
mzXML and mgf keep no chromatograms, ms1 and cms1 keep MS1 spectra only, and
ms2 and cms2 keep MS2 spectra only.

Lossy-by-request options are offered, not blocked. Without this distinction
every subsetting filter would look blockable, and parity would mean nothing.

### 2. The envelope, the same for both tiers

- **Typed arguments only.** React sends a structured, typed intent through the
  configuration authority of
  [ADR 0044](0044-conversion-configuration-authority.md), as amended below, and
  Rust owns everything after that:
  - Rust builds the intent from the structured value, validates every value and
    every rule of decision 4, and lowers it to argv, deterministically.
  - The receipt binds the whole intent, chains included.
  - Each `--filter` and `--chromatogramFilter` is one argv element.
  - No field is a free-text argument box, and no configuration file
    (`-c/--config`) is ever passed.
- **String-valued parameters are typed fields.** These are native IDs, the
  `titleMaker` template and the Thermo scan-filter match. Rust refuses control
  characters, and refuses any character that would split a value meant to be
  one token.
- **File-valued parameters** come from a Rust-owned picker and never from a
  path typed in React. These are `mzRefiner`'s identification files,
  `diaUmpire`'s parameter file and `--contactInfo`.
  - Inside a `--filter` value the provider splits on whitespace, and a chosen
    path, or the destination the staging area sits under, can contain spaces.
  - So Rust copies each chosen file into the item's private staging area under
    a generated name with no whitespace, keeping its extension, before launch.
    The run reads the copy, so the content is fixed when the plan is bound.
  - The argv names the copy by a path relative to the provider's working
    directory, so no component of the token comes from a chosen path or from
    the destination's path.
  - The copies sit outside the directory output discovery reads.
  - Rust refuses the item if a token it would emit still contains whitespace.
- **Private staging and no overwrite.** msconvert always writes into the
  private staging directory. MSCanvas finalizes the output under the name its
  plan derives (for a SCIEX output set, the backend's names, as today); Fail
  and Skip remain the only conflict policies. `-o`, `--outfile`, `-e`,
  filemasks and `-f` stay MSCanvas's own (the inventory's "envelope" rows).
- **Exactly one format flag**, from one typed enum (CNV-D1).
- **The five judgements and the output checks** of decisions 5 and 6 run for
  every item, advanced or not.
- **The executable is re-verified before launch.** A binary that changes
  mid-run still fails (`ExecutableChanged`).

### 3. One label: "not verified by MSCanvas"

The label is a resource value in `en` and `zh-CN`. It appears:

- on the collapsed **Advanced options** disclosure;
- on each advanced step or switch;
- in the plan summary before Run;
- on the outcome of every queue item finalized with any advanced setting,
  shown even when every check passed;
- in the redacted diagnostics export, which lists the advanced settings used.

There is one label and no explanatory paragraph, in keeping with the owner's
direction to remove secondary explanations. The disclosure is collapsed by
default.

### 4. An ordered filter chain replaces the nine fixed rows

`ConversionIntent` becomes:

- a format;
- an encoding: per-array precision, compression, numpress, truncation,
  prediction and index;
- an ordered spectrum chain;
- an ordered chromatogram chain;
- a typed set of reader and writer switches.

Each chain step is an enum variant carrying only its own typed parameters.
These are CNV-D2's structural obligations 1 and 2, written in 2026-09 for
exactly this chain.

Rules enforced when an intent is built, not when it is displayed:

- a vendor `peakPicking` step may only be first (help lines 207–208);
- `cwt` is unrepresentable;
- `snr`, `peakSpace` and `msLevel=` exist only on a picker variant that
  consumes them;
- format-bound options exist only with their format:
  - the mzMLb chunk size and compression level with mzMLb;
  - with mzXML, one global precision, `--32` or `--64`. Its `<peaks>` element
    holds m/z-intensity pairs at a single precision, so per-array precision
    cannot be expressed. Numpress, truncation and prediction are not offered
    with mzXML either: its `compressionType` can declare only none or zlib, so
    the file could not say what was done;
- encoding options exist only in the combinations a controlled-vocabulary term
  can name (decision 5):
  - truncation and prediction exist only with zlib on, because every term for
    them includes zlib;
  - on one array role, numpress excludes truncation and prediction, and
    `--numpressPic` excludes `--numpressSlof`;
  - a role encoded with numpress is fixed at 64-bit precision, since numpress
    decodes to 64-bit values;
  - `--numpressLinearAbsTol` exists only with `--numpressLinear`;
- numbers are finite, ranges ordered and sets non-empty.

**The nine rows stay, as the verified subset.** `ADMITTED` remains a table,
and "is this verified?" remains one lookup in it: the intent equals a row, the
installed build can express it, the executable is the verified build, and the
source is in the row's source domain. These are decision 1's four conditions.
Every other buildable intent is advanced. Steps are lowered in chain order.

The existing capability probe reads which formats, switches and filters a build
accepts, from that build's own help. This is evidence of spelling only, as
M6.2's rule says. An option the build does not list is unavailable, and says so.

### 5. Output checks for mzML

**mzML outputs** keep the five judgements and the existing integrity contract,
with three extensions:

1. **Changes the chain or a switch was asked to make are reported unverified
   for that item.** The switches are `--simAsSpectra` and `--srmAsSpectra`
   (spectrum and chromatogram counts), `--ddaProcessing`,
   `--combineIonMobilitySpectra`, `--acceptZeroLengthSpectra` and
   `--ignoreMissingZeroSamples`. This covers:
   - spectrum and chromatogram counts under subsetting or those switches;
   - array lengths under centroiding, thresholds or zero-sample handling;
   - values under truncation, numpress or `mzShift`.

   These are never reported verified, and never failed for the requested
   change. **An output with no records still fails** (`OutputContainsNoRecords`),
   whatever was requested. For a SCIEX output set it fails the whole set, as
   it is one link of ADR 0024's completeness proof.
2. **Each encoding option has one expected term per array.** The table names
   the term each array of the affected role must carry; the other role's arrays
   carry their own role's term. The terms are those of the PSI-MS controlled
   vocabulary (data-version 4.2.12). They were not measured on this build. An
   array with any other term, or with two, fails as `CompressionPolicyMismatch`,
   which is the existing closed rule.

   | Requested, per array role | Expected term | Verdict |
   | --- | --- | --- |
   | zlib, nothing else | `MS:1000574` zlib compression | checked, as today |
   | No compression, nothing else | `MS:1000576` no compression | checked, as today |
   | `--numpressLinear` (m/z and retention time) | `MS:1002312`; with zlib, `MS:1002746` | encoding checked; values unverified |
   | `--numpressPic` (intensity) | `MS:1002313`; with zlib, `MS:1002747` | encoding checked; values unverified |
   | `--numpressSlof` (intensity) | `MS:1002314`; with zlib, `MS:1002748` | encoding checked; values unverified |
   | Truncation, no prediction | `MS:1003088` truncation and zlib compression | encoding checked; values unverified |
   | Delta prediction, with or without truncation | `MS:1003089` truncation, delta prediction and zlib compression | encoding checked; values unverified |
   | Linear prediction, with or without truncation | `MS:1003090` truncation, linear prediction and zlib compression | encoding checked; values unverified |

   The precision check reads each array's precision term as today. A numpress
   role expects the 64-bit term, as decision 4 fixes it.
3. **Under `--noindex`** the index property is reported as not applicable,
   never as passed.

The requested-algorithm check stays for every picker step: an output recording
a different algorithm fails. `-g` waits for a dependency decision, because the
checks would have to read through gzip and the conversion crate has no gzip
reader.

### 6. Every other format is written from a private mzML intermediate

**Every non-mzML output is written from a private mzML intermediate.** No
format needs the fallback of blocking picker steps and SCIEX sources for that
format. If implementation finds a format that cannot be written from an mzML
intermediate, that format blocks both until it can.

1. **Run 1: source to mzML.** The source is converted to mzML in its own
   private staging directory, at 64/64 with zlib and an index, which is
   lossless. Run 1 carries:
   - both chains; a vendor picker reaches the vendor reader here, first in its
     chain;
   - the reader switches.

   The intermediate gets every check of decision 5: the integrity contract, the
   requested-algorithm check, SCIEX completeness and `OutputContainsNoRecords`.
   Its precision, compression and index are judged against its own fixed
   encoding, 64/64 with zlib and an index; the requested encoding is lowered
   only in run 2. A failure here fails the item before run 2.
2. **Run 2: mzML to the requested format.** Each intermediate is converted into
   a second private staging directory. Run 2 carries:
   - the format flag;
   - the encoding options that format takes (decision 4), such as precision,
     `-z`, `--noindex` and the mzMLb options;
   - the writer switches: `--stripLocationFromSourceFiles`,
     `--stripVersionFromSoftware` and `--contactInfo`.

   **Run 2 carries no filter**, so nothing acts on the data after run 1's
   checks.
3. **The final file gets the minimal checks.** These need no new dependency:
   - exit 0;
   - exactly the expected file in run 2's staging directory;
   - non-zero length;
   - the format's fixed leading signature, where it has one: the XML root
     element for mzXML, the HDF5 signature for mz5 and mzMLb.

   A deeper check of mz5 or mzMLb would need an HDF5 reader, which is a
   dependency decision this ADR does not take. Except for mzXML, run 2's output
   is not compared with the intermediate, and what it holds beyond run 1's
   checks is unverified.
4. **The intermediates are discarded** with the staging area and never
   finalized.

**What it costs:** for a single-output source, two provider runs. For a SCIEX
output set of N samples, 1 + N: run 1 writes N intermediates, which run 1's
checks judge as a set, and run 2 runs once per intermediate. If any run 2
fails, the set fails whole. Progress shows two phases.

Non-mzML outputs are finalized as files. They are **not adoptable and not
previewable**, because the viewer reads mzML only, and the queue item says so.

#### mzXML

mzXML adds two checks to this route.

1. **The X2 precondition.** If any spectrum of the intermediate names a source
   file other than the run's default, the item is refused before run 2. This is
   X2's measured loss, now checked on the document rather than assumed of the
   source.
2. **The output is compared with the intermediate.** It is read with the XML
   reader the conversion crate already depends on, and all of these must hold:
   - the `<scan>` elements, nested ones included, must match the
     intermediate's spectra by count, and by scan number where the
     intermediate's native IDs carry one;
   - `msRun/@scanCount` must equal the count written;
   - every `<peaks>` element must state the requested precision, and the
     requested `compressionType`.

   Any shortfall fails the item.

**What this checks:** because the comparison is against the intermediate and
not against the declared count, it catches any dropped spectrum, whatever the
cause. That includes M6.10 S2's Thermo multi-controller condition if it
occurs. S2 is still unmeasured, and this ADR does not claim otherwise.

**What it does not check:**

- array values (no mzXML array decoding);
- chromatograms (the format has none; the format choice is labelled
  "legacy, no chromatograms").

mzXML is advanced, never a verified default. CNV-002's source/output array
comparison is still not met.

### 7. What stays blocked

The [inventory's section 6](../../spikes/MSCONVERT_OPTION_INVENTORY.md#6-blocked-in-one-place)
is the list. In short:

- **mzXML where any spectrum of the intermediate names a source file other
  than the run's default, and mzXML with `--merge`.** X2.
- **`peakPicking cwt`.** M6.2.
- **`peakPicking vendor` on an mzML source.** It was measured running the
  local-maximum picker instead.
- **`peakPicking vendor` anywhere but first.** The help requires first.
- **Bare `peakPicking` on Thermo RAW.** The vendor picker runs, and the check
  refuses it (M6.10 S1).
- **Picker parameters a picker ignores.**
- **`--continueOnError`.** It skips data at exit 0, against fail-closed.
- **`-c/--config`.** An untyped argument channel.
- **The envelope switches.**

Still refused, as before:

- overwrite and automatic rename;
- a free-text argument box;
- any default or preset that inserts a picker. The "no additional
  centroiding" lock of CNV-D2 is unchanged.

### 8. What runs, and how an option becomes verified

**This ADR runs nothing.** Implementation is tested against the fake provider
and the captured help. Running the real build to qualify an advanced option,
including native QA, needs a bounded release of the ProteoWizard hold.

**Promoting an option from advanced to verified** follows M6.2's route
unchanged:

- a measurement on the verified build, under such a release;
- a case in the evidence record;
- a new row in the verified table.

### 9. Delivery order

1. **The typed chain and the verified subset.** No visible change: the nine
   rows become the subset, the capability probe reads filter names, and the
   ADR 0044 wire carries the structured intent.
2. **The advanced set for mzML output.** The chain editor, encoding,
   switches, the label and the check extensions of decision 5.
3. **Non-mzML formats.** The two-run route of decision 6, the minimal checks,
   and mzXML's comparison.
4. **File-valued parameters** through a Rust-owned picker and staged copies.

Each later in its own slice:

- `--merge`, as a queue item with several sources and one output;
- `--runIndexSet`, with SCIEX completeness checking the requested runs;
- `-g`, after a dependency decision.

## Alternatives rejected

- **A free-text argument box or raw passthrough.** The owner ruled it out. It
  would also let a user type past the envelope: `--outdir`, `-` for stdout,
  `--continueOnError`.
- **Measure every option first.** That means dozens of hold releases, and
  fixtures that do not exist for most of the options. The owner chose
  labelling over waiting.
- **Keep mzXML refused.** The intermediate gives the enforceable precondition
  and the spectrum comparison M6.10 found missing.
- **mzXML with only a `scanCount` self-check.** It catches X2's shape only
  where the header is written from the list size. It is not a comparison, and
  S2's form is unknown.
- **Finalize advanced outputs on exit 0 alone.** That contradicts the five
  judgements, and X2 exited 0.
- **Write non-mzML formats directly from the source.** Only mzML can be checked
  for the algorithm that ran and for records, so a picker substitution or an
  empty SCIEX member would pass as a non-empty file.
- **Block every lossy filter.** Requested loss is not silent loss. Blocking it
  would leave parity empty.

## Consequences

**What option C delivers:**

- Every option of the verified build's help is either offered or blocked with
  a written reason.
- "Verified" keeps its meaning. It is narrower than what is offered, and it is
  still one table lookup.

**What it costs:**

- the chain type and its lowering;
- the structured intent on the ADR 0044 wire;
- the probe's filter list;
- the advanced disclosure and chain editor, with rendered and keyboard QA;
- the label in `en` and `zh-CN`;
- the integrity extensions and the encoding-term table;
- the two-run route for non-mzML formats, and mzXML's comparison;
- a Rust-owned picker and staged copies for file parameters;
- a test matrix over chain constraints and blocked rows.

**Risks:**

- **"Converted" read as "correct".** The label stays on the item outcome and
  in diagnostics. Whether an adopted mzML layer keeps the label after adoption
  is decided in slice 2.
- **A larger settings surface.** It cuts against the owner's direction to
  remove secondary explanations. It is collapsed by default, with one label
  and no prose.
- **Unmeasured encoding terms.** If this build writes a term other than
  decision 5's table, every item with that option fails closed until a
  measurement corrects the table.

**No dependency is added by this ADR.** `-g` and any HDF5 check wait for their
own decisions.

## Open questions for the owner

**May a build without an `EVIDENCED_PROVIDER_BUILDS` row convert vendor
families, labelled instead of refused?** This ADR does not decide it. Option C
is about options, not builds, and the owner accepted beta 1 with vendor
conversion bound to ProteoWizard 3.0.26013 (ADR 0047). So the build gate stays
as it is: a vendor family converts only on a build its row names, and a build
that cannot report its release matches no row.

If the owner wants otherwise, that is its own decision, and it must at least:

- **keep `SciexWiffBundle` refused on a build without a measured row.** Its
  completeness proof reads a per-sample failure marker that is a string
  literal of the evidenced build (`sciex_completeness.rs`, ADR 0024 "Bound to
  one executable"). On a build that words it differently the audit sees no
  marker and judges the set complete. ADR 0024 measured that loss: exit 0,
  nine of ten samples declared and written, the tenth lost in silence;
- say what a build that cannot report its release gets;
- amend:
  - [ADR 0010](0010-first-vendor-raw-source-admission.md), "Support is bound to
    the provider build" ("Widening support is adding a measured row, not
    relaxing a check");
  - [ADR 0018](0018-shimadzu-labsolutions-lcd-source-admission.md) and
    [ADR 0022](0022-sciex-wiff-source-admission.md), each family's build-gate
    row;
  - [ADR 0024](0024-sciex-sample-completeness.md), "Bound to one executable";
  - ADR 0043, contract 3 (`EVIDENCED_PROVIDER_BUILDS`);
  - [ADR 0047](0047-first-windows-beta-scope-and-implementation-route.md#owner-decisions-at-publication-2026-10-28),
    which records vendor conversion bound to 3.0.26013 as accepted.

## What this amends, on acceptance

- **[ADR 0043](0043-conversion-completion-route.md), its boundary "Every
  admitted setting is evidence-bound" and contract 3** ("a visible setting must
  not exist merely because a CLI flag exists"): these hold for the verified
  tier only. The advanced tier exists because the owner chose parity, and it is
  labelled, not admitted. Contract 3's build binding is unchanged.
- **ADR 0043, CNV-D1.** mzXML stays `MZXML_REFUSED` as a verified format, and
  returns as advanced through decision 6. The one-format-flag rule is kept.
- **ADR 0043, CNV-D2.** Structural obligations 1–3 now govern the general
  chain, and obligation 3 is met for every format through the intermediate.
  The "no additional centroiding" lock is unchanged.
- **[ADR 0044](0044-conversion-configuration-authority.md).** Its authority
  carries a structured intent, not only a row id:
  - React sends the typed intent (format, encoding, both chains, switches) as a
    structured value. Rust builds the `ConversionIntent`, validates it against
    decision 4 and refuses what it cannot build.
  - `ConversionIntent::from_stable_id` remains, and resolves the nine verified
    rows only.
  - The catalog is the verified rows plus what the build's help lists.
    Availability is answered per format, step and switch from the probe, where
    0044 answered it per admitted row; "verified" stays a property of a row.
  - Plan identity carries the canonical intent, chains included, where it
    carried the intent id. The receipt binds it, and a plan whose intent
    differs from Rust's own answer is not current.
  - A selection preserved across an installation change (0044 decision 8) is
    the whole intent. It stays selected, and the steps or switches the new
    build cannot express are named.
- **[ADR 0045](0045-conversion-completion-closure-and-handoff.md), the
  terminal ledger.** CNV-002's `REFUSED_WITH_EVIDENCE` stays the disposition
  of mzXML as a verified format. mzXML is offered as advanced through decision
  6.
- **[ADR 0047](0047-first-windows-beta-scope-and-implementation-route.md), the
  scope table.** "Additional centroiding admission" and "mzXML" leave "Later or
  excluded" for the advanced tier, labelled. Overwrite and ETA stay excluded.
- **[The feature catalog](../../product/FEATURE_CATALOG.md):**
  - CNV-002: "Disabled until … counts pass", "unplannable by type" and the
    terminal `MZXML_REFUSED` describe the verified tier. mzXML is plannable as
    advanced, labelled legacy with no chromatograms, and its acceptance remains
    what promotion to verified would need;
  - CNV-005: the unconstructible scoped presets and the vendor-family
    restriction hold for the verified tier. The advanced set offers picker
    steps, scoped ones included, labelled and lossy by request.
- **[The after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), section
  7.6.** "mzXML output" and "settings outside the admitted catalog" leave
  "Stays refused". The refusals that remain are decision 7's.
- **The status lines that say mzXML is refused pending this ADR:** the README's
  "What works today", the project proposal's section 7.7 and the roadmap's M3.
- **Unchanged:** M6.2's rule that help text is not evidence of an operation.
  The advanced set rests on help text precisely because it is labelled
  unverified.
