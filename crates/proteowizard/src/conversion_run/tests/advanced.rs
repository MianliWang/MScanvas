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
            vendor_picker
        ),
        Err(ConversionPlanError::StepBlockedForSource)
    );
    assert_eq!(fs::read_dir(&root).expect("read root").count(), 0);
}
