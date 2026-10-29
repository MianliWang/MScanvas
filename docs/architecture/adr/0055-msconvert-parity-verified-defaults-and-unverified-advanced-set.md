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
how.

**The distance to parity** is the
[option inventory](../../spikes/MSCONVERT_OPTION_INVENTORY.md). The help lists:

- 59 switches and positional filemasks;
- 10 output formats;
- 39 spectrum filters and 2 chromatogram filters.

MSCanvas offers one format, two filters (`msLevel` and the gated default
picker) and no switch.

## Decisions

### 1. Three tiers, and what "known to lose data" means

Every option of the verified build's help is in exactly one tier. The
inventory assigns all 103 rows.

- **Verified default.** All of ADR 0043's three admission questions hold:
  the combination is one of the measured rows; the build is the verified
  build; and the measurement was taken on this kind of source. No label is
  shown.
- **Advanced.** The build's own help lists the option, and it is not blocked.
  It is offered labelled "not verified by MSCanvas" (decision 3), inside the
  envelope of decision 2.
- **Blocked.** Not offered. Each blocked row names its reason.

**Known to lose data** means all three of these:

- an outcome the user did not ask for;
- data present in the source missing or altered in the output, while the run
  reports success;
- either measured on the verified build, or stated by the help itself.

Loss the user asks for is different. A threshold, an m/z window, truncation,
numpress tolerance or a denoising step is **lossy by request**. It stays in
the advanced set, and the plan summary names the loss. Without this
distinction every subsetting filter would look blockable, and parity would mean
nothing.

### 2. The envelope, the same for both tiers

- **Typed arguments only.** React sends typed values through the
  configuration authority of [ADR 0044](0044-conversion-configuration-authority.md),
  and Rust owns everything after that:
  - Rust validates every value and lowers it to argv, deterministically.
  - The receipt binds the whole configuration.
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
- **Private staging and no overwrite.** msconvert always writes into the
  private staging directory. MSCanvas finalizes the output under the name its
  plan derives (for a SCIEX output set, the backend's names, as today); Fail
  and Skip remain the only conflict policies. `-o`, `--outfile`, `-e`,
  filemasks and `-f` stay MSCanvas's own (the inventory's "envelope" rows).
- **Exactly one format flag**, from one typed enum (CNV-D1).
- **The five judgements and the output checks** of decision 6 run for every
  item, advanced or not.
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
- format-bound options exist only with their format (the mzMLb chunk and
  level; `--numpressLinearAbsTol` with `--numpressLinear`);
- numbers are finite, ranges ordered and sets non-empty.

**The nine rows stay, as the verified subset.** `ADMITTED` remains a table,
and "is this verified?" remains one lookup in it: equal to a row, on the
verified build, in the row's source domain. Every other buildable intent is
advanced. Steps are lowered in chain order.

The existing capability probe reads which formats, switches and filters a build
accepts, from that build's own help. This is evidence of spelling only, as
M6.2's rule says. An option the build does not list is unavailable, and says so.

### 5. The build pin becomes a label, not a refusal

**What changes:**

- Only the verified build has verified defaults. That build is
  `msconvert.exe` SHA-256
  `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD`.
- Any other build may convert every admitted source family.
- On another build, every setting carries the label, the defaults included,
  and the build's release is shown.
- `EVIDENCED_PROVIDER_BUILDS` stays. A missing row now decides the label
  instead of refusing the run.

**What does not change:** no source family is added. Agilent, Bruker and
Waters directories and `.wiff2` stay unadmitted.

### 6. Output checks

**mzML outputs** keep the five judgements and the existing integrity contract,
with three extensions:

1. **Changes the chain was asked to make are reported unverified for that
   item.** This covers spectrum count under subsetting, array lengths under
   centroiding or thresholds, and values under truncation, numpress or
   `mzShift`. They are never reported verified, and never failed for the
   requested change.
2. **Numpress arrays** are recognized by accession and checked against the
   requested compression. Their values are reported unverified, since they are
   not decoded.
3. **Under `--noindex`** the index property is reported as not applicable.

The requested-algorithm check stays for every picker step: an output recording
a different algorithm fails. `-g` waits for a dependency decision, because the
checks would have to read through gzip and the conversion crate has no gzip
reader.

**Other formats get minimal checks that need no new dependency:**

- exit 0;
- exactly the expected file or files in staging;
- non-zero length;
- the format's fixed leading signature, where it has one: the XML root element
  for mzXML, the HDF5 signature for mz5 and mzMLb.

A deeper check of mz5 or mzMLb would need an HDF5 reader, which is a
dependency decision this ADR does not take.

