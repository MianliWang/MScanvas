export type WorkspaceStatus = "ready" | "queued" | "converting" | "completed" | "failed";

export interface WorkspaceItem {
  id: string;
  name: string;
  kind: "Thermo RAW" | "mzML" | "mzXML";
  sizeLabel: string;
  path: string;
  status: WorkspaceStatus;
  selected: boolean;
}

export const initialWorkspaceItems: WorkspaceItem[] = [
  {
    id: "sample-001",
    name: "QC_pool_01.raw",
    kind: "Thermo RAW",
    sizeLabel: "2.8 GB",
    path: "D:\\MSData\\Batch-14\\QC_pool_01.raw",
    status: "ready",
    selected: true,
  },
  {
    id: "sample-002",
    name: "Sample_A_01.raw",
    kind: "Thermo RAW",
    sizeLabel: "3.1 GB",
    path: "D:\\MSData\\Batch-14\\Sample_A_01.raw",
    status: "ready",
    selected: false,
  },
  {
    id: "sample-003",
    name: "Sample_B_01.mzML",
    kind: "mzML",
    sizeLabel: "1.4 GB",
    path: "D:\\MSData\\Batch-14\\mzML\\Sample_B_01.mzML",
    status: "completed",
    selected: false,
  },
];
