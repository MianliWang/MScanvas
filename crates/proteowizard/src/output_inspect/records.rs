//! The minimal checks of the record formats and the HDF5 formats.
//!
//! The record markers and headers are the evidenced build's writers, read from
//! its source, not measured: `Serializer_MGF.cpp`, `Serializer_MSn.cpp` and
//! `TextWriter.hpp` (written by `MSDataFile.cpp` as `TextWriter(os, 0, -1)`).

use std::io::{BufRead, Read};

use super::{FinalOutputVerdict, NonMzmlFormat, OutputCheckRefusal, limit};
use crate::mzml::{MzmlLimitKind, MzmlScanError, MzmlScanLimits};

const HDF5_SIGNATURE: [u8; 8] = *b"\x89HDF\r\n\x1a\n";

/// `MSn_Type` file type, version, then a `char[16][128]` header.
const CMS_HEADER_BYTES: u64 = 4 + 4 + 16 * 128;
const CMS_VERSION: i32 = 3;

/// Bytes of each line kept for matching. Every marker is shorter, so a longer
/// line is never buffered: the text format writes each array on one line.
const LINE_PREFIX_BYTES: usize = 32;

/// mz5 and mzMLb: the HDF5 signature at offset 0. Neither writer sets a user
/// block (`Connection_mz5.cpp`, `Connection_mzMLb.cpp` create with defaults),
/// so the superblock cannot sit further in.
pub(super) fn check_hdf5<R: Read>(reader: R) -> Result<FinalOutputVerdict, OutputCheckRefusal> {
    if leading::<8, _>(reader)? != Some(HDF5_SIGNATURE) {
        return Err(OutputCheckRefusal::SignatureMismatch);
    }
    Ok(FinalOutputVerdict::SignatureOnly)
}

pub(super) fn check<R: BufRead>(
    reader: R,
    length: u64,
    format: NonMzmlFormat,
    limits: &MzmlScanLimits,
) -> Result<FinalOutputVerdict, OutputCheckRefusal> {
    let present = match format {
        NonMzmlFormat::Cms1 => cms(reader, length, 2)?,
        NonMzmlFormat::Cms2 => cms(reader, length, 4)?,
        NonMzmlFormat::Mgf => first_record(reader, limits, None, |line| line == b"BEGIN IONS")?,
        NonMzmlFormat::Ms1 | NonMzmlFormat::Ms2 => {
            first_record(reader, limits, Some(b"H\t"), |line| {
                line.starts_with(b"S\t")
            })?
        }
        NonMzmlFormat::Text => first_record(reader, limits, Some(b"msdata:"), |line| {
            let trimmed = line.trim_ascii_start();
            trimmed == b"spectrum:" || trimmed == b"chromatogram:"
        })?,
        NonMzmlFormat::MzXml(_) | NonMzmlFormat::Mz5 | NonMzmlFormat::MzMlb => {
            unreachable!("dispatched elsewhere")
        }
    };
    if !present {
        return Err(OutputCheckRefusal::OutputContainsNoRecords);
    }
    Ok(FinalOutputVerdict::RecordsPresent)
}

/// cms1 and cms2: the little-endian file type and version, then a record
/// present exactly when anything follows the header, since the writer writes
/// nothing after it but records.
fn cms<R: Read>(reader: R, length: u64, file_type: i32) -> Result<bool, OutputCheckRefusal> {
    let Some(leading) = leading::<8, _>(reader)? else {
        return Err(OutputCheckRefusal::SignatureMismatch);
    };
    let field = |at: usize| {
        i32::from_le_bytes([
            leading[at],
            leading[at + 1],
            leading[at + 2],
            leading[at + 3],
        ])
    };
    if field(0) != file_type || field(4) != CMS_VERSION || length < CMS_HEADER_BYTES {
        return Err(OutputCheckRefusal::SignatureMismatch);
    }
    Ok(length > CMS_HEADER_BYTES)
}

/// The first `N` bytes, or `None` where the file is shorter.
fn leading<const N: usize, R: Read>(mut reader: R) -> Result<Option<[u8; N]>, OutputCheckRefusal> {
    let mut bytes = [0_u8; N];
    match reader.read_exact(&mut bytes) {
        Ok(()) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => Ok(None),
        Err(error) => Err(MzmlScanError::Io { kind: error.kind() }.into()),
    }
}

