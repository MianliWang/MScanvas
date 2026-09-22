/// Reading and replacing one small local document. Shared by the preference
/// store and the project store so that the same-directory replacement sequence
/// exists once.
mod local_document;
/// The narrow, Rust-owned UI preference store. Separate from `preview` on
/// purpose: it holds no scientific state, confers no authority and shares no
/// lane with the conversion, process or roster locks.
mod preferences;
mod preview;
/// The project record store: what a saved project references, what was run over
/// it, and the only new write authority in M8.1. Separate from `preview` for
/// the same reason `preferences` is: a project references files, it does not
/// admit them, and the two collections stay distinct.
mod project;
/// The one explicit bridge between the project document and the live
/// workspace. Separate from both, so the crossing is a named thing rather than
/// a dependency either of them grew. See the module for what each side decides.
mod reattachment;

use preferences::UiPreferenceStore;
use preferences::dto::{UiPreferenceReadDto, UiPreferenceSaveDto, UiPreferenceWriteDto};

/// The session's preference store, shared so a command can take it onto a
/// blocking thread.
type SharedPreferences = Arc<UiPreferenceStore>;

/// Reads the stored UI preferences for a starting document.
///
/// Reads and never writes: a first run is answered as absent rather than given
/// a file, and a record this build cannot use is reported and left exactly as
/// found. The webview names no path, no file and no key -- there is no argument
/// to name one with.
///
/// Bound to the calling document like every other owned operation here. A
/// preference commit is authority over a file in the user's profile, and the
/// answer to a read is what the next commit merges onto.
#[tauri::command]
async fn load_ui_preferences(
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    preferences: State<'_, SharedPreferences>,
) -> Result<UiPreferenceReadDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let preferences = Arc::clone(&preferences);
    // A profile volume can be slow, and a preference read is not something to
    // hold an async worker for.
    off_the_async_runtime(move || preferences.load()).await
}

/// Commits one half of the UI preference record.
///
/// The payload names a field group and nothing else: no path, no file name, no
/// arbitrary document and no filesystem capability. Which group is committed is
/// what keeps a Settings apply and a panel toggle from overwriting each other,
/// and the answer identifies the exact snapshot that was published and read
/// back -- an uncertain outcome is reported as a failure rather than as saved.
#[tauri::command]
async fn save_ui_preferences(
    request: UiPreferenceWriteDto,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    preferences: State<'_, SharedPreferences>,
) -> Result<UiPreferenceSaveDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let preferences = Arc::clone(&preferences);
    off_the_async_runtime(move || preferences.save(&request)).await
}

// ---------------------------------------------------------------------------
// Project record commands.
//
// The M8.1 slice. Every one of these is bound to the calling document like the
// preference commands beside them, because a project save is authority over a
// file the user chose, and a stale document must not be able to exercise it.
//
// The webview names no path in either direction. It asks for a dialog, Rust
// shows it, and what comes back is a description of the project in which every
// record is addressed by identifier. No absolute path is ever sent to the page.
// ---------------------------------------------------------------------------

/// The session's project store.
type SharedProjects = Arc<project::ProjectStore>;

use reattachment::ProjectAdmissionDto;

/// How a project refusal reaches the interface.
///
/// The stable identifier is the payload; the sentence is an English fallback
/// for a surface that has no localized string for it yet. Neither carries a
/// path, a file name or anything out of the document.
fn project_error(error: project::ProjectError) -> PreviewErrorDto {
    use project::ProjectError as Refusal;

    let message = match error {
        Refusal::UnsavedChanges => "This project has changes that have not been saved.",
        Refusal::NoOpenProject => "No project is open.",
        Refusal::NotYetPublished => "This project has not been saved anywhere yet. Use Save As.",
        Refusal::UnknownRecord => "That record is not part of the open project.",
        Refusal::Document(_) => "That project file could not be used, and was left unchanged.",
        Refusal::DestinationNotNamed => "Choose a filename ending in .mscanvas for a project.",
        Refusal::DestinationNotAProject => {
            "That file is not an MSCanvas project, so it was not replaced."
        }
        Refusal::DestinationAliasesInput => {
            "That file is one this project references, so it was not replaced."
        }
        Refusal::StaleDocument => {
            "That project file has changed since it was opened, so it was not replaced."
        }
        Refusal::NotPublished => "The project could not be saved. The previous file is unchanged.",
        Refusal::Oversized => "This project is larger than MSCanvas saves.",
        Refusal::Unavailable(_) => "That file could not be read.",
        Refusal::NotChecked => "Check this file before adding it to the Workbench.",
        Refusal::ContentChanged => "That file has changed since the project recorded it.",
        Refusal::ObjectNotIdentified => {
            "This drive cannot identify that file, so it cannot be added to the Workbench."
        }
        Refusal::Cancelled => "Cancelled.",
        Refusal::NothingSelected => "Nothing was selected.",
        Refusal::AlreadyRunning => "Another check is already running.",
        Refusal::StaleOperation => "That operation is no longer the one running.",
        Refusal::NotInWorkbench => "Add this reference to the Workbench before creating its layer.",
        Refusal::LayerDependsOnInput => {
            "Remove this reference's layer before removing the reference."
        }
    };
    PreviewErrorDto::new(error.stable_id(), message, error.retryable())
}

/// Describes the session's project.
#[tauri::command]
async fn get_project_state(
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    Ok(projects.describe())
}

/// Starts a new empty project.
#[tauri::command]
async fn create_project(
    name: String,
    discard_unsaved: bool,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    projects
        .create(name, discard_unsaved)
        .map_err(project_error)?;
    Ok(projects.describe())
}

/// Closes the open project.
#[tauri::command]
async fn close_project(
    discard_unsaved: bool,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    projects.close(discard_unsaved).map_err(project_error)?;
    Ok(projects.describe())
}

/// Shows the picker and opens the chosen project document.
///
/// The document is parsed and validated whole before any live state is
/// replaced, so a refusal leaves the open project exactly as it was. Nothing
/// inside it is resolved or read: every reference comes back `notChecked`.
#[tauri::command]
async fn open_project(
    discard_unsaved: bool,
    app: tauri::AppHandle,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<Option<project::dto::ProjectStateDto>, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let projects = Arc::clone(&projects);
    let Some(chosen) = chosen_file(&app, preview::dialog::PROJECT_OPEN_DIALOG).await? else {
        return Ok(None);
    };
    off_the_async_runtime(move || {
        projects
            .open_document(&chosen, discard_unsaved)
            .map_err(project_error)?;
        Ok(Some(projects.describe()))
    })
    .await?
}

/// Republishes the open project over the document this session bound.
#[tauri::command]
async fn save_project(
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let projects = Arc::clone(&projects);
    off_the_async_runtime(move || {
        projects.save().map_err(project_error)?;
        Ok(projects.describe())
    })
    .await?
}

/// Shows the save dialog and publishes the project where the user chose.
#[tauri::command]
async fn save_project_as(
    app: tauri::AppHandle,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<Option<project::dto::ProjectStateDto>, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let projects = Arc::clone(&projects);
    let owner = main_window_handle(&app);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(preview::dialog::choose_save_destination(
            owner,
            preview::dialog::PROJECT_SAVE_DIALOG,
            "project.mscanvas",
        ));
    })
    .map_err(|_| picker_unavailable())?;

    off_the_async_runtime(move || {
        let Some(destination) = receiver.recv().map_err(|_| picker_unavailable())?? else {
            return Ok(None);
        };
        projects.save_as(&destination).map_err(project_error)?;
        Ok(Some(projects.describe()))
    })
    .await?
}

/// Shows the picker and registers the chosen file as a reference.
///
/// Registering a file records where it is and what it currently contains. It
/// asserts nothing about the file being a supported acquisition, and it admits
/// nothing to the workspace roster.
#[tauri::command]
async fn add_project_input(
    app: tauri::AppHandle,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<Option<project::dto::ProjectStateDto>, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let projects = Arc::clone(&projects);
    let Some(chosen) = chosen_file(&app, preview::dialog::PROJECT_INPUT_DIALOG).await? else {
        return Ok(None);
    };
    off_the_async_runtime(move || {
        projects.register_input(&chosen).map_err(project_error)?;
        Ok(Some(projects.describe()))
    })
    .await?
}

