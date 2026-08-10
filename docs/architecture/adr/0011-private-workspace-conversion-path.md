# ADR 0011 — The private path from a workspace dataset to one conversion

- Status: Accepted for one private, surfaceless path; every user-visible
  conversion surface, every queue concern and every other source family
  separately gated
- Date: 2026-08-07
- Amended: 2026-08-07 (M3.1) — the path is no longer private. Both open gates
  below are closed: a surface exists, and the msconvert help binding now has
  deterministic coverage from both ends. See
  [ADR 0012](0012-first-visible-thermo-conversion.md).
- Amended: 2026-08-10 (M3.8) — the coordinator carries a second family. The
  order below is unchanged and is the reason it needed no rewriting: every step
  is expressed over *the family the row was accepted as*, so admitting one more
  meant making the mappings total rather than adding a branch. Shimadzu
  LabSolutions LCD now reaches the same gate, the same staging, the same
  output-only validation and the same report, and reaches them from nothing a
  user can click. The "no second source family" gate below is therefore closed
  for exactly one further family and unchanged for the rest. See
  [ADR 0019](0019-private-shimadzu-workspace-conversion.md).

## Context

Two boundaries existed and did not touch.

[ADR 0006](0006-multi-dataset-workspace-boundary.md) built a session that owns
datasets: a registry keyed by filesystem identity, an accepted file that holds
its object open for as long as a row names it, and an opaque handle that is the
only thing the webview ever receives. Everything it accepts is mzML.

[ADR 0009](0009-mzml-conversion-execution-boundary.md) and
[ADR 0010](0010-first-vendor-raw-source-admission.md) built a conversion
boundary that owns runs: admission by signature, an immutable plan, private
staging, one reviewed execution path, an integrity contract, and — since ADR
0010 — one named vendor family gated on the exact build it was measured on.
Everything it accepts is a path.

A path is not a dataset. The session knows which object the user chose and holds
it; the crate knows how to admit, plan, convert and judge. Neither can convert a
dataset the user has, and the whole risk of connecting them is in the order the
two are touched: a handoff that resolves a handle to a path and hands the path
over would give up every guarantee the session exists to keep, at the exact
moment it matters.

This ADR records that connection, made once, privately, with no surface.

## Decision

One private coordinator, one classification on the dataset, one narrow bridge
across the crate boundary, and the existing gate.

### The session records which family a file was accepted as

`AcceptedFile` gains `DatasetSourceKind`, with exactly two variants: `Mzml` and
`ThermoRaw`. It is decided at acceptance, from the object, and never re-decided
— the same rule the identity beside it already follows.

ADR 0006 forbade this type outright while the only evidence the repository had
was for mzML: *"No type in it may name a vendor format or a directory
acquisition, including as an unconstructed enum variant, because a variant that
exists is a claim that the data behind it is understood. Directory acquisitions
and vendor formats need their own evidence and their own decision."* ADR 0010
recorded that evidence for one family; this is that decision. The condition ADR
0006 set has been met rather than waived, and the list is short for the same
reason it was empty.

It is a field on the accepted file rather than a second map beside the registry.
A parallel map would let a dataset exist in one and not the other, and the state
where a row has no family is exactly the state this exists to prevent.

### Every use of a dataset re-applies the rule it was accepted under

`revalidate` dispatches on the recorded family. A vendor acquisition is
re-admitted by its signature, never by its extension.

This is not tidiness. mzML acceptance is an extension test; running it over a
dataset that was admitted by signature would accept a file whose bytes had
stopped being an acquisition, on the strength of its name. The measured
consequence is in the test suite: a `.raw` file rewritten to something no reader
recognises is refused at revalidation, and the same file passes if the dispatch
is removed.

### Vendor recognition is not reimplemented

`accept_thermo_raw_file` calls `ConversionSource::open_thermo_raw_file` and
treats its answer as the recognition. There is no second signature table, no
second extension filter and no second posture check in the desktop crate.

