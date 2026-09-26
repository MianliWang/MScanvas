//! What crossing from a project reference to a workspace row does, and what it
//! refuses to do.
//!
//! Every test here runs against real files in a task-owned temporary directory
//! and against the real workspace service, holding a provider that fails the
//! test if anything starts a process. So the content boundary is proved by
//! writing bytes and reading them back rather than by a fixture asserting its
//! own answer, and "this action is provider-free" is proved by the provider
//! rather than by inspection.
//!
//! No VM, no installer, no ProteoWizard, and nothing outside the directory each
//! test creates is read or written.

use std::fs;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};

use crate::preview::PreviewService;
use crate::preview::dto::{WorkspaceAddOutcomeDto, WorkspaceAddResultDto};
use crate::preview::idle_provider::NoProcess;
use crate::project::observe::{Cancellation, UnavailableReason};
use crate::project::record::{InputId, LayerId};
use crate::project::tests::Scratch;
use crate::project::{ProjectError, ProjectStore};

use crate::preview::sciex_fixture::{SCIEX_MARKERS, scan_companion_bytes, wiff_container_bytes};

use super::{
    AdmissionRefusal, add_project_input_to_workspace, add_project_input_to_workspace_between,
    admitted_handle,
};

/// A session workspace that fails the test if anything starts a process.
fn workspace() -> PreviewService {
    PreviewService::new(Box::new(NoProcess))
}

/// A project with one reference, registered from a file this test wrote.
///
/// Registering establishes the reference's content with the same mechanism a
/// check uses, so the reference starts out matching -- which is the eligible
/// state, reached the way the product reaches it rather than by writing a
/// verdict into the store.
fn project_with(scratch: &Scratch, name: &str, bytes: &[u8]) -> (ProjectStore, InputId) {
    let store = ProjectStore::new();
    store
        .create("Reattachment".to_owned(), false)
        .expect("a new project");
    let path = scratch.write(name, bytes);
    let id = store.register_input(&path).expect("register the reference");
    (store, id)
}

/// The whole action, the way the command issues it: accept, then run.
fn add(
    projects: &ProjectStore,
    service: &PreviewService,
    id: InputId,
) -> Result<WorkspaceAddResultDto, AdmissionRefusal> {
    let job = projects.accept_job().map_err(AdmissionRefusal::Project)?;
    add_project_input_to_workspace(projects, service, job, id)
}

#[track_caller]
fn project_refusal(refusal: AdmissionRefusal) -> ProjectError {
    match refusal {
        AdmissionRefusal::Project(error) => error,
        AdmissionRefusal::Workspace(error) => {
            panic!(
                "expected a project refusal, got the workspace's {}",
                error.kind
            )
        }
    }
}

/// What the description says about one reference's current state.
#[track_caller]
fn verification(store: &ProjectStore, id: InputId) -> &'static str {
    store
        .describe()
        .inputs
        .iter()
        .find(|input| input.id == id.to_string())
        .map(|input| input.verification)
        .expect("the reference is described")
}

/// The workspace row the description remembers for one reference, if any.
#[track_caller]
fn remembered_row(store: &ProjectStore, id: InputId) -> Option<String> {
    store
        .describe()
        .inputs
        .iter()
        .find(|input| input.id == id.to_string())
        .and_then(|input| input.workbench_dataset_handle.clone())
}

// ---------------------------------------------------------------------------
// The action itself
// ---------------------------------------------------------------------------

#[test]
fn a_checked_reference_becomes_one_workspace_row() {
    let scratch = Scratch::new("reattach-one");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();

    let result = add(&projects, &service, id).expect("the reference is admitted");

    assert!(matches!(
        result.outcomes.as_slice(),
        [WorkspaceAddOutcomeDto::Added { .. }]
    ));
    assert_eq!(result.roster.datasets.len(), 1);
    assert_eq!(result.roster.datasets[0].file_name, "sample.mzML");
    // And the project now knows which row that reference is, so the surface can
    // offer to show it rather than to add it again.
    assert_eq!(
        remembered_row(&projects, id).as_deref(),
        Some(result.roster.datasets[0].handle.as_str())
    );
}

#[test]
fn adding_the_same_reference_twice_answers_with_the_row_it_already_has() {
    let scratch = Scratch::new("reattach-twice");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();

    let first = add(&projects, &service, id).expect("admitted");
    let handle = admitted_handle(&first).expect("a row").to_owned();
    let second = add(&projects, &service, id).expect("admitted again");

    assert!(matches!(
        second.outcomes.as_slice(),
        [WorkspaceAddOutcomeDto::Duplicate { .. }]
    ));
    assert_eq!(admitted_handle(&second), Some(handle.as_str()));
    assert_eq!(
        second.roster.datasets.len(),
        1,
        "one acquisition is one row however many times it is asked for"
    );
}

