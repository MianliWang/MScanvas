//! Small generated fixtures and the slice-1 probes of ADR 0056 (decision 9).

use std::io::{Cursor, Write as _};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use flate2::Compression;
use flate2::write::ZlibEncoder;

use super::*;

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

fn cv(accession: &str, name: &str, value: &str) -> String {
    format!(r#"<cvParam cvRef="MS" accession="{accession}" name="{name}" value="{value}"/>"#)
}

fn cvu(accession: &str, name: &str, value: &str, unit: &str) -> String {
    format!(
        r#"<cvParam cvRef="MS" accession="{accession}" name="{name}" value="{value}" unitAccession="{unit}"/>"#
    )
}

fn mz_term() -> String {
    cvu("MS:1000514", "m/z array", "", "MS:1000040")
}

fn intensity_term() -> String {
    cvu("MS:1000515", "intensity array", "", "MS:1000131")
}

const F32: (&str, &str) = ("MS:1000521", "32-bit float");
const F64: (&str, &str) = ("MS:1000523", "64-bit float");
const I32: (&str, &str) = ("MS:1000519", "32-bit integer");
const I64: (&str, &str) = ("MS:1000522", "64-bit integer");
const ZLIB: (&str, &str) = ("MS:1000574", "zlib compression");
const NONE: (&str, &str) = ("MS:1000576", "no compression");

fn term((accession, name): (&str, &str)) -> String {
    cv(accession, name, "")
}

fn le_f64(values: &[f64]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn le_f32(values: &[f32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn le_i64(values: &[i64]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn zlib(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).expect("in memory");
    encoder.finish().expect("in memory")
}

fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

/// One `binaryDataArray` from its terms and its base64 payload.
fn array(terms: &[String], payload: &str) -> String {
    format!(
        r#"<binaryDataArray encodedLength="{}">{}<binary>{payload}</binary></binaryDataArray>"#,
        payload.len(),
        terms.concat()
    )
}

fn mz_array(values: &[f64]) -> String {
    array(
        &[term(F64), term(ZLIB), mz_term()],
        &b64(&zlib(&le_f64(values))),
    )
}

fn intensity_array(values: &[f32]) -> String {
    array(
        &[term(F32), term(NONE), intensity_term()],
        &b64(&le_f32(values)),
    )
}

fn scan(minutes: &str) -> String {
    format!(
        "<scanList count=\"1\">{}<scan>{}<scanWindowList count=\"1\"><scanWindow>{}</scanWindow></scanWindowList></scan></scanList>",
        cv("MS:1000795", "no combination", ""),
        cvu("MS:1000016", "scan start time", minutes, "UO:0000031"),
        cv("MS:1000501", "scan window lower limit", "100"),
    )
}

/// Base peak, TIC and the observed m/z range: the terms every row requires.
fn summary_terms() -> String {
    [
        cv("MS:1000504", "base peak m/z", "445.12"),
        cv("MS:1000505", "base peak intensity", "1200.5"),
        cv("MS:1000285", "total ion current", "2400.25"),
        cv("MS:1000528", "lowest observed m/z", "400.5"),
        cv("MS:1000527", "highest observed m/z", "500.75"),
    ]
    .concat()
}

fn spectrum(index: u64, id: &str, length: u64, body: &str) -> String {
    format!(
        "\n      <spectrum index=\"{index}\" id=\"{id}\" defaultArrayLength=\"{length}\">{body}</spectrum>"
    )
}

/// An MS1 profile spectrum with a 64-bit zlib m/z array and a 32-bit
/// uncompressed intensity array.
fn ms1(index: u64, arrays: &[String]) -> String {
    let body = format!(
        "{}{}{}{}<binaryDataArrayList count=\"{}\">{}</binaryDataArrayList>",
        cv("MS:1000511", "ms level", "1"),
        cv("MS:1000128", "profile spectrum", ""),
        summary_terms(),
        scan("5.9"),
        arrays.len(),
        arrays.concat()
    );
    spectrum(index, &format!("scan={}", index + 19), 3, &body)
}

fn ms1_default(index: u64) -> String {
    ms1(
        index,
        &[
            mz_array(&[400.5, 445.12, 500.75]),
            intensity_array(&[10.0, 1200.5, 0.25]),
        ],
    )
}

/// An MS2 spectrum whose MS level and representation come only from a param
/// group, with two precursors, the second without a selected-ion intensity.
fn ms2(index: u64) -> String {
    let precursors = format!(
        "<precursorList count=\"2\">\
         <precursor><selectedIonList count=\"2\"><selectedIon>{}{}</selectedIon><selectedIon>{}</selectedIon></selectedIonList></precursor>\
         <precursor><selectedIonList count=\"1\"><selectedIon>{}</selectedIon></selectedIonList></precursor>\
         </precursorList>",
        cvu("MS:1000744", "selected ion m/z", "445.3", "MS:1000040"),
        cv("MS:1000042", "peak intensity", "880"),
        cvu("MS:1000744", "selected ion m/z", "999.9", "MS:1000040"),
        cvu("MS:1000744", "selected ion m/z", "512.25", "MS:1000040"),
    );
    let scan = format!(
        "<scanList count=\"1\"><scan>{}</scan></scanList>",
        cvu("MS:1000016", "scan start time", "354", "UO:0000010"),
    );
    let arrays = [
        array(
            &[term(F64), term(NONE), mz_term()],
            &b64(&le_f64(&[150.0, 175.5])),
        ),
        array(
            &[term(F64), term(ZLIB), intensity_term()],
            &b64(&zlib(&le_f64(&[3.0, 4.0]))),
        ),
    ];
    let body = format!(
        "<referenceableParamGroupRef ref=\"ms2\"/>{}{scan}{precursors}<binaryDataArrayList count=\"2\">{}</binaryDataArrayList>",
        summary_terms(),
        arrays.concat()
    );
    spectrum(index, &format!("scan={}", index + 19), 2, &body)
}

fn groups() -> String {
    format!(
        "<referenceableParamGroupList count=\"1\"><referenceableParamGroup id=\"ms2\">{}{}</referenceableParamGroup></referenceableParamGroupList>",
        cv("MS:1000511", "ms level", "2"),
        cv("MS:1000127", "centroid spectrum", ""),
    )
}

fn document_with(groups: &str, spectra: &[String]) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0" id="fixture">
  <cvList count="1"><cv id="MS" fullName="PSI-MS" URI="https://example.invalid/psi-ms.obo"/></cvList>
  <fileDescription><fileContent>{}{}</fileContent></fileDescription>
  {groups}
  <run id="R1">
    <spectrumList count="{}" defaultDataProcessingRef="dp">{}
    </spectrumList>
    <chromatogramList count="1"><chromatogram index="0" id="TIC" defaultArrayLength="1"><binaryDataArrayList count="1">{}</binaryDataArrayList></chromatogram></chromatogramList>
  </run>
</mzML>
"#,
        // Aggregate markers that must not leak into a spectrum.
        cv("MS:1000128", "profile spectrum", ""),
        cv("MS:1000127", "centroid spectrum", ""),
        spectra.len(),
        spectra.concat(),
        array(&[term(F64), term(NONE), mz_term()], "not base64 at all"),
    )
}

fn document(spectra: &[String]) -> String {
    document_with(&groups(), spectra)
}

fn base() -> String {
    document(&[ms1_default(0), ms2(1)])
}

/// The same document with every element in a prefixed namespace, like PX.3's
/// `prefixed` case.
fn prefixed(document: &str, prefix: &str) -> String {
    let mut out = String::new();
    let mut chars = document.chars().peekable();
    while let Some(character) = chars.next() {
        out.push(character);
        if character == '<' {
            if chars.peek() == Some(&'/') {
                out.push('/');
                chars.next();
            }
            if chars.peek().is_some_and(char::is_ascii_alphabetic) {
                out.push_str(prefix);
                out.push(':');
            }
        }
    }
    out.replace("xmlns=\"", &format!("xmlns:{prefix}=\""))
}

fn table(document: &str) -> Result<MzmlSpectrumTable, MzmlOpenError> {
    read_spectrum_table_from(Cursor::new(document.as_bytes()), MzmlScanLimits::default())
}

fn selected(document: &str, index: u64) -> Result<MzmlSelectedSpectrum, MzmlSpectrumError> {
    let table = table(document).expect("the table opens");
    read_selected_spectrum_from(Cursor::new(document.as_bytes()), &table, index)
}

/// The refusal of spectrum 0 whose arrays are `arrays` and whose declared
/// length is `length`.
fn ms1_refusal(length: u64, arrays: &[String]) -> MzmlSpectrumError {
    let spectrum = ms1(0, arrays).replace(
        "defaultArrayLength=\"3\"",
        &format!("defaultArrayLength=\"{length}\""),
    );
    selected(&document(&[spectrum]), 0).expect_err("the spectrum is refused")
}

const fn refused(role: ArrayRole, problem: ArrayProblem) -> MzmlSpectrumError {
    MzmlSpectrumError::Array { role, problem }
}

// ---------------------------------------------------------------------------
// What the reader reads
// ---------------------------------------------------------------------------

#[test]
fn the_table_reads_every_row_with_its_units_and_decodes_nothing() {
    let table = table(&base()).expect("opens");
    assert_eq!(table.declared_spectrum_count(), Some(2));
    let [ms1, ms2] = table.rows() else {
        panic!("two rows");
    };

    assert_eq!(ms1.identity().index(), 0);
    assert_eq!(ms1.identity().scan_number(), Some(19));
    assert_eq!(ms1.ms_level(), 1);
    // The aggregate `fileContent` markers do not reach a spectrum.
    assert_eq!(ms1.representation(), MzmlRepresentation::Profile);
    assert_eq!(ms1.retention_time().value(), 5.9);
    assert_eq!(ms1.retention_time().unit(), RetentionTimeUnit::Minute);
    assert_eq!(ms1.base_peak_mz(), 445.12);
    assert_eq!(ms1.base_peak_intensity(), 1200.5);
    assert_eq!(ms1.total_ion_current(), 2400.25);
    assert_eq!(ms1.lowest_observed_mz(), Some(400.5));
    assert_eq!(ms1.highest_observed_mz(), Some(500.75));
    assert_eq!(ms1.default_array_length(), Some(3));
    assert_eq!(ms1.precursor_count(), 0);
    assert_eq!(ms1.first_precursor(), None);

    // MS level and representation reach this row only through its group.
    assert_eq!(ms2.ms_level(), 2);
    assert_eq!(ms2.representation(), MzmlRepresentation::Centroid);
    assert_eq!(ms2.retention_time().unit(), RetentionTimeUnit::Second);
    assert_eq!(ms2.precursor_count(), 2);
    let precursor = ms2.first_precursor().expect("first precursor");
    // The first selected ion, not the second.
    assert_eq!(precursor.selected_ion_mz(), Some(445.3));
    assert_eq!(precursor.selected_ion_intensity(), Some(880.0));
}

#[test]
fn a_selected_spectrum_holds_the_stored_values_with_their_units_and_widths() {
    let ms1 = selected(&base(), 0).expect("decodes");
    assert_eq!(ms1.mz().values(), [400.5, 445.12, 500.75]);
    assert_eq!(ms1.mz().stored_as(), Some(BinaryDataType::Float64));
    assert_eq!(
        ms1.mz().unit(),
        &ArrayUnit::Declared("MS:1000040".to_owned())
    );
    // 32-bit values widen exactly; 0.25 and 1200.5 are exact in f32.
    assert_eq!(ms1.intensity().values(), [10.0, 1200.5, 0.25]);
    assert_eq!(ms1.intensity().stored_as(), Some(BinaryDataType::Float32));
    assert_eq!(
        ms1.intensity().unit(),
        &ArrayUnit::Declared("MS:1000131".to_owned())
    );
    assert_eq!(ms1.row(), &table(&base()).expect("opens").rows()[0]);

    let ms2 = selected(&base(), 1).expect("decodes");
    assert_eq!(ms2.mz().values(), [150.0, 175.5]);
    assert_eq!(ms2.intensity().values(), [3.0, 4.0]);
    // Every precursor, and an unstated intensity stays unstated.
    let precursors = ms2.precursors();
    assert_eq!(precursors.len(), 2);
    assert_eq!(precursors[1].selected_ion_mz(), Some(512.25));
    assert_eq!(precursors[1].selected_ion_intensity(), None);
}

#[test]
fn a_32_bit_value_widens_to_exactly_its_stored_value() {
    let stored = 0.1_f32;
    let spectrum = ms1(
        0,
        &[
            mz_array(&[1.0, 2.0, 3.0]),
            intensity_array(&[stored, 1.0, 2.0]),
        ],
    );
    let read = selected(&document(&[spectrum]), 0).expect("decodes");
    assert_eq!(read.intensity().values()[0], f64::from(stored));
    assert_ne!(read.intensity().values()[0], 0.1_f64);
}

#[test]
fn a_namespace_prefixed_document_reads_like_its_unprefixed_control() {
    let control = base();
    let prefixed = prefixed(&control, "ms");
    assert!(prefixed.contains("<ms:spectrum ") && prefixed.contains("xmlns:ms="));

    let control_table = table(&control).expect("control opens");
    let prefixed_table = table(&prefixed).expect("prefixed opens");
    assert_eq!(control_table.rows(), prefixed_table.rows());
    for index in 0..2 {
        assert_eq!(
            selected(&control, index).expect("control decodes"),
            selected(&prefixed, index).expect("prefixed decodes"),
        );
    }
}

#[test]
fn elements_outside_the_mzml_namespace_are_not_mzml() {
    // A foreign `spectrum` is neither a row nor part of one.
    let foreign = r#"<x:spectrum xmlns:x="urn:other" index="0" id="foreign"/>"#;
    let document = base().replace(
        "<spectrumList count=\"2\" defaultDataProcessingRef=\"dp\">",
        &format!("<spectrumList count=\"2\" defaultDataProcessingRef=\"dp\">{foreign}"),
    );
    assert_eq!(table(&document).expect("opens").rows().len(), 2);

    // A root with no namespace is not mzML.
    let unbound = base().replace(" xmlns=\"http://psi.hupo.org/ms/mzml\"", "");
    assert_eq!(
        table(&unbound).expect_err("refused"),
        MzmlOpenError::Scan(MzmlScanError::Malformed(MzmlMalformedKind::UnexpectedRoot))
    );
}

#[test]
fn an_indexed_document_with_a_bom_is_read_without_trusting_its_index() {
    let plain = base();
    let body = plain
        .strip_prefix("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n")
        .expect("declaration");
    // An index whose offsets are wrong on purpose.
    let indexed = format!(
        "\u{feff}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<indexedmzML xmlns=\"http://psi.hupo.org/ms/mzml\">\n{}<indexList count=\"1\"><index name=\"spectrum\"><offset idRef=\"scan=19\">7</offset><offset idRef=\"scan=20\">9</offset></index></indexList><indexListOffset>3</indexListOffset><fileChecksum>0</fileChecksum></indexedmzML>\n",
        body.replace(" xmlns=\"http://psi.hupo.org/ms/mzml\"", "")
    );
    let indexed_table = table(&indexed).expect("opens");
    assert_eq!(indexed_table.rows(), table(&plain).expect("opens").rows());
    for index in 0..2 {
        assert_eq!(
            selected(&indexed, index).expect("decodes"),
            selected(&plain, index).expect("decodes")
        );
    }
}

#[test]
fn integer_arrays_widen_exactly_or_are_refused() {
    let int_array = |data_type, bytes: Vec<u8>| {
        array(
            &[term(data_type), term(NONE), intensity_term()],
            &b64(&bytes),
        )
    };
    let mz = mz_array(&[1.0, 2.0, 3.0]);

    let i32_values: Vec<u8> = [-7_i32, 0, i32::MAX]
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect();
    let read = selected(
        &document(&[ms1(0, &[mz.clone(), int_array(I32, i32_values)])]),
        0,
    )
    .expect("decodes");
    assert_eq!(read.intensity().values(), [-7.0, 0.0, f64::from(i32::MAX)]);
    assert_eq!(
        read.intensity().stored_as(),
        Some(BinaryDataType::Integer32)
    );

    // 2^53, 2^60 and -2^63 are exact in f64.
    let exact = le_i64(&[1 << 53, 1 << 60, i64::MIN]);
    let read = selected(
        &document(&[ms1(0, &[mz.clone(), int_array(I64, exact)])]),
        0,
    )
    .expect("decodes");
    assert_eq!(
        read.intensity().values(),
        [
            9_007_199_254_740_992.0,
            1_152_921_504_606_846_976.0,
            -9_223_372_036_854_775_808.0
        ]
    );

    for inexact in [
        (1_i64 << 53) + 1,
        -(1_i64 << 53) - 1,
        i64::MAX,
        i64::MAX - 511,
    ] {
        assert_eq!(
            ms1_refusal(3, &[mz.clone(), int_array(I64, le_i64(&[0, inexact, 0]))]),
            refused(ArrayRole::Intensity, ArrayProblem::IntegerNotExact),
            "{inexact}"
        );
    }
}

#[test]
fn a_non_finite_value_refuses_the_spectrum() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            ms1_refusal(
                3,
                &[
                    mz_array(&[1.0, value, 3.0]),
                    intensity_array(&[1.0, 2.0, 3.0])
                ]
            ),
            refused(ArrayRole::Mz, ArrayProblem::NonFiniteValue)
        );
    }
    assert_eq!(
        ms1_refusal(
            3,
            &[
                mz_array(&[1.0, 2.0, 3.0]),
                intensity_array(&[f32::NAN, 2.0, 3.0])
            ]
        ),
        refused(ArrayRole::Intensity, ArrayProblem::NonFiniteValue)
    );
}

