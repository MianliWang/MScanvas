import { useMemo, useState } from "react";

import { ConversionInspector } from "../features/convert/ConversionInspector";
import { WorkspacePanel } from "../features/data-workspace/WorkspacePanel";
import { initialWorkspaceItems, type WorkspaceItem } from "../features/data-workspace/model";
import { ExplorePanel } from "../features/explore/ExplorePanel";
import { RunBar } from "../features/runs/RunBar";


export function App() {
  const [items, setItems] = useState<WorkspaceItem[]>(initialWorkspaceItems);
  const [activeId, setActiveId] = useState<string | null>(initialWorkspaceItems[0]?.id ?? null);

  const selectedCount = items.filter((item) => item.selected).length;
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const completedCount = items.filter((item) => item.status === "completed").length;
  const activeItem = useMemo(() => items.find((item) => item.id === activeId) ?? null, [activeId, items]);

  function toggleSelected(id: string) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)),
    );
  }

  function removeSelected() {
    setItems((current) => {
      const remaining = current.filter((item) => !item.selected);
      setActiveId((currentActive) =>
        remaining.some((item) => item.id === currentActive) ? currentActive : (remaining[0]?.id ?? null),
      );
      return remaining;
    });
  }

  function clearWorkspace() {
    setItems([]);
    setActiveId(null);
  }

  function addMockAcquisition() {
    const sequence = items.length + 1;
    const id = `sample-${Date.now()}`;
    setItems((current) => [
      ...current,
      {
        id,
        name: `Imported_${String(sequence).padStart(2, "0")}.raw`,
        kind: "Thermo RAW",
        sizeLabel: "2.6 GB",
        path: `D:\\MSData\\Imported_${String(sequence).padStart(2, "0")}.raw`,
        status: "ready",
        selected: false,
      },
    ]);
    setActiveId(id);
  }

  function addMockFolder() {
    const stamp = Date.now();
    const folderItems: WorkspaceItem[] = [1, 2].map((index) => ({
      id: `folder-${stamp}-${index}`,
      name: `Folder_sample_${String(index).padStart(2, "0")}.raw`,
      kind: "Thermo RAW",
      sizeLabel: `${2 + index}.4 GB`,
      path: `D:\\MSData\\Imported-folder\\Folder_sample_${String(index).padStart(2, "0")}.raw`,
      status: "ready",
      selected: false,
    }));
    setItems((current) => [...current, ...folderItems]);
    setActiveId(folderItems[0]?.id ?? null);
  }

  function queueSelected() {
    setItems((current) =>
      current.map((item) => (item.selected ? { ...item, status: "queued" } : item)),
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">MS</span>
          <div>
            <strong>MSCanvas</strong>
            <span>Local workspace · M0 shell</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="Current workspace view">
          <button className="is-active" type="button" aria-current="page">
            Explore workspace
          </button>
        </nav>

        <div className="toolbar-actions">
          <button className="secondary-button" onClick={addMockAcquisition} type="button">
            Add files
          </button>
          <button className="secondary-button" onClick={addMockFolder} type="button">
            Add folder
          </button>
          <button className="secondary-button" onClick={removeSelected} disabled={selectedCount === 0} type="button">
            Remove selected
          </button>
          <button className="secondary-button" onClick={clearWorkspace} disabled={items.length === 0} type="button">
            Clear list
          </button>
          <button className="primary-button" onClick={queueSelected} disabled={selectedCount === 0} type="button">
            Convert selected
          </button>
        </div>
      </header>

      <div className="prototype-banner" role="status">
        Functional repository shell using mock data. RAW access and ProteoWizard execution are not connected yet.
      </div>

      <div className="workspace-layout">
        <WorkspacePanel
          activeId={activeId}
          items={items}
          onActivate={setActiveId}
          onToggleSelected={toggleSelected}
        />
        <ExplorePanel activeName={activeItem?.name ?? null} />
        <ConversionInspector activeName={activeItem?.name ?? null} selectedCount={selectedCount} />
      </div>

      <RunBar completedCount={completedCount} queuedCount={queuedCount} />
    </div>
  );
}