#[test]
fn a_confirmed_relocation_admits_the_object_the_record_now_names() {
    let scratch = Scratch::new("reattach-relocated");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();

    // The same bytes, somewhere else, and the original gone: the shape a user
    // has after moving their data.
    let moved = scratch.write("moved/sample.mzML", b"<mzML/>");
    fs::remove_file(scratch.join("sample.mzML")).expect("remove the original");
    assert!(
        projects.propose_relink(id, &moved).expect("propose"),
        "the candidate holds the recorded bytes"
    );
    projects.commit_relink(id).expect("confirm the relocation");
    // Confirming a relocation drops whatever row the old object had, because
    // the record names something else now.
    assert_eq!(remembered_row(&projects, id), None);

    let result = add(&projects, &service, id).expect("the relocated object is admitted");

    assert_eq!(result.roster.datasets.len(), 1);
    assert_eq!(result.roster.datasets[0].byte_length, 7);
}

// ---------------------------------------------------------------------------
// Eligibility: what the last check established
// ---------------------------------------------------------------------------

#[test]
fn an_unchecked_reference_is_refused_and_admits_nothing() {
    let scratch = Scratch::new("reattach-unchecked");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();
    // Save As rebases every locator, so nothing an earlier check established is
    // still about this project's files. This is how a reference reaches the
    // unchecked state through an ordinary product action.
    projects
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");
    assert_eq!(verification(&projects, id), "notChecked");

    let refusal = add(&projects, &service, id).expect_err("a refusal");

    assert_eq!(project_refusal(refusal), ProjectError::NotChecked);
    assert!(
        service.roster().datasets.is_empty(),
        "a refusal admits nothing"
    );
    // And it did not quietly run the check the user did not ask for.
    assert_eq!(verification(&projects, id), "notChecked");
}

#[test]
fn a_reference_whose_bytes_changed_is_refused() {
    let scratch = Scratch::new("reattach-changed");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();
    let before = projects.describe();
    scratch.write("sample.mzML", b"<mzML> rewritten, and longer </mzML>");

    let refusal = add(&projects, &service, id).expect_err("a refusal");

    assert_eq!(project_refusal(refusal), ProjectError::ContentChanged);
    assert!(service.roster().datasets.is_empty());
    // The refusal is what the surface says, and what it says about the file is
    // now the newer truth rather than the answer from before the edit.
    assert_eq!(verification(&projects, id), "differentContent");
    let after = projects.describe();
    assert_eq!(after.dirty, before.dirty, "nothing in the document changed");
    assert_eq!(
        after.inputs[0].members[0].recorded_byte_length,
        before.inputs[0].members[0].recorded_byte_length,
        "the recorded baseline is not rewritten by a failed revalidation"
    );
}

/// The case a length, a modified time and a file identity all miss.
#[test]
fn an_in_place_edit_at_the_same_name_and_length_is_refused() {
    let scratch = Scratch::new("reattach-inplace");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML>aaaa</mzML>");
    let service = workspace();
    let identity_before = crate::local_document::object_identity(&scratch.join("sample.mzML"));

    // Same path, same byte count, same object. Only the bytes differ.
    scratch.write("sample.mzML", b"<mzML>bbbb</mzML>");
    assert_eq!(
        crate::local_document::object_identity(&scratch.join("sample.mzML")),
        identity_before,
        "this test is only meaningful while the object is the same one"
    );

    let refusal = add(&projects, &service, id).expect_err("a refusal");

    assert_eq!(project_refusal(refusal), ProjectError::ContentChanged);
    assert!(service.roster().datasets.is_empty());
}

#[test]
fn a_missing_reference_is_refused_with_its_own_reason() {
    let scratch = Scratch::new("reattach-missing");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();
    fs::remove_file(scratch.join("sample.mzML")).expect("remove");

    let refusal = add(&projects, &service, id).expect_err("a refusal");

    assert_eq!(
        project_refusal(refusal),
        ProjectError::Unavailable(UnavailableReason::MissingAtCheckedLocation),
        "not there and changed are different answers and stay different"
    );
    assert!(service.roster().datasets.is_empty());
}

/// Windows-specific. A file another program holds writable cannot be read
/// stably, and that is its own refusal rather than a content judgement.
#[cfg(windows)]
#[test]
fn a_reference_held_writable_elsewhere_is_refused_as_an_unstable_read() {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_SHARE_READ: u32 = 0x0000_0001;

    let scratch = Scratch::new("reattach-unstable");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();
    let held = fs::OpenOptions::new()
        .write(true)
        .share_mode(FILE_SHARE_READ)
        .open(scratch.join("sample.mzML"))
        .expect("hold the file writable");

    let refusal = add(&projects, &service, id).expect_err("a refusal");

    assert_eq!(
        project_refusal(refusal),
        ProjectError::Unavailable(UnavailableReason::UnstableRead)
    );
    assert!(service.roster().datasets.is_empty());
    drop(held);
}