/// Removes one reference, and the history that named it.
///
/// Never touches the file it referenced. Removing a row is the only thing that
/// removes a row.
#[tauri::command]
async fn remove_project_input(
    input_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let id = parsed_input_id(&input_id)?;
    projects.remove_input(id).map_err(project_error)?;
    Ok(projects.describe())
}

/// Accepts one check or capture and answers the identifier it will run under.
///
/// Deliberately separate from running it, and deliberately quick: Tauri
/// dispatches invokes as independent fetches, so a cancel pressed the instant
/// after a check is started could otherwise reach Rust before the check itself
/// and find nothing to cancel -- and the check would then run to completion.
/// Accepting first gives the operation an identity and a cancellation state
/// that a cancel can find before any file is opened. The identifier is
/// correlation only; it names no path and confers no authority.
#[tauri::command]
async fn begin_project_job(
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectJobDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let id = projects.accept_job().map_err(project_error)?;
    Ok(project::dto::ProjectJobDto {
        operation_id: id.handle(),
    })
}

/// Checks every reference in the open project against its recorded baseline.
///
/// Runs the operation `begin_project_job` accepted. The press is what
/// authorises reading the displayed reference set. It authorises nothing else:
/// no other directory is looked at, and nothing is admitted, opened in a viewer
/// or converted as a result.
#[tauri::command]
async fn check_project_links(
    operation_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let id = parsed_job_id(&operation_id)?;
    let projects = Arc::clone(&projects);
    // Hashing is why this is off the async runtime: a check reads every
    // referenced file whole, and a large acquisition must not hold a worker.
    off_the_async_runtime(move || {
        projects.check_linked_files(id).map_err(project_error)?;
        Ok(projects.describe())
    })
    .await?
}

/// Asks one accepted operation to stop.
///
/// Names the operation, so a cancel that arrives late -- after its operation
/// finished, or after a different one was accepted -- changes nothing and says
/// so. It is never an error: "nothing to cancel" is an answer, not a failure.
#[tauri::command]
async fn cancel_project_job(
    operation_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::CancelOutcomeDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    // An identifier this build never minted names nothing, which is the same
    // answer as an identifier whose operation is gone.
    let outcome = match project::ProjectJobId::parse(&operation_id) {
        Some(id) => projects.cancel_job(id),
        None => project::CancelOutcome::NoActiveOperation,
    };
    Ok(project::dto::CancelOutcomeDto {
        outcome: outcome.stable_id(),
    })
}

/// Runs `CaptureFileFactsV1` over the selected references.
///
/// Records what the selected files actually contain. It is not analysis, not
/// conversion and not QC, and a run that could not observe every selected
/// reference records its real outcome and produces no artifact.
#[tauri::command]
async fn capture_project_file_facts(
    operation_id: String,
    input_ids: Vec<String>,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let job = parsed_job_id(&operation_id)?;
    let mut selected = Vec::with_capacity(input_ids.len());
    for id in &input_ids {
        selected.push(parsed_input_id(id)?);
    }
    let projects = Arc::clone(&projects);
    let (outcome, described) = off_the_async_runtime(move || {
        let outcome = projects.capture_file_facts(job, &selected);
        (outcome, projects.describe())
    })
    .await?;
    // The run is recorded whichever way the capture went, so a refusal here is
    // still a refusal with a recorded run behind it. The interface re-reads the
    // project to see it.
    match outcome {
        Ok(_) => Ok(described),
        Err(error) => Err(project_error(error)),
    }
}

/// Shows the picker and examines one candidate for a reference.
///
/// Looks at exactly the file the user pointed at. Nothing is scanned, nothing
/// is substituted, and nothing is committed until the confirmation below.
#[tauri::command]
async fn propose_project_relink(
    input_id: String,
    app: tauri::AppHandle,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<Option<project::dto::ProjectStateDto>, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let id = parsed_input_id(&input_id)?;
    let projects = Arc::clone(&projects);
    let Some(chosen) = chosen_file(&app, preview::dialog::RELINK_CANDIDATE_DIALOG).await? else {
        return Ok(None);
    };
    off_the_async_runtime(move || {
        projects
            .propose_relink(id, &chosen)
            .map_err(project_error)?;
        Ok(Some(projects.describe()))
    })
    .await?
}

/// Commits the relink the user was shown.
#[tauri::command]
async fn commit_project_relink(
    input_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let id = parsed_input_id(&input_id)?;
    projects.commit_relink(id).map_err(project_error)?;
    Ok(projects.describe())
}

/// Adds the file one project reference names to the session workspace.
///
/// The webview names no path. It names the reference, by the identifier the
/// project description already gave it, and the operation it accepted; Rust
/// resolves that reference through the open project, proves the file still
/// holds the recorded bytes, and hands *that* object to the workspace
/// admission boundary every other import goes through.
///
/// Nothing here starts a preview or a backend process. Admission is filesystem
/// work, and a reference that becomes a row becomes one the user can then read
/// by asking, exactly as a row added through the picker does.
#[tauri::command]
async fn add_project_input_to_workspace(
    operation_id: String,
    input_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<ProjectAdmissionDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let job = parsed_job_id(&operation_id)?;
    let id = parsed_input_id(&input_id)?;
    let projects = Arc::clone(&projects);
    let service = Arc::clone(&service);
    // Off the async runtime because the proof hashes the whole acquisition,
    // for the same reason a check is.
    let (outcome, described) = off_the_async_runtime(move || {
        let outcome = reattachment::add_project_input_to_workspace(&projects, &service, job, id);
        (outcome, projects.describe())
    })
    .await?;
    match outcome {
        Ok(workspace) => Ok(ProjectAdmissionDto {
            project: described,
            workspace,
        }),
        Err(reattachment::AdmissionRefusal::Project(error)) => Err(project_error(error)),
        // The workspace's own refusal, unchanged. Translating it into project
        // vocabulary would invent a project meaning for something that is not
        // a project fact.
        Err(reattachment::AdmissionRefusal::Workspace(error)) => Err(error),
    }
}

/// Creates the layer of one reference, or answers the one it already has.
///
/// Reads no file and starts nothing. The one question asked outside the
/// project is whether the row the project remembers for this reference is
/// still in the roster, which is an in-memory lookup; a reference with no live
/// row is refused rather than re-admitted, because pressing this is not a
/// request to add anything to the Workbench.
#[tauri::command]
async fn create_project_layer(
    input_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let id = parsed_input_id(&input_id)?;
    projects
        .create_layer(id, |handle| {
            service.dataset_object_identities(handle).is_some()
        })
        .map_err(project_error)?;
    Ok(projects.describe())
}

/// Removes one layer. The reference it was sourced from stays.
#[tauri::command]
async fn remove_project_layer(
    layer_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    let id = parsed_layer_id(&layer_id)?;
    projects.remove_layer(id).map_err(project_error)?;
    Ok(projects.describe())
}

/// Abandons an outstanding relink proposal.
#[tauri::command]
async fn abandon_project_relink(
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
    projects: State<'_, SharedProjects>,
) -> Result<project::dto::ProjectStateDto, PreviewErrorDto> {
    verified_document_epoch(&ipc_request, &webview, &service).await?;
    projects.abandon_relink();
    Ok(projects.describe())
}

/// Shows one single-file picker on the main thread and waits for the answer.
///
/// The wait is blocking and the dialog is modal, so it lasts as long as the
/// user takes to choose. That is not something to hold an async worker for.
async fn chosen_file(
    app: &tauri::AppHandle,
    facts: preview::dialog::OpenDialogFacts,
) -> Result<Option<std::path::PathBuf>, PreviewErrorDto> {
    let owner = main_window_handle(app);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(preview::dialog::choose_one_file(owner, facts));
    })
    .map_err(|_| picker_unavailable())?;
    off_the_async_runtime(move || receiver.recv().map_err(|_| picker_unavailable())?).await?
}

