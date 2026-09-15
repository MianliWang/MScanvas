use super::*;
use crate::preview::dto::{
    WorkspaceClearActionDto as Action, WorkspaceClearOutcomeDto as Outcome,
    WorkspaceClearRefusalDto as Refusal,
};

#[test]
fn active_clear_stop_barrier_requires_the_current_attempt_cancellation_request() {
    let cancellation = ConversionCancellation::new();
    let (mut slot, operation, attempt) = running_two_item_slot(cancellation.request_handle());
    assert!(!slot.current_attempt_cancellation_requested_for_test(operation));
    let StopAccepted::Requested(Some(request)) = slot.request_clear_stop().unwrap() else {
        panic!("the running attempt has a cancellation request")
    };
    assert!(slot.stop_requested(operation));
    assert!(
        !slot.current_attempt_cancellation_requested_for_test(operation),
        "the recorded stop alone must not release the parked runner"
    );
    assert!(!cancellation.request_handle().is_requested());

    request.request();
    assert!(slot.current_attempt_cancellation_requested_for_test(operation));
    assert!(!slot.current_attempt_cancellation_requested_for_test(operation + 1));
    slot.release_attempt(operation, 0, attempt);
    assert!(cancellation.request_handle().is_requested());
    assert!(
        !slot.current_attempt_cancellation_requested_for_test(operation),
        "a settled attempt cannot satisfy the barrier through an old token"
    );
}