// ---------------------------------------------------------------------------
// The workspace decides admission, and its answer is not softened
// ---------------------------------------------------------------------------

#[test]
fn a_checked_reference_the_workbench_does_not_open_gets_the_refusal_it_always_had() {
    let scratch = Scratch::new("reattach-unsupported");
    // A project may record any local file -- that is what FileFacts is for.
    // Recording one has never been a claim that the Workbench opens it.
    let (projects, id) = project_with(&scratch, "notes.txt", b"not an acquisition");
    let service = workspace();

    let result = add(&projects, &service, id).expect("the request itself is not an error");

    match result.outcomes.as_slice() {
        [
            WorkspaceAddOutcomeDto::Rejected {
                candidate_name,
                error,
            },
        ] => {
            assert_eq!(candidate_name, "notes.txt");
            assert_eq!(error.kind, "unsupported_extension");
        }
        other => panic!("expected the existing refusal, got {other:?}"),
    }
    assert!(result.roster.datasets.is_empty());
    assert_eq!(
        remembered_row(&projects, id),
        None,
        "nothing was admitted, so there is no row to offer to show"
    );
}

#[test]
fn an_ordinary_import_of_the_same_object_converges_on_one_row() {
    let scratch = Scratch::new("reattach-race");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();
    // The same object, admitted first by the ordinary picker path.
    let imported = service
        .add_files(std::slice::from_ref(&scratch.join("sample.mzML")))
        .expect("the ordinary import");
    let existing = admitted_handle(&imported).expect("a row").to_owned();

    let result = add(&projects, &service, id).expect("admitted");

    assert_eq!(
        admitted_handle(&result),
        Some(existing.as_str()),
        "one filesystem object is one row, whichever route reached it"
    );
    assert_eq!(result.roster.datasets.len(), 1);
}

// ---------------------------------------------------------------------------
// Lifetime: neither collection owns the other
// ---------------------------------------------------------------------------

#[test]
fn removing_the_workspace_row_leaves_the_project_untouched() {
    let scratch = Scratch::new("reattach-remove-row");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();
    let result = add(&projects, &service, id).expect("admitted");
    let handle = admitted_handle(&result).expect("a row").to_owned();
    let before = projects.describe();

    service
        .remove_datasets(std::slice::from_ref(&handle))
        .expect("remove the row");

    let after = projects.describe();
    assert!(service.roster().datasets.is_empty());
    assert_eq!(after.inputs.len(), 1, "the reference is still referenced");
    assert_eq!(after.inputs[0].id, before.inputs[0].id);
    assert_eq!(after.inputs[0].verification, before.inputs[0].verification);
    assert_eq!(after.runs.len(), before.runs.len());
}

#[test]
fn closing_the_project_leaves_the_workspace_row_where_it_is() {
    let scratch = Scratch::new("reattach-close");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();
    add(&projects, &service, id).expect("admitted");

    projects.close(true).expect("close the project");

    assert_eq!(
        service.roster().datasets.len(),
        1,
        "closing a document does not empty the session workspace"
    );
    assert!(!projects.describe().open);
}

#[test]
fn removing_the_reference_drops_the_remembered_row_and_not_the_row() {
    let scratch = Scratch::new("reattach-remove-input");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();
    add(&projects, &service, id).expect("admitted");

    projects.remove_input(id).expect("remove the reference");

    assert!(projects.describe().inputs.is_empty());
    assert_eq!(service.roster().datasets.len(), 1);
}

#[test]
fn admitting_a_reference_launches_no_process() {
    // The whole claim rests on the provider: it panics on any installation
    // probe, any reconfiguration and any run. Every test in this file holds
    // one, and this is the one that says so out loud -- including for the
    // duplicate path, which is the one that touches the registry without
    // admitting anything new.
    let scratch = Scratch::new("reattach-no-process");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();

    add(&projects, &service, id).expect("admitted");
    add(&projects, &service, id).expect("admitted again");
    service.roster();
}

// ---------------------------------------------------------------------------
// Stale operations and races
// ---------------------------------------------------------------------------

#[test]
fn a_proof_cannot_commit_into_a_project_that_has_moved_since() {
    let scratch = Scratch::new("reattach-stale-commit");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let job = projects.accept_job().expect("accept");
    let proof = projects.prove_admissible(job, id).expect("proved");

    // A second reference is registered and then removed, which is what the
    // store treats as "what was true of these records no longer is".
    let other = scratch.write("other.mzML", b"<mzML>other</mzML>");
    let other_id = projects.register_input(&other).expect("register");
    projects.remove_input(other_id).expect("remove");

    assert_eq!(
        projects.record_admission(&proof, "dataset-1", proof.identities()),
        Err(ProjectError::StaleDocument),
        "even with the very objects it proved, a proof cannot commit into a moved project"
    );
    assert_eq!(remembered_row(&projects, id), None);
}

