//! Small generated fixtures for the RT × m/z map (ADR 0068).

use std::io::Cursor;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use super::*;
use crate::mzml::MzmlScanLimits;
use crate::mzml_reader::{ArrayProblem, read_spectrum_table_from};

const PROFILE: &str = "MS:1000128";
const CENTROID: &str = "MS:1000127";
const MINUTE: &str = "UO:0000031";
const SECOND: &str = "UO:0000010";
const NO_COMPRESSION: &str = "MS:1000576";
const NUMPRESS: &str = "MS:1002312";
const COUNTS: &str = "MS:1000131";
const MZ: &str = "MS:1000040";

/// A term; an empty unit is no unit.
fn cv(accession: &str, value: &str, unit: &str) -> String {
    format!(
        r#"<cvParam cvRef="MS" accession="{accession}" name="term" value="{value}" unitAccession="{unit}"/>"#
    )
}

fn array(role: &str, unit: &str, compression: &str, values: &[f64]) -> String {
    let bytes: Vec<u8> = values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect();
    format!(
        "<binaryDataArray>{}{}{}<binary>{}</binary></binaryDataArray>",
        cv("MS:1000523", "", ""),
        cv(compression, "", ""),
        cv(role, "", unit),
        STANDARD.encode(bytes)
    )
}

/// The m/z and intensity arrays with their units; only the intensity array
/// takes `compression`.
fn arrays_with(
    mz: &[f64],
    intensity: &[f64],
    (mz_unit, intensity_unit): (&str, &str),
    compression: &str,
) -> String {
    format!(
        "<binaryDataArrayList count=\"2\">{}{}</binaryDataArrayList>",
        array("MS:1000514", mz_unit, NO_COMPRESSION, mz),
        array("MS:1000515", intensity_unit, compression, intensity)
    )
}

fn arrays(mz: &[f64], intensity: &[f64]) -> String {
    arrays_with(mz, intensity, (MZ, COUNTS), NO_COMPRESSION)
}

/// One spectrum with the terms every table row requires. An empty
/// representation states none.
fn spectrum(
    index: usize,
    level: u32,
    representation: &str,
    (time, unit): (&str, &str),
    length: usize,
    body: &str,
) -> String {
    let representation = if representation.is_empty() {
        String::new()
    } else {
        cv(representation, "", "")
    };
    format!(
        r#"<spectrum index="{index}" id="scan={index}" defaultArrayLength="{length}">{}{representation}{}{}{}<scanList count="1"><scan>{}</scan></scanList>{body}</spectrum>"#,
        cv("MS:1000511", &level.to_string(), ""),
        cv("MS:1000504", "100", ""),
        cv("MS:1000505", "1", ""),
        cv("MS:1000285", "1", ""),
        cv("MS:1000016", time, unit),
    )
}

/// An MS1 profile spectrum at a retention time in minutes.
fn ms1(index: usize, minutes: &str, mz: &[f64], intensity: &[f64]) -> String {
    spectrum(
        index,
        1,
        PROFILE,
        (minutes, MINUTE),
        mz.len(),
        &arrays(mz, intensity),
    )
}

fn document(spectra: &[String]) -> Vec<u8> {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0"><run id="run"><spectrumList count="{}">{}</spectrumList></run></mzML>"#,
        spectra.len(),
        spectra.concat()
    )
    .into_bytes()
}

fn table(document: &[u8]) -> MzmlSpectrumTable {
    read_spectrum_table_from(Cursor::new(document), MzmlScanLimits::default())
        .expect("the fixture opens")
}

fn request(retention_time: (f64, f64), time_bins: u32, mz: (f64, f64), mz_bins: u32) -> MapRequest {
    MapRequest {
        retention_time,
        mz,
        retention_time_bins: time_bins,
        mz_bins,
    }
}

fn map(document: &[u8], request: MapRequest) -> Result<RtMzMap, MapError> {
    bin_rt_mz_map_from(
        Cursor::new(document),
        &table(document),
        request,
        &CancellationToken::new(),
        |_, _| {},
    )
}

fn row(map: &RtMzMap, time_bin: u32) -> Vec<Option<f64>> {
    (0..map.request().mz_bins)
        .map(|mz_bin| map.cell(time_bin, mz_bin))
        .collect()
}

