import { useRef, useState } from "react";
import { RawTextField } from "../../components/fields/RawTextField";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
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
  const committed = current.committed ?? current.full;
  const id = `plot-range-${port.axis}`;
  const close = () => { setDraft(null); setProblem(null); if (details.current) details.current.open = false; summary.current?.focus(); };
  const focusPlot = () => root.current?.parentElement?.querySelector<SVGSVGElement>('svg[role="img"]')?.focus({ preventScroll: true });
  return <div className="plot-range-actions" ref={root}>
    <p className="plot-committed-range" aria-live="polite">{t(pending === null ? "rangeCommitted" : "rangePending", {
      name: axis, low: String((pending?.domain ?? committed).low), high: String((pending?.domain ?? committed).high),
    })}</p>
    {pending === null ? null : <div className="plot-pending-actions">
      <button type="button" className="secondary-button" onClick={() => { port.confirm(pending); focusPlot(); }}
        aria-label={t("rangeConfirmContext", { name: axis, low: String(pending.domain.low), high: String(pending.domain.high) })}>
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
