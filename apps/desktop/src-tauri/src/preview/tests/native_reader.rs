//! The viewer's native mzML path through the service (ADR 0056, slice 2):
//! stored values reach the exports exactly, the file's own terms reach the
//! transfer objects, and nothing the file does not state is invented.

use super::*;
use serde_json::json;

/// Opens `file` and loads spectrum `index`, answering the panel's transfer
/// object.
fn open_and_load(
    file: &TestFile,
    index: u64,
) -> (
    PreviewService,
    super::super::dto::PreviewDto,
    super::super::dto::SelectedSpectrumDto,
) {
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let selected = service.accept_file(&file.path).expect("accepted");
    let preview = service.open_preview(&selected.handle).expect("opens");
    let spectrum = loaded_spectrum(&service, &selected.handle, index);
    (service, preview, spectrum)
}

/// The records of one data document, split on its delimiter.
fn records(text: &str, delimiter: char) -> Vec<(String, String)> {
    text.lines()
        .filter(|line| !line.starts_with('#'))
        .skip(1)
        .map(|line| {
            let (mz, intensity) = line.split_once(delimiter).expect("two fields");
            (mz.to_owned(), intensity.to_owned())
        })
        .collect()
}

/// One preamble value of a data document.
fn preamble(text: &str, key: &str, delimiter: char) -> String {
    text.lines()
        .find_map(|line| line.strip_prefix(&format!("#{key}{delimiter}")))
        .unwrap_or_else(|| panic!("the preamble carries {key}"))
        .to_owned()
}

#[test]
fn csv_and_tsv_exports_write_the_stored_values_exactly() {
    // The installed check's one FAIL (AFTER_BETA1_PLAN 7.1): `msaccess` printed
    // a spectrum at eight decimals. Natively the values are the stored ones,
    // widened exactly, and the exports write them back bit for bit. None of
    // these survives eight decimals.
    let stored_mz: [f32; 3] = [100.123_46, 445.12, 0.1];
    let stored_intensity: [f64; 3] = [0.123_456_789_123, 1.0 / 3.0, 9_000.000_000_000_02];
    for value in stored_intensity {
        assert_ne!(
            format!("{value:.8}").parse::<f64>().expect("a number"),
            value
        );
    }
    for value in stored_mz {
        assert_ne!(
            format!("{:.8}", f64::from(value))
                .parse::<f64>()
                .expect("a number"),
            f64::from(value)
        );
    }
    let file = TestFile::new("stored-values");
    let mut spectra = sample_spectra();
    spectra[0].mz = FixtureArray::f32s(&stored_mz);
    spectra[0].intensity = FixtureArray::f64s(&stored_intensity);
    spectra[0].declared_length = 3;
    file.write(&document(&spectra));
    let (service, _, spectrum) = open_and_load(&file, 0);

    for (format, delimiter) in [("csv", ','), ("tsv", '\t')] {
        let destination = file.directory.join(format!("stored.{format}"));
        assert_eq!(
            spectrum_saved_as(&service, &spectrum.export_token, format, &destination),
            None
        );
        let text = fs::read_to_string(&destination).expect("the export");
        let written = records(&text, delimiter);
        assert_eq!(written.len(), 3);
        for ((mz, intensity), (stored_mz, stored_intensity)) in
            written.iter().zip(stored_mz.iter().zip(stored_intensity))
        {
            let mz = mz.parse::<f64>().expect("an m/z");
            // The 32-bit value, widened: it narrows back to the stored bits.
            assert_eq!(mz, f64::from(*stored_mz));
            #[expect(
                clippy::cast_possible_truncation,
                reason = "the point is that this narrowing is exact"
            )]
            let narrowed = mz as f32;
            assert_eq!(narrowed.to_bits(), stored_mz.to_bits());
            assert_eq!(
                intensity.parse::<f64>().expect("an intensity").to_bits(),
                stored_intensity.to_bits()
            );
        }
    }
}

