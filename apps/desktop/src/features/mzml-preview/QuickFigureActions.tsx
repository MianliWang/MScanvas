import * as Menu from "@radix-ui/react-dropdown-menu";
import { useLayoutEffect, useRef, useState } from "react";
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
  readonly disabled?: boolean;
  /** Why the item is closed, printed inside it so it is read with its name. */
  readonly reason?: string | null;
  /** The item opens a dialog, which takes focus from the closing menu. */
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
 * A plot head's figure actions: Export… (the figure dialog), PNG, Copy and ⋯.
 * The running initiating control survives its native picker and guards repeats.
 */
export function QuickFigureActions({ busy, figureUnavailable, pngUnavailable, reasonId, onPreview, onPng, onCopy, menuItems }: {
  readonly busy: boolean; readonly figureUnavailable: boolean; readonly pngUnavailable: boolean;
  /** The visible line that says why PNG or Copy is refused, while one is. */
  readonly reasonId?: string;
  readonly onPreview: () => void; readonly onPng: () => void; readonly onCopy: () => void;
  readonly menuItems: readonly PlotMenuItem[];
}) {
  const t = useUiMessages();
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
  return <div className="figure-quick-actions">
    <Button size="sm" icon={<Icon name="download" />} aria-label={t("figureExportTitle")} onClick={onPreview}>{t("plotExport")}</Button>
    <Button size="sm" variant="quiet" refused={busy || figureUnavailable || pngUnavailable} reasonId={reasonId}
      aria-label={active === "png" && busy ? t("viewerExporting", { name: "PNG" }) : t("figureQuickPng")} onClick={() => run("png")}>PNG</Button>
    <IconButton size="sm" icon={<Icon name="copy" />} refused={busy || figureUnavailable} reasonId={reasonId}
      label={t(active === "copy" && busy ? "viewerCopying" : "viewerCopy")} onClick={() => run("copy")} />
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton ref={trigger} size="sm" icon={<Icon name="more" />} label={t("plotMoreExports")} />
      </Menu.Trigger>
      <Menu.Portal><Menu.Content className="roster-menu" sideOffset={4} align="end" onCloseAutoFocus={event => {
        if (openingDialog.current) { event.preventDefault(); openingDialog.current = false; }
      }}>
        {menuItems.map(item => <Menu.Item key={item.key} disabled={item.disabled} onSelect={() => {
          if (item.opensDialog) openingDialog.current = true;
          item.onSelect(trigger.current);
        }}>{item.label}{item.reason ? <span className="plot-menu-reason">{item.reason}</span> : null}</Menu.Item>)}
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </div>;
}
