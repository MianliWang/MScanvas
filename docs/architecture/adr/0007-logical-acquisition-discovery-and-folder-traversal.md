# ADR 0007 — Logical acquisition discovery and folder traversal

- Status: Accepted for the private mzML folder-discovery foundation; the visible
  `Add mzML folder…` workflow and directory-formatted acquisitions are
  separately gated
- Date: 2026-07-31

## Context

The feature catalogue asks for folder ingestion — "discover logical acquisition
roots without descending inside recognized directory datasets" — while ADR 0006
says the registry accepts mzML regular files and that "no type in it may name a
vendor format or a directory acquisition, including as an unconstructed enum
variant". Both cannot be satisfied at once: recognising a directory acquisition
in order to stop at it is exactly the claim ADR 0006 refuses to let a type make
without evidence.

This ADR reconciles them by narrowing what M1.4 claims rather than by widening
what the registry believes. It also settles the part of folder ingestion that
has nothing to do with formats and everything to do with authority: a folder is
a boundary the user drew, and a traversal that leaves it has read data nobody
authorised.

Two facts drove the decisions below, and both were measured rather than assumed.
A directory junction can be created on Windows by an ordinary user with no
elevation. And a path that traverses one still begins with the chosen root, so a
canonical-path prefix test answers "inside" for a file that is not.

## Scope

M1.4.0 discovers regular `.mzML` files under one explicitly chosen local Windows
folder. It adds no command, no transfer object, no picker and no interface: the
engine is private to the preview module and nothing in the product can reach it.

Out of scope here, each for its own reason: vendor formats and
directory-formatted acquisitions (no evidence), Explorer drag-and-drop (a
different authority boundary), persistence (ADR 0006 excludes it), and any
backend work at all (discovery never asks ProteoWizard anything).

## Definition of a logical acquisition root

For M1.4.0 a supported logical acquisition root is still one regular mzML file.
A folder is a container of candidate roots; it is not itself an acquisition.

Discovery classifies what it meets — a supported file, an ordinary file, a
traversable directory, a reparse entry, an inaccessible entry — and that
classification is private to the traversal. It never enters the registry, never
becomes a dataset kind and is never serialised. The registry after this slice
accepts exactly what it accepted before.

## Directory acquisitions

Recognise none.

Suffix-only recognition is rejected outright, and not as a matter of taste. A
false positive skips an ordinary folder and hides every mzML file inside it; a
false negative descends into an acquisition and offers its internal files as
independent datasets. Both are silent, and both are scientific errors rather
than interface ones.

Before any family may be recognised, this repository requires: a representative
directory structure; a lawful source for it; whether the root is a directory on
Windows at all; marker evidence beyond the suffix; case behaviour; nested
behaviour; whether the same suffix can name an ordinary directory; whether
ProteoWizard accepts the root directly; whether preview and conversion support
it; how a directory's filesystem identity is captured; how an identity lease
would work on one; how change detection would work; and what a roster row's kind
and readiness could then truthfully say. The M0 spike recorded vendor RAW
coverage as not run, so none of this is available today.

## Root authority and containment

The chosen folder is an authority boundary. The user chose one root, not every
place a junction can point.

- A root that is itself a reparse point is refused before anything is
  enumerated.
- A root on a remote or mapped network drive is refused, because identity,
  leases and consistency on one are unverified here.
- A child entry carrying `FILE_ATTRIBUTE_REPARSE_POINT` is not followed, not
  descended into, not offered as a candidate, and counted.
- No link target is resolved at any point.

Containment is established by refusing reparse entries on the way down, not by
comparing canonical paths. A canonical-path prefix test is not containment
evidence: measured on this machine, a naive walk reached a file physically
outside the chosen folder through an unelevated junction while the path string
still began with that folder.

## Reparse points, links and junctions

Every reparse tag is unsupported in this slice. That deliberately includes cloud
placeholders and WOF- or deduplication-backed files, which are ordinary readable
regular files carrying the same attribute. No tag allowlist is introduced here,
because reading a tag correctly is its own evidence question and getting it
wrong silently admits a link.

The cost is real and must not be hidden: a folder synchronised by a cloud client
may yield few candidates or none. A discovery that skipped reparse entries is
therefore incomplete by construction, the count is kept, and the visible slice
must say the scan was incomplete rather than report an empty folder.

## Traversal order

Depth-first, with the files of a level before that level's subdirectories, each
group ordered by the UTF-16 code-unit ordinal of the entry name and the full
relative path as the final tie-break. The root is depth 0.

The ordering is deliberately ordinal rather than locale-aware, for the same
reason M1.3 compares search text with a locale-independent lower-casing: which
files a user gets, and in what order, must not depend on where the machine
thinks it is. It is not Explorer's order and does not try to be; it is a stable
application contract, and repeated scans of an unchanged tree return the same
sequence.

