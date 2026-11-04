# ADR 0064 — M10 automation route: one CLI over the desktop's own operations, then skills, then a narrow MCP adapter

Status: **Accepted (2026-10-30)**, by the owner's decision A0064 recorded
under [Owner decision, 2026-10-30](#owner-decision-2026-10-30). Proposed
2026-10-30. Nothing here is implemented. Each decision below was the
maintainer's recommendation; the owner accepted all eight
[open questions](#open-questions-for-the-owner) as recommended. Question 3
was confirmed again with its corrected cost on 2026-10-31; see
[Owner decision, 2026-10-31](#owner-decision-2026-10-31).
Plan: [after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), section 5
(phase 1, item 4) and section 7.3; feature catalog AUT-001, AUT-002 and
AUT-003.
Related: [0005](0005-mzml-preview-boundary.md),
[0011](0011-private-workspace-conversion-path.md),
[0013](0013-serial-conversion-queue.md),
[0017](0017-redacted-conversion-diagnostics-export.md),
[0044](0044-conversion-configuration-authority.md),
[0049](0049-content-bound-execution-snapshot.md),
[0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
[0056](0056-project-owned-mzml-reader-for-viewing.md),
[0057](0057-conversion-capacity-and-viewing-during-conversion.md),
[0058](0058-user-saved-conversion-presets.md),
[0060](0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md).

## Context

**What M10 asks for.** The proposal's principle 9: "GUI, future CLI, skills and
MCP must ultimately reuse the same domain contracts." Its automation layer
lists a structured CLI, headless execution, skills, a narrow local MCP adapter,
approved-plan execution and machine-readable reports, and names the executable
`mscanvas`. The catalog's three rows:

- AUT-001, headless CLI: "Reuses the same domain plans and returns structured
  output/exit codes."
- AUT-002, repository/user skill: "Guides inspect → plan → approve → run →
  validate without bypassing contracts."
- AUT-003, local MCP adapter: "Exposes narrow typed tools and executes only
  approved plans/roots."

**Rules that already bind it.**

- `AGENTS.md`: React never spawns processes; Rust owns filesystem, process,
  queue and backend state; command arguments are typed argv arrays, never
  shell strings; no generic plugin ABI during MVP work; no implicit
  centroiding, backend fallback or output overwrite.
- The proposal's architecture section: domain crates do not depend on Tauri,
  React, MCP or a concrete package, and there is no crate per noun.
- `apps/desktop/src-tauri/AGENTS.md`: "Tauri commands should be thin adapters
  over application services."
- ADR 0011: "Two spellings of one rule are two rules the moment either
  changes."
- The plan, section 8: any new `msconvert` or `msaccess` measurement needs a
  new bounded release of the ProteoWizard hold.

**Where the contracts live on `main` (`7ac5a21`, 2026-10-30).**

- **Three shared crates.** `mscanvas-core`, `mscanvas-plot-spec` and
  `mscanvas-proteowizard`. The last holds:
  - discovery and capability evidence;
  - the admitted intent table and `ConversionPlan::to_mzml`;
  - the single- and multi-output runs (`run_conversion_cancellable`), with
    process supervision that puts the backend in a job object that is killed
    when its handle closes;
  - output inspection and the integrity contract (`inspect_conversion_output`,
    `verify_mzml_conversion`, `FinalizedOutput`);
  - the project-owned mzML reader of ADR 0056 (`inspect_file`,
    `read_spectrum_table`).
- **The rules that turn those into a product are in the desktop crate's
  `PreviewService`** (`apps/desktop/src-tauri/src/preview/service.rs`):
  - acceptance and revalidation by family (`selection.rs`);
  - the configuration authority and its receipts (ADR 0044;
    `configuration.rs`, `authority.rs`);
  - the destination policy (`destination_policy.rs`);
  - the ADR 0011 coordinator and the serial queue (ADR 0013);
  - adoption, and diagnostics redaction (ADR 0017).
- **How the desktop plans a conversion today.** `conversion_queue_plan`:
  1. takes the admitted row by its stable id
     (`ConversionIntent::from_stable_id`);
  2. checks the request's binding receipt;
  3. asks the configuration authority whether the bound installation admits
     the row (`RowAdmission`);
  4. checks the queue's capacity;
  5. resolves the destination policy and plans one item per row.

  Begin then runs each item through the coordinator: claim, wait, revalidate,
  bind, gate, pin, admit, run, check the output, finalize under Fail or Skip.
- **Tauri is named in few places.** `tauri` appears in `lib.rs` (the commands
  and the composition), `preferences/mod.rs` (the application-data path),
  `preview/drop_ingestion.rs` (window drop events) and four `PreviewService`
  methods: three clipboard copies and the drop channel. Otherwise the service
  is an ordinary Rust value built from a `PreviewProvider`. `preview` is a
  private module; the library exports only `run()`. Its crate types already
  include `rlib`, so another package can link it.
- **In flight.** Draft PR #161 (`be/integrate`) adds ADR 0055's structured
  intent (`crates/proteowizard/src/structured.rs`, with its tier and its
  lowering), the 1,024 capacity of ADR 0057, preset storage (ADR 0058) and
  project schema 5. Draft PR #175 (`be/reader-preview`) reads the preview's
  table and spectra natively. Both rewrite files a CLI would call. Neither is
  on `main`.
- **An approved plan has a precedent.** The targeted-MS1 recipe resolves typed
  targets into a digest-named plan for review, and the run is an accepted
  operation (catalog ANA-004; ADR 0049 and 0050).
- **The name is free.** The installed executable is `mscanvas-desktop.exe`
  ([beta-1 installed check](../../release/beta-1/INSTALLED_CHECK.md)), so an
  `mscanvas.exe` beside it does not collide on a case-insensitive file system.

**The question.** Which surface carries automation, and in what order, without
a second spelling of any rule and without opening a door the desktop keeps
shut.

## Options

**A. A separate CLI binary over shared Rust code.** There are three ways to
share the code:

- **A1. A small CLI package over the desktop library.** A workspace package,
  `apps/cli` (package `mscanvas-cli`, binary `mscanvas`), links
  `mscanvas_desktop_lib` and drives the same `PreviewService` operations the
  Tauri commands drive, through one public module the library adds. Every rule
  is reused as it is, and no file moves. The costs:
  - the binary links Tauri's crates although it calls none of them; its size,
    and whether anything Tauri links needs WebView2 at load, are unmeasured;
  - one more workspace member, a path package in `Cargo.lock` and no
    third-party dependency. The proposal's "no crate per noun" is about domain
    crates; this is a second composition root, as `mscanvas-desktop` is one.

  A variant puts `src/bin/mscanvas.rs` in the desktop package itself. It is
  not proposed. The Tauri CLI's embedded NSIS template (read in a local
  2.11.4 install; `main` pins 2.12.4, not re-read) copies a
  `binaries` list beside the main executable ("Copy external binaries"), and
  the maintainer's unverified reading of the bundler is that it fills that
  list with every non-main binary target of the app package as well as with
  `externalBin`. The CLI would then ship before open question 4 is answered.
  Two binaries in one package also make a bare `cargo run` ambiguous
  (`default-run`). A separate package is invisible to the bundler.
- **A2. Move first, then build.** The Tauri-free application layer (`preview/`,
  `project/` and what they need) moves into one shared library crate, leaving
  `mscanvas-desktop` as the Tauri composition root the proposal describes. The
  CLI is its own package over that crate. This is the cleanest dependency
  graph. The cost is a mechanical move of tens of thousands of lines that every
  open lane touches (#161, #164, #175). It can only happen in a quiet window,
  and nothing a user sees changes.
- **A3. A CLI over `mscanvas-proteowizard` alone.** Acceptance, the
  configuration authority, the destination policy and the coordinator's order
  would be written a second time.

**B. A desktop-hosted local server.** The running application listens on a
local port, and the CLI and the MCP adapter are its clients.

**C. A Python wrapper.** A package that calls `msconvert`, or reimplements
plans, in Python.

**D. Nothing yet.** Beta-1 testers come first, and the structured intent is
still moving (#161).

## Decisions

### 1. The route: A1 now, A2 only on a measured need

- The CLI is the package `mscanvas-cli` in `apps/cli`, binary `mscanvas`, over
  the desktop library. The library gains one public module, `cli`, as its only
  new export, and `preview` stays private. The glue lives in a new submodule,
  `preview::automation`, which sees the `pub(super)` items of `selection`,
  `destination_policy` and `destination` as they are, so no visibility there
  widens. Its entry is a `pub fn` with a standard-library signature (argv as
  `OsString`s in, the exit code out), and `cli` only re-exports it.
- Each subcommand is a thin adapter, as a Tauri command is: parse typed argv,
  call the service, print the answer. No subcommand reuses a rule under a
  second spelling. What the CLI adds is listed here, so a review can test the
  implementation against this list; an item that reuses an existing rule
  names it:
  - allowed roots, and how long a root is held (decision 4). Containment under
    a root is not a new rule: it is the destination policy's ancestry walk
    (`destination_is_within`), extracted once in `destination_policy.rs` so
    that it starts from a held handle, and called by the destination policy
    and the CLI alike;
  - plan and report files, created new (decision 4). Their names pass
    `SubfolderName::parse`, and they are created as `create_child_object`
    creates a folder, by a file variant of it in the same module: two
    extractions, not two new rules;
  - plan documents, and the per-item digest comparison when an item runs
    (decision 5);
  - `validate`'s re-check of outputs by name, against a digest-bound report
    (decision 5);
  - the cross-process run lock and its holder record (decision 6);
  - cancellation from the console, and from a closed stdin for the adapter
    (decisions 6 and 7);
  - one change in the shared crate, not in the CLI: the backend process is
    started detached from any console, so a console's control events never
    reach it (decision 6). It applies to the desktop's spawns too;
  - the MCP adapter's own digest-named plan and report store (decisions 4
    and 7).
- A2 waits for a measured need:
  - the CLI binary's size or a load-time dependency that matters;
  - a CLI on another operating system;
  - build time that slows CI.

  When the need comes, A2 is one mechanical move in a quiet window, with no
  change in behavior.
- **The `e2e` feature.** It compiles in the webview boundary script, the QA
  preference root (`UiPreferenceStore::bind`) and the seeded spectrum and
  chromatogram (`preview::seed_spectrum_for_e2e` and the service methods
  behind it). All of them are reached only from `run()`'s setup and from
  `bind`, and the CLI calls neither. The CLI is built without the feature, as
  the shipped desktop is. There is no compile-time barrier, because the
  required `cargo clippy --all-features` run would trip it; instead a test
  checks that `cli` and `preview::automation` name no `e2e`-gated item.
- **Tests reach the fake provider in-process only.** The desktop's fake
  provider exists under `cfg(test)` inside the desktop crate
  (`preview/tests.rs`: "no production command can ever return mock data"), and
  `PreviewProvider` is in the private `preview` module. Every test that needs a
  fake backend is therefore a unit test of `preview::automation`. It calls the
  function behind the binary's `main` with typed argv, a fake provider in
  place of the discovered one and a run lock bound to a temporary directory
  (decision 6), and checks the document and the exit code. Slice 1 needs no
  working fake: its "no launch" case uses the existing `cfg(test)`,
  `pub(crate)` double `idle_provider::NoProcess`, which fails a test that
  starts a process. The working `FakeProvider` lives in `preview/tests.rs`;
  slice 3 moves it into a `cfg(test)`, `pub(crate)` module of its own, as
  `idle_provider` is, after #161 and #175 merge, because both edit that
  file. The shipped binary gets no provider or lock-directory injection
  point, for the reason the desktop's manifest gives for `test-support`: a
  seam that can forge a backend in a shipped build forges it anywhere.
  - What this gives up: no test runs `mscanvas.exe` against a fake backend,
    and no test runs it where it would take the run lock, because the built
    binary binds the real profile.
  - What still runs as a process: tests of the built binary cover only what
    needs neither a backend nor the lock. That is usage refusals, `inspect` on
    fixtures, `validate`, the root refusals, and stdin closed. The run lock
    held by another process is a unit test, with a child process holding the
    file in the test's own lock directory. Console isolation is tested in the
    crate, with a controlled child as `process.rs` already does (decision 6).
    A run that was killed is reproduced by leaving a staging directory made
    the way the crate's `live_recovery` tests make one.

### 2. What the CLI exposes first

A closed set of subcommands. None takes an executable, an argument list or a
free-text option.

| Subcommand | What it does | Starts ProteoWizard |
| --- | --- | --- |
| `inspect <file>…` | Accepts each file under the rules Add files uses and reports its family and length. For mzML it also reports what `inspect_file` and the native reader give: counts, MS levels, representation, compression, precision, processing history and a spectrum-table summary. A vendor file gets admission facts only: family, length and, for SCIEX, whether the companion was observed | Never |
| `intents` | The configuration read for the installation: each admitted row with its stable id, summary, lossy statement, tier and availability | Yes: discovery's capability probe |
| `plan` | Builds a plan document (decision 5) and writes it create-new | Yes: the capability probe |
| `run` | Runs one approved plan, one item at a time | Yes |
| `validate` | Re-checks a run report's finalized outputs by name: length and SHA-256 against a report bound by its digest (decision 5). The output checks ran before each output was finalized and are recorded in the report; unchanged bytes still pass them | Never |
| `help` | Usage text | Never |

- **The intent is named, never defaulted.** `plan --intent <stable-id>` names
  an admitted row. After #161 merges, `--intent-file <file>` takes the
  structured intent's JSON wire and judges it with the same validating
  constructor the desktop uses.
- **Tiers and labels follow ADR 0055 unchanged.** A buildable intent that
  equals no admitted row is in the advanced tier, and a blocked combination is
  refused. An advanced intent carries "not verified by MSCanvas"
  per item, in the plan, the run report and diagnostics. On a build with no
  measured row, every setting carries the label; the build gate is the one
  `main` holds when the slice lands, after ADR 0055's owner decision of
  2026-10-29.
- **Nothing scientific has a default.** `--intent` is required, so no
  centroiding happens unless the named row or intent holds a picker step, and
  then the plan names the loss. `--out <dir>` is required, and the destination
  policy keeps refusing a folder inside a recognized vendor dataset (CNV-003).
  `--conflict fail|skip` defaults to `fail` (CNV-008).
- **Later, by their own slices:** presets (`--preset <name>`, reading ADR
  0058's document without writing it) and ADR 0055's file-valued parameters.

### 3. Output, exit codes and no prompts

- **stdout carries exactly one JSON document per invocation**, except under
  `mcp`, whose stdout is the JSON-RPC stream (decision 7). The document is
  UTF-8 without a byte-order mark, LF, ending in a newline:
  `{ "schema": "mscanvas.cli.<subcommand>", "schemaVersion": 1, "outcome":
  "ok" | "refused" | "failed" | "cancelled", … }`. A refusal or failure is a
  document too, with a stable `code` and a repository-authored English
  `message`. `help` is the only text output.
- **stderr is empty by default.** `run --progress jsonl` writes bounded
  progress events there (phase, item index, elapsed time).
- **A panic is exit 5, not 101.** The workspace keeps the default `unwind`.
  The entry installs a panic hook that writes nothing to stderr and wraps its
  body in `catch_unwind`; a panic on a worker thread reaches it through that
  thread's `join` result. Each becomes the exit-5 document.
- **No prompt, ever.** No interactive question, no pager, no colour, and no
  change of behaviour on a terminal. A missing decision is a refusal.
- **Exit codes, a closed set:**

  | Code | Meaning |
  | --- | --- |
  | 0 | Done as asked: every file inspected; the plan written; every item finalized, or skipped as the plan allowed; every output unchanged and passing |
  | 1 | Refused before anything changed, with a typed code: a path outside the roots, drift, a digest that was not approved, the build, the run lock, capacity. `inspect` with several files exits 1 when any one is refused, and its document still lists every file's own result |
  | 2 | Usage: an unknown subcommand or flag, a missing or repeated flag, a path that is not valid UTF-8, an input document of an unknown schema or with an unknown field. Nothing is inspected or run. One exception: `run` without `--approve` is the plan review of decision 5, exit 1 |
  | 3 | Ran, and something failed: an item was not finalized (the others keep their outcomes), or `validate` found a changed output or a failed check |
  | 4 | Cancelled: Ctrl+C or Ctrl+Break, or the adapter's client went away or cancelled. Promised for the console only with the backend detached from it (decision 6). Closing the console is best effort |
  | 5 | Internal error: a defect, said so in the document |

- **Schemas.** Each document and version gets one checked-in JSON Schema file
  under `schemas/cli/`, with golden documents for every subcommand. A Rust
  test checks each golden document against its schema's declared properties
  and required keys, using `serde_json` only. Full JSON Schema validation
  would need a dependency and is not proposed.
- **Compatibility.** Within a version, an output document only gains optional
  fields. Input documents (plans, intent files) refuse unknown fields, as the
  desktop's requests do. A later CLI reads an older plan version exactly or
  refuses it as unsupported; it never upgrades one silently. "Stable" starts
  at M10's closure. Until then a version may change between slices, and the
  binary is not shipped (open question 4).
- **A path that cannot round-trip is refused.** A non-UTF-8 path from
  `args_os` cannot be written into JSON, so it is a usage refusal.

### 4. Paths and allowed roots

- **Every subcommand that names a file takes one or more `--root <dir>`.**
  Every source, destination, plan and report path must resolve under one of
  them, or it is refused (`pathOutsideRoots`). The MCP adapter's own store is
  the one exception, below.
- **Containment reuses the destination policy's rule.** The question "is this
  object at or under that directory" is already answered once, for CNV-003's
  row 2, by `destination_is_within`: "an ancestry walk compared by object
  identity at each step, not a string prefix", which ADR 0043 requires. The
  CLI asks the same question, so it calls the same walk. The walk is
  extracted once in `destination_policy.rs` so that it takes its start from a
  held handle, and the destination policy calls the extracted form. No lane
  in flight edits that file.
  - **Where the walk starts:** the identity of the handle the CLI holds, and
    that handle's own final path (`GetFinalPathNameByHandleW`, as
    `std::fs::canonicalize` reads one). Not the canonical path the picker's
    acceptance takes from a separate resolution of the name (ADR 0005,
    `selection.rs`), which can name another object than the one held. A
    junction in a middle directory is resolved in that final path, so a
    junction inside a root that points outside it starts the walk outside,
    and it never meets the root.
  - **What it must meet:** the root's identity, read from the root's held
    handle. Identity is the volume serial and the file id, so a sibling
    `D:\data-x` never matches `D:\data`.
  - **The extracted signature:** start path, start identity, end identity.
    Today's walk reads its end by name (`canonicalize` of the acquisition
    root, then `directory_identity_of`); the destination policy keeps doing
    that and passes the result in, and the CLI passes the identity of its held
    root.
  - **Failure:** as in the destination policy, an identity that cannot be read
    at any step refuses (`pathOutsideRoots`), and so does a walk that ends at
    the top of its volume.
- **A root is held for one operation, not for the life of the process.** A
  root is admitted and held as a destination root is (`admit_and_hold`, ADR
  0009): not followed if it is a link, held without `FILE_SHARE_DELETE`, and
  held before it is judged. The hold is released when the operation is
  terminal. ADR 0009 states the cost
  of such a hold: "Windows refuses to rename any *ancestor* of a held
  directory", so for as long as the hold lasts the user cannot rename or
  remove the root or any folder above it. That is why the hold lasts one
  operation:
  - **the CLI:** one invocation is one operation, so it holds its roots from
    argv parsing to exit, and a `run` holds them to the end of the run;
  - **the MCP adapter:** at launch it opens each root, records its identity
    and releases it; a root that cannot be admitted fails the launch. Each
    tool call opens its roots again by their launch paths, compares each
    identity with the recorded one and refuses on a difference
    (`rootReplaced`), then holds them until the call is terminal, and a `run`
    until the run is. An idle adapter holds no root.
- **By kind of path:**
  - **source:** acceptance as the picker's files get it, then containment on
    the accepted file's handle;
  - **destination (`--out`):** admitted by `admit_and_hold`, as the queue's
    destination is, then containment on the held destination;
  - **plan and report files, created new:** the parent directory is admitted
    and held by `admit_and_hold`, as a destination is, and passes
    containment. The last component passes `SubfolderName::parse`, which
    already refuses `:` (an NTFS alternate data stream would attach to an
    existing file, a source included), the other characters Windows will not
    put in a name, surrounding whitespace, a trailing dot, and the reserved
    device names, `CONIN$`, `CONOUT$` and the superscript port numbers
    included. The CLI reuses the predicate and reports its own code,
    `fileNameUnusable`, not the desktop's folder message. The file is created relative to the held parent with
    `NtCreateFile`, `FILE_CREATE`, `OBJ_DONT_REPARSE` and
    `FILE_NON_DIRECTORY_FILE`: the file variant of `create_child_object`. An
    existing name is refused, nothing follows a link, and the parent cannot be
    replaced while it is held, so nothing has to be checked or removed after
    creation;
  - **every argv path:** a `\\?\` or `\\.\` prefix and a drive-relative path
    (`C:x`) are refused. A relative path resolves against the working
    directory before any check.
- **Roots are fixed for the life of the process.** The CLI takes them from
  argv, and the MCP adapter from its launch configuration (decision 7).
  Nothing in a tool call or a document can add one.
- **Sources are read-only.** Inside a root the CLI writes only its outputs
  into the destination folder and the plan and report files it was told to
  write, all create-new.
- **One exception: the MCP adapter's own store.** A plan made through the
  adapter, and the report of a run through it, are kept in the adapter's store,
  not under a root (decision 7):
  - a folder in the application-local directory, bound the way the run lock's
    directory is bound (decision 6), so tests and the `e2e` build never write
    the real profile;
  - each file is named by its own digest and created new as plan and report
    files are, relative to the held store folder. No tool call names a path
    in it; a tool names a plan or report by digest only;
  - the adapter never deletes from it. When it holds the cap's number of
    files, a new plan is refused (`planStoreFull`). A result holds no
    absolute path, so the store's location is documented for the person to
    clear. The cap is open question 8.

### 5. Plans, approval and drift

- **`plan` writes a plan document, create-new.** It never relies on stdout
  redirection, because Windows PowerShell 5.1's `>` writes UTF-16. The
  document holds:
  - the MSCanvas version, and each root's canonical path and identity;
  - per item: the canonical source path, family, object identity (volume
    serial and file id), length and SHA-256, and the derived output names
    where the plan knows them. A SCIEX item's names come from the backend, as
    in the desktop's queue, and are recorded as not known until run;
  - per companion of a bundle (SCIEX's `.wiff.scan`), in bind order: its
    canonical path, object identity and SHA-256. The companion is where the
    spectra live, and the backend opens it although no argv names it, so a
    plan that bound only the primary would let a rewritten companion through;
  - the intent (a stable id, or the structured intent after #161), its tier
    per item and its lossy statements;
  - the provider's release, revision and `msconvert` SHA-256;
  - where the installation came from: `named`, with the `--proteowizard`
    folder's canonical path and identity, or `discovered`;
  - the destination's canonical path and identity, and the conflict policy;
  - the option tokens the intent lowers to, without staging paths.

  stdout prints the summary and the plan's digest: the SHA-256 of the file's
  exact bytes.
- **`run --plan <file>` without `--approve` is the review.** It reads the plan
  as `run` does (below) and prints MSCanvas's own review document: the
  summary, every item with its tier and lossy statements, the installation's
  source, and the digest. It refuses with `planNotApproved` and exits 1. It
  starts no process, takes no lock and writes nothing. This is what a person
  approves from: text MSCanvas wrote, read in their own terminal, not an
  agent's account of the plan.
- **`run --plan <file> --approve <sha256>`** reads the plan file once, through
  a deny-write handle, into memory; the digest and the parse are of those same
  bytes. It refuses unless the digest equals the approved one
  (`planNotApproved`). It refuses a plan written by another MSCanvas version
  (`buildChanged`), because the lowering, the tiers and the labels belong to
  the version, and roots that are not the plan's roots, the same set by
  canonical path and identity (`rootsChanged`); a plan is never re-judged
  under other roots. Then, holding the run lock (decision 6), it re-derives
  the plan in its own process:
  1. accept every source again and hash it, one acquisition at a time, through
     deny-write handles (`lock_against_replacement`) released after each
     acquisition. A bundle's members are locked together, as the desktop's
     SCIEX paths do (`service.rs`), and every member is compared: identity,
     name and digest;
  2. resolve the installation again from the source the plan records
     (decision 6), and read its configuration. `run` takes no
     `--proteowizard`; one given is a usage refusal;
  3. plan again with the same intent, destination and policy;
  4. compare the result with the approved plan, field by field.

  Any difference refuses before a staging directory exists, with the first
  drift's code. Every field has one: a source or companion
  (`sourceChanged`); the provider's release, revision, `msconvert` SHA-256 or
  the installation's source (`providerChanged`); an intent the installation
  no longer admits (`intentNotAdmitted`); the destination or the conflict policy
  (`destinationChanged`); any other field, such as a tier, a lossy statement,
  an option token or a derived output name (`planChanged`). Then each item
  runs, one at a time, through the ADR 0011 coordinator. Under Fail an item
  whose output name is taken is not converted and the run exits 3; under
  Skip it is skipped.
- **Each item is bound again when it runs.** The comparison above happens
  once, but a run of up to 1,024 items can take hours, and the workspace
  lease shares writes on purpose (`selection.rs`, `FILE_SHARE_ALL`). For a
  single-object family the coordinator's own revalidation compares identity
  only, and an identity survives an in-place rewrite. For a bundle it already
  compares the member digests (`selection.rs`, `member_digests`), but against
  the acceptance the process remembered, not against the plan. So after
  `lock_against_replacement` on every member and `open_conversion_source`,
  what the conversion source has just computed under those deny-write handles
  is compared with the plan:
  - the primary's length and SHA-256 (`ConversionSource::byte_length`,
    `sha256`), which cover the primary only;
  - for a bundle, each companion's identity and SHA-256
    (`companion_identities`, `companion_digests`). The crate exposes no
    companion length, and the digest binds the content without it.

  A difference refuses that item with `sourceChanged` before its staging
  exists; earlier items keep their outcomes, and the run exits 3. The check
  costs no extra read. The CLI cannot make it from outside: it sits in the
  queue's item runner in `service.rs`, right after `open_conversion_source`.
  A queue item gains an optional expected binding, which the desktop's queue
  leaves empty (decision 9, CLI slice 4).
- **What approval means.** It binds "what was reviewed is what runs". It does
  not authenticate a person: anyone who can read a plan can compute its
  digest, and `plan` prints it. For a person typing at their own terminal
  that is the right meaning, because the shell's user is the person. When an
  agent drives the CLI, the agent is the shell's user, and `--approve` is not
  a boundary against it (decision 6, "An agent with a shell"). For an agent
  the boundary is the MCP adapter's approval (decision 7, open question 2).
- **Bound to bytes.** Each source, every member of a bundle included, is
  hashed at plan, before the run and again as its item runs. An identity-only
  binding is cheaper, but a file an instrument is still writing keeps its
  identity; ADR 0049 binds a run to bytes for that reason.
- **The run report.** It names the approved plan's digest. Each item is
  finalized (output names, length, SHA-256, checks passed, the not-verified
  flag), skipped, failed (a typed code and no backend text), cancelled, or not
  started. The report is always printed, and also written create-new when
  `--report <file>` is given; the result and the last progress event carry
  the written report's SHA-256.
- **`validate --report <file> --report-digest <sha256>`** is a new rule, not
  `FinalizedOutput`'s drift check: that is a session-scoped object that does
  not survive the process (`finalized_output.rs`). It reads the report like a
  plan, once and through a deny-write handle, and refuses it unless its digest
  matches (`reportNotApproved`), so rewriting an output and its report
  together is caught. Then it opens each finalized output by name with a
  deny-write handle and compares length and SHA-256 with the report. The file
  id is reported but not required, because a file system may reissue one.
- **No adoption.** The CLI adds nothing to a workspace or a project. A
  finalized output is a file in the destination, which the desktop opens like
  any mzML.
- **Capacity.** A plan holds at most `MAX_CONVERSION_QUEUE_ITEMS` items: 16 on
  `main`, and 1,024 under ADR 0057 once #161 merges.

### 6. The security model

- **Approved plans only** (decision 5). Nothing runs without a plan file and
  its digest.
- **Allowed roots** (decision 4).
- **No shell strings.**
  - argv is read with `std::env::args_os` into typed values;
  - backend argv comes only from the crate's lowering, one element per token,
    with no `-c/--config` and no free-text argument (ADR 0055, decision 2);
  - the installation is found by discovery or named with
    `--proteowizard <folder>`. A named folder that is unusable is refused,
    never replaced by discovery. The plan records which (decision 5), and
    `run` resolves through that source only. A named folder that is now
    unusable or has another identity, or a discovery that finds another
    `msconvert`, refuses as `providerChanged`, and discovery never stands in
    for a named folder;
  - the MCP adapter takes the installation as it takes its roots: from its
    launch configuration (`mscanvas mcp --proteowizard <folder>`) or from
    discovery, fixed for the life of the process. No tool input has an
    installation field, and one that appears is refused as an unknown field.
    Its `run` refuses a stored plan whose recorded source is not its own
    launch configuration's (`providerChanged`).
    `intents` and `plan` start a capability probe without an approval, so an
    agent that could name the folder would choose which executable the
    adapter starts. The desktop keeps the same rule: "choosing a file or an
    installation is a request to show a picker, not a path the webview
    names" (`preview/mod.rs`).
- **No network.** The CLI and the adapter open no socket, listen on nothing,
  check for no update and send no telemetry. The MCP adapter uses the stdio
  transport only. An MCP host sends tool results to its model provider, which
  is why the adapter's results are bounded and name no absolute path
  (decision 7).
- **Never overwrite.** Finalization is Fail or Skip only. Plan and report
  files are create-new. There is no `--force`.
- **No hidden science.** No default intent; tiers and the label as ADR 0055
  states them.
- **Bounded, redacted output.** No backend stderr text reaches a document
  (RUN-005). Messages are repository-authored, and diagnostics follow ADR
  0017.
- **One ProteoWizard process across processes.** Each process has its own
  backend gate today, so a CLI run beside an open desktop could start two
  backend processes, which ADR 0057 does not allow before its throughput
  measurement. Decision:
  - a per-user run-lock file, opened with no sharing (`share_mode(0)`, from
    the standard library);
  - **where:** one function both processes call resolves the directory, as
    `SHGetKnownFolderPath(FOLDERID_LocalAppData)` plus `org.mscanvas.desktop`.
    The desktop takes the lock through this function too, not through Tauri's
    resolver, so no environment variable and no host that trims the
    environment can split the two. The `windows` crate's `Win32_UI_Shell` and
    `Win32_System_Com` features are already on. A directory that cannot be
    resolved refuses (`runLockUnavailable`);
  - **bound, not looked up:** the lock is a value over a bound directory,
    handed to the service and to the CLI's composition root. The one resolver
    above is the production binding only. Tests bind a temporary directory of
    their own, as `UiPreferenceStore::for_root` does, so parallel tests do not
    contend and nothing is written into a real profile. The `e2e` build binds
    the task-owned QA root, as `UiPreferenceStore::bind` does under that
    feature, because a QA campaign "must not quietly write into the real
    profile" (`preferences/mod.rs`);
  - **how long:** each side holds it from before the first ProteoWizard
    process an operation would start, discovery's probe included, until that
    operation is terminal. A CLI `run` takes it before re-derivation and holds
    it to the end of the run; the desktop's queue holds it until the queue is
    terminal; `intents` and `plan` hold it for the probe. Neither side can take
    it between two of the other's items;
  - the CLI refuses with `backendBusy` instead of waiting, before any probe;
  - **the holder record:** beside the lock, the holder writes its kind
    (`cli`, `mcp` or `desktop`), PID, process creation time (a PID alone is
    reused) and start time. A refused process reads it to say who holds the
    lock. The record is a description; the lock, which the system releases
    when its holder dies, is the only authority;
  - both sides, and what the desktop does while the lock is held, come in CLI
    slice 2, before any subcommand that starts a probe (decision 9; open
    question 3).
- **The backend is detached from the console.** Today the crate creates the
  backend with `CREATE_SUSPENDED` and no other creation flag (`process.rs`).
  Under the CLI the backend would therefore be attached to the CLI's console,
  and a Ctrl+C or Ctrl+Break typed there would reach `msconvert` directly. It
  would end itself and race the queue's stop, and the item could be judged a
  backend failure (exit 3) rather than cancelled. The property required: no
  console control event reaches the backend, and only the CLI's handler stops
  it, through the job object.
  - Recommended: the crate's spawn adds `CREATE_NO_WINDOW`, which gives the
    backend a console of its own with no window. The maintainer's reading of
    the console documentation is that a new process group alone
    (`CREATE_NEW_PROCESS_GROUP`) disables only Ctrl+C in the child, while
    Ctrl+Break typed at the console still reaches every process attached to
    it. The slice that makes the change confirms the flag with the test below
    before relying on it.
  - It is a shared-crate change and applies to every spawn, the desktop's
    included, so there is one spelling. What it changes for the desktop's
    own spawns is measured in that slice, not assumed.
  - ADR 0014's cancellation evidence was taken on the spawn as it is.
    Cancellation goes through `TerminateJobObject`, not a console event, so
    no change is expected, but the evidence is taken again on the changed
    spawn during the native qualification under its hold release.
  - Open question 7.
- **Cancellation.** Ctrl+C and Ctrl+Break reach a handler registered with
  `SetConsoleCtrlHandler`, declared the way the crate already declares its
  `kernel32` functions, so no dependency changes. The handler maps to the
  queue's stop. With the backend detached, the item is cancelled and the run
  exits 4 with its staging reclaimed. Until the detachment lands, exit 4 from
  the console is not promised. Closing the console is best effort: Windows
  ends the process soon after the handler returns from `CTRL_CLOSE_EVENT`, so
  an orderly stop is not promised there.
- **A killed run leaves its staging.** If the process is killed, or the
  console closes first, the job object ends the backend with it. What is left
  is the item's staging directory, `<output name>.mscanvas-staging` in the
  destination folder, with MSCanvas's owner marker inside. Nothing reclaims it
  today: the desktop's recovery reclaims only records of its own session
  (`staging_recovery.rs`; `StagingRecovery` is "an opaque live-session
  record"), and a later run of that item refuses at the name
  (`StagingTargetExists`). The crate's `ConversionPlan::reclaim_staging_area`
  removes a marked staging area for one plan, but only when its caller
  asserts that no run of that plan is in flight. Whether `run` offers that,
  under the run lock, is open question 6. Until then the result names the
  folder, and the user deletes it.
- **The ProteoWizard hold.**
  - In the product: `inspect` and `validate` never start a process. `intents`,
    `plan` and `run` start ProteoWizard exactly as the desktop does.
  - In development: no agent, test or CI job runs a real ProteoWizard through
    the CLI or the adapter without a recorded, bounded hold release. Tests use
    the fake providers and `test-support` evidence. Real qualification of
    `run`, through the CLI and through the adapter, is a native item under its
    own release.
- **An agent with a shell.** A host that also gives an agent an unrestricted
  shell lets it run `msconvert` itself, or `mscanvas run --approve` with the
  digest `plan` printed. No MSCanvas design changes that, and the CLI does not
  claim to. The boundary MSCanvas offers an agent is the MCP adapter's `run`.
  The skill asks an agent never to run `mscanvas run` itself, but that is
  guidance, not a boundary (decision 8).

### 7. The MCP adapter sits on the CLI's schemas

- **Same binary.** `mscanvas mcp --root <label>=<dir> …` runs the adapter over
  the stdio transport (newline-delimited JSON-RPC 2.0). One protocol revision
  is pinned, and recorded when the slice starts.
- **A fixed tool list, one tool per subcommand:** `inspect`, `intents` and
  `plan`, and `run` and `validate` only from the second MCP slice. `validate`
  names a report in the adapter's store, and only the adapter's `run` writes
  one there.
  - Each tool's input takes its subcommand's arguments, except the roots and
    the installation, which come from the launch configuration only (decisions
    4 and 6), and plan and report paths, which are digests. Its result
    (`structuredContent`, with the same JSON as text) is its subcommand's
    document, with one difference: every path is root-relative (below), and
    roots appear by label only. The adapter's schemas therefore have ids of
    their own, `mscanvas.mcp.<tool>`, checked in under `schemas/mcp/` beside
    `schemas/cli/`'s `mscanvas.cli.<subcommand>`. Both kinds of document are
    serialized from the same Rust types, with the path representation as the
    only parameter, and a test checks that each pair of checked-in schemas has
    the same fields except for the path representation. One schema for both
    was considered: it would make the CLI label its roots too and drop
    absolute paths from its documents, which the CLI's user named directly
    and needs back.
  - Tools are never registered dynamically, and no resource or prompt
    executes anything. That keeps the AGENTS.md rule against a generic plugin
    ABI.
- **One implementation.** The adapter calls the same in-process functions as
  the subcommands. It does not start the CLI.
- **A client that goes away cancels.** The adapter has no window, and a run
  can be long. End of input on stdin, or a failed write to stdout, takes the
  Ctrl+C path: the work in progress is cancelled, the run lock is released,
  and the adapter exits. Nothing keeps running for a client that is gone.
- **Paths are root-relative.** A file is `{ "root": "<label>", "path":
  "<relative path>" }` in both directions. A result never holds an absolute
  path, because results reach the host's model provider. A plan made through
  the adapter, and the report of a run through it, are written to the
  adapter's own store (decision 4's exception), named by their digests; the
  agent receives the digest and the summary, and names a plan or a report to
  `run` or `validate` by digest only. The outputs themselves go to the plan's
  destination, which is under a root as for the CLI.
- **`run`, second MCP slice.** It runs a plan only after an approval the
  agent cannot give by calling a tool. Recommended: MCP elicitation. The
  adapter asks the client to show the plan's summary and digest, in text the
  adapter wrote, not the agent, and runs only on an accept. A client that does
  not declare elicitation is refused (`approvalUnavailable`) and nothing runs.
  - What this buys is narrow. The approval text is the adapter's, and no tool
    call can satisfy it.
  - What it does not buy: the accept comes from the client, and the adapter
    cannot tell whether a person or a client policy gave it, just as it cannot
    tell for the host's tool confirmation. Every option in open question 2
    trusts the client except an approval record the person writes outside it.
- **No SDK.** The adapter is written over `serde_json`: `initialize`,
  `tools/list`, `tools/call`, cancellation and progress notifications. An MCP
  SDK crate would be a new dependency and is not proposed.

### 8. Skills sit on the CLI

- **One skill, `mscanvas-automation`,** kept outside `.agents/skills/`, beside
  the CLI's package (`apps/cli/skills/`), and copyable as a user skill. This
  repository's development agents load `.agents/skills/*`. A product skill
  there could be triggered during development and lead an agent to
  `intents`, `plan` or `run`, which start ProteoWizard (discovery's probe
  runs `msconvert --help`), against the hold.
- **What it does.** It walks an agent through inspect → intents → plan → the
  person reviews the plan in MSCanvas's own words and runs it → validate. The
  agent never runs a plan itself:
  - until MCP slice 2, the skill hands the person `mscanvas run --plan <file>`
    with its roots and no digest, to run in their own terminal. That prints
    the review (decision 5); the person reads it, copies the digest from it
    and runs the line again with `--approve <digest>`. The agent waits;
  - once the adapter's `run` exists, an agent on the adapter runs through it,
    behind its approval (decision 7). An agent with only a shell keeps the
    first path.

  It never calls `msconvert`, never edits a plan file, never computes, passes
  or writes out an approval digest on the person's behalf, and reports every
  refusal as the CLI wrote it. Its text says that inside this repository only
  the fake providers are used, and that `intents`, `plan` and `run` against a
  real installation need a recorded hold release.
- **A skill is guidance, not a boundary.** What it states falls in two kinds:
  - **enforced by the CLI and the adapter**, so an agent that ignores the
    skill gets their refusals: roots, the plan digest binding, drift, the
    per-item binding, create-new and never overwrite, the run lock, and, on
    the adapter, the approval of `run`;
  - **guidance only**, which nothing enforces for an agent with a shell:
    waiting for the person, not running `mscanvas run` itself, not computing
    a digest, and not calling `msconvert`. Decision 6 says why.
- **Its examples use the repository's fixtures,** and its checks run against
  the fake providers, never a real installation.

### 9. Order and dependencies

1. **CLI slice 1:** the package, `inspect`, the envelope, exit codes, roots and
   schemas. It needs nothing open and can start now. What it touches outside
   the new package:
   - the `cli` module in `lib.rs`, a `pub use` of `preview::automation`'s
     entry, and one line in the workspace's members; #161 also edits `lib.rs`;
   - one line in `preview/mod.rs`, `pub(crate) mod automation;`, and the new
     `preview/automation.rs`. #175 edits `preview/mod.rs`;
   - `destination_policy.rs`, for the extracted walk, name check and file
     creation of decisions 1 and 4. The walk and `create_child_object` are
     private today and their extracted forms become `pub(super)`;
     `admit_and_hold`, `SubfolderName::parse` and the types they take are
     `pub(super)` already. No lane in flight edits it;
   - nothing in `selection.rs` or `destination.rs`: `preview::automation`
     sees their `pub(super)` items, so `private_interfaces` has nothing to
     report;
   - its "no launch" test uses `idle_provider::NoProcess` as it is.
2. **CLI slice 2:** the run lock and its holder record in both processes, and
   the desktop's refusal while the lock is held. It comes before any
   subcommand that starts a probe, so `main` never holds a CLI that can start
   a ProteoWizard process beside the desktop's, which ADR 0057 does not
   allow. It does not wait for #161, but it edits `service.rs`, which #161 and
   #175 also rewrite, and the desktop's refusal text is a webview resource
   coordinated with the UI lane that owns `apps/desktop/src/`.
3. **CLI slice 3:** `intents` and `plan`. It waits for #161 to merge, because
   the structured intent, its tier and the capacity are there, and for #175,
   because it moves `FakeProvider` out of `preview/tests.rs`, which both
   edit (decision 1).
4. **CLI slice 4:** `run` with the per-item binding, `validate`, the backend's
   detachment from the console in the shared crate, and Ctrl+C. The
   per-item binding edits the queue's item runner in `service.rs`, which #161
   and #175 rewrite, so it also lands after both (decision 5).
5. **The skill.** Until MCP slice 2, its run step is the person's own
   terminal (decision 8).
6. **MCP slice 1:** `inspect`, `intents` and `plan`.
7. **MCP slice 2:** `run` with approval, after open question 2, and
   `validate`.
8. **Closure:** schemas declared stable at version 1, native qualification
   under a hold release, and the distribution decision (open question 4).

A2's extraction is not on this list. It is scheduled only when decision 1's
measured need appears.

## Acceptance criteria

### CLI slice 1

- `inspect` on an mzML fixture prints one document and exits 0. Its facts
  equal what the desktop's acceptance and the native reader give for the same
  fixture.
- `inspect` on a vendor fixture reports family and length, and the fake
  provider records no launch.
- `inspect` on two files, one of them refused, exits 1 and lists both results.
- Refusals: a file outside the roots exits 1 with `pathOutsideRoots`; so do a
  junction inside a root that points outside it, a reparse point at the file
  itself, and, under `--root <dir>`, a file in the sibling `<dir>-x`. A plan
  or report name with `:`, a device name (`CONIN$` included) or a trailing
  dot exits 1 with `fileNameUnusable`, decided by `SubfolderName::parse`'s
  predicate, and a `\\?\` prefix is refused. A non-UTF-8 path and an unknown flag each exit 2 with a usage
  document.
- Containment calls the walk the destination policy calls: the destination
  policy's existing row-2 tests pass unchanged on the extracted form.
- While an invocation holds a root, renaming the root or a folder above it
  fails; once the invocation has exited, the rename succeeds.
- Every test runs with stdin closed, and none waits for input. The built
  binary is run as a process for the cases decision 1 lists; the rest are
  unit tests of `preview::automation`.
- A panic forced in a test exits 5, prints one document on stdout and leaves
  stderr empty.
- Every golden document matches its schema.
- A test fails if `cli` or `preview::automation` names an `e2e`-gated item.
- The desktop still launches in development, and until open question 4 is
  answered the release-candidate installer carries no executable other than
  `mscanvas-desktop.exe` and `uninstall.exe`.

### CLI slice 2

- The lock is held by a child process: the CLI's lock function refuses with
  `backendBusy` and names the holder from its record. A lock bound to a
  directory that cannot be used refuses with `runLockUnavailable`.
- Two services in one test process, each bound to its own temporary lock
  directory, do not contend, and no test writes the lock or its record into a
  real profile.
- While another process holds the lock, the desktop refuses to start a
  conversion, a discovery probe or any other ProteoWizard process, names the
  holder, and is checked in the rendered app. Opening a preview is refused,
  because an open runs `msaccess` for metadata and the run summary (ADR 0056,
  decision 3). Before #175 merges a selected spectrum is refused too; after
  it, a selected spectrum of a preview that was already open is read
  natively and not refused (ADR 0057, decision 1).

### CLI slice 3

- `intents` lists the rows, tiers and availability the desktop's
  configuration read gives for the same fake build.
- `plan` writes create-new and refuses a plan path that exists, and a link
  standing at that name is refused, not followed. The printed digest equals
  the SHA-256 of the written bytes.
- A missing `--intent` exits 2. A vendor file on a build without a measured
  row follows ADR 0055's build gate: labelled, with SCIEX refused; on a build
  that cannot report its release, `plan` refuses every vendor file. An advanced
  intent labels every item, and a blocked combination is refused.
- A SCIEX plan records the companion's path, identity and digest.
- While the lock is held, `intents` and `plan` exit 1 with `backendBusy` and
  start no probe.

### CLI slice 4

- A wrong digest exits 1; no staging directory exists and no process was
  started.
- `run --plan <file>` without `--approve` exits 1 with `planNotApproved` and
  the review document, which matches its schema and golden document; no
  process was started, the lock was not taken and nothing was written.
- Each drift kind is refused before staging, one test per kind, on the fake
  provider: `buildChanged`, `rootsChanged`, `sourceChanged`,
  `providerChanged`, `intentNotAdmitted`, `destinationChanged` and
  `planChanged`. Two of them on the installation's source: a plan made with
  `--proteowizard <folder>` whose folder is unusable at run refuses as
  `providerChanged` and discovery is not tried; a plan made by discovery that
  now discovers another `msconvert` refuses as `providerChanged`.
- Per-item binding: on the fake provider, the second item's source is
  rewritten in place, keeping its identity, after the run has started. That
  item is refused with `sourceChanged` and no staging; the first item's
  outcome is unchanged; the run exits 3. The same holds when the second
  item's `.wiff.scan` companion is the file rewritten.
- A taken output name: under Fail the item is not converted and the run exits
  3; under Skip it is skipped. The existing file's bytes are unchanged in
  every test.
- Console detachment, in the crate: a controlled child, in the style of
  `process.rs`'s `controlled_mock_parent` and never ProteoWizard, is started
  through the crate's spawn from a helper that has a console of its own. The
  helper sends `CTRL_C_EVENT` and `CTRL_BREAK_EVENT` to its console with
  `GenerateConsoleCtrlEvent`; the child is still running afterwards and is
  ended by the job object.
- Ctrl+C, in `preview::automation` on the fake provider: the handler's stop
  cancels the item, its staging is reclaimed, and the run exits 4.
- A staging directory with MSCanvas's marker, left as a killed run leaves it
  and made as the crate's `live_recovery` tests make one, is not removed, and
  the run refuses that item with `StagingTargetExists` and names the folder.
- `validate` exits 0 on unchanged outputs, and 3 with `outputChanged` after
  one byte of an output changes. A report changed by one byte is refused with
  `reportNotApproved`.

### Skill

- Every command in the skill appears in the CLI's golden tests, and the skill
  names no `msconvert` option.
- `mscanvas run` appears in the skill only as a line the agent hands the
  person to run in their own terminal, never as a step the agent runs, and
  without `--approve`: the digest the person approves with is one MSCanvas's
  review printed for them.
- The skill's file is not under `.agents/skills/`, and its text states the
  hold rule.

### MCP slice 1

- `tools/list` returns exactly the fixed tools, with their `mscanvas.mcp.*`
  schemas. Each has the same fields as its `mscanvas.cli.*` schema except for
  the path representation.
- `plan` writes into a store bound to the test's temporary directory, named
  by the plan's digest. A full store refuses with `planStoreFull` and deletes
  nothing.
- An absolute path, or a path that leaves its root, is refused, with the same
  cases as CLI slice 1.
- A tool input with an installation field, or any other field its schema
  does not name, is refused as an unknown field, and nothing is probed.
- While the adapter is idle, with no call in progress, each root and the
  folders above it can be renamed. A root renamed away and replaced by
  another folder of the same name between two calls is refused with
  `rootReplaced`.
- No result in the test suite contains an absolute path.
- Closing stdin during a call cancels it, and the adapter exits.

### MCP slice 2

- A client without elicitation is refused with `approvalUnavailable`; a
  declined approval runs nothing; an accepted one behaves as the CLI's `run`.
- `validate` names a report in the store by digest and exits as the CLI's
  `validate` does; a digest the store does not hold is refused.

## Out of scope

- Preview, figure and data export, targeted MS1, projects, adoption into a
  workspace, the view cache and QC. Each can become a later subcommand by its
  own decision.
- File-valued parameters, `--merge` and `--runIndexSet` (ADR 0055's later
  slices).
- Snakemake and Nextflow examples (the proposal's automation layer, later).
- A Python package, an HTTP API, a desktop-hosted server, remote execution and
  a daemon.
- A generic plugin or tool ABI, and dynamically registered MCP tools.
- Any ProteoWizard run in CI.
- CLI builds for macOS or Linux.
- Any desktop behaviour change other than the cross-process run lock and its
  refusal, and the backend's detachment from the console, a shared-crate
  change that reaches the desktop's spawns (decision 6).

## Estimates

On the plan's basis (section 4: a slice is about one working session, 0.3–1
calendar day):

| Work | Slices | Plan, section 5 |
| --- | --- | --- |
| CLI slices 1–4 | 4 | 2–4 |
| The skill | 1 | 1–2 |
| MCP slices 1–2 | 2 | 2–3 |
| Closure and qualification | 1, plus one hold-release window | included |
| A2's extraction, if ever | 1–2, in a quiet window | not planned |

Calendar: 1.5–3 weeks, as the plan says. It is bound by #161's merge, the
owner's answers and the hold-release window more than by implementation.

## Alternatives rejected

- **A2 first.** It is right eventually, if a need is measured, but it moves
  every file three open lanes are editing and delivers nothing a user can use.
- **A3.** It writes acceptance, the configuration authority, the destination
  policy and the coordinator's order a second time, which ADR 0011 forbids.
- **A second binary target inside the desktop package** (Options, A1).
- **B, a desktop-hosted server.** A listening socket can be reached by any
  local process, and through DNS rebinding by a web page, so it needs a token
  scheme. Automation would need a running window. The installed check found
  nothing listening, and this would change that. It would also share one
  roster and one queue between a person and a script.
- **C, a Python wrapper.** If it calls `msconvert` it bypasses every MSCanvas
  rule: tiers, output checks and no-overwrite. If it reimplements them, they
  are spelled a second time, in a second language. Either way MSCanvas would
  have to ship or require a runtime. Anyone who wants Python can call the CLI
  and read its JSON.
- **D, nothing yet.** It is kept as a sequencing rule, not as the route:
  decision 9 makes the slices that depend on #161 wait for it.
- **`clap` for argv, `schemars` for schemas, an MCP SDK crate.** Each would be
  a new dependency. The closed subcommand set is small enough to parse from
  `args_os` by hand.
- **Roots for the MCP adapter only.** That is two rules for one command layer.
- **The MCP host's tool confirmation as approval.** It trusts the client, as
  elicitation does, and less narrowly: the confirmed text is the agent's own
  tool call, and the call itself is the approval, so a host set to approve
  tools automatically turns every call into a run.
- **MCP's `roots/list` as the allowed roots.** A client may change them during
  a session, and they say where the agent works, not where MSCanvas may write.
- **Identity-only source binding,** and **printing the plan for redirection**
  (decision 5).

## Consequences

- Automation reuses every rule the desktop enforces, because it calls the same
  operations, and adds only the rules decision 1 lists. The desktop's
  behaviour does not change except for the run lock and its refusal, and the
  backend's detachment from the console.
- The CLI carries Tauri's crates until A2. That is a size cost, not a
  capability: the CLI calls no Tauri code.
- A person can convert headless, reproducibly, with machine-readable results.
  An agent that has no shell and works through the adapter, on a client that
  honours elicitation, can prepare plans without being able to run one the
  client did not accept. That is not proof a person accepted it (decision 7).
- The schemas become a compatibility promise at M10's closure, and they cost
  a version bump to change after that.

## What this amends, on acceptance

- [The after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), sections 7.3
  and 9: the route is recorded (done line-locally with this record).
- In the slices that implement it, not now:
  - the feature catalog's AUT-001, AUT-002 and AUT-003;
  - [ADR 0057](0057-conversion-capacity-and-viewing-during-conversion.md):
    serial conversion extends across processes through the run lock (CLI
    slice 2).
- [ADR 0005](0005-mzml-preview-boundary.md) is not amended: no webview
  command is added.
- [ADR 0058](0058-user-saved-conversion-presets.md), decision 2: a method can
  leave the app as a plan file (owner decision A0064), by a dated note (done
  with this record).

## Open questions for the owner

*Answered by the owner on 2026-10-30, each as recommended; see
[Owner decision, 2026-10-30](#owner-decision-2026-10-30). Question 3 was
confirmed again with its corrected cost on 2026-10-31; see
[Owner decision, 2026-10-31](#owner-decision-2026-10-31).*

1. **The route.** A1, a small CLI package over the desktop library, now, and
   A2 only on a measured need, in decision 9's order? Recommended: yes.
2. **How a person approves a run that an agent asks for through MCP.** Every
   option but the second trusts the client to have asked a person.
   - **Elicitation (recommended):** the adapter writes the approval text and
     no tool call can satisfy it; it does not prove a person answered.
     Clients without elicitation are refused.
   - **An approval record:** the person writes it with `mscanvas approve` in
     their own terminal. It works with any client and does not trust it, and
     adds a small store and a step outside the agent's session. Like the CLI's
     `--approve`, it is no boundary against an agent that also has a shell,
     which could run `mscanvas approve` itself (decision 6).
   - **The host's tool confirmation:** not recommended, because the agent
     writes the call that is confirmed, and hosts can approve automatically.
3. **The cross-process run lock.** While a CLI run holds it, the desktop
   refuses operations that would start ProteoWizard and names the holder
   (recommended). Viewing an mzML does not start ProteoWizard once #175's
   native reader is the preview's, so it is not refused. The alternative is to
   have the desktop wait.

   > **Correction, 2026-10-30, after the owner's answer.** The sentence on
   > viewing is wrong. #175 reads the spectrum table and selected spectra
   > natively, but an open still runs `msaccess` for metadata and the run
   > summary (ADR 0056, decision 3). So while a CLI run holds the lock, which
   > for 1,024 items can be hours, the desktop cannot open a new preview.
   > Before #175 merges a selected spectrum is refused too; after it, only the
   > spectra of a preview already open stay readable (ADR 0057, decision 1).
   > That is the cost ADR 0057, decision 2, already accepts while the
   > desktop's own queue runs. The recommendation stands, because waiting
   > would leave an open hanging for as long instead, but the owner answered
   > on the wrong cost and was asked again. *The owner confirmed it again
   > with this cost on 2026-10-31; see
   > [Owner decision, 2026-10-31](#owner-decision-2026-10-31).*
4. **Distribution at M10's closure.** Recommended: the installer carries
   `mscanvas.exe` beside `mscanvas-desktop.exe`, documents where it is, and
   does not change the user's PATH. This is a release change.
5. **Roots for the CLI.** Recommended: required for every subcommand that
   names a file, as for the adapter. The alternative drops them for the CLI,
   whose user names files directly.
6. **A staging directory a killed run left behind.** Recommended: `run
   --reclaim-staging` removes, for its own plan's items only and while it
   holds the run lock, a staging directory that carries MSCanvas's marker,
   and reports each removal. Without the flag the item refuses
   (`StagingTargetExists`) and the result names the folder. The alternative
   is manual deletion only.
7. **Detaching the backend from the console.** Recommended: the shared
   crate's spawn adds `CREATE_NO_WINDOW` for every backend process, the
   desktop's included, confirmed by the controlled-child test of CLI slice 4,
   with ADR 0014's cancellation evidence taken again under the qualification's
   hold release. The alternatives: a flag only the CLI asks for, which is a
   second spelling of how the backend is started; or no console cancellation,
   so that Ctrl+C ends the CLI by Windows' default and the job object ends the
   backend, with the item's staging left behind as for a killed run.
8. **The MCP adapter's store.** Recommended: never deleted by the adapter,
   with a fixed cap on its files, set in MCP slice 1, beyond which `plan`
   refuses (`planStoreFull`), and its location documented. The alternative is
   automatic removal of the oldest entries, which deletes a file the person
   may still want to read and is not proposed.

## Owner decision, 2026-10-30

**Decision A0064.** Shown the open owner decisions, the owner replied
verbatim "全部按推荐，继续" ("all as recommended, continue"). That accepts
this ADR and answers its eight questions as recommended:

1. **The route:** A1, a small CLI package over the desktop library, now; A2
   only on a measured need, in decision 9's order.
2. **MCP approval:** elicitation. The adapter writes the approval text and no
   tool call can satisfy it; it does not prove that a person answered.
   Clients without elicitation are refused (`approvalUnavailable`).
3. **The cross-process run lock:** while a CLI run holds it, the desktop
   refuses operations that would start ProteoWizard and names the holder.
   Viewing an mzML is not refused once #175's reader is the preview's.
   *Superseded on 2026-10-31: that last sentence was wrong when the owner
   answered; opening a new preview is refused too (the correction under open
   question 3). The owner confirmed the answer again with that cost; see
   [Owner decision, 2026-10-31](#owner-decision-2026-10-31).*
4. **Distribution:** the installer carries `mscanvas.exe` beside
   `mscanvas-desktop.exe`, documents where it is, and does not change PATH.
   This is a release change.
5. **Roots for the CLI:** required for every subcommand that names a file.
6. **A staging directory a killed run left behind:** `run --reclaim-staging`
   removes it only for its own plan's items, only while it holds the run lock,
   only when it carries MSCanvas's marker, and reports each removal. Without
   the flag the item refuses (`StagingTargetExists`) and the result names the
   folder.
7. **Detaching the backend from the console:** the shared crate's spawn adds
   `CREATE_NO_WINDOW` for every backend process, the desktop's included,
   confirmed by CLI slice 4's controlled-child test, with ADR 0014's
   cancellation evidence taken again under the qualification's hold release.
8. **The MCP adapter's store:** never deleted by the adapter; a fixed cap on
   its files, set in MCP slice 1, beyond which `plan` refuses
   (`planStoreFull`); its location documented.

The same decision amends [ADR 0058](0058-user-saved-conversion-presets.md) so
that a method can leave the app as a plan file (export and import of a method
as JSON). An imported plan is validated by the same constructor as a preset and
never runs without review. The amendment is a dated note in ADR 0058's
decision 2.

## Changed after acceptance, 2026-10-30

A review after the owner's answer found these. Nothing is implemented, so
each is corrected in place above; this list is so the owner can see what
changed after "全部按推荐".

- **Open question 3's premise was wrong** (correction under the question).
  The owner was asked to confirm it again, and did on 2026-10-31; see
  [Owner decision, 2026-10-31](#owner-decision-2026-10-31).
- **CLI slice 1 widens no visibility.** The glue moves into
  `preview::automation`, which sees the `pub(super)` items it needs;
  `selection.rs` and `destination.rs` are not touched (decisions 1 and 9).
  The earlier text said one line in `selection.rs` would do, which missed
  the other `pub(super)` accessors and types a caller outside `preview`
  would need.
- **The plan records where the installation came from**, named folder or
  discovery, and `run` resolves through that source only, so a named folder
  can never fall back to discovery (decisions 5 and 6).
- **`run --plan` without `--approve` prints MSCanvas's own review**, and the
  skill hands the person that line without a digest, so what the person
  approves is text MSCanvas wrote, not the agent's summary (decisions 3, 5
  and 8).
- **A panic is the exit-5 document**, with stderr empty (decision 3).
- Smaller: the containment walk's extracted signature (decision 4), and the
  build gate's no-release case in CLI slice 3.

## Owner decision, 2026-10-31

**Question 3, confirmed again.** Shown open question 3 again with its
corrected cost and recommendation, among five questions put to the owner
again, the owner replied verbatim "全部按推荐" ("all as recommended"). The
answer:

- While a command-line run holds the cross-process run lock, which for 1,024
  items can be hours, the desktop refuses and shows the holder rather than
  waiting.
- Opening a new preview is refused too, because an open still runs `msaccess`
  for metadata and the run summary (ADR 0056, decision 3). After #175 only a
  preview already open can still read spectra (ADR 0057, decision 1).
- The cost ends once the reader's own run summary replaces `msaccess`, the
  follow-up of owner decision R-1 in
  [OWNER_DECISIONS_V511.md](../../development/OWNER_DECISIONS_V511.md).

The engineering corrections under
[Changed after acceptance, 2026-10-30](#changed-after-acceptance-2026-10-30)
stand. No other question of this ADR was asked again; the other seven answers
of 2026-10-30 are unchanged.