/// Reads one operation identifier the webview sent.
///
/// An identifier this build never minted is a stale operation: it names
/// nothing that can run, and the refusal deliberately does not echo it back.
fn parsed_job_id(value: &str) -> Result<project::ProjectJobId, PreviewErrorDto> {
    project::ProjectJobId::parse(value)
        .ok_or_else(|| project_error(project::ProjectError::StaleOperation))
}

/// Reads one input identifier the webview sent.
///
/// Refused rather than looked up loosely. The identifier came from outside, and
/// the refusal deliberately does not echo it back.
fn parsed_input_id(value: &str) -> Result<project::record::InputId, PreviewErrorDto> {
    value
        .parse()
        .map_err(|()| project_error(project::ProjectError::UnknownRecord))
}

/// Reads one layer identifier the webview sent, under the same rule.
fn parsed_layer_id(value: &str) -> Result<project::record::LayerId, PreviewErrorDto> {
    value
        .parse()
        .map_err(|()| project_error(project::ProjectError::UnknownRecord))
}

#[tauri::command]
async fn open_finalized_output(
    output_id: String,
    action: preview::dto::OutputOpenActionDto,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<preview::dto::OutputOpenOutcomeDto, PreviewErrorDto> {
    let document = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.open_finalized_output(&output_id, action, document)).await
}

#[tauri::command]
async fn preview_figure(
    request: preview::dto::FigurePreviewRequestDto,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<preview::dto::FigurePreviewOutcomeDto, PreviewErrorDto> {
    let document = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.preview_figure(&request, document)).await
}

#[tauri::command]
async fn reclaim_conversion_staging(
    recovery_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<preview::dto::StagingReclaimOutcomeDto, PreviewErrorDto> {
    let document = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.reclaim_conversion_staging(&recovery_id, document)).await
}

use preview::dto::{
    WorkspaceClearActionDto, WorkspaceClearOutcomeDto, WorkspaceClearPlanDto,
    WorkspaceClearRefusalDto,
};

#[tauri::command]
async fn plan_workspace_clear(
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<Result<WorkspaceClearPlanDto, WorkspaceClearRefusalDto>, PreviewErrorDto> {
    let document = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.plan_workspace_clear(document)).await
}

#[tauri::command]
async fn execute_workspace_clear(
    plan_id: String,
    action: WorkspaceClearActionDto,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<WorkspaceClearOutcomeDto, PreviewErrorDto> {
    let document = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.execute_workspace_clear(&plan_id, action, document)).await
}

use std::sync::{Arc, mpsc};
use std::time::Duration;

use mscanvas_core::BootstrapStatus;
use serde::Deserialize;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::JavaScriptChannelId;
use tauri::webview::PageLoadEvent;
use tauri::{Manager, State};

use preview::dto::{
    AuthorityObservedDto, BackendReadingDto, ConversionBeginOutcomeDto, ConversionBeginRequestDto,
    ConversionConfigurationSnapshotDto, ConversionDiagnosticsReservationDto,
    ConversionPlanOutcomeDto, ConversionPlanRequestDto, FolderImportReservationDto,
    FolderIngestionResultDto, PreviewDto, PreviewErrorDto, SelectedSpectrumOutcomeDto,
    WorkspaceAddResultDto, WorkspaceConversionUpdateDto, WorkspaceDropSubscriptionReservationDto,
    WorkspaceDropUpdateDto, WorkspaceOutputAdoptionResultDto, WorkspaceRemoveResultDto,
    WorkspaceRosterDto, diagnostics_picker_unavailable, invalid_conversion_reservation,
    invalid_workspace_drop_subscription, spectrum_picker_unavailable,
};
use preview::{PreviewService, ProteoWizardProvider, normalize_window_drop_event};

#[tauri::command]
fn get_bootstrap_status() -> BootstrapStatus {
    BootstrapStatus::new(
        env!("CARGO_PKG_VERSION"),
        "mzml-preview",
        "ProteoWizard is supplied and licensed separately by you",
    )
}

/// Reports whether a user-installed ProteoWizard is usable. MSCanvas never
/// bundles, downloads or installs one.
#[tauri::command]
async fn inspect_backend(
    service: State<'_, SharedService>,
) -> Result<BackendReadingDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.inspect_backend()).await
}

/// Reports what conversion semantics are known for the installation MSCanvas is
/// currently bound to.
///
/// One response answers the whole question: which binding it is about, what is
/// known for that binding, and what happened to this request. The webview never
/// joins a receipt from one response with a catalog from another -- that join is
/// what made a stale catalog installable.
///
/// It may run a `msconvert --help` probe, so it is subject to the same backend
/// lane every other process is; a refusal is reported in the response's own
/// outcome rather than as an error, because the snapshot beside it is still the
/// news for the panel.
#[tauri::command]
async fn read_conversion_configuration(
    service: State<'_, SharedService>,
) -> Result<ConversionConfigurationSnapshotDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.read_conversion_configuration()).await?
}

/// Reports every dataset the session holds, in the order they were added.
///
/// Reads what is already there. No file is revalidated and no process is
/// launched, so drawing the roster costs nothing on the machine.
#[tauri::command]
async fn get_workspace_roster(
    service: State<'_, SharedService>,
) -> Result<WorkspaceRosterDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.roster()).await
}

/// Shows the native picker and adds every chosen file to the workspace.
///
/// Named for the workspace rather than for one format. It admits mzML and the
/// one evidenced Thermo RAW family, so `choose_mzml_files` had become a name
/// that said something false about what it does. The visible action is still
/// `Add files…`.
///
/// This runs asynchronously so the modal dialog can be dispatched onto the main
/// thread without blocking the command dispatcher. Cancelling returns `None`,
/// which is an ordinary outcome rather than an error: nothing was chosen, so
/// nothing changed. It is deliberately not an empty result, which would be a
/// batch that added nothing.
///
/// The webview names no path in either direction. It asks for a picker, Rust
/// shows it, and what comes back is a roster and one outcome per chosen file.
/// Nothing here reads an acquisition and nothing here launches a process: which
/// family each candidate is admitted under is decided by opening and inspecting
/// it, and the picker's extension filter is only what the shell sorts by.
#[tauri::command]
async fn choose_workspace_files(
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<Option<WorkspaceAddResultDto>, PreviewErrorDto> {
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(preview::dialog::choose_workspace_files(owner));
    })
    .map_err(|_| picker_unavailable())?;

    // The wait is blocking and the dialog is modal, so it can last as long as
    // the user takes to choose. That is not something to hold an async worker
    // for.
    off_the_async_runtime(move || {
        let chosen = receiver.recv().map_err(|_| picker_unavailable())??;
        chosen.map(|paths| service.add_files(&paths)).transpose()
    })
    .await?
}

/// Reserves one folder import without opening a picker.
///
/// Deliberately synchronous and deliberately separate from choosing. Tauri
/// dispatches Windows invokes as independent fetches, so requests from a
/// reloaded document can overtake requests from the one it replaced. If this
/// response reaches its document, Rust already holds the returned single-use
/// reservation. If it does not, that document cannot issue the matching
/// chooser. Begin is idempotent at the current workspace generation, so a
/// delayed request from that document can neither replace the live reservation
/// nor supersede a claimed scan.
#[tauri::command]
fn begin_mzml_folder_import(
    service: State<'_, SharedService>,
) -> Result<FolderImportReservationDto, PreviewErrorDto> {
    service.begin_folder_import()
}

