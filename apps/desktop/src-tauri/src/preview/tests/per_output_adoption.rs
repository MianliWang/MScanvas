//! ADR 0052: one finalized output of a terminal queue, named by the opaque id
//! its item carries, adopted through the queue-wide adoption.

use super::*;

/// The output ids one item of the current queue carries, in member order.
fn output_ids(service: &PreviewService, item: usize) -> Vec<String> {
    queue_of(&service.conversion_state()).items[item]
        .finalized_outputs
        .iter()
        .map(|output| output.output_id.clone())
        .collect()
}

/// The queue the slot holds, whatever state it is in.
fn queue_of(update: &WorkspaceConversionUpdateDto) -> &ConversionQueueDto {
    match &update.state {
        WorkspaceConversionStateDto::Running { queue, .. }
        | WorkspaceConversionStateDto::Stopping { queue, .. }
        | WorkspaceConversionStateDto::Terminal { queue, .. } => queue,
        other => panic!("the slot holds a queue; got {other:?}"),
    }
}

fn adopt_one(
    service: &PreviewService,
    operation: u64,
    output_id: &str,
) -> Result<WorkspaceOutputAdoptionResultDto, PreviewErrorDto> {
    service.adopt_conversion_output(&operation.to_string(), output_id, current_document(service))
}

fn item_adoption(service: &PreviewService, item: usize) -> ConversionItemAdoptionDto {
    terminal_queue(&service.conversion_state()).items[item]
        .adoption
        .clone()
}

fn settled(added: usize, already_in_workspace: usize) -> ConversionItemAdoptionDto {
    ConversionItemAdoptionDto::Settled {
        added,
        already_in_workspace,
        refused: 0,
        refusals: Vec::new(),
    }
}

fn added_name(result: &WorkspaceOutputAdoptionResultDto) -> &str {
    match result.outcomes.as_slice() {
        [WorkspaceOutputAdoptionOutcomeDto::Added { dataset, .. }] => &dataset.file_name,
        other => panic!("one output added; got {other:?}"),
    }
}

/// Every file under `root` with its bytes, so a test can say none was
/// written, moved or deleted.
fn files_under(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).expect("read a fixture directory") {
            let path = entry.expect("a fixture entry").path();
            if path.is_dir() {
                pending.push(path);
            } else {
                let bytes = fs::read(&path).expect("read a fixture file");
                files.push((path, bytes));
            }
        }
    }
    files.sort();
    files
}

/// Refused with the queue-wide action's own refusal, and nothing claimed: the
/// queue reads exactly as it did, the roster is unchanged, no adoption is left
/// in flight and no workspace generation was reserved -- a reserved one would
/// supersede an import the user started before this click.
fn assert_refused_and_nothing_claimed(service: &PreviewService, operation: u64, output_id: &str) {
    let queue = serde_json::to_value(service.conversion_state()).expect("the queue serializes");
    let roster = service.roster();
    let generation = service.reserve_folder_import().generation();
    let error = adopt_one(service, operation, output_id).expect_err("the output is not offered");
    assert_eq!(error.kind, "outputs_not_adoptable", "{output_id:?}");
    assert_eq!(
        service.reserve_folder_import().generation(),
        generation + 1,
        "a refusal reserved a workspace generation: {output_id:?}"
    );
    assert_eq!(
        serde_json::to_value(service.conversion_state()).expect("the queue serializes"),
        queue,
        "a refusal changed the queue: {output_id:?}"
    );
    assert_eq!(service.roster(), roster, "a refusal changed the roster");
    assert!(
        !service.adoption_is_in_flight(),
        "a refusal left the adoption flag claimed"
    );
}

#[test]
fn one_output_is_adopted_and_then_another() {
    let fixture = TestFile::new("per-output-two");
    let (service, _destination, operation, _document) =
        converted_queue(&fixture, &["one.raw", "two.raw"]);
    let files = files_under(&fixture.directory);
    let before = service.roster().datasets.len();

    let first = adopt_one(&service, operation, &output_ids(&service, 0)[0])
        .expect("an offered output is adoptable");
    assert_eq!(adoption_kinds(&first), vec!["added"]);
    assert_eq!(adoption_identities(&first.outcomes), vec![(0, 0)]);
    assert_eq!(added_name(&first), "one.mzML");
    assert_eq!(first.operation_id, operation.to_string());
    assert_eq!(first.roster.datasets.len(), before + 1);
    assert_eq!(item_adoption(&service, 0), settled(1, 0));
    assert_eq!(
        item_adoption(&service, 1),
        ConversionItemAdoptionDto::NotRequested,
        "an item nobody asked about was answered"
    );

    let second = adopt_one(&service, operation, &output_ids(&service, 1)[0])
        .expect("the other output is still offered");
    assert_eq!(adoption_identities(&second.outcomes), vec![(1, 0)]);
    assert_eq!(added_name(&second), "two.mzML");
    assert_eq!(second.roster.datasets.len(), before + 2);
    assert_eq!(item_adoption(&service, 0), settled(1, 0));
    assert_eq!(item_adoption(&service, 1), settled(1, 0));
    assert_eq!(
        files_under(&fixture.directory),
        files,
        "adoption wrote, moved or deleted a file"
    );
}

