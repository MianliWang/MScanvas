//! The intermediate's facts that decide what run 2's writers keep.

use std::io::{BufRead, BufReader};
use std::path::Path;

use super::{Node, OutputCheckRefusal, capture, limit, malformed, walk_xml};
use crate::fs_guard;
use crate::mzml::{
    MzmlLimitKind, MzmlMalformedKind, MzmlScanError, MzmlScanLimits, parse_u64_decimal,
};

const MS_LEVEL: &[u8] = b"MS:1000511";

/// Counts of the spectra each non-mzML writer selects, and the X2 fact.
///
/// ponytail: a second bounded read of an intermediate `inspect_file` already
/// read. Fold these facts into `MzmlFacts` to read the file once.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IntermediateFacts {
    spectra: u64,
    chromatograms: u64,
    ms1_spectra: u64,
    above_ms1_with_selected_ion: u64,
    ms2_with_selected_ion: u64,
    first_non_default_source_file: Option<u64>,
}

impl IntermediateFacts {
    #[must_use]
    pub const fn spectra(&self) -> u64 {
        self.spectra
    }

    #[must_use]
    pub const fn chromatograms(&self) -> u64 {
        self.chromatograms
    }

    /// Spectra at MS level 1: what ms1 and cms1 keep.
    #[must_use]
    pub const fn ms1_spectra(&self) -> u64 {
        self.ms1_spectra
    }

    /// Spectra above MS1 whose first precursor names a selected ion: what mgf
    /// keeps (`Serializer_MGF.cpp:101-103`).
    #[must_use]
    pub const fn above_ms1_with_selected_ion(&self) -> u64 {
        self.above_ms1_with_selected_ion
    }

    /// MS2 spectra whose first precursor names a selected ion: what ms2 and
    /// cms2 keep (`Serializer_MSn.cpp:480-482`).
    #[must_use]
    pub const fn ms2_with_selected_ion(&self) -> u64 {
        self.ms2_with_selected_ion
    }

    /// The position of the first spectrum whose `sourceFileRef` is not the
    /// run's `defaultSourceFileRef`, or is present where the run has none.
    /// mzXML's writer skips such spectra (`Serializer_mzXML.cpp:782-783`).
    #[must_use]
    pub const fn first_non_default_source_file(&self) -> Option<u64> {
        self.first_non_default_source_file
    }
}

