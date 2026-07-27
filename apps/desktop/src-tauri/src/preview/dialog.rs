//! A Rust-owned native "open file" dialog.
//!
//! The webview is deliberately granted no filesystem or dialog permission, so
//! the native picker is invoked here and only the chosen path enters Rust. The
//! frontend receives an opaque handle and a display name, never a path.

use super::dto::PreviewErrorDto;

#[cfg(windows)]
pub use windows_dialog::{choose_installation_folder, choose_mzml_file};

#[cfg(not(windows))]
pub fn choose_mzml_file(
    _owner: Option<isize>,
) -> Result<Option<std::path::PathBuf>, PreviewErrorDto> {
    Err(PreviewErrorDto::new(
        "file_picker_unavailable",
        "The native file picker is available on Windows in this version.",
        false,
    ))
}

#[cfg(not(windows))]
pub fn choose_installation_folder(
    _owner: Option<isize>,
) -> Result<Option<std::path::PathBuf>, PreviewErrorDto> {
    Err(PreviewErrorDto::new(
        "folder_picker_unavailable",
        "The native folder picker is available on Windows in this version.",
        false,
    ))
}

#[cfg(windows)]
mod windows_dialog {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;

    use super::PreviewErrorDto;

    const OFN_PATHMUSTEXIST: u32 = 0x0000_0800;
    const OFN_FILEMUSTEXIST: u32 = 0x0000_1000;
    const OFN_NOCHANGEDIR: u32 = 0x0000_0008;
    const OFN_EXPLORER: u32 = 0x0008_0000;
    const OFN_NODEREFERENCELINKS: u32 = 0x0010_0000;
    const OFN_DONTADDTORECENT: u32 = 0x0200_0000;

    /// `MAX_PATH` is not enough for a long path, so the buffer is generous and
    /// the dialog is told the exact capacity.
    const PATH_BUFFER_LENGTH: usize = 32_768;

    #[repr(C)]
    struct OpenFileNameW {
        struct_size: u32,
        owner: *mut c_void,
        instance: *mut c_void,
        filter: *const u16,
        custom_filter: *mut u16,
        max_custom_filter: u32,
        filter_index: u32,
        file: *mut u16,
        max_file: u32,
        file_title: *mut u16,
        max_file_title: u32,
        initial_directory: *const u16,
        title: *const u16,
        flags: u32,
        file_offset: u16,
        file_extension: u16,
        default_extension: *const u16,
        custom_data: isize,
        hook: *mut c_void,
        template_name: *const u16,
        reserved_pointer: *mut c_void,
        reserved_value: u32,
        flags_ex: u32,
    }

