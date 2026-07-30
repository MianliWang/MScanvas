//! A Rust-owned native "open file" dialog.
//!
//! The webview is deliberately granted no filesystem or dialog permission, so
//! the native picker is invoked here and only the chosen path enters Rust. The
//! frontend receives an opaque handle and a display name, never a path.

use super::dto::PreviewErrorDto;

#[cfg(windows)]
pub use windows_dialog::{choose_installation_folder, choose_mzml_files};

#[cfg(not(windows))]
pub fn choose_mzml_files(
    _owner: Option<isize>,
) -> Result<Option<Vec<std::path::PathBuf>>, PreviewErrorDto> {
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
    use std::path::{Path, PathBuf};

    use super::PreviewErrorDto;

    const OFN_PATHMUSTEXIST: u32 = 0x0000_0800;
    const OFN_FILEMUSTEXIST: u32 = 0x0000_1000;
    const OFN_NOCHANGEDIR: u32 = 0x0000_0008;
    const OFN_EXPLORER: u32 = 0x0008_0000;
    const OFN_NODEREFERENCELINKS: u32 = 0x0010_0000;
    const OFN_DONTADDTORECENT: u32 = 0x0200_0000;
    const OFN_ALLOWMULTISELECT: u32 = 0x0000_0200;

    /// What `CommDlgExtendedError` reports when the answer did not fit.
    ///
    /// It has to be told apart from every other failure, because with
    /// `OFN_ALLOWMULTISELECT` the buffer then holds a required size rather than
    /// a path, and reading it as one would invent a selection.
    const FNERR_BUFFERTOOSMALL: u32 = 0x3003;

    /// `MAX_PATH` is not enough for a long path, so the buffer is generous and
    /// the dialog is told the exact capacity.
    const PATH_BUFFER_LENGTH: usize = 32_768;

    /// The room one multi-selection answer is given.
    ///
    /// A multi-selection is a directory followed by one name per file, so the
    /// answer grows with the number of files rather than with one path's
    /// length. Half a megabyte holds several thousand ordinary names, which is
    /// above the workspace capacity this boundary enforces; a selection larger
    /// than it is refused with a typed failure rather than read from a prefix.
    const SELECTION_BUFFER_LENGTH: usize = 262_144;

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

    /// Shows the native picker and returns every chosen path in the order the
    /// dialog reported them, or `None` when the user cancelled. Cancelling is
    /// an ordinary outcome, not an error.
    ///
    /// Must be called from a thread that can run a modal message loop; the
    /// Tauri command dispatches it onto the main thread.
    pub fn choose_mzml_files(
        owner: Option<isize>,
    ) -> Result<Option<Vec<PathBuf>>, PreviewErrorDto> {
        // A double-NUL terminated pair list: display label, then pattern.
        let mut filter = Vec::new();
        filter.extend_from_slice(&wide("mzML files (*.mzML)"));
        filter.extend_from_slice(&wide("*.mzML"));
        filter.push(0);
        let title = wide("Open mzML files");
        let default_extension = wide("mzML");

        let mut buffer = vec![0_u16; SELECTION_BUFFER_LENGTH];
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
            // to the recent-documents list. Multi-selection is added to that
            // set rather than replacing any of it: a roster is built from one
            // picker operation, and every other guarantee still holds for each
            // file in it.
            flags: OFN_PATHMUSTEXIST
                | OFN_FILEMUSTEXIST
                | OFN_NOCHANGEDIR
                | OFN_EXPLORER
                | OFN_NODEREFERENCELINKS
                | OFN_DONTADDTORECENT
                | OFN_ALLOWMULTISELECT,
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
            if error == FNERR_BUFFERTOOSMALL {
                return Err(selection_too_large());
            }
            return Err(PreviewErrorDto::new(
                "file_picker_failed",
                "The file picker could not be opened.",
                true,
            ));
        }

        let chosen = parse_selection(&buffer)?;
        // An answer that names nothing is the same fact as a cancelled dialog:
        // the workspace is left exactly as the user left it.
        Ok((!chosen.is_empty()).then_some(chosen))
    }

    /// Reads the dialog's answer into the paths it names.
    ///
    /// `GetOpenFileNameW` documents two forms and this reads both. One file is
    /// one absolute path. Several files are the containing directory followed by
    /// one bare file name each, and the list ends with an empty string -- the
    /// second NUL of the documented double terminator.
    ///
    /// Pure, and separated from the call for that reason: it is the half that
    /// can be wrong in ways a rendered check would not show, and the half a
    /// malformed answer reaches. Nothing here invents a path. A component that
    /// cannot be what its position says it is -- a later name that is really an
    /// absolute path, or one carrying a separator of its own -- is refused
    /// outright rather than joined onto a directory to see what comes out.
    fn parse_selection(buffer: &[u16]) -> Result<Vec<PathBuf>, PreviewErrorDto> {
        let mut segments = Vec::new();
        let mut start = 0_usize;
        loop {
            // The list is terminated by an empty string, so running out of
            // buffer before finding one means the answer was cut. Reading the
            // last complete segment as though the list ended there would turn a
            // truncated answer into a shorter selection that looks whole.
            let Some(offset) = buffer[start..].iter().position(|unit| *unit == 0) else {
                return Err(malformed_selection());
            };
            if offset == 0 {
                break;
            }
            segments.push(PathBuf::from(std::ffi::OsString::from_wide(
                &buffer[start..start + offset],
            )));
            start += offset + 1;
        }

        let mut segments = segments.into_iter();
        let Some(first) = segments.next() else {
            return Ok(Vec::new());
        };
        // Both forms begin with something absolute: one file's own path, or the
        // directory the rest are named inside.
        if !first.is_absolute() {
            return Err(malformed_selection());
        }
        let names: Vec<PathBuf> = segments.collect();
        if names.is_empty() {
            return Ok(vec![first]);
        }
        let mut chosen = Vec::with_capacity(names.len());
        for name in names {
            if !is_plain_file_name(&name) {
                return Err(malformed_selection());
            }
            chosen.push(first.join(name));
        }
        Ok(chosen)
    }

    /// Whether this component can only be a file name inside the directory the
    /// answer began with.
    ///
    /// Exactly one ordinary component. That refuses an absolute path, a UNC
    /// root, a nested relative path, and `.` or `..` -- every shape whose
    /// meaning after a join is not the file the position claims it is.
    fn is_plain_file_name(value: &Path) -> bool {
        let mut components = value.components();
        matches!(components.next(), Some(std::path::Component::Normal(_)))
            && components.next().is_none()
    }

    fn malformed_selection() -> PreviewErrorDto {
        PreviewErrorDto::new(
            "file_picker_selection_unreadable",
            "Windows described that selection in a form MSCanvas could not read, so nothing was \
             added. Try choosing the files again.",
            true,
        )
    }

    fn selection_too_large() -> PreviewErrorDto {
        PreviewErrorDto::new(
            "file_picker_selection_too_large",
            "That selection is larger than MSCanvas reads from one picker, so nothing was added. \
             Choose fewer files at a time.",
            true,
        )
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

    #[cfg(test)]
    mod tests {
        use super::{malformed_selection, parse_selection, selection_too_large};
        use std::path::PathBuf;

        /// The buffer the dialog leaves behind: each string NUL-terminated, the
        /// empty string that ends the list, then the untouched zeros of the
        /// allocation the caller handed over.
        fn answer(segments: &[&str]) -> Vec<u16> {
            let mut buffer = truncated_answer(segments);
            buffer.resize(buffer.len() + 16, 0);
            buffer
        }

        /// The same answer cut off the moment its last string ends, which is
        /// what a caller sees when the list did not fit.
        fn truncated_answer(segments: &[&str]) -> Vec<u16> {
            let mut buffer = Vec::new();
            for segment in segments {
                buffer.extend(segment.encode_utf16());
                buffer.push(0);
            }
            buffer
        }

        #[test]
        fn one_selection_is_the_single_absolute_path_the_dialog_wrote() {
            assert_eq!(
                parse_selection(&answer(&[r"D:\MSData\sample.mzML"]))
                    .expect("one path is a valid answer"),
                vec![PathBuf::from(r"D:\MSData\sample.mzML")]
            );
        }

        #[test]
        fn two_selections_are_a_directory_and_two_names_rather_than_one_path() {
            assert_eq!(
                parse_selection(&answer(&[r"D:\MSData", "second.mzML", "first.mzML"]))
                    .expect("two files are a valid answer"),
                vec![
                    PathBuf::from(r"D:\MSData\second.mzML"),
                    PathBuf::from(r"D:\MSData\first.mzML"),
                ],
                "the order the dialog reported is the order the roster is built in"
            );
        }

        #[test]
        fn several_selections_keep_the_order_the_dialog_reported() {
            let chosen = parse_selection(&answer(&[
                r"D:\MSData\batch",
                "c.mzML",
                "a.mzML",
                "b.mzML",
                "d.mzML",
            ]))
            .expect("several files are a valid answer");

            assert_eq!(
                chosen,
                vec![
                    PathBuf::from(r"D:\MSData\batch\c.mzML"),
                    PathBuf::from(r"D:\MSData\batch\a.mzML"),
                    PathBuf::from(r"D:\MSData\batch\b.mzML"),
                    PathBuf::from(r"D:\MSData\batch\d.mzML"),
                ]
            );
        }

        #[test]
        fn a_selection_may_be_named_in_any_script() {
            assert_eq!(
                parse_selection(&answer(&[r"D:\データ", "標準 1.mzML", "样本.mzML"]))
                    .expect("a non-ASCII answer is a valid answer"),
                vec![
                    PathBuf::from(r"D:\データ\標準 1.mzML"),
                    PathBuf::from(r"D:\データ\样本.mzML"),
                ]
            );
        }

        #[test]
        fn a_directory_that_is_a_volume_root_still_joins_correctly() {
            // A root ends in a separator already, and joining one onto it must
            // not produce a doubled one or lose the name.
            assert_eq!(
                parse_selection(&answer(&[r"D:\", "sample.mzML"]))
                    .expect("a volume root is a valid directory"),
                vec![PathBuf::from(r"D:\sample.mzML")]
            );
        }

        #[test]
        fn an_answer_naming_nothing_is_an_empty_selection_rather_than_a_path() {
            assert!(
                parse_selection(&answer(&[]))
                    .expect("an empty answer is not a failure")
                    .is_empty()
            );
        }

        #[test]
        fn an_answer_with_no_final_terminator_is_refused_rather_than_cut_short() {
            // The list ends with an empty string. Without one, the answer was
            // cut, and reading the last complete name as though the list ended
            // there would turn a truncated answer into a shorter selection that
            // looks whole.
            assert_eq!(
                parse_selection(&truncated_answer(&[r"D:\MSData", "a.mzML", "b.mzML"]))
                    .expect_err("a cut answer is refused")
                    .kind,
                "file_picker_selection_unreadable"
            );
            assert_eq!(
                parse_selection(&truncated_answer(&[r"D:\MSData\sample.mzML"]))
                    .expect_err("even one cut path is refused")
                    .kind,
                "file_picker_selection_unreadable"
            );
        }

        #[test]
        fn a_later_component_that_is_not_a_bare_file_name_is_refused() {
            // Every one of these has a meaning after a join that is not the file
            // its position claims it is.
            for malformed in [
                vec![r"D:\MSData", r"C:\elsewhere\other.mzML"],
                vec![r"D:\MSData", r"\\server\share\other.mzML"],
                vec![r"D:\MSData", r"sub\other.mzML"],
                vec![r"D:\MSData", ".."],
                vec![r"D:\MSData", "."],
                // And the first component is a directory or a path, never a
                // relative fragment.
                vec!["MSData", "a.mzML"],
                vec!["sample.mzML"],
            ] {
                assert_eq!(
                    parse_selection(&answer(&malformed))
                        .expect_err("a malformed answer is refused rather than invented from")
                        .kind,
                    "file_picker_selection_unreadable",
                    "{malformed:?}"
                );
            }
        }

        #[test]
        fn an_answer_that_did_not_fit_is_a_typed_failure_rather_than_a_short_selection() {
            // With multi-selection the dialog writes a required size into the
            // buffer instead of a path when the answer does not fit, so this
            // condition has to be told apart from every other failure before
            // anything reads it.
            let error = selection_too_large();

            assert_eq!(error.kind, "file_picker_selection_too_large");
            assert!(error.retryable, "choosing fewer files is worth offering");
        }

        #[test]
        fn a_refused_selection_never_carries_what_it_refused() {
            for error in [
                parse_selection(&answer(&[
                    r"D:\MSData\private",
                    r"C:\elsewhere\secret.mzML",
                ]))
                .expect_err("a malformed answer is refused"),
                malformed_selection(),
                selection_too_large(),
            ] {
                let rendered = serde_json::to_string(&error).expect("the error serializes");
                assert!(!rendered.contains("MSData"), "{rendered}");
                assert!(!rendered.contains("secret"), "{rendered}");
                assert!(!rendered.contains("elsewhere"), "{rendered}");
                // No separator of any kind: the rendering escapes a backslash,
                // so one escaped pair would be one separator.
                assert!(!rendered.contains("\\\\"), "{rendered}");
            }
        }
    }
}