#[test]
fn a_refused_spectrum_leaves_the_open_and_the_others_standing() {
    let bad = ms1(
        0,
        &[
            mz_array(&[1.0, f64::NAN, 3.0]),
            intensity_array(&[1.0, 2.0, 3.0]),
        ],
    );
    let document = document(&[bad, ms2(1)]);
    let table = table(&document).expect("the open stands");
    let read = |index| read_selected_spectrum_from(Cursor::new(document.as_bytes()), &table, index);
    assert!(read(0).is_err());
    assert_eq!(read(1).expect("decodes").mz().values(), [150.0, 175.5]);
}

// ---------------------------------------------------------------------------
// Decode caps (decision 2)
// ---------------------------------------------------------------------------

#[test]
fn a_declared_length_of_two_to_the_40_is_refused_before_anything_is_reserved() {
    assert_eq!(
        ms1_refusal(1 << 40, &[mz_array(&[1.0]), intensity_array(&[1.0])]),
        refused(ArrayRole::Mz, ArrayProblem::PointCapExceeded)
    );
    // An array's own `arrayLength` is held to the same cap.
    let own_length = mz_array(&[1.0]).replace(
        "<binaryDataArray ",
        &format!("<binaryDataArray arrayLength=\"{}\" ", u64::MAX),
    );
    assert_eq!(
        ms1_refusal(1, &[own_length, intensity_array(&[1.0])]),
        refused(ArrayRole::Mz, ArrayProblem::PointCapExceeded)
    );
    assert_eq!(
        ms1_refusal(
            MAX_DECODED_ARRAY_POINTS + 1,
            &[mz_array(&[1.0]), intensity_array(&[1.0])]
        ),
        refused(ArrayRole::Mz, ArrayProblem::PointCapExceeded)
    );
}

