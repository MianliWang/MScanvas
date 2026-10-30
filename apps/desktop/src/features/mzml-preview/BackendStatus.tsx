import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button, Disclosure, Icon } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { joinSentences } from "../preferences/i18n";
import { STATUS_BACKEND_ID } from "../workbench/StatusBar";
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
   * observation and the render that consumes it, this presents the reading as
   * superseded rather than as fact: it names no build as current, and it
   * loses none of the reason text it has (ledger row 110).
   *
   * **Entire, not just the verdict.** The release, the build date and the
   * origin describe a build as much as "available" does, so marking only the
   * verdict stale would leave the installation the session has left named as
   * the current one, which is exactly the half-fix that row exists for.
   */
  readonly readingSuperseded: boolean;
  /** The conversion lane lost track of a process: nothing starts until a restart. */
  readonly laneQuarantined?: boolean;
  readonly onRecheck: () => void;
  readonly onChooseInstallation: () => void;
  readonly onUseAutomaticDiscovery: () => void;
  /** Opened from the status bar's ProteoWizard item: every detail and action. */
  readonly open?: boolean;
  /** Escape or a press outside. Escape also hands the keyboard back to the item. */
  readonly onClose?: () => void;
}

/**
 * The installed backend's details, and the offline setup help beside them.
 *
 * One element in every state, so it is one live region and its actions and
 * help keep their identity whatever the verdict (screen readers do not
 * announce a region that arrives with its text in it). What changes is how it
 * shows:
 *
 * - **hidden** while a usable backend leaves nothing to do: out of sight but
 *   still read, so a verdict is heard. The status bar's item says "ready".
 * - **notice** while no usable backend stands: one line in the main area with
 *   the one action that fixes it and the setup help (S4, S7).
 * - **popover** while opened from the status bar: the reading, the build, every
 *   way out and the help, over the bar.
 *
 * MSCanvas never bundles, downloads or installs ProteoWizard, so "not
 * installed" is an ordinary state of the application rather than an error, and
 * nothing here gates the workspace: a session with no usable backend can still
 * add, group and organise acquisitions.
 */
