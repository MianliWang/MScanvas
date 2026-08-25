//! A Rust-owned native "open file" dialog.
//!
//! The webview is deliberately granted no filesystem or dialog permission, so
//! the native picker is invoked here and only the chosen path enters Rust. The
//! frontend receives an opaque handle and a display name, never a path.

use std::path::Path;

use super::dto::PreviewErrorDto;

/// How one save dialog presents itself.
///
/// Carried together rather than as loose parameters because each field is
/// wrong on its own: a window titled "Save conversion diagnostics" over a
/// filter reading `*.csv` is a dialog that misstates what is about to be
/// written, and the two would drift the moment a third format arrived.
///
/// Every field is `&'static str`. These describe MSCanvas's own formats, so
/// none of them is ever built from a path, a file name a user chose, or
/// anything else that crossed a boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SaveDialogFacts {
    /// The dialog window's title.
    pub title: &'static str,
    /// What the filter row reads, including its pattern in the usual form.
    pub filter_label: &'static str,
    /// The pattern the filter matches, such as `*.svg`.
    pub filter_pattern: &'static str,
    /// The extension appended when the typed name carries none.
    pub default_extension: &'static str,
}

impl SaveDialogFacts {
    /// Whether a chosen destination is named as the document it will hold.
    ///
    /// The dialog is guidance: it shows a filter and appends
    /// [`Self::default_extension`] when the typed name carries none. It is not
    /// an authority, because a user may type an extension of their own and the
    /// dialog hands that back unchanged. So the writer checks the path it
    /// actually received rather than assuming what the dialog would have done.
    ///
    /// The **final** extension is what is compared, so `trace.csv.txt` is a
    /// `txt` and is refused for a CSV. Comparison is case-insensitive: these
    /// identifiers are ASCII and Windows file extensions do not distinguish
    /// case, so `.CSV` is the same document as `.csv`.
    ///
    /// Everything else fails closed -- no extension at all, an empty one, and a
    /// name whose extension is not valid Unicode. A file the boundary cannot
    /// read the name of is not one it can promise anything about.
    #[must_use]
    pub fn names_this_document(&self, destination: &Path) -> bool {
        destination
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case(self.default_extension))
    }

    /// What to tell someone whose filename does not match, in their words.
    ///
    /// Names the extension to use and the document it belongs to, and nothing
    /// else. No path, no folder and no source: a refusal is not a place to
    /// disclose where the user was working.
    #[must_use]
    pub fn extension_refusal(&self) -> String {
        format!(
            "Choose a filename ending in .{} for a {} export.",
            self.default_extension,
            self.default_extension.to_ascii_uppercase(),
        )
    }
}

#[cfg(windows)]
pub use windows_dialog::{
    choose_conversion_destination, choose_diagnostics_destination, choose_installation_folder,
    choose_mzml_folder, choose_save_destination, choose_workspace_files,
};

/// The save dialog for the one diagnostics document.
pub const DIAGNOSTICS_SAVE_DIALOG: SaveDialogFacts = SaveDialogFacts {
    title: "Save conversion diagnostics",
    filter_label: "Diagnostics (*.json)",
    filter_pattern: "*.json",
    default_extension: "json",
};

#[cfg(not(windows))]
pub fn choose_save_destination(
    _owner: Option<isize>,
    _facts: SaveDialogFacts,
    _default_file_name: &str,
) -> Result<Option<std::path::PathBuf>, PreviewErrorDto> {
    Err(PreviewErrorDto::new(
        "file_picker_unavailable",
        "The native save dialog is available on Windows in this version.",
        false,
    ))
}

#[cfg(not(windows))]
pub fn choose_diagnostics_destination(
    owner: Option<isize>,
    default_file_name: &str,
) -> Result<Option<std::path::PathBuf>, PreviewErrorDto> {
    choose_save_destination(owner, DIAGNOSTICS_SAVE_DIALOG, default_file_name)
}