#[test]
fn a_zlib_stream_of_zeros_at_the_cap_stops_one_byte_past_the_declared_length() {
    // Declared exactly at the point cap, 64-bit, so the caps admit it; the
    // stream inflates past that, and the inflate stops at declared + 1.
    let declared = usize::try_from(MAX_DECODED_ARRAY_POINTS * 8).expect("fits");
    let zeros = vec![0_u8; 1024 * 1024];
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    for _ in 0..(declared / zeros.len() + 1) {
        encoder.write_all(&zeros).expect("in memory");
    }
    let bomb = b64(&encoder.finish().expect("in memory"));
    let mz = array(&[term(F64), term(ZLIB), mz_term()], &bomb);
    assert_eq!(
        ms1_refusal(MAX_DECODED_ARRAY_POINTS, &[mz, intensity_array(&[1.0])]),
        refused(ArrayRole::Mz, ArrayProblem::DecodedLongerThanDeclared)
    );

    // The spike's shape, a small declared length over many zeros, does not
    // get as far as the inflate: its base64 alone is over the bound.
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    for _ in 0..8 {
        encoder.write_all(&zeros).expect("in memory");
    }
    let mz = array(
        &[term(F64), term(ZLIB), mz_term()],
        &b64(&encoder.finish().expect("in memory")),
    );
    assert_eq!(
        ms1_refusal(3, &[mz, intensity_array(&[1.0, 2.0, 3.0])]),
        refused(ArrayRole::Mz, ArrayProblem::EncodedTextOverBound)
    );
}

