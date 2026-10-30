# ADR 0060 — One-click view of a Thermo RAW file through an MSCanvas-owned conversion cache

Status: **Accepted** by the owner on 2026-10-30. The owner accepted the feature
that day ([ADR 0059](0059-vendor-format-strategy-official-readers-thermo-first.md),
decision 2, "One-click view RAW";
[after-beta-1 plan, section 2](../../development/AFTER_BETA1_PLAN.md#2-owner-decisions-2026-10-28),
decision 5 of 2026-10-30) and asked that its details follow the
recommendations. This record states them. Nothing here is implemented. The
questions still open for the owner are listed
[at the end](#open-questions-for-the-owner); none of them blocks the first
slice.
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
local scratch build and is not committed. The design-goal identifiers cited
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

A profile view of a 276 MB RAW therefore costs about a minute of `msconvert`
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

- **Activating a RAW row never starts work.** Clicking it, or moving through
  the roster, highlights it and shows this pane. It hashes nothing and converts
  nothing. Browsing forty RAW rows must not start forty conversions of a minute
  each, and highlighting a row in order to remove it must not start one.
- **View** starts the one-click operation (decision 2). It is the first button
  of the pane.
- **View with…** opens a menu of other verified rows (decision 2).
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

1. Move to the row and activate it with Enter or Space. It is highlighted, and
   nothing starts.
2. Press Enter again on the highlighted RAW row. That presses View. This is a
   new rule for RAW rows only: Enter on a row that is already highlighted
   means "view it". Or Tab to View and press Enter or Space.
3. View with… opens with Enter, Space or Down. Up and Down move, Enter chooses,
   and Escape closes the menu and returns focus to its button.
4. While the operation runs, focus stays where it was, so the roster stays
   usable. Cancel is reachable by Tab in the pane.
5. When the view opens, focus does not move, as when an mzML row opens.

**Live regions.** A polite live region announces each phase change and the
open ("QC_pool_01.raw is open."). A failure is announced through
`role="alert"`, once. The elapsed-time counter is not announced.

### 2. What one click runs: the verified profile default, never a picker

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
- **View with… is the explicit choice.** Its menu lists the verified rows that
  Rust offers for this source, in table order:
  - The default comes first, marked Default.
  - Only rows whose source domain covers Thermo RAW and whose output format the
    viewer reads, which today means mzML.
  - A lossy row says what it loses, in ADR 0055's words, for example "Lossy:
    replaces profile peaks with centroids" or "Lossy: removes spectra".
  - Advanced-tier intents are not in the menu. That includes "MS2 and up"
    vendor centroiding while it stays labelled. They go through Conversion.
  - The choice applies to that one view. It is never remembered, and View
    never starts from it. This is ADR 0058's reasoning against restoring a
    last-used preset: a lossy step must not come back without being chosen.
- **Each intent is its own cache entry** (decision 7). A centroided view and the
  profile view of one file are two entries, and View finds only the profile one.

### 3. The states, and what each one shows

The pane for the RAW row shows one of these states. The status bar shows the
running operation from every screen as text, "Preparing QC_pool_01.raw for
viewing 0:42", in the busy slot the conversion queue uses.

| State | Pane | Buttons |
| --- | --- | --- |
| **Idle** | The one line of decision 1 | View, View with…, Convert this file… |
| **Checking file** | The plot frames of direction A's reading state, with skeletons after 300 ms, and one line: "Checking QC_pool_01.raw" with a determinate bar of bytes read | Cancel |
| **Checking cached copy** | As above: "Checking the cached copy" with a determinate bar | Cancel |
| **Converting** | As above: "Converting QC_pool_01.raw for viewing", the elapsed time, and an indeterminate bar | Cancel |
| **Checking output** | As above: "Checking the converted file", with a determinate bar | Cancel |
| **Storing** | As above: "Storing the converted file", with no bar. It is one rename (decision 8) | Cancel, which waits for the rename |
| **Opening** | Direction A's reading state, unchanged: "Reading QC_pool_01.raw…" | Cancel, as for any read |
| **Viewing** | The tabs Chromatogram and spectrum, Scans and Metadata, as for an mzML row. The file row shows the RAW's name and, when the intent is not the default, its summary, such as "Vendor centroiding, MS1 and above" and "Lossy" | The viewer's own |
| **Failed** | What broke, and why, in at most two lines | Try again (runs View again), Convert this file… |
| **Cancelled** | "Cancelled. Nothing was kept." until the next action | View, View with…, Convert this file… |
| **Refused** | View stays focusable with `aria-disabled` and its reason below it, linked by `aria-describedby` (decision 4) | The recovery the reason names |

- **Progress claims only what MSCanvas measures.** M6.8 (CNV-D8) allows no
  percentage, estimate or fraction of an item that the provider does not
  report. The three checking phases are MSCanvas's own reads, so bytes read
  out of the file's length is a real fraction. `msconvert` reports nothing, so
  Converting shows an indeterminate bar and the elapsed time, and no estimate
  of the time left.
- **A cache hit** runs Checking file, Checking cached copy and Opening. A miss
  runs Checking file, Converting, Checking output, Storing and Opening. A phase that
  ends within 300 ms shows nothing (design goal I8).
- **The open is not part of the operation.** When the operation is ready, the
  webview opens it only if the RAW row is still the highlighted row
  (`open_raw_view`, decision 12). If the user has moved to another row, the
  converted entry stays in the cache, and View on the RAW row later is a hit.
  The open never takes the screen from what the user is looking at.

### 4. Refusals: the build gate, and no fallback

View is refused, before any work, in each of these states. Each refusal has a
typed code. Each reason says what would make View possible, and any recovery it
names has a button (design goal S4).

| Condition | Code | Reason (en, proposed) | Recovery |
| --- | --- | --- | --- |
| No usable ProteoWizard | `backend_not_found` (existing) | "ProteoWizard is not available." | The backend surface's own actions, such as Choose ProteoWizard folder… |
| Backend quarantined (ADR 0015) | `backend_quarantined` (existing) | The quarantine reason, as today | The quarantine's own recovery |
| The build does not report its release | `provider_build_not_evidenced` (existing; ADR 0055's gate) | "This ProteoWizard does not report its release, so it cannot convert vendor files." | Choose ProteoWizard folder… |
| A conversion queue is awaiting a destination or running | `conversion_busy` (existing) | "A conversion is running." | Show conversion |
| Another view is being prepared | `raw_view_busy` | "Preparing {name} for viewing." | Show {name}, whose pane has Cancel |
| The row is not a Thermo RAW row | `raw_view_unsupported_source` | Not shown: the pane has no View for such a row | none |
| The cache has no folder (decision 6) | `view_cache_unavailable` | "MSCanvas has no folder for its view cache on this computer." | Convert this file… |
| The cache folder exists but carries no MSCanvas marker | `view_cache_root_unrecognized` | "The view cache folder was not made by MSCanvas, so MSCanvas will not write to it." | Convert this file… |
| The RAW is larger than half the entry ceiling (decision 9) | `view_cache_entry_too_large` | "This file is too large to view through the cache." | Convert this file… |
| Not enough free disk space (decision 9) | `view_cache_no_space` | "The view cache needs about {n} GiB free; {m} GiB are free." | Clear view cache, Convert this file… |
| The intent sent by View with… is not one Rust offers now | `raw_view_intent_not_offered` | "That setting is not available for this file now." | View |

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
- The reason is "A conversion is running.", and Show conversion takes the user
  to the queue and its Stop controls.
- **Not recommended: running the view after the queue.** Queue membership is
  fixed at Begin (ADR 0013). A private cache item does not belong in a queue
  that writes to the user's destination. A queue can hold 1,024 items and run
  for hours (ADR 0057 decision 3), and a click that silently waits that long is
  worse than a refusal that says why.

**A view conversion is a conversion.** It holds the backend gate from Checking
file until it is terminal, as a queue does. While it runs:

- Begin of a conversion queue is refused, with "Preparing {name} for viewing."
  and Show {name}. Composing settings is still allowed.
- Opening any other preview is refused, as during a queue (ADR 0057
  decision 2). A row whose preview is already retained is still shown, and its
  selected spectra stay readable natively once ADR 0057 decision 1 ships.
- The RAW row being prepared cannot be removed, as the converting row of a queue
  cannot (ADR 0012). Clear workspace treats the operation as active work, with
  the choices WSP-007 already gives: Remove non-running, Cancel and clear, and
  Return.

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

**Ownership marker.** MSCanvas creates the root itself, with create-new
semantics, and writes `.mscanvas-view-cache-owner` into it. The marker holds a
constant, `mscanvas-view-cache\n`, as the staging marker does: it proves which
program made the folder, not which run.

- A root that exists without the marker, or whose marker reads otherwise, is
  not MSCanvas's. View is refused with `view_cache_root_unrecognized`, and
  nothing under it is read, written or removed.
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
  (canonical path, identity, generation). It then hashes the file through
  Windows CNG, in chunks, with Cancel checked between chunks. This is the
  Checking file phase.
- **On a miss the hash costs nothing extra.** The conversion's own source capture
  (`capture_conversion_source`) is that hash, and `revalidate_source` rehashes
  after the run as it does today. A mismatch fails the operation with
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
   `entry\entry.json` is written beside it (decision 9 lists its fields).
5. Room is made under the cap (decision 9).
6. `entry` is renamed to `entries\<key>` with no replacement (`MoveFileExW`
   without `MOVEFILE_REPLACE_EXISTING`). The attempt directory is then removed.

**Never overwriting.** If `entries\<key>` already exists, for instance because
another MSCanvas process published the same key first, the rename fails.
MSCanvas then verifies the existing entry (below) and uses it, and discards its
own staged copy. If the existing entry is damaged, it is removed and the rename
is tried once more. No entry is ever replaced in place, and no file outside the
cache is ever written. ADR 0055's Fail and Skip policies are not involved,
because there is no destination: an existing entry with the same key holds the
same source, build and intent.

**Every entry is verified before it is opened, hit or not.**

- `entries\<key>` is a plain directory holding exactly `entry.json` and
  `view.mzML`, compared ignoring case.
- The manifest parses as schema 1, refusing unknown fields, within 16 KiB.
- The manifest's key inputs hash to the directory name and equal the request's.
- `view.mzML` is a regular file whose byte length and SHA-256 equal the
  manifest's. It is hashed through the pin handle below, so the bytes hashed
  are the bytes then opened.

**A damaged entry is never opened.** An entry that fails any check but still
carries only MSCanvas's fixed names is removed. The operation then continues as
a miss, and its phase line says "The cached copy was damaged and was removed."
Converting again with the same build and intent is the same operation, not a
fallback, and the user sees that it happens. Anything else under `entries`
is left exactly as found and counted as unrecognized: a link, an unknown name,
or a directory not named by a key. If such a thing blocks the key, View is
refused with `view_cache_root_unrecognized`.

**A pin keeps an entry from being evicted while it is read.** From verification
until its preview state ends, the operation holds `view.mzML` open with read
access, sharing read only, without write or delete sharing.

- **When it ends:** the preview state ends at the next open (ADR 0056 decision
  4 keeps one preview at a time), when the RAW row is removed, when the
  workspace is cleared, and when the session ends.
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

- **Basis:** about twenty profile views of `TE0`'s size (528,766,200 bytes
  each).
- It is shown, and not editable, in the cache's summary in Settings. A
  user-adjustable cap would add a field to the preference record, whose store
  refuses another schema rather than migrating it (M7.5). That is left to the
  owner (open question 2).

**The per-entry ceiling is 4 GiB,** the document limit of the mzML inspector and
of the viewing reader (`MzmlScanLimits`). A larger output fails the output
checks anyway, and the reader could not open it.

- **Before any work**, a RAW larger than 2 GiB is refused with
  `view_cache_entry_too_large`. Both measured profile outputs are at least 1.9
  times their source. The recovery is Convert this file… to a folder the user
  chooses, which has no cap.
- **After the run**, an output that fails the inspector's size limit fails the
  operation with the same code, and nothing is published.

**Disk space is checked before a miss converts.** The check reads the cache
volume's free space available to the caller (`GetDiskFreeSpaceExW`, as ADR 0049
does for its work area). It requires three times the RAW's size, plus a 2 GiB
reserve. The factor covers both measured ratios with margin. The reserve keeps
the volume usable for everything else.

- If space is short and evicting every unpinned entry on that volume would make
  enough room, the least recently opened entries are evicted until it fits.
- Otherwise View is refused with `view_cache_no_space`, without evicting
  anything. The reason gives both numbers, with Clear view cache and Convert
  this file… as the recovery.
- **If the disk fills during the run anyway,** the conversion fails as any
  conversion does. The attempt's staging is removed, nothing is published, and
  the failure says how much space is free on the cache drive.

**Eviction order:** least recently opened first, by the manifest's
`lastOpenedAt`, then `createdAt`, then the key.

- `lastOpenedAt` is rewritten at each open through `publish_through_temporary`.
  If that rewrite fails, the view still opens: the order is advisory and holds
  no data.
- Entries of an older key version, or of another build, are evicted by the same
  order. Nothing is special-cased.
- **Before publishing**, unpinned entries are evicted until the total plus the
  new entry fits the cap. Pinned entries are never evicted. If pinned entries
  alone keep the total above the cap, the new entry is still published. The
  cache then stays above the cap until those pins end, by at most the size of
  the pinned entries. That is one entry per running MSCanvas preview.

**What eviction and Clear may delete is closed:**

- `entries\<key>\view.mzML`, `entries\<key>\entry.json`, then the empty
  `entries\<key>` directory, for a key-named plain directory under the marked
  root;
- an attempt directory under `staging` whose owner is gone (decision 6).

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
- `createdAt`, `lastOpenedAt` (UTC).

It holds no path and no file name. Whether the entry is verified is not stored.
It is derived at each open from the provider digest, the intent and the source
kind, with this build's tables.

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
- It is offered again as the recovery of `view_cache_no_space`.

**Workspace removal deletes nothing.** Removing the RAW row, or clearing the
workspace, releases its lease, its memo and its pin. It deletes neither the RAW
nor its cache entries. The entries age out under the cap.

### 10. Cancellation and failure

**Cancel** is one button in the pane, bound to the exact operation id. A late
press after the operation ended is a no-op that answers the current state.

| Phase | What Cancel does |
| --- | --- |
| Checking file, Checking cached copy, Checking output | Stops MSCanvas's own read at the next chunk |
| Converting | The queue's request-only cancellation of the `msconvert` tree (ADR 0014, ADR 0015) |
| Storing (the rename) | Not cancellable. It is one rename, and Cancel waits for it |
| Opening | The read's existing Cancel, with its supersession rules |

- After a cancel, the attempt's staging is removed by identity-bound cleanup and
  nothing is published. The pane says "Cancelled. Nothing was kept."
- **An unconfirmed termination quarantines the backend for the session**, as for
  a queue item (ADR 0015). View, conversion and preview reads are then refused,
  with the quarantine's own reason.

**A failure** shows its typed cause in at most two lines, with two buttons:

- **Try again** runs View again;
- **Convert this file…** is the route with full diagnostics.

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
  32-bit, zlib, no peak picking";
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
| `get_raw_view_state` | none | `RawViewStateDto` |
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
- `ready`: `operation`, `handle`, `cacheHit`, `unverifiedBuildRelease`;
- `failed`: `operation`, `handle`, `code`, `message`, `retryable`;
- `cancelled`: `operation`, `handle`.

`unverifiedBuildRelease` is a string or null, the wire name draft PR #156 uses
for the same fact.

- **Opening.** `open_raw_view` opens only a `ready` operation's entry, and only
  once. It refuses an operation that is superseded, already opened, or whose
  row was removed. The open goes through the ordinary preview path:
  - the open ticket and supersession of ADR 0056 decision 4;
  - `msaccess` for metadata and the run summary, and the native reader for the
    table and spectra;
  - generation checks against the entry.

  The retained `DatasetPreviewState` belongs to the RAW row, so
  `load_selected_spectrum(handle, index)` and every export command keep their
  signatures. A `ready` operation that is not opened is dropped when the next
  operation begins.
- **`PreviewDto` gains `viewSource`**, null for an mzML row, otherwise
  `{ kind: "viewCache", sourceFileName, sourceKind, sourceSha256,
  providerRelease, providerSha256, intentId, intentSummary, verified,
  convertedAt }`.
- **The configuration read (ADR 0044) gains `rawViewIntents`.** It lists the
  verified rows View with… may offer, in table order with the default first:
  each row's id, summary, lossy statement and verified flag. Rust refuses any
  other id.
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
   nothing. A test counts zero provider launches and zero source reads.
2. View converts with `ConversionIntent::SHIPPED` and no other intent. The argv
   is the source, then `--mzML --zlib`, then the staging output, with no
   `--filter`. The default request type has no intent field.
3. View with… lists only the rows in `rawViewIntents`: the default first, and
   lossy rows labelled. The choice is never remembered, and the next View is
   the default again.
4. A miss shows the phases of decision 3 and opens the view if the row is still
   highlighted. A hit launches no `msconvert`.
5. Nothing is written outside `view-cache`: not in the RAW's folder, any
   destination, the project folder or the temporary directory. The RAW's bytes
   and times are unchanged.
6. An existing entry is never replaced. Two publishes of one key leave one
   entry, and the second uses it.
7. A damaged entry is never opened: one with a wrong digest or length, a bad
   manifest, a key mismatch, a missing file or an extra file. An owned damaged
   entry is removed, and unrecognized items are left and counted.
8. Each refusal of decision 4 shows a focusable, `aria-disabled` View, with its
   reason linked by `aria-describedby` and its recovery button.
9. On an unmeasured build that reports its release, View works and the label
   appears everywhere decision 4 lists. On a build that does not report its
   release, View is refused.
10. While a queue awaits a destination or runs, View is refused. While a view
    runs, the queue's Begin, a second View, the open of another preview and the
    removal of the RAW row are refused, each with its reason.
11. Cancel in each phase publishes nothing and leaves no staging.
12. Eviction keeps the cache within the cap, except by pinned entries as
    decision 9 states. It never evicts a pinned entry. It never deletes
    anything but decision 9's closed list.
13. A RAW over 2 GiB, and short disk space, are refused before any work, with
    their numbers.
14. Clear view cache removes unpinned entries and reports what it kept.
    Removing the RAW row deletes nothing.
15. The Metadata tab, the figures and the data documents state the source and
    the conversion as decision 11 says. An mzML row's exports are
    byte-identical to today.
16. QC capture from a cached view is refused with `viewed_through_cache`.
17. Every state works by keyboard alone, at 960x640 and 1366x768, in `en` and
    `zh-CN`.

### 14. Tests to write

**Rust, with the fake provider:**

- the key: a golden value for fixed inputs, and a different key when any one
  input changes;
- `begin_raw_view` lowers `SHIPPED`; no request can make it lower a picker;
  `begin_raw_view_with` refuses an advanced-tier id, an unknown id and an id
  not in `rawViewIntents`;
- the refusal matrix of decision 4, one test per row, each asserting zero
  provider launches and no file created;
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
  and counted, and nothing it points to is touched;
- pins: an entry held by a preview is not evicted or cleared, and the pin is
  released by the next open, row removal and Clear workspace;
- eviction order, the cap after publishing, the bound above the cap with pinned
  entries, and the refusal without eviction when eviction could not make room;
- the 2 GiB ceiling, the disk-space check through an injected free-space probe,
  and an output over the inspector's limit published nowhere;
- Cancel in each phase, and a late Cancel of an ended operation;
- `open_raw_view`: once per ready operation; refused when superseded, already
  opened or the row was removed;
- the staging sweep: a gone owner's attempt removed; a live owner's attempt,
  this process included, left;
- the root: created with its marker; a root without one refused and untouched;
  an unresolved root refused;
- exports: the six keys and the next schema version for a cached view, and
  byte-identical goldens for an mzML row; the figure `<desc>` source line;
- QC capture refused with `viewed_through_cache`.

**Frontend (Vitest):**

- the pane for every `RawViewStateDto` and every refusal: the buttons, the
  reason, `aria-describedby` and the label;
- Enter on a highlighted RAW row presses View, and activating a RAW row calls
  nothing;
- polling stops at a terminal state, and a reloaded document resumes;
- the open happens only when the row is still highlighted;
- View with… shows `rawViewIntents` in order, its menu keyboard, and Escape;
- the Settings row, Clear's result line, and its refusal while a view runs;
- the live-region text for each phase, the open and a failure;
- `en` and `zh-CN` locale parity for every new key.

**Browser end to end (mock boundary):** idle, miss, open; idle, hit, open; Cancel
in Converting; a failure and Try again; refused while a queue runs, with Show
conversion; a second View refused, with Show {name}; and Clear view cache. Each
also runs with the keyboard alone.

**Native QA, under a bounded ProteoWizard hold release** (open question 6):

- real `msconvert` views of the two public files, `TV0`'s and `TE0`'s sources;
- times recorded for the hash, the conversion, the output check, the open and a
  hit;
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
- [ ] View with… open, with the default first and the lossy row labelled.
- [ ] Each refusal of decision 4, with its reason and its recovery button.
- [ ] Failed, with Try again; Cancelled.
- [ ] The status bar's busy text on the Conversion and Project screens; the
  queue's Begin refused with Show {name}.
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
3. **The interface.** The pane, View with…, the progress, the status bar, the
   Settings row, every refusal, `en` and `zh-CN` resources, Vitest, browser
   end-to-end tests and rendered QA.
4. **Export provenance.** The figure source line and the data documents' keys
   and schema versions, with golden tests.

Native QA follows slice 3 under its own hold release.

## Alternatives rejected

- **Activating the row converts it** (the accepted wording read literally).
  Moving through the roster, or highlighting a row to remove it, would start a
  minute-long conversion that holds the backend gate. This is open question 1,
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
- **RAW files over 2 GiB cannot be viewed this way.** The bound comes from the
  4 GiB document limit the inspector and the viewing reader share
  (`MzmlScanLimits`, ADR 0056 decision 2), and profile outputs measured at least
  1.9 times their source. Long Orbitrap and Astral runs can exceed it.
  Convert this file… stays their route (open question 7).
- **Time:** a first view of a 276 MB RAW takes about a minute of conversion
  (`TE0`: 63.6 s) plus the hash and the open. A hit costs two hashes and the
  open. Neither is measured end to end yet; native QA records both.
- **A busy backend:** a view conversion blocks a queue's Begin and the open of
  other previews for its duration. A running queue blocks View.
- **One more lifetime handle:** the open entry is pinned, and is not deletable
  while it is viewed.

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
  decision 5, section 3's ADR numbers, and the backlog.

**In the change that implements each decision, by dated notes:**

- [ADR 0005](0005-mzml-preview-boundary.md), M3.1's amendment, and ADR 0056
  decision 3's "Vendor rows stay `dataset_not_previewable`": a Thermo RAW row is
  previewable through a ready view operation, and in no other way.
- [ADR 0056](0056-project-owned-mzml-reader-for-viewing.md) decision 4: the
  pin is an exception to "No read holds a file handle", for cache entries only.
- [ADR 0057](0057-conversion-capacity-and-viewing-during-conversion.md): a view
  conversion is a conversion for decisions 1 and 2 and for the safety argument.
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

None blocks slice 1. Each has a recommended default, which stands unless the
owner chooses otherwise.

1. **The entry point.** The accepted wording is "Selecting a Thermo RAW row to
   view converts it". This record recommends a View button, so that activating
   a row starts nothing (decision 1). Converting on activation is the other
   reading; its cost is under Alternatives rejected. *Default: the View
   button.*
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
   `msaccess` on the two public files, plus a cancel and a two-process eviction
   check (decision 14). Without it, the slices merge on fake-provider and
   browser evidence, and the timings stay unmeasured.
7. **Viewing RAW files over 2 GiB.** Raising the 4 GiB document limit of the
   inspector and the viewing reader would amend ADR 0056 decision 2, whose caps
   are a resource contract. *Default: the limit stays, and such files go
   through Convert this file….*
