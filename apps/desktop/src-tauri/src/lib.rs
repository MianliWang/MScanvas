mod preview;

use std::sync::{Arc, mpsc};
use std::time::Duration;

use mscanvas_core::BootstrapStatus;
use serde::Deserialize;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::JavaScriptChannelId;
use tauri::webview::PageLoadEvent;
use tauri::{Manager, State};

use preview::dto::{
    BackendAvailabilityDto, FolderImportReservationDto, FolderIngestionResultDto, PreviewDto,
    PreviewErrorDto, SelectedSpectrumOutcomeDto, WorkspaceAddResultDto,
    WorkspaceDropSubscriptionReservationDto, WorkspaceDropUpdateDto, WorkspaceRemoveResultDto,
    WorkspaceRosterDto, invalid_workspace_drop_subscription,
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
fn begin_mzml_folder_import(service: State<'_, SharedService>) -> FolderImportReservationDto {
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
        .append_invoke_initialization_script(DROP_DOCUMENT_AUTHORITY_INITIALIZATION_SCRIPT)
        .manage(SharedService::new(PreviewService::new(Box::new(
            ProteoWizardProvider::new(),
        ))))
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
            inspect_backend,
            choose_backend_installation,
            use_automatic_backend_discovery,
            get_workspace_roster,
            choose_mzml_files,
            begin_mzml_folder_import,
            choose_mzml_folder,
            subscribe_workspace_drop_updates,
            remove_workspace_datasets,
            clear_workspace,
            open_mzml_preview,
            load_selected_spectrum
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the MSCanvas desktop application");
}