#[test]
fn base64_text_longer_than_the_declared_length_allows_is_refused_unread() {
    let long = "A".repeat(64 * 1024);
    let mz = array(&[term(F64), term(NONE), mz_term()], &long);
    assert_eq!(
        ms1_refusal(1, &[mz, intensity_array(&[1.0])]),
        refused(ArrayRole::Mz, ArrayProblem::EncodedTextOverBound)
    );
}

#[test]
fn the_caps_and_their_bound_are_checked_arithmetic() {
    assert_eq!(encoded_bound(u64::MAX, true), None);
    assert_eq!(encoded_bound(u64::MAX, false), None);
    let largest = encoded_bound(MAX_DECODED_ARRAY_BYTES, true).expect("bounded");
    assert!(largest < MzmlScanLimits::default().max_text_run_bytes);
}

// ---------------------------------------------------------------------------
// Spectrum-level refusals (decision 1)
// ---------------------------------------------------------------------------

#[test]
fn compression_other_than_zlib_or_none_is_refused_by_kind() {
    let payload = b64(&le_f64(&[1.0, 2.0, 3.0]));
    let mz = |compression: &[String]| {
        let mut terms = vec![term(F64), mz_term()];
        terms.extend_from_slice(compression);
        array(&terms, &payload)
    };
    let intensity = intensity_array(&[1.0, 2.0, 3.0]);
    let cases = [
        (
            vec![cv(
                "MS:1002312",
                "MS-Numpress linear prediction compression",
                "",
            )],
            ArrayProblem::Numpress,
        ),
        (
            vec![cv(
                "MS:1002746",
                "MS-Numpress linear prediction compression followed by zlib compression",
                "",
            )],
            ArrayProblem::Numpress,
        ),
        (
            vec![
                term(ZLIB),
                cv("MS:1002313", "MS-Numpress positive integer compression", ""),
            ],
            ArrayProblem::Numpress,
        ),
        (
            vec![cv(
                "MS:1003089",
                "truncation, delta prediction and zlib compression",
                "",
            )],
            ArrayProblem::TruncationOrPrediction,
        ),
        (
            vec![cv("MS:1009999", "zstd compression", "")],
            ArrayProblem::CompressionUnrecognized,
        ),
        (vec![], ArrayProblem::CompressionMissing),
        (
            vec![term(ZLIB), term(NONE)],
            ArrayProblem::CompressionStatedTwice,
        ),
    ];
    for (compression, problem) in cases {
        assert_eq!(
            ms1_refusal(3, &[mz(&compression), intensity.clone()]),
            refused(ArrayRole::Mz, problem),
            "{compression:?}"
        );
    }
}

#[test]
fn a_binary_data_type_must_be_stated_once_and_be_supported() {
    let payload = b64(&le_f64(&[1.0, 2.0, 3.0]));
    let intensity = intensity_array(&[1.0, 2.0, 3.0]);
    let cases = [
        (vec![], ArrayProblem::DataTypeMissing),
        (
            vec![term(F64), term(F32)],
            ArrayProblem::DataTypeStatedTwice,
        ),
        (
            vec![cv("MS:1000520", "16-bit float", "")],
            ArrayProblem::DataTypeUnsupported,
        ),
    ];
    for (data_type, problem) in cases {
        let mut terms = data_type.clone();
        terms.extend([term(NONE), mz_term()]);
        assert_eq!(
            ms1_refusal(3, &[array(&terms, &payload), intensity.clone()]),
            refused(ArrayRole::Mz, problem),
            "{data_type:?}"
        );
    }
}

