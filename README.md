# MSCanvas

**A modern open-source workspace for mass spectrometry data.**

MSCanvas aims to be a Windows-first, local-first desktop application for importing mass-spectrometry acquisitions, exploring linked chromatograms and spectra, converting vendor data to open formats, and exporting clean scientific figures. Later releases may orchestrate established analysis packages through typed modules and isolated workers.

> Status: **pre-alpha**. The application has two real end-to-end paths: curate a
> session workspace of local `.mzML` files and inspect one of them against a
> user-installed ProteoWizard, and queue up to sixteen selected vendor rows —
> Thermo Scientific RAW, Shimadzu LabSolutions LCD and SCIEX WIFF, alone or
> mixed — for serial conversion to mzML, each family on the exact ProteoWizard
> build evidenced for it. It is not yet the batch workspace described under
> [Product scope](#product-scope).

Canonical repository: [`MianliWang/MScanvas`](https://github.com/MianliWang/MScanvas) (currently private).

## What works today

Build a session workspace of local `.mzML` files and inspect one of them:

- ProteoWizard is discovered automatically on `PATH` and in the locations an
  installer writes. If it is installed somewhere else, you can choose its
  installation folder for the current session; that choice is never written to
  disk, and returning to automatic discovery is offered from every state.
- Choose one or many `.mzML` files in a single native picker operation. They
  appear as an ordered list, and adding the same acquisition again — under a
  second name, or by picking it twice — reports the row you already have instead
  of listing it twice. Files that could not be read are named individually and do
  not affect the ones that arrived.
- Or choose a folder, and MSCanvas adds every regular `.mzML` file beneath it in
  one operation. On Windows, the Explorer-style folder picker accepts an
  absolute path pasted into its address bar. The scan stays inside the folder
  you chose: junctions, symbolic
  links, mount points and cloud placeholders are never followed, and are counted
  and reported instead. It is bounded by four named limits, and a scan that
  stopped at one of them, skipped a linked entry or could not read a subtree says
  so rather than reporting part of a folder as the whole of it. The list stays
  usable while it runs — searching, sorting, selecting and reading a file you
  already have all keep working — and a selection you make meanwhile survives.
  If you picked the wrong folder, `Clear list` stays available even over an
  empty list. When its command succeeds, the workspace is empty after both it
  and the import settle.
  `Remove selected` also stays available to manage rows already on screen, but
  it is not cancellation: rows the import committed first can remain. A late
  folder reply never overwrites either later workspace action. If that action
  fails, MSCanvas reads the authoritative roster after both operations settle
  rather than exposing the uncertain folder snapshot. If two files end up
  sharing a name, each says where it was found for as long as they collide.
  Directory-formatted vendor acquisitions are not recognized in this version.
- Or drop one or many regular `.mzML` files, ordinary local folders, or a mixture
  of both onto the main window from Windows Explorer. Direct files use the same
  acceptance boundary as `Add files…`, and each folder uses the same recursive,
  link-refusing discovery boundary as the folder picker. A single drop obeys one
  root limit and shares its entry, directory and candidate budgets instead of
  multiplying them per folder; traversal depth restarts at zero for each folder
  root. If a limit is reached, a linked entry is refused or part of the input
  cannot be inspected, the result says the drop was incomplete while retaining
  valid files already found. Paths stay in Rust, a second drop cannot replace
  one already importing, and adding a large or mixed drop does not start one
  backend read per row. Reparse, remote and virtual roots are unsupported;
  directory-formatted and vendor acquisitions are still not recognized.
- Select rows with the pointer or the keyboard the way a file list works: click,
  Ctrl-click, Shift-click, arrows, Space, Home, End and Ctrl+A. Remove the
  selected rows, or clear the list, without restarting. Neither ever deletes,
  moves or writes to a file on disk. The session holds up to 1,024 files.
- Narrow the list by filename, and order it by the order files were added, by
  name in either direction, or by size in either direction. Names with numbers in
  them sort the way they read, so `sample-2` comes before `sample-10`. A search
  never hides work in progress: a row you selected, the row whose preview is on
  screen and a row being read stay visible and say why they are still there, and
  the count tells you how many files matched rather than how many rows you can
  see. Ranges and Ctrl+A follow what is on screen. Neither the search nor the
  sort reaches ProteoWizard, and neither outlives the session.
- Rust owns the file paths and decides what may be opened. The interface holds an
  opaque session handle and a display name, never a path, never parses backend
  output, and nothing is uploaded.
- Reading is explicit and one at a time. Moving around the list costs nothing;
  previewing the focused row reads acquisition metadata, a run summary and a
  spectrum table for that one file, and selecting a table row loads that one
  spectrum. Adding files, a folder or an Explorer drop reads at most the first
  file of a session that had nothing in it, so choosing or dropping ten files
  does not start ten reads and a folder of a thousand does not start a thousand.
- The spectrum is drawn as a repository-owned SVG stick plot with no charting
  dependency. The retention-time unit, the profile/centroid representation and
  array units are shown as unreported rather than guessed, because the backend
  output this preview reads does not carry them. That says nothing about whether
  the acquisition itself records them.

A loaded mzML preview shows a **TIC/BPC chromatogram** beside its scan table.
Both traces are the per-scan values the spectrum table already carries --
`totalIonCurrent` and `basePeakIntensity` against retention time -- so no extra
ProteoWizard process runs for it. It is **not** a stored chromatogram read out
of the file, and the standalone `msaccess tic` query remains unused and
evidence-gated. Retention time and intensity carry no reported unit, and the
axis says so rather than guessing minutes. A preview whose spectrum table did
not load completely gets an explicit unavailable state instead of a chromatogram
of the rows that did arrive.

Selecting a scan means the same thing everywhere: a click in the plot, a click
or Enter in the table, and Previous/Next scan all commit the same selection, and
the marker, the highlighted row and the spectrum panel follow it. Arrow keys
still move focus in the table without reading anything, because each read is one
ProteoWizard process. The chromatogram's retention-time axis zooms, pans and
resets by pointer and by keyboard, and its range survives selecting scans and
focusing a vendor row.

Not implemented yet: vendor RAW preview; XIC, and any chromatogram export;
spectrum zoom and pan; directory-formatted acquisition recognition; filtering the workspace by
anything other than filename, and grouping it; a workspace that outlives the
session, which includes remembering a search or a sort; conversion progress as a
percentage; cancelling one item of a queue while the rest carry on; resuming a
stopped queue; a conversion queue that survives closing the application;
diagnostics for anything but the latest attempt of each item, a diagnostics
history, complete raw converter logs, and sending a diagnostics file anywhere;
and every figure export but the selected spectrum's own SVG, PNG, CSV and TSV --
there is no chromatogram export and no current-range export, and figure settings
are not remembered across a restart, nor is the chromatogram's range. mzXML output stays disabled and fail-closed until
representative multi-source integrity checks pass.

A conversion queue is reachable, and its limits are the claim. `Add files…`
admits regular `.mzML` files plus three precisely evidenced vendor families —
**Thermo Scientific RAW**, **Shimadzu LabSolutions LCD** and **SCIEX WIFF** —
each recognized by what its bytes are, never by its name alone: a RAW by its
signature, an LCD and a WIFF by the measured structure inside their containers,
which share their leading bytes with each other. Folders and Explorer drops
still discover mzML only.

A SCIEX WIFF acquisition is **two files**, and both are required: you select the
`.wiff`, and MSCanvas admits it together with the matching `.wiff.scan` beside
it as one workspace row. If the companion is missing, is not a file, or is not
the companion MSCanvas expects, the acquisition is refused when it is added and
told which file to put beside it. Selecting the `.wiff.scan` on its own is
refused the same way. The companion never becomes a row of its own.

Select up to **16** vendor rows — any of the three families, or a mix — and
MSCanvas shows the ordered list it would run, which family each row is, and what
each item would write; you choose Fail or Skip for names already taken, with no
overwrite, and one folder on this computer through a Rust-owned picker.

**One acquisition is one queue item, whatever it produces.** Thermo and Shimadzu
rows each write one mzML whose name is known before anything runs. A SCIEX
acquisition can hold many samples, and ProteoWizard writes one document per
sample and chooses their names itself — so the plan says *1–24 mzML outputs,
filenames determined during conversion* rather than inventing a name, and the
queue's progress still counts acquisitions rather than output files. The items convert one at a time, in the order shown, each on
the exact provider build evidenced for its own family, and each reports what
was measured of its own output. Conversion is judged on its output alone —
MSCanvas cannot read a vendor container, so nothing claims source fidelity.

One file's failure does not stop the files after it, and nothing already
converted is undone. `Retry` reruns only the failures MSCanvas can say another
attempt might change — a destination folder that is there but will not open, or
an acquisition that is there but could not be read — and leaves everything else
exactly as it is.

`Stop queue` ends the whole queue: it asks the running conversion to stop and
begins none of the ones after it. Outputs already completed stay in the folder,
and no partial file is ever finalized. It is not instantaneous and it is not a
promise about the item under way — a conversion that finished before the request
arrived keeps its result rather than being called cancelled. A stopped queue is
over; converting those rows again is a new queue. If MSCanvas cannot confirm that
the converter process ended, it says so and refuses further backend work until
you restart it, rather than starting a second converter beside one it has lost
track of.

It runs on one exact ProteoWizard build the repository has a recorded conversion
for, one file at a time; there is no percentage, because nothing measures one. Validation is output-only: the converted
document's own postconditions are established, and nothing is compared against a
vendor-source spectrum model, because MSCanvas cannot read one. Folder ingestion
and Explorer drop stay mzML-only. Converted files are never added to the
workspace for you -- when a queue is over you can add its finalized outputs
yourself, and MSCanvas admits one only when the final name still refers to the
exact object it finalized and that object still holds the bytes it validated.
Nothing is previewed automatically. A ten-sample SCIEX acquisition offers ten
outputs to add, not one, and each is an ordinary mzML row afterwards.

For a SCIEX acquisition that converted every one of its outputs, MSCanvas says
that **every sample identified by the SCIEX reader produced its output**. That
is narrower than it may sound and is meant to be: it does not say the reader
identified every sample in the acquisition, and it says nothing about how
faithfully any document represents one. Publishing several files is sequential
and is not a transaction — if it stops partway, the files already written stay
in your folder and are yours, MSCanvas says how many there were, and it will not
offer them as the acquisition's complete output set. You can add them
individually later with `Add files…`.

When a queue is over and something in it went wrong, you can save one local JSON
file describing it: which items failed, what the boundary called each failure,
and a bounded excerpt of what the converter printed. Known filesystem paths and
internal identifiers are removed, and an excerpt that still looks like it names
one is left out of the file rather than saved. That is not the same as anonymous
— converter output is written by an instrument's software about a real
acquisition, so it may still carry acquisition metadata, and MSCanvas says so
beside the action and again inside the file. Nothing is uploaded, nothing is sent
anywhere, and a file of that name that already exists is never replaced. The file
is yours to read before you decide who sees it.

## Product scope

The first usable product is the target below, not a description of today. A
session file workspace exists, built from the file and folder pickers and native
Windows Explorer drop. Of the second item, metadata, spectrum and scan-table
exploration are built and TIC/BPC are not; nothing else in this list is built
yet. See [What works today](#what-works-today).

- drag-and-drop file and folder workspaces;
- metadata, TIC/BPC, spectrum and scan-table exploration;
- linked selection across views;
- conversion to mzML through user-installed ProteoWizard, with mzXML gated behind
  representative multi-source integrity checks;
- queue, cancellation, retry and actionable errors;
- SVG and PNG figure export, `Copy plot`, and underlying CSV/TSV export for the
  selected spectrum, at a width, height, DPI and theme the user chooses
  (shipped); chromatogram data export and a linked figure still to come.
- a TIC/BPC chromatogram with zoom, pan and reset, linked to the scan table and
  the selected spectrum in both directions (shipped); XIC still to come.

Analysis is deferred rather than prohibited. MSCanvas should reuse mature algorithms from OpenMS/pyOpenMS, matchms and other reviewed packages instead of reimplementing them.

## Repository status

The repository contains:

- a React + TypeScript + Vite desktop interface built around the mzML preview
  workspace;
- a Tauri 2 native host whose main window is granted no Tauri core API
  permissions, so the interface reaches the backend only through this
  application's own typed commands;
- Rust domain, ProteoWizard-adapter and plot-spec crates, where the adapter owns
  discovery, typed argv planning, process supervision, preview parsing and mzML
  conversion-integrity checking;
- product, UX and architecture source documents;
- repo-local Codex guidance and skills;
- frontend, Rust and repository-quality CI workflows.

Committed pnpm and Cargo lockfiles, frozen/locked CI installs and a deterministic
desktop build prerequisite are in place, and `main` is protected by a repository
ruleset requiring the three CI checks and resolved review threads. See
[`BOOTSTRAP_STATUS.md`](BOOTSTRAP_STATUS.md) for the commands actually verified and
the remaining runtime/backend work.

## Development prerequisites

- Node.js 22.13 or newer within the Node 22 release line (`.node-version` pins the
  exact CI runtime);
- pnpm 11.15.1 installed through npm;
- Rust 1.97.1 through rustup;
- Windows 10/11 for the supported desktop target;
- ProteoWizard installed separately. MSCanvas never bundles, downloads or installs
  it, and the mzML preview path does not work without it.

## Getting started

```powershell
npm install --global --no-audit --no-fund pnpm@11.15.1
rustup toolchain install 1.97.1 --component rustfmt clippy
pnpm install --frozen-lockfile
pnpm dev
```

For a fail-closed installation and complete local check pass, run
`pwsh -File .\scripts\bootstrap.ps1` from the repository root.

To launch the Tauri desktop host:

```powershell
pnpm tauri dev
```

Run repository checks:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-targets
python -B scripts/check_repo.py
```

## Repository map

- [`PROJECT_PROPOSAL.md`](PROJECT_PROPOSAL.md) — product and engineering source of truth.
- [`docs/product/FEATURE_CATALOG.md`](docs/product/FEATURE_CATALOG.md) — stable feature IDs and acceptance summaries.
- [`docs/product/PRIMARY_WORKFLOWS.md`](docs/product/PRIMARY_WORKFLOWS.md) — end-to-end user contracts.
- [`docs/ux/UX_PROCESS.md`](docs/ux/UX_PROCESS.md) — task analysis, concepts and usability validation.
- [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) — boundaries and ownership.
- [`ROADMAP.md`](ROADMAP.md) — milestone sequence.
- [`BOOTSTRAP_STATUS.md`](BOOTSTRAP_STATUS.md) — verified and pending setup work.
- [`docs/development/PUBLISHING.md`](docs/development/PUBLISHING.md) — repository, branch-protection and future release workflow.
- [`docs/development/DEPENDENCY_POLICY.md`](docs/development/DEPENDENCY_POLICY.md) — routine update grouping, deliberate majors and visible security updates.
- [`docs/development/INITIALIZATION_REPORT.md`](docs/development/INITIALIZATION_REPORT.md) — what the bootstrap created, validated and deferred.

## Source of truth

Before non-trivial work, read:

1. [`PROJECT_PROPOSAL.md`](PROJECT_PROPOSAL.md)
2. the nearest applicable `AGENTS.md`
3. accepted ADRs and feature specifications for the target area.

## License

MSCanvas is licensed under the [Apache License 2.0](LICENSE). External conversion engines, vendor readers and scientific packages retain their own licenses and are not automatically redistributed by this repository.
