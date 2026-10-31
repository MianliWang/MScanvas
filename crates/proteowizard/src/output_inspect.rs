//! Checks for outputs written in a format other than mzML (ADR 0055 decision 6).
//!
//! Every such output is written by a second provider run from a private mzML
//! intermediate that has already passed the mzML checks. Two judgements remain,
//! and both fail closed:
//!
//! - [`admit_intermediate`], before run 2: the intermediate must hold something
//!   the requested format keeps, and for mzXML no spectrum may name a source
//!   file other than the run's default (M6.10 case X2);
//! - [`inspect_final_output`], after run 2: the final file must be non-empty,
//!   carry its format's fixed signature where it has one, and hold at least one
//!   record. mzXML is compared with the intermediate as well.
//!
//! Exit status and the staging directory's contents are the run's judgements,
//! not these. Nothing here decodes an array, and every read is bounded by the
//! same explicit limits the mzML scanner uses.

mod intermediate;
mod mzxml;
mod records;

use std::borrow::Cow;
use std::io::{BufRead, BufReader};
use std::path::Path;

use quick_xml::errors::Error as XmlError;
use quick_xml::events::attributes::AttrError;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

use crate::fs_guard;
use crate::intent::CompressionIntent;
use crate::mzml::{
    BoundedReader, MzmlFacts, MzmlLimitKind, MzmlMalformedKind, MzmlScanError, MzmlScanLimits,
    UnsafeXmlKind, is_predefined_reference, map_xml_error,
};

pub use intermediate::{IntermediateFacts, scan_intermediate, scan_intermediate_reader};

/// A format written from the mzML intermediate, with what its writer reads.
///
/// Only mzXML carries encoding here, because only mzXML's encoding is checked;
/// the other formats' writers read none (text formats) or are not read past
/// their signature (mz5, mzMLb).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NonMzmlFormat {
    MzXml(MzxmlEncoding),
    Mgf,
    Text,
    Ms1,
    Ms2,
    Cms1,
    Cms2,
    Mz5,
    MzMlb,
}

impl NonMzmlFormat {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::MzXml(_) => "mzxml",
            Self::Mgf => "mgf",
            Self::Text => "text",
            Self::Ms1 => "ms1",
            Self::Ms2 => "ms2",
            Self::Cms1 => "cms1",
            Self::Cms2 => "cms2",
            Self::Mz5 => "mz5",
            Self::MzMlb => "mzmlb",
        }
    }
}

/// The one global precision mzXML's `<peaks>` is written at (`--32` or `--64`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzxmlPrecision {
    Bits32,
    Bits64,
}

impl MzxmlPrecision {
    const fn attribute(self) -> &'static str {
        match self {
            Self::Bits32 => "32",
            Self::Bits64 => "64",
        }
    }
}

/// What run 2 asked the mzXML writer for, and what `<peaks>` must declare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MzxmlEncoding {
    pub precision: MzxmlPrecision,
    pub compression: CompressionIntent,
}

/// What a final file that passed its checks may be reported as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinalOutputVerdict {
    /// mzXML: every scan matched an intermediate spectrum by position, and by
    /// scan number where the intermediate's native ID carried one. Array values
    /// are not compared.
    MzxmlMatchesIntermediate {
        scans: u64,
        scan_numbers_compared: u64,
    },
    /// mgf, text, ms1, ms2, cms1, cms2: the signature, where the format has one,
    /// and at least one record. What the records hold is unverified.
    RecordsPresent,
    /// mz5, mzMLb: the HDF5 signature only. What the file holds is unverified.
    SignatureOnly,
}

impl FinalOutputVerdict {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::MzxmlMatchesIntermediate { .. } => "mzxml_matches_intermediate",
            Self::RecordsPresent => "records_present",
            Self::SignatureOnly => "signature_only",
        }
    }
}

