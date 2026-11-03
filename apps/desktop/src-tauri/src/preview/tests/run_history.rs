//! The queue feeding the conversion run history (ADR 0065).

use super::*;
use crate::project::tests::Scratch;
use crate::run_history::{
    ConversionHistory, ItemProgress, RunHistoryListDto, RunHistoryReadDto, RunHistoryWriteDto,
    RunState, SetCompleteness,
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
    let document: serde_json::Value = serde_json::from_str(&stored).expect("a document");
    let recorded_source = &document["items"][0]["source"];
    assert_members(&recorded_source["members"], std::slice::from_ref(&source));
    assert_eq!(
        recorded_source["destination"].as_str().map(plain_path),
        Some(plain_path(
            fs::canonicalize(&destination)
                .expect("the folder resolves")
                .to_str()
                .expect("a UTF-8 fixture path")
        ))
    );
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

/// A path without the verbatim prefix admission may spell it with.
fn plain_path(path: &str) -> String {
    path.trim_start_matches(r"\\?\").to_owned()
}

/// Every member, primary first, with the identity the file itself answers.
fn assert_members(members: &serde_json::Value, files: &[PathBuf]) {
    let members = members.as_array().expect("members");
    assert_eq!(members.len(), files.len());
    for (member, file) in members.iter().zip(files) {
        let canonical = fs::canonicalize(file).expect("the file resolves");
        assert_eq!(
            member["path"].as_str().map(plain_path),
            canonical.to_str().map(plain_path)
        );
        assert_eq!(
            member["byteLength"],
            fs::metadata(file).expect("the file").len()
        );
        let (volume, id) = crate::local_document::object_identity(file).expect("its identity");
        assert_eq!(member["volumeSerial"], volume);
        let id: String = id.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(member["fileId"], id);
    }
}

/// What the run's document holds, which the wire never carries.
fn stored_document(profile: &Scratch, run_id: &str) -> serde_json::Value {
    let file = profile
        .join("app")
        .join("conversion-history")
        .join(format!("run-{run_id}.json"));
    serde_json::from_slice(&fs::read(file).expect("the run's document")).expect("a document")
}

/// The record says what the queue's own label says (ADR 0055), for a row on the
/// measured build and for a row on a build MSCanvas did not measure.
#[test]
fn a_row_records_whether_its_settings_and_its_build_were_verified() {
    const UNMEASURED: &str = "3.0.26204";
    for (capabilities, release, build_verified) in [
        (evidenced_capabilities(), EVIDENCED_RELEASE, true),
        (
            conversion_capabilities(UNMEASURED, Some("a09eea9"), EVIDENCED_EXECUTABLE_SHA256),
            UNMEASURED,
            false,
        ),
    ] {
        let fixture = TestFile::new("run-history-row-label");
        let destination = destination_root(&fixture, "out");
        let profile = Scratch::new("run-history-row-label-profile");
        let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
        let service = PreviewService::new(Box::new(ConvertingProvider::new(
            capabilities,
            FakeConversionRunner::new(BackendAct::Convert),
        )));
        service.attach_run_history(Arc::clone(&history));
        let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
        let update = queue_and_run(&service, &[handle], &destination);
        let label = terminal_queue(&update).items[0]
            .not_verified_by_mscanvas
            .clone();
        let settings_verified = label
            .as_ref()
            .is_none_or(|label| !label.unverified_settings);

        let runs = recorded(&profile, &history);
        let RunHistoryReadDto::Found { run, items } = history.read(&runs[0].run_id) else {
            panic!("the run reads back");
        };
        for summary in [&runs[0], &run] {
            assert_eq!(
                summary.settings_row,
                Some(ConversionIntent::SHIPPED.stable_id())
            );
            assert_eq!(summary.settings_verified, settings_verified, "{release}");
            assert_eq!(summary.build_verified, build_verified, "{release}");
            assert_eq!(summary.build_release.as_deref(), Some(release));
        }
        assert_eq!(items[0].settings_verified, settings_verified, "{release}");
        assert_eq!(items[0].build_verified, build_verified, "{release}");
        assert_eq!(
            label.is_none(),
            settings_verified && build_verified,
            "{release}"
        );
        if build_verified {
            assert!(settings_verified, "the measured row on its measured build");
        }
    }
}

/// Advanced settings are no row, and are labelled at the run and at each file.
#[test]
fn an_advanced_intent_records_no_row_and_unverified_settings() {
    let fixture = TestFile::new("run-history-advanced");
    let profile = Scratch::new("run-history-advanced-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    let service = PreviewService::new(Box::new(ConvertingProvider::offering_every_admitted_row()));
    service.attach_run_history(Arc::clone(&history));
    let handle = service
        .add_dataset(&fixture.readable_mzml("run.mzML"))
        .expect("add an mzML row")
        .handle;
    let document = current_document(&service);
    let request = ConversionBeginRequestDto {
        handles: vec![handle],
        intent_id: None,
        intent: Some(crate::preview::dto::ConversionIntentWireDto(
            serde_json::json!({
                "output": {
                    "format": "mzml",
                    "mz": { "encoding": "plain", "bits": 64 },
                    "intensity": { "encoding": "plain", "bits": 32 },
                    "zlib": true,
                    "index": true
                },
                "spectrumFilters": [{ "kind": "ms_level", "levels": [{ "start": 1, "end": 1 }] }],
                "chromatogramFilters": [],
                "switches": []
            }),
        )),
        conflict_policy: ConversionConflictPolicyDto::Fail,
        expected_receipt: service.readied_receipt(),
        destination_policy: None,
    };
    let reservation = match service
        .begin_conversion_queue_under(&request, document, DestinationPolicy::SourceSibling)
        .outcome
    {
        ConversionBeginOutcomeDto::Reserved { reservation } => reservation,
        ConversionBeginOutcomeDto::Refused { error } => panic!("refused: {error:?}"),
    };
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("the reservation is claimed");
    service.resolve_claimed_conversion(operation);

    let runs = recorded(&profile, &history);
    let RunHistoryReadDto::Found { run, items } = history.read(&runs[0].run_id) else {
        panic!("the run reads back");
    };
    for summary in [&runs[0], &run] {
        assert_eq!(summary.settings_row, None);
        assert!(!summary.settings_verified);
        assert!(summary.build_release.is_some());
    }
    assert!(!items[0].settings_verified);
    assert!(
        crate::preview::service::read_structured_intent(
            &stored_document(&profile, &runs[0].run_id)["settings"]["intent"]
        )
        .is_ok()
    );
}

/// A retry's attempt is not its earlier attempt. Until it settles the record holds
/// none of that one's result, so a session that ends here leaves an outcome
/// unknown with no code beside it. The item this pass has not reached keeps its
/// failure, which is what it reads back as (ADR 0065 section 5).
#[test]
fn an_item_retrying_when_the_session_ends_keeps_nothing_of_its_earlier_attempt() {
    let fixture = TestFile::new("run-history-mid-retry");
    let destination = destination_root(&fixture, "out");
    let profile = Scratch::new("run-history-mid-retry-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    let (runner, started, release) = FakeConversionRunner::new(BackendAct::Convert).blocking();
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    service.attach_run_history(Arc::clone(&history));
    let files = [fixture.thermo_raw("one.raw"), fixture.thermo_raw("two.raw")];
    let handles = [
        add_one_acquisition(&service, &files[0]),
        add_one_acquisition(&service, &files[1]),
    ];
    let writers = [hold_for_writing(&files[0]), hold_for_writing(&files[1])];
    queue_and_run(&service, &handles, &destination);
    drop(writers);
    let runs = recorded(&profile, &history);
    let run_id = runs[0].run_id.clone();
    let read_items = |history: &ConversionHistory| {
        let RunHistoryReadDto::Found { items, .. } = history.read(&run_id) else {
            panic!("the run reads back");
        };
        items
    };
    let earlier = read_items(&history)[0].progress.failure.clone();
    assert!(earlier.is_some(), "the first pass failed by its code");

    let retry = std::thread::spawn({
        let service = Arc::clone(&service);
        let document = current_document(&service);
        move || service.retry_conversion_queue(document)
    });
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("the retry reaches its process");

    let running = read_items(&history);
    let blank = |state: &str, attempts: u64| ItemProgress {
        state: state.to_owned(),
        attempts,
        outcome: None,
        failure: None,
        outputs: Vec::new(),
        completeness: None,
        set_adoptable: None,
    };
    assert_eq!(running[0].progress, blank("running", 2));
    assert_eq!(
        (
            running[1].progress.state.as_str(),
            &running[1].progress.failure
        ),
        ("pending", &earlier)
    );

    // What the disk says at this moment is what a session ending here leaves.
    let name = format!("run-{run_id}.json");
    let ended = Scratch::new("run-history-mid-retry-ended");
    let ended_directory = ended.join("app").join("conversion-history");
    fs::create_dir_all(&ended_directory).expect("the ended session's history");
    fs::copy(
        profile.join("app").join("conversion-history").join(&name),
        ended_directory.join(&name),
    )
    .expect("copy the run as it stood");
    release.send(()).expect("release the parked conversion");
    retry
        .join()
        .expect("the retry finishes")
        .expect("the retry answers");

    let next = ConversionHistory::open(Ok(ended.join("app")));
    let items = read_items(&next);
    assert_eq!(items[0].progress, blank("interrupted", 2));
    assert_eq!(
        (items[1].progress.state.as_str(), &items[1].progress.failure),
        ("failed", &earlier)
    );
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
    let (fixture, service, handle, destination) = private_sciex_queue(
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
    let document = stored_document(&profile, &runs[0].run_id);
    assert_members(
        &document["items"][0]["source"]["members"],
        &[
            fixture.directory.join("acquisition.wiff"),
            fixture.companion_of("acquisition"),
        ],
    );
    assert!(document["items"][0]["source"]["destination"].is_string());
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

fn recorded(
    profile: &Scratch,
    history: &ConversionHistory,
) -> Vec<crate::run_history::RunSummaryDto> {
    let RunHistoryListDto::Listed { runs, problem, .. } = history.list() else {
        panic!("the history lists");
    };
    assert_eq!(problem, None, "every write was made");
    assert_eq!(
        fs::read_dir(profile.join("app").join("conversion-history"))
            .expect("the history's folder")
            .filter(|entry| {
                entry
                    .as_ref()
                    .expect("an entry")
                    .file_name()
                    .to_string_lossy()
                    .starts_with("run-")
            })
            .count(),
        runs.len(),
        "what is listed is what is on disk"
    );
    runs
}

/// What ended before a build was bound ran nothing, and leaves nothing.
#[test]
fn a_queue_refused_before_it_bound_a_build_leaves_no_record() {
    let fixture = TestFile::new("run-history-before-binding");
    let profile = Scratch::new("run-history-before-binding-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    service.attach_run_history(Arc::clone(&history));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    let document = current_document(&service);
    let reservation = service
        .begin_conversion_under_now(
            &[handle],
            ConversionConflictPolicyDto::Fail,
            document,
            DestinationPolicy::NamedSubfolder(SubfolderName::parse("converted").expect("a name")),
        )
        .expect("a queue");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    service.quarantine_backend_now();

    let update = service.resolve_claimed_conversion(operation);

    assert_eq!(
        terminal_queue(&update)
            .error
            .as_ref()
            .map(|error| error.kind.as_str()),
        Some("backend_quarantined")
    );
    assert!(recorded(&profile, &history).is_empty());
}

/// A refusal after the build was bound ended a run that ran, and says so by
/// its code: the item it kept from starting never ran.
#[test]
fn a_queue_refused_after_it_bound_a_build_records_its_failure_code() {
    let fixture = TestFile::new("run-history-after-binding");
    let profile = Scratch::new("run-history-after-binding-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::StrandAnOwnedProcess),
    )));
    service.attach_run_history(Arc::clone(&history));
    let first = add_one_acquisition(&service, &fixture.thermo_raw("first.raw"));
    let second = add_one_acquisition(&service, &fixture.thermo_raw("second.raw"));
    let document = current_document(&service);
    let reservation = service
        .begin_conversion_under_now(
            &[first, second],
            ConversionConflictPolicyDto::Fail,
            document,
            DestinationPolicy::NamedSubfolder(SubfolderName::parse("converted").expect("a name")),
        )
        .expect("a queue");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    assert!(service.start_resolved_for_test(operation, None));

    let update = service.drain_queue_for_test(operation);

    let runs = recorded(&profile, &history);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].failure.as_deref(), Some("backend_quarantined"));
    assert!(runs[0].ended_at_ms.is_some());
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    assert_eq!(runs[0].state, RunState::Completed);
    let RunHistoryReadDto::Found { items, .. } = history.read(&runs[0].run_id) else {
        panic!("the run reads back");
    };
    assert_eq!(items[1].progress.state, "notRun");
}

/// A stop ends the run as what it was, each item as the queue reports it.
#[test]
fn a_stopped_queue_is_recorded_as_stopped_and_an_unconfirmed_stop_as_stop_failed() {
    for (ending, state) in [
        (StopEnding::Confirmed, RunState::Stopped),
        (StopEnding::Survivors, RunState::StopFailed),
    ] {
        let fixture = TestFile::new("run-history-stop");
        let destination = destination_root(&fixture, "out");
        let profile = Scratch::new("run-history-stop-profile");
        let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
        let (runner, started, release) = StopAwareRunner::parked(ending);
        let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
            evidenced_capabilities(),
            runner,
        ))));
        service.attach_run_history(Arc::clone(&history));
        let handles: Vec<String> = ["one.raw", "two.raw"]
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
        let worker = {
            let service = Arc::clone(&service);
            std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
        };
        started
            .recv_timeout(Duration::from_secs(10))
            .expect("the first item reaches its process");
        service
            .stop_conversion_queue(&operation.to_string(), document)
            .expect("stoppable");
        // Asked while it stops: the queue is still running, and so is the run.
        assert_eq!(recorded(&profile, &history)[0].state, RunState::Running);
        release.send(()).expect("release the parked conversion");
        let update = worker.join().expect("the queue worker finishes");

        let runs = recorded(&profile, &history);
        assert_eq!((runs[0].state, runs.len()), (state, 1), "{ending:?}");
        assert!(runs[0].ended_at_ms.is_some());
        let RunHistoryReadDto::Found { items, .. } = history.read(&runs[0].run_id) else {
            panic!("the run reads back");
        };
        let wire: Vec<serde_json::Value> = terminal_queue(&update)
            .items
            .iter()
            .map(|item| serde_json::to_value(item.state).expect("serializes"))
            .collect();
        let stored: Vec<serde_json::Value> = items
            .iter()
            .map(|item| serde_json::Value::from(item.progress.state.clone()))
            .collect();
        assert_eq!(stored, wire, "{ending:?}");
    }
}

