import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState } from "react";

import { SettingField } from "../../components/fields/SettingField";
import { Button, Icon, SegmentedControl } from "../../components/ui";
import { SESSION_DEFAULTS } from "./sessionPreferences";
import { useSessionPreferences, useUiMessages } from "./SessionPreferencesProvider";
import {
  explainStoredProblem,
  explainUnavailableProblem,
  explainWriteProblem,
} from "./storageMessages";

/**
 * The only Settings entry and modal; Radix stays behind this owned surface.
 *
 * Settings apply immediately (GOALS D4, direction A 2.6): each choice is shown
 * and saved as it is made, so the dialog has one Close and no Apply or Cancel.
 * A failed save says so in place, with Try again beside it.
 */
export function SettingsDialog() {
  const preferences = useSessionPreferences();
  const message = useUiMessages();
  const languageId = useId();
  const densityId = useId();
  const layoutId = useId();
  const problemId = useId();
  const noteId = useId();
  const resetId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const composing = useRef(false);
  const returnPending = useRef(false);
  const returnSuperseded = useRef(false);
  const mounted = useRef(true);
  /** The block a failed or refused save renders, so the keyboard can be given to it. */
  const failureRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const { storage, save, panels, effective } = preferences;
  const saving = save.status === "saving";
  const hydrating = storage.status === "loading";
  /**
   * Why a choice cannot be made right now, as the id of the visible block that
   * says so: a resource problem, or the footer note while the stored record is
   * read. The choices stay focusable (B4).
   */
  const choiceReason = preferences.problem !== null ? problemId : hydrating ? noteId : undefined;
  const atDefaults = effective.locale === SESSION_DEFAULTS.locale && effective.density === SESSION_DEFAULTS.density;
  const resetRefusal = hydrating ? message("storageLoading") : atDefaults ? message("settingsAlreadyDefault") : null;
  /** Reset layout acts on the panels, refused while the record is read or already the default. */
  const layoutResettable = panels.requested.roster !== "automatic" || panels.requested.details !== "automatic";
  const layoutRefusal = panels.busy ? message("panelsLoading")
    : layoutResettable ? undefined : message("layoutNothingToReset");

  useEffect(() => {
    mounted.current = true;
    const recordDestination = (event: FocusEvent) => {
      if (returnPending.current && event.target instanceof HTMLElement &&
        event.target !== document.body && event.target !== opener.current &&
        !content.current?.contains(event.target)) returnSuperseded.current = true;
    };
    document.addEventListener("focusin", recordDestination);
    return () => { mounted.current = false; document.removeEventListener("focusin", recordDestination); };
  }, []);

  useEffect(() => {
    // The keyboard goes to the explanation, which is where the recovery
    // actions are. Only from the body: a reader who has since moved keeps
    // their place.
    if (save.status === "failed" || save.status === "storedRecordUnusable") {
      const active = document.activeElement;
      if (active === null || active === document.body) failureRef.current?.focus({ preventScroll: true });
    }
  }, [save.status]);

  const close = () => {
    // A write in flight settles on its own; its reply is still adopted.
    // A change whose write failed or was refused (an unusable stored record,
    // left untouched) stays this session's, and is said to be.
    if (save.status === "failed" || save.status === "storedRecordUnusable") preferences.useForThisSession();
    else if (preferences.state.draft !== null && !saving) preferences.discard();
    returnPending.current = true;
    returnSuperseded.current = false;
    setOpen(false);
  };
  const choose = (next: typeof effective) => {
    if (choiceReason !== undefined) return;
    preferences.change(next);
  };
  const refusedOption = choiceReason !== undefined;

  return <Dialog.Root open={open} onOpenChange={(next) => {
    if (next) { preferences.open(); setOpen(true); return; }
    // Escape and the Close button both route here.
    close();
  }}>
    <Dialog.Trigger asChild>
      <Button variant="quiet" size="sm" icon={<Icon name="settings" />} className="settings-entry" ref={opener} data-settings-entry="">
        {message("settingsEntry")}
      </Button>
    </Dialog.Trigger>
    <p aria-live="polite" className="visually-hidden" data-live-region="preferences">
      {preferences.announcement === null ? "" : message(preferences.announcement)}
    </p>
    <Dialog.Portal>
      <Dialog.Overlay className="settings-overlay" />
      <Dialog.Content className="settings-dialog" data-settings-dialog="" aria-describedby={undefined}
        ref={(node) => { if (node !== null) content.current = node; }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          composing.current = false;
          returnPending.current = false;
          // The current value, so the keyboard starts where the reader's
          // attention is.
          const checked = content.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]');
          if (checked !== null && checked !== undefined) checked.focus();
          else content.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnPending.current = false;
          if (!mounted.current || returnSuperseded.current || !document.hasFocus()) return;
          const active = document.activeElement;
          // Radix schedules return after unmount. Do not overwrite a later
          // deliberate move or take focus away from a native window.
          if (active !== null && active !== document.body && active !== opener.current &&
            !content.current?.contains(active)) return;
          const target = opener.current?.isConnected && !opener.current.disabled
            ? opener.current : document.querySelector<HTMLElement>("[data-settings-return-target]");
          target?.focus();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onCompositionStartCapture={() => { composing.current = true; }}
        onCompositionEndCapture={() => { composing.current = false; }}
        onKeyDownCapture={(event) => {
          if ((composing.current || event.nativeEvent.isComposing || event.keyCode === 229) && event.key === "Enter") {
            event.preventDefault(); event.stopPropagation();
          }
        }}
        onEscapeKeyDown={(event) => {
          // This callback runs in Radix's document capture listener, before
          // React's field handlers. The dialog owns Escape, including IME.
          event.stopImmediatePropagation();
          if (composing.current || event.isComposing || event.keyCode === 229) event.preventDefault();
        }}>
        <header className="settings-dialog-header">
          <Dialog.Title>{message("settings")}</Dialog.Title>
        </header>
        <div className="settings-dialog-body">
          <div className="settings-fields">
            <h3 className="settings-section-title">{message("appearance")}</h3>
            {/* `data-setting-value` names each option for the e2e drivers, which
                cannot select a segment by a localized label. Refused, not
                disabled, while the stored record is read (B4). */}
            <SettingField labelId={languageId} label={message("language")}>
              <SegmentedControl labelledBy={languageId} value={effective.locale} reasonId={choiceReason}
                options={[{ value: "en", refused: refusedOption, label: <span data-setting-value="en">{message("english")}</span> },
                  { value: "zh-CN", refused: refusedOption, label: <span data-setting-value="zh-CN">{message("simplifiedChinese")}</span> }]}
                onChange={(locale) => choose({ ...effective, locale })} />
            </SettingField>
            <SettingField labelId={densityId} label={message("density")}>
              <SegmentedControl labelledBy={densityId} value={effective.density} reasonId={choiceReason}
                options={[{ value: "comfortable", refused: refusedOption, label: <span data-setting-value="comfortable">{message("comfortable")}</span> },
                  { value: "compact", refused: refusedOption, label: <span data-setting-value="compact">{message("compact")}</span> }]}
                onChange={(density) => choose({ ...effective, density })} />
            </SettingField>
            <h3 className="settings-section-title">{message("layoutSection")}</h3>
            <SettingField labelId={layoutId} label={message("layoutPanels")} help={layoutRefusal}>
              <Button size="sm" data-layout-reset="" refused={layoutRefusal !== undefined} reasonId={`${layoutId}-help`}
                onClick={panels.reset}>{message("layoutReset")}</Button>
            </SettingField>
            {/* The shell's layout region is aria-hidden behind this modal, so
                the dialog says it here. Mounted empty, so the change is heard. */}
            <p aria-live="polite" className="visually-hidden" data-live-region="settings-layout">
              {panels.announcement === "reset" ? message("layoutResetDone") : ""}
            </p>
            {preferences.problem === null ? null : <div className="settings-resource-error" role="alert" id={problemId}>
              <p>{message("resourceError")}</p>
              <p>{message("resourceCode", { code: preferences.problem.code })}</p>
              <Button size="sm" onClick={preferences.recover}>{message("recover")}</Button>
            </div>}
            {/* The stored record is not this build's and has been left exactly
                as found. Replacing it is the user's to confirm, and it is the
                only thing that overwrites it. */}
            {storage.status === "unusable" ? <div className="settings-storage-problem" role="alert" data-stored-record="unusable">
              <p><strong>{message("storedUnusableTitle")}</strong></p>
              <p>{explainStoredProblem(storage.problem, message)}</p>
              <p>{message("storedUnusableBody")}</p>
              <Button size="sm" data-stored-replace="" refused={saving} reasonId={noteId} onClick={() => { if (!saving) preferences.replaceStoredRecord(); }}>
                {message("storedReplace")}
              </Button>
            </div> : null}
            {storage.status === "unavailable" ? <div className="settings-storage-note" role="status" data-storage="unavailable">
              <p>{message("storageUnavailable")}</p>
              <p>{explainUnavailableProblem(storage.problem, message)}</p>
            </div> : null}
            {storage.status === "readFailed" ? <div className="settings-storage-note" role="status" data-storage="read-failed">
              <p>{explainUnavailableProblem(storage.problem, message)}</p>
              <p>{message("storageReadFailedNote")}</p>
            </div> : null}
            {/* Every outcome a save can have, each said once, in place, with
                its retry beside it. */}
            {save.status === "failed" ? <div className="settings-storage-problem" role="alert" data-save="failed" ref={failureRef} tabIndex={-1}>
              <p><strong>{message(save.problem === "notConfirmed" ? "saveUncertainTitle" : "saveFailedTitle")}</strong></p>
              <p>{explainWriteProblem(save.problem, message)}</p>
              {save.temporaryLeftBehind ? <p>{message("saveTemporaryLeftBehind")}</p> : null}
              <p>{message(save.problem === "notConfirmed" ? "saveUncertainKeeps" : "saveFailedKeeps")}</p>
              <div className="settings-storage-actions">
                {save.retryable ? <Button size="sm" data-save-retry="" onClick={preferences.retrySave}>
                  {message("saveRetry")}
                </Button> : null}
                <Button size="sm" data-save-session-only="" onClick={preferences.useForThisSession}>
                  {message("saveSessionOnly")}
                </Button>
              </div>
            </div> : null}
            {save.status === "storedRecordUnusable" ? <div className="settings-storage-problem" role="alert" data-save="refused" ref={failureRef} tabIndex={-1}>
              <p><strong>{message("saveRefusedTitle")}</strong></p>
              <p>{explainStoredProblem(save.problem, message)}</p>
              <p>{message("storedUnusableBody")}</p>
            </div> : null}
          </div>
        </div>
        <footer className="settings-dialog-footer">
          {/* The durability note, which has to agree with the blocks above it. */}
          <p id={noteId} data-storage-note="">{
            saving ? message("savePending")
              : save.sessionOnly ? message("sessionOnlyNote")
                : hydrating ? message("storageLoading")
                  : save.status === "failed" || save.status === "storedRecordUnusable" ? message("storageNotSaving")
                    : storage.status === "unavailable" || save.status === "unavailable" ? message("storageSessionOnly")
                      : storage.status === "unusable" || storage.status === "readFailed" ? message("storageNotSaving")
                        : ""
          }</p>
          <div className="settings-dialog-actions">
            <Button variant="secondary" data-settings-reset="" refused={resetRefusal !== null} reasonId={hydrating ? noteId : resetId}
              onClick={() => { if (resetRefusal === null) choose({ ...SESSION_DEFAULTS }); }}>{message("reset")}</Button>
            {resetRefusal === null || hydrating ? null : <span className="settings-reset-reason" id={resetId}>{resetRefusal}</span>}
            <Dialog.Close asChild><Button data-settings-close="">{message("close")}</Button></Dialog.Close>
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
