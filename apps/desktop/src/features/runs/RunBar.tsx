interface RunBarProps {
  queuedCount: number;
  completedCount: number;
}

export function RunBar({ queuedCount, completedCount }: RunBarProps) {
  return (
    <footer className="run-bar" aria-label="Run summary">
      <div>
        <strong>Runs</strong>
        <span>{queuedCount} queued · {completedCount} completed · 0 failed</span>
      </div>
      <div className="run-progress" aria-label="Mock conversion progress">
        <span style={{ width: queuedCount > 0 ? "38%" : "0%" }} />
      </div>
      <button className="quiet-button" type="button" disabled title="Queue detail is not connected in the M0 shell">
        Open queue
      </button>
    </footer>
  );
}
