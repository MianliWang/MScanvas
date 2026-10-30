//! The queue feeding the conversion run history (ADR 0065).

use super::*;
use crate::project::tests::Scratch;
use crate::run_history::{ConversionHistory, RunHistoryListDto, RunHistoryReadDto, RunState};

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
