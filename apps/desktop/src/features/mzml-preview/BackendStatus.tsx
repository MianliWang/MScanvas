import type { BackendState } from "./usePreviewWorkspace";

export interface BackendStatusProps {
  readonly state: BackendState;
  readonly onRecheck: () => void;
}

/**
 * The installed-backend banner.
 *
 * MSCanvas never bundles or installs ProteoWizard, so "not installed" is an
 * ordinary state of the application rather than an error, and it always says
 * what the user can do about it.
 */
export function BackendStatus({ state, onRecheck }: BackendStatusProps) {
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
      </p>
    );
  }

  const { availability } = state;
  if (availability.state === "available") {
    return (
      <p className="notice notice-success" role="status">
        <span aria-hidden="true">✓ </span>
        ProteoWizard is available
        {availability.release === null ? "" : ` · ${availability.release}`}
        {availability.buildDate === null ? "" : ` · built ${availability.buildDate}`}
        {availability.sameInstallation ? "" : " · msaccess and msconvert are separate installations"}
      </p>
    );
  }

  return (
    <div className="notice notice-warning" role="status">
      <strong>ProteoWizard is not available</strong>
      <span>{availability.failure?.summary ?? "No usable backend was found."}</span>
      {availability.failure === null ? null : <span>{availability.failure.correctiveAction}</span>}
      <button className="link-button" onClick={onRecheck} type="button">
        Check again
      </button>
    </div>
  );
}