/// Shows the native folder picker for one exact reservation and adds every
/// mzML file found beneath the chosen folder.
///
/// The webview names no folder: it returns only the opaque reservation Rust
/// issued. Rust consumes and validates that claim **before** dispatching the
/// dialog. A replacement document, Clear or Remove that overtook it therefore
/// makes it fail without opening a picker; one that follows the claim
/// supersedes the eventual commit through the same generation check.
///
/// Cancelling returns `None`, which is an ordinary outcome rather than an empty
/// scan. Nothing here reads an acquisition or launches a backend process.
#[tauri::command]
async fn choose_mzml_folder(
    reservation_id: String,
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<Option<FolderIngestionResultDto>, PreviewErrorDto> {
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
    let token = service.claim_folder_import(&reservation_id)?;
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(preview::dialog::choose_mzml_folder(owner));
    })
    .map_err(|_| folder_picker_unavailable())?;

    // The wait spans the modal dialog and then the scan, either of which can
    // last as long as the user's filesystem takes. Neither is something to
    // hold an async worker for.
    off_the_async_runtime(move || {
        let chosen = receiver.recv().map_err(|_| folder_picker_unavailable())??;
        chosen
            .map(|root| service.add_mzml_folder(&root, token))
            .transpose()
    })
    .await?
}

/// The typed phases of the one native-drop subscription command.
///
/// `JavaScriptChannelId` is Tauri's strongly typed nested representation of a
/// `Channel`: it accepts only the framework's `__CHANNEL__:<u32>` wire shape and
/// is converted on the injected calling Webview. MSCanvas never accepts or
/// parses an arbitrary callback string or event name.
#[derive(Deserialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum WorkspaceDropSubscriptionRequest {
    Begin,
    Claim {
        reservation_id: String,
        channel: JavaScriptChannelId,
    },
}

const DROP_DOCUMENT_AUTHORITY_HEADER: &str = "mscanvas-document-authority";
const DROP_DOCUMENT_AUTHORITY_PROPERTY: &str = "__MSCANVAS_DOCUMENT_AUTHORITY__";
const DROP_DOCUMENT_AUTHORITY_INITIALIZATION_SCRIPT: &str = r#";
(() => {
  const words = new Uint32Array(4);
  globalThis.crypto.getRandomValues(words);
  const authority = Array.from(
    words,
    (word) => word.toString(16).padStart(8, "0"),
  ).join("");
  Object.defineProperty(globalThis, "__MSCANVAS_DOCUMENT_AUTHORITY__", {
    configurable: false,
    enumerable: false,
    value: authority,
    writable: false,
  });
})();
"#;

fn valid_drop_document_authority(authority: &str) -> bool {
    authority.len() == 32
        && authority
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn drop_document_authority_check_script(authority: &str) -> Option<String> {
    valid_drop_document_authority(authority)
        .then(|| format!("globalThis.{DROP_DOCUMENT_AUTHORITY_PROPERTY} === \"{authority}\""))
}

async fn verify_drop_document_authority(
    webview: &tauri::Webview<tauri::Wry>,
    authority: &str,
) -> Result<(), PreviewErrorDto> {
    let script = drop_document_authority_check_script(authority)
        .ok_or_else(invalid_workspace_drop_subscription)?;
    let (sender, receiver) = mpsc::sync_channel(1);
    webview
        .eval_with_callback(script, move |answer| {
            let _ = sender.send(answer == "true");
        })
        .map_err(|_| invalid_workspace_drop_subscription())?;
    let matches = spawn_blocking(move || {
        receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false);
    matches
        .then_some(())
        .ok_or_else(invalid_workspace_drop_subscription)
}

/// Begins or claims the one path-free native-drop stream for the current main
/// document. Begin retains no Channel. Claim replaces the subscriber only
/// after Rust validates its current-document reservation, then sends the exact
/// current snapshot.
#[tauri::command]
async fn subscribe_workspace_drop_updates(
    request: WorkspaceDropSubscriptionRequest,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<Option<WorkspaceDropSubscriptionReservationDto>, PreviewErrorDto> {
    if webview.label() != "main" {
        return Err(invalid_workspace_drop_subscription());
    }
    let authority = ipc_request
        .headers()
        .get(DROP_DOCUMENT_AUTHORITY_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| valid_drop_document_authority(value))
        .ok_or_else(invalid_workspace_drop_subscription)?
        .to_owned();
    let expected_document_epoch = service.workspace_drop_document_epoch();
    verify_drop_document_authority(&webview, &authority).await?;

    match request {
        WorkspaceDropSubscriptionRequest::Begin => service
            .begin_workspace_drop_subscription(expected_document_epoch)
            .map(Some),
        WorkspaceDropSubscriptionRequest::Claim {
            reservation_id,
            channel,
        } => {
            let channel: tauri::ipc::Channel<WorkspaceDropUpdateDto> = channel.channel_on(webview);
            service.claim_workspace_drop_subscription(
                expected_document_epoch,
                &reservation_id,
                channel,
            )?;
            Ok(None)
        }
    }
}

/// Answers one exact plan question, without starting anything.
///
/// Read-only and free: no gate, no picker, no reservation, no process. It exists
/// so the summary the user reads before deciding is derived from what the run
/// will actually do, rather than composed in the webview from constants that are
/// free to drift from it.
///
/// The request names every fact that changes what the future queue means -- the
/// ordered rows, the selected admitted semantic, the conflict policy and the
/// binding the panel is rendering. The last of those is *checked* rather than
/// echoed: a plan asked under an installation this session has left is refused
/// with the authority it is actually on.
#[tauri::command]
async fn describe_workspace_conversion_queue(
    request: ConversionPlanRequestDto,
    service: State<'_, SharedService>,
) -> Result<ConversionPlanOutcomeDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.conversion_queue_plan(&request)).await?
}

/// Runs every retryable failure of the terminal queue again.
///
/// Takes no destination and no list: the queue already holds both, and asking
/// for either again would make a retry a new decision rather than the same one
/// repeated. Refused unless the queue is terminal and something in it is
/// actually retryable.
///
/// Proves the calling document for the same reason the two halves of the picker
/// reservation do. A retry opens no dialog, but it does launch processes and
/// write files this application creates, and authority over that is not weaker
/// because the folder was chosen earlier. The proof is that the caller is the
/// *current* document, not the one that built the queue -- a reloaded document
/// is entitled to retry what it recovered.
#[tauri::command]
async fn retry_workspace_conversion_queue(
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<WorkspaceConversionUpdateDto, PreviewErrorDto> {
    let document_epoch = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.retry_conversion_queue(document_epoch)).await?
}

/// Stops the running conversion queue of the calling document.
///
/// Takes the operation identifier the caller is looking at and nothing else. No
/// path, no item, no process identifier and no cancellation object crosses:
/// what a caller may say is *which queue*, and the session decides everything
/// about how it ends.
///
/// Proves the calling document exactly as a retry does, and for the same
/// reason. Stopping ends work this application started and decides what happens
/// to files it was writing, so the authority for it is being the current
/// document — which a reloaded document is, and a replaced one is not.
///
/// Idempotent by construction. A second request for a queue already stopping is
/// answered with the authoritative state rather than a refusal, because the
/// user asking twice is asking for the thing that is already happening.
#[tauri::command]
async fn stop_workspace_conversion_queue(
    operation_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<WorkspaceConversionUpdateDto, PreviewErrorDto> {
    let document_epoch = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.stop_conversion_queue(&operation_id, document_epoch))
        .await?
}

/// Stops the one conversion in flight and lets the queue carry on.
///
/// A different promise from stopping the queue, and the two are deliberately
/// separate commands. This one ends one attempt; the queue keeps its bound
/// membership, its order and its finished outputs, and the next item starts.
///
/// The caller names the exact attempt it means -- the operation, the item's
/// index and that item's attempt number. Rust checks all three against what is
/// actually running, under the lock that records the request, so a request
/// built from a read taken a moment ago cannot land on whatever happens to be
/// running now. It is refused instead, and the reply carries the state that
/// says what to ask about.
///
/// Proves the calling document exactly as a stop and a retry do.
#[tauri::command]
async fn cancel_current_workspace_conversion_item(
    operation_id: String,
    item_index: usize,
    attempt: u64,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<WorkspaceConversionUpdateDto, PreviewErrorDto> {
    let document_epoch = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || {
        service.cancel_current_conversion_item(&operation_id, item_index, attempt, document_epoch)
    })
    .await?
}

/// Settles one item that has not started, without running it.
///
/// The item keeps its place in the plan and the plan keeps an answer for it.
/// Taking a row *out* of a bound plan is a different request and is refused
/// outright, because membership is fixed at BEGIN: a plan that could lose a row
/// afterwards could no longer say what it was asked to do.
///
/// Only an item still waiting its turn. One the worker has already started is
/// answered with a refusal rather than a cancellation, so a skip that raced a
/// start never becomes a request to stop work in progress.
#[tauri::command]
async fn skip_pending_workspace_conversion_item(
    operation_id: String,
    item_index: usize,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<WorkspaceConversionUpdateDto, PreviewErrorDto> {
    let document_epoch = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || {
        service.skip_pending_conversion_item(&operation_id, item_index, document_epoch)
    })
    .await?
}

/// Adds a terminal queue's finalized mzML outputs to the workspace.
///
/// Explicit, and never a consequence of a conversion finishing. The caller says
/// which queue and nothing else: which outputs, in which order, and whether each
/// may be admitted are all the session's to decide, and the answer carries no
/// path, no destination and no filesystem identity.
///
/// Proves the calling document exactly as a retry and a stop do. Adding rows
/// changes the list the user is working on, so the authority for it is being the
/// current document -- which a reloaded document is, and a replaced one is not.
///
/// Launches no process. A session that has stopped trusting the backend may
/// still do this, because nothing here runs one; whether the rows it produces
/// can be previewed is a separate question the quarantine already answers.
#[tauri::command]
async fn adopt_workspace_conversion_outputs(
    operation_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<WorkspaceOutputAdoptionResultDto, PreviewErrorDto> {
    let document_epoch = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.adopt_conversion_outputs(&operation_id, document_epoch))
        .await?
}

/// Binds one diagnostics export and reserves the right to choose a file.
///
/// Deliberately synchronous and deliberately separate from saving, for the
/// reason a conversion destination already gives: a webview can reload between
/// any two IPC fetches, so Rust retains the reservation and a document that
/// never receives the identifier can never open a dialog.
///
/// Proves the calling document the same way a retry and an adoption do. What is
/// bound cannot change afterwards — the document, the terminal queue and which
/// settling of it — so a retry started while the dialog is open cannot make the
/// export describe a queue the user was not looking at.
///
/// Launches no process. A session that has stopped trusting the backend may
/// still do this, and that is the case this export exists for.
#[tauri::command]
async fn begin_workspace_conversion_diagnostics_export(
    operation_id: String,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<ConversionDiagnosticsReservationDto, PreviewErrorDto> {
    let document_epoch = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || {
        service.begin_conversion_diagnostics_export(&operation_id, document_epoch)
    })
    .await?
}

/// Draws one committed m/z window of the selected spectrum for the viewport.
///
/// The viewport's read of the same retained spectrum the export lane names, and
/// the answer to a question the webview cannot settle for itself: `mz` and
/// `intensity` in the selected-spectrum payload are bounded for transfer, so a
/// window beyond that prefix has to be drawn from the complete arrays Rust
/// retained. What comes back is a **bounded screen projection** -- real
/// measurements, possibly fewer of them than the window holds, never an
/// invented one -- and it is never what a scientific export is taken from.
///
/// Launches no process, re-reads no acquisition and takes no export lane.
/// Moving a viewport is not re-acquiring a spectrum.
#[tauri::command]
async fn project_selected_spectrum(
    export_token: String,
    low: f64,
    high: f64,
    service: State<'_, SharedService>,
) -> Result<preview::dto::SpectrumProjectionDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.project_selected_spectrum(&export_token, low, high))
        .await?
}

