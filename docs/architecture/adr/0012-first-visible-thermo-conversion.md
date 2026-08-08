# ADR 0012 — The first visible Thermo RAW → mzML conversion

- Status: Accepted for one focused dataset at a time, on one evidenced provider
  build, for one named vendor family; queueing, cancellation, retry and every
  other family separately gated
- Date: 2026-08-07

## Context

[ADR 0011](0011-private-workspace-conversion-path.md) joined the workspace to
the conversion boundary and deliberately stopped there: the path was private,
had no command behind it, and every item on it carried a stated
`expect(dead_code)`. The open gate it recorded was the plain one — *"No surface
exists. Nothing a user can do reaches this path."*

This ADR is that surface, and nothing more than that surface.

## The exact claim

> MSCanvas can admit one evidenced Thermo Scientific RAW regular-file family
> through `Add files…` and convert one focused Thermo RAW workspace row to mzML,
> one at a time, on the exact evidenced ProteoWizard build.

Not: every Thermo RAW file, every ProteoWizard build, all vendor RAW, directory
acquisitions, source-fidelity verification, cancellation, queueing, progress,
overwrite, or output auto-import.

## Decision

### One ingestion surface widens, and only one

`Add files…` admits mzML and the evidenced Thermo family. There is no second
button: a permanent `Add RAW…` beside it would be two doors into one list, and
the user's question is "add this acquisition", not "which reader will open it".

The picker's filter offers `*.mzML;*.raw`. That is candidate filtering and
nothing else — Rust dispatches on the extension only to choose *which admission
runs*, and each admission then decides. A `.raw` whose bytes are not an
acquisition is refused by the signature rule; a name the product does not open
is refused by mzML admission with the error it always had.

Folder discovery and the Explorer drop stay regular-mzML-only. Both walk a tree
the user did not enumerate, and admitting a vendor family from a walk is a wider
claim than admitting one the user named.

The command behind the action is renamed `choose_workspace_files`.
`choose_mzml_files` had become a name that said something false about what it
does, and a registered command's name is read by everyone who audits the
boundary.

### A row says which family it is

`SelectedFileDto` gains a required, closed `sourceKind`. No optional member and
no `unknown`: the one decision that depends on it — whether a row can be
previewed at all — is not a decision to guess.

It is not identity, it is not searched and it is not a sort key. Two rows of
different families are still two rows, and a file admitted twice keeps the
family it was first admitted under.

Rust refuses `open_mzml_preview` for a vendor row with
`dataset_not_previewable`. The disabled button and its visible explanation are
the interface's account of that rule, not the rule.

An automatic first preview reads the first newly added **mzML** row, never
simply the first row. A mixed batch into an empty workspace still costs one
process; a batch of acquisitions costs none.

### Conversion acts on the focused row

Not on the selection. A selection is a set the user built for removing rows;
converting is one acquisition at a time, and an action whose scope changed as
they curated the list would be an action they could not predict.

The primary action lives in the conversion panel beside the summary it acts on,
rather than as a sixth roster button. That is partly discoverability — the panel
appears the moment a convertible row is focused — and partly arithmetic: the
roster's `280px` floor is derived from five action buttons wrapping to three
lines, and a sixth would move the floor, the narrow-window budget and four
pinned tests without making the action easier to find.

Moving focus to a vendor row does not disturb an mzML preview already on screen.
The preview and the panel may describe different rows, which is why the roster
keeps `active` and `focused` as different things.

### The destination is Rust's, and must be local

A third native folder picker, titled *"Choose where to save the converted
mzML"*. No path crosses the WebView in either direction.

The chosen folder is admitted before anything is planned or created, and is
refused when it is absent, not a directory, a reparse point, UNC, or on a mapped
or otherwise remote volume.

Remote refusal is admission, not cleanup. ADR 0009's finalization and cleanup
guarantees are local Windows guarantees: finalization takes the destination name
atomically on one volume, and cleanup reclaims staging by opening each entry and
comparing its filesystem identity. Neither survives a redirector that can
reorder, cache or disconnect mid-operation. Refusing early is the difference
between "we will not write there" and "we wrote there and cannot tell you what
state it is in".

Nothing about the choice is remembered.

### Two phases around the picker

`begin_workspace_conversion` binds the document, the row, its request epoch, its
family and the conflict policy, and returns one opaque reservation.
`choose_workspace_conversion_destination` consumes that reservation **before**
dispatching the dialog.

The shape is `begin_mzml_folder_import` / `choose_mzml_folder`'s, for the reason
that one already gives: a webview can reload between any two IPC fetches, so the
reservation is retained in Rust and a document that never receives the
identifier can never open a picker. Both commands prove the calling document
with the per-document authority the drop subscription established — a conversion
reservation is authority over a picker and over a file this application creates,
so it is bound as tightly.

The reservation carries no path, no filesystem identity, no backend generation
and no internal epoch. A cancelled picker is an ordinary no-op: nothing is
created, the slot returns to idle, and no counter rewinds.

### One slot, and it is not a queue