#[test]
fn a_proof_cannot_commit_into_a_different_project() {
    let scratch = Scratch::new("reattach-replaced-project");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let job = projects.accept_job().expect("accept");
    let proof = projects.prove_admissible(job, id).expect("proved");

    projects
        .create("Another project".to_owned(), true)
        .expect("a different project is open now");

    assert_eq!(
        projects.record_admission(&proof, "dataset-1", proof.identities()),
        Err(ProjectError::StaleDocument),
        "a proof about one project cannot land in another"
    );
}

/// A different object at the same name, holding the very same bytes.
///
/// The case the whole same-object proof exists for, and the one nothing else
/// catches. The digest cannot see it: the bytes are identical, so a re-hash of
/// the replacement matches the record exactly. Length, modified time and path
/// say nothing either. Two identity observations taken *after* the read handle
/// closed would both observe the replacement and agree with each other, which
/// is precisely the agreement that proves nothing.
///
/// What refuses it is that the identity was taken through the handle the bytes
/// were hashed through, so it names the object that was measured rather than
/// the object the name means afterwards.
#[test]
fn an_object_replaced_after_the_proof_is_not_claimed_however_identical_its_bytes() {
    let scratch = Scratch::new("reattach-swapped-identical");
    let bytes = b"<mzML>identical either way</mzML>";
    let (projects, id) = project_with(&scratch, "sample.mzML", bytes);
    let service = workspace();
    let proved = crate::local_document::object_identity(&scratch.join("sample.mzML"));

    let refusal = add_project_input_to_workspace_between(
        &projects,
        &service,
        projects.accept_job().expect("accept"),
        id,
        || {
            // A different object, at the same name, with the same bytes. Built
            // beside the original and moved over it, so the replacement cannot
            // be handed the identity the original just released.
            let replacement = scratch.write("replacement", bytes);
            fs::remove_file(scratch.join("sample.mzML")).expect("remove the proved object");
            fs::rename(&replacement, scratch.join("sample.mzML")).expect("put it in place");
        },
    )
    .expect_err("a refusal");

    assert_ne!(
        crate::local_document::object_identity(&scratch.join("sample.mzML")),
        proved,
        "this test is only meaningful while the object really was replaced"
    );
    assert_eq!(project_refusal(refusal), ProjectError::ContentChanged);
    assert_eq!(
        remembered_row(&projects, id),
        None,
        "the project claims no row it did not prove"
    );
    // The workspace's row is the workspace's. It admitted a real file under
    // its own rules, and manufacturing atomicity the workspace does not
    // promise by tearing that row out is not this module's to do.
    assert_eq!(service.roster().datasets.len(), 1);
}

/// The same window, with a replacement that differs only in its bytes.
///
/// Its length is identical, so nothing about the file's shape reveals it. This
/// is the case a re-hash *would* catch -- and it must be refused as a
/// replacement rather than silently re-measured and carried on with.
#[test]
fn an_object_replaced_after_the_proof_is_refused_rather_than_re_measured() {
    let scratch = Scratch::new("reattach-swapped-same-length");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML>aaaa</mzML>");
    let service = workspace();

    let refusal = add_project_input_to_workspace_between(
        &projects,
        &service,
        projects.accept_job().expect("accept"),
        id,
        || {
            let replacement = scratch.write("replacement", b"<mzML>bbbb</mzML>");
            fs::remove_file(scratch.join("sample.mzML")).expect("remove");
            fs::rename(&replacement, scratch.join("sample.mzML")).expect("put it in place");
        },
    )
    .expect_err("a refusal");

    assert_eq!(project_refusal(refusal), ProjectError::ContentChanged);
    assert_eq!(remembered_row(&projects, id), None);
}

