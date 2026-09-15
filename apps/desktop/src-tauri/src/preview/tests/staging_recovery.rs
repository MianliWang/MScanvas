#![cfg(windows)]

use super::*;
use crate::preview::dto::{
    StagingReclaimOutcomeDto, StagingReclaimRefusalDto, StagingRecoveryStatusDto,
};
use std::os::windows::fs::OpenOptionsExt;

struct LockFirstOutput {
    inner: FakeConversionRunner,
    first: AtomicBool,
    lock: Arc<Mutex<Option<fs::File>>>,
}

impl HasLaunchCount for LockFirstOutput {
    fn launch_count(&self) -> Arc<AtomicUsize> {
        self.inner.launch_count()
    }
}

impl ProcessRunner for LockFirstOutput {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        let output = self.inner.run(spec)?;
        if self.first.swap(false, Ordering::SeqCst) {
            let path = spec.output_destination().expect("one known output");
            *self.lock.lock().unwrap() = Some(
                fs::OpenOptions::new()
                    .read(true)
                    .share_mode(0x03)
                    .open(path)
                    .unwrap(),
            );
        }
        Ok(output)
    }
}

#[test]
fn staging_recovery_runs_from_real_creation_through_lock_refusal_unlock_and_fresh_plan() {
    let fixture = TestFile::new("service-owned-staging-recovery");
    let destination = destination_root(&fixture, "out");
    let lock = Arc::new(Mutex::new(None));
    let runner = LockFirstOutput {
        inner: FakeConversionRunner::new(BackendAct::Convert),
        first: AtomicBool::new(true),
        lock: Arc::clone(&lock),
    };
    let launches = runner.launch_count();
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    )));
    let source = fixture.thermo_raw("one.raw");
    let original = fs::read(&source).unwrap();
    let handle = add_one_acquisition(&service, &source);
    let document = current_document(&service);
    let begin = service
        .begin_conversion_now(
            std::slice::from_ref(&handle),
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .unwrap();
    let operation = service
        .claim_conversion(&begin.reservation_id, document)
        .unwrap();
    let before = service.run_claimed_conversion(operation, &destination);
    let item = &terminal_queue(&before).items[0];
    let recovery = item
        .staging_recovery
        .as_ref()
        .expect("creation retained its owner");
    assert_eq!(recovery.status, StagingRecoveryStatusDto::Recoverable);
    assert_eq!(recovery.attempt, 1);
    assert!(matches!(
        service.reclaim_conversion_staging("forged", document),
        StagingReclaimOutcomeDto::Refused {
            reason: StagingReclaimRefusalDto::UnknownRecovery
        }
    ));
    assert!(matches!(
        service.reclaim_conversion_staging(&recovery.recovery_id, document + 1),
        StagingReclaimOutcomeDto::Refused {
            reason: StagingReclaimRefusalDto::StaleDocument
        }
    ));
    assert!(matches!(
        service.reclaim_conversion_staging(&recovery.recovery_id, document),
        StagingReclaimOutcomeDto::Refused {
            reason: StagingReclaimRefusalDto::StillBlocked
        }
    ));
    lock.lock().unwrap().take();
    assert!(matches!(
        service.reclaim_conversion_staging(&recovery.recovery_id, document),
        StagingReclaimOutcomeDto::Cleaned
    ));
    let after = service.conversion_state();
    let after_item = &terminal_queue(&after).items[0];
    assert_eq!(
        after_item.staging_recovery.as_ref().unwrap().status,
        StagingRecoveryStatusDto::Cleaned
    );
    assert_eq!(
        after_item.result, item.result,
        "cleanup cannot rewrite the original attempt report"
    );
    assert_eq!(after_item.staged, item.staged);
    assert_eq!(after_item.adoption, item.adoption);
    assert_eq!(launches.load(Ordering::SeqCst), 1, "cleanup never reruns");
    assert_eq!(
        service.roster().datasets.len(),
        1,
        "cleanup never adopts or removes"
    );
    assert!(!service.backend_is_quarantined());
    assert!(fs::read_dir(&destination).unwrap().next().is_none());
    let fresh = service
        .begin_conversion_now(&[handle], ConversionConflictPolicyDto::Fail, document)
        .unwrap();
    let next = service
        .claim_conversion(&fresh.reservation_id, document)
        .unwrap();
    assert_ne!(operation, next);
    let completed = service.run_claimed_conversion(next, &destination);
    assert_eq!(terminal_queue(&completed).finalized_count, 1);
    assert_eq!(launches.load(Ordering::SeqCst), 2);
    assert_eq!(fs::read(&source).unwrap(), original);
}

#[test]
fn staging_recovery_prevents_adoption_from_claiming_the_same_terminal_queue_during_cleanup() {
    let fixture = TestFile::new("staging-recovery-adoption-race");
    let destination = destination_root(&fixture, "out");
    let lock = Arc::new(Mutex::new(None));
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        LockFirstOutput {
            inner: FakeConversionRunner::new(BackendAct::Convert),
            first: AtomicBool::new(true),
            lock: Arc::clone(&lock),
        },
    )));
    let handles = ["locked.raw", "valid.raw"]
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)));
    let document = current_document(&service);
    let begin = service
        .begin_conversion_now(&handles, ConversionConflictPolicyDto::Fail, document)
        .unwrap();
    let operation = service
        .claim_conversion(&begin.reservation_id, document)
        .unwrap();
    let before = service.run_claimed_conversion(operation, &destination);
    let queue = terminal_queue(&before);
    assert_eq!(
        queue.adoptable_output_count, 1,
        "the race must include an actually adoptable member"
    );
    let recovery = queue.items[0].staging_recovery.as_ref().unwrap();
    lock.lock().unwrap().take();
    let result =
        service.reclaim_conversion_staging_after_admission(&recovery.recovery_id, document, || {
            let error = service
                .adopt_conversion_outputs(&operation.to_string(), document)
                .expect_err("cleanup owns the terminal queue");
            assert_eq!(error.kind, "staging_recovery_in_progress");
            assert_eq!(service.roster().datasets.len(), 2);
        });
    assert!(matches!(result, StagingReclaimOutcomeDto::Cleaned));
    service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("adoption becomes available after cleanup releases ownership");
    assert_eq!(service.roster().datasets.len(), 3);
}