#[test]
fn integer_arrays_widen_exactly_and_an_inexact_64_bit_integer_is_refused() {
    let file = TestFile::new("integers");
    let mut spectra = sample_spectra();
    spectra[0].mz = FixtureArray::i32s(&[100, 200, i32::MAX]);
    spectra[0].intensity = FixtureArray::i64s(&[-(1_i64 << 53), 0, 1 << 53]);
    spectra[0].declared_length = 3;
    // Spectrum 1 holds a 64-bit integer that `f64` cannot hold exactly.
    spectra[1].mz = FixtureArray::f64s(&[300.0, 400.0]);
    spectra[1].intensity = FixtureArray::i64s(&[1, (1_i64 << 53) + 1]);
    file.write(&document(&spectra));
    let (service, _, spectrum) = open_and_load(&file, 0);

    assert_eq!(spectrum.mz, vec![100.0, 200.0, f64::from(i32::MAX)]);
    #[expect(
        clippy::cast_precision_loss,
        reason = "2^53 is exactly representable, which is what is asserted"
    )]
    let bound = (1_i64 << 53) as f64;
    assert_eq!(spectrum.intensity, vec![-bound, 0.0, bound]);

    let selected = service.roster().datasets[0].handle.clone();
    let refused = service
        .load_spectrum(&selected, 1)
        .expect_err("rounded rather than shown is not an option");
    assert_eq!(refused.kind, "spectrum_value_not_exact");
    assert_eq!(
        refused.detail.as_deref(),
        Some("intensity:integer_not_exact")
    );
    assert!(!refused.retryable);
    // The open and every other spectrum stand.
    loaded_spectrum(&service, &selected, 2);
}