/// A bundle is proved from every member, not from its primary.
///
/// The primary is untouched here: only the companion is replaced, and only
/// after both were hashed. A proof that covered the primary alone would find
/// its one identity unchanged and claim the row.
#[test]
fn a_bundle_whose_companion_is_replaced_after_the_proof_is_not_claimed() {
    let scratch = Scratch::new("reattach-bundle-companion");
    let primary = scratch.write("acquisition.wiff", &wiff_container_bytes(&SCIEX_MARKERS));
    let companion = scan_companion_bytes("opaque spectral payload");
    scratch.write("acquisition.wiff.scan", &companion);
    let projects = ProjectStore::new();
    projects
        .create("Reattachment".to_owned(), false)
        .expect("a new project");
    let id = projects.register_input(&primary).expect("register");
    // The record really does name both members; without that this test would
    // be about a single-file input wearing a bundle's name.
    assert_eq!(projects.describe().inputs[0].members.len(), 2);
    let service = workspace();

    let refusal = add_project_input_to_workspace_between(
        &projects,
        &service,
        projects.accept_job().expect("accept"),
        id,
        || {
            // The same companion bytes, a different companion object. The
            // primary is not touched at all.
            let replacement = scratch.write("replacement.scan", &companion);
            fs::remove_file(scratch.join("acquisition.wiff.scan")).expect("remove the companion");
            fs::rename(&replacement, scratch.join("acquisition.wiff.scan"))
                .expect("put it in place");
        },
    )
    .expect_err("a refusal");

    assert_eq!(project_refusal(refusal), ProjectError::ContentChanged);
    assert_eq!(remembered_row(&projects, id), None);
}

/// The window the same-object proof exists for, made reachable.
///
/// A bundle is measured one member at a time, and each member's handle is
/// released before the next one is opened. So while the *companion* is being
/// hashed, the primary is no longer held -- and that is a moment a test can act
/// in, unlike the instruction-width gap a single-member input leaves.
///
/// The primary is replaced there, by an object holding the very same bytes.
/// Nothing downstream can see it on its own: the digests still match, the
/// lengths are equal, the path is unchanged, and any identity question asked
/// from that moment on -- by this module or by workspace admission -- answers
/// about the replacement and agrees with every other such question.
///
/// What refuses it is that the primary's identity was taken through the handle
/// the primary's bytes were hashed through, before the replacement existed. An
/// implementation that established identity from the path after the reads were
/// done would observe the replacement on both sides, find them equal, and claim
/// a row for an object it never measured.
#[test]
fn a_member_replaced_once_its_own_read_is_done_is_not_claimed() {
    let scratch = Scratch::new("reattach-member-swapped");
    let container = wiff_container_bytes(&SCIEX_MARKERS);
    let primary = scratch.write("acquisition.wiff", &container);
    scratch.write(
        "acquisition.wiff.scan",
        &scan_companion_bytes("opaque spectral payload"),
    );
    let projects = ProjectStore::new();
    projects
        .create("Reattachment".to_owned(), false)
        .expect("a new project");
    let id = projects.register_input(&primary).expect("register");
    assert_eq!(projects.describe().inputs[0].members.len(), 2);
    let service = workspace();
    let proved = crate::local_document::object_identity(&scratch.join("acquisition.wiff"));

    // The gate fires once per chunk handed to a digest, member by member. Which
    // call lands in which member is not something to count out -- the reader
    // hands over a final empty chunk too -- so the swap simply tries on every
    // call and lets the platform decide when it is allowed.
    //
    // That is not a workaround, it is the mechanism under test. While the
    // primary is being hashed its own handle denies delete sharing, so the
    // attempt fails; the first call on which it succeeds is therefore a call
    // where the primary is no longer held, which is exactly the moment this
    // test needs and the only one it could be.
    let attempts = Arc::new(AtomicUsize::new(0));
    let done = Arc::new(AtomicBool::new(false));
    let counted = Arc::clone(&attempts);
    let settled = Arc::clone(&done);
    let directory = scratch.directory().to_path_buf();
    let swapped = container.clone();
    let cancellation = Cancellation::with_gate(Arc::new(move || {
        if settled.load(Ordering::SeqCst) {
            return;
        }
        counted.fetch_add(1, Ordering::SeqCst);
        let replacement = directory.join("replacement.wiff");
        let acquisition = directory.join("acquisition.wiff");
        if fs::write(&replacement, &swapped).is_err() {
            return;
        }
        if fs::remove_file(&acquisition).is_err() {
            let _ = fs::remove_file(&replacement);
            return;
        }
        fs::rename(&replacement, &acquisition).expect("put the replacement in place");
        settled.store(true, Ordering::SeqCst);
    }));
    let job = projects.accept_job_with(cancellation).expect("accept");

    let refusal =
        add_project_input_to_workspace(&projects, &service, job, id).expect_err("a refusal");

    assert!(
        done.load(Ordering::SeqCst),
        "the replacement has to have happened, or this test asserts nothing"
    );
    assert!(
        attempts.load(Ordering::SeqCst) > 1,
        "and it has to have been refused first, while the primary was still held"
    );
    assert_ne!(
        crate::local_document::object_identity(&scratch.join("acquisition.wiff")),
        proved,
        "this test is only meaningful while the primary really was replaced"
    );
    assert_eq!(project_refusal(refusal), ProjectError::ContentChanged);
    assert_eq!(
        remembered_row(&projects, id),
        None,
        "the project claims no row for an object it never measured"
    );
}

