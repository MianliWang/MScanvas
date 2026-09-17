# M7.5 — Preferences and first-run recovery

Status: **LOCAL IMPLEMENTATION COMPLETE; ACCEPTANCE AND PUBLICATION IN PROGRESS**.
Authorized baseline: `1dfe2ce2e0a1819931996287c7031bbf272ca3a9`.
Baseline tree: `fd930b7827a42c933ce57b1ef2d5873aa1d99891`.

## User task and authorities

Three things a user can do that they could not before. UI preferences survive a
restart. A stored record that cannot be read, or that cannot be written, is
reported accurately and can be recovered from without leaving the application.
And every surface the product delivers reads in English or Simplified Chinese,
including the installed-backend banner and the inspector panel, which were
English in every session until now.

Rust owns where preferences live and what may be in them. The webview sends a
typed field group and receives the committed snapshot; it cannot name a
directory, a file, a key or a prefix, and there is no operation here that takes
one. The store confers no authority: nothing in the record can open a file, bind
a backend, name a destination or restore an operation, because none of those
things is representable in its type.

## The record

One versioned record, in `apps/desktop/src-tauri/src/preferences/record.rs`.

| Field | Domain | Default | Consumer |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | — | validated before any other field is read |
| `appearance.locale` | `en` \| `zh-CN` | `en` | the i18n runtime and `documentElement.lang` |
| `appearance.density` | `comfortable` \| `compact` | `comfortable` | the roster's `data-density` and its row-height estimate |
| `layout.roster` | `automatic` \| `shown` \| `hidden` | `automatic` | the workspace shell's roster panel |
| `layout.details` | `automatic` \| `shown` \| `hidden` | `automatic` | the workspace shell's inspector panel |

The stored document is asserted byte for byte in a test, so a field added
without a decision fails there rather than reaching a profile:

    {"schemaVersion":1,"appearance":{"locale":"en","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"}}

`deny_unknown_fields` applies at every level and every scalar is an enumerated
serde variant, so an unknown field and a value outside its domain are both
refusals rather than data to carry forward. The bound is 16 KiB: judged from the
file's length before anything is parsed, and again at the read, so a file that
grew between the two cannot become an unbounded read.

**Three panel states, not two.** `automatic` is the absence of a choice, so the
responsive default decides; `shown` and `hidden` are choices. Before M7.5 the
narrow-window fold *set* the panel state closed, and with a durable record that
would have published "the user hides the inspector" because the window was
briefly narrow. A breakpoint now moves a session-only suppression and never the
stored request, so widening the window restores what was saved.

**No dimension is stored, and that is a finding rather than an omission.** The
workspace grid gives the roster and the inspector fixed track widths (280px and
245px) and offers no resize affordance, so there is no user-chosen size to
remember. Inventing one would have meant inventing the splitter to set it with.

### What is not representable

No acquisition, backend or destination path. No recent file, dataset id, roster
or membership. No group name. No highlighted or conversion selection, active
source or scan. No search filter or scientific sort. No RT or m/z range, and no
raw numeric draft. No `FigureSpec` or export setting. No conversion intent, plan
or queue. No output manifest. No backend receipt, authority revision or
capability reading. No process state, quarantine or staging deletion authority.
No open dialog, focus claim, undo history or interrupted operation.

A provider folder choice stays session-scoped, as it was: a restart searches
automatically again and obtains fresh authority through the existing discovery.
The offline help says so in both languages.

## Path and write policy

The per-user application-local directory Tauri's path resolver answers, and the
fixed file name `ui-preferences.json` inside it. Application-local rather than
roaming, because this is machine-local interface state: a density that suits one
display is not a setting to carry to another machine. Deliberately not the
executable's directory, the checkout, the process working directory, an
acquisition folder or anywhere a renderer could reach. No absolute path is
published to the webview, written to a message or recorded here.