#[test]
fn a_cell_keeps_the_greatest_intensity_and_empty_is_not_zero() {
    let document = document(&[
        ms1(
            0,
            "1.0",
            &[100.0, 101.0, 102.5, 104.5, 106.0],
            &[5.0, 7.0, 0.0, -3.0, 2.0],
        ),
        ms1(1, "1.5", &[100.5], &[9.0]),
    ]);
    let map = map(&document, request((0.0, 4.0), 2, (100.0, 108.0), 4)).expect("maps");

    // Both spectra fall in the first retention-time bin, and the greatest
    // value wins across spectra. A measured zero and a negative value are
    // values; the second row holds no point at all.
    assert_eq!(row(&map, 0), [Some(9.0), Some(0.0), Some(-3.0), Some(2.0)]);
    assert_eq!(row(&map, 1), [None; 4]);
    assert_eq!(map.cell(2, 0), None, "outside the raster");
    assert_eq!(map.points_binned(), 6);
    assert_eq!(map.points_outside_mz(), 0);
    assert_eq!(map.spectra(MzmlRepresentation::Profile), 2);
    assert_eq!(map.retention_time_unit(), RetentionTimeUnit::Minute);
    assert_eq!(map.mz_unit(), &ArrayUnit::Declared(MZ.into()));
    assert_eq!(map.intensity_unit(), &ArrayUnit::Declared(COUNTS.into()));
}

#[test]
fn bins_are_half_open_and_the_upper_bound_falls_in_the_last_bin() {
    let document = document(&[
        ms1(
            0,
            "0",
            &[0.0, 3.0, 8.0, -0.5, 8.5],
            &[1.0, 2.0, 3.0, 4.0, 5.0],
        ),
        ms1(1, "3", &[1.0], &[6.0]),
        ms1(2, "8", &[1.0], &[7.0]),
        ms1(3, "8.5", &[1.0], &[8.0]),
    ]);
    let map = map(&document, request((0.0, 8.0), 8, (0.0, 8.0), 8)).expect("maps");

    let mut first = vec![None; 8];
    first[0] = Some(1.0);
    first[3] = Some(2.0);
    first[7] = Some(3.0);
    assert_eq!(row(&map, 0), first);
    assert_eq!(map.points_outside_mz(), 2, "m/z -0.5 and 8.5");
    assert_eq!(
        map.cell(3, 1),
        Some(6.0),
        "an inner edge opens the upper bin"
    );
    assert_eq!(
        map.cell(7, 1),
        Some(7.0),
        "the upper bound is in the last bin"
    );
    assert_eq!(
        map.spectra(MzmlRepresentation::Profile),
        3,
        "8.5 min is outside the window"
    );
    assert_eq!(map.mz_edges(3), Some((3.0, 4.0)));
    assert_eq!(map.retention_time_edges(7), Some((7.0, 8.0)));
    assert_eq!(map.mz_edges(8), None, "outside the raster");
}

#[test]
fn every_bin_starts_at_its_own_edge() {
    // Ranges whose edges are not exact in binary, two of them the measured
    // files' first views.
    for ((low, high), bins) in [
        ((1303.2, 1350.2), 100),
        ((0.1, 0.7), 3),
        ((356.412150088193, 1313.128239995699), 2048),
        ((0.002757293606, 33.003497392559), 1024),
        // Near the narrowest range the axis accepts for its bins.
        (
            (1000.0, 1000.0 + 2048.0 * 5.0 * 1000.0 * f64::EPSILON),
            2048,
        ),
    ] {
        let axis = Axis::new((low, high), bins).expect("a valid axis");
        assert_eq!((axis.edge(0), axis.edge(bins)), (low, high));
        for k in 1..bins {
            let edge = axis.edge(k);
            let at = format!("{low}..{high} in {bins} bins, edge {k} = {edge}");
            assert_eq!(axis.bin(edge), Some(k as usize), "{at}");
            assert_eq!(axis.bin(edge.next_down()), Some(k as usize - 1), "{at}");
        }
        assert_eq!(axis.bin(high), Some(bins as usize - 1));
    }
}

#[test]
fn only_ms1_spectra_inside_the_window_are_read() {
    let numpress = arrays_with(&[100.0], &[1.0], (MZ, COUNTS), NUMPRESS);
    let document = document(&[
        ms1(0, "1", &[100.0], &[4.0]),
        spectrum(1, 1, PROFILE, ("5", MINUTE), 1, &numpress),
        spectrum(2, 2, CENTROID, ("1", MINUTE), 1, &numpress),
    ]);

    // The refused MS1 spectrum is outside the window and the MS2 spectrum is
    // never binned, so neither is decoded.
    let narrow = map(&document, request((0.0, 2.0), 1, (99.0, 101.0), 1)).expect("maps");
    assert_eq!(narrow.cell(0, 0), Some(4.0));
    assert_eq!(narrow.points_binned(), 1);

    // Inside the window, a refused spectrum refuses the whole map.
    assert_eq!(
        map(&document, request((0.0, 6.0), 1, (99.0, 101.0), 1)),
        Err(MapError::Spectrum {
            index: 1,
            error: MzmlSpectrumError::Array {
                role: ArrayRole::Intensity,
                problem: ArrayProblem::Numpress,
            },
        })
    );
}

