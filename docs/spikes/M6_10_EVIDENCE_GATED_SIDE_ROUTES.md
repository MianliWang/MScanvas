# M6.10 — Evidence-gated side routes

**Route outcome: `SIDE_ROUTES_DISPOSITIONED`.**

Four conditional routes, four terminal dispositions, none left open. **Two**
`REFUSED_WITH_EVIDENCE` on measurements taken here, **one**
`REFUSED_WITH_EVIDENCE` on a stated and still-unmet admission prerequisite, and
**one** `EVIDENCE_BLOCKED` naming the scientific input that is missing and who
supplies it. **None is admitted, and none had to be.**
[Exit criterion 11](../architecture/adr/0043-conversion-completion-route.md#m610--evidence-gated-side-routes)
requires each route to *reach* a disposition; it never requires one to be
admitted.

This slice admits no capability into the product. It closes four questions, closes
the evidence-tooling correction M6.2 assigned to it, and repairs one shipped claim
that a measurement taken here contradicts.

## Repository baseline

| Fact | Value |
| --- | --- |
| Canonical `main` at start | `7ca6bbb4b6f9d5f48af48fb1f4ce1d59c8774c20` |
| Published tree at start | `d2d93e2cf9d3db00c05bf43e7943b6b1bb9121c4` |
| `main` vs `origin/main` | 0 / 0 |
| Worktree / index / untracked | clean |
| Stash | empty |
| Milestones | M6.0 through M6.9 complete; M6.10 unstarted; M6.11 not started |

## The terminal ledger

**This table is the authority.** Every other statement in this repository about
these four routes cites it rather than restating it, and criterion 11 is answered
from here.

| # | Route | Question, exactly | Shipped availability today | Applicable gate | Disposition | Named outcome it maps to |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **CNV-002 mzXML output** | May MSCanvas offer mzXML as a second conversion output format? | **Unavailable and unconstructible.** `OutputFormat` has one variant, so no `ConversionIntent` names mzXML and `PlanError::MzXmlIntegrityGateRequired` is unreachable | CNV-002's **source/output spectrum comparison**. `ValidationMode::OutputOnly` cannot carry it | **`REFUSED_WITH_EVIDENCE`** | CNV-D1's **`MZXML_REFUSED`** |
| 2 | **Vendor-format direct preview** | May a vendor acquisition be previewed without converting it first? | **Unavailable.** `open_preview` refuses a non-previewable family with `dataset_not_previewable` before any backend runs | ADR 0037 / 0042: **conversion support is not direct-preview support**, under ADR 0042's evidence discipline, whose third step is a **representative** measurement | **`EVIDENCE_BLOCKED`** | — (criterion 11 vocabulary only) |
| 3 | **Any further vendor family** | Does M6 open an additional vendor source family at all — asked once, not family by family? | **Unchanged at three**: Thermo RAW, Shimadzu LCD, SCIEX WIFF. `EVIDENCED_PROVIDER_BUILDS` holds three rows and `ConversionSourceKind` four variants | ADR 0007's directory-acquisition evidence list for the directory-shaped candidates, and the lawful-fixture and recognition prerequisites ADR 0010 and ADR 0018 each established for a file-shaped one | **`REFUSED_WITH_EVIDENCE`** | — (criterion 11 vocabulary only) |
| 4 | **VIEW-007 conditional XIC re-entry** | Has a **different** `msaccess` executable identity appeared, which is the stated trigger? | **Unavailable.** VIEW-007 is unimplemented; no operation, gate, DTO, command or surface exists | ADR 0042 / `ROADMAP.md`: a **different measured `msaccess` identity**, then M5.4's three-part gate in full | **`REFUSED_WITH_EVIDENCE`** | M5.4's **`XIC_SOURCE_REFUSED`**, retained |

**Three vocabularies, mapped rather than merged.** Criterion 11 admits exactly
`ADMITTED`, `REFUSED_WITH_EVIDENCE` and `EVIDENCE_BLOCKED`. CNV-D1 and M5.4 each
carry their own named outcome, and the last column maps to them instead of
replacing them. `PENDING`, `DEFERRED_WITH_OWNER` and `NOT_TRIGGERED` appear
nowhere as a route's disposition: none of them is terminal.

**A route's disposition is not an experiment's status.** Route 1 is refused while
one of its experiments — the second mzXML drop condition — stays blocked; route 4
is refused while the identity that would have triggered its gate never appeared.
Both are recorded that way below rather than averaged into one word.

## Executables, re-observed

Every conclusion below belongs to these two identities, observed **before and
again after** every measurement this slice took.

| Fact | `msconvert` | `msaccess` |
| --- | --- | --- |
| Bytes | `12,687,872` | `12,898,816` |
| SHA-256 | `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD` | `85681B205569A9850F47D079749E04BA45F4B0C64E363D4A2C5C67C3C67ED1F4` |
| Release, as the tool states it | `3.0.26013 (47b13cf)` | `3.0.26013` |
| Build date | `Jan 13 2026 14:42:37` | `Jan 13 2026 14:42:37` |
| Help capture | stdout, exit `0`, `34,486` bytes, `2597C0A4…5752` | stderr, exit `1`, `28,873` bytes, `81C280BD…3553` |
| Stable across this slice's runs | yes | yes |

Discovered where this repository's own discovery searches. **No absolute
executable path is recorded here.** Both digests are byte-identical to the ones
[M6.2](M6_MSCONVERT_CAPABILITY_EVIDENCE.md) and
[M5.4](M5_XIC_SOURCE_EVIDENCE.md) recorded, and the `msaccess` help capture
reproduces M5.4's recorded stderr digest exactly.

## Route 1 — CNV-002 mzXML

**Disposition: `REFUSED_WITH_EVIDENCE`, which is CNV-D1's `MZXML_REFUSED`.**

### The decisive comparison, reproduced with the corrected tooling

The whole M6.2 ledger was re-run against the executable above with the
strengthened inspector and driver this slice delivers. **29 cases, 66
independent confirmations, all 66 agree, no classification changed.**

| Case | Source | argv between source and `--outdir` | Exit | `<scan>`/`<spectrum>` written | Run-level declaration | Survivor identities |
| --- | --- | --- | --- | --- | --- | --- |
| `X1` | profile | `--mzXML --64` | `0` | `4` | `scanCount="4"` | `1, 2, 3, 4` |
| `X2` | multi-source | `--mzXML --64` | `0` | **`2`** | **`scanCount="4"`** | **`1, 4`** |
| `X3` | multi-source | `--mzML --64` | `0` | `4` | `count="4"` | `scan=1 … scan=4` |
| `X4` | profile | `--mzXML --64`, backend-named output | `0` | `4` | `scanCount="4"` | `1, 2, 3, 4` |
| `X5` | profile | `--mzXML --64 --filter peakPicking` | `0` | `4` | `scanCount="4"` | `1, 2, 3, 4` |

**The refusal rests on scan elements and decoded arrays, not on `scanCount`,
exit status or well-formed XML.** `X2` exits `0` with empty stderr and produces a
document that parses. What it does not produce is the spectra: the fixture's
source-file attribution is `SF1, SF2, SF2, SF1` over MS levels `1, 2, 1, 2`, and
the two survivors are **scan 1 and scan 4** — the two `SF1` spectra, spanning
**both** MS levels. Selection is by source file and not by MS level, which is the
confound the fixture was built to exclude. `X3` is the control: the same document
to mzML keeps all four and preserves their attribution, so the loss is the mzXML
writer's and not the reader's.

**And the header stands over a document that is not there.**
`msRun/@scanCount="4"` sits above two `<scan>` elements. A consumer trusting the
declared count would read a two-spectrum document as a complete four-spectrum
conversion. **M6.2's harness could not see this** — it never read the run-level
attribute, so `X2`'s *drop* reproduced through the tooling and its
*misdeclaration* did not. It can now: the run pins that `X2` is the only parsed
output in the whole set carrying a structural defect, and that its one defect is
exactly `msRun declares scanCount=4 over 2 scan elements`.

**This is the gate CNV-002 names, and this build fails it.** The gate is a
source/output spectrum comparison. `ValidationMode::OutputOnly` cannot carry one
— it is reached precisely because there is nothing to compare against — and the
shipped comparison path reads mzML on both sides.

### The single-source result, kept at its own scope

**`X1` and `X4` are faithful.** Four spectra of four, MS levels and point counts
preserved at `14, 7, 21, 7`, `precision="64"` declared, decoded m/z and intensity
arrays **exactly equal to the source `float64` values**, and a header that
declares what was written. `X4` is the case that supplied no `--outfile`, so that
result holds for a document the backend named itself. Both comparisons are made
by the driver against the fixture rather than against each other.

**`X5` is not one of them, and saying so matters.** It runs a picker, which is
its purpose in the ledger, so its arrays are the picked apexes and its point
counts are `4, 1, 7, 1` against the source's `14, 7, 21, 7`. What `X5` shows is
that a processing intent carried into mzXML keeps all four spectra and an honest
header — not that mzXML preserved anything. Reading it as faithful would be
reading the picker's output as the source's, and an earlier draft of this
sentence did exactly that.

That is a real result and it is **not** product support.

**A narrower single-source admission is not established, and is not proposed
here.** It would need, and does not have: an *enforceable* source precondition
that a document has one source file, applied before a plan is built rather than
assumed; the applicable integrity gates, which for a second format means a
source comparison that the current path performs only for mzML; and the output's
naming and directory behaviour on the non-mzML path — `X4` shows the backend
naming its own output `m62_profile.mzXML` when none is given, which a plan that
must derive its destination identity cannot use. Nothing here assumes a vendor
acquisition is single-source; the one lawful vendor acquisition available to this
slice happens to be, and one file is not a precondition.

**So mzXML stays unconstructible.** `OutputFormat` keeps one variant, no intent
names the format, and `PlanError::MzXmlIntegrityGateRequired` stays unreachable
and kept — deleting a refusal because nothing reaches it is how a format returns
without one.

## Route 2 — vendor-format direct preview

**Disposition: `EVIDENCE_BLOCKED`.**

### What was measured, exactly

The five operations `PreviewOperation` emits, in the exact argv shape
`build_msaccess_command_spec` builds — `msaccess <input> --outdir <fresh> --exec
"<command>"` — against three inputs, each into a fresh directory, all from one
pinned working directory.

| Input | `metadata` | `run_summary` | `spectrum_table` | `tic` | `binary` |
| --- | --- | --- | --- | --- | --- |
| **A** — the Thermo acquisition, read **directly** | exit `0`, `1,033` B | exit `0`, no file, `324` B on stdout | exit `0`, `260` B | exit `0`, `147` B | exit `0`, `47,253` B |
| **B** — a generated mzML fixture, the harness control | exit `0`, `995` B | exit `0`, no file, `337` B on stdout | exit `0`, `469` B | exit `0`, `233` B | exit `0`, `729` B |
| **C** — the same acquisition **converted** to mzML | exit `0`, `1,479` B | exit `0`, no file, `321` B on stdout | exit `0`, `257` B | exit `0`, `144` B | exit `0`, `47,250` B |

Bytes are the output directory's contents unless the cell says stdout. Every
other operation wrote its output to a file and nothing to stdout.

**`msaccess` reads the vendor acquisition directly.** Four of the five operations
wrote a file and the fifth wrote to stdout; none failed, and none refused the
input. `run_summary` produced no file for **any** of the three inputs, including
the mzML control — that is a property of this build's command, not of the vendor
path, and it is recorded so it is not mistaken for one.

**The direct read and the converted read agree.** `binary` returned `1,525`
lines from each, differing in exactly **one**: the comment naming the source
file. All `1,504` data lines are identical. `spectrum_table` and `tic` differ in
the same one line and in nothing else, down to the native identifier
`controllerType=0 controllerNumber=1 scan=1`.

**Where that comparison is held, stated rather than implied.** The line counts
above were taken from the two outputs directly, and those outputs are retained
outside the worktree with the acquisition, so they are not reproducible from
anything committed here. What the retained report does carry independently is the
**three-byte delta on every affected output** — `47,253` against `47,250`, `260`
against `257`, `147` against `144` — which is exactly the difference in length
between the two source names and nothing else. Read the line figures as the
unretained observation they are; the byte deltas corroborate them and are
recorded.

### Why that is not an admission, and what is actually missing

**The comparison is not independent.** Both sides of it pass through the same
vendor reader in the same executable. It shows the direct path and the converted
path agree; it cannot show either is right, because a reader wrong in both places
produces exactly this agreement. **A successful conversion is not proof of the
preview numbers, and a self-consistent reread is not either.**

**One file is not a family.** This acquisition is a single-scan MS2 extraction:
one spectrum, one controller, already centroided, no MS1, no chromatogram list.
Nothing here says what this build does with an MS1 spectrum, a chromatogram, a
multi-sample acquisition or a profile scan. ADR 0042 names the discipline this
falls short of — exact capability, exact executable identity, **representative
and live measurement**, classification, then admission or an explicit refusal —
and ADR 0037 supplies the half that bites hardest here: an exit code of `0` is
not evidence of correctness. **Two of the three
admitted conversion families were not measured at all**, and SCIEX WIFF is
structurally harder: one acquisition legitimately yields one document per sample,
and the preview boundary carries one source identity.

**The serialization limits M5.4 measured are present here.** The `tic` output for
this acquisition carries `sumIntensity` at **four fixed decimal places**, which is
the exact finding M5.4 refused `tic` as an XIC source on. It is the same build.
Whatever a preview admission would be, it inherits that.

**And positive evidence is not a delivered feature.** Admitting this route means a
production change at `open_preview`'s `is_previewable` gate, a per-family
capability gate bound to an executable identity, and the preview contract's own
obligations — with the integration and rendered tests that go with them. None of
that is licensed by one successful read.

**A silent temporary conversion is not direct preview**, is not an authorized
fallback, and is not proposed. `dataset_not_previewable` says
*"Convert to mzML before previewing this acquisition."* — which is an explicit
instruction to the user, not a hidden step.

| The missing input | Who supplies it |
| --- | --- |
| Lawfully redistributable **representative** acquisitions for each admitted family — a Thermo acquisition carrying MS1 and a chromatogram list, a Shimadzu LCD, and a multi-sample SCIEX bundle — rather than one single-scan extraction | The repository owner, as a fixture-permission decision on the basis ADR 0010 and ADR 0018 already established |
| An **independent reference** for the preview quantities that does not pass through the same vendor reader — a published reference value set, or a second reader | The same decision, plus the slice that would own the measurement |
| The product decision to open the preview boundary to a non-mzML family at all, with its capability gate and contracts | A later slice. **Not M6.10's**, and not M6's: ADR 0043 excludes an admitted direct preview from every exit criterion |

**This is not a claim that the provider cannot do it.** It plainly did, once, for
one file. The route is blocked on the evidence an admission needs, which is a
different thing and is recorded as one.

## Route 3 — whether M6 opens any further vendor family

**Disposition: `REFUSED_WITH_EVIDENCE`. The milestone-level answer is no.**

### The answer, and its actual basis

The question is asked once, as ADR 0043 asks it: *does M6 open an additional
vendor source family at all?* It is answered before any candidate is enumerated,
because the reason is the same for all of them and does not depend on which.

**No.** The basis is a **standing repository decision plus an unmet admission
prerequisite**, and it is stated that way rather than as an experimental result.

- **ADR 0007 decides directory acquisitions: "Recognise none."** Suffix-only
  recognition is rejected outright, and the ADR states a list of things this
  repository requires before *any* directory family may be recognised — a
  representative structure, a lawful source for it, marker evidence beyond the
  suffix, case and nesting behaviour, whether the provider accepts the root,
  whether preview and conversion support it, how filesystem identity, a lease and
  change detection would work on a directory, and what a roster row could then
  truthfully say. **Not one item of it was produced by any M6 slice**, and no M6
  slice was scoped to produce any. That covers Bruker, Waters and Agilent `.d`
  together, which is why they are not surveyed one at a time. The list is cited
  rather than counted: an earlier draft of this sentence gave it a number, and
  the number was arrived at by counting semicolons — the kind of hand-derived
  count the rest of this slice exists to remove.
- **The file-shaped candidates need a different prerequisite, stated separately**
  because ADR 0007's list is about directories and does not reach them. A
  file-shaped family needs what ADR 0010 and ADR 0018 each established before
  their family was admitted: a lawfully redistributable acquisition, a
  recognition authority that reads the bytes rather than the suffix — and M3.7
  recorded that ProteoWizard's own compound-file readers supply none — and a
  source model the conversion plan can represent. **`.wiff2` is a different
  container**, and the SCIEX admission says so in the code that carries it: the
  evidenced row is about this installation's SCIEX library reading acquisitions
  Analyst wrote between 2007 and 2012, and is explicitly not evidence about
  `.wiff2`.
- **No lawful fixture exists in this repository for any unadmitted family.** The
  two vendor families this repository did admit each came in through a recorded
  lawful-use basis and a measured two-stage acquisition; nothing equivalent
  exists for a fourth.

**This is a policy choice about M6's scope, resting on evidence about what is
absent — not a measurement that any family failed.** No unadmitted family was
tested here, and none is claimed to be unsupportable. ADR 0043 puts the same
thing from the other side: an admitted further vendor family is excluded from
every M6 exit criterion, unconditionally.

**The state that is preserved.** Three families stay admitted and unchanged —
`ThermoRawFile`, `ShimadzuLcdFile`, `SciexWiffBundle` — on three
`EVIDENCED_PROVIDER_BUILDS` rows bound to the digest above. No row was added,
removed, relaxed or widened. No directory family is recognised, and M6.5's two
directory containment rules remain implemented and tested through the path a
directory-shaped source would enter, and remain unexercisable through an admitted
family.

**Re-entry** is ADR 0007's list, in full, for whichever family a later milestone
proposes — not an extension inferred from this repository already converting
three.

## Route 4 — VIEW-007's conditional XIC re-entry

**Disposition: `REFUSED_WITH_EVIDENCE`, retaining M5.4's `XIC_SOURCE_REFUSED`.**

### The trigger, re-observed rather than inherited

The trigger ADR 0042 and `ROADMAP.md` state is **a different measured `msaccess`
executable identity**. A match in M6.0 or M6.2 is not today's observation, so the
identity was measured again here, against M5.4's exact refusal identity.

| Fact | M5.4 recorded | Observed by M6.10 | Same |
| --- | --- | --- | --- |
| `msaccess.exe` bytes | `12,898,816` | `12,898,816` | yes |
| `msaccess.exe` SHA-256 | `85681B20…D1F4` | `85681B20…D1F4` | yes |
| Release, from `msaccess` itself | `3.0.26013` | `3.0.26013` | yes |
| Build date | `Jan 13 2026 14:42:37` | `Jan 13 2026 14:42:37` | yes |
| `msaccess --help` stderr | `28,873` bytes, `81C280BD…3553` | `28,873` bytes, `81C280BD…3553` | yes |

**The new-identity trigger did not fire.** The bytes are the ones M5.4 measured,
so M5.4's scientific refusal is retained and this route closes on it: the four
queries that can express an m/z window were each measured and each rejected —
`tic`, `sic` and `slice` on **four-fixed-decimal intensity serialization**, and
`image` independently, on producing no per-scan quantity and no result identity.

**What the digest match does and does not establish.** It establishes that the
executable is the one the refusal covers. It does **not** re-run the science, and
nothing here claims it does: no XIC measurement was taken, no query was executed,
and hashing an executable is not evidence about what it computes. The refusal
stands on M5.4's own measurements, which are cited and not re-derived.

**M5.4's three-part re-entry gate did not run, because its first part did not
open.** For the record, so a later reader does not have to reconstruct it: a
different digest requires the exact help/capability grammar as well; a resolved
numeric-fidelity answer, either a serialization that preserves the zero/non-zero
distinction over the mzML domain MSCanvas supports or a declared, measured,
capability-gateable precision control; and **re-measurement of everything that
record establishes**, because both defects it found — the four-decimal
serialization and the singular-parabola abort — are implementation properties that
help text does not expose. A matching help text is not a substitute for any of
it, and **evidence never transfers on a version label**.

**What this permits, and its owner.** It permits nothing to be built. It records
that the condition was evaluated against the identity actually installed and did
not open. If a different `msaccess` is ever installed, the gate above is live
again and its owner is whichever slice measures it; the question of whether
*another provider or runtime* could serve an XIC belongs to the Post-M6 interlude,
which this slice does not start, schedule or prejudge.

**M6.10 decides the route and does not implement XIC.** No operation, capability
gate, parser, DTO, command, frontend, cache, export or selection authority was
added, and no `PreviewOperation` was extended. A visible XIC is not VIEW-007's M6
form and is on no M6 criterion.

## Subordinate obligations

M6.10-owned, and **not** criterion-11 routes. Each carries a supported
disposition; none is dropped because the ledger above has four rows.

| # | Obligation | Owner it came from | Disposition |
| --- | --- | --- | --- |
| S1 | `peakPicking vendor` performing the vendor algorithm | M6.2 blocked table | **Partly measured, partly `EVIDENCE_BLOCKED`** — see below |
| S2 | mzXML's second drop condition: a Thermo spectrum outside `controllerType=0 controllerNumber=1` | M6.2 blocked table | **`EVIDENCE_BLOCKED`**, with a sharper reason than M6.2 had |
| S3 | Representative-profile re-entry for `cwt`'s rejection and the default picker's exactness | M6.2 unverified assumptions | **`EVIDENCE_BLOCKED`** |
| S4 | The inspector's four strictness gaps: base64 syntax, a missing array, the mzXML run-level count, other structure | M6.2, "the harness is an inspector, not a validator" | **Closed** |
| S5 | `verify()` covering the bases it claims, and the guard comparing every ledger field | M6.2, same section | **Closed** |
| S6 | Pinning the driver's working directory and keeping its report out of the observed ones | M6.2 residual | **Closed** |

### S1 — the vendor picker, reached at last, and what it changed

M6.2 named the missing input as *a lawful vendor acquisition of an admitted
family, plus authorization to exercise the vendor DLL path*. The first half
exists: the Thermo acquisition ADR 0010 admitted, on the Apache-2.0 basis M3.0.3
recorded, re-verified here at `78,309` bytes and SHA-256 `b3d97b38…6dd7b` against
a `200` with no redirect. The second half is the same class of operation M3.0.3
already performed on this build with this file — one filter token apart, no new
component, nothing installed and nothing vendored.

Four conversions of that acquisition, one argument apart:

| Case | Filter | Exit | Implementation the output names | Decoded arrays |
| --- | --- | --- | --- | --- |
| `V1` | *(none)* | `0` | *(no picking method)* | `1,504` points |
| `V2` | `peakPicking` | `0` | **`Thermo/Xcalibur peak picking`** | identical to `V1` |
| `V3` | `peakPicking vendor` | `0` | **`Thermo/Xcalibur peak picking`** | identical to `V1` |
| `V4` | `peakPicking cwt` | `0` | `CantWaiT (continuous wavelet transform) peak picker` | identical to `V1` |

**Measured: the vendor path is reached on a vendor acquisition, and the bare form
reaches it too.** M6.2 observed the request producing the local-maximum picker on
an *open* source and correctly recorded that as evidence about the fallback. It is
now clear what the fallback is a property of: the **source**, not the request.
Where a vendor reader is behind the source, both `peakPicking` and
`peakPicking vendor` select the vendor picker and record its name.

**Still `EVIDENCE_BLOCKED`: what the vendor algorithm *does*.** All four outputs
carry identical arrays, because this acquisition is **already centroided**. No
picker had profile data to act on, so nothing here measures the vendor
algorithm's numerical behaviour — only that it is selected and named. The missing
input is a lawfully redistributable **profile-mode** vendor acquisition of an
admitted family; the party is the same fixture-permission decision route 2 names.

**M6.3's admitted table is unchanged, and no vendor centroiding intent is typed.**
That remains true for the reason it was always true: what the vendor algorithm
computes is unmeasured. A shipped consequence of this measurement is recorded
under [repairs](#one-shipped-claim-repaired) rather than here.

### S2 — the second mzXML drop condition

**`EVIDENCE_BLOCKED`, and the reason is now specific rather than general.** The
condition is a Thermo spectrum not from `controllerType=0 controllerNumber=1`.
The one lawful Thermo acquisition available to this slice carries exactly one
spectrum and its native identifier is `controllerType=0 controllerNumber=1
scan=1` — the very controller the writer keeps. It cannot exercise the condition
at all.

Missing: a lawfully redistributable Thermo acquisition with **more than one
controller**. Party: the fixture-permission decision above.

**Route 1 does not depend on it**, and this is the distinction criterion 11
insists on. The source-file condition is measured, is a decisive counterexample
against the gate CNV-002 states, and is sufficient on its own. A second, separate
experiment remaining blocked does not reopen a gate that has already been
answered.

### S3 — representative-profile re-entry

**`EVIDENCE_BLOCKED`, unchanged in substance and re-checked here.** M6.2 scoped
both peak-picking findings to synthetic seven-point peaks with hard zero flanks:
`cwt` returning one of three peaks, and the default picker recovering every apex
bit-exactly. Neither generalizes to instrument-shaped data.

Nothing this slice acquired supplies the input. The Thermo acquisition is
centroided. The representative open acquisition this repository pins is
MS2-only mzML and its README already excludes MS1 behaviour of any kind. Missing:
a lawfully redistributable **profile-mode** acquisition with resolvable peaks.
Party: the fixture-permission decision above; consumer: whichever slice would
re-open CNV-005 and CNV-006, which stay unconstructible meanwhile.

### S4, S5, S6 — the tooling correction, closed

See [the tooling section](#the-inherited-evidence-tooling-correction).

**One unmeasured combination is preserved exactly as M6.2 left it.** Per-array
precision composed with any processing intent is still `NOT_MEASURED`: every
filtered case in the ledger carries the *global* `--32` or `--64`, and `--mz32`,
`--mz64`, `--inten32` and `--inten64` appear only in cases that run no filter.
The corrected tooling checks more of what the ledger *did* run; it measures
nothing new, admits nothing, and promotes no M6.2 candidate.

## The inherited evidence-tooling correction

M6.2 assigned this to M6.10 as **one pass over the runner and the guard rather
than a patch per instance**, and it is done that way.

### The inspector now refuses documents it used to call healthy

| Property | Before | Now |
| --- | --- | --- |
| Document root | any root fell through to the mzML reader, whose descendant search then recovered every spectrum — so a complete mzML wrapped in anything at all read as a clean mzML | only `mzML`, `indexedmzML` and `mzXML` are read; every other root is refused |
| Contradictory declarations | two compression terms, two float widths, or two array roles on one array silently took whichever appeared first | an array that declares two of any of them is reported rather than decoded under one of them |
| Trailing bytes | a valid zlib stream with bytes appended decoded to the stream and said nothing about the suffix | an incomplete stream and a non-empty suffix are each reported |
| Per-array length | mzML's optional `arrayLength` override was discarded, so a document using it legitimately read as corrupt | each array is held to its own declared length where it states one, and a present override that is not a number is a defect rather than a reason to fall back |
| Base64 syntax | `b64decode` **silently discarded** characters outside the alphabet, so a payload with a stray `$` decoded to aligned bytes and read as healthy | Layout whitespace is removed; anything else — a stray character, a length that is not a multiple of four, wrong padding — is reported and the array decodes to nothing |
| Declared compression | a payload declaring `zlib` that does not decompress raised | reported as a defect on the array that carries it |
| Required arrays | a spectrum with **no intensity array at all** carried no malformed flag and no length disagreement | each spectrum's array **roles** are checked by name: a missing one, a duplicated one and an unrecognised one are each a named defect |
| Declared vs decoded length | compared per array | unchanged, and now reported with the roles and lengths that disagree |
| Run-level count | **not read at all** for mzXML, so `X2`'s drop reproduced and its misdeclaration did not | `msRun/@scanCount` and mzML's `spectrumList/@count` are both read and reported **beside** the elements actually written |
| Document health | there was no such report | every document carries a `defects` list, and a numeric agreement no longer makes a malformed document healthy |

A document that is missing or wrong fails a positive equality rather than passing
it, which is why M6.2's conclusions did not rest on the silence. What the gaps
cost was the ability to tell a corrupt document from a healthy one, and that is
what is closed.

### `verify()` now covers the bases it claims

Every gap M6.2 enumerated, and what replaced it:

| Gap M6.2 recorded | What runs now |
| --- | --- |
| No `cwd` passed; only `--outdir` enumerated | One **pinned** working directory, created empty, used by every case, enumerated afterwards — and the driver's report is written outside it, so the driver's own file is not one of the entries the measurement is about |
| `posture` copied into the report; only `K7` and `K8` compared | Every case's exit is parsed from its declared posture and compared, together with its output **name** and its directory **contents**, as one per-case comparison |
| `K5` and `K6` run and never compared | Each anchored to the two MS2 spectra the fixture holds, **and** compared to each other by every decoded value of both arrays. Anchoring both sides is the point: compared only to each other, "the order does not matter" and "neither filter did anything" are the same observation |
| The default-picker check read spectrum 2, m/z only | Every apex of every spectrum, **m/z and intensity**, against apexes derived from the fixture plan rather than from any output |
| MS-level checks compared ids, not arrays | `L1` and `L2` compared by id **and** by every value of both arrays of every surviving spectrum |
| `P1` and `P2` run and never shaped | All six precision postures shaped over both arrays of every spectrum |
| The compression check read one array of one spectrum | Every array of every spectrum, for `D1`, `C1` and `C2` |
| `K12` run and never compared | Every value against the exact `binary32` image of `K1`'s, plus declared width and entry counts |
| `K10` run and read by nobody, `K8` read only for its exit status | `K10`'s scope compared against both levels and its arrays against `K2`'s; `K8`'s output read, not just its exit — it is what makes `K7` a fact about the algorithm rather than about the fixture |
| Nothing pinned *which* outputs failed to read back | `K7` is required to be the only one. Without that, a second output that stopped parsing would be dropped from the health check silently and the run would still report agreement |
| The guard compared case id and format | The guard compares **every field a case declares** — id, family, fixture, argv, format, output name, posture — through one rendering contract |

**Two rules keep the new checks honest.** An equality taken over an array — or
over a list of surviving spectrum ids — that came back empty would agree with
anything, so every one a comparison reads is recorded and an empty one is a
**disagreement in its own right**. And `K7`'s
expected failure stays its own result: exit `1`, an unterminated partial document
that does not parse, and one directory entry that is that partial artifact — never
a successful conversion, and never a reason to skip a case.

### The run

```text
python -B scripts/msconvert_evidence_run.py --report <file>
```

| Step | Result |
| --- | --- |
| Fixtures regenerated and matched against their recorded digests | 3 / 3 exact |
| Executable identity checked **before** the run | matches the identity above |
| Cases enumerated from the committed ledger | `29`, all ids unique |
| Cases executed, each into a fresh empty directory | `29` |
| Exit, output name and directory contents matching the row that asked for them | `29 / 29` |
| mzXML-producing cases, derived from the ledger | `4` — `X1`, `X2`, `X4`, `X5` |
| Parsed outputs carrying a structural defect | `1` — `X2`, and its one defect is the run-level misdeclaration |
| Entries in the pinned process working directory afterwards | **`0`** |
| Independent confirmations recomputed from this run | **66 / 66 agree** |
| Executable identity checked **after** the run | byte length, digest, release and build date unchanged |

**No classification changed.** The corrected tooling reproduced every M6.2
conclusion and revealed no prior measurement error; what it added is the ability
to *see* the one defect M6.2 had to describe in prose, and to fail if any of the
newly covered comparisons ever stops holding.

**Two of the confirmations were rewritten rather than dropped.** An earlier
revision of this driver compared the ledger's own derivation of the mzXML cases
against a copy of itself, and the number of cases run against the length of a
dict built by iterating those cases. Neither could fail. Both are still checks
and both are still in the count; what changed is what they compare against — the
output names on disk, and the set of cases that produced a document. A check
that cannot fail inflates a count without adding a confirmation, which is the
defect this driver exists to prevent.

**The count itself is not guarded.** It is what the run printed, and reproducing
it requires the executable, which repository validation does not have. A static
guard over the driver's source is conceivable and would be brittle, so none is
claimed. What is done instead is to keep the number in the **two evidence
records that describe a run** — this one and M6.2's amendment — and to have every
summary elsewhere link here rather than restate it. A figure repeated across five
documents and derivable in none is the shape of the defect this slice spent its
tooling budget removing.

**And the number rose through review**, from 52 to 66. Every increment is a
check review found missing, not the same measurement recounted: `K8`'s and
`K10`'s outputs, which the driver ran and read back for nobody; the pinning of
`K7` as the *only* output that does not read back, without which a second
unreadable one would have been dropped from the health check in silence; the
checks that separate what `X1` declares from what `X5` declares from what `X5`'s
apexes are — one of which, in its first form, was named for `X5` and read `X1`,
so it could not fail; and the anchoring of the order pair to `K2`, because two
outputs compared only to each other agree just as well when the picker did
nothing to either. M6.2's own conclusions stay as they
were written, and this record does not rewrite them.

**The working-directory result is now a property the tooling enforces**, not a
measurement an operator took by hand. M6.2 ran the set from a directory made for
the purpose and found the driver's own report in it afterwards; the report is now
written outside, and the directory is empty.

## One shipped claim repaired

**Found by S1, and it is a claim rather than a capability.** Three places in the
shipped product said the bare `peakPicking` filter runs the local-maximum
algorithm, unconditionally. On this build that is measured true for a source with
no vendor reader behind it, measured **false for Thermo RAW**, and **unestablished
for Shimadzu LCD and SCIEX WIFF** — neither was measured, and whether their
readers advertise vendor centroiding is not a question this slice asked.

Which is enough to correct the claim without replacing it with a second
unsupported one. A sentence that names one algorithm for every source is
contradicted by the one family that was measured and unsupported for the two that
were not, so the algorithm is no longer named.

| Where | What it said | What it says now |
| --- | --- | --- |
| `mzml.rs`, the recognised picker names | `"vendor peak picking"` — **a string no run of this build has ever produced**, carried from a source reading into a table whose other entry is measured | `"Thermo/Xcalibur peak picking"`, measured here, and qualified as **family-specific as well as build-specific** |
| `intent.rs`, `UnscopedDefaultCentroiding` | "Centroiding by the build's default local-maximum picker" | the picker the **bare form selects**, which is measured per source family rather than named once |
| `ConversionSettings.tsx`, the disclosure a user reads | "Lossy. **Default local-maximum peak picking** replaces the recorded profile points…" | "Lossy. **Peak picking** replaces the recorded profile points…" — the loss is claimed, the implementation is not |

**A consequence is recorded rather than left to be met, and it is reachable.** On
this build a **Thermo** acquisition converted under `UnscopedDefaultCentroiding`
is **refused** by the conversion integrity contract with
`ProcessingAlgorithmMismatch`, because the algorithm the intent names is not the
algorithm this build runs there. **The refusal is the contract working**: nothing
wrong is certified and no wrong data is published. The repair makes the diagnosis
accurate — `VendorPeakPicking` rather than `Unrecognized` — and changes no gate
outcome, no admission and no argv.

**How reachable, exactly.** `is_convertible` answers `false` for mzML, so **every
conversion the visible workflow performs is of a vendor acquisition**. The two
`UnscopedDefaultCentroiding` rows in the admitted table rest on `K1`, `K8` and
`K12`, all measured on **mzML** fixtures, and the control that offers them is not
qualified by source family. So the combination a user can select is offered only
on sources where M6.10 has now measured a different algorithm running — and for
the one family measured, the conversion is refused after the provider has run.
Nothing on screen says so.

**This is not a regression, and it is not repaired here.** The refusal predates
this slice: before the repair the same conversion failed as `Unrecognized`
instead. What changed is that somebody has now measured why. Whether the product
should offer that combination for a vendor row at all, whether M6.4's typed
availability should withdraw it, and what the control should say instead are one
**product decision**, and it needs the two unmeasured families answered before it
can be made well.

**Owner: M6.11, to carry as a non-blocking residual with this record as its
evidence**, and the first slice that revisits conversion processing to decide it.
Naming an owner is not optional here — ADR 0043 requires a residual recorded
outside the exit criteria to carry one, and an unowned known-broken option is the
shape of exactly the failure criterion 11 exists to prevent, one level down.

**Also recorded, and lower.** A *source* mzML whose own history names
`vendor peak picking` now folds to `Unrecognized`, which makes the unknown delta
unestablishable and degrades `RequestedProcessing` from verified to unverified
rather than refusing. It is fail-safe, and it is unreachable from the visible
workflow because mzML is not convertible there.

## Fixture and permission provenance

| Item | Value |
| --- | --- |
| Fixture | The Thermo acquisition ADR 0010 admitted, re-verified at M3.0.3's pinned commit |
| Retrieval | `200`, zero redirects, no credentials, no account |
| Byte length | `78,309`, matching the recorded identity |
| SHA-256 | `b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b`, matching |
| Licence instrument | The repository root `LICENSE` at the pinned commit — Apache-2.0, `200`, `11,358` bytes, matching |
| Held | Outside the worktree, in a task-owned directory, and not committed |
| Printed | **Nothing of its content.** Its bytes carry an author's given name, a machine name and local paths, which is why M3.0.3 does not print them and neither does this record |
| Not authorized by it | Any other vendor experiment. A conversion-fixture permission is not a standing licence for every vendor algorithm or DLL path |

The three synthetic mzML fixtures are unchanged, regenerated from
`scripts/msconvert_evidence.py` and matched against their recorded digests.

## Limits, stated rather than implied

- **Every measurement belongs to the two executables above**, on this machine, on
  the dates recorded. Nothing transfers to another build, and no negative result
  here is a claim about any other.
- **Route 2's positive read is one file, one spectrum, one family.** It is not
  evidence about MS1 behaviour, chromatograms, profile data, multi-sample
  acquisitions, the other two admitted families, or scale.
- **Route 3 tested no vendor family.** Its answer is a scope decision resting on
  unmet, stated prerequisites, and says nothing about whether any family could be
  supported.
- **Route 4 took no XIC measurement.** It observed an executable identity. M5.4's
  findings are cited as M5.4's.
- **The corrected tooling measures the same 29 cases.** It does not widen the
  candidate set, and it admits nothing.
- **`msRun/@scanCount` was measured on the multi-source mzXML case.** Whether the
  same writer misdeclares on other inputs is still unmeasured, as M6.2 recorded.
- **The vendor measurements are not reproducible from this repository.** The
  29-case ledger is committed, fixture-pinned and re-runnable by anyone; routes 2
  and 3's measurements and S1's are not, because the acquisition they need cannot
  be committed. Their inputs are identified by digest and their argv is stated,
  so they are repeatable by someone holding the same lawfully retrieved file —
  which is a weaker property than the ledger's, and is recorded as one rather
  than left to be assumed equal.

## What this record does not do

It admits no capability, exposes no control, adds no row to
`EVIDENCED_PROVIDER_BUILDS`, adds no conversion source family, extends no
`PreviewOperation`, changes no argv builder and adds no dependency. It does not
implement XIC, does not start the Post-M6 interlude, does not select a
replacement runtime, and does not build a trace or an export. It does not publish
M6's closure, mark any other exit criterion passed, or start M6.11. **What it
supplies to M6.11 is criterion 11's evidence: four routes, four terminal
dispositions, and the ledger above as their single authority.**