#[test]
fn a_decoded_length_must_equal_the_declared_length_either_way() {
    let intensity = intensity_array(&[1.0, 2.0, 3.0]);
    for (values, problem) in [
        (vec![1.0, 2.0], ArrayProblem::DecodedShorterThanDeclared),
        (
            vec![1.0, 2.0, 3.0, 4.0],
            ArrayProblem::DecodedLongerThanDeclared,
        ),
    ] {
        // Uncompressed and zlib alike.
        let plain = array(&[term(F64), term(NONE), mz_term()], &b64(&le_f64(&values)));
        assert_eq!(
            ms1_refusal(3, &[plain, intensity.clone()]),
            refused(ArrayRole::Mz, problem)
        );
        assert_eq!(
            ms1_refusal(3, &[mz_array(&values), intensity.clone()]),
            refused(ArrayRole::Mz, problem)
        );
    }
    // Bytes that are not a whole number of values.
    let ragged = array(&[term(F64), term(NONE), mz_term()], &b64(&[0_u8; 23]));
    assert_eq!(
        ms1_refusal(3, &[ragged, intensity.clone()]),
        refused(ArrayRole::Mz, ArrayProblem::DecodedShorterThanDeclared)
    );
    // An empty payload holds no points.
    let empty = array(&[term(F64), term(ZLIB), mz_term()], "");
    assert_eq!(
        ms1_refusal(3, &[empty, intensity]),
        refused(ArrayRole::Mz, ArrayProblem::DecodedShorterThanDeclared)
    );
}

#[test]
fn corrupt_base64_and_zlib_are_refused() {
    let intensity = intensity_array(&[1.0, 2.0, 3.0]);
    let good = zlib(&le_f64(&[1.0, 2.0, 3.0]));
    // A flipped header and a flipped checksum. A flip inside the deflate data
    // may still inflate, and is then the length check's or nobody's to catch.
    let mut header = good.clone();
    header[0] ^= 0xff;
    let mut checksum = good.clone();
    *checksum.last_mut().expect("checksum") ^= 0xff;
    let mut trailing = good.clone();
    trailing.extend_from_slice(b"extra");
    let cases = [
        (b64(&good).replace('A', "*"), ArrayProblem::CorruptBase64),
        ("QUJD&#65;".to_owned(), ArrayProblem::CorruptBase64),
        (b64(&good[..good.len() / 2]), ArrayProblem::CorruptZlib),
        (b64(&header), ArrayProblem::CorruptZlib),
        (b64(&checksum), ArrayProblem::CorruptZlib),
        (b64(&trailing), ArrayProblem::CorruptZlib),
        (b64(&le_f64(&[1.0, 2.0, 3.0])), ArrayProblem::CorruptZlib),
    ];
    for (payload, problem) in cases {
        let mz = array(&[term(F64), term(ZLIB), mz_term()], &payload);
        assert_eq!(
            ms1_refusal(3, &[mz, intensity.clone()]),
            refused(ArrayRole::Mz, problem),
            "{payload}"
        );
    }
}

#[test]
fn base64_with_line_breaks_decodes() {
    let encoded = b64(&zlib(&le_f64(&[1.0, 2.0, 3.0])));
    let wrapped: String = encoded
        .as_bytes()
        .chunks(8)
        .map(|chunk| format!("{}\r\n  ", String::from_utf8_lossy(chunk)))
        .collect();
    let mz = array(&[term(F64), term(ZLIB), mz_term()], &wrapped);
    let spectrum = ms1(0, &[mz, intensity_array(&[1.0, 2.0, 3.0])]);
    let read = selected(&document(&[spectrum]), 0).expect("decodes");
    assert_eq!(read.mz().values(), [1.0, 2.0, 3.0]);
}

#[test]
fn which_array_is_which_must_be_unambiguous() {
    let intensity = intensity_array(&[1.0, 2.0, 3.0]);
    let mz = mz_array(&[1.0, 2.0, 3.0]);

    assert_eq!(
        ms1_refusal(3, std::slice::from_ref(&intensity)),
        MzmlSpectrumError::MissingArray(ArrayRole::Mz)
    );
    assert_eq!(
        ms1_refusal(3, &[mz.clone(), intensity.clone(), mz.clone()]),
        MzmlSpectrumError::DuplicateArray(ArrayRole::Mz)
    );
    let both = array(
        &[term(F64), term(NONE), mz_term(), intensity_term()],
        &b64(&le_f64(&[1.0, 2.0, 3.0])),
    );
    assert_eq!(
        ms1_refusal(3, &[both, intensity.clone()]),
        MzmlSpectrumError::ArrayWithBothRoles
    );
    let two_points =
        mz_array(&[1.0, 2.0]).replace("<binaryDataArray ", "<binaryDataArray arrayLength=\"2\" ");
    assert_eq!(
        ms1_refusal(3, &[two_points, intensity.clone()]),
        MzmlSpectrumError::ArrayLengthsDiffer
    );
    let late = mz.replace("</binary>", &format!("</binary>{}", term(F32)));
    assert_eq!(
        ms1_refusal(3, &[late, intensity.clone()]),
        MzmlSpectrumError::TermAfterPayload
    );
    let conflicting = mz.replace(
        &mz_term(),
        &format!(
            "{}{}",
            mz_term(),
            cvu("MS:1000514", "m/z array", "", "UO:0000221")
        ),
    );
    assert_eq!(
        ms1_refusal(3, &[conflicting, intensity.clone()]),
        refused(ArrayRole::Mz, ArrayProblem::ConflictingTerm)
    );

    // An array this reader does not decode is not judged: it may conflict, and
    // its payload may be anything.
    let other = format!(
        "<binaryDataArray encodedLength=\"3\">{}{}{}<binary>???</binary>{}</binaryDataArray>",
        term(F64),
        cv("MS:1000786", "non-standard data array", "a"),
        cv("MS:1000786", "non-standard data array", "b"),
        term(F32),
    );
    let read = selected(&document(&[ms1(0, &[mz, other, intensity])]), 0).expect("decodes");
    assert_eq!(read.mz().values(), [1.0, 2.0, 3.0]);
}

