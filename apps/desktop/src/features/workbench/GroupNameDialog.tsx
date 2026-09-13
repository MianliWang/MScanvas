import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";

export function GroupNameDialog({ name, rename, returnTo, onSave, onClose }: {
  readonly name: string; readonly rename: boolean; readonly returnTo: HTMLElement | null; readonly onSave: (name: string) => void; readonly onClose: () => void;
}) {
  const t = useUiMessages();
  const [draft, setDraft] = useState(name);
  const composing = useRef(false);
  const content = useRef<HTMLDivElement | null>(null);
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="settings-overlay" /><Dialog.Content className="group-name-dialog" ref={node => { if (node !== null) content.current = node; }} onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {
      event.preventDefault();
      const active = document.activeElement;
      if (document.hasFocus() && (active === document.body || active === returnTo || (active !== null && content.current?.contains(active))) && returnTo?.isConnected && !returnTo.closest("[hidden]")) returnTo.focus();
    }} onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}
      onEscapeKeyDown={event => { event.stopImmediatePropagation(); if (composing.current || event.isComposing || event.keyCode === 229) event.preventDefault(); }}
      onKeyDownCapture={event => { if ((composing.current || event.nativeEvent.isComposing || event.keyCode === 229) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); } }}>
      <Dialog.Title>{t(rename ? "renameGroup" : "newGroup")}</Dialog.Title>
      <Dialog.Description>{t("groupNameHelp")}</Dialog.Description>
      <form onSubmit={event => { event.preventDefault(); if (draft.trim() && draft.length <= 120) onSave(draft); }}>
        <label htmlFor="organization-group-name">{t("groupName")}</label>
        <input id="organization-group-name" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) { event.stopPropagation(); if (event.key === "Enter") event.preventDefault(); } }} maxLength={120} />
        <div className="group-dialog-actions"><Dialog.Close asChild><button type="button" className="secondary-button">{t("cancel")}</button></Dialog.Close>
          <button type="submit" className="primary-button" disabled={!draft.trim() || draft.length > 120}>{t("saveGroup")}</button></div>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