#[test]
fn profile_and_centroid_spectra_are_binned_alike_and_counted() {
    let document = document(&[
        ms1(0, "1", &[100.0, 100.2], &[3.0, 8.0]),
        spectrum(1, 1, CENTROID, ("2", MINUTE), 1, &arrays(&[100.1], &[5.0])),
        spectrum(2, 1, "", ("3", MINUTE), 1, &arrays(&[100.3], &[6.0])),
    ]);
    let map = map(&document, request((0.0, 4.0), 1, (99.0, 101.0), 1)).expect("maps");

    assert_eq!(map.cell(0, 0), Some(8.0));
    assert_eq!(map.spectra(MzmlRepresentation::Profile), 1);
    assert_eq!(map.spectra(MzmlRepresentation::Centroid), 1);
    assert_eq!(map.spectra(MzmlRepresentation::NotDeclared), 1);
}

#[test]
fn a_table_without_ms1_is_refused_and_an_empty_ms1_spectrum_bins_nothing() {
    let only_ms2 = document(&[spectrum(
        0,
        2,
        CENTROID,
        ("1", MINUTE),
        1,
        &arrays(&[100.0], &[1.0]),
    )]);
    assert_eq!(ms1_extent(&table(&only_ms2)), Err(MapError::NoMs1Spectra));
    assert_eq!(
        map(&only_ms2, request((0.0, 2.0), 1, (99.0, 101.0), 1)),
        Err(MapError::NoMs1Spectra)
    );

    // A spectrum of no points declares no unit, and does not disagree with
    // one that does.
    let with_empty = document(&[
        spectrum(0, 1, PROFILE, ("1", MINUTE), 0, ""),
        ms1(1, "2", &[100.0], &[3.0]),
    ]);
    let map = map(&with_empty, request((0.0, 4.0), 1, (99.0, 101.0), 1)).expect("maps");
    assert_eq!(map.spectra(MzmlRepresentation::Profile), 2);
    assert_eq!(map.points_binned(), 1);
    assert_eq!(map.intensity_unit(), &ArrayUnit::Declared(COUNTS.into()));
}

#[test]
fn units_must_agree_and_nothing_converts() {
    let mixed_time = document(&[
        ms1(0, "1", &[100.0], &[1.0]),
        spectrum(1, 1, PROFILE, ("60", SECOND), 1, &arrays(&[100.0], &[1.0])),
    ]);
    assert_eq!(
        map(&mixed_time, request((0.0, 100.0), 1, (99.0, 101.0), 1)),
        Err(MapError::MixedRetentionTimeUnits)
    );

    // Only one of the two MS1 spectra declares its retention-time unit.
    let partly_declared_time = document(&[
        ms1(0, "1", &[100.0], &[1.0]),
        spectrum(1, 1, PROFILE, ("2", ""), 1, &arrays(&[100.0], &[1.0])),
    ]);
    assert_eq!(
        ms1_extent(&table(&partly_declared_time)),
        Err(MapError::MixedRetentionTimeUnits)
    );
    assert_eq!(
        map(
            &partly_declared_time,
            request((0.0, 4.0), 1, (99.0, 101.0), 1)
        ),
        Err(MapError::MixedRetentionTimeUnits)
    );

    for (units, role) in [
        ((MZ, "MS:1000132"), ArrayRole::Intensity),
        ((MZ, ""), ArrayRole::Intensity),
        (("UO:0000221", COUNTS), ArrayRole::Mz),
        (("", COUNTS), ArrayRole::Mz),
    ] {
        let mixed = document(&[
            ms1(0, "1", &[100.0], &[1.0]),
            spectrum(
                1,
                1,
                PROFILE,
                ("2", MINUTE),
                1,
                &arrays_with(&[100.0], &[1.0], units, NO_COMPRESSION),
            ),
        ]);
        assert_eq!(
            map(&mixed, request((0.0, 4.0), 1, (99.0, 101.0), 1)),
            Err(MapError::MixedArrayUnits(role)),
            "{units:?}"
        );
    }

    let undeclared_time = document(&[spectrum(
        0,
        1,
        PROFILE,
        ("1", ""),
        1,
        &arrays(&[100.0], &[1.0]),
    )]);
    let map = map(&undeclared_time, request((0.0, 2.0), 1, (99.0, 101.0), 1)).expect("maps");
    assert_eq!(map.retention_time_unit(), RetentionTimeUnit::NotDeclared);
}