Publication is a bounded same-directory private sibling named
`.mscanvas-ui-preferences-<pid>-<attempt>.tmp`, opened `CREATE_NEW` with
`DELETE` access and `FILE_SHARE_READ`, filled, flushed and `sync_data`'d, then
given the published name by handle with `SetFileInformationByHandle` and
`FileRenameInfo` with `ReplaceIfExists`. The old file is never removed or
truncated first, so every failing path leaves the last confirmed record where it
was. `DELETE` access is not optional: the kernel will not rename an object
through a handle that could not also remove it, and the first implementation
without it failed every publish.

A link, a directory or a device at the published name is refused rather than
replaced. Only the temporary this operation created is cleaned up, and a cleanup
that fails is reported separately, because "your preferences were not saved" and
"…and there is now a file in your profile MSCanvas could not remove" are
different things to be told.

**What is not claimed.** Durability across a crash or a power loss. The bytes
are flushed and ordered before the replace, which is what makes the published
name mean one whole record or the other; it is not a promise about a machine
losing power mid-replace.

A save is reported as `saved` only after the published record is read back and
equals the record that was written. An uncertain outcome is `failed`
(`notConfirmed`), not saved.

### The root a QA campaign binds

The faults this milestone has to prove — a record this build cannot read, one
from a later schema, one the filesystem refuses to replace — are faults of a
file in a person's own profile, and no test gets to corrupt, lock or delete
that. So the non-default `e2e` build, and only it, resolves the preference root
from `MSCANVAS_E2E_PREFERENCE_ROOT` instead of from the path resolver, and
answers `unavailable` for the whole session when that directory is missing,
relative or not a directory. It never falls back to the per-user profile.

Below the binding nothing is substituted: the same record type, the same
validation, the same bounded temporary, the same handle-bound replace, the same
read-back. It is a different root, not a different store, and no renderer
message carries a path, a key or a file name either way.

Three things keep it out of a shipped build. `scripts/check_repo.py` fails if
any Rust line naming the module, its binder or the variable sits outside the
`cfg` that gates it, or if the name appears in the production frontend at all. A
byte scan of two binaries built from the same tree finds the name once in the
`e2e` build and not at all in an ordinary debug build, which keeps its string
literals. And the campaign refuses to run without a usable binding: the
configuration checks it before a driver is spawned and again for the session
its worker creates, and the spec checks it once more for every application
process it launches — which is what covers a restart, since reloading a session
does not re-run a configuration hook.

## Ordering and lanes

Every write is serialized under the store's own mutex, and the merge base is
read from disk *inside* that lock. So a panel commit and a Settings apply only
ever change the field group they name, and neither can overwrite the other's
newer committed fields. Each accepted publish takes the next revision; the
document keeps the highest it has adopted and drops an answer carrying a lower
one, and each lane also drops any reply that is not its newest outstanding
request. That is the busy/conflict policy: serialize, last accepted wins per
group, revisions order the outcomes. There is no cross-process settings-sync
service.

The store's mutex is its own. It is never taken while the conversion, process or
roster locks are held, so a slow profile volume can delay a preference save and
nothing else. Both commands run their work through `off_the_async_runtime`, as
every other blocking operation here does, and both are bound to the calling
document by the same per-document proof the conversion reservations use — a
registered command is not on its own a restricted one.

## Startup, Settings and layout semantics

Hydration is a distinct bounded state. No default is written before the read
resolves, the Settings editors and the panel toggles are frozen while it is
outstanding, and a late answer is dropped once anything the user did has claimed
the record. A read that fails settles into recoverable defaults with an accurate
explanation — never an indefinite spinner and never an automatic retry loop.

The M7.1 contract is preserved and extended:

- Opening Settings snapshots the applied preferences; edits preview without
  touching disk.
- Cancel, Close and Escape before a save discard the draft, restore the applied
  session state and the opener's focus, and leave disk unchanged.
- Reset changes the draft to the defaults only. Reset then Cancel persists
  nothing. Reset then Apply is saved.
- Apply captures one draft, validates and publishes it, and closes only after
  that exact snapshot is confirmed. While it is in flight the fields, Reset,
  Cancel, Close and Escape are frozen and Apply itself is inert, so a second
  activation cannot dispatch a second write and nothing implies that cancelling
  after dispatch could recall the bytes.
