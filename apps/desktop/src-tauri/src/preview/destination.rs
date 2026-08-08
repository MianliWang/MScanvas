//! Admission of the folder a converted output may land in.
//!
//! The conversion boundary's finalization and cleanup guarantees are local
//! Windows guarantees. Finalization takes the destination name atomically on one
//! volume; cleanup reclaims a staging directory by opening each entry and
//! comparing its filesystem identity. Both are statements about an object on a
//! local volume, and neither survives a redirector that can reorder, cache,
//! disconnect or answer from somewhere else mid-operation.
//!
//! So a remote root is refused here, at admission, rather than discovered later
//! by a cleanup that cannot finish. Refusing early is the difference between "we
//! will not write there" and "we wrote there and cannot tell you what state it
//! is in".

use std::path::{Path, PathBuf};

use super::dto::PreviewErrorDto;

/// The volume serial number and 128-bit file ID of one admitted folder.
///
/// Enough to say whether a name still refers to the same directory object, and
/// deliberately nothing more: it locates nothing and is never serialized.
pub(super) type DestinationIdentity = (u64, [u8; 16]);

/// The open directory admission judged, kept alive by whoever admitted it.
///
/// Holding it is what makes the admission still true afterwards: the share mode
/// welcomes other readers and writers and refuses only rename and delete, so a
/// caller that keeps it stops the one thing that could make the path mean a
/// different object without stopping anything the conversion itself needs.
#[cfg(windows)]
pub(super) type DestinationHold = std::fs::File;

/// POSIX has no equivalent: a directory can always be renamed out from under an
/// open descriptor, so there is no hold to keep. The identity comparison is the
/// guarantee there, exactly as it is for a source file.
#[cfg(not(windows))]
pub(super) type DestinationHold = ();

/// Admits one chosen folder as a destination root, or says why not.
///
/// Every refusal is decided before the conversion boundary is entered, so a
/// rejected destination costs no plan, no staging directory and no process.
pub(super) fn admit_destination_root(
    chosen: &Path,
) -> Result<(PathBuf, Option<DestinationIdentity>, DestinationHold), PreviewErrorDto> {
    // The chosen object itself, before its name is resolved. `canonicalize`
    // follows links, so inspecting the result would inspect a link's *target*
    // and accept the link -- which is exactly what this refuses. A junction to
    // a perfectly ordinary local folder is still a destination whose contents
    // are decided somewhere this boundary has not looked.
    // Held first, and for the whole of admission. Everything below judges an
    // object nothing can rename or delete in the meantime, so the name still
    // means what it meant when it was inspected.
    let held = hold_chosen_directory(chosen)?;
    let chosen_metadata = std::fs::symlink_metadata(chosen).map_err(|_| destination_unusable())?;
    if is_reparse_point(&chosen_metadata) {
        return Err(destination_is_a_link());
    }
    if !chosen_metadata.is_dir() {
        return Err(destination_not_a_folder());
    }

    // Resolved only after the object is accepted, so everything below judges
    // the same directory the run will use rather than whatever a link in the
    // middle of the path points at.
    let canonical = std::fs::canonicalize(chosen).map_err(|_| destination_unusable())?;
    let metadata = std::fs::symlink_metadata(&canonical).map_err(|_| destination_unusable())?;
    if is_reparse_point(&metadata) || !metadata.is_dir() {
        return Err(destination_is_a_link());
    }

    if !is_local_volume(&canonical)? {
        return Err(destination_is_remote());
    }
    // Read from the handle this admission is already holding, so the identity
    // describes the object that passed every check above rather than whatever
    // the name means by the time somebody asks again. A queue keeps it, and a
    // retry compares against it: a folder is not a name.
    // The hold goes back to the caller rather than being dropped here. An
    // admission that ended the moment it answered would be a statement about a
    // directory that no longer has to be the one written into.
    let identity = directory_identity(&held);
    Ok((canonical, identity, held))
}

