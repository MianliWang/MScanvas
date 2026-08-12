# ADR 0017: redacted conversion diagnostics export

- **Status:** Accepted. A terminal queue's diagnosable attempts can be saved to
  one local JSON file when the user asks, and never otherwise.
- **Date:** 2026-08-09
- **Builds on:** [ADR 0009](0009-mzml-conversion-execution-boundary.md) (the
  execution boundary and its bounded process capture),
  [ADR 0013](0013-serial-conversion-queue.md) (the serial queue),
  [ADR 0014](0014-proteowizard-cancellation-evidence.md) (cancellation
  evidence), [ADR 0015](0015-user-visible-queue-stop.md) (the queue-level stop)
  and [ADR 0016](0016-explicit-converted-output-adoption.md) (the shape of an
  explicit action on a terminal queue).

## Context

A failed conversion tells the user a stable identifier and a sentence. That is
the right thing on screen — it is what they can act on — and it is not enough to
diagnose with. What would be enough is what `msconvert` itself printed, and that
is precisely what has never been kept.

The reason it has never been kept is not oversight. Backend text names the
acquisition, the folder the user chose, the private staging directory and the
installation. ADR 0009 captures it, uses the exit status, and drops it when the
run returns; `BackendRunFacts` deliberately carries an exit code, a termination
and two truncation flags and nothing else, with a comment saying why.

So the question this ADR answers is not "should diagnostics exist" but "what can
honestly be said, to whom, and with what left out". Every decision below resolves
one tension: the text is what makes a diagnostic useful, and the text is what
makes it dangerous.

## Decision

### The export is explicit, local, and one file

One action on a terminal queue: **Export failure diagnostics…**. It builds one
JSON document, opens a Rust-owned native save dialog, and writes one file where
the user says.

Nothing is uploaded, mailed, posted, or put on a clipboard. No support site is
opened and no ticket is created. The saved file is not opened afterwards, because
opening it would decide what the user is looking at — the objection that makes
adoption explicit in ADR 0016, applied to the same kind of action.

There is no diagnostic history. Tickets are session state, the export result is
one value on one slot, and a new queue drops both. What survives is the file,
which is the user's.

### Only a terminal queue, and only its latest attempts

A running or stopping queue's results are not all in. An item's diagnostic
describes its **latest retained attempt** and no earlier one: a retry that
succeeds takes the failure it replaced with it, and there is no attempt history
to export.

An item is worth diagnosing when its latest settling is one of:

- an ordinary failure, whether the conversion boundary reached one or this
  session refused before it;
- a stop that could not be confirmed;
- any terminal item that left staging residue behind — including one that
  finalized, because something MSCanvas created is still on the user's disk.

Nothing else. A clean finalization, a skip, a confirmed cancellation and an item
a stopped queue never began have nothing to diagnose, and a queue made only of
those exposes no action at all rather than a disabled one.

A queue whose own stop could not be confirmed is exportable even where no item
carries a ticket. What that queue records about *itself* — that MSCanvas cannot
say whether a converter process survived — is the diagnosis, and it belongs to
the queue rather than to any item.

### Redaction happens before the queue retains anything

The excerpt is built inside `run_staged`, while the plan, the staging area and
the executable are still in scope, and the captured bytes go out of scope with
the run that made them. Nothing downstream holds raw process output, and nothing
downstream could redact it if it did: by then the paths are gone.

This is the load-bearing decision. Every alternative — keeping the bytes on the
queue, redacting at export time, redacting in the transfer layer — moves the
unredacted text somewhere it has to be trusted, and the trust would be misplaced
because the information needed to redact it no longer exists there.

### Exact tokens, then shape, and fail closed

Two mechanisms, composed, because neither is sufficient.

`Redactor` knows *particular* paths and removes every spelling it can obtain:
the acquisition's canonical and plain forms, the destination root, the staging
root and its output directory, the executable and the folder above it, the
temporary directory, and the user profile. Case, separators, dot segments,
extended-length prefixes, UNC forms and Windows short and long names are all
covered by the existing reviewed implementation, extended here only to count what
it replaced.

