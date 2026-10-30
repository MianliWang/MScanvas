# ADR 0064 — M10 automation route: one CLI over the desktop's own operations, then skills, then a narrow MCP adapter

Status: **Proposed** 2026-10-30, for the owner's decision. Nothing here is
implemented. Each decision below is the maintainer's recommendation; what the
owner has to answer is listed [at the end](#open-questions-for-the-owner).
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
  private module; the library exports only `run()`.
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

- **A1. A second binary target in the desktop package.**
  `src/bin/mscanvas.rs` drives the same `PreviewService` operations the Tauri
  commands drive, through one public entry the library adds. Every rule is
  reused as it is, and no file moves. The costs:
  - the binary links Tauri's crates although it calls none of them; its size,
    and whether anything Tauri links needs WebView2 at load, are unmeasured;
  - whether the Tauri bundler would put the second binary into the installer
    is unmeasured.
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

- The CLI is a second binary target, `mscanvas`, in the desktop package. The
  library gains one public module, `cli`, as its only new export, and
  `preview` stays private.
- Each subcommand is a thin adapter, as a Tauri command is: parse typed argv,
  call the service, print the answer. No subcommand holds a rule a Tauri
  command lacks. The only additions are reading paths from argv (decision 4)
  and reading and writing plan documents (decision 5).
- A2 waits for a measured need:
  - the CLI binary's size or a load-time dependency that matters;
  - a CLI on another operating system;
  - build time that slows CI.

  When the need comes, A2 is one mechanical move in a quiet window, with no
  change in behavior.
- The `e2e` feature cannot reach the CLI: the `cli` module refuses to compile
  with it, by the same kind of `compile_error!` barrier that keeps
  `test-support` out of optimized builds.

### 2. What the CLI exposes first

A closed set of subcommands. None takes an executable, an argument list or a
free-text option.

| Subcommand | What it does | Starts ProteoWizard |
| --- | --- | --- |
| `inspect <file>…` | Accepts each file under the rules Add files uses and reports its family and length. For mzML it also reports what `inspect_file` and the native reader give: counts, MS levels, representation, compression, precision, processing history and a spectrum-table summary. A vendor file gets admission facts only: family, length and, for SCIEX, whether the companion was observed | Never |
| `intents` | The configuration read for the installation: each admitted row with its stable id, summary, lossy statement, tier and availability | Yes: discovery's capability probe |
| `plan` | Builds a plan document (decision 5) and writes it create-new | Yes: the capability probe |
| `run` | Runs one approved plan, one item at a time | Yes |
| `validate` | Re-checks a run report's finalized outputs: the same bytes (`FinalizedOutput` drift), and the output-only mzML checks against the plan's intent | Never |
| `help` | Usage text | Never |

- **The intent is named, never defaulted.** `plan --intent <stable-id>` names
  an admitted row. After #161 merges, `--intent-file <file>` takes the
  structured intent's JSON wire and judges it with the same validating
  constructor the desktop uses.
- **Tiers and labels follow ADR 0055 unchanged.** An intent that equals no
  admitted row is in the advanced tier. It carries "not verified by MSCanvas"
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

- **stdout carries exactly one JSON document per invocation.** It is UTF-8
  without a byte-order mark, LF, ending in a newline:
  `{ "schema": "mscanvas.cli.<subcommand>", "schemaVersion": 1, "outcome":
  "ok" | "refused" | "failed" | "cancelled", … }`. A refusal or failure is a
  document too, with a stable `code` and a repository-authored English
  `message`. `help` is the only text output.
- **stderr is empty by default.** `run --progress jsonl` writes bounded
  progress events there (phase, item index, elapsed time).
- **No prompt, ever.** No interactive question, no pager, no colour, and no
  change of behaviour on a terminal. A missing decision is a refusal.
- **Exit codes, a closed set:**

  | Code | Meaning |
  | --- | --- |
  | 0 | Done as asked: every file inspected; the plan written; every item finalized, or skipped as the plan allowed; every output unchanged and passing |
  | 1 | Refused before anything changed, with a typed code: a path outside the roots, drift, a digest that was not approved, the build, the run lock, capacity |
  | 2 | Usage: an unknown subcommand or flag, a missing or repeated flag, a path that is not valid UTF-8, an input document of an unknown schema or with an unknown field |
  | 3 | Ran, and something failed: an item was not finalized (the others keep their outcomes), or `validate` found a changed output or a failed check |
  | 4 | Cancelled: Ctrl+C or the console closed |
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
  them. Resolution uses the handle-based acceptance the picker's files get: a
  regular file, no reparse point or symlink, identity read from the handle
  (ADR 0005). A path that leaves every root, by `..` or through a reparse
  point, is refused (`pathOutsideRoots`).
- **Roots are fixed for the life of the process.** The CLI takes them from
  argv, and the MCP adapter from its launch configuration (decision 7).
  Nothing in a tool call or a document can add one.
- **Sources are read-only.** Inside a root the CLI writes only its outputs
  into the destination folder and the plan and report files it was told to
  write, all create-new.

### 5. Plans, approval and drift

- **`plan` writes a plan document, create-new.** It never relies on stdout
  redirection, because Windows PowerShell 5.1's `>` writes UTF-16. The
  document holds:
  - the MSCanvas version and the roots;
  - per item: the canonical source path, family, object identity (volume
    serial and file id), length and SHA-256, and the derived output names;
  - the intent (a stable id, or the structured intent after #161), its tier
    per item and its lossy statements;
  - the provider's release, revision and `msconvert` SHA-256;
  - the destination's canonical path and identity, and the conflict policy;
  - the option tokens the intent lowers to, without staging paths.

  stdout prints the summary and the plan's digest: the SHA-256 of the file's
  exact bytes.
- **`run --plan <file> --approve <sha256>`** refuses unless the file's digest
  equals the approved one (`planNotApproved`). Then it re-derives the plan in
  its own process:
  1. accept every source again and hash it through the pinned handle;
  2. discover the installation again and read its configuration;
  3. plan again with the same intent, destination and policy;
  4. compare the result with the approved plan, field by field.

  Any difference refuses before a staging directory exists, with the first
  drift's code (`sourceChanged`, `providerChanged`, `intentNotAdmitted`,
  `destinationChanged`). Then each item runs, one at a time, through the ADR
  0011 coordinator. Under Fail an item whose output name is taken is not
  converted and the run exits 3; under Skip it is skipped.
- **What approval means.** It binds "what was reviewed is what runs". It does
  not authenticate a person: anyone who can read a plan can compute its
  digest. For the CLI that is the right meaning, because the shell's user is
  the person. For an agent host it is not enough (decision 7, open
  question 2).
- **Bound to bytes.** Each source is read twice, at plan and at run. An
  identity-only binding is cheaper, but a file an instrument is still writing
  keeps its identity; ADR 0049 binds a run to bytes for that reason.
- **The run report.** Each item is finalized (output names, length, SHA-256,
  checks passed, the not-verified flag), skipped, failed (a typed code and no
  backend text), cancelled, or not started. The report is always printed, and
  also written create-new when `--report <file>` is given.
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
    never replaced by discovery.
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
  - a per-user run-lock file in the application-local directory, opened with
    no sharing (`share_mode(0)`, from the standard library), is held by
    whichever process starts `msconvert` or `msaccess`;
  - the CLI refuses with `backendBusy` instead of waiting;
  - the desktop takes the same lock around its backend gate, in the run slice
    (open question 3);
  - the directory is the one Tauri resolves for `org.mscanvas.desktop`. The CLI
    computes it from `LOCALAPPDATA`, and a test pins that the two agree.
- **Cancellation.** Ctrl+C and console close reach a handler registered with
  `SetConsoleCtrlHandler`, declared the way the crate already declares its
  `kernel32` functions, so no dependency changes. The handler maps to the
  queue's stop. If the process is killed instead, the job object ends the
  backend with it, and the existing staging recovery reclaims what is left on
  the next run.
- **The ProteoWizard hold.**
  - In the product: `inspect` and `validate` never start a process. `intents`,
    `plan` and `run` start ProteoWizard exactly as the desktop does.
  - In development: no agent, test or CI job runs a real ProteoWizard through
    the CLI or the adapter without a recorded, bounded hold release. Tests use
    the fake providers and `test-support` evidence. Real qualification of
    `run`, through the CLI and through the adapter, is a native item under its
    own release.
- **An agent with a shell.** A host that also gives an agent an unrestricted
  shell lets it run `msconvert` itself, or `mscanvas run --approve` with a
  digest it computed. No MSCanvas design changes that. The boundary MSCanvas
  offers an agent is the MCP adapter, and the skill tells an agent to use only
  the adapter or the CLI (decision 8).

### 7. The MCP adapter sits on the CLI's schemas

- **Same binary.** `mscanvas mcp --root <label>=<dir> …` runs the adapter over
  the stdio transport (newline-delimited JSON-RPC 2.0). One protocol revision
  is pinned, and recorded when the slice starts.
- **A fixed tool list, one tool per subcommand:** `inspect`, `intents`, `plan`
  and `validate`, and `run` only from the second MCP slice.
  - Each tool's input schema is its subcommand's argument schema. Its result
    (`structuredContent`, with the same JSON as text) is the subcommand's
    document under the same schema id.
  - Tools are never registered dynamically, and no resource or prompt
    executes anything. That keeps the AGENTS.md rule against a generic plugin
    ABI.
- **One implementation.** The adapter calls the same in-process functions as
  the subcommands. It does not start the CLI.
- **Paths are root-relative.** A file is `{ "root": "<label>", "path":
  "<relative path>" }` in both directions. A result never holds an absolute
  path, because results reach the host's model provider. A plan made through
  the adapter is stored by the adapter in the application-local directory,
  named by its digest; the agent receives the digest and the summary.
- **`run`, second MCP slice.** It runs only a plan the person approved
  outside the agent's control. Recommended: MCP elicitation. The adapter asks
  the client to show the plan's summary and digest, in text the adapter wrote,
  not the agent, and runs only on the person's accept. A client that does not
  declare elicitation is refused (`approvalUnavailable`) and nothing runs.
  The alternatives are open question 2.
- **No SDK.** The adapter is written over `serde_json`: `initialize`,
  `tools/list`, `tools/call`, cancellation and progress notifications. An MCP
  SDK crate would be a new dependency and is not proposed.

### 8. Skills sit on the CLI

- **One skill, `mscanvas-automation`,** in `.agents/skills/` beside the
  development skills, and copyable as a user skill. It walks an agent through
  inspect → intents → plan → show the person the summary and digest → wait for
  the person's approval → run → validate, using only the CLI's subcommands or
  the adapter's tools. It never calls `msconvert`, never edits a plan file,
  never computes an approval digest on the person's behalf, and reports every
  refusal as the CLI wrote it.
- **A skill is guidance, not a boundary.** Every rule it states is enforced by
  the CLI, so an agent that ignores the skill gets the CLI's refusals.
- **Its examples use the repository's fixtures,** and its checks run against
  the fake providers, never a real installation.

### 9. Order and dependencies

1. **CLI slice 1:** the binary, `inspect`, the envelope, exit codes, roots and
   schemas. It needs nothing open and can start now; its only overlap with
   other lanes is one line in `lib.rs`.
2. **CLI slice 2:** `intents` and `plan`. It waits for #161 to merge, because
   the structured intent, its tier and the capacity are there.
3. **CLI slice 3:** `run`, `validate`, the cross-process run lock in both
   processes, and Ctrl+C.
4. **The skill.**
5. **MCP slice 1:** the read-only tools and `plan`.
6. **MCP slice 2:** `run` with approval, after open question 2.
7. **Closure:** schemas declared stable at version 1, native qualification
   under a hold release, and the distribution decision (open question 4).

A2's extraction is not on this list. It is scheduled only when decision 1's
measured need appears.

## Acceptance criteria

**CLI slice 1**

- `inspect` on an mzML fixture prints one document and exits 0. Its facts
  equal what the desktop's acceptance and the native reader give for the same
  fixture.
- `inspect` on a vendor fixture reports family and length, and the fake
  provider records no launch.
- Refusals: a file outside the roots exits 1 with `pathOutsideRoots`; a
  reparse point is refused; a non-UTF-8 path and an unknown flag each exit 2
  with a usage document.
- Every test runs with stdin closed, and none waits for input.
- Every golden document matches its schema.

**CLI slice 2**

- `intents` lists the rows, tiers and availability the desktop's
  configuration read gives for the same fake build.
- `plan` writes create-new and refuses a plan path that exists. The printed
  digest equals the SHA-256 of the written bytes.
- A missing `--intent` exits 2. A vendor file on a build without a measured
  row follows ADR 0055's build gate: labelled, with SCIEX refused. An advanced
  intent labels every item.

**CLI slice 3**

- A wrong digest exits 1; no staging directory exists and no process was
  started.
- Each drift kind is refused before staging, one test per kind, on the fake
  provider.
- A taken output name: under Fail the item is not converted and the run exits
  3; under Skip it is skipped. The existing file's bytes are unchanged in
  every test.
- A run lock held by another process exits 1 with `backendBusy`, and nothing
  starts.
- Ctrl+C during a fake run exits 4, the item is cancelled and its staging is
  reclaimed.
- `validate` exits 0 on unchanged outputs, and 3 with `outputChanged` after
  one byte of an output changes.

**Skill**

- Every command in the skill appears in the CLI's golden tests, and the skill
  names no `msconvert` option.

**MCP slice 1**

- `tools/list` returns exactly the fixed tools, with schemas equal to the
  CLI's.
- An absolute path, or a path that leaves its root, is refused.
- No result in the test suite contains an absolute path.

**MCP slice 2**

- A client without elicitation is refused with `approvalUnavailable`; a
  declined approval runs nothing; an accepted one behaves as the CLI's `run`.

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
- Any desktop behaviour change other than the cross-process run lock.

## Estimates

On the plan's basis (section 4: a slice is about one working session, 0.3–1
calendar day):

