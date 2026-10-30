use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::project::tests::Scratch;

use super::*;

/// A source path the wire must never carry. Forward slashes, so JSON does not
/// escape it and a plain search finds it wherever it went.
const SOURCE: &str = "C:/private-lab-folder/sample-a.raw";
const DESTINATION: &str = "C:/private-output-folder";

fn base(scratch: &Scratch) -> PathBuf {
    scratch.join("app")
}

fn open(scratch: &Scratch) -> ConversionHistory {
    ConversionHistory::open(Ok(base(scratch)))
}

fn history_directory(scratch: &Scratch) -> PathBuf {
    base(scratch).join(DIRECTORY)
}

fn source(name: &str) -> ItemSource {
    ItemSource {
        family: "thermo_raw".to_owned(),
        display_name: name.to_owned(),
        members: vec![SourceMember {
            path: SOURCE.to_owned(),
            byte_length: 10,
            volume_serial: 1,
            file_id: "0f".repeat(16),
        }],
        destination: Some(DESTINATION.to_owned()),
        settings_verified: true,
        build_verified: true,
    }
}

fn start(items: usize) -> RunStart {
    RunStart {
        settings: RunSettings {
            row: Some("mzml+no_additional_centroiding+all+mz64_intensity32+zlib".to_owned()),
            intent: serde_json::json!({ "output": { "format": "mzml" } }),
        },
        build_release: Some("3.0.26013".to_owned()),
        conflict_policy: "fail".to_owned(),
        items: (0..items)
            .map(|index| source(&format!("sample-{index}.raw")))
            .collect(),
    }
}

fn item(state: &str) -> ItemProgress {
    ItemProgress {
        state: state.to_owned(),
        attempts: u64::from(state != PENDING_ITEM),
        outcome: None,
        failure: None,
        outputs: Vec::new(),
    }
}

fn progress(state: RunState, items: &[&str]) -> RunProgress {
    RunProgress {
        state,
        passes: 1,
        failure: None,
        items: items.iter().map(|state| item(state)).collect(),
    }
}

fn runs(history: &ConversionHistory) -> Vec<RunSummaryDto> {
    match history.list() {
        RunHistoryListDto::Listed { runs, .. } => runs,
        other => panic!("a bound history lists; got {other:?}"),
    }
}

fn items(history: &ConversionHistory, run_id: &str) -> Vec<RunItemDto> {
    match history.read(run_id) {
        RunHistoryReadDto::Found { items, .. } => items,
        other => panic!("the run is found; got {other:?}"),
    }
}

