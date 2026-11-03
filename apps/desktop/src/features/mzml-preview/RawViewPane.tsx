import { useLayoutEffect, useRef, type FocusEvent, type ReactNode } from "react";

import { Button, EmptyState, Icon } from "../../components/ui";
import type { UiMessage } from "../preferences/i18n";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { CONVERSION_AXES } from "./conversionIntentSelection";
import { conversionErrorMessage } from "./conversionMessages";
import { axisValueLabel } from "./ConversionSettings";
import { SOURCE_KIND_LABEL, type PreviewError, type RawViewAvailability, type RawViewPhase, type RawViewState, type SelectedFile, type ViewSource } from "./contracts";
import { formatDatasetLabel } from "./format";
import { NotVerifiedTag } from "./NotVerifiedTag";
import { hasOwnedMessage, ownedErrorMessage } from "./ownedErrorMessages";
import type { RawViewControl } from "./useRawView";

const REASON_ID = "raw-view-refusal";
const OPEN_REASON_ID = "raw-view-open-reason";

/** A name standing alone keeps more of itself than one inside a sentence or on a button. */
const HEADING_NAME_LIMIT = 64;

/** Failures another ProteoWizard can cure: their recovery is decision 4's, and the row comes back with it. */
const BINDING_FAILURES: ReadonlySet<string> = new Set(["backend_not_found", "provider_build_not_evidenced"]);

const PHASE = {
  checkingSource: "rawViewPhaseCheckingSource",
  checkingCachedCopy: "rawViewPhaseCheckingCachedCopy",
  converting: "rawViewPhaseConverting",
  checkingOutput: "rawViewPhaseCheckingOutput",
  storing: "rawViewPhaseStoring",
} as const satisfies Record<RawViewPhase, string>;

/** One gibibyte, the unit every size in this pane's copy uses (decision 9). */
const GIB = 2 ** 30;
const gib = (bytes: number) => (bytes / GIB).toFixed(1);

export const rawViewPhaseText = (phase: RawViewPhase, t: UiMessage) => t(PHASE[phase]);

/** Minutes and seconds of a clock, never an estimate of what is left (decision 3). */
export function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A name for a one-line sentence: it loses its middle, and keeps its end and extension. */
export function shortFileName(name: string, limit = 32): string {
  if (name.length <= limit) return name;
  const tail = Math.floor(limit / 2);
  return `${name.slice(0, limit - tail - 1)}…${name.slice(-tail)}`;
}

/** This row's operation, or `null` when the latest one is another row's or there is none. */
export function ownRawViewState(state: RawViewState, handle: string): Exclude<RawViewState, { state: "idle" }> | null {
  return state.state !== "idle" && state.handle === handle ? state : null;
}

/** Whether a ready operation of this row can still be opened. */
const openable = (own: ReturnType<typeof ownRawViewState>) => own?.state === "ready" && own.openable;

/** Try again: a retryable failure, or one whose cause Rust says has since gone (ADR 0060 slice 3 note 8). */
function retryOffered(failed: Extract<RawViewState, { state: "failed" }>, availability: RawViewAvailability | null): boolean {
  return failed.retryable || (BINDING_FAILURES.has(failed.code) && availability?.available === true);
}

/**
 * What Enter on the highlighted RAW row presses (decision 1): the pane's first
 * action, in the states that have one and while Rust says it can be pressed, and
 * nothing in any other.
 */
export function rawViewFirstAction(view: RawViewControl, handle: string): "view" | "open" | "retry" | null {
  if (view.busy) return null;
  const own = ownRawViewState(view.state, handle);
  if (openable(own)) return "open";
  const available = view.availability?.available === true;
  if (own?.state === "failed") return available && retryOffered(own, view.availability) ? "retry" : null;
  return available ? "view" : null;
}

/** The sentence a refused View carries, from Rust's code (decision 4). */
export function rawViewRefusalText(code: string, runningName: string | null, t: UiMessage): string {
  switch (code) {
    case "raw_view_busy": return runningName === null ? t("rawViewBusyUnnamed") : t("rawViewBusy", { name: shortFileName(runningName) });
    case "conversion_busy": return t("rawViewConversionBusy");
    case "view_cache_entry_too_large": return t("rawViewTooLarge");
    default: {
      const error: PreviewError = { kind: code, summary: "", detail: null, retryable: false };
      return conversionErrorMessage(error, t);
    }
  }
}