#[test]
fn adopting_the_same_output_twice_adds_it_once() {
    let fixture = TestFile::new("per-output-twice");
    let (service, _destination, operation, _document) = converted_queue(&fixture, &["one.raw"]);
    let id = &output_ids(&service, 0)[0];

    let first = adopt_one(&service, operation, id).expect("offered");
    let WorkspaceOutputAdoptionOutcomeDto::Added { dataset: added, .. } = &first.outcomes[0] else {
        panic!("the first adoption adds the output");
    };
    let second = adopt_one(&service, operation, id).expect("the ticket survives an attempt");
    let WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace { dataset, .. } = &second.outcomes[0]
    else {
        panic!("the second adoption finds the row the first added");
    };
    assert_eq!(dataset.handle, added.handle);
    assert_eq!(second.roster, first.roster);
    assert_eq!(item_adoption(&service, 0), settled(0, 1));
}

#[test]
fn an_output_this_queue_does_not_offer_is_refused_and_nothing_is_claimed() {
    let fixture = TestFile::new("per-output-unknown");
    let (service, destination, operation, _document) = converted_queue(&fixture, &["one.raw"]);
    let earlier = output_ids(&service, 0)[0].clone();

    // A second queue replaces the first in the slot; the earlier queue's id is
    // not this queue's to adopt.
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("two.raw"));
    let update = queue_and_run(&service, &[handle], &destination);
    let current = operation_of(&update);
    let id = output_ids(&service, 0)[0].clone();
    assert_ne!(id, earlier);
    let files = files_under(&fixture.directory);

    for unknown in [
        earlier.as_str(),
        "",
        "finalized-0",
        "not-an-output",
        &format!("{id} "),
        &id.to_uppercase(),
        &"x".repeat(4096),
    ] {
        assert_refused_and_nothing_claimed(&service, current, unknown);
    }
    // The right id under another operation, and under the replaced one.
    assert_refused_and_nothing_claimed(&service, current + 1, &id);
    assert_refused_and_nothing_claimed(&service, operation, &id);
    assert_eq!(files_under(&fixture.directory), files);

    // Nothing was claimed, so the queue-wide action is untouched.
    let result = adopt_visible(&service, current).expect("the queue is still adoptable");
    assert_eq!(adoption_kinds(&result), vec!["added"]);
}

/// A queue still under way offers nothing, even an output already finalized;
/// once it is terminal the same id is adopted, and a cancelled item offers
/// none.
#[test]
fn an_output_of_a_queue_still_under_way_is_refused_until_it_settles() {
    let fixture = TestFile::new("per-output-running");
    let destination = fixture.destination("out");
    let (runner, observed, release) = FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"])
        .also_converting()
        .parked_on_call(2, StopEnding::Confirmed);
    let service = Arc::new(output_set_service(runner));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("after.raw"))
        .expect("a Thermo row");
    let document = current_document(&service);
    let reservation = service
        .begin_conversion_now(
            &[sciex.handle.clone(), thermo.handle.clone()],
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("the reservation is claimed");
    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    observed
        .recv_timeout(Duration::from_secs(10))
        .expect("the second item started");

    let ids = output_ids(&service, 0);
    assert_eq!(ids.len(), 2, "the finalized set's outputs are on the wire");
    // The wire shape ADR 0052 decision 3 reads: the item-level signals already
    // say adoptable, and only the queue count says not yet.
    let running = service.conversion_state();
    let queue = queue_of(&running);
    assert_eq!(queue.adoptable_output_count, 0);
    assert_eq!(
        queue.items[0].adoption,
        ConversionItemAdoptionDto::NotRequested
    );
    assert!(
        item_set_report(&queue.items[0])
            .expect("the finalized set's report")
            .complete_set_adoptable
    );
    let roster = service.roster();
    let refused = adopt_one(&service, operation, &ids[0]).expect_err("the queue is running");
    assert_eq!(refused.kind, "outputs_not_adoptable");
    assert_eq!(service.roster(), roster);
    assert!(!service.adoption_is_in_flight());

    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the stop is accepted");
    release.send(()).expect("release the parked backend");
    let update = worker.join().expect("the worker finishes");
    assert_eq!(
        item_states(terminal_queue(&update)),
        vec![
            ConversionQueueItemStateDto::Finalized,
            ConversionQueueItemStateDto::Cancelled
        ]
    );
    assert!(
        output_ids(&service, 1).is_empty(),
        "a cancelled item has no output"
    );

    let result = adopt_one(&service, operation, &ids[0]).expect("the settled queue offers it");
    assert_eq!(adoption_identities(&result.outcomes), vec![(0, 0)]);
}