/// The volume serial and 128-bit file id behind one open directory handle.
///
/// `None` where the platform does not name objects that way, which every caller
/// reads as a refusal rather than as agreement.
#[cfg(windows)]
fn directory_identity(held: &std::fs::File) -> Option<DestinationIdentity> {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;

    /// `FileIdInfo`, the information class that answers with the whole file ID.
    const FILE_ID_INFO_CLASS: i32 = 0x12;

    #[repr(C)]
    #[derive(Default)]
    struct FileIdInformation {
        volume_serial_number: u64,
        file_id: [u8; 16],
    }

    // The equivalent std accessors are still unstable, and the whole file ID is
    // what this needs: the 64-bit index is documented as unique only on volumes
    // that have one, and ReFS is the counter-example its successor exists for.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "GetFileInformationByHandleEx"]
        fn get_file_information_by_handle_ex(
            file: *mut c_void,
            information_class: i32,
            information: *mut c_void,
            information_size: u32,
        ) -> i32;
    }

    let mut information = FileIdInformation::default();
    // SAFETY: the handle outlives the call, and the out parameter is a fully
    // initialized value of the layout this information class writes.
    let succeeded = unsafe {
        get_file_information_by_handle_ex(
            held.as_raw_handle().cast::<c_void>(),
            FILE_ID_INFO_CLASS,
            std::ptr::from_mut(&mut information).cast::<c_void>(),
            u32::try_from(std::mem::size_of::<FileIdInformation>())
                .expect("FILE_ID_INFO fits in DWORD"),
        )
    };
    (succeeded != 0).then_some((information.volume_serial_number, information.file_id))
}

#[cfg(not(windows))]
const fn directory_identity(_held: &()) -> Option<DestinationIdentity> {
    None
}

/// Holds the chosen directory open, without following it, for the length of
/// admission.
///
/// Comparing the name twice cannot detect a swap: rename the directory away,
/// leave a junction behind, and canonicalization follows it to an ordinary
/// folder whose every check passes. Holding the object removes the window
/// instead of trying to observe it — a directory this process has open cannot
/// be renamed or deleted, so the name still means the object that was
/// inspected when the path is resolved below.
///
/// Deny-write sharing is not requested: a destination folder is one other
/// programs may legitimately be writing into, and refusing every busy folder
/// would be a stricter rule than this boundary needs. What is withheld is
/// rename and delete of the directory itself.
#[cfg(windows)]
fn hold_chosen_directory(chosen: &Path) -> Result<std::fs::File, PreviewErrorDto> {
    use std::os::windows::fs::OpenOptionsExt;

    /// Needed to open a directory at all.
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    /// Opens a link itself rather than its target, so a reparse point is
    /// refused above rather than followed here.
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    /// Readers and writers are welcome; renaming and deleting this directory
    /// out from under the admission that is judging it are not.
    const FILE_SHARE_READ_WRITE: u32 = 0x0000_0003;

    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(chosen)
        .map_err(|_| destination_unusable())
}

#[cfg(not(windows))]
fn hold_chosen_directory(_chosen: &Path) -> Result<(), PreviewErrorDto> {
    Ok(())
}

/// Whether this object carries a reparse tag of any kind.
///
/// Junctions, symbolic links, mount points and cloud placeholders alike. The
/// same rule folder discovery applies to what it walks, for the same reason: a
/// tag means the object's contents are decided somewhere this boundary has not
/// inspected.
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    mscanvas_proteowizard::is_reparse_point(metadata)
}

/// What a `\\?\` prefix expands to for a UNC path, which canonicalization
/// produces for every network name on Windows.
#[cfg(windows)]
const VERBATIM_UNC_PREFIX: &str = r"\\?\UNC\";

/// Whether the canonical root sits on a volume this computer owns.
///
/// Two questions, because Windows has two ways of being elsewhere. A UNC name
/// has no drive letter to ask about at all, and a mapped letter has one that
/// answers `DRIVE_REMOTE`. Either is a redirector between this process and the
/// bytes.
#[cfg(windows)]
fn is_local_volume(canonical: &Path) -> Result<bool, PreviewErrorDto> {
    /// The drive letter names a network share, mapped or otherwise.
    const DRIVE_REMOTE: u32 = 4;
    /// The name is not a root this computer has.
    const DRIVE_NO_ROOT_DIR: u32 = 1;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "GetDriveTypeW"]
        fn get_drive_type_w(root: *const u16) -> u32;
    }

    let text = canonical.to_string_lossy();
    // A UNC name has no volume to ask about. `canonicalize` renders one as
    // `\\?\UNC\server\share`, and a caller could also hand over `\\server\share`
    // directly, so both spellings are refused rather than only the one this
    // build happens to produce.
    if text.starts_with(VERBATIM_UNC_PREFIX) || text.starts_with(r"\\?\UNC") {
        return Ok(false);
    }
    let plain = text.strip_prefix(r"\\?\").unwrap_or(&text);
    if plain.starts_with(r"\\") {
        return Ok(false);
    }

    // `GetDriveTypeW` wants a root with a trailing separator; anything else is
    // documented as taking the process working directory into account, which
    // would make the answer about somewhere nobody named.
    let mut components = plain.chars();
    let (Some(letter), Some(':')) = (components.next(), components.next()) else {
        return Err(destination_unusable());
    };
    if !letter.is_ascii_alphabetic() {
        return Err(destination_unusable());
    }
    let root: Vec<u16> = format!("{letter}:\\")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: `root` is a live NUL-terminated UTF-16 volume root for the length
    // of the call, which is the documented argument.
    let kind = unsafe { get_drive_type_w(root.as_ptr()) };
    if kind == DRIVE_NO_ROOT_DIR {
        return Err(destination_unusable());
    }
    Ok(kind != DRIVE_REMOTE)
}