Filesystem enumeration order is not a contract and is not used. Measured on
NTFS, a directory whose entries were created in one order enumerated in another,
and the result was neither sorted nor ordinal.

This order becomes the candidate order the future folder batch presents to
acceptance, and therefore the registry insertion order of the rows it adds. The
sorting key never crosses the boundary.

## Traversal budgets

The workspace capacity of 1,024 datasets is not a traversal budget: a folder can
hold millions of entries before the thousandth candidate is found.

```text
MAX_DISCOVERY_DEPTH       = 32
MAX_DISCOVERY_ENTRIES     = 200_000
MAX_DISCOVERY_DIRECTORIES = 20_000
MAX_DISCOVERY_CANDIDATES  = 1_024
```

The root counts as one entered directory. Every immediate child an enumeration
returns counts as one inspected entry, counted before it is classified. A
candidate counts once its classification is complete.

Depth is the one limit that does not stop the scan: a child that would sit
deeper than the limit is not entered, the subtree is skipped, and eligible
siblings continue. Exhausting entries, directories or candidates stops the
remaining traversal.

Reaching any limit makes the result incomplete and is recorded as the specific
reason rather than a single boolean. It is not an error: the candidates already
found are kept and remain valid, because nothing has been accepted, leased or
given an identifier yet.

`MAX_DISCOVERY_DETAILS = 3` bounds how many per-item details the visible slice
will show, matching the existing notice cap. It belongs to M1.4.1.

## Hidden, system and inaccessible entries

An ordinary entry is never skipped for being hidden, carrying the System
attribute, beginning with a dot, or resembling a familiar cache or repository
name. The user chose this root explicitly, and skipping by name or by ordinary
attribute would silently omit data that may be exactly what they came for. The
budgets, not a name allowlist, are what bound the cost.

Posture, accessibility, reparse status, extension and the named limits are the
only things that decide traversal.

An inaccessible child or subtree is counted and traversal continues; one
unreadable folder does not discard everything else found. An inaccessible root
is a discovery error, because there is nothing to have found. No path appears in
either.

## Candidate acceptance

Discovery proposes paths. It does not accept them.

The future acceptance phase calls the existing complete `accept_mzml_file`,
unchanged, once per candidate in discovery order. Discovery must not duplicate
canonical acceptance, identity leasing, duplicate detection or capacity
decisions, and it holds no lease of its own: it opens a directory handle while
enumerating that directory and releases it before moving on.

The extension test discovery uses is the same predicate acceptance uses,
extracted rather than reimplemented, so the two can never drift. It is only a
proposal; acceptance remains authoritative and re-decides everything.

Acceptance keeps its existing two-resolution shape — a no-follow handle
establishes posture, length, identity and the lease, and a second resolution
supplies the canonical path, the extension verdict and the display name. This
ADR does not change that and does not claim the window between them is closed.

## Duplicate identity

Unchanged. Duplicates are decided by filesystem identity at acceptance, before
capacity, and no identifier is consumed by a duplicate, a rejection or a full
workspace. Discovery may propose the same file twice only if the filesystem
presents it twice under different names; acceptance answers that as it already
does.

## Same-name display and path privacy

Recursive discovery can find `A\sample.mzML` and `B\sample.mzML`. Both are
different acquisitions and both would render as `sample.mzML`, which is not
enough to choose between them.

The approved future rule is collision-only, chosen-root-relative context: the
relative location is shown only for rows whose final filename collides with
another row's. It is based only on the folder the user chose, never contains a
drive, a UNC root or the chosen root's own name, never contains `..`, is
bounded, and is not persisted.

M1.4.0 retains the relative components privately so that rule remains possible.
It sends nothing: no transfer object changes in this slice, and the relative
form does not cross a boundary until M1.4.1 amends ADR 0006's path privacy
section deliberately.

## Partial success and outcomes

The visible slice will report per-item outcomes for files only — added,
duplicate, rejected — reusing the shapes the file picker already produces.
Directory-level events are aggregate counts, because a per-item directory
outcome is a per-item directory name.

One inaccessible subdirectory does not roll back unrelated additions. A root
that cannot be inspected is a command-level failure that leaves the roster
untouched. A truncated scan is never described as complete, and a scan that
completed and found nothing is not described as a failure.

## Mutation concurrency

For M1.4.1, and not implemented here: scan outside the workspace mutation gate,
snapshot a monotonic workspace mutation generation before scanning, and commit
only if that generation is unchanged. Otherwise return a typed
`import_superseded` and add nothing.

