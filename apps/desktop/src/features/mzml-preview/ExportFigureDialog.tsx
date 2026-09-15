import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { FigurePreviewKind, FigurePreviewOutcome, FigurePreviewQuestion, FigurePreviewRequest, FigureTheme } from "./contracts";
import { FigureSettingsFields } from "./FigureSettingsFields";
import { ownedErrorMessage } from "./ownedErrorMessages";
import type { FigureSettingsValidation } from "./figureSettingsValidation";
import type { FigureSettingsDraft, FigureSettingsField } from "./usePreviewWorkspace";

type PreviewState =
  | { readonly status: "none" | "loading" | "failed"; readonly key: string }
  | { readonly status: "answered"; readonly key: string; readonly answer: FigurePreviewOutcome };

export interface ExportFigureDialogProps {
  readonly kind: FigurePreviewKind;
  readonly sourceLabel: string;
  readonly question: FigurePreviewQuestion | null;
  readonly preview: (request: FigurePreviewRequest) => Promise<FigurePreviewOutcome>;
  readonly onExport: (question: FigurePreviewQuestion, format: "svg" | "png") => boolean;
  readonly onCopy: (question: FigurePreviewQuestion) => boolean;
  readonly onClose: () => void;
  readonly returnTo: HTMLElement | null;
  readonly busy: boolean;
  readonly result: ReactNode;
  readonly settings: FigureSettingsDraft;
  readonly validation: FigureSettingsValidation;
  readonly onSetting: (field: FigureSettingsField, value: string) => void;
  readonly onTheme: (theme: FigureTheme) => void;
  readonly scope: "current" | "full";
  readonly currentAvailable: boolean;
  readonly onScope: (scope: "current" | "full") => void;
  readonly scopeHelp: string;
}

