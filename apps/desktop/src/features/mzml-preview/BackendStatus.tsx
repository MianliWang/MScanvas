import { useState } from "react";

import { Button, Disclosure } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { joinSentences } from "../preferences/i18n";
import { presentBackend, type BackendActionId } from "./backendPresentation";
import type { BackendState } from "./usePreviewWorkspace";

/** The busy sentence's id: the reason a refused action points at. */
const BUSY_ID = "backend-busy";

export interface BackendStatusProps {
  readonly state: BackendState;
  /**
   * Whether a backend request is outstanding, the folder picker included.
   *
   * Every action here starts one, and the two installation commands contend
   * for a single lock in Rust. Leaving them live would let a second act on a
   * verdict that is already being replaced, and would give no sign that the
   * first is still running once the picker's own dialog has closed.
   */
  readonly busy: boolean;
  /**
   * Whether the reading below has stopped describing this session.
   *
   * A projection can arrive from an operation that produced no
   * `BackendAvailabilityDto` -- a refused `BEGIN`, a queue poll, a settings
   * read -- so the authority moves and the reading does not. Between that
   * observation and the render that consumes it, this banner presents the
   * reading as superseded rather than as fact: it names no build as current,
   * and it loses none of the reason text it has (ledger row 110).
   *
   * **Entire, not just the verdict.** The release, the build date and the
   * origin describe a build as much as "available" does, so marking only the
   * verdict stale would leave the installation the session has left named as
   * the current one, which is exactly the half-fix that row exists for.
   */
  readonly readingSuperseded: boolean;
  readonly onRecheck: () => void;
  readonly onChooseInstallation: () => void;
  readonly onUseAutomaticDiscovery: () => void;
  /**
   * Folded to its reading alone, out of sight, because there is nothing to act
   * on (PM9 L10). The reading stays the one live region, so a verdict is still
   * announced; the actions and the help keep their nodes and are hidden, and
   * the status bar's toggle shows them again. Never set while the banner has
   * something to say.
   */
  readonly collapsed?: boolean;
  /** Called when the reader uses the banner, so it stays open for the outcome. */
  readonly onEngage?: () => void;
}

/**
 * The installed-backend banner, and the offline setup help beside it.
 *
 * MSCanvas never bundles, downloads or installs ProteoWizard, so "not
 * installed" is an ordinary state of the application rather than an error, and
 * it always says what the user can do about it.
 *
 * Every state offers a way back to automatic discovery, including the state
 * where the call itself failed. A chosen folder is the only place MSCanvas then
 * looks, so a banner without that offer can leave a session unable to reach an
 * installation it would have found on its own.
 *
 * The help is a disclosure in every state, closed to begin with, and it needs
 * no network, no dataset and no backend to read. It is deliberately not an
 * onboarding wizard: nothing here gates the workspace, and a session with no
 * usable backend can still add, group and organise acquisitions.
 */