/// Every other platform reports no local volume, because none of the
/// finalization and cleanup evidence this boundary rests on was measured there.
#[cfg(not(windows))]
fn is_local_volume(_canonical: &Path) -> Result<bool, PreviewErrorDto> {
    Ok(false)
}

fn destination_unusable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "destination_unusable",
        "MSCanvas could not use that folder. Choose another one.",
        true,
    )
}

fn destination_not_a_folder() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "destination_not_a_folder",
        "That choice is not a folder. Choose a folder to save the converted file in.",
        true,
    )
}

fn destination_is_a_link() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "destination_is_a_link",
        "That folder is a link to somewhere else, which MSCanvas does not follow. Choose the \
         folder itself.",
        true,
    )
}

fn destination_is_remote() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "destination_is_remote",
        "MSCanvas saves converted files to this computer's own drives. A network or mapped \
         location cannot be finished and cleaned up safely. Choose a local folder.",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::{admit_destination_root, is_local_volume};
    use std::path::{Path, PathBuf};

    /// A folder on this computer is a destination; the drive-type answer is
    /// what decides, not the shape of the string.
    #[cfg(windows)]
    #[test]
    fn a_local_folder_is_admitted_and_reported_canonically() {
        let root = std::env::temp_dir();
        let (admitted, identity, _held) =
            admit_destination_root(&root).expect("a local temporary folder is usable");

        assert!(admitted.is_absolute());
        assert!(
            identity.is_some(),
            "a Windows directory answers with a volume and a file id"
        );
        assert!(
            is_local_volume(&admitted).expect("a local folder has a volume"),
            "the temporary folder of a Windows test run is on a local volume"
        );
    }

    /// A network name is refused whichever way it is spelled, and before
    /// anything is created.
    #[cfg(windows)]
    #[test]
    fn a_network_name_is_never_a_destination() {
        for unc in [
            PathBuf::from(r"\\server\share\outputs"),
            PathBuf::from(r"\\?\UNC\server\share\outputs"),
        ] {
            assert!(
                !is_local_volume(&unc).expect("a UNC name is answerable without a volume query"),
                "{unc:?}"
            );
        }
    }

    /// A file is not a folder, and a name with nothing behind it is neither.
    #[test]
    fn only_an_existing_folder_is_admitted() {
        let file = std::env::temp_dir().join(format!(
            "mscanvas-destination-tests-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock after Unix epoch")
                .as_nanos()
        ));
        std::fs::write(&file, b"not a folder").expect("write the fixture");

        let as_file = admit_destination_root(&file).expect_err("a file is not a destination");
        assert_eq!(as_file.kind, "destination_not_a_folder");

        std::fs::remove_file(&file).expect("remove the fixture");
        let absent = admit_destination_root(&file).expect_err("a name with nothing behind it");
        assert_eq!(absent.kind, "destination_unusable");
    }

    /// A refusal says what was wrong and never where.
    #[test]
    fn a_refused_destination_never_carries_what_it_refused() {
        let secret = Path::new(r"D:\private\outputs\secret");
        let error = admit_destination_root(secret).expect_err("an absent folder is refused");
        let rendered = serde_json::to_string(&error).expect("the error serializes");

        assert!(!rendered.contains("private"), "{rendered}");
        assert!(!rendered.contains("secret"), "{rendered}");
        assert!(!rendered.contains("\\\\"), "{rendered}");
    }
}
