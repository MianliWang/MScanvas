//! What the workspace restore document records about each live row (ADR 0061).
//!
//! Memory only: the facts admission established and the row's leases keep
//! true. Nothing here opens, stats or hashes a file, and nothing changes the
//! workspace generation.

use std::path::PathBuf;

use super::super::dto::DatasetSourceKindDto;
use super::super::selection::source_kind_dto;
use super::PreviewService;

/// One object a live row is bound to, as admission recorded it.
///
/// Deliberately not `Debug`: it holds an absolute path.
pub(crate) struct RowMember {
    pub path: PathBuf,
    pub byte_length: u64,
    pub identity: (u64, [u8; 16]),
}

/// One live row: the handle the webview holds, its family and its members,
/// primary first.
pub(crate) struct LiveRow {
    pub handle: String,
    pub family: DatasetSourceKindDto,
    pub members: Vec<RowMember>,
}

impl PreviewService {
    /// Every live row's recorded facts, in registry order.
    ///
    /// Taken under the mutation gate, as the roster is, so the answer is wholly
    /// before or wholly after a batch rather than part of one.
    pub(crate) fn workspace_restore_rows(&self) -> Vec<LiveRow> {
        let gate = self.enter_workspace_mutation_after_drop();
        let workspace = self.workspace();
        let rows = workspace
            .registry
            .ids()
            .iter()
            .filter_map(|id| workspace.registry.get(*id))
            .map(|dataset| {
                let file = dataset.file();
                let primary = RowMember {
                    path: file.path().to_path_buf(),
                    byte_length: file.byte_length(),
                    identity: file.identity().as_pair(),
                };
                let companions = file.companions().iter().map(|companion| RowMember {
                    path: companion.path().to_path_buf(),
                    byte_length: companion.byte_length(),
                    identity: companion.identity().as_pair(),
                });
                LiveRow {
                    handle: dataset.id().handle(),
                    family: source_kind_dto(file.source_kind()),
                    members: std::iter::once(primary).chain(companions).collect(),
                }
            })
            .collect();
        drop(workspace);
        drop(gate);
        rows
    }
}
