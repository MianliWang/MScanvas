#![cfg(windows)]

use super::*;
use crate::preview::dto::{
    OutputOpenActionDto as Action, OutputOpenOutcomeDto as Outcome, OutputOpenRefusalDto as Refusal,
};

fn output_id(service: &PreviewService) -> String {
    terminal_queue(&service.conversion_state()).items[0].finalized_outputs[0]
        .output_id
        .clone()
}

fn refused(reason: Refusal) -> Outcome {
    Outcome::Refused { reason }
}

#[test]
fn valid_opening_holds_the_exact_file_deduplicates_and_preserves_conversion_and_adoption() {
    let fixture = TestFile::new("open-valid");
    let (service, destination, operation, document) = converted_queue(&fixture, &["one.raw"]);
    let id = output_id(&service);
    let expected = destination.join("one.mzML");
    let bytes = fs::read(&expected).unwrap();
    let before = serde_json::to_value(service.conversion_state()).unwrap();
    let roster = serde_json::to_value(service.roster()).unwrap();
    let outcome = service.open_finalized_output_with(&id, Action::File, document, |path| {
        assert_eq!(path, expected.canonicalize().unwrap());
        assert_eq!(fs::read(path).unwrap(), bytes);
        assert!(
            fs::write(path, &bytes).is_err(),
            "writers are excluded through the handoff"
        );
        assert!(fs::rename(path, destination.join("moved.mzML")).is_err());
        assert_eq!(
            service.open_finalized_output_with(&id, Action::Folder, document, |_| panic!(
                "duplicate handoff"
            )),
            refused(Refusal::InFlight)
        );
        Ok(())
    });
    assert_eq!(outcome, Outcome::Accepted);
    assert_eq!(
        serde_json::to_value(service.conversion_state()).unwrap(),
        before
    );
    assert_eq!(serde_json::to_value(service.roster()).unwrap(), roster);
    assert!(!service.backend_is_quarantined());
    for reason in [
        Refusal::NoAssociation,
        Refusal::AccessDenied,
        Refusal::PlatformFailure,
    ] {
        assert_eq!(
            service.open_finalized_output_with(&id, Action::File, document, |_| Err(reason)),
            refused(reason)
        );
    }
    assert_eq!(
        serde_json::to_value(service.conversion_state()).unwrap(),
        before
    );
    assert_eq!(
        adoption_kinds(
            &service
                .adopt_conversion_outputs(&operation.to_string(), document)
                .unwrap()
        ),
        vec!["added"]
    );
}

#[test]
fn unknown_and_stale_output_requests_cannot_reach_the_platform() {
    let fixture = TestFile::new("open-stale");
    let (service, _, _, document) = converted_queue(&fixture, &["one.raw"]);
    let id = output_id(&service);
    for unknown in ["unknown".to_owned(), "x".repeat(65)] {
        assert_eq!(
            service.open_finalized_output_with(&unknown, Action::File, document, |_| panic!(
                "unknown output"
            )),
            refused(Refusal::UnknownOutput)
        );
    }
    assert_eq!(
        service.open_finalized_output_with(&id, Action::File, document + 1, |_| panic!(
            "stale document"
        )),
        refused(Refusal::StaleDocument)
    );
    let result = service.open_finalized_output_after_validation(
        &id,
        Action::File,
        document,
        || {
            service.begin_webview_document();
        },
        |_| panic!("document changed while the file was inspected"),
    );
    assert_eq!(result, refused(Refusal::StaleDocument));
    assert_eq!(
        service
            .open_finalized_output_with(&id, Action::File, current_document(&service), |_| Ok(())),
        Outcome::Accepted
    );
}