Holding the gate across a recursive scan is rejected. `Clear list` and
`Remove selected` queue on that same gate, so a user who chose the wrong folder
would find the only ways out blocked by the thing they want out of — the exact
condition this repository already refuses for backend reads. Scanning outside
the gate without a generation is rejected too: a scan that began before a
`Clear list` would otherwise repopulate the workspace the user just emptied.

## Cancellation and progress

For M1.4.1: no cancellation task model, no percentage, and a visible
`Scanning folder…` while a scan is outstanding. The budgets are what bound the
worst case. A percentage without a known total is a number the application would
be inventing, and a task/cancellation protocol overlaps the future conversion
queue and needs its own decision.

## Tauri boundary

M1.4.0 adds no command. The engine is private to `preview::discovery`, mounted
privately, and reachable only from within that module.

M1.4.1 will add exactly one command, `choose_mzml_folder`, returning a typed
result. The webview will not supply or receive a path, a parent, a folder
identifier or an ordering key, and the capability set stays empty.

## Platform posture

Windows only. The traversal policy, its ordering, its budgets and its error
model are platform-independent and tested on any host through a fake adapter;
the filesystem adapter that reads real directories is `#[cfg(windows)]`, and on
other platforms the entry point compiles and returns a typed
platform-unavailable error.

This follows the identity lease decision in ADR 0006, which is Windows-only for
the same reason: the guarantee needs a no-following open that this project has
no dependency-free way to make elsewhere. No cross-platform traversal safety is
claimed without CI and evidence.

## Core artifact taxonomy

`crates/core::ArtifactKind::Acquisition` exists and the artifact model describes
it as a vendor RAW or directory dataset. It is a future artifact-domain
taxonomy. It is not a preview-registry dataset kind, not a directory-acquisition
recogniser and not evidence that any format is supported; the desktop
application imports only `BootstrapStatus` from that crate, and the registry
does not use it. It is untouched by this slice.

## Testing obligations

- Traversal policy is tested through a fake adapter, so ordering, budgets,
  cycles, malformed records and adapter failures are deterministic.
- A real Windows filesystem test creates a junction pointing outside the chosen
  root, places an mzML file behind it, and requires that the file is not
  returned and the junction is counted as skipped. It fails loudly if the
  junction cannot be created rather than skipping the claim.
- A junction used as the chosen root is refused.
- Every budget is tested exactly below, exactly at, and one past its limit.
- Repeated scans of an unchanged tree return the same order, and a fake adapter
  returning its entries in different orders produces the same result.
- Formatting a candidate, a result, an entry or an error contains no drive, root
  name, child name, relative path or identity.
- A tree deeper than the configured budget neither overflows the stack nor stops
  its shallower siblings.

## Consequences

Folder discovery becomes possible without any of it being reachable, which is
the point: the traversal boundary is settled and tested before a button depends
on it. The cost is that the milestone delivers nothing a user can see, and the
feature catalogue must say so.

A folder full of cloud placeholders yields little or nothing until a tag
decision is made. That is visible and counted rather than silent, and it is the
honest consequence of refusing every reparse tag rather than guessing at one.

The order a folder adds rows in is this ADR's order, not Explorer's, and users
who expect Explorer's will see a difference.

## Rejected alternatives

- **Canonical path prefix comparison as containment.** It passes for a path
  that traverses a junction, which was measured rather than reasoned about, and
  it adds a second racy name lookup to prove something a posture check already
  proves.
- **Recursive `read_dir` without identity verification.** It follows junctions
  by default, has no cycle bound, and re-resolves the whole path at every level.
- **Undocumented `NtCreateFile` with a root directory handle.** It would close
  the residual name-replacement window, and it is not a documented API this
  project is willing to depend on.
- **A tag allowlist admitting cloud placeholders now.** Reading reparse tags
  correctly is its own evidence question, and being wrong admits a link.
- **Skipping dot-prefixed or hidden directories.** It is a guess about what the
  user meant that silently omits data they explicitly pointed at.
- **Suffix-based directory-acquisition recognition.** A false positive hides
  every file inside an ordinary folder.
- **Holding the workspace mutation gate across a scan.** It blocks the only ways
  out of a mistaken folder choice.
- **Recursion through the call stack.** A deep or adversarial tree decides how
  much stack the application uses.
- **A `truncated: bool`.** Which limit stopped a scan is what tells a user
  whether to narrow the folder or raise nothing at all.

## Follow-up slices

- **M1.4.1** — the visible `Add mzML folder…` workflow: the picker, one command,
  a transfer object, the interface and rendered Windows QA.
- **M1.5** — Explorer drag-and-drop over this same discovery boundary.
- **Later** — evidence-backed directory-acquisition families, behind the gate
  recorded above.