/// The finalized prefix of a partial set is on the wire for opening, and is
/// not adoptable one by one (ADR 0027); the complete item beside it is.
#[test]
fn a_member_of_a_partially_finalized_set_is_refused() {
    let fixture = TestFile::new("per-output-partial");
    let destination = fixture.destination("out");
    let raced = destination.join("a-S2.mzML");
    let runner =
        FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"]).also_converting();
    let service = Arc::new(output_set_service(runner));
    service.race_next_publication(move |position| {
        if position == 1 {
            fs::write(&raced, b"raced in after the preflight")
                .expect("occupy the second name mid-set");
        }
    });
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("after.raw"))
        .expect("a Thermo row");
    let update = run_visible_queue(
        &service,
        &[sciex.handle.clone(), thermo.handle.clone()],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    assert_eq!(
        item_states(terminal_queue(&update)),
        vec![
            ConversionQueueItemStateDto::Failed,
            ConversionQueueItemStateDto::Finalized
        ]
    );
    let prefix = output_ids(&service, 0);
    assert_eq!(prefix.len(), 1, "the finalized prefix is on the wire");
    let files = files_under(&fixture.directory);

    assert_refused_and_nothing_claimed(&service, operation, &prefix[0]);
    assert_eq!(
        item_adoption(&service, 0),
        ConversionItemAdoptionDto::NothingToAdopt
    );

    let result = adopt_one(&service, operation, &output_ids(&service, 1)[0])
        .expect("the complete item beside it is offered");
    assert_eq!(adoption_identities(&result.outcomes), vec![(1, 0)]);
    assert_eq!(added_name(&result), "after.mzML");
    assert_eq!(files_under(&fixture.directory), files);
}

/// A fully finalized set whose sample completeness was not established is
/// refused like a partial one, member by member and as a whole.
#[test]
fn a_member_of_a_set_without_established_completeness_is_refused() {
    let fixture = TestFile::new("per-output-incomplete");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(FakeOutputSetRunner::writing(&[
        "a-S1.mzML",
        "a-S2.mzML",
    ])));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    service.forget_next_set_completeness();
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    assert_eq!(
        item_states(terminal_queue(&update)),
        vec![ConversionQueueItemStateDto::Failed]
    );
    assert_eq!(adoptable_output_count(&update), 0);
    let members = output_ids(&service, 0);
    assert_eq!(members.len(), 2, "both members are on the wire for opening");
    let files = files_under(&fixture.directory);

    for member in &members {
        assert_refused_and_nothing_claimed(&service, operation, member);
    }
    assert_eq!(
        adopt_visible(&service, operation)
            .expect_err("nothing is offered")
            .kind,
        "outputs_not_adoptable"
    );
    assert_eq!(service.dataset_count(), 1, "only the acquisition");
    assert_eq!(files_under(&fixture.directory), files);
}

/// Each member of a complete SCIEX set is adopted by its own output id, in
/// any order, and keeps its `(item, member)` identity.
#[test]
fn a_complete_set_is_adopted_member_by_member() {
    let names = ["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"];
    let (fixture, service, handle, destination) =
        private_sciex_queue("per-output-set", FakeOutputSetRunner::writing(&names));
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    let members = output_ids(&service, 0);
    assert_eq!(members.len(), adoptable_output_count(&update));
    assert_eq!(members.len(), 3);
    let files = files_under(&fixture.directory);

    for member in [2, 0, 1] {
        let result = adopt_one(&service, operation, &members[member]).expect("a member is offered");
        assert_eq!(adoption_identities(&result.outcomes), vec![(0, member)]);
        assert_eq!(added_name(&result), names[member]);
        assert_eq!(item_adoption(&service, 0), settled(1, 0));
    }
    assert_eq!(
        service.dataset_count(),
        4,
        "the acquisition and its three outputs"
    );

    // The whole set again, queue-wide: every member is already there.
    let result = adopt_visible(&service, operation).expect("the set is still offered");
    assert_eq!(set_adoption_kinds(&result.outcomes), vec!["already"; 3]);
    assert_eq!(item_adoption(&service, 0), settled(0, 3));
    assert_eq!(files_under(&fixture.directory), files);
}

