mod preview;

use std::sync::Arc;

use mscanvas_core::BootstrapStatus;
use tauri::async_runtime::spawn_blocking;
use tauri::{Manager, State};

use preview::dto::{
    BackendAvailabilityDto, FolderIngestionResultDto, PreviewDto, PreviewErrorDto,
    SelectedSpectrumOutcomeDto, WorkspaceAddResultDto, WorkspaceRemoveResultDto,
    WorkspaceRosterDto,
};
use preview::{PreviewService, ProteoWizardProvider};

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
) -> Result<BackendAvailabilityDto, PreviewErrorDto> {
    let service = Arc::clone(&service);
    off_the_async_runtime(move || service.inspect_backend()).await
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
/// This runs asynchronously so the modal dialog can be dispatched onto the main
/// thread without blocking the command dispatcher. Cancelling returns `None`,
/// which is an ordinary outcome rather than an error: nothing was chosen, so
/// nothing changed. It is deliberately not an empty result, which would be a
/// batch that added nothing.
///
/// The webview names no path in either direction. It asks for a picker, Rust
/// shows it, and what comes back is a roster and one outcome per chosen file.
/// Nothing here reads an acquisition.
#[tauri::command]
async fn choose_mzml_files(
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<Option<WorkspaceAddResultDto>, PreviewErrorDto> {
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(preview::dialog::choose_mzml_files(owner));
    })
    .map_err(|_| picker_unavailable())?;

    // The wait is blocking and the dialog is modal, so it can last as long as
    // the user takes to choose. That is not something to hold an async worker
    // for.
    off_the_async_runtime(move || {
        let chosen = receiver.recv().map_err(|_| picker_unavailable())??;
        Ok(chosen.map(|paths| service.add_files(&paths)))
    })
    .await?
}

/// Shows the native folder picker and adds every mzML file found beneath the
/// chosen folder.
///
/// The webview names no folder in either direction: it asks for a picker, Rust
/// shows one, and what comes back is a roster, one outcome per candidate, and
/// how the scan itself went. Cancelling returns `None`, which is an ordinary
/// outcome -- nothing was chosen, so nothing changed -- and is deliberately not
/// an empty result, which would be a folder that held no mzML files.
///
/// Nothing here reads an acquisition. Scanning a folder of a thousand files
/// costs a thousand filesystem inspections and no backend processes at all.
#[tauri::command]
async fn choose_mzml_folder(
    app: tauri::AppHandle,
    service: State<'_, SharedService>,
) -> Result<Option<FolderIngestionResultDto>, PreviewErrorDto> {
    let owner = main_window_handle(&app);
    let service = Arc::clone(&service);
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
            .map(|root| service.add_mzml_folder(&root))
            .transpose()
    })
    .await?
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
    off_the_async_runtime(move || service.remove_datasets(&handles)).await
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
    off_the_async_runtime(move || service.clear_workspace()).await
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
) -> Result<Option<BackendAvailabilityDto>, PreviewErrorDto> {
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
) -> Result<BackendAvailabilityDto, PreviewErrorDto> {
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
) -> Result<SelectedSpectrumOutcomeDto, PreviewErrorDto> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SharedService::new(PreviewService::new(Box::new(
            ProteoWizardProvider::new(),
        ))))
        .invoke_handler(tauri::generate_handler![
            get_bootstrap_status,
            inspect_backend,
            choose_backend_installation,
            use_automatic_backend_discovery,
            get_workspace_roster,
            choose_mzml_files,
            choose_mzml_folder,
            remove_workspace_datasets,
            clear_workspace,
            open_mzml_preview,
            load_selected_spectrum
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the MSCanvas desktop application");
}
