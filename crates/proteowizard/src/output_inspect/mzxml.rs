//! mzXML's comparison with the intermediate (ADR 0055 decision 6, mzXML 2).

use std::io::BufRead;

use super::{
    FinalOutputVerdict, MzxmlEncoding, Node, OutputCheckRefusal, capture, limit, walk_xml,
};
use crate::intent::CompressionIntent;
use crate::mzml::{MzmlFacts, MzmlLimitKind, MzmlScanLimits, parse_u64_decimal};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tag {
    /// A scan by its position, and whether its `<peaks>` was seen.
    Scan {
        position: u64,
        peaks: bool,
    },
    Other,
}

/// Reads the whole document, nested scans included, and holds it against the
/// intermediate. Scan numbers are compared as they stream past; nothing about
/// a scan is retained once it closes.
pub(super) fn compare<R: BufRead>(
    reader: R,
    encoding: MzxmlEncoding,
    intermediate: &MzmlFacts,
    limits: &MzmlScanLimits,
) -> Result<FinalOutputVerdict, OutputCheckRefusal> {
    let compression = match encoding.compression {
        CompressionIntent::Zlib => "zlib",
        CompressionIntent::NoCompression => "none",
    };
    let mut stack: Vec<Tag> = Vec::new();
    let mut root_seen = false;
    let mut runs = 0_u32;
    let mut declared: Option<u64> = None;
    let mut scans = 0_u64;
    let mut compared = 0_u64;

    walk_xml(reader, limits, |node| {
        let start = match node {
            Node::Open(start) => start,
            Node::Close => {
                if let Some(Tag::Scan { position, peaks }) = stack.pop()
                    && !peaks
                {
                    return Err(OutputCheckRefusal::PeaksNotOnePerScan { position });
                }
                return Ok(());
            }
        };
        let local = start.local_name();
        if !root_seen {
            root_seen = true;
            if local.as_ref() != b"mzXML" {
                return Err(OutputCheckRefusal::SignatureMismatch);
            }
            stack.push(Tag::Other);
            return Ok(());
        }
        let tag = match local.as_ref() {
            b"msRun" => {
                runs += 1;
                if runs > 1 {
                    return Err(OutputCheckRefusal::MsRunNotUnique);
                }
                let [count] = capture(start, limits, [b"scanCount"])?;
                declared = count.as_deref().map(parse_u64_decimal).transpose()?;
                Tag::Other
            }
            b"scan" => {
                if scans >= limits.max_spectra {
                    return Err(limit(MzmlLimitKind::Spectra));
                }
                let position = scans;
                scans += 1;
                let [num] = capture(start, limits, [b"num"])?;
                let num = num.as_deref().map(parse_u64_decimal).transpose()?;
                let expected = intermediate
                    .spectra()
                    .get(usize::try_from(position).unwrap_or(usize::MAX))
                    .and_then(|spectrum| spectrum.scan_number());
                if let Some(expected) = expected {
                    if num != Some(expected) {
                        return Err(OutputCheckRefusal::ScanNumberMismatch { position });
                    }
                    compared += 1;
                }
                Tag::Scan {
                    position,
                    peaks: false,
                }
            }
            b"peaks" => {
                let Some(Tag::Scan { position, peaks }) = stack.last_mut() else {
                    return Err(OutputCheckRefusal::PeaksNotOnePerScan { position: scans });
                };
                let position = *position;
                if std::mem::replace(peaks, true) {
                    return Err(OutputCheckRefusal::PeaksNotOnePerScan { position });
                }
                let [precision, compression_type] =
                    capture(start, limits, [b"precision", b"compressionType"])?;
                if precision.as_deref() != Some(encoding.precision.attribute()) {
                    return Err(OutputCheckRefusal::PeaksPrecisionMismatch {
                        requested: encoding.precision,
                        position,
                    });
                }
                if compression_type.as_deref() != Some(compression) {
                    return Err(OutputCheckRefusal::PeaksCompressionMismatch {
                        requested: encoding.compression,
                        position,
                    });
                }
                Tag::Other
            }
            _ => Tag::Other,
        };
        stack.push(tag);
        Ok(())
    })?;

    if !root_seen {
        return Err(OutputCheckRefusal::SignatureMismatch);
    }
    if scans == 0 {
        return Err(OutputCheckRefusal::OutputContainsNoRecords);
    }
    if scans != intermediate.observed_spectrum_count() {
        return Err(OutputCheckRefusal::ScanCountMismatch {
            intermediate: intermediate.observed_spectrum_count(),
            output: scans,
        });
    }
    if declared != Some(scans) {
        return Err(OutputCheckRefusal::DeclaredScanCountInconsistent {
            declared,
            written: scans,
        });
    }
    Ok(FinalOutputVerdict::MzxmlMatchesIntermediate {
        scans,
        scan_numbers_compared: compared,
    })
}

#[cfg(test)]
mod tests {
    use super::super::tests::{INTERMEDIATE, mzml_facts};
    use super::super::{MzxmlPrecision, malformed};
    use super::*;
    use crate::mzml::{MzmlMalformedKind, MzmlScanError, UnsafeXmlKind};