`absolute_path_start` knows none of them and recognises the *shape* of an
absolute path: drive-rooted, UNC, `\\?\`, `\\.\`, `file:` URLs and POSIX roots.
It already existed as the preview boundary's general path scrubber; it moves into
the conversion crate so there is one owner of the rule rather than two that can
drift, and the preview DTO now delegates to it with its behaviour unchanged.

After exact-token redaction, the shape test runs on exactly the string that would
be written. If anything still looks like an absolute local path, **the whole
excerpt is withheld** and a stable reason — `residual_absolute_path` — is exported
in its place. A suppressed excerpt costs a diagnosis; a leaked one costs the user
something they cannot take back.

One false positive is forgiven, and only one. Replacing a directory root leaves
its remainder behind — `<destination>\run.mzML` — and a remainder begins with a
separator, which by shape alone is a UNC or POSIX root. A separator directly
after a placeholder is therefore read as the tail of something already removed
and the scan continues past it. A drive letter or a `file:` URL after a
placeholder is *not* a tail and still withholds the excerpt. Without this
exemption almost every excerpt naming an output would be suppressed and the
feature would do nothing; with it broader than a separator, a leak would pass.

**Where the shape test stops.** One separator between two bare words with no
dot — `source/private` concatenated straight onto a label, at the root of a
volume — is the same shape as `m/z`, in every feature available at this level.
`m/z` is in nearly every line `msconvert` prints, so anything strict enough to
withhold the first withholds the second, and with it the excerpt for the whole
queue. That residual is therefore not removed, and it is one of the things the
review-before-sharing warning exists to cover. A test pins the trade from both
ends so that changing either is a decision rather than a passing suite.

The cost runs the other way too, and is also real: a line carrying two unit
tokens is two separators, and two separators is what catches
`source/home/alice`. Such a line loses its excerpt. Every structured fact,
count and identifier stays.

**Two separators in one line is a tree.** Every rule above begins at a
boundary, because a boundary is what tells a root from `m/z`. Backend text does
not always give one: a label concatenated with a path — `source/home/alice/run.raw`
— puts every separator after an alphanumeric where no boundary rule can see it.
The drive-letter form escapes the same way and is caught by the separator after
its colon; POSIX and UNC forms have no colon. So the excerpt also counts, and
two separators of any kind in one line withholds it.

This one is deliberately *not* the shared shape test's business. That test
decides what a screen hides, where losing a line of an acquisition's own
metadata to `m/z … counts/second` would be a poor trade. This decides what a
file the user may send onward keeps, where it is the right one. A remainder the
redactor left behind is set aside before counting, or every excerpt naming an
output would go.

**A remainder is one name, never a tree.** A single component after a
placeholder is a filename, which the schema already exports as a display fact;
two or more is directory structure that survived because a *less specific*
token matched the root while the more specific one missed. That is measured
between one placeholder and the next rather than to the end of the line, so a
line naming two redacted paths is two remainders rather than one long one.

This half of the rule was added because CI caught it, not because it was
foreseen. Windows spells a path with some components short and others long,
and a machine whose profile carries an 8.3 name does so routinely; on such a
runner the acquisition's own registration missed while the temporary root's
still matched, leaving the folders between them sitting after a placeholder.
No token this boundary can obtain in advance covers that hybrid — which is the
entire reason the shape test exists, and the entire reason it has to be the
stricter of the two. The cost is that such a machine loses the excerpt; that
is the trade this ADR takes everywhere else and it is not weakened here.

### Text is bytes

A stream is not guaranteed UTF-8 and is not guaranteed printable. Decoding is
lossy and **says so**; NUL, escape sequences and every other C0 control except
`\n`, `\r` and `\t` become the replacement character before anything else
touches the text. Backend text is never interpreted as HTML or Markdown
anywhere.

Each excerpt carries the truthful facts about its stream whether or not the text
survived: total bytes, bytes the process boundary captured, whether *that* limit
truncated it, whether *this* bound truncated it, how many replacements were made,
and whether it was withheld. The two truncation flags are separate because they
are two different limits and a reader deciding which one to raise needs to know
which was reached.

### Bounds

```text
MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES = 32 KiB   (per stream, encoded UTF-8)
MAX_DIAGNOSTIC_ITEMS                = MAX_CONVERSION_QUEUE_ITEMS (16)
MAX_DIAGNOSTIC_EXPORT_BYTES         = 2 MiB    (the whole document)
```

The stream bound applies after decoding and redaction, to the text as it will be
written: what a bound on a file has to promise is about the file, and redaction
changes the length of everything it touches. It is far below the process
boundary's own 8 MiB capture limit, which exists so a run holds a whole
conversation in memory rather than so a person can read one. **The capture limit
is not raised to enlarge the export.**

The item bound is the queue's own capacity, so it is structural rather than a
second number to keep in step.

The document is serialized to memory and measured whole, including its trailing
newline, before anything is opened or created. A document over the bound is
refused with `diagnostics_too_large` and writes nothing. Half a JSON document is
not a smaller diagnostics file; it is one no reader can open, offered in exchange
for hiding the fact that the bound was reached.

What the export carries is the **prefix** of each stream, because that is what
the process boundary keeps. The schema says `"retained": "prefix"` rather than
leaving a reader to infer it, and says `"none"` where no stream was retained at
all — a backend that printed nothing and an attempt that never launched one are
different facts.

### One versioned schema, written by hand

```json
{
  "schema": "mscanvas.conversion-diagnostics",
  "version": 1,
  "application": { "name": "MSCanvas", "version": "…" },
  "queue": { "operationId": "…", "terminalReason": "…", "…": "counts" },
  "provider": { "release": "…", "buildDate": "…", "sourceRevision": "…",
                "executableSha256": "…", "installationGeneration": 0 },
  "items": [ { "queueIndex": 0, "…": "safe facts", "stdout": {}, "stderr": {} } ],
  "redaction": { "schema": "mscanvas.path-redaction", "version": 1,
                 "replacementCount": 0, "suppressedExcerptCount": 0,
                 "warning": "…" }
}
```

Everything in it is a display name, a measurement, a closed enumeration or a
stable identifier. Items are in queue order; field order is fixed by the code
that writes it, so two exports of one unchanged queue are byte-identical rather
than merely equivalent.

Serialized by hand rather than through a format crate. Nothing in this
application's production dependencies renders JSON — `serde` describes shapes and
a format crate would have to be added — and adding a dependency to write two
hundred bytes of structure would be the wrong trade. Writing it out also buys the
deterministic ordering and puts every string through one escaper.

The provider section says which build produced the failure and never where it is
installed. The source revision is carried on the installation identity rather
than re-probed; the executable path and installation folder are never exported.

A release, a build date and a revision are read out of the installed tool's own
help text, which makes them backend text like any other. They go through the
same bounding and shape scrubbing the backend label on screen already gets, so a
build that printed a path in its version line cannot put one into a file that
promises none.

The redaction section says how many replacements were made and how many excerpts
were withheld. It does **not** list what was replaced: a manifest of removed
values is the removed values.

### The warning, stated twice

> Known filesystem paths and internal identifiers are removed, but backend text
> may still contain acquisition metadata. Review the file before sharing.

Beside the action, and again inside the file. The two are read at different
moments by possibly different people: the one who exports it and the one who is
about to be sent it.

MSCanvas does not claim the file is anonymous, does not claim it is safe to
publish unreviewed, and does not claim that redaction removes every scientific or
personal datum. Backend text is written by an instrument's software about a real
acquisition; no amount of path removal changes that.

### A Rust-owned save dialog, and a no-clobber write

The dialog is `GetSaveFileNameW` through the same `comdlg32` entry point and the
same `OPENFILENAMEW` the acquisition picker already uses — one struct, one set of
flags, one way of telling cancellation from failure — titled **Save conversion
diagnostics**, defaulting to `mscanvas-conversion-diagnostics.json`, filtered to
`*.json`. No save path crosses the webview boundary in either direction.

Deliberately *without* the shell's overwrite prompt. That prompt asks whether to
replace an existing file, and this boundary will not replace one — so answering
yes would lead to a refusal, and the shell would have offered something MSCanvas
does not do. The product rule is no implicit output overwrite, and a dialog that
implies otherwise is that rule being weakened in the one place a user is looking.
An occupied name is answered by a refusal that says so and names the recovery.

It follows the existing two-phase pattern exactly: a reservation is issued
synchronously and bound to the document, the terminal queue and which settling of
it, and is consumed before the dialog is dispatched. A document that never
receives the identifier can never open one; a replaced document's reservation is
released; a reservation cannot be claimed twice.

The folder goes through the same admission a conversion destination does, which
refuses UNC, mapped and otherwise remote volumes, reparse points and
non-directories — because the guarantees below are local Windows guarantees.

The write itself is the shape finalization already uses, extended with the half
this crate never had. A private sibling is created exclusively, filled, flushed
and synced, then **renamed by handle** to the chosen name with `ReplaceIfExists`
false. So the object published is the object written, an occupied name is a
refusal rather than a loss, and nothing is ever written to the selected name
directly. A failure anywhere removes the sibling through the handle that made it,
and a removal that fails is reported *beside* the primary failure rather than
folded into it.

A success answers with a basename, a byte length, a SHA-256 and an item count.
The digest is what makes the answer checkable by someone about to send the file
on. The containing directory is never returned.

### Everything a reader can see shares one ordering key

The diagnostics state rides on the conversion read, so it shares that read's
sequence — and a document installs a read only when the sequence has moved. Every
transition that changes what a reader can see therefore advances it: asking for
an export, finishing one, and releasing one however it ended.

A transition that did not would be a transition no document ever applies. The
export would appear to run for ever, and retry, adoption and every workspace
mutation would stay closed until a reload. It advances only on a real change,
because a page load releases a reservation that usually is not there and every
reload would otherwise look like a transition.

Reserving also takes the workspace mutation gate a retry and an adoption take.
Those two check that no export is in flight and *then* wait for the conversion
lock; an export that claimed the slot inside that window would leave a retry
starting anyway, against the very results a save dialog was about to describe.
One gate over all three is what makes the check they already make sound.

### Nothing of the document crosses IPC

The webview learns four things: whether an export is available, how many items it
would describe, whether one is under way, and what the last one wrote. It never
receives the document, an excerpt, an error detail from a stream, or any path.

Refusals are stable and path-free: `diagnostics_unavailable`,
`invalid_diagnostics_reservation`, `diagnostics_export_in_progress`,
`diagnostics_export_superseded`, `diagnostics_destination_unusable`,
`diagnostics_destination_exists`, `diagnostics_not_written`,
`diagnostics_not_finalized`, `diagnostics_too_large`,
`diagnostics_picker_unavailable`.

`diagnostics_unavailable` collapses a stale document, an unknown or superseded
operation, a queue still under way and a queue with nothing to describe, for the
reason `outputs_not_adoptable` collapses its own set: telling them apart would
describe session state to a caller that by construction is not the one holding
it.

### Retry, adoption, stop and quarantine

An export and an adoption are the two actions that own a terminal queue. Both
only read it, and Rust runs one at a time — an adoption commits under the
workspace gate and an export can be sitting in a modal dialog, so overlapping
them would hold that gate for as long as a user takes to choose a folder. Either
may be done first, and doing one does not consume the other.

While an export is between being asked for and being finished, Rust refuses
`Retry failed`, adoption, a new queue, `Add files…`, `Add mzML folder`, an
Explorer drop, `Remove selected`, `Clear list` and a second export. Roster reads,
search, sort, focus, selection and an already-open preview stay available.
Disabled controls are a projection of those rules, never the rules.

An export takes no backend gate and launches no process, so backend quarantine
does not block it — and that session is the one that most needs it. Exporting
does not clear the quarantine either.

Nothing an export does changes an item's outcome, its retryability, the queue's
completion reason, adoption eligibility or the workspace. A cancelled dialog and
a failed write both leave the queue exactly as they found it.

### Reload

Diagnostic tickets are Rust session state and survive a webview reload with the
terminal queue, so the action is offered again to the replacement document.

Both halves of what a dialog answers with — a chosen file and a cancellation —
name the reservation, and nothing weaker. Two dialogs for one terminal queue
carry the same operation and the same settling, so neither of those tells an
abandoned window from a live one; only the identifier does, because exactly one
was ever issued for each. Without it a reload could leave the old window on
screen, the replacement could open its own, and the old one answering first
would consume the replacement's reservation — cancelling it, or worse, writing
the file to somewhere that user never chose.

Which queue and which settling a write is about are *answered with* by the slot
rather than carried by the caller, so there is one place they come from and no
caller can pair a reservation with a round it does not belong to.

A reservation is released on document replacement whether or not its dialog has
been claimed, exactly as a conversion destination reservation is. The
replacement never learns the identifier, so a reservation left alive would keep
the slot busy for the rest of the session on the strength of a dialog no
document is waiting for. The consequence is stated rather than hidden: a save
dialog belonging to a replaced document may still be on screen, and whatever it
answers with is dropped — nothing is written, no partial file exists, and the
replacement is offered the export again.

An export that is **already writing** completes. Its result is stored on the slot
and read by the replacement document on mount, which is the smaller of the two
possible rules: the alternative — detecting supersession before finalization and
removing the temporary — would mean threading a cancellation signal through the
writer for a window measured in milliseconds, and would leave the user with
neither a file nor an explanation. Nothing is retried automatically after a
reload.

Tickets do not survive a restart. After one, the queue is gone and there is
nothing to describe.

## Consequences

- The conversion boundary now retains something derived from process output for
  the first time. It is bounded, redacted, opaque in `Debug`, unserialized, and
  reachable only through the queue item that owns it.
- The general absolute-path shape test has one owner instead of two. The preview
  DTO's scrubber and this export's suppression now agree by construction.
- The crate gains a general safe-small-file writer. It is used by one caller
  today and is the primitive any future local artifact should use.
- The installation identity gains the ProteoWizard source revision, so the export
  can name a build without re-probing one.
- Two commands, following the reservation-then-dialog pattern the destination
  picker established.

## Alternatives considered

**Keeping raw streams on the queue and redacting at export.** Rejected, and it is
the decision this ADR exists to make. By export time the plan, the staging area
and the executable are gone, so the redaction would be shape-based only — and a
shape test alone cannot remove a path it does not recognise.

**Registering more spellings instead of tightening the shape rule.** Rejected
as a *replacement* for it. More tokens is always worth having and this boundary
registers every one it can obtain, but the set can never be complete: a backend
prints paths nobody handed this process, and Windows offers spellings — hybrid
short and long components among them — that no lookup enumerates. A rule that
depended on the token list being complete would fail open on exactly the
machines least like the one it was written on.

**Replacing residual absolute paths instead of withholding the excerpt.** Rejected
for this file. The preview DTO replaces to end of line because it is showing a
document's own metadata on screen, where losing a line's tail is the cost of
being readable. A file the user may send to someone else is a different risk, and
the honest answer to "this still looks like a path" is to say so and keep quiet.

**Truncating an oversized document.** Rejected. It produces a file no reader can
open while hiding the fact that the bound was reached.

**Adding a JSON dependency.** Rejected under the dependency policy for two
hundred bytes of structure, and it would have cost the deterministic field order
that makes two exports comparable.

**Automatic upload, a support form, or copying to the clipboard.** Rejected.
Every one of them moves the file somewhere before it has been reviewed, which is
the one thing the warning exists to prevent.

**A persistent diagnostics log.** Rejected. It is a job system's feature, it
accumulates exactly the text this ADR spends its length bounding, and nothing in
this workflow reads a second entry.


## Amendment, 2026-08-12 — one source is still one diagnostic item

[ADR 0026](0026-private-sciex-serial-queue-integration.md) put an acquisition
that produces up to twenty-four documents into the queue. It is **one**
diagnostic item, so the sixteen-item bound and the arithmetic behind the 2 MiB
whole-export bound are unchanged, as are the 32 KiB per-stream excerpt, the
redactor and the no-clobber writer.

An ordinary queue's export is byte-identical to what it was. A set item — which
no shipped build can produce — writes `outputFileName: null` rather than a
fabricated name and gains one additional member, `outputSet`, emitted only for
such an item. That member is counts and stable identifiers: member states, bound
source objects, the completeness identifier, the partial-finalization counts and
the filesystem's own error kind. **No member basename appears anywhere**, because
the backend derives those from sample identifiers inside the acquisition; the
acquisition's own display name is still there, as `sourceFileName`, exactly as
it has been for every family since this export existed.

One real gap was closed at the same time. The workspace group report and its
member facts derived `Debug`, so any log that rendered one printed every member
basename. They are opaque now, and carry those names only through accessors.