#[test]
fn requests_are_checked_before_anything_is_read() {
    let document = document(&[ms1(0, "1", &[100.0], &[1.0])]);
    let check = |request| map(&document, request).err();

    for bounds in [
        (f64::NAN, 1.0),
        (0.0, f64::INFINITY),
        (2.0, 1.0),
        (1.0, 1.0),
        (-f64::MAX, f64::MAX),
    ] {
        assert_eq!(
            check(request(bounds, 1, (99.0, 101.0), 1)),
            Some(MapError::InvalidBounds),
            "{bounds:?}"
        );
        assert_eq!(
            check(request((0.0, 2.0), 1, bounds, 1)),
            Some(MapError::InvalidBounds),
            "{bounds:?}"
        );
    }
    // Bins narrower than the bounds' precision would have no width.
    assert_eq!(
        check(request((0.0, 2.0), 1, (1000.0, 1000.0 + 1e-10), 2048)),
        Some(MapError::InvalidBounds)
    );
    assert_eq!(
        check(request((0.0, 2.0), 1, (1000.0, 1000.001), 2048)),
        None
    );
    assert_eq!(
        check(request((0.0, 2.0), 0, (99.0, 101.0), 1)),
        Some(MapError::InvalidBins)
    );
    assert_eq!(
        check(request((0.0, 2.0), 2049, (99.0, 101.0), 1024)),
        Some(MapError::InvalidBins)
    );
    assert_eq!(check(request((0.0, 2.0), 2048, (99.0, 101.0), 1024)), None);
}

#[test]
fn progress_counts_the_window_and_cancellation_leaves_no_raster() {
    let document = document(&[
        ms1(0, "1", &[100.0], &[1.0]),
        ms1(1, "2", &[100.0], &[2.0]),
        ms1(2, "3", &[100.0], &[3.0]),
        ms1(3, "9", &[100.0], &[4.0]),
    ]);
    let table = table(&document);
    let view = request((0.0, 4.0), 1, (99.0, 101.0), 1);
    let run = |cancel: &CancellationToken, stop_after: Option<u64>| {
        let mut heard = Vec::new();
        let result = bin_rt_mz_map_from(
            Cursor::new(&document),
            &table,
            view,
            cancel,
            |done, total| {
                heard.push((done, total));
                if Some(done) == stop_after {
                    cancel.cancel();
                }
            },
        );
        (result, heard)
    };

    let (result, heard) = run(&CancellationToken::new(), None);
    assert_eq!(result.map(|map| map.cell(0, 0)), Ok(Some(3.0)));
    assert_eq!(heard, [(1, 3), (2, 3), (3, 3)]);

    let (result, heard) = run(&CancellationToken::new(), Some(1));
    assert_eq!(result, Err(MapError::Cancelled));
    assert_eq!(heard, [(1, 3)]);

    // Cancelled while the last spectrum is heard: every spectrum was binned,
    // and still no raster.
    let (result, heard) = run(&CancellationToken::new(), Some(3));
    assert_eq!(result, Err(MapError::Cancelled));
    assert_eq!(heard, [(1, 3), (2, 3), (3, 3)]);

    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let (result, heard) = run(&cancelled, None);
    assert_eq!(result, Err(MapError::Cancelled));
    assert!(heard.is_empty());

    // A window holding no MS1 spectrum reads nothing, and is still cancelled.
    let empty_window = bin_rt_mz_map_from(
        Cursor::new(&document),
        &table,
        request((5.0, 8.0), 1, (99.0, 101.0), 1),
        &cancelled,
        |_, _| {},
    );
    assert_eq!(empty_window, Err(MapError::Cancelled));
}

#[test]
fn the_extent_comes_from_the_ms1_rows_alone() {
    let observed = |low: &str, high: &str| {
        format!(
            "{}{}{}",
            cv("MS:1000528", low, "MS:1000040"),
            cv("MS:1000527", high, "MS:1000040"),
            arrays(&[100.0], &[1.0])
        )
    };
    let stated = document(&[
        spectrum(0, 1, PROFILE, ("2", MINUTE), 1, &observed("150", "900")),
        spectrum(1, 2, CENTROID, ("0.5", SECOND), 1, &observed("50", "2000")),
        spectrum(2, 1, PROFILE, ("7", MINUTE), 1, &observed("120", "880")),
    ]);
    let extent = ms1_extent(&table(&stated)).expect("has MS1");
    assert_eq!(extent.retention_time(), (2.0, 7.0));
    assert_eq!(extent.retention_time_unit(), RetentionTimeUnit::Minute);
    assert_eq!(extent.mz(), Some((120.0, 900.0)));
    assert_eq!(extent.spectra(), 2);

    let partly = document(&[
        spectrum(0, 1, PROFILE, ("2", MINUTE), 1, &observed("150", "900")),
        ms1(1, "7", &[100.0], &[1.0]),
    ]);
    assert_eq!(ms1_extent(&table(&partly)).expect("has MS1").mz(), None);
}