/// The item's record is the latest adoption's answer and nothing more (ADR
/// 0052, decision 5): one member's answer replaces a queue-wide one, dropping
/// the refusal of a member it did not check again.
#[test]
fn a_per_output_answer_replaces_the_items_earlier_answer() {
    let (_fixture, service, handle, destination) = private_sciex_queue(
        "per-output-replaces",
        FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"]),
    );
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    fs::write(destination.join("a-S2.mzML"), mzml_document(3, true))
        .expect("rewrite the second member");

    let result = adopt_visible(&service, operation).expect("the set is offered");
    assert_eq!(
        set_adoption_kinds(&result.outcomes),
        vec!["added", "refused", "added"]
    );
    assert_eq!(
        item_adoption(&service, 0),
        ConversionItemAdoptionDto::Settled {
            added: 2,
            already_in_workspace: 0,
            refused: 1,
            refusals: vec![String::from("output_changed")],
        }
    );

    adopt_one(&service, operation, &output_ids(&service, 0)[0]).expect("the member is offered");
    assert_eq!(item_adoption(&service, 0), settled(0, 1));
}

/// An output of a build MSCanvas did not measure carries the same label when
/// adopted on its own as when adopted with the queue (ADR 0055).
#[test]
fn the_unverified_build_label_travels_with_a_per_output_adoption() {
    const RELEASE: &str = "3.0.26204";
    let adopt = |label: &str, per_output: bool| {
        let fixture = TestFile::new(label);
        let destination = destination_root(&fixture, "out");
        let service = PreviewService::new(Box::new(ConvertingProvider::new(
            conversion_capabilities(RELEASE, Some("a09eea9"), EVIDENCED_EXECUTABLE_SHA256),
            FakeConversionRunner::new(BackendAct::Convert),
        )));
        let handle = add_one_acquisition(&service, &fixture.thermo_raw("acquisition.raw"));
        let operation = operation_of(&queue_and_run(&service, &[handle], &destination));
        let result = if per_output {
            adopt_one(&service, operation, &output_ids(&service, 0)[0])
        } else {
            adopt_visible(&service, operation)
        }
        .expect("the labelled output is adoptable");
        let [WorkspaceOutputAdoptionOutcomeDto::Added { dataset, .. }] = result.outcomes.as_slice()
        else {
            panic!("one output added: {:?}", result.outcomes);
        };
        assert_eq!(
            service.roster().datasets[1].not_verified_by_mscanvas,
            dataset.not_verified_by_mscanvas
        );
        dataset.not_verified_by_mscanvas.clone()
    };

    let label = crate::project::record::NotVerifiedByMscanvas::of(false, Some(RELEASE.to_owned()));
    assert!(label.is_some());
    assert_eq!(adopt("per-output-label-one", true), label);
    assert_eq!(adopt("per-output-label-queue", false), label);
}

#[test]
fn a_queue_wide_adoption_after_a_per_output_one_finds_it_there() {
    let fixture = TestFile::new("per-output-then-queue");
    let (service, _destination, operation, _document) =
        converted_queue(&fixture, &["one.raw", "two.raw"]);

    adopt_one(&service, operation, &output_ids(&service, 1)[0]).expect("offered");
    let result = adopt_visible(&service, operation).expect("the queue is still offered");
    assert_eq!(adoption_kinds(&result), vec!["added", "already"]);
    assert_eq!(adoption_identities(&result.outcomes), vec![(0, 0), (1, 0)]);
    assert_eq!(item_adoption(&service, 0), settled(1, 0));
    assert_eq!(item_adoption(&service, 1), settled(0, 1));
}

#[test]
fn a_per_output_adoption_after_a_queue_wide_one_finds_it_there() {
    let fixture = TestFile::new("queue-then-per-output");
    let (service, _destination, operation, _document) =
        converted_queue(&fixture, &["one.raw", "two.raw"]);

    let all = adopt_visible(&service, operation).expect("offered");
    assert_eq!(adoption_kinds(&all), vec!["added", "added"]);
    let result = adopt_one(&service, operation, &output_ids(&service, 1)[0])
        .expect("the output is still offered");
    assert_eq!(adoption_kinds(&result), vec!["already"]);
    assert_eq!(result.roster, all.roster);
    // Only the item asked about is answered again.
    assert_eq!(item_adoption(&service, 0), settled(1, 0));
    assert_eq!(item_adoption(&service, 1), settled(0, 1));
}