/// The positive control beside the two refusals above.
///
/// The same bundle, nothing replaced: it is admitted as one row and the
/// project claims it. Without this, "a bundle is refused" would be equally
/// consistent with a bundle never being admitted at all.
#[test]
fn an_untouched_bundle_is_admitted_as_one_row_and_claimed() {
    let scratch = Scratch::new("reattach-bundle-intact");
    let primary = scratch.write("acquisition.wiff", &wiff_container_bytes(&SCIEX_MARKERS));
    scratch.write(
        "acquisition.wiff.scan",
        &scan_companion_bytes("opaque spectral payload"),
    );
    let projects = ProjectStore::new();
    projects
        .create("Reattachment".to_owned(), false)
        .expect("a new project");
    let id = projects.register_input(&primary).expect("register");
    let service = workspace();

    let result = add(&projects, &service, id).expect("the bundle is admitted");

    assert_eq!(result.roster.datasets.len(), 1);
    assert_eq!(
        remembered_row(&projects, id).as_deref(),
        admitted_handle(&result),
        "both members were proved and both were admitted, so the row is this reference's"
    );
}

/// What the same-object proof deliberately does not cover, pinned so it cannot
/// change quietly.
///
/// An equal-length rewrite *of the same object*, after the content proof and
/// before admission. The identity is untouched -- it is the same object -- so
/// the binding is satisfied and the row is claimed, while the bytes in it are
/// no longer the recorded bytes.
///
/// This is not a hole the binding could close: identity proves "same object"
/// and a digest proves "same bytes", and neither substitutes for the other. To
/// close it this operation would have to hold the user's file against every
/// writer for the length of a workspace admission, which is a worse trade than
/// the window it removes. What bounds it instead is downstream and already
/// exists: the workspace rehashes an acquisition at the moment it reads one,
/// and refuses a row whose bytes have moved on.
///
/// Recorded as a characterization rather than as an endorsement. If the
/// answer here ever changes, it should change because somebody decided it
/// should.
#[test]
fn an_equal_length_rewrite_of_the_same_object_after_the_proof_is_still_claimed() {
    let scratch = Scratch::new("reattach-rewritten-same-object");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML>aaaa</mzML>");
    let service = workspace();
    let proved = crate::local_document::object_identity(&scratch.join("sample.mzML"));

    let result = add_project_input_to_workspace_between(
        &projects,
        &service,
        projects.accept_job().expect("accept"),
        id,
        || {
            // In place, so the object is the same object throughout.
            fs::write(scratch.join("sample.mzML"), b"<mzML>bbbb</mzML>").expect("rewrite");
        },
    )
    .expect("the object is the one that was proved, so the binding is satisfied");

    assert_eq!(
        crate::local_document::object_identity(&scratch.join("sample.mzML")),
        proved,
        "an in-place rewrite is the same object, which is exactly why this gets through"
    );
    assert!(
        remembered_row(&projects, id).is_some(),
        "the binding answers about objects and this is the object it was given"
    );
    assert!(admitted_handle(&result).is_some());
}

/// Windows-specific. The M8.1 stable-read contract, asserted rather than
/// inferred: while a member is being hashed, nobody else can open it for
/// writing, so the bytes the digest covers cannot be rewritten underneath it.
#[cfg(windows)]
#[test]
fn an_in_place_rewrite_is_blocked_while_the_read_handle_is_held() {
    let scratch = Scratch::new("reattach-rewrite-blocked");
    let bytes = vec![b'e'; 512 * 1024];
    let (projects, id) = project_with(&scratch, "sample.mzML", &bytes);
    let service = workspace();

    let reached = Arc::new(Barrier::new(2));
    let proceed = Arc::new(Barrier::new(2));
    let inside = Arc::clone(&reached);
    let resume = Arc::clone(&proceed);
    let once = Arc::new(AtomicBool::new(true));
    let cancellation = Cancellation::with_gate(Arc::new(move || {
        if once.swap(false, Ordering::SeqCst) {
            inside.wait();
            resume.wait();
        }
    }));
    let job = projects.accept_job_with(cancellation).expect("accept");

    std::thread::scope(|scope| {
        let worker = scope.spawn(|| add_project_input_to_workspace(&projects, &service, job, id));
        // Provably inside the read of that member, with no sleep anywhere.
        reached.wait();
        let refused = fs::OpenOptions::new()
            .write(true)
            .open(scratch.join("sample.mzML"))
            .expect_err("a writer must not get in while the digest is running");
        // ERROR_SHARING_VIOLATION. The measurement is what holds it off.
        assert_eq!(refused.raw_os_error(), Some(32));
        proceed.wait();
        worker
            .join()
            .expect("the worker finished")
            .expect("the unrewritten object is admitted");
    });

    assert_eq!(service.roster().datasets.len(), 1);
    assert!(remembered_row(&projects, id).is_some());
}