#[cfg(not(windows))]
pub fn choose_workspace_files(
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

#[cfg(not(windows))]
pub fn choose_mzml_folder(
    _owner: Option<isize>,
) -> Result<Option<std::path::PathBuf>, PreviewErrorDto> {
    Err(PreviewErrorDto::new(
        "folder_picker_unavailable",
        "The native folder picker is available on Windows in this version.",
        false,
    ))
}

#[cfg(not(windows))]
pub fn choose_conversion_destination(
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
    use super::SaveDialogFacts;
    use std::ffi::OsString;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStringExt;
    use std::path::{Path, PathBuf};

    use super::PreviewErrorDto;
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
        CoTaskMemFree, CoUninitialize,
    };
    use windows::Win32::UI::Shell::{
        FILEOPENDIALOGOPTIONS, FOS_ALLNONSTORAGEITEMS, FOS_ALLOWMULTISELECT, FOS_CREATEPROMPT,
        FOS_DONTADDTORECENT, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR,
        FOS_NODEREFERENCELINKS, FOS_NOVALIDATE, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, FileOpenDialog,
        IFileOpenDialog, SIGDN_FILESYSPATH,
    };
    use windows::core::{HRESULT, PCWSTR, PWSTR};

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
        #[link_name = "GetSaveFileNameW"]
        fn get_save_file_name_w(arguments: *mut OpenFileNameW) -> i32;
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
    pub fn choose_workspace_files(
        owner: Option<isize>,
    ) -> Result<Option<Vec<PathBuf>>, PreviewErrorDto> {
        // A double-NUL terminated pair list: display label, then pattern. One
        // combined entry rather than four, because the four families are one
        // workspace and a user choosing an acquisition should not have to know
        // which filter row it is under.
        //
        // Candidate filtering only. What a file is is decided by opening it:
        // an mzML candidate goes to mzML admission, a `.raw` candidate to the
        // signature rule, a `.lcd` candidate to the compound-file rule and a
        // `.wiff` candidate to the SCIEX bundle rule -- each of which refuses a
        // name whose bytes are not an acquisition of that family.
        //
        // `*.wiff.scan` is deliberately **not** offered. The companion is not a
        // separately selectable acquisition: it is admitted with the primary
        // that names it, and proposing it here would invite the user to select
        // half of one. Selecting it anyway is refused by name in
        // `accept_workspace_file`, with the sentence that says what to select
        // instead.
        let mut filter = Vec::new();
        filter.extend_from_slice(&wide("Acquisitions (*.mzML;*.raw;*.lcd;*.wiff)"));
        filter.extend_from_slice(&wide("*.mzML;*.raw;*.lcd;*.wiff"));
        filter.push(0);
        let title = wide("Open acquisitions");
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

    /// Shows the native save dialog and returns where diagnostics should be
    /// written, or `None` when the user cancelled.
    ///
    /// A save dialog rather than a folder picker, because what is being decided
    /// is a file and its name. The default name is MSCanvas' own and the user
    /// may change it, which is what makes exporting twice into one folder an
    /// ordinary thing to do rather than something the no-clobber rule punishes.
    ///
    /// It is the same `comdlg32` entry point family the acquisition picker
    /// already uses and the same `OPENFILENAMEW`: one struct, one set of flags
    /// and one way of telling cancellation from failure, rather than a second
    /// dialog implementation whose guarantees would have to be established
    /// separately.
    ///
    /// Nothing is created here. This returns a name; admission decides whether
    /// its folder is one this boundary will write into, and the write itself
    /// refuses to replace anything.
    ///
    /// Must be called from a thread that can run a modal message loop; the
    /// Tauri command dispatches it onto the main thread.
    pub fn choose_diagnostics_destination(
        owner: Option<isize>,
        default_file_name: &str,
    ) -> Result<Option<PathBuf>, PreviewErrorDto> {
        choose_save_destination(owner, super::DIAGNOSTICS_SAVE_DIALOG, default_file_name)
    }

    /// Shows one native save dialog and answers with the name that was chosen.
    ///
    /// Parametrised by [`SaveDialogFacts`] rather than copied per format: the
    /// flags below are the interesting part of this function, and three copies
    /// of them would be three places for the no-overwrite posture to be relaxed
    /// in. Only the title, the filter and the default extension differ between
    /// the documents MSCanvas writes.
    pub fn choose_save_destination(
        owner: Option<isize>,
        facts: SaveDialogFacts,
        default_file_name: &str,
    ) -> Result<Option<PathBuf>, PreviewErrorDto> {
        let mut filter = Vec::new();
        filter.extend_from_slice(&wide(facts.filter_label));
        filter.extend_from_slice(&wide(facts.filter_pattern));
        filter.push(0);
        let title = wide(facts.title);
        let default_extension = wide(facts.default_extension);

        // The proposed name goes into the same buffer the answer comes back in,
        // which is how this entry point is documented to receive one.
        let mut buffer = vec![0_u16; SELECTION_BUFFER_LENGTH];
        for (slot, unit) in buffer
            .iter_mut()
            .zip(default_file_name.encode_utf16().chain(std::iter::once(0)))
        {
            *slot = unit;
        }

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
            // The same guarantees the acquisition picker asks for, minus the
            // ones about opening an existing file: the folder must exist, the
            // dialog must not change the working directory, must not resolve
            // shortcuts behind the user's back and must not write to the
            // recent-documents list. `OFN_FILEMUSTEXIST` is deliberately absent
            // -- the whole point is a file that does not exist yet.
            // Deliberately without `OFN_OVERWRITEPROMPT`. That prompt asks
            // whether to replace an existing file, and this boundary will not
            // replace one -- so answering yes would lead to a refusal, and the
            // shell would have offered something MSCanvas does not do. The
            // product rule is no implicit output overwrite; a dialog that
            // implies otherwise is that rule being weakened in the one place a
            // user is looking.
            flags: OFN_PATHMUSTEXIST
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
        let chosen = unsafe { get_save_file_name_w(&raw mut arguments) };
        if chosen == 0 {
            // SAFETY: the documented way to distinguish cancellation from
            // failure immediately after the call returns zero.
            let error = unsafe { comm_dlg_extended_error() };
            if error == 0 {
                return Ok(None);
            }
            return Err(PreviewErrorDto::new(
                "file_picker_failed",
                "The save dialog could not be opened.",
                true,
            ));
        }

        let chosen = read_single_path(&buffer)?;
        Ok(Some(chosen))
    }

    /// Reads one NUL-terminated absolute path out of a dialog answer.
    ///
    /// A save dialog answers with exactly one name and no multi-selection form,
    /// so this refuses anything that is not one absolute path rather than
    /// reaching for the directory-then-names reading beside it.
    fn read_single_path(buffer: &[u16]) -> Result<PathBuf, PreviewErrorDto> {
        let Some(end) = buffer.iter().position(|unit| *unit == 0) else {
            return Err(malformed_selection());
        };
        if end == 0 {
            return Err(malformed_selection());
        }
        let chosen = PathBuf::from(std::ffi::OsString::from_wide(&buffer[..end]));
        if !chosen.is_absolute() || chosen.file_name().is_none() {
            return Err(malformed_selection());
        }
        Ok(chosen)
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

    /// The modern common dialog still inherits useful shell defaults. These
    /// are the decisions MSCanvas adds to them: choose exactly one existing
    /// filesystem folder, do not resolve a shell link behind the user's back,
    /// and do not write the choice into Windows' recent-items list.
    const REQUIRED_FOLDER_DIALOG_OPTIONS: FILEOPENDIALOGOPTIONS = FILEOPENDIALOGOPTIONS(
        FOS_PICKFOLDERS.0
            | FOS_FORCEFILESYSTEM.0
            | FOS_PATHMUSTEXIST.0
            | FOS_FILEMUSTEXIST.0
            | FOS_NOCHANGEDIR.0
            | FOS_NODEREFERENCELINKS.0
            | FOS_DONTADDTORECENT.0,
    );
    const REFUSED_FOLDER_DIALOG_OPTIONS: FILEOPENDIALOGOPTIONS = FILEOPENDIALOGOPTIONS(
        FOS_ALLOWMULTISELECT.0 | FOS_ALLNONSTORAGEITEMS.0 | FOS_NOVALIDATE.0 | FOS_CREATEPROMPT.0,
    );

    fn folder_dialog_options(mut inherited: FILEOPENDIALOGOPTIONS) -> FILEOPENDIALOGOPTIONS {
        // These inherited modes contradict one existing filesystem folder or
        // weaken validation. Clear them before adding MSCanvas' requirements.
        inherited.0 &= !REFUSED_FOLDER_DIALOG_OPTIONS.0;
        inherited |= REQUIRED_FOLDER_DIALOG_OPTIONS;
        inherited
    }

    struct ComApartment;

    impl ComApartment {
        fn initialise() -> Result<Self, PreviewErrorDto> {
            // SAFETY: this call supplies the documented null reserved pointer
            // and requests the apartment model required by the common dialog.
            // Every successful call, including S_FALSE, is balanced by Drop.
            let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if result.is_err() {
                return Err(folder_picker_unavailable());
            }
            Ok(Self)
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            // SAFETY: paired with the one successful CoInitializeEx call that
            // constructed this guard, on the same main thread.
            unsafe { CoUninitialize() };
        }
    }

    /// Owns the task-allocator string returned by IShellItem. Keeping the
    /// allocator pair in Drop prevents a new return path from leaking it.
    struct TaskAllocatedWide(PWSTR);

    impl TaskAllocatedWide {
        fn is_null(&self) -> bool {
            self.0.is_null()
        }

        fn to_os_string(&self) -> OsString {
            // SAFETY: the only constructor site receives this pointer from a
            // successful GetDisplayName(SIGDN_FILESYSPATH), whose contract is a
            // live NUL-terminated UTF-16 string owned by the caller.
            OsString::from_wide(unsafe { self.0.as_wide() })
        }
    }

    impl Drop for TaskAllocatedWide {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: this is the documented allocator pair for the one
                // GetDisplayName allocation wrapped by this value.
                unsafe { CoTaskMemFree(Some(self.0.as_ptr().cast())) };
            }
        }
    }

    fn folder_picker_cancelled(code: HRESULT) -> bool {
        code == HRESULT::from_win32(ERROR_CANCELLED.0)
    }

    fn folder_dialog_owner(owner: Option<isize>) -> Option<HWND> {
        owner
            .filter(|handle| *handle != 0)
            .map(|handle| HWND(handle as *mut c_void))
    }

    fn validated_folder_path(path: PathBuf) -> Result<PathBuf, PreviewErrorDto> {
        if path.as_os_str().is_empty() || !path.is_absolute() {
            return Err(folder_choice_unreadable());
        }
        Ok(path)
    }

    /// The part of the Common Item Dialog whose ordering and classifications
    /// are MSCanvas policy rather than COM resource management.
    ///
    /// Keeping this adapter private makes the real interface the only
    /// production implementation, while letting tests prove the whole
    /// `GetOptions` -> `SetOptions` -> `SetTitle` -> `Show` -> result sequence
    /// without opening a modal desktop window.
    trait FolderDialogBackend {
        fn inherited_options(&self) -> Result<FILEOPENDIALOGOPTIONS, ()>;
        fn apply_options(&self, options: FILEOPENDIALOGOPTIONS) -> Result<(), ()>;
        fn apply_title(&self, title: &str) -> Result<(), ()>;
        fn show(&self, owner: Option<HWND>) -> Result<(), HRESULT>;
        fn selected_path(&self) -> Result<PathBuf, ()>;
    }

    impl FolderDialogBackend for IFileOpenDialog {
        fn inherited_options(&self) -> Result<FILEOPENDIALOGOPTIONS, ()> {
            // SAFETY: `self` is a live interface and the options are copied by
            // value rather than retained through a borrowed pointer.
            unsafe { self.GetOptions() }.map_err(|_| ())
        }

        fn apply_options(&self, options: FILEOPENDIALOGOPTIONS) -> Result<(), ()> {
            // SAFETY: this changes only this dialog instance before Show.
            unsafe { self.SetOptions(options) }.map_err(|_| ())
        }

        fn apply_title(&self, title: &str) -> Result<(), ()> {
            let title = wide(title);
            // SAFETY: `title` is NUL-terminated and remains live through the
            // call; IFileDialog copies it rather than retaining the pointer.
            unsafe { self.SetTitle(PCWSTR(title.as_ptr())) }.map_err(|_| ())
        }

        fn show(&self, owner: Option<HWND>) -> Result<(), HRESULT> {
            // SAFETY: the optional HWND is the Tauri main window, and the
            // caller runs this modal operation on that window's main thread.
            unsafe { self.Show(owner) }.map_err(|error| error.code())
        }

        fn selected_path(&self) -> Result<PathBuf, ()> {
            // SAFETY: Show succeeded, so the dialog owns one result. The
            // returned IShellItem keeps it alive while its filesystem name is
            // copied into Rust-owned storage.
            let chosen = unsafe { self.GetResult() }.map_err(|_| ())?;
            // SAFETY: FOS_FORCEFILESYSTEM requests a filesystem item. The
            // shell allocates this NUL-terminated name with the task allocator.
            let display_name = TaskAllocatedWide(
                unsafe { chosen.GetDisplayName(SIGDN_FILESYSPATH) }.map_err(|_| ())?,
            );
            if display_name.is_null() {
                return Err(());
            }
            Ok(PathBuf::from(display_name.to_os_string()))
        }
    }

    fn show_folder_dialog(
        dialog: &impl FolderDialogBackend,
        owner: Option<isize>,
        title: &str,
    ) -> Result<Option<PathBuf>, PreviewErrorDto> {
        let inherited = dialog
            .inherited_options()
            .map_err(|_| folder_picker_unavailable())?;
        dialog
            .apply_options(folder_dialog_options(inherited))
            .map_err(|_| folder_picker_unavailable())?;
        dialog
            .apply_title(title)
            .map_err(|_| folder_picker_unavailable())?;

        if let Err(code) = dialog.show(folder_dialog_owner(owner)) {
            if folder_picker_cancelled(code) {
                return Ok(None);
            }
            return Err(folder_picker_unavailable());
        }

        let path = dialog
            .selected_path()
            .map_err(|_| folder_choice_unreadable())?;
        Ok(Some(validated_folder_path(path)?))
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
        browse_for_folder(owner, "Choose the ProteoWizard installation folder")
    }

    /// Shows the native folder picker and returns the folder of acquisitions to
    /// scan, or `None` when the user cancelled.
    ///
    /// A separate operation from the installation picker rather than the same
    /// one with a different caption. The two name different things -- where the
    /// backend is installed, and where the user keeps their data -- and a
    /// single "choose a folder" command that meant either would be a boundary
    /// whose meaning depended on who called it.
    ///
    /// It asks for the folder, not for files inside it: what the user is
    /// choosing is the authority boundary the scan runs under. What is in it is
    /// discovery's question, and it is asked after this returns.
    ///
    /// Must be called from a thread that can run a modal message loop; the
    /// Tauri command dispatches it onto the main thread.
    pub fn choose_mzml_folder(owner: Option<isize>) -> Result<Option<PathBuf>, PreviewErrorDto> {
        browse_for_folder(owner, "Choose a folder containing .mzML files")
    }

    /// Shows the native folder picker and returns where one converted output
    /// may be written, or `None` when the user cancelled.
    ///
    /// A third operation rather than a third caption on one of the others, for
    /// the reason the second one already gives: these name different things --
    /// where the backend is installed, where the user keeps their data, and
    /// where a file this application creates should go -- and one command that
    /// meant any of them would be a boundary whose meaning depended on who
    /// called it. This one is the only one that leads to writing anything.
    ///
    /// Whether the chosen folder can actually be written to safely is not
    /// decided here. This returns a folder; admission decides whether it is one
    /// this boundary's finalization and cleanup guarantees hold for.
    ///
    /// Must be called from a thread that can run a modal message loop; the
    /// Tauri command dispatches it onto the main thread.
    pub fn choose_conversion_destination(
        owner: Option<isize>,
    ) -> Result<Option<PathBuf>, PreviewErrorDto> {
        browse_for_folder(owner, "Choose where to save the converted mzML")
    }

    /// The one native folder dialog, told what to ask for.
    ///
    /// The title is the only thing that differs between the two operations, and
    /// deliberately the only thing: sharing the implementation is what keeps
    /// their flags identical -- one existing filesystem directory, shell links
    /// left unresolved, no recent-items write, and the caller's window as the
    /// owner -- rather than two copies that drift. A failure here is the same
    /// failure either way, because it is the shell declining to resolve a choice
    /// to a filesystem path, which says nothing about what the caller wanted the
    /// folder for.
    fn browse_for_folder(
        owner: Option<isize>,
        title: &str,
    ) -> Result<Option<PathBuf>, PreviewErrorDto> {
        let _apartment = ComApartment::initialise()?;

        // SAFETY: FileOpenDialog is the documented in-process COM class for an
        // IFileOpenDialog. The apartment guard remains alive for every use.
        let dialog: IFileOpenDialog = unsafe {
            CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
                .map_err(|_| folder_picker_unavailable())?
        };
        show_folder_dialog(&dialog, owner, title)
    }

    fn folder_picker_unavailable() -> PreviewErrorDto {
        PreviewErrorDto::new(
            "folder_picker_failed",
            "The folder picker could not be opened.",
            true,
        )
    }

    fn folder_choice_unreadable() -> PreviewErrorDto {
        PreviewErrorDto::new(
            "folder_picker_failed",
            "That choice could not be read as a folder on this computer.",
            true,
        )
    }

    #[cfg(test)]
    mod tests {
        use super::{
            FolderDialogBackend, folder_choice_unreadable, folder_dialog_options,
            folder_dialog_owner, folder_picker_cancelled, folder_picker_unavailable,
            malformed_selection, parse_selection, selection_too_large, show_folder_dialog,
            validated_folder_path,
        };
        use std::cell::{Cell, RefCell};
        use std::path::PathBuf;
        use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_CANCELLED, HWND};
        use windows::Win32::UI::Shell::{
            FILEOPENDIALOGOPTIONS, FOS_ALLNONSTORAGEITEMS, FOS_ALLOWMULTISELECT, FOS_CREATEPROMPT,
            FOS_DONTADDTORECENT, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR,
            FOS_NODEREFERENCELINKS, FOS_NOVALIDATE, FOS_OVERWRITEPROMPT, FOS_PATHMUSTEXIST,
            FOS_PICKFOLDERS,
        };
        use windows::core::HRESULT;

        struct FakeFolderDialog {
            inherited: Result<FILEOPENDIALOGOPTIONS, ()>,
            options_succeed: bool,
            title_succeeds: bool,
            show_result: Result<(), HRESULT>,
            selected: Result<PathBuf, ()>,
            events: RefCell<Vec<&'static str>>,
            applied_options: RefCell<Vec<FILEOPENDIALOGOPTIONS>>,
            titles: RefCell<Vec<String>>,
            owners: RefCell<Vec<Option<isize>>>,
            selected_calls: Cell<usize>,
        }

        impl FakeFolderDialog {
            fn successful(path: impl Into<PathBuf>) -> Self {
                Self {
                    inherited: Ok(FILEOPENDIALOGOPTIONS(0)),
                    options_succeed: true,
                    title_succeeds: true,
                    show_result: Ok(()),
                    selected: Ok(path.into()),
                    events: RefCell::new(Vec::new()),
                    applied_options: RefCell::new(Vec::new()),
                    titles: RefCell::new(Vec::new()),
                    owners: RefCell::new(Vec::new()),
                    selected_calls: Cell::new(0),
                }
            }
        }

        impl FolderDialogBackend for FakeFolderDialog {
            fn inherited_options(&self) -> Result<FILEOPENDIALOGOPTIONS, ()> {
                self.events.borrow_mut().push("options");
                self.inherited
            }

            fn apply_options(&self, options: FILEOPENDIALOGOPTIONS) -> Result<(), ()> {
                self.events.borrow_mut().push("set-options");
                self.applied_options.borrow_mut().push(options);
                self.options_succeed.then_some(()).ok_or(())
            }

            fn apply_title(&self, title: &str) -> Result<(), ()> {
                self.events.borrow_mut().push("title");
                self.titles.borrow_mut().push(title.to_owned());
                self.title_succeeds.then_some(()).ok_or(())
            }

            fn show(&self, owner: Option<HWND>) -> Result<(), HRESULT> {
                self.events.borrow_mut().push("show");
                self.owners
                    .borrow_mut()
                    .push(owner.map(|handle| handle.0 as isize));
                self.show_result
            }

            fn selected_path(&self) -> Result<PathBuf, ()> {
                self.events.borrow_mut().push("result");
                self.selected_calls.set(self.selected_calls.get() + 1);
                self.selected.clone()
            }
        }

        /// The buffer the dialog leaves behind: each string NUL-terminated, the
        /// empty string that ends the list, then the untouched zeros of the
        /// allocation the caller handed over.
        fn answer(segments: &[&str]) -> Vec<u16> {
            let mut buffer = truncated_answer(segments);
            buffer.resize(buffer.len() + 16, 0);
            buffer
        }

        #[test]
        fn folder_dialog_orchestration_applies_policy_in_order_and_preserves_the_owner() {
            let mut dialog = FakeFolderDialog::successful(r"D:\MS Data\batch");
            dialog.inherited = Ok(FILEOPENDIALOGOPTIONS(
                FOS_ALLOWMULTISELECT.0 | FOS_NOVALIDATE.0 | FOS_OVERWRITEPROMPT.0,
            ));

            let chosen = show_folder_dialog(
                &dialog,
                Some(0x1234_isize),
                "Choose a folder containing .mzML files",
            )
            .expect("the fake dialog succeeds")
            .expect("the fake dialog chose a folder");

            assert_eq!(chosen, PathBuf::from(r"D:\MS Data\batch"));
            assert_eq!(
                dialog.events.borrow().as_slice(),
                ["options", "set-options", "title", "show", "result"]
            );
            let applied = dialog.applied_options.borrow();
            assert_eq!(applied.len(), 1);
            assert!(applied[0].contains(FOS_PICKFOLDERS));
            assert!(applied[0].contains(FOS_FORCEFILESYSTEM));
            assert!(applied[0].contains(FOS_PATHMUSTEXIST));
            assert!(applied[0].contains(FOS_FILEMUSTEXIST));
            assert!(applied[0].contains(FOS_NOCHANGEDIR));
            assert!(applied[0].contains(FOS_NODEREFERENCELINKS));
            assert!(applied[0].contains(FOS_DONTADDTORECENT));
            assert!(!applied[0].contains(FOS_ALLOWMULTISELECT));
            assert!(!applied[0].contains(FOS_NOVALIDATE));
            assert!(applied[0].contains(FOS_OVERWRITEPROMPT));
            assert_eq!(
                dialog.titles.borrow().as_slice(),
                ["Choose a folder containing .mzML files"]
            );
            assert_eq!(dialog.owners.borrow().as_slice(), [Some(0x1234_isize)]);
            assert_eq!(dialog.selected_calls.get(), 1);
        }

        #[test]
        fn folder_dialog_orchestration_reads_no_result_after_cancel_or_show_failure() {
            let mut cancelled = FakeFolderDialog::successful(r"D:\ignored");
            cancelled.show_result = Err(HRESULT::from_win32(ERROR_CANCELLED.0));
            assert!(
                show_folder_dialog(&cancelled, None, "Choose a folder")
                    .expect("cancel is an ordinary outcome")
                    .is_none()
            );
            assert_eq!(
                cancelled.events.borrow().as_slice(),
                ["options", "set-options", "title", "show"]
            );
            assert_eq!(cancelled.selected_calls.get(), 0);

            let mut denied = FakeFolderDialog::successful(r"D:\ignored");
            denied.show_result = Err(HRESULT::from_win32(ERROR_ACCESS_DENIED.0));
            let error = show_folder_dialog(&denied, None, "Choose a folder")
                .expect_err("a non-cancel Show failure stays a failure");
            assert_eq!(error.kind, "folder_picker_failed");
            assert_eq!(denied.selected_calls.get(), 0);
        }

        #[test]
        fn folder_dialog_orchestration_rejects_missing_or_malformed_results() {
            let mut missing = FakeFolderDialog::successful(r"D:\ignored");
            missing.selected = Err(());
            let missing_error = show_folder_dialog(&missing, None, "Choose a folder")
                .expect_err("a result that cannot be read is not cancellation");
            assert_eq!(missing_error.kind, "folder_picker_failed");
            assert_eq!(missing.selected_calls.get(), 1);

            for malformed in [
                PathBuf::new(),
                PathBuf::from("relative"),
                PathBuf::from(".."),
            ] {
                let dialog = FakeFolderDialog::successful(malformed);
                let error = show_folder_dialog(&dialog, None, "Choose a folder")
                    .expect_err("a successful Show must still return one absolute folder");
                assert_eq!(error.kind, "folder_picker_failed");
                assert_eq!(dialog.selected_calls.get(), 1);
            }
        }

        #[test]
        fn folder_dialog_orchestration_stops_at_the_failed_setup_step() {
            let mut options = FakeFolderDialog::successful(r"D:\ignored");
            options.inherited = Err(());
            assert!(show_folder_dialog(&options, None, "Choose a folder").is_err());
            assert_eq!(options.events.borrow().as_slice(), ["options"]);

            let mut applying = FakeFolderDialog::successful(r"D:\ignored");
            applying.options_succeed = false;
            assert!(show_folder_dialog(&applying, None, "Choose a folder").is_err());
            assert_eq!(
                applying.events.borrow().as_slice(),
                ["options", "set-options"]
            );

            let mut title = FakeFolderDialog::successful(r"D:\ignored");
            title.title_succeeds = false;
            assert!(show_folder_dialog(&title, None, "Choose a folder").is_err());
            assert_eq!(
                title.events.borrow().as_slice(),
                ["options", "set-options", "title"]
            );
        }

        #[test]
        fn folder_dialog_is_one_existing_filesystem_folder_without_shell_side_effects() {
            let inherited = FILEOPENDIALOGOPTIONS(
                FOS_ALLOWMULTISELECT.0
                    | FOS_ALLNONSTORAGEITEMS.0
                    | FOS_NOVALIDATE.0
                    | FOS_CREATEPROMPT.0
                    | FOS_OVERWRITEPROMPT.0,
            );
            let options = folder_dialog_options(inherited);

            for required in [
                FOS_PICKFOLDERS,
                FOS_FORCEFILESYSTEM,
                FOS_PATHMUSTEXIST,
                FOS_FILEMUSTEXIST,
                FOS_NOCHANGEDIR,
                FOS_NODEREFERENCELINKS,
                FOS_DONTADDTORECENT,
            ] {
                assert!(options.contains(required), "missing {required:?}");
            }
            for refused in [
                FOS_ALLOWMULTISELECT,
                FOS_ALLNONSTORAGEITEMS,
                FOS_NOVALIDATE,
                FOS_CREATEPROMPT,
            ] {
                assert!(!options.contains(refused), "retained {refused:?}");
            }
            assert!(
                options.contains(FOS_OVERWRITEPROMPT),
                "unrelated shell defaults stay intact"
            );
        }

        #[test]
        fn only_the_windows_cancel_result_is_a_dismissed_picker() {
            assert!(folder_picker_cancelled(HRESULT::from_win32(
                ERROR_CANCELLED.0
            )));
            assert!(!folder_picker_cancelled(HRESULT::from_win32(
                ERROR_ACCESS_DENIED.0
            )));
            assert!(!folder_picker_cancelled(HRESULT(0)));
        }

        #[test]
        fn the_main_window_handle_is_neither_replaced_nor_invented() {
            let sentinel = 0x1234_isize;
            let owner = folder_dialog_owner(Some(sentinel)).expect("one owner remains one owner");

            assert_eq!(owner.0 as isize, sentinel);
            assert!(folder_dialog_owner(None).is_none());
            assert!(folder_dialog_owner(Some(0)).is_none());
        }

        #[test]
        fn a_successful_dialog_must_still_name_one_absolute_folder() {
            for absolute in [r"D:\MS Data\batch", r"C:\データ\样本"] {
                let path = PathBuf::from(absolute);
                assert_eq!(
                    validated_folder_path(path.clone()).expect("an absolute path is valid"),
                    path
                );
            }

            for malformed in [
                PathBuf::new(),
                PathBuf::from("relative"),
                PathBuf::from(".."),
            ] {
                let error = validated_folder_path(malformed)
                    .expect_err("a successful Show does not turn a malformed result into cancel");
                assert_eq!(error.kind, "folder_picker_failed");
                let rendered = serde_json::to_string(&error).expect("the error serializes");
                assert!(!rendered.contains("relative"), "{rendered}");
            }
        }

        #[test]
        fn the_legacy_folder_picker_stays_retired_and_the_production_adapter_stays_wired() {
            let source = include_str!("dialog.rs");

            for legacy in [
                concat!("SHBrowse", "ForFolderW"),
                concat!("SHGetPath", "FromIDListEx"),
                concat!("Browse", "InfoW"),
                concat!("BIF", "_"),
            ] {
                assert!(!source.contains(legacy), "legacy API returned: {legacy}");
            }
            for required in [
                concat!("CoInitialize", "Ex(None, COINIT_APARTMENTTHREADED)"),
                concat!("CoUn", "initialize()"),
                concat!(
                    "CoCreate",
                    "Instance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)"
                ),
                concat!("unsafe { self.", "GetOptions() }"),
                concat!("unsafe { self.", "SetOptions(options) }"),
                concat!("unsafe { self.", "SetTitle(PCWSTR(title.as_ptr())) }"),
                concat!("unsafe { self.", "Show(owner) }"),
                concat!("IFile", "OpenDialog"),
                concat!("show_folder_", "dialog(&dialog, owner, title)"),
                concat!("unsafe { self.", "GetResult() }"),
                concat!("unsafe { chosen.", "GetDisplayName(SIGDN_FILESYSPATH) }"),
                concat!("FOS_PICK", "FOLDERS"),
                concat!("SIGDN_FILE", "SYSPATH"),
                concat!("CoTaskMem", "Free(Some(self.0.as_ptr().cast()))"),
            ] {
                assert!(source.contains(required), "modern API missing: {required}");
            }
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
                folder_picker_unavailable(),
                folder_choice_unreadable(),
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
