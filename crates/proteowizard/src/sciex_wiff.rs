//! Recognising a SCIEX WIFF acquisition, which is not one file.
//!
//! Every source family this boundary admitted before this one is a single
//! object: recognise the file, bind the file, convert the file. A SCIEX
//! acquisition is a `<name>.wiff` **and** a `<name>.wiff.scan` beside it, and
//! the second one is not an accessory. Measured on the evidenced build: remove
//! the companion and `msconvert` exits 1 with *"Could not open data stream. Is
//! a required 'scan' file missing?"* — after writing one truncated document per
//! sample into the output directory. Ten documents, roughly a seventh the size
//! of the real ones, each of them well-formed enough to open.
//!
//! That is the whole reason this module exists. A boundary that recognised,
//! bound and pinned only the `.wiff` would be pinning a fraction of what the
//! backend reads, and the unbound part is the part that carries the spectra.
//!
//! ## What names the family
//!
//! Not the extension. Upstream's own `Reader_ABI::identify` is
//! `iends_with(".wiff") || iends_with(".wiff2")` with a `// TODO: check header
//! signature?` above it — the name is all it consults, so anything named right
//! is handed to the vendor library.
//!
//! Not the magic either. A `.wiff` is a Microsoft compound file, so its first
//! eight bytes are the eight bytes a Shimadzu `.lcd` begins with; that is
//! already why [`crate::compound_file`] exists. What names the family is the
//! set of entries inside the container, exactly as it is for LabSolutions, and
//! [`SCIEX_WIFF_DIRECTORY_ENTRIES`] is that set.
//!
//! And the companion is recognised too, by its own leading bytes rather than by
//! having the right name. It is not a compound file — measured, all three
//! fixtures — so the container reader cannot speak for it, and a rule that
//! accepted whatever sat at `<name>.wiff.scan` would bind an object it never
//! looked at.

use std::ffi::OsString;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// The extension the installed SCIEX reader requires, and exactly it.
///
/// `.wiff2` is a different container — measured: its first bytes are neither
/// the compound-file magic nor anything resembling it — read by a different
/// vendor assembly, with its own companion layout. Sharing a prefix with
/// `.wiff` is not sharing a format, and this boundary has no `.wiff2`
/// acquisition, no measurement and therefore no admission for it.
pub(crate) const SCIEX_WIFF_EXTENSION: &str = "wiff";

/// What the companion's name is: the primary's **whole file name** with this
/// appended, in the same directory.
///
/// Not the stem plus `.scan`. `Reader_ABI` builds the name as `wiffpath +
/// ".scan"`, so the companion of `a.wiff` is `a.wiff.scan` and never `a.scan`.
pub(crate) const SCAN_COMPANION_SUFFIX: &str = ".scan";

/// The entries a SCIEX acquisition carries in the first sector of its
/// compound-file directory.
///
/// Measured on all three lawful fixtures in ProteoWizard's own test data —
/// `Enolase_repeats_AQv1.4.2.wiff` (ten samples), `PressureTrace1.wiff` and
/// `201208-378803.wiff` (one each) — and absent from both LabSolutions
/// fixtures, whose markers are in turn absent from all three of these. The two
/// families are stored in the same container and share not one entry name that
/// either is recognised by, so this rule and the LabSolutions rule cannot both
/// admit one object.
///
/// Four names, all required, chosen from the twenty-two the three fixtures
/// share: the two that say the container holds samples and an acquisition
/// method, the sample table itself, and the mass-spectrometer method. Names
/// that appear in only some of the three — `Period0`, `DataDependant`,
/// `CTCPALAsMethod` — describe how one acquisition was run and are deliberately
/// not required.
///
/// Three fixtures is a small sample, and the direction to be wrong in is
/// refusing an acquisition rather than admitting a document that is not one.
pub(crate) const SCIEX_WIFF_DIRECTORY_ENTRIES: [&str; 4] = [
    "SampleSubtree",
    "MethodSubtree",
    "SampleTable",
    "MassSpecMethod",
];

