//! Small mzML 1.1 documents written in memory, for the preview suite and the
//! rendered tests' seed.
//!
//! Since ADR 0056 the spectrum table and the selected spectrum are read by the
//! project's own reader, so a fixture is a document rather than canned
//! `msaccess` text. Arrays are little-endian and uncompressed; only the
//! test-only [`native_spectrum`] reads a document, and nothing here is
//! reachable from a shipped build.

/// One stored array: its binary data type and its little-endian bytes.
pub(crate) struct FixtureArray {
    data_type: &'static str,
    bytes: Vec<u8>,
}

impl FixtureArray {
    pub(crate) fn f64s(values: &[f64]) -> Self {
        Self::of(
            "MS:1000523",
            values.iter().flat_map(|value| value.to_le_bytes()),
        )
    }

    #[cfg(test)]
    pub(crate) fn f32s(values: &[f32]) -> Self {
        Self::of(
            "MS:1000521",
            values.iter().flat_map(|value| value.to_le_bytes()),
        )
    }

    #[cfg(test)]
    pub(crate) fn i32s(values: &[i32]) -> Self {
        Self::of(
            "MS:1000519",
            values.iter().flat_map(|value| value.to_le_bytes()),
        )
    }

    #[cfg(test)]
    pub(crate) fn i64s(values: &[i64]) -> Self {
        Self::of(
            "MS:1000522",
            values.iter().flat_map(|value| value.to_le_bytes()),
        )
    }

    fn of(data_type: &'static str, bytes: impl Iterator<Item = u8>) -> Self {
        Self {
            data_type,
            bytes: bytes.collect(),
        }
    }

    fn element(&self, role: &str, unit: Option<&str>) -> String {
        let payload = base64(&self.bytes);
        format!(
            r#"<binaryDataArray encodedLength="{}">{}{}{}<binary>{payload}</binary></binaryDataArray>"#,
            payload.len(),
            cv(self.data_type, ""),
            cv("MS:1000576", ""),
            cv_unit(role, "", unit),
        )
    }
}

/// One spectrum, with the terms every table row requires.
pub(crate) struct FixtureSpectrum {
    pub(crate) id: String,
    pub(crate) ms_level: u32,
    pub(crate) retention_time: f64,
    /// The scan start time's unit accession, or none declared.
    pub(crate) retention_time_unit: Option<&'static str>,
    /// MS:1000127 or MS:1000128, or neither declared.
    pub(crate) representation: Option<&'static str>,
    pub(crate) base_peak_mz: f64,
    pub(crate) base_peak_intensity: f64,
    pub(crate) total_ion_current: f64,
    /// MS:1000528 and MS:1000527, or neither stated.
    pub(crate) observed_mz_range: Option<(f64, f64)>,
    /// One precursor's selected-ion m/z and intensity, either unstated.
    pub(crate) precursor: Option<(Option<f64>, Option<f64>)>,
    pub(crate) mz: FixtureArray,
    pub(crate) intensity: FixtureArray,
    pub(crate) mz_unit: Option<&'static str>,
    pub(crate) intensity_unit: Option<&'static str>,
    /// `defaultArrayLength`: the point count unless a test sets another.
    pub(crate) declared_length: usize,
}

impl FixtureSpectrum {
    /// A spectrum of 64-bit float points, declaring no unit and no
    /// representation.
    pub(crate) fn new(
        id: impl Into<String>,
        ms_level: u32,
        retention_time: f64,
        (base_peak_mz, base_peak_intensity): (f64, f64),
        total_ion_current: f64,
        points: &[(f64, f64)],
    ) -> Self {
        let (mz, intensity): (Vec<f64>, Vec<f64>) = points.iter().copied().unzip();
        Self {
            id: id.into(),
            ms_level,
            retention_time,
            retention_time_unit: None,
            representation: None,
            base_peak_mz,
            base_peak_intensity,
            total_ion_current,
            observed_mz_range: None,
            precursor: None,
            mz: FixtureArray::f64s(&mz),
            intensity: FixtureArray::f64s(&intensity),
            mz_unit: None,
            intensity_unit: None,
            declared_length: points.len(),
        }
    }