#[test]
fn active_clear_captures_nonmembers_and_never_removes_waiting_queue_members() {
    let fixture = TestFile::new("active-clear-nonmembers");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let first = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    let second = add_one_acquisition(&service, &fixture.thermo_raw("two.raw"));
    let other_path = fixture.thermo_raw("other.raw");
    let other = add_one_acquisition(&service, &other_path);
    let document = current_document(&service);
    service
        .begin_conversion_now(
            &[first.clone(), second.clone()],
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .unwrap();
    let plan = service.plan_workspace_clear(document).unwrap();
    assert_eq!(
        (plan.total_count, plan.removable_count, plan.protected_count),
        (3, 1, 2)
    );
    let Outcome::Removed { result } =
        service.execute_workspace_clear(&plan.plan_id, Action::RemoveNonRunning, document)
    else {
        panic!("nonmember is removable")
    };
    assert_eq!(result.removed_handles, vec![other]);
    assert_eq!(
        result
            .roster
            .datasets
            .iter()
            .map(|row| row.handle.clone())
            .collect::<Vec<_>>(),
        vec![first, second]
    );
    assert!(other_path.exists(), "removal does not delete source data");
    let empty = service.plan_workspace_clear(document).unwrap();
    assert_eq!(empty.removable_count, 0);
    assert!(matches!(
        service.execute_workspace_clear(&empty.plan_id, Action::RemoveNonRunning, document),
        Outcome::Refused {
            reason: Refusal::NothingRemovable
        }
    ));
}

#[test]
fn active_clear_rejects_changed_roster_and_an_unknown_or_replaced_confirmation() {
    let fixture = TestFile::new("active-clear-stale");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    let document = current_document(&service);
    let old = service.plan_workspace_clear(document).unwrap();
    let latest = service.plan_workspace_clear(document).unwrap();
    assert!(matches!(
        service.execute_workspace_clear(&old.plan_id, Action::CancelAndClear, document),
        Outcome::Refused {
            reason: Refusal::StalePlan
        }
    ));
    add_one_acquisition(&service, &fixture.thermo_raw("new.raw"));
    assert!(matches!(
        service.execute_workspace_clear(&latest.plan_id, Action::CancelAndClear, document),
        Outcome::Refused {
            reason: Refusal::StalePlan
        }
    ));
    assert_eq!(service.roster().datasets.len(), 2);
}

#[test]
fn active_clear_waits_without_worker_locks_and_preserves_racing_completion() {
    exercise_clear_stop(StopEnding::NaturalSuccess, false);
    exercise_clear_stop(StopEnding::Confirmed, false);
}

#[test]
fn active_clear_preserves_every_row_when_an_addition_wins_after_stop_before_commit() {
    exercise_clear_stop(StopEnding::Confirmed, true);
}

#[test]
fn active_clear_retains_rows_when_the_process_stop_cannot_be_confirmed() {
    exercise_clear_stop(StopEnding::Survivors, false);
    exercise_clear_stop(StopEnding::Unterminated, false);
}

#[test]
fn active_clear_retires_an_awaiting_picker_and_supersedes_an_older_import() {
    let fixture = TestFile::new("active-clear-awaiting-picker");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let source = fixture.thermo_raw("one.raw");
    let handle = add_one_acquisition(&service, &source);
    let import = service.begin_folder_import_now();
    let document = current_document(&service);
    let reservation = service
        .begin_conversion_now(&[handle], ConversionConflictPolicyDto::Fail, document)
        .unwrap();
    let plan = service.plan_workspace_clear(document).unwrap();
    assert_eq!(plan.protected_count, 1);
    assert!(matches!(
        service.execute_workspace_clear(&plan.plan_id, Action::CancelAndClear, document),
        Outcome::Removed { .. }
    ));
    assert!(
        service
            .claim_conversion(&reservation.reservation_id, document)
            .is_err(),
        "a late picker cannot launch the retired queue"
    );
    assert!(
        service.claim_folder_import(&import.reservation_id).is_err(),
        "a late import cannot reinstall cleared rows"
    );
    assert!(service.roster().datasets.is_empty());
    assert!(source.exists());
}

fn exercise_clear_stop(ending: StopEnding, add_while_waiting: bool) {
    let fixture = TestFile::new("active-clear-stop");
    let destination = destination_root(&fixture, "out");
    let (runner, started, release) = StopAwareRunner::parked(ending);
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    let paths = [fixture.thermo_raw("one.raw"), fixture.thermo_raw("two.raw")];
    let handles: Vec<_> = paths
        .iter()
        .map(|path| add_one_acquisition(&service, path))
        .collect();
    let document = current_document(&service);
    let reservation = service
        .begin_conversion_now(&handles, ConversionConflictPolicyDto::Fail, document)
        .unwrap();
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .unwrap();
    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    let plan = service.plan_workspace_clear(document).unwrap();
    assert_eq!(plan.protected_count, 2);
    let addition = fixture.thermo_raw("new.raw");
    let clearer = {
        let service = Arc::clone(&service);
        std::thread::spawn(move || {
            service.execute_workspace_clear_after_quiescence_for_test(
                &plan.plan_id,
                Action::CancelAndClear,
                document,
                || {
                    if add_while_waiting {
                        add_one_acquisition(&service, &addition);
                    }
                },
            )
        })
    };
    service.wait_for_clear_cancellation_request_for_test(operation);
    assert_eq!(
        service.roster().datasets.len(),
        2,
        "pending stop has not released rows"
    );
    release.send(()).unwrap();
    let settled = worker.join().unwrap();
    let outcome = clearer.join().unwrap();
    if matches!(ending, StopEnding::Survivors | StopEnding::Unterminated) {
        assert!(matches!(
            outcome,
            Outcome::Refused {
                reason: Refusal::Quarantined
            }
        ));
        assert_eq!(service.roster().datasets.len(), 2);
        assert!(service.backend_is_quarantined());
    } else if add_while_waiting {
        assert!(matches!(
            outcome,
            Outcome::Refused {
                reason: Refusal::StalePlan
            }
        ));
        assert_eq!(service.roster().datasets.len(), 3);
    } else {
        assert!(matches!(outcome, Outcome::Removed { .. }));
        assert!(service.roster().datasets.is_empty());
    }
    assert!(paths.iter().all(|path| path.exists()));
    if ending == StopEnding::NaturalSuccess {
        assert_eq!(terminal_queue(&settled).finalized_count, 1);
        assert!(destination.join("one.mzML").exists());
    } else if matches!(ending, StopEnding::Confirmed) {
        assert_eq!(terminal_queue(&settled).cancelled_count, 1);
    }
}
