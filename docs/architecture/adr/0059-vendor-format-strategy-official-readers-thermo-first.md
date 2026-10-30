# ADR 0059 — Vendor format strategy: official readers, Thermo first, no decompilation

Status: **Accepted** by the owner on 2026-10-30.
Related: [0002](0002-external-proteowizard.md),
[0010](0010-first-vendor-raw-source-admission.md),
[0012](0012-first-visible-thermo-conversion.md),
[0018](0018-shimadzu-labsolutions-lcd-source-admission.md),
[0027](0027-first-visible-sciex-wiff-workflow.md),
[0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
[0056](0056-project-owned-mzml-reader-for-viewing.md);
ADR 0051 (proposed in PR #155).
Evidence: a research report of 2026-10-29 on vendor readers, their licences
and the law on reverse engineering (written for the owner, not committed;
summarized below with its public sources);
[M3 vendor RAW evidence](../../spikes/M3_VENDOR_RAW_EVIDENCE.md);
[M3 next-vendor evidence](../../spikes/M3_NEXT_VENDOR_EVIDENCE.md);
[Thermo vendor centroiding evidence](../../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md).

> **This is not legal advice.** The research summarizes public licence texts,
> statutes and case reports collected on 2026-10-29, read by non-lawyers. Before
> anyone ships code that decodes a vendor format directly, or distributes a
> vendor library, an intellectual-property lawyer should review it. Where the
> research was uncertain, this record says so.

## Context

AGENTS.md says "Reuse mature scientific backends; do not reimplement
proprietary RAW readers or mature algorithms without a written decision" and
"Never vendor proprietary SDKs, DLLs or restricted vendor readers."
[ADR 0002](0002-external-proteowizard.md) made a user-installed ProteoWizard
the first backend: MSCanvas "does not bundle or automatically download
proprietary readers", and another backend "requires a separate legal/technical
decision".

Three needs raised the question of going further: viewing a Thermo RAW without
a full conversion, msconvert parity (ADR 0055), and vendor formats msconvert
does not read at all (Shimadzu `.qgd`, Agilent ChemStation `.D`). The research
asked whether MSCanvas should reverse engineer vendor formats and write its own
decoders, and if not, which route each vendor needs.

Its answer is that the danger is mostly not copyright:

- **Copyright risk is low for clean-room study of data files.** Studying the
  user's own files, without touching vendor programs, is low-risk under
  Canadian, US and EU copyright law. Open independent readers have existed for
  10–15 years, and the research found no vendor lawsuit or takedown against
  one. It did not search legal databases or GitHub's DMCA records, so that is
  "not found", not "does not exist".
- **The practical risk is silent m/z error.** Calibration, lock-mass
  correction and ion-mobility conversion live in vendor code. Independent
  readers document m/z errors from a few ppm to thousands, and the error is
  silent. That conflicts with msconvert parity and with "no backend fallback".
- **The contract risk is personal.** Vendor licences forbid reverse
  engineering their software. ProteoWizard's download asks the user to accept
  the vendor licences, and Thermo's RawFileReader licence says "If you use this
  Software, you accept this License". So a maintainer who converts Thermo files
  with msconvert is probably already a RawFileReader licensee. *Uncertain:*
  there is no case law on acceptance through ProteoWizard. Using the vendor
  library as an oracle to infer field meanings could then count as reverse
  engineering "this Software". The licences choose their own law (California
  for Thermo, Massachusetts for SCIEX, Germany for Bruker, Japan for
  Shimadzu), and US courts have enforced bans on reverse engineering in such
  licences (*Bowers v. Baystate*, *Davidson v. Jung*).
- **Patent risk is unknown, not low.** No patent search was done.

The owner's decision, 2026-10-30: Thermo first, Bruker compatibility later when
there is capacity, no decompilation, and every other point as the research
recommends.

## Decisions

### 1. Vendor formats are read only by the vendors' own readers

- MSCanvas reads a vendor acquisition only through the vendor's own reader,
  inside the user's own ProteoWizard installation, run as `msconvert` with
  typed argv (ADR 0002). The licence relationship stays between the user,
  ProteoWizard and the vendor.
- MSCanvas does not:
  - decompile, disassemble or otherwise reverse engineer vendor software, or
    load it by reflection to study it;
  - use a vendor reader's output as an oracle to work out what a vendor file's
    fields mean;
  - write a decoder of its own for a proprietary vendor format;
  - bundle, mirror or download at run time any vendor library. ADR 0002
    already refuses bundling and automatic download; this also refuses a
    download after showing the vendor's licence, as the R package rawrr does;
  - circumvent encryption, SCIEX `.wiff2`'s in particular. This one is
    permanent.
- **This is the written decision AGENTS.md asks for, and it is a decision not
  to reimplement.** It also keeps "Never vendor proprietary SDKs" without
  exception.
- **Contributor isolation.** Anyone who has read decompiled vendor code, or has
  used a vendor library as an oracle for field meanings, does not write or
  review independent parsing code for that vendor's formats.
- An existing open reader with a permissive licence, written by others, is a
  different question (decision 3). Adopting one is a dependency decision, not
  reverse engineering by MSCanvas.

### 2. Thermo first

Thermo RAW is the vendor format worked on now, and it needs no reverse
engineering:

- Thermo's official RawFileReader is a free .NET library for Windows, Linux and
  macOS, published on Thermo's GitHub.
- The maintained open Thermo readers are built on it, apart from opentfraw,
  an independent decoder from 2026 that nobody has validated.
- The verified ProteoWizard 3.0.26013 installation carries
  `ThermoFisher.CommonCore.RawFileReader.dll`
  ([M3 evidence](../../spikes/M3_VENDOR_RAW_EVIDENCE.md)). Today's msconvert
  route is therefore already the RawFileReader route.

The Thermo work the owner selected on 2026-10-30
([plan, section 2](../../development/AFTER_BETA1_PLAN.md#2-owner-decisions-2026-10-28)):

- **Vendor centroiding.** `peakPicking vendor msLevel=1-` ("MS1 and up")
  becomes a verified row on the evidenced build.
  `peakPicking vendor msLevel=2-` ("MS2 and up") stays in the advanced tier,
  labelled not verified, until a public Orbitrap profile-MS2 file is measured
  (*one was, later on 2026-10-30: see the [note under Consequences](#consequences)*)
  ([evidence](../../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md)).

  > **Implemented 2026-10-30** (branch `be/thermo-ms1`, into `be/integrate`).
  >
  > - **MS1 and up is the tenth verified row**, `VendorCentroidingFromMs1`:
  >   mzML, every spectrum, m/z 64-bit and intensity 32-bit with no precision
  >   flag, zlib, cases `TV1` and `TE1`. It lowers to
  >   `--mzML --zlib --filter "peakPicking vendor msLevel=1-"`.
  >   - It is verified only on the evidenced executable. On another build that
  >     reports its release it converts Thermo RAW labelled "not verified", with
  >     that release, under ADR 0055's relaxed gate. A build that reports no
  >     release converts no Thermo RAW.
  >   - Its source domain is the Thermo RAW family, not the two measured
  >     instrument models. The owner chose this in decision 6 above, the
  >     evidence's second option, on CNV-D2's argument that one bundled reader
  >     picks for every Thermo instrument.
  >   - Its verified claim on profile MS2 rests on ion-trap data only (`3a`,
  >     14 spectra). "MS1 and up" also centroids MS2, and Orbitrap (FTMS)
  >     profile MS2, common on Q Exactive-class methods, was not measured. This
  >     is the gap that keeps "MS2 and up" advanced. Decision 6 verifies this
  >     row across the family with the gap open; the public Orbitrap
  >     profile-MS2 measurement that would lift "MS2 and up" would also close
  >     it.
  > - **MS2 and up, and every other vendor scope, is advanced on Thermo RAW,
  >   labelled not verified.** Before this change the code refused any vendor
  >   picker as not checkable. Its output check knew only the default picker's
  >   request, which refuses a vendor picker as unrequested and wants every
  >   spectrum centroid, so a correct `msLevel=2-` output would have failed.
  >   The check now judges a vendor picker on Thermo RAW at its requested scope:
  >   - the run adds exactly one method naming `Thermo/Xcalibur peak picking`,
  >     and no other picker. A second vendor method fails as a second,
  >     contradicting scope record; none leaves the processing unverified;
  >   - that method's `ms levels` record is what this build writes for the
  >     scope: none for `1-`, the interval otherwise. It is the only witness
  >     of a scope the build discarded;
  >   - every in-scope spectrum declares centroid. Out-of-scope spectra are not
  >     judged, and the filter string's `p`/`c` is never read.
  >   - Known limit: under `1-` a spectrum with no MS level is judged in
  >     scope, although msconvert's `msLevel=1-` probably leaves it unpicked
  >     (not checked). A file whose spectrum list carried such spectra (a UV
  >     or PDA controller, not measured) would fail closed as
  >     `CentroidRepresentationMissing`, never pass wrongly.
  > - **Unchanged:**
  >   - the vendor picker stays blocked on mzML sources and anywhere but first;
  >   - bare `peakPicking` on Thermo RAW stays blocked;
  >   - on Shimadzu LCD and SCIEX WIFF the vendor picker has no output check,
  >     because their readers' picker names were never measured, so it is
  >     refused as not checkable;
  >   - the shipped default stays "no additional centroiding".
  > - The capability probe now reads a spectrum-filter declaration that the
  >   help wraps over up to three lines. The 3.0.26013 help puts `peakPicking`'s
  >   `[msLevel=<ms_levels>]` on the second line.
- **One-click view RAW.** Selecting a Thermo RAW row to view converts it with
  the verified defaults into an MSCanvas-owned cache, never the user's
  destination and never overwriting, then opens the result. It is to be
  designed and implemented later.
- **Folder and drop** propose Thermo RAW (ADR 0051, PR #155).

**Later options, not decided here:**

- *A user-installed ThermoRawFileParser as a second external converter.* Its
  `query` and `xic` subcommands return spectra, chromatograms and metadata
  without a full conversion. It would need its own ADR and a user goal. It uses
  Thermo's picker by default, so peak picking would have to be passed
  explicitly. It would never be a fallback for msconvert, or msconvert for it.
  It reads through the same RawFileReader, so it is not an independent
  reference.
- *Bundling RawFileReader.* This is not planned. The licence would make the
  distributor:
  - indemnify Thermo without a cap (§3.1);
  - show a fixed copyright line in the About box (§3.2);
  - bind end users to a no-redistribution licence (§3.3);
  - obtain written consent for any commercial use (§4.2).

  It also forbids combining the library with GPL-like "Excluded License"
  software (§4.3). Thermo's 2019 slides promise developers a redistribution
  letter, and whether it is still issued is unknown.

### 3. Bruker later

- **Bruker compatibility waits until there is capacity.** Until then a Bruker
  `.d` stays unadmitted, as every directory acquisition is today
  ([ADR 0010](0010-first-vendor-raw-source-admission.md)).
- **A TDF/TSF preview through an existing open reader is a later, separate
  decision.** The candidate is timsrust, used directly or through mzdata's
  `bruker_tdf` feature. Bruker staff explained the binary layout to open-source
  authors, and MSCanvas would reverse engineer nothing. Adopting it would need:
  - its own ADR and dependency approval;
  - an answer on timsrust's licence: the crate metadata says Apache-2.0, while
    the repository's LICENSE file is MIT text. Either is compatible with this
    project;
  - a label stating that its calibration is open and approximate. timsrust
    states about ±5 ppm m/z with Bruker's SDK and ±10–20 ppm without it, and
    the 1/K0 calibration polynomial is not public, so readers use a linear
    approximation;
  - no fallback in either direction. Conversion stays with msconvert.
- **BAF, YEP and FID go through msconvert only.** The only open readers are
  GPL-3 R code.

### 4. The other vendors stay on msconvert, with their limits stated

- **SCIEX.** `.wiff` and `.wiff2` go through msconvert only. SCIEX's own free
  MS Data Converter 2.0 may be named as the vendor's alternative. `.wiff2`
  decryption is never done.
- **Agilent.** MassHunter `.d` goes through msconvert only. msconvert does not
  read ChemStation `.D`. That gap stays open, and any route for it is a later
  decision under decision 1's rules. entab (MIT, Rust) is the first candidate
  the research names.
- **Waters.** `.raw` goes through msconvert only. Waters' reader licence grants
  use "for non-commercial purposes only". This project reads that grant as
  binding the user who converts through msconvert, not only a distributor (an
  inference from the licence text). If MSCanvas admits Waters, it states that
  limit to the user before a Waters conversion.
- **Shimadzu.**
  - `.lcd` goes through msconvert
    ([ADR 0018](0018-shimadzu-labsolutions-lcd-source-admission.md)).
  - `.qgd` (GCMSsolution) has no msconvert route. MSCanvas's guidance sends
    users to GCMSsolution's netCDF (AIA) export. Only secondary sources support
    that export, and MSCanvas has not verified it. MSCanvas does not read
    netCDF today; reading it would be its own decision.

### 5. No silent substitutes

A reader that is not a vendor reader, such as decision 3's TDF preview if it
is adopted, is a backend the user chooses. The interface and exported
provenance name its identity, its version and the nature of its calibration.
It is never used because msconvert failed. A clear "not supported" refusal is
better than a plausible spectrum 20 ppm off.

### 6. Reopening in-house decoders

Writing an in-house decoder for a vendor format needs an amendment of this ADR,
and at least:

- review by an intellectual-property lawyer;
- a patent search;
- a two-person clean-room process;
- test data under a clear licence.

## Research summary

### Per vendor

| Format | Official reader and licence essentials | Open readers: on the vendor library / independent | Risk of an MSCanvas decoder | Route |
| --- | --- | --- | --- | --- |
| **Thermo `.raw`** | RawFileReader: .NET, free, closed, on Thermo's GitHub, Windows/Linux/macOS. Redistribution "only in combination with" the distributor's software, with uncapped indemnity, an About-box notice and an end-user licence; commercial use needs written consent; "You may not decompile, disassemble, reverse engineer, use reflection or modify this Software"; California law | On it: ThermoRawFileParser (Apache-2.0), rawrr (GPL-3), fisher_py (MIT), thermorawfilereader.rs/mzdata (Apache-2.0), msconvert. Independent: Unfinnigan, unthermo, rawprasslib (stalled, old instruments); opentfraw (2026, not independently validated) | High: new instruments outrun it; a maintainer is probably already a licensee (*uncertain*) | msconvert now; a user-installed ThermoRawFileParser later if a goal needs it |
| **Bruker `.d` TDF/TSF** | TDF-SDK (Windows/Linux, no macOS, login to download); German law; commercial use and non-GPL redistribution allowed under §4's conditions; reverse engineering forbidden | On it: TIMSCONVERT, pyTDFSDK, AlphaRaw. Independent: timsrust, mzdata, OpenTIMS, OpenTimsTDF; layout explained by Bruker staff | Low to medium, and unnecessary: readers exist | Later, separate decision (decision 3); conversion via msconvert |
| **Bruker `.d` BAF/YEP/FID** | Baf2Sql's licence text not found | GPL-3 R code only (rtms, readBrukerFlexData) | Medium to high; no permissive reference | msconvert only |
| **SCIEX `.wiff`/`.wiff2`** | Clearcore2 (Windows .NET). ProteoWizard's EULA copy: non-commercial distribution only, no downstream redistribution, licence key "must not be part of the open source". `.wiff2` is an encrypted container; its SDK licence not found | On it: msconvert, AlphaRaw. Independent: OpenSXRaw (2026; m/z "not reliable on any instrument family"; no `.wiff2`) | High; `.wiff2` decryption touches technological protection measures, the highest risk in the table | msconvert only; never decrypt `.wiff2` |
| **Agilent `.d` (MassHunter)** | MHDAC (.NET; Windows in ProteoWizard): internal use, or distribution "for non-commercial purposes only"; disassembly forbidden "except as permitted by law" | On it: msconvert. Independent: rainbow (LGPL-3), OpenARaw (Apache-2.0, 2026); ChemStation `.D`: entab (MIT), chromConverter (GPL-3) | Medium; high-resolution data needs per-scan calibration | msconvert; ChemStation `.D` a later decision |
| **Waters `.raw`** | MassLynx/WRDAC: use and distribution "for non-commercial purposes only", distribution only as part of ProteoWizard; trade secrets claimed; reverse engineering and publishing benchmarks forbidden; SDK 5.0.0 needs a licence key per file open | On it: msconvert. Independent: rainbow (no high-resolution data), OpenWRaw (no lock-mass correction, median 46 ppm; no ion mobility) | High; ion mobility and lock-mass need the vendor library | msconvert only; state the non-commercial limit |
| **Shimadzu `.lcd`/`.qgd`** | Shimadzu.LabSolutions.IO (Windows x64): non-commercial distribution only, inside a work branded "ProteoWizard"; Japanese law | `.lcd`: msconvert (converted by 3.0.26013); OpenSZRaw wrong m/z on QTOF. `.qgd`: no msconvert route; OpenSZRaw's unit-resolution GC-MS plausible | Medium; `.qgd` is the one real gap | `.lcd` via msconvert; `.qgd` via the GCMSsolution netCDF export |

### Legal risk by practice

| Practice | Canada | United States | European Union | Overall |
| --- | --- | --- | --- | --- |
| **Clean room:** study the user's own data files | No program is copied; a format layout is probably unprotected idea or function; no case law on file formats | No code copied; contract and patent risk remain | *SAS v. WPL* (CJEU 2012): a data file format is not a program's expression | Low for copyright; contract and patent unknown |
| **Oracle:** infer field meanings from the vendor library | May be reverse engineering the licensed "Software" if the EULA was accepted | As Canada, and *Bowers*/*Davidson* enforce such clauses | Art. 5(3) and Art. 8 protect observe, study and test | Medium (*uncertain*) |
| **Decompile** a vendor DLL | s.30.61 interoperability exception, but no rule voiding a contrary contract; government guidance says the EULA prevails | *Sega*/*Connectix* fair use, but *Bowers*/*Davidson* enforce EULA bans; §1201(f) is narrow | Art. 6 allows it under strict conditions; Art. 8 voids a contrary contract | High |
| **Redistribute** a vendor DLL | Depends entirely on the licence | As Canada | As Canada | Breaks AGENTS.md; SCIEX, Agilent, Waters and Shimadzu licences essentially forbid it |
| **Decrypt `.wiff2`** | s.41.1 forbids circumventing technological protection measures; s.41.12's interoperability exception (2024) is narrow | §1201; *Davidson* refused the (f) exception | Art. 6 addresses programs; its reach over data encryption is unclear | Highest |

### Practical risks

- **Silent m/z error.** Independent readers report their own errors: SCIEX
  ±2000 ppm, Shimadzu QTOF wrong, Waters median 46 ppm, Agilent 10–20 ppm,
  Bruker 10–20 ppm without the SDK. They are measured on different bases, so
  they do not rank the readers. A crash is visible; a spectrum 10 ppm off is
  not.
- **Maintenance.** The cost grows with formats × versions × instrument lines.
  Thermo's 2026 RawFileReader build adapts to scan-filter changes. Volunteer
  readers have repeatedly stalled.
- **Validation is circular.** Proving a decoder right needs vendor-library
  output or vendor exports across instruments and software versions, which
  needs vendor software and licences. Waters forbids publishing benchmark
  results.
- **The product's rules amplify all of this.** "No implicit centroiding,
  backend fallback or output overwrite" means a non-vendor reader can only be
  a labelled, user-chosen backend (decision 5).

### Sources

Licences and official readers:
[RawFileReader README](https://github.com/thermofisherlsms/RawFileReader/blob/main/README.md),
[RawFileReader License.doc](https://github.com/thermofisherlsms/RawFileReader/blob/main/License.doc),
[RawFileReader ASMS 2019 slides](https://github.com/thermofisherlsms/RawFileReader/blob/main/docs/ASMS_2019_RawFileReader.pptx),
[EULA.Sciex](https://github.com/ProteoWizard/pwiz/blob/master/pwiz/data/vendor_readers/Sciex/EULA.Sciex.txt),
[EULA.Agilent](https://github.com/ProteoWizard/pwiz/blob/master/pwiz/data/vendor_readers/Agilent/EULA.Agilent.txt),
[EULA.Waters](https://github.com/ProteoWizard/pwiz/blob/master/pwiz/data/vendor_readers/Waters/EULA.Waters.txt),
[EULA.Shimadzu](https://github.com/ProteoWizard/pwiz/blob/master/pwiz/data/vendor_readers/Shimadzu/EULA.Shimadzu.txt),
[Bruker SDK licence copy](https://raw.githubusercontent.com/MatteoLacki/opentims_bruker_bridge/HEAD/LICENCE-BRUKER.txt),
[ProteoWizard download page](https://proteowizard.sourceforge.io/download.html),
[SCIEX on `.wiff2` encryption](https://sciex.com/support/knowledge-base-articles/what-are-the-advantages-of-wiff2-data-file-format_en_us),
[SCIEX MS Data Converter 2.0 guide](https://download.sciex.com/sciex-ms-data-converter-2.0-user-guide.pdf),
[ProteoWizard Shimadzu reader](https://github.com/ProteoWizard/pwiz/blob/master/pwiz/data/vendor_readers/Shimadzu/Reader_Shimadzu.cs),
[ProteoWizard Agilent reader](https://github.com/ProteoWizard/pwiz/blob/master/pwiz/data/vendor_readers/Agilent/Reader_Agilent.cs).

Open readers:
[ThermoRawFileParser](https://github.com/compomics/ThermoRawFileParser),
[rawrr](https://github.com/fgcz/rawrr/blob/devel/R/dotNetAssembly.R),
[thermorawfilereader.rs](https://github.com/mobiusklein/thermorawfilereader.rs),
[mzdata](https://github.com/mobiusklein/mzdata),
[opentfraw](https://docs.rs/crate/opentfraw/1.0.3/source/ATTRIBUTION.md),
[timsrust](https://github.com/MannLabs/timsrust),
[OpenTimsTDF](https://github.com/Sigilweaver/OpenTimsTDF),
[AlphaTims preprint](https://www.biorxiv.org/content/10.1101/2021.07.27.453933v1.full),
[OpenTIMS paper](https://pubmed.ncbi.nlm.nih.gov/33724840/),
[rainbow](https://github.com/evanyeyeye/rainbow),
[entab](https://github.com/bovee/entab),
[OpenSXRaw](https://github.com/Sigilweaver/OpenSXRaw),
[OpenARaw](https://github.com/Sigilweaver/OpenARaw),
[OpenWRaw](https://github.com/Sigilweaver/OpenWRaw),
[OpenSZRaw](https://github.com/Sigilweaver/OpenSZRaw).

Law:
[Copyright Act s.30.61](https://laws-lois.justice.gc.ca/eng/acts/c-42/section-30.61.html),
[s.41.12](https://laws-lois.justice.gc.ca/eng/acts/c-42/section-41.12.html),
[Bill C-294](https://www.parl.ca/DocumentViewer/en/44-1/bill/C-294/royal-assent),
[Trade Commissioner Service guidance](https://www.tradecommissioner.gc.ca/en/market-industry-info/search-country-region/country/canada-united-states-export/intellectual-property-considerations-canadian-smes/reverse-engineering-considerations-protecting-inventions.html),
[EFF reverse-engineering FAQ](https://www.eff.org/issues/coders/reverse-engineering-faq),
[17 U.S.C. §1201](https://www.law.cornell.edu/uscode/text/17/1201),
[Software Directive Art. 6](https://www.legislation.gov.uk/eudr/2009/24/article/6/adopted),
[Art. 8](https://www.legislation.gov.uk/eudr/2009/24/article/8/adopted),
[*SAS v. World Programming*](https://en.wikipedia.org/wiki/SAS_Institute_Inc_v_World_Programming_Ltd),
[*Bowers v. Baystate*](https://en.wikipedia.org/wiki/Bowers_v._Baystate_Technologies,_Inc.).

## Consequences

- **No code changes.** The admitted families, conversion and viewing are
  unchanged. *2026-10-30: except decision 2's vendor centroiding, implemented
  as its note records.*
- **"Thermo direct preview" changes shape.** The
  [plan](../../development/AFTER_BETA1_PLAN.md#75-evidence-gated-items) gated
  it on "an independent reference that does not pass through the same vendor
  reader". That reference cannot be an in-house decoder now. It can be
  published reference values, or a third-party reader adopted by its own
  dependency decision (opentfraw is new and unvalidated). One-click view RAW
  (decision 2) meets the user goal through conversion instead.
- **Two ProteoWizard builds.** ProteoWizard is moving to a C#/.NET rewrite
  (2026-10) whose Linux build reads Thermo, Bruker and Waters files. A user's
  msconvert may be either build, and their outputs are not byte-identical.
  Binding evidence to the build's digest (ADR 0055) matters more, not less.
- **Help and release text** may say why a vendor format is unsupported, and
  name the vendor's own export where one exists.

> **2026-10-30: the condition for "MS2 and up" is met.** Decision 2 kept
> `peakPicking vendor msLevel=2-` in the advanced tier "until a public Orbitrap
> profile-MS2 file is measured". The
> [evidence](../../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md) now measures one:
>
> - the file is source 3c, a CC0 Q Exactive data-independent run from PRIDE
>   `PXD066799`;
> - on the verified 3.0.26013 build, `msLevel=2-` centroided all 23,676 of its
>   Orbitrap profile MS2 spectra;
> - it left the 474 profile MS1 spectra bit-identical (cases `TQ0` to `TQ2`).
>
> This lifts the measurement gate on "MS2 and up". "MS1 and up" also centroids
> MS2, so its claim on Orbitrap profile MS2 is now measured too, for that
> model. Turning "MS2 and up" into a verified row is a follow-up code change,
> not part of this note. Other Orbitrap models and data-dependent profile MS2
> remain unmeasured. Whether that row's source domain is the whole Thermo RAW
> family, as the evidence proposes for both rows, is for that change to settle.
