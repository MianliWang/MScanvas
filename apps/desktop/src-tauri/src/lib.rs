mod preview;

use mscanvas_core::BootstrapStatus;
use tauri::{Manager, State};

use preview::dto::{
    BackendAvailabilityDto, PreviewDto, PreviewErrorDto, SelectedFileDto,
    SelectedSpectrumOutcomeDto,
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
async fn inspect_backend(service: State<'_, PreviewService>) -> Result<BackendAvailabilityDto, ()> {
    Ok(service.inspect_backend())
}

/// Shows the native picker and registers the chosen file.
///
/// This runs asynchronously so the modal dialog can be dispatched onto the main
/// thread without blocking the command dispatcher. Cancelling returns `None`,
/// which is an ordinary outcome rather than an error.
#[tauri::command]
async fn choose_mzml_file(
    app: tauri::AppHandle,
    service: State<'_, PreviewService>,
) -> Result<Option<SelectedFileDto>, PreviewErrorDto> {
    let owner = main_window_handle(&app);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(preview::dialog::choose_mzml_file(owner));
    })
    .map_err(|_| picker_unavailable())?;
    let chosen = receiver.recv().map_err(|_| picker_unavailable())??;

    chosen.map(|path| service.accept_file(&path)).transpose()
}

fn picker_unavailable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "file_picker_unavailable",
        "The file picker could not be opened.",
        true,
    )
}

/// Loads metadata, run summary and the spectrum table for one open action.
#[tauri::command]
async fn open_mzml_preview(
    handle: String,
    service: State<'_, PreviewService>,
) -> Result<PreviewDto, PreviewErrorDto> {
    service.open_preview(&handle)
}

/// Loads exactly one spectrum by zero-based index.
#[tauri::command]
async fn load_selected_spectrum(
    handle: String,
    index: u64,
    service: State<'_, PreviewService>,
) -> Result<SelectedSpectrumOutcomeDto, PreviewErrorDto> {
    service.load_spectrum(&handle, index)
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
        .manage(PreviewService::new(Box::new(ProteoWizardProvider::new())))
        .invoke_handler(tauri::generate_handler![
            get_bootstrap_status,
            inspect_backend,
            choose_mzml_file,
            open_mzml_preview,
            load_selected_spectrum
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the MSCanvas desktop application");
}
