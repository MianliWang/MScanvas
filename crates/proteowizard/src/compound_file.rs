//! Reading just enough of a Microsoft compound file to tell one vendor family
//! from another.
//!
//! Several acquisition families are stored in the container Microsoft calls a
//! compound file, or OLE2 structured storage: a whole small filesystem of named
//! storages and streams inside one regular file. Two of them matter here.
//! Shimadzu LabSolutions `.lcd` and SCIEX `.wiff` both begin with the identical
//! eight-byte magic, so the fixed-offset signature that recognises a Thermo RAW
//! cannot tell them apart — measured, on real fixtures of both.
//!
//! That is why this exists. The magic says "this is a compound file", which is
//! stronger than a suffix and is not a family; the *names of the entries inside
//! it* are what say which family, and they are the only thing that does. So
//! recognition needs to look one level in, and this reads exactly that far and
//! stops.
//!
//! It is not a compound-file library and must not become one. It reads the
//! header and one directory sector, and it answers one question: which entry
//! names are in there. Nothing here opens a stream, follows the FAT, walks the
//! red-black tree the directory is ordered as, or decodes any content. A parser
//! used to decide what an acquisition *is* should be as small as the question.
//!
//! Every refusal is a refusal. A file whose geometry is not one of the two
//! documented shapes, whose directory sector does not fit, or whose entry names
//! are not valid UTF-16 is not admitted on the strength of what could be read
//! before that — the point of reading it at all is to be sure.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};

/// The eight bytes every compound file begins with.
///
/// Shared by every family stored this way, which is exactly why it cannot be
/// the recognition on its own.
pub(crate) const COMPOUND_FILE_SIGNATURE: [u8; 8] =
    [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// The header is documented as 512 bytes whatever the sector size is.
const HEADER_BYTES: usize = 512;

/// The little-endian marker at offset 28. The format defines no big-endian
/// variant in practice, and a file that does not carry this is not one this
/// reader will guess at.
const LITTLE_ENDIAN_MARKER: [u8; 2] = [0xFE, 0xFF];

/// One directory entry is 128 bytes, always.
const DIRECTORY_ENTRY_BYTES: usize = 128;

/// The name field is 64 bytes — at most 32 UTF-16 code units including the
/// terminator.
const DIRECTORY_NAME_BYTES: usize = 64;

/// The two (major version, sector shift) pairs the format defines: version 3
/// with 512-byte sectors, and version 4 with 4096-byte sectors.
///
/// A set of two pairs, not a range and not two independent fields. A range from
/// 9 to 12 also admits 10 and 11, which the format does not define — a header
/// declaring one would send this reader looking for a directory at an invented
/// 1024- or 2048-byte geometry. And a shift checked without its version accepts
/// a header that contradicts itself, which is the same kind of thing the byte
/// order marker and the entry terminator are checked for: a file saying two
/// incompatible things about itself is not one to read on.
///
/// Both LabSolutions fixtures declare version 4 with shift 12. Nothing here is
/// inferred from one field to excuse the other; a pair not in this set is
/// refused.
const DEFINED_VERSION_GEOMETRIES: [(u16, u16); 2] = [(3, 9), (4, 12)];

/// How far into the file this reader will seek to reach the directory.
///
/// A bound rather than a fact about any format: the directory sector's offset
/// comes out of the file being examined, so without one a crafted header could
/// send this reader anywhere. Four gibibytes is far past any acquisition this
/// boundary admits and far short of a seek worth worrying about.
const MAXIMUM_DIRECTORY_OFFSET: u64 = 4 * 1024 * 1024 * 1024;

/// Why a candidate could not be read as a compound file.
///
/// Path-free and content-free, like every other refusal this crate publishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompoundFileError {
    /// The object does not begin with the compound-file magic, or its header
    /// does not describe one of the two documented geometries.
    NotACompoundFile,
    /// It is a compound file and its directory could not be read: a sector
    /// offset past the end, a short read, or a name that is not UTF-16.
    DirectoryUnreadable,
    /// The object could not be read at all.
    Unreadable { kind: io::ErrorKind },
}

/// The entry names in a compound file's first directory sector.
///
/// Bounded by construction: one sector holds at most thirty-two entries, and
/// each name is at most thirty-one UTF-16 code units. There is no way to grow
/// this by pointing it at a larger file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RootDirectoryNames {
    names: Vec<String>,
}