#[test]
fn the_file_s_own_terms_reach_the_transfer_objects_and_the_exports() {
    let file = TestFile::new("declared-terms");
    let mut spectra = sample_spectra();
    for spectrum in &mut spectra {
        spectrum.retention_time_unit = Some("UO:0000031");
    }
    spectra[0].representation = Some("MS:1000128");
    spectra[0].mz_unit = Some("MS:1000040");
    spectra[0].intensity_unit = Some("MS:1000131");
    spectra[0].observed_mz_range = Some((100.5, 200.25));
    spectra[1].representation = Some("MS:1000127");
    spectra[1].precursor = Some((None, Some(880.0)));
    file.write(&document(&spectra));
    let (service, preview, profile) = open_and_load(&file, 0);

    // The table and the page's range carry the declared unit.
    assert!(
        preview
            .spectrum_table
            .rows
            .iter()
            .all(|row| row.retention_time.unit == RetentionTimeUnitDto::Minute)
    );
    assert_eq!(
        preview.run_summary.retention_time_range,
        RetentionTimeRangeDto::Reported {
            minimum: 0.1,
            maximum: 0.3,
            unit: RetentionTimeUnitDto::Minute,
        }
    );
    // The panel carries the values a profile line and a unit label need.
    assert_eq!(profile.representation, SpectrumRepresentationDto::Profile);
    assert_eq!(
        profile.mz_unit,
        ValueUnitDto::Declared {
            accession: "MS:1000040".to_owned()
        }
    );
    assert_eq!(
        profile.intensity_unit,
        ValueUnitDto::Declared {
            accession: "MS:1000131".to_owned()
        }
    );
    assert_eq!(profile.retention_time.unit, RetentionTimeUnitDto::Minute);
    assert_eq!(
        (profile.mz_low, profile.mz_high),
        (Some(100.5), Some(200.25))
    );
    let destination = file.directory.join("profile.csv");
    assert_eq!(
        spectrum_saved_as(&service, &profile.export_token, "csv", &destination),
        None
    );
    let text = fs::read_to_string(&destination).expect("the export");
    assert_eq!(preamble(&text, "representation", ','), "profile");
    assert_eq!(preamble(&text, "mz_unit", ','), "MS:1000040");
    assert_eq!(preamble(&text, "intensity_unit", ','), "MS:1000131");

    // A centroid spectrum, and a precursor that states only its intensity:
    // the m/z it does not state is `None`, never zero, and so is a range the
    // spectrum does not state. Its arrays declare no unit.
    let handle = preview.file.handle.clone();
    let centroid = loaded_spectrum(&service, &handle, 1);
    assert_eq!(centroid.representation, SpectrumRepresentationDto::Centroid);
    assert_eq!(centroid.mz_unit, ValueUnitDto::NotReported);
    assert_eq!((centroid.mz_low, centroid.mz_high), (None, None));
    assert_eq!(centroid.precursors.len(), 1);
    assert_eq!(centroid.precursors[0].index, 0);
    assert_eq!(centroid.precursors[0].mz, None);
    assert_eq!(centroid.precursors[0].intensity, Some(880.0));
    assert_eq!(preview.spectrum_table.rows[1].precursor_mz, None);
    let destination = file.directory.join("centroid.tsv");
    assert_eq!(
        spectrum_saved_as(&service, &centroid.export_token, "tsv", &destination),
        None
    );
    let text = fs::read_to_string(&destination).expect("the export");
    assert_eq!(preamble(&text, "representation", '\t'), "centroid");
    assert_eq!(preamble(&text, "mz_unit", '\t'), "unreported");

    // On the wire, as the webview reads it: an unstated value is `null`.
    fn wire(value: &impl serde::Serialize) -> serde_json::Value {
        serde_json::to_value(value).expect("serializes")
    }
    let preview = wire(&preview);
    assert_eq!(
        preview["spectrumTable"]["rows"][0]["retentionTime"],
        json!({ "value": 0.1, "unit": "minute" })
    );
    assert_eq!(
        preview["runSummary"]["retentionTimeRange"],
        json!({ "state": "reported", "minimum": 0.1, "maximum": 0.3, "unit": "minute" })
    );
    let profile = wire(&profile);
    assert_eq!(profile["representation"], json!("profile"));
    assert_eq!(
        profile["intensityUnit"],
        json!({ "state": "declared", "accession": "MS:1000131" })
    );
    assert_eq!(
        (&profile["mzLow"], &profile["mzHigh"]),
        (&json!(100.5), &json!(200.25))
    );
    let centroid = wire(&centroid);
    assert_eq!(centroid["representation"], json!("centroid"));
    assert_eq!(centroid["mzUnit"], json!({ "state": "notReported" }));
    assert_eq!(
        (&centroid["mzLow"], &centroid["mzHigh"]),
        (&json!(null), &json!(null))
    );
    assert_eq!(
        centroid["precursors"][0],
        json!({ "index": 0, "mz": null, "intensity": 880.0 })
    );

    // A profile projection carries the measured samples its line crosses each
    // edge from (P175); a centroid one carries none. Both keys are always on
    // the wire, nulls included, because the webview reads them unguarded.
    // One spectrum is retained at a time, so each is projected while current.
    let window = |token: &str, low: f64, high: f64| {
        wire(
            &service
                .project_selected_spectrum(token, low, high)
                .expect("a window of the source"),
        )
    };
    let discrete = window(
        centroid["exportToken"].as_str().expect("a token"),
        320.0,
        380.0,
    );
    assert_eq!(
        (&discrete["outsideLow"], &discrete["outsideHigh"]),
        (&json!(null), &json!(null))
    );
    let profile = loaded_spectrum(&service, &handle, 0);
    let between = window(&profile.export_token, 120.0, 180.0);
    assert_eq!(between["sourcePoints"], json!(0));
    assert_eq!(
        (&between["outsideLow"], &between["outsideHigh"]),
        (
            &json!({ "mz": 100.5, "intensity": 10.0 }),
            &json!({ "mz": 200.25, "intensity": 40.0 })
        )
    );
}