- A failed write keeps the draft and the preview, keeps the last confirmed disk
  state, and offers Retry, Cancel and an explicit **Use for this session**. That
  action claims no write and says that a restart still uses the last saved
  record. It is never a silent fallback.
- Where the store is known unavailable before Apply is pressed, the dialog has
  said so since it opened and Apply applies to the session without dispatching a
  write that is already known to be impossible.

An unusable stored record is reported, left exactly as found, and replaced only
by the confirmed **Reset and replace the saved file** action in Settings.
Nothing about reading, cancelling, a media-query event or an automatic layout
adjustment overwrites it.

The panel toggles remain immediate presentation actions. Each commits only its
own layout fields through the same serialized store. A failed layout save leaves
the arrangement on screen, reports as a status that it will not survive a
restart, and offers a retry; a **Reset layout** action appears whenever there is
something to reset and is reachable with no dataset and no backend. A details
panel asked for while nothing is loaded stays asked for — the request is the
preference, and availability is not.

The preference and i18n owner is one provider above the workspace, and nothing
keys or remounts the workspace or the provider on locale, storage state or
density. Active work, source identity, pending and committed ranges, raw numeric
strings, caret and IME state and in-flight exports survive a locale change, as
they did in M7.1.

## First-run setup and backend recovery

`backendPresentation` turns the existing typed projection into one of seven
named states, from the reading the session already has:

| State | What it claims | Actions |
| --- | --- | --- |
| `checking` | nothing | none |
| `requestFailed` | the call failed, and nothing about an installation | recheck, choose, automatic |
| `staleReading` | nothing as current; the earlier reason survives as history | recheck, choose, automatic |
| `missing` | no installation was found | recheck, choose |
| `unsupported` | something was found and cannot be used | recheck, automatic, choose a different folder |
| `quarantined` | this session lost a process and will start no more | recheck, plus the way out its origin implies |
| `available` | a usable installation, with the build it names | recheck, plus the way out its origin implies |

A failed request is not an absence; a superseded reading presents no verdict, no
release, no build date and no origin as current while keeping the reason it
carried; a quarantined session is kept apart from a verdict about the
installation, because the recovery is a restart of MSCanvas rather than a repair
of ProteoWizard. Every state offers a way back to automatic discovery. No second
backend registry, error-string refresh heuristic, fallback provider, arbitrary
executable chooser or refresh-on-error effect was added, and a locale or
preference change triggers no backend probe.

**Action identity.** Each recovery path carries a stable semantic id —
`recheck`, `choose`, `automatic` — on the control as `data-backend-action`, and
each is keyed by it. The picker's focus return compares that id rather than the
label. A label was never an identity once the interface had two languages: the
same action reads differently in each, and applying a locale mid-request would
have made every action look replaced. The DOM slot a verdict change used to hand
from `Choose folder…` to `Search automatically` cannot be handed over at all
now, and the identity comparison remains behind that. Where the action survives
the request unchanged the keyboard goes back to it — which now includes a picker
that failed to open, because the same action is still there and still means the
same thing. Where it genuinely disappears, the banner announces the change
through its status region and takes nothing.

**Offline setup help** is a disclosure in every banner state, closed to begin
with, needing no network, no dataset and no backend. It says that ProteoWizard
is the user's to install and license and that MSCanvas never downloads, installs
or bundles it; that a folder chosen here lasts for this app session only and the
next start searches automatically again; what each of the three existing
controls does; that the first beta is supported on Windows 11 25H2 x64 and that
other Windows versions and ARM64 are not promised supported; and that a session
without a usable backend can still add, group and organise acquisitions. It is
not a wizard, it gates nothing, and there is no stored "setup complete"
authority.

## Localization and accessibility coverage

Every surface M7.5 delivers or touches is localized in `en` and `zh-CN`, bundled
locally, with no detector and no remote backend. What closed, and what was found
in the process, is in `.tmp/m75-evidence/unit3-localization-inventory.md`; the
shape of it:

- The installed-backend banner and the offline help: about 28 strings, none of
  which existed as resources before.