export function BackendStatus({
  state,
  busy,
  readingSuperseded,
  onRecheck,
  onChooseInstallation,
  onUseAutomaticDiscovery,
  collapsed = false,
  onEngage,
}: BackendStatusProps) {
  const t = useUiMessages();
  const [helpOpen, setHelpOpen] = useState(false);
  const banner = presentBackend(state, readingSuperseded, t);

  const run: Record<BackendActionId, () => void> = {
    recheck: onRecheck,
    choose: onChooseInstallation,
    automatic: onUseAutomaticDiscovery,
  };

  const named = banner.names;
  // One banner element and one live region, for every state including
  // `checking`. Two branches returning different element types put a *new*
  // region in the document on each transition, already containing its text --
  // which is the one mutation a screen reader does not announce. So pressing
  // `Check again` used to be silent, and so was the verdict that followed it.
  // The setup-help disclosure keeps its identity for the same reason: a verdict
  // arriving on its own must not take a reader's place in the tab order. For
  // the same reason, focus anywhere in the banner counts as engaging it: a
  // quiet verdict does not fold a banner a reader is in. Focusable itself, but
  // outside the tab order, so the status bar can hand its place here when the
  // banner has something to say again.
  return (
    <div
      id="backend-status"
      tabIndex={-1}
      className={collapsed ? "visually-hidden" : `notice notice-${banner.tone}`}
      data-backend-status={banner.kind}
      data-backend-reading={banner.kind === "staleReading" ? "superseded" : undefined}
      data-backend-collapsed={collapsed ? "" : undefined}
      onFocus={() => onEngage?.()}
    >
      {/* One live region for the whole banner, so a verdict, its reason and the
          build it names are announced as one thing rather than as three. */}
      <div role="status" className="backend-status-reading">
        {/* A checking banner's title is already the reason its actions wait. */}
        <strong id={busy && banner.kind === "checking" ? BUSY_ID : undefined}>{banner.title}</strong>
        {/* One span, joined as the locale joins sentences: separate spans get
            the flex gap, which reads as a double space between Chinese ones. */}
        {banner.body.length === 0 ? null : <span>{joinSentences(t, banner.body)}</span>}
        {named === null ? null : (
          <span data-backend-build="">
            {[
              named.release,
              named.buildDate === null ? null : t("backendBuiltOn", { date: named.buildDate }),
              banner.separateInstallations ? t("backendSeparateInstallations") : null,
              banner.chosen ? t("backendFromChosenFolder") : null,
            ]
              .filter((part): part is string => part !== null)
              .join(" · ")}
          </span>
        )}
        {/* Said in the banner rather than left to the refused controls alone.
            The picker's dialog closes before the probes run, and without this
            the moment between reads as finished when it is not. It is the
            reason every action below points at. */}
        {busy && banner.kind !== "checking" ? <span id={BUSY_ID} data-backend-busy="">{t("backendCheckingInstallation")}</span> : null}
        {/* Shown only where this build had no sentence of its own for the code,
            so it stays inspectable instead of being paraphrased away. */}
        {banner.code !== null && banner.kind === "requestFailed" ? (
          <span data-backend-code="">{t("backendProblemCode", { code: banner.code })}</span>
        ) : null}
      </div>
      <div className="backend-status-actions" hidden={collapsed}>
        {banner.actions.map((entry, position) => (
          // Refused rather than disabled while a request runs (UI-24): the
          // keyboard stays on the action it pressed, through the native picker
          // and after it, and the busy sentence above says why it waits.
          <Button
            // The semantic id, not the position: React must not carry one
            // action's node over to another when a verdict changes which ones
            // are offered. The suffix separates the two `choose` offers a
            // chosen-but-unusable folder shows.
            key={`${entry.id}-${position}`}
            variant="secondary"
            size="sm"
            data-backend-action={entry.id}
            refused={busy}
            reasonId={BUSY_ID}
            onClick={() => {
              onEngage?.();
              run[entry.id]();
            }}
          >
            {entry.label}
          </Button>
        ))}
      </div>
      {/* The offline setup help, reachable in every state, including the
          states with no reading and no installation at all. It holds only
          what no control says: that ProteoWizard is theirs to install, which
          folder to choose and that it lasts for this session only, the support
          target and what needs a backend. */}
      <div className="backend-setup-help" hidden={collapsed}>
        <Disclosure
          variant="secondary"
          data-backend-help=""
          label={t("backendHelpTitle")}
          open={helpOpen}
          onOpenChange={(open) => {
            setHelpOpen(open);
            // Help opened while a check is running stays open when a quiet
            // verdict arrives, instead of folding away under the reader.
            if (open) onEngage?.();
          }}
          regionProps={{ className: "backend-setup-help-body" }}
        >
          <p>{t("backendHelpProvider")}</p>
          <p>{t("backendHelpSessionScope")}</p>
          <p>{t("backendHelpTarget")}</p>
          <p>{t("backendHelpWithoutBackend")}</p>
        </Disclosure>
      </div>
    </div>
  );
}
