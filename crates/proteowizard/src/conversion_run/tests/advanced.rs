//! ADR 0055: an advanced intent planned, lowered, run and judged end to end
//! against the fake provider.

use super::*;
use crate::chain::{IntSet, SpectrumStep};
use crate::structured::{IntensityArray, MzArray, MzMlEncoding, OutputEncoding, Precision};

/// The captured 3.0.26013 help, which declares the filters a chain lowers to.
const CAPTURED_HELP: &str = include_str!("../../structured/msconvert-3.0.26013-help.txt");

fn mzml(mz: Precision, intensity: Precision) -> OutputEncoding {
    OutputEncoding::MzMl(MzMlEncoding {
        mz: MzArray::Plain { bits: mz },
        intensity: IntensityArray::Plain { bits: intensity },
        zlib: true,
        index: true,
    })
}

/// MS1 only at 64/32: no row holds it (L1 is 64/64), so it is advanced.
fn ms1_at_64_32() -> StructuredIntent {
    StructuredIntent::new(
        mzml(Precision::Bits64, Precision::Bits32),
        vec![SpectrumStep::MsLevel {
            levels: IntSet::single(1),
        }],
        Vec::new(),
        [],
    )
    .expect("a valid intent")
}

fn planned(intent: StructuredIntent, directory: &TestDirectory) -> ConversionPlan {
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    ConversionPlan::advanced(open_source(&source), &root, ConflictPolicy::Fail, intent)
        .expect("plan an advanced conversion")
}

#[test]
fn an_advanced_intent_runs_its_own_argv_and_reports_what_it_changed_unverified() {
    let directory = TestDirectory::new();
    let intent = ms1_at_64_32();
    assert_eq!(intent.verified_row(), None);
    let plan = planned(intent.clone(), &directory);
    assert_eq!(plan.intent(), None, "no row describes an advanced plan");
    assert_eq!(plan.advanced_intent(), Some(&intent));

    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities_from(CAPTURED_HELP), &runner);
    let valid = report
        .finalized()
        .unwrap_or_else(|| panic!("expected a finalized conversion: {:?}", report.outcome()));

    let argv: Vec<String> = runner
        .argv()
        .iter()
        .map(|token| token.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        argv[1..5],
        ["--mzML", "--zlib", "--filter", "msLevel 1"],
        "{argv:?}"
    );
    // The requested selection is reported unverified, never verified and
    // never failed.
    assert!(
        valid
            .unverified()
            .contains(&IntegrityProperty::SpectrumCount)
    );
    assert!(!valid.verified().contains(&IntegrityProperty::SpectrumCount));
}

#[test]
fn an_advanced_output_with_another_encoding_is_never_finalized() {
    let directory = TestDirectory::new();
    // Asks for 64-bit intensity; the stand-in writes 32, as an unflagged
    // build does.
    let intent = StructuredIntent::new(
        mzml(Precision::Bits64, Precision::Bits64),
        vec![SpectrumStep::MsLevel {
            levels: IntSet::single(1),
        }],
        Vec::new(),
        [],
    )
    .expect("a valid intent");
    let plan = planned(intent, &directory);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities_from(CAPTURED_HELP), &runner);
    assert!(report.finalized().is_none(), "{:?}", report.outcome());
    assert_eq!(
        fs::read_dir(directory.path().join("out"))
            .expect("read the destination root")
            .count(),
        0
    );
}

#[test]
fn an_intent_without_output_checks_or_blocked_for_its_source_is_refused_when_planned() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let mzxml = StructuredIntent::new(
        OutputEncoding::MzXml(crate::structured::MzXmlEncoding {
            precision: Precision::Bits64,
            zlib: true,
            index: true,
        }),
        Vec::new(),
        Vec::new(),
        [],
    )
    .expect("a valid intent");
    assert_eq!(
        ConversionPlan::advanced(open_source(&source), &root, ConflictPolicy::Fail, mzxml),
        Err(ConversionPlanError::IntentNotCheckable)
    );

    let vendor_picker = StructuredIntent::new(
        mzml(Precision::Bits64, Precision::Bits64),
        vec![SpectrumStep::PeakPickingVendor { ms_levels: None }],
        Vec::new(),
        [],
    )
    .expect("a valid intent");
    assert_eq!(
        ConversionPlan::advanced(
            open_source(&source),
            &root,
            ConflictPolicy::Fail,
            vendor_picker.clone()
        ),
        Err(ConversionPlanError::StepBlockedForSource)
    );
    // On another vendor family the picker's name and scope record were never
    // measured, so there is nothing to judge the output by.
    let shimadzu = write_shimadzu_source(directory.path(), "acquisition.lcd");
    assert_eq!(
        ConversionPlan::advanced(
            open_shimadzu(&shimadzu),
            &root,
            ConflictPolicy::Fail,
            vendor_picker
        ),
        Err(ConversionPlanError::IntentNotCheckable)
    );
    assert_eq!(fs::read_dir(&root).expect("read root").count(), 0);
}