- The inspector panel: 18 strings. A metadata section's title and lines stay as
  the acquisition spells them; an MS level and a retention time are
  measurements; `Not reported` stays the unreported state rather than becoming a
  zero in either language.
- Seventy-six owned boundary error sentences. `ownedErrorMessage` used to fall
  through to `error.summary`, and every summary is authored in English, so those
  codes had been reaching Chinese sessions in English. The English values are
  the boundary's own words copied exactly.

  Thirteen of the seventy-six were first classified as sentences this build does
  not word and left to the wrapper. They were the wrong side of that line: each
  is fixed copy MSCanvas itself authors in Rust with nothing interpolated into
  it -- a spectrum list disagreeing with a spectrum, a file that changed while
  it was being read, an m/z range a spectrum does not have -- so each now has
  its own resource. The affected-delta review found that misclassification.
- The storage and preference states M7.5 adds: 39 strings.

Eleven boundary codes keep the boundary's own words. Nine interpolate evidence a
paraphrase would lose — a folder, a count, a process detail — and two are test
seams. In a Simplified Chinese session those nine are wrapped in a label that
says they are the boundary's untranslated original, which is the one thing that
explains why they are in English. In an English session there is nothing to
explain, so the words are shown as written: a provenance label there would name
nothing the reader can use and would displace the problem from the start of the
sentence.

This is a declared limit, not a closure: it is listed with reasons in
`ownedErrorMessages.test.ts`, and `check_repo.py` fails if a new boundary code
appears without either a resource or an entry there, or if an entry names a code
that no longer exists.

About forty English strings were also found *in the bundle and unreachable*:
M7.1 moved the roster, the export panel, the viewport controls and three
availability modules onto resource keys and left their inline English behind,
where `noUnusedLocals` being off and an exported constant never being unused
meant nothing could see them. The unread ones are deleted; the one a test still
read carries the resource key instead. `ConversionAvailability`,
`SpectrumSelectionAvailability` and `ConversionNotice` now carry their reason and
not a sentence — they are read by the operation as well, and an operation has no
locale. `noUnusedLocals` and `noUnusedParameters` are on.

Accessibility is covered in `accessibility.test.tsx`, in both locales: label
association and accessible names for both Settings groups; the dialog's name,
description, opening focus, modal scope, Escape and focus return; one
announcement per outcome in the language on screen; real `disabled` and
`aria-busy` on the frozen apply with keyboard activation proved inert; an alert
for a storage problem and a status for a storage fact; the panel toggles'
`aria-expanded` and `aria-controls` and the refused inspector's stated reason;
the layout reset and the unsaved-layout retry reachable by keyboard; the
banner's single reading region with its actions outside it; the recovery
actions' names, order and tab reachability; and the help as a native disclosure
with a named summary.

The Chinese bundle is compared value by value against the English in
`localizationCoverage.test.ts`, so a value copied from English fails with its
own key named. Key parity alone would not have caught any of this.

## Support target

The approved first-beta support target is **Windows 11 25H2 x64**, recorded in
ADR 0047. It is a support target, not evidence of compatibility or installation
qualification. Other Windows versions and ARM64 are not promised supported.
Installed-candidate qualification on the target belongs to M7.6.

## Limits

- No dark theme or appearance system was added. The accepted light appearance is
  unchanged, and scientific figure theme, dimensions and DPI remain figure
  settings rather than application appearance.
- Panel dimensions are inapplicable, as recorded above, not deferred.
- No migration path exists or is needed: no earlier schema was ever published,
  and a later one belongs to the build that wrote it.
- The eleven declared boundary codes above are shown in the boundary's own
  words rather than translated, labelled as untranslated original where the
  reader's language is not the one they are written in.
- jsdom lays nothing out, so clipping, hit-target size, reflow at a constrained
  width, reduced motion and Windows focus are not proved by the unit suites.
  They belong to the browser and native campaigns.