/// Why an intermediate or a final file was refused. No variant carries a path,
/// a native identifier or document text; positions are zero-based record
/// positions in document order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputCheckRefusal {
    /// The file could not be opened safely, read, or parsed within the limits.
    Unreadable(MzmlScanError),
    EmptyOutput,
    /// The format's fixed leading signature is absent.
    SignatureMismatch,
    /// Nothing the format keeps: in the intermediate before run 2, or in the
    /// final file after it.
    OutputContainsNoRecords,
    /// mzXML only (X2): a spectrum names a source file other than the run's
    /// default, or names one where the run declares none. The writer skips it.
    SpectrumFromNonDefaultSourceFile {
        position: u64,
    },
    /// mzXML only: the scans written are not the intermediate's spectra.
    ScanCountMismatch {
        intermediate: u64,
        output: u64,
    },
    /// mzXML only: `msRun/@scanCount` is absent, unparseable or not the number
    /// of scans written.
    DeclaredScanCountInconsistent {
        declared: Option<u64>,
        written: u64,
    },
    /// mzXML only: more than one `msRun`.
    MsRunNotUnique,
    /// mzXML only: a scan's `num` is not the scan number the intermediate's
    /// native ID carries at that position.
    ScanNumberMismatch {
        position: u64,
    },
    /// mzXML only: a scan carries no `<peaks>`, or more than one, or a
    /// `<peaks>` sits outside any scan.
    PeaksNotOnePerScan {
        position: u64,
    },
    PeaksPrecisionMismatch {
        requested: MzxmlPrecision,
        position: u64,
    },
    PeaksCompressionMismatch {
        requested: CompressionIntent,
        position: u64,
    },
}

impl OutputCheckRefusal {
    /// Where a meaning equals one of [`crate::ConversionIntegrityOutcome`]'s,
    /// the identifier is the same, so the run can map one to one.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Unreadable(error) => error.stable_id(),
            Self::EmptyOutput => "zero_byte_output",
            Self::SignatureMismatch => "output_signature_mismatch",
            Self::OutputContainsNoRecords => "output_contains_no_records",
            Self::SpectrumFromNonDefaultSourceFile { .. } => {
                "spectrum_from_non_default_source_file"
            }
            Self::ScanCountMismatch { .. } => "spectrum_count_mismatch",
            Self::DeclaredScanCountInconsistent { .. } => "output_declared_count_inconsistent",
            Self::MsRunNotUnique => "ms_run_not_unique",
            Self::ScanNumberMismatch { .. } => "scan_number_mismatch",
            Self::PeaksNotOnePerScan { .. } => "peaks_not_one_per_scan",
            Self::PeaksPrecisionMismatch { .. } => "numeric_precision_mismatch",
            Self::PeaksCompressionMismatch { .. } => "compression_policy_mismatch",
        }
    }
}

impl From<MzmlScanError> for OutputCheckRefusal {
    fn from(error: MzmlScanError) -> Self {
        Self::Unreadable(error)
    }
}

const fn malformed(kind: MzmlMalformedKind) -> OutputCheckRefusal {
    OutputCheckRefusal::Unreadable(MzmlScanError::Malformed(kind))
}

const fn limit(kind: MzmlLimitKind) -> OutputCheckRefusal {
    OutputCheckRefusal::Unreadable(MzmlScanError::LimitExceeded(kind))
}

/// Decision 6, run 1: whether run 2 may write `format` from this intermediate.
///
/// The selections mirror the evidenced build's writers: mgf keeps spectra above
/// MS1 whose first precursor names a selected ion; ms2 and cms2 keep MS2 spectra
/// that do; ms1 and cms1 keep MS1 spectra; a spectrum with no MS level is kept
/// by none of them.
pub fn admit_intermediate(
    format: NonMzmlFormat,
    intermediate: &IntermediateFacts,
) -> Result<(), OutputCheckRefusal> {
    let kept = match format {
        NonMzmlFormat::MzXml(_) => {
            if let Some(position) = intermediate.first_non_default_source_file() {
                return Err(OutputCheckRefusal::SpectrumFromNonDefaultSourceFile { position });
            }
            intermediate.spectra()
        }
        NonMzmlFormat::Mgf => intermediate.above_ms1_with_selected_ion(),
        NonMzmlFormat::Ms1 | NonMzmlFormat::Cms1 => intermediate.ms1_spectra(),
        NonMzmlFormat::Ms2 | NonMzmlFormat::Cms2 => intermediate.ms2_with_selected_ion(),
        NonMzmlFormat::Text | NonMzmlFormat::Mz5 | NonMzmlFormat::MzMlb => {
            intermediate.spectra() + intermediate.chromatograms()
        }
    };
    if kept == 0 {
        return Err(OutputCheckRefusal::OutputContainsNoRecords);
    }
    Ok(())
}

