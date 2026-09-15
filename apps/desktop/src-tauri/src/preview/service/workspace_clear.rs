//! Captured, revalidated row release. No source or output file is deleted here.

use super::super::dto::{
    WorkspaceClearActionDto, WorkspaceClearOutcomeDto, WorkspaceClearPlanDto,
    WorkspaceClearRefusalDto,
};
use super::*;

pub(super) struct ClearPlan {
    id: String,
    document: u64,
    generation: u64,
    incarnation: (u64, u64),
    all: Vec<DatasetId>,
    removable: Vec<DatasetId>,
}

impl PreviewService {
    #[cfg(test)]
    pub(in crate::preview) fn wait_for_clear_cancellation_request_for_test(&self, operation: u64) {
        let mut slot = self.conversion_slot();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !slot.current_attempt_cancellation_requested_for_test(operation) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(
                !remaining.is_zero(),
                "clear requests cancellation before the parked attempt is released"
            );
            // Recording the slot stop notifies before the actual request. The
            // token update has no notification, so recheck it while yielding
            // the slot lock, within the original overall deadline.
            let (next, _) = self
                .conversion_changed
                .wait_timeout(slot, remaining.min(Duration::from_millis(10)))
                .unwrap();
            slot = next;
        }
    }
    pub fn plan_workspace_clear(
        &self,
        document: u64,
    ) -> Result<WorkspaceClearPlanDto, WorkspaceClearRefusalDto> {
        let _delivery = self.drop_updates.begin_delivery();
        let gate = self.enter_workspace_mutation();
        self.clear_available(document)?;
        let all = self.clear_roster_ids();
        let slot = self.conversion_slot();
        let removable: Vec<_> = all
            .iter()
            .copied()
            .filter(|id| !slot.busy_holds(*id))
            .collect();
        let active = slot.is_busy();
        let incarnation = slot.incarnation();
        drop(slot);
        let sequence = self
            .next_clear_plan
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .expect("a live session cannot exhaust clear identities");
        let id = format!("clear-{sequence}");
        let dto = WorkspaceClearPlanDto {
            plan_id: id.clone(),
            total_count: all.len(),
            removable_count: removable.len(),
            protected_count: all.len() - removable.len(),
            active,
        };
        *self
            .clear_plan
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(ClearPlan {
            id,
            document,
            generation: gate.generation,
            incarnation,
            all,
            removable,
        });
        Ok(dto)
    }

    pub fn execute_workspace_clear(
        &self,
        plan_id: &str,
        action: WorkspaceClearActionDto,
        document: u64,
    ) -> WorkspaceClearOutcomeDto {
        self.execute_workspace_clear_seamed(plan_id, action, document, || {})
    }

    #[cfg(test)]
    pub(in crate::preview) fn execute_workspace_clear_after_quiescence_for_test(
        &self,
        plan_id: &str,
        action: WorkspaceClearActionDto,
        document: u64,
        after_quiescence: impl FnOnce(),
    ) -> WorkspaceClearOutcomeDto {
        self.execute_workspace_clear_seamed(plan_id, action, document, after_quiescence)
    }

    fn execute_workspace_clear_seamed(
        &self,
        plan_id: &str,
        action: WorkspaceClearActionDto,
        document: u64,
        after_quiescence: impl FnOnce(),
    ) -> WorkspaceClearOutcomeDto {
        match self.execute_workspace_clear_inner(plan_id, action, document, after_quiescence) {
            Ok(result) => WorkspaceClearOutcomeDto::Removed { result },
            Err(reason) => WorkspaceClearOutcomeDto::Refused { reason },
        }
    }

    fn execute_workspace_clear_inner(
        &self,
        plan_id: &str,
        action: WorkspaceClearActionDto,
        document: u64,
        after_quiescence: impl FnOnce(),
    ) -> Result<WorkspaceRemoveResultDto, WorkspaceClearRefusalDto> {
        let plan = {
            let mut retained = self
                .clear_plan
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if plan_id.len() > 64
                || retained
                    .as_ref()
                    .is_none_or(|plan| plan.id != plan_id || plan.document != document)
            {
                return Err(WorkspaceClearRefusalDto::StalePlan);
            }
            retained.take().expect("checked retained plan")
        };
        let chosen = match action {
            WorkspaceClearActionDto::RemoveNonRunning => &plan.removable,
            WorkspaceClearActionDto::CancelAndClear => &plan.all,
        };
        if chosen.is_empty() {
            return Err(WorkspaceClearRefusalDto::NothingRemovable);
        }
        {
            let _delivery = self.drop_updates.begin_delivery();
            let gate = self.enter_workspace_mutation();
            self.validate_clear_plan(&plan, &gate)?;
            if matches!(action, WorkspaceClearActionDto::CancelAndClear) {
                let mut slot = self.conversion_slot();
                let stop = slot
                    .request_clear_stop()
                    .map_err(|_| WorkspaceClearRefusalDto::OwnershipChanged)?;
                self.publish_conversion_busy(&slot);
                drop(slot);
                // Neither mutation nor delivery is held while a process is asked
                // to end, or while its worker finishes and publishes the result.
                drop(gate);
                drop(_delivery);
                if let StopAccepted::Requested(Some(request)) = stop {
                    request.request();
                }
                self.wait_for_clear_quiescence(plan.incarnation)?;
            }
        }
        after_quiescence();
        let delivery = self.drop_updates.begin_delivery();
        let mut gate = self.enter_workspace_mutation();
        self.validate_clear_plan(&plan, &gate)?;
        {
            let slot = self.conversion_slot();
            if chosen.iter().any(|id| slot.busy_holds(*id)) {
                return Err(WorkspaceClearRefusalDto::OwnershipChanged);
            }
        }
        // This is the commit point. Any older in-flight import is superseded;
        // any import that already changed the roster made validation refuse.
        gate.advance();
        let claim = self.native_drop_claim.swap(0, Ordering::AcqRel);
        gate.active_drop = None;
        self.workspace_mutation_ready.notify_all();
        let mut workspace = self.workspace();
        for id in chosen {
            workspace.revoke(*id, RevocationReason::Cleared);
        }
        let result = WorkspaceRemoveResultDto {
            roster: roster_of(&workspace),
            removed_handles: chosen.iter().map(|id| id.handle()).collect(),
            unknown_handles: Vec::new(),
        };
        drop(workspace);
        self.spectrum_export_slot().forget_if_owned_by(chosen);
        drop(gate);
        self.drop_updates.publish_terminal_with_busy(
            delivery,
            drop_claim_has_busy(claim),
            WorkspaceDropStateDto::Idle,
        );
        Ok(result)
    }

    fn clear_available(&self, document: u64) -> Result<(), WorkspaceClearRefusalDto> {
        if document != self.workspace_drop_document_epoch() {
            return Err(WorkspaceClearRefusalDto::StaleDocument);
        }
        if self.backend_is_quarantined() {
            return Err(WorkspaceClearRefusalDto::Quarantined);
        }
        if self.terminal_queue_action_in_flight() {
            return Err(WorkspaceClearRefusalDto::ActionInFlight);
        }
        Ok(())
    }

    fn clear_roster_ids(&self) -> Vec<DatasetId> {
        roster_of(&self.workspace())
            .datasets
            .iter()
            .map(|row| DatasetId::parse(&row.handle).expect("registry handle"))
            .collect()
    }

    fn validate_clear_plan(
        &self,
        plan: &ClearPlan,
        gate: &WorkspaceMutationState,
    ) -> Result<(), WorkspaceClearRefusalDto> {
        self.clear_available(plan.document)?;
        if gate.generation != plan.generation || self.clear_roster_ids() != plan.all {
            return Err(WorkspaceClearRefusalDto::StalePlan);
        }
        if self.conversion_slot().incarnation() != plan.incarnation {
            return Err(WorkspaceClearRefusalDto::OwnershipChanged);
        }
        Ok(())
    }

    fn wait_for_clear_quiescence(
        &self,
        incarnation: (u64, u64),
    ) -> Result<(), WorkspaceClearRefusalDto> {
        // A missing worker may never notify. This is a refusal deadline, never
        // evidence that a process ended and never permission to release rows.
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut slot = self.conversion_slot();
        loop {
            if slot.incarnation() != incarnation {
                return Err(WorkspaceClearRefusalDto::OwnershipChanged);
            }
            if self.backend_is_quarantined() {
                return Err(WorkspaceClearRefusalDto::Quarantined);
            }
            if !slot.is_busy() {
                return Ok(());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(WorkspaceClearRefusalDto::StopUnconfirmed);
            }
            let (next, _) = self
                .conversion_changed
                .wait_timeout(slot, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            slot = next;
        }
    }
}
