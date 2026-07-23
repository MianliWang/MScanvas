use mscanvas_core::BootstrapStatus;

#[tauri::command]
fn get_bootstrap_status() -> BootstrapStatus {
    BootstrapStatus::new(
        env!("CARGO_PKG_VERSION"),
        "mock-shell",
        "ProteoWizard discovery pending",
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_bootstrap_status])
        .run(tauri::generate_context!())
        .expect("failed to run the MSCanvas desktop application");
}