/// Shows the native save dialog for one exact reservation and writes the file.
///
/// The webview names no path: it returns only the opaque reservation Rust
/// issued, and receives back the authoritative conversion state. Rust consumes
/// and validates that claim **before** dispatching the dialog, so a reload or a
/// second request that overtook it fails without opening one.
///
/// Cancelling is an ordinary outcome: nothing was created and nothing was
/// written, and the answer is the same state a later read returns.
#[tauri::command]
async fn save_workspace_conversion_diagnostics(
    reservation_id: String,
    app: tauri::AppHandle,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<WorkspaceConversionUpdateDto, PreviewErrorDto> {
    let document_epoch = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
    service.claim_conversion_diagnostics_export(&reservation_id, document_epoch)?;
    let (sender, receiver) = std::sync::mpsc::channel();
    if app
        .run_on_main_thread(move || {
            let _ = sender.send(preview::dialog::choose_diagnostics_destination(
                owner,
                preview::service::DIAGNOSTICS_EXPORT_FILE_NAME,
            ));
        })
        .is_err()
    {
        // The claim already took the slot. A dispatch that never happened
        // leaves nothing to close it, so without this the session would hold a
        // reservation whose dialog does not exist -- and every action on the
        // terminal queue would stay refused until a reload.
        service.cancel_conversion_diagnostics_export(&reservation_id);
        return Err(diagnostics_picker_unavailable());
    }

    // Moved into the worker so a cancellation can name the exact dialog it is
    // closing. Two dialogs for one terminal queue carry the same operation and
    // the same settling, so the identifier is the only thing that tells an
    // abandoned window from a live one.
    let claimed_reservation = reservation_id;
    // The wait spans the modal dialog and then the write, neither of which is
    // something to hold an async worker for.
    off_the_async_runtime(move || {
        let chosen = match receiver
            .recv()
            .map_err(|_| diagnostics_picker_unavailable())?
        {
            Ok(chosen) => chosen,
            Err(error) => {
                // The dialog itself failed. That is a refusal of this export,
                // not a write that went wrong, and the slot has to be released
                // either way.
                service.cancel_conversion_diagnostics_export(&claimed_reservation);
                return Err(error);
            }
        };
        let Some(destination) = chosen else {
            return Ok(service.cancel_conversion_diagnostics_export(&claimed_reservation));
        };
        service.write_conversion_diagnostics(&claimed_reservation, &destination)?;
        Ok(service.conversion_state())
    })
    .await?
}

/// Binds one selected-spectrum export and reserves the right to choose a file.
///
/// The webview names the spectrum by the opaque token it received with that
/// spectrum's panel, the format by one of four fixed words, and how much of the
/// spectrum by a scope and the m/z window its viewport has committed to. It
/// supplies no path, no arrays and no dataset handle: which measurement this
/// writes was decided when Rust interpreted it, and a token from an earlier
/// selection is refused rather than answered with whatever spectrum is current
/// now.
///
/// The range is a **request**. Rust resolves it against the retained snapshot,
/// refuses a window that spectrum does not have rather than clamping it, and
/// fixes the answer here -- so a viewport that moves while the picker is open
/// changes nothing about the file being written. No screen projection reaches
/// this path: a drawing is not the science.
///
/// Deliberately separate from choosing a destination, for the reason the
/// diagnostics export gives: a webview can reload between any two IPC fetches,
/// so Rust retains the reservation and a document that never receives the
/// identifier can never open a picker.
///
/// Launches no process and changes no preview. Exporting a spectrum is not
/// selecting one.
#[tauri::command]
async fn begin_selected_spectrum_export(
    export_token: String,
    format: String,
    range: preview::dto::SpectrumRangeDto,
    settings: preview::dto::FigureSettingsDto,
    service: State<'_, SharedService>,
) -> Result<String, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || {
        service.begin_spectrum_export(&export_token, &format, &range, &settings)
    })
    .await?
}

