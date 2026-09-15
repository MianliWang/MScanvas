#![cfg(windows)]

use super::*;
use std::os::windows::fs::OpenOptionsExt;

#[test]
fn live_creation_prevents_in_place_reparse_mutation_of_the_empty_output_directory() {
    let directory = TestDirectory::new();
    let foreign = directory.path().join("foreign");
    fs::create_dir(&foreign).unwrap();
    let sentinel = foreign.join("must-survive.txt");
    fs::write(&sentinel, b"foreign contents").unwrap();
    let control = directory.path().join("junction-control");
    assert!(
        make_junction(&control, &foreign),
        "this host can exercise a real junction"
    );
    remove_junction(&control);
    let parent = directory.path().join("destination");
    fs::create_dir(&parent).unwrap();
    let staging = StagingRecovery::create(parent.join("owned"), None).unwrap();
    assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
    assert!(
        !make_junction(&parent, &foreign),
        "the pinned staging child keeps its publication parent nonempty"
    );
    let output = staging.output_directory();
    let redirected = make_junction(&output, &foreign);
    // Release this task's holds before removing a successfully constructed test
    // junction. No cleanup method is asked to walk a redirected namespace.
    drop(staging);
    if redirected {
        remove_junction(&output);
    }
    assert_eq!(fs::read(&sentinel).unwrap(), b"foreign contents");
    assert!(
        !redirected,
        "creation custody must prevent a same-object reparse rewrite"
    );
}

fn no_delete_lock(path: &Path) -> File {
    fs::OpenOptions::new()
        .read(true)
        .share_mode(0x03)
        .open(path)
        .unwrap()
}

#[test]
fn live_recovery_retains_creation_and_frozen_children_through_a_real_lock() {
    let directory = TestDirectory::new();
    let cancellation = ConversionCancellation::new();
    let observer = cancellation.recovery_observer();
    let root = directory.path().join("owned-staging");
    let staging = StagingRecovery::create(root.clone(), Some(&cancellation)).unwrap();
    let plain = staging.output_directory().join("a-disposable.bin");
    let blocked = staging.output_directory().join("z-locked.bin");
    fs::write(&plain, b"task-owned temporary output").unwrap();
    fs::write(&blocked, b"task-owned locked output").unwrap();
    let lock = no_delete_lock(&blocked);
    assert!(staging.discard().is_some());
    assert_eq!(staging.status(), StagingRecoveryStatus::Recoverable);
    assert!(
        !plain.exists(),
        "the first teardown already removed an unlocked member"
    );
    let retained = observer.retained().unwrap();
    assert_eq!(retained.id(), staging.id());
    assert!(blocked.exists());
    assert!(root.join(STAGING_OWNER_MARKER).exists());
    drop(lock);
    retained.reclaim().unwrap();
    assert_eq!(retained.status(), StagingRecoveryStatus::Cleaned);
    assert!(!root.exists());
}

#[test]
fn live_recovery_never_authorizes_a_child_added_after_the_first_teardown() {
    let directory = TestDirectory::new();
    let root = directory.path().join("owned-staging");
    let staging = StagingRecovery::create(root.clone(), None).unwrap();
    let blocked = staging.output_directory().join("locked.bin");
    fs::write(&blocked, b"owned").unwrap();
    let lock = no_delete_lock(&blocked);
    assert!(staging.discard().is_some());
    drop(lock);
    let foreign = staging.output_directory().join("arrived-later.bin");
    fs::write(&foreign, b"must survive").unwrap();
    assert!(matches!(
        staging.reclaim(),
        Err(StagingResidue::ForeignEntry)
    ));
    assert_eq!(staging.status(), StagingRecoveryStatus::ProofUnavailable);
    assert_eq!(fs::read(&foreign).unwrap(), b"must survive");
    assert!(blocked.exists());
}

#[test]
fn live_recovery_refuses_a_replaced_child_even_when_its_name_and_bytes_match() {
    let directory = TestDirectory::new();
    let root = directory.path().join("owned-staging");
    let staging = StagingRecovery::create(root, None).unwrap();
    let blocked = staging.output_directory().join("locked.bin");
    fs::write(&blocked, b"same bytes").unwrap();
    let lock = no_delete_lock(&blocked);
    assert!(staging.discard().is_some());
    drop(lock);
    fs::rename(&blocked, directory.path().join("displaced.bin")).unwrap();
    fs::write(&blocked, b"same bytes").unwrap();
    assert!(staging.reclaim().is_err());
    assert_eq!(fs::read(&blocked).unwrap(), b"same bytes");
    assert_eq!(staging.status(), StagingRecoveryStatus::ProofUnavailable);
}

#[test]
fn live_recovery_refuses_unconfirmed_process_and_cannot_admit_a_forged_marker() {
    let directory = TestDirectory::new();
    let root = directory.path().join("owned-staging");
    let staging = StagingRecovery::create(root.clone(), None).unwrap();
    let output = staging
        .output_directory()
        .join("still-owned-by-process.bin");
    fs::write(&output, b"preserve").unwrap();
    staging.before_provider();
    assert!(staging.discard().is_some());
    assert_eq!(staging.status(), StagingRecoveryStatus::ProcessUnconfirmed);
    assert!(staging.reclaim().is_err());
    assert_eq!(fs::read(&output).unwrap(), b"preserve");
    let forged = directory.path().join("forged-staging");
    fs::create_dir(&forged).unwrap();
    fs::write(forged.join(STAGING_OWNER_MARKER), STAGING_OWNER_MAGIC).unwrap();
    assert!(matches!(
        StagingRecovery::create(forged.clone(), None),
        Err(ConversionRunFailure::StagingTargetExists)
    ));
    assert!(forged.exists());
}

