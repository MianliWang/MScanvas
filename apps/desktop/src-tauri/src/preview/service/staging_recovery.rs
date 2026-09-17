//! Explicit deletion of the current terminal queue's proven disposable staging.

use super::super::dto::{StagingReclaimOutcomeDto, StagingReclaimRefusalDto};
use super::*;
use mscanvas_proteowizard::StagingRecoveryStatus;

struct ReclaimInFlight<'a>(&'a AtomicBool);
impl Drop for ReclaimInFlight<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl PreviewService {
    pub fn reclaim_conversion_staging(
        &self,
        recovery_id: &str,
        document: u64,
    ) -> StagingReclaimOutcomeDto {
        self.reclaim_conversion_staging_after_admission(recovery_id, document, || {})
    }

    pub(in crate::preview) fn reclaim_conversion_staging_after_admission(
        &self,
        recovery_id: &str,
        document: u64,
        after_admission: impl FnOnce(),
    ) -> StagingReclaimOutcomeDto {
        let result = self.reclaim_conversion_staging_inner(recovery_id, document, after_admission);
        match result {
            Ok(()) => StagingReclaimOutcomeDto::Cleaned,
            Err(reason) => StagingReclaimOutcomeDto::Refused { reason },
        }
    }

    fn reclaim_conversion_staging_inner(
        &self,
        recovery_id: &str,
        document: u64,
        after_admission: impl FnOnce(),
    ) -> Result<(), StagingReclaimRefusalDto> {
        // Current-document authorization remains held through bounded deletion.
        // No process is waited on: the backend gate is acquired with try_lock.
        // The workspace and conversion slot are never held during filesystem work.
        let _delivery = self.drop_updates.begin_delivery();
        let mutation = self.enter_workspace_mutation();
        if document != self.workspace_drop_document_epoch() {
            return Err(StagingReclaimRefusalDto::StaleDocument);
        }
        if self.backend_is_quarantined() {
            return Err(StagingReclaimRefusalDto::Quarantined);
        }
        if self.conversion_is_busy() || self.terminal_queue_action_in_flight() {
            return Err(StagingReclaimRefusalDto::ActiveWork);
        }
        let _backend = self
            .backend_gate
            .try_lock()
            .map_err(|_| StagingReclaimRefusalDto::ActiveWork)?;
        let record = self
            .conversion_slot()
            .staging_recovery(recovery_id)
            .ok_or(StagingReclaimRefusalDto::UnknownRecovery)?;
        if record.status() != StagingRecoveryStatus::Recoverable {
            return Err(StagingReclaimRefusalDto::ProofUnavailable);
        }
        self.staging_reclaiming.store(true, Ordering::Release);
        let _in_flight = ReclaimInFlight(&self.staging_reclaiming);
        drop(mutation);
        after_admission();
        let answer = record.reclaim();
        // Recovery is separate mutable bookkeeping; advancing only the slot's
        // read sequence lets an existing document receive that news without
        // rewriting the attempt's process, staging, output or integrity facts.
        self.conversion_slot().note_staging_recovery(recovery_id);
        answer.map_err(|_| {
            if record.status() == StagingRecoveryStatus::Recoverable {
                StagingReclaimRefusalDto::StillBlocked
            } else {
                StagingReclaimRefusalDto::ProofUnavailable
            }
        })
    }
}