/// Decision 6, run 2: the minimal checks of the final file, and for mzXML its
/// comparison with `intermediate`, the facts run 1's checks established.
///
/// The path is opened only as a regular file. `limits` bounds every read; for
/// mzXML, `max_spectra` bounds the scans.
pub fn inspect_final_output(
    path: &Path,
    format: NonMzmlFormat,
    intermediate: &MzmlFacts,
    limits: MzmlScanLimits,
) -> Result<FinalOutputVerdict, OutputCheckRefusal> {
    let (file, length) = fs_guard::open_regular_file(path).map_err(MzmlScanError::from)?;
    inspect_opened(
        BufReader::with_capacity(64 * 1024, file),
        length,
        format,
        intermediate,
        &limits,
    )
}

fn inspect_opened<R: BufRead>(
    reader: R,
    length: u64,
    format: NonMzmlFormat,
    intermediate: &MzmlFacts,
    limits: &MzmlScanLimits,
) -> Result<FinalOutputVerdict, OutputCheckRefusal> {
    if length == 0 {
        return Err(OutputCheckRefusal::EmptyOutput);
    }
    match format {
        NonMzmlFormat::MzXml(encoding) => mzxml::compare(reader, encoding, intermediate, limits),
        NonMzmlFormat::Mgf
        | NonMzmlFormat::Text
        | NonMzmlFormat::Ms1
        | NonMzmlFormat::Ms2
        | NonMzmlFormat::Cms1
        | NonMzmlFormat::Cms2 => records::check(reader, length, format, limits),
        NonMzmlFormat::Mz5 | NonMzmlFormat::MzMlb => records::check_hdf5(reader),
    }
}

/// One element boundary. An empty element is an `Open` followed by a `Close`.
enum Node<'a, 'b> {
    Open(&'a BytesStart<'b>),
    Close,
}

/// Walks an XML document with the mzML scanner's refusals and limits: no
/// document type declaration, no general reference but the predefined ones and
/// character references, and the byte, depth, element and name limits.
///
/// Text is never decoded, so a document declaring a non-UTF-8 encoding is read
/// as long as the attributes a visitor captures are ASCII.
fn walk_xml<R: BufRead>(
    reader: R,
    limits: &MzmlScanLimits,
    mut visit: impl FnMut(Node<'_, '_>) -> Result<(), OutputCheckRefusal>,
) -> Result<(), OutputCheckRefusal> {
    let mut xml = Reader::from_reader(BoundedReader::new(
        reader,
        limits.max_document_bytes,
        limits.max_text_run_bytes,
    ));
    let config = xml.config_mut();
    config.check_end_names = true;
    config.allow_unmatched_ends = false;
    config.allow_dangling_amp = false;
    config.expand_empty_elements = false;

    let mut depth = 0_usize;
    let mut elements = 0_u64;
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        let event = match xml.read_event_into(&mut buffer) {
            Ok(event) => event,
            Err(error) => return Err(map_xml_error(xml.get_mut().tripped, error).into()),
        };
        match &event {
            Event::Eof => break,
            Event::DocType(_) => {
                return Err(MzmlScanError::Unsafe(UnsafeXmlKind::DoctypeDeclaration).into());
            }
            Event::GeneralRef(reference) => {
                let name = reference
                    .decode()
                    .map_err(|_| malformed(MzmlMalformedKind::InvalidUtf8))?;
                if !is_predefined_reference(&name) {
                    return Err(MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity).into());
                }
            }
            Event::Start(start) | Event::Empty(start) => {
                elements += 1;
                if elements > limits.max_elements {
                    return Err(limit(MzmlLimitKind::Elements));
                }
                if start.name().as_ref().len() > limits.max_name_bytes {
                    return Err(limit(MzmlLimitKind::NameBytes));
                }
                let opens = matches!(event, Event::Start(_));
                if opens && depth >= limits.max_depth {
                    return Err(limit(MzmlLimitKind::Depth));
                }
                // Every element answers to the attribute limits, as in the
                // mzML scanner, not only the ones a visitor captures from.
                capture(start, limits, [])?;
                visit(Node::Open(start))?;
                if opens {
                    depth += 1;
                } else {
                    visit(Node::Close)?;
                }
            }
            Event::End(_) => {
                depth = depth
                    .checked_sub(1)
                    .ok_or(malformed(MzmlMalformedKind::NotWellFormed))?;
                visit(Node::Close)?;
            }
            _ => {}
        }
        if let Some(kind) = xml.get_mut().finish_event() {
            return Err(limit(kind));
        }
    }
    if depth != 0 {
        return Err(malformed(MzmlMalformedKind::NotWellFormed));
    }
    Ok(())
}