#[test]
fn a_spectrum_declaring_no_points_may_omit_its_arrays() {
    let spectrum = ms1(0, &[]).replace("defaultArrayLength=\"3\"", "defaultArrayLength=\"0\"");
    let read = selected(&document(&[spectrum]), 0).expect("reads");
    assert!(read.mz().values().is_empty() && read.intensity().values().is_empty());
    assert_eq!(read.mz().stored_as(), None);

    // Declared zero with empty payloads under zlib is zero points too.
    let empty = |role: String| array(&[term(F64), term(ZLIB), role], "");
    let spectrum = ms1(0, &[empty(mz_term()), empty(intensity_term())])
        .replace("defaultArrayLength=\"3\"", "defaultArrayLength=\"0\"");
    let read = selected(&document(&[spectrum]), 0).expect("reads");
    assert_eq!(read.mz().stored_as(), Some(BinaryDataType::Float64));
    assert!(read.mz().values().is_empty());
}

#[test]
fn a_random_read_that_lands_on_another_spectrum_is_refused() {
    let document = base();
    let table = table(&document).expect("opens");

    // The same bytes with the second spectrum's native ID changed in place,
    // as if the file were rewritten between the open and the read.
    let changed = document.replacen("id=\"scan=20\"", "id=\"scan=21\"", 1);
    assert_eq!(changed.len(), document.len());
    assert_eq!(
        read_selected_spectrum_from(Cursor::new(changed.as_bytes()), &table, 1),
        Err(MzmlSpectrumError::NotAsRecorded)
    );
    // Shifted bytes put the offset somewhere that is not a spectrum start.
    let shifted = format!("  {document}");
    assert_eq!(
        read_selected_spectrum_from(Cursor::new(shifted.as_bytes()), &table, 1),
        Err(MzmlSpectrumError::NotAsRecorded)
    );
    assert_eq!(
        read_selected_spectrum_from(Cursor::new(document.as_bytes()), &table, 2),
        Err(MzmlSpectrumError::NotInTable)
    );
}

#[test]
fn a_random_read_checks_element_names_as_strictly_as_a_full_pass() {
    let document = base();
    let table = table(&document).expect("opens");
    // The second spectrum's own `</scan>`, misspelt at the same length so the
    // recorded offsets stay valid.
    let second = document.find("id=\"scan=20\"").expect("second spectrum");
    let close = second + document[second..].find("</scan>").expect("scan end");
    let mut misspelt = document.clone();
    misspelt.replace_range(close..close + "</scan>".len(), "</scna>");
    assert_eq!(
        read_selected_spectrum_from(Cursor::new(misspelt.as_bytes()), &table, 1),
        Err(MzmlSpectrumError::Document(MzmlScanError::Malformed(
            MzmlMalformedKind::NotWellFormed
        )))
    );
}

// ---------------------------------------------------------------------------
// Open-level refusals (decision 1)
// ---------------------------------------------------------------------------

#[test]
fn unsafe_xml_is_refused_before_anything_is_read() {
    let doctype = base().replacen(
        "<mzML ",
        "<!DOCTYPE mzML [<!ENTITY level \"2\">]>\n<mzML ",
        1,
    );
    assert_eq!(
        table(&doctype).expect_err("refused"),
        MzmlOpenError::Scan(MzmlScanError::Unsafe(UnsafeXmlKind::DoctypeDeclaration))
    );
    let entity = base().replacen("value=\"445.12\"", "value=\"&level;\"", 1);
    assert_eq!(
        table(&entity).expect_err("refused"),
        MzmlOpenError::Scan(MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity))
    );
}

#[test]
fn the_document_must_be_utf8_mzml_1_1() {
    for version in ["1.0.0", "1.1", "1.10.0", "2.1.0", "1.1.x"] {
        let document = base().replace("version=\"1.1.0\"", &format!("version=\"{version}\""));
        assert_eq!(
            table(&document).expect_err(version),
            MzmlOpenError::NotMzml11
        );
    }
    let missing = base().replace(" version=\"1.1.0\"", "");
    assert_eq!(
        table(&missing).expect_err("missing"),
        MzmlOpenError::NotMzml11
    );
    let patched = base().replace("version=\"1.1.0\"", "version=\"1.1.2\"");
    assert!(table(&patched).is_ok());

    let utf16 = base().replace("encoding=\"utf-8\"", "encoding=\"UTF-16\"");
    assert_eq!(table(&utf16).expect_err("refused"), MzmlOpenError::NotUtf8);
}

const XSI: &str = "http://www.w3.org/2001/XMLSchema-instance";
const MZML_XSD: &str = "http://psidev.info/files/ms/mzML/xsd/mzML1.1.0.xsd";

/// `base()` with its `version` attribute replaced by `attributes`.
fn unversioned(attributes: &str) -> String {
    base().replace(" version=\"1.1.0\"", attributes)
}