impl RootDirectoryNames {
    /// Whether an entry of exactly this name is present.
    ///
    /// Exact, and deliberately case-sensitive. These names are structural
    /// constants a vendor's own writer emits, not user input, and matching them
    /// loosely would be inventing tolerance for a variation nothing has
    /// measured.
    pub(crate) fn contains(&self, name: &str) -> bool {
        self.names.iter().any(|present| present == name)
    }

    /// Whether every one of these entries is present.
    pub(crate) fn contains_all(&self, names: &[&str]) -> bool {
        names.iter().all(|name| self.contains(name))
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.names.len()
    }
}

/// Reads the entry names in the first directory sector of an open compound
/// file.
///
/// Takes the handle rather than a path, and that is the whole safety argument:
/// the caller has already pinned the object under its no-follow guard, so what
/// is examined here is that object and not whatever the name means by now.
///
/// This seeks, and leaves the position wherever it finished. The caller hashes
/// the same object next and rewinds first for that reason; the test below holds
/// that arrangement in place, because a caller that stopped rewinding would
/// hash a suffix and nothing else would notice.
///
/// # Errors
///
/// Refuses anything that is not a compound file of one of the two documented
/// geometries, and refuses a compound file whose first directory sector cannot
/// be read whole.
pub(crate) fn read_root_directory_names(
    file: &mut File,
) -> Result<RootDirectoryNames, CompoundFileError> {
    let header = read_at(file, 0, HEADER_BYTES)?;

    if header[..COMPOUND_FILE_SIGNATURE.len()] != COMPOUND_FILE_SIGNATURE {
        return Err(CompoundFileError::NotACompoundFile);
    }
    if header[28..30] != LITTLE_ENDIAN_MARKER {
        return Err(CompoundFileError::NotACompoundFile);
    }

    let major_version = u16::from_le_bytes([header[26], header[27]]);
    let sector_shift = u16::from_le_bytes([header[30], header[31]]);
    if !DEFINED_VERSION_GEOMETRIES.contains(&(major_version, sector_shift)) {
        return Err(CompoundFileError::NotACompoundFile);
    }
    let sector_bytes = 1_usize << sector_shift;

    // Sector *N* begins one whole sector into the file, because the header
    // occupies sector position zero — 512 bytes of it, and the rest of that
    // sector is padding when sectors are larger.
    let first_directory_sector =
        u32::from_le_bytes([header[48], header[49], header[50], header[51]]);
    let offset = (u64::from(first_directory_sector) + 1)
        .checked_mul(sector_bytes as u64)
        .ok_or(CompoundFileError::DirectoryUnreadable)?;
    if offset > MAXIMUM_DIRECTORY_OFFSET {
        return Err(CompoundFileError::DirectoryUnreadable);
    }

    let sector = read_at(file, offset, sector_bytes)?;
    let mut names = Vec::new();
    for entry in sector.chunks_exact(DIRECTORY_ENTRY_BYTES) {
        if let Some(name) = entry_name(entry)? {
            names.push(name);
        }
    }
    Ok(RootDirectoryNames { names })
}

/// One directory entry's name, or `None` where the entry holds nothing.
///
/// An unused entry is ordinary — a sector is allocated whole and filled as the
/// document grows — so it is skipped rather than refused. A *used* entry whose
/// name does not decode is refused, because this reader is about to be asked
/// whether a particular name is present and an unreadable one cannot be
/// answered for either way.
fn entry_name(entry: &[u8]) -> Result<Option<String>, CompoundFileError> {
    // 0 is an unallocated entry; 1 storage, 2 stream, 5 root. Anything else is
    // not a shape this format defines.
    let object_type = entry[66];
    if object_type == 0 {
        return Ok(None);
    }
    if !matches!(object_type, 1 | 2 | 5) {
        return Err(CompoundFileError::DirectoryUnreadable);
    }

    // The length counts bytes and includes the two-byte terminator.
    let declared = usize::from(u16::from_le_bytes([entry[64], entry[65]]));
    if !(2..=DIRECTORY_NAME_BYTES).contains(&declared) || declared % 2 != 0 {
        return Err(CompoundFileError::DirectoryUnreadable);
    }

    let units: Vec<u16> = entry[..declared]
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();

    // The last declared code unit has to be the terminator, and dropping it
    // without looking is how a name gets forged. A field holding
    // `LSS Raw DataX` whose declared length covers the `X` would otherwise
    // decode to exactly `LSS Raw Data`; do that three times and a container
    // that is not an acquisition passes recognition.
    let (terminator, name) = units
        .split_last()
        .expect("the declared length is at least 2");
    if *terminator != 0 {
        return Err(CompoundFileError::DirectoryUnreadable);
    }

    String::from_utf16(name)
        .map(Some)
        .map_err(|_| CompoundFileError::DirectoryUnreadable)
}

