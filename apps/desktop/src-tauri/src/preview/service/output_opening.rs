//! Current-document access to objects retained at successful publication.

use std::path::Path;

use super::super::adoption::AdoptionRefusal;
use super::super::dto::{OutputOpenActionDto, OutputOpenOutcomeDto, OutputOpenRefusalDto};
use super::PreviewService;

impl PreviewService {
    /// The caller supplies a lookup handle, never a target or a shell argument.
    pub fn open_finalized_output(
        &self,
        output_id: &str,
        action: OutputOpenActionDto,
        document_epoch: u64,
    ) -> OutputOpenOutcomeDto {
        self.open_finalized_output_with(
            output_id,
            action,
            document_epoch,
            super::super::output_opening::open,
        )
    }

    pub(in crate::preview) fn open_finalized_output_with(
        &self,
        output_id: &str,
        action: OutputOpenActionDto,
        document_epoch: u64,
        opener: impl FnOnce(&Path) -> Result<(), OutputOpenRefusalDto>,
    ) -> OutputOpenOutcomeDto {
        self.open_finalized_output_after_validation(
            output_id,
            action,
            document_epoch,
            || {},
            opener,
        )
    }

    pub(in crate::preview) fn open_finalized_output_after_validation(
        &self,
        output_id: &str,
        action: OutputOpenActionDto,
        document_epoch: u64,
        after_validation: impl FnOnce(),
        opener: impl FnOnce(&Path) -> Result<(), OutputOpenRefusalDto>,
    ) -> OutputOpenOutcomeDto {
        let result = (|| {
            // This gate only deduplicates presentation handoffs. It never reserves
            // the backend, changes a conversion, or changes adoption eligibility.
            let _opening = self
                .output_opening
                .try_lock()
                .map_err(|_| OutputOpenRefusalDto::InFlight)?;
            if document_epoch != self.workspace_drop_document_epoch() {
                return Err(OutputOpenRefusalDto::StaleDocument);
            }
            let ticket = self
                .conversion_slot()
                .finalized_output(output_id)
                .ok_or(OutputOpenRefusalDto::UnknownOutput)?;
            match action {
                OutputOpenActionDto::File => {
                    let admitted = ticket.accept().map_err(|refusal| match refusal {
                        AdoptionRefusal::Missing => OutputOpenRefusalDto::OutputMissing,
                        AdoptionRefusal::Changed | AdoptionRefusal::NotMzml => {
                            OutputOpenRefusalDto::OutputChanged
                        }
                        AdoptionRefusal::Unreadable => OutputOpenRefusalDto::OutputUnreadable,
                    })?;
                    // Hashing occurs without service locks. Recheck document and
                    // live ownership at the handoff, while all object holds live.
                    after_validation();
                    let _delivery = self.drop_updates.begin_delivery();
                    self.validate_open_handoff(output_id, document_epoch)?;
                    opener(admitted.path())
                }
                OutputOpenActionDto::Folder => {
                    let (path, _hold) = ticket
                        .folder_for_open()
                        .map_err(|_| OutputOpenRefusalDto::FolderUnavailable)?;
                    after_validation();
                    let _delivery = self.drop_updates.begin_delivery();
                    self.validate_open_handoff(output_id, document_epoch)?;
                    opener(&path)
                }
            }
        })();
        match result {
            Ok(()) => OutputOpenOutcomeDto::Accepted,
            Err(reason) => OutputOpenOutcomeDto::Refused { reason },
        }
    }

    fn validate_open_handoff(
        &self,
        output_id: &str,
        document_epoch: u64,
    ) -> Result<(), OutputOpenRefusalDto> {
        if document_epoch != self.workspace_drop_document_epoch() {
            return Err(OutputOpenRefusalDto::StaleDocument);
        }
        if self.conversion_slot().finalized_output(output_id).is_none() {
            return Err(OutputOpenRefusalDto::UnknownOutput);
        }
        Ok(())
    }
}