/// Shows the native save dialog for one exact reservation and writes the file.
///
/// The webview names no path and receives none back: the answer carries the
/// format, the file's own name and how many source points it holds, and nothing
/// about the folder it went into.
///
/// Rust consumes and validates the claim **before** dispatching the dialog, so a
/// reload or a second request that overtook it fails without opening one. The
/// spectrum is taken at that moment too, so a selection landing while the dialog
/// is open cannot change what is written.
///
/// Cancelling is an ordinary outcome: nothing was created, nothing was written,
/// and the spectrum on screen is exactly as it was.
#[tauri::command]
async fn copy_selected_spectrum_plot(
    export_token: String,
    range: preview::dto::SpectrumRangeDto,
    settings: preview::dto::FigureSettingsDto,
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<preview::dto::SpectrumCopyOutcomeDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    // Rasterizing a large figure is real work, and the clipboard write is a
    // platform call. Neither belongs on an async worker.
    off_the_async_runtime(move || {
        service.copy_spectrum_plot(&app, &export_token, &range, &settings)
    })
    .await?
}

/// Shows the native save dialog for one exact reservation and writes the file.
///
/// See the command below for the save path this one deliberately does not have:
/// Copy plot writes no file, so it needs no dialog, no name and no destination.
#[tauri::command]
async fn save_selected_spectrum_export(
    reservation_id: String,
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<preview::dto::SpectrumExportOutcomeDto, PreviewErrorDto> {
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
    let claimed = service.claim_spectrum_export(&reservation_id)?;
    let dialog = claimed.dialog();
    let suggested = claimed.suggested_file_name();
    let (sender, receiver) = std::sync::mpsc::channel();
    if app
        .run_on_main_thread(move || {
            let _ = sender.send(preview::dialog::choose_save_destination(
                owner, dialog, &suggested,
            ));
        })
        .is_err()
    {
        // The claim already took the slot. A dispatch that never happened
        // leaves nothing to close it, so without this the session would hold a
        // reservation whose dialog does not exist -- and every later export
        // would stay refused until a reload.
        service.cancel_spectrum_export(&reservation_id);
        return Err(spectrum_picker_unavailable());
    }

    let claimed_reservation = reservation_id;
    // The wait spans the modal dialog and then the write, neither of which is
    // something to hold an async worker for.
    off_the_async_runtime(move || {
        let chosen = match receiver.recv().map_err(|_| spectrum_picker_unavailable())? {
            Ok(chosen) => chosen,
            Err(error) => {
                // The dialog itself failed. That is a refusal of this export,
                // not a write that went wrong, and the slot has to be released
                // either way.
                service.cancel_spectrum_export(&claimed_reservation);
                return Err(error);
            }
        };
        let Some(destination) = chosen else {
            service.cancel_spectrum_export(&claimed_reservation);
            return Ok(preview::dto::SpectrumExportOutcomeDto::Cancelled);
        };
        service.write_spectrum_export(&claimed, &destination)
    })
    .await?
}

/// Binds one chromatogram export and reserves the right to choose a file.
///
/// The webview names the run by the opaque token it received with the preview,
/// the format by one of four fixed words, and how much of the run to cover by a
/// scope and -- for a current range -- the viewport it has committed to. It
/// supplies no path, no arrays, no dataset handle and no screen geometry: what
/// this writes comes from the facts Rust retained when the preview was read.
///
/// The range is checked against that run rather than trusted, and refused
/// rather than clamped where it does not fit. A token from an earlier preview is
/// refused too, rather than answered with whatever run is loaded now.
///
/// Launches no process and changes no preview. Exporting a chromatogram is not
/// opening one.
#[tauri::command]
async fn begin_chromatogram_export(
    export_token: String,
    format: String,
    range: preview::dto::ChromatogramRangeDto,
    traces: preview::dto::ChromatogramTracesDto,
    settings: preview::dto::FigureSettingsDto,
    service: State<'_, SharedService>,
) -> Result<String, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || {
        service.begin_chromatogram_export(&export_token, &format, &range, traces, &settings)
    })
    .await?
}

/// Draws the chromatogram and puts it on the clipboard.
///
/// The same figure a PNG export would write, through the same renderer and the
/// same rasterizer. No screenshot and no DOM: the webview receives what was
/// copied in words, and no pixels come back to it.
#[tauri::command]
async fn copy_chromatogram_plot(
    export_token: String,
    range: preview::dto::ChromatogramRangeDto,
    traces: preview::dto::ChromatogramTracesDto,
    settings: preview::dto::FigureSettingsDto,
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<preview::dto::ChromatogramCopyOutcomeDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    // Rasterizing a large figure is real work, and the clipboard write is a
    // platform call. Neither belongs on an async worker.
    off_the_async_runtime(move || {
        service.copy_chromatogram_plot(&app, &export_token, &range, traces, &settings)
    })
    .await?
}

/// Shows the native save dialog for one exact chromatogram reservation and
/// writes the file.
///
/// The webview names no path and receives none back. Rust consumes and validates
/// the claim **before** dispatching the dialog, so a reload or a second request
/// that overtook it fails without opening one -- and the range, the trace set and
/// the figure settings were all taken when the export began, so a viewport that
/// moves while the dialog is open cannot change what is written.
///
/// Cancelling is an ordinary outcome: nothing was created, nothing was written,
/// and the preview on screen is exactly as it was.
#[tauri::command]
async fn save_chromatogram_export(
    reservation_id: String,
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<preview::dto::ChromatogramExportOutcomeDto, PreviewErrorDto> {
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
    let claimed = service.claim_chromatogram_export(&reservation_id)?;
    let dialog = claimed.dialog();
    let suggested = claimed.suggested_file_name();
    let (sender, receiver) = std::sync::mpsc::channel();
    if app
        .run_on_main_thread(move || {
            let _ = sender.send(preview::dialog::choose_save_destination(
                owner, dialog, &suggested,
            ));
        })
        .is_err()
    {
        // The claim already took the lane. A dispatch that never happened leaves
        // nothing to close it, so without this the session would hold a
        // reservation whose dialog does not exist -- and every later scientific
        // export would stay refused until a reload.
        service.cancel_chromatogram_export(&reservation_id);
        return Err(spectrum_picker_unavailable());
    }

    let claimed_reservation = reservation_id;
    off_the_async_runtime(move || {
        let chosen = match receiver.recv().map_err(|_| spectrum_picker_unavailable())? {
            Ok(chosen) => chosen,
            Err(error) => {
                service.cancel_chromatogram_export(&claimed_reservation);
                return Err(error);
            }
        };
        let Some(destination) = chosen else {
            service.cancel_chromatogram_export(&claimed_reservation);
            return Ok(preview::dto::ChromatogramExportOutcomeDto::Cancelled);
        };
        service.write_chromatogram_export(&claimed, &destination)
    })
    .await?
}

/// Binds one linked two-panel figure and reserves the one scientific lane.
///
/// Both tokens travel together because the pair is what the figure is about.
/// Rust decides in one operation whether they are still current, whether they
/// describe one scan of one run, whether that scan is inside the range that
/// would be drawn, and whether the figure is tall enough to hold two panels --
/// so nothing that could not be drawn ever opens a dialog.
///
/// Launches no process, reads no file and changes no preview.
#[tauri::command]
async fn begin_linked_figure_export(
    chromatogram_token: String,
    spectrum_token: String,
    format: String,
    range: preview::dto::ChromatogramRangeDto,
    traces: preview::dto::ChromatogramTracesDto,
    settings: preview::dto::FigureSettingsDto,
    service: State<'_, SharedService>,
) -> Result<String, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || {
        service.begin_linked_figure_export(
            &chromatogram_token,
            &spectrum_token,
            &format,
            &range,
            traces,
            &settings,
        )
    })
    .await?
}

/// Draws the linked figure and puts it on the clipboard.
///
/// The same two panels a PNG export would write, through the same renderer and
/// the same rasterizer. No screenshot and no DOM.
#[tauri::command]
async fn copy_linked_plot(
    chromatogram_token: String,
    spectrum_token: String,
    range: preview::dto::ChromatogramRangeDto,
    traces: preview::dto::ChromatogramTracesDto,
    settings: preview::dto::FigureSettingsDto,
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<preview::dto::LinkedFigureCopyOutcomeDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || {
        service.copy_linked_plot(
            &app,
            &chromatogram_token,
            &spectrum_token,
            &range,
            traces,
            &settings,
        )
    })
    .await?
}

