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

/// Admits one chosen folder as a destination root, or says why not.
///
/// Every refusal is decided before the conversion boundary is entered, so a
/// rejected destination costs no plan, no staging directory and no process.
pub(super) fn admit_destination_root(chosen: &Path) -> Result<PathBuf, PreviewErrorDto> {
    // The chosen object itself, before its name is resolved. `canonicalize`
    // follows links, so inspecting the result would inspect a link's *target*
    // and accept the link -- which is exactly what this refuses. A junction to
    // a perfectly ordinary local folder is still a destination whose contents
    // are decided somewhere this boundary has not looked.
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

    // The name is resolved twice, and the two answers must agree. Between the
    // inspection above and this resolution another process can rename the
    // directory away and leave a junction behind, and canonicalization would
    // then follow it to an ordinary folder that never passed admission --
    // giving a verdict about one object and a path naming another.
    //
    // Re-resolving detects exactly that: a canonical path is already fully
    // resolved, so canonicalizing it again answers with itself unless the name
    // now means something else. This is the same technique the conversion
    // boundary's own identity capture uses, and the plan formed from this root
    // additionally binds it by filesystem identity and rechecks it before
    // anything is created -- so a swap after this point is refused there.
    if std::fs::canonicalize(&canonical).map_err(|_| destination_unusable())? != canonical {
        return Err(destination_unusable());
    }
    if !is_local_volume(&canonical)? {
        return Err(destination_is_remote());
    }
    Ok(canonical)
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
        let admitted = admit_destination_root(&root).expect("a local temporary folder is usable");

        assert!(admitted.is_absolute());
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