/// The bytes every measured `.wiff.scan` begins with.
///
/// Identical across all three fixtures, whose acquisitions differ in
/// instrument, sample count, year and size: `0x00000582`, twelve zero bytes,
/// `0x11111111`, `0x00000582` again, then `0x00000001`. The three diverge at
/// offset 44, so this stops at 32 — the longest prefix that is both common and
/// clearly structural rather than incidentally zero.
///
/// This is a recognition, not a parse. Nothing here claims to know what the
/// fields mean, and nothing reads past them. What it establishes is that the
/// object about to be bound as this acquisition's companion is the kind of
/// object the reader will find there, rather than whatever happened to be
/// sitting under that name.
pub(crate) const SCAN_COMPANION_SIGNATURE: [u8; 32] = [
    0x82, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x11, 0x11, 0x11, 0x11, 0x82, 0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
];

/// The name the companion of this primary must have, in the primary's own
/// directory.
///
/// Derived from the primary's name rather than searched for. A directory scan
/// looking for "the scan file" would find one belonging to a different
/// acquisition — upstream's test data has a `swath.api.wiff.scan` whose primary
/// is `swath.api.wiff2`, sitting in the same directory as two `.wiff` files —
/// and would bind it.
///
/// `None` where the path has no file name or no parent, which is not a
/// companion this boundary could name.
pub(crate) fn companion_path(primary: &Path) -> Option<PathBuf> {
    let file_name = primary.file_name()?;
    let parent = primary.parent()?;
    let mut companion = OsString::with_capacity(file_name.len() + SCAN_COMPANION_SUFFIX.len());
    companion.push(file_name);
    companion.push(SCAN_COMPANION_SUFFIX);
    Some(parent.join(companion))
}

/// Whether an open object begins with the companion's signature.
///
/// Takes the handle, like every other recognition in this crate, so what is
/// examined is the object the caller pinned rather than the name that reached
/// it. Leaves the read position after the signature; a caller that hashes next
/// rewinds first.
///
/// # Errors
///
/// An object shorter than the signature cannot be carrying it, which is a
/// mismatch (`Ok(false)`) rather than an inspection failure.
pub(crate) fn companion_signature_matches(file: &mut File) -> io::Result<bool> {
    let mut head = [0_u8; SCAN_COMPANION_SIGNATURE.len()];
    match file.read_exact(&mut head) {
        Ok(()) => Ok(head == SCAN_COMPANION_SIGNATURE),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_companion_name_is_the_whole_primary_name_plus_scan() {
        let companion = companion_path(Path::new(r"C:\data\Enolase_repeats.wiff"))
            .expect("a named file in a directory has a companion name");
        assert_eq!(
            companion.file_name(),
            Some(OsString::from("Enolase_repeats.wiff.scan").as_os_str()),
        );
        assert_eq!(companion.parent(), Some(Path::new(r"C:\data")));
    }

    #[test]
    fn the_companion_is_never_the_stem_plus_scan() {
        // `a.scan` is a name nothing writes and the reader never opens.
        // Deriving it would look for a file that does not exist and refuse
        // every real acquisition; the point of the check is that this is not
        // an off-by-one anybody can make silently.
        let companion =
            companion_path(Path::new("a.wiff")).expect("a relative name still has a parent");
        assert_ne!(
            companion.file_name(),
            Some(OsString::from("a.scan").as_os_str())
        );
    }

    #[test]
    fn the_two_compound_file_families_share_no_marker() {
        // The whole reason both rules can live in one boundary. Measured on
        // five fixtures; asserted here so a later edit to either list cannot
        // quietly make one family recognisable as the other.
        for shimadzu in ["Method File Property", "GUMM_Information", "LSS Raw Data"] {
            assert!(
                !SCIEX_WIFF_DIRECTORY_ENTRIES.contains(&shimadzu),
                "a LabSolutions marker must not be required of a SCIEX acquisition",
            );
        }
    }
}
