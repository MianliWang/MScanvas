# Rendered UI QA

Two layers, and the difference between them is what each one is allowed to
claim.

| | `pnpm e2e:browser` | `pnpm e2e:tauri` |
|---|---|---|
| Renderer | real Chrome, headless | real WebView2 |
| Backend | replaced at the IPC boundary | real Rust process |
| Cost | seconds | minutes |
| Answers | what the interface looks like and how it behaves | whether the shipped composition stands up and wires together |

Browser mode is the primary gate, because it is where a claim about layout,
focus treatment, wrapping at a viewport, or an export outcome can be made
cheaply and repeatedly. The Tauri layer is deliberately smaller: it exists to
prove the parts browser mode has to assume.

## Commands

| Command | What it does |
|---|---|
| `pnpm e2e:typecheck` | Types the harness. |
| `pnpm e2e:browser` | The browser-mode suite. Starts and stops its own Vite. |
| `pnpm qa:m4.1` | The gate: typecheck, then browser mode. |
| `pnpm e2e:build` | Builds the frontend and the `--features e2e` binary. |
| `pnpm e2e:tauri` | The real-WebView suite. Needs `e2e:build` and `tauri-driver` first. |
| `pnpm e2e:native-dialog` | The save-dialog selector probe. See `native/README.md`. |
| `pnpm qa:pm9:manual` | Opens one PM9 controlled scenario in a visible window for a person to review. Test-only; see below. |

The Tauri layer needs `tauri-driver` on `PATH` (`cargo install tauri-driver`)
and a debug binary built with `--features e2e`.

## Manual visual review (PM9)

A person looking at the product, not a test that judges it. It opens one of
PM9's controlled scenarios -- the states the PM9.1 spec asserts, from
`support/pm9Scenarios.ts` -- in a visible Chrome window and leaves it there
until the reviewer ends it. It serves PM9.3 to PM9.7 as much as PM9.2.

**What it is, and what it is not.** Browser manual review is the real
production frontend over a controlled IPC fixture: the same Vite, React and
components the application ships, with the Tauri backend replaced at the IPC
boundary by an answer table. It is not Rust execution, not native WebView2 or
its DPI, not ProteoWizard and not a scientific validation. A command the
scenario's table does not answer is refused at the boundary, so driving the
page beyond its scenario shows refusals, not a backend. ProteoWizard is never
run, and the HOLD is unaffected.

**Nothing of it ships.** There is no route, query flag, debug menu or build
switch in the application. The review keys and the answer table are injected
into the test browser's documents by the harness (`browser.addInitScript`);
the spec is `manual/pm9-scenario.manual.ts`, outside the suite's glob, and only
`wdio.manual.conf.ts` names it.

Run it from the repository root in PowerShell:

```powershell
$env:MSCANVAS_PM9_MANUAL_SCENARIO = "populated"   # the default
$env:MSCANVAS_PM9_MANUAL_LOCALE = "zh-CN"         # en (the default) or zh-CN
$env:MSCANVAS_PM9_MANUAL_VIEWPORT = "1366x768"    # the default; any size below
$env:MSCANVAS_BROWSER_DEV_PORT = "5273"           # only if 5273 is taken
pnpm qa:pm9:manual
```

The variables stay set for the rest of that PowerShell session; clear one with,
for example, `Remove-Item Env:MSCANVAS_PM9_MANUAL_LOCALE`.