| Work | Slices | Plan, section 5 |
| --- | --- | --- |
| CLI slices 1–3 | 3 | 2–4 |
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
- **The MCP host's tool confirmation as approval.** A host can be set to
  approve tools automatically, and the adapter cannot tell.
- **MCP's `roots/list` as the allowed roots.** A client may change them during
  a session, and they say where the agent works, not where MSCanvas may write.
- **Identity-only source binding,** and **printing the plan for redirection**
  (decision 5).

## Consequences

- Automation reuses every rule the desktop enforces, because it calls the same
  operations, and the desktop's behaviour does not change except for the run
  lock.
- The CLI carries Tauri's crates until A2. That is a size cost, not a
  capability: the CLI calls no Tauri code.
- A person can convert headless, reproducibly, with machine-readable results,
  and an agent can prepare plans without being able to run one the person did
  not approve.
- The schemas become a compatibility promise at M10's closure, and they cost
  a version bump to change after that.

## What this amends, on acceptance

- [The after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), sections 7.3
  and 9: the route is recorded (done line-locally with this record).
- In the slices that implement it, not now:
  - the feature catalog's AUT-001, AUT-002 and AUT-003;
  - [ADR 0057](0057-conversion-capacity-and-viewing-during-conversion.md):
    serial conversion extends across processes through the run lock (CLI
    slice 3).
- [ADR 0005](0005-mzml-preview-boundary.md) is not amended: no webview
  command is added.

## Open questions for the owner

1. **The route.** A1 now, A2 only on a measured need, in decision 9's order?
   Recommended: yes.
2. **How a person approves a run that an agent asks for through MCP.**
   - **Elicitation (recommended):** the adapter asks the client to show the
     plan, and runs only on the person's accept. Clients without elicitation
     are refused.
   - **An approval record:** the person writes it with `mscanvas approve` in
     their own terminal. It works with any client, and adds a small store.
   - **The host's tool confirmation:** not recommended, because hosts can
     approve automatically.
3. **The cross-process run lock.** While a CLI run holds it, the desktop
   refuses to start a preview or a conversion and says why (recommended). The
   alternative is to have the desktop wait.
4. **Distribution at M10's closure.** Recommended: the installer carries
   `mscanvas.exe` beside `mscanvas-desktop.exe`, documents where it is, and
   does not change the user's PATH. This is a release change.
5. **Roots for the CLI.** Recommended: required for every subcommand that
   names a file, as for the adapter. The alternative drops them for the CLI,
   whose user names files directly.