- The frontend store seam in the unit tests is a deterministic fake. It proves
  what the interface does with each answer and is not evidence about disk; disk
  behaviour is proved against the filesystem in
  `apps/desktop/src-tauri/src/preferences/tests.rs` and against a task-owned
  profile root in the native campaign.

## Acceptance

Two isolated read-only reviewers made one full-scope pass each over
storage/authority/lifetime and UI/setup/i18n/accessibility, returning 20
findings and 18 distinct defects, all repaired and pinned. A second pass over
the delta after the native campaign found six more, and they are worth naming
because they were defects in the repairs themselves:

- the localization repair had been applied to the one branch the boundary cannot
  reach — every real projection failure still read in English, because all three
  of those refusals are built without a detail and the branch that localized
  them required one;
- thirteen owned sentences had been classified as copy this build does not word,
  when it words every one of them;
- the untranslated-original wrapper was being used as a failure *title*, where
  in an English session it named nothing the reader could use;
- three refused-candidate notice lines still interpolated the boundary's own
  prose;
- the refused header controls carried their reason only in a tooltip, on
  buttons `disabled` out of the tab order, so a keyboard user was told nothing;
- and the layout reset's focus hand-off fired for pointer activation too,
  moving the keyboard to a control the reader had not touched.

The last two are now one repair: those controls are refused with
`aria-disabled` and stay focusable, so the reason is reachable without a
pointer and a reader who presses the reset keeps their place. The store refuses
the action as well, so the dimming is not the only guard.

Browser acceptance drove production React in real Chrome across 1920×1080,
1366×768, an intermediate window at a 1.5 device pixel ratio and 960×640, in
both languages and both densities, with reduced motion emulated — 8 cases,
33 screenshots. It found three defects, all repaired here: a help disclosure
clipped by its scrollport, fifteen render sites showing a boundary error's own
English words in a Chinese session, and a layout reset that lost the keyboard
when it disabled itself.

The native campaign ran the compiled build on real Windows at 144 DPI
(150 % scaling), CSS viewport 1366×768, against a preference root the campaign
owned rather than the operator's: three launches, each given the foreground by
one temporary topmost, one hit-tested caption click and a restore. Three chains
passed.

- **A record, and a restart that starts on it.** A first run had no file and
  wrote none. One applied choice produced a 126-byte record of exactly the five
  allowed values, requested as the appearance group alone. A panel toggle
  committed only the layout group. A restart — a different process, a different
  window — started on that file and did not rewrite it.
- **The file is left exactly as it is found.** Cancel, Reset-then-Cancel, a
  publish the filesystem genuinely refused (the record held open without delete
  sharing), a refused Retry, and `Use for this session` all left the same
  digest on disk with no temporary behind them, and the dialog named the exact
  refusal rather than claiming a save. The same apply landed once the hold was
  released. A `schemaVersion: 2` record written by something that is not this
  build survived a real startup and a Cancel byte for byte while the session ran
  on usable defaults; only the confirmed replacement overwrote it.
- **First-run help, recovery, and the real provider.** The backend read
  `available` and named its release. The offline help opened unclipped in both
  languages, carrying the support target, the user-installed-ProteoWizard
  explanation and the session-only lifetime of a chosen folder. A language
  change probed the backend zero extra times. A cancelled native
  installation-folder dialog returned the keyboard to the `choose` action by
  that action's identity; a folder holding neither tool read as `unsupported`
  and never reached the saved record; automatic discovery returned to the host's
  real verdict. Then a retained acquisition converted through the real
  `msconvert`, was adopted, opened and read in Simplified Chinese, and exported
  to CSV whose keys, header, `unreported` unit states and 1,504 full-precision
  rows contain no Chinese at all.

Every capture asserted the owned process in the foreground with document focus,
the measured DPI and viewport, a raster equal to the client rect, no external
resource, an empty mock IPC table so that every command reached Rust, a
non-writable `invoke`, and an empty console.

## Evidence

Retained, ignored and local under `.tmp/m75-evidence/`: the checkpoint, the
per-unit gate records with their serial reversion controls, the localization
inventory, the source-review findings, and the browser and native acceptance
records with their own bytes, runs, screenshots and attribution.
