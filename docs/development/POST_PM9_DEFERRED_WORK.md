# Post-PM9 deferred work and disposition ledger

Date: 2026-10-20; options taken up 2026-10-27.
Status: **PLANNING RECORD (2026-10-20). ON 2026-10-27 THE OWNER TOOK UP PM9.7 F2/F3,
PM9.4 O1-O8 AND PM9.5 O1-O4: IMPLEMENTED ON `feat/beta1-readiness`, COMPONENT-TESTED,
WHOLE VITEST AND BROWSER SUITES AND A PER-OPTION RENDERED SPEC PASSING; NATIVE
ACCEPTANCE PENDING.** See
[Beta-1 readiness, 2026-10-27](#beta-1-readiness-2026-10-27).

PM9 is closed on frozen production `30b855f`, tests `e94fb16`, with the closing
record at `959a74f`. This inventory prepares independent work after that
closure. It neither changes the frozen candidate nor transfers historical
acceptance to a new change. The authoritative closing scope is
[baseline section 18](../phases/pm9/baseline.md#18-pm97-the-after-side-the-regression-and-the-frozen-candidate-2026-10-14)
and the [route's closing record](../phases/pm9/slices.md#closing-record).

## Authority and status meanings

The current dispatch permits this read-only inventory and its new document.
It does not select every optional row for implementation. No production,
existing test, dependency, contract, provider or engine change is made here.
No test, typecheck, build, application, provider or engine execution supports
this document's proposed acceptance criteria.

- **Carried-forward option:** recorded for later selection, not a required
  fix and not an assertion that the behavior was remeasured today.
- **Not adopted:** an explicit final decision to retain the shipped approach;
  this is not an implementation backlog item. Reconsideration needs a new
  product decision with a reason, not routine completion of this ledger.
- **Accepted / kept / closed:** the final PM9 decision stands. A historical
  provisional question is not still pending merely because its source slice
  retains the original question.
- **New capability / excluded:** not presentation polish; it needs its own
  scope and architecture decision before implementation.

The final [2026-10-13 and 2026-10-14 owner decisions](../phases/pm9/slice-07.md#9-owner-decisions-at-the-freeze)
take precedence over earlier provisional wording in the slice records. In
particular, the owner carried PM9.4 O1-O8, PM9.5 O1-O4 and the integrated
findings F2/F3 forward; the same decision explicitly did not adopt the
conversion settings summary/edit pattern or either stepper.

IDs below are qualified by their slice. **PM9.7 F2/F3** are the empty-state
findings; they are not PM9.4's future-capability F2/F3, PM9.5's future F2/F3,
or the reused review-finding numbers in PM9.4's execution log.

## Beta-1 readiness, 2026-10-27

The owner asked for every carried-forward option in this ledger to be taken
up before the first public beta, following the recommendations this ledger
records. Each was implemented in one of five parallel work lanes, reviewed
independently and repaired on review, then merged into `feat/beta1-readiness`
(PR #134, stacked on PM9's PR #131). None needed a Rust, DTO or IPC contract
change; PM9.5 O4's facts already existed for all three operation families.

Validation on the merged code: `pnpm typecheck` and `pnpm e2e:typecheck` exit
0; the whole browser suite passes on `bd82a0a`, 34 spec files and 487 tests in
Chrome 156; full Vitest first reported two cross-lane assertion conflicts,
reconciled in `678614f`, and then passed on `678614f`, 114 files and 2301
tests.

Rendered acceptance per option: `e2e/specs/beta1-ux.browser.e2e.ts` holds
F2, F3 (Workbench and Conversion), PM9.4 O1-O8 and PM9.5 O1-O4 in real Chrome
at 960x640 and 1366x768, in en and zh-CN where the state is language-bearing,
with keyboard routes and "no command sent" checks for refused presses, and
leaves a viewport screenshot per state. Its review found one rendered defect:
the targeted setup's disclosures (O1's read path among them) drew no marker,
because their summaries are flex boxes, and read as plain text; they now draw
one. After that repair the spec passes with the targeted, PM9.6 and PM9.7
specs, 6 files and 87 tests. Not held in a rendered case, each still covered
by component tests: PM9.4 O3's over-capacity state, O4's other
request-failure banners, O6's Stop this file wording, O7's source-comparison
mode and result half, O8's refusals other than cleanup during Add and a
partially published O1 set; PM9.5 O2 at 960x640 and O4's capture and
admission families.
Native acceptance at OS scaling is still owed.

One accepted PM9 position changes: PM9.7 F2 makes New project the one emphasised
action with no project open, which replaces PM9.2 L1's "New and Open stay
equals" ([slice 02](../phases/pm9/slice-02.md), kept as history).

## PM9.7 empty-state findings

Source observations: [slice 07, section 11](../phases/pm9/slice-07.md#11-record).
Final disposition: [slice 07, section 9](../phases/pm9/slice-07.md#9-owner-decisions-at-the-freeze),
confirmed by [baseline section 18](../phases/pm9/baseline.md#18-pm97-the-after-side-the-regression-and-the-frozen-candidate-2026-10-14).
The integrated states were accepted with both weaknesses carried forward.

| Item | Original meaning and final disposition | Further owner choice | Smallest proposed acceptance | Dependencies and scope risk |
| --- | --- | --- | --- | --- |
| PM9.7 F2 | With no project open, Project emphasizes no next action. Carried forward at PM9's freeze; **taken up 2026-10-27:** New project is the one emphasised action while no project is open, Open project stays beside it. | Select whether to change the empty-state hierarchy; the preference between creating a project and reopening one is not resolved by the finding. | Planning suggestion: emphasize the existing New project action only while no project is open, keep Open project available, and retain the existing explanatory hint. Verify one emphasized next action, both actions reachable by keyboard at the anchors in en/zh-CN, and the existing New/Open operations unchanged. | `ProjectPanel` and its existing locale resources. Preserve F1's refused-action treatment and existing unsaved-project handling. Rendering or navigating must not create a project, open a picker or start work automatically. |
| PM9.7 F3 | At 960x640 the empty Workbench's and Conversion's next action is behind folded Acquisitions, which their copy does not name. Carried forward at PM9's freeze; **taken up 2026-10-27:** both guidances name *Add files…* in *Acquisitions* and the header toggle, composed from those controls' own resources. | Select a focused discoverability/copy change and its wording; automatic unfolding or a new duplicate action is a separate interaction choice. | Planning suggestion: name the existing header Acquisitions toggle and Add files path in the empty guidance. At 960x640, start folded and reach the toggle with Tab/Enter, then the existing acquisition action; verify the named route in both languages and that expanded-state guidance remains true. A candidate English phrase is "Open Acquisitions in the header, then choose Add files..."; final UI punctuation and zh-CN terminology must follow the existing resources. | Workbench empty guidance, conversion no-target guidance and `rosterToggle`; preserve one user-controlled fold state. Workbench guidance must distinguish mzML preview from vendor conversion. Do not imply vendor preview, usable ProteoWizard, a ready conversion or automatic membership/execution. |

These are candidate criteria, not chosen copy or completed repairs. Before a
product edit, confirm the current state and freeze the selected criterion;
this inventory does not supply new rendered evidence.

## PM9.4 optional presentation ledger

Original rows: [slice 04, Optional, recorded and not done](../phases/pm9/slice-04.md#optional-recorded-and-not-done).
Final disposition for **each O1-O8**: carried forward after PM9, not into its
candidate, by [slice 07, section 9](../phases/pm9/slice-07.md#9-owner-decisions-at-the-freeze).
The minimum criteria below apply only if that individual option is selected.

| Item | Original observation | Final disposition / further owner choice | Smallest proposed acceptance | Dependencies and scientific or workflow risk |
| --- | --- | --- | --- | --- |
| [O1](../phases/pm9/slice-04.md#optional-recorded-and-not-done) | A set row repeats each finalized output name in its member list and open group. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. Names stay beside their Open actions; the plain list remains only for a set without them. | Each finalized member remains identifiable beside its own Open action; complete and partially published sets still distinguish all members. Removing duplicate text must not remove member actions or partial-set facts. | Existing output-set projection and identity-bound opening. Do not synthesize names, merge distinct members, or imply an incomplete prefix is an adoptable complete set. |
| [O2](../phases/pm9/slice-04.md#optional-recorded-and-not-done) | Excluded mzML rows are counted without being named. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. | A bounded list or disclosure names the excluded rows in the chosen scope and retains the exact count; long names remain readable and keyboard reachable. | Existing scope projection and file display names. Listing exclusions must not change checkbox membership, eligibility, execution order or mzML's conversion refusal. |
| [O3](../phases/pm9/slice-04.md#optional-recorded-and-not-done) | No-target and capacity states repeat one fact in two or three sentences. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. | Each state retains one clear actionable reason; Convert's accessible description still reaches it. Verify no-target and over-capacity states separately, including a refused press sending no start command. | Notice and plan-pending copy, accessible IDs and the authoritative start rule. Do not hide a distinct refusal merely because two sentences resemble each other, or invent a capacity or eligible count. |
| [O4](../phases/pm9/slice-04.md#optional-recorded-and-not-done) | The shared request-error banner is at the panel top, names no action and uses `role=status`. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. The one panel-top banner now leads with the failed control's name; moving it beside each control remains an owner choice. | A failed action is identifiable where the reader can recover; preserve the typed error's meaning and a keyboard-accessible recovery route without duplicate announcements. | Conversion operation error ownership and focus. A presentation change must not attribute another action's error to the current press, introduce retry commands, or change provider refusal semantics. |
| [O5](../phases/pm9/slice-04.md#optional-recorded-and-not-done) | Convert has an ellipsis even for destinations that open no picker. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. | The label indicates the existing picker only for the custom-folder path; eligible count, localization and refused-state description remain intact. | Existing destination policy and Convert resources. Do not change the custom-folder default, add a picker to sibling/subfolder destinations, or change start request arguments. |
| [O6](../phases/pm9/slice-04.md#optional-recorded-and-not-done) | The review explains Stop and Skip before either action exists. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. | A ready review stays understandable; running rows still explain Stop/Skip when offered, and cancellation versus requested/confirmed ending remains clear. | Review and running-state help. Do not add controls before they are valid or imply pause, resume, undo or automatic retry. |
| [O7](../phases/pm9/slice-04.md#optional-recorded-and-not-done) | `validationMode` is not rendered; the PM9.4 record describes its then-current value as always output-only because Rust hardcodes it. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. The plan says output-only only for an output-only mode and nothing for another until plan-time wording is chosen; results follow each report's mode. | If shown, the description comes from the Rust-projected mode and says exactly what was checked. Output-only validation must not be described as source comparison, scientific suitability or fidelity. | Existing authoritative report fields and localized explanations. No new validation algorithm, comparison, provider read or stronger quality claim is authorized by displaying the field. Recheck the current projection rather than universalizing the historical output-only observation. |
| [O8](../phases/pm9/slice-04.md#optional-recorded-and-not-done) | Add, Diagnostics and staging cleanup give no reason when another lane action refuses them. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. | Each refused action has a truthful reachable reason tied to the current lane; click/Enter/Space remain inert while refused, and pending initiators retain the established natural focus behavior. | Existing adoption, diagnostics, recovery and lane ownership. Do not unlock concurrent work, weaken staging ownership/cleanup boundaries, delete source data or alter queue/adoption authority. |

PM9.4's [required and verified rows](../phases/pm9/slice-04.md#3-findings-and-acceptance)
remain accepted. These options do not reopen the completed scope, review,
queue or recovery work.

## PM9.5 optional presentation and operation-state ledger

Original rows: [slice 05, Optional, recorded and not done](../phases/pm9/slice-05.md#optional-recorded-and-not-done).
Final disposition for **each O1-O4**: carried forward by
[slice 07, section 9](../phases/pm9/slice-07.md#9-owner-decisions-at-the-freeze).

| Item | Original observation | Final disposition / further owner choice | Smallest proposed acceptance | Dependencies and scientific or workflow risk |
| --- | --- | --- | --- | --- |
| [O1](../phases/pm9/slice-05.md#optional-recorded-and-not-done) | The recipe paragraph occupies about eight lines at 1366x768; a list and a disclosure for the read path could shorten the first screen. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. Select the information hierarchy; the suggested list/disclosure is not already approved UI. | Essential recipe scope and caveats remain visible before Run; optional read-path detail is keyboard reachable. Verify the first screen and review/Run path in both languages with the same typed inputs. | Existing targeted setup prose. Do not hide experimental/scientific limitations, imply identification or validation, change parameters or turn a read-path explanation into new processing. |
| [O2](../phases/pm9/slice-05.md#optional-recorded-and-not-done) | Below 1700 px, Show run inspects a run in folded Details; the existing Show Details hint is at the surface top rather than beside the press. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. Select whether a local hint is needed. | At 1366x768 and 960x640 the reader can discover and open the existing Details path after Show run, with truthful guidance and the current inspected run retained. | Show run, shell Details toggle and presentation state. Do not silently unfold panels, move focus, open a report or change the accepted history keyboard model as an incidental copy repair. |
| [O3](../phases/pm9/slice-05.md#optional-recorded-and-not-done) | The targeted setup heading has the same weight as every project section heading. | **Taken up after PM9 (2026-10-27):** implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. Select whether a stronger hierarchy is warranted. | The active setup is visually distinguishable without breaking semantic heading order, minimum targets, long-name wrapping or constrained-window reachability. | Project setup styles and the design system. No new page, stepper, navigation state or altered request/plan/run lifecycle. |
| [O4](../phases/pm9/slice-05.md#optional-recorded-and-not-done) | Busy-line Cancel for a links check, capture or admission has no retained "requested" state; PM9.5 R7 covers targeted runs only. | **Taken up after PM9 (2026-10-27):** the existing contract carries the accepted operation and its terminal answer for all three families, so no contract change was needed; implemented in `feat/beta1-readiness`, component-tested, whole Vitest and browser suites passing; native acceptance pending. Select whether to extend the requested-state contract to these other operations. | A cancellation press refers to the accepted operation ID, suppresses repeat requests across that operation's controls, and says requested until its own terminal answer. A late terminal answer must not overwrite a newer operation's state. | Project job/cancellation ownership and projections for each operation family. First establish which existing facts support this state; a missing authoritative fact needs a separately bounded contract change. Do not claim cancellation completed on request, clear records, or add automatic retries. |

PM9.5's [R1-R12 and V1-V7](../phases/pm9/slice-05.md#4-findings-and-acceptance)
remain accepted; O4 must not be presented as an unfixed targeted-run R7.

## ADR 0006 correction

**Disposition: documentation-only correction prepared and statically reviewed.**
No further product choice is required to remove the obsolete sidebar
breakdown. The [owner decision](../phases/pm9/slice-07.md#9-owner-decisions-at-the-freeze)
follows [baseline section 11](../phases/pm9/baseline.md#11-pm93-focused-rendered-acceptance-2026-09-28):
the 544 px statement names a sidebar removed by the M7.2 fold.

The target is [ADR 0006, Active dataset](../architecture/adr/0006-multi-dataset-workspace-boundary.md#active-dataset)
and its related [testing obligations](../architecture/adr/0006-multi-dataset-workspace-boundary.md#testing-obligations).
The minimum acceptance is an explicit dated correction that distinguishes the
historical breakdown from the current folded workbench and does not assert
unmeasured replacement dimensions. Preserve the notice/recovery contract and
historical attribution. No CSS, minimum window size, panel layout or scientific
behavior changes as part of this correction.

The separate correction now contains the dated amendment and revised testing
obligations. Its independent static review identified no defect. This inventory
does not edit ADR 0006; neither that correction nor its static review supplies
fresh browser or native rendering evidence.

## Explicit final decisions that are not pending implementation

The [final freeze decisions](../phases/pm9/slice-07.md#9-owner-decisions-at-the-freeze)
resolve these earlier questions; retaining their historical descriptions does
not revive them.

| Item | Final disposition and consequence |
| --- | --- |
| PM9.4 one-line settings summary with an edit action | **Not adopted.** This is separate from PM9.4 O1-O8. Do not implement it as ordinary deferred polish. |
| PM9.4 three-phase stepper | **Not adopted.** Keep the accepted single conversion surface and review leading to Convert. |
| PM9.5 stepper | **Not adopted.** Keep the accepted in-place request, review, Run and ending. |
| L7 at 1920x1080, L11 outer inset, L21 constrained one-row navigation | **Kept as intentional deviations**, not correction tasks. |
| [PM9.6 O1](../phases/pm9/slice-06.md#optional), history focus | **Kept:** opening history brings the report into view while the keyboard stays in history. Do not copy PM9.5 Open result's heading-focus behavior into history. |
| [PM9.6 O3](../phases/pm9/slice-06.md#optional), evidence reveal guard | **Kept:** the reveal uses the keyboard/focus guard alone. A scroll-based cancellation guard is not owed. |
| [PM9.6 O2](../phases/pm9/slice-06.md#optional), target outcome outside its heading | **No action needed** in [slice 07 A6](../phases/pm9/slice-07.md#3-work-items-frozen-before-any-run); do not convert this observation into a requirement. |
| [PM9.6 O4](../phases/pm9/slice-06.md#optional), `unknownRecord` evidence wording | Remains with the M9.2 wording owner **only if a reachable path appears**; the recorded path is unreachable. Do not manufacture a product failure or add a new route to exercise it. |
| PM9.7 F1/F6/F15 | **Fixed and accepted in candidate 2**, not deferred: refused Project look/reason, consistent zh-CN terms and the 2 px focus ring. Their native rendering qualification remains a different evidence question. |
| PM9.7 F4/F5 and F7-F14 | F4/F5 evidence gaps were **closed test-only**; F7-F14 were **observations with no action**. See [slice 07 section 11](../phases/pm9/slice-07.md#11-record). |

The conversion reference's separate review page, subfolder default,
percentage/ETA layer, simulated names, methods/templates/presets and settings
outside the admitted catalog were also [deliberately not adopted](../phases/pm9/slice-04.md#10-record).
The targeted reference's separate pages, progress track/ETA and task log were
not adopted; its useful task hierarchy was accepted without those features
([slice 05 section 12](../phases/pm9/slice-05.md#12-record)). None is an O-row
implementation commitment.

## Future-capability rows and distinct qualification work

This table prevents reuse of local F-numbers from silently expanding the
presentation backlog. These rows are not additional authorized implementations.

| Source item | Current disposition / decision and minimum boundary for any future work |
| --- | --- |
| [PM9.4 F1](../phases/pm9/slice-04.md#future-or-another-owners): Retry has no `operationId` | Rust/DTO work, outside the presentation slice. A new authority-binding decision and invariant-level tests would be needed; copy must not imply a binding the command does not carry. |
| [PM9.4 F2](../phases/pm9/slice-04.md#future-or-another-owners): preview without adoption or adopt one output | New capability. Separately choose the workflow and authoritative finalized-output identity before any implementation; no automatic adoption/preview or bypass of the existing object checks. |
| [PM9.4 F3](../phases/pm9/slice-04.md#future-or-another-owners): adopted outputs join conversion membership | Existing roster import default from M6.9/M7.2, **not a defect selected for repair**. Changing that default is an owner decision; any later change must preserve the distinction between highlight, preview and conversion membership. |
| [PM9.4 F4](../phases/pm9/slice-04.md#future-or-another-owners): shell dot and scope pill | Both were **closed with PM9.2**, retained only as history. No new task. |
| [PM9.5 F1](../phases/pm9/slice-05.md#future-or-another-owners), also [PM9.6 F1](../phases/pm9/slice-06.md#futureexternal): parameter-bound wording | A read-only Rust-owned bounds projection is required before exact ranges can be stated. No new projection is authorized by this inventory; do not duplicate or guess the scientific bounds in UI copy. |
| [PM9.5 F2](../phases/pm9/slice-05.md#future-or-another-owners): report, evidence, exports, history and reopen | The handoff was to PM9.6 and is **superseded by that completed slice's acceptance**, not an unimplemented bundle. See [PM9.6 record](../phases/pm9/slice-06.md#13-record) and [PM9 closeout](../phases/pm9/slices.md#closing-record). Native/filesystem/engine evidence is still distinct. |
| [PM9.5 F3](../phases/pm9/slice-05.md#future-or-another-owners): cross-session drafts, import, presets, batch continuation, automatic retry | **Excluded new capabilities**, not O-row polish. Require a separate product and persistence/execution decision if reconsidered. |
| [PM9.6 F2](../phases/pm9/slice-06.md#futureexternal): result sort/filter/paging, view-scoped export, clipboard, PNG metadata, spreadsheet-formula neutralization | **Excluded new capabilities.** Any later proposal must preserve source order, full-table export meaning, scientific values and format contracts; this ledger supplies no new export or data-transformation permission. |
| [PM9.6 F3](../phases/pm9/slice-06.md#futureexternal): history deletion/notes, automatic relink, Workbench restore, rerun to replace damage | **Excluded.** Do not reinterpret recovery copy as permission to delete history, restore sessions, relink automatically or regenerate stored evidence. |
| [PM9.6 F4](../phases/pm9/slice-06.md#futureexternal): real reopen/payload copies, native dialogs, engine and DPI | Separate qualification evidence. Browser acceptance does not establish any of these results. |
| 150% native rendering and related selector migration | **Executed 2026-10-27/28 on the beta-1 candidate's source:** the 79 titles of the prepared matrix and NQ-I's 18 integrated cases passed in their final runs ([first run](POST_PM9_NATIVE_QUALIFICATION.md#execution-2026-10-2728-beta-1-candidate), [idle-desktop run](POST_PM9_NATIVE_QUALIFICATION.md#nq-n2-and-nq-i-on-an-idle-desktop-2026-10-28)). The [native preparation record](POST_PM9_NATIVE_QUALIFICATION.md#execution-gates) owns binary attribution, resource admission, the bounded provider authorization and actual Windows scaling evidence. |
| U4 live-provider qualification | **Executed 2026-10-27/28** in the native campaign ([record](POST_PM9_NATIVE_QUALIFICATION.md#u4-live-provider-conversions)): the four M6 suites passed through the `e2e`-feature binary with 32 real ProteoWizard 3.0.26013 conversions of campaign copies of the admitted Thermo fixture across all attempts, output-only validation. It is not installed-release evidence and compares nothing with a vendor-source spectrum model. The [2026-10-20 bounded release](POST_PM9_NATIVE_QUALIFICATION.md#provider-hold) authorizes automatic discovery/probes and reads/conversions of existing admitted fixtures for this qualification. It is authorization, not positive provider evidence. The **historical PM9 disposition remains BLOCKED_PROVIDER_HOLD**, with U4 accepted while that check was open ([freeze decision](../phases/pm9/slice-07.md#9-owner-decisions-at-the-freeze)). Neither a help probe nor native rendering proves actual conversion; no new samples, providers or separate engine qualification are authorized by this release. |
| Real targeted-MS1 engine path | **PENDING**, its own qualification. Static runtime/fixture inspection, controlled results and UI work do not prove an engine run; do not infer identification, a validated assay or packaged runtime support. See [M9's remaining limits](../product/M9_CLOSURE.md#13-remaining-limits). |

## Handoff boundary

This ledger is a planning artifact. Its proposed criteria are deliberately
smaller than a redesign, but they still require selection, current-state
confirmation and rendered validation before a product change can be accepted.
No optional row is marked fixed here, no PM9 result is rerun or reopened, and
no commit, push, PR or publication is produced by this document task.