/// Scans an intermediate after refusing any non-regular, symlinked or
/// reparse-point path.
pub fn scan_intermediate(
    path: &Path,
    limits: MzmlScanLimits,
) -> Result<IntermediateFacts, OutputCheckRefusal> {
    let (file, _length) = fs_guard::open_regular_file(path).map_err(MzmlScanError::from)?;
    scan_intermediate_reader(BufReader::with_capacity(64 * 1024, file), limits)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tag {
    SpectrumList,
    Spectrum,
    PrecursorList,
    Precursor,
    ChromatogramList,
    Other,
}

#[derive(Default)]
struct Spectrum {
    ms_level: Option<u64>,
    precursors: u32,
    first_precursor_names_selected_ion: bool,
}

/// Scans an intermediate from any buffered reader.
pub fn scan_intermediate_reader<R: BufRead>(
    reader: R,
    limits: MzmlScanLimits,
) -> Result<IntermediateFacts, OutputCheckRefusal> {
    let mut facts = IntermediateFacts::default();
    let mut stack: Vec<Tag> = Vec::new();
    let mut root_seen = false;
    let mut default_source: Option<String> = None;
    let mut spectrum: Option<Spectrum> = None;

    walk_xml(reader, &limits, |node| {
        let start = match node {
            Node::Open(start) => start,
            Node::Close => {
                if stack.pop() == Some(Tag::Spectrum)
                    && let Some(closed) = spectrum.take()
                {
                    let named = closed.first_precursor_names_selected_ion;
                    match closed.ms_level {
                        Some(1) => facts.ms1_spectra += 1,
                        Some(2) if named => {
                            facts.ms2_with_selected_ion += 1;
                            facts.above_ms1_with_selected_ion += 1;
                        }
                        Some(level) if level > 2 && named => facts.above_ms1_with_selected_ion += 1,
                        _ => {}
                    }
                }
                return Ok(());
            }
        };
        let local = start.local_name();
        if !root_seen {
            root_seen = true;
            if !matches!(local.as_ref(), b"mzML" | b"indexedmzML") {
                return Err(malformed(MzmlMalformedKind::UnexpectedRoot));
            }
            stack.push(Tag::Other);
            return Ok(());
        }
        let parent = stack.last().copied();
        let tag = match local.as_ref() {
            b"run" => {
                let [reference] = capture(start, &limits, [b"defaultSourceFileRef"])?;
                default_source = reference.map(|value| value.into_owned());
                Tag::Other
            }
            b"spectrumList" => Tag::SpectrumList,
            b"chromatogramList" => Tag::ChromatogramList,
            b"spectrum" if parent == Some(Tag::SpectrumList) => {
                if facts.spectra >= limits.max_spectra {
                    return Err(limit(MzmlLimitKind::Spectra));
                }
                let [reference] = capture(start, &limits, [b"sourceFileRef"])?;
                if let Some(reference) = reference
                    && default_source.as_deref() != Some(reference.as_ref())
                    && facts.first_non_default_source_file.is_none()
                {
                    facts.first_non_default_source_file = Some(facts.spectra);
                }
                facts.spectra += 1;
                spectrum = Some(Spectrum::default());
                Tag::Spectrum
            }
            b"chromatogram" if parent == Some(Tag::ChromatogramList) => {
                if facts.chromatograms >= limits.max_chromatograms {
                    return Err(limit(MzmlLimitKind::Chromatograms));
                }
                facts.chromatograms += 1;
                Tag::Other
            }
            b"cvParam" if parent == Some(Tag::Spectrum) => {
                let [accession, value] = capture(start, &limits, [b"accession", b"value"])?;
                if accession.as_deref().map(str::as_bytes) == Some(MS_LEVEL)
                    && let Some(current) = spectrum.as_mut()
                {
                    current.ms_level = value.as_deref().map(parse_u64_decimal).transpose()?;
                }
                Tag::Other
            }
            b"precursorList" if parent == Some(Tag::Spectrum) => Tag::PrecursorList,
            b"precursor" if parent == Some(Tag::PrecursorList) => {
                if let Some(current) = spectrum.as_mut() {
                    current.precursors = current.precursors.saturating_add(1);
                }
                Tag::Precursor
            }
            // Only a spectrum's precursor reaches `Tag::Precursor`, and the
            // writers read the first one alone.
            b"selectedIon" if stack.contains(&Tag::Precursor) => {
                if let Some(current) = spectrum.as_mut()
                    && current.precursors == 1
                {
                    current.first_precursor_names_selected_ion = true;
                }
                Tag::Other
            }
            _ => Tag::Other,
        };
        stack.push(tag);
        Ok(())
    })?;

    if !root_seen {
        return Err(malformed(MzmlMalformedKind::MissingRootElement));
    }
    Ok(facts)
}

#[cfg(test)]
mod tests {
    use super::super::tests::INTERMEDIATE;
    use super::*;
    use crate::mzml::UnsafeXmlKind;

    fn scan(document: &str) -> Result<IntermediateFacts, OutputCheckRefusal> {
        scan_intermediate_reader(document.as_bytes(), MzmlScanLimits::default())
    }

    #[test]
    fn the_selection_counts_mirror_the_writers() {
        let facts = scan(INTERMEDIATE).expect("fixture is mzML");
        assert_eq!(facts.spectra(), 3);
        assert_eq!(facts.chromatograms(), 1);
        assert_eq!(facts.ms1_spectra(), 1);
        // The MS3 spectrum's first precursor names no selected ion.
        assert_eq!(facts.above_ms1_with_selected_ion(), 1);
        assert_eq!(facts.ms2_with_selected_ion(), 1);
        assert_eq!(facts.first_non_default_source_file(), None);
    }

    #[test]
    fn a_chromatogram_precursor_is_not_a_spectrum_precursor() {
        let document = r#"<mzML><run id="r"><spectrumList count="1">
            <spectrum index="0" id="scan=1">
              <cvParam accession="MS:1000511" value="2"/>
            </spectrum></spectrumList>
            <chromatogramList count="1"><chromatogram index="0" id="SRM">
              <precursor><selectedIonList count="1"><selectedIon/></selectedIonList></precursor>
            </chromatogram></chromatogramList></run></mzML>"#;
        let facts = scan(document).expect("well-formed");
        assert_eq!(facts.ms2_with_selected_ion(), 0);
    }

    #[test]
    fn unsafe_and_malformed_intermediates_fail_closed() {
        assert_eq!(
            scan(r#"<!DOCTYPE mzML [<!ENTITY x "y">]><mzML/>"#),
            Err(MzmlScanError::Unsafe(UnsafeXmlKind::DoctypeDeclaration).into())
        );
        for undeclared in [
            "<mzML><run id=\"r\">&x;</run></mzML>",
            "<mzML><run defaultSourceFileRef=\"&x;\"/></mzML>",
        ] {
            assert_eq!(
                scan(undeclared),
                Err(MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity).into())
            );
        }
        assert_eq!(
            scan("<mzXML/>"),
            Err(malformed(MzmlMalformedKind::UnexpectedRoot))
        );
        assert_eq!(
            scan(""),
            Err(malformed(MzmlMalformedKind::MissingRootElement))
        );
        assert_eq!(
            scan("<mzML><run>"),
            Err(malformed(MzmlMalformedKind::NotWellFormed))
        );
        let bad_level = INTERMEDIATE.replace(r#"value="2""#, r#"value="two""#);
        assert_eq!(
            scan(&bad_level),
            Err(malformed(MzmlMalformedKind::InvalidNumber))
        );
    }

    #[test]
    fn every_limit_the_pass_reads_fails_closed() {
        let cases: [(MzmlScanLimits, MzmlLimitKind); 9] = [
            (
                MzmlScanLimits::default().with_max_document_bytes(64),
                MzmlLimitKind::DocumentBytes,
            ),
            (
                MzmlScanLimits::default().with_max_text_run_bytes(8),
                MzmlLimitKind::TextRunBytes,
            ),
            (
                MzmlScanLimits::default().with_max_depth(3),
                MzmlLimitKind::Depth,
            ),
            (
                MzmlScanLimits::default().with_max_elements(5),
                MzmlLimitKind::Elements,
            ),
            (
                MzmlScanLimits::default().with_max_attributes_per_element(1),
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
                MzmlScanLimits::default().with_max_spectra(1),
                MzmlLimitKind::Spectra,
            ),
            (
                MzmlScanLimits::default().with_max_chromatograms(0),
                MzmlLimitKind::Chromatograms,
            ),
        ];
        for (limits, expected) in cases {
            assert_eq!(
                scan_intermediate_reader(INTERMEDIATE.as_bytes(), limits),
                Err(limit(expected)),
                "{expected:?}"
            );
        }
    }

    /// The attribute limits hold on an element no visitor reads from, here
    /// the root: a caller's bound is the whole document's.
    #[test]
    fn attribute_limits_hold_on_an_element_nothing_captures() {
        let cases: [(&str, MzmlScanLimits, Result<(), OutputCheckRefusal>); 4] = [
            (
                r#"<mzML id="xx"/>"#,
                MzmlScanLimits::default().with_max_attribute_value_bytes(1),
                Err(limit(MzmlLimitKind::AttributeValueBytes)),
            ),
            (
                r#"<mzML a="1" b="2"/>"#,
                MzmlScanLimits::default().with_max_attributes_per_element(1),
                Err(limit(MzmlLimitKind::AttributesPerElement)),
            ),
            (
                r#"<mzML attribute="1"/>"#,
                MzmlScanLimits::default().with_max_name_bytes(4),
                Err(limit(MzmlLimitKind::NameBytes)),
            ),
            (
                r#"<mzML a="1" a="2"/>"#,
                MzmlScanLimits::default(),
                Err(malformed(MzmlMalformedKind::DuplicateAttribute)),
            ),
        ];
        for (document, limits, expected) in cases {
            assert_eq!(
                scan_intermediate_reader(document.as_bytes(), limits).map(|_| ()),
                expected,
                "{document}"
            );
        }
    }
}