fn entries(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(directory)
        .expect("the directory")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

fn run_files(scratch: &Scratch) -> Vec<String> {
    entries(&history_directory(scratch))
        .into_iter()
        .filter(|name| run_id_of_name(name).is_some())
        .collect()
}

#[test]
fn a_run_round_trips_through_a_restart_and_its_paths_stay_in_the_file() {
    let scratch = Scratch::new("history-round-trip");
    let history = open(&scratch);
    history.begin(
        7,
        start(2),
        progress(RunState::Running, &["running", "pending"]),
    );
    assert_eq!(runs(&history)[0].state, RunState::Running);

    let mut done = progress(RunState::Completed, &["finalized", "failed"]);
    done.items[0].outputs.push(RunOutput {
        file_name: "sample-0.mzML".to_owned(),
        state: None,
        byte_length: Some(1234),
        sha256: Some("ab".repeat(32)),
        checks: Some(OutputChecks {
            mode: "output_only".to_owned(),
            fully_verified: false,
            verified: vec!["well_formed".to_owned()],
            unverified: Vec::new(),
            inapplicable: vec!["source_equivalence".to_owned()],
            advisory: Vec::new(),
        }),
    });
    done.items[1].failure = Some("provider_exit_nonzero".to_owned());
    history.update(7, done.clone());
    // After the end, nothing further is written for this run.
    history.update(7, progress(RunState::Stopped, &["failed", "failed"]));
    drop(history);

    let again = open(&scratch);
    let listed = runs(&again);
    assert_eq!(listed.len(), 1);
    let run = &listed[0];
    assert_eq!(run.state, RunState::Completed);
    assert!(run.ended_at_ms.is_some());
    assert_eq!(
        (run.item_count, run.finalized_count, run.failed_count),
        (2, 1, 1)
    );
    assert!(run.settings_verified && run.build_verified);
    let detail = items(&again, &run.run_id);
    assert_eq!(detail[0].display_name, "sample-0.raw");
    assert_eq!(detail[0].progress, done.items[0]);
    assert_eq!(
        detail[1].progress.failure.as_deref(),
        Some("provider_exit_nonzero")
    );

    // The wire carries names, never a location.
    let wire = format!(
        "{}{}",
        serde_json::to_string(&again.list()).expect("the list serializes"),
        serde_json::to_string(&again.read(&run.run_id)).expect("the run serializes")
    );
    assert!(
        !wire.contains(SOURCE) && !wire.contains(DESTINATION),
        "{wire}"
    );
    // The file is where they are kept, for this machine only.
    let stored = fs::read_to_string(history_directory(&scratch).join(file_name_of(&run.run_id)))
        .expect("the run's document");
    assert!(stored.contains(SOURCE) && stored.contains(DESTINATION));

    // An identifier that is not a run's name is not a path into the folder.
    assert_eq!(again.read("../owner"), RunHistoryReadDto::NotFound);
}

#[test]
fn a_retry_pass_reopens_the_same_run() {
    let scratch = Scratch::new("history-retry");
    let history = open(&scratch);
    history.begin(3, start(1), progress(RunState::Running, &["running"]));
    history.update(3, progress(RunState::Completed, &["failed"]));
    let mut retry = progress(RunState::Running, &["running"]);
    retry.passes = 2;
    history.begin(3, start(1), retry);
    let mut retried = progress(RunState::Completed, &["finalized"]);
    retried.passes = 2;
    history.update(3, retried);

    let listed = runs(&history);
    assert_eq!(listed.len(), 1, "a retry is the same queue, not a new run");
    assert_eq!((listed[0].passes, listed[0].finalized_count), (2, 1));
}

#[test]
fn a_run_of_this_session_whose_end_was_never_written_is_not_shown_as_running() {
    let scratch = Scratch::new("history-own-unended");
    let history = open(&scratch);
    history.begin(1, start(1), progress(RunState::Running, &["running"]));
    // Its worker left without a terminal answer, and the next queue began.
    history.begin(2, start(1), progress(RunState::Running, &["running"]));

    let listed = runs(&history);
    let states: Vec<RunState> = listed.iter().map(|run| run.state).collect();
    assert_eq!(states.len(), 2);
    assert_eq!(
        states
            .iter()
            .filter(|state| **state == RunState::Running)
            .count(),
        1,
        "only the run being recorded is running: {states:?}"
    );
    assert!(states.contains(&RunState::Interrupted));
    assert_eq!(
        history.clear(),
        RunHistoryWriteDto::Done {
            kept_in_progress: 1
        }
    );
}

#[test]
fn two_instances_append_without_dropping_each_others_runs() {
    let scratch = Scratch::new("history-two-writers");
    let first = Arc::new(open(&scratch));
    let second = Arc::new(open(&scratch));
    let writers: Vec<_> = [(Arc::clone(&first), 0_u64), (Arc::clone(&second), 100)]
        .into_iter()
        .map(|(history, offset)| {
            std::thread::spawn(move || {
                for key in offset..offset + 5 {
                    history.begin(key, start(1), progress(RunState::Running, &["running"]));
                    history.update(key, progress(RunState::Completed, &["finalized"]));
                }
            })
        })
        .collect();
    for writer in writers {
        writer.join().expect("the writer finishes");
    }

    assert_eq!(runs(&first).len(), 10, "each sees the other's runs");
    assert_eq!(runs(&second).len(), 10);
    assert!(
        runs(&first)
            .iter()
            .all(|run| run.state == RunState::Completed)
    );
}

#[test]
fn a_run_whose_session_ended_is_interrupted_and_a_live_one_is_left_alone() {
    let scratch = Scratch::new("history-interrupted");
    let ended = open(&scratch);
    ended.begin(
        1,
        start(3),
        progress(RunState::Running, &["finalized", "running", "pending"]),
    );
    let live = open(&scratch);
    live.begin(1, start(1), progress(RunState::Running, &["running"]));
    let live_run = runs(&live)
        .into_iter()
        .find(|run| run.state == RunState::Running && run.item_count == 1)
        .expect("the live run")
        .run_id;
    let live_bytes = fs::read(history_directory(&scratch).join(file_name_of(&live_run)))
        .expect("the live run's document");
    // What a process ending does to its lock, without ending this one.
    drop(ended);

    let later = open(&scratch);
    let listed = runs(&later);
    assert_eq!(listed.len(), 2);
    let interrupted = listed
        .iter()
        .find(|run| run.run_id != live_run)
        .expect("the ended session's run");
    assert_eq!(interrupted.state, RunState::Interrupted);
    assert!(interrupted.interrupted_at_ms.is_some());
    assert_eq!(
        interrupted.ended_at_ms, None,
        "when it stopped is not known"
    );
    let states: Vec<String> = items(&later, &interrupted.run_id)
        .into_iter()
        .map(|item| item.progress.state)
        .collect();
    assert_eq!(states, ["finalized", "interrupted", "notRun"]);

    assert_eq!(
        listed
            .iter()
            .find(|run| run.run_id == live_run)
            .map(|run| run.state),
        Some(RunState::Running)
    );
    assert_eq!(
        fs::read(history_directory(&scratch).join(file_name_of(&live_run)))
            .expect("the live run's document"),
        live_bytes,
        "a live session's run is not written by another"
    );
    let owners = entries(&history_directory(&scratch))
        .into_iter()
        .filter(|name| name.starts_with(OWNER_PREFIX))
        .count();
    assert_eq!(
        owners, 2,
        "the ended session's lock is gone; two live ones remain"
    );
}

#[test]
fn the_oldest_ended_runs_are_pruned_and_a_run_in_progress_never_is() {
    let scratch = Scratch::new("history-prune-count");
    let history = open(&scratch);
    let active_id = |history: &ConversionHistory| {
        history
            .locked()
            .active
            .as_ref()
            .map(|active| active.record.run_id.clone())
            .expect("a run is being recorded")
    };
    // A second instance's run in progress, which this one must not prune.
    let other = open(&scratch);
    other.begin(1, start(1), progress(RunState::Running, &["running"]));
    let in_progress = active_id(&other);
    let mut ended = Vec::new();
    for key in 0..(MAX_RUNS as u64 + 3) {
        history.begin(key, start(1), progress(RunState::Running, &["running"]));
        ended.push(active_id(&history));
        history.update(key, progress(RunState::Completed, &["finalized"]));
    }
    let kept = run_files(&scratch);
    assert_eq!(kept.len(), MAX_RUNS);
    assert!(kept.contains(&file_name_of(&in_progress)));
    assert!(kept.contains(&file_name_of(ended.last().expect("the newest"))));
    // 204 runs for 200 places. The one still being written is passed over,
    // so four ended runs went.
    assert_eq!(
        ended
            .iter()
            .filter(|id| !kept.contains(&file_name_of(id)))
            .count(),
        4
    );
}

#[test]
fn the_byte_bound_prunes_the_oldest_and_an_oversized_run_drops_only_its_items() {
    let scratch = Scratch::new("history-prune-bytes");
    let directory = history_directory(&scratch);
    fs::create_dir_all(&directory).expect("the history directory");
    // Five ended runs of about 14 MiB each, more than the 64 MiB bound.
    let large = "x".repeat(14 * 1024 * 1024);
    let mut names = Vec::new();
    for index in 0..5_u64 {
        let run_id = format!("{:013}-{}", 1_000 + index, "a".repeat(32));
        let mut item_source = source("large.raw");
        item_source.display_name.clone_from(&large);
        let record = RunRecord {
            schema_version: SCHEMA_VERSION,
            run_id: run_id.clone(),
            owner: "b".repeat(32),
            state: RunState::Completed,
            started_at_ms: 1_000 + index,
            ended_at_ms: Some(2_000),
            interrupted_at_ms: None,
            passes: 1,
            settings: start(0).settings,
            build_release: None,
            conflict_policy: "fail".to_owned(),
            failure: None,
            items_omitted: false,
            items: vec![RunItem {
                source: item_source,
                progress: item(FINALIZED_ITEM),
            }],
        };
        fs::write(
            directory.join(file_name_of(&run_id)),
            serde_json::to_vec(&record).expect("serializes"),
        )
        .expect("write the run");
        names.push(file_name_of(&run_id));
    }

    let history = open(&scratch);
    let kept = run_files(&scratch);
    assert_eq!(kept, names[1..], "the oldest went, and only it");

    // A run too large for one document is still recorded, without its items.
    let mut huge = start(1);
    huge.items[0].display_name = "y".repeat(17 * 1024 * 1024);
    history.begin(9, huge, progress(RunState::Running, &["running"]));
    let newest = runs(&history)
        .into_iter()
        .find(|run| run.started_at_ms > 2_000)
        .expect("the oversized run is listed");
    assert!(newest.items_omitted);
    assert_eq!(newest.item_count, 0);
    assert!(
        !newest.settings_verified,
        "nothing is claimed of items not kept"
    );
}

#[test]
fn a_corrupt_run_is_set_aside_and_a_newer_one_is_left_in_place() {
    let scratch = Scratch::new("history-corrupt");
    let directory = history_directory(&scratch);
    fs::create_dir_all(&directory).expect("the history directory");
    let corrupt = file_name_of(&format!("{:013}-{}", 1, "c".repeat(32)));
    let newer = file_name_of(&format!("{:013}-{}", 2, "d".repeat(32)));
    fs::write(directory.join(&corrupt), b"{ not a run").expect("write");
    fs::write(directory.join(&newer), br#"{"schemaVersion":99}"#).expect("write");
    fs::write(directory.join("notes.txt"), b"not ours to read").expect("write");

    let history = open(&scratch);

    let names = entries(&directory);
    assert!(!names.contains(&corrupt), "taken off its name");
    let aside = names
        .iter()
        .find(|name| name.starts_with(SET_ASIDE_PREFIX))
        .expect("kept aside");
    assert_eq!(
        fs::read(directory.join(aside)).expect("read"),
        b"{ not a run"
    );
    assert!(
        names.contains(&newer),
        "a later build's run is not this one's to move"
    );
    assert_eq!(
        fs::read(directory.join("notes.txt")).expect("read"),
        b"not ours to read"
    );
    let RunHistoryListDto::Listed {
        runs, newer: count, ..
    } = history.list()
    else {
        panic!("listed");
    };
    assert!(runs.is_empty());
    assert_eq!(count, 1);
}

#[test]
fn clear_keeps_a_run_in_progress_and_off_forgets_everything_for_every_instance() {
    let scratch = Scratch::new("history-clear-off");
    let history = open(&scratch);
    history.begin(1, start(1), progress(RunState::Running, &["running"]));
    history.update(1, progress(RunState::Completed, &["finalized"]));
    history.begin(2, start(1), progress(RunState::Running, &["running"]));

    assert_eq!(
        history.clear(),
        RunHistoryWriteDto::Done {
            kept_in_progress: 1
        }
    );
    assert_eq!(runs(&history).len(), 1);
    assert_eq!(runs(&history)[0].state, RunState::Running);

    let other = open(&scratch);
    assert_eq!(
        history.set_enabled(false),
        RunHistoryWriteDto::Done {
            kept_in_progress: 0
        }
    );
    assert!(
        run_files(&scratch).is_empty(),
        "off forgets the run in progress too"
    );
    history.update(2, progress(RunState::Completed, &["finalized"]));
    other.begin(5, start(1), progress(RunState::Running, &["running"]));
    assert!(
        run_files(&scratch).is_empty(),
        "no instance records while off"
    );
    let RunHistoryListDto::Listed { recording, .. } = other.list() else {
        panic!("listed");
    };
    assert!(!recording);

    assert_eq!(
        other.set_enabled(true),
        RunHistoryWriteDto::Done {
            kept_in_progress: 0
        }
    );
    history.begin(6, start(1), progress(RunState::Running, &["running"]));
    assert_eq!(run_files(&scratch).len(), 1);
}

#[test]
fn nothing_is_written_outside_the_history_directory() {
    let scratch = Scratch::new("history-confined");
    let history = open(&scratch);
    history.begin(
        1,
        start(2),
        progress(RunState::Running, &["running", "pending"]),
    );
    history.update(1, progress(RunState::Completed, &["finalized", "failed"]));
    let _ = history.list();
    let _ = history.clear();
    let _ = history.set_enabled(false);
    let _ = history.set_enabled(true);
    history.begin(2, start(1), progress(RunState::Running, &["running"]));
    drop(history);
    let _ = open(&scratch);

    assert_eq!(entries(scratch.directory()), ["app"]);
    assert_eq!(entries(&base(&scratch)), [DIRECTORY]);
    for name in entries(&history_directory(&scratch)) {
        assert!(
            run_id_of_name(&name).is_some()
                || name.starts_with(OWNER_PREFIX)
                || name.starts_with(SET_ASIDE_PREFIX)
                || name == OFF_MARKER,
            "{name} is not a name this store writes"
        );
    }
}

#[test]
fn a_session_with_nowhere_to_keep_runs_says_so_and_records_nothing() {
    let history = ConversionHistory::open(Err("rootUnresolved"));
    history.begin(1, start(1), progress(RunState::Running, &["running"]));
    assert_eq!(
        history.list(),
        RunHistoryListDto::Unavailable {
            problem: "rootUnresolved"
        }
    );
    assert_eq!(
        history.clear(),
        RunHistoryWriteDto::Unavailable {
            problem: "rootUnresolved"
        }
    );
}

#[cfg(windows)]
#[test]
fn a_history_directory_that_is_a_junction_is_refused() {
    let scratch = Scratch::new("history-junction");
    let elsewhere = scratch.join("elsewhere");
    fs::create_dir_all(&elsewhere).expect("the target");
    fs::create_dir_all(base(&scratch)).expect("the base");
    let link = history_directory(&scratch);
    let made = std::process::Command::new("cmd.exe")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&elsewhere)
        .output()
        .expect("run mklink");
    assert!(made.status.success(), "the disposable junction must exist");

    let history = open(&scratch);
    history.begin(1, start(1), progress(RunState::Running, &["running"]));

    assert_eq!(
        history.list(),
        RunHistoryListDto::Unavailable {
            problem: "unsafeDirectory"
        }
    );
    assert!(
        entries(&elsewhere).is_empty(),
        "nothing went through the link"
    );
    // Only the link, never its target's contents.
    fs::remove_dir(&link).expect("remove the junction");
}