`ConversionSlot` holds `idle | awaitingDestination | running | terminal`, one
report, and a sequence that only advances. A second conversion is refused, not
enqueued. Starting one replaces the previous report rather than accumulating
beside it. There is no member holding a list and no member naming work that has
not started.

State is read, not pushed. The drop subscription's Channel needed a reservation
protocol, a document proof and a replay contract because native drag-and-drop
produces events this side cannot ask for. A conversion has one slot and two
observable transitions, so a read on mount plus a read while something runs is
the whole of what a document needs — and it is what makes reload recovery fall
out rather than being built.

A conversion therefore survives a reload: the reply to the command that started
it goes nowhere, and the answer is in Rust. App restart does not restore it,
because the slot is session state and the file it produced is the durable
artefact.

### Rust enforces the concurrency rules

While a conversion is awaiting a destination or running: `Add files…`, `Add mzML
folder…`, `Clear list` and any new preview are refused with `conversion_busy`; a
native drop is refused at the callback with its own `conversion_busy` reason,
before its paths are retained; and removing the converting row is refused while
every other row stays removable. Search, sort, focus, selection and roster reads
stay available throughout.

The callback path reads a lock-free mirror of the slot's busy flag, because that
path must never wait on a service mutex — the rule this service already keeps
for the drop claim itself.

The converting row stays visible outside a search, with `Converting — outside
search`, above every other pin reason: it is the one state the user cannot act
their way out of.

There is no Cancel button, and the panel says so. This workflow cannot stop a
running `msconvert`, and a control that only stopped watching would be a lie
about what it does. There is no percentage either: nothing measures one.

### The result carries no path

`ConversionReportDto` names the dataset by handle, the output by the file name
the plan derived, and everything else by measurement or stable identifier. A run
that finalized nothing names no output file — reporting the planned name would
name a file that does not exist, or one that does and that this run deliberately
did not touch.

Three terminal answers, never collapsed: a file was produced; a name was
occupied and deliberately left alone; or nothing was written. The skipped answer
says explicitly that the existing file was not inspected.

A finalized result is never called fully verified, and says why in the same
breath.

## Consequences

The registered command surface grows from 13 to 17. The new four are one
read-only description, one read-only state read, and the two halves of the
picker reservation. None accepts a path.

`add_files`, `begin_folder_import`, `clear_workspace` and `remove_datasets`
became fallible. Their refusal is a real product state, and a signature that
could not express it would have pushed the guard into the command layer where
three other callers would have had to remember it.

ADR 0011's deterministic binding gate is closed from both ends: a run given
capability evidence read from `msaccess` cannot express a conversion and is
refused, and a source-contract test pins that the production provider binds
`msconvert` for conversion and `msaccess` for preview, with exactly two bindings
and each naming its own tool.

## Evidence

### Deterministic coverage

Rust: 356 tests, none needing an installation. Frontend: 476, none needing a
WebView. Between them they cover the widened admission and its refusals, the
family on the wire and in a row's accessible name, the preview refusal, the plan
summary, the reservation's single use and document binding, a cancelled picker,
the one-slot refusal, every destination posture, every mutation guard, drop
refusal at the callback, reload recovery, the terminal vocabulary, the path-free
report, and the running state's honesty about cancellation.

### Real end-to-end conversion

Run on the implementation head, through the product path — `add_files`, then the
reservation the destination picker claims — against the evidenced build.

| Fact | Value |
| --- | --- |
| Installed build | release `3.0.26013`, revision `47b13cf`, `msconvert.exe` SHA-256 `9BB6F5D5…D590BD`, verified before the run |
| Acquisition | `FT-HCD-MSX.raw`, upstream commit `8f945db3`, `78,309` bytes, SHA-256 `b3d97b38…dd7b` |
| Admitted as | dataset `file-0`, `thermo_raw`, `78,309` bytes |
| Plan | mzML, `zlib`, output-only |
| Outcome | `finalized` |
| Output | `FT-HCD-MSX.mzML`, `28,655` bytes, SHA-256 `6CE2ACE6…D8648C`, 1 spectrum, 1 chromatogram |
| Destination | exactly one file; no sidecars; no staging residue |
| Validation | `OutputOnly`; 9 verified, 0 unverified, 11 inapplicable; not fully verified |
| Process | exit `0`, `568 ms` |
| Wire | the serialized update names no path — checked against the acquisition's and the destination's own strings |

The acquisition and the output were deleted afterwards. No vendor data is
committed.

## Open gates

- **One acquisition, one build, one family.** Unchanged from ADR 0010. Widening
  any of them is a measurement.
- **No queue, no cancellation, no retry, no persistence.** The next conversion
  work is a serial multi-file queue with per-file failure isolation and retry,
  and cancellation stays out of it until there is evidence that a `msconvert`
  process tree can be terminated cleanly.
- **The native picker is contract-tested, not physically operated.** Its option
  policy, ordering and failure classification have unit coverage; that a modal
  Windows dialog appears is not something this suite can assert.
- **Remote detection is a drive-type answer and a UNC prefix test.** A local
  path that is nevertheless redirected by a filter driver is not detected, and
  nothing here claims it is.