/// Streams lines until one is a record, checking the first line against
/// `signature` where the format has one. Stops at the first record, so a
/// conforming file is read only up to it.
fn first_record<R: BufRead>(
    mut reader: R,
    limits: &MzmlScanLimits,
    signature: Option<&[u8]>,
    is_record: impl Fn(&[u8]) -> bool,
) -> Result<bool, OutputCheckRefusal> {
    let mut line: Vec<u8> = Vec::with_capacity(LINE_PREFIX_BYTES);
    let mut truncated = false;
    let mut first = true;
    let mut consumed = 0_u64;
    // Judges one finished line: `Some(found)` ends the scan.
    let mut finish = |line: &mut Vec<u8>, truncated: &mut bool| {
        let mut content = line.as_slice();
        if !*truncated && content.last() == Some(&b'\r') {
            content = &content[..content.len() - 1];
        }
        let verdict = if std::mem::replace(&mut first, false)
            && signature.is_some_and(|signature| !content.starts_with(signature))
        {
            Some(Err(OutputCheckRefusal::SignatureMismatch))
        } else if is_record(content) {
            Some(Ok(true))
        } else {
            None
        };
        line.clear();
        *truncated = false;
        verdict
    };
    loop {
        let chunk = reader
            .fill_buf()
            .map_err(|error| MzmlScanError::Io { kind: error.kind() })?;
        if chunk.is_empty() {
            // A last line without a newline is judged like any other.
            if !line.is_empty()
                && let Some(verdict) = finish(&mut line, &mut truncated)
            {
                return verdict;
            }
            return Ok(false);
        }
        // Never look past the limit, even inside a chunk that holds a record.
        let allowed = limits
            .max_document_bytes
            .saturating_sub(consumed)
            .saturating_add(1);
        let chunk = &chunk[..chunk
            .len()
            .min(usize::try_from(allowed).unwrap_or(usize::MAX))];
        let mut taken = 0;
        let mut verdict = None;
        for &byte in chunk {
            taken += 1;
            if byte == b'\n' {
                verdict = finish(&mut line, &mut truncated);
                if verdict.is_some() {
                    break;
                }
            } else if line.len() < LINE_PREFIX_BYTES {
                line.push(byte);
            } else {
                truncated = true;
            }
        }
        reader.consume(taken);
        consumed = consumed.saturating_add(taken as u64);
        if let Some(verdict) = verdict {
            return verdict;
        }
        if consumed > limits.max_document_bytes {
            return Err(limit(MzmlLimitKind::DocumentBytes));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::inspect_opened;
    use super::super::tests::{INTERMEDIATE, mzml_facts};
    use super::*;

    fn inspect(
        bytes: &[u8],
        format: NonMzmlFormat,
    ) -> Result<FinalOutputVerdict, OutputCheckRefusal> {
        inspect_with(bytes, format, MzmlScanLimits::default())
    }

    fn inspect_with(
        bytes: &[u8],
        format: NonMzmlFormat,
        limits: MzmlScanLimits,
    ) -> Result<FinalOutputVerdict, OutputCheckRefusal> {
        inspect_opened(
            bytes,
            bytes.len() as u64,
            format,
            &mzml_facts(INTERMEDIATE),
            &limits,
        )
    }

    const MGF: &[u8] = b"BEGIN IONS\nTITLE=scan=12\nPEPMASS=100.5\n100.1 5\nEND IONS\n";

    const MS2: &[u8] = b"H\tCreationDate Thu Oct 29 00:00:00 2026\nH\tExtractor\tProteoWizard\n\
S\t12\t12\t100.5\nI\tNativeID\tscan=12\nZ\t2\t200.0\n100.1 5\n";

    const TEXT: &[u8] = br#"msdata:
  id: x
  run:
    id: r
    spectrumList (1 spectra):
      spectrum:
        index: 0
"#;

    fn cms(file_type: i32, records: &[u8]) -> Vec<u8> {
        let mut bytes = file_type.to_le_bytes().to_vec();
        bytes.extend_from_slice(&3_i32.to_le_bytes());
        bytes.resize(2056, 0);
        bytes.extend_from_slice(records);
        bytes
    }

    #[test]
    fn record_formats_with_a_record_pass() {
        let cases: [(&[u8], NonMzmlFormat); 4] = [
            (MGF, NonMzmlFormat::Mgf),
            (MS2, NonMzmlFormat::Ms2),
            (MS2, NonMzmlFormat::Ms1),
            (TEXT, NonMzmlFormat::Text),
        ];
        for (bytes, format) in cases {
            assert_eq!(
                inspect(bytes, format),
                Ok(FinalOutputVerdict::RecordsPresent),
                "{format:?}"
            );
        }
        assert_eq!(
            inspect(&cms(2, &[0; 80]), NonMzmlFormat::Cms1),
            Ok(FinalOutputVerdict::RecordsPresent)
        );
        assert_eq!(
            inspect(&cms(4, &[0; 80]), NonMzmlFormat::Cms2),
            Ok(FinalOutputVerdict::RecordsPresent)
        );
        // CRLF line endings, a chromatogram-only text dump, a record on a last
        // line with no newline.
        let crlf = String::from_utf8_lossy(MGF).replace('\n', "\r\n");
        assert_eq!(
            inspect(crlf.as_bytes(), NonMzmlFormat::Mgf),
            Ok(FinalOutputVerdict::RecordsPresent)
        );
        assert_eq!(
            inspect(b"msdata:\n      chromatogram:\n", NonMzmlFormat::Text),
            Ok(FinalOutputVerdict::RecordsPresent)
        );
        assert_eq!(
            inspect(b"H\tCreationDate\nS\t1\t1", NonMzmlFormat::Ms1),
            Ok(FinalOutputVerdict::RecordsPresent)
        );
    }

    #[test]
    fn a_header_without_records_is_refused() {
        let no_records = Err(OutputCheckRefusal::OutputContainsNoRecords);
        assert_eq!(inspect(b"\n", NonMzmlFormat::Mgf), no_records);
        assert_eq!(
            inspect(
                b"H\tCreationDate\nH\tExtractor\tProteoWizard\n",
                NonMzmlFormat::Ms2
            ),
            no_records
        );
        assert_eq!(
            inspect(
                b"msdata:\n  run:\n    spectrumList (0 spectra):\n",
                NonMzmlFormat::Text
            ),
            no_records
        );
        assert_eq!(inspect(&cms(2, &[]), NonMzmlFormat::Cms1), no_records);
        // A marker only counts as a whole line, or a line's start for ms1/ms2.
        assert_eq!(
            inspect(b"TITLE=BEGIN IONS\n", NonMzmlFormat::Mgf),
            no_records
        );
        assert_eq!(
            inspect(b"msdata:\n  id: spectrum:\n", NonMzmlFormat::Text),
            no_records
        );
    }

    #[test]
    fn a_missing_signature_is_refused() {
        let mismatch = Err(OutputCheckRefusal::SignatureMismatch);
        assert_eq!(inspect(b"S\t1\t1\n", NonMzmlFormat::Ms1), mismatch);
        assert_eq!(
            inspect(b"mzML:\n      spectrum:\n", NonMzmlFormat::Text),
            mismatch
        );
        assert_eq!(inspect(&cms(4, &[0; 80]), NonMzmlFormat::Cms1), mismatch);
        assert_eq!(inspect(&cms(2, &[0; 80]), NonMzmlFormat::Cms2), mismatch);
        let mut wrong_version = cms(2, &[0; 80]);
        wrong_version[4] = 2;
        assert_eq!(inspect(&wrong_version, NonMzmlFormat::Cms1), mismatch);
        assert_eq!(inspect(&cms(2, &[])[..100], NonMzmlFormat::Cms1), mismatch);
        assert_eq!(inspect(b"\x02\0\0", NonMzmlFormat::Cms1), mismatch);
    }

    #[test]
    fn hdf5_formats_need_the_signature_at_offset_zero() {
        let mut file = HDF5_SIGNATURE.to_vec();
        file.extend_from_slice(&[0; 64]);
        for format in [NonMzmlFormat::Mz5, NonMzmlFormat::MzMlb] {
            assert_eq!(
                inspect(&file, format),
                Ok(FinalOutputVerdict::SignatureOnly)
            );
            assert_eq!(
                inspect(&file[..7], format),
                Err(OutputCheckRefusal::SignatureMismatch)
            );
            let mut shifted = vec![0; 512];
            shifted.extend_from_slice(&file);
            assert_eq!(
                inspect(&shifted, format),
                Err(OutputCheckRefusal::SignatureMismatch)
            );
        }
    }

    #[test]
    fn a_long_line_is_never_buffered_and_the_document_limit_holds() {
        // One array line far longer than the kept prefix, then the record.
        let mut text = b"msdata:\n        binary: [3] ".to_vec();
        text.extend(std::iter::repeat_n(b'7', 1 << 20));
        text.extend_from_slice(b"\n      spectrum:\n");
        assert_eq!(
            inspect(&text, NonMzmlFormat::Text),
            Ok(FinalOutputVerdict::RecordsPresent)
        );

        // A long line starting with the ms2 marker still counts.
        let mut ms2 = b"H\tCreationDate\nS\t".to_vec();
        ms2.extend(std::iter::repeat_n(b'1', 100));
        assert_eq!(
            inspect(&ms2, NonMzmlFormat::Ms2),
            Ok(FinalOutputVerdict::RecordsPresent)
        );

        let mut no_record = b"msdata:\n".to_vec();
        no_record.extend(std::iter::repeat_n(b'\n', 4096));
        assert_eq!(
            inspect_with(
                &no_record,
                NonMzmlFormat::Text,
                MzmlScanLimits::default().with_max_document_bytes(1024)
            ),
            Err(limit(MzmlLimitKind::DocumentBytes))
        );
    }
}