export function BackendStatus({
  state,
  busy,
  readingSuperseded,
  laneQuarantined = false,
  onRecheck,
  onChooseInstallation,
  onUseAutomaticDiscovery,
  open = false,
  onClose,
}: BackendStatusProps) {
  const t = useUiMessages();
  const [helpOpen, setHelpOpen] = useState(false);
  const banner = presentBackend(state, readingSuperseded, t, laneQuarantined);

  // A check, or a reading the session has left, is not a verdict: the surface
  // keeps what the last verdict put there. So pressing Check again on the
  // notice leaves the reader on the notice, refused with its reason, until the
  // answer arrives. Derived during render, React's way to remember a previous
  // value.
  const verdict = banner.notice === "transient" ? null : { notice: banner.notice === "notice", primary: banner.primary };
  const [last, setLast] = useState(verdict ?? { notice: false, primary: null as BackendActionId | null });
  if (verdict !== null && (verdict.notice !== last.notice || verdict.primary !== last.primary)) setLast(verdict);
  const shown = verdict ?? last;
  const mode = open ? "popover" : shown.notice ? "notice" : "hidden";
  // The notice offers its one fix, and keeps the action the reader last
  // pressed on it beside that fix: a verdict that changes the fix must not
  // take the keyboard's place away (the picker can fail, say).
  const [held, setHeld] = useState<BackendActionId | null>(null);
  if (mode !== "notice" && held !== null) setHeld(null);
  const lastOf = (id: BackendActionId | null) => banner.actions.findLastIndex((entry) => entry.id === id);
  const offered = mode === "notice" ? [lastOf(shown.primary), lastOf(held)] : null;

  const run: Record<BackendActionId, () => void> = {
    recheck: onRecheck,
    choose: onChooseInstallation,
    automatic: onUseAutomaticDiscovery,
  };

  const root = useRef<HTMLDivElement>(null);
  const backToItem = () => document.getElementById(STATUS_BACKEND_ID)?.focus();
  // Opened from the item at the window's foot, far from here in the document:
  // the keyboard comes along, or the details would be one Tab away from nowhere.
  useLayoutEffect(() => {
    if (open) root.current?.focus({ preventScroll: true });
  }, [open]);
  // A verdict that hides what the reader was on -- a success removes the
  // notice -- hands the keyboard to the item that now says it, never to the body.
  useLayoutEffect(() => {
    if (mode === "hidden" && root.current?.contains(document.activeElement)) backToItem();
  }, [mode]);
  // A press outside closes it. Never a blur: the native folder picker takes
  // the window's focus while its request is still this popover's.
  useEffect(() => {
    if (!open || onClose === undefined) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || document.getElementById(STATUS_BACKEND_ID)?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); };
  }, [open, onClose]);

  const named = banner.names;
  // Hidden from sight only in the one-line notice: the live region still reads
  // the whole verdict, and the popover shows it.
  const detail = mode === "notice" ? "visually-hidden" : undefined;
  return (
    <div
      ref={root}
      id="backend-status"
      tabIndex={-1}
      className={mode === "hidden" ? "visually-hidden" : `backend-status notice notice-${banner.tone}`}
      data-backend-status={banner.kind}
      data-backend-mode={mode}
      data-backend-reading={banner.kind === "staleReading" ? "superseded" : undefined}
      data-backend-collapsed={mode === "hidden" ? "" : undefined}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        onClose?.();
        backToItem();
      }}
    >
      <span className="backend-status-icon" data-tone={banner.status.tone} aria-hidden="true">
        <Icon name={banner.status.tone === "ready" ? "checkCircle" : banner.status.tone === "pending" ? "clock" : "alert"} />
      </span>
      {/* One live region for the reading, so a verdict, its reason and the
          build it names are announced as one thing rather than as three. */}
      <div role="status" className="backend-status-reading">
        {/* A checking reading's title is already the reason its actions wait. */}
        <strong id={busy && banner.kind === "checking" ? BUSY_ID : undefined}>{banner.title}</strong>
        {/* One span, joined as the locale joins sentences: separate spans get
            the flex gap, which reads as a double space between Chinese ones. */}
        {banner.body.length === 0 ? null : <span className={detail}>{joinSentences(t, banner.body)}</span>}
        {named === null ? null : (
          <span className={detail} data-backend-build="">
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
        {/* Said beside the actions rather than left to the refused controls
            alone. The picker's dialog closes before the probes run, and without
            this the moment between reads as finished when it is not. It is the
            reason every action points at. */}
        {busy && banner.kind !== "checking" ? <span id={BUSY_ID} data-backend-busy="">{t("backendCheckingInstallation")}</span> : null}
        {/* Shown only where this build had no sentence of its own for the code,
            so it stays inspectable instead of being paraphrased away. */}
        {banner.code !== null && banner.kind === "requestFailed" ? (
          <span className={detail} data-backend-code="">{t("backendProblemCode", { code: banner.code })}</span>
        ) : null}
      </div>
      <div className="backend-status-actions" hidden={mode === "hidden" || offered?.every((at) => at < 0) === true}>
        {banner.actions.map((entry, position) => (
          // Refused rather than disabled while a request runs (UI-24): the
          // keyboard stays on the action it pressed, through the native picker
          // and after it, and the busy sentence says why it waits.
          <Button
            // The semantic id, not the position: React must not carry one
            // action's node over to another when a verdict changes which ones
            // are offered. The suffix separates the two `choose` offers a
            // chosen-but-unusable folder shows.
            key={`${entry.id}-${position}`}
            variant="secondary"
            size="sm"
            data-backend-action={entry.id}
            hidden={offered !== null && !offered.includes(position)}
            refused={busy}
            reasonId={BUSY_ID}
            onClick={() => {
              if (mode === "notice") setHeld(entry.id);
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
      <div className="backend-setup-help" hidden={mode === "hidden"}>
        <Disclosure
          variant="secondary"
          data-backend-help=""
          label={t("backendHelpTitle")}
          open={helpOpen}
          onOpenChange={setHelpOpen}
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