/// Captures the values of `keys` on one element, with the mzML scanner's
/// attribute limits. Only captured values are decoded.
fn capture<'a, const N: usize>(
    start: &'a BytesStart<'_>,
    limits: &MzmlScanLimits,
    keys: [&[u8]; N],
) -> Result<[Option<Cow<'a, str>>; N], OutputCheckRefusal> {
    let mut captured = std::array::from_fn(|_| None);
    let mut attributes = start.attributes();
    attributes.with_checks(true);
    for (observed, attribute) in attributes.enumerate() {
        let attribute = attribute.map_err(|error| match error {
            AttrError::Duplicated(_, _) => malformed(MzmlMalformedKind::DuplicateAttribute),
            _ => malformed(MzmlMalformedKind::NotWellFormed),
        })?;
        if observed >= limits.max_attributes_per_element {
            return Err(limit(MzmlLimitKind::AttributesPerElement));
        }
        if attribute.key.as_ref().len() > limits.max_name_bytes {
            return Err(limit(MzmlLimitKind::NameBytes));
        }
        if attribute.value.len() > limits.max_attribute_value_bytes {
            return Err(limit(MzmlLimitKind::AttributeValueBytes));
        }
        let local = attribute.key.local_name();
        let Some(slot) = keys.iter().position(|key| *key == local.as_ref()) else {
            continue;
        };
        captured[slot] = Some(
            attribute
                .normalized_value(XmlVersion::Implicit1_0)
                .map_err(|error| match error {
                    XmlError::Escape(_) => OutputCheckRefusal::from(MzmlScanError::Unsafe(
                        UnsafeXmlKind::UndeclaredEntity,
                    )),
                    XmlError::Encoding(_) => malformed(MzmlMalformedKind::InvalidUtf8),
                    _ => malformed(MzmlMalformedKind::NotWellFormed),
                })?,
        );
    }
    Ok(captured)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mzml::inspect_reader;

    /// Three spectra and one chromatogram: an MS1 scan, an MS2 scan whose first
    /// precursor names a selected ion, and an MS3 scan whose does not.
    pub(super) const INTERMEDIATE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<indexedmzML xmlns="http://psi.hupo.org/ms/mzml">
  <mzML version="1.1.0">
    <run id="r" defaultSourceFileRef="SF1">
      <spectrumList count="3">
        <spectrum index="0" id="scan=11" defaultArrayLength="0">
          <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="1"/>
        </spectrum>
        <spectrum index="1" id="scan=12" defaultArrayLength="0" sourceFileRef="SF1">
          <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="2"/>
          <precursorList count="1">
            <precursor>
              <selectedIonList count="1"><selectedIon/></selectedIonList>
            </precursor>
          </precursorList>
        </spectrum>
        <spectrum index="2" id="scan=13" defaultArrayLength="0">
          <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="3"/>
          <precursorList count="2">
            <precursor/>
            <precursor>
              <selectedIonList count="1"><selectedIon/></selectedIonList>
            </precursor>
          </precursorList>
        </spectrum>
      </spectrumList>
      <chromatogramList count="1">
        <chromatogram index="0" id="TIC" defaultArrayLength="0"/>
      </chromatogramList>
    </run>
  </mzML>
</indexedmzML>"#;

    pub(super) fn mzml_facts(document: &str) -> MzmlFacts {
        inspect_reader(document.as_bytes(), MzmlScanLimits::default()).expect("fixture is mzML")
    }

    fn intermediate(document: &str) -> IntermediateFacts {
        scan_intermediate_reader(document.as_bytes(), MzmlScanLimits::default())
            .expect("fixture is mzML")
    }

    const MZXML: NonMzmlFormat = NonMzmlFormat::MzXml(MzxmlEncoding {
        precision: MzxmlPrecision::Bits64,
        compression: CompressionIntent::Zlib,
    });

    const EVERY_FORMAT: [NonMzmlFormat; 9] = [
        MZXML,
        NonMzmlFormat::Mgf,
        NonMzmlFormat::Text,
        NonMzmlFormat::Ms1,
        NonMzmlFormat::Ms2,
        NonMzmlFormat::Cms1,
        NonMzmlFormat::Cms2,
        NonMzmlFormat::Mz5,
        NonMzmlFormat::MzMlb,
    ];

    #[test]
    fn an_intermediate_holding_what_every_format_keeps_is_admitted_for_each() {
        let facts = intermediate(INTERMEDIATE);
        for format in EVERY_FORMAT {
            assert_eq!(admit_intermediate(format, &facts), Ok(()), "{format:?}");
        }
    }

    #[test]
    fn an_intermediate_with_nothing_a_format_keeps_is_refused_before_run_two() {
        // MS1 only: nothing for mgf, ms2 or cms2; ms1 and the rest still pass.
        let ms1_only = INTERMEDIATE
            .replace(r#"value="2""#, r#"value="1""#)
            .replace(r#"value="3""#, r#"value="1""#);
        let facts = intermediate(&ms1_only);
        for format in [NonMzmlFormat::Mgf, NonMzmlFormat::Ms2, NonMzmlFormat::Cms2] {
            assert_eq!(
                admit_intermediate(format, &facts),
                Err(OutputCheckRefusal::OutputContainsNoRecords),
                "{format:?}"
            );
        }
        assert_eq!(admit_intermediate(NonMzmlFormat::Ms1, &facts), Ok(()));

        // An MS2 spectrum whose first precursor names no selected ion is kept by
        // neither mgf nor ms2, even if a later precursor names one.
        let no_first_selected_ion = INTERMEDIATE.replace(
            r#"<selectedIonList count="1"><selectedIon/></selectedIonList>
            </precursor>
          </precursorList>
        </spectrum>
        <spectrum index="2""#,
            r#"</precursor>
          </precursorList>
        </spectrum>
        <spectrum index="2""#,
        );
        let facts = intermediate(&no_first_selected_ion);
        assert_eq!(facts.ms2_with_selected_ion(), 0);
        for format in [NonMzmlFormat::Mgf, NonMzmlFormat::Ms2] {
            assert_eq!(
                admit_intermediate(format, &facts),
                Err(OutputCheckRefusal::OutputContainsNoRecords),
                "{format:?}"
            );
        }

        // No MS level at all: no record format keeps it.
        let no_level = INTERMEDIATE.replace(
            r#"<cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="1"/>"#,
            "",
        );
        let facts = intermediate(&no_level);
        assert_eq!(facts.ms1_spectra(), 0);
        assert_eq!(
            admit_intermediate(NonMzmlFormat::Cms1, &facts),
            Err(OutputCheckRefusal::OutputContainsNoRecords)
        );

        // Chromatograms only: no spectrum for mzXML; text, mz5 and mzMLb go on.
        let chromatograms_only = r#"<mzML><run id="r"><spectrumList count="0"/>
            <chromatogramList count="1"><chromatogram index="0" id="TIC"/></chromatogramList>
            </run></mzML>"#;
        let facts = intermediate(chromatograms_only);
        assert_eq!(
            admit_intermediate(MZXML, &facts),
            Err(OutputCheckRefusal::OutputContainsNoRecords)
        );
        for format in [
            NonMzmlFormat::Text,
            NonMzmlFormat::Mz5,
            NonMzmlFormat::MzMlb,
        ] {
            assert_eq!(admit_intermediate(format, &facts), Ok(()), "{format:?}");
        }
        let nothing = intermediate("<mzML><run id=\"r\"/></mzML>");
        assert_eq!(
            admit_intermediate(NonMzmlFormat::Text, &nothing),
            Err(OutputCheckRefusal::OutputContainsNoRecords)
        );
    }

    #[test]
    fn mzxml_is_refused_where_a_spectrum_names_a_non_default_source_file() {
        // A different source file than the run's default.
        let other = INTERMEDIATE.replace(
            r#"defaultArrayLength="0">
          <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="3"/>"#,
            r#"defaultArrayLength="0" sourceFileRef="SF2">
          <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="3"/>"#,
        );
        let refused = Err(OutputCheckRefusal::SpectrumFromNonDefaultSourceFile { position: 2 });
        assert_eq!(admit_intermediate(MZXML, &intermediate(&other)), refused);
        // Only mzXML's writer skips it.
        assert_eq!(
            admit_intermediate(NonMzmlFormat::Mgf, &intermediate(&other)),
            Ok(())
        );

        // A named source file where the run declares no default: the fixture's
        // second spectrum names SF1.
        let no_default = INTERMEDIATE.replace(r#" defaultSourceFileRef="SF1""#, "");
        assert_eq!(
            admit_intermediate(MZXML, &intermediate(&no_default)),
            Err(OutputCheckRefusal::SpectrumFromNonDefaultSourceFile { position: 1 })
        );
    }

    #[test]
    fn a_zero_byte_final_file_is_refused_for_every_format() {
        let facts = mzml_facts(INTERMEDIATE);
        for format in EVERY_FORMAT {
            assert_eq!(
                inspect_opened(&b""[..], 0, format, &facts, &MzmlScanLimits::default()),
                Err(OutputCheckRefusal::EmptyOutput),
                "{format:?}"
            );
        }
    }

    #[test]
    fn a_final_path_that_is_not_a_regular_file_is_refused_before_any_read() {
        let directory = std::env::temp_dir();
        let refusal = inspect_final_output(
            &directory,
            NonMzmlFormat::Mz5,
            &mzml_facts(INTERMEDIATE),
            MzmlScanLimits::default(),
        )
        .expect_err("a directory is not an output file");
        assert!(matches!(
            refusal,
            OutputCheckRefusal::Unreadable(MzmlScanError::Source(_))
        ));
        assert!(matches!(
            scan_intermediate(&directory, MzmlScanLimits::default()),
            Err(OutputCheckRefusal::Unreadable(MzmlScanError::Source(_)))
        ));
    }

    #[test]
    fn refusals_carry_distinct_stable_ids_and_no_text() {
        let refusals = [
            OutputCheckRefusal::EmptyOutput,
            OutputCheckRefusal::SignatureMismatch,
            OutputCheckRefusal::OutputContainsNoRecords,
            OutputCheckRefusal::SpectrumFromNonDefaultSourceFile { position: 0 },
            OutputCheckRefusal::ScanCountMismatch {
                intermediate: 1,
                output: 0,
            },
            OutputCheckRefusal::DeclaredScanCountInconsistent {
                declared: None,
                written: 0,
            },
            OutputCheckRefusal::MsRunNotUnique,
            OutputCheckRefusal::ScanNumberMismatch { position: 0 },
            OutputCheckRefusal::PeaksNotOnePerScan { position: 0 },
            OutputCheckRefusal::PeaksPrecisionMismatch {
                requested: MzxmlPrecision::Bits32,
                position: 0,
            },
            OutputCheckRefusal::PeaksCompressionMismatch {
                requested: CompressionIntent::Zlib,
                position: 0,
            },
            OutputCheckRefusal::Unreadable(MzmlScanError::LimitExceeded(
                MzmlLimitKind::DocumentBytes,
            )),
        ];
        let ids: std::collections::BTreeSet<_> =
            refusals.iter().map(|refusal| refusal.stable_id()).collect();
        assert_eq!(ids.len(), refusals.len());
        assert!(
            ids.iter()
                .all(|id| id.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'))
        );
    }
}
