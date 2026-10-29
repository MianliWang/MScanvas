import { useRef, useState } from "react";
import { RawTextField } from "../../components/fields/RawTextField";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { formatMz } from "./format";
import type { PlotInputPort, PlotInputSnapshot } from "./viewer/plotInputAdapters";
import { sameRange, usableRange } from "./viewer/rangeSelection";
import { validateRangeDraft } from "./viewer/rangeDraft";

export function PlotRangeActions<A extends "rt" | "mz", D extends { readonly low: number; readonly high: number }>({ port }: {
  readonly port: PlotInputPort<A, D>;
}) {
  const t = useUiMessages();
  const summary = useRef<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const details = useRef<HTMLDetailsElement | null>(null);
  const composing = useRef(false);
  const [draft, setDraft] = useState<{ context: PlotInputSnapshot<A, D>; low: string; high: string } | null>(null);
  const [problem, setProblem] = useState<"rangeBlank" | "rangeInvalid" | "rangeForward" | "rangeOutside" | "rangeStale" | null>(null);
  const current = port.current();
  if (current === null) return null;
  const pending = current.range?.phase === "pending" ? current.range : null;
  const axis = t(port.axis === "rt" ? "rangeRtAxis" : "rangeMzAxis");
  // At the plot's own precision, as its axis and caption print it; the exact
  // values are the editor's and the export note's (PM9 UI-31).
  const format = (value: number) => (port.axis === "mz" ? formatMz(value) : value.toFixed(4));
  const id = `plot-range-${port.axis}`;
  const close = () => { setDraft(null); setProblem(null); if (details.current) details.current.open = false; summary.current?.focus(); };
  const focusPlot = () => root.current?.parentElement?.querySelector<SVGSVGElement>('svg[role="img"]')?.focus({ preventScroll: true });
  return <div className="plot-range-actions" ref={root}>
    {/* The plot's caption prints the range on screen, a gesture's included.
        This line says what is pending or committed: a pending band's bounds,
        else "full range" while nothing narrower is committed and "part of the
        full range" once a range is. The owners store the whole run or
        spectrum as no commit, so a committed range is always a proper part of
        it, and neither committed sentence claims to be the range on screen:
        both stay true before, during and after a wheel or drag (PM9 UI-34).
        The line follows the pending band and the committed range, never a
        gesture's range: a gesture's frames and its abandonment change nothing
        here, and neither does its start unless that start discards a pending
        band (the owners' rule), after which the line reports the committed
        range. A gesture's commit is announced once, when it settles. The
        committed bounds are announced rather than printed, so the caption's
        numbers are not repeated at rest; the hidden part brings its own
        separator. Atomic, so a reader hears the whole line, not only the
        numbers that changed. Not printed only while nothing is pending and
        nothing narrower than the full range is committed: there the caption's
        "Showing ... (full range)" already says it, so the sentence is announced
        but not shown. A committed part is printed, because a current-range
        export takes it (PM9 UI-34). The element stays mounted either way, so
        the live region is watched before its text changes. */}
    <p className={`plot-committed-range${pending === null && current.committed === null ? " visually-hidden" : ""}`} aria-live="polite" aria-atomic="true">{pending !== null
      ? t("rangePending", { name: axis, low: format(pending.domain.low), high: format(pending.domain.high) })
      : current.committed === null
        ? t("rangeCommittedFull", { name: axis })
        : <>{t("rangeCommittedPart", { name: axis })}<span className="visually-hidden">{t("rangeCommittedBounds", {
          low: format(current.committed.low), high: format(current.committed.high) })}</span></>}</p>
    {pending === null ? null : <div className="plot-pending-actions">
      <button type="button" className="secondary-button" onClick={() => { port.confirm(pending); focusPlot(); }}
        aria-label={t("rangeConfirmContext", { name: axis, low: format(pending.domain.low), high: format(pending.domain.high) })}>
        {t("rangeConfirm")}
      </button>
      <button type="button" className="secondary-button" onClick={() => { port.cancel(pending.transaction); focusPlot(); }}>{t("rangeCancel")}</button>
    </div>}
    <details className="plot-range-editor" ref={details} onToggle={event => {
      if (!event.currentTarget.open) { setDraft(null); setProblem(null); }
    }}>
      <summary ref={summary} onClick={() => {
        if (!details.current?.open) {
          const context = port.current();
          if (context) { const range = context.committed ?? context.full;
            setDraft({ context, low: String(range.low), high: String(range.high) }); setProblem(null); }
        }
      }}>{t("rangeEdit", { name: axis })}</summary>
      {draft === null ? null : <form className="plot-range-form" onCompositionStartCapture={() => { composing.current = true; }}
        onCompositionEndCapture={() => { composing.current = false; }} onKeyDown={event => {
          if (event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === "Enter" && event.repeat) event.preventDefault();
        }} onSubmit={event => {
          event.preventDefault(); if (composing.current) return;
          const now = port.current();
          if (now === null || now.source !== draft.context.source || now.revision !== draft.context.revision ||
            now.instruction !== draft.context.instruction || !sameRange(now.committed, draft.context.committed)) { setProblem("rangeStale"); return; }
          const result = validateRangeDraft(draft.low, draft.high, now.full);
          if (!result.valid) { setProblem(result.reason); return; }
          port.apply(port.domain(result.low, result.high)); close();
        }}>
        <label id={`${id}-low-label`} htmlFor={`${id}-low`}>{t("rangeLow")}</label>
        <RawTextField id={`${id}-low`} labelledBy={`${id}-low-label`} describedBy={`${id}-problem`} inputMode="decimal"
          invalid={problem !== null} value={draft.low} onChange={low => setDraft({ ...draft, low })} />
        <label id={`${id}-high-label`} htmlFor={`${id}-high`}>{t("rangeHigh")}</label>
        <RawTextField id={`${id}-high`} labelledBy={`${id}-high-label`} describedBy={`${id}-problem`} inputMode="decimal"
          invalid={problem !== null} value={draft.high} onChange={high => setDraft({ ...draft, high })} />
        <button type="submit" className="secondary-button" disabled={!usableRange(current.full)}>{t("rangeApply")}</button>
        <button type="button" className="secondary-button" onClick={close}>{t("rangeCancel")}</button>
        <p id={`${id}-problem`} aria-live="polite">{problem === null ? t("rangeGrammar") : t(problem)}</p>
      </form>}
    </details>
    <details className="plot-gesture-help"><summary>{t("rangeHelp")}</summary><p>{t("rangeHelpText")}</p></details>
  </div>;
}
