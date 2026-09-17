import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef } from "react";

import { ChoiceField } from "../../components/fields/ChoiceField";
import { SettingField } from "../../components/fields/SettingField";
import { useSessionPreferences, useUiMessages } from "./SessionPreferencesProvider";
import {
  explainStoredProblem,
  explainUnavailableProblem,
  explainWriteProblem,
} from "./storageMessages";

/** The only Settings entry and modal; Radix stays behind this owned surface. */
export function SettingsDialog({ rowCount }: { readonly rowCount: number }) {
  const preferences = useSessionPreferences();
  const message = useUiMessages();
  const languageId = useId();
  const densityId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const composing = useRef(false);
  const returnPending = useRef(false);
  const returnSuperseded = useRef(false);
  const mounted = useRef(true);
  const open = preferences.state.draft !== null;
  const { storage, save } = preferences;
  /**
   * Whether one apply is in flight.
   *
   * While it is, every action that would change what is being published is
   * frozen and Apply itself is inert, so a second activation cannot dispatch a
   * second write of a snapshot the first is already publishing. Cancel is
   * frozen too, deliberately: once the bytes are on their way, a button that
   * looked like it could call them back would be a lie about disk.
   */
  const saving = save.status === "saving";
  const hydrating = storage.status === "loading";
  const frozen = saving || hydrating;

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
    // An apply that did not close the dialog has nothing pending. Cleared here
    // rather than left set, so a later real close still returns the keyboard.
    if (save.status === "failed" || save.status === "storedRecordUnusable" || save.status === "unavailable") {
      returnPending.current = false;
      returnSuperseded.current = false;
    }
  }, [save.status]);

  function closeWith(action: () => void) {
    returnPending.current = true;
    returnSuperseded.current = false;
    action();
  }

  return <Dialog.Root open={open} onOpenChange={(next) => {
    if (next) { preferences.open(); return; }
    // Escape, the close control and the overlay all route here. A publish in
    // flight is not cancellable, so the dialog stays until it settles.
    if (!saving) closeWith(preferences.discard);
  }}>
    <Dialog.Trigger asChild>
      <button className="secondary-button settings-entry" ref={opener} type="button" data-settings-entry="">
        {message("settings")}
      </button>
    </Dialog.Trigger>
    <p aria-live="polite" className="visually-hidden" data-live-region="preferences">
      {preferences.announcement === null ? "" : message(preferences.announcement)}
    </p>
    <Dialog.Portal>
      <Dialog.Overlay className="settings-overlay" />
      <Dialog.Content className="settings-dialog" data-settings-dialog=""
        ref={(node) => { if (node !== null) content.current = node; }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          composing.current = false;
          returnPending.current = false;
          content.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
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
          // A publish in flight cannot be recalled, so Escape does not pretend
          // to. The dialog reports the outcome instead.
          if (saving) event.preventDefault();
        }}>
        <header className="settings-dialog-header">
          <div>
            <Dialog.Title>{message("settings")}</Dialog.Title>
            <Dialog.Description>{message("description")}</Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button className="settings-close" type="button" disabled={saving} aria-label={message("close")}>
              <span aria-hidden="true">×</span>
            </button>
          </Dialog.Close>
        </header>
        <div className="settings-dialog-body">
          <div className="settings-category">
            <strong>{message("appearance")}</strong>
            <span>{message("appearanceHelp")}</span>
          </div>
          <div className="settings-fields">
            <SettingField labelId={languageId} label={message("language")} help={message("languageHelp")}>
              <ChoiceField labelledBy={languageId} describedBy={`${languageId}-help`} value={preferences.effective.locale}
                disabled={frozen}
                options={[{ value: "en", label: message("english") }, { value: "zh-CN", label: message("simplifiedChinese") }]}
                onChange={(locale) => preferences.preview({ ...preferences.effective, locale })} />
            </SettingField>
            <SettingField labelId={densityId} label={message("density")} help={message("densityHelp")}>
              <ChoiceField labelledBy={densityId} describedBy={`${densityId}-help`} value={preferences.effective.density}
                disabled={frozen}
                options={[{ value: "comfortable", label: message("comfortable") }, { value: "compact", label: message("compact") }]}
                onChange={(density) => preferences.preview({ ...preferences.effective, density })} />
              <p className="setting-field-help" data-density-row-count="">{message("rosterRows", { count: rowCount })}</p>
            </SettingField>
            {preferences.problem === null ? null : <div className="settings-resource-error" role="alert">
              <p>{message("resourceError")}</p>
              <p>{message("resourceCode", { code: preferences.problem.code })}</p>
              <button type="button" className="secondary-button" onClick={preferences.recover}>{message("recover")}</button>
            </div>}
            {/* The stored record is not this build's and has been left exactly
                as found. Replacing it is the user's to confirm, and it is the
                only thing that overwrites it -- nothing about reading,
                cancelling or resizing does. */}
            {storage.status === "unusable" ? <div className="settings-storage-problem" role="alert" data-stored-record="unusable">
              <p><strong>{message("storedUnusableTitle")}</strong></p>
              <p>{explainStoredProblem(storage.problem, message)}</p>
              <p>{message("storedUnusableBody")}</p>
              <button type="button" className="secondary-button" data-stored-replace="" disabled={frozen} onClick={preferences.replaceStoredRecord}>
                {message("storedReplace")}
              </button>
            </div> : null}
            {/* Nothing is wrong with the workspace, and nothing is claimed about
                disk. Reported as a status rather than an alert for that reason. */}
            {storage.status === "unavailable" ? <div className="settings-storage-note" role="status" data-storage="unavailable">
              <p>{message("storageUnavailable")}</p>
              <p>{explainUnavailableProblem(storage.problem, message)}</p>
            </div> : null}
            {save.status === "failed" ? <div className="settings-storage-problem" role="alert" data-save="failed">
              <p><strong>{message("saveFailedTitle")}</strong></p>
              <p>{explainWriteProblem(save.problem, message)}</p>
              {save.temporaryLeftBehind ? <p>{message("saveTemporaryLeftBehind")}</p> : null}
              <p>{message("saveFailedKeeps")}</p>
              <div className="settings-storage-actions">
                {save.retryable ? <button type="button" className="secondary-button" data-save-retry="" onClick={preferences.retrySave}>
                  {message("saveRetry")}
                </button> : null}
                {/* Named, not a silent fallback, and it claims no write: what it
                    says is that a restart still uses the last saved record. */}
                <button type="button" className="secondary-button" data-save-session-only="" onClick={preferences.useForThisSession}>
                  {message("saveSessionOnly")}
                </button>
              </div>
            </div> : null}
          </div>
        </div>
        <footer className="settings-dialog-footer">
          <p data-storage-note="">{
            save.sessionOnly ? message("sessionOnlyNote")
              : hydrating ? message("storageLoading")
                : storage.status === "unavailable" ? message("storageSessionOnly")
                  : message("storageSaved")
          }</p>
          <div className="settings-dialog-actions">
            <button className="secondary-button settings-reset" type="button" disabled={frozen} onClick={preferences.reset}>{message("reset")}</button>
            <Dialog.Close asChild><button className="secondary-button" type="button" disabled={saving}>{message("cancel")}</button></Dialog.Close>
            {/* Inert while a publish is in flight, so a second activation --
                pointer, keyboard or both -- cannot dispatch a second write. */}
            <button className="primary-button" type="button" aria-busy={saving || undefined}
              disabled={preferences.problem !== null || frozen}
              onClick={() => closeWith(preferences.apply)}>
              {saving ? message("savePending") : message("apply")}
            </button>
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