/** What a failed view says, in owned words: the conversion's own codes have no sentence of their own here. */
export function rawViewFailureText(failed: Extract<RawViewState, { state: "failed" }>, t: UiMessage): string {
  if (failed.code === "view_cache_no_space" && failed.neededBytes !== null && failed.freeBytes !== null) {
    return t("rawViewNoSpace", { needed: gib(failed.neededBytes), free: gib(failed.freeBytes) });
  }
  const error: PreviewError = { kind: failed.code, summary: failed.message, detail: null, retryable: failed.retryable };
  const said = hasOwnedMessage(failed.code) ? ownedErrorMessage(error, t) : t("rawViewConversionFailed");
  return failed.freeBytes === null ? said : t("rawViewFailureWithFree", { failure: said, free: t("rawViewFreeNow", { free: gib(failed.freeBytes) }) });
}

export interface RawViewPaneProps {
  readonly row: SelectedFile;
  readonly view: RawViewControl;
  /** Why this session is not asking Rust right now, such as the start-up check. */
  readonly localReason: string | null;
  /** The name of the row a view is running for, when it is another row's. */
  readonly runningName: string | null;
  readonly canOpen: boolean;
  /** The visible reason elsewhere that a refused Open points at. */
  readonly openReasonId?: string | undefined;
  /** Why Open waits, when nothing else on screen says so. */
  readonly openReason?: string | null;
  readonly onOpen: (operation: number) => void;
  readonly onConvert: () => void;
  readonly onChooseFolder: () => void;
  readonly onShowBackend: () => void;
  readonly onShowConversion: () => void;
  readonly onShowRunning: () => void;
}

/**
 * The Thermo RAW row's pane (ADR 0060 decisions 1, 3 and 4). Activating the row
 * started nothing; everything here is one press away, and the pane says which
 * state the operation is in, as Rust answered it.
 */