#[test]
fn live_recovery_refuses_hard_links_before_capture_and_after_partial_teardown() {
    for after_partial in [false, true] {
        let directory = TestDirectory::new();
        let staging =
            StagingRecovery::create(directory.path().join("owned-staging"), None).unwrap();
        let child = staging.output_directory().join("output.bin");
        fs::write(&child, b"must remain at both names").unwrap();
        if after_partial {
            let lock = no_delete_lock(&child);
            assert!(staging.discard().is_some());
            drop(lock);
        }
        let external = directory.path().join("external-link.bin");
        fs::hard_link(&child, &external).unwrap();
        if after_partial {
            assert!(matches!(
                staging.reclaim(),
                Err(StagingResidue::ForeignEntry)
            ));
        } else {
            assert!(matches!(
                staging.discard(),
                Some(StagingResidue::ForeignEntry)
            ));
        }
        assert_eq!(staging.status(), StagingRecoveryStatus::ProofUnavailable);
        assert_eq!(fs::read(&child).unwrap(), b"must remain at both names");
        assert_eq!(fs::read(&external).unwrap(), b"must remain at both names");
    }
}

#[test]
fn live_recovery_keeps_the_creation_root_and_its_parent_pinned_until_cleanup() {
    let directory = TestDirectory::new();
    let parent = directory.path().join("destination");
    fs::create_dir(&parent).unwrap();
    let root = parent.join("owned-staging");
    let staging = StagingRecovery::create(root.clone(), None).unwrap();
    let child = staging.output_directory().join("locked.bin");
    fs::write(&child, b"owned disposable output").unwrap();
    let lock = no_delete_lock(&child);
    assert!(staging.discard().is_some());
    assert!(fs::rename(&root, parent.join("replacement-root")).is_err());
    assert!(fs::rename(&parent, directory.path().join("replacement-parent")).is_err());
    assert_eq!(fs::read(&child).unwrap(), b"owned disposable output");
    drop(lock);
    staging.reclaim().unwrap();
    assert!(!root.exists());
    assert!(parent.exists());
}

#[test]
fn live_recovery_can_inspect_identity_under_an_exclusive_content_lock_and_retry_owned_deletion() {
    let directory = TestDirectory::new();
    let staging = StagingRecovery::create(directory.path().join("owned-staging"), None).unwrap();
    let child = staging.output_directory().join("uninspectable.bin");
    fs::write(&child, b"must survive until the content lock is released").unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&child)
        .unwrap();
    assert!(staging.discard().is_some());
    // READ_ATTRIBUTES does not request content access. This real lock stops
    // deletion, but it does not make file identity uninspectable on Windows.
    assert_eq!(staging.status(), StagingRecoveryStatus::Recoverable);
    assert!(child.exists());
    drop(lock);
    staging.reclaim().unwrap();
    assert!(!child.exists());
}

#[test]
fn live_recovery_never_renews_proof_after_an_initial_inspection_refusal() {
    for refuse in [true, false] {
        let directory = TestDirectory::new();
        let staging =
            StagingRecovery::create(directory.path().join("owned-staging"), None).unwrap();
        let child = staging.output_directory().join("output.bin");
        fs::write(&child, b"preserve when inspection fails").unwrap();
        // A controlled initial-inspection failure, not a claim that a content
        // sharing lock denies READ_ATTRIBUTES or that the host ACL was changed.
        let result = staging.discard_with_inspection_for_test(|| {
            if refuse {
                Err(StagingResidue::NotRemoved {
                    kind: io::ErrorKind::PermissionDenied,
                })
            } else {
                Ok(())
            }
        });
        if refuse {
            assert!(result.is_err());
            assert_eq!(staging.status(), StagingRecoveryStatus::ProofUnavailable);
            assert!(staging.reclaim().is_err());
            assert_eq!(fs::read(child).unwrap(), b"preserve when inspection fails");
        } else {
            result.unwrap();
            assert_eq!(staging.status(), StagingRecoveryStatus::Cleaned);
            assert!(!child.exists());
        }
    }
}

#[test]
fn live_recovery_never_follows_or_deletes_a_foreign_junction() {
    struct Junction(PathBuf);
    impl Drop for Junction {
        fn drop(&mut self) {
            remove_junction(&self.0);
        }
    }
    let directory = TestDirectory::new();
    let foreign = directory.path().join("foreign");
    fs::create_dir(&foreign).unwrap();
    let sentinel = foreign.join("preserve.bin");
    fs::write(&sentinel, b"outside the staging ownership").unwrap();
    let staging = StagingRecovery::create(directory.path().join("owned-staging"), None).unwrap();
    let entry = staging.output_directory().join("redirected");
    assert!(
        make_junction(&entry, &foreign),
        "this Windows proof requires a real task-owned junction"
    );
    let _entry = Junction(entry.clone());
    assert!(staging.discard().is_some());
    assert_eq!(staging.status(), StagingRecoveryStatus::ProofUnavailable);
    assert!(staging.reclaim().is_err());
    assert!(entry.exists());
    assert_eq!(
        fs::read(sentinel).unwrap(),
        b"outside the staging ownership"
    );
}
