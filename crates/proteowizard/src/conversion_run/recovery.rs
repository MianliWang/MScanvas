//! Live-session staging custody, acquired at creation and never reconstructed.

use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::*;

static NEXT_RECOVERY: AtomicU64 = AtomicU64::new(1);

/// A separate recovery observation. It never changes the original run report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum StagingRecoveryStatus {
    Active,
    Recoverable,
    Cleaned,
    ProcessUnconfirmed,
    ProofUnavailable,
}

/// An opaque live-session record. No path-based constructor is public.
#[derive(Clone)]
pub struct StagingRecovery(Arc<RecoveryRecord>);

struct RecoveryRecord {
    id: u64,
    status: AtomicU8,
    state: Mutex<RecoveryState>,
}

struct RecoveryState {
    area: OwnedStagingArea,
    /// The exact containing directory held from staging creation.
    parent: Option<File>,
    quiescent: bool,
    frozen: Option<cleanup::FrozenStagingTree>,
    snapshot_attempted: bool,
}

/// The caller can keep this observer before it transfers its one cancellation
/// object to the runner. Only staging creation inside this crate can fill it.
#[derive(Clone, Default)]
pub struct StagingRecoveryObserver(Arc<Mutex<Option<StagingRecovery>>>);

impl StagingRecoveryObserver {
    #[must_use]
    pub fn retained(&self) -> Option<StagingRecovery> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn install(&self, record: StagingRecovery) {
        let mut slot = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        assert!(
            slot.is_none(),
            "one cancellation owns at most one staging creation"
        );
        *slot = Some(record);
    }
}

impl StagingRecovery {
    pub(super) fn create(
        path: PathBuf,
        cancellation: Option<&ConversionCancellation>,
    ) -> Result<Self, ConversionRunFailure> {
        let parent = cleanup::hold_recovery_parent(path.parent().ok_or(
            ConversionRunFailure::StagingNotCreated {
                kind: io::ErrorKind::InvalidInput,
            },
        )?)
        .map_err(|error| ConversionRunFailure::StagingNotCreated { kind: error.kind() })?;
        let root = cleanup::create_owned_directory(
            &parent,
            path.file_name()
                .ok_or(ConversionRunFailure::StagingNotCreated {
                    kind: io::ErrorKind::InvalidInput,
                })?,
        )
        .map_err(|error| match error.kind() {
            io::ErrorKind::AlreadyExists => ConversionRunFailure::StagingTargetExists,
            kind => ConversionRunFailure::StagingNotCreated { kind },
        })?;
        let id = NEXT_RECOVERY
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .expect("a live process cannot exhaust staging identities");
        let record = Self(Arc::new(RecoveryRecord {
            id,
            status: AtomicU8::new(StagingRecoveryStatus::Active as u8),
            state: Mutex::new(RecoveryState {
                // Finished disables implicit Drop teardown for this record.
                // All attempts after creation go through this retained owner.
                area: OwnedStagingArea {
                    root: Some(root),
                    output: None,
                    marker: None,
                    path,
                    state: StagingState::Finished,
                },
                parent: Some(parent),
                quiescent: true,
                frozen: None,
                snapshot_attempted: false,
            }),
        }));
        if let Some(cancellation) = cancellation {
            cancellation.recovery_observer().install(record.clone());
        }
        let populated = {
            let mut state = record
                .0
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.area.populate_created().and_then(|()| {
                let parent = cleanup::parent_for_publication(
                    state.parent.as_ref().ok_or(io::ErrorKind::InvalidData)?,
                    &state.area.path,
                    state.area.root.as_ref().ok_or(io::ErrorKind::InvalidData)?,
                )?;
                state.parent = Some(parent);
                Ok(())
            })
        };
        if let Err(error) = populated {
            // Any objects that were actually acquired remain in the record.
            // A missing root hold never licenses deletion by its old name.
            record.discard();
            return Err(ConversionRunFailure::StagingNotCreated { kind: error.kind() });
        }
        Ok(record)
    }