#[test]
fn the_remaining_wire_spellings_are_pinned() {
    // The variants the declared-terms file above does not reach. Serde renames
    // these and the webview mirrors them by hand, so a misspelling would fail
    // neither side's compiler.
    for (value, expected) in [
        (
            serde_json::to_value(RetentionTimeRangeDto::MixedUnits),
            json!({ "state": "mixedUnits" }),
        ),
        (
            serde_json::to_value(RetentionTimeRangeDto::NoRows),
            json!({ "state": "noRows" }),
        ),
        (
            serde_json::to_value(RetentionTimeUnitDto::Second),
            json!("second"),
        ),
        (
            serde_json::to_value(RetentionTimeUnitDto::NotReported),
            json!("notReported"),
        ),
        (
            serde_json::to_value(SpectrumRepresentationDto::NotReported),
            json!("notReported"),
        ),
    ] {
        assert_eq!(value.expect("serializes"), expected);
    }
}

#[test]
fn two_disagreeing_spectrum_counts_are_both_shown() {
    // ADR 0056, decision 3: the run summary counts three, the file's table
    // holds two, and neither is chosen.
    let file = TestFile::new("counts-differ");
    let mut spectra = sample_spectra();
    spectra.truncate(2);
    file.write(&document(&spectra));
    let (_, preview, _) = open_and_load(&file, 0);
    assert_eq!(preview.run_summary.total_spectrum_count, 3);
    assert_eq!(preview.spectrum_table.total_row_count, 2);
}

#[test]
fn a_run_in_one_declared_unit_keeps_its_chromatogram_with_that_unit() {
    for (accession, word) in [("UO:0000010", "second"), ("UO:0000031", "minute")] {
        let file = TestFile::new(&format!("chromatogram-{word}"));
        let mut spectra = sample_spectra();
        for spectrum in &mut spectra {
            spectrum.retention_time_unit = Some(accession);
        }
        file.write(&document(&spectra));
        let (service, preview, _) = open_and_load(&file, 0);

        let token = preview
            .chromatogram_export_token
            .expect("a run in one unit has a chromatogram");
        let destination = file.directory.join("run.csv");
        assert_eq!(
            chromatogram_saved_as(&service, &token, "csv", &destination),
            None
        );
        let text = fs::read_to_string(&destination).expect("the export");
        assert_eq!(preamble(&text, "retention_time_unit", ','), word);
    }
}

#[test]
fn a_run_of_mixed_units_has_no_chromatogram_and_no_range() {
    let file = TestFile::new("chromatogram-mixed");
    let mut spectra = sample_spectra();
    spectra[0].retention_time_unit = Some("UO:0000010");
    spectra[1].retention_time_unit = Some("UO:0000031");
    file.write(&document(&spectra));
    let (_, preview, _) = open_and_load(&file, 0);

    // Nothing converts seconds to minutes, so there is no one axis.
    assert_eq!(preview.chromatogram_export_token, None);
    assert_eq!(
        preview.run_summary.retention_time_range,
        RetentionTimeRangeDto::MixedUnits
    );
    // Each row still states its own.
    let units: Vec<_> = preview
        .spectrum_table
        .rows
        .iter()
        .map(|row| row.retention_time.unit)
        .collect();
    assert_eq!(
        units,
        [
            RetentionTimeUnitDto::Second,
            RetentionTimeUnitDto::Minute,
            RetentionTimeUnitDto::NotReported,
        ]
    );
}

#[test]
fn a_numpress_spectrum_is_refused_and_the_open_stands() {
    // The owner's decision of 2026-10-29 (ADR 0056): the viewer keeps the typed
    // refusal. The table pass decodes no array, so the file opens.
    let file = TestFile::new("numpress");
    let document =
        sample_document().replacen(r#"accession="MS:1000576""#, r#"accession="MS:1002312""#, 1);
    file.write(&document);
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the file opens");

    let refused = service
        .load_spectrum(&selected.handle, 0)
        .expect_err("numpress is not decoded");
    assert_eq!(refused.kind, "spectrum_encoding_unsupported");
    assert_eq!(refused.detail.as_deref(), Some("mz:numpress"));
    loaded_spectrum(&service, &selected.handle, 1);
}
