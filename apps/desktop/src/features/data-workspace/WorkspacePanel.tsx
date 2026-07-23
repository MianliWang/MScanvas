import type { WorkspaceItem } from "./model";

interface WorkspacePanelProps {
  items: WorkspaceItem[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onToggleSelected: (id: string) => void;
}

const statusLabels: Record<WorkspaceItem["status"], string> = {
  ready: "Ready",
  queued: "Queued",
  converting: "Converting",
  completed: "Completed",
  failed: "Failed",
};

export function WorkspacePanel({
  items,
  activeId,
  onActivate,
  onToggleSelected,
}: WorkspacePanelProps) {
  return (
    <section className="panel workspace-panel" aria-labelledby="workspace-heading">
      <header className="panel-header">
        <div>
          <h2 id="workspace-heading">Data workspace</h2>
          <p>{items.length} acquisitions</p>
        </div>
        <button className="quiet-button" type="button" aria-label="Filter workspace" disabled title="Planned for M1">
          Filter
        </button>
      </header>

      {items.length === 0 ? (
        <div className="empty-state" role="status">
          <strong>No data in this workspace</strong>
          <span>Drop RAW, mzML or mzXML files here, or use Add files.</span>
        </div>
      ) : (
        <div className="workspace-list" role="list" aria-label="Mass spectrometry data files">
          {items.map((item) => {
            const isActive = item.id === activeId;
            return (
              <div
                className={`workspace-row${isActive ? " is-active" : ""}`}
                key={item.id}
                role="listitem"
              >
                <input
                  aria-label={`Select ${item.name}`}
                  checked={item.selected}
                  onChange={() => onToggleSelected(item.id)}
                  type="checkbox"
                />
                <button
                  className="workspace-row-main"
                  onClick={() => onActivate(item.id)}
                  type="button"
                >
                  <span className="workspace-name">{item.name}</span>
                  <span className="workspace-meta">
                    {item.kind} · {item.sizeLabel}
                  </span>
                </button>
                <span className={`status status-${item.status}`}>{statusLabels[item.status]}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