Two spellings of one rule are two rules the moment either changes, and this rule
is the one ADR 0010 spent a fixture, a download and a real conversion to
establish.

### The handoff is proved on the object, not the name

`ConversionSource` gains `object_identity() -> Option<(u64, [u8; 16])>` — the
volume serial and file id it was admitted with, and nothing else. The session
compares it against the identity its own inspection established and refuses
unless they agree.

The alternative was to make the crate's canonical path broadly public and
compare paths. That is weaker in the way that matters: a path is a name, two
names can resolve to one object and one name can come to resolve to another, and
the session's entire identity discipline exists because of it. It is also
broader — a public path accessor on a conversion source is a path accessor for
every caller forever, and this boundary's rule is that a path never leaves Rust
by accident.

A platform that does not name objects by a volume and a file id answers `None`,
and the session refuses rather than skipping the check. There is no weaker
comparison to fall back to, and proceeding without one would mean the strongest
thing said about a conversion's source is that two strings matched.

### The evidenced-build gate is asked, not copied

`provider_build_is_evidenced` becomes public and the coordinator calls it before
it pins a file or creates anything. `run_conversion` applies the same predicate
regardless, so a caller that skips the question is refused rather than admitted;
what asking early buys is that an unevidenced build costs the user no staging
directory and no process.

The predicate is the crate's own. A second implementation of the same rule at
the call site would be a second rule the moment either changed, and this rule is
a statement about one release, one revision and one executable digest.

### The order the coordinator touches things is the design

Every step is placed against an invariant the preview service already keeps, and
several are correct only where they are:

1. The handle is resolved and the epoch claimed **before** the wait, so a later
   request supersedes this one.
2. The backend gate is taken with **no workspace lock held**. It is waited on
   for as long as a whole conversion takes, and the roster must keep answering
   throughout.
3. The epoch is rechecked **after** the wait. A conversion still queued when the
   user moves on never launches a process.
4. The file is revalidated under its recorded family.
5. The installation is bound and its build checked **before** anything is pinned
   or created.
6. The file is pinned against replacement, and only then re-admitted as a
   conversion source — so the identity comparison in that admission closes the
   window between revalidation and the pin, and closes it *before an output
   could exist*. A comparison made after the run could not: it would be
   reporting on a file that had already been written.
7. The installation is recorded **under the gate**, and the run is stamped with
   the value that observation leaves behind rather than the one it found on the
   way in — the same rule an open follows, and for the same reason: an open that
   resolved a backend nothing had seen yet and kept it to itself would leave the
   sequence naming the installation before it. The gate guard carries the
   generation it was taken at precisely so that reading one after the guard is
   dropped does not compile.

Nothing is recorded against the dataset. A conversion reads it and writes
elsewhere, so there is no per-dataset state to commit.

### It claims a request without discarding the preview

`begin_reading_request` claims the dataset's epoch and hands back its file, and
deliberately does not clear what the previous open recorded. Clearing is right
for an open, which replaces the preview on screen; it is wrong for a read whose
product lands somewhere else, and would make a conversion behave like a reload
that never finished.

### One gate, one lane

The conversion takes the existing `backend_gate`. Preview and conversion
serialize through it, in both directions, and the suite proves both: a
conversion waiting behind a parked preview has created nothing, and a preview
waiting behind a parked conversion has asked the backend for nothing. There is
no second backend lane, no queue, no cancellation and no progress.

### The provider seam gains one method, and it fails closed

`PreviewProvider::conversion_backend` returns the capability evidence, the
installation identity and the process runner as one binding.

It is not a `PreviewOperation`. Folding it into that enum would enrol it in
`required_operations`, which decides whether an installation is reported
available at all — so an installation that could preview perfectly well would
stop being usable because it could not convert.

The three answers come back together because they must describe one binding.
Capabilities read from one resolution, an identity from another and a runner
belonging to neither would let a conversion be gated on the evidence of a build
it did not run on.

