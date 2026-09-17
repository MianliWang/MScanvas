import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef } from "react";

import { ChoiceField } from "../../components/fields/ChoiceField";
import { SettingField } from "../../components/fields/SettingField";
import { useSessionPreferences, useUiMessages } from "./SessionPreferencesProvider";

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

  function closeWith(action: () => void) {
    returnPending.current = true;
    returnSuperseded.current = false;
    action();
  }

  return <Dialog.Root open={open} onOpenChange={(next) => next ? preferences.open() : closeWith(preferences.discard)}>
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
        }}>
        <header className="settings-dialog-header">
          <div>
            <Dialog.Title>{message("settings")}</Dialog.Title>
            <Dialog.Description>{message("description")}</Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button className="settings-close" type="button" aria-label={message("close")}>
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
                options={[{ value: "en", label: message("english") }, { value: "zh-CN", label: message("simplifiedChinese") }]}
                onChange={(locale) => preferences.preview({ ...preferences.effective, locale })} />
            </SettingField>
            <SettingField labelId={densityId} label={message("density")} help={message("densityHelp")}>
              <ChoiceField labelledBy={densityId} describedBy={`${densityId}-help`} value={preferences.effective.density}
                options={[{ value: "comfortable", label: message("comfortable") }, { value: "compact", label: message("compact") }]}
                onChange={(density) => preferences.preview({ ...preferences.effective, density })} />
              <p className="setting-field-help" data-density-row-count="">{message("rosterRows", { count: rowCount })}</p>
            </SettingField>
            {preferences.problem === null ? null : <div className="settings-resource-error" role="alert">
              <p>{message("resourceError")}</p>
              <p>{message("resourceCode", { code: preferences.problem.code })}</p>
              <button type="button" className="secondary-button" onClick={preferences.recover}>{message("recover")}</button>
            </div>}
          </div>
        </div>
        <footer className="settings-dialog-footer">
          <p>{message("sessionOnly")}</p>
          <div className="settings-dialog-actions">
            <button className="secondary-button settings-reset" type="button" onClick={preferences.reset}>{message("reset")}</button>
            <Dialog.Close asChild><button className="secondary-button" type="button">{message("cancel")}</button></Dialog.Close>
            <button className="primary-button" type="button" disabled={preferences.problem !== null} onClick={() => closeWith(preferences.apply)}>{message("apply")}</button>
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
