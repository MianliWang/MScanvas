//! Giving a validated conversion output its final name.
//!
//! The rule this module exists for is that the object which receives the final
//! name must be the object the integrity scanner read. A path-based move cannot
//! promise that: between the judgement and the move, anything with write access
//! to the destination root can put a different file at the staged name, and the
//! move would carry that file to the final name while the report described the
//! one that was judged.
//!
//! On Windows the rename therefore acts on the open handle rather than on a
//! name. `SetFileInformationByHandle` with `FileRenameInfo` renames the object
//! the handle refers to; the staged name is never resolved again and does not
//! need to still mean anything.
//!
//! The target end is bound differently, because the Win32 entry point does not
//! support binding it the same way — see [`DestinationDirectory`].
//!
//! All unsafe code for finalization lives here; teardown's is in
//! [`super::cleanup`], and the boundary has no other.

use std::ffi::OsStr;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use crate::conversion::ValidatedConversionOutput;
use crate::finalized_output::FinalizedOutput;

/// The destination root, held open as the object it was admitted as.
///
/// The rename would ideally name its target relative to this handle, and the
/// NT-level contract behind `FILE_RENAME_INFO` provides exactly that through
/// its `RootDirectory` field. The Win32 `SetFileInformationByHandle` does not
/// forward it: measured against this stack, every non-null `RootDirectory` form
/// is refused with `ERROR_INVALID_PARAMETER`, including with the access mask the
/// driver documentation recommends — which is why the standard library also
/// always passes null. `a_root_directory_relative_rename_is_unavailable` keeps
/// that measurement in the suite, so the day it stops being true is visible.
///
/// The target is therefore bound by holding the directory instead. The handle is
/// opened while the root is still the object the identity contract admitted, and
/// deliberately *without* delete sharing, which is what stops the directory
/// being renamed or removed for as long as a run is in flight. The final name is
/// then formed against the canonical path of a directory object that cannot be
/// swapped underneath it.
pub(crate) struct DestinationDirectory {
    #[cfg(windows)]
    _pin: File,
    path: PathBuf,
}

impl DestinationDirectory {
    /// Opens the admitted destination root and pins it for the run.
    #[cfg(windows)]
    pub(super) fn open(path: &Path) -> io::Result<Self> {
        use std::os::windows::fs::OpenOptionsExt;

        /// The mask the `FILE_RENAME_INFORMATION` documentation recommends for
        /// a rename's target directory.
        const FILE_TRAVERSE: u32 = 0x0000_0020;
        const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
        const FILE_SHARE_READ: u32 = 0x0000_0001;
        const FILE_SHARE_WRITE: u32 = 0x0000_0002;
        /// Required to obtain a handle to a directory at all.
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

        // Delete sharing is withheld on purpose. It costs the user the ability
        // to rename or remove this one directory while a conversion runs, and
        // it buys the guarantee that the path the final name is formed from
        // still denotes the directory that was admitted.
        let pin = std::fs::OpenOptions::new()
            .read(true)
            .access_mode(FILE_TRAVERSE | FILE_READ_ATTRIBUTES)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)?;
        if !pin.metadata()?.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "the destination root is not a directory",
            ));
        }
        Ok(Self {
            _pin: pin,
            path: path.to_path_buf(),
        })
    }

    /// Records the admitted destination root. No platform outside Windows
    /// offers the pin, so nothing here claims one.
    #[cfg(not(windows))]
    pub(super) fn open(path: &Path) -> io::Result<Self> {
        if !std::fs::metadata(path)?.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "the destination root is not a directory",
            ));
        }
        Ok(Self {
            path: path.to_path_buf(),
        })
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl std::fmt::Debug for DestinationDirectory {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Neither the path nor the handle may be rendered.
        formatter
            .debug_struct("DestinationDirectory")
            .field("root", &"<opaque-destination-root>")
            .finish_non_exhaustive()
    }
}

/// Gives the validated object the planned final name inside `destination`.
///
/// Consuming the validated output is the double-finalization guard: an object
/// that has been finalized no longer exists to finalize again.
///
/// The object is retained -- as a permissive reopen of itself, not as this
/// handle -- and is retained *before* the rename, so a failure to retain leaves
/// nothing published. It is the one thing that can later answer whether the
/// final name still means this object, and it costs nothing that matters: the
/// retention shares everything, so the user may still write, rename or remove
/// their own output, and it is released with the report that carries it.
#[cfg(windows)]
pub(super) fn finalize_validated(
    validated: ValidatedConversionOutput,
    destination: &DestinationDirectory,
    final_name: &OsStr,
) -> io::Result<FinalizedOutput> {
    let (file, valid) = validated.into_parts();
    // Before the rename, deliberately. Retaining can fail -- it opens a handle
    // and asks the object what it is -- and a failure after the rename would
    // report that nothing was finalized while the output sat at its final name,
    // occupying it for every later run. Renaming does not change which object
    // this is, so nothing about the retention goes stale below.
    let retained = FinalizedOutput::retain(&file, valid)?;
    let renamed = single_component(final_name)
        .map(|name| destination.path().join(name))
        .and_then(|target| rename_object_to(&file, &target));
    // The renaming handle goes as soon as it has done its work. It is the one
    // that withholds write sharing, and every moment it is held past its purpose
    // is a moment the user cannot write their own file.
    drop(file);
    renamed.map(|()| retained)
}