#[test]
fn a_project_replaced_while_the_read_runs_admits_nothing() {
    let scratch = Scratch::new("reattach-replace-midread");
    // Large enough that the digest is streamed in more than one chunk, so the
    // gate below is reached while the read is genuinely in progress.
    let bytes = vec![b'a'; 512 * 1024];
    let (projects, id) = project_with(&scratch, "sample.mzML", &bytes);
    let service = workspace();

    let reached = Arc::new(Barrier::new(2));
    let proceed = Arc::new(Barrier::new(2));
    let inside = Arc::clone(&reached);
    let resume = Arc::clone(&proceed);
    let once = Arc::new(AtomicBool::new(true));
    let cancellation = Cancellation::with_gate(Arc::new(move || {
        if once.swap(false, Ordering::SeqCst) {
            inside.wait();
            resume.wait();
        }
    }));
    let job = projects
        .accept_job_with(cancellation)
        .expect("accept the operation");

    std::thread::scope(|scope| {
        let worker = scope.spawn(|| add_project_input_to_workspace(&projects, &service, job, id));
        // Provably inside the read, with no sleep anywhere.
        reached.wait();
        projects
            .create("Another project".to_owned(), true)
            .expect("replace the project under the read");
        proceed.wait();
        let refusal = worker
            .join()
            .expect("the worker finished")
            .expect_err("a refusal");
        assert_eq!(project_refusal(refusal), ProjectError::StaleDocument);
    });

    assert!(
        service.roster().datasets.is_empty(),
        "work proved for one project does not admit into another"
    );
}

#[test]
fn a_reference_relinked_while_the_read_runs_admits_nothing() {
    let scratch = Scratch::new("reattach-relink-midread");
    let bytes = vec![b'b'; 512 * 1024];
    let (projects, id) = project_with(&scratch, "sample.mzML", &bytes);
    let service = workspace();
    let elsewhere = scratch.write("moved/sample.mzML", &bytes);

    let reached = Arc::new(Barrier::new(2));
    let proceed = Arc::new(Barrier::new(2));
    let inside = Arc::clone(&reached);
    let resume = Arc::clone(&proceed);
    let once = Arc::new(AtomicBool::new(true));
    let cancellation = Cancellation::with_gate(Arc::new(move || {
        if once.swap(false, Ordering::SeqCst) {
            inside.wait();
            resume.wait();
        }
    }));
    let job = projects.accept_job_with(cancellation).expect("accept");

    std::thread::scope(|scope| {
        let worker = scope.spawn(|| add_project_input_to_workspace(&projects, &service, job, id));
        reached.wait();
        // The proposal itself is not a mutation; confirming it is, and it is
        // what makes the record name something else.
        projects.propose_relink(id, &elsewhere).expect("propose");
        projects.commit_relink(id).expect("confirm");
        proceed.wait();
        let refusal = worker.join().expect("finished").expect_err("a refusal");
        assert_eq!(project_refusal(refusal), ProjectError::StaleDocument);
    });

    assert!(service.roster().datasets.is_empty());
}

#[test]
fn a_reference_removed_while_the_read_runs_admits_nothing() {
    let scratch = Scratch::new("reattach-remove-midread");
    let bytes = vec![b'c'; 512 * 1024];
    let (projects, id) = project_with(&scratch, "sample.mzML", &bytes);
    let service = workspace();

    let reached = Arc::new(Barrier::new(2));
    let proceed = Arc::new(Barrier::new(2));
    let inside = Arc::clone(&reached);
    let resume = Arc::clone(&proceed);
    let once = Arc::new(AtomicBool::new(true));
    let cancellation = Cancellation::with_gate(Arc::new(move || {
        if once.swap(false, Ordering::SeqCst) {
            inside.wait();
            resume.wait();
        }
    }));
    let job = projects.accept_job_with(cancellation).expect("accept");

    std::thread::scope(|scope| {
        let worker = scope.spawn(|| add_project_input_to_workspace(&projects, &service, job, id));
        reached.wait();
        projects.remove_input(id).expect("remove the reference");
        proceed.wait();
        let refusal = worker.join().expect("finished").expect_err("a refusal");
        assert_eq!(project_refusal(refusal), ProjectError::StaleDocument);
    });

    assert!(service.roster().datasets.is_empty());
}

