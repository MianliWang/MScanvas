import type { BackendState } from "./usePreviewWorkspace";

export interface BackendStatusProps {
  readonly state: BackendState;
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
  onRecheck,
  onChooseInstallation,
  onUseAutomaticDiscovery,
}: BackendStatusProps) {
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
        <button className="link-button" onClick={onRecheck} type="button">
          Check again
        </button>
        {/* Which installation was in use is exactly what a failed call does not
            say, so both ways out are offered rather than guessed between. */}
        <button className="link-button" onClick={onChooseInstallation} type="button">
          Choose folder…
        </button>
        <button className="link-button" onClick={onUseAutomaticDiscovery} type="button">
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
  const switchAway = chosen ? (
    <button className="link-button" onClick={onUseAutomaticDiscovery} type="button">
      Search automatically
    </button>
  ) : (
    <button className="link-button" onClick={onChooseInstallation} type="button">
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
        </span>
        {/* An installation can be moved, replaced or removed while MSCanvas is
            running, and this banner would otherwise keep saying it is there. */}
        <button className="link-button" onClick={onRecheck} type="button">
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
      </span>
      {availability.failure === null ? null : <span>{availability.failure.correctiveAction}</span>}
      <button className="link-button" onClick={onRecheck} type="button">
        Check again
      </button>
      {switchAway}
      {/* A chosen folder holding nothing usable still leaves the choice in
          place, so this state needs both: pick a different folder, or stop
          using one at all. */}
      {chosen ? (
        <button className="link-button" onClick={onChooseInstallation} type="button">
          Choose a different folder…
        </button>
      ) : null}
    </div>
  );
}