    #[must_use]
    pub fn id(&self) -> String {
        format!("staging-{}", self.0.id)
    }

    /// Lock-free because queue DTO projection holds the conversion slot leaf.
    #[must_use]
    pub fn status(&self) -> StagingRecoveryStatus {
        match self.0.status.load(Ordering::Acquire) {
            0 => StagingRecoveryStatus::Active,
            1 => StagingRecoveryStatus::Recoverable,
            2 => StagingRecoveryStatus::Cleaned,
            3 => StagingRecoveryStatus::ProcessUnconfirmed,
            _ => StagingRecoveryStatus::ProofUnavailable,
        }
    }

    fn publish(&self, status: StagingRecoveryStatus) {
        self.0.status.store(status as u8, Ordering::Release);
    }

    pub(super) fn output_directory(&self) -> PathBuf {
        self.0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .area
            .output_directory()
    }

    pub(super) fn before_provider(&self) {
        self.0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .quiescent = false;
    }

    pub(super) fn after_provider(&self, result: &Result<ProcessOutput, ProcessError>) {
        let confirmed = match result {
            Ok(output) => OwnedTreeDisposition::of(output).no_owned_process_survives(),
            Err(error) => !error.leaves_an_owned_process_unaccounted(),
        };
        self.0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .quiescent = confirmed;
    }

    pub(super) fn discard(&self) -> Option<StagingResidue> {
        self.teardown(true).err()
    }

    /// Explicit cleanup of the same frozen live-session object set. A caller
    /// can look up a record, but cannot manufacture or renew its proof.
    pub fn reclaim(&self) -> Result<(), StagingResidue> {
        self.teardown(false)
    }

    fn teardown(&self, initial: bool) -> Result<(), StagingResidue> {
        self.teardown_with_initial_inspection(initial, || Ok(()))
    }

    #[cfg(all(test, windows))]
    pub(super) fn discard_with_inspection_for_test(
        &self,
        inspect: impl FnOnce() -> Result<(), StagingResidue>,
    ) -> Result<(), StagingResidue> {
        self.teardown_with_initial_inspection(true, inspect)
    }

    fn teardown_with_initial_inspection(
        &self,
        initial: bool,
        inspect: impl FnOnce() -> Result<(), StagingResidue>,
    ) -> Result<(), StagingResidue> {
        let mut state = self
            .0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !initial && self.status() != StagingRecoveryStatus::Recoverable {
            return Err(StagingResidue::ForeignEntry);
        }
        if !state.quiescent {
            self.publish(StagingRecoveryStatus::ProcessUnconfirmed);
            return Err(StagingResidue::NotRemoved {
                kind: io::ErrorKind::WouldBlock,
            });
        }
        if !state.snapshot_attempted {
            state.snapshot_attempted = true;
            match inspect()
                .and_then(|()| cleanup::freeze_staging_tree(&state.area, state.parent.as_ref()))
            {
                Ok(frozen) => state.frozen = Some(frozen),
                Err(residue) => {
                    self.publish(StagingRecoveryStatus::ProofUnavailable);
                    return Err(residue);
                }
            }
        }
        let RecoveryState {
            area,
            parent,
            frozen,
            ..
        } = &mut *state;
        let Some(frozen) = frozen else {
            self.publish(StagingRecoveryStatus::ProofUnavailable);
            return Err(StagingResidue::ForeignEntry);
        };
        match cleanup::resume_frozen_teardown(area, parent.as_ref(), frozen) {
            Ok(()) => {
                parent.take();
                self.publish(StagingRecoveryStatus::Cleaned);
                Ok(())
            }
            Err(residue) => {
                let retryable = matches!(residue, StagingResidue::NotRemoved { .. });
                self.publish(if retryable {
                    StagingRecoveryStatus::Recoverable
                } else {
                    StagingRecoveryStatus::ProofUnavailable
                });
                Err(residue)
            }
        }
    }
}

impl fmt::Debug for StagingRecovery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StagingRecovery")
            .field("status", &self.status())
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for StagingRecoveryObserver {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<staging-recovery-observer>")
    }
}