    /// What the evidenced build's writer emits for [`INTERMEDIATE`], shortened:
    /// the declared Latin-1 encoding, a raw Latin-1 byte (0xE9) in a file name
    /// nothing decodes, a nested scan, an empty `<peaks>`, the index and sha1.
    fn written() -> Vec<u8> {
        let mut document = br#"<?xml version="1.0" encoding="ISO-8859-1"?>
<mzXML xmlns="http://sashimi.sourceforge.net/schema_revision/mzXML_3.2"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <msRun scanCount="3" startTime="PT1S" endTime="PT3S">
    <parentFile fileName="file:///C:/d/caf"#
            .to_vec();
        document.push(0xE9);
        document.extend_from_slice(
            br#".mzML" fileType="processedData" fileSha1="0"/>
    <scan num="11" msLevel="1" peaksCount="1">
      <peaks compressionType="zlib" compressedLen="16" precision="64" byteOrder="network" contentType="m/z-int">eJw=</peaks>
      <scan num="12" msLevel="2" peaksCount="0">
        <precursorMz precursorIntensity="0">100.5</precursorMz>
        <peaks xsi:nil="true" compressionType="zlib" compressedLen="0" precision="64" byteOrder="network" contentType="m/z-int"></peaks>
      </scan>
    </scan>
    <scan num="13" msLevel="3" peaksCount="0">
      <peaks compressionType="zlib" compressedLen="0" precision="64" byteOrder="network" contentType="m/z-int"/>
    </scan>
  </msRun>
  <index name="scan"><offset id="11">1</offset></index>
  <indexOffset>2</indexOffset>
  <sha1>0</sha1>
</mzXML>
"#,
        );
        document
    }

    const ZLIB_64: MzxmlEncoding = MzxmlEncoding {
        precision: MzxmlPrecision::Bits64,
        compression: CompressionIntent::Zlib,
    };

    fn check_bytes(
        document: &[u8],
        encoding: MzxmlEncoding,
    ) -> Result<FinalOutputVerdict, OutputCheckRefusal> {
        compare(
            document,
            encoding,
            &mzml_facts(INTERMEDIATE),
            &MzmlScanLimits::default(),
        )
    }

    fn check(document: &str) -> Result<FinalOutputVerdict, OutputCheckRefusal> {
        check_bytes(document.as_bytes(), ZLIB_64)
    }

    fn edited(from: &str, to: &str) -> String {
        let original = String::from_utf8_lossy(&written()).into_owned();
        assert_eq!(original.matches(from).count(), 1, "{from}");
        original.replace(from, to)
    }

    #[test]
    fn a_faithful_document_matches_its_intermediate() {
        assert_eq!(
            check_bytes(&written(), ZLIB_64),
            Ok(FinalOutputVerdict::MzxmlMatchesIntermediate {
                scans: 3,
                scan_numbers_compared: 3,
            })
        );
    }

