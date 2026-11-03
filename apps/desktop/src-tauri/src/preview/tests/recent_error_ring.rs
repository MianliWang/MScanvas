//! ADR 0063, question 7: a failed conversion's outcome joins the recent-error
//! ring, once per run, where the session builds its report from the run.

use super::*;
use crate::environment_diagnostics::NOTED_ON_THIS_THREAD;
use crate::preview::dto::ConversionReportDto;

/// What `run` noted on this thread, whatever the rest of the suite is doing.
///
/// Less `file_not_resolvable`: the fake installation names tools that are not
/// there, and each look at one builds and discards that error (decision 5).
fn noted_during<T>(run: impl FnOnce() -> T) -> (T, Vec<String>) {
    NOTED_ON_THIS_THREAD.take();
    let value = run();
    let mut noted = NOTED_ON_THIS_THREAD.take();
    noted.retain(|code| code != "file_not_resolvable");
    (value, noted)
}

fn shimadzu_run(act: BackendAct, label: &str) -> ConversionReportDto {
    let fixture = TestFile::new(label);
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");
    let destination = fixture.destination("out");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(act),
    )));
    let dataset = service
        .add_shimadzu_dataset(&acquisition)
        .expect("admit the acquisition");
    service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome")
        .to_dto()
}

#[test]
fn a_failed_run_joins_the_ring_by_its_detailed_outcome() {
    let (report, noted) = noted_during(|| shimadzu_run(BackendAct::WriteNothing, "ring-failed"));
    assert_eq!(report.outcome, "output_rejected");
    assert_eq!(report.detailed_outcome.as_deref(), Some("missing_output"));
    assert_eq!(noted, ["missing_output"]);
}

#[test]
fn a_finalized_run_notes_nothing() {
    let (report, noted) = noted_during(|| shimadzu_run(BackendAct::Convert, "ring-finalized"));
    assert_eq!(report.detailed_outcome, None);
    assert!(noted.is_empty(), "{noted:?}");
}

/// The trap ADR 0063 rejects: a queue is read again and again, and two failed
/// rows read in turn would push every other code out of the ring.
#[test]
fn reading_a_failed_queue_again_notes_nothing_more() {
    let fixture = TestFile::new("ring-read-again");
    let destination = fixture.destination("out");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::WriteNothing),
    )));
    let rows = [
        add_one_acquisition(&service, &fixture.thermo_raw("first.raw")),
        add_one_acquisition(&service, &fixture.thermo_raw("second.raw")),
    ];
    let (update, noted) = noted_during(|| {
        run_visible_queue(
            &service,
            &rows,
            &destination,
            ConversionConflictPolicyDto::Fail,
        )
    });
    assert_eq!(terminal_queue(&update).failed_count, 2);
    assert_eq!(noted, ["missing_output", "missing_output"]);

    let (_, noted) = noted_during(|| {
        for _ in 0..3 {
            service.conversion_state();
        }
    });
    assert!(noted.is_empty(), "{noted:?}");
}

/// A set with no detailed outcome is named by its group outcome.
#[test]
fn a_partially_published_set_joins_the_ring_by_its_group_outcome() {
    let fixture = TestFile::new("ring-partial");
    let destination = fixture.destination("out");
    let raced = destination.join("a-S2.mzML");
    let service = output_set_service(
        FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"]).also_converting(),
    );
    service.race_next_publication(move |position| {
        if position == 1 {
            fs::write(&raced, b"raced in").expect("occupy the second name mid-set");
        }
    });
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");

    let (update, noted) = noted_during(|| {
        run_visible_queue(
            &service,
            &[sciex.handle],
            &destination,
            ConversionConflictPolicyDto::Fail,
        )
    });
    assert_eq!(terminal_queue(&update).failed_count, 1);
    assert_eq!(noted, ["partially_finalized"]);
}

/// A set refused before publication is named by the refusal, not the group.
#[test]
fn a_refused_set_joins_the_ring_by_its_refusal() {
    let fixture = TestFile::new("ring-refused");
    let destination = fixture.destination("out");
    let service = output_set_service(
        FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"])
            .also_converting()
            .complaining(READER_LOST_A_SAMPLE),
    );
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");

    let (update, noted) = noted_during(|| {
        run_visible_queue(
            &service,
            &[sciex.handle],
            &destination,
            ConversionConflictPolicyDto::Fail,
        )
    });
    assert_eq!(terminal_queue(&update).failed_count, 1);
    assert_eq!(noted, ["source_sample_failure_observed"]);
}

/// A set that published whole and can be adopted is a success.
#[test]
fn a_complete_set_notes_nothing() {
    let fixture = TestFile::new("ring-complete");
    let destination = fixture.destination("out");
    let service = output_set_service(FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");

    let (update, noted) = noted_during(|| {
        run_visible_queue(
            &service,
            &[sciex.handle],
            &destination,
            ConversionConflictPolicyDto::Fail,
        )
    });
    assert_eq!(
        item_states(terminal_queue(&update)),
        vec![ConversionQueueItemStateDto::Finalized]
    );
    assert!(noted.is_empty(), "{noted:?}");
}

/// Skipping names that are taken is what the user asked for, not a failure.
#[test]
fn a_skipped_set_notes_nothing() {
    let fixture = TestFile::new("ring-skipped");
    let destination = fixture.destination("out");
    for name in ["a-S1.mzML", "a-S2.mzML"] {
        fs::write(destination.join(name), b"the user converted this before")
            .expect("occupy a name");
    }
    let service = output_set_service(FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");

    let (update, noted) = noted_during(|| {
        run_visible_queue(
            &service,
            &[sciex.handle],
            &destination,
            ConversionConflictPolicyDto::Skip,
        )
    });
    assert_eq!(
        item_states(terminal_queue(&update)),
        vec![ConversionQueueItemStateDto::Skipped]
    );
    assert!(noted.is_empty(), "{noted:?}");
}

/// The one failure that reads like a success (ADR 0063, decision 5): the set
/// published whole, but without established completeness it cannot be adopted.
#[test]
fn a_whole_set_that_cannot_be_adopted_notes_fully_finalized() {
    let fixture = TestFile::new("ring-not-adoptable");
    let destination = fixture.destination("out");
    let service = output_set_service(FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    service.forget_next_set_completeness();

    let (update, noted) = noted_during(|| {
        run_visible_queue(
            &service,
            &[sciex.handle],
            &destination,
            ConversionConflictPolicyDto::Fail,
        )
    });
    assert_eq!(
        item_states(terminal_queue(&update)),
        vec![ConversionQueueItemStateDto::Failed]
    );
    assert_eq!(noted, ["fully_finalized"]);
}

/// A stop is what the user asked for. It runs on the helper's own thread, so
/// this reads the ring itself; nothing else in the suite may ever record the code.
#[test]
fn a_stopped_set_is_not_a_failure() {
    let (_fixture, _destination, _service, update, _launches) =
        stop_mid_sciex_item("ring-stopped", StopEnding::Confirmed);
    assert_eq!(
        item_states(terminal_queue(&update))[0],
        ConversionQueueItemStateDto::Cancelled
    );
    assert!(
        crate::environment_diagnostics::recent_errors()
            .0
            .iter()
            .all(|entry| entry.code != "multi_output_cancelled")
    );
}
