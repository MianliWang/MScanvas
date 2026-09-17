import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { presentBackend, type BackendActionId } from "./backendPresentation";
import type { BackendState } from "./usePreviewWorkspace";

/**
 * The control that opened the native folder picker, and the action it named.
 *
 * The name is kept because surviving the request is not the same as still being
 * the same control. A new verdict re-renders the banner in place, and React
 * keeps the button node and relabels it -- `Search automatically` takes over
 * the slot `Choose folder…` was in. Focusing that node would hand the keyboard
 * to an action the user never reached for, one Enter away from undoing the
 * choice they just made.
 *
 * What identifies the action is its semantic id, not its label. The label is
 * not an identity at all once the interface has two languages: the same action
 * reads differently in each, and applying a language while a picker is open
 * would make every action look replaced. The id survives both, and it still
 * changes when the *meaning* does.
 */
interface PickerTrigger {
  readonly control: HTMLButtonElement;
  readonly action: BackendActionId;
  /**
   * Whether the request this trigger belongs to has been seen outstanding.
   *
   * An effect carries the `busy` of the render that queued it, and React does
   * not promise to have run it before the next event. One queued before the
   * picker opened therefore says `false` about a request that has not started,
   * which reads exactly like the request having finished.
   */
  outstanding: boolean;
}

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
}: BackendStatusProps) {
  const t = useUiMessages();
  const pendingRestore = useRef<PickerTrigger | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const banner = presentBackend(state, readingSuperseded, t);

  const run: Record<BackendActionId, () => void> = {
    recheck: onRecheck,
    choose: onChooseInstallation,
    automatic: onUseAutomaticDiscovery,
  };

  /**
   * Remembers the control the picker was opened from, so the keyboard can be
   * given back to it.
   *
   * Only what actually held the keyboard is remembered. A press that did not
   * focus the button has no place to return to, and taking focus the user never
   * put here would be a move of its own rather than a restoration.
   */
  const start = (id: BackendActionId) => (event: MouseEvent<HTMLButtonElement>) => {
    const control = event.currentTarget;
    pendingRestore.current =
      id === "choose" && document.activeElement === control
        ? { control, action: id, outstanding: false }
        : null;
    run[id]();
  };

  /**
   * Returns the keyboard to the control that opened the picker.
   *
   * Every banner action is disabled for the whole request, the picker's modal
   * lifetime included, and disabling the focused button is what blurs it. The
   * browser does not put focus back when the button is enabled again, so
   * cancelling the dialog left a keyboard user without their place in the tab
   * order.
   *
   * Deliberately not keyed on `busy`: a request begins and ends with it false,
   * so an effect comparing that value alone would not run again if the two
   * renders were ever batched into one. Running after every commit costs a null
   * check, and what makes a settle a settle is stated below rather than left to
   * a dependency list.
   */
  useEffect(() => {
    const pending = pendingRestore.current;
    if (pending === null) {
      return;
    }
    if (busy) {
      // Outstanding, so nothing is restored yet -- and having seen it is what
      // tells the end of this request from an effect that was queued before it
      // began. That effect carries the `busy` of an older render, which says
      // `false` about a request that has not started and reads exactly like one
      // that has finished; acting on it would consume the trigger between the
      // press and the dialog, and nothing would ever give the keyboard back.
      pending.outstanding = true;
      return;
    }
    if (!pending.outstanding) {
      return;
    }
    // Settled, whatever the outcome. Held any longer it could fire on a later
    // request it says nothing about.
    pendingRestore.current = null;
    // Only a control that is still there, still usable and still the action the
    // user pressed. A verdict can leave the button in place and give the slot
    // to another action, and that node is a different control however unchanged
    // the DOM looks -- while a folder that is chosen and turns out to be
    // unusable leaves the same chooser exactly where it was, which is a place
    // worth giving back.
    //
    // Compared on the semantic id the node carries, not on its text. A
    // translation changes every label without changing a single action, and the
    // reverse -- the same label over a different action -- is what this guard
    // exists to catch.
    //
    // `isConnected` is redundant today, because React leaves a control it
    // unmounts with the `disabled` this request gave it. It is stated anyway:
    // what must never happen is reaching for a node that is gone, and that is
    // not a thing to infer from how an unmount happens to leave an attribute.
    if (
      !pending.control.isConnected ||
      pending.control.disabled ||
      pending.control.dataset.backendAction !== pending.action
    ) {
      return;
    }
    // Never over a control the user has since chosen for themselves. Blurred by
    // the disabling, focus is on the body until something else claims it.
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      return;
    }
    // `preventScroll`, so returning the keyboard cannot also move the workspace
    // under the user.
    pending.control.focus({ preventScroll: true });
  });

  /**
   * The offline setup help.
   *
   * Reachable in every state, including the states with no reading and no
   * installation at all, and it explains the three things a reader actually
   * needs: that ProteoWizard is theirs to install, that a folder they choose
   * lasts for this session only, and which control does what.
   */
  const help = (
    <details
      className="backend-setup-help"
      data-backend-help=""
      open={helpOpen}
      onToggle={(event) => setHelpOpen(event.currentTarget.open)}
    >
      <summary>{t("backendHelpTitle")}</summary>
      <p>{t("backendHelpProvider")}</p>
      <p>{t("backendHelpSessionScope")}</p>
      <ul>
        <li>{t("backendHelpChoose")}</li>
        <li>{t("backendHelpAutomatic")}</li>
        <li>{t("backendHelpRecheck")}</li>
      </ul>
      <p>{t("backendHelpTarget")}</p>
      <p>{t("backendHelpWithoutBackend")}</p>
    </details>
  );

  if (banner.kind === "checking") {
    return (
      <div className="notice notice-neutral" data-backend-status="checking">
        <span role="status">{banner.title}</span>
        {help}
      </div>
    );
  }

  const named = banner.names;
  return (
    <div
      className={`notice notice-${banner.tone}`}
      data-backend-status={banner.kind}
      data-backend-reading={banner.kind === "staleReading" ? "superseded" : undefined}
    >
      {/* One live region for the whole banner, so a verdict, its reason and the
          build it names are announced as one thing rather than as three. */}
      <div role="status" className="backend-status-reading">
        <strong>{banner.title}</strong>
        {banner.body.map((sentence) => (
          <span key={sentence}>{sentence}</span>
        ))}
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
        {/* Said in the banner rather than left to the disabled controls alone.
            The picker's dialog closes before the probes run, and without this
            the moment between reads as finished when it is not. */}
        {busy ? <span data-backend-busy="">{t("backendCheckingInstallation")}</span> : null}
        {/* Shown only where this build had no sentence of its own for the code,
            so it stays inspectable instead of being paraphrased away. */}
        {banner.code !== null && banner.kind === "requestFailed" ? (
          <span data-backend-code="">{t("backendProblemCode", { code: banner.code })}</span>
        ) : null}
      </div>
      <div className="backend-status-actions">
        {banner.actions.map((entry, position) => (
          <button
            // The semantic id, not the position: React must not carry one
            // action's node over to another when a verdict changes which ones
            // are offered. The suffix separates the two `choose` offers a
            // chosen-but-unusable folder shows.
            key={`${entry.id}-${position}`}
            className="link-button"
            data-backend-action={entry.id}
            disabled={busy}
            onClick={start(entry.id)}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>
      {help}
    </div>
  );
}
