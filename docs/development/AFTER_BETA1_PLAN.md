# After beta 1: plan and backlog

Date: 2026-10-28. Status: **PLAN — owner-approved direction, updated as work
completes.** Durations are the maintainer's estimates calibrated on this
repository's history (section 4), not commitments. Nothing here authorizes a
release, an upload, a dependency change or outbound contact; each of those
keeps its own approval.

This is the one place that orders the work left after the first beta. The
records it points to stay authoritative for their own scope: ADR 0047 for the
beta's scope and release decisions, the
[post-PM9 ledger](POST_PM9_DEFERRED_WORK.md) for PM9's dispositions, the
[native qualification record](POST_PM9_NATIVE_QUALIFICATION.md) for native
evidence and the [M9 closure](../product/M9_CLOSURE.md) for targeted-MS1 limits.

## 1. Beta 1: what is left before publication (phase 0)

The candidate is the installer the `Release candidate` workflow built from
`main` at `e6d2a49` (run 40618719468): `MSCanvas_0.1.0_x64-setup.exe`,
6,469,906 bytes, SHA-256
`4bf752addff63c489df440814efbd2adb9f445cb41ce406bdf6d9a035c657ee8`, unsigned by
the owner's approval, with a verified build-provenance attestation. Its package
inspection found none of the QA markers in the executable. Its frontend scan
read the QA control step's rebuild of `dist`, not the shipped files; a
byte-identical rebuild of the shipped frontend holds no development origin, and
its only marker matches are three message-table keys every build carries
([installed check](../release/beta-1/INSTALLED_CHECK.md#adr-0047-release-exits-and-other-beta-1-items)).

| Item | State, 2026-10-28 |
| --- | --- |
| Whole Vitest, whole browser suite, per-option rendered spec | Vitest passes on the candidate's source (114 files, 2301 tests, CI). The whole browser suite passed on `bd82a0a`, one presentation change earlier (34 files, 487 tests). After that change, `beta1-ux` (16 cases) passes with the targeted, PM9.6 and PM9.7 specs (6 files, 87 tests) |
| Native campaign at 150% (NQ-T … NQ-N2) | Pass on final runs, 79 of 79 titles, several after test-only repairs (PR #138); NQ-N2's 3 on the idle desktop |
| U4 live-provider check | Pass: 32 real ProteoWizard 3.0.26013 conversions across all attempts; the one output line-compared with the admitted mzML differs only in source path, the index offsets that path shifts, and checksum |
| NQ-N2 (3) and NQ-I (18) | Pass on an idle desktop, 2026-10-28: 3/3 and 18/18 at first run, no test change ([record](POST_PM9_NATIVE_QUALIFICATION.md)) |
| Installed check in the owner's account | Run 2026-10-28 ([record](../release/beta-1/INSTALLED_CHECK.md)). One **FAIL**: exported spectrum values are `msaccess`'s 8-decimal text, not the stored binary values. Keeping the candidate and stating it, or rebuilding, is the owner's call |
| Not covered, put to the owner with the report | No run on the 25H2 support target; the installed runtime's configuration observed but not logged; the installer's own pages and Run anyway; the organisational-policy trust test; G18 installed fault, missing backend, Open file/folder, Copy plot, WebView2 missing/offline, FAT/exFAT/network work areas, stored-result native save/reopen |
| Release notes and ADR 0047 2026-10-28 record | Merged (PR #139); check results, values and support-target statements filled after the checks |
| Release documents on `main` | The records and the filled release documents merge to `main` on the owner's go, before publication; the release body links to them at that commit |
| Prerelease `v0.1.0-beta.1` | **Published 2026-10-28** on the owner's go; tag on `e6d2a49`; public assets downloaded back, hash and attestation verified |

**The freeze ended at publication.** Production, dependency and toolchain
changes may merge again, each with the owner's approval as before.

## 2. Owner decisions, 2026-10-28

- **Selected post-beta-1 features** (section 6): an opt-in spreadsheet CSV;
  PNG text metadata; per-output adoption (preview without adopting declined);
  and
  Add folder / Explorer drop proposing the admitted vendor families, which
  reverses ADR 0012's walk restriction (the amendment is written with that
  slice; section 6.1 records what SCIEX's derived companion adds).
- **Not selected now:** stored-result clipboard copy, a subfolder default and a
  queue capacity above 16 (the last needs a stated basis). Other
  evidence-gated items stay gated. *2026-10-29: the queue capacity is
  selected, at 1,024 ([ADR 0057](../architecture/adr/0057-conversion-capacity-and-viewing-during-conversion.md);
  below).*
- **Dependencies and Node 26:** after publication, in batches, before beta 2.
- **Merging:** test-only and docs-only pull requests may be merged by the
  maintainer agent once every required check passes; product, dependency and
  release changes still go to the owner. *2026-10-29: product pull requests may
  be merged too, once every required check passes and no review thread is
  open. A dependency or release change keeps its own approval.*
- **This plan** is tracked in the repository and updated as items complete.
- **Feature design answers** (after the read-only briefs and their critiques):
  - folder/drop proposes **Thermo RAW and Shimadzu LCD only**; SCIEX stays
    picker-only until a measurement shows its companion pairing cannot take a
    same-stem `.wiff2`'s companion;
  - the walk gains a non-destructive **Stop adding**, a true "k of N"
    progress once the scan has counted its candidates, a **duplicate and
    full-roster short-circuit** before any hashing, and a **warning** not to
    add a folder an instrument is still writing to;
  - the spreadsheet CSV also neutralizes a trigger that follows a `;` inside a
    declared text field, drops `formula` from the declared fields, and claims
    formula protection in help or release text only after it is checked in
    Excel, LibreOffice and WPS;
  - every other design default below is accepted as recommended.
- **At publication** (later the same day; [ADR 0047](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#owner-decisions-at-publication-2026-10-28)):
  - beta 1 is published as it was checked, with the gaps the release notes
    state;
  - **msconvert parity, option C:** MSCanvas is to be no less capable than
    msconvert. Verified settings stay the default; every other msconvert
    option is offered in an advanced set labelled as not verified by
    MSCanvas, through typed arguments (never a free-text argument box), with
    private staging, no overwrite and the output checks kept, and combinations
    known to lose data still blocked. This reverses the evidence-bound catalog
    rule for that advanced set and needs its own ADR, a general filter chain in
    place of the nine fixed rows, and a capture of the full msconvert help text
    (a ProteoWizard hold release the owner grants). The help was captured
    later that day ([capture](../spikes/MSCONVERT_HELP_CAPTURE.md),
    [option inventory](../spikes/MSCONVERT_OPTION_INVENTORY.md)), and the ADR
    is [ADR 0055](../architecture/adr/0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
    proposed;
  - **frontend:** the owner is not satisfied with either the execution or the
    scope of the current interface; the target is to be defined with the
    owner before a redesign;
  - **secondary explanations:** remove them from the interface first, because
    good design should explain itself. The inventory of 2026-10-28 (1,587
    strings; about 29% of the words shown by default) is applied as proposed,
    keeping recovery paths, no-overwrite and irreversible-action warnings,
    the scientific-honesty statements and accessible names;
  - **design reference:** where earlier UX records are unclear,
    [lieflat-charts](https://github.com/larashero3-dotcom/lieflat-charts) is a
    reference for chart design, not a dependency: its licence (PolyForm
    Noncommercial) does not allow copying it into this Apache-2.0 project.

**Owner decisions, 2026-10-29** (every recommendation put to the owner was
accepted):

1. **`serde` in the conversion crate.** `serde` becomes a direct dependency of
   `crates/proteowizard`; it is already a workspace dependency and in
   `Cargo.lock`, so no package is added. The wire deserializes into the
   crate's unvalidated parts, and the structured intent's validating
   constructor checks them ([ADR 0055](../architecture/adr/0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
   dependency note).
2. **The "not verified by MSCanvas" flag survives adoption.** It is carried
   into an adopted output's provenance, in the session and in the project
   document, not only into the queue outcome and diagnostics. A project schema
   bump is accepted (ADR 0055, risks).
3. **Conversion capacity and viewing during conversion**
   ([ADR 0057](../architecture/adr/0057-conversion-capacity-and-viewing-during-conversion.md)):
   - an open preview's selected spectra may be read natively during a
     conversion, once ADR 0056's reader is integrated;
   - opening a new preview during a conversion stays refused for now, because
     it would run `msaccess` beside `msconvert`;
   - queue capacity rises from 16 to 1,024, the roster cap, so one checked
     roster converts as one queue; conversion lists must be windowed;
   - parallel conversion waits for a throughput measurement under a bounded
     ProteoWizard hold release (week 2); until then conversion stays serial.
4. **User-saved conversion presets**
   ([ADR 0058](../architecture/adr/0058-user-saved-conversion-presets.md)):
   presets are user-saved only, MSCanvas ships none, and none is selected at
   startup. A preset may hold a picker step because the user wrote it, and
   applying it shows the step's lossy effect in the plan summary. ADR 0055's
   decision 7 now reads "no default or MSCanvas-authored preset inserts a
   picker".
5. **Numpress in the viewer.** The viewer keeps the typed refusal. An adopted
   numpress output opens, and its spectra show that refusal
   ([ADR 0056](../architecture/adr/0056-project-owned-mzml-reader-for-viewing.md),
   open question).

**Still open** (not decided on 2026-10-29):

- the R0 real-file comparison for the reader (ADR 0056, decision 8): the PRIDE
  `PXD081190` download, an MS1 profile-mode file from the owner, and a
  ProteoWizard hold release. *R0 ran on 2026-10-29 on public files
  ([PR #157](https://github.com/MianliWang/MScanvas/pull/157)) and did not
  pass: the reader refused the `PXD081190` file, whose `<mzML>` has no
  `version` attribute. Decision 2 below amends ADR 0056. R0 ran again on
  2026-10-30 and passed: the reader reads both files exactly
  ([record](../spikes/ADR0056_R0_REAL_FILE_COMPARISON.md));*
- whether product pull requests may be merged without the owner. *Answered
  2026-10-29: they may (the merging bullet above);*
- which demo direction the interface follows.

**Owner decisions, 2026-10-30** (Thermo first, Bruker compatibility later when
there is capacity, no decompilation, and every other point as recommended):

1. **Vendor formats stay on the vendors' own readers**
   ([ADR 0059](../architecture/adr/0059-vendor-format-strategy-official-readers-thermo-first.md)).
   Thermo comes first, and Bruker waits until there is capacity. MSCanvas does
   not decompile or reverse engineer vendor software and writes no decoder of
   its own for a vendor format. Vendor files go through the official vendor
   readers, inside the user's own ProteoWizard `msconvert`. A Bruker TDF
   preview through an existing permissively licensed open reader (timsrust or
   mzdata) stays a later, separate decision.
2. **mzML version from the schema location.** When `<mzML>` has no `version`
   attribute, the reader takes the version from the xsd file name in that
   element's `xsi:schemaLocation`, as ProteoWizard does. A stated version
   that is not `1.1.x` is still refused
   ([ADR 0056](../architecture/adr/0056-project-owned-mzml-reader-for-viewing.md),
   decision 1).
3. **The chosen ProteoWizard folder is remembered across launches**
   ([PR #158](https://github.com/MianliWang/MScanvas/pull/158)). This reverses
   ADR 0005's "for the session only, never written to disk", and the
   installation's folder may be sent to the webview
   ([ADR 0005](../architecture/adr/0005-mzml-preview-boundary.md)).
4. **`tiff` is a direct production dependency** of the desktop crate, at
   `=0.11.3` with only `lzw`
   ([PR #159](https://github.com/MianliWang/MScanvas/pull/159)). It is already
   in `Cargo.lock` through `image`, so no package is added
   ([ADR 0030](../architecture/adr/0030-png-copy-plot-and-figure-settings.md),
   dependencies).
5. **One-click view RAW** is accepted. Selecting a Thermo RAW row to view
   converts it with the verified defaults into an MSCanvas-owned cache, never
   the user's destination and never overwriting, then opens the result. It is
   designed and implemented later. *2026-10-30: designed in
   [ADR 0060](../architecture/adr/0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md),
   whose details follow the recommendations as the owner asked; it lists the
   questions still open.*
6. **Thermo vendor centroiding.** "MS1 and up" (`peakPicking vendor
   msLevel=1-`) becomes a verified row on the evidenced build. "MS2 and up"
   stays in the advanced tier, labelled not verified, until a public Orbitrap
   profile-MS2 file is measured (*one was on 2026-10-30: see
   [section 7.5](#75-evidence-gated-items)*)
   ([evidence](../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md),
   [PR #162](https://github.com/MianliWang/MScanvas/pull/162)).

## 3. Parallel execution rules

- **Lanes by disjoint files.** Each lane works in its own git worktree with
  `node_modules` junctioned from the main checkout; lanes never run `cargo` or
  install packages. Rust and the full frontend suite are validated by CI on the
  pull request. A shared file (locale bundles, `previewFixtures.ts`,
  `lib.rs`'s command registration) is edited key-locally and merged in a fixed
  order.
- **Local heavy validation** (whole Vitest, browser suites) runs only under the
  standing memory admission (8 GiB free and at most 80% used).
- **Native and installed checks are serial on one desktop** and need an idle
  desktop the owner has agreed to: they take the foreground and drive native
  dialogs.
- **Decisions are batched.** History shows gates, not implementation, set the
  calendar (section 4), so each phase asks its open questions once.
- **ADR numbers are pre-assigned** to avoid the four features racing for 0051:
  0051 folder/drop vendor ingestion, 0052 per-output adoption, 0053 PNG text
  metadata, 0054 spreadsheet CSV. 0055 is msconvert parity (option C), 0056
  the mzML reader for viewing, 0057 conversion capacity and viewing during
  conversion, 0058 user-saved conversion presets, 0059 the vendor format
  strategy, 0060 one-click view of a Thermo RAW file.

## 4. Pace and estimating basis

Measured from git history (first commit to merge, local time):

| Work | Calendar span | Note |
| --- | --- | --- |
| M5 viewer completion | 4 days | 62 commits |
| M6.1–M6.10 conversion completion | 9 days | 234 commits, ~40 h idle |
| M7.1–M7.5 | 1–2 days each | median feature slice 7.4 h |
| M8 (5 slices) | 5 days | 61 h idle inside M8.1 |
| M9 (5 slices) | 2 days | |
| PM9 (7 slices) | 20 days | commits on 9 days; PM9.6 waited 8 days on the memory gate |
| Beta-1 readiness | 1 day | 6 parallel lanes |

A slice is about one working session (0.3–1 calendar day). Multi-day
stretches came from memory admission, owner decisions and idle gaps. The
estimates below count sessions and add the gates explicitly.

## 5. Phases and tracks

**Vendor priority (2026-10-30,
[ADR 0059](../architecture/adr/0059-vendor-format-strategy-official-readers-thermo-first.md)):**
Thermo RAW first: vendor centroiding's verified row, one-click view RAW and
folder/drop. Bruker compatibility comes later, when there is capacity, by its
own decision. Every vendor format stays on the official readers inside the
user's ProteoWizard; no work decompiles vendor software or decodes a vendor
format in-house.

**Phase 0 — beta 1 (now; about one day of work plus one idle-desktop window).**
Section 1.

**Phase 1 — weeks 1–2 after publication, in parallel tracks.**

1. **Tester feedback** (beta 1.x): highest priority, triaged daily.
2. **Dependencies and toolchain** (owner-approved per batch):
   - merge #133 (vite 8.2.4, which also closes the open vite advisories) and
     #135 (npm development group); close #132, a duplicate of #133;
   - #136 (npm runtime, 37 updates) and #137 (cargo, 101 updates including
     tauri 2.12 and wry/tao 0.x bumps) each as their own pull request with the
     version-pin tests updated deliberately and a full native regression;
   - Node 26 (issue #13): its LTS promotion was scheduled for 2026-10-28;
     once promoted, choose a stable patch and move all eight pinned places
     together; Node 22 support ends on 2027-04-30.
3. **Signing preparation** for SignPath Foundation: a "Code signing policy"
   section on the README and the release page with the required SignPath
   statement, team roles, a privacy statement that accounts for the
   installer's WebView2 download, and published uninstall instructions. The
   application itself is outbound and the owner submits it; once approved, the
   `Release candidate` workflow gains the signing step and beta 2 is signed.
4. **M10.0 route decision** (documentation, about half a session; owner
   approval).
5. **Polish and limits** (section 7.2), interleaved with the selected features.

**Phase 2 — weeks 2–4.**

- **M10:** stable CLI and schemas (2–4 slices), then repository/user skills
  (1–2), then a narrow local MCP adapter (2–3), then closure and
  qualification. Estimate 1.5–3 calendar weeks, mostly bound by decisions and
  validation windows.
- **Selected features** (section 6), about four slices each, in parallel lanes
  disjoint from the M10 CLI.
- **P1 capabilities:** WSP-010 restore workspace, FIG-007 saved FigureSpec,
  ENV-004 copy diagnostics.
- **Beta 2:** signed if SignPath has approved the project by then.

**Phase 3 — week 5 onward, as external inputs arrive.** The evidence-gated
items of section 7.5 and the P2 capabilities of section 7.4.

## 6. Selected features

Each was designed read-only against the current code and critiqued
independently; the briefs are summarized here, and each slice records its
own acceptance. Every one keeps the raw scientific values, the no-overwrite
writer and Rust's ownership of files.

### 6.1 Folder and drop propose admitted vendor files (WSP-002/003; ADR 0051)

- **Owner's scope, 2026-10-28:** Thermo RAW and Shimadzu LCD; SCIEX later (see
  the critique below). The walk adds Stop adding, "k of N" progress, the
  duplicate and full-roster short-circuit and the instrument-folder warning.
- **Scope:** one proposal predicate in `selection.rs` that is the union of the
  mzML check and the existing family routing predicates, used by the
  walk (`discovery.rs`) and the drop; walked and dropped candidates go through
  the same `accept_workspace_file` admission the picker uses, by bytes, with
  the SCIEX `.wiff.scan` companion derived from the `.wiff` name, never
  searched for. Directories, `.wiff.scan` and `.wiff2` are never proposed;
  directory acquisitions stay unrecognized (ADR 0007).
- **Decisions, with the recommendation:** admission runs after the scan and
  before the mutation gate, so Clear, Remove and roster reads do not wait
  behind hashing up to 1,024 acquisitions; rename the two folder commands in a
  mechanical commit; new vendor rows keep the existing conversion-membership
  default; a suffix-matching file that fails admission (for example a camera
  `.raw`) is reported per file, with one owned sentence in both languages.
- **From the critique:**
  - SCIEX is not a single file: its companion name is derived from the
    `.wiff`, and upstream data has a `.wiff2` whose companion is named like a
    `.wiff`'s; ADR 0027 says no walk may pair one without separate evidence
    and a product decision. Including SCIEX needs the owner's explicit
    confirmation of that residual.
  - Admission hashes whole vendor files and one file's hash cannot be
    interrupted; during a drop every other workspace operation waits on the
    drop's claim, and Clear is the only exit. The count budgets no longer bound
    the worst case, so ADR 0007's "the budgets bound the worst case" is
    withdrawn.
  - A walked file is fully read before its identity is rechecked: precheck the
    observed identity before reading. The folder commit lacks the drop's
    conversion-busy check; a walked SCIEX duplicate now reaches rebind.
  - Hashing holds a deny-write handle, so adding a folder an instrument is
    still writing to can disturb the acquisition software (unmeasured).
  - Companion observation must be case-insensitive and must treat a truncated
    directory listing as unobserved, not changed.
- **Slices:** preparations (auto-preview picks the first added mzML row);
  Rust widening, identity precheck and companion observation; copy, rename and
  rendered/native evidence. **Size M–L** (raised from M by the critique).

### 6.2 Per-output adoption, preview reached explicitly (PM9.4 F2; ADR 0052)

- **Scope:** one new narrow command, `adopt_conversion_output(operation,
  output_id, document)`, sharing the existing adoption body with a filter
  applied before the flag claim; authority only from the expanded adoption
  authority, so a partial-set member, an unfinalized item or an unknown id is
  refused and nothing is claimed. The existing all-at-once adoption is
  unchanged.
- **"Preview without adopting" is declined, not implemented:** every in-app
  preview needs a roster row (the spectrum slot is installed per dataset), so
  F2 closes with its adopt-one-output half. A look without adding stays the
  existing Open file, which runs the same object and byte check; removing an
  added row later deletes nothing.
- **From the critique:** keep the existing "Locate {{name}}" group label and
  its one status line (no second live region per group); reuse the existing
  "not added" sentence and the named Show in Workbench label; a per-output
  answer clears the queue-level adoption summary so the two never disagree;
  ADR 0052 supersedes ADR 0016's "takes a whole queue" and amends the
  adoption-relation rows of ADR 0043 and 0045; a set whose sample completeness
  is not established is refused like a partial one.
- **Owner's answer, 2026-10-28:** one Add per output, as recommended; a large
  SCIEX set is checked in rendered QA at 960x640 before that is final.
- **Decisions, with the recommendation:** "preview" is Add, then the existing
  Show in Workbench, then the row (no new preview entry point); each member of
  a complete SCIEX set gets its own Add by its output id; members of a
  partially finalized set stay unadoptable one by one (ADR 0027); per-output
  adoptions join conversion membership as queue-wide adoption does (F3); the
  command is a sibling of the queue-wide one.
- **Slices:** ADR and Rust; contract and hook; UI and copy; rendered QA.
  **Size M.**

### 6.3 PNG text metadata (FIG-002; ADR 0053)

- **Scope:** every saved PNG figure (spectrum, chromatogram, linked figure,
  stored targeted result) gains two uncompressed `iTXt` chunks, `Title` and
  `Description`, holding exactly the SVG's own `<title>` and `<desc>` from the
  same renderer call. No new dependency (the existing encoder writes `iTXt`).
  No path or handle, as for the SVG.
- **Decisions, with the recommendation:** only those two keys; no
  machine-readable provenance key; Copy plot unchanged; no UI. The change is
  disclosed in the release notes and the changelog, since a PNG now carries
  the figure's labels.
- **Slices:** plot-spec accessor (`render_with_text`, SVG bytes unchanged);
  PNG chunks with golden tests per figure kind; records and native evidence.
  **Size S.**
- **Status, 2026-10-30:** the accessor, the PNG chunks and their golden tests
  are implemented
  ([ADR 0053](../architecture/adr/0053-png-text-metadata.md), accepted), with
  the changelog entry. Native evidence and the release-notes line are still
  to come.

### 6.4 Spreadsheet CSV for the targeted results table (ADR 0054)

- **Scope:** a third closed export word on the existing targeted table export,
  written beside the unchanged CSV and TSV: a UTF-8 byte-order mark, a
  distinct `#format` value
  (`mscanvas_targeted_ms1_results_spreadsheet`, its own schema 1), and one
  leading apostrophe on declared user or engine text fields whose value would
  start a formula. Numbers and code-owned fields are never altered; spectrum
  and chromatogram data files hold only numbers and fixed words and get no
  variant.
- **Owner's answers, 2026-10-28:** `formula` is not a declared field (it
  cannot start a trigger); a trigger after a `;` inside a declared field is
  neutralized too, for spreadsheets that split on `;`; help and release text
  claim formula protection only after a check in Excel, LibreOffice and WPS.
  The interface name is "spreadsheet CSV" / "电子表格 CSV", CSV only.
- **Slices:** decisions and an as-stored golden guard; Rust; boundary and UI;
  rendered QA and records. **Size M** (raised from S–M by the critique).
- **Status, 2026-10-30:**
  [ADR 0054](../architecture/adr/0054-spreadsheet-csv-for-the-targeted-results-table.md)
  accepted; the as-stored golden guard and the Rust side (the closed word
  `spreadsheetCsv`) are implemented on `be/spreadsheet-csv`. The webview
  control follows after PR #164. The Excel, LibreOffice and WPS check is the
  owner's and pending, so no help or release text claims formula protection.

## 7. Backlog

### 7.1 Near-term engineering

- One-click view of a Thermo RAW file
  ([ADR 0060](../architecture/adr/0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md),
  VIEW-009): four slices after ADR 0056's slices 2 and 3 (the cache library;
  the operation and its commands; the interface; export provenance). The
  interface slice waits on the owner's choice of interface direction. Native QA
  needs a bounded ProteoWizard hold release.
  - Slice 1, the cache library, is in [PR #172](https://github.com/MianliWang/MScanvas/pull/172) (2026-10-30): the root
    and its marker, the key, the manifest, verification, publishing, the pins,
    eviction, Clear and the staging sweep, with Rust tests. No command, UI or
    conversion yet; slice 2 is next.
  - Left to slice 2: a chunked, cancellable hash of the RAW for Checking file
    and Checking output; reading the volume's free space for `make_space`; the
    1.5 GiB refusal before any work; the summary and Clear DTOs over `usage`
    and `clear`; and codes for a check that could not be made
    (`Lookup::Unreadable`) and for a damaged entry that could not be removed,
    which decision 10's table does not list. An attempt that a sharing refusal
    keeps from being removed after `view_cache_not_stored` stays until a later
    session's sweep, because decision 6 leaves this process's attempts alone.
- CI runs the browser suite in six parallel Windows shards (`browser-e2e.yml`, informational, added 2026-10-29); it runs no native e2e, and `windows-smoke.yml` has never run.
- `check_repo.py`'s current-status guard reads only ROADMAP's M5 section.
- The WebDriver session-open flake needs one captured failure log.
- Security alerts (enabled 2026-10-27), triaged 2026-10-28 — none reaches the
  beta-1 installer:
  - npm alerts are build and test tooling; the undici, serialize-javascript
    and source-map-js ones were fixed on 2026-10-30, and extract-zip has no
    fix before WebdriverIO 10 (see the security fixes in
    [DEPENDENCY_POLICY.md](DEPENDENCY_POLICY.md));
  - Pillow is in the development-only targeted-MS1 runtime lock
    (`experiments/m9_0/runtime/requirements-cp313-win_amd64.lock.txt`), is not
    imported by project code and is not shipped; bumping it changes the pinned
    runtime manifest digest, so update it when that runtime is next provisioned
    and before any release ships the runtime;
  - `glib` (Rust) is only in Tauri's Linux GTK backend, not in the Windows
    dependency tree; the fix needs gtk-rs 0.20 and the cargo batch keeps glib
    0.18.5;
  - owner decision, 2026-10-30: these 44 alerts (Pillow 41, extract-zip 2,
    glib 1) are not dismissed; they stay open and are fixed later as above (see
    [DEPENDENCY_POLICY.md](DEPENDENCY_POLICY.md)).
- The `PM9.7-I2 … zh-CN-1366x768` flake (the browser spec's scrolled-to-end
  check, 2 px short in CI on `main` at `7c2c774` and on PRs #167 and #169;
  reruns passed on #167 and #169, and the next push to `main` passed) is fixed
  in the test, pending confirmation on Browser e2e 6/6. The case set the end
  once, right after the selected spectrum reported its range. Under reduced
  motion, which only the zh-CN cases emulate, `app.css` turns every style
  change into a 0.01 ms transition, so a commit's layout can land a frame
  later. Locally that was measured as 1 px: the spectrum summary's line goes
  from 16.5 px to 19.5 px (11 px to 13 px font) and loses a 2 px margin a frame
  after the end was set. The 2 px CI state was not captured; CI's failure
  frame matches the local one except for the evidence column's scroll. The
  case now waits for the spectrum's drawing, and both its scrolls set the end
  again until it holds for five frames, whichever commit lands late. Left
  open: that reduced-motion rule adds transitions where none are declared (a
  question for the interface rebuild, where the summary no longer changes
  class); the native I2 (`e2e/specs/pm9.7-integrated.native.e2e.ts`) still
  sets the end once; the browser workflow keeps screenshots but not
  `evidence.json`.
- The real targeted-MS1 engine qualification and, before any release ships the
  runtime, its packaging, licence qualification and worker confinement.
- Exported values are not the stored binary values: a spectrum is read through
  `msaccess binary … precision=8` (`SELECTED_SPECTRUM_PRECISION`) and the scan
  table prints rounded retention times; in the test file its total ion current
  and base peak intensity, printed to two decimals, matched the stored values
  (installed check, item 5). Read at full precision or decode the arrays; the
  measurement needs a new bounded release of the ProteoWizard hold.
- NQ-I's worker `beforeSession` guard throws at `e2e/wdio.pm9-native.conf.ts:201`
  on every attempt and WDIO only logs it, so the checks after it never run;
  `specs[0]` arriving as a `file:///` URL is the unconfirmed suspect.
- WebView2 updated itself to 156.0.4314.50 on 2026-10-28; the next native
  campaign needs the matching msedgedriver.
- `release-candidate.yml` runs `pnpm e2e:build` before `inspect_candidate.ps1`,
  which rebuilds `dist` without the Tauri hook's environment, so the inspection
  scans a different frontend from the one shipped. Inspect before the QA
  control build (or build it elsewhere), scan the shipped `dist` for markers,
  and exempt the three `qaRoot*` keys of the preference-error message table,
  which every frontend build carries. The native campaign's QA binary was built
  the same way (NQ-B1 `pnpm build`, Vite target `safari13`), so native results
  cover the shipped frontend's source, not its files; build the QA frontend
  with the Tauri hook's environment in the same fix. A release-workflow change:
  owner approval.

### 7.2 Polish and limits

- English copy: "1 spectra, 1 chromatograms" has no singular
  (`m74CnvOutputMetrics`); "32000000 pixels" has no digit grouping
  (`m74ErrorRasterBudget`).
- Figure panel titles echo the raw size draft ("00640 × 480 px") rather than
  the value the export uses (`SelectedSpectrumPanel.tsx:54`,
  `PreviewWorkspace.tsx:955`); in zh-CN Settings the workspace-entry count sits
  against the density options' focus ring.
- Uninstall leaves `HKCU\Software\MSCanvas contributors` and the application
  data unless Delete the application data is selected, which the bundled
  template says removes both (not yet observed); decide whether the uninstaller
  should remove the key by default, and check the selected path.
- M9 leftovers: unreferenced results counted but not shown; the 4 MiB document
  bound checked only after a worker ran; no "experimental" caption on an
  exported figure (owner design decision); no recovery UI for retained
  scratch; batch history session-only; whole target lists stored per plan.
- Defects and gaps: Save As does not reserve the result-store name; the M9.1
  Save As pre-copy refusal has no dedicated test; a recoverable queue-level
  refusal leaves later items showing "Waiting".
- PM9 options left to the owner: the request-error banner beside its control
  (PM9.4 O4), Retry bound to an operation id (PM9.4 F1), Rust-projected
  parameter bounds for exact range wording (PM9.5 F1).
- Residuals: process-boundary cases covered only through extracted functions;
  the m6.8 stop-row harness race; unmeasured backend stderr locales; the
  bootstrap's pending empty-spectrum picker and msconvert overwrite
  observations; non-ASCII code-page measurement for the runtime.
- Representative-participant usability sessions have never been run.
- Reporting the measured pyOpenMS/OpenMS defects upstream needs the owner's
  per-message approval.

### 7.3 M10 — automation

Stable CLI and schemas, then repository/user skills, then a narrow local MCP
adapter, reusing the desktop's domain contracts (AUT-001…003). Starts with the
M10.0 route decision.

### 7.4 Future capabilities

- P1: WSP-010 restore workspace; FIG-007 saved FigureSpec; ENV-004 copy
  diagnostics.
- P2: FIG-008 figure composer; VIEW-008 multi-layer comparison (needs an
  admitted normalization first); RUN-007 persistent conversion history;
  ANA-002 QC recipe or a second recipe.
- Later: other adducts, charges, negative mode and profile input for targeted
  MS1; history pruning; a preview cache only on a measured need; a vendor
  reader self-test; G16 cross-session staging ownership.

### 7.5 Evidence-gated items

None can be delivered by engineering alone; each waits for one input.

| Item | Input that unblocks it | Size |
| --- | --- | --- |
| Folder/drop vendor files | Owner decision (given 2026-10-28 for Thermo and Shimadzu; section 6.1). SCIEX: a measurement that its derived companion cannot pair with a same-stem `.wiff2` | M–L |
| XIC (VIEW-007) | A new scope record for a bounded project-owned mzML array decoder: a new candidate, not a repair of PX's refused one, rerunning all 77 rows; a written decision on reader work and dependency approval | L–XL |
| Thermo vendor centroiding and scoped presets (CNV-005/006) | One lawfully redistributable profile-mode Thermo RAW (not yet found; ProteoWizard's own test data is the first place to look), a sample decision, a bounded ProteoWizard hold release, and the owner's choice of what the output check may claim. *2026-10-30: public profile RAW was measured ([evidence](../spikes/THERMO_VENDOR_CENTROIDING_EVIDENCE.md)); "MS1 and up" becomes a verified row, and "MS2 and up" waits for a public Orbitrap profile-MS2 file (section 2). Later the same day a public Q Exactive profile-MS2 file (PRIDE `PXD066799`) was measured, so "MS2 and up" meets that condition; its verified row is a follow-up code change ([ADR 0059](../architecture/adr/0059-vendor-format-strategy-official-readers-thermo-first.md#consequences))* | M–L |
| Thermo direct preview | The same sample plus an independent reference that does not pass through the same vendor reader. *2026-10-30: under [ADR 0059](../architecture/adr/0059-vendor-format-strategy-official-readers-thermo-first.md) that reference cannot be an in-house decoder; one-click view RAW (section 2) meets the goal through conversion* | M |
| Directory acquisitions, further vendor families | A lawful directory sample, a new directory source model, then recognition (directory recognition follows the first admitted directory family). *2026-10-30: Bruker is the next one named, later, when there is capacity, by its own decision (ADR 0059)* | XL |

### 7.6 Refused or not adopted

- **Stays refused** (a reversal would break a scientific or data-safety
  guarantee): mzXML output (the writer drops spectra silently, and vendor
  input cannot meet the comparison gate), automatic rename, row removal from a
  running queue, retry of a stopped queue, automatic adoption, preview, retry
  or relink, fabricated progress or ETA, simulated output names, settings
  outside the admitted catalog, in-place spreadsheet-formula neutralization,
  rerun to replace a damaged result, diagnostics upload. "Terminal" means
  closed for the route that decided it, not impossible.
- **Reversible, not selected:** explicit overwrite (needs a new finalization
  contract), pause/resume (needs a measured need), the settings summary and the
  steppers (kept by PM9's freeze), target-file import (overlaps M10), on-screen
  result sorting and filtering, view-scoped export, history notes,
  stored-result clipboard copy.
  - *2026-10-29:* three entries left this list.
    - **Queue capacity above 16** is selected at 1,024, on the basis
      [ADR 0057](../architecture/adr/0057-conversion-capacity-and-viewing-during-conversion.md)
      states.
    - **Parallel conversion** is no longer waiting for a need. It waits for
      ADR 0057's throughput measurement under a bounded hold release, and
      conversion stays serial until then.
    - **Presets** are adopted as user-saved conversion presets
      ([ADR 0058](../architecture/adr/0058-user-saved-conversion-presets.md)).
- **Owned elsewhere:** Workbench restore on reopen (WSP-010), surviving queue
  and adoption history (RUN-007), remembered choices (M7.5 preferences),
  saved typed plans and large unattended batches (M10).

## 8. Dates and external dependencies

- Node 22 end of support: 2027-04-30.
- SignPath Foundation requires a published release and an automated build;
  beta 1 and the `Release candidate` workflow provide both.
- Any new msconvert or msaccess measurement needs a new bounded release of the
  ProteoWizard hold.

## 9. Open owner decisions

- The frontend's target: what "meets requirements" means in execution and
  scope, before any redesign, and which demo direction the interface follows.
  *ADR 0060's interface slice waits on the direction (its open question 8).*
- *Answered 2026-10-29:* the owner accepted
  [ADR 0055](../architecture/adr/0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md)
  (option C) and
  [ADR 0056](../architecture/adr/0056-project-owned-mzml-reader-for-viewing.md)
  with its dependency request, and chose the typed refusal for numpress,
  truncation and prediction (section 2).
- ADR 0056's re-measurement (R0): the PRIDE `PXD081190` download, an MS1
  profile-mode file the owner authorizes, and a ProteoWizard hold release.
  *R0 ran on 2026-10-29 and did not pass; the owner amended ADR 0056's
  decision 1 on 2026-10-30, and the rerun that day passed
  ([record](../spikes/ADR0056_R0_REAL_FILE_COMPARISON.md)).*
- *Answered 2026-10-29:* product pull requests may be merged without the
  owner, once every required check passes and no review thread is open.
- *Answered 2026-10-30* (section 2): the vendor format strategy (ADR 0059),
  the mzML version rule, the remembered ProteoWizard folder, the `tiff`
  dependency, one-click view RAW and Thermo vendor centroiding.
- The study model for cross-sample analysis:
  [ADR 0067](../architecture/adr/0067-study-model-for-cross-sample-analysis.md),
  proposed 2026-10-30, with ten open questions. It would supersede ADR 0050 for
  study recipes only, and its records join schema 5 if they merge before a
  release writes it.
- The per-feature questions that rendered QA raises inside each slice.
- Each dependency batch, the Node 26 patch, and the SignPath application.
- M10.0's route, when drafted.
