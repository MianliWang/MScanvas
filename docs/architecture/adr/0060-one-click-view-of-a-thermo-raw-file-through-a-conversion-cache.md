# ADR 0060 — One-click view of a Thermo RAW file through an MSCanvas-owned conversion cache

Status: **Accepted** by the owner on 2026-10-30. The owner accepted the feature
that day ([ADR 0059](0059-vendor-format-strategy-official-readers-thermo-first.md),
decision 2, "One-click view RAW";
[after-beta-1 plan, section 2](../../development/AFTER_BETA1_PLAN.md#2-owner-decisions-2026-10-28),
decision 5 of 2026-10-30) and asked that its details follow the
recommendations. This record states those recommendations. Slice 1, the cache
library, is implemented ([PR #172](https://github.com/MianliWang/MScanvas/pull/172),
2026-10-30). Slice 2, the operation and its commands, is implemented on `be/viewraw-op`
([slice 2 notes](#slice-2-notes-2026-10-30)); nothing else here is. The questions still open for the owner are listed
[at the end](#open-questions-for-the-owner). None of them blocks slices 1
and 2; questions 1 and 8 gate slice 3, the interface (decision 16).
Amended 2026-10-30 by ADR 0056 slice 2: the data documents' version numbers
(a note under Exports).
Related: [0005](0005-mzml-preview-boundary.md),
[0006](0006-multi-dataset-workspace-boundary.md),
[0011](0011-private-workspace-conversion-path.md),
[0014](0014-proteowizard-cancellation-evidence.md),
[0015](0015-user-visible-queue-stop.md),
[0016](0016-explicit-converted-output-adoption.md),
[0044](0044-conversion-configuration-authority.md),
[0049](0049-content-bound-execution-snapshot.md),
[0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
[0056](0056-project-owned-mzml-reader-for-viewing.md),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md),
[0058](0058-user-saved-conversion-presets.md),
[0059](0059-vendor-format-strategy-official-readers-thermo-first.md).
Evidence: [Thermo vendor centroiding evidence](../../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md)
(cases `TV0` and `TE0`, the verified default on two public Thermo RAW files);
ADR 0056's [reader spike](0056-project-owned-mzml-reader-for-viewing.md#evidence)
and M0's `msaccess` timings.
Design reference: interface direction A (roster on the left; per-file tabs
Chromatogram and spectrum, Scans and Metadata; the chromatogram above the scan
list and the spectrum; bordered buttons; a status bar). Its clickable demo is a
local scratch build and is not committed, and the owner has not yet chosen the
interface direction (open question 8). The design-goal identifiers cited
here (B2, I8, S4, W7) are those of the design-goals draft of 2026-10-29, which
is not committed either; each citation states the rule it relies on.

## Context

**A Thermo RAW row cannot be viewed today.** The preview boundary answers
`dataset_not_previewable` for every vendor row (ADR 0005, amended by M3.1;
ADR 0056 decision 3). To look at one, a user goes through the conversion
workflow:

1. Convert this file…, which moves to the Conversion screen;
2. reads the settings, which is a decision;
3. Convert 1…, and chooses a destination folder, a second decision;
4. waits;
5. Add 1 output to workspace;
6. returns to the Workbench and activates the new mzML row.

That is about seven actions, two decisions and two screen changes. It also
leaves an mzML file in a folder the user had to choose, when all they wanted
was to look.

**The owner's decision, 2026-10-30:** "Selecting a Thermo RAW row to view
converts it with the verified defaults into an MSCanvas-owned cache, never the
user's destination and never overwriting, then opens the result."

**What the evidence says about size and time.** Both files are public, and both
were converted with the verified default on the verified build:

| Case | Source | Source bytes | Output bytes | Output / source | Conversion time |
| --- | --- | --- | --- | --- | --- |
| `TV0` | LTQ Velos, 85 spectra | 2,086,041 | 4,790,428 | 2.30 | 1,388 ms |
| `TE0` | Orbitrap Exploris 480, 43,878 spectra | 275,621,692 | 528,766,200 | 1.92 | 63,632 ms |

A default view of a 276 MB RAW therefore costs about a minute of `msconvert`
and about 529 MB of disk. The same file with vendor centroiding on MS1 and above
(`TE1`) is 284,183,742 bytes. That is smaller, but it is not a default
(decision 2).

**The constraints this design must keep:**

- no implicit centroiding, no backend fallback, no overwrite (AGENTS.md);
- vendor files are read only through the user's own ProteoWizard, and no other
  reader stands in (ADR 0059 decisions 1 and 5);
- the build gate and the "not verified by MSCanvas" label (ADR 0055, owner
  decision of 2026-10-29);
- opening a preview stays refused while a conversion runs, because the open
  runs `msaccess` beside `msconvert` (ADR 0057 decision 2);
- Rust owns files, processes and the cache, and React receives no path
  (ADR 0005, ADR 0044).

## User goal and interaction budget

**User.** A scientist with Thermo RAW files, on an instrument computer or a
share. They want to see a run's chromatogram and spectra now, without choosing
settings or a folder. Viewing is ad hoc and frequent. Files range from a few
megabytes to a few gigabytes.

**Risks.** Two are scientific: a view must not centroid or round anything the
user did not ask for. Two are about the user's data: the cache must never
overwrite or delete anything that is not its own, and must not fill the disk.

| Goal | Physical actions | Decisions | Screen changes | Feedback |
| --- | ---: | ---: | ---: | --- |
| View a Thermo RAW file (this ADR) | 2: activate the row, then View; or Enter twice | 0 | 0 | The phase and elapsed time, a Cancel button, then the view with its source and conversion facts |
| The same today | about 7 | 2 | 2 | The queue's states, then a new roster row to activate |

## Decisions

### 1. The entry point: a View button in the RAW row's pane

**Where it lives.** In direction A, activating a roster row shows that row in
the Workbench's main column. For an mzML row that opens it. For a vendor row
the column shows the file row and a one-line state with Convert this file….
For a **Thermo RAW** row, that state becomes:

```text
| QC_pool_01.raw                                                          |  file row
|-------------------------------------------------------------------------|
| View converts this Thermo RAW file to mzML in MSCanvas's view cache.     |
| [View]  [View with…]  [Convert this file…]                              |
```

Today's roster activates mzML rows only (`DatasetRoster.tsx`), so a vendor row
shows nothing; slice 3 adds the vendor row's pane. If the owner chooses another
direction (open question 8), the pane goes wherever that direction shows a
vendor row's state. The rules below are about the pane's content, not its
place.

- **Activating a RAW row never starts work.** Clicking it, or moving through
  the roster, highlights it and shows this pane. It hashes nothing and converts
  nothing. Browsing forty RAW rows must not start forty conversions of a minute
  each, and highlighting a row in order to remove it must not start one.
- **View** starts the one-click operation (decision 2). It is the first button
  of the pane.
- **View with…** opens a menu of the other admitted rows for this source
  (decision 2).
- **Convert this file…** is unchanged. It is the route to a file in a folder
  the user chooses, with every conversion setting.
- **View is a bordered button, not the filled primary.** The Workbench already
  has its one filled primary, Convert N checked…, in the roster footer
  (design goal B2). A second filled button would make two primaries.
- **Only Thermo RAW rows get View** (ADR 0059 decision 2). Shimadzu LCD and
  SCIEX rows keep Convert this file… alone.
- On a build without a measured row, View carries the "not verified by
  MSCanvas" label (decision 4).

**Keyboard path.**

1. Move to the row and activate it with Enter. It is highlighted, and nothing
   starts. Space keeps its roster meaning: it toggles the row's selection.
2. Press Enter again on the highlighted RAW row. This is a new rule for RAW
   rows only: Enter on a RAW row that is already highlighted presses the pane's
   first action, which is View in Idle and Cancelled, Open in Ready, and Try
   again in a retryable Failed. In every other state it does nothing. A
   repeated keydown (`event.repeat`) never presses anything, so holding Enter
   down cannot start a conversion. Or Tab to the button and press Enter or
   Space.
3. View with… opens with Enter, Space or Down. Up and Down move, Enter chooses,
   and Escape closes the menu and returns focus to its button.
4. While the operation runs, focus stays where it was. Search, sort, focus,
   selection and roster reads stay available, as during a queue (ADR 0012,
   decision 5). Cancel is reachable by Tab in the pane.
5. When the view opens, focus does not move, as when an mzML row opens.

A layout whose roster is a drawer that closes on activation, as direction A's
demo is at narrow widths, needs its own path to View. It is settled with the
direction (open question 8).

**Live regions.** A polite live region announces each phase change, the open
("QC_pool_01.raw is open.") and a Ready that the user is not looking at
("QC_pool_01.raw is ready to view."). A failure is announced through
`role="alert"`, once. The elapsed-time counter is not announced.

### 2. What one click runs: the verified default, never a picker

**View always converts with `ConversionIntent::SHIPPED`.** That is the first
admitted row (`ADMITTED[0]`, evidence `D1`):

- mzML;
- no additional centroiding;
- all spectra;
- m/z 64-bit, intensity 32-bit;
- zlib.

It lowers, after the source, to `--mzML --zlib`. That is exactly the argv the
`TE0` and `TV0` cases ran.

- **The View command carries no intent at all** (`begin_raw_view`,
  decision 12). The default is chosen in Rust, so no frontend defect can put a
  picker into a one-click view.
- **"The verified defaults" means this one row.** It never means "any verified
  row". `peakPicking vendor msLevel=1-` is decided as a verified row for Thermo
  RAW on the evidenced build (plan section 2, 2026-10-30), and it is still
  never what View runs. The same holds for any row verified later.
- **View with… is the explicit choice.** Its menu lists `rawViewIntents`
  (decision 12), in table order:
  - The rows of the admitted table (`ConversionIntent::ADMITTED`) whose source
    domain covers Thermo RAW and whose output format the viewer reads, which
    today means mzML. Today these are the seven `AnyAdmittedSource` rows. The
    two unscoped-centroiding rows were measured on mzML sources only and are not
    offered. The vendor centroiding row "MS1 and up" joins through the table
    when ADR 0055's slice adds it.
  - Membership does not depend on the installed build; whether each row is
    verified does. On the evidenced build the measured rows are verified. On
    any other build that reports its release, the same rows are listed, and
    every one of them, the default included, carries "not verified by
    MSCanvas" (ADR 0055, owner decision of 2026-10-29). On a build that does not
    report its release, View with… is refused as View is (decision 4).
  - The default comes first, marked Default.
  - A lossy row says what it loses, in ADR 0055's words, for example "Lossy:
    replaces profile peaks with centroids" or "Lossy: removes spectra".
  - Advanced-tier intents are not in the menu. That includes "MS2 and up"
    vendor centroiding while it stays labelled. They go through Conversion.
    *2026-10-30, later: "MS2 and up" is now a verified row with a Thermo RAW
    domain ([ADR 0059](0059-vendor-format-strategy-official-readers-thermo-first.md#2-thermo-first)),
    so it joins the menu through the table as "MS1 and up" does. Every other
    vendor scope stays advanced and out of the menu.*
  - The choice applies to that one view. It is never remembered, and View
    never starts from it. This is ADR 0058's reasoning against restoring a
    last-used preset: a lossy step must not come back without being chosen.
- **Each intent is its own cache entry** (decision 7). A centroided view and the
  default view of one file are two entries, and View finds only the default
  one.

### 3. The states, and what each one shows

The pane for the RAW row shows one of these states. The status bar shows the
running operation from every screen as text, "Preparing QC_pool_01.raw for
viewing 0:42", in the busy slot the conversion queue uses.

| State | Pane | Buttons |
| --- | --- | --- |
| **Idle** | The one line of decision 1, with the "not verified by MSCanvas" label beside View on an unmeasured build | View, View with…, Convert this file… |
| **Checking file** | The plot frames of direction A's reading state, with skeletons after 300 ms, and one line: "Checking QC_pool_01.raw" with a determinate bar of bytes read | Cancel |
| **Checking cached copy** | As above: "Checking the cached copy" with a determinate bar | Cancel |
| **Converting** | As above: "Converting QC_pool_01.raw for viewing", the elapsed time, and an indeterminate bar | Cancel |
| **Checking output** | As above: "Checking the converted file", with a determinate bar over the output's bytes and the RAW's, both read again (decision 7) | Cancel |
| **Storing** | As above: "Storing the converted file", with no bar. It is steps 5 and 6 of decision 8, eviction and the publishing rename, and it cannot be cancelled (decision 10) | none |
| **Ready** | "QC_pool_01.raw is ready to view." Shown when the operation became ready while the row was not highlighted | Open, View with…, Convert this file… |
| **Opening** | Direction A's reading state, unchanged: "Reading QC_pool_01.raw…". Opening another row supersedes it, as it supersedes any open (ADR 0056 decision 4) | none, as for an mzML open |
| **Viewing** | The tabs Chromatogram and spectrum, Scans and Metadata, as for an mzML row. The file row shows the RAW's name and, when the intent is not the default, its summary, such as "Vendor centroiding, MS1 and above" and "Lossy" | The viewer's own, and View with… and Convert this file… in the file row |
| **Failed** | What broke, and why, in at most two lines (decision 10) | Try again when the failure is retryable, and Convert this file… |
| **Cancelled** | Until the next action: "Cancelled. Nothing was added to the view cache.", or, when the cancel came after the entry was stored, "Cancelled. The converted copy stays in the view cache, so View finds it." (decision 10) | View, View with…, Convert this file… |
| **Refused** | View stays focusable with `aria-disabled` and its reason below it, linked by `aria-describedby` (decision 4) | The recovery the reason names |

- **Another setting while viewing.** View with… stays in the Viewing file row,
  so a user looking at the default view can choose another row, or the reverse.
  That starts a new operation. The current view stays on screen until the new
  one opens, the file row shows the progress line and Cancel in place of its
  buttons, and focus stays on View with….
- **Progress claims only what MSCanvas measures.** CNV-D8 (ADR 0043) is
  LOCKED: "counts and a named state, never a percentage, a fraction of an item
  or an estimate". It was written for the queue, and the queue keeps it. This
  record amends it for the view pane only (What this amends). The three
  checking phases are MSCanvas's own reads, so bytes read out of bytes to read
  is a measured fraction, and the elapsed time is a clock, not an estimate.
  `msconvert` reports nothing, so Converting shows an indeterminate bar and the
  elapsed time, and never an estimate of the time left.
- **A cache hit** runs Checking file, Checking cached copy and Opening. A miss
  runs Checking file, Converting, Checking output, Storing, Checking cached copy
  and Opening. A phase that ends within 300 ms shows nothing (design goal I8).
- **The open is not part of the operation.** When the operation becomes
  `ready`, the webview opens it (`open_raw_view`, decision 12) only if the RAW
  row is still the highlighted row. A `cancelled` operation is never opened.
  Otherwise the row shows Ready, the status bar says "QC_pool_01.raw is ready to
  view." with Show {name} until the next operation, and the live region says so
  once. Returning to the row shows Ready and opens nothing; Open opens it. The
  open never takes the screen from what the user is looking at.

### 4. Refusals: the build gate, and no fallback

View is refused before the press, and before any work, in each of these
states. Rust answers the highlighted row's availability (`get_raw_view_state`
with the row's handle, decision 12), so the webview never recomputes this
policy. A begin request answers the same codes when the state changed after the
last read, and the pane then shows that refusal. Each refusal has a typed code.
Each reason says what would make View possible, and any recovery it names has a
button (design goal S4). When several hold at once, the first in table order is
shown.

| Condition | Code | Reason (en, proposed) | Recovery |
| --- | --- | --- | --- |
| No usable ProteoWizard | `backend_not_found` (existing) | "ProteoWizard is not available." | The backend surface's own actions, such as Choose ProteoWizard folder… |
| Backend quarantined (ADR 0015) | `backend_quarantined` (existing) | The quarantine reason, as today | The quarantine's own recovery |
| The build does not report its release | `provider_build_not_evidenced` (existing; ADR 0055's gate) | "This ProteoWizard does not report its release, so it cannot convert vendor files." | Choose ProteoWizard folder… |
| A conversion queue is awaiting a destination or running | `conversion_busy` (existing) | "A conversion is waiting for a destination or running." | Show conversion |
| Another view is being prepared | `raw_view_busy` | "Preparing {name} for viewing." | Show {name}, whose pane has Cancel |
| The row is not a Thermo RAW row | `raw_view_unsupported_source` | Not shown: the pane has no View for such a row, so only a request can meet it | none |
| The cache has no folder (decision 6) | `view_cache_unavailable` | "MSCanvas has no folder for its view cache on this computer." | Convert this file… |
| The cache folder exists but carries no MSCanvas marker (decision 6) | `view_cache_root_unrecognized` | "A view-cache folder that MSCanvas did not make is in %LOCALAPPDATA%\org.mscanvas.desktop. Move or rename it, then View again." | Convert this file… |
| The RAW is larger than 1.5 GiB (decision 9) | `view_cache_entry_too_large` | "This file is larger than 1.5 GiB, too large to view through the cache." | Convert this file… |
| The intent sent by View with… is not one Rust offers now; only a press of View with… can meet it | `raw_view_intent_not_offered` | "That setting is not available for this file now.", under View with… | View |

The location in the `view_cache_root_unrecognized` reason is text in the
locale resource, not a path that crosses IPC. MSCanvas never makes a root
without its marker (decision 6), so such a folder is someone else's, and
MSCanvas neither deletes it nor asks the user to.

**Some conditions are known only once the operation runs:** whether there is
room for a miss, an unrecognized item where the entry belongs, and the output's
size. They end the operation `failed` with their own code and buttons
(decision 10).

**The build gate is ADR 0055's, unchanged.** A view is a conversion of a
vendor family:

- The **evidenced build** converts it, and the default view is verified, with no
  label.
- **Any other build that reports its release** converts it, labelled "not
  verified by MSCanvas", with the release named. The label sits beside View,
  in the progress line, in the viewer's file row and Metadata, and in every
  export (decision 11).
- **A build that cannot report its release** converts no vendor family, so View
  is refused.

**No fallback, in any direction.** When ProteoWizard is missing, refused or
fails, nothing else reads the RAW. That rules out ThermoRawFileParser, an open
decoder and a stale cache entry from another build. A cache hit counts only for
the installed build (decision 7), so a missing ProteoWizard is refused even when
an entry exists. The open of a hit needs `msaccess` too (ADR 0056 decision 3).

### 5. Concurrency with conversion (ADR 0057)

**While a conversion queue awaits a destination or runs, View is refused**
(`conversion_busy`), for a hit as well as a miss.

- Even a hit opens through `msaccess`, which ADR 0057 decision 2 refuses beside
  `msconvert`.
- The reason is "A conversion is waiting for a destination or running.", and
  Show conversion takes the user to the queue and its Stop controls.
- **Not recommended: running the view after the queue.** Queue membership is
  fixed at Begin (ADR 0013). A private cache item does not belong in a queue
  that writes to the user's destination. A queue can hold 1,024 items and run
  for hours (ADR 0057 decision 3), and a click that silently waits that long is
  worse than a refusal that says why.

**A view conversion is a conversion: it holds the conversion slot.** It takes
the slot that ADR 0012 gives a queue, with the slot's lock-free busy mirror,
from Checking file until it is terminal. Every route ADR 0012 refuses while the
slot is held is therefore refused while a view runs, through the guards that
exist today and no new one:

- Add files…, Add mzML folder…, a native drop, Begin of a conversion queue,
  opening another preview, loading a spectrum, and removing the RAW row being
  prepared. Opening and loading follow ADR 0057 decision 2; once its
  decision 1 ships, a row whose preview is already retained keeps its selected
  spectra readable natively.
- When the slot's holder is a view, each of these answers `raw_view_busy`, not
  `conversion_busy`, with "Preparing {name} for viewing." and Show {name},
  whose pane has Cancel. Show conversion would lead to a screen with no queue
  and no Cancel for this operation. The mirror records which kind of holder
  has the slot, so the drop callback answers the same way without a lock.
- Search, sort, focus, selection and roster reads stay available, as ADR 0012
  keeps them, and composing conversion settings is still allowed.
- Clear workspace treats the operation as active work, with the choices
  WSP-007 already gives: Remove non-running, Cancel and clear, and Return.
- The webview's `canPreview` and ADR 0044's `backendUsable` projection read a
  running view from `get_raw_view_state` (decision 12), as they read the
  queue's state today, so the two layers agree (ADR 0056 decision 3).

The slot, not the backend gate, is what refuses these routes. The coordinator
takes the backend gate for the run as it does for a queue item, and Checking
file and Checking cached copy do not take it. Other previews stay
refused through the slot for the whole operation, hashes included. For a hit
near the size limit that can be about a minute (Consequences); native QA
measures it (decision 14).

**One view conversion at a time.** A second View, on any RAW row, is refused
with `raw_view_busy` while one runs. The reason names the file, and Show {name}
leads to its Cancel.

- *Not recommended: superseding.* A new View that stops the running one would
  throw away up to a minute of conversion without asking.
- *Not recommended: queueing views.* That is hidden pending work.

### 6. The cache: location, ownership and layout

**Location.** The cache lives in `view-cache` under the per-user
application-local data folder that Tauri resolves (`app_local_data_dir`). That
is the same binding as `ui-preferences.json` and `conversion-presets.json`, and
under the `e2e` feature it is the same task-owned QA root.

- **It is never anywhere else.** It is never in the RAW's folder, a conversion
  destination, the project's folder, the temporary directory or the working
  directory. If the resolver gives no folder, View is refused
  (`view_cache_unavailable`) and no other place is tried.
- **The uninstaller.** Whatever it does with the application data, it does with
  the cache. What its "Delete the application data" choice removes is not yet
  observed (plan section 7.2, as ADR 0058 records for presets).

**Ownership marker.** The marker, `.mscanvas-view-cache-owner`, holds a
constant, `mscanvas-view-cache\n`, as the staging marker does: it proves which
program made the folder, not which run. MSCanvas makes the root whole or not at
all:

1. It creates `view-cache.creating-<uuid>` beside where the root goes, with
   create-new semantics, writes the marker into it, flushes it and closes it.
2. It renames that directory to `view-cache`, with no replacement.

- If the rename finds `view-cache` already there, another MSCanvas process made
  it first. MSCanvas removes its own creation directory and reads that root's
  marker.
- Any other failure of the rename removes the creation directory, and this
  View is refused with `view_cache_unavailable`. The next View tries again.
- A crash before the rename leaves a creation directory that holds at most the
  marker. It is not `view-cache`, so it never blocks View. It is left in place:
  it holds about 20 bytes, and a sweep of other processes' creation
  directories would race their renames.
- A root that exists without the marker, or whose marker reads otherwise, is
  therefore never MSCanvas's. View is refused with
  `view_cache_root_unrecognized`, and nothing under it is read, written or
  removed. The reason says where the folder is and asks the user to move or
  rename it (decision 4).
- The root, and every entry, must be a plain directory and not a link or other
  reparse point.

**Layout.**

```text
<application-local data>\view-cache\
  .mscanvas-view-cache-owner        the root marker
  entries\<key>\                    one published entry; <key> is 64 lowercase hex digits
    entry.json                      the manifest
    view.mzML                       the converted file
  staging\<attempt uuid>\           one attempt's private area
    owner.json                      the attempt's owner: process id and creation time
    ...                             the conversion's own staging area, beneath it
```

- No name in the cache comes from the user's file. The RAW's name, folder and
  path appear nowhere in it, so a path with spaces or Unicode cannot reach a
  cache name, and the cache records nothing about where the user keeps data.
- The staging and `owner.json` rules are those of the targeted MS1 work area
  (`targeted_ms1/scratch.rs`). A sweep at the start of each view operation
  removes an attempt directory only when its marker reads, names that same
  directory, and names an owner process that is gone. It never runs at startup.
  An attempt of another running MSCanvas, or of this one, is left alone.
- **Two MSCanvas processes may share the cache**, because the application is not
  single-instance. Every rule below holds across processes: attempts are
  per-process, publishing never replaces (decision 8), and a pin is an
  operating-system handle (decision 8), not a flag in memory.

### 7. The cache key, and how the source digest is obtained

**The key** is the SHA-256 of four lines:

```text
mscanvas-view-cache-key/1
source-sha256=<64 lowercase hex>
provider-sha256=<64 lowercase hex>
intent=<canonical intent>
```

- **The bytes hashed** (dated note, 2026-10-30, slice 1): that text in UTF-8,
  each line ended by one LF, the last included. The intent is one line of at
  most 1 KiB without control characters; anything else makes no key.
- **`source-sha256`** is the SHA-256 of the RAW's bytes.
- **`provider-sha256`** is the SHA-256 of the installed `msconvert.exe`, the
  identity the capability probe already reads and ADR 0043's contract 3 binds
  every measured setting to. Another build means another key, so outputs of two
  builds are never mixed. ADR 0059 notes that the two ProteoWizard builds do
  not write byte-identical outputs.
- **`intent`** is the canonical intent the plan's receipt binds (ADR 0044,
  decision 9): today `ConversionIntent::stable_id()`, and the canonical
  serialization of the structured intent once ADR 0055's slice 1 ships.
- **The version line changes** whenever the lowering, the output checks or the
  manifest change. Old entries then match nothing, and the size policy ages them
  out (decision 9).

**The source digest is a full SHA-256, never a path or a time.** The row's
identity lease opens the file sharing read, write and delete (ADR 0006), so a
listed RAW can be rewritten in place. No filesystem fact proves content: a
writer can also reset `LastWriteTime` and `ChangeTime`.

- **The first View of a row in a session** re-accepts the row, as every use does
  (canonical path, identity, generation). It then hashes the file in chunks,
  with Cancel checked between chunks and the bytes read reported. This is the
  Checking file phase. Today's source capture cannot do that: a Thermo RAW
  becomes a conversion source through `ConversionSource::open_thermo_raw_file`,
  whose `SourceObjectFacts::capture` hashes the whole file in one call
  (`Sha256Digest::calculate_file`), with no progress and no Cancel. Slice 2
  adds a chunked, cancellable form of that capture.
- **On a miss the RAW is hashed once before the run.** The facts Checking file
  captures (identity, length and digest) are the conversion's source baseline.
  The coordinator's bind uses them instead of capturing again, under the memo's
  rule below, and a test asserts that the key's source digest equals the
  baseline's.
- **After the run, `revalidate_source` hashes the RAW again,** as it does for a
  queue item. That read belongs to Checking output, whose bar counts the
  output's bytes and the RAW's (decision 3), and it needs the same chunked,
  cancellable form. A mismatch fails the operation with
  `raw_view_source_changed`, and nothing is published.
- **A repeat View of the same row in the same session** may reuse the digest
  from a memo. Rust keeps one memo per roster row:
  - the digest;
  - the byte length, `LastWriteTime` and `ChangeTime`, all read through the
    row's lease handle (`GetFileInformationByHandleEx`) when the hash was taken.

  The memo is used only when the row's identity is unchanged and all three
  facts read now equal it. Any difference means a full hash. The memo lives in
  memory with its row, and goes when the row is removed, the workspace is
  cleared or the session ends. It is never written down and never shared
  between rows, and a file added again is a new row with no memo.
- **Residual risk, stated:** a rewrite in place that restores the length and
  both times goes unnoticed until the row is added again or the next session.
  The viewer shows the digest it viewed (decision 11), so the view still says
  which content it is.
- **Residual risk, stated:** the provider digest covers `msconvert.exe` only.
  The vendor reader beside it (`ThermoFisher.CommonCore.RawFileReader.dll`) is
  not hashed. That is the same residual the evidenced-build binding carries
  today.

### 8. Publishing, reuse and damage

**A miss converts into staging and publishes by one rename.**

1. The view conversion goes through ADR 0011's coordinator: claim, wait, epoch
   recheck, revalidate, bind, gate, pin, admit, run. Its plan is bound by the
   configuration authority (ADR 0044) to the source, the build and the intent,
   and its destination is the attempt's directory under `staging`. No user
   destination is involved.
2. `msconvert` writes only into the attempt's private staging area (ADR 0009,
   ADR 0055 decision 2), under one Job Object with a request-only cancellation
   handle (ADR 0014, ADR 0015).
3. The output gets every check a queue item gets: the five judgements, the
   integrity contract for the intent, `OutputContainsNoRecords`, and the source
   revalidation. A failure fails the operation, and nothing is published.
4. The validated output is renamed within the attempt to `entry\view.mzML`,
   through the handle it was validated with, as finalization does today.
   `entry\entry.json` is written beside it (decision 9 lists its fields). Both
   handles are then closed. No handle is held across step 6, because Windows
   can refuse to rename a directory while a file in it is open.
5. Room is made under the cap (decision 9).
6. `entry` is renamed to `entries\<key>` with no replacement (`MoveFileExW`
   without `MOVEFILE_REPLACE_EXISTING`). The attempt directory is then removed.
   (Dated note, 2026-10-30, slice 1: the attempt directory itself, `entry`'s
   parent, is held without delete sharing from its creation until its
   removal, so its name cannot be swapped for a link while paths through it
   are used. That handle is outside `entry` and does not stop this rename.)

Step 4 closes Checking output. Steps 5 and 6 are the Storing phase, and they
cannot be cancelled (decision 10). The new entry's verification after step 6
(below) is shown as Checking cached copy.

**Never overwriting.** If `entries\<key>` already exists, for instance because
another MSCanvas process published the same key first, the rename fails.
MSCanvas then verifies the existing entry (below) and uses it, and discards its
own staged copy. If the existing entry is damaged, it is removed and the rename
is tried once more. ADR 0055's Fail and Skip policies are not involved, because
there is no destination: an existing entry with the same key holds the same
source, build and intent.

- **Any other failure of the rename,** such as a sharing violation from a
  scanner still reading the new file, fails the operation with
  `view_cache_not_stored` (retryable). Nothing is published, and the attempt's
  staging is removed.
- **Entries are written once.** Nothing in an entry is replaced or rewritten
  after step 6; only the directory's time changes (decision 9). No file outside
  the cache is ever written.

**Every entry is verified before it is opened, hit or not.**

- `entries\<key>` is a plain directory holding exactly `entry.json` and
  `view.mzML`, compared ignoring case.
- The manifest parses as schema 1, refusing unknown fields, within 16 KiB.
- The manifest's key inputs hash to the directory name and equal the request's.
- `view.mzML` is a regular file whose byte length and SHA-256 equal the
  manifest's. It is hashed through the pin handle below, so the bytes hashed
  are the bytes then opened.
- On a miss, the new entry is verified after step 6, once the pin is taken.
  If it is gone or fails by then, because another MSCanvas process evicted or
  cleared it in between, the operation fails with `view_cache_entry_lost`
  (retryable). It does not convert again.

**A damaged entry is never opened.** An entry that fails any check but still
carries only MSCanvas's fixed names is removed. The operation then continues as
a miss, and its phase line says "The cached copy was damaged and was removed."
Converting again with the same build and intent is the same operation, not a
fallback, and the user sees that it happens. An operation converts at most
once, so this happens at most once per press. Anything else under `entries`
is left exactly as found and counted as unrecognized: a link, an unknown name,
or a directory not named by a key. If such a thing holds the entry's place,
the operation fails with `view_cache_entry_unrecognized` (not retryable).

**A pin keeps an entry from being evicted while it is read.** From verification
until its preview state ends, the operation holds `view.mzML` open with read
access, sharing read only, without write or delete sharing.

- **When it ends:** a `ready` operation passes its pin to the preview state
  when it is opened. A `ready` operation that is never opened keeps its pin
  until the next view operation begins, its RAW row is removed, the workspace
  is cleared or the session ends. The preview state's pin ends at the next open
  (ADR 0056 decision 4 keeps one preview at a time), when the RAW row is
  removed, when the workspace is cleared, and when the session ends. One
  MSCanvas process therefore pins at most two entries: its open view's and one
  `ready` operation's.
- **What it blocks:** no process, this one or another MSCanvas, can delete,
  rename or write the file while it is pinned. Eviction and Clear see the
  sharing refusal and count the entry as in use.
- **What it still allows:** `msaccess` and the native reader open the file for
  reading, which read sharing admits. That `msaccess` opens a file held this
  way is a native QA item (decision 14).
- **This amends ADR 0056 decision 4,** "No read holds a file handle", for cache
  entries only. The pin is a lifetime, like the identity lease, and not the
  handle a read goes through. The user's own files keep the rule.

### 9. Size: the cap, eviction, Clear and disk space

**The cap is 10 GiB (10,737,418,240 bytes), a constant in Rust.** It counts the
`view.mzML` byte lengths of the published entries.

- **Basis:** about twenty default views of `TE0`'s size (528,766,200 bytes
  each).
- It is shown, and not editable, in the cache's summary in Settings. A
  user-adjustable cap would add a field to the preference record, whose store
  refuses another schema rather than migrating it (M7.5). That is left to the
  owner (open question 2).

**The per-entry ceiling is 4 GiB,** the document limit of the mzML inspector and
of the viewing reader (`MzmlScanLimits`). A larger output fails the output
checks anyway, and the reader could not open it.

- **Before any work**, a RAW larger than 1.5 GiB (1,610,612,736 bytes) is
  refused with `view_cache_entry_too_large`. This is a heuristic, not a bound.
  4 GiB divided by the larger measured ratio (`TV0`, 2.30) is 1.74 GiB, and the
  margin below that is there because only two files were measured. It applies
  to every intent. The vendor-centroided ratio (`TE1`, 1.03) comes from one
  file, and a per-intent limit would rest on that file alone. The recovery is
  Convert this file… to a folder the user chooses, which has no cap.
- **After the run**, an output that fails the inspector's size limit fails the
  operation with the same code, not retryable, and nothing is published. A RAW
  under the heuristic can still meet this after a full conversion. Try again is
  not offered, because it would fail the same way.
- *Not chosen: stopping the run once the staging output passes 4 GiB.* The stop
  would be the request-only cancellation, and a termination it cannot confirm
  quarantines the backend for the session (decision 10).

**Disk space is checked once Checking file has found a miss,** before
Converting. A hit needs no space. The check reads the cache volume's free space
available to the caller (`GetDiskFreeSpaceExW`, as ADR 0049 does for its work
area). It requires three times the RAW's size, plus a 2 GiB reserve. The factor
covers both measured ratios with margin. The reserve keeps the volume usable
for everything else.

- If space is short and evicting every unpinned entry on that volume would make
  enough room, the least recently opened entries are evicted until it fits.
- Otherwise the operation fails with `view_cache_no_space` (retryable), without
  evicting anything: "The drive that holds MSCanvas's application data needs
  about {n} GiB free; {m} GiB are free. Free space on it, or convert this file
  to a folder on another drive." The buttons are Try again and Convert this
  file…. Clear view cache is not offered, because everything it could remove
  was already counted as removable.
- **If the disk fills during the run anyway,** the conversion fails as any
  conversion does. The attempt's staging is removed and nothing is published.
  `msconvert` reports nothing that says why it failed, so the reason never
  claims a full disk. After a failed run Rust reads the volume's free space
  again, and when it is below the 2 GiB reserve the reason adds "{m} GiB are
  free on the drive that holds MSCanvas's application data."

**Eviction order:** least recently opened first, by the last-write time of the
`entries\<key>` directory, then the key.

- The time is set at publish and at each open, with `SetFileTime` on a handle
  to the directory. Nothing in an entry changes after publish (decision 8), so
  nothing else moves the time. If setting it fails, the view still opens: the
  order is advisory and holds no data. Another program that changes the time
  changes only the order.
- Entries of an older key version, or of another build, are evicted by the same
  order. Nothing is special-cased.
- **Before publishing**, unpinned entries are evicted until the total plus the
  new entry fits the cap. Pinned entries are never evicted. If pinned entries
  alone keep the total above the cap, the new entry is still published. The
  cache then stays above the cap until those pins end, by at most the size of
  the pinned entries. That is at most two entries per running MSCanvas
  (decision 8).

**What eviction and Clear may delete is closed:**

- `entries\<key>\view.mzML`, `entries\<key>\entry.json`, then the empty
  `entries\<key>` directory, for a key-named plain directory under the marked
  root;
- an attempt directory under `staging` whose owner is gone (decision 6);
- the operation's own `view-cache.creating-<uuid>` directory, after it lost the
  race to make the root (decision 6).

The RAW is never in the cache, so it is never a candidate. No user file,
destination, adopted output, link or unknown name is ever a candidate. Removal
follows the staging cleanup's discipline (`conversion_run/cleanup.rs`): the
marker is checked first, no reparse point is followed, and a removal that fails
part way stops and leaves what remains for a later pass. A damaged remainder is
recognized by its fixed names.

**The manifest** (`entry.json`, schema 1, unknown fields refused):

- `schemaVersion`, `key`;
- `sourceSha256`, `sourceByteLength`, `sourceKind` (`thermoRaw`);
- `providerRelease`, `providerSha256`;
- `intent`, the canonical intent;
- `outputSha256`, `outputByteLength`;
- `createdAt` (UTC).

It is written once, before publishing, and never again; when the entry was last
opened is the directory's time, not a field. It holds no path and no file name.
Whether the entry is verified is not stored. It is derived at each open from
the provider digest, the intent and the source kind, with this build's tables.

**Clear view cache** is in Settings, in a View cache row.

- The row reads "{n} views, {x} GiB of 10 GiB", beside a danger-bordered
  **Clear view cache** button. Every size in the copy is in GiB, the cap's
  unit. One line under it keeps the irreversible-action
  disclosure: "Removes only MSCanvas's converted copies. RAW files and your
  outputs are not touched."
- There is no confirmation dialog, because everything it removes is app-owned
  and can be made again.
- It removes every unpinned entry and every staging attempt whose owner is gone.
- It is refused while a view conversion runs, with "Preparing {name} for
  viewing." and Show {name}.
- The result replaces the summary line, for example "Removed 3 views (1.6 GiB).
  1 in use was kept." Entries that could not be removed, and unrecognized items
  left in place, are counted the same way.

**Workspace removal deletes nothing.** Removing the RAW row, or clearing the
workspace, releases its lease, its memo and its pin. It deletes neither the RAW
nor its cache entries. The entries age out under the cap.

### 10. Cancellation and failure

**Cancel** is one button in the pane, bound to the exact operation id. A late
press after the operation ended is a no-op that answers the current state.

| Phase | What Cancel does |
| --- | --- |
| Checking file, Checking cached copy on a hit, Checking output | Stops MSCanvas's own read at the next chunk |
| Converting | The queue's request-only cancellation of the `msconvert` tree (ADR 0014, ADR 0015) |
| Storing (eviction and the publishing rename) | Nothing at once. The pane shows no Cancel. A cancel request that arrives during Storing, pressed just before it began, waits for Storing to finish and then ends the operation without verifying or opening the entry |
| Checking cached copy, on a miss (the new entry's verification) | Stops the read at the next chunk; the entry is already stored |
| Opening | Not part of the operation (decision 3). It has no Cancel, as an mzML open has none today; opening another row supersedes it |

Cancel always ends the operation `cancelled`, and a `cancelled` operation is
never opened. Its `stored` field says whether this operation published an
entry:

- **A cancel before Storing** ends with `stored: false`. The attempt's staging
  is removed by identity-bound cleanup, and nothing is published. The pane says
  "Cancelled. Nothing was added to the view cache." On a hit, the existing
  entry is left as it was.
- **A cancel during Storing, or during the new entry's verification,** ends
  with `stored: true`. The entry is published and its pin, if taken, is
  released. The pane says "Cancelled. The converted copy stays in the view
  cache, so View finds it." The next View verifies it as a hit.
- **An unconfirmed termination quarantines the backend for the session**, as for
  a queue item (ADR 0015). View, conversion and preview reads are then refused,
  with the quarantine's own reason.
- **A superseded or failed open** ends the operation. Its entry stays in the
  cache, so the next View on the row is a hit.

**A failure** shows its code's reason in at most two lines, with these buttons:

- **Try again** appears only when the failure is retryable. It repeats the
  failed request: View for a View, and the same intent for a View with…;
- **Convert this file…** is always there, as the route with full diagnostics.

| Failure | Code | Retryable |
| --- | --- | --- |
| The conversion failed | the conversion's own failure, as a queue item reports it | as for a queue item |
| The RAW changed during the operation (decision 7) | `raw_view_source_changed` | yes |
| Not enough free space for a miss (decision 9) | `view_cache_no_space` | yes |
| The output is over the 4 GiB limit (decision 9) | `view_cache_entry_too_large` | no |
| Something MSCanvas did not make holds the entry's place (decision 8) | `view_cache_entry_unrecognized` | no |
| The publishing rename failed other than by an existing entry (decision 8) | `view_cache_not_stored` | yes |
| The new entry was removed or damaged before it was verified (decision 8) | `view_cache_entry_lost` | yes |

The view operation keeps no diagnostics document of its own in this slice. A
queue conversion of the same file has RUN-009's redacted export. A diagnostics
export for views is a later decision, if failures show a need.

### 11. Provenance: the viewer, exports and the project

**The viewer.** The file row shows the RAW's name, never `view.mzML` and never
a cache path. The Metadata tab opens with a "Viewed through the view cache"
group, as key and value rows:

- the source: the RAW's file name and "Thermo RAW";
- the source SHA-256;
- "Converted by": the ProteoWizard release and the `msconvert.exe` SHA-256;
- the settings: the intent's summary, for example "mzML, m/z 64-bit, intensity
  32-bit, zlib, no additional centroiding";
- "Converted at";
- "Not verified by MSCanvas", when the build or the intent is not verified.

`msaccess`'s metadata sections follow, as for an mzML row. They describe the
converted file, including the conversion's own data-processing record, and are
redacted as today.

**Exports.** Every export made while a cached view is open names the RAW as its
source, and states the conversion.

- **Figures:** the source line of the shared title block, the SVG `<desc>` and,
  once ADR 0053 lands, the PNG `Description` read "Thermo RAW {name}, converted
  by ProteoWizard {release} ({intent summary})". "Not verified by MSCanvas" is
  added when it applies.
- **Data documents** (spectrum and chromatogram CSV and TSV) add six preamble
  keys: `#source_kind`, `#source_sha256`, `#conversion_provider_release`,
  `#conversion_provider_sha256`, `#conversion_intent` and
  `#conversion_verified`.
  - A document that carries them takes a new schema version, which the slice
    assigns. The spectrum's full-source and range documents share one `#format`
    (`mscanvas_spectrum_export`) and one version sequence, in which 1 (full
    source) and 2 (range) are taken, so each provenance-bearing spectrum kind
    gets a version above 2. The chromatogram document takes the next version
    of its own sequence.
  - An export from an mzML row stays byte-identical to today.

  > **2026-10-30: [ADR 0056](0056-project-owned-mzml-reader-for-viewing.md)
  > slice 2 took spectrum versions 3 (full source) and 4 (range) and
  > chromatogram version 2** for an mzML row's documents, whose representation
  > and unit fields now carry the file's declared values. Each
  > provenance-bearing spectrum kind therefore gets a version above 4, and the
  > chromatogram's provenance-bearing document takes version 3. "Byte-identical
  > to today" means identical to what an mzML row writes from that change on.
- No export carries a cache path or the cache key.

**The project document: the cached file stays a private viewing artifact.**

- It never becomes a project input, a layer's source or a recorded artifact. An
  entry can be evicted at any time, and a project must not depend on the
  application's private data.
- The project document does not change, and schema 4 stands.
- **QC capture from a cached view is refused,** with a typed project error,
  `viewed_through_cache`. Without the refusal, `capture_project_qc_summary`
  would record the converted copy's `msaccess` run summary as the RAW's layer's
  snapshot, with no conversion provenance, and schema 4 has no field for it.
  The recovery is Convert this file…, Add output, then capture from the adopted
  mzML. That mzML's provenance, including the "not verified" flag, is what the
  owner's decision of 2026-10-29 carries into the project.
- **Targeted MS1 is unchanged.** Its worker reads its own source and never a
  preview.
- **Recording a cached view in the project** is left to the owner (open
  question 4).
- **No "Save a copy as mzML…" from the cache.** The cache publishes nowhere but
  itself. A file in a folder is Convert this file…, with its plan, destination
  and no-overwrite finalization (open question 5).

### 12. The Rust and Tauri boundary

Rust owns the cache, the operation, the memo, the pins and the size policy.
React receives no cache path, entry name or key, and no command takes a path.
Requests refuse unknown fields. The commands that change state check the
document epoch (`verified_document_epoch`), as the conversion's begin does:
`begin_raw_view`, `begin_raw_view_with`, `cancel_raw_view`, `open_raw_view` and
`clear_view_cache`.

| Command | Request | Answer |
| --- | --- | --- |
| `begin_raw_view` | `{ handle }`, with no intent field | `RawViewStateDto`, or `PreviewErrorDto` with a decision 4 code |
| `begin_raw_view_with` | `{ handle, intentId }`; `intentId` must be in Rust's current `rawViewIntents` | As above |
| `get_raw_view_state` | `{ handle }`: the highlighted RAW row, or null | `{ state, availability }`: the `RawViewStateDto`, and the given row's `RawViewAvailabilityDto`, null when no handle is given |
| `cancel_raw_view` | `{ operation }` | `RawViewStateDto` |
| `open_raw_view` | `{ operation }` | `PreviewDto`, the same type `open_mzml_preview` answers |
| `describe_view_cache` | none | `ViewCacheSummaryDto` |
| `clear_view_cache` | none | `ViewCacheClearOutcomeDto` |

`RawViewStateDto` is a tagged union:

- `idle`;
- `running`: `operation`, `handle`, `fileName`, `phase` (`checkingSource`,
  `checkingCachedCopy`, `converting`, `checkingOutput` or `storing`),
  `elapsedMs`, `bytesRead` and `bytesTotal` for a checking phase,
  `intentId`, `unverifiedBuildRelease`;
- `ready`: `operation`, `handle`, `intentId`, `cacheHit`,
  `unverifiedBuildRelease`;
- `failed`: `operation`, `handle`, `intentId`, `code`, `message`, `retryable`;
- `cancelled`: `operation`, `handle`, `stored` (decision 10).

`unverifiedBuildRelease` is a string or null, the wire name draft PR #156 uses
for the same fact.

`RawViewAvailabilityDto` is `{ available: true, unverifiedBuildRelease }` or
`{ available: false, code }`, with a code of decision 4's table. Rust computes
it from the row, the backend, the slot and the cache root, and from the RAW's
length read through the row's lease handle. It reads none of the file's
content and launches nothing. The webview reads it when a RAW row is
highlighted and whenever the backend, queue or view state changes.

- **Opening.** `open_raw_view` opens only a `ready` operation's entry, and only
  once. It refuses an operation that is superseded, already opened, or whose
  row was removed. A superseded or failed open ends the operation, and its
  entry stays in the cache. The open goes through the ordinary preview path:
  - the open ticket and supersession of ADR 0056 decision 4;
  - `msaccess` for metadata and the run summary, and the native reader for the
    table and spectra;
  - generation checks against the entry.

  The retained `DatasetPreviewState` belongs to the RAW row, so
  `load_selected_spectrum(handle, index)` and every export command keep their
  signatures. A `ready` operation that is not opened is dropped, and its pin
  released, when the next operation begins, its row is removed or the
  workspace is cleared (decision 8).
- **The open of a cache entry is the one exception** to ADR 0057's "A native
  read opens only a roster row's own file" and to ADR 0056 decision 3's open
  inside the row file's `lock_against_replacement` and `SourceGeneration`
  check. For a cached view, the file opened is the pinned entry, the pin stands
  in for the replacement lock, and the generation check is made against the
  entry (What this amends).
- **`PreviewDto` gains `viewSource`**, null for an mzML row, otherwise
  `{ kind: "viewCache", sourceFileName, sourceKind, sourceSha256,
  providerRelease, providerSha256, intentId, intentSummary, verified,
  convertedAt }`.
- **The configuration read (ADR 0044) gains `rawViewIntents`.** It lists the
  rows View with… may offer (decision 2): the admitted rows whose source domain
  covers Thermo RAW and whose output is mzML, whatever the installed build, in
  table order with the default first. Each row carries its id, summary, lossy
  statement and `verified`, which the installed build decides; on an unmeasured
  build every row has `verified: false`. Rust refuses any other id.
- **The webview's admission reads the view too.** `canPreview` and the
  `backendUsable` projection treat a running view operation as they treat a
  running queue (decision 5).
- **`ViewCacheSummaryDto`** is either `{ available: true, entries, bytes,
  capBytes, inUse, unrecognized }` or `{ available: false, reason }`. The reason
  is `rootUnresolved`, `rootUnrecognized` or `unreadable`.
- **`ViewCacheClearOutcomeDto`** is `{ removed, freedBytes, keptInUse, failed,
  unrecognizedLeft }`.
- **No event channel.** The webview polls `get_raw_view_state` while an
  operation is running, as it polls `get_workspace_conversion_state`. A
  reloaded document reads the state and carries on.
- **Bounds.** Every string crossing IPC is bounded and redacted, as
  `backend_label` does. A failure message is repository-authored English. No
  provider text crosses, because raw stderr is never shown (RUN-005).

### 13. Acceptance criteria

1. Activating, or moving through, a Thermo RAW row hashes nothing and converts
   nothing. A test counts zero provider launches and zero reads of the file's
   content. Holding Enter down on a highlighted RAW row presses nothing.
2. View converts with `ConversionIntent::SHIPPED` and no other intent. The argv
   is the source, then `--mzML --zlib`, then the staging output, with no
   `--filter`. The default request type has no intent field.
3. View with… lists only the rows in `rawViewIntents`: the default first, and
   lossy rows labelled. On an unmeasured build that reports its release, the
   same rows are listed, each labelled. The choice is never remembered, and the
   next View is the default again. View with… stays reachable while viewing.
4. A miss shows the phases of decision 3 and opens the view if the row is still
   highlighted; otherwise the row shows Ready, and Open opens it. A hit
   launches no `msconvert`.
5. Nothing is written outside `view-cache`: not in the RAW's folder, any
   destination, the project folder or the temporary directory. The RAW's bytes
   and times are unchanged.
6. An existing entry is never replaced. Two publishes of one key leave one
   entry, and the second uses it.
7. A damaged entry is never opened: one with a wrong digest or length, a bad
   manifest, a key mismatch, a missing file or an extra file. An owned damaged
   entry is removed, and unrecognized items are left and counted.
8. Each refusal in decision 4's table shows, before the press and from Rust's
   availability answer, a focusable, `aria-disabled` View, with its reason
   linked by `aria-describedby` and its recovery button. When several hold,
   the first in table order is shown.
9. On an unmeasured build that reports its release, View works and the label
   appears everywhere decision 4 lists. On a build that does not report its
   release, View is refused.
10. While a queue awaits a destination or runs, View is refused. While a view
    runs, Add files…, Add mzML folder…, a native drop, the queue's Begin, a
    second View, the open of another preview and the removal of the RAW row are
    refused with `raw_view_busy` and Show {name}.
11. Cancel before Storing publishes nothing and leaves no staging, and ends
    `cancelled` with `stored: false`. A cancel that reaches Storing, or the new
    entry's verification, ends `cancelled` with `stored: true`, the entry
    published and nothing opened. Either copy is true of the cache.
12. Eviction keeps the cache within the cap, except by pinned entries as
    decision 9 states. It never evicts a pinned entry. It never deletes
    anything but decision 9's closed list.
13. A RAW over 1.5 GiB is refused before any work, with the limit. Short disk
    space for a miss fails the operation after Checking file and before
    Converting, with both numbers, without evicting anything and without
    offering Clear view cache.
14. A failure offers Try again only when it is retryable, and Try again repeats
    the failed request's intent. An output over 4 GiB, and an unrecognized item
    in the entry's place, are not retryable.
15. Clear view cache removes unpinned entries and reports what it kept.
    Removing the RAW row deletes nothing.
16. The Metadata tab, the figures and the data documents state the source and
    the conversion as decision 11 says. An mzML row's exports are
    byte-identical to today.
17. QC capture from a cached view is refused with `viewed_through_cache`.
18. Every state works by keyboard alone, at 960x640 and 1366x768, in `en` and
    `zh-CN`.

### 14. Tests to write

**Rust, with the fake provider:**

- the key: a golden value for fixed inputs, and a different key when any one
  input changes;
- `begin_raw_view` lowers `SHIPPED`; no request can make it lower a picker;
  `begin_raw_view_with` refuses an advanced-tier id, an unknown id and an id
  not in `rawViewIntents`;
- `rawViewIntents`: the same rows on the evidenced build and on an unmeasured
  build, with `verified: false` on every row of the latter, the default
  included; no unscoped-centroiding row;
- the refusal matrix of decision 4, one test per row, each asserting zero
  provider launches and no file created, the availability answer for each, and
  the table order when several hold;
- the failures of decision 10, one test per row, each with its `retryable`;
- the conversion slot: while a view runs, Add files…, Add mzML folder…, a
  native drop through the busy mirror, Begin, another open, a spectrum load and
  the row's removal answer `raw_view_busy`;
- the source baseline: the bind reuses Checking file's facts, and the key's
  source digest equals the baseline's;
- the build gate: the evidenced build gives no label, another release gives
  the label with its release, and a build without a release is refused;
- hit and miss: a hit launches nothing; a miss stages only under `staging`;
  the publish uses no-replace; and a filesystem snapshot of the RAW's folder
  and a destination is unchanged before and after;
- the memo: reused when identity, length and both times are unchanged; a full
  hash after any one changes; gone after row removal and Clear workspace;
- source change during the run: `raw_view_source_changed`, nothing published;
- damage: each check of decision 8 fails closed, and the entry is removed only
  when its names are MSCanvas's own; a link or junction under `entries` is left
  and counted, and nothing it points to is touched; a damaged hit converts at
  most once;
- publishing: a rename that fails other than by an existing entry gives
  `view_cache_not_stored` and no staging; an entry removed between publishing
  and verification gives `view_cache_entry_lost` and converts nothing more;
  `entry.json` is never rewritten;
- pins: an entry held by a preview or a `ready` operation is not evicted or
  cleared; the preview's pin is released by the next open, row removal and
  Clear workspace, and a `ready` operation's by the next operation, row removal
  and Clear workspace;
- eviction order by the directory's time, the cap after publishing, the bound
  above the cap with pinned entries, and the failure without eviction when
  eviction could not make room;
- the 1.5 GiB heuristic, the disk-space check through an injected free-space
  probe after Checking file and never on a hit, and an output over the
  inspector's limit published nowhere and not retryable;
- Cancel in each phase before Storing, with `stored: false` and no staging; a
  cancel that reaches Storing, and one during the new entry's verification,
  with `stored: true` and the entry published; a late Cancel of an ended
  operation;
- `open_raw_view`: once per ready operation; refused when superseded, already
  opened or the row was removed; a superseded open leaves the entry;
- the staging sweep: a gone owner's attempt removed; a live owner's attempt,
  this process included, left;
- the root: made through its creation directory with the marker; two processes
  making it at once leave one root and remove the loser's creation directory;
  a crash before the rename leaves no `view-cache`; a root without a marker
  refused and untouched; an unresolved root refused;
- exports: the six keys and the next schema version for a cached view, and
  byte-identical goldens for an mzML row; the figure `<desc>` source line;
- QC capture refused with `viewed_through_cache`.

**Frontend (Vitest):**

- the pane for every `RawViewStateDto`, Ready included, and every refusal: the
  buttons, the reason, `aria-describedby` and the label;
- Enter on a highlighted RAW row presses View, Open or Try again by state and
  nothing in any other state; a repeated keydown presses nothing; Space
  toggles selection; activating a RAW row calls nothing but
  `get_raw_view_state`;
- polling stops at a terminal state, and a reloaded document resumes;
- the open happens only for a `ready` operation whose row is still
  highlighted; otherwise Ready, with the status bar line; a `cancelled`
  operation is never opened, and its copy follows `stored`;
- Try again repeats the failed intent, and is absent when not retryable;
- View with… shows `rawViewIntents` in order, its menu keyboard, and Escape;
- the Settings row, Clear's result line, and its refusal while a view runs;
- the live-region text for each phase, the open, an unattended Ready and a
  failure;
- `en` and `zh-CN` locale parity for every new key.

**Browser end to end (mock boundary):** idle, miss, open; idle, hit, open; a
miss that becomes ready while another row is highlighted, then Open; Cancel in
Converting; a failure and Try again; refused while a queue runs, with Show
conversion; a second View refused, with Show {name}; Add files… refused while a
view runs; View with… from Viewing; and Clear view cache. Each also runs with
the keyboard alone.

**Native QA, under a bounded ProteoWizard hold release** (open question 6):

- real `msconvert` views of the two public files, `TV0`'s and `TE0`'s sources;
- times recorded for each phase of a miss and of a hit: the RAW's hash, the
  conversion, the output check, the cached copy's check and the open;
- the same for the largest public Thermo RAW under 1.5 GiB that can be found,
  or a note of the search if none is. No time budget is set before these are
  measured;
- the entry sizes;
- Cancel during Converting;
- `msaccess` opening a pinned entry;
- a second MSCanvas process evicting while the first one views.

### 15. Rendered QA checklist

Shots at 1366x768 and 960x640, in `en` and `zh-CN`, of:

- [ ] Idle, on the evidenced build, and on an unmeasured build with the label.
- [ ] Each phase, with the skeleton appearing only after 300 ms, the
  determinate bars of the checking phases, the indeterminate Converting bar
  with its elapsed time, and Cancel.
- [ ] Viewing a miss and viewing a hit: the file row, the Metadata group, and
  the profile spectrum drawn as a line (ADR 0056 slice 3).
- [ ] View with… open, with the default first and the lossy row labelled, on
  the evidenced build and on an unmeasured build with every row labelled; and
  View with… in the Viewing file row.
- [ ] Each refusal of decision 4, with its reason and its recovery button.
- [ ] Failed, retryable with Try again and not retryable without it; Cancelled.
- [ ] Ready, after moving away during a miss and after returning to the row,
  with the status bar line.
- [ ] The status bar's busy text on the Conversion and Project screens; the
  queue's Begin and Add files… refused with Show {name}.
- [ ] Settings: the View cache row, Clear's result line, and Clear refused while
  a view runs.
- [ ] A long RAW name truncated in the middle in the pane, the status bar and
  the reasons (design goal W7).
- [ ] Keyboard only, through the whole of decision 1's path, with the focus
  visible at every step.
- [ ] No horizontal page scroll, no clipped label, text contrast of at least
  4.5:1, and focus rings, icons and field edges of at least 3:1.
- [ ] A screen reader hears each phase once, the open once, and a failure once.

### 16. Delivery order and dependencies

**Dependencies:**

- **ADR 0056 slices 2 and 3.** Without the native reader, a view of a profile
  file is `msaccess`'s sticks with "representation not reported", which defeats
  much of the purpose. This feature follows them.
- **ADR 0055's build gate** (draft PR #156) for the unverified label. Until it
  merges, View exists on the evidenced build only, as vendor conversion does
  today.
- **The interface direction (open question 8), for slice 3 only.** Decision 1's
  pane, its layout and the narrow-width keyboard path follow direction A, which
  the owner has not chosen (plan section 9). Today's roster activates mzML rows
  only, and its primary buttons are Add files and Preview again, not Convert N
  checked…. Slice 3 starts once questions 1 and 8 are answered.
- ADR 0057 decision 1 is not a dependency. It only lets another open preview
  stay readable while a view converts.

**Slices:**

1. **The cache library, no UI.** The root and its marker, the key, the manifest,
   verification, publishing, the pins, eviction, Clear and the staging sweep,
   with their Rust tests.
2. **The operation and the commands.** ADR 0011's coordinator with the cache as
   destination, the phases, the memo, Cancel, the refusals, the boundary of
   decision 12, `viewSource` and QC capture's refusal, with the fake-provider
   tests.
3. **The interface,** once open questions 1 and 8 are answered. The pane, View
   with…, the progress, the status bar, the Settings row, every refusal, `en`
   and `zh-CN` resources, Vitest, browser end-to-end tests and rendered QA.
4. **Export provenance.** The figure source line and the data documents' keys
   and schema versions, with golden tests.

Native QA follows slice 3 under its own hold release.

## Slice 2 notes (2026-10-30)

Dated notes of 2026-10-30, written with slice 2 (the operation and its
commands, branch `be/viewraw-op`). Where a note departs from a decision above,
it says so; the decisions stand otherwise.

1. **What is implemented.** `begin_raw_view`, `get_raw_view_state`,
   `cancel_raw_view`, `open_raw_view`, `describe_view_cache` and
   `clear_view_cache` (decision 12); the phases of decision 3; the refusals of
   decision 4 that need no process; the view as a holder of the conversion
   slot (decision 5); the failures of decision 10; and Cancel in every phase.
   Progress is read by polling `get_raw_view_state`, as decision 12 says; there
   is no event channel. The commands are registered, and no webview calls them
   until slice 3.
2. **Two cases slice 1 left open. Accepted by the owner, 2026-10-30 (A0060).**
   - A check that could not be made (`Lookup::Unreadable`), and a damaged
     entry that could not be removed (`Lookup::Damaged { removed: false }`),
     end the operation `failed` with `view_cache_entry_unavailable`, retryable,
     before anything is converted. Neither is treated as a miss and neither as
     damage: converting would publish into a place that is still held, and
     removing what could not be checked could remove a sound entry another
     process is reading. The same code answers when a place found occupied at
     publishing is in either state.
   - An attempt that a sharing refusal keeps from being removed after
     `view_cache_not_stored`, for example while a scanner still reads the new
     file, stays in `staging` until a later session's sweep removes it,
     because decision 6's sweep leaves this process's attempts alone. Nothing
     is published from it and nothing reads it.
3. **The output's name inside the attempt departs from decision 6 while the
   run lasts.** The view conversion uses the existing plan
   (`ConversionPlan::to_mzml`), which names its output after the RAW, so
   `msconvert` writes `<RAW stem>.mzML`, and its staging area, inside the
   attempt directory. Checking output renames that file to `entry\view.mzML`
   through the handle it was checked with, so no published name comes from the
   user's file. A RAW whose name the plan cannot stage fails with
   `conversion_not_plannable`. Follow-up: a plan with a fixed output name, once
   `be/integrate` (PR #161) has reshaped `ConversionPlan`. That PR also makes
   `plan_conversion` take a bound intent; since the merge of 2026-10-31 the
   view's call passes `BoundIntent::Row(SHIPPED)` and never an advanced
   intent. Accepted by the owner, 2026-10-30 (A0060).
4. **Hashing. A miss reads the RAW in full four times.** Checking file is the
   conversion crate's own admission
   (`ConversionSource::open_thermo_raw_file_reporting`), read in chunks with
   Cancel asked before each, so its digest is the key's and the run's baseline
   and the bind does not hash the RAW again (decision 7). That one read is
   also the row's re-acceptance (`revalidate_thermo_raw_reporting`), so
   nothing reads the RAW before the bar, and Checking output re-accepts the
   row the same way. Inside Converting,
   the run reads it twice more, each in one read with no progress and with
   Cancel answered only after it: its pin rehashes it before `msconvert`
   starts, and its post-run judgement (`revalidate_source`) rehashes it after.
   Checking output then reads the output
   (`FinalizedOutput::still_matches_reporting`) and the RAW again under one
   bar, which also covers the time between that judgement and the publish.
   Decision 7 meant the post-run read to be Checking output's own. A
   reporting, cancellable form of the crate's post-run revalidation would
   remove one read; it waits until PR #161 has reshaped the crate's run. Until
   then this is a known ceiling: up to 1.5 GiB read twice with no bar.
5. **The key's intent line** is `ConversionIntent::SHIPPED.stable_id()`. PR
   #161 has merged; moving it to the structured intent's canonical
   serialization, with the key's version line (decision 7), is still to do.
6. **Deferred, each with its reason.**
   - `backend_not_found` and `provider_build_not_evidenced` need the help
     probe, so they end the operation `failed` once its worker has bound the
     build, before the RAW is read, instead of refusing the press.
     `get_raw_view_state` takes no handle and answers no
     `RawViewAvailabilityDto` yet; slice 3 adds both.
   - `begin_raw_view_with` and `rawViewIntents` wait for PR #161's structured
     intents.
   - `PreviewDto.viewSource` and the typed `viewed_through_cache` refusal come
     with slice 3. Until then a cached view retains no run-summary token, so a
     QC capture from it fails closed.
   - The same-session digest memo is not built: every View hashes the RAW in
     full, which is the safer side of decision 7.
   - A native drop while a view runs is refused through the busy mirror with
     the queue's `conversion_busy` drop state, because that state is a
     webview-visible transfer object. Every other route of decision 5 answers
     `raw_view_busy`.
7. **ADR 0056 decision 3 for a Thermo RAW row, as implemented.**
   `open_mzml_preview` and `load_selected_spectrum` still refuse a vendor row
   with `dataset_not_previewable`. Only `open_raw_view` opens one, and every
   read of that preview goes to the pinned entry: `msaccess`'s metadata and
   run summary, and, since the merge with PR #175 on 2026-10-31, the native
   reader's table and selected spectrum (ADR 0056), so no spectrum of a
   cached view is read by `msaccess`. Neither that open nor a spectrum load
   re-admits or hashes the RAW: View re-accepted the row, and the pin and the
   entry's generation stand in (decision 12). The next open of any row ends
   that preview and its pin through ADR 0056 decision 4's open ticket: an
   open's start drops every other row's retained preview, and a viewed open
   that a newer open has passed installs nothing and answers
   `selection_superseded`. A viewed open passes the same ticket check as any
   open and installs its chromatogram, but retains no run summary (decision
   11). The ticket replaced the workspace's own record of the latest open.
   `a_miss_converts_the_verified_default_publishes_once_and_opens_the_entry_not_the_raw`
   fails if a native read of a viewed row takes the RAW's path, or if a
   viewed open retains a token or a producer.
8. **After review (2026-10-30).** The items marked as pending await the
   owner's confirmation; the rest follow decisions above.
   - **The wire, beyond decision 12.** `running` also carries
     `cachedCopyDamaged` (decision 8's notice). `failed` carries
     `neededBytes` and `freeBytes` for `view_cache_no_space`, and null for
     every other code. `ready` carries `openable`, true only while the row
     holds the operation's pin: an open, a superseded or failed open, the
     row's removal, Clear workspace and the next View each make it false.
     `open_raw_view` answers `raw_view_not_ready` (not retryable) for an
     operation that is not `ready` and `openable`. The row's pin carries its
     operation, so a late open of an older operation never takes a newer
     View's entry.
   - **`view_cache_unreadable`, retryable (pending).** The cache's folders
     could not be listed (the summary's `unreadable`), or the free space on
     its volume could not be read. It never claims the disk is full. That
     answers View, its eviction and Clear view cache alike.
     `view_cache_entry_unavailable` stays for one entry that could not be
     checked or removed, including the entry this operation just published,
     which then stays for the next View to check.
   - **Cancel and the end of the work (pending).** Once the work has reached
     a pinned entry, the operation settles under the slot lock. A Cancel
     accepted before that ends it `cancelled`, with its `stored`, and
     releases the pin. A Cancel after it is a late press, and the operation
     ends `ready`. Storing, too, is entered under the slot lock Cancel takes,
     so a Cancel accepted before it, also one after Checking output's last
     chunk, ends `cancelled` with `stored: false` and publishes and evicts
     nothing, as decision 10 says.
   - **An unconfirmed end of `msconvert`,** a cancellation that could not be
     confirmed or a run that leaves its process unaccounted for, quarantines
     the backend and keeps the attempt, marker and all, for a later
     session's sweep, as targeted MS1 keeps its work area. A run's residue
     alone does not keep it: the sweep would remove it the same way.
   - **Failures the run itself finds.** A RAW that the run's pin or its
     post-run judgement finds changed answers `raw_view_source_changed`
     (retryable), and an output over the document limit answers
     `view_cache_entry_too_large` (not retryable), as decision 10's table
     says. Every other run failure answers the crate's failure identifier
     (`stable_id`), which is what a queue item's `outcome` carries and what
     the webview reads. The detailed identifier stays with Convert this
     file…'s diagnostics.
   - **The 1.5 GiB limit is also asked of the length Checking file finds,**
     before its first chunk, so a RAW that grew after it was added is refused
     without being read.
   - **Retry of a terminal queue answers `raw_view_busy` while a view runs.**
     With Begin's refusal, no queue runs beside a view, so Cancel and clear
     has one holder to stop.
   - **Clear view cache holds the workspace mutation gate (pending)** that
     `begin_raw_view` takes the slot under, so no View begins between Clear's
     check and its removal. A workspace mutation waits for a Clear meanwhile.
   - **View begins after an accepted native drop,** as a queue does, so the
     slot never turns that drop's commit into a refusal.
   - **The entry points PRs #161 and #179 added (2026-10-31 merge).** Begin
     with a structured intent (ADR 0055) is the same Begin and answers
     `raw_view_busy` before the intent is read. Planning one and the four
     preset commands stay allowed, as composing conversion settings is
     (decision 5): they take no slot, no gate and no row. Per-output adoption
     (ADR 0052) shares the queue-wide action's body and takes no new guard.
   - **The next open of any row ends a cached view and its pin when that open
     is accepted,** not when it commits, so an open that then fails does not
     leave a preview off screen holding an entry. Since the merge with PR #175
     this is ADR 0056 decision 4's ticket, taken with the other rows' previews
     dropped under one hold, and only the latest open commits, so a viewed
     open that was still reading when the other began installs nothing.
   - **Dated notes** are written in ADR 0005, ADR 0006, ADR 0012, ADR 0056
     decision 3 and ADR 0057 decision 2. ADR 0043 (CNV-D8) and ADR 0055 take
     theirs with slice 3, whose interface shows the progress and the reuse.

## Alternatives rejected

- **Activating the row converts it** (the accepted wording read literally).
  Moving through the roster, or highlighting a row to remove it, would start a
  minute-long conversion that holds the conversion slot. This is open question 1,
  because it departs from that wording.
- **Hashing on highlight and opening a hit at once.** Every row passed would be
  read whole, from a share as well. A same-session repeat view on highlight,
  through the memo, is open question 3.
- **The vendor-centroided row as the view default.** It is smaller and faster,
  but it is implicit centroiding.
- **The cache in the RAW's folder, a destination, the project folder or the
  temporary directory.** The first two write where the user did not ask, which
  the owner ruled out. A project is not always open. A temporary-directory
  cleaner can delete an entry while it is in use, and an operating-system
  folder carries no MSCanvas ownership.
- **Adopting the converted file as a roster row.** Adoption is explicit (ADR
  0016), and a second row for one acquisition would split its identity.
- **Path, size and modification time as the source's identity.** The lease
  shares write, and a rewrite in place keeps the path.
- **Running a view after a running queue, or superseding a running view.** The
  first is hidden pending work that can last hours. The second throws away
  work without asking.
- **Another reader when ProteoWizard is missing**, such as ThermoRawFileParser
  or an open decoder. ADR 0059 decision 5 rules out silent substitutes, and
  either would need its own decision.
- **A user-adjustable cap now.** It needs a preference schema change that the
  store refuses rather than migrates (open question 2).
- **Diagnostics for a failed view now.** Convert this file… already gives
  RUN-009's export for the same file.

## Consequences

**What it gives:** a Thermo RAW file is viewable in two actions, with no
settings, no folder and no file left behind. The view is scientifically the
verified default, and it says so.

**What it costs:**

- **Disk:** up to 10 GiB by default on the volume holding the application
  data, usually the system volume, plus the transient bound of decision 9.
- **RAW files over 1.5 GiB cannot be viewed this way.** The heuristic comes
  from the 4 GiB document limit the inspector and the viewing reader share
  (`MzmlScanLimits`, ADR 0056 decision 2), and default outputs measured at 1.92
  and 2.30 times their source. A RAW under it can still produce an output over
  the limit, which fails after the conversion. Long Orbitrap and Astral runs
  can exceed it. Convert this file… stays their route (open question 7).
- **Time:** a first view of a 276 MB RAW takes about a minute of conversion
  (`TE0`: 63.6 s) plus the hash and the open. A hit costs the RAW's hash (none
  on a memo hit), the cached copy's hash and the open. Near the size limit, the
  cached copy can be close to 4 GiB; scaled by bytes from M0's run summary
  (3,160 ms on 208 MB, ADR 0056), `msaccess` alone would take about a minute,
  an estimate. Neither is measured end to end yet; native QA records both.
- **A busy slot:** a view operation holds the conversion slot, so it blocks a
  queue's Begin, adding files and the open of other previews for its duration,
  hashes included. A running queue blocks View.
- **More lifetime handles:** the open entry is pinned, and is not deletable
  while it is viewed; so is a `ready` entry until it is opened or dropped.

**Risks:**

- **"Viewed" read as "verified."** On an unmeasured build every view carries
  the label, in the viewer and in every export.
- **The two residuals of decision 7:** a rewrite in place that restores the
  length and both times, and a vendor reader replaced under an unchanged
  `msconvert.exe`.
- **`msaccess` against a pinned file** is not measured.
- **Large runs:** a RAW above 100,000 spectra opens as a prefix with no
  chromatogram (ADR 0056 decision 5), as any mzML of that size does.

## What this amends

**Now:**

- [The feature catalog](../../product/FEATURE_CATALOG.md): VIEW-009, Designed.
- [The after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md): section 2's
  decision 5, section 3's ADR numbers, the backlog, and section 9's note that
  the interface slice waits on the direction.

**In the change that implements each decision, by dated notes:**

- [ADR 0005](0005-mzml-preview-boundary.md), M3.1's amendment, and ADR 0056
  decision 3's "Vendor rows stay `dataset_not_previewable`": a Thermo RAW row is
  previewable through a ready view operation, and in no other way.
- [ADR 0056](0056-project-owned-mzml-reader-for-viewing.md) decision 4: the
  pin is an exception to "No read holds a file handle", for cache entries only.
- [ADR 0056](0056-project-owned-mzml-reader-for-viewing.md) decision 3: for a
  cached view the open reads the pinned entry, the pin stands in for the row
  file's `lock_against_replacement`, and the `SourceGeneration` check is made
  against the entry (decision 12).
- [ADR 0057](0057-conversion-capacity-and-viewing-during-conversion.md): a view
  conversion is a conversion for decisions 1 and 2 and for the safety argument.
  In its "Staging ownership" item, "A native read opens only a roster row's own
  file" gains one exception: the pinned cache entry of a `ready` view
  operation, which is published and verified, never a staging directory.
- [ADR 0012](0012-first-visible-thermo-conversion.md), "Rust enforces the
  concurrency rules": a view operation holds the conversion slot, and the
  refusals it lists answer `raw_view_busy` while the holder is a view
  (decision 5).
- [ADR 0043](0043-conversion-completion-route.md) CNV-D8 (LOCKED): the view
  pane, and only it, may show a determinate bar of bytes MSCanvas itself reads
  and the elapsed time of a running view. The `msconvert` phase still shows no
  fraction and no estimate, and the queue's progress is unchanged (decision 3).
- [ADR 0006](0006-multi-dataset-workspace-boundary.md): a RAW row's preview
  state is backed by a cache entry, and the row keeps its lease, its handle and
  its identity.
- [ADR 0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md)
  decision 2: the cache's reuse of an existing entry is not a conflict policy,
  because a view has no destination.
- [Primary workflows](../../product/PRIMARY_WORKFLOWS.md) WF-003, and
  [interaction budgets](../../product/INTERACTION_BUDGETS.md): the Thermo RAW
  path and its budget row.
- The beta's install and support page, which lists what the application data
  folder holds.

## Open questions for the owner

None blocks slices 1 and 2. Questions 1 and 8 gate slice 3: its work starts
once the owner has answered them, and their defaults are recommendations, not
answers. Every other question has a recommended default, which stands unless
the owner chooses otherwise.

1. **The entry point (gates slice 3).** The accepted wording is "Selecting a
   Thermo RAW row to view converts it". This record recommends a View button,
   so that activating a row starts nothing (decision 1). Converting on
   activation is the other reading; its cost is under Alternatives rejected.
   *Recommended: the View button.*
2. **A user-adjustable cap.** It needs a preference record schema 2, and the
   store refuses another schema rather than migrating it, so preferences written
   by a later build would read as unsupported in an earlier one. *Default: the
   10 GiB constant.*
3. **A same-session repeat view on highlight.** With a memo hit and an existing
   entry, a highlighted RAW row could open at once, as an mzML row does, at the
   cost of the cached copy's hash and the open on every highlight. *Default: no;
   View is pressed every time.*
4. **Project provenance for cached views.** Recording a cached view in the
   project, with the source digest, the build and the intent, needs a project
   schema change beyond the one accepted on 2026-10-29. *Default: QC capture
   from a cached view is refused, and Convert this file… then Add output is the
   route.*
5. **"Save a copy as mzML…" from the cache.** It would be a second finalization
   path beside the queue's. *Default: none; Convert this file… is the route.*
6. **A bounded ProteoWizard hold release for native QA:** `msconvert` and
   `msaccess` on the two public files and on the largest public Thermo RAW
   under 1.5 GiB that can be found, plus a cancel and a two-process eviction
   check (decision 14). Without it, the slices merge on fake-provider and
   browser evidence, and the timings stay unmeasured.
7. **Viewing RAW files over 1.5 GiB.** Raising the 4 GiB document limit of the
   inspector and the viewing reader would amend ADR 0056 decision 2, whose caps
   are a resource contract. *Default: the limit stays, and such files go
   through Convert this file….*
8. **The interface direction (gates slice 3).** Plan section 9 still lists
   which demo direction the interface follows. Decision 1's pane, the
   narrow-width keyboard path and the progress forms are written for
   direction A; those progress forms amend LOCKED CNV-D8 for the view pane
   (What this amends), which the owner confirms with the direction.
   *Recommended: direction A.*