/// Gives the validated object the planned final name inside `destination`.
///
/// The standard library offers no rename bound to an open object and no
/// no-clobber rename outside Windows. A hard link fails when the target exists,
/// so the no-clobber rule holds, but the link is made from the staged *name*:
/// this platform does not carry the object-bound guarantee and does not claim
/// it.
#[cfg(not(windows))]
pub(super) fn finalize_validated(
    validated: ValidatedConversionOutput,
    destination: &DestinationDirectory,
    staged: &Path,
    final_name: &OsStr,
) -> io::Result<FinalizedOutput> {
    let (file, valid) = validated.into_parts();
    // Released before the link so cleanup is never blocked by this reading.
    // Nothing is retained: the link is made from the staged *name*, so there is
    // no renamed object to hold and this platform does not claim one.
    drop(file);
    let target = destination.path().join(single_component(final_name)?);
    std::fs::hard_link(staged, target)?;
    let _ = std::fs::remove_file(staged);
    Ok(FinalizedOutput::unbound(valid))
}

/// Refuses anything that is not one plain name.
///
/// The planned output name is already validated, so this is a second lock on
/// the one input that could steer a finalization out of the admitted root.
pub(super) fn single_component(final_name: &OsStr) -> io::Result<&OsStr> {
    let mut components = Path::new(final_name).components();
    let single = matches!(
        components.next(),
        Some(std::path::Component::Normal(component)) if component == final_name
    ) && components.next().is_none();
    if !single {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "a final output name must be one path component",
        ));
    }
    Ok(final_name)
}

/// Renames the object `file` names to `target`, refusing to replace anything.
///
/// The source is the open object, not a name: the staged path may already refer
/// to something else by the time this runs and it does not matter, because the
/// kernel renames the file object the handle holds. `ReplaceIfExists` stays
/// false, so an occupied target fails with `ERROR_ALREADY_EXISTS` rather than
/// overwriting.
#[cfg(windows)]
pub(super) fn rename_object_to(file: &File, target: &Path) -> io::Result<()> {
    use std::ffi::c_void;
    use std::mem::{align_of, offset_of, size_of};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;

    type Handle = *mut c_void;
    type Bool = i32;

    /// `FileRenameInfo` in `FILE_INFO_BY_HANDLE_CLASS`.
    const FILE_RENAME_INFO_CLASS: i32 = 3;

    /// The fixed prefix of the variable-length `FILE_RENAME_INFO`. It is never
    /// instantiated by value; it exists to pin the documented layout and to
    /// derive where the name characters begin.
    ///
    /// `flags` models the SDK union of `BOOLEAN ReplaceIfExists` and
    /// `DWORD Flags`. Writing it as a zeroed `DWORD` is `ReplaceIfExists =
    /// FALSE` under either reading and leaves no indeterminate filler byte.
    #[repr(C)]
    struct FileRenameInfoHeader {
        flags: u32,
        root_directory: Handle,
        file_name_length: u32,
        file_name: [u16; 1],
    }

    const FILE_NAME_OFFSET: usize = offset_of!(FileRenameInfoHeader, file_name);

    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 24] = [(); size_of::<FileRenameInfoHeader>()];
    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 8] = [(); align_of::<FileRenameInfoHeader>()];
    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 8] = [(); offset_of!(FileRenameInfoHeader, root_directory)];
    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 20] = [(); FILE_NAME_OFFSET];

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "SetFileInformationByHandle"]
        fn set_file_information_by_handle(
            file: Handle,
            information_class: i32,
            information: *mut c_void,
            information_size: u32,
        ) -> Bool;
    }

    let mut name: Vec<u16> = target.as_os_str().encode_wide().collect();
    if name.is_empty() || name.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "a rename target may not be empty or contain an interior null",
        ));
    }
    // The length counts bytes and excludes the terminator, but the Win32 entry
    // point still resolves the name as a wide string, so the buffer carries one.
    let file_name_length = u32::try_from(name.len() * size_of::<u16>()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "the rename target is too long")
    })?;
    name.push(0);

    let buffer_bytes = FILE_NAME_OFFSET + name.len() * size_of::<u16>();
    let information_size = u32::try_from(buffer_bytes).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "the rename target is too long")
    })?;
    // A `u64` element type gives the eight-byte alignment the handle field
    // needs and zeroes both the union filler and the alignment padding; a byte
    // vector would only be byte-aligned.
    let mut buffer = vec![0_u64; buffer_bytes.div_ceil(size_of::<u64>())];
    let base: *mut u8 = buffer.as_mut_ptr().cast();

    // SAFETY: `buffer` is at least `buffer_bytes` long and eight-byte aligned,
    // so `base` is a valid, correctly aligned `FILE_RENAME_INFO`. Each field is
    // written through its own raw place, at offsets the `repr(C)` layout of
    // `FileRenameInfoHeader` fixes on every target this compiles for, and the
    // name with its terminator fits exactly in the trailing bytes.
    unsafe {
        let header = base.cast::<FileRenameInfoHeader>();
        (&raw mut (*header).flags).write(0);
        (&raw mut (*header).root_directory).write(std::ptr::null_mut());
        (&raw mut (*header).file_name_length).write(file_name_length);
        base.add(FILE_NAME_OFFSET)
            .cast::<u16>()
            .copy_from_nonoverlapping(name.as_ptr(), name.len());
    }

    // SAFETY: the handle is live for the call, and `base` points at a fully
    // initialized `FILE_RENAME_INFO` of exactly `information_size` bytes that
    // outlives it.
    let renamed = unsafe {
        set_file_information_by_handle(
            file.as_raw_handle(),
            FILE_RENAME_INFO_CLASS,
            base.cast(),
            information_size,
        )
    };
    // Read before anything else can clobber the thread's last error. `buffer` is
    // still owned at this point, which is what keeps it alive across the call.
    if renamed == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The measurement behind [`DestinationDirectory`]'s target binding: the Win32