/// `<mzML>` attributes naming `location` for the mzML namespace, declared the
/// way MSFragger 4.1 writes them (the PXD081190 header in the R0 record).
fn schema(location: &str) -> String {
    format!(r#" xmlns:xsi="{XSI}" xsi:schemaLocation="http://psi.hupo.org/ms/mzml {location}""#)
}

#[test]
fn without_a_version_the_mzml_schema_location_decides() {
    let named = unversioned(&schema(MZML_XSD));
    assert_eq!(
        table(&named).expect("opens").rows(),
        table(&base()).expect("opens").rows()
    );
    assert_eq!(
        selected(&named, 1).expect("decodes"),
        selected(&base(), 1).expect("decodes")
    );

    // Any prefix bound to the schema-instance namespace, any pair order, and a
    // relative or local location.
    for attributes in [
        format!(r#" xmlns:s="{XSI}" s:schemaLocation="http://psi.hupo.org/ms/mzml {MZML_XSD}""#),
        format!(
            r#" xmlns:xsi="{XSI}" xsi:schemaLocation="urn:other other.xsd http://psi.hupo.org/ms/mzml mzML1.1.0.xsd""#
        ),
        schema(r"C:\schemas\mzML1.1.1.xsd"),
        format!(
            " xmlns:xsi=\"{XSI}\" xsi:schemaLocation=\"\n  http://psi.hupo.org/ms/mzml\t{MZML_XSD} \""
        ),
    ] {
        assert!(table(&unversioned(&attributes)).is_ok(), "{attributes}");
    }

    // The declaration may come from the index wrapper, whose own schema is
    // the `_idx` one.
    let body = named
        .strip_prefix("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n")
        .expect("declaration")
        .replace(
            &format!(" xmlns=\"http://psi.hupo.org/ms/mzml\" xmlns:xsi=\"{XSI}\""),
            "",
        );
    let indexed = format!(
        "<indexedmzML xmlns=\"http://psi.hupo.org/ms/mzml\" xmlns:xsi=\"{XSI}\" xsi:schemaLocation=\"http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.2_idx.xsd\">\n{body}</indexedmzML>\n"
    );
    assert_eq!(
        table(&indexed).expect("opens").rows(),
        table(&base()).expect("opens").rows()
    );
    // The wrapper's schema is not the `<mzML>` element's.
    let wrapper_only = indexed.replace(
        &format!(" xsi:schemaLocation=\"http://psi.hupo.org/ms/mzml {MZML_XSD}\""),
        "",
    );
    assert_ne!(wrapper_only, indexed);
    assert_eq!(
        table(&wrapper_only).expect_err("refused"),
        MzmlOpenError::NotMzml11
    );
}

#[test]
fn a_stated_version_or_an_unclear_schema_location_is_refused() {
    let refused = |attributes: &str| {
        assert_eq!(
            table(&unversioned(attributes)).expect_err(attributes),
            MzmlOpenError::NotMzml11,
            "{attributes}"
        );
    };
    let named = schema(MZML_XSD);

    // A stated version alone decides, even beside a 1.1.0 schema.
    refused(&format!(" version=\"1.0.0\"{named}"));
    refused(&format!(" version=\"\"{named}"));
    let stated = unversioned(&format!(
        " version=\"1.1.0\"{}",
        schema("http://psi.hupo.org/schema_revision/mzML_1.0.0/mzML1.0.0.xsd")
    ));
    assert!(table(&stated).is_ok());

    // Another schema version, or a file name that is not exactly mzML1.1.<n>.xsd.
    for file in [
        "mzML1.0.0.xsd",
        "mzML1.0.xsd",
        "mzML0.99.1.xsd",
        "mzML1.1.xsd",
        "mzML1.10.0.xsd",
        "mzML1.1.0_idx.xsd",
        "mzML1.1.x.xsd",
        "MZML1.1.0.xsd",
        "mzML1.1.0.XSD",
        "mzML1.1.0.xsd.gz",
        "http://psidev.info/files/ms/mzML/xsd/",
    ] {
        refused(&schema(file));
    }

    // The location must be paired with the mzML namespace, once.
    refused(&format!(
        r#" xmlns:xsi="{XSI}" xsi:schemaLocation="urn:other {MZML_XSD}""#
    ));
    refused(&format!(
        r#" xmlns:xsi="{XSI}" xsi:schemaLocation="{MZML_XSD}""#
    ));
    refused(&format!(
        r#" xmlns:xsi="{XSI}" xsi:schemaLocation="http://psi.hupo.org/ms/mzml {MZML_XSD} urn:other""#
    ));
    refused(&format!(
        r#" xmlns:xsi="{XSI}" xsi:schemaLocation="http://psi.hupo.org/ms/mzml {MZML_XSD} http://psi.hupo.org/ms/mzml {MZML_XSD}""#
    ));
    refused(&format!(r#" xmlns:xsi="{XSI}" xsi:schemaLocation="""#));

    // Only the schema-instance namespace counts, whatever the prefix says.
    refused(&format!(
        r#" xmlns:xsi="urn:not-xsi" xsi:schemaLocation="http://psi.hupo.org/ms/mzml {MZML_XSD}""#
    ));
    refused(&format!(
        r#" xsi:schemaLocation="http://psi.hupo.org/ms/mzml {MZML_XSD}""#
    ));
    refused(&format!(
        r#" xmlns:xsi="{XSI}" schemaLocation="http://psi.hupo.org/ms/mzml {MZML_XSD}""#
    ));
    refused(&format!(
        r#" xmlns:xsi="{XSI}" xsi:noNamespaceSchemaLocation="{MZML_XSD}""#
    ));

    // Two prefixes for one namespace state one attribute twice.
    let twice = unversioned(&format!(
        r#" xmlns:a="{XSI}" xmlns:b="{XSI}" a:schemaLocation="http://psi.hupo.org/ms/mzml {MZML_XSD}" b:schemaLocation="http://psi.hupo.org/ms/mzml {MZML_XSD}""#
    ));
    assert_eq!(
        table(&twice).expect_err("refused"),
        MzmlOpenError::Scan(MzmlScanError::Malformed(
            MzmlMalformedKind::DuplicateAttribute
        ))
    );
    let entity = unversioned(&schema("&location;"));
    assert_eq!(
        table(&entity).expect_err("refused"),
        MzmlOpenError::Scan(MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity))
    );
}

#[test]
fn the_open_refuses_what_the_table_would_have_to_guess() {
    let ms1_with = |extra: &str| {
        document(&[ms1_default(0).replacen("<scanList", &format!("{extra}<scanList"), 1)])
    };
    let cases = [
        (
            ms1_with("<referenceableParamGroupRef ref=\"nowhere\"/>"),
            MzmlOpenError::UndefinedParamGroup,
        ),
        (
            // A spectrum's own MS level against its group's.
            ms1_with("<referenceableParamGroupRef ref=\"ms2\"/>"),
            MzmlOpenError::ConflictingTerm,
        ),
        (
            ms1_with(&cv("MS:1000285", "total ion current", "1")),
            MzmlOpenError::ConflictingTerm,
        ),
        (
            ms1_with(&cv("MS:1000127", "centroid spectrum", "")),
            MzmlOpenError::ConflictingRepresentation,
        ),
        (
            document(&[ms1_default(0).replacen(
                "</scanList>",
                &format!(
                    "<scan>{}</scan></scanList>",
                    cvu("MS:1000016", "scan start time", "6", "UO:0000031")
                ),
                1,
            )]),
            MzmlOpenError::MultipleScans,
        ),
        (
            document(&[ms1_default(0).replace("UO:0000031", "UO:0000028")]),
            MzmlOpenError::UnsupportedRetentionTimeUnit,
        ),
        (
            document(&[
                ms1_default(0).replace(&cv("MS:1000285", "total ion current", "2400.25"), "")
            ]),
            MzmlOpenError::MissingRequiredValue(RequiredValue::TotalIonCurrent),
        ),
        (
            document(&[ms1_default(0).replace(&cv("MS:1000511", "ms level", "1"), "")]),
            MzmlOpenError::MissingRequiredValue(RequiredValue::MsLevel),
        ),
        (
            document(&[ms1_default(0).replace(&scan("5.9"), "")]),
            MzmlOpenError::MissingRequiredValue(RequiredValue::ScanStartTime),
        ),
        (
            document(&[ms1_default(1)]),
            MzmlOpenError::IndexOutOfSequence,
        ),
        (
            document_with(
                &groups().replace(
                    "</referenceableParamGroupList>",
                    "<referenceableParamGroup id=\"ms2\"/></referenceableParamGroupList>",
                ),
                &[ms1_default(0)],
            ),
            MzmlOpenError::AmbiguousParamGroup,
        ),
    ];
    for (document, error) in cases {
        assert_eq!(table(&document).expect_err("refused"), error);
    }
}

#[test]
fn a_misplaced_spectrum_element_neither_opens_nor_closes_a_row() {
    let nested = format!(
        "<userParam name=\"x\"/><spectrum index=\"7\" id=\"inner\">{}</spectrum>",
        cv("MS:1000511", "ms level", "9")
    );
    let document = document(&[ms1_default(0).replacen(
        "<cvParam",
        &format!("<scanWindow>{nested}</scanWindow><cvParam"),
        1,
    )]);
    let table = table(&document).expect("opens");
    assert_eq!(table.rows().len(), 1);
    assert_eq!(table.rows()[0].ms_level(), 1);
    assert_eq!(
        read_selected_spectrum_from(Cursor::new(document.as_bytes()), &table, 0)
            .expect("decodes")
            .row()
            .ms_level(),
        1
    );
}

#[test]
fn a_term_restated_with_the_same_value_is_one_term() {
    let document = document(&[ms1_default(0).replacen(
        "<scanList",
        &format!("{}<scanList", cv("MS:1000511", "ms level", "1")),
        1,
    )]);
    assert_eq!(table(&document).expect("opens").rows()[0].ms_level(), 1);
}

#[test]
fn retention_time_units_are_carried_never_converted() {
    let with_unit = |unit: &str| {
        let document = document(&[ms1_default(0).replace(" unitAccession=\"UO:0000031\"", unit)]);
        table(&document).expect("opens").rows()[0].retention_time()
    };
    assert_eq!(with_unit("").unit(), RetentionTimeUnit::NotDeclared);
    assert_eq!(
        with_unit(" unitAccession=\"MS:1000038\"").unit(),
        RetentionTimeUnit::Minute
    );
    let seconds = with_unit(" unitAccession=\"UO:0000010\"");
    assert_eq!(
        (seconds.value(), seconds.unit()),
        (5.9, RetentionTimeUnit::Second)
    );
}

#[test]
fn malformed_documents_are_refused_with_typed_errors() {
    let malformed = |kind| MzmlOpenError::Scan(MzmlScanError::Malformed(kind));
    let document = base();
    let cases = [
        (
            document[..document.len() / 2].to_owned(),
            malformed(MzmlMalformedKind::NotWellFormed),
        ),
        (
            "<?xml version=\"1.0\"?>".to_owned(),
            malformed(MzmlMalformedKind::MissingRootElement),
        ),
        (
            "<mzXML xmlns=\"http://psi.hupo.org/ms/mzml\"/>".to_owned(),
            malformed(MzmlMalformedKind::UnexpectedRoot),
        ),
        (
            document.replacen("index=\"0\"", "index=\"zero\"", 1),
            malformed(MzmlMalformedKind::InvalidNumber),
        ),
        (
            document.replacen("value=\"2400.25\"", "value=\"NaN\"", 1),
            malformed(MzmlMalformedKind::NonFiniteNumber),
        ),
        (
            document.replacen("</scan>", "</scna>", 1),
            malformed(MzmlMalformedKind::NotWellFormed),
        ),
    ];
    for (document, error) in cases {
        assert_eq!(table(&document).expect_err("refused"), error);
    }

    let limited = read_spectrum_table_from(
        Cursor::new(base().as_bytes()),
        MzmlScanLimits::default().with_max_spectra(1),
    );
    assert_eq!(
        limited.expect_err("refused"),
        MzmlOpenError::Scan(MzmlScanError::LimitExceeded(MzmlLimitKind::Spectra))
    );
}

// ---------------------------------------------------------------------------
// Never a panic (decision 1)
// ---------------------------------------------------------------------------

#[test]
fn no_truncation_or_byte_flip_panics() {
    let document = base();
    let bytes = document.as_bytes();
    for end in 0..bytes.len() {
        let _ = read_spectrum_table_from(Cursor::new(&bytes[..end]), MzmlScanLimits::default());
    }

    // Every byte of a one-spectrum document, read both as a new open and as a
    // selected read against the table of the unchanged file.
    let document = self::document(&[ms1_default(0)]);
    let table = table(&document).expect("opens");
    let mut mutated = document.into_bytes();
    for position in 0..mutated.len() {
        let original = mutated[position];
        for replacement in [b'<', b'A', 0xff] {
            mutated[position] = replacement;
            let _ = read_spectrum_table_from(Cursor::new(&mutated), MzmlScanLimits::default());
            let _ = read_selected_spectrum_from(Cursor::new(&mutated), &table, 0);
        }
        mutated[position] = original;
    }
}