/** One current question; old answers never grant a matching-preview action. */
export function ExportFigureDialog(props: ExportFigureDialogProps) {
  const t = useUiMessages();
  const id = useId();
  const questionKey = JSON.stringify(props.question);
  const source = props.question?.source;
  const sourceKey = source === undefined ? null : source.kind === "linked"
    ? JSON.stringify([source.kind, source.chromatogramToken, source.spectrumToken])
    : JSON.stringify([source.kind, source.token]);
  const [acceptedSource, setAcceptedSource] = useState(sourceKey);
  const sourceChanged = sourceKey !== null && acceptedSource !== null && sourceKey !== acceptedSource;
  const version = useRef({ questionKey, value: 0 });
  if (version.current.questionKey !== questionKey) version.current = { questionKey, value: version.current.value + 1 };
  const key = `${version.current.value}:${questionKey}`;
  const desired = useRef({ key, question: props.question });
  desired.current = { key, question: sourceChanged ? null : props.question };
  const [state, setState] = useState<PreviewState>({ status: "none", key: "" });
  const [refresh, setRefresh] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const live = useRef(true);
  const processing = useRef(false);
  const sequence = useRef(0);
  const dispatched = useRef(false);
  const content = useRef<HTMLDivElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  const renderer = useRef(props.preview);
  renderer.current = props.preview;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (acceptedSource === null && sourceKey !== null) setAcceptedSource(sourceKey); }, [acceptedSource, sourceKey]);
  useEffect(() => { if (!props.busy) dispatched.current = false; }, [props.busy]);
  useEffect(() => {
    if (processing.current) return;
    const drain = async () => {
      processing.current = true;
      try {
        while (live.current) {
          const next = desired.current;
          if (next.question === null) { setState({ status: "none", key: next.key }); break; }
          const requestId = ++sequence.current;
          setState({ status: "loading", key: next.key });
          try {
            const answer = await renderer.current({ ...next.question, requestId });
            if (!live.current) break;
            if (desired.current.key === next.key) {
              setState(answer.requestId === requestId ? { status: "answered", key: next.key, answer } : { status: "failed", key: next.key });
            }
          } catch {
            if (live.current && desired.current.key === next.key) setState({ status: "failed", key: next.key });
          }
          if (desired.current.key === next.key) break;
        }
      } finally { processing.current = false; }
    };
    void drain();
  }, [key, refresh, acceptedSource]);
  const artifact = !sourceChanged && state.status === "answered" && state.key === key && state.answer.status === "rendered" ? state.answer : null;
  useEffect(() => {
    if (artifact === null) { setImageUrl(null); return; }
    // Image context is inert: no innerHTML, object/embed, script, or DOM SVG.
    const url = URL.createObjectURL(new Blob([artifact.svg], { type: "image/svg+xml" }));
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artifact]);
  const stale = sourceChanged || state.key !== key;
  const error = !stale && state.status === "answered" && state.answer.status === "refused" ? state.answer.error : null;
  const status = sourceChanged ? t("figurePreviewSourceChanged") : stale ? t("figurePreviewStale") : state.status === "none" ? t("figurePreviewNone") : state.status === "loading" ? t("figurePreviewLoading") : state.status === "failed" ? t("figurePreviewFailed") : error ? ownedErrorMessage(error, t) : artifact?.empty ? t("figurePreviewEmpty") : t("figurePreviewCurrent");
  const save = (format: "svg" | "png") => {
    if (dispatched.current || props.busy || artifact === null || props.question === null || (format === "png" && props.validation.dpi !== null)) return;
    dispatched.current = props.onExport(props.question, format);
    if (!dispatched.current) setState({ status: "none", key: "" });
  };
  return <Dialog.Root open onOpenChange={open => { if (!open) props.onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="settings-overlay" />
      <Dialog.Content className="figure-export-dialog" ref={content}
        onOpenAutoFocus={event => { event.preventDefault(); close.current?.focus(); }}
        onCloseAutoFocus={event => {
          event.preventDefault(); const active = document.activeElement;
          if (document.hasFocus() && (active === document.body || active === props.returnTo || (active !== null && content.current?.contains(active))) && props.returnTo?.isConnected && !props.returnTo.closest("[hidden], [inert]")) props.returnTo.focus();
        }} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.stopImmediatePropagation()}>
        <header className="figure-export-header"><Dialog.Title>{t("figureExportTitle")}</Dialog.Title>
          <button ref={close} type="button" className="secondary-button" onClick={props.onClose}>{t("figureExportReturn")}</button></header>
        <Dialog.Description>{t("figurePreviewHelp")}</Dialog.Description>
        <p className="figure-export-source">{props.sourceLabel}</p>
        <div className="figure-export-body"><fieldset className="figure-export-options" disabled={sourceChanged}>
          <legend className="visually-hidden">{t("figure")}</legend>
          <fieldset><legend>{t(props.kind === "spectrum" ? "viewerExportScope" : "viewerExportRunScope")}</legend>
            {(["current", "full"] as const).map(scope => <label className="spectrum-figure-theme" key={scope}>
              <input type="radio" name={`${id}-scope`} checked={props.scope === scope} disabled={scope === "current" && !props.currentAvailable} onChange={() => props.onScope(scope)} />
              {t(scope === "current" ? "viewerExportCurrent" : props.kind === "spectrum" ? "viewerExportFull" : "viewerExportFullRun")}</label>)}
            <p>{props.scopeHelp}</p>
            {props.kind === "linked" ? <p>{t("viewerLinkedHelp")}</p> : null}
          </fieldset>
          <FigureSettingsFields idPrefix={`export-${id}`} settings={props.settings} validation={props.validation} onFigureSetting={(field, value) => { if (!sourceChanged) props.onSetting(field, value); }} onFigureTheme={theme => { if (!sourceChanged) props.onTheme(theme); }} />
        </fieldset><div className="figure-preview" aria-busy={state.status === "loading"}>
          {imageUrl && artifact ? <img src={imageUrl} alt={t("figurePreviewAlt")} data-spec-id={artifact.specId} width={artifact.width} height={artifact.height} /> : <div className="figure-preview-placeholder" aria-hidden="true" />}
          <p role="status">{status}</p>
          {error || state.status === "failed" || stale ? <button className="secondary-button" type="button" disabled={props.busy || processing.current} onClick={() => { if (sourceChanged) setAcceptedSource(sourceKey); setRefresh(value => value + 1); }}>{t(sourceChanged ? "figurePreviewUseSource" : "figurePreviewRefresh")}</button> : null}
        </div></div>
        <footer><div className="spectrum-export-actions">{(["svg", "png"] as const).map(format => <button type="button" className="primary-button" key={format}
          aria-disabled={props.busy || artifact === null || (format === "png" && props.validation.dpi !== null)}
          onClick={() => save(format)}>{t("viewerExportFormat", { name: format.toUpperCase() })}</button>)}
          <button type="button" className="secondary-button" aria-disabled={props.busy || artifact === null} onClick={() => {
            if (!dispatched.current && !props.busy && artifact !== null && props.question !== null) dispatched.current = props.onCopy(props.question);
          }}>{t("viewerCopy")}</button></div>
          <div className="figure-export-result">{props.result}</div></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
