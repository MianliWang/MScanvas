//! New fixtures for ADR 0071's X1: each per-scan state, each whole-query refusal
//! and each departure. The 77 frozen PX.3 rows are X2's, and none is read here.

use std::io::{Cursor, Write as _};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use flate2::Compression;
use flate2::write::ZlibEncoder;

use super::*;
use crate::mzml::UnsafeXmlKind;

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const MZ_UNIT: &str = r#"unitAccession="MS:1000040" unitName="m/z" unitCvRef="MS""#;
const RT_UNIT: &str = r#"unitAccession="UO:0000010" unitName="second" unitCvRef="UO""#;
const INTENSITY_UNIT: &str =
    r#"unitAccession="MS:1000131" unitName="number of detector counts" unitCvRef="MS""#;

const F32: &str = r#"<cvParam cvRef="MS" accession="MS:1000521" name="32-bit float" value=""/>"#;
const F64: &str = r#"<cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>"#;
const I32: &str = r#"<cvParam cvRef="MS" accession="MS:1000519" name="32-bit integer" value=""/>"#;
const I64: &str = r#"<cvParam cvRef="MS" accession="MS:1000522" name="64-bit integer" value=""/>"#;
const ZLIB: &str =
    r#"<cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>"#;
const NO_COMPRESSION: &str =
    r#"<cvParam cvRef="MS" accession="MS:1000576" name="no compression" value=""/>"#;
const PROFILE_TERM: &str =
    r#"<cvParam cvRef="MS" accession="MS:1000128" name="profile spectrum" value=""/>"#;
const CENTROID_TERM: &str =
    r#"<cvParam cvRef="MS" accession="MS:1000127" name="centroid spectrum" value=""/>"#;
const POSITIVE: &str =
    r#"<cvParam cvRef="MS" accession="MS:1000130" name="positive scan" value=""/>"#;
const NEGATIVE: &str =
    r#"<cvParam cvRef="MS" accession="MS:1000129" name="negative scan" value=""/>"#;

