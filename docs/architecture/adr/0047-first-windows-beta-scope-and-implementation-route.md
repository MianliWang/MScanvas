# ADR 0047 — First Windows beta scope and implementation route

Status: **accepted route; implementation NOT STARTED.**
Date: 2026-09-12. Baseline: `8c8b1cc1e503f0885f30e54109bfc2eb0fb0001e`
([PR #118](https://github.com/MianliWang/MScanvas/pull/118)).
Authority: the owner's separate M7.0 authorization, including continuation of
the accepted v5.11 design. M7.0 is Markdown only. Its completion means **ROUTE
PUBLISHED**, after review and protected publication, not UI complete or beta
released. Every implementation slice below needs its own authorization.

## Goal and fixed boundary

M7 delivers an **installable, release-validated Windows x64 desktop beta** for
researchers and facility operators who need to inspect admitted local mzML,
prepare open-format data, and export scientific figures. A user must complete
import → organize/browse → inspect → configure/convert → understand results →
explicitly adopt → export, with understandable failure recovery. This is the
existing viewer, converter and figure product made usable as an installed
application. M8's durable store, M9's analysis and M10's automation are later
owners, not release prerequisites. No release date or scale guarantee is set.

[ADR 0045](0045-conversion-completion-closure-and-handoff.md#the-m7-and-m8-seams)
supplies the completed M6 authorities. [ADR 0046](0046-post-m6-xic-provider-runtime-route-lock.md)
and [PX.4](../../spikes/PX_4_XIC_PROVIDER_RUNTIME_DECISION.md) supply the terminal
non-admission handoff: B is refused for its exact authorized evaluation; A is
viable, unprototyped, not rejected and outside that set; C is not viable as
originally defined. XIC is not a prerequisite. No B repair, A experiment,
PX.5/PX.6, new reader or scientific measurement belongs to this route.

The [feature catalog](../../product/FEATURE_CATALOG.md) distinguishes targets
from implemented behavior; its priority labels do not add beta conditions.
[Primary workflows](../../product/PRIMARY_WORKFLOWS.md) retain their detailed
contracts. Their historical WF-003 ref/render-window paragraph is superseded
by ADR 0045's explicit M6.1 closure; M7 must not recreate that window. Earlier
handoffs saying M7 had not started describe their dated stages; this record
accepts M7 entry for planning only.

| Reference feature | Existing capability to re-present | Proposed M7 adapter and consumer | Later or excluded capability |
| --- | --- | --- | --- |
| Home, imports, roster | Native file picker admits mzML and evidenced Thermo RAW, Shimadzu LCD, SCIEX WIFF bundles; folder/Explorer drop admits mzML only; non-destructive remove/clear | M7.2 shell and session virtual folders over stable dataset IDs | New RAW families, directory acquisitions, scientific classification persistence |
| TIC/BPC, spectrum, scans | mzML linked selection, bounded table, admitted RT/m/z viewports; TIC/BPC from a complete loaded scan table, with unreported units preserved | M7.3 whole-row activation, bounded search/sort, range adapter | Direct vendor preview, whole-file scan query, XIC, overlays/comparison |
| Compact configuration and results | Source-qualified typed intent, selected/all queue, destination policies, cancellation, five judgements, explicit adoption | M7.4 basic/advanced views, compact result/details and the currently unbuilt Open file / Open folder actions | Arbitrary methods/graphs, additional centroiding admission, mzXML, overwrite, ETA |
| Figures/data | Rust full-source/current-range SVG, PNG, Copy plot, CSV/TSV; linked figure with full-source lower spectrum | M7.4 shared figure controls; M7.3 proves committed-range handoff | New formats, feature/statistics export, saved FigureSpec/composer |
| Settings and layout | Session backend choice and existing figure settings | M7.1 real localized settings; M7.5 allowlisted UI preferences/restoration | Durable project/artifact/run/classification/provenance store; scientific-run resume |
| Analysis, nodes, code, AI | No production consumer | Omit future navigation or state honest unavailability where context requires it | Smoothing, peak detection/alignment/gap filling, matching, statistics, arbitrary execution, Python/R and AI automation |

Supported conversion remains the three evidenced vendor families to mzML under
their installed-build gates; imported mzML is viewed, not offered as a vendor
conversion item. A SCIEX `.wiff` and its required `.wiff.scan` remain one
acquisition. No prototype option expands a source contract. Seven of nine
measured intent rows cover the visible vendor workflow, conditional on grammar;
the two reader-sensitive centroiding rows do not. Whole-combination refusals
retain their separate evidence, installation and source-family reasons.

Rust owns filesystem identity, discovery, backend receipts, queue/capacity,
processes and scientific data. React consumes typed operations and projections,
never shell strings, unrestricted paths or a second capability registry. Keep
source-qualified intents, bound order, authoritative capacity (currently sixteen
serial items), destination revalidation/cleanup, Fail/Skip and
`OVERWRITE_REFUSED`, confirmed cancellation versus quarantine, and independent
process/staged/finalized/integrity/adoption facts. Output-only validation does
not establish vendor fidelity. Adoption stays explicit and identity-checked;
an exit code or partially finalized set cannot become complete success.

## Accepted-reference continuation

The source inputs are the completed frontend preflight dated 2026-09-07/08:
`REPORT.md`, `HANDOFF.md` and `INPUT_CLOSEOUT.md`, retained in the task-specific
`mscanvas-preflight-20260908T015341Z-a9a06584` directory. Its M6.5 baseline was
`33d882054e240fa4bc69cc17564f90aa518ec3bc`. INPUT_CLOSEOUT closed the missing
ZIP/README item; the report's original PARTIAL heading is historical. Its
capability statuses, provisional M7-F labels and package observations are not
today's installed state or implementation authority.

Read-only M7.0 verification found these exact reference bytes:

| Material | Bytes | SHA256 |
| --- | ---: | --- |
| `mscanvas_unified_demo_v5_11.html` | 490253 | `d09b60e0bd3225721ddf87731ec64c0577015952afc05d91290d5461b3896337` |
| `mscanvas_unified_demo_v5_11.zip` | 1147863 | `5d9151c745be4d7d8a2ce3e07102cc9a026bcca9bd9b59e4ed5265f3bdafaab6` |
| ZIP `README.md` | 3587 | `2621422be483902329f9559b173c64a8890ca84fb6c0923273f817b3cc3b6afc` |

The archive has 65 unique entries and its HTML equals the standalone HTML.
The local checkpoint retains exact input locations and preflight hashes; neither
the archive nor private acquisition inputs are published here. README identifies
synthetic signals, simulated budgets and historical Chromium QA. No prototype
build or QA script was run. Those screenshots explain the accepted reference;
they do not validate current production. Accumulated globals/CSS patches are
not an architecture to port.

The existing [design system](../../ux/DESIGN_SYSTEM.md),
[UX process](../../ux/UX_PROCESS.md) and repository UI skills remain owners.
M7 uses accepted-reference continuation instead of another three-concept contest.
Each slice still frames its task, baseline, interaction budget, recovery and
rendered evidence. External skills are scoped advice; no template or skill
installation inherits permission from the preflight.

Carry the following decisions into real consumers:

- **M7.2:** logo/name form one Home action; navigation preserves active work.
  Import, browse, convert and export stay discoverable. Viewed acquisition,
  Ctrl/Shift drag multi-selection and curated conversion membership are distinct
  states. Membership feeds M6.7's existing selected/all resolver; display search,
  collapse and virtual-folder moves change neither science nor a bound queue.
  Keep the complete roster's authoritative chosen sort for queue resolution;
  internal browsing order is presentation only. An explicit conversion-scope or
  authoritative sort change invalidates an unstarted review, never a running
  snapshot. Virtual organization is session-only and labelled as lost on restart.
- **M7.3:** activate the whole scan row; sorting belongs to its column header.
  Arrow/Page/Home/End navigate without backend selection; Enter/Space activate.
  Search/filter captions name the loaded prefix, total/loaded counts and
  truncation. Virtualization proves no whole-file query. Preserve the current
  100,000-row transfer ceiling and at-most-1,800-point spectrum projection;
  incomplete tables still cannot supply a whole-run chromatogram.
- **M7.3:** dragging selects a pending range; release alone never zooms. A
  subsequent explicit activation or Enter commits once; Escape cancels. Provide
  a focusable range action and numeric/keyboard equivalents through compact
  contextual controls/help, with no permanent V/H/Z/R or pan/view strip.
  Explicitly amend [ADR 0032](0032-viewer-interaction-and-viewport-state.md) and
  the spectrum adapter's [ADR 0039](0039-visible-spectrum-viewport-adapter.md) at
  implementation: pending state is axis- and selection-revision-bound; stale
  release/projection responses cannot commit it. Exports read committed ranges.
  Define touch versus page-scroll ownership and cancellation in that slice;
  do not inherit static `touch-action: none` as evidence of usable touch.
- **M7.2–M7.4:** smooth interruptible motion explains movement without covering
  data. Use gap/group highlight and a compact count for drag feedback. One owner
  controls drag transforms, hit tests and scrolling; Motion cannot also transform
  those nodes. Reduced motion preserves outcomes. Use local/system fonts,
  consistent spacing, reflow and collapsible panels; never shrink scientific
  text to cure overlap. Remove repeated prose, keeping units, uncertainty,
  scope, recovery and useful implementation comments.
- **M7.4:** basic/advanced controls edit the same typed intent, with compact
  precision choices and explicit whole-combination recovery. One result summary
  leads to inspectable independent details. Keep unknown progress honest; no
  estimator is scheduled. Node/list editing remains later method-editor guidance,
  not a reason to install React Flow.

Keep React/TypeScript/Vite/Tauri/Rust, owned components and scientific renderers.
The baseline manifests declare React 19.2.8, TypeScript 7.0.2, Vite 8.2.2,
Tauri JS 2.11.1/CLI 2.11.4, Rust toolchain 1.97.1 and pnpm 11.15.1;
these are repository inputs, not a fresh runtime compatibility test. Lockfiles
remain authoritative for resolved graphs, including Rust's ranged dependencies.

Carry the preflight's **2026-09-07/08 researched proposals**, without treating
them as current recommendations to install: M7.1 `i18next` 26.4.2,
`react-i18next` 17.0.13 and, if consumed, Radix Dialog 1.1.23; M7.2 `motion`
13.2.0, `@dnd-kit/react`, `@dnd-kit/dom`, `@dnd-kit/helpers` each 0.5.0;
Radix Dropdown Menu 2.1.24 / Tooltip 1.2.16 only at an actual consumer.
Use that one dnd API family, not legacy core/sortable APIs. The pinned dnd
keyboard API used `event.code`; i18next selector defaults differed from newer
documentation. Explicit configuration, complete lock closure, license/peer
review and Windows/WebView2 integration remain unproved. Each slice requests
precise dependency authority and checks its consumed pin; no bulk installation,
framework comparison, table library or PX scratch dependency enters by default.

## Dependency-ordered delivery

The implementation/evidence owner is the named slice and its concrete consumer
below; an implementer is assigned when that slice is authorized. Each published
slice preserves a usable product and supplies both local languages for its
changed surface. M7.5 closes coverage over every remaining delivered UI string.

| Slice and user-visible outcome | Owner/consumer and prerequisite | Allowed change kind under separate authority | Focused evidence and recovery |
| --- | --- | --- | --- |
| **M7.1 — Localized settings and shared controls** | Desktop settings dialog, existing roster and figure-setting consumers; M7.0 | Localized resources/policy, owned fields/dialog, session UI preference, focused tests; precise i18n/Dialog cohort | Preflight proof 2: offline settings → real table → language switch; cancel/reset, focus/IME, missing-resource failure; acceptance below |
| **M7.2 — Workbench shell and roster organization** | Shell/roster adapter over dataset IDs and existing scope resolver; M7.1 | Shell, virtual organization, grouped drag, selected/all presentation, Motion/dnd only with approval | Proof 1: grouped multi-drag, folded target, scroll/virtual rows, keyboard, Escape, invalid drop, concurrent roster revision and safe undo; native OS drop remains separate |
| **M7.3 — Viewer, scans and committed gestures** | SpectrumTable, scan model, linked reducers/adapters, Rust retained snapshot/export reader; M7.2 | Viewer presentation, explicit adapter/ADR amendments, focused tests; no new scientific provider/query | Proof 3: real mzML → scan/sort/filter → pending/commit → current/full export; axis/revision isolation, empty/refused/late response recovery; physical input checks |
| **M7.4 — Conversion, results and figures** | ConversionPanel, conversion availability/scope, ConversionItemJudgements, adoption and FigureSettingsFields; M7.3 | Consolidate projections/actions; narrow Rust/Tauri output-opening and guarded staging-recovery operations; focused integration/native evidence | Real conversion/result/open/adopt/export; locked-staging recovery and safe refusals; file/folder opening failures; source/build refusals, picker cancel, Fail/Skip/collision, stop/quarantine, partial output and retry |
| **M7.5 — Preferences and first-run recovery** | Existing settings consumers, Rust narrow preference storage and backend discovery/diagnostics; M7.4 | Allowlisted local persistence, onboarding/help, remaining localization/accessibility; no scientific store | Restart/default/reset/corrupt/version-invalid/unwritable preference tests; missing/unsupported backend recovery; offline bilingual task; no restored operation/authority |
| **M7.6 — Installer and release integration** | Tauri bundle/build configuration and release QA/package records; M7.5 plus external decisions at their deadlines | Separately authorized packaging/build/release tests, notices/provenance and candidate preparation; upload only with release consent | Clean standard-user installation, real-build integrated task, uninstall/rollback and artifact verification; diagnose setup failure without modifying sources |

M7.1 is a visible product increment, not another preflight. Add a reachable
Settings dialog with `en` / `zh-CN` and a **roster density** preference actually
consumed by the current roster. Opening it, applying/cancelling a draft, resetting
defaults and returning to row activation must work in the running product.
Until M7.5 persistence lands, it explicitly says settings last for this session.
Shared fields must serve this dialog and an existing settings consumer, such as
FigureSettingsFields; a component inventory alone fails acceptance.

M7.4 owns WF-004's unimplemented Open file / Open folder recovery. A narrow
operation takes a finalized-output identity; Rust resolves and revalidates the
stored object before invoking the platform handler. React receives no path or
shell command. Missing/replaced outputs and unavailable file associations give
actionable refusal, with folder access where still valid. Opening neither adopts
an output nor upgrades a partial set's integrity/completeness. M7.6 exercises
both actions and their failures in the installed application.

M7.4 also owns [ADR 0043's G18](0043-conversion-completion-route.md): failed
cleanup can strand a deterministic staging name, and `reclaim_staging_area`
currently has only test callers. Provide explicit application recovery, not an
automatic pre-launch delete. A narrow reclaim command must require Rust-held
same-session ownership of the staging/destination objects and confirmed process
quiescence, revalidating objects at deletion. A name or the forgeable marker
alone is insufficient authority; exposing the existing helper unchanged is not
acceptance. Busy/quarantined, replaced, linked or unproved targets stay untouched.
After a transient lock clears, the user can retry owned cleanup and then make a
fresh reviewed conversion. If ownership cannot be proved, including after
restart, refuse cleanup and offer a different destination/new plan when backend
authority permits. No source or finalized output is deleted. M8 retains G16's
cross-session authenticated-ownership question; it is not a beta prerequisite.
M7.6 tests lock → cleanup failure → unlock → reclaim → successful conversion,
plus forged/replaced/linked targets, busy/quarantine refusal and the safe
new-destination path, covering single-output/set mechanisms where affected.

M7.1 schedules the narrow root language-policy amendment: localized UI resource
**values** may use their declared language. Keys, identifiers, comments, test
descriptions, documentation, evidence, provider logs and canonical machine
exports remain English/original. Application messages use structured codes and
parameters; arbitrary provider output is neither translated nor reinterpreted.
No language-policy change is claimed implemented by M7.0.

Resources are bundled locally, including recovery, accessible names, live
announcements, help and plural/interpolation forms. M7.1 tests typed key parity,
0/1/n and missing keys; fallback does not count as translated coverage. Switching
language updates `document.lang` without remounting the workspace/provider or
losing drafts, pending input, selection, viewport or running work, and without
dispatching an operation. Cancel restores the prior preferences and focus.

Both locales accept ASCII decimal-dot numeric input and a finite exponent only
where the field's domain permits it; no grouping separator, blank-to-zero,
NaN/Infinity or locale-based guess of `1,234`. IME composition cannot commit.
Existing domain validators retain integer/range/unit rules. Format displays with
an explicit locale; retain canonical values separately, never reparse a rounded
display on language change. IDs, unit states and CSV/TSV/JSON precision and
numeric conventions stay unchanged. M7.1 owns shared input tests; each later
consumer verifies its fields and M7.6 verifies exported values.

M7.1 acceptance includes real roster activation and figure controls after dialog
return, both languages offline, empty/loading/error/unsupported states, keyboard
trap/return/Escape, IME, long labels/local font fallback, 1366×768, 1920×1080,
960×640 and an intermediate window, plus 100/125/150/200% scaling. Distinguish
browser zoom from Windows scaling. Native-picker return must be exercised when
integration changes it. Preserve in-flight work using controlled integration
tests and the real native path affected; mock success is not provider evidence.

## Release exits and existing residuals

These are obligations to implement and prove, not passes recorded by this ADR.
Core product or trust failures block their consumer and the release. M7.6 records
each exit against the actual release candidate, its source SHA, build inputs,
Windows/WebView2/provider identities, lawful fixtures and raw results.

| Release exit | Implementation and evidence owners | Required concrete result |
| --- | --- | --- |
| Complete supported task | M7.2/3/4/5 implement; M7.6 integrates | Installed real application completes import/view/convert/result/open-file-or-folder/adopt/figure/data export; stranded-staging cleanup/replan, missing/replaced output and handler-failure recovery; actionable unsupported input/build and missing-backend recovery; outputs checked and source bytes unchanged |
| Offline, readable, accessible UI | M7.1–5 own changed surfaces; M7.6 audits all delivered UI | Complete local en/zh-CN including recovery/aria/live regions; keyboard/focus and physical pointer/touch results separately recorded; three viewport targets, scaling, reduced motion and bounded-data disclosures pass |
| Safe preference lifetime | M7.5 implements/tests; M7.6 repeats installed restart | Allowlisted locale/density/appearance/layout defaults and explicit reset; corrupt, unsupported-version and write-failure recovery; valid panel sizes on changed display; no paths, dataset roster, scientific drafts, receipts, queue, classification or live work restored |
| Installable Windows x64 candidate | M7.6 packaging and clean-machine QA | One real installer; standard user with no Node/Rust/Git installs, launches and uninstalls; WebView2 present/missing/offline paths, user-installed provider setup, denied permissions and Unicode/space paths tested; sources and finalized scientific outputs survive uninstall |
| Production configuration | M7.6 build owner and independent package inspection | Distributed application loads bundled frontend without dev server; no `e2e` feature/bridge, mock provider, test-only IPC or synthetic success. Check both build configuration and actual packaged runtime; QA-enabled executable is not the release candidate |
| Release custody and recovery | M7.6 release owner/QA, repository owner approves | Version/changelog, artifact hashes, source/lock/toolchain/build-command provenance, dependency notices and vendor boundary; documented name-review result accepted by the owner; approved signature/posture; consent/redaction diagnostics, feedback destination, smoke record and uninstall/reinstall rollback instructions tied to retained approved artifacts |

Preference storage is local UI state, separate from source data and scientific
history. On error, keep usable defaults and explain recovery; never interpret
panel restoration as reopening a project or resuming an interrupted run.
No automatic updater or cloud telemetry is required. Diagnostics stay explicit
local exports with redaction and consent before sharing; backend excerpts may
still carry acquisition metadata. A feedback link must not upload it silently.

The existing residuals have first consumers, rather than a new audit campaign:

| Existing item | First responsible consumer and disposition |
| --- | --- |
| [Issue #112](https://github.com/MianliWang/MScanvas/issues/112), root cause undetermined | First slice touching ConversionPanel/focus restoration, expected M7.4 but M7.1 if shared-dialog integration touches it. Investigate before accepting that flow; deterministic picker-cancel/temporarily absent control/scope-return/user-focus-intent proof. No skip, blanket retry or timeout inflation |
| ADR 0045's failing M4.1 empty-spectrum export and M5.2 Tab cases | M7.3 owns viewport Tab; M7.4 owns empty-spectrum export, or earlier touched consumer. Diagnose test versus product and prove intended semantics; baseline failure is not green |
| M6.6–M6.9 native campaign NOT RE-RUN; stop-row harness race; save-dialog/clipboard/window-focus limits | First changed mechanism: M7.1 dialog/focus, M7.2 OS drop, M7.3 input/export, M7.4 conversion/adoption; M7.6 integrated native smoke. Retain measured driver/port facts and attribution; manual native evidence where automation cannot observe |
| `NOTICE_ORDER` coverage and advisory-code presentation | M7.4, or earlier localization consumer, must keep every applicable reason visible and translated; unknown structured codes remain inspectable without invented meaning |
| ADR 0043 G18, no application-reachable staging reclaim | M7.4 owns the guarded cleanup/replan flow above; M7.6 owns installed fault/recovery proof. It is a required conversion recovery exit, not a non-blocking residual; G16's forgeable marker cannot be borrowed as deletion authority |
| Closed evidence gates, source-family lists, hypothetical retry/fault/cost questions | Keep ADR 0045's named owners. No source-family expansion, overwrite cure, provider investigation or cache work is required by this UI route; any new observed release-critical defect still blocks release |

Select tests by changed mechanism. Text/token work does not rerun every old
native campaign, while dependency, focus, drop, IPC or input changes refresh
their affected real paths. The three preflight integration proofs run at their
named consumers, not in M7.0. Record synthetic/browser, real Tauri/provider and
physical-device evidence separately. No hardware, latency or large-scale claim
without measured inputs, host and results. Required CI failures remain failures;
a passing rerun retains the original attempt and its cause/status.

## External release decisions

M7.0 may close with the following decisions scheduled; M7's release exit cannot
waive them. **MianliWang, repository/product owner**, is the exact decision owner
for each row; M7.6 implements and records the answer, not an agent guessing it.

| Decision | Recommendation, not approval | Blocks / latest decision point |
| --- | --- | --- |
| Supported Windows versions | Initially maintained Windows 11 x64 versions, explicitly enumerated and tested; no implicit Windows 10/ARM/all-platform support | Support matrix, M7.5 setup wording; decide before M7.5 acceptance and freeze before M7.6 candidate QA |
| Signing identity/certificate or unsigned posture | Owner chooses an identity and budget, or explicitly approves an unsigned beta with accurate warning/setup guidance; do not promise warning-free signing | Signing configuration and final-candidate trust tests; before M7.6 candidate production |
| Distribution host/audience | Owner-approved beta channel and stated audience; GitHub prerelease is a possible host. Live repository API on 2026-09-12 reports public, superseding the request/preflight's private assumption; visibility was not changed here | Download/support instructions and access tests; before M7.6 candidate acceptance. Public source is not release consent |
| Lawful redistributable samples | Minimal licensed samples with attributable permission; maintainer-only vendor inputs remain local and unbundled | Shareable sample pack and reproducible public smoke instructions; decide before M7.6 release-fixture freeze |
| Actual public release consent and existing name review | Owner accepts the documented trademark, package-name and domain review required by [Proposal section 2](../../../PROJECT_PROPOSAL.md#2-name-and-positioning), then explicitly approves exact candidate hashes, audience/host, notices and feedback/rollback record | M7.6 assembles the name-review result before candidate acceptance; an unresolved result blocks release-ready status. Final consent follows validation and precedes every binary upload/tag/release |

Recommend one per-user NSIS installer built on Windows, with an explicit
WebView2 setup choice and offline prerequisite instructions. This is a proposed
packaging route, not a configured installer. [Tauri's installer documentation](https://v2.tauri.app/distribute/windows-installer/)
describes NSIS/MSI and runtime installation modes; [Microsoft's WebView2 deployment guide](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
distinguishes online bootstrapper/offline standalone and per-user/per-machine
setup. M7.6 must test the selected path, including refusal when prerequisites
cannot be installed. UI resources remain offline regardless of setup method.
ProteoWizard/vendor readers are user-installed, never bundled by this route.

Primary platform references were read on 2026-09-12. [Windows lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro)
is version-specific, so support must be rebound at release. [Tauri's signing guidance](https://v2.tauri.app/distribute/sign/windows/)
also states a newly signed release can still trigger SmartScreen. No cost,
certificate purchase, EULA acceptance, signing-key access, acquisition/archive
upload, visibility change or telemetry activation is authorized here.

M7.6 may report **BETA-RELEASE-READY CANDIDATE; PUBLICATION PENDING** only when
all product/package exits and external decisions other than upload consent are
satisfied. **BETA RELEASED** additionally requires consent and verified
distribution of those exact artifacts. M7.0 reports neither status.

## M7.0 publication boundary

Run direct `python -B scripts/check_repo.py`, `git diff --check` and an explicit
Markdown/path-closure check. No local frontend/Rust build, browser/native suite,
prototype execution or new science is part of this documentation task. One
isolated read-only review covers the small route; repairs receive focused
follow-up at their consumers. Required remote checks still apply.

Publication uses the actual reviewed head, resolved findings, live protections
and exact-head true merge. Verify two ordered parents (rebound base, reviewed
head), candidate-equal tree, natural Frontend/Rust/Repository quality `push/main`
checks on the merge, local ff-only inclusion and task-branch cleanup. Retain PR
and local closeout evidence rather than committing a follow-up SHA insertion.
Stop after M7.0: **M7 IN PROGRESS; M7 IMPLEMENTATION NOT STARTED; M7.1 —
Localized settings and shared controls — NEXT / NOT STARTED; M7.1 REQUIRES ITS
OWN IMPLEMENTATION AUTHORIZATION; PUBLIC BETA NOT BUILT / NOT RELEASED.**