    #[link(name = "comdlg32")]
    unsafe extern "system" {
        #[link_name = "GetOpenFileNameW"]
        fn get_open_file_name_w(arguments: *mut OpenFileNameW) -> i32;
        #[link_name = "CommDlgExtendedError"]
        fn comm_dlg_extended_error() -> u32;
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Shows the native picker and returns the chosen path, or `None` when the
    /// user cancelled. Cancelling is an ordinary outcome, not an error.
    ///
    /// Must be called from a thread that can run a modal message loop; the
    /// Tauri command dispatches it onto the main thread.
    pub fn choose_mzml_file(owner: Option<isize>) -> Result<Option<PathBuf>, PreviewErrorDto> {
        // A double-NUL terminated pair list: display label, then pattern.
        let mut filter = Vec::new();
        filter.extend_from_slice(&wide("mzML files (*.mzML)"));
        filter.extend_from_slice(&wide("*.mzML"));
        filter.push(0);
        let title = wide("Open mzML file");
        let default_extension = wide("mzML");

        let mut buffer = vec![0_u16; PATH_BUFFER_LENGTH];
        let mut arguments = OpenFileNameW {
            struct_size: u32::try_from(std::mem::size_of::<OpenFileNameW>())
                .expect("OPENFILENAMEW size fits in DWORD"),
            owner: owner.map_or(std::ptr::null_mut(), |handle| handle as *mut c_void),
            instance: std::ptr::null_mut(),
            filter: filter.as_ptr(),
            custom_filter: std::ptr::null_mut(),
            max_custom_filter: 0,
            filter_index: 1,
            file: buffer.as_mut_ptr(),
            max_file: u32::try_from(buffer.len()).expect("path buffer fits in DWORD"),
            file_title: std::ptr::null_mut(),
            max_file_title: 0,
            initial_directory: std::ptr::null(),
            title: title.as_ptr(),
            // The dialog must not change the process working directory, must
            // not resolve shortcuts behind the user's back, and must not write
            // to the recent-documents list.
            flags: OFN_PATHMUSTEXIST
                | OFN_FILEMUSTEXIST
                | OFN_NOCHANGEDIR
                | OFN_EXPLORER
                | OFN_NODEREFERENCELINKS
                | OFN_DONTADDTORECENT,
            file_offset: 0,
            file_extension: 0,
            default_extension: default_extension.as_ptr(),
            custom_data: 0,
            hook: std::ptr::null_mut(),
            template_name: std::ptr::null(),
            reserved_pointer: std::ptr::null_mut(),
            reserved_value: 0,
            flags_ex: 0,
        };

        // SAFETY: every pointer field references a live buffer that outlives
        // the call, and `struct_size`/`max_file` describe those buffers exactly.
        let chosen = unsafe { get_open_file_name_w(&raw mut arguments) };
        if chosen == 0 {
            // SAFETY: the documented way to distinguish cancellation from
            // failure immediately after the call returns zero.
            let error = unsafe { comm_dlg_extended_error() };
            if error == 0 {
                return Ok(None);
            }
            return Err(PreviewErrorDto::new(
                "file_picker_failed",
                "The file picker could not be opened.",
                true,
            ));
        }

        let length = buffer.iter().position(|unit| *unit == 0).unwrap_or(0);
        if length == 0 {
            return Ok(None);
        }
        Ok(Some(PathBuf::from(std::ffi::OsString::from_wide(
            &buffer[..length],
        ))))
    }

    const BIF_RETURNONLYFSDIRS: u32 = 0x0000_0001;
    const BIF_NEWDIALOGSTYLE: u32 = 0x0000_0040;
    const BIF_NONEWFOLDERBUTTON: u32 = 0x0000_0200;

    const COINIT_APARTMENTTHREADED: u32 = 0x2;
    const S_OK: i32 = 0;
    const S_FALSE: i32 = 1;

    #[repr(C)]
    struct BrowseInfoW {
        owner: *mut c_void,
        root: *const c_void,
        display_name: *mut u16,
        title: *const u16,
        flags: u32,
        callback: *mut c_void,
        parameter: isize,
        image: i32,
    }

    #[link(name = "shell32")]
    unsafe extern "system" {
        #[link_name = "SHBrowseForFolderW"]
        fn sh_browse_for_folder_w(arguments: *mut BrowseInfoW) -> *mut c_void;
        #[link_name = "SHGetPathFromIDListEx"]
        fn sh_get_path_from_id_list_ex(
            list: *const c_void,
            path: *mut u16,
            length: u32,
            options: u32,
        ) -> i32;
    }

    #[link(name = "ole32")]
    unsafe extern "system" {
        #[link_name = "CoTaskMemFree"]
        fn co_task_mem_free(block: *mut c_void);
        #[link_name = "CoInitializeEx"]
        fn co_initialize_ex(reserved: *mut c_void, model: u32) -> i32;
        #[link_name = "CoUninitialize"]
        fn co_uninitialize();
    }

    /// Shows the native folder picker and returns the chosen directory, or
    /// `None` when the user cancelled.
    ///
    /// Deliberately a folder rather than an executable. A picker that accepts
    /// `msconvert.exe` invites pointing MSCanvas at one binary while the other
    /// comes from somewhere else, and the crate already treats a mismatched pair
    /// as a failure. Asking for the folder makes the unit of choice the same
    /// unit discovery works in.
    ///
    /// Must be called from a thread that can run a modal message loop; the
    /// Tauri command dispatches it onto the main thread.
    pub fn choose_installation_folder(
        owner: Option<isize>,
    ) -> Result<Option<PathBuf>, PreviewErrorDto> {
        // The resizable dialog style needs an initialised apartment. Tauri's
        // main thread already has one, so this is normally S_FALSE; it is called
        // anyway because the rule is that whoever needs COM initialises it, and
        // it is undone only when this call is what established it.
        // SAFETY: no arguments, and the result decides whether to undo it.
        let initialised =
            unsafe { co_initialize_ex(std::ptr::null_mut(), COINIT_APARTMENTTHREADED) };
        let owns_apartment = initialised == S_OK || initialised == S_FALSE;

        let title = wide("Choose the ProteoWizard installation folder");
        let mut display_name = vec![0_u16; PATH_BUFFER_LENGTH];
        let mut arguments = BrowseInfoW {
            owner: owner.map_or(std::ptr::null_mut(), |handle| handle as *mut c_void),
            root: std::ptr::null(),
            display_name: display_name.as_mut_ptr(),
            title: title.as_ptr(),
            // Only real filesystem directories, and no way to create one: the
            // point of this dialog is to name an installation that already
            // exists, and an empty new folder can only fail.
            flags: BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_NONEWFOLDERBUTTON,
            callback: std::ptr::null_mut(),
            parameter: 0,
            image: 0,
        };

        // SAFETY: every pointer field references a live buffer that outlives the
        // call. The returned item list is owned by the caller.
        let chosen = unsafe { sh_browse_for_folder_w(&raw mut arguments) };
        if chosen.is_null() {
            if owns_apartment {
                // SAFETY: paired with the successful initialisation above.
                unsafe { co_uninitialize() };
            }
            // This dialog reports cancellation and failure the same way, so
            // there is nothing to distinguish and cancelling is the reading
            // that does not invent an error.
            return Ok(None);
        }

        let mut buffer = vec![0_u16; PATH_BUFFER_LENGTH];
        // `Ex` rather than `SHGetPathFromIDListW`, which writes into a caller
        // buffer it assumes is `MAX_PATH` and cannot express a longer path.
        // SAFETY: `chosen` is the live list just returned, and the length
        // describes `buffer` exactly.
        let resolved = unsafe {
            sh_get_path_from_id_list_ex(
                chosen,
                buffer.as_mut_ptr(),
                u32::try_from(buffer.len()).expect("path buffer fits in DWORD"),
                0,
            )
        };
        // SAFETY: the documented way to release what the dialog returned, and
        // it is released on every path out of here.
        unsafe { co_task_mem_free(chosen) };
        if owns_apartment {
            // SAFETY: paired with the successful initialisation above.
            unsafe { co_uninitialize() };
        }

        if resolved == 0 {
            return Err(PreviewErrorDto::new(
                "folder_picker_failed",
                "That choice could not be read as a folder on this computer.",
                true,
            ));
        }
        let length = buffer.iter().position(|unit| *unit == 0).unwrap_or(0);
        if length == 0 {
            return Ok(None);
        }
        Ok(Some(PathBuf::from(std::ffi::OsString::from_wide(
            &buffer[..length],
        ))))
    }
}