The default implementation refuses. A provider that has not been taught to
convert must say so; the alternative — inheriting some other provider's backend
— is how a test double ends up launching a real process.

Capabilities are read from `msconvert`, not from `msaccess`. They are separate
executables with separate option grammars, and the build evidence a conversion
is gated on is a statement about that one.

### The result carries no path

`WorkspaceConversionReport` names the dataset by its handle, the output by the
file name the plan derived, and everything else by measurement: byte length,
digest, observed record counts, the validation mode, the three property sets,
bounded process facts, staging residue, and the installation sequence. The
caller chose the destination root and already knows it.

A report exists for a refused conversion as well as a finalized one. Collapsing
"the destination name was already taken", "this build has no evidence for this
family" and "the output failed the integrity contract" into one error would lose
three different answers. A run that finalized nothing names no output file,
planned or otherwise — reporting the planned name would name a file that does
not exist, or worse, one that does and that this run deliberately did not touch.

## What this deliberately does not do

- **No surface.** No Tauri command, no transfer object, no capability, no
  frontend code, no button, no menu action, no output-folder picker. The
  registered command list is byte-for-byte what it was.
- **No widening of ingestion.** The picker, folder discovery and the Explorer
  drop remain mzML-only, and the suite asserts it directly: a Thermo acquisition
  offered to any of them is refused as an unsupported extension.
- **No queue, cancellation, progress, retry or persistence.** *The queue and
  retry are closed above this path by
  [ADR 0013](0013-serial-conversion-queue.md); this path is still what one item
  of that queue runs through, one plan at a time. Cancellation, a progress
  percentage and persistence remain open on the same terms.*
- **No second source family.** *Closed for one further family by
  [ADR 0019](0019-private-shimadzu-workspace-conversion.md): Shimadzu
  LabSolutions LCD is evidenced by
  [ADR 0018](0018-shimadzu-labsolutions-lcd-source-admission.md) and admitted
  here privately.* Bruker, Waters, SCIEX WIFF and directory acquisitions remain
  where ADR 0010 and ADR 0018 left them: unevidenced or refused, and unnamed.

## Consequences

The path is compiled into the shipped binary and is unreachable from it. Every
item on it carries a stated `expect(dead_code)` under `cfg(not(test))` pointing
here. This is deliberate and is the cost of landing the join before the surface:
it is not test-only logic — the tests exercise this implementation rather than a
stand-in — but it has no caller until a slice adds one.

`mscanvas-proteowizard` gains a `test-support` feature, off by default, enabled
only as a dev-dependency of the desktop crate. It exposes one constructor that
builds capability evidence from help text no discovery probe bound to an
executable.

This was not a free choice. The coordinator takes capability evidence by value,
and every production route to one runs a real executable — so without it, no
deterministic test of this path could exist at all, and the alternative was a
suite that needed a local ProteoWizard. Widening the constructor to an ordinary
public one was rejected: it would make forged evidence reachable from the
shipped binary, which is precisely what the build gate above it exists to
prevent. No dependency and no lock file changed.

Keeping it out of a shipped build is enforced twice, because declaring a feature
is not by itself a barrier. `cargo build --all-features` turns on every feature a
manifest declares, and Cargo offers no way to exempt one — so a manifest
convention alone would have left the claim false and the gate reachable.

- `scripts/check_repo.py` refuses any manifest that enables `test-support`
  outside `[dev-dependencies]`, because that change is a one-word edit.
- The crate itself refuses to compile with the feature on in an optimized build.
  That is the only property distinguishing a build users receive, and it catches
  `--all-features` exactly where a manifest rule cannot: a test build keeps the
  constructor, and an optimized build carrying it fails to compile rather than
  shipping a way around the gate.

`cargo tree -e features,no-dev` shows the feature absent from the desktop's
normal build graph and present only in its test graph; `cargo check
--features test-support --release` fails, and both other combinations succeed.

## Evidence

