//! Typed conversion output inspection and source/output integrity comparison.
//!
//! Process exit status, preview interpretation and conversion integrity are
//! three separate judgements. This module owns the third one and never consults
//! the first two: an exit code of zero is not evidence that a conversion
//! produced a usable, semantically equivalent mzML document.
//!
//! The comparison is deliberately conservative about what it claims. It does
//! not assert byte-for-byte equivalence, general losslessness or vendor
//! fidelity, and it never fails a conversion merely because the output uses a
//! different but legal mzML serialization.

use std::ffi::{OsStr, OsString};
use std::io;
use std::path::Path;

use thiserror::Error;

use crate::capability::Sha256Digest;
use crate::command::OpenFormat;
use crate::fs_guard::{
    self, OutputDirectoryEntry, OutputDirectorySnapshot, OutputEntryKind, RegularFileError,
};
use crate::mzml::{self, MzmlFacts, MzmlScanError, MzmlScanLimits};

/// The compression the typed conversion plan requested. This is MSCanvas policy,
/// not a scientific property of the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CompressionPolicy {
    /// Every binary array in the output must carry a zlib compression marker.
    #[default]
    Zlib,
}

impl CompressionPolicy {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Zlib => "zlib",
        }
    }
}

/// The typed conversion intent an integrity check is allowed to assume.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ConversionPolicy {
    compression: CompressionPolicy,
}

impl ConversionPolicy {
    #[must_use]
    pub const fn new(compression: CompressionPolicy) -> Self {
        Self { compression }
    }

    #[must_use]
    pub const fn compression(self) -> CompressionPolicy {
        self.compression
    }
}

/// Typed facts about a conversion output, established without consulting the
/// backend's exit status.
#[derive(Debug, Clone, PartialEq)]
pub struct ConversionOutputInspection {
    byte_length: u64,
    sha256: Sha256Digest,
    facts: MzmlFacts,
}

impl ConversionOutputInspection {
    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    #[must_use]
    pub const fn sha256(&self) -> Sha256Digest {
        self.sha256
    }

    #[must_use]
    pub const fn facts(&self) -> &MzmlFacts {
        &self.facts
    }
}

/// Why an output directory does not hold one usable conversion output. No
/// variant contains a path or backend text.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ConversionOutputRejection {
    #[error("the conversion produced no output")]
    Missing,
    #[error("the conversion output is empty")]
    Empty,
    #[error("the conversion output is not a regular file")]
    NonRegularOutput,
    #[error("the conversion produced an unexpected output set")]
    UnexpectedExtraOutput { observed: usize },
    #[error("the conversion output does not carry the planned name")]
    UnexpectedOutputName,
    #[error("the conversion output does not carry the planned extension")]
    ExtensionMismatch,
    #[error("the conversion left partial output behind")]
    PartialOutput,
    #[error("the conversion output could not be inspected as mzML")]
    Scan(MzmlScanError),
    #[error("the conversion output could not be hashed")]
    NotHashed,
    #[error("the output directory could not be inspected: {kind}")]
    DirectoryInspectionFailed { kind: io::ErrorKind },
}

impl ConversionOutputRejection {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Missing => "missing_output",
            Self::Empty => "zero_byte_output",
            Self::NonRegularOutput => "non_regular_output",
            Self::UnexpectedExtraOutput { .. } => "unexpected_output",
            Self::UnexpectedOutputName => "unexpected_output_name",
            Self::ExtensionMismatch => "output_extension_mismatch",
            Self::PartialOutput => "partial_output",
            Self::Scan(_) => "malformed_output",
            Self::NotHashed => "output_not_hashed",
            Self::DirectoryInspectionFailed { .. } => "output_directory_inspection_failed",
        }
    }
}

impl From<RegularFileError> for ConversionOutputRejection {
    fn from(error: RegularFileError) -> Self {
        match error {
            RegularFileError::NotRegularFile
            | RegularFileError::Symlink
            | RegularFileError::ReparsePoint
            | RegularFileError::ChangedDuringOpen => Self::NonRegularOutput,
            RegularFileError::Io { kind } => Self::DirectoryInspectionFailed { kind },
        }
    }
}

/// Derives the planned conversion output file name from a source path.
///
/// The stem is preserved so a converted file stays recognizable next to its
/// acquisition; the extension always comes from the requested format.
#[must_use]
pub fn conversion_output_file_name(input: &Path, format: OpenFormat) -> Option<OsString> {
    let stem = input.file_stem().filter(|stem| !stem.is_empty())?;
    let mut name = stem.to_os_string();
    name.push(".");
    name.push(format.extension());
    Some(name)
}

/// Inspects the output directory of a completed conversion.
///
/// This establishes the filesystem postconditions and the typed mzML facts of
/// the output alone. It performs no source comparison and reads no process
/// state.
pub fn inspect_conversion_output(
    output_directory: &Path,
    expected_file_name: &OsStr,
    format: OpenFormat,
    limits: MzmlScanLimits,
) -> Result<ConversionOutputInspection, ConversionOutputRejection> {
    let snapshot = fs_guard::snapshot_output_directory(output_directory)?;
    let entry = require_single_planned_entry(&snapshot, expected_file_name, format)?;

    let path = output_directory.join(expected_file_name);
    inspect_planned_output_file(&path, entry.byte_length(), limits)
}