#[test]
fn opening_refuses_replacement_same_length_rewrite_and_unreadable_files_with_a_valid_control() {
    for fault in ["replace", "rewrite", "locked"] {
        let fixture = TestFile::new(&format!("open-{fault}"));
        let (service, destination, _, document) = converted_queue(&fixture, &["one.raw"]);
        let id = output_id(&service);
        assert_eq!(
            service.open_finalized_output_with(&id, Action::File, document, |_| Ok(())),
            Outcome::Accepted
        );
        let output = destination.join("one.mzML");
        let original = fs::read(&output).unwrap();
        let mut lock = None;
        let expected = match fault {
            "replace" => {
                fs::rename(&output, destination.join("original.mzML")).unwrap();
                fs::write(&output, &original).unwrap();
                Refusal::OutputChanged
            }
            "rewrite" => {
                let changed = String::from_utf8(original.clone())
                    .unwrap()
                    .replacen("scan=1", "scan=9", 1);
                assert_ne!(changed.as_bytes(), original);
                assert_eq!(changed.len(), original.len());
                fs::write(&output, changed).unwrap();
                Refusal::OutputChanged
            }
            "locked" => {
                lock = Some(hold_for_writing(&output));
                Refusal::OutputUnreadable
            }
            _ => unreachable!(),
        };
        assert_eq!(
            service.open_finalized_output_with(&id, Action::File, document, |_| panic!(
                "invalid file reached the platform"
            )),
            refused(expected)
        );
        drop(lock);
        assert_eq!(service.roster().datasets.len(), 1);
        if fault == "locked" {
            assert_eq!(
                service.open_finalized_output_with(&id, Action::File, document, |_| Ok(())),
                Outcome::Accepted
            );
        }
    }
}

#[test]
fn a_missing_file_keeps_only_its_independently_validated_folder_recovery() {
    let fixture = TestFile::new("open-folder");
    let (service, destination, _, document) = converted_queue(&fixture, &["one.raw"]);
    let id = output_id(&service);
    fs::remove_file(destination.join("one.mzML")).unwrap();
    // An unheld empty directory permits the write access required by
    // FSCTL_SET_REPARSE_POINT. The folder handoff must exclude that access.
    use std::os::windows::fs::OpenOptionsExt;
    let write_directory = |path: &Path| {
        fs::OpenOptions::new()
            .access_mode(0x4000_0000)
            .share_mode(7)
            .custom_flags(0x0200_0000 | 0x0020_0000)
            .open(path)
    };
    drop(write_directory(&destination).unwrap());
    assert_eq!(
        service.open_finalized_output_with(&id, Action::File, document, |_| panic!("missing file")),
        refused(Refusal::OutputMissing)
    );
    assert_eq!(
        service.open_finalized_output_with(&id, Action::Folder, document, |path| {
            assert_eq!(path, destination.canonicalize().unwrap());
            assert!(
                write_directory(path).is_err(),
                "in-place reparse writes are excluded through delegation"
            );
            assert!(
                fs::rename(path, fixture.directory.join("moved")).is_err(),
                "folder is held through delegation"
            );
            Ok(())
        }),
        Outcome::Accepted
    );
    fs::rename(&destination, fixture.directory.join("moved")).unwrap();
    fs::create_dir(&destination).unwrap();
    assert_eq!(
        service.open_finalized_output_with(&id, Action::Folder, document, |_| panic!(
            "replacement folder"
        )),
        refused(Refusal::FolderUnavailable)
    );
}

#[test]
fn a_partial_set_member_opens_by_its_own_identity_without_becoming_adoptable() {
    let fixture = TestFile::new("open-partial-set");
    let destination = fixture.destination("out");
    let service = output_set_service(FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]));
    let occupied = destination.join("a-S2.mzML");
    service.race_next_publication(move |position| {
        if position == 1 {
            fs::write(&occupied, b"foreign final target").unwrap();
        }
    });
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .unwrap();
    let update = run_visible_queue(
        &service,
        &[sciex.handle],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let item = &terminal_queue(&update).items[0];
    assert_eq!(item.state, ConversionQueueItemStateDto::Failed);
    assert_eq!(item.finalized_outputs.len(), 1);
    assert_eq!(adoptable_output_count(&update), 0);
    let member = &item.finalized_outputs[0];
    assert_eq!(member.file_name, "a-S1.mzML");
    assert_eq!(
        service.open_finalized_output_with(
            &member.output_id,
            Action::File,
            current_document(&service),
            |path| {
                assert_eq!(path, destination.join("a-S1.mzML").canonicalize().unwrap());
                Ok(())
            }
        ),
        Outcome::Accepted
    );
    assert_eq!(
        serde_json::to_value(service.conversion_state()).unwrap(),
        serde_json::to_value(update).unwrap()
    );
    assert_eq!(service.roster().datasets.len(), 1);
}