Scenarios: `populated`, `converting`, `projectWithResult`,
`resultPayloadMissing`, `resultPayloadCorrupt`,
`resultSourceAndRuntimeUnavailable`, `qcCapture`, `busyInspected`,
`targetedTask`. Each opens in its starting state; reaching, say,
`busyInspected`'s inspected result is the reviewer's own path through the real
interface (Project, then the result's Inspect).

`targetedTask` is the targeted-MS1 task (PM9.5): a saved project with three
acquisitions, one with a long name and one with a Chinese name, and nothing
run yet. Project → **Targeted MS1…** on a layer, type targets (for example
`Caffeine, C8H10N4O2, 120, 30`), **Review plan**, then **Run**; tick more
acquisitions for a batch. The answers are fixed, from `support/targeted.ts`:
a review answers the first acquisition's plan whichever row opened the setup,
a run completes at once, and a batch ends with one acquisition completed with
a target found, one failed and one completed with every target not detected.
States that need a held answer -- a run in progress, a stop -- are in the
PM9.5 spec's frames, not here.

**Stored results, history and reopen (PM9.6).** The existing scenarios reach
every report; nothing was added for PM9.6. For example, a stored result in
Chinese at the narrowest anchor:

```powershell
$env:MSCANVAS_PM9_MANUAL_SCENARIO = "projectWithResult"
$env:MSCANVAS_PM9_MANUAL_LOCALE = "zh-CN"
$env:MSCANVAS_PM9_MANUAL_VIEWPORT = "960x640"
pnpm qa:pm9:manual
```

| Scenario | Path through the real interface |
|---|---|
| `projectWithResult` | Project → under Recorded work, **Targeted MS1 result** → the report; press **Caffeine** → its evidence comes into view beside the row; **Show Details** → the run under "Produced by" (the report stays) → the result under "Produced" |
| `resultPayloadMissing`, `resultPayloadCorrupt` | Project → the history row already names the payload's state → the record → the report's state line and its next step |
| `resultSourceAndRuntimeUnavailable` | As `projectWithResult`: the report says the source and the runtime are unavailable, and still reads, draws and offers its outputs |
| `qcCapture` | Workbench → press **QC_pool_01.mzML** in the roster to view it → Project → **Capture QC summary** on its layer → the report; then the run in Recorded work keeps it |
| `targetedTask` | Project → **Targeted MS1…** → tick all three → type targets → **Review plan** → **Run 3 analyses** → Recorded work: a completed result, a failed run with its reason, a result with every target not detected |

Reopening a project, a relink and late answers need answers the fixed table
cannot give; they are in the PM9.6 spec's frames
(`specs/pm9.6-results-history.browser.e2e.ts`), not here.

In the page, hold Alt+Shift and press:

| Key | Does |
|---|---|
| Right / Left | next / previous viewport |
| Down / Up | next / previous scenario |
| L | the other language |
| Q | ends the session |

Closing the window, or Ctrl+C in the terminal, also ends it. The terminal names
the current scenario, language and viewport, and every view is kept as a
screenshot under `test-results/pm9-manual/` (git-ignored), sized exactly to the
logical viewport, which is how a size larger than the window is reviewed whole.

**Viewports.** 960x640, 1024x768, 1152x720, 1280x720, 1280x800, 1366x768,
1440x900, 1536x864, 1680x1050, 1920x1080 and 2560x1440, logical pixels at DPR
1. Only 960x640, 1366x768 and 1920x1080 are the automated contract's anchors;
the rest are review points. A size becomes a regression case only when a real
defect is found at it, and then in an automated spec, not here.

**Language.** The scenario opens with the stored preference the application
reads at start, as the PM9.1 spec does; nothing about how the application
chooses or applies a language changes.

**Comparing with the v5.11 reference.** The accepted reference is owner-held
and not in the repository. Open it on its own, in any browser, beside the
review window:

```powershell
Start-Process "C:\Users\rough\Downloads\mscanvas_unified_demo_v5_11.html"
```

Its recorded identity is in `docs/phases/pm9/baseline.md` §3 (490,253 bytes and
a SHA-256). The harness neither copies the demo nor uses its synthetic
scientific content. Compare the two side by side for task hierarchy, evidence
emphasis, action density, context clarity, progressive disclosure and
responsive behaviour, and record findings in the owning slice.

**Headed automated specs.** `MSCANVAS_BROWSER_HEADED=true` shows the window for
any browser spec; it drops only the headless and hidden-scrollbar flags. Unset,
the suite is exactly as it was.

```powershell
$env:MSCANVAS_BROWSER_HEADED = "true"
pnpm e2e:browser --spec ./e2e/specs/pm9.1-baseline.browser.e2e.ts
Remove-Item Env:MSCANVAS_BROWSER_HEADED
```

`MSCANVAS_PM9_MANUAL_SMOKE=true` checks the harness itself and exits: it opens
the scenario, walks the whole viewport list and presses one review key. It
accepts nothing about the pages.

## The `e2e` Cargo feature

Off by default, and never enabled for a release build. It compiles in two
things:

- an initialization script that can answer this application's own commands from
  a table the page can write;
- **one synthetic spectrum**, installed into the ordinary export slot at startup,
  so a rendered test can reach the real export path on a machine with no
  ProteoWizard installation and no mzML file.

Both are capabilities a shipped binary must not carry — anything running in the
document could use the first to make the interface believe whatever it liked.
Neither is a command: there is nothing for a webview to call, and the
registration list is byte-identical in every build.

Nothing else about the binary changes. The WebDriver session itself is external
(`tauri-driver` in front of the platform WebDriver), so no server, port, or
remote-control surface is compiled in at any time.

A default build carries none of the markers:

```
$ cargo build -p mscanvas-desktop --bin mscanvas-desktop
$ strings target/debug/mscanvas-desktop.exe | grep -c __mscanvasIpcTable__
0
```

`scripts/check_repo.py` checks all of it rather than trusting it: the feature
staying off by default, every test-only symbol sitting inside its `cfg`, the seed
never reaching the registration list, no marker in the production frontend, no
clipboard permission or package, and no font vendored or fetched. Each guard was
verified by making the violation and watching it fail.

## What is real in the Tauri layer, and what is not

Real: the process, the WebView, the frontend bundle, the IPC transport, and
every command no test answers — the boundary passes those straight through to
Rust, so `carries a real IPC round trip` is exactly that.

Answered from the table: the commands that would need a ProteoWizard
installation and an mzML file on the running machine, plus the export pair,
whose real implementation opens a modal save dialog no WebDriver session can
dismiss. See `native/README.md` for what that costs and what it leaves open.

## One thing worth knowing before changing the boundary

The host installs `__TAURI_INTERNALS__.invoke` with `Object.defineProperty`,
non-writable and non-configurable, and it does so *after* appended
initialization scripts run. So there is exactly one moment at which the function
can be substituted: the definition itself. An accessor installed beforehand is
replaced without ever being told, and the symptom is not an error — it is a
suite that observes an application making no IPC calls at all.
