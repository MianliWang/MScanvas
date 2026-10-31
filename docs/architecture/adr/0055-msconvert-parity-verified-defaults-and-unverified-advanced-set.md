# ADR 0055 — msconvert parity: verified defaults and an unverified advanced set

Status: **Accepted** by the owner on 2026-10-29, together with the build-gate
decision recorded under [Owner decision on the build gate](#owner-decision-on-the-build-gate-2026-10-29).
Proposed 2026-10-28.
Related: [0002](0002-external-proteowizard.md),
[0024](0024-sciex-sample-completeness.md),
[0043](0043-conversion-completion-route.md),
[0044](0044-conversion-configuration-authority.md),
[0045](0045-conversion-completion-closure-and-handoff.md),
[0047](0047-first-windows-beta-scope-and-implementation-route.md#owner-decisions-at-publication-2026-10-28).
Evidence: [msconvert 3.0.26013 help capture](../../spikes/MSCONVERT_HELP_CAPTURE.md),
[option inventory](../../spikes/MSCONVERT_OPTION_INVENTORY.md),
[M6.2](../../spikes/M6_MSCONVERT_CAPABILITY_EVIDENCE.md),
[M6.10](../../spikes/M6_10_EVIDENCE_GATED_SIDE_ROUTES.md),
and the [ProteoWizard source](https://github.com/ProteoWizard/pwiz/tree/47b13cf)
at the evidenced build's revision, `47b13cf`
([bootstrap status](../../../BOOTSTRAP_STATUS.md) records 3.0.26013 as that
revision). The source was read, not run. Citations of the form
`IO.cpp:1926` are to that revision, under `pwiz/data/msdata/`, except
`msconvert.cpp`, which is under `pwiz_tools/commandline/`.

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
  vendor acquisition exists for it. *2026-10-30: superseded for Thermo RAW.
  Two public profile acquisitions were measured
  ([evidence](../../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md)).
  `peakPicking vendor msLevel=1-` is now a verified row, and other vendor
  scopes on Thermo RAW are advanced and labelled, with output checks
  ([ADR 0059](0059-vendor-format-strategy-official-readers-thermo-first.md#2-thermo-first)).
  On other vendor families it stays unchecked and refused. Later the same day
  a third acquisition measured Orbitrap profile MS2, and
  `peakPicking vendor msLevel=2-` became a verified row too; every other
  vendor scope stays advanced.*
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
Numeric precision is the one exception, and only where a check reads it: on
mzML arrays not encoded with numpress, and on mzXML's `<peaks>` (decisions 5
and 6). There every row states it, and the check verifies it. On mz5 and mzMLb
the final file is not read, so precision below 64 bits is lossy by request
there.

A format that keeps only part of a document, or fixes how precisely it writes
values, says so in the format choice. This is what the build's writers do:

- mzXML keeps no chromatograms;
- mgf keeps no chromatograms, and only spectra above MS1 that name a selected
  precursor ion (`Serializer_MGF.cpp:101-103`);
- ms1 and cms1 keep MS1 spectra only;
- ms2 and cms2 keep only MS2 spectra that name a selected precursor ion, so
  MS3 and above are dropped (`Serializer_MSn.cpp:480-482`);
- mgf, text, ms1 and ms2 write values as decimal text, with m/z at 10, 12, 7
  and 7 significant digits, and cms1 and cms2 store intensities at 32 bits
  (decision 4's table).

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

> **Rendered 2026-10-30 on `be/integrate` (PR #161).** "Not verified by
> MSCanvas" (`未经 MSCanvas 验证`), followed by "ProteoWizard *release*" when the
> build is why. It is on every plan row and counted in the plan summary before
> Run; on each queue row while it waits, runs and after it settles, from the
> label `BEGIN` binds to the item; beside Add, which it describes, with how
> many of the outputs carry it (decision 2); on the roster row an adopted
> output becomes; and on the project reference. No surface sends an advanced
> intent yet, so the Advanced disclosure and its steps carry no label.

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
- an encoding option exists only with a format whose writer reads it, as the
  table below states;
- on one array role, numpress excludes truncation and prediction, which the
  mzMLb writer ignores on an array it numpresses (`IO.cpp:1639-1647`), and
  `--numpressPic` excludes `--numpressSlof`;
- a role encoded with numpress is fixed at 64-bit precision. The writer stores
  an array without numpress when numpress would exceed its tolerance, and then
  at the role's precision (decision 5), so the fallback keeps every bit
  instead of losing more than the tolerance the user set;
- with `--numpressLinear`, which also encodes retention time, the lowering
  never emits `--32` and spells precision with the per-array switches only.
  msconvert sets per-array precision for m/z and intensity alone, so the time
  array takes the global precision, which then stays at its 64-bit default
  (`msconvert.cpp:689-724`);
- linear numpress carries exactly one tolerance, relative or absolute
  (`--numpressLinearAbsTol`). The build sets the relative tolerance to 0 when
  an absolute one is given (`msconvert.cpp:775`; help lines 65–66), so the
  two never coexist;
- every numpress tolerance is above 0. A negative one turns numpress off
  (`msconvert.cpp:758`, `:763`, `:769`), and 0 turns its accuracy check off
  (help lines 59 and 74; for the absolute tolerance,
  `BinaryDataEncoder.cpp:164`);
- with mzMLb, compression level 0 exists only with zlib off: with zlib on, the
  build raises level 0 to 4 (`MSDataFile.cpp:249-250`);
- numbers are finite, ranges ordered and sets non-empty.

**Which encoding options each format takes** is what its writer reads. msconvert
accepts every encoding option with every format and reports nothing
(`msconvert.cpp:672-775`), so an option outside its format's row would be a
control that cannot affect the result, which CNV-D2's obligation 2 makes
unrepresentable.

| Format | Encoding options offered | What the writer does |
| --- | --- | --- |
| mzML | per-array precision, zlib, numpress, `--noindex` | Reads all four; decision 5 checks them. Applies no truncation and no prediction: prediction is read only for mzMLb (`IO.cpp:1871-1876`), both are applied only on the mzMLb path (`:1628-1818`), and the encoder reads neither |
| mzXML | one global precision (`--32` or `--64`), zlib, `--noindex` | `<peaks>` holds m/z-intensity pairs at the global precision, and `compressionType` declares none or zlib; per-array precision is never read, nor the per-array numpress overrides, the only numpress msconvert sets (`Serializer_mzXML.cpp:552-584`) |
| mzMLb | per-array precision, zlib, numpress, truncation, prediction, chunk size, compression level | The only writer that applies truncation and prediction (`IO.cpp:1628-1818`). It writes its index datasets whatever `--noindex` says (`Serializer_mzML.cpp:199-242`), so `--noindex` is not offered |
| mz5 | per-array precision, zlib | Reads precision per array and zlib, and no other encoding option (`mz5/Configuration_mz5.cpp:173-251`, `:297-322`) |
| mgf, text, ms1, ms2, cms1, cms2 | none | Read no encoding option. mgf, text, ms1 and ms2 write decimal text, m/z at 10, 12, 7 and 7 significant digits (`Serializer_MGF.cpp:77`, `TextWriter.hpp:426`, `Serializer_MSn.cpp:167`); cms1 and cms2 store m/z at 64 bits and intensity at 32, always compressed (`Serializer_MSn.cpp:255-307`, `:490`, `:499`) |

The table was read from the source, not measured.

**The nine rows stay, as the verified subset.** `ADMITTED` remains a table,
and "is this verified?" remains one lookup in it: the intent equals a row, the
installed build can express it, the executable is the verified build, and the
source is in the row's source domain. These are decision 1's four conditions.
Every other buildable intent is advanced. Steps are lowered in chain order.
*2026-10-30: ten rows. The tenth is Thermo vendor centroiding of every MS
level, `peakPicking vendor msLevel=1-`. It is mzML at m/z 64-bit and intensity
32-bit with zlib, cases `TV1` and `TE1`, and its source domain is Thermo RAW
([ADR 0059](0059-vendor-format-strategy-official-readers-thermo-first.md#2-thermo-first)).
Later on 2026-10-30: eleven rows. The tenth also cites `TQ1`, and the eleventh
is Thermo vendor centroiding of MS2 and above, `peakPicking vendor msLevel=2-`,
with the same encoding and source domain, cases `TV2`, `TE2` and `TQ2`.*

The existing capability probe reads which formats, switches and filters a build
accepts, from that build's own help. This is evidence of spelling only, as
M6.2's rule says. An option the build does not list is unavailable, and says so.

### 5. Output checks for mzML

**mzML outputs** keep the five judgements and the existing integrity contract,
with three extensions:

1. **Changes the chain or a switch was asked to make are reported unverified
   for that item.** The switches are `--simAsSpectra` and `--srmAsSpectra`
   (spectrum and chromatogram counts), `--ddaProcessing`,
   `--combineIonMobilitySpectra`, `--ignoreCalibrationScans`,
   `--acceptZeroLengthSpectra` and `--ignoreMissingZeroSamples`. This covers:
   - spectrum and chromatogram counts under subsetting or those switches;
   - array lengths under centroiding, thresholds or zero-sample handling;
   - values under numpress or `mzShift`.

   These are never reported verified, and never failed for the requested
   change. **An output with no records still fails** (`OutputContainsNoRecords`),
   whatever was requested; for a format that keeps part of a document, decision
   6 applies this to the part it keeps. For a SCIEX output set it fails the
   whole set, as it is one link of ADR 0024's completeness proof.
2. **Each array carries one precision term and one compression term, as the
   table says.** The terms are the ones the evidenced build's writer emits, read
   from its source (`IO.cpp:1926-1969`), not measured. The other role's arrays
   carry their own role's terms. An array with any other term, or with two
   precision or two compression terms, fails as `NumericPrecisionMismatch` or
   `CompressionPolicyMismatch`, the existing closed rules.

   | Requested, per array role | Expected terms | Verdict |
   | --- | --- | --- |
   | zlib, nothing else | the requested precision; `MS:1000574` zlib compression | checked, as today |
   | No compression, nothing else | the requested precision; `MS:1000576` no compression | checked, as today |
   | `--numpressLinear` (m/z and retention time) | `MS:1000521` 32-bit float; `MS:1002312`, or with zlib `MS:1002746` | encoding checked; precision not applicable; values unverified |
   | `--numpressPic` (intensity) | `MS:1000521` 32-bit float; `MS:1002313`, or with zlib `MS:1002747` | as above |
   | `--numpressSlof` (intensity) | `MS:1000521` 32-bit float; `MS:1002314`, or with zlib `MS:1002748` | as above |
   | Numpress requested, array stored without it | `MS:1000523` 64-bit float (decision 4); `MS:1000574` or `MS:1000576`, as requested | checked as the plain rows; reported |

   **On a numpress array the precision term is nominal.** The writer always
   writes the 32-bit float term there, because numpress fixes its own word size
   (`IO.cpp:1958-1969`), so its precision is reported as not applicable.

   **Under `--numpressLinear` the time array's precision is checked too.**
   Today the check reads no precision on a time array, because no intent states
   one. This one does: decision 4 fixes retention time at 64 bits, so a time
   array stored without numpress is judged by the last row, as m/z is.

   **A numpress array can come back without numpress.** The writer decodes what
   it encoded, and when the error exceeds the tolerance it stores that array
   without numpress (`BinaryDataEncoder.cpp:202-238`, `IO.cpp:1886`):
   - Pic always checks, but falls back only on a decoded value that is not
     finite or is 1.0 or more away, so in effect only on overflow
     (`BinaryDataEncoder.cpp:209`);
   - Linear with a relative tolerance, and Slof, check against that tolerance,
     which decision 4 keeps above 0;
   - Linear with an absolute tolerance checks nothing after encoding, since the
     relative tolerance is then 0, and falls back only when the encoder cannot
     reach that accuracy (`BinaryDataEncoder.cpp:164-170`).

   Which arrays fall back depends on the data, so a fallback is not a failure.
   The array is judged by the last row, and the item's outcome reports, per
   role, how many arrays were stored without numpress.
3. **Under `--noindex`** the index property is reported as not applicable,
   never as passed.

The requested-algorithm check stays for every picker step: an output recording
a different algorithm fails. `-g` waits for a dependency decision, because the
checks would have to read through gzip and the conversion crate has no gzip
reader.

> **Implemented 2026-10-30 on `be/integrate`.** No check runs, and nothing is
> finalized, while the run's owned process tree is not confirmed gone, even
> after exit 0: the attempt settles as `backend_not_terminated`, or
> `cancellation_failed` where a stop was requested, so the desktop's
> owned-process quarantine sees it. This holds for the single-output run and
> for a SCIEX output set, as decision 6's run 1 does on `be/two-step`.
>
> Two corrections from the PR #161 review, both of which had refused correct
> outputs:
>
> - **A step that changes point counts may empty a spectrum.** Examples are an
>   m/z window, a threshold and the other steps that set
>   `spectrum_array_lengths`. The source's payload presence is then not
>   compared. The output answers for itself instead: a declared point with no
>   payload still fails, and payload presence against the source is reported
>   unverified.
> - **Unpaired spectra inherit an unknown history, never an empty one.** When
>   a population step unpairs the spectra, a source picker the output copied
>   cannot be told from one this run added. The requested processing is then
>   unverified rather than refused as `processing_algorithm_mismatch`.

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

   **So does an intermediate with nothing the format keeps.** For a format
   that keeps part of a document (decision 1), the item fails before run 2 as
   `OutputContainsNoRecords` when the intermediate holds:
   - for mzXML, no spectrum;
   - for mgf, no spectrum above MS1 that names a selected precursor ion;
   - for ms1 and cms1, no MS1 spectrum;
   - for ms2 and cms2, no MS2 spectrum that names a selected precursor ion.

   Otherwise run 2 would write a file with no records, such as an ms2 file of
   headers only, and the minimal checks below would pass it. The text, mz5 and
   mzMLb formats keep chromatograms as well as spectra, so for them decision
   5's rule, which the intermediate has already passed, is the whole
   condition: an intermediate holding only chromatograms goes on to run 2.
2. **Run 2: mzML to the requested format.** Each intermediate is converted into
   a second private staging directory. Run 2 carries:
   - the format flag;
   - the encoding options decision 4's table lists for that format, and no
     other;
   - the writer switches: `--stripLocationFromSourceFiles`,
     `--stripVersionFromSoftware` and `--contactInfo`.

   **Run 2 carries no filter**, so no filter acts on the data after run 1's
   checks. The encoding run 2 applies is unverified, except what mzXML's
   comparison reads.
3. **The final file gets the minimal checks.** These need no new dependency:
   - exit 0;
   - exactly the expected file in run 2's staging directory;
   - non-zero length;
   - the format's fixed leading signature, where it has one: the XML root
     element for mzXML, the HDF5 signature for mz5 and mzMLb.

   A deeper check of mz5 or mzMLb would need an HDF5 reader, which is a
   dependency decision this ADR does not take. Except for mzXML, run 2's output
   is not compared with the intermediate, and what it holds beyond run 1's
   checks is unverified. That includes every mzMLb encoding option, truncation
   and prediction among them, and the terms the mzMLb writer leaves: with zlib,
   a predicted array carries both a prediction term and the zlib term
   (`IO.cpp:1939-1952`).
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
   file other than the run's default, or names one where the run declares no
   default, the item is refused before run 2. The writer skips exactly those
   spectra (`Serializer_mzXML.cpp:782-783`). This is X2's measured loss, now
   checked on the document rather than assumed of the source.
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
occurs. The build's source shows the mechanism: on a document whose native IDs
are in the Thermo format, the writer skips every spectrum whose ID does not
begin `controllerType=0 controllerNumber=1` (`Serializer_mzXML.cpp:774-777`),
and the comparison fails such an item. That was read, not run; S2 is still
unmeasured, and this ADR does not claim otherwise.

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
  than the run's default, or names one where the run declares no default, and
  mzXML with `--merge`.** X2.
- **`peakPicking cwt`.** M6.2.
- **`peakPicking vendor` on an mzML source.** It was measured running the
  local-maximum picker instead.
- **`peakPicking vendor` anywhere but first.** The help requires first.
- **Bare `peakPicking` on Thermo RAW.** The vendor picker runs, and the check
  refuses it (M6.10 S1). *2026-10-30: still blocked. The request names the
  default picker; the Thermo vendor picker is asked for as `peakPicking
  vendor` (ADR 0059).*
- **Picker parameters a picker ignores.**
- **Encoding options the chosen format's writer does not read** (decision 4's
  table), truncation and prediction outside mzMLb among them. They could not
  affect the result.
- **`--continueOnError`.** It skips data at exit 0, against fail-closed.
- **`-c/--config`.** An untyped argument channel.
- **The envelope switches.**

Still refused, as before:

- overwrite and automatic rename;
- a free-text argument box;
- a default or an MSCanvas-authored preset that inserts a picker. The "no
  additional centroiding" lock of CNV-D2 is unchanged.

  > **Amended 2026-10-29 by [ADR 0058](0058-user-saved-conversion-presets.md).**
  > This read "any default or preset that inserts a picker". It now reads: no
  > default or MSCanvas-authored preset inserts a picker. Presets are
  > user-saved only and MSCanvas ships none. A user-saved preset may hold a
  > picker step the user wrote, and applying it shows the step's lossy effect
  > in the plan summary.

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
- the integrity extensions, the per-format encoding table and the term table;
- the two-run route for non-mzML formats, and mzXML's comparison;
- a Rust-owned picker and staged copies for file parameters;
- a test matrix over chain constraints and blocked rows.

**Risks:**

- **"Converted" read as "correct".** The label stays on the item outcome and
  in diagnostics. Whether an adopted mzML layer keeps the label after adoption
  is decided in slice 2.

  > **Decided by the owner, 2026-10-29.** The "not verified by MSCanvas" flag
  > is carried into an adopted output's provenance, in the session and in the
  > project document, not only into the queue outcome and diagnostics. The
  > project document's schema bump this needs is accepted. Beta 1 writes
  > schema 4 (`project/record.rs`), which refuses every other version today, so
  > the slice that bumps it states what the new build does with a schema-4
  > document.

  > **What this build does with a schema-4 document, 2026-10-29. A release
  > decision for the owner before merge.** The M9 closure says beta 1's
  > publication began schema 4's compatibility promise
  > ([M9 closure §4](../../product/M9_CLOSURE.md#4-schema-4--the-canonical-disposition)),
  > so this build reads it. Beta 1's published
  > [`INSTALL_AND_SUPPORT.md`](../../release/beta-1/INSTALL_AND_SUPPORT.md#roll-back)
  > says instead that no compatibility between betas is promised; the owner
  > decides which one stands, and whether this disposition or the refusal it
  > replaced ships:
  >
  > - The version probe admits 4 and 5. A schema-4 document is read through
  >   its own exact types: unknown fields are refused, and a schema-5 field
  >   in it (`notVerifiedByMscanvas`, even `null`) is `malformed`. Every
  >   schema-4 rule still applies, with the answer schema 5 gives.
  > - It is held in memory as schema 5 with `notVerifiedByMscanvas: null` on
  >   every input: nothing is recorded, never verified; beta 1 ran only the
  >   measured build and recorded no label.
  > - Opening writes nothing and leaves the project with no unsaved changes.
  >   A Save with nothing unsaved writes nothing either and succeeds. The
  >   first Save after a change writes schema 5. Nothing is dropped; besides
  >   the version, each input gains its `null` label, and a digest is written
  >   in upper case, the one spelling this build writes (beta 1 wrote no
  >   other).
  > - Save As replaces a schema-4 document only where it is the one this
  >   session is bound to, chosen again in the dialog; that writes schema 5
  >   with or without a change. Any other copy, even of this project at this
  >   revision, is refused as `destinationNotAProject` and left as it is.
  > - The bound document found in another schema than it was bound in, at
  >   the same project and revision, was written by someone else: Save and
  >   Save As onto it are refused as `staleDocument`.
  > - Schemas 1–3 and 6 or later stay `unsupportedVersion`; a document with
  >   no version stays `malformed`.
  >
  > **The consequence: beta 1 cannot open a document this build has
  > written.** Beta 1 refuses schema 5 as `unsupportedVersion`, and
  > reinstalling beta 1 (its Roll back) does not undo that. A beta-1 project
  > that is only opened, saved with nothing unsaved, and closed stays
  > readable by beta 1. Nothing in the interface says so before the first
  > write yet: a prompt there is later work, and the next release notes'
  > known limitations and roll-back section must state the consequence.
  >
  > **Known limitation: a beta-1 document near the size bound.** Beta 1
  > published documents up to 4 MiB. The `null` label adds 37 bytes per
  > input when written, so a beta-1 document whose size plus 37 bytes per
  > input exceeds the bound opens but can never be saved by this build
  > (`a_schema_four_document_without_room_for_its_labels_opens_and_is_never_written`):
  > every Save after
  > a change and every Save As is refused as `oversized`, and the file is
  > left as beta 1 wrote it. Where the size is history that cannot be
  > removed, the project stays read-only here. No data is lost.

  > **Decided by the owner, 2026-10-30.** This read-and-upgrade disposition
  > ships, and the M9 closure's position stands: beta 1's publication began
  > schema 4's compatibility promise. Beta 1's `INSTALL_AND_SUPPORT.md` keeps
  > its words and gains a dated correction under Roll back. The next release
  > notes state the upgrade on the first Save after a change, the advice to
  > keep a copy of a project before saving it in the new version, and the
  > size limitation above (`CHANGELOG.md`, Unreleased). The prompt before the
  > first schema-5 write is still interface work.

  > **The prompt, 2026-10-30 (PR #161).** The project state says when the
  > bound document is schema 4 (`savingUpgradesSchema`). A Save that would
  > write it, from the head or from the unsaved-changes question, first asks
  > "Saving upgrades this beta 1 project, and beta 1 cannot open it
  > afterwards. Keep a copy first if you still need beta 1.", with the
  > keyboard on "Save and upgrade"; Cancel writes nothing. A Save with nothing
  > unsaved writes nothing and is not asked. Save As is asked whenever the
  > bound document is schema 4, with or without a change, because choosing
  > that file again in the dialog writes schema 5 over it.

  > **Implemented on `be/integrate` (draft PR #161), 2026-10-29.**
  >
  > - **Session.** An adoption ticket carries the item report's label
  >   (`unverifiedSettings`, `unverifiedBuildRelease`), and the adopted row
  >   keeps it as `notVerifiedByMscanvas` on the roster row. A row the user
  >   had added another way gains the label when the same object is adopted.
  >   Advanced outputs are offered for adoption again.
  > - **Project.** Schema 5 adds `notVerifiedByMscanvas` to an input. It is
  >   recorded at registration when the object whose bytes were hashed is a
  >   row this session adopted from a labelled conversion, whatever route
  >   registered it. `null` means nothing is recorded, never verified. The
  >   field is required on every input, and `unverifiedBuildRelease` is
  >   explicit `null` on a measured build, like every optional value in the
  >   document: an omitted one is `malformed`. A label with neither half set
  >   is refused as inconsistent.
  > - ~~**A schema-4 document is refused as `unsupportedVersion`**, like every
  >   other version, and nothing migrates. Beta 1's projects therefore do not
  >   open in this build.~~ Replaced the same day by the read-and-upgrade
  >   disposition in the note above. Either one is a release decision for the
  >   owner before merge. *The owner chose read and upgrade on 2026-10-30.*
- **A larger settings surface.** It cuts against the owner's direction to
  remove secondary explanations. It is collapsed by default, with one label
  and no prose.
- **Encoding behaviour read, not measured.** Decision 4's format table and
  decision 5's term table come from the evidenced build's source. If the
  binary does otherwise, every mzML item with that option fails closed
  (decision 5's closed rules) until a measurement corrects the table, and
  on other formats the option goes unchecked, as decision 6 says. Numpress
  fallback is not this risk: it depends on the data, and decision 5 accepts
  and reports it.

**No dependency is added by this ADR.** `-g` and any HDF5 check wait for their
own decisions.

> **Amended 2026-10-29 by the owner's approval.** `serde` becomes a direct
> dependency of `crates/proteowizard`. It is already a workspace dependency and
> in `Cargo.lock`, so no package is added. The ADR 0044 wire deserializes into
> the crate's unvalidated parts (format and encoding, both chains, switches),
> and the structured intent's validating constructor (`StructuredIntent::new`
> in draft PR #150) checks them, so a deserialized value is never an intent
> until that constructor accepts it.

## Owner decision on the build gate, 2026-10-29

**Question:** may a build without an `EVIDENCED_PROVIDER_BUILDS` row convert
vendor families, labelled instead of refused? Option C is about options, not
builds, and beta 1 shipped with vendor conversion bound to ProteoWizard
3.0.26013 (ADR 0047).

**Decision (owner, 2026-10-29): relax the gate.**

- Thermo RAW and Shimadzu LCD convert on any installed build that reports its
  release. On a build without a measured row every setting, the defaults
  included, carries the "not verified by MSCanvas" label, and the plan, the
  item results and diagnostics name the build's release.
- A build that cannot report its release still converts no vendor family:
  there is nothing to name in the label.
- `SciexWiffBundle` stays refused on any build without a measured row, for the
  reason below.
- The measured build keeps its verified defaults; nothing about the verified
  tier changes.

The records below are amended in the change that implements the relaxed gate,
not by this note. The decision honours these constraints, recorded before it
was taken:

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
  carries a structured intent, not only a row id. React sends the typed intent
  (format, encoding, both chains, switches) as a structured value; Rust builds
  the `ConversionIntent`, validates it against decision 4 and refuses what it
  cannot build. `ConversionIntent::from_stable_id` remains, and resolves the
  nine verified rows only. Amended, by name:
  - **Decision 6** (`catalog: admitted rows`): the catalog is the verified
    rows plus the formats, steps and switches the build's help lists.
  - **Decision 7** ("availability belongs to the row, never to the value") and
    the question table's granularity row: this holds for the verified tier.
    For the advanced tier availability is answered per format, step and switch
    from the probe. "Verified" stays a property of a row.
  - **Decision 8** ("stated once, at settings level, naming the combination"):
    kept for the verified tier. A preserved advanced intent is the whole
    intent; it stays selected, and its one settings-level statement names the
    steps or switches the new build's help does not list. That answers which
    spelling is missing, not which axis is to blame, and no control repeats it;
    the rejection of per-value messages stands.
  - **Decision 9** and the question table's plan row: plan identity carries the
    canonical intent, chains included, where it carried the intent id. The
    receipt binds it, and a plan whose intent differs from Rust's own answer is
    not current.
  - **Decision 13** and the question table's retention row: React retains the
    selected intent as its structured value, where it retained "the selected
    admitted intent id".
  - **The semantic finding ledger, row 1** (defect source "A frontend able to
    compose axis values", acceptance "39 combinations unreachable by any
    activation sequence"): this holds for the verified tier. In the advanced
    tier React composes a structured intent and those combinations are
    reachable; decision 4's rules, enforced in Rust, decide whether an advanced
    intent can be built, and the admitted table alone still decides whether it
    is verified.
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
- **The status lines that keep mzXML gated until representative multi-source
  integrity checks pass:** the README's "What works today" and "Product scope";
  the project proposal's sections 1, 6 (layer 2), 7.7, 18 (M3) and 21 (success
  criterion 5); and the roadmap's M3. They describe the verified tier. mzXML is
  offered as advanced through decision 6, and that gate, CNV-002's source/output
  comparison, remains what promotion to verified needs.
- **Unchanged:** M6.2's rule that help text is not evidence of an operation.
  The advanced set rests on help text precisely because it is labelled
  unverified.