/// Shows the native save dialog for one exact linked reservation and writes the
/// file.
///
/// The pair, the range, the traces and the figure settings were all taken when
/// the export began, so selecting another scan or opening another run while the
/// dialog is open cannot change what is written.
#[tauri::command]
async fn save_linked_figure_export(
    reservation_id: String,
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<preview::dto::LinkedFigureExportOutcomeDto, PreviewErrorDto> {
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
    let claimed = service.claim_linked_figure_export(&reservation_id)?;
    let dialog = claimed.dialog();
    let suggested = claimed.suggested_file_name();
    let (sender, receiver) = std::sync::mpsc::channel();
    if app
        .run_on_main_thread(move || {
            let _ = sender.send(preview::dialog::choose_save_destination(
                owner, dialog, &suggested,
            ));
        })
        .is_err()
    {
        // The claim already took the lane, and a dispatch that never happened
        // leaves nothing to close it.
        service.cancel_linked_figure_export(&reservation_id);
        return Err(spectrum_picker_unavailable());
    }

    let claimed_reservation = reservation_id;
    off_the_async_runtime(move || {
        let chosen = match receiver.recv().map_err(|_| spectrum_picker_unavailable())? {
            Ok(chosen) => chosen,
            Err(error) => {
                service.cancel_linked_figure_export(&claimed_reservation);
                return Err(error);
            }
        };
        let Some(destination) = chosen else {
            service.cancel_linked_figure_export(&claimed_reservation);
            return Ok(preview::dto::LinkedFigureExportOutcomeDto::Cancelled);
        };
        service.write_linked_figure_export(&claimed, &destination)
    })
    .await?
}

/// Reads the session's one conversion slot.
///
/// The authoritative answer about a conversion, and the only one that survives a
/// reload. A document reads this on mount to recover work it did not start, and
/// again while something is running. It launches nothing and changes nothing.
#[tauri::command]
async fn get_workspace_conversion_state(
    service: State<'_, SharedService>,
) -> Result<WorkspaceConversionUpdateDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.conversion_state()).await
}

/// Binds one conversion request and reserves the right to choose a folder.
///
/// Deliberately synchronous and deliberately separate from choosing, for the
/// reason `begin_mzml_folder_import` already gives: a webview can reload between
/// any two IPC fetches, so Rust retains the reservation and a document that
/// never receives the identifier can never open a picker.
///
/// Proves the calling document the same way the drop subscription does. A
/// reservation issued to a document that has since been replaced is refused,
/// because the document that would receive the answer is gone.
#[tauri::command]
async fn begin_workspace_conversion_queue(
    request: ConversionBeginRequestDto,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<AuthorityObservedDto<ConversionBeginOutcomeDto>, PreviewErrorDto> {
    let document_epoch = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.begin_conversion_queue(&request, document_epoch)).await
}

/// Shows the native destination picker for one exact reservation and converts.
///
/// The webview names no folder: it returns only the opaque reservation Rust
/// issued. Rust consumes and validates that claim **before** dispatching the
/// dialog, so a reload or a second request that overtook it fails without
/// opening a picker.
///
/// Cancelling returns the idle state, which is an ordinary outcome: nothing was
/// created and nothing ran. The answer is the conversion state either way, and
/// it is the same value a later read returns — so a reply lost with a replaced
/// document costs the replacement nothing but one read.
#[tauri::command]
async fn choose_workspace_conversion_destination(
    reservation_id: String,
    app: tauri::AppHandle,
    ipc_request: tauri::ipc::Request<'_>,
    webview: tauri::Webview<tauri::Wry>,
    service: State<'_, SharedService>,
) -> Result<WorkspaceConversionUpdateDto, PreviewErrorDto> {
    let document_epoch = verified_document_epoch(&ipc_request, &webview, &service).await?;
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
    let operation = service.claim_conversion(&reservation_id, document_epoch)?;
    // **A source-relative policy has no folder to choose.** The reservation
    // still owns the decision and the resolution is still the one authorized
    // step that may create a directory -- what it does not need is a dialog.
    // Asked of the claimed queue rather than of the caller, so the webview
    // names a policy once, at `BEGIN`, and never again.
    if service.claimed_policy_needs_a_folder(operation) == Some(false) {
        let service = Arc::clone(&service);
        return off_the_async_runtime(move || {
            Ok::<_, PreviewErrorDto>(service.resolve_claimed_conversion(operation))
        })
        .await?;
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    if app
        .run_on_main_thread(move || {
            let _ = sender.send(preview::dialog::choose_conversion_destination(owner));
        })
        .is_err()
    {
        // The claim already took the slot. A dispatch that never happened
        // leaves nothing to close it, so without this the session would hold an
        // awaiting reservation whose picker does not exist -- and conversion,
        // adding, clearing and previewing would stay refused until a reload.
        service.cancel_conversion(operation);
        return Err(folder_picker_unavailable());
    }

    // The wait spans the modal dialog and then the whole conversion, either of
    // which can last as long as it lasts. Neither is something to hold an async
    // worker for.
    off_the_async_runtime(move || {
        let chosen = match receiver.recv().map_err(|_| folder_picker_unavailable())? {
            Ok(chosen) => chosen,
            Err(error) => {
                // The picker itself failed. That is a refusal of this
                // operation, not a conversion that went wrong, and the slot has
                // to leave `awaitingDestination` either way.
                service.cancel_conversion(operation);
                return Err(error);
            }
        };
        let Some(destination) = chosen else {
            return Ok(service.cancel_conversion(operation));
        };
        Ok(service.run_claimed_conversion(operation, &destination))
    })
    .await?
}

/// Proves which main document is calling, and answers with its epoch.
///
/// The same proof the drop subscription uses, reused rather than reimplemented:
/// a per-document secret installed before any script runs, sent as a header, and
/// verified by evaluating it in the calling webview. A conversion reservation is
/// authority over a picker and a file this application creates, so it is bound
/// to a document exactly as tightly.
async fn verified_document_epoch(
    ipc_request: &tauri::ipc::Request<'_>,
    webview: &tauri::Webview<tauri::Wry>,
    service: &SharedService,
) -> Result<u64, PreviewErrorDto> {
    if webview.label() != "main" {
        return Err(invalid_conversion_reservation());
    }
    let authority = ipc_request
        .headers()
        .get(DROP_DOCUMENT_AUTHORITY_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| valid_drop_document_authority(value))
        .ok_or_else(invalid_conversion_reservation)?
        .to_owned();
    let epoch = service.workspace_drop_document_epoch();
    verify_drop_document_authority(webview, &authority)
        .await
        .map_err(|_| invalid_conversion_reservation())?;
    Ok(epoch)
}

/// Removes the rows these handles name and answers with the roster that
/// remains.
///
/// Handles only: the webview names a row it was given, never a path. A handle
/// the session no longer holds is reported as an ordinary reconciliation
/// outcome rather than refused. Source acquisitions are not touched.
#[tauri::command]
async fn remove_workspace_datasets(
    handles: Vec<String>,
    service: State<'_, SharedService>,
) -> Result<WorkspaceRemoveResultDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.remove_datasets(&handles)).await?
}

/// Empties the workspace and answers with the empty roster.
///
/// Takes no identifier: clearing is one action over everything the session
/// holds, and a list of rows to clear would be a second way to remove some of
/// them. Source acquisitions are not touched.
#[tauri::command]
async fn clear_workspace(
    service: State<'_, SharedService>,
) -> Result<WorkspaceRosterDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.clear_workspace()).await?
}

fn picker_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "file_picker_unavailable",
        "The file picker could not be opened.",
        true,
    )
}

