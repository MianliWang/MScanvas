import type { ReactElement } from "react";

import type { NotVerifiedByMscanvas } from "./contracts";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";

/**
 * The label from a plan row's or a report's two fields, or `null` for a
 * verified conversion. An absent field is not a claim of verification; it is
 * only a fixture that predates the field.
 */
export function notVerifiedOf(item: {
  readonly unverifiedSettings?: boolean;
  readonly unverifiedBuildRelease?: string | null;
}): NotVerifiedByMscanvas | null {
  const unverifiedSettings = item.unverifiedSettings === true;
  const unverifiedBuildRelease = item.unverifiedBuildRelease ?? null;
  return unverifiedSettings || unverifiedBuildRelease !== null ? { unverifiedSettings, unverifiedBuildRelease } : null;
}

/** ADR 0055's one label, naming the build where the build is why. */
export function notVerifiedText(label: NotVerifiedByMscanvas, t: UiMessage): string {
  return label.unverifiedBuildRelease === null
    ? t("m74CnvNotVerified")
    : t("m74CnvNotVerifiedBuild", { release: label.unverifiedBuildRelease });
}

/** The label as a tag, or nothing for a verified conversion. */
export function NotVerifiedTag({ label, id }: {
  readonly label: NotVerifiedByMscanvas | null | undefined;
  readonly id?: string;
}): ReactElement | null {
  const t = useUiMessages();
  if (label == null) return null;
  return <span className="not-verified-tag" data-not-verified="" id={id}>{notVerifiedText(label, t)}</span>;
}
