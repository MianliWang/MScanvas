import { useId, useLayoutEffect, useRef, useState } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";

/** The running initiating control survives its native picker and guards repeats. */
export function QuickFigureActions({ busy, figureUnavailable, pngUnavailable, onPreview, onPng, onCopy, context, quickVisible = true }: {
  readonly busy: boolean; readonly figureUnavailable: boolean; readonly pngUnavailable: boolean;
  readonly onPreview: () => void; readonly onPng: () => void; readonly onCopy: () => void;
  /** What the actions produce -- plot, range, size -- one part each. The plot is named, not printed. */
  readonly context: readonly string[];
  readonly quickVisible?: boolean;
}) {
  const t = useUiMessages();
  const id = useId();
  const [active, setActive] = useState<"png" | "copy" | null>(null);
  const claimed = useRef(false);
  useLayoutEffect(() => {
    // A synchronous refusal or completion may never paint a busy state.
    if (!busy && active !== null) { claimed.current = false; setActive(null); }
  }, [busy, active]);
  const run = (operation: "png" | "copy") => {
    if (busy || claimed.current || figureUnavailable || (operation === "png" && pngUnavailable)) return;
    claimed.current = true; setActive(operation);
    if (operation === "png") onPng(); else onCopy();
  };
  // The caption comes first: it names what the actions produce, and sits before
  // them on their line rather than under them. The plot's name is the panel
  // heading's, so it is spoken in the group's name and not printed again.
  return <div className="figure-quick-group" role="group" aria-label={context.join(" · ")}>
    <p className="figure-quick-context" id={id}>{context.slice(1).map((part, index) => <span key={index}>
      {/* The separator stays with the part before it. */}
      {index === 0 ? null : "\u00a0· "}<span className="figure-quick-part">{part}</span>
    </span>)}</p>
    <div className="figure-quick-actions" aria-describedby={id}>
    <button type="button" className="secondary-button" onClick={onPreview}>{t("figureExportTitle")}</button>
    {quickVisible ? <><button type="button" className="secondary-button" disabled={figureUnavailable || pngUnavailable || (busy && active !== "png")}
      aria-describedby={id} aria-disabled={busy || undefined} onClick={() => run("png")}>{active === "png" && busy ? t("viewerExporting", { name: "PNG" }) : t("figureQuickPng")}</button>
    <button type="button" className="secondary-button" disabled={figureUnavailable || (busy && active !== "copy")}
      aria-describedby={id} aria-disabled={busy || undefined} onClick={() => run("copy")}>{t(active === "copy" && busy ? "viewerCopying" : "viewerCopy")}</button></> : null}
    </div>
  </div>;
}