/// Reads exactly `length` bytes at `offset`, or refuses.
///
/// A short read is a refusal rather than a shorter answer: every caller here is
/// deciding what a file *is*, and deciding it from a fragment is how a
/// truncated or crafted object gets admitted.
fn read_at(file: &mut File, offset: u64, length: usize) -> Result<Vec<u8>, CompoundFileError> {
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| CompoundFileError::Unreadable { kind: error.kind() })?;
    let mut buffer = vec![0_u8; length];
    match file.read_exact(&mut buffer) {
        Ok(()) => Ok(buffer),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
            Err(CompoundFileError::DirectoryUnreadable)
        }
        Err(error) => Err(CompoundFileError::Unreadable { kind: error.kind() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    /// A compound file with the given entries in its first directory sector.
    ///
    /// Built rather than fetched, so every recognition test is deterministic
    /// and downloads nothing. The real fixtures are measured separately by the
    /// ignored evidence run.
    fn compound_file(entries: &[(&str, u8)], sector_shift: u16) -> Vec<u8> {
        let sector_bytes = 1_usize << sector_shift;
        let mut bytes = vec![0_u8; sector_bytes.max(HEADER_BYTES)];
        bytes[..8].copy_from_slice(&COMPOUND_FILE_SIGNATURE);
        // The major version its shift implies, because a real header carries
        // one and the reader now checks the pair. A builder that left this
        // zero would have been quietly testing a file no writer produces.
        let major_version: u16 = if sector_shift == 9 { 3 } else { 4 };
        bytes[26..28].copy_from_slice(&major_version.to_le_bytes());
        bytes[28..30].copy_from_slice(&LITTLE_ENDIAN_MARKER);
        bytes[30..32].copy_from_slice(&sector_shift.to_le_bytes());
        // Directory at sector 0, which begins one sector in.
        bytes[48..52].copy_from_slice(&0_u32.to_le_bytes());

        let mut directory = vec![0_u8; sector_bytes];
        for (index, (name, object_type)) in entries.iter().enumerate() {
            let entry = index * DIRECTORY_ENTRY_BYTES;
            let units: Vec<u16> = name.encode_utf16().collect();
            for (unit, slot) in units.iter().zip(directory[entry..].chunks_exact_mut(2)) {
                slot.copy_from_slice(&unit.to_le_bytes());
            }
            let declared = u16::try_from(units.len() * 2 + 2).expect("a short test name");
            directory[entry + 64..entry + 66].copy_from_slice(&declared.to_le_bytes());
            directory[entry + 66] = *object_type;
        }
        bytes.extend_from_slice(&directory);
        bytes
    }

    fn written(tag: &str, bytes: &[u8]) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "mscanvas-compound-{tag}-{}-{unique}",
            std::process::id()
        ));
        let mut file = File::create(&path).expect("the fixture is created");
        file.write_all(bytes).expect("the fixture is written");
        path
    }

    fn names_of(bytes: &[u8], tag: &str) -> Result<RootDirectoryNames, CompoundFileError> {
        let path = written(tag, bytes);
        let mut file = File::open(&path).expect("the fixture opens");
        let answer = read_root_directory_names(&mut file);
        drop(file);
        let _ = std::fs::remove_file(&path);
        answer
    }

    /// The ordinary reading: entry names come back, unused entries do not.
    #[test]
    fn the_first_directory_sector_yields_its_entry_names() {
        let bytes = compound_file(
            &[
                ("Root Entry", 5),
                ("Method File Property", 2),
                ("LSS SST", 1),
            ],
            12,
        );

        let names = names_of(&bytes, "read").expect("a compound file is read");

        assert_eq!(names.len(), 3, "the unused entries are not names");
        assert!(names.contains("Root Entry"));
        assert!(names.contains("Method File Property"));
        assert!(names.contains("LSS SST"));
        assert!(!names.contains("GUMM_Information"));
        assert!(names.contains_all(&["Root Entry", "LSS SST"]));
        assert!(!names.contains_all(&["Root Entry", "absent"]));
    }

    /// Both documented geometries, because the sector size decides where the
    /// directory is and getting it wrong reads padding.
    #[test]
    fn both_documented_sector_sizes_are_read() {
        for shift in [9_u16, 12] {
            let bytes = compound_file(&[("Root Entry", 5), ("Marker", 2)], shift);
            let names = names_of(&bytes, "shift").expect("both geometries are documented");
            assert!(names.contains("Marker"), "shift {shift}");
        }
    }

    /// Matching is exact. These names are structural constants, and tolerating
    /// a variation nothing has measured is inventing evidence.
    #[test]
    fn entry_names_are_matched_exactly() {
        let bytes = compound_file(&[("Root Entry", 5), ("GUMM_Information", 1)], 12);
        let names = names_of(&bytes, "exact").expect("a compound file is read");

        assert!(names.contains("GUMM_Information"));
        for near_miss in [
            "gumm_information",
            "GUMM_INFORMATION",
            "GUMM_Information ",
            " GUMM_Information",
            "GUMM_Informatio",
        ] {
            assert!(!names.contains(near_miss), "{near_miss}");
        }
    }

    /// Everything that is not a compound file, refused before any geometry is
    /// trusted.
    #[test]
    fn anything_without_the_magic_and_a_documented_geometry_is_refused() {
        // Not the magic at all.
        let mut wrong_magic = compound_file(&[("Root Entry", 5)], 12);
        wrong_magic[0] = 0xD1;
        assert_eq!(
            names_of(&wrong_magic, "magic").expect_err("the magic is the first gate"),
            CompoundFileError::NotACompoundFile
        );

        // The magic, and no little-endian marker.
        let mut wrong_order = compound_file(&[("Root Entry", 5)], 12);
        wrong_order[28] = 0xFF;
        wrong_order[29] = 0xFE;
        assert_eq!(
            names_of(&wrong_order, "order").expect_err("no big-endian variant is guessed at"),
            CompoundFileError::NotACompoundFile
        );

        // A sector size the format does not define. 10 and 11 are the ones
        // worth naming: they sit *between* the two defined shifts, so a range
        // check would wave them through and send the directory read to an
        // invented 1024- or 2048-byte geometry, where a crafted file is free to
        // have put whatever names it likes.
        for shift in [0_u16, 8, 10, 11, 13, 31] {
            let mut odd = compound_file(&[("Root Entry", 5)], 12);
            odd[30..32].copy_from_slice(&shift.to_le_bytes());
            assert_eq!(
                names_of(&odd, "geometry").expect_err("only two geometries are documented"),
                CompoundFileError::NotACompoundFile,
                "shift {shift}"
            );
        }

        // A header that contradicts itself: each field defined on its own, the
        // pair not. Version 0 is the case a synthetic fixture falls into by
        // simply not writing the field, which is how this was missed.
        for major in [0_u16, 3, 5, 0xFFFF] {
            let mut mismatched = compound_file(&[("Root Entry", 5)], 12);
            mismatched[26..28].copy_from_slice(&major.to_le_bytes());
            assert_eq!(
                names_of(&mismatched, "version").expect_err("the pair is checked, not the fields"),
                CompoundFileError::NotACompoundFile,
                "major {major} with shift 12"
            );
        }
        let mut swapped = compound_file(&[("Root Entry", 5)], 9);
        swapped[26..28].copy_from_slice(&4_u16.to_le_bytes());
        assert_eq!(
            names_of(&swapped, "swapped").expect_err("version 4 does not use 512-byte sectors"),
            CompoundFileError::NotACompoundFile
        );

        // Both defined pairs are still read, so what the refusals above reject
        // is the contradiction and not the fields.
        for (major, shift) in [(3_u16, 9_u16), (4, 12)] {
            let mut defined = compound_file(&[("Root Entry", 5), ("Marker", 2)], shift);
            defined[26..28].copy_from_slice(&major.to_le_bytes());
            let names = names_of(&defined, "defined").expect("a defined pair is read");
            assert!(names.contains("Marker"), "version {major} shift {shift}");
        }

        // Shorter than the header.
        assert_eq!(
            names_of(&[0xD0, 0xCF, 0x11, 0xE0], "short").expect_err("a prefix is not a header"),
            CompoundFileError::DirectoryUnreadable
        );
    }

    /// A compound file whose directory cannot be read whole is refused, rather
    /// than answered from the part that could.
    #[test]
    fn a_directory_that_cannot_be_read_whole_is_refused() {
        // A directory sector past the end of the file.
        let mut truncated = compound_file(&[("Root Entry", 5)], 12);
        truncated[48..52].copy_from_slice(&64_u32.to_le_bytes());
        assert_eq!(
            names_of(&truncated, "past-end").expect_err("a sector past the end is not readable"),
            CompoundFileError::DirectoryUnreadable
        );

        // A directory sector so far out that its offset is a seek nobody meant.
        let mut absurd = compound_file(&[("Root Entry", 5)], 12);
        absurd[48..52].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            names_of(&absurd, "absurd").expect_err("the offset is bounded"),
            CompoundFileError::DirectoryUnreadable
        );

        // A used entry with an impossible name length.
        for declared in [0_u16, 1, 3, 66, 400] {
            let mut bad = compound_file(&[("Root Entry", 5)], 12);
            let entry = 4096; // the directory sector begins one sector in
            bad[entry + 64..entry + 66].copy_from_slice(&declared.to_le_bytes());
            assert_eq!(
                names_of(&bad, "namelen").expect_err("a name length must be possible"),
                CompoundFileError::DirectoryUnreadable,
                "declared {declared}"
            );
        }

        // A used entry with an object type the format does not define.
        let mut odd_type = compound_file(&[("Root Entry", 5)], 12);
        odd_type[4096 + 66] = 7;
        assert_eq!(
            names_of(&odd_type, "objtype").expect_err("only three object types are defined"),
            CompoundFileError::DirectoryUnreadable
        );

        // A used entry whose name is not valid UTF-16. Terminated properly, so
        // what this refuses is the decoding and not the terminator below.
        let mut lone_surrogate = compound_file(&[("Root Entry", 5)], 12);
        lone_surrogate[4096..4096 + 2].copy_from_slice(&0xD800_u16.to_le_bytes());
        lone_surrogate[4096 + 2..4096 + 4].copy_from_slice(&0_u16.to_le_bytes());
        lone_surrogate[4096 + 64..4096 + 66].copy_from_slice(&4_u16.to_le_bytes());
        assert_eq!(
            names_of(&lone_surrogate, "utf16").expect_err("a name must decode"),
            CompoundFileError::DirectoryUnreadable
        );
    }

    /// The declared length's last code unit must be the terminator it claims to
    /// be, because discarding it unlooked-at is a way to forge a name.
    ///
    /// A field holding `Marker!` whose declared length covers the `!` would
    /// decode to exactly `Marker` if the last unit were simply dropped. Nothing
    /// downstream could tell the difference: the family recognition asks
    /// whether a name is present, and this would answer yes about a container
    /// that never held it.
    #[test]
    fn a_name_whose_declared_length_does_not_end_in_the_terminator_is_refused() {
        let mut forged = compound_file(&[("Root Entry", 5), ("Marker!", 2)], 12);
        let entry = 4096 + DIRECTORY_ENTRY_BYTES;
        // Seven characters and two bytes each, declared as though the seventh
        // were the terminator.
        forged[entry + 64..entry + 66].copy_from_slice(&14_u16.to_le_bytes());

        assert_eq!(
            names_of(&forged, "terminator").expect_err("the terminator is checked"),
            CompoundFileError::DirectoryUnreadable
        );

        // The same field, declared honestly, is read as the whole name — so
        // what the refusal above rejects is the mismatch and not the content.
        let honest = compound_file(&[("Root Entry", 5), ("Marker!", 2)], 12);
        let names = names_of(&honest, "honest").expect("an honest name is read");
        assert!(names.contains("Marker!"));
        assert!(!names.contains("Marker"));
    }

    /// This reader moves the handle, so the caller's rewind is load-bearing:
    /// the next thing that happens to the object is a digest of all of it, and
    /// hashing from here would hash a suffix.
    #[test]
    fn the_caller_must_rewind_to_hash_the_whole_object_afterwards() {
        let bytes = compound_file(&[("Root Entry", 5), ("Marker", 2)], 12);
        let path = written("rewind", &bytes);
        let mut file = File::open(&path).expect("the fixture opens");

        read_root_directory_names(&mut file).expect("a compound file is read");
        assert_ne!(
            file.stream_position().expect("the position is readable"),
            0,
            "the caller's rewind would be dead code"
        );

        file.rewind().expect("the caller rewinds before hashing");
        let mut all = Vec::new();
        file.read_to_end(&mut all).expect("the whole object reads");

        assert_eq!(all.len(), bytes.len());
        drop(file);
        let _ = std::fs::remove_file(&path);
    }
}
