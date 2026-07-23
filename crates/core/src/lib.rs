//! Core domain types for MSCanvas.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ArtifactId(Uuid);

impl ArtifactId {
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for ArtifactId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    Acquisition,
    OpenMsRun,
    Chromatogram,
    SpectrumSelection,
    FeatureTable,
    QcReport,
    Figure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Ready,
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceItem {
    pub id: ArtifactId,
    pub display_name: String,
    pub kind: ArtifactKind,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    items: Vec<WorkspaceItem>,
}

impl Workspace {
    #[must_use]
    pub fn items(&self) -> &[WorkspaceItem] {
        &self.items
    }

    pub fn add(&mut self, item: WorkspaceItem) -> bool {
        if self.items.iter().any(|existing| existing.id == item.id) {
            return false;
        }
        self.items.push(item);
        true
    }

    /// Clears logical workspace membership only. It performs no filesystem operation.
    pub fn clear(&mut self) -> Vec<WorkspaceItem> {
        std::mem::take(&mut self.items)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BootstrapStatus {
    pub app_version: String,
    pub provider: String,
    pub detail: String,
}

impl BootstrapStatus {
    #[must_use]
    pub fn new(
        app_version: impl Into<String>,
        provider: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            app_version: app_version.into(),
            provider: provider.into(),
            detail: detail.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_removes_only_logical_workspace_membership() {
        let mut workspace = Workspace::default();
        let item = WorkspaceItem {
            id: ArtifactId::new(),
            display_name: "sample.raw".to_owned(),
            kind: ArtifactKind::Acquisition,
        };
        assert!(workspace.add(item.clone()));

        let removed = workspace.clear();

        assert_eq!(removed, vec![item]);
        assert!(workspace.items().is_empty());
    }

    #[test]
    fn duplicate_artifact_ids_are_not_added_twice() {
        let mut workspace = Workspace::default();
        let item = WorkspaceItem {
            id: ArtifactId::new(),
            display_name: "sample.raw".to_owned(),
            kind: ArtifactKind::Acquisition,
        };

        assert!(workspace.add(item.clone()));
        assert!(!workspace.add(item));
        assert_eq!(workspace.items().len(), 1);
    }
}
