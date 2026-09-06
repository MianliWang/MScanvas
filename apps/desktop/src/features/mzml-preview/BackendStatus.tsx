import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";

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
 */
interface PickerTrigger {
  readonly control: HTMLButtonElement;
  readonly action: string;
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
 * The installed-backend banner.
 *
 * MSCanvas never bundles or installs ProteoWizard, so "not installed" is an
 * ordinary state of the application rather than an error, and it always says
 * what the user can do about it.
 *
 * Every state offers a way back to automatic discovery, including the state
 * where the call itself failed. A chosen folder is the only place MSCanvas
 * then looks, so a banner without that offer can leave a session unable to
 * reach an installation it would have found on its own.
 */
export function BackendStatus({
  state,
  busy,
  readingSuperseded,
  onRecheck,
  onChooseInstallation,
  onUseAutomaticDiscovery,
}: BackendStatusProps) {
  const pendingRestore = useRef<PickerTrigger | null>(null);

  /**
   * Remembers the control the picker was opened from, so the keyboard can be
   * given back to it.
   *
   * Only what actually held the keyboard is remembered. A press that did not
   * focus the button has no place to return to, and taking focus the user never
   * put here would be a move of its own rather than a restoration.
   */
  const startChoosing = (event: MouseEvent<HTMLButtonElement>) => {
    const control = event.currentTarget;
    pendingRestore.current =
      document.activeElement === control
        ? { control, action: control.textContent ?? "", outstanding: false }
        : null;
    onChooseInstallation();
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
    // user pressed. A verdict can leave the button in place and rename it, and
    // that node is a different control however unchanged the DOM looks -- while
    // a folder that is chosen and turns out to be unusable leaves the same
    // chooser exactly where it was, which is a place worth giving back.
    //
    // `isConnected` is redundant today, because React leaves a control it
    // unmounts with the `disabled` this request gave it. It is stated anyway:
    // what must never happen is reaching for a node that is gone, and that is
    // not a thing to infer from how an unmount happens to leave an attribute.
    if (
      !pending.control.isConnected ||
      pending.control.disabled ||
      pending.control.textContent !== pending.action
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

  if (state.status === "checking") {
    return (
      <p className="notice notice-neutral" role="status">
        Checking for an installed ProteoWizard backend…
      </p>
    );
  }

  if (state.status === "failed") {
    return (
      <p className="notice notice-danger" role="status">
        <span>{state.error.summary}</span>{" "}
        <button className="link-button" disabled={busy} onClick={onRecheck} type="button">
          Check again
        </button>
        {/* Which installation was in use is exactly what a failed call does not
            say, so both ways out are offered rather than guessed between. */}
        <button className="link-button" disabled={busy} onClick={startChoosing} type="button">
          Choose folder…
        </button>
        <button className="link-button" disabled={busy} onClick={onUseAutomaticDiscovery} type="button">
          Search automatically
        </button>
      </p>
    );
  }

  const { availability } = state;
  // Read from the verdict in hand, never from a remembered choice, so a folder
  // the user picked and a verdict about the previous installation cannot appear
  // together.
  const chosen = availability.origin === "chosen";
  const originNote = chosen ? " · from the folder you chose" : "";
  // Said in the banner rather than left to the disabled controls alone. The
  // picker's dialog closes before the probes run, and without this the moment
  // between reads as finished when it is not.
  const busyNote = busy ? " · checking the installation…" : "";
  const switchAway = chosen ? (
    <button className="link-button" disabled={busy} onClick={onUseAutomaticDiscovery} type="button">
      Search automatically
    </button>
  ) : (
    <button className="link-button" disabled={busy} onClick={startChoosing} type="button">
      Choose folder…
    </button>
  );

  if (readingSuperseded) {
    // **Nothing here is presented as current.** Not the verdict, not the
    // release, not the build date, and not the origin -- the reading describes
    // a publication this session has moved past, and a banner that kept any of
    // them would be naming a build the session has left.
    //
    // The reason text survives, attributed to the reading it belongs to rather
    // than dropped: a reader who was told why the previous backend was unusable
    // does not stop being owed that sentence because a newer publication
    // arrived.
    //
    // Every action stays live. This state is a wait for a read MSCanvas already
    // owes, and where that read is deferred behind a conversion the reader is
    // still entitled to ask for one themselves.
    return (
      <div className="notice notice-neutral" data-backend-reading="superseded" role="status">
        <strong>The installed ProteoWizard changed</strong>
        <span>
          What MSCanvas knew about the backend was read before that change, so none of it
          describes this session any more. MSCanvas reads it again as soon as the backend
          is free.
        </span>
        {availability.failure === null ? null : (
          <span>{`That earlier reading said: ${availability.failure.summary}`}</span>
        )}
        <button className="link-button" disabled={busy} onClick={onRecheck} type="button">
          Check again
        </button>
        {/* Both ways out, rather than the one the reading's origin implies.
            `switchAway` picks between them from `availability.origin`, and that
            origin is part of what has stopped describing the session -- offering
            `Search automatically` alone would tell a reader they are on a folder
            they chose, which is exactly the claim this state exists to withdraw.
            The failed branch above offers both for the same reason. */}
        <button className="link-button" disabled={busy} onClick={startChoosing} type="button">
          Choose folder…
        </button>
        <button
          className="link-button"
          disabled={busy}
          onClick={onUseAutomaticDiscovery}
          type="button"
        >
          Search automatically
        </button>
      </div>
    );
  }

  if (availability.state === "available") {
    return (
      <p className="notice notice-success" role="status">
        <span aria-hidden="true">✓ </span>
        <span>
          ProteoWizard is available
          {availability.release === null ? "" : ` · ${availability.release}`}
          {availability.buildDate === null ? "" : ` · built ${availability.buildDate}`}
          {availability.sameInstallation
            ? ""
            : " · msaccess and msconvert are separate installations"}
          {originNote}
          {busyNote}
        </span>
        {/* An installation can be moved, replaced or removed while MSCanvas is
            running, and this banner would otherwise keep saying it is there. */}
        <button className="link-button" disabled={busy} onClick={onRecheck} type="button">
          Check again
        </button>
        {switchAway}
      </p>
    );
  }

  return (
    <div className="notice notice-warning" role="status">
      <strong>ProteoWizard is not available</strong>
      <span>
        {availability.failure?.summary ?? "No usable backend was found."}
        {originNote}
        {busyNote}
      </span>
      {availability.failure === null ? null : <span>{availability.failure.correctiveAction}</span>}
      <button className="link-button" disabled={busy} onClick={onRecheck} type="button">
        Check again
      </button>
      {switchAway}
      {/* A chosen folder holding nothing usable still leaves the choice in
          place, so this state needs both: pick a different folder, or stop
          using one at all. */}
      {chosen ? (
        <button className="link-button" disabled={busy} onClick={startChoosing} type="button">
          Choose a different folder…
        </button>
      ) : null}
    </div>
  );
}
