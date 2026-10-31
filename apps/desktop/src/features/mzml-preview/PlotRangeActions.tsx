import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { RawTextField } from "../../components/fields/RawTextField";
import { Button } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { formatMz } from "./format";
import type { PlotMenuItem } from "./QuickFigureActions";
import type { PlotInputPort, PlotInputSnapshot } from "./viewer/plotInputAdapters";
import { sameRange, usableRange } from "./viewer/rangeSelection";
import { validateRangeDraft } from "./viewer/rangeDraft";

/** The plot's gesture sentence; each plot's `aria-describedby` names its own. */
export const plotGestureHelpId = (axis: "rt" | "mz") => `plot-range-${axis}-gestures`;

/**
 * "Set range…" as an item of the plot's ⋯ menu (direction A), and whether its
 * editor is open. Closing gives the keyboard back to the ⋯ trigger it came from.
 */
export function usePlotRangeEditor(): { readonly editing: boolean; readonly item: PlotMenuItem; readonly close: () => void } {
  const t = useUiMessages();
  const [editing, setEditing] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const close = useCallback(() => { setEditing(false); returnTo.current?.focus(); }, []);
  return {
    editing,
    close,
    item: { key: "range", label: t("rangeSet"), opensDialog: true, onSelect: trigger => { returnTo.current = trigger; setEditing(true); } },
  };
}

/**
 * Everything a plot's range has besides its gestures, over the drawing so none
 * of it moves the plot: the pending band's Confirm and Cancel, the range editor
 * while it is open, the committed range for a screen reader, and the gesture
 * sentence the plot is described by.
 */
export function PlotRangeActions<A extends "rt" | "mz", D extends { readonly low: number; readonly high: number }>({ port, editing, onClose }: {
  readonly port: PlotInputPort<A, D>;
  /** Whether the editor is open; the plot's ⋯ menu opens it. */
  readonly editing: boolean;
  readonly onClose: () => void;
}) {
  const t = useUiMessages();
  const root = useRef<HTMLDivElement | null>(null);
  const composing = useRef(false);
  const [draft, setDraft] = useState<{ context: PlotInputSnapshot<A, D>; low: string; high: string } | null>(null);
  const [problem, setProblem] = useState<"rangeBlank" | "rangeInvalid" | "rangeForward" | "rangeOutside" | "rangeStale" | null>(null);
  // Opening takes the range on screen as it is now, and the keyboard moves to From.
  useLayoutEffect(() => {
    if (!editing) { setDraft(null); setProblem(null); return; }
    const context = port.current();
    if (context === null) return;
    const range = context.committed ?? context.full;
    setDraft({ context, low: String(range.low), high: String(range.high) });
    setProblem(null);
    // Once per opening: the port is rebuilt every render and must not reopen it.
  }, [editing]);
  const opened = draft !== null;
  useLayoutEffect(() => { if (opened) root.current?.querySelector<HTMLInputElement>(".plot-range-form input")?.focus(); }, [opened]);
  const current = port.current();
  if (current === null) return null;
  const pending = current.range?.phase === "pending" ? current.range : null;
  const axis = t(port.axis === "rt" ? "rangeRtAxis" : "rangeMzAxis");
  // At the plot's own precision, as its axis and caption print it; the exact
  // values are the editor's and the export note's (PM9 UI-31).
  const format = (value: number) => (port.axis === "mz" ? formatMz(value) : value.toFixed(4));
  const id = `plot-range-${port.axis}`;
  // A plot whose whole range is one value has nothing narrower to apply.
  const noWidth = !usableRange(current.full);
  const focusPlot = () => root.current?.closest("section")?.querySelector<SVGSVGElement>('svg[role="img"]')?.focus({ preventScroll: true });
  return <div className="plot-range-actions" ref={root}>
    {/* What is pending or committed, over the drawing's corner: a pending
        band's bounds, else "part of the full range" once a range narrower
        than the run or spectrum is committed. The readout line under the plot
        prints the range on screen, a gesture's included, so neither committed
        sentence claims to be it, and both stay true before, during and after
        a wheel or drag (PM9 UI-34). The committed bounds are announced rather
        than printed, so the readout's numbers are not repeated. Atomic, so a
        reader hears the whole line. Not printed while nothing is pending and
        nothing narrower than the full range is committed. The element stays
        mounted either way, so the live region is watched before its text
        changes. */}
    <p className={`plot-committed-range${pending === null && current.committed === null ? " visually-hidden" : ""}`} aria-live="polite" aria-atomic="true">{pending !== null
      ? t("rangePending", { name: axis, low: format(pending.domain.low), high: format(pending.domain.high) })
      : current.committed === null
        ? t("rangeCommittedFull", { name: axis })
        : <>{t("rangeCommittedPart", { name: axis })}<span className="visually-hidden">{t("rangeCommittedBounds", {
          low: format(current.committed.low), high: format(current.committed.high) })}</span></>}</p>
    {pending === null ? null : <div className="plot-pending-actions">
      <Button size="sm" onClick={() => { port.confirm(pending); focusPlot(); }}
        aria-label={t("rangeConfirmContext", { name: axis, low: format(pending.domain.low), high: format(pending.domain.high) })}>
        {t("rangeConfirm")}
      </Button>
      <Button size="sm" onClick={() => { port.cancel(pending.transaction); focusPlot(); }}>{t("rangeCancel")}</Button>
    </div>}
    {draft === null ? null : <form className="plot-range-form" id={`${id}-editor`} aria-label={t("rangeSet")}
      onCompositionStartCapture={() => { composing.current = true; }}
      onCompositionEndCapture={() => { composing.current = false; }} onKeyDown={event => {
        if (event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === "Enter" && event.repeat) event.preventDefault();
      }} onSubmit={event => {
        event.preventDefault(); if (composing.current) return;
        const now = port.current();
        if (now === null || now.source !== draft.context.source || now.revision !== draft.context.revision ||
          now.instruction !== draft.context.instruction || !sameRange(now.committed, draft.context.committed)) { setProblem("rangeStale"); return; }
        const result = validateRangeDraft(draft.low, draft.high, now.full);
        if (!result.valid) { setProblem(result.reason); return; }
        port.apply(port.domain(result.low, result.high)); onClose();
      }}>
      <label id={`${id}-low-label`} htmlFor={`${id}-low`}>{t("rangeLow")}</label>
      <RawTextField id={`${id}-low`} labelledBy={`${id}-low-label`} describedBy={`${id}-problem`} inputMode="decimal"
        invalid={problem !== null} value={draft.low} onChange={low => setDraft({ ...draft, low })} />
      <label id={`${id}-high-label`} htmlFor={`${id}-high`}>{t("rangeHigh")}</label>
      <RawTextField id={`${id}-high`} labelledBy={`${id}-high-label`} describedBy={`${id}-problem`} inputMode="decimal"
        invalid={problem !== null} value={draft.high} onChange={high => setDraft({ ...draft, high })} />
      <Button type="submit" size="sm" refused={noWidth} reasonId={`${id}-problem`}>{t("rangeApply")}</Button>
      <Button size="sm" onClick={onClose}>{t("rangeCancel")}</Button>
      <p id={`${id}-problem`} aria-live="polite">{problem !== null ? t(problem) : noWidth ? t("rangeNoWidth") : t("rangeGrammar")}</p>
    </form>}
    {/* The gestures, as the plot's description rather than a disclosure. */}
    <p className="visually-hidden" id={plotGestureHelpId(port.axis)}>{t("rangeHelpText")}</p>
  </div>;
}
