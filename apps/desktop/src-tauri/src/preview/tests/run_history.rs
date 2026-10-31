//! The queue feeding the conversion run history (ADR 0065).

use super::*;
use crate::project::tests::Scratch;
use crate::run_history::{
    ConversionHistory, RunHistoryListDto, RunHistoryReadDto, RunState, SetCompleteness,
};

#[test]
fn a_finished_queue_is_recorded_with_its_sources_and_outputs_and_the_wire_names_no_path() {
    let fixture = TestFile::new("run-history-queue");
    let destination = destination_root(&fixture, "out");
    let profile = Scratch::new("run-history-queue-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    service.attach_run_history(Arc::clone(&history));
    let source = fixture.thermo_raw("first.raw");
    let first = add_one_acquisition(&service, &source);
    let second = add_one_acquisition(&service, &fixture.thermo_raw("second.raw"));

    let update = queue_and_run(&service, &[first, second], &destination);
    assert_eq!(terminal_queue(&update).finalized_count, 2);

    let RunHistoryListDto::Listed { runs, problem, .. } = history.list() else {
        panic!("the history lists");
    };
    assert_eq!(problem, None, "every write was made");
    assert_eq!(runs.len(), 1, "one queue, one run");
    let run = &runs[0];
    assert_eq!(run.state, RunState::Completed);
    assert!(run.ended_at_ms.is_some());
    assert_eq!((run.item_count, run.finalized_count, run.passes), (2, 2, 1));
    let RunHistoryReadDto::Found { items, .. } = history.read(&run.run_id) else {
        panic!("the run reads back");
    };
    assert_eq!(items[0].display_name, "first.raw");
    assert_eq!(items[0].family, "thermo_raw");
    assert_eq!(items[0].progress.state, "finalized");
    let output = &items[0].progress.outputs[0];
    assert_eq!(output.file_name, "first.mzML");
    assert!(output.sha256.is_some() && output.checks.is_some());

    // The locators stay in the file, for this machine; the wire names none.
    // Spelled as admission canonicalized them: on a profile with an 8.3 short
    // name the fixture's own spelling is a different string.
    let escaped = |path: &Path| {
        let canonical = fs::canonicalize(path).expect("the fixture resolves");
        let plain = canonical
            .to_str()
            .expect("a UTF-8 fixture path")
            .trim_start_matches(r"\\?\");
        serde_json::to_string(plain)
            .expect("serializes")
            .trim_matches('"')
            .to_owned()
    };
    let stored = fs::read_to_string(
        profile
            .join("app")
            .join("conversion-history")
            .join(format!("run-{}.json", run.run_id)),
    )
    .expect("the run's document");
    assert!(stored.contains(&escaped(&source)));
    let wire = format!(
        "{}{}",
        serde_json::to_string(&history.list()).expect("serializes"),
        serde_json::to_string(&history.read(&run.run_id)).expect("serializes")
    );
    assert!(!wire.contains(&escaped(&source)));
    assert!(!wire.contains(&escaped(&destination)));
    // Nor a drive path of any spelling.
    assert!(!wire.contains(":\\\\"), "{wire}");
}

/// The item converting is on disk as `running` before its process starts, so
/// a session that ends there leaves it `interrupted`, never "not run".
#[test]
fn an_item_converting_when_the_session_ends_is_interrupted_not_never_run() {
    let fixture = TestFile::new("run-history-mid-item");
    let destination = destination_root(&fixture, "out");
    let profile = Scratch::new("run-history-mid-item-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    let (runner, observe_start, release) =
        FakeConversionRunner::new(BackendAct::Convert).blocking();
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    service.attach_run_history(Arc::clone(&history));
    let handles: Vec<String> = ["first.raw", "second.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();
    let document = current_document(&service);
    let reservation = service
        .begin_conversion_now(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let draining = std::thread::spawn({
        let service = Arc::clone(&service);
        let destination = destination.clone();
        move || service.run_claimed_conversion(operation, &destination)
    });
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the first item reached its process");

    // What the disk says at this moment is what a session ending here leaves.
    let RunHistoryListDto::Listed { runs, .. } = history.list() else {
        panic!("the history lists");
    };
    let name = format!("run-{}.json", runs[0].run_id);
    let stored = profile.join("app").join("conversion-history").join(&name);
    let ended = Scratch::new("run-history-mid-item-ended");
    let ended_directory = ended.join("app").join("conversion-history");
    fs::create_dir_all(&ended_directory).expect("the ended session's history");
    fs::copy(&stored, ended_directory.join(&name)).expect("copy the run as it stood");
    release.send(()).expect("release the parked conversion");
    draining.join().expect("the queue finishes");

    let snapshot: serde_json::Value =
        serde_json::from_slice(&fs::read(ended_directory.join(&name)).expect("read the copy"))
            .expect("a run document");
    let states: Vec<&str> = snapshot["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| item["progress"]["state"].as_str().expect("a state"))
        .collect();
    assert_eq!(states, ["running", "pending"]);

    // Its owner's lock is not there, so the next start finds it ended.
    let next = ConversionHistory::open(Ok(ended.join("app")));
    let RunHistoryReadDto::Found { run, items } = next.read(&runs[0].run_id) else {
        panic!("the run reads back");
    };
    assert_eq!(run.state, RunState::Interrupted);
    assert_eq!(
        items
            .iter()
            .map(|item| item.progress.state.as_str())
            .collect::<Vec<_>>(),
        ["interrupted", "notRun"]
    );
}

/// A SCIEX set records the completeness finding and whether it could be
/// adopted whole, by stable identifiers, beside its members.
#[test]
fn a_set_records_its_completeness_and_whether_it_was_adoptable() {
    let (_fixture, service, handle, destination) = private_sciex_queue(
        "run-history-set",
        FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]).also_converting(),
    );
    let profile = Scratch::new("run-history-set-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    service.attach_run_history(Arc::clone(&history));
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let report = item_set_report(&terminal_queue(&update).items[0])
        .expect("a set item carries its group report");

    let RunHistoryListDto::Listed { runs, .. } = history.list() else {
        panic!("the history lists");
    };
    let RunHistoryReadDto::Found { items, .. } = history.read(&runs[0].run_id) else {
        panic!("the run reads back");
    };
    let progress = &items[0].progress;
    assert_eq!(progress.outputs.len(), 2);
    assert_eq!(progress.set_adoptable, Some(report.complete_set_adoptable));
    let super::super::dto::ConversionSampleCompletenessDto::Established {
        method,
        sample_count,
    } = &report.completeness
    else {
        panic!("the fake set establishes completeness");
    };
    assert_eq!(
        progress.completeness,
        Some(SetCompleteness::Established {
            method: method.clone(),
            sample_count: *sample_count,
        })
    );
}