#[test]
fn a_cancel_during_the_hash_admits_nothing() {
    let scratch = Scratch::new("reattach-cancelled");
    let bytes = vec![b'd'; 512 * 1024];
    let (projects, id) = project_with(&scratch, "sample.mzML", &bytes);
    let service = workspace();

    let reached = Arc::new(Barrier::new(2));
    let proceed = Arc::new(Barrier::new(2));
    let inside = Arc::clone(&reached);
    let resume = Arc::clone(&proceed);
    let once = Arc::new(AtomicBool::new(true));
    let cancellation = Cancellation::with_gate(Arc::new(move || {
        if once.swap(false, Ordering::SeqCst) {
            inside.wait();
            resume.wait();
        }
    }));
    let job = projects.accept_job_with(cancellation).expect("accept");

    std::thread::scope(|scope| {
        let worker = scope.spawn(|| add_project_input_to_workspace(&projects, &service, job, id));
        reached.wait();
        projects.cancel_job(job);
        proceed.wait();
        let refusal = worker.join().expect("finished").expect_err("a refusal");
        assert_eq!(project_refusal(refusal), ProjectError::Cancelled);
    });

    assert!(service.roster().datasets.is_empty());
    assert_eq!(remembered_row(&projects, id), None);
}

// ---------------------------------------------------------------------------
// M8.4: a layer outlives the row it was created from
// ---------------------------------------------------------------------------

/// Creates the layer of one reference, asking the real roster whether the
/// remembered row is still there -- the closure the command passes.
fn create_layer(
    projects: &ProjectStore,
    service: &PreviewService,
    id: InputId,
) -> Result<LayerId, ProjectError> {
    projects.create_layer(id, |handle| {
        service.dataset_object_identities(handle).is_some()
    })
}

/// The layers as the interface receives them.
fn layers_of(projects: &ProjectStore) -> serde_json::Value {
    serde_json::to_value(projects.describe().layers).expect("serializable")
}

#[test]
fn a_layer_remains_when_its_row_is_removed_and_when_the_workspace_is_cleared() {
    let scratch = Scratch::new("layer-row-gone");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let other = projects
        .register_input(&scratch.write("other.mzML", b"<mzML>other</mzML>"))
        .expect("register");
    let service = workspace();
    let result = add(&projects, &service, id).expect("admitted");
    let handle = admitted_handle(&result).expect("a row").to_owned();
    let layer = create_layer(&projects, &service, id).expect("the layer is created");
    let before = layers_of(&projects);

    service
        .remove_datasets(std::slice::from_ref(&handle))
        .expect("remove the row");

    assert!(service.roster().datasets.is_empty());
    assert_eq!(layers_of(&projects), before, "the layer is unchanged");
    // Rust still remembers the row: nothing here notices a row leaving, and
    // the interface resolves the handle against the roster it holds.
    assert_eq!(
        remembered_row(&projects, id).as_deref(),
        Some(handle.as_str())
    );
    // Positive control: the existing layer is answered without the roster.
    assert_eq!(create_layer(&projects, &service, id), Ok(layer));
    // Negative control: a reference whose row is gone and which has no layer
    // yet is refused by the roster's real answer.
    let other_result = add(&projects, &service, other).expect("admitted");
    let other_handle = admitted_handle(&other_result).expect("a row").to_owned();
    service
        .remove_datasets(std::slice::from_ref(&other_handle))
        .expect("remove the other row");
    assert_eq!(
        create_layer(&projects, &service, other),
        Err(ProjectError::NotInWorkbench)
    );
    assert_eq!(layers_of(&projects), before);

    // Re-admitted, then the whole workspace emptied.
    let again = add(&projects, &service, id).expect("admitted again");
    let second_handle = admitted_handle(&again).expect("a row").to_owned();
    assert_eq!(create_layer(&projects, &service, id), Ok(layer));
    service.clear_workspace().expect("clear the workspace");

    assert!(service.roster().datasets.is_empty());
    assert_eq!(layers_of(&projects), before);
    assert_eq!(
        remembered_row(&projects, id).as_deref(),
        Some(second_handle.as_str())
    );
}

#[test]
fn creating_describing_and_removing_a_layer_launches_no_process_and_moves_no_row() {
    // The provider panics on any probe, reconfiguration or run, so reaching
    // the end is the proof that none happened.
    let scratch = Scratch::new("layer-no-process");
    let (projects, id) = project_with(&scratch, "sample.mzML", b"<mzML/>");
    let service = workspace();
    let result = add(&projects, &service, id).expect("admitted");
    let handle = admitted_handle(&result).expect("a row").to_owned();

    let layer = create_layer(&projects, &service, id).expect("created");
    let described = projects.describe();
    assert_eq!(described.layers.len(), 1);
    assert_eq!(described.layers[0].id, layer.to_string());
    assert_eq!(described.layers[0].source_input_id, id.to_string());
    projects.remove_layer(layer).expect("removed");
    assert!(projects.describe().layers.is_empty());

    let roster = service.roster();
    assert_eq!(roster.datasets.len(), 1);
    assert_eq!(roster.datasets[0].handle, handle);
    assert_eq!(
        remembered_row(&projects, id).as_deref(),
        Some(handle.as_str()),
        "neither creating nor removing a layer touches the row or the memory of it"
    );
}