/// A retry is the same queue, so the same record, and what is stored holds a
/// settings intent the only judge of one accepts: schema 1 is fixed now, and a
/// re-run reads it through that judge.
#[test]
fn a_retry_reopens_the_record_and_the_stored_intent_passes_the_judge() {
    let fixture = TestFile::new("run-history-retry");
    let destination = destination_root(&fixture, "out");
    let profile = Scratch::new("run-history-retry-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    service.attach_run_history(Arc::clone(&history));
    let done = add_one_acquisition(&service, &fixture.thermo_raw("done.raw"));
    let held = fixture.thermo_raw("held.raw");
    let blocked = add_one_acquisition(&service, &held);
    let writer = hold_for_writing(&held);
    queue_and_run(&service, &[done, blocked], &destination);
    drop(writer);

    let first = recorded(&profile, &history);
    assert_eq!(
        (first[0].state, first[0].passes, first[0].failed_count),
        (RunState::Completed, 1, 1)
    );
    let file = profile
        .join("app")
        .join("conversion-history")
        .join(format!("run-{}.json", first[0].run_id));
    let stored: serde_json::Value =
        serde_json::from_slice(&fs::read(&file).expect("the run's document")).expect("a document");
    assert!(
        crate::preview::service::read_structured_intent(&stored["settings"]["intent"]).is_ok(),
        "{}",
        stored["settings"]
    );
    assert_eq!(stored["conflictPolicy"], "fail");

    service
        .retry_conversion_queue(current_document(&service))
        .expect("the retry answers");

    let again = recorded(&profile, &history);
    assert_eq!(again.len(), 1, "a retry is not a new run");
    assert_eq!(again[0].run_id, first[0].run_id);
    assert_eq!((again[0].state, again[0].passes), (RunState::Completed, 2));
    assert_eq!((again[0].finalized_count, again[0].failed_count), (2, 0));
}

/// A retry refused before it bound a build ran nothing, so the ended record
/// stays as it was: not reopened, and not given that refusal's code.
#[test]
fn a_retry_refused_before_it_bound_a_build_leaves_the_record_as_it_was() {
    let fixture = TestFile::new("run-history-retry-refused");
    let destination = destination_root(&fixture, "out");
    let profile = Scratch::new("run-history-retry-refused-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    let provider = ConvertingProvider::faithful();
    let label = provider.installation_label();
    let service = PreviewService::new(Box::new(provider));
    service.attach_run_history(Arc::clone(&history));
    let done = add_one_acquisition(&service, &fixture.thermo_raw("done.raw"));
    let held = fixture.thermo_raw("held.raw");
    let blocked = add_one_acquisition(&service, &held);
    let writer = hold_for_writing(&held);
    queue_and_run(&service, &[done, blocked], &destination);
    drop(writer);
    let before = recorded(&profile, &history);

    *label.lock().expect("the installation label") = String::from("other-msconvert");
    let update = service
        .retry_conversion_queue(current_document(&service))
        .expect("the retry answers");

    assert_eq!(
        terminal_queue(&update)
            .error
            .as_ref()
            .map(|error| error.kind.as_str()),
        Some("queue_installation_changed")
    );
    assert_eq!(recorded(&profile, &history), before);
}

/// The interface offers the list, Clear and Off, so the application attaches the
/// store (ADR 0065 question 6). Host wiring no unit test can run.
#[test]
fn the_application_attaches_the_store_to_the_queue() {
    assert!(include_str!("../../lib.rs").contains(".attach_run_history("));
}

/// Every field, state and outcome the wire carries is one the webview's types
/// spell, so a rename here cannot quietly blank a row there.
#[test]
fn the_webview_types_spell_every_name_the_wire_carries() {
    fn keys_of(value: &serde_json::Value, keys: &mut std::collections::BTreeSet<String>) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, inner) in map {
                    keys.insert(key.clone());
                    keys_of(inner, keys);
                }
            }
            serde_json::Value::Array(values) => {
                values.iter().for_each(|inner| keys_of(inner, keys));
            }
            _ => {}
        }
    }
    let fixture = TestFile::new("run-history-spelling");
    let destination = destination_root(&fixture, "out");
    let profile = Scratch::new("run-history-spelling-profile");
    let history = Arc::new(ConversionHistory::open(Ok(profile.join("app"))));
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    service.attach_run_history(Arc::clone(&history));
    let first = add_one_acquisition(&service, &fixture.thermo_raw("first.raw"));
    queue_and_run(&service, &[first], &destination);
    let RunHistoryListDto::Listed { runs, .. } = history.list() else {
        panic!("the history lists");
    };
    let answers = [
        serde_json::to_value(history.list()).expect("serializes"),
        serde_json::to_value(history.read(&runs[0].run_id)).expect("serializes"),
        serde_json::to_value(SetCompleteness::Established {
            method: "audit".to_owned(),
            sample_count: 1,
        })
        .expect("serializes"),
        serde_json::to_value(SetCompleteness::NotEstablished {
            reason: "unknown".to_owned(),
        })
        .expect("serializes"),
        serde_json::to_value(RunHistoryWriteDto::Failed {
            problem: "notRemoved",
            not_removed: 1,
        })
        .expect("serializes"),
        serde_json::to_value(RunHistoryWriteDto::Done {
            kept_in_progress: 0,
        })
        .expect("serializes"),
    ];
    let api = include_str!("../../../../src/features/run-history/runHistoryApi.ts");
    let mut keys = std::collections::BTreeSet::new();
    answers.iter().for_each(|answer| keys_of(answer, &mut keys));
    assert!(keys.contains("keptInProgress") && keys.contains("sampleCount"));
    for key in keys {
        assert!(api.contains(&format!("readonly {key}")), "{key}");
    }
    let outcomes = [
        serde_json::to_value(RunHistoryListDto::Unavailable { problem: "x" }),
        serde_json::to_value(RunHistoryReadDto::NotFound),
        serde_json::to_value(RunHistoryReadDto::Refused { problem: "x" }),
        serde_json::to_value(RunHistoryWriteDto::Unavailable { problem: "x" }),
    ];
    for outcome in answers.iter().take(2).chain(answers.iter().skip(4)).chain(
        outcomes
            .iter()
            .map(|outcome| outcome.as_ref().expect("serializes")),
    ) {
        let tag = outcome["outcome"].as_str().expect("a tagged outcome");
        assert!(api.contains(&format!("\"{tag}\"")), "{tag}");
    }
    for state in [
        RunState::Running,
        RunState::Completed,
        RunState::Stopped,
        RunState::StopFailed,
        RunState::Interrupted,
    ] {
        let spelled = serde_json::to_value(state).expect("serializes");
        assert!(api.contains(&format!("{spelled}")), "{spelled}");
    }
}