/// Shows the native folder picker and uses the chosen ProteoWizard for this
/// session, returning what that installation can actually do.
///
/// For this session only, and never written to disk. Automatic discovery
/// searches `PATH` and the locations an installer writes; this looks wherever
/// it is told, and what keeps it the narrower of the two is that the user says
/// so again next time rather than having a past choice apply silently.
///
/// Cancelling returns `None`, which means nothing changed — the caller keeps the
/// verdict it already had rather than being handed one about a folder nobody
/// chose.
#[tauri::command]
async fn choose_backend_installation(
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<Option<BackendReadingDto>, PreviewErrorDto> {
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(preview::dialog::choose_installation_folder(owner));
    })
    .map_err(|_| folder_picker_unavailable())?;

    off_the_async_runtime(move || {
        let chosen = receiver.recv().map_err(|_| folder_picker_unavailable())??;
        Ok(chosen.map(|home| service.use_installation(Some(home))))
    })
    .await?
}

/// Goes back to searching for ProteoWizard automatically, and reports what that
/// finds.
///
/// Separate from choosing, and always available, because the state a chosen
/// folder can leave behind is one nothing else undoes: a folder that turns out
/// to hold no usable installation would otherwise be the only thing MSCanvas
/// looks at for the rest of the session, with an installation it would have
/// found on its own sitting unused.
#[tauri::command]
async fn use_automatic_backend_discovery(
    service: State<'_, SharedService>,
) -> Result<BackendReadingDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.use_installation(None)).await
}

fn folder_picker_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "folder_picker_unavailable",
        "The folder picker could not be opened.",
        true,
    )
}

/// Loads metadata, run summary and the spectrum table for one open action.
#[tauri::command]
async fn open_mzml_preview(
    handle: String,
    service: State<'_, SharedService>,
) -> Result<PreviewDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.open_preview(&handle)).await?
}

/// Loads exactly one spectrum by zero-based index.
#[tauri::command]
async fn load_selected_spectrum(
    handle: String,
    index: u64,
    service: State<'_, SharedService>,
) -> Result<AuthorityObservedDto<SelectedSpectrumOutcomeDto>, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.load_spectrum(&handle, index)).await?
}

/// The preview service, shared so a command can take it onto a blocking thread.
type SharedService = Arc<PreviewService>;

/// Runs a blocking preview call away from the async runtime's workers.
///
/// Every preview operation launches a process and waits for it. Waiting on an
/// async worker would let a handful of abandoned selections occupy the runtime
/// and leave the next selection, and every other command, queued behind
/// processes whose results nobody wants.
async fn off_the_async_runtime<T, F>(work: F) -> Result<T, PreviewErrorDto>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    spawn_blocking(work).await.map_err(|_| {
        PreviewErrorDto::new(
            "preview_worker_unavailable",
            "MSCanvas could not run that request. Try again.",
            true,
        )
    })
}

#[cfg(windows)]
fn main_window_handle(app: &tauri::AppHandle) -> Option<isize> {
    app.get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|handle| handle.0 as isize)
}

#[cfg(not(windows))]
const fn main_window_handle(_app: &tauri::AppHandle) -> Option<isize> {
    None
}

/// The rendered-QA IPC boundary, compiled in only under the `e2e` feature.
#[cfg(feature = "e2e")]
const E2E_IPC_BOUNDARY_SCRIPT: &str = include_str!("e2e_boundary.js");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    let builder = builder
        // Registered so Rust can write an image to the clipboard. The plugin's
        // own commands are *not* granted to the webview: `capabilities/
        // default.json` lists no permission, and Tauri denies every plugin
        // command that is not listed. So this application can put a figure on
        // the clipboard and has no capability to read one, which is the posture
        // a scientific tool should have -- a clipboard read would be a window
        // onto whatever the user last copied from somewhere else.
        .plugin(tauri_plugin_clipboard_manager::init())
        .append_invoke_initialization_script(DROP_DOCUMENT_AUTHORITY_INITIALIZATION_SCRIPT);
    // Only under the `e2e` feature, which no release build enables. The script
    // it appends can answer this application's own commands from a table the
    // page can write, which is not a capability a shipped binary should carry.
    #[cfg(feature = "e2e")]
    let builder = builder.append_invoke_initialization_script(E2E_IPC_BOUNDARY_SCRIPT);
    builder
        .manage(SharedService::new(PreviewService::new(Box::new(
            ProteoWizardProvider::new(),
        ))))
        // One startup hook, because `Builder::setup` replaces rather than
        // appends: a second call would silently drop the first.
        .setup(|app| {
            // The preference store is bound once, from the application's own
            // resolved per-user directory. A binding that cannot be made leaves
            // a store that answers `unavailable`, so the application stays
            // completely usable on defaults rather than failing to start.
            app.manage(SharedPreferences::new(UiPreferenceStore::bind(
                app.handle(),
            )));
            // The project store starts with no project open and no path bound.
            // It resolves nothing, reads nothing and creates nothing until a
            // user acts, so binding it cannot fail and cannot touch the disk.
            app.manage(SharedProjects::new(project::ProjectStore::new()));
            // One synthetic spectrum in the ordinary export slot, so a rendered
            // test can reach the real export path on a machine with no
            // ProteoWizard installation and no mzML file. Not a command: there
            // is nothing here for a webview to call, in any build.
            #[cfg(feature = "e2e")]
            preview::seed_spectrum_for_e2e(&app.state::<SharedService>());
            Ok(())
        })
        // Locked Tauri routing contract: stable tauri-runtime-wry 2.11.4
        // creates a configured WebviewWindow as `WindowContent` and converts
        // its Wry drag callback into `WindowEvent::DragDrop`. Child webviews
        // take the distinct `WebviewEvent` route. This is therefore the native
        // WebView drag boundary for the configured main window.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let Some(signal) = normalize_window_drop_event(event) else {
                return;
            };
            let service = Arc::clone(&window.state::<SharedService>());
            let Some(dispatch) = service.reserve_native_drop_signal(signal) else {
                return;
            };
            let operation_id = dispatch.operation_id();
            tauri::async_runtime::spawn(async move {
                let worker_service = Arc::clone(&service);
                if spawn_blocking(move || worker_service.process_native_drop_dispatch(dispatch))
                    .await
                    .is_err()
                    && let Some(operation_id) = operation_id
                {
                    service.fail_native_drop_worker(operation_id);
                }
            });
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && payload.event() == PageLoadEvent::Started {
                webview.state::<SharedService>().begin_webview_document();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap_status,
            load_ui_preferences,
            save_ui_preferences,
            get_project_state,
            create_project,
            close_project,
            open_project,
            save_project,
            save_project_as,
            add_project_input,
            remove_project_input,
            begin_project_job,
            check_project_links,
            cancel_project_job,
            capture_project_file_facts,
            propose_project_relink,
            commit_project_relink,
            abandon_project_relink,
            add_project_input_to_workspace,
            create_project_layer,
            remove_project_layer,
            inspect_backend,
            choose_backend_installation,
            use_automatic_backend_discovery,
            read_conversion_configuration,
            get_workspace_roster,
            choose_workspace_files,
            begin_mzml_folder_import,
            choose_mzml_folder,
            subscribe_workspace_drop_updates,
            remove_workspace_datasets,
            clear_workspace,
            plan_workspace_clear,
            execute_workspace_clear,
            reclaim_conversion_staging,
            preview_figure,
            open_finalized_output,
            open_mzml_preview,
            load_selected_spectrum,
            describe_workspace_conversion_queue,
            get_workspace_conversion_state,
            begin_workspace_conversion_queue,
            choose_workspace_conversion_destination,
            retry_workspace_conversion_queue,
            stop_workspace_conversion_queue,
            cancel_current_workspace_conversion_item,
            skip_pending_workspace_conversion_item,
            adopt_workspace_conversion_outputs,
            begin_workspace_conversion_diagnostics_export,
            save_workspace_conversion_diagnostics,
            begin_selected_spectrum_export,
            project_selected_spectrum,
            save_selected_spectrum_export,
            begin_chromatogram_export,
            begin_linked_figure_export,
            copy_linked_plot,
            save_linked_figure_export,
            save_chromatogram_export,
            copy_chromatogram_plot,
            copy_selected_spectrum_plot
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the MSCanvas desktop application");
}