    fn element(&self, index: usize) -> String {
        let length = self.declared_length;
        let mut body = cv("MS:1000511", &self.ms_level.to_string());
        if let Some(representation) = self.representation {
            body.push_str(&cv(representation, ""));
        }
        body.push_str(&cv("MS:1000504", &self.base_peak_mz.to_string()));
        body.push_str(&cv("MS:1000505", &self.base_peak_intensity.to_string()));
        body.push_str(&cv("MS:1000285", &self.total_ion_current.to_string()));
        if let Some((low, high)) = self.observed_mz_range {
            body.push_str(&cv("MS:1000528", &low.to_string()));
            body.push_str(&cv("MS:1000527", &high.to_string()));
        }
        body.push_str(&format!(
            r#"<scanList count="1">{}<scan>{}</scan></scanList>"#,
            cv("MS:1000795", ""),
            cv_unit(
                "MS:1000016",
                &self.retention_time.to_string(),
                self.retention_time_unit
            ),
        ));
        if let Some((mz, intensity)) = self.precursor {
            let mut ion = mz.map_or_else(String::new, |mz| cv("MS:1000744", &mz.to_string()));
            if let Some(intensity) = intensity {
                ion.push_str(&cv("MS:1000042", &intensity.to_string()));
            }
            body.push_str(&format!(
                r#"<precursorList count="1"><precursor><selectedIonList count="1"><selectedIon>{ion}</selectedIon></selectedIonList></precursor></precursorList>"#
            ));
        }
        body.push_str(&format!(
            r#"<binaryDataArrayList count="2">{}{}</binaryDataArrayList>"#,
            self.mz.element("MS:1000514", self.mz_unit),
            self.intensity.element("MS:1000515", self.intensity_unit),
        ));
        format!(
            r#"
    <spectrum index="{index}" id="{}" defaultArrayLength="{length}">{body}</spectrum>"#,
            self.id
        )
    }
}

/// An mzML 1.1 document holding these spectra, in this order.
pub(crate) fn document(spectra: &[FixtureSpectrum]) -> String {
    let body: String = spectra
        .iter()
        .enumerate()
        .map(|(index, spectrum)| spectrum.element(index))
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0" id="fixture">
  <cvList count="2"><cv id="MS" fullName="PSI-MS" URI="https://example.invalid/psi-ms.obo"/><cv id="UO" fullName="Unit Ontology" URI="https://example.invalid/uo.obo"/></cvList>
  <run id="fixture-run">
  <spectrumList count="{}" defaultDataProcessingRef="dp">{body}
  </spectrumList>
  </run>
</mzML>
"#,
        spectra.len()
    )
}

/// One spectrum read by the production reader from an in-memory document
/// that declares this representation and these array units: index 0,
/// `scan=1`, retention time 0.5 with no unit declared.
#[cfg(test)]
pub(crate) fn native_spectrum(
    representation: &'static str,
    units: (Option<&'static str>, Option<&'static str>),
    points: &[(f64, f64)],
) -> mscanvas_proteowizard::SelectedSpectrumResult {
    use mscanvas_proteowizard::{
        MzmlScanLimits, SelectedSpectrumResult, read_selected_spectrum_from,
        read_spectrum_table_from,
    };
    use std::io::Cursor;

    let mut fixture = FixtureSpectrum::new("scan=1", 1, 0.5, points[1], 1_010.0, points);
    fixture.representation = Some(representation);
    (fixture.mz_unit, fixture.intensity_unit) = units;
    let text = document(&[fixture]);
    let table = read_spectrum_table_from(Cursor::new(text.as_bytes()), MzmlScanLimits::default())
        .expect("the document opens");
    SelectedSpectrumResult::from_native(
        read_selected_spectrum_from(Cursor::new(text.as_bytes()), &table, 0)
            .expect("the spectrum decodes"),
    )
}

fn cv(accession: &str, value: &str) -> String {
    cv_unit(accession, value, None)
}

fn cv_unit(accession: &str, value: &str, unit: Option<&str>) -> String {
    let unit = unit.map_or_else(String::new, |unit| format!(r#" unitAccession="{unit}""#));
    let reference = accession.split(':').next().unwrap_or("MS");
    format!(
        r#"<cvParam cvRef="{reference}" accession="{accession}" name="term" value="{value}"{unit}/>"#
    )
}

/// Standard base64 with padding, which is all an mzML payload needs.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let group = chunk
            .iter()
            .enumerate()
            .fold(0_u32, |group, (position, byte)| {
                group | (u32::from(*byte) << (16 - 8 * position))
            });
        for position in 0..4 {
            if position <= chunk.len() {
                let sextet = (group >> (18 - 6 * position)) & 63;
                encoded.push(char::from(ALPHABET[sextet as usize]));
            } else {
                encoded.push('=');
            }
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::base64;

    #[test]
    fn base64_pads_like_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0x00]), "//4A");
    }
}