export function RawViewPane({ row, view, localReason, runningName, canOpen, openReasonId, openReason = null, onOpen, onConvert, onChooseFolder, onShowBackend, onShowConversion, onShowRunning }: RawViewPaneProps) {
  const t = useUiMessages();
  const own = ownRawViewState(view.state, row.handle);
  const name = formatDatasetLabel(row);
  const shownName = shortFileName(name, HEADING_NAME_LIMIT);

  // The buttons change with the state, and the one pressed goes with it. The
  // keyboard stays in the pane rather than falling to the body; a move of the
  // reader's own is left alone, because only a change of state asks this.
  // Storing is a change of its own: it has no button, so the pane itself holds
  // the keyboard until the next state offers one.
  const root = useRef<HTMLDivElement>(null);
  const heldFocus = useRef(false);
  const kind = own?.state === "running" && own.phase === "storing" ? "storing" : own?.state ?? "idle";
  const shownKind = useRef(kind);
  useLayoutEffect(() => {
    const node = root.current;
    if (node === null) return;
    if (shownKind.current !== kind && heldFocus.current && (document.activeElement === null || document.activeElement === document.body)) {
      (node.querySelector<HTMLElement>("button") ?? node).focus({ preventScroll: true });
    }
    shownKind.current = kind;
    heldFocus.current = node.contains(document.activeElement);
  });
  // Between renders too: a press right after the keyboard arrived renders nothing first.
  const onFocus = () => { heldFocus.current = true; };
  const onBlur = (event: FocusEvent) => { if (event.relatedTarget !== null) heldFocus.current = false; };

  // Rust's answer decides whether View or Try again can be pressed. A press it
  // refused after the last read is said here too, and holds nothing: it was
  // about a moment, and the next answer is the authority.
  const availabilityCode = view.availability?.available === false ? view.availability.code : null;
  const refusedCode = availabilityCode ?? (view.refusal?.handle === row.handle ? view.refusal.error.kind : null);
  const refusedHere = localReason ?? (refusedCode === null ? null : rawViewRefusalText(refusedCode, runningName, t));
  // Not asked yet: nothing is known, so nothing is offered.
  const refused = localReason !== null || availabilityCode !== null || view.availability === null || view.busy;
  const reason = refusedHere === null ? null : <span id={REASON_ID} className="raw-view-reason" title={runningName ?? undefined} data-raw-view-refusal={refusedCode ?? "local"}>{refusedHere}</span>;
  const describedBy = refusedHere === null ? undefined : REASON_ID;
  const recovery = (code: string | null) => <>
    {code === "backend_not_found" || code === "provider_build_not_evidenced" ? <Button onClick={onChooseFolder}>{t("rawViewChooseFolder")}</Button> : null}
    {code === "backend_quarantined" ? <Button onClick={onShowBackend}>{t("rawViewShowBackend")}</Button> : null}
    {code === "conversion_busy" ? <Button onClick={onShowConversion}>{t("rawViewShowConversion")}</Button> : null}
    {code === "raw_view_busy" && runningName !== null ? <Button aria-label={t("rawViewShow", { name: runningName })} title={runningName} onClick={onShowRunning}>{t("rawViewShow", { name: shortFileName(runningName) })}</Button> : null}
    {/* The read itself failed, so nothing on this side would ask again. */}
    {availabilityCode === "unexpected_error" ? <Button data-raw-view-reask="" onClick={view.refresh}>{t("rawViewTryAgain")}</Button> : null}
  </>;

  const convert = <Button onClick={onConvert}>{t("rawViewConvert")}</Button>;
  let body: ReactNode;
  if (own?.state === "running") {
    const determinate = own.bytesRead !== null && own.bytesTotal !== null && own.bytesTotal > 0;
    body = <div className="viewer-skeleton raw-view-progress" aria-busy="true" data-raw-view="running" data-raw-view-phase={own.phase}>
      <div className="raw-view-head">
        <strong className="viewer-skeleton-name" title={name}>{shownName}</strong>
        <NotVerifiedTag label={own.unverifiedBuildRelease === null ? null : { unverifiedSettings: false, unverifiedBuildRelease: own.unverifiedBuildRelease }} />
        {/* Keyed, so each phase waits its own 300 ms: one that ends sooner shows nothing (I8). */}
        <span key={own.phase} className="raw-view-phase">
          <span data-raw-view-line="">{rawViewPhaseText(own.phase, t)}</span>
          {own.phase === "converting" ? <span className="raw-view-elapsed" data-raw-view-elapsed="">{formatElapsed(own.elapsedMs)}</span> : null}
          {/* What MSCanvas measures, and nothing else: its own reads have bytes, msconvert reports nothing. */}
          {determinate ? <div className="conversion-progress-bar raw-view-bar" role="progressbar" aria-label={rawViewPhaseText(own.phase, t)} aria-valuemin={0} aria-valuemax={own.bytesTotal ?? 0} aria-valuenow={own.bytesRead ?? 0} data-raw-view-bar="measured">
            <span style={{ width: `${String(Math.min(100, ((own.bytesRead ?? 0) / (own.bytesTotal ?? 1)) * 100))}%` }} />
          </div>
            : own.phase === "converting" ? <div className="conversion-progress-bar raw-view-bar" role="progressbar" aria-label={rawViewPhaseText(own.phase, t)} data-raw-view-bar="indeterminate">
              <span />
              <span className="conversion-progress-current" style={{ left: 0, width: "100%" }} />
            </div> : null}
        </span>
        {/* Storing cannot be cancelled (decision 10). */}
        {own.phase === "storing" ? null : <Button data-raw-view-cancel="" onClick={view.cancel}>{t("cancel")}</Button>}
      </div>
      {own.cachedCopyDamaged ? <p className="raw-view-note">{t("rawViewDamaged")}</p> : null}
      {view.refusal?.handle === row.handle ? <p className="raw-view-note" data-raw-view-refusal={view.refusal.error.kind}>{rawViewRefusalText(view.refusal.error.kind, null, t)}</p> : null}
      <div className="viewer-skeleton-plot" aria-hidden="true"><span className="viewer-skeleton-head" /><span className="viewer-skeleton-frame" /></div>
      <div className="viewer-skeleton-lower" aria-hidden="true">
        <div className="viewer-skeleton-table">{[0, 1, 2, 3, 4, 5].map(item => <span key={item} className="viewer-skeleton-row" />)}</div>
        <div className="viewer-skeleton-plot"><span className="viewer-skeleton-head" /><span className="viewer-skeleton-frame" /></div>
      </div>
    </div>;
  } else if (own?.state === "ready" && own.openable) {
    body = <EmptyState className="evidence-state" message={<>
      <Icon name="file" size={28} />
      <strong data-raw-view="ready" title={name}>{t("rawViewReady", { name: shownName })}</strong>
      <NotVerifiedTag label={own.unverifiedBuildRelease === null ? null : { unverifiedSettings: false, unverifiedBuildRelease: own.unverifiedBuildRelease }} />
      {openReason === null ? null : <span id={OPEN_REASON_ID} className="raw-view-reason" data-raw-view-open-reason="">{openReason}</span>}
    </>} action={<div className="evidence-actions">
      <Button refused={!canOpen} reasonId={openReason === null ? openReasonId : OPEN_REASON_ID} data-raw-view-open="" onClick={() => onOpen(own.operation)}>{t("rawViewOpen")}</Button>
      {convert}
    </div>} />;
  } else if (own?.state === "failed") {
    const canRetry = retryOffered(own, view.availability);
    const bindingFailure = BINDING_FAILURES.has(own.code);
    // Only what a button here answers to. A final failure offers none of them,
    // and what refuses a press that is not offered is not this row's news.
    const said = canRetry || bindingFailure;
    body = <EmptyState className="evidence-state" message={<>
      <Icon name="info" size={28} />
      <strong title={name}>{shownName}</strong>
      <span role="alert" data-raw-view="failed" data-raw-view-code={own.code}>{rawViewFailureText(own, t)}</span>
      {said && refusedCode !== own.code ? reason : null}
    </>} action={<div className="evidence-actions">
      {canRetry ? <Button refused={refused} aria-describedby={describedBy} data-raw-view-retry="" onClick={() => view.begin(row.handle)}>{t("rawViewTryAgain")}</Button> : null}
      {said ? recovery(refusedCode ?? (bindingFailure ? own.code : null)) : null}
      {convert}
    </div>} />;
  } else {
    const label = view.availability?.available === true && view.availability.unverifiedBuildRelease !== null
      ? { unverifiedSettings: false, unverifiedBuildRelease: view.availability.unverifiedBuildRelease } : null;
    const cancelled = own?.state === "cancelled" ? own : null;
    body = <EmptyState className="evidence-state" message={<>
      <Icon name="file" size={28} />
      <strong title={name}>{shownName}</strong>
      <span id="preview-needs-conversion-description">{SOURCE_KIND_LABEL[row.sourceKind]}</span>
      {cancelled === null ? null : <span data-raw-view="cancelled">{t(cancelled.stored ? "rawViewCancelledStored" : "rawViewCancelledEmpty")}</span>}
      {reason}
      <NotVerifiedTag label={label} />
    </>} action={<div className="evidence-actions">
      {/* Bordered: the Workbench's one filled primary stays the roster's Convert (B2). */}
      <Button refused={refused} aria-describedby={describedBy} data-raw-view-view="" onClick={() => view.begin(row.handle)}>{t("rawViewView")}</Button>
      {recovery(refusedCode)}
      {convert}
    </div>} />;
  }
  return <div ref={root} className="raw-view-pane" data-raw-view-pane={row.handle} tabIndex={-1} onFocus={onFocus} onBlur={onBlur}>{body}</div>;
}

/** The settings a view was converted with, in the conversion surface's own words. */
export function viewSourceSettings(source: ViewSource, t: UiMessage): string {
  return ["mzML", ...CONVERSION_AXES.map(axis => axisValueLabel(axis, source.intent[axis] as never, t))].join(", ");
}