### Deterministic coverage

Twenty-seven tests, all against a substituted backend, none needing an
installation. They cover the whole vertical for both families, every refusal in
the order above, both directions of gate contention, the workspace answering
during a run, supersession, the replacement hold, and the report carrying no
path. A twenty-eighth is `#[ignore]`d and is the real end-to-end run below.

### Mutations

Ten mutations of the load-bearing decisions were applied one at a time and the
suite re-run. All ten were refused.

| # | Mutation | Refused by |
| --- | --- | --- |
| 1 | Revalidation ignores the recorded family | the vendor family-change test, and every vendor conversion test |
| 2 | The two admissions are not proved to name one object | the handoff identity test |
| 3 | Admission accepts a vendor acquisition on its extension alone | both misnaming tests |
| 4 | The coordinator never asks whether the build is evidenced | both build-gate tests |
| 5 | The coordinator runs without taking the backend gate | the supersession test |
| 6 | The coordinator never rechecks whether the request is current | the supersession test |
| 7 | The coordinator clears the preview of the dataset it converts | the preview-preserved test |
| 8 | The source is not held against replacement | the source-in-use test |
| 9 | A vendor family is planned as an open format | both build-gate tests |
| 10 | A run that finalized nothing still reports an output name | three refusal tests |

Mutation 8 initially survived, and the reason is worth recording rather than
hiding: the crate pins the source for itself during a run and compares its
identity at admission, so most of what the session's hold prevents is
independently refused a layer down. What the hold uniquely decides is the case
where another program holds the file open for writing — an acquisition that is
not finished — and that is what the test added for it establishes. The hold is
kept: defence in depth here is one identity comparison away from being the only
thing standing between a swapped file and a converted one.

### Real end-to-end conversion

Run on the exact implementation head, on the evidenced build, beginning from a
workspace dataset handle rather than from any harness.

| Fact | Value |
| --- | --- |
| Acquisition | `FT-HCD-MSX.raw`, upstream commit `8f945db3`, `78,309` bytes, SHA-256 `b3d97b38…dd7b` |
| Installed build | release `3.0.26013`, revision `47b13cf`, `msconvert.exe` SHA-256 `9BB6F5D5…D590BD` — the evidenced row, verified before the run |
| Entered as | dataset handle `file-0`, admitted byte length `78,309` |
| Outcome | `finalized` |
| Output | `FT-HCD-MSX.mzML`, `28,655` bytes, SHA-256 `6CE2ACE6…D8648C`, 1 spectrum, 1 chromatogram |
| Destination contents | exactly one file; no sidecars |
| Validation | `OutputOnly`; 9 verified, 0 unverified, 11 inapplicable; not fully verified |
| Process | exit `0`, `663 ms`, peak job memory `35,098,624` bytes |
| Staging residue | none |

The output digest and byte length are recorded as observed once, not as stable
facts — ADR 0010 already established that a backend's serialization is its own
business. What is stable is the shape: one file, output-only validation, and a
run that is never reported as fully verified because the source was never read
as mzML.

The acquisition, the output and the destination were deleted after the run. No
vendor data is committed.

## Open gates

- **No surface exists.** Nothing a user can do reaches this path. The next
  conversion work is the first visible single-dataset vertical slice, and it is
  a separate decision with its own scope.
- **The msconvert help binding is untested against a real installation in the
  desktop suite.** Every deterministic test substitutes the provider, so
  `bind_help_of(Msconvert)` is exercised only by the ignored end-to-end test. A
  mutation swapping it for `Msaccess` would not be refused by the deterministic
  suite.
- **One acquisition, one build.** The evidence remains what ADR 0010 made it:
  one file of one family converted on one build. Widening is a measured row, not
  a relaxed check.
- **Vendor libraries are still never opened by this repository.** The gate binds
  to the `msconvert` executable's digest and says nothing about the vendor DLLs
  beside it. ADR 0010 left this open and it stays open.
