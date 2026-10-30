import * as Menu from "@radix-ui/react-dropdown-menu";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button, Icon, IconButton } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";
import { figureProblemMessageKey, type FigureSettingProblem, type FigureSettingsValidation } from "./figureSettingsValidation";

/** One entry of a plot's ⋯ menu. */
export interface PlotMenuItem {
  readonly key: string;
  readonly label: string;
  /** Receives the ⋯ trigger, so a dialog opened from the menu returns focus to it. */
  readonly onSelect: (trigger: HTMLElement | null) => void;
  /** Refused, not disabled: it stays in the menu's arrow-key order with its reason. */
  readonly refused?: boolean;
  /** Why the item is closed, printed inside it and read as its description. */
  readonly reason?: string | null;
  /** Ids of other visible lines that describe the item, such as the menu note. */
  readonly describedBy?: string;
  /** The item moves focus somewhere of its own (a dialog, an editor), so the closing menu must not take it back. */
  readonly opensDialog?: boolean;
}

/**
 * Why a plot's PNG or Copy is refused, in the order the lane and the settings
 * refuse them, or `null`. A DPI problem refuses only PNG; its sentence is still
 * the one to show, because Copy then points at nothing.
 */
export function figureRefusal(t: UiMessage, busy: boolean, validation: FigureSettingsValidation, nothingDrawn = false): string | null {
  const problem = (value: FigureSettingProblem) => t(figureProblemMessageKey(value), { code: value.code });
  if (busy) return t("plotExportBusy");
  if (validation.render !== null) return problem(validation.render);
  if (nothingDrawn) return t("viewerTracesHidden");
  return validation.dpi === null ? null : problem(validation.dpi);
}

/**
 * A plot head's figure actions (direction A): Export… (the figure dialog) and
 * ⋯. The menu holds the plot's own items first (Set range…), then Quick PNG
 * and Copy plot, which repeat the current settings without the dialog, then the
 * data exports. A refused item says why inside itself. A running PNG or Copy
 * guards repeats until the lane frees.
 */
export function QuickFigureActions({ busy, figureUnavailable, pngUnavailable, reason, onPreview, onPng, onCopy, leadingItems = [], menuItems, menuNote }: {
  readonly busy: boolean; readonly figureUnavailable: boolean; readonly pngUnavailable: boolean;
  /** Why PNG or Copy is refused, while one is. */
  readonly reason?: string | null;
  readonly onPreview: () => void; readonly onPng: () => void; readonly onCopy: () => void;
  /** The plot's own items, above the figure items. */
  readonly leadingItems?: readonly PlotMenuItem[];
  readonly menuItems: readonly PlotMenuItem[];
  /** A line under the menu items that items can point at with `describedBy`. */
  readonly menuNote?: { readonly id: string; readonly text: string };
}) {
  const t = useUiMessages();
  const menuId = useId();
  const [active, setActive] = useState<"png" | "copy" | null>(null);
  const claimed = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const openingDialog = useRef(false);
  useLayoutEffect(() => {
    // A synchronous refusal or completion may never paint a busy state.
    if (!busy && active !== null) { claimed.current = false; setActive(null); }
  }, [busy, active]);
  const run = (operation: "png" | "copy") => {
    if (busy || claimed.current || figureUnavailable || (operation === "png" && pngUnavailable)) return;
    claimed.current = true; setActive(operation);
    if (operation === "png") onPng(); else onCopy();
  };
  const figureItems: PlotMenuItem[] = [
    { key: "png", label: active === "png" && busy ? t("viewerExporting", { name: "PNG" }) : t("figureQuickPng"),
      refused: busy || figureUnavailable || pngUnavailable, reason, onSelect: () => run("png") },
    { key: "copy", label: t(active === "copy" && busy ? "viewerCopying" : "viewerCopy"),
      refused: busy || figureUnavailable, reason: busy || figureUnavailable ? reason : null, onSelect: () => run("copy") },
  ];
  const groups = [leadingItems, figureItems, menuItems].filter(group => group.length > 0);
  return <div className="figure-quick-actions">
    <Button size="sm" icon={<Icon name="download" />} aria-label={t("figureExportTitle")} onClick={onPreview}>{t("plotExport")}</Button>
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton ref={trigger} size="sm" variant="secondary" icon={<Icon name="more" />} label={t("plotMoreExports")} />
      </Menu.Trigger>
      <Menu.Portal><Menu.Content className="roster-menu plot-menu" sideOffset={4} align="end" onCloseAutoFocus={event => {
        if (openingDialog.current) { event.preventDefault(); openingDialog.current = false; }
      }}>
        {groups.map((group, index) => <Menu.Group key={group[0]?.key ?? index}>
          {index === 0 ? null : <Menu.Separator />}
          {group.map(item => {
            const reasonId = item.reason ? `${menuId}-${item.key}-reason` : undefined;
            // Radix `disabled` would drop the item from the arrow-key order and
            // with it the reason, so a refused item is aria-disabled and its
            // selection is cancelled here, which also keeps the menu open on it.
            return <Menu.Item key={item.key} aria-disabled={item.refused || undefined}
              aria-describedby={[reasonId, item.describedBy].filter(Boolean).join(" ") || undefined}
              onSelect={event => {
                if (item.refused) { event.preventDefault(); return; }
                if (item.opensDialog) openingDialog.current = true;
                item.onSelect(trigger.current);
              }}>
              {item.label}
              {/* Read as the description, not as part of the name. */}
              {item.reason ? <span aria-hidden="true" className="plot-menu-reason" id={reasonId}>{item.reason}</span> : null}
            </Menu.Item>;
          })}
        </Menu.Group>)}
        {menuNote === undefined ? null : <><Menu.Separator />
          <Menu.Label className="plot-menu-note" id={menuNote.id}>{menuNote.text}</Menu.Label></>}
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </div>;
}
