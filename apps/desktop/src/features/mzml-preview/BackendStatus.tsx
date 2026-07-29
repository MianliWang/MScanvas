import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";

import type { BackendState } from "./usePreviewWorkspace";

/**
 * The control that opened the native folder picker, with the banner it was
 * pressed from.
 *
 * The banner is kept because a cancelled picker is the one outcome that applies
 * no verdict, so the state is still the very object it was. Anything else
 * replaced it, and the button in that position may since have become a
 * different action.
 */
interface PickerTrigger {
  readonly control: HTMLButtonElement;
  readonly bannerAtRequest: BackendState;
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
      document.activeElement === control ? { control, bannerAtRequest: state } : null;
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
   * renders were ever batched into one. Reading the pending trigger after every
   * commit costs a null check and cannot miss the settle.
   */
  useEffect(() => {
    const pending = pendingRestore.current;
    if (pending === null || busy) {
      return;
    }
    // Settled, whatever the outcome. Held any longer it could fire on a later
    // request it says nothing about.
    pendingRestore.current = null;
    // Cancelling changes nothing, which is exactly how it is recognised here:
    // no verdict was applied, so the banner is still the object it was and the
    // control still means what the user pressed. Any other outcome replaced the
    // verdict, and the button in that position may now be a different action --
    // `Search automatically` sits where `Choose folder…` was -- so the focus
    // stays where the new render put it.
    if (pending.bannerAtRequest !== state) {
      return;
    }
    // Never a node this render has removed, and never one still disabled.
    if (!pending.control.isConnected || pending.control.disabled) {
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
