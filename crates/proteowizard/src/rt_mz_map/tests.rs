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
const POSITIVE: &str = "MS:1000130";
const NEGATIVE: &str = "MS:1000129";

/// The map of `ms1`'s spectra: profile, stating no polarity.
const UNSTATED_PROFILE: MapKind = kind(None, MzmlRepresentation::Profile);
const POSITIVE_PROFILE: MapKind = kind(Some(MzmlPolarity::Positive), MzmlRepresentation::Profile);
const NEGATIVE_PROFILE: MapKind = kind(Some(MzmlPolarity::Negative), MzmlRepresentation::Profile);

const fn kind(polarity: Option<MzmlPolarity>, representation: MzmlRepresentation) -> MapKind {
    MapKind {
        polarity,
        representation,
    }
}

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

/// A one-point spectrum's body that states its lowest and highest observed m/z.
fn observed(low: &str, high: &str) -> String {
    format!(
        "{}{}{}",
        cv("MS:1000528", low, "MS:1000040"),
        cv("MS:1000527", high, "MS:1000040"),
        arrays(&[100.0], &[1.0])
    )
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

/// An MS1 spectrum at a retention time in minutes, with these terms on the
/// spectrum itself: the reader takes a polarity from there, not from its scan.
fn stating(
    index: usize,
    minutes: &str,
    representation: &str,
    terms: &[&str],
    body: &str,
) -> String {
    let terms: String = terms.iter().map(|term| cv(term, "", "")).collect();
    spectrum(
        index,
        1,
        representation,
        (minutes, MINUTE),
        1,
        &format!("{terms}{body}"),
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
        kind: UNSTATED_PROFILE,
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
    assert_eq!(map.spectra(), 2);
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
    assert_eq!(map.spectra(), 3, "8.5 min is outside the window");
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
        spectrum(2, 2, PROFILE, ("1", MINUTE), 1, &numpress),
    ]);

    // The refused MS1 spectrum is outside the window. The MS2 spectrum is inside
    // it, with the map's polarity and representation, so only its level keeps it
    // from being read. Neither is decoded.
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
fn both_polarities_map_apart_and_neither_reads_the_other() {
    let one_point = arrays(&[100.0], &[5.0]);
    let numpress = arrays_with(&[100.0], &[9.0], (MZ, COUNTS), NUMPRESS);
    let document = document(&[
        stating(0, "1", PROFILE, &[POSITIVE], &one_point),
        stating(1, "2", PROFILE, &[NEGATIVE], &numpress),
        stating(2, "3", PROFILE, &[POSITIVE], &arrays(&[100.0], &[7.0])),
    ]);

    let extents = ms1_extent(&table(&document)).expect("has MS1");
    assert_eq!(extents.len(), 2);
    assert_eq!(extents[0].kind(), POSITIVE_PROFILE);
    assert_eq!(extents[0].spectra(), 2);
    assert_eq!(extents[0].retention_time(), (1.0, 3.0));
    assert_eq!(extents[1].kind(), NEGATIVE_PROFILE);
    assert_eq!(extents[1].spectra(), 1);
    assert_eq!(extents[1].retention_time(), (2.0, 2.0));

    let view = request((0.0, 4.0), 4, (99.0, 101.0), 1);
    // The negative spectrum would refuse if it were read, so the positive map
    // does not read it, and its progress does not count it.
    let mut heard = Vec::new();
    let positive = bin_rt_mz_map_from(
        Cursor::new(&document),
        &table(&document),
        MapRequest {
            kind: POSITIVE_PROFILE,
            ..view
        },
        &CancellationToken::new(),
        |done, total| heard.push((done, total)),
    )
    .expect("maps");
    assert_eq!(heard, [(1, 2), (2, 2)]);
    assert_eq!(positive.request().kind, POSITIVE_PROFILE);
    assert_eq!(positive.spectra(), 2);
    assert_eq!(positive.cell(1, 0), Some(5.0));
    assert_eq!(positive.cell(2, 0), None, "the negative spectrum's bin");
    assert_eq!(positive.cell(3, 0), Some(7.0));

    assert_eq!(
        map(
            &document,
            MapRequest {
                kind: NEGATIVE_PROFILE,
                ..view
            }
        ),
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
fn a_partly_declared_polarity_is_refused_whichever_map_is_asked_for() {
    let body = arrays(&[100.0], &[1.0]);
    let declared = stating(0, "1", PROFILE, &[POSITIVE], &body);
    let undeclared = stating(1, "2", PROFILE, &[], &body);
    let stated_two_ways = stating(1, "2", PROFILE, &[POSITIVE, NEGATIVE], &body);
    let later_undeclared = stating(0, "1", PROFILE, &[], &body);
    let later_declared = stating(1, "2", PROFILE, &[NEGATIVE], &body);

    for spectra in [
        [declared.clone(), undeclared],
        [declared, stated_two_ways],
        [later_undeclared, later_declared],
    ] {
        let document = document(&spectra);
        assert_eq!(
            ms1_extent(&table(&document)),
            Err(MapError::PartlyDeclaredPolarity)
        );
        for kind in [POSITIVE_PROFILE, NEGATIVE_PROFILE, UNSTATED_PROFILE] {
            let view = MapRequest {
                kind,
                ..request((0.0, 4.0), 1, (99.0, 101.0), 1)
            };
            assert_eq!(map(&document, view), Err(MapError::PartlyDeclaredPolarity));
        }
    }
    assert_eq!(
        MapError::PartlyDeclaredPolarity.stable_id(),
        "partly_declared_polarity"
    );

    // Across representations too: a centroid spectrum stating none refuses the
    // file, though no profile spectrum lacks one.
    let across_representations = document(&[
        stating(0, "1", PROFILE, &[POSITIVE], &body),
        stating(1, "2", CENTROID, &[], &body),
    ]);
    assert_eq!(
        ms1_extent(&table(&across_representations)),
        Err(MapError::PartlyDeclaredPolarity)
    );

    // Only MS1 spectra count: an MS2 spectrum stating none leaves the map alone.
    let with_ms2 = document(&[
        stating(0, "1", PROFILE, &[POSITIVE], &body),
        spectrum(1, 2, PROFILE, ("2", MINUTE), 1, &body),
    ]);
    let extents = ms1_extent(&table(&with_ms2)).expect("has MS1");
    assert_eq!(extents.len(), 1);
    assert_eq!(extents[0].kind(), POSITIVE_PROFILE);
}

#[test]
fn no_polarity_declared_is_one_map_stating_not_reported() {
    let body = arrays(&[100.0], &[3.0]);
    // A polarity stated two ways is not reported, as the reader says.
    let document = document(&[
        stating(0, "1", PROFILE, &[], &body),
        stating(1, "2", PROFILE, &[POSITIVE, NEGATIVE], &body),
    ]);
    let rows = table(&document);
    assert_eq!(rows.rows()[0].polarity(), MzmlDeclared::NotDeclared);
    assert_eq!(rows.rows()[1].polarity(), MzmlDeclared::Conflicting);

    let extents = ms1_extent(&rows).expect("has MS1");
    assert_eq!(extents.len(), 1);
    assert_eq!(extents[0].kind(), UNSTATED_PROFILE);
    assert_eq!(extents[0].spectra(), 2);

    let map = map(&document, request((0.0, 4.0), 1, (99.0, 101.0), 1)).expect("maps");
    assert_eq!(map.request().kind.polarity, None);
    assert_eq!(map.spectra(), 2);
}

#[test]
fn both_representations_map_apart() {
    let document = document(&[
        ms1(0, "1", &[100.0, 100.2], &[3.0, 8.0]),
        spectrum(1, 1, CENTROID, ("2", MINUTE), 1, &arrays(&[100.1], &[5.0])),
        ms1(2, "3", &[100.3], &[6.0]),
    ]);
    let centroid = kind(None, MzmlRepresentation::Centroid);

    let extents = ms1_extent(&table(&document)).expect("has MS1");
    assert_eq!(extents.len(), 2);
    assert_eq!(extents[0].kind(), UNSTATED_PROFILE);
    assert_eq!(extents[0].spectra(), 2);
    assert_eq!(extents[0].retention_time(), (1.0, 3.0));
    assert_eq!(extents[1].kind(), centroid);
    assert_eq!(extents[1].spectra(), 1);

    // One bin over the whole window: a centroid value never shares a cell with
    // a profile value.
    let view = request((0.0, 4.0), 1, (99.0, 101.0), 1);
    let profile = map(&document, view).expect("maps");
    assert_eq!(profile.cell(0, 0), Some(8.0));
    assert_eq!((profile.spectra(), profile.points_binned()), (2, 3));

    let centroided = map(
        &document,
        MapRequest {
            kind: centroid,
            ..view
        },
    )
    .expect("maps");
    assert_eq!(centroided.cell(0, 0), Some(5.0));
    assert_eq!((centroided.spectra(), centroided.points_binned()), (1, 1));
}

#[test]
fn a_partly_declared_representation_is_refused_whichever_map_is_asked_for() {
    let declared = ms1(0, "1", &[100.0], &[1.0]);
    let undeclared = spectrum(1, 1, "", ("2", MINUTE), 1, &arrays(&[100.0], &[1.0]));
    let centroid = spectrum(1, 1, CENTROID, ("2", MINUTE), 1, &arrays(&[100.0], &[1.0]));
    let first_undeclared = spectrum(0, 1, "", ("1", MINUTE), 1, &arrays(&[100.0], &[1.0]));

    for spectra in [[declared, undeclared], [first_undeclared, centroid]] {
        let document = document(&spectra);
        assert_eq!(
            ms1_extent(&table(&document)),
            Err(MapError::PartlyDeclaredRepresentation)
        );
        for representation in [
            MzmlRepresentation::Profile,
            MzmlRepresentation::Centroid,
            MzmlRepresentation::NotDeclared,
        ] {
            let view = MapRequest {
                kind: kind(None, representation),
                ..request((0.0, 4.0), 1, (99.0, 101.0), 1)
            };
            assert_eq!(
                map(&document, view),
                Err(MapError::PartlyDeclaredRepresentation)
            );
        }
    }
    assert_eq!(
        MapError::PartlyDeclaredRepresentation.stable_id(),
        "partly_declared_representation"
    );

    // Across polarities too: a negative spectrum stating none refuses the file,
    // though no positive spectrum lacks one.
    let body = arrays(&[100.0], &[1.0]);
    let across_polarities = document(&[
        stating(0, "1", PROFILE, &[POSITIVE], &body),
        stating(1, "2", "", &[NEGATIVE], &body),
    ]);
    assert_eq!(
        ms1_extent(&table(&across_polarities)),
        Err(MapError::PartlyDeclaredRepresentation)
    );
}

#[test]
fn the_file_wide_checks_cover_spectra_outside_the_window() {
    let body = arrays(&[100.0], &[1.0]);
    let view = MapRequest {
        kind: POSITIVE_PROFILE,
        ..request((0.0, 2.0), 1, (99.0, 101.0), 1)
    };
    let positive_body = format!("{}{body}", cv(POSITIVE, "", ""));
    for (outside, refusal) in [
        (
            stating(1, "9", PROFILE, &[], &body),
            MapError::PartlyDeclaredPolarity,
        ),
        (
            stating(1, "9", "", &[POSITIVE], &body),
            MapError::PartlyDeclaredRepresentation,
        ),
        (
            spectrum(1, 1, PROFILE, ("540", SECOND), 1, &positive_body),
            MapError::MixedRetentionTimeUnits,
        ),
    ] {
        let spectra = [stating(0, "1", PROFILE, &[POSITIVE], &body), outside];
        assert_eq!(map(&document(&spectra), view), Err(refusal), "{refusal:?}");
    }
}

#[test]
fn no_representation_declared_is_one_map_stating_not_reported() {
    let document = document(&[
        spectrum(0, 1, "", ("1", MINUTE), 1, &arrays(&[100.0], &[3.0])),
        spectrum(1, 1, "", ("2", MINUTE), 1, &arrays(&[100.0], &[4.0])),
    ]);
    let undeclared = kind(None, MzmlRepresentation::NotDeclared);

    let extents = ms1_extent(&table(&document)).expect("has MS1");
    assert_eq!(extents.len(), 1);
    assert_eq!(extents[0].kind(), undeclared);

    let map = map(
        &document,
        MapRequest {
            kind: undeclared,
            ..request((0.0, 4.0), 1, (99.0, 101.0), 1)
        },
    )
    .expect("maps");
    assert_eq!(
        map.request().kind.representation,
        MzmlRepresentation::NotDeclared
    );
    assert_eq!(map.cell(0, 0), Some(4.0));
}

#[test]
fn both_polarities_map_apart_when_no_representation_is_declared() {
    let document = document(&[
        stating(0, "1", "", &[POSITIVE], &arrays(&[100.0], &[3.0])),
        stating(1, "2", "", &[NEGATIVE], &arrays(&[100.0], &[4.0])),
    ]);
    let undeclared = MzmlRepresentation::NotDeclared;
    let positive = kind(Some(MzmlPolarity::Positive), undeclared);
    let negative = kind(Some(MzmlPolarity::Negative), undeclared);

    let extents = ms1_extent(&table(&document)).expect("has MS1");
    assert_eq!(extents.len(), 2);
    assert_eq!((extents[0].kind(), extents[1].kind()), (positive, negative));

    let view = request((0.0, 4.0), 1, (99.0, 101.0), 1);
    for (kind, value) in [(positive, 3.0), (negative, 4.0)] {
        let map = map(&document, MapRequest { kind, ..view }).expect("maps");
        assert_eq!((map.spectra(), map.cell(0, 0)), (1, Some(value)));
    }
}

#[test]
fn the_maps_are_the_kinds_present_and_any_other_is_refused_before_a_read() {
    // Would refuse if read, so reaching the read shows as this refusal.
    let numpress = arrays_with(&[100.0], &[1.0], (MZ, COUNTS), NUMPRESS);
    let document = document(&[
        stating(0, "1", PROFILE, &[POSITIVE], &numpress),
        stating(1, "2", CENTROID, &[NEGATIVE], &numpress),
    ]);
    let negative_centroid = kind(Some(MzmlPolarity::Negative), MzmlRepresentation::Centroid);
    let extents = ms1_extent(&table(&document)).expect("has MS1");
    assert_eq!(
        extents.iter().map(Ms1Extent::kind).collect::<Vec<_>>(),
        [POSITIVE_PROFILE, negative_centroid],
        "two of the four combinations, not all four"
    );

    let view = request((0.0, 4.0), 1, (99.0, 101.0), 1);
    let ask = |kind| map(&document, MapRequest { kind, ..view });
    for absent in [
        kind(Some(MzmlPolarity::Positive), MzmlRepresentation::Centroid),
        NEGATIVE_PROFILE,
        UNSTATED_PROFILE,
        kind(None, MzmlRepresentation::NotDeclared),
    ] {
        assert_eq!(ask(absent), Err(MapError::MapNotInTable), "{absent:?}");
    }
    assert_eq!(MapError::MapNotInTable.stable_id(), "map_not_in_table");
    assert!(
        matches!(
            ask(POSITIVE_PROFILE),
            Err(MapError::Spectrum { index: 0, .. })
        ),
        "a map the table has reaches the read"
    );
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
    assert_eq!(map.spectra(), 2);
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

    // Across maps too: neither the profile nor the centroid map stands.
    let mixed_across_maps = document(&[
        ms1(0, "1", &[100.0], &[1.0]),
        spectrum(1, 1, CENTROID, ("60", SECOND), 1, &arrays(&[100.0], &[1.0])),
    ]);
    assert_eq!(
        ms1_extent(&table(&mixed_across_maps)),
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
    // The one MS1 spectrum is refused when it is read, so a request that
    // reaches the read returns that refusal, and a refused request never does.
    let numpress = arrays_with(&[100.0], &[1.0], (MZ, COUNTS), NUMPRESS);
    let document = document(&[spectrum(0, 1, PROFILE, ("1", MINUTE), 1, &numpress)]);
    let check = |request| map(&document, request).err();
    let read = Some(MapError::Spectrum {
        index: 0,
        error: MzmlSpectrumError::Array {
            role: ArrayRole::Intensity,
            problem: ArrayProblem::Numpress,
        },
    });

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
    // A subnormal range's threshold underflows; its zero-width bins are still
    // refused.
    assert_eq!(
        check(request((0.0, 2.0), 1, (0.0, 5e-324), 2)),
        Some(MapError::InvalidBounds)
    );
    assert_eq!(
        check(request((0.0, 2.0), 1, (1000.0, 1000.001), 2048)),
        read
    );
    assert_eq!(
        check(request((0.0, 2.0), 0, (99.0, 101.0), 1)),
        Some(MapError::InvalidBins)
    );
    assert_eq!(
        check(request((0.0, 2.0), 2049, (99.0, 101.0), 1024)),
        Some(MapError::InvalidBins)
    );
    assert_eq!(check(request((0.0, 2.0), 2048, (99.0, 101.0), 1024)), read);
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
fn a_window_holding_no_spectrum_of_its_map_is_not_refused() {
    let document = document(&[ms1(0, "1", &[100.0], &[1.0])]);
    let map = map(&document, request((5.0, 8.0), 2, (99.0, 101.0), 1)).expect("not refused");
    assert_eq!(map.spectra(), 0);
    assert_eq!(map.points_binned(), 0);
    assert_eq!(row(&map, 0), [None]);
    assert_eq!(row(&map, 1), [None]);
    assert_eq!(map.mz_unit(), &ArrayUnit::NotDeclared);
}

#[test]
fn a_bin_narrower_than_four_epsilon_of_its_bound_is_refused() {
    let low = 1000.0_f64;
    let axis = |epsilons: f64| {
        let step = low * f64::EPSILON * epsilons;
        Axis::new((low, low + 16.0 * step), 16)
    };
    assert_eq!(axis(3.9), Err(MapError::InvalidBounds));
    assert!(axis(4.1).is_ok());
}

#[test]
fn the_extent_comes_from_the_ms1_rows_alone() {
    let stated = document(&[
        spectrum(0, 1, PROFILE, ("2", MINUTE), 1, &observed("150", "900")),
        spectrum(1, 2, CENTROID, ("0.5", SECOND), 1, &observed("50", "2000")),
        spectrum(2, 1, PROFILE, ("7", MINUTE), 1, &observed("120", "880")),
    ]);
    let extents = ms1_extent(&table(&stated)).expect("has MS1");
    assert_eq!(extents.len(), 1);
    assert_eq!(extents[0].retention_time(), (2.0, 7.0));
    assert_eq!(extents[0].retention_time_unit(), RetentionTimeUnit::Minute);
    assert_eq!(extents[0].mz(), Some((120.0, 900.0)));
    assert_eq!(extents[0].spectra(), 2);

    let partly = document(&[
        spectrum(0, 1, PROFILE, ("2", MINUTE), 1, &observed("150", "900")),
        ms1(1, "7", &[100.0], &[1.0]),
    ]);
    assert_eq!(ms1_extent(&table(&partly)).expect("has MS1")[0].mz(), None);

    // A later spectrum that states its range does not restore one already lost:
    // it would be some spectra's range presented as the whole map's.
    let later_stated = document(&[
        ms1(0, "2", &[100.0], &[1.0]),
        spectrum(1, 1, PROFILE, ("7", MINUTE), 1, &observed("150", "900")),
    ]);
    assert_eq!(
        ms1_extent(&table(&later_stated)).expect("has MS1")[0].mz(),
        None
    );

    // One bound is no range, whichever it is.
    for accession in ["MS:1000528", "MS:1000527"] {
        let one_bound = format!(
            "{}{}",
            cv(accession, "150", "MS:1000040"),
            arrays(&[100.0], &[1.0])
        );
        let document = document(&[spectrum(0, 1, PROFILE, ("2", MINUTE), 1, &one_bound)]);
        assert_eq!(
            ms1_extent(&table(&document)).expect("has MS1")[0].mz(),
            None,
            "{accession}"
        );
    }

    // Each map's range is its own: two stated ranges are not merged, as the LTQ
    // Velos conversion's profile and centroid maps state different ones.
    let two_stated = document(&[
        spectrum(0, 1, PROFILE, ("2", MINUTE), 1, &observed("300", "2000")),
        spectrum(1, 1, CENTROID, ("3", MINUTE), 1, &observed("400", "1400")),
    ]);
    let extents = ms1_extent(&table(&two_stated)).expect("has MS1");
    assert_eq!(extents[0].mz(), Some((300.0, 2000.0)));
    assert_eq!(extents[1].mz(), Some((400.0, 1400.0)));

    // And a map whose spectra state theirs keeps it beside one whose spectra do
    // not.
    let one_map_stated = document(&[
        spectrum(0, 1, PROFILE, ("2", MINUTE), 1, &observed("150", "900")),
        spectrum(1, 1, CENTROID, ("3", MINUTE), 1, &arrays(&[100.0], &[1.0])),
    ]);
    let extents = ms1_extent(&table(&one_map_stated)).expect("has MS1");
    assert_eq!(extents[0].mz(), Some((150.0, 900.0)));
    assert_eq!(extents[1].mz(), None);
}

#[test]
fn the_extent_bounds_move_both_ways() {
    let document = document(&[
        spectrum(0, 1, PROFILE, ("7", MINUTE), 1, &observed("150", "900")),
        spectrum(1, 1, PROFILE, ("2", MINUTE), 1, &observed("150", "950")),
    ]);
    let extents = ms1_extent(&table(&document)).expect("has MS1");
    assert_eq!(extents[0].retention_time(), (2.0, 7.0));
    assert_eq!(extents[0].mz(), Some((150.0, 950.0)));
}

#[test]
fn a_stated_mz_range_that_is_empty_or_inverted_has_no_first_view() {
    for (low, high, stated) in [
        ("900", "100", (900.0, 100.0)),
        ("100", "100", (100.0, 100.0)),
    ] {
        let document = document(&[spectrum(
            0,
            1,
            PROFILE,
            ("2", MINUTE),
            1,
            &observed(low, high),
        )]);
        assert_eq!(
            ms1_extent(&table(&document)).expect("has MS1")[0].mz(),
            Some(stated),
            "reported as stated, not as a range the spectra do not state"
        );
        assert_eq!(
            map(&document, request((0.0, 4.0), 1, stated, 1)),
            Err(MapError::InvalidBounds)
        );
    }

    let both_inverted = document(&[
        spectrum(0, 1, PROFILE, ("2", MINUTE), 1, &observed("500", "100")),
        spectrum(1, 1, PROFILE, ("3", MINUTE), 1, &observed("600", "400")),
    ]);
    let stated = ms1_extent(&table(&both_inverted)).expect("has MS1")[0].mz();
    assert_eq!(
        stated,
        Some((500.0, 400.0)),
        "the lowest low and the highest high, not ordered"
    );
    assert_eq!(
        map(&both_inverted, request((0.0, 4.0), 1, (500.0, 400.0), 1)),
        Err(MapError::InvalidBounds)
    );
}

#[test]
fn a_cell_past_the_mz_axis_is_not_the_next_rows_cell() {
    let document = document(&[ms1(0, "3", &[100.0], &[1.0])]);
    let map = map(&document, request((0.0, 4.0), 2, (99.0, 101.0), 1)).expect("maps");
    assert_eq!(map.cell(1, 0), Some(1.0));
    assert_eq!(map.cell(0, 1), None, "not the next row's cell");
}

#[test]
fn the_result_keeps_the_request_exactly() {
    let document = document(&[ms1(0, "0.1", &[500.0], &[1.0])]);
    // Each upper bound needs all 17 significant digits: rounded to fewer, it changes.
    let view = request(
        (0.002538333333, 0.30000000000000004),
        3,
        (400.500793457031, 1399.7896728515627),
        7,
    );
    assert_eq!(map(&document, view).expect("maps").request(), &view);
}

#[test]
fn the_path_entry_refuses_a_directory() {
    let document = document(&[ms1(0, "1", &[100.0], &[1.0])]);
    let got = bin_rt_mz_map(
        &std::env::temp_dir(),
        &table(&document),
        request((0.0, 2.0), 1, (99.0, 101.0), 1),
        &CancellationToken::new(),
        |_, _| {},
    );
    assert_eq!(got.err().map(MapError::stable_id), Some("not_regular_file"));
}

#[test]
fn the_stable_ids_decision_5_lists_do_not_change() {
    let refused = MzmlSpectrumError::Array {
        role: ArrayRole::Intensity,
        problem: ArrayProblem::Numpress,
    };
    for (error, id) in [
        (MapError::InvalidBounds, "map_bounds_invalid"),
        (MapError::InvalidBins, "map_bins_invalid"),
        (MapError::AllocationRefused, "allocation_refused"),
        (MapError::NoMs1Spectra, "no_ms1_spectra"),
        (
            MapError::MixedRetentionTimeUnits,
            "mixed_retention_time_units",
        ),
        (
            MapError::MixedArrayUnits(ArrayRole::Mz),
            "mixed_array_units",
        ),
        (
            MapError::MixedArrayUnits(ArrayRole::Intensity),
            "mixed_array_units",
        ),
        (MapError::Cancelled, "cancelled"),
        (
            MapError::Spectrum {
                index: 0,
                error: refused,
            },
            "numpress",
        ),
    ] {
        assert_eq!(error.stable_id(), id);
    }
}