fn cv(accession: &str, value: &str) -> String {
    format!(r#"<cvParam cvRef="MS" accession="{accession}" name="term" value="{value}"/>"#)
}

fn level(level: u32) -> String {
    format!(r#"<cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="{level}"/>"#)
}

fn faims(value: &str) -> String {
    cv("MS:1001581", value)
}

fn mz_role(unit: &str) -> String {
    format!(r#"<cvParam cvRef="MS" accession="MS:1000514" name="m/z array" value="" {unit}/>"#)
}

fn intensity_role(unit: &str) -> String {
    format!(
        r#"<cvParam cvRef="MS" accession="MS:1000515" name="intensity array" value="" {unit}/>"#
    )
}

fn le_f64(values: &[f64]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn zlib(bytes: &[u8]) -> String {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).unwrap();
    STANDARD.encode(encoder.finish().unwrap())
}

fn plain(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

/// One array: its terms, then a payload.
fn array(terms: &[&str], payload: &str) -> String {
    let terms = terms.concat();
    format!(
        r#"<binaryDataArray encodedLength="0">{terms}<binary>{payload}</binary></binaryDataArray>"#
    )
}

fn mz_array(values: &[f64]) -> String {
    array(&[&mz_role(MZ_UNIT), F64, ZLIB], &zlib(&le_f64(values)))
}

fn intensity_array(values: &[f64]) -> String {
    array(
        &[&intensity_role(INTENSITY_UNIT), F64, ZLIB],
        &zlib(&le_f64(values)),
    )
}

fn corrupt_mz() -> String {
    array(&[&mz_role(MZ_UNIT), F64, ZLIB], "%%%not-base64%%%")
}

fn corrupt_intensity() -> String {
    array(
        &[&intensity_role(INTENSITY_UNIT), F64, ZLIB],
        "%%%not-base64%%%",
    )
}

fn scan_list(seconds: f64) -> String {
    format!(
        r#"<scanList count="1"><scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{seconds}" {RT_UNIT}/></scan></scanList>"#
    )
}

fn spectrum(index: u64, length: u64, terms: &str, scan_list: &str, arrays: &[String]) -> String {
    let list = if arrays.is_empty() {
        String::new()
    } else {
        format!(
            r#"<binaryDataArrayList count="{}">{}</binaryDataArrayList>"#,
            arrays.len(),
            arrays.concat()
        )
    };
    format!(
        r#"<spectrum index="{index}" id="scan={}" defaultArrayLength="{length}">{terms}{scan_list}{list}</spectrum>"#,
        index + 1
    )
}

fn ms1_terms() -> String {
    format!("{}{PROFILE_TERM}", level(1))
}

/// An MS1 profile scan at 60 s with both arrays well formed.
fn ms1(index: u64, mz: &[f64], intensity: &[f64]) -> String {
    spectrum(
        index,
        mz.len() as u64,
        &ms1_terms(),
        &scan_list(60.0),
        &[mz_array(mz), intensity_array(intensity)],
    )
}

/// `ms1` with these terms in place of the level and the representation.
fn with_terms(index: u64, terms: &str) -> String {
    spectrum(
        index,
        1,
        terms,
        &scan_list(60.0),
        &[mz_array(&[101.0]), intensity_array(&[1.0])],
    )
}

fn document_with_groups(groups: &str, spectra: &[String]) -> Vec<u8> {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?><mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">{groups}<run id="r"><spectrumList count="{}">{}</spectrumList></run></mzML>"#,
        spectra.len(),
        spectra.concat()
    )
    .into_bytes()
}

fn document(spectra: &[String]) -> Vec<u8> {
    document_with_groups("", spectra)
}

fn group(id: &str, params: &str) -> String {
    format!(
        r#"<referenceableParamGroupList count="1"><referenceableParamGroup id="{id}">{params}</referenceableParamGroup></referenceableParamGroupList>"#
    )
}

fn group_ref(id: &str) -> String {
    format!(r#"<referenceableParamGroupRef ref="{id}"/>"#)
}

fn window(low: f64, high: f64) -> XicQuery {
    XicQuery::from_bounds(1, low, high).unwrap()
}

fn run(document: &[u8], query: XicQuery) -> Result<XicResult, XicRefusal> {
    read_xic_from(
        Cursor::new(document),
        &query,
        MzmlScanLimits::default(),
        &mut XicIdentity,
        || false,
    )
}

fn evaluate(spectra: &[String]) -> XicResult {
    run(&document(spectra), window(100.0, 102.0)).unwrap()
}

fn refuse(spectra: &[String]) -> XicRefusal {
    run(&document(spectra), window(100.0, 102.0)).unwrap_err()
}

fn only_state(spectra: &[String]) -> XicScanState {
    let result = evaluate(spectra);
    assert_eq!(result.rows().len(), 1);
    result.rows()[0].state()
}

fn unreadable(role: ArrayRole, problem: ArrayProblem) -> XicScanState {
    XicScanState::Unreadable {
        role,
        reason: XicUnreadableReason::Array(problem),
    }
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

#[test]
fn a_query_refuses_what_is_not_one_level_and_one_closed_window() {
    for query in [
        XicQuery::from_bounds(0, 100.0, 102.0),
        XicQuery::from_bounds(1, 102.0, 100.0),
        XicQuery::from_bounds(1, f64::NAN, 102.0),
        XicQuery::from_bounds(1, 100.0, f64::NAN),
        XicQuery::from_bounds(1, 100.0, f64::INFINITY),
        XicQuery::from_bounds(1, f64::NEG_INFINITY, 102.0),
        XicQuery::from_half_width(1, 100.0, -0.5),
        XicQuery::from_half_width(1, f64::MAX, f64::MAX),
        XicQuery::from_half_width(1, 100.0, f64::NAN),
        XicQuery::from_ppm(1, 100.0, -10.0),
        XicQuery::from_ppm(1, f64::MAX, 1e9),
        XicQuery::from_ppm(1, f64::NAN, 10.0),
        XicQuery::from_ppm(0, 100.0, 10.0),
    ] {
        assert_eq!(query, Err(XicRefusal::InvalidQuery));
    }
}

#[test]
fn a_zero_width_window_is_legal() {
    let result = run(
        &document(&[ms1(0, &[100.0, 101.0], &[1.0, 2.0])]),
        window(101.0, 101.0),
    )
    .unwrap();
    assert_eq!(
        result.rows()[0].state(),
        XicScanState::Measured {
            sum: 2.0,
            points_in_window: 1
        }
    );
    let zero = XicQuery::from_ppm(1, 101.0, 0.0).unwrap();
    assert_eq!((zero.low(), zero.high()), (101.0, 101.0));
}

#[test]
fn ppm_resolves_in_binary64_and_the_typed_input_travels_with_the_result() {
    let query = XicQuery::from_ppm(1, 524.2645, 10.0).unwrap();
    // Python's repr of the same operations, in the same order.
    assert_eq!(query.low(), 524.259257355);
    assert_eq!(query.high(), 524.269742645);

    let spectra = [ms1(0, &[524.2645], &[3.0])];
    let result = run(&document(&spectra), query).unwrap();
    assert_eq!(
        result.query().input(),
        XicWindowInput::Ppm {
            centre: 524.2645,
            ppm: 10.0
        }
    );
    assert_eq!(result.query().low(), 524.259257355);

    // ppm never reaches the query's identity.
    assert_eq!(
        query,
        XicQuery::from_bounds(1, 524.259257355, 524.269742645).unwrap()
    );
    assert_ne!(
        query,
        XicQuery::from_bounds(2, 524.259257355, 524.269742645).unwrap()
    );

    // Here `centre * (ppm / 1e6)` rounds differently, so the record's order
    // shows. Python's repr, again.
    let ordered = XicQuery::from_ppm(1, 1458.1862, 10.0).unwrap();
    assert_eq!(ordered.low(), 1458.1716181380002);
    assert_eq!(ordered.high(), 1458.200781862);
}

#[test]
fn a_half_width_resolves_to_the_same_closed_window() {
    let query = XicQuery::from_half_width(2, 101.0, 1.0).unwrap();
    assert_eq!(query.ms_level(), 2);
    assert_eq!((query.low(), query.high()), (100.0, 102.0));
    assert_eq!(
        query.input(),
        XicWindowInput::HalfWidth {
            centre: 101.0,
            half_width: 1.0
        }
    );
}

// ---------------------------------------------------------------------------
// The per-scan states
// ---------------------------------------------------------------------------

#[test]
fn measured_includes_both_ends_on_unsorted_arrays_and_only_those_points() {
    let below = 100.0_f64.next_down();
    let above = 102.0_f64.next_up();
    let result = evaluate(&[ms1(
        0,
        &[102.0, below, 100.0, above, 101.0],
        &[0.25, 8.0, 0.125, 16.0, 0.5],
    )]);
    assert_eq!(
        result.rows()[0].state(),
        XicScanState::Measured {
            sum: 0.875,
            points_in_window: 3
        }
    );
    assert!(result.rows()[0].decode_attempted());
    assert_eq!(XIC_QUANTITY, "point_sum");
}

#[test]
fn a_zero_sum_and_an_empty_window_are_two_different_measurements() {
    let result = evaluate(&[ms1(0, &[101.0], &[0.0]), ms1(1, &[99.0], &[8.0])]);
    assert_eq!(
        result.rows()[0].state(),
        XicScanState::Measured {
            sum: 0.0,
            points_in_window: 1
        }
    );
    assert_eq!(
        result.rows()[1].state(),
        XicScanState::Measured {
            sum: 0.0,
            points_in_window: 0
        }
    );
    assert!(result.is_complete());
}

#[test]
fn an_excluded_scan_is_filtered_on_declared_metadata_without_decoding() {
    let result = evaluate(&[spectrum(
        0,
        1,
        &level(2),
        &scan_list(60.0),
        &[corrupt_mz(), corrupt_intensity()],
    )]);
    let row = &result.rows()[0];
    assert_eq!(row.state(), XicScanState::ExcludedByMsLevel);
    assert_eq!(row.ms_level(), Some(2));
    assert!(!row.decode_attempted());
    assert!(!row.is_coverage_gap());
    assert!(result.is_complete());
}

#[test]
fn an_undeclared_level_is_its_own_state_and_a_gap_and_is_never_guessed() {
    // A precursor's MS level term is not the spectrum's.
    let noise = format!(
        r#"<precursorList count="1"><precursor><selectedIonList count="1"><selectedIon>{}</selectedIon></selectedIonList></precursor></precursorList>"#,
        level(1)
    );
    let result = evaluate(&[spectrum(
        0,
        1,
        &noise,
        &scan_list(60.0),
        &[corrupt_mz(), corrupt_intensity()],
    )]);
    let row = &result.rows()[0];
    assert_eq!(row.state(), XicScanState::MsLevelUndeclared);
    assert_eq!(row.ms_level(), None);
    assert!(!row.decode_attempted());
    assert_eq!(result.coverage_gaps(), 1);
    assert!(!result.is_complete());
}

#[test]
fn an_absent_array_is_no_usable_arrays_also_at_length_zero() {
    let level_one = level(1);
    let time = scan_list(60.0);
    for (length, arrays) in [
        (1, vec![mz_array(&[101.0])]),
        (1, vec![intensity_array(&[1.0])]),
        (1, vec![]),
        // The viewing reader accepts these three at declared length zero.
        (0, vec![mz_array(&[])]),
        (0, vec![intensity_array(&[])]),
        (0, vec![]),
    ] {
        let result = evaluate(&[spectrum(0, length, &level_one, &time, &arrays)]);
        let row = &result.rows()[0];
        assert_eq!(row.state(), XicScanState::NoUsableArrays);
        assert!(!row.decode_attempted());
        assert!(row.is_coverage_gap());
    }
}

#[test]
fn both_arrays_present_at_length_zero_are_a_measurement() {
    assert_eq!(
        only_state(&[ms1(0, &[], &[])]),
        XicScanState::Measured {
            sum: 0.0,
            points_in_window: 0
        }
    );
}

#[test]
fn an_empty_zlib_payload_at_length_zero_is_empty_as_the_reader_reads_it() {
    let arrays = [
        array(&[&mz_role(MZ_UNIT), F64, ZLIB], ""),
        array(&[&intensity_role(INTENSITY_UNIT), F64, ZLIB], ""),
    ];
    assert_eq!(
        only_state(&[spectrum(0, 0, &level(1), &scan_list(60.0), &arrays)]),
        XicScanState::Measured {
            sum: 0.0,
            points_in_window: 0
        }
    );
}

#[test]
fn lengths_that_disagree_are_no_usable_arrays() {
    let level_one = level(1);
    let time = scan_list(60.0);
    let state = |length, mz: &[f64], intensity: &[f64]| {
        only_state(&[spectrum(
            0,
            length,
            &level_one,
            &time,
            &[mz_array(mz), intensity_array(intensity)],
        )])
    };
    // Intensity shorter, intensity longer, m/z against the declared length.
    assert_eq!(
        state(2, &[100.0, 101.0], &[1.0]),
        XicScanState::NoUsableArrays
    );
    assert_eq!(
        state(1, &[101.0], &[1.0, 2.0]),
        XicScanState::NoUsableArrays
    );
    assert_eq!(
        state(3, &[100.0, 101.0], &[1.0, 2.0]),
        XicScanState::NoUsableArrays
    );
    assert_eq!(
        state(1, &[100.0, 101.0], &[1.0, 2.0]),
        XicScanState::NoUsableArrays
    );
}

#[test]
fn an_array_length_attribute_does_not_stand_in_for_the_default_length() {
    let array_with_length = mz_array(&[100.0, 101.0]).replace(
        r#"<binaryDataArray encodedLength="0">"#,
        r#"<binaryDataArray encodedLength="0" arrayLength="2">"#,
    );
    assert_eq!(
        only_state(&[spectrum(
            0,
            1,
            &level(1),
            &scan_list(60.0),
            &[array_with_length, intensity_array(&[1.0])],
        )]),
        XicScanState::NoUsableArrays
    );
}

#[test]
fn a_nan_mz_ends_the_scan_before_intensity_is_decoded() {
    // The oracle's order: the corrupt intensity is never reached, in either
    // document order.
    let level_one = level(1);
    let time = scan_list(60.0);
    let nan_mz = mz_array(&[f64::NAN, 101.0]);
    let corrupt = corrupt_intensity();
    for arrays in [[nan_mz.clone(), corrupt.clone()], [corrupt, nan_mz]] {
        assert_eq!(
            only_state(&[spectrum(0, 2, &level_one, &time, &arrays)]),
            XicScanState::NoUsableArrays
        );
    }
}

#[test]
fn a_wrong_mz_length_ends_the_scan_before_intensity_is_decoded() {
    assert_eq!(
        only_state(&[spectrum(
            0,
            2,
            &level(1),
            &scan_list(60.0),
            &[mz_array(&[101.0]), corrupt_intensity()],
        )]),
        XicScanState::NoUsableArrays
    );
}

#[test]
fn an_infinite_mz_is_simply_outside_the_window() {
    assert_eq!(
        only_state(&[ms1(
            0,
            &[f64::INFINITY, f64::NEG_INFINITY, 101.0],
            &[f64::NAN, f64::INFINITY, 0.5],
        )]),
        XicScanState::Measured {
            sum: 0.5,
            points_in_window: 1
        }
    );
}

#[test]
fn unreadable_carries_the_readers_typed_refusal() {
    let level_one = level(1);
    let time = scan_list(60.0);
    let intensity = intensity_array(&[1.0]);
    let mz_role = mz_role(MZ_UNIT);
    let payload = zlib(&le_f64(&[101.0]));
    let unknown_compression =
        r#"<cvParam cvRef="MS" accession="MS:9999999" name="brand new compression" value=""/>"#;
    let numpress = cv("MS:1002312", "");
    let truncation = cv("MS:1003088", "");
    let half_float = cv("MS:1000520", "");
    let cases: Vec<(String, ArrayProblem)> = vec![
        (corrupt_mz(), ArrayProblem::CorruptBase64),
        (
            array(&[&mz_role, F64, ZLIB], &plain(b"not a zlib stream")),
            ArrayProblem::CorruptZlib,
        ),
        (
            array(&[&mz_role, F64, ZLIB, &numpress], &payload),
            ArrayProblem::Numpress,
        ),
        (
            array(&[&mz_role, F64, ZLIB, &truncation], &payload),
            ArrayProblem::TruncationOrPrediction,
        ),
        (
            array(&[&mz_role, F64, unknown_compression], &payload),
            ArrayProblem::CompressionUnrecognized,
        ),
        (
            array(&[&mz_role, ZLIB], &payload),
            ArrayProblem::DataTypeMissing,
        ),
        (
            array(&[&mz_role, F64, F32, ZLIB], &payload),
            ArrayProblem::DataTypeStatedTwice,
        ),
        (
            array(&[&mz_role, &half_float, ZLIB], &payload),
            ArrayProblem::DataTypeUnsupported,
        ),
        (
            array(&[&mz_role, F64], &payload),
            ArrayProblem::CompressionMissing,
        ),
        (
            array(&[&mz_role, F64, ZLIB, NO_COMPRESSION], &payload),
            ArrayProblem::CompressionStatedTwice,
        ),
    ];
    for (mz, problem) in cases {
        let row = only_state(&[spectrum(0, 1, &level_one, &time, &[mz, intensity.clone()])]);
        assert_eq!(row, unreadable(ArrayRole::Mz, problem));
    }
    // Intensity is reached only after a good m/z.
    assert_eq!(
        only_state(&[spectrum(
            0,
            1,
            &level_one,
            &time,
            &[mz_array(&[101.0]), corrupt_intensity()],
        )]),
        unreadable(ArrayRole::Intensity, ArrayProblem::CorruptBase64)
    );
}

#[test]
fn an_unreadable_scan_is_a_gap_and_the_pass_goes_on() {
    let result = evaluate(&[
        spectrum(
            0,
            1,
            &ms1_terms(),
            &scan_list(60.0),
            &[corrupt_mz(), intensity_array(&[1.0])],
        ),
        ms1(1, &[101.0], &[4.0]),
    ]);
    assert_eq!(result.coverage_gaps(), 1);
    assert!(result.rows()[0].is_coverage_gap());
    assert_eq!(
        result.rows()[1].state(),
        XicScanState::Measured {
            sum: 4.0,
            points_in_window: 1
        }
    );
}

#[test]
fn an_array_with_no_payload_element_is_unreadable() {
    let no_binary = format!(
        r#"<binaryDataArray encodedLength="0">{}{F64}{ZLIB}</binaryDataArray>"#,
        mz_role(MZ_UNIT)
    );
    assert_eq!(
        only_state(&[spectrum(
            0,
            1,
            &level(1),
            &scan_list(60.0),
            &[no_binary, intensity_array(&[1.0])],
        )]),
        XicScanState::Unreadable {
            role: ArrayRole::Mz,
            reason: XicUnreadableReason::PayloadAbsent
        }
    );
}

#[test]
fn a_term_after_the_payload_is_unreadable() {
    let late = format!(
        r#"<binaryDataArray encodedLength="0">{}{F64}<binary>{}</binary>{ZLIB}</binaryDataArray>"#,
        mz_role(MZ_UNIT),
        zlib(&le_f64(&[101.0]))
    );
    assert_eq!(
        only_state(&[spectrum(
            0,
            1,
            &level(1),
            &scan_list(60.0),
            &[late, intensity_array(&[1.0])],
        )]),
        XicScanState::Unreadable {
            role: ArrayRole::Mz,
            reason: XicUnreadableReason::TermAfterPayload
        }
    );
}

#[test]
fn stored_bytes_that_are_not_whole_values_are_unreadable() {
    let torn = array(&[&mz_role(MZ_UNIT), F64, NO_COMPRESSION], &plain(&[0; 12]));
    assert_eq!(
        only_state(&[spectrum(
            0,
            1,
            &level(1),
            &scan_list(60.0),
            &[torn, intensity_array(&[1.0])],
        )]),
        XicScanState::Unreadable {
            role: ArrayRole::Mz,
            reason: XicUnreadableReason::NotWholeValues
        }
    );
}

#[test]
fn the_decode_caps_are_a_refusal_of_that_scan_and_the_pass_goes_on() {
    let over = spectrum(
        0,
        MAX_POINTS_PLUS_ONE,
        &ms1_terms(),
        &scan_list(60.0),
        &[mz_array(&[101.0]), intensity_array(&[1.0])],
    );
    let result = evaluate(&[over, ms1(1, &[101.0], &[4.0])]);
    assert_eq!(
        result.rows()[0].state(),
        unreadable(ArrayRole::Mz, ArrayProblem::PointCapExceeded)
    );
    assert!(matches!(
        result.rows()[1].state(),
        XicScanState::Measured { .. }
    ));
}

const MAX_POINTS_PLUS_ONE: u64 = crate::mzml_reader::MAX_DECODED_ARRAY_POINTS + 1;

#[test]
fn a_payload_over_its_bound_is_a_refusal_of_that_scan_and_the_pass_goes_on() {
    let long = array(
        &[&mz_role(MZ_UNIT), F64, NO_COMPRESSION],
        &plain(&vec![0; 64 * 1024]),
    );
    let result = evaluate(&[
        spectrum(
            0,
            1,
            &ms1_terms(),
            &scan_list(60.0),
            &[long, intensity_array(&[1.0])],
        ),
        ms1(1, &[101.0], &[4.0]),
    ]);
    assert_eq!(
        result.rows()[0].state(),
        unreadable(ArrayRole::Mz, ArrayProblem::EncodedTextOverBound)
    );
    assert!(matches!(
        result.rows()[1].state(),
        XicScanState::Measured { .. }
    ));
}

#[test]
fn a_non_finite_intensity_fails_the_scan_only_inside_the_window() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            only_state(&[ms1(0, &[101.0], &[bad])]),
            XicScanState::NonFiniteIntensity
        );
        assert_eq!(
            only_state(&[ms1(0, &[99.0, 101.0], &[bad, 0.25])]),
            XicScanState::Measured {
                sum: 0.25,
                points_in_window: 1
            }
        );
    }
}

#[test]
fn a_sum_past_the_range_is_not_representable_and_a_non_finite_point_comes_first() {
    assert_eq!(
        only_state(&[ms1(0, &[100.0, 101.0], &[f64::MAX, f64::MAX])]),
        XicScanState::SumNotRepresentable
    );
    assert_eq!(
        only_state(&[ms1(
            0,
            &[100.0, 101.0, 102.0],
            &[f64::MAX, f64::MAX, f64::INFINITY],
        )]),
        XicScanState::NonFiniteIntensity
    );
    // Only the final exact sum is tested.
    assert_eq!(
        only_state(&[ms1(
            0,
            &[100.0, 101.0, 102.0],
            &[f64::MAX, f64::MAX, -f64::MAX],
        )]),
        XicScanState::Measured {
            sum: f64::MAX,
            points_in_window: 3
        }
    );
}

#[test]
fn missing_retention_time_is_a_gap_on_a_measured_scan_when_the_whole_run_has_none() {
    let result = evaluate(&[spectrum(
        0,
        1,
        &level(1),
        "",
        &[mz_array(&[101.0]), intensity_array(&[1.0])],
    )]);
    let row = &result.rows()[0];
    assert!(matches!(row.state(), XicScanState::Measured { .. }));
    assert_eq!(row.retention_time(), None);
    assert!(row.is_coverage_gap());
    assert_eq!(result.coverage_gaps(), 1);
    assert!(!result.is_complete());
    assert_eq!(*result.retention_time_unit(), XicUnit::default());
}

#[test]
fn zero_in_scope_scans_is_a_complete_answer() {
    let result = run(
        &document(&[ms1(0, &[101.0], &[1.0])]),
        XicQuery::from_bounds(2, 100.0, 102.0).unwrap(),
    )
    .unwrap();
    assert_eq!(result.rows()[0].state(), XicScanState::ExcludedByMsLevel);
    assert!(result.is_complete());
    assert_eq!(result.coverage_gaps(), 0);
}

#[test]
fn duplicate_retention_times_stay_separate_rows_in_source_order() {
    let result = evaluate(&[
        ms1(0, &[101.0], &[1.0]),
        ms1(1, &[101.0], &[2.0]),
        ms1(2, &[101.0], &[4.0]),
    ]);
    let order: Vec<(u64, f64)> = result
        .rows()
        .iter()
        .map(|row| {
            let XicScanState::Measured { sum, .. } = row.state() else {
                panic!("not measured");
            };
            (row.identity().index(), sum)
        })
        .collect();
    assert_eq!(order, [(0, 1.0), (1, 2.0), (2, 4.0)]);
    assert!(
        result
            .rows()
            .iter()
            .all(|row| row.retention_time() == Some(60.0))
    );
}

#[test]
fn indices_need_only_be_unique_and_identity_is_kept() {
    let result = evaluate(&[ms1(7, &[101.0], &[1.0]), ms1(3, &[101.0], &[1.0])]);
    assert_eq!(result.rows()[0].identity().index(), 7);
    assert_eq!(
        result.rows()[1].identity().representations()[0].sensitive_raw(),
        "scan=4"
    );
}

#[test]
fn stored_values_widen_exactly_whatever_their_data_type() {
    let f32_mz: Vec<u8> = [101.0_f32].iter().flat_map(|v| v.to_le_bytes()).collect();
    let f32_intensity: Vec<u8> = [0.1_f32].iter().flat_map(|v| v.to_le_bytes()).collect();
    let binary32 = [
        array(&[&mz_role(MZ_UNIT), F32, ZLIB], &zlib(&f32_mz)),
        array(
            &[&intensity_role(INTENSITY_UNIT), F32, NO_COMPRESSION],
            &plain(&f32_intensity),
        ),
    ];
    assert_eq!(
        only_state(&[spectrum(0, 1, &level(1), &scan_list(60.0), &binary32)]),
        XicScanState::Measured {
            sum: f64::from(0.1_f32),
            points_in_window: 1
        }
    );

    let integers = [
        array(
            &[&mz_role(MZ_UNIT), I32, ZLIB],
            &zlib(&101_i32.to_le_bytes()),
        ),
        array(
            &[&intensity_role(INTENSITY_UNIT), I64, ZLIB],
            &zlib(&(1_i64 << 53).to_le_bytes()),
        ),
    ];
    assert_eq!(
        only_state(&[spectrum(0, 1, &level(1), &scan_list(60.0), &integers)]),
        XicScanState::Measured {
            sum: 9_007_199_254_740_992.0,
            points_in_window: 1
        }
    );
}

/// Pins the provisional refusal and nothing more. ADR 0071 open question 2 is
/// unanswered, so no state is asserted, and this goes with the answer.
#[test]
fn an_integer_above_two_to_the_53_is_a_provisional_refusal_with_no_state() {
    let integers = [
        mz_array(&[101.0]),
        array(
            &[&intensity_role(INTENSITY_UNIT), I64, ZLIB],
            &zlib(&((1_i64 << 53) + 1).to_le_bytes()),
        ),
    ];
    assert_eq!(
        refuse(&[spectrum(0, 1, &level(1), &scan_list(60.0), &integers)]),
        XicRefusal::IntegerNotExact(ArrayRole::Intensity)
    );
}

// ---------------------------------------------------------------------------
// The run-wide unit rules
// ---------------------------------------------------------------------------

fn with_units(index: u64, ms_level: u32, mz: &str, seconds: &str, intensity: &str) -> String {
    let time = format!(
        r#"<scanList count="1"><scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="60" {seconds}/></scan></scanList>"#
    );
    spectrum(
        index,
        1,
        &level(ms_level),
        &time,
        &[
            array(&[&mz_role(mz), F64, ZLIB], &zlib(&le_f64(&[101.0]))),
            array(
                &[&intensity_role(intensity), F64, ZLIB],
                &zlib(&le_f64(&[1.0])),
            ),
        ],
    )
}

const INCOMPLETE: [&str; 5] = [
    r#"unitAccession="""#,
    r#"unitAccession=" ""#,
    r#"unitName="m/z""#,
    r#"unitCvRef="MS""#,
    r#"unitName="m/z" unitCvRef="MS""#,
];

#[test]
fn an_incomplete_declaration_refuses_the_query_on_each_axis() {
    for unit in INCOMPLETE {
        assert_eq!(
            refuse(&[with_units(0, 1, unit, RT_UNIT, INTENSITY_UNIT)]),
            XicRefusal::IncompleteUnit(XicAxis::Mz)
        );
        assert_eq!(
            refuse(&[with_units(0, 1, MZ_UNIT, unit, INTENSITY_UNIT)]),
            XicRefusal::IncompleteUnit(XicAxis::RetentionTime)
        );
        assert_eq!(
            refuse(&[with_units(0, 1, MZ_UNIT, RT_UNIT, unit)]),
            XicRefusal::IncompleteUnit(XicAxis::Intensity)
        );
    }
}

#[test]
fn differing_units_and_a_unit_beside_none_refuse_the_query_on_each_axis() {
    let other = r#"unitAccession="X:1" unitName="other" unitCvRef="X""#;
    let good = with_units(0, 1, MZ_UNIT, RT_UNIT, INTENSITY_UNIT);
    for unit in [other, ""] {
        assert_eq!(
            refuse(&[
                good.clone(),
                with_units(1, 1, unit, RT_UNIT, INTENSITY_UNIT)
            ]),
            XicRefusal::MixedUnit(XicAxis::Mz)
        );
        assert_eq!(
            refuse(&[
                good.clone(),
                with_units(1, 1, MZ_UNIT, unit, INTENSITY_UNIT)
            ]),
            XicRefusal::MixedUnit(XicAxis::RetentionTime)
        );
        assert_eq!(
            refuse(&[good.clone(), with_units(1, 1, MZ_UNIT, RT_UNIT, unit)]),
            XicRefusal::MixedUnit(XicAxis::Intensity)
        );
    }
}

#[test]
fn the_unit_rules_compare_the_raw_triple_so_a_synonym_is_a_mix() {
    let minute = r#"unitAccession="UO:0000031" unitName="minute" unitCvRef="UO""#;
    let synonym = r#"unitAccession="MS:1000038" unitName="minute" unitCvRef="MS""#;
    assert_eq!(
        refuse(&[
            with_units(0, 1, MZ_UNIT, minute, INTENSITY_UNIT),
            with_units(1, 1, MZ_UNIT, synonym, INTENSITY_UNIT),
        ]),
        XicRefusal::MixedUnit(XicAxis::RetentionTime)
    );
    // The same accession under another name is a different declaration too.
    let renamed = r#"unitAccession="UO:0000031" unitName="min" unitCvRef="UO""#;
    assert_eq!(
        refuse(&[
            with_units(0, 1, MZ_UNIT, minute, INTENSITY_UNIT),
            with_units(1, 1, MZ_UNIT, renamed, INTENSITY_UNIT),
        ]),
        XicRefusal::MixedUnit(XicAxis::RetentionTime)
    );
}

#[test]
fn the_unit_rules_are_run_wide_over_every_ms_level() {
    let other = r#"unitAccession="X:1" unitName="other" unitCvRef="X""#;
    assert_eq!(
        refuse(&[
            with_units(0, 1, MZ_UNIT, RT_UNIT, INTENSITY_UNIT),
            with_units(1, 2, MZ_UNIT, RT_UNIT, other),
        ]),
        XicRefusal::MixedUnit(XicAxis::Intensity)
    );
    assert_eq!(
        refuse(&[
            with_units(0, 1, MZ_UNIT, RT_UNIT, INTENSITY_UNIT),
            with_units(1, 2, other, RT_UNIT, INTENSITY_UNIT),
        ]),
        XicRefusal::MixedUnit(XicAxis::Mz)
    );
    assert_eq!(
        refuse(&[
            with_units(0, 1, MZ_UNIT, RT_UNIT, INTENSITY_UNIT),
            with_units(1, 2, MZ_UNIT, other, INTENSITY_UNIT),
        ]),
        XicRefusal::MixedUnit(XicAxis::RetentionTime)
    );
}

#[test]
fn a_scan_with_no_start_time_beside_a_declared_unit_is_a_mix() {
    let bare = spectrum(
        1,
        1,
        &level(2),
        "",
        &[mz_array(&[101.0]), intensity_array(&[1.0])],
    );
    assert_eq!(
        refuse(&[ms1(0, &[101.0], &[1.0]), bare]),
        XicRefusal::MixedUnit(XicAxis::RetentionTime)
    );
}

#[test]
fn the_refusal_reason_does_not_depend_on_the_order_of_the_scans() {
    let other = r#"unitAccession="X:1" unitName="other" unitCvRef="X""#;
    let rt_mix = with_units(1, 1, MZ_UNIT, other, INTENSITY_UNIT);
    let mz_mix = with_units(2, 1, other, RT_UNIT, INTENSITY_UNIT);
    let good = with_units(0, 1, MZ_UNIT, RT_UNIT, INTENSITY_UNIT);
    for spectra in [
        [good.clone(), rt_mix.clone(), mz_mix.clone()],
        [good.clone(), mz_mix.clone(), rt_mix.clone()],
    ] {
        assert_eq!(refuse(&spectra), XicRefusal::MixedUnit(XicAxis::Mz));
    }
    // Incomplete comes before mixed on one axis, and a later axis waits.
    assert_eq!(
        refuse(&[
            good.clone(),
            mz_mix,
            with_units(3, 1, r#"unitName="m/z""#, RT_UNIT, INTENSITY_UNIT),
        ]),
        XicRefusal::IncompleteUnit(XicAxis::Mz)
    );
    // Malformed metadata comes before a unit rule.
    assert_eq!(
        refuse(&[
            good,
            rt_mix,
            with_terms(3, &format!("{}{}", level(1), level(2)))
        ]),
        XicMetadataProblem::ConflictingTerm.into()
    );
}

#[test]
fn a_uniformly_undeclared_unit_is_served_as_not_reported_on_each_axis() {
    let result = evaluate(&[with_units(0, 1, "", "", "")]);
    assert!(matches!(
        result.rows()[0].state(),
        XicScanState::Measured { .. }
    ));
    assert_eq!(*result.mz_unit(), XicUnit::default());
    assert_eq!(*result.intensity_unit(), XicUnit::default());
    assert_eq!(*result.retention_time_unit(), XicUnit::default());
}

#[test]
fn all_three_attributes_are_kept_and_an_unknown_accession_is_preserved() {
    let unknown =
        r#"unitAccession="PX:unknown &amp; more" unitName="custom &amp; unit" unitCvRef="PX""#;
    let result = evaluate(&[with_units(0, 1, unknown, RT_UNIT, INTENSITY_UNIT)]);
    assert_eq!(result.mz_unit().accession(), Some("PX:unknown & more"));
    assert_eq!(result.mz_unit().name(), Some("custom & unit"));
    assert_eq!(result.mz_unit().cv_ref(), Some("PX"));
    assert_eq!(result.retention_time_unit().accession(), Some("UO:0000010"));
    assert_eq!(
        result.intensity_unit().name(),
        Some("number of detector counts")
    );
}

#[test]
fn a_unit_declared_through_a_param_group_is_a_declaration_at_its_use_site() {
    let groups = group("mz", &mz_role(MZ_UNIT));
    let mz = array(&[&group_ref("mz"), F64, ZLIB], &zlib(&le_f64(&[101.0])));
    let referenced = spectrum(
        0,
        1,
        &ms1_terms(),
        &scan_list(60.0),
        &[mz, intensity_array(&[1.0])],
    );
    let direct = ms1(1, &[101.0], &[1.0]);
    let result = run(
        &document_with_groups(&groups, &[referenced, direct]),
        window(100.0, 102.0),
    )
    .unwrap();
    assert_eq!(result.mz_unit().accession(), Some("MS:1000040"));
    assert!(result.is_complete());
}

// ---------------------------------------------------------------------------
// ADR 0071 decision 4: the rules over in-scope scans
// ---------------------------------------------------------------------------

#[test]
fn mixed_polarity_among_in_scope_scans_refuses_the_query() {
    let positive = with_terms(0, &format!("{}{POSITIVE}", level(1)));
    let negative = with_terms(1, &format!("{}{NEGATIVE}", level(1)));
    let undeclared = with_terms(1, &level(1));
    assert_eq!(
        refuse(&[positive.clone(), negative]),
        XicRefusal::MixedPolarity
    );
    assert_eq!(refuse(&[positive, undeclared]), XicRefusal::MixedPolarity);
}

#[test]
fn polarity_outside_the_scope_is_not_read_and_one_polarity_is_reported() {
    let positive = with_terms(0, &format!("{}{POSITIVE}", level(1)));
    let other_level = with_terms(1, &format!("{}{NEGATIVE}", level(2)));
    let result = evaluate(&[positive, other_level]);
    assert_eq!(
        result.polarity(),
        MzmlDeclared::Value(MzmlPolarity::Positive)
    );
    assert!(result.is_complete());

    let undeclared = evaluate(&[with_terms(0, &level(1))]);
    assert_eq!(undeclared.polarity(), MzmlDeclared::NotDeclared);
}

#[test]
fn a_polarity_stated_two_ways_keeps_its_meaning_even_when_every_scan_does_it() {
    let both = with_terms(0, &format!("{}{POSITIVE}{NEGATIVE}", level(1)));
    assert_eq!(refuse(&[both]), XicRefusal::MixedPolarity);

    // Restating one polarity does not disagree with itself.
    let twice = with_terms(0, &format!("{}{POSITIVE}{POSITIVE}", level(1)));
    assert_eq!(
        evaluate(&[twice]).polarity(),
        MzmlDeclared::Value(MzmlPolarity::Positive)
    );
}

#[test]
fn polarity_follows_the_readers_rule_for_groups_and_for_the_scan() {
    // A group's polarity is the spectrum's, and conflicts with a direct one.
    let groups = group("negative", NEGATIVE);
    let referenced = with_terms(0, &format!("{}{}", level(1), group_ref("negative")));
    let result = run(
        &document_with_groups(&groups, std::slice::from_ref(&referenced)),
        window(100.0, 102.0),
    )
    .unwrap();
    assert_eq!(
        result.polarity(),
        MzmlDeclared::Value(MzmlPolarity::Negative)
    );
    let both = with_terms(
        0,
        &format!("{}{POSITIVE}{}", level(1), group_ref("negative")),
    );
    assert_eq!(
        run(
            &document_with_groups(&groups, &[both]),
            window(100.0, 102.0)
        ),
        Err(XicRefusal::MixedPolarity)
    );

    // A polarity stated only inside the scan is not the spectrum's.
    let in_scan = spectrum(
        0,
        1,
        &level(1),
        &format!(r#"<scanList count="1"><scan>{POSITIVE}</scan></scanList>"#),
        &[mz_array(&[101.0]), intensity_array(&[1.0])],
    );
    assert_eq!(evaluate(&[in_scan]).polarity(), MzmlDeclared::NotDeclared);
}

#[test]
fn mixed_faims_voltage_among_in_scope_scans_refuses_the_query() {
    let minus_45 = with_terms(0, &format!("{}{}", level(1), faims("-45")));
    let minus_60 = with_terms(1, &format!("{}{}", level(1), faims("-60")));
    let undeclared = with_terms(1, &level(1));
    assert_eq!(
        refuse(&[minus_45.clone(), minus_60]),
        XicRefusal::MixedFaimsCompensationVoltage
    );
    assert_eq!(
        refuse(&[minus_45, undeclared]),
        XicRefusal::MixedFaimsCompensationVoltage
    );
}

#[test]
fn one_faims_voltage_is_reported_as_a_number_on_either_element() {
    let on_spectrum = with_terms(0, &format!("{}{}", level(1), faims("-45")));
    let on_scan = spectrum(
        1,
        1,
        &level(1),
        &scan_list(60.0).replace("</scan>", &format!("{}</scan>", faims("-45.0"))),
        &[mz_array(&[101.0]), intensity_array(&[1.0])],
    );
    let result = evaluate(&[on_spectrum, on_scan]);
    assert_eq!(result.faims_compensation_voltage(), Some(-45.0));

    let other_level = with_terms(0, &format!("{}{}", level(2), faims("-60")));
    let none = with_terms(1, &level(1));
    assert_eq!(
        evaluate(&[other_level, none]).faims_compensation_voltage(),
        None
    );
}

#[test]
fn a_faims_voltage_that_cannot_be_read_or_conflicts_is_not_one_value() {
    for terms in [
        format!("{}{}", level(1), faims("high")),
        format!("{}{}{}", level(1), faims("-45"), faims("-60")),
    ] {
        assert_eq!(
            refuse(&[with_terms(0, &terms)]),
            XicRefusal::MixedFaimsCompensationVoltage
        );
    }
}

#[test]
fn mixed_representation_among_in_scope_scans_refuses_the_query() {
    let profile = with_terms(0, &format!("{}{PROFILE_TERM}", level(1)));
    let centroid = with_terms(1, &format!("{}{CENTROID_TERM}", level(1)));
    let undeclared = with_terms(1, &level(1));
    assert_eq!(
        refuse(&[profile.clone(), centroid]),
        XicRefusal::MixedRepresentation
    );
    assert_eq!(
        refuse(&[profile, undeclared]),
        XicRefusal::MixedRepresentation
    );
}

#[test]
fn ms1_profile_beside_ms2_centroid_is_served_with_its_representation() {
    let result = evaluate(&[
        with_terms(0, &format!("{}{PROFILE_TERM}", level(1))),
        with_terms(1, &format!("{}{CENTROID_TERM}", level(2))),
    ]);
    assert_eq!(result.representation(), MzmlRepresentation::Profile);
    assert_eq!(
        result.rows()[0].representation(),
        MzmlRepresentation::Profile
    );
    assert_eq!(
        result.rows()[1].representation(),
        MzmlRepresentation::Centroid
    );

    let undeclared = evaluate(&[with_terms(0, &level(1))]);
    assert_eq!(undeclared.representation(), MzmlRepresentation::NotDeclared);
}

#[test]
fn the_rules_are_taken_after_the_unit_rules_and_in_the_records_order() {
    let other = r#"unitAccession="X:1" unitName="other" unitCvRef="X""#;
    assert_eq!(
        refuse(&[
            with_terms(0, &format!("{}{POSITIVE}", level(1))),
            with_units(1, 1, MZ_UNIT, other, INTENSITY_UNIT),
        ]),
        XicRefusal::MixedUnit(XicAxis::RetentionTime)
    );
    assert_eq!(
        refuse(&[
            with_terms(0, &format!("{}{POSITIVE}{PROFILE_TERM}", level(1))),
            with_terms(1, &format!("{}{NEGATIVE}{CENTROID_TERM}", level(1))),
        ]),
        XicRefusal::MixedPolarity
    );
    assert_eq!(
        refuse(&[
            with_terms(0, &format!("{}{}{PROFILE_TERM}", level(1), faims("-40"))),
            with_terms(1, &format!("{}{}{CENTROID_TERM}", level(1), faims("-60"))),
        ]),
        XicRefusal::MixedFaimsCompensationVoltage
    );
}

#[test]
fn a_scan_with_no_declared_level_is_outside_decision_4s_rules() {
    let result = evaluate(&[
        with_terms(
            0,
            &format!("{}{POSITIVE}{}{PROFILE_TERM}", level(1), faims("-40")),
        ),
        with_terms(1, &format!("{NEGATIVE}{}{CENTROID_TERM}", faims("-60"))),
    ]);
    assert_eq!(
        result.polarity(),
        MzmlDeclared::Value(MzmlPolarity::Positive)
    );
    assert_eq!(result.faims_compensation_voltage(), Some(-40.0));
    assert_eq!(result.representation(), MzmlRepresentation::Profile);
    assert_eq!(result.rows()[1].state(), XicScanState::MsLevelUndeclared);
    assert_eq!(result.coverage_gaps(), 1);
}

fn with_scan_windows(index: u64, ms_level: u32, windows: &[(f64, f64)]) -> String {
    let windows: String = windows
        .iter()
        .map(|&(lower, upper)| {
            format!(
                "<scanWindow>{}{}</scanWindow>",
                cv("MS:1000501", &lower.to_string()),
                cv("MS:1000500", &upper.to_string())
            )
        })
        .collect();
    let list = if windows.is_empty() {
        String::new()
    } else {
        format!(r#"<scanWindowList count="1">{windows}</scanWindowList>"#)
    };
    spectrum(
        index,
        1,
        &level(ms_level),
        &format!(
            r#"<scanList count="1"><scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="60" {RT_UNIT}/>{list}</scan></scanList>"#
        ),
        &[mz_array(&[101.0]), intensity_array(&[1.0])],
    )
}

#[test]
fn a_window_outside_the_scanned_range_is_disclosed_and_stays_measured() {
    let result = evaluate(&[
        with_scan_windows(0, 1, &[(360.0, 1300.0)]),
        with_scan_windows(1, 1, &[(360.0, 1300.0)]),
        // Not in scope, so not counted.
        with_scan_windows(2, 2, &[(360.0, 1300.0)]),
    ]);
    assert_eq!(result.scans_outside_scan_window(), 2);
    assert!(!result.scan_windows_differ());
    assert!(matches!(
        result.rows()[0].state(),
        XicScanState::Measured { .. }
    ));
    assert!(result.is_complete());
}

#[test]
fn a_window_that_meets_any_scan_window_is_not_outside() {
    let result = evaluate(&[
        with_scan_windows(0, 1, &[(102.0, 200.0)]),
        with_scan_windows(1, 1, &[(50.0, 100.0)]),
        with_scan_windows(2, 1, &[(300.0, 400.0), (90.0, 110.0)]),
    ]);
    assert_eq!(result.scans_outside_scan_window(), 0);
    assert!(result.scan_windows_differ());
}

#[test]
fn differing_scan_windows_and_one_beside_none_are_disclosed_in_scope_only() {
    assert!(
        evaluate(&[
            with_scan_windows(0, 1, &[(50.0, 200.0)]),
            with_scan_windows(1, 1, &[]),
        ])
        .scan_windows_differ()
    );
    let result = evaluate(&[
        with_scan_windows(0, 1, &[(50.0, 200.0)]),
        with_scan_windows(1, 2, &[(50.0, 900.0)]),
    ]);
    assert!(!result.scan_windows_differ());
    assert_eq!(result.scans_outside_scan_window(), 0);
    // A scan that declares none is never counted as outside.
    assert_eq!(
        evaluate(&[with_scan_windows(0, 1, &[])]).scans_outside_scan_window(),
        0
    );
}

// ---------------------------------------------------------------------------
// Whole-query refusals of the document and its metadata
// ---------------------------------------------------------------------------

#[test]
fn equal_multiple_scans_are_accepted_and_differing_ones_refuse() {
    let time = |seconds: u32| {
        format!(
            r#"<scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{seconds}" {RT_UNIT}/></scan>"#
        )
    };
    let arrays = [mz_array(&[101.0]), intensity_array(&[1.0])];
    let equal = spectrum(
        0,
        1,
        &level(1),
        &format!(r#"<scanList count="2">{}{}</scanList>"#, time(60), time(60)),
        &arrays,
    );
    let result = evaluate(&[equal]);
    assert_eq!(result.rows()[0].retention_time(), Some(60.0));

    let differing = spectrum(
        0,
        1,
        &level(1),
        &format!(
            r#"<scanList count="2">{}{}</scanList>"#,
            time(60),
            time(120)
        ),
        &arrays,
    );
    assert_eq!(
        refuse(&[differing]),
        XicMetadataProblem::ConflictingTerm.into()
    );
}

#[test]
fn a_term_stated_two_ways_refuses_the_query_at_any_level() {
    for terms in [
        format!("{}{}", level(1), level(2)),
        format!("{}{PROFILE_TERM}{CENTROID_TERM}", level(1)),
        // In a scan the query excludes, too.
        format!("{}{PROFILE_TERM}{CENTROID_TERM}", level(2)),
        // Any attribute that differs is a different statement.
        format!(
            r#"{}<cvParam cvRef="MS" accession="MS:1000511" name="other" value="1"/>"#,
            level(1)
        ),
    ] {
        assert_eq!(
            refuse(&[with_terms(0, &terms)]),
            XicMetadataProblem::ConflictingTerm.into()
        );
    }
    // A restatement that is equal is one statement.
    let twice = format!("{}{}", level(1), level(1));
    assert!(evaluate(&[with_terms(0, &twice)]).is_complete());
}

#[test]
fn a_level_and_a_start_time_must_be_readable_when_stated() {
    let missing_value = r#"<cvParam cvRef="MS" accession="MS:1000511" name="ms level"/>"#;
    assert_eq!(
        refuse(&[with_terms(0, missing_value)]),
        XicMetadataProblem::Missing(XicRequiredValue::MsLevelValue).into()
    );
    assert_eq!(
        refuse(&[with_terms(0, &level(0))]),
        XicMetadataProblem::MsLevelNotPositive.into()
    );
    let not_a_number =
        r#"<cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="one"/>"#;
    assert_eq!(
        refuse(&[with_terms(0, not_a_number)]),
        MzmlScanError::Malformed(MzmlMalformedKind::InvalidNumber).into()
    );

    let arrays = [mz_array(&[101.0]), intensity_array(&[1.0])];
    let no_value = format!(
        r#"<scanList count="1"><scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" {RT_UNIT}/></scan></scanList>"#
    );
    assert_eq!(
        refuse(&[spectrum(0, 1, &level(1), &no_value, &arrays)]),
        XicMetadataProblem::Missing(XicRequiredValue::ScanStartTimeValue).into()
    );
    let infinite = format!(
        r#"<scanList count="1"><scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="inf" {RT_UNIT}/></scan></scanList>"#
    );
    assert_eq!(
        refuse(&[spectrum(0, 1, &level(1), &infinite, &arrays)]),
        MzmlScanError::Malformed(MzmlMalformedKind::NonFiniteNumber).into()
    );
}

#[test]
fn the_required_values_are_this_passs_own() {
    // No base peak, no TIC and no observed m/z range, which the viewer requires.
    assert!(evaluate(&[ms1(0, &[101.0], &[1.0])]).is_complete());

    let refused = |spectrum: &str, which| {
        assert_eq!(
            refuse(&[spectrum.to_owned()]),
            XicMetadataProblem::Missing(which).into()
        );
    };
    refused(
        r#"<spectrum id="s" defaultArrayLength="0"/>"#,
        XicRequiredValue::Index,
    );
    refused(
        r#"<spectrum index="0" defaultArrayLength="0"/>"#,
        XicRequiredValue::NativeId,
    );
    refused(
        r#"<spectrum index="0" id="" defaultArrayLength="0"/>"#,
        XicRequiredValue::NativeId,
    );
    refused(
        r#"<spectrum index="0" id="s"/>"#,
        XicRequiredValue::DefaultArrayLength,
    );
    refused(
        r#"<spectrum index="0" id="s" defaultArrayLength="0"><scanList/></spectrum>"#,
        XicRequiredValue::ScanListCount,
    );
    refused(
        r#"<spectrum index="0" id="s" defaultArrayLength="0"><binaryDataArrayList/></spectrum>"#,
        XicRequiredValue::ArrayListCount,
    );
}

#[test]
fn two_spectra_may_not_share_an_index_or_a_native_id() {
    assert_eq!(
        refuse(&[ms1(0, &[101.0], &[1.0]), ms1(0, &[101.0], &[1.0])]),
        XicMetadataProblem::DuplicateIdentity.into()
    );
    assert_eq!(
        refuse(&[
            r#"<spectrum index="0" id="same" defaultArrayLength="0"/>"#.to_owned(),
            r#"<spectrum index="1" id="same" defaultArrayLength="0"/>"#.to_owned(),
        ]),
        XicMetadataProblem::DuplicateIdentity.into()
    );
}

#[test]
fn a_shared_identity_is_the_reason_whatever_the_order_of_the_scans() {
    let other = r#"unitAccession="X:1" unitName="other" unitCvRef="X""#;
    let good = with_units(0, 1, MZ_UNIT, RT_UNIT, INTENSITY_UNIT);
    // Shares the first scan's native ID, under its own index.
    let shared = with_units(7, 1, MZ_UNIT, RT_UNIT, INTENSITY_UNIT)
        .replace(r#"id="scan=8""#, r#"id="scan=1""#);
    let mix = with_units(8, 1, other, RT_UNIT, INTENSITY_UNIT);
    // In the first and the third the refusal is already certain when the shared
    // identity is read.
    for spectra in [
        [good.clone(), mix.clone(), shared.clone()],
        [good.clone(), shared.clone(), mix.clone()],
        [mix, good, shared],
    ] {
        assert_eq!(
            refuse(&spectra),
            XicMetadataProblem::DuplicateIdentity.into()
        );
    }
    let positive = with_terms(0, &format!("{}{POSITIVE}", level(1)));
    let negative = with_terms(1, &format!("{}{NEGATIVE}", level(1)));
    let repeated = with_terms(1, &format!("{}{POSITIVE}", level(1)));
    assert_eq!(
        refuse(&[positive, negative, repeated]),
        XicMetadataProblem::DuplicateIdentity.into()
    );
}

#[test]
fn a_list_count_that_disagrees_with_its_members_refuses_the_query() {
    let good = ms1(0, &[101.0], &[1.0]);
    let overstated = document(std::slice::from_ref(&good));
    let overstated = String::from_utf8(overstated)
        .unwrap()
        .replace(r#"<spectrumList count="1">"#, r#"<spectrumList count="2">"#);
    assert_eq!(
        run(overstated.as_bytes(), window(100.0, 102.0)),
        Err(XicMetadataProblem::CountDisagrees(XicRequiredValue::SpectrumListCount).into())
    );
    let scans = good.replace(r#"<scanList count="1">"#, r#"<scanList count="2">"#);
    assert_eq!(
        refuse(&[scans]),
        XicMetadataProblem::CountDisagrees(XicRequiredValue::ScanListCount).into()
    );
    let arrays = good.replace(
        r#"<binaryDataArrayList count="2">"#,
        r#"<binaryDataArrayList count="3">"#,
    );
    assert_eq!(
        refuse(&[arrays]),
        XicMetadataProblem::CountDisagrees(XicRequiredValue::ArrayListCount).into()
    );
}

#[test]
fn the_run_must_hold_exactly_one_spectrum_list_and_a_wrapper_one_mzml() {
    let head = r#"<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">"#;
    let none = format!(r#"{head}<run id="r"/></mzML>"#);
    assert_eq!(
        run(none.as_bytes(), window(100.0, 102.0)),
        Err(XicMetadataProblem::NotOneSpectrumList.into())
    );
    let two = format!(
        r#"{head}<run id="r"><spectrumList count="0"/><spectrumList count="0"/></run></mzML>"#
    );
    assert_eq!(
        run(two.as_bytes(), window(100.0, 102.0)),
        Err(XicMetadataProblem::NotOneSpectrumList.into())
    );
    let no_count = format!(r#"{head}<run id="r"><spectrumList/></run></mzML>"#);
    assert_eq!(
        run(no_count.as_bytes(), window(100.0, 102.0)),
        Err(XicMetadataProblem::Missing(XicRequiredValue::SpectrumListCount).into())
    );
    let inner = r#"<mzML version="1.1.0"><run id="r"><spectrumList count="0"/></run></mzML>"#;
    let wrapped =
        format!(r#"<indexedmzML xmlns="http://psi.hupo.org/ms/mzml">{inner}{inner}</indexedmzML>"#);
    assert_eq!(
        run(wrapped.as_bytes(), window(100.0, 102.0)),
        Err(XicMetadataProblem::NotOneMzml.into())
    );
    let empty = r#"<indexedmzML xmlns="http://psi.hupo.org/ms/mzml"></indexedmzML>"#;
    assert_eq!(
        run(empty.as_bytes(), window(100.0, 102.0)),
        Err(MzmlOpenError::NotMzml11.into())
    );
    let nested = format!("{head}{inner}</mzML>");
    assert_eq!(
        run(nested.as_bytes(), window(100.0, 102.0)),
        Err(XicMetadataProblem::NotOneMzml.into())
    );
}

#[test]
fn an_array_role_may_not_repeat_or_combine_and_any_other_array_is_ignored() {
    let time = scan_list(60.0);
    let level_one = level(1);
    assert_eq!(
        refuse(&[spectrum(
            0,
            1,
            &level_one,
            &time,
            &[
                mz_array(&[101.0]),
                mz_array(&[101.0]),
                intensity_array(&[1.0])
            ],
        )]),
        XicMetadataProblem::DuplicateArrayRole.into()
    );
    let both = array(
        &[
            &mz_role(MZ_UNIT),
            &intensity_role(INTENSITY_UNIT),
            F64,
            ZLIB,
        ],
        &zlib(&le_f64(&[101.0])),
    );
    assert_eq!(
        refuse(&[spectrum(0, 1, &level_one, &time, &[both])]),
        XicMetadataProblem::ConflictingTerm.into()
    );
    // The reader's rule for an array neither m/z nor intensity: not decoded.
    let other = array(&[&cv("MS:1000516", ""), F64, ZLIB], "%%%not-base64%%%");
    assert_eq!(
        only_state(&[spectrum(
            0,
            1,
            &level_one,
            &time,
            &[other, mz_array(&[101.0]), intensity_array(&[1.0])],
        )]),
        XicScanState::Measured {
            sum: 1.0,
            points_in_window: 1
        }
    );
    // A time array is read for its role only. One is ignored; two are a repeat.
    let time_array = array(&[&cv("MS:1000595", ""), F64, ZLIB], "%%%not-base64%%%");
    let pair = [mz_array(&[101.0]), intensity_array(&[1.0])];
    let with_time = [pair[0].clone(), pair[1].clone(), time_array.clone()];
    assert_eq!(
        only_state(&[spectrum(0, 1, &level_one, &time, &with_time)]),
        XicScanState::Measured {
            sum: 1.0,
            points_in_window: 1
        }
    );
    let [mz, intensity] = pair;
    assert_eq!(
        refuse(&[spectrum(
            0,
            1,
            &level_one,
            &time,
            &[mz, intensity, time_array.clone(), time_array],
        )]),
        XicMetadataProblem::DuplicateArrayRole.into()
    );
}

/// One array with two `binary` elements.
fn two_payloads(role: &str, first: &[f64], second: &[f64]) -> String {
    let joined = format!(
        "{}</binary><binary>{}",
        plain(&le_f64(first)),
        plain(&le_f64(second))
    );
    array(&[role, F64, NO_COMPRESSION], &joined)
}

fn two_array_scan(length: u64, mz: String, intensity: String) -> String {
    spectrum(0, length, &ms1_terms(), &scan_list(60.0), &[mz, intensity])
}

#[test]
fn two_payloads_in_one_array_are_refused_and_never_joined() {
    let refused = |role| XicScanState::Unreadable {
        role,
        reason: XicUnreadableReason::PayloadStatedTwice,
    };
    let mz_role = mz_role(MZ_UNIT);
    let intensity_role = intensity_role(INTENSITY_UNIT);
    // Three doubles are 32 base64 characters with no padding, so the two texts
    // would join into one valid payload of six. One double ends in padding,
    // which a join would corrupt. The answer is the same either way.
    let six = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
    assert_eq!(
        only_state(&[two_array_scan(
            6,
            two_payloads(&mz_role, &[100.0, 100.5, 101.0], &[101.0, 101.5, 102.0]),
            intensity_array(&six),
        )]),
        refused(ArrayRole::Mz)
    );
    assert_eq!(
        only_state(&[two_array_scan(
            2,
            two_payloads(&mz_role, &[100.0], &[101.0]),
            intensity_array(&[1.0, 2.0]),
        )]),
        refused(ArrayRole::Mz)
    );
    assert_eq!(
        only_state(&[two_array_scan(
            6,
            mz_array(&[100.0, 100.5, 101.0, 101.0, 101.5, 102.0]),
            two_payloads(&intensity_role, &six[..3], &six[3..]),
        )]),
        refused(ArrayRole::Intensity)
    );
    // The first reason stands, and the pass goes on to the next scan.
    let numpress = format!("{mz_role}{}", cv("MS:1002312", ""));
    let result = evaluate(&[
        two_array_scan(
            2,
            two_payloads(&numpress, &[100.0], &[101.0]),
            intensity_array(&[1.0, 2.0]),
        ),
        ms1(1, &[101.0], &[1.0]),
    ]);
    assert_eq!(
        result.rows()[0].state(),
        unreadable(ArrayRole::Mz, ArrayProblem::Numpress)
    );
    assert_eq!(
        result.rows()[1].state(),
        XicScanState::Measured {
            sum: 1.0,
            points_in_window: 1
        }
    );
}

#[test]
fn a_reference_in_a_payload_joins_it_or_refuses_the_array() {
    let values = plain(&le_f64(&[101.0]));
    let role = mz_role(MZ_UNIT);
    let first = values.chars().next().unwrap();
    let with_character = format!("&#{};{}", u32::from(first), &values[first.len_utf8()..]);
    let state = |payload: &str, extra: &str| {
        only_state(&[spectrum(
            0,
            1,
            &level(1),
            &scan_list(60.0),
            &[
                array(&[&role, F64, NO_COMPRESSION, extra], payload),
                intensity_array(&[1.0]),
            ],
        )])
    };
    assert_eq!(
        state(&with_character, ""),
        XicScanState::Measured {
            sum: 1.0,
            points_in_window: 1
        }
    );
    assert_eq!(
        state(&format!("{values}&amp;"), ""),
        unreadable(ArrayRole::Mz, ArrayProblem::CorruptBase64)
    );
    // An array already refused keeps its first reason.
    assert_eq!(
        state(&format!("{values}&amp;"), &cv("MS:1002312", "")),
        unreadable(ArrayRole::Mz, ArrayProblem::Numpress)
    );
}

#[test]
fn bytes_after_the_zlib_stream_are_a_corrupt_stream() {
    let mut raw = STANDARD
        .decode(zlib(&le_f64(&[101.0])))
        .expect("the helper's own base64");
    raw.push(b'x');
    let payload = plain(&raw);
    assert_eq!(
        only_state(&[spectrum(
            0,
            1,
            &level(1),
            &scan_list(60.0),
            &[
                array(&[&mz_role(MZ_UNIT), F64, ZLIB], &payload),
                intensity_array(&[1.0]),
            ],
        )]),
        unreadable(ArrayRole::Mz, ArrayProblem::CorruptZlib)
    );
}

#[test]
fn a_spectrum_outside_the_list_does_not_close_the_open_one() {
    let nested = scan_list(60.0).replace(
        "</scan>",
        r#"<spectrum index="9" id="elsewhere" defaultArrayLength="0"/></scan>"#,
    );
    let result = evaluate(&[spectrum(
        0,
        1,
        &level(1),
        &nested,
        &[mz_array(&[101.0]), intensity_array(&[1.0])],
    )]);
    assert_eq!(result.rows().len(), 1);
    assert_eq!(
        result.rows()[0].state(),
        XicScanState::Measured {
            sum: 1.0,
            points_in_window: 1
        }
    );
}

#[test]
fn a_term_restated_with_its_attributes_in_another_order_does_not_conflict() {
    let reordered = r#"<cvParam value="1" name="ms level" accession="MS:1000511" cvRef="MS"/>"#;
    assert_eq!(
        only_state(&[with_terms(0, &format!("{}{reordered}", level(1)))]),
        XicScanState::Measured {
            sum: 1.0,
            points_in_window: 1
        }
    );
}

#[test]
fn param_groups_are_read_at_their_use_site_and_refused_as_the_reader_refuses_them() {
    let groups = group("spectrum", &format!("{}{PROFILE_TERM}", level(1)));
    let referenced = with_terms(0, &group_ref("spectrum"));
    let result = run(
        &document_with_groups(&groups, &[referenced]),
        window(100.0, 102.0),
    )
    .unwrap();
    assert_eq!(result.rows()[0].ms_level(), Some(1));
    assert_eq!(result.representation(), MzmlRepresentation::Profile);

    assert_eq!(
        refuse(&[with_terms(0, &group_ref("missing"))]),
        MzmlOpenError::UndefinedParamGroup.into()
    );
    let nested = group("outer", &group_ref("outer"));
    assert!(matches!(
        run(&document_with_groups(&nested, &[]), window(100.0, 102.0)),
        Err(XicRefusal::Document(_))
    ));
    let no_id = r#"<referenceableParamGroupList count="1"><referenceableParamGroup/></referenceableParamGroupList>"#;
    assert_eq!(
        run(&document_with_groups(no_id, &[]), window(100.0, 102.0)),
        Err(MzmlOpenError::AmbiguousParamGroup.into())
    );
    let repeated = r#"<referenceableParamGroupList count="2"><referenceableParamGroup id="g"/><referenceableParamGroup id="g"/></referenceableParamGroupList>"#;
    assert_eq!(
        run(&document_with_groups(repeated, &[]), window(100.0, 102.0)),
        Err(MzmlOpenError::AmbiguousParamGroup.into())
    );
}

#[test]
fn the_readers_document_refusals_carry_over() {
    let refused = |text: &str, expected: XicRefusal| {
        assert_eq!(run(text.as_bytes(), window(100.0, 102.0)), Err(expected));
    };
    refused(
        r#"<?xml version="1.0"?><!DOCTYPE mzML []><mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0"/>"#,
        MzmlScanError::Unsafe(UnsafeXmlKind::DoctypeDeclaration).into(),
    );
    refused(
        r#"<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">&custom;</mzML>"#,
        MzmlScanError::Unsafe(UnsafeXmlKind::UndeclaredEntity).into(),
    );
    refused(
        r#"<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.0.0"/>"#,
        MzmlOpenError::NotMzml11.into(),
    );
    refused(
        r#"<?xml version="1.0" encoding="latin1"?><mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0"/>"#,
        MzmlOpenError::NotUtf8.into(),
    );
    refused(
        r#"<mzML version="1.1.0"/>"#,
        MzmlScanError::Malformed(MzmlMalformedKind::UnexpectedRoot).into(),
    );
    refused(
        "",
        MzmlScanError::Malformed(MzmlMalformedKind::MissingRootElement).into(),
    );
}

#[test]
fn an_undefined_param_group_is_refused_outside_every_read_scope() {
    let configuration = format!(
        r#"<instrumentConfigurationList count="1"><instrumentConfiguration id="i">{}</instrumentConfiguration></instrumentConfigurationList>"#,
        group_ref("nowhere")
    );
    assert_eq!(
        run(
            &document_with_groups(&configuration, &[ms1(0, &[101.0], &[1.0])]),
            window(100.0, 102.0)
        ),
        Err(MzmlOpenError::UndefinedParamGroup.into())
    );
}

/// The shape of the frozen row `inherited_tiny.pwiz.1.1.mzML`, which is not read
/// here: an index wrapper under an ISO-8859-1 declaration, all ASCII.
fn declared_iso_8859_1(spectra: &[String]) -> Vec<u8> {
    format!(
        r#"<?xml version="1.0" encoding="ISO-8859-1"?><indexedmzML xmlns="http://psi.hupo.org/ms/mzml"><mzML version="1.1.0"><run id="r"><spectrumList count="{}">{}</spectrumList></run></mzML></indexedmzML>"#,
        spectra.len(),
        spectra.concat()
    )
    .into_bytes()
}

fn inserted(document: &[u8], before: &str, bytes: &[u8]) -> Vec<u8> {
    let at = document
        .windows(before.len())
        .position(|slice| slice == before.as_bytes())
        .unwrap();
    [&document[..at], bytes, &document[at..]].concat()
}

#[test]
fn an_iso_8859_1_declaration_is_read_when_every_byte_is_ascii() {
    let minute = r#"unitAccession="UO:0000031" unitName="minute" unitCvRef="UO""#;
    let query = XicQuery::from_bounds(1, 2.0, 4.0).unwrap();
    let scan = |index, seconds| with_units(index, 1, MZ_UNIT, seconds, INTENSITY_UNIT);
    let mixed = [
        scan(0, minute),
        scan(1, minute),
        scan(2, ""),
        scan(3, RT_UNIT),
    ];
    assert_eq!(
        run(&declared_iso_8859_1(&mixed), query),
        Err(XicRefusal::MixedUnit(XicAxis::RetentionTime))
    );
    let uniform = [ms1(0, &[3.0], &[5.0])];
    assert_eq!(
        run(&declared_iso_8859_1(&uniform), query).unwrap().rows()[0].state(),
        XicScanState::Measured {
            sum: 5.0,
            points_in_window: 1
        }
    );
    // The label is the one the frozen input states, in any case, and no other.
    let lower = String::from_utf8(declared_iso_8859_1(&uniform))
        .unwrap()
        .replace("ISO-8859-1", "iso-8859-1");
    assert!(run(lower.as_bytes(), query).is_ok());
    let other_label = lower.replace("iso-8859-1", "windows-1252");
    assert_eq!(
        run(other_label.as_bytes(), query),
        Err(MzmlOpenError::NotUtf8.into())
    );
}

#[test]
fn an_iso_8859_1_declaration_refuses_any_byte_that_is_not_ascii() {
    let query = window(100.0, 102.0);
    let ascii = declared_iso_8859_1(&[ms1(0, &[101.0], &[1.0])]);
    for bytes in [
        // These two are one character in UTF-8, and two in the encoding the
        // document declares.
        inserted(&ascii, "scan=1", &[0xc3, 0xa9]),
        inserted(&ascii, "scan=1", &[0xe9]),
        // Nothing in the pass reads a comment or a text it does not know.
        inserted(&ascii, "<run", b"<!-- \xe9 -->"),
        inserted(&ascii, "<run", b"<fileContent>\xe9</fileContent>"),
    ] {
        assert_eq!(run(&bytes, query), Err(MzmlOpenError::NotUtf8.into()));
    }
    // Under a UTF-8 declaration the same two bytes are the one character.
    let utf8 = document(&[ms1(0, &[101.0], &[1.0])]);
    assert!(run(&inserted(&utf8, "scan=1", &[0xc3, 0xa9]), query).is_ok());
}

#[test]
fn a_truncated_document_is_refused_and_never_a_silent_prefix() {
    let whole = document(&[ms1(0, &[101.0], &[1.0]), ms1(1, &[101.0], &[1.0])]);
    for cut in [whole.len() - 10, whole.len() / 2] {
        assert!(matches!(
            run(&whole[..cut], window(100.0, 102.0)),
            Err(XicRefusal::Document(_))
        ));
    }
}

#[test]
fn a_prefixed_document_reads_like_its_unprefixed_form() {
    let plain_document = String::from_utf8(document(&[ms1(0, &[101.0], &[1.0])])).unwrap();
    let body = plain_document
        .replace("<?xml version=\"1.0\" encoding=\"utf-8\"?>", "")
        .replace(
            r#"xmlns="http://psi.hupo.org/ms/mzml""#,
            r#"xmlns:p="http://psi.hupo.org/ms/mzml""#,
        )
        .replace("</", "\u{1}")
        .replace('<', "<p:")
        .replace('\u{1}', "</p:");
    assert_eq!(
        run(body.as_bytes(), window(100.0, 102.0)).unwrap(),
        run(plain_document.as_bytes(), window(100.0, 102.0)).unwrap()
    );
}

#[test]
fn elements_outside_the_namespace_are_not_the_documents() {
    let foreign = format!(
        r#"<x:spectrum xmlns:x="urn:other" index="0" id="s" defaultArrayLength="0"/>{}"#,
        ms1(0, &[101.0], &[1.0])
    );
    assert_eq!(evaluate(&[foreign]).rows().len(), 1);
}

#[test]
fn the_inspectors_limits_stay_the_outer_bound() {
    let spectra = [ms1(0, &[101.0], &[1.0]), ms1(1, &[101.0], &[1.0])];
    let limited = read_xic_from(
        Cursor::new(document(&spectra)),
        &window(100.0, 102.0),
        MzmlScanLimits::default().with_max_spectra(1),
        &mut XicIdentity,
        || false,
    );
    assert_eq!(
        limited,
        Err(MzmlScanError::LimitExceeded(MzmlLimitKind::Spectra).into())
    );
}

#[test]
fn a_refused_path_is_a_document_refusal_with_nothing_read() {
    let missing = std::env::temp_dir().join("mscanvas-xic-no-such-file.mzML");
    assert!(matches!(
        read_xic(
            &missing,
            &window(100.0, 102.0),
            MzmlScanLimits::default(),
            || false
        ),
        Err(XicRefusal::Document(_))
    ));
}

#[test]
fn the_product_entry_point_reads_a_file_with_the_identity() {
    let spectra = [ms1(0, &[101.0], &[1.0])];
    let path = std::env::temp_dir().join(format!("mscanvas-xic-{}.mzML", std::process::id()));
    std::fs::write(&path, document(&spectra)).unwrap();
    let result = read_xic(
        &path,
        &window(100.0, 102.0),
        MzmlScanLimits::default(),
        || false,
    );
    std::fs::remove_file(&path).unwrap();
    assert_eq!(result.unwrap(), evaluate(&spectra));
}

// ---------------------------------------------------------------------------
// One pass: order, cancellation, the transform
// ---------------------------------------------------------------------------

#[test]
fn the_order_of_the_arrays_in_the_document_does_not_change_the_answer() {
    let forward = spectrum(
        0,
        1,
        &level(1),
        &scan_list(60.0),
        &[mz_array(&[101.0]), intensity_array(&[1.0])],
    );
    let reversed = spectrum(
        0,
        1,
        &level(1),
        &scan_list(60.0),
        &[intensity_array(&[1.0]), mz_array(&[101.0])],
    );
    assert_eq!(evaluate(&[forward]), evaluate(&[reversed]));
}

#[test]
fn terms_after_the_arrays_still_decide_the_scan() {
    // Out of the schema's order, the level arrives after the payloads were kept.
    let arrays = format!(
        r#"<binaryDataArrayList count="2">{}{}</binaryDataArrayList>"#,
        mz_array(&[101.0]),
        intensity_array(&[1.0])
    );
    let late = format!(
        r#"<spectrum index="0" id="s" defaultArrayLength="1">{arrays}{}</spectrum>"#,
        level(1)
    );
    assert!(matches!(only_state(&[late]), XicScanState::Measured { .. }));
}

#[test]
fn cancellation_is_asked_between_spectra_and_returns_no_result() {
    let spectra = [
        ms1(0, &[101.0], &[1.0]),
        ms1(1, &[101.0], &[1.0]),
        ms1(2, &[101.0], &[1.0]),
    ];
    let document = document(&spectra);
    let query = window(100.0, 102.0);
    let run_until = |stop_at: u32| {
        let mut asked = 0;
        let result = read_xic_from(
            Cursor::new(document.as_slice()),
            &query,
            MzmlScanLimits::default(),
            &mut XicIdentity,
            || {
                asked += 1;
                asked == stop_at
            },
        );
        (result, asked)
    };
    // Before each of the three spectra, and once after the last.
    let (result, asked) = run_until(0);
    assert_eq!(result.unwrap().rows().len(), 3);
    assert_eq!(asked, 4);
    for stop_at in 1..=4 {
        let (result, asked) = run_until(stop_at);
        assert_eq!(result, Err(XicRefusal::Cancelled));
        assert_eq!(asked, stop_at);
    }
}

#[derive(Default)]
struct Narrowing {
    seen: Vec<f64>,
}

impl XicSpectrumTransform for Narrowing {
    fn apply(&mut self, retention_time: &mut Option<f64>, mz: &mut [f64], intensity: &mut [f64]) {
        self.seen.push(mz[0]);
        *retention_time = retention_time.map(|seconds| seconds / 60.0);
        for value in intensity {
            *value = f64::from(*value as f32);
        }
    }
}

#[test]
fn a_transform_is_applied_between_decode_and_sum_in_source_order() {
    let stored = 1.0 + 2.0_f64.powi(-30);
    let spectra = [
        ms1(0, &[101.0], &[stored]),
        ms1(1, &[100.0], &[stored]),
        with_terms(2, &level(2)),
    ];
    let document = document(&spectra);
    let query = window(100.0, 102.0);
    let mut transform = Narrowing::default();
    let narrowed = read_xic_from(
        Cursor::new(document.as_slice()),
        &query,
        MzmlScanLimits::default(),
        &mut transform,
        || false,
    )
    .unwrap();
    let identity = run(&document, query).unwrap();

    // Each in-scope spectrum once, in order, and no excluded one.
    assert_eq!(transform.seen, [101.0, 100.0]);
    assert_eq!(narrowed.rows()[0].retention_time(), Some(1.0));
    assert_eq!(
        narrowed.rows()[0].state(),
        XicScanState::Measured {
            sum: 1.0,
            points_in_window: 1
        }
    );
    assert_eq!(identity.rows()[0].retention_time(), Some(60.0));
    assert_eq!(
        identity.rows()[0].state(),
        XicScanState::Measured {
            sum: stored,
            points_in_window: 1
        }
    );
}

#[test]
fn no_array_is_decoded_once_a_refusal_is_certain() {
    let spectra = [
        with_terms(0, &format!("{}{POSITIVE}", level(1))),
        with_terms(1, &format!("{}{NEGATIVE}", level(1))),
        // This scan's integer would otherwise end the pass with another reason.
        spectrum(
            2,
            1,
            &format!("{}{POSITIVE}", level(1)),
            &scan_list(60.0),
            &[
                array(
                    &[&mz_role(MZ_UNIT), I64, ZLIB],
                    &zlib(&((1_i64 << 53) + 1).to_le_bytes()),
                ),
                intensity_array(&[1.0]),
            ],
        ),
    ];
    let mut transform = Narrowing::default();
    let refused = read_xic_from(
        Cursor::new(document(&spectra)),
        &window(100.0, 102.0),
        MzmlScanLimits::default(),
        &mut transform,
        || false,
    );
    assert_eq!(refused, Err(XicRefusal::MixedPolarity));
    assert_eq!(transform.seen.len(), 1);
}

// ---------------------------------------------------------------------------
// The exact sum (XIC-S3)
// ---------------------------------------------------------------------------

fn exact_sum(values: &[u64]) -> Option<u64> {
    let mut sum = ExactSum::default();
    for &bits in values {
        sum.add(f64::from_bits(bits));
    }
    sum.finish().map(f64::to_bits)
}

/// Expected bits from Python's `fractions.Fraction`, the frozen oracle's own
/// reference, computed apart from this code. The values are the arithmetic the
/// PX.3 protocol names: rounding ties, subnormals, cancellation and the range.
const NAMED_SUMS: &[(&[u64], Option<u64>)] = &[
    // A tie broken only by a bit in a lower limb, then only by a lower bit of
    // the limb that holds the round bit.
    (
        &[
            0x3ff0_0000_0000_0000,
            0x3ca0_0000_0000_0000,
            0x0170_0000_0000_0000,
        ],
        Some(0x3ff0_0000_0000_0001),
    ),
    (
        &[
            0x3ff0_0000_0000_0000,
            0x3ca0_0000_0000_0000,
            0x3c30_0000_0000_0000,
        ],
        Some(0x3ff0_0000_0000_0001),
    ),
    // A subtraction whose borrow crosses a limb.
    (
        &[
            0x44d0_0000_0000_0000,
            0x40f4_0000_0000_0000,
            0xbcd0_0000_0000_0000,
            0xc0f4_0000_0000_0000,
        ],
        Some(0x44d0_0000_0000_0000),
    ),
    (
        &[
            0x3fb9_9999_9999_999a,
            0x3fc9_9999_9999_999a,
            0x3fd3_3333_3333_3333,
        ],
        Some(0x3fe3_3333_3333_3333),
    ),
    (
        &[
            0x4340_0000_0000_0000,
            0x3ff0_0000_0000_0000,
            0xc340_0000_0000_0000,
        ],
        Some(0x3ff0_0000_0000_0000),
    ),
    (
        &[
            0x7fef_ffff_ffff_ffff,
            0x7fef_ffff_ffff_ffff,
            0xffef_ffff_ffff_ffff,
        ],
        Some(0x7fef_ffff_ffff_ffff),
    ),
    (&[0x3ff0_0000_0040_0000], Some(0x3ff0_0000_0040_0000)),
    (&[0x0000_0000_0000_0001], Some(0x0000_0000_0000_0001)),
    (
        &[
            0x0000_0000_0000_0001,
            0x0000_0000_0000_0001,
            0x0000_0000_0000_0001,
        ],
        Some(0x0000_0000_0000_0003),
    ),
    (&[0x8000_0000_0000_0000], Some(0x0000_0000_0000_0000)),
    (
        &[0x3ff0_0000_0000_0000, 0xbff0_0000_0000_0000],
        Some(0x0000_0000_0000_0000),
    ),
    (
        &[0x3ff0_0000_0000_0000, 0x3ca0_0000_0000_0000],
        Some(0x3ff0_0000_0000_0000),
    ),
    (
        &[0x3ff0_0000_0000_0001, 0x3ca0_0000_0000_0000],
        Some(0x3ff0_0000_0000_0002),
    ),
    (
        &[
            0xbfb9_9999_9999_999a,
            0xbfc9_9999_9999_999a,
            0x3fd3_3333_3333_3333,
        ],
        Some(0xbc80_0000_0000_0000),
    ),
    (&[0x7fef_ffff_ffff_ffff, 0x0000_0000_0000_0001], None),
    (&[0xffef_ffff_ffff_ffff, 0xffef_ffff_ffff_ffff], None),
    (&[0x3f0a_36e2_eb1c_432d], Some(0x3f0a_36e2_eb1c_432d)),
    (
        &[
            0x3ee4_f8b5_88e3_68f1,
            0x3ee4_f8b5_88e3_68f1,
            0x3ee4_f8b5_88e3_68f1,
            0x3ee4_f8b5_88e3_68f1,
            0x3ee4_f8b5_88e3_68f1,
        ],
        Some(0x3f0a_36e2_eb1c_432d),
    ),
    (&[0x7fef_ffff_ffff_ffff], Some(0x7fef_ffff_ffff_ffff)),
    (&[0xffef_ffff_ffff_ffff], Some(0xffef_ffff_ffff_ffff)),
    (&[0xffef_ffff_ffff_ffff, 0x8000_0000_0000_0001], None),
    (
        &[0xbff0_0000_0000_0000, 0xbca0_0000_0000_0000],
        Some(0xbff0_0000_0000_0000),
    ),
    (
        &[0xbff0_0000_0000_0001, 0xbca0_0000_0000_0000],
        Some(0xbff0_0000_0000_0002),
    ),
    (
        &[0x3fff_ffff_ffff_ffff, 0x3ca0_0000_0000_0000],
        Some(0x4000_0000_0000_0000),
    ),
    (
        &[0x000f_ffff_ffff_ffff, 0x0000_0000_0000_0001],
        Some(0x0010_0000_0000_0000),
    ),
];

/// The same reference over pseudo-random values chosen by their bits, across
/// the exponent range, so that sums carry, cancel and round.
const WIDE_SUMS: &[(&[u64], Option<u64>)] = &[
    (
        &[0x802f_ffff_ffff_ffff, 0x002f_ffff_ffff_ffff],
        Some(0x0000_0000_0000_0000),
    ),
    (
        &[
            0x7fe2_ddf3_8045_c635,
            0xbffe_08f3_7418_6a99,
            0x8011_2ebe_079d_16b1,
        ],
        Some(0x7fe2_ddf3_8045_c635),
    ),
    (
        &[
            0xc33b_b912_2a7c_31ca,
            0x0020_0000_0000_0001,
            0xfd09_aa75_1a9a_4759,
            0x002a_7500_2d38_dcda,
            0x0002_d3d6_3739_625e,
            0x8005_af06_f8e2_fb32,
            0xffd3_969c_e0c7_29ef,
            0xbffd_c308_9104_ae45,
            0x4335_a229_944f_0185,
        ],
        Some(0xffd3_969c_e0c7_2abc),
    ),
    (
        &[
            0x801a_c4d2_d5d8_4f2a,
            0x8011_f38f_e496_09ec,
            0xffdd_356f_4cf9_8252,
            0x0005_29bd_f15c_191e,
            0xfd04_82f4_91b8_e393,
        ],
        Some(0xffdd_356f_4cf9_82f6),
    ),
    (
        &[
            0x002d_2346_a27f_621a,
            0x8000_0000_0000_0000,
            0xc332_cea4_f056_3ee7,
            0x8007_ccfc_ca8c_ece0,
            0x0019_13b4_aee1_b460,
            0xc00c_f299_fee4_6df5,
            0x7fd9_86cf_17ff_4f62,
            0xffe0_0000_0000_0000,
            0x4334_af44_1ee3_1bbc,
            0xc330_0000_0000_0001,
            0x7d09_3c4b_d8d1_79ce,
            0xc334_c3f5_48ae_397d,
            0xfd0f_809e_0f0d_9138,
            0x8010_0000_0000_0001,
            0x802a_adde_e3d5_42bf,
            0x3e80_0000_0000_0001,
            0x7fd0_0000_0000_0000,
        ],
        Some(0x7fc3_0d9e_2ffe_9e60),
    ),
    (
        &[
            0x4331_bf1e_d650_b518,
            0xc339_ff76_5938_a5f9,
            0xc00f_ffff_ffff_ffff,
            0x8329_7019_7cb0_ee2c,
            0x001e_a442_7ee7_b766,
        ],
        Some(0xc320_80af_05cf_e1ca),
    ),
    (
        &[
            0x8018_b041_9cc8_5ff0,
            0x7fe0_bbc4_7980_0bc2,
            0xffdf_ffff_ffff_ffff,
            0x8007_a89c_b2e4_b81d,
            0x3ff0_0000_0000_0000,
            0x0018_b041_9cc8_5ff0,
            0xffe0_bbc4_7980_0bc2,
            0x7fdf_ffff_ffff_ffff,
        ],
        Some(0x3ff0_0000_0000_0000),
    ),
    (
        &[
            0x3e88_1acc_d0e6_854c,
            0x001f_ffff_ffff_ffff,
            0x3ffd_ad2f_2b8b_9fbf,
            0x4336_7994_2504_f802,
            0x800a_734c_e04a_fa29,
        ],
        Some(0x4336_7994_2504_f804),
    ),
    (
        &[
            0x0320_0000_0000_0000,
            0x7fe0_0000_0000_0000,
            0x4005_d8c3_53ef_7a81,
            0x0001_cbd7_3931_048a,
            0xfd0b_c62c_9cea_fd39,
        ],
        Some(0x7fdf_ffff_ffff_ff22),
    ),
    (
        &[
            0x7fd7_2ea2_b081_1644,
            0x7fde_7a8e_4de1_82c6,
            0xfd08_2656_30e8_f65f,
            0x832f_deb5_9555_6f3b,
            0x7fe4_0838_4905_3f4e,
            0xfd00_0000_0000_0000,
            0x0326_1f64_4a42_a447,
            0xbe8a_9b81_13ad_3fcd,
            0x7fd0_0000_0000_0001,
        ],
        None,
    ),
];

#[test]
fn the_exact_sum_agrees_bit_for_bit_with_the_independent_reference() {
    for (values, expected) in NAMED_SUMS.iter().chain(WIDE_SUMS) {
        assert_eq!(exact_sum(values), *expected, "{values:x?}");
    }
}

/// A second reference inside the test: `i128` holds these sums exactly on a
/// common grid, and its cast to `f64` rounds to nearest with ties to even.
#[test]
fn the_exact_sum_rounds_like_an_exact_integer_cast() {
    const GRID: f64 = 1.0 / (1_u64 << 20) as f64;
    let mut state = 0x2545_f491_4f6c_dd1d_u64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for _ in 0..2000 {
        let mut sum = ExactSum::default();
        let mut exact = 0_i128;
        for _ in 0..(next() % 12 + 1) {
            // At most 53 bits, so each value is exactly a binary64.
            let magnitude = next() >> (11 + next() % 40);
            let units = if next() & 1 == 0 {
                magnitude as i128
            } else {
                -(magnitude as i128)
            };
            exact += units;
            sum.add(units as f64 * GRID);
        }
        let expected = if exact == 0 { 0.0 } else { exact as f64 * GRID };
        assert_eq!(sum.finish().map(f64::to_bits), Some(expected.to_bits()));
    }
}

#[test]
fn an_exact_zero_is_positive_zero_and_a_negative_sum_keeps_its_sign() {
    assert_eq!(exact_sum(&[]), Some(0.0_f64.to_bits()));
    assert_eq!(exact_sum(&[(-0.0_f64).to_bits()]), Some(0.0_f64.to_bits()));
    assert_eq!(
        exact_sum(&[(-1.5_f64).to_bits(), 0.5_f64.to_bits()]),
        Some((-1.0_f64).to_bits())
    );
}

// ---------------------------------------------------------------------------
// Stable identifiers
// ---------------------------------------------------------------------------

#[test]
fn every_state_and_refusal_has_a_stable_identifier_with_no_document_text() {
    let states = [
        XicScanState::Measured {
            sum: 0.0,
            points_in_window: 0,
        },
        XicScanState::ExcludedByMsLevel,
        XicScanState::MsLevelUndeclared,
        XicScanState::NoUsableArrays,
        XicScanState::Unreadable {
            role: ArrayRole::Mz,
            reason: XicUnreadableReason::PayloadAbsent,
        },
        XicScanState::Missing,
        XicScanState::NonFiniteIntensity,
        XicScanState::SumNotRepresentable,
    ];
    let ids: HashSet<_> = states.iter().map(|state| state.stable_id()).collect();
    assert_eq!(ids.len(), 8);
    assert!(!ids.iter().any(|id| id.contains("area")));

    assert_eq!(XicRefusal::InvalidQuery.stable_id(), "invalid_query");
    assert_eq!(
        XicRefusal::IncompleteUnit(XicAxis::Mz).to_string(),
        "a mz unit is declared incompletely"
    );
    assert_eq!(XicAxis::RetentionTime.stable_id(), "retention_time");
    assert_eq!(
        XicRefusal::from(XicMetadataProblem::Missing(XicRequiredValue::Index)).stable_id(),
        "missing_required_value"
    );
    assert_eq!(
        XicRefusal::IntegerNotExact(ArrayRole::Mz).stable_id(),
        "integer_not_exact"
    );
    assert_eq!(
        XicUnreadableReason::Array(ArrayProblem::Numpress).stable_id(),
        "numpress"
    );
    assert_eq!(
        XicRequiredValue::ScanListCount.stable_id(),
        "scan_list_count"
    );
}