fn require_single_planned_entry<'a>(
    snapshot: &'a OutputDirectorySnapshot,
    expected_file_name: &OsStr,
    format: OpenFormat,
) -> Result<&'a OutputDirectoryEntry, ConversionOutputRejection> {
    if snapshot.is_empty() {
        return Err(ConversionOutputRejection::Missing);
    }
    // Partial output is reported before an entry count so an interrupted write
    // is never described as a merely unexpected output set.
    if snapshot.contains_partial_output() {
        return Err(ConversionOutputRejection::PartialOutput);
    }
    let [entry] = snapshot.entries() else {
        return Err(ConversionOutputRejection::UnexpectedExtraOutput {
            observed: snapshot.len(),
        });
    };
    if !entry.has_name(expected_file_name) {
        return Err(ConversionOutputRejection::UnexpectedOutputName);
    }
    if !entry.has_extension(format.extension()) {
        return Err(ConversionOutputRejection::ExtensionMismatch);
    }
    if entry.kind() != OutputEntryKind::RegularFile {
        return Err(ConversionOutputRejection::NonRegularOutput);
    }
    if entry.byte_length() == 0 {
        return Err(ConversionOutputRejection::Empty);
    }
    Ok(entry)
}

fn inspect_planned_output_file(
    path: &Path,
    observed_byte_length: u64,
    limits: MzmlScanLimits,
) -> Result<ConversionOutputInspection, ConversionOutputRejection> {
    // The structural scan runs first so an unusable output reports its precise
    // structural reason rather than a hashing failure that merely happened to
    // occur on the way there.
    let facts = mzml::inspect_file(path, limits).map_err(ConversionOutputRejection::Scan)?;
    let sha256 =
        Sha256Digest::calculate_file(path).map_err(|_| ConversionOutputRejection::NotHashed)?;
    Ok(ConversionOutputInspection {
        byte_length: observed_byte_length,
        sha256,
        facts,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::mzml::MzmlRoot;

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    const VALID_OUTPUT: &str = concat!(
        r#"<indexedmzML><mzML><run><spectrumList count="1">"#,
        r#"<spectrum index="0" id="scan=1" defaultArrayLength="2">"#,
        r#"<cvParam accession="MS:1000511" name="ms level" value="1"/>"#,
        r#"<binaryDataArrayList count="1"><binaryDataArray encodedLength="8">"#,
        r#"<cvParam accession="MS:1000514" name="m/z array"/>"#,
        r#"<cvParam accession="MS:1000574" name="zlib compression"/>"#,
        r#"<binary>AA==</binary>"#,
        r#"</binaryDataArray></binaryDataArrayList></spectrum>"#,
        r#"</spectrumList></run></mzML></indexedmzML>"#,
    );

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock after Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "mscanvas-conversion-tests-{}-{timestamp}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create conversion test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn inspect(directory: &Path) -> Result<ConversionOutputInspection, ConversionOutputRejection> {
        inspect_conversion_output(
            directory,
            OsStr::new("sample.mzML"),
            OpenFormat::MzMl,
            MzmlScanLimits::default(),
        )
    }

    #[test]
    fn conversion_output_file_name_preserves_the_stem_and_forces_the_format_extension() {
        assert_eq!(
            conversion_output_file_name(Path::new("/data/样本 01.raw"), OpenFormat::MzMl),
            Some(OsString::from("样本 01.mzML"))
        );
        assert_eq!(
            conversion_output_file_name(Path::new("/data/sample.mzML"), OpenFormat::MzXml),
            Some(OsString::from("sample.mzXML"))
        );
        // A trailing separator still names the directory, so it keeps a stem.
        assert_eq!(
            conversion_output_file_name(Path::new("/data/"), OpenFormat::MzMl),
            Some(OsString::from("data.mzML"))
        );
        // A path with no final component has nothing to preserve.
        assert_eq!(
            conversion_output_file_name(Path::new("/"), OpenFormat::MzMl),
            None
        );
        assert_eq!(
            conversion_output_file_name(Path::new(".."), OpenFormat::MzMl),
            None
        );
    }

    #[test]
    fn missing_partial_extra_and_nonregular_outputs_are_distinct_outcomes() {
        let directory = TestDirectory::new();
        assert_eq!(
            inspect(directory.path()),
            Err(ConversionOutputRejection::Missing)
        );

        let partial = TestDirectory::new();
        fs::write(partial.path().join("sample.mzML.partial"), b"incomplete")
            .expect("write partial output");
        assert_eq!(
            inspect(partial.path()),
            Err(ConversionOutputRejection::PartialOutput)
        );

        let extra = TestDirectory::new();
        fs::write(extra.path().join("sample.mzML"), VALID_OUTPUT).expect("write planned output");
        fs::write(extra.path().join("other.mzML"), VALID_OUTPUT).expect("write extra output");
        assert_eq!(
            inspect(extra.path()),
            Err(ConversionOutputRejection::UnexpectedExtraOutput { observed: 2 })
        );

        let non_regular = TestDirectory::new();
        fs::create_dir(non_regular.path().join("sample.mzML")).expect("create directory output");
        assert_eq!(
            inspect(non_regular.path()),
            Err(ConversionOutputRejection::NonRegularOutput)
        );

        let empty = TestDirectory::new();
        fs::write(empty.path().join("sample.mzML"), b"").expect("write empty output");
        assert_eq!(inspect(empty.path()), Err(ConversionOutputRejection::Empty));
    }

    #[test]
    fn the_output_must_carry_the_planned_name_and_extension() {
        let renamed = TestDirectory::new();
        fs::write(renamed.path().join("unplanned.mzML"), VALID_OUTPUT).expect("write output");
        assert_eq!(
            inspect(renamed.path()),
            Err(ConversionOutputRejection::UnexpectedOutputName)
        );

        let wrong_extension = TestDirectory::new();
        fs::write(wrong_extension.path().join("sample.mzXML"), VALID_OUTPUT).expect("write output");
        assert_eq!(
            inspect_conversion_output(
                wrong_extension.path(),
                OsStr::new("sample.mzXML"),
                OpenFormat::MzMl,
                MzmlScanLimits::default(),
            ),
            Err(ConversionOutputRejection::ExtensionMismatch)
        );
    }

    #[test]
    fn a_structurally_unusable_output_reports_its_scan_reason_before_any_hash() {
        let malformed = TestDirectory::new();
        fs::write(malformed.path().join("sample.mzML"), b"<mzML><run>")
            .expect("write malformed output");
        assert!(matches!(
            inspect(malformed.path()),
            Err(ConversionOutputRejection::Scan(_))
        ));

        let unsafe_output = TestDirectory::new();
        fs::write(
            unsafe_output.path().join("sample.mzML"),
            br#"<!DOCTYPE mzML><mzML><run/></mzML>"#,
        )
        .expect("write unsafe output");
        assert_eq!(
            inspect(unsafe_output.path()),
            Err(ConversionOutputRejection::Scan(MzmlScanError::Unsafe(
                crate::mzml::UnsafeXmlKind::DoctypeDeclaration
            )))
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_planned_output_reports_bytes_hash_and_typed_facts() {
        let directory = TestDirectory::new();
        fs::write(directory.path().join("sample.mzML"), VALID_OUTPUT).expect("write output");

        let inspection = inspect(directory.path()).expect("the planned output inspects cleanly");

        assert_eq!(inspection.byte_length(), VALID_OUTPUT.len() as u64);
        assert_eq!(
            inspection.sha256(),
            Sha256Digest::calculate(VALID_OUTPUT.as_bytes()).expect("hash the fixture")
        );
        assert_eq!(inspection.facts().root(), MzmlRoot::IndexedMzml);
        assert_eq!(inspection.facts().observed_spectrum_count(), 1);
    }

    #[test]
    fn output_rejections_expose_distinct_stable_ids_and_path_free_debug_output() {
        let ids = [
            ConversionOutputRejection::Missing.stable_id(),
            ConversionOutputRejection::Empty.stable_id(),
            ConversionOutputRejection::NonRegularOutput.stable_id(),
            ConversionOutputRejection::UnexpectedExtraOutput { observed: 2 }.stable_id(),
            ConversionOutputRejection::UnexpectedOutputName.stable_id(),
            ConversionOutputRejection::ExtensionMismatch.stable_id(),
            ConversionOutputRejection::PartialOutput.stable_id(),
            ConversionOutputRejection::Scan(MzmlScanError::Io {
                kind: io::ErrorKind::NotFound,
            })
            .stable_id(),
            ConversionOutputRejection::NotHashed.stable_id(),
            ConversionOutputRejection::DirectoryInspectionFailed {
                kind: io::ErrorKind::PermissionDenied,
            }
            .stable_id(),
        ];
        assert_eq!(
            ids.iter().collect::<std::collections::BTreeSet<_>>().len(),
            ids.len()
        );

        let directory = TestDirectory::new();
        fs::write(directory.path().join("sample.mzML.tmp"), b"incomplete").expect("write partial");
        let snapshot =
            fs_guard::snapshot_output_directory(directory.path()).expect("snapshot the directory");
        let rendered = format!("{snapshot:?}");
        assert!(rendered.contains("<opaque-sensitive>"));
        assert!(!rendered.contains("sample"));
    }

    #[test]
    fn a_missing_output_directory_reports_a_bounded_io_kind() {
        let directory = TestDirectory::new();
        let missing = directory.path().join("absent");

        assert_eq!(
            inspect(&missing),
            Err(ConversionOutputRejection::DirectoryInspectionFailed {
                kind: io::ErrorKind::NotFound
            })
        );
    }
}