    #[test]
    fn a_dropped_spectrum_fails_even_under_a_header_declaring_it() {
        // X2's shape: the header counts the list, the writer skipped one.
        let dropped = edited(
            r#"    <scan num="13" msLevel="3" peaksCount="0">
      <peaks compressionType="zlib" compressedLen="0" precision="64" byteOrder="network" contentType="m/z-int"/>
    </scan>
"#,
            "",
        );
        assert_eq!(
            check(&dropped),
            Err(OutputCheckRefusal::ScanCountMismatch {
                intermediate: 3,
                output: 2,
            })
        );
        let undeclared = edited(r#"scanCount="3""#, r#"scanCount="4""#);
        assert_eq!(
            check(&undeclared),
            Err(OutputCheckRefusal::DeclaredScanCountInconsistent {
                declared: Some(4),
                written: 3,
            })
        );
        let missing = edited(r#"scanCount="3" "#, "");
        assert_eq!(
            check(&missing),
            Err(OutputCheckRefusal::DeclaredScanCountInconsistent {
                declared: None,
                written: 3,
            })
        );
        let twice = edited("  <index ", "  <msRun scanCount=\"3\"/>\n  <index ");
        assert_eq!(check(&twice), Err(OutputCheckRefusal::MsRunNotUnique));
    }

    #[test]
    fn a_scan_number_other_than_the_native_ids_fails_and_an_opaque_id_is_not_compared() {
        assert_eq!(
            check(&edited(r#"num="12""#, r#"num="99""#)),
            Err(OutputCheckRefusal::ScanNumberMismatch { position: 1 })
        );
        assert_eq!(
            check(&edited(r#"<scan num="12" "#, "<scan ")),
            Err(OutputCheckRefusal::ScanNumberMismatch { position: 1 })
        );

        // An intermediate whose second native ID carries no scan number.
        let opaque = INTERMEDIATE.replace(r#"id="scan=12""#, r#"id="sample=1 period=1 cycle=1""#);
        let verdict = compare(
            edited(r#"num="12""#, r#"num="2""#).as_bytes(),
            ZLIB_64,
            &mzml_facts(&opaque),
            &MzmlScanLimits::default(),
        );
        assert_eq!(
            verdict,
            Ok(FinalOutputVerdict::MzxmlMatchesIntermediate {
                scans: 3,
                scan_numbers_compared: 2,
            })
        );
    }

    #[test]
    fn every_peaks_must_state_the_requested_encoding() {
        let thirty_two = MzxmlEncoding {
            precision: MzxmlPrecision::Bits32,
            ..ZLIB_64
        };
        assert_eq!(
            check_bytes(&written(), thirty_two),
            Err(OutputCheckRefusal::PeaksPrecisionMismatch {
                requested: MzxmlPrecision::Bits32,
                position: 0,
            })
        );
        let uncompressed = MzxmlEncoding {
            compression: CompressionIntent::NoCompression,
            ..ZLIB_64
        };
        assert_eq!(
            check_bytes(&written(), uncompressed),
            Err(OutputCheckRefusal::PeaksCompressionMismatch {
                requested: CompressionIntent::NoCompression,
                position: 0,
            })
        );
        // The nested scan's peaks, not its parent's.
        let nested = edited(
            r#"<peaks xsi:nil="true" compressionType="zlib" compressedLen="0" precision="64""#,
            r#"<peaks xsi:nil="true" compressionType="zlib" compressedLen="0" precision="32""#,
        );
        assert_eq!(
            check(&nested),
            Err(OutputCheckRefusal::PeaksPrecisionMismatch {
                requested: MzxmlPrecision::Bits64,
                position: 1,
            })
        );
    }

    #[test]
    fn a_scan_needs_exactly_one_peaks() {
        let none = edited(
            r#"      <peaks compressionType="zlib" compressedLen="0" precision="64" byteOrder="network" contentType="m/z-int"/>
    </scan>"#,
            "    </scan>",
        );
        assert_eq!(
            check(&none),
            Err(OutputCheckRefusal::PeaksNotOnePerScan { position: 2 })
        );
        let two = edited(
            r#"contentType="m/z-int"/>
    </scan>"#,
            r#"contentType="m/z-int"/><peaks precision="64" compressionType="zlib"/>
    </scan>"#,
        );
        assert_eq!(
            check(&two),
            Err(OutputCheckRefusal::PeaksNotOnePerScan { position: 2 })
        );
    }

    #[test]
    fn a_document_that_is_not_mzxml_or_holds_no_scan_is_refused() {
        assert_eq!(check("<mzML/>"), Err(OutputCheckRefusal::SignatureMismatch));
        assert_eq!(check("   "), Err(OutputCheckRefusal::SignatureMismatch));
        assert_eq!(
            check(r#"<mzXML><msRun scanCount="0"/></mzXML>"#),
            Err(OutputCheckRefusal::OutputContainsNoRecords)
        );
    }

    #[test]
    fn unsafe_malformed_and_oversized_documents_fail_closed() {
        assert_eq!(
            check(r#"<!DOCTYPE mzXML [<!ENTITY x "y">]><mzXML/>"#),
            Err(MzmlScanError::Unsafe(UnsafeXmlKind::DoctypeDeclaration).into())
        );
        assert_eq!(
            check(&edited(r#"num="11""#, r#"num="&x;""#)),
            Err(MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity).into())
        );
        assert_eq!(
            check(&edited(r#"num="11""#, r#"num="eleven""#)),
            Err(malformed(MzmlMalformedKind::InvalidNumber))
        );
        assert_eq!(
            check(&edited("</mzXML>", "")),
            Err(malformed(MzmlMalformedKind::NotWellFormed))
        );
        let limits = [
            (
                MzmlScanLimits::default().with_max_document_bytes(64),
                MzmlLimitKind::DocumentBytes,
            ),
            (
                MzmlScanLimits::default().with_max_text_run_bytes(32),
                MzmlLimitKind::TextRunBytes,
            ),
            (
                MzmlScanLimits::default().with_max_depth(3),
                MzmlLimitKind::Depth,
            ),
            (
                MzmlScanLimits::default().with_max_elements(4),
                MzmlLimitKind::Elements,
            ),
            (
                MzmlScanLimits::default().with_max_attributes_per_element(2),
                MzmlLimitKind::AttributesPerElement,
            ),
            (
                MzmlScanLimits::default().with_max_name_bytes(4),
                MzmlLimitKind::NameBytes,
            ),
            (
                MzmlScanLimits::default().with_max_attribute_value_bytes(1),
                MzmlLimitKind::AttributeValueBytes,
            ),
            (
                MzmlScanLimits::default().with_max_spectra(2),
                MzmlLimitKind::Spectra,
            ),
        ];
        for (limits, expected) in limits {
            assert_eq!(
                compare(
                    written().as_slice(),
                    ZLIB_64,
                    &mzml_facts(INTERMEDIATE),
                    &limits
                ),
                Err(limit(expected)),
                "{expected:?}"
            );
        }
    }
}