/// What the verified build writes for a Thermo acquisition under the vendor
/// picker: every spectrum centroid, and one method naming the picker with the
/// scope record given.
fn vendor_centroided(scope: Option<&str>) -> String {
    let scope = scope.map_or(String::new(), |value| {
        format!(r#"<userParam name="ms levels" value="{value}"/>"#)
    });
    output_document()
        .replace(
            r#"<cvParam accession="MS:1000128" name="profile spectrum"/>"#,
            r#"<cvParam accession="MS:1000127" name="centroid spectrum"/>"#,
        )
        .replace(
            r#"<run id="R1"><spectrumList count="2">"#,
            &format!(
                r#"<dataProcessingList count="1"><dataProcessing id="pwiz"><processingMethod order="1" softwareRef="pwiz"><cvParam accession="MS:1000035" name="peak picking"/><userParam name="Thermo/Xcalibur peak picking"/>{scope}</processingMethod></dataProcessing></dataProcessingList><run id="R1"><spectrumList count="2" defaultDataProcessingRef="pwiz">"#
            ),
        )
}

fn vendor_row() -> ConversionIntent {
    ConversionIntent::admitted(
        crate::OutputFormat::MzMl,
        crate::ProcessingIntent::VendorCentroidingFromMs1,
        crate::SpectrumPopulation::All,
        crate::NumericPrecision::Mz64Intensity32,
        crate::CompressionIntent::Zlib,
    )
    .expect("TV1, TE1, TQ1")
}

/// The vendor-centroiding row, planned and run on a Thermo acquisition: the
/// measured argv after the source, and an output judged on its own terms with
/// the requested processing verified. mzML and Shimadzu sources are refused
/// before anything is planned.
#[test]
fn a_thermo_acquisition_converts_under_the_vendor_centroiding_row() {
    let directory = TestDirectory::new();
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let mzml = write_source(directory.path(), "sample.mzML");
    let shimadzu = write_shimadzu_source(directory.path(), "acquisition.lcd");
    for refused in [open_source(&mzml), open_shimadzu(&shimadzu)] {
        assert_eq!(
            ConversionPlan::to_mzml(refused, &root, ConflictPolicy::Fail, vendor_row()).map(|_| ()),
            Err(ConversionPlanError::IntentNotEvidencedForSource)
        );
    }

    let source = write_thermo_source(directory.path(), "acquisition.raw");
    let plan = ConversionPlan::to_mzml(
        open_thermo(&source),
        &root,
        ConflictPolicy::Fail,
        vendor_row(),
    )
    .expect("plan the row on Thermo RAW");
    let act = |spec: &CommandSpec| {
        fs::write(staged_destination(spec), vendor_centroided(None)).expect("write output");
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities_from(CAPTURED_HELP), &runner);
    let valid = report
        .finalized()
        .unwrap_or_else(|| panic!("expected a finalized conversion: {:?}", report.outcome()));
    let argv: Vec<String> = runner
        .argv()
        .iter()
        .map(|token| token.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        argv[1..5],
        [
            "--mzML",
            "--zlib",
            "--filter",
            "peakPicking vendor msLevel=1-"
        ],
        "{argv:?}"
    );
    assert!(
        valid
            .verified()
            .contains(&IntegrityProperty::RequestedProcessing)
    );
}

/// MS2 and above on Thermo RAW is the eleventh row (ADR 0059), and its scope
/// record is checked whichever way it is planned: as the row, which carries no
/// levels of its own and is judged at the row's scope, or as the structured
/// intent the wire sends. An output carrying the record the build writes for
/// `2-` is finalized, and one without it -- a scope the build discarded, or
/// the MS1-and-above record -- is not.
#[test]
fn vendor_centroiding_from_ms2_is_a_row_and_its_scope_record_is_checked() {
    let row = ConversionIntent::admitted(
        crate::OutputFormat::MzMl,
        crate::ProcessingIntent::VendorCentroidingFromMs2,
        crate::SpectrumPopulation::All,
        crate::NumericPrecision::Mz64Intensity32,
        crate::CompressionIntent::Zlib,
    )
    .expect("TV2, TE2, TQ2");
    let from_ms2 = StructuredIntent::new(
        mzml(Precision::Bits64, Precision::Bits32),
        vec![SpectrumStep::PeakPickingVendor {
            ms_levels: Some(IntSet::new([(2, None)]).expect("2-")),
        }],
        Vec::new(),
        [],
    )
    .expect("a valid intent");
    assert_eq!(from_ms2.verified_row(), Some(row));

    for (scope, finalized, as_row) in [
        (Some("2-"), true, true),
        (None, false, true),
        (Some("2-"), true, false),
        (None, false, false),
    ] {
        let directory = TestDirectory::new();
        let root = directory.path().join("out");
        fs::create_dir(&root).expect("create destination root");
        let source = write_thermo_source(directory.path(), "acquisition.raw");
        let plan = if as_row {
            ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail, row)
        } else {
            ConversionPlan::advanced(
                open_thermo(&source),
                &root,
                ConflictPolicy::Fail,
                from_ms2.clone(),
            )
        }
        .expect("plan MS2 and above on Thermo RAW");
        // The fixture's spectra are MS1, out of scope: left as the reader gave
        // them and not judged.
        let act = move |spec: &CommandSpec| {
            fs::write(staged_destination(spec), vendor_centroided(scope)).expect("write output");
            Ok(0)
        };
        let runner = FakeRunner::new(&act);
        let report = run_conversion(&plan, &capabilities_from(CAPTURED_HELP), &runner);
        assert_eq!(
            report.finalized().is_some(),
            finalized,
            "{scope:?}, row {as_row}: {:?}",
            report.outcome()
        );
        if !finalized {
            assert!(
                matches!(
                    report.outcome(),
                    ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(
                        ConversionIntegrityOutcome::PickerScopeRecordMismatch { .. }
                    ))
                ),
                "{:?}",
                report.outcome()
            );
        }
        assert!(
            runner
                .argv()
                .contains(&OsString::from("peakPicking vendor msLevel=2-"))
        );
    }
}