Non-mzML outputs are finalized as files. They are **not adoptable and not
previewable**, because the viewer reads mzML only, and the queue item says so.

### 7. mzXML returns through a private mzML intermediate

1. **Source to mzML.** The source is converted to mzML in staging, with the
   spectrum chain, at 64/64, under the existing mzML checks. A vendor picker
   reaches the vendor reader here, first in its chain.
2. **The X2 precondition.** If any spectrum of the intermediate names a source
   file other than the run's default, the item is refused before the second
   run. This is X2's measured loss, now checked on the document rather than
   assumed of the source.
3. **mzML to mzXML.** The intermediate is converted to mzXML at the requested
   precision. The output is read with the XML reader the conversion crate
   already depends on, and two things must hold:
   - the `<scan>` elements, nested ones included, must match the
     intermediate's spectra by count, and by scan number where the
     intermediate's native IDs carry one;
   - `msRun/@scanCount` must equal the count written.

   Any shortfall fails the item.
4. **The intermediate is discarded** with the staging area and never finalized.

**What this checks:** because the comparison is against the intermediate and
not against the declared count, it catches any dropped spectrum, whatever the
cause. That includes M6.10 S2's Thermo multi-controller condition if it
occurs. S2 is still unmeasured, and this ADR does not claim otherwise.

**What it does not check:**

- array values (no mzXML array decoding);
- chromatograms (the format has none; the format choice is labelled
  "legacy, no chromatograms").

**What it costs:** two provider runs per item. Progress shows two phases.

mzXML is advanced, never a verified default. CNV-002's source/output array
comparison is still not met.

### 8. What stays blocked

The [inventory's section 6](../../spikes/MSCONVERT_OPTION_INVENTORY.md#6-blocked-in-one-place)
is the list. In short:

- **mzXML on a multi-source document, and with `--merge`.** X2.
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

### 9. What runs, and how an option becomes verified

**This ADR runs nothing.** Implementation is tested against the fake provider
and the captured help. Running the real build to qualify an advanced option,
including native QA, needs a bounded release of the ProteoWizard hold.

**Promoting an option from advanced to verified** follows M6.2's route
unchanged:

- a measurement on the verified build, under such a release;
- a case in the evidence record;
- a new row in the verified table.

### 10. Delivery order

1. **The typed chain and the verified subset.** No visible change: the nine
   rows become the subset, and the capability probe reads filter names.
2. **The advanced set for mzML output.** The chain editor, encoding,
   switches, the label and the check extensions of decision 6.
3. **Non-mzML formats.** The finalize-only path, the minimal checks, and
   mzXML through the intermediate.
4. **File-valued parameters** through a Rust-owned picker.
5. **The build pin** becomes a label.

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
- the probe's filter list;
- the advanced disclosure and chain editor, with rendered and keyboard QA;
- the label in `en` and `zh-CN`;
- the integrity extensions;
- a finalize-only path for non-mzML files;
- the intermediate path for mzXML;
- a Rust-owned picker for file parameters;
- a test matrix over chain constraints and blocked rows.

**Risks:**

- **"Converted" read as "correct".** The label stays on the item outcome and
  in diagnostics. Whether an adopted mzML layer keeps the label after adoption
  is decided in slice 2.
- **A larger settings surface.** It cuts against the owner's direction to
  remove secondary explanations. It is collapsed by default, with one label
  and no prose.

**No dependency is added by this ADR.** `-g` and any HDF5 check wait for their
own decisions.

## What this amends, on acceptance

- **[ADR 0043](0043-conversion-completion-route.md), its boundary "Every
  admitted setting is evidence-bound" and contract 3** ("a visible setting must
  not exist merely because a CLI flag exists"): these hold for the verified
  tier only. The advanced tier exists because the owner chose parity, and it is
  labelled, not admitted.
- **ADR 0043, CNV-D1.** mzXML stays `MZXML_REFUSED` as a verified format, and
  returns as advanced through decision 7. The one-format-flag rule is kept.
- **ADR 0043, CNV-D2.** Structural obligations 1–3 now govern the general
  chain. The "no additional centroiding" lock is unchanged.
- **ADR 0043, contract 3 (`EVIDENCED_PROVIDER_BUILDS`).** A missing row labels
  instead of refusing (decision 5).
- **[The after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), section
  7.6.** "mzXML output" and "settings outside the admitted catalog" leave
  "Stays refused". The refusals that remain are decision 8's.
- **Unchanged:**
  - [ADR 0044](0044-conversion-configuration-authority.md): the chain is
    configuration under its authority and receipt;
  - M6.2's rule that help text is not evidence of an operation: the advanced
    set rests on help text precisely because it is labelled unverified.