/// entry point refuses a handle-relative rename target. If this ever starts
/// passing, the target end can become object-bound too.
#[cfg(all(test, windows))]
#[test]
fn a_root_directory_relative_rename_is_unavailable() {
    use std::ffi::c_void;
    use std::mem::{offset_of, size_of};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;

    #[repr(C)]
    struct Header {
        flags: u32,
        root_directory: *mut c_void,
        file_name_length: u32,
        file_name: [u16; 1],
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "SetFileInformationByHandle"]
        fn set_file_information_by_handle(
            file: *mut c_void,
            information_class: i32,
            information: *mut c_void,
            information_size: u32,
        ) -> i32;
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "mscanvas-root-relative-rename-{}-{timestamp}",
        std::process::id()
    ));
    std::fs::create_dir(&root).expect("create the probe root");
    let staging = root.join("stage");
    std::fs::create_dir(&staging).expect("create the probe staging directory");
    let staged = staging.join("probe.mzML");
    std::fs::write(&staged, b"probe").expect("write the probe output");

    const DELETE: u32 = 0x0001_0000;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(0x0000_0001 | 0x0000_0080 | 0x0010_0000 | DELETE)
        .share_mode(0x0000_0001 | 0x0000_0002 | 0x0000_0004)
        .open(&staged)
        .expect("open the probe output");
    // Exactly the access mask the driver documentation recommends.
    let directory = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(0x0000_0020 | 0x0000_0080)
        .share_mode(0x0000_0001 | 0x0000_0002 | 0x0000_0004)
        .custom_flags(0x0200_0000)
        .open(&root)
        .expect("open the probe root directory");

    let name: Vec<u16> = OsStr::new("probe.mzML").encode_wide().collect();
    const FILE_NAME_OFFSET: usize = offset_of!(Header, file_name);
    let buffer_bytes = FILE_NAME_OFFSET + (name.len() + 1) * size_of::<u16>();
    let mut buffer = vec![0_u64; buffer_bytes.div_ceil(size_of::<u64>())];
    let base: *mut u8 = buffer.as_mut_ptr().cast();
    // SAFETY: the same construction `rename_object_to` performs, with a
    // non-null root directory, over a buffer of the required size and alignment.
    let renamed = unsafe {
        let header = base.cast::<Header>();
        (&raw mut (*header).flags).write(0);
        (&raw mut (*header).root_directory).write(directory.as_raw_handle());
        (&raw mut (*header).file_name_length).write((name.len() * size_of::<u16>()) as u32);
        base.add(FILE_NAME_OFFSET)
            .cast::<u16>()
            .copy_from_nonoverlapping(name.as_ptr(), name.len());
        set_file_information_by_handle(file.as_raw_handle(), 3, base.cast(), buffer_bytes as u32)
    };
    let error = std::io::Error::last_os_error();
    drop(file);
    drop(directory);
    let _ = std::fs::remove_dir_all(&root);

    assert_eq!(renamed, 0, "a root-directory-relative rename now succeeds");
    assert_eq!(
        error.raw_os_error(),
        Some(87),
        "expected ERROR_INVALID_PARAMETER from the Win32 entry point"
    );
}

#[cfg(test)]
mod tests {
    use super::single_component;
    use std::ffi::OsStr;

    /// The last lock stopping a final name from steering a finalization out of
    /// the admitted destination root.
    #[test]
    fn only_one_plain_name_may_become_a_final_target() {
        single_component(OsStr::new("sample.mzML")).expect("a plain name is a final target");
        for refused in [
            "",
            ".",
            "..",
            "sub/sample.mzML",
            "../sample.mzML",
            #[cfg(windows)]
            r"sub\sample.mzML",
            #[cfg(windows)]
            r"..\sample.mzML",
            #[cfg(windows)]
            r"C:\sample.mzML",
            "/sample.mzML",
        ] {
            let error = single_component(OsStr::new(refused))
                .expect_err(&format!("{refused:?} must not become a final target"));
            assert_eq!(
                error.kind(),
                std::io::ErrorKind::InvalidInput,
                "{refused:?}"
            );
        }
    }
}
