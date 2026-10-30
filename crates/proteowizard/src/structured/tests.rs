use std::fs;
use std::num::{NonZeroU8, NonZeroU32, NonZeroU64};

use super::*;
use crate::capability::{CapturedHelpStream, CompleteHelpCapture, Sha256Digest};
use crate::chain::{
    ActivationType, AnalyzerKind, ChargeStatePredictor, DeisotopeMethod, Demultiplex,
    DemultiplexOptimization, Fraction, IntSet, Lockmass, MassUnit, MzTolerance, MzToleranceUnit,
    NativeId, NonNegative, Orientation, Polarity, PrecursorTarget, Real, ScanFilterMatch,
    ScanFilterText, SelectionMode, ThresholdCriterion, TitleKeyword, TitlePart, TitleTemplate,
    Turbocharger, ZeroSampleMode,
};
use crate::command::BackendTool;
use crate::intent::{NumericPrecision, SpectrumPopulation};

/// The msconvert 3.0.26013 help ADR 0055 rests on, from
/// `docs/spikes/evidence/msconvert-3.0.26013-help.txt` with its line endings
/// made LF; the parser trims `\r`, so the two parse alike.
const REAL_HELP: &str = include_str!("msconvert-3.0.26013-help.txt");

const SOURCE_KINDS: [ConversionSourceKind; 4] = [
    ConversionSourceKind::MzmlFile,
    ConversionSourceKind::ThermoRawFile,
    ConversionSourceKind::ShimadzuLcdFile,
    ConversionSourceKind::SciexWiffBundle,
];

fn capabilities(help: &str, executable_sha256: Sha256Digest) -> InstalledHelpCapabilities {
    let executable = fs::canonicalize(std::env::current_exe().expect("test executable"))
        .expect("canonical test executable");
    let capture = CompleteHelpCapture::new(
        CapturedHelpStream::new(
            help.as_bytes(),
            help.len() as u64,
            false,
            Sha256Digest::from_bytes([0xAB; 32]),
        ),
        CapturedHelpStream::new(&[], 0, false, Sha256Digest::from_bytes([0xEE; 32])),
    );
    InstalledHelpCapabilities::parse_unbound_capture_for_tests(
        BackendTool::MsConvert,
        executable,
        executable_sha256,
        capture,
    )
    .expect("the captured help parses")
}

fn verified_build() -> Sha256Digest {
    VERIFIED_MSCONVERT_SHA256.parse().expect("digest")
}

fn p(value: f64) -> Positive {
    Positive::new(value).expect("positive")
}

fn n(value: f64) -> NonNegative {
    NonNegative::new(value).expect("non-negative")
}

fn mzml(mz: MzArray, intensity: IntensityArray, zlib: bool, index: bool) -> OutputEncoding {
    OutputEncoding::MzMl(MzMlEncoding {
        mz,
        intensity,
        zlib,
        index,
    })
}

fn plain_mzml() -> OutputEncoding {
    mzml(
        MzArray::Plain {
            bits: Precision::Bits64,
        },
        IntensityArray::Plain {
            bits: Precision::Bits32,
        },
        true,
        true,
    )
}

fn build(output: OutputEncoding, chain: Vec<SpectrumStep>) -> StructuredIntent {
    StructuredIntent::new(output, chain, Vec::new(), []).expect("buildable")
}

fn direct(intent: &StructuredIntent) -> Vec<String> {
    match intent.lowering() {
        Lowering::Direct(tokens) => strings(tokens),
        Lowering::ViaIntermediate { .. } => panic!("mzML lowers to one run"),
    }
}

fn strings(tokens: Vec<OsString>) -> Vec<String> {
    tokens
        .into_iter()
        .map(|token| token.into_string().expect("UTF-8"))
        .collect()
}

/// The guard for all nine rows: each one's structured form is buildable,
/// lowers byte for byte to the row's own argv, and looks up as that row.
#[test]
fn every_verified_row_lowers_to_its_own_argv_and_looks_up_as_itself() {
    for admitted in ConversionIntent::ADMITTED {
        let row = admitted.intent();
        let structured = StructuredIntent::from(row);
        let rebuilt = StructuredIntent::new(
            *structured.output(),
            structured.spectrum_chain().to_vec(),
            structured.chromatogram_chain().to_vec(),
            structured.switches(),
        )
        .expect("a row's structured form is buildable");
        assert_eq!(rebuilt, structured);
        assert_eq!(
            structured.lowering(),
            Lowering::Direct(row.lower()),
            "{}",
            row.stable_id()
        );
        assert_eq!(structured.verified_row(), Some(row), "{}", row.stable_id());
    }
}

/// A set spelled `1-1` by a control is the set `1`, so the L1 row is found.
#[test]
fn a_row_reached_through_a_redundant_spelling_is_still_the_row() {
    let ms1 = IntSet::new([(1, Some(1)), (1, Some(1))]).expect("set");
    let intent = build(
        mzml(
            MzArray::Plain {
                bits: Precision::Bits64,
            },
            IntensityArray::Plain {
                bits: Precision::Bits64,
            },
            true,
            true,
        ),
        vec![SpectrumStep::MsLevel { levels: ms1 }],
    );
    let l1 = ConversionIntent::admitted(
        OutputFormat::MzMl,
        ProcessingIntent::NoAdditionalCentroiding,
        SpectrumPopulation::Ms1Only,
        NumericPrecision::Mz64Intensity64,
        CompressionIntent::Zlib,
    )
    .expect("L1");
    assert_eq!(intent.verified_row(), Some(l1));
}

/// One step away from a row is advanced, however small the step.
#[test]
fn an_intent_one_step_from_a_row_is_not_a_row() {
    let near = [
        StructuredIntent::new(plain_mzml(), Vec::new(), Vec::new(), [Switch::SimAsSpectra]),
        StructuredIntent::new(
            mzml(
                MzArray::Plain {
                    bits: Precision::Bits64,
                },
                IntensityArray::Plain {
                    bits: Precision::Bits32,
                },
                true,
                false,
            ),
            Vec::new(),
            Vec::new(),
            [],
        ),
        StructuredIntent::new(
            plain_mzml(),
            vec![SpectrumStep::MsLevel {
                levels: IntSet::new([(1, None)]).expect("1-"),
            }],
            Vec::new(),
            [],
        ),
        StructuredIntent::new(
            plain_mzml(),
            Vec::new(),
            vec![ChromatogramStep::Index {
                indices: IntSet::single(0),
            }],
            [],
        ),
        // The 32/32 row with a picker is K12; without zlib it is no row.
        StructuredIntent::new(
            mzml(
                MzArray::Plain {
                    bits: Precision::Bits32,
                },
                IntensityArray::Plain {
                    bits: Precision::Bits32,
                },
                false,
                true,
            ),
            vec![SpectrumStep::PeakPickingDefault],
            Vec::new(),
            [],
        ),
    ];
    for intent in near {
        let intent = intent.expect("buildable");
        assert_eq!(intent.verified_row(), None, "{intent:?}");
    }
}

#[test]
fn the_vendor_picker_may_only_be_first() {
    let vendor = SpectrumStep::PeakPickingVendor { ms_levels: None };
    assert!(
        StructuredIntent::new(
            plain_mzml(),
            vec![
                vendor.clone(),
                SpectrumStep::MsLevel {
                    levels: IntSet::single(2)
                }
            ],
            Vec::new(),
            [],
        )
        .is_ok()
    );
    for chain in [
        vec![
            SpectrumStep::MsLevel {
                levels: IntSet::single(2),
            },
            vendor.clone(),
        ],
        vec![vendor.clone(), vendor],
    ] {
        assert_eq!(
            StructuredIntent::new(plain_mzml(), chain, Vec::new(), []),
            Err(StructuredIntentError::VendorPickerNotFirst)
        );
    }
}

/// Steps are validated when the intent is built, not when it is lowered.
#[test]
fn an_invalid_step_refuses_the_intent() {
    let reversed = SpectrumStep::MzWindow {
        low: n(300.0),
        high: n(100.0),
    };
    assert_eq!(
        StructuredIntent::new(plain_mzml(), vec![reversed], Vec::new(), []),
        Err(StructuredIntentError::UnorderedRange)
    );
}

/// With linear numpress the global precision switch never appears, so
/// retention time keeps its 64-bit default; intensity is spelled per array.
#[test]
fn linear_numpress_never_emits_a_global_precision_switch() {
    let linear = MzArray::NumpressLinear {
        tolerance: LinearTolerance::Relative(p(2e-9)),
    };
    let numpress = "--numpressLinear=0.000000002";
    for (intensity, expected) in [
        (
            IntensityArray::Plain {
                bits: Precision::Bits32,
            },
            vec!["--mzML", "--zlib", numpress],
        ),
        (
            IntensityArray::Plain {
                bits: Precision::Bits64,
            },
            vec!["--mzML", "--zlib", "--inten64", numpress],
        ),
        (
            IntensityArray::NumpressPic,
            vec!["--mzML", "--zlib", "--inten64", numpress, "--numpressPic"],
        ),
        (
            IntensityArray::NumpressSlof { tolerance: p(2e-4) },
            vec![
                "--mzML",
                "--zlib",
                "--inten64",
                numpress,
                "--numpressSlof=0.0002",
            ],
        ),
    ] {
        let tokens = direct(&build(mzml(linear, intensity, true, true), Vec::new()));
        assert_eq!(tokens, expected, "{intensity:?}");
    }
}

/// Intensity numpress fixes intensity at 64 bits beside a 32-bit m/z array,
/// so the per-array spelling is used, never `--32`.
#[test]
fn intensity_numpress_fixes_intensity_at_64_bits() {
    let tokens = direct(&build(
        mzml(
            MzArray::Plain {
                bits: Precision::Bits32,
            },
            IntensityArray::NumpressPic,
            true,
            true,
        ),
        Vec::new(),
    ));
    assert_eq!(
        tokens,
        ["--mzML", "--zlib", "--mz32", "--inten64", "--numpressPic"]
    );
}

#[test]
fn an_absolute_linear_tolerance_replaces_the_relative_one() {
    let tokens = direct(&build(
        mzml(
            MzArray::NumpressLinear {
                tolerance: LinearTolerance::Absolute(p(1e-4)),
            },
            IntensityArray::Plain {
                bits: Precision::Bits32,
            },
            false,
            false,
        ),
        Vec::new(),
    ));
    assert_eq!(
        tokens,
        [
            "--mzML",
            "--zlib=off",
            "--numpressLinear",
            "--numpressLinearAbsTol=0.0001",
            "--noindex",
        ]
    );
}

fn mzmlb(zlib: bool, compression_level: Option<u8>, truncation: Truncation) -> OutputEncoding {
    OutputEncoding::MzMlb(MzMlbEncoding {
        mz: MzMlbMzArray::Plain(MzMlbPlainArray {
            precision: Precision::Bits32,
            truncation,
            prediction: Prediction::Delta,
        }),
        intensity: MzMlbIntensityArray::NumpressSlof { tolerance: p(2e-4) },
        zlib,
        chunk_size: NonZeroU64::new(1_048_576),
        compression_level,
    })
}

#[test]
fn mzmlb_compression_level_and_truncation_are_bounded() {
    let refused = |output| StructuredIntent::new(output, Vec::new(), Vec::new(), []).err();
    assert_eq!(
        refused(mzmlb(true, Some(0), Truncation::Off)),
        Some(StructuredIntentError::CompressionLevelZeroWithZlib)
    );
    assert_eq!(
        refused(mzmlb(false, Some(10), Truncation::Off)),
        Some(StructuredIntentError::CompressionLevelOutOfRange)
    );
    let bits = |value| Truncation::DropMantissaBits(NonZeroU8::new(value).expect("bits"));
    assert_eq!(
        refused(mzmlb(true, None, bits(24))),
        Some(StructuredIntentError::TruncationExceedsMantissa)
    );
    assert_eq!(refused(mzmlb(false, Some(0), bits(23))), None);
}

#[test]
fn mzmlb_lowers_every_option_its_writer_reads_in_run_two() {
    let intent = build(mzmlb(false, Some(0), Truncation::IntegersOnly), Vec::new());
    let Lowering::ViaIntermediate { output, .. } = intent.lowering() else {
        panic!("mzMLb is written from the intermediate");
    };
    assert_eq!(
        strings(output),
        [
            "--mzMLb",
            "--zlib=off",
            "--mz32",
            "--inten64",
            "--numpressSlof=0.0002",
            "--mzTruncation=-1",
            "--mzDelta",
            "--mzMLbChunkSize=1048576",
            "--mzMLbCompressionLevel=0",
        ]
    );
}

fn every_other_format() -> Vec<OutputEncoding> {
    vec![
        OutputEncoding::MzXml(MzXmlEncoding {
            precision: Precision::Bits32,
            zlib: false,
            index: false,
        }),
        OutputEncoding::Mz5(Mz5Encoding {
            mz: Precision::Bits64,
            intensity: Precision::Bits64,
            zlib: true,
        }),
        mzmlb(true, None, Truncation::Off),
        OutputEncoding::Mgf,
        OutputEncoding::Text,
        OutputEncoding::Ms1,
        OutputEncoding::Cms1,
        OutputEncoding::Ms2,
        OutputEncoding::Cms2,
    ]
}

/// Decision 6: run 1 is lossless mzML carrying both chains and the reader
/// switches; run 2 carries the format, its encoding and the writer switches,
/// and no filter.
#[test]
fn every_other_format_is_written_from_a_private_mzml_intermediate() {
    for output in every_other_format() {
        let intent = StructuredIntent::new(
            output,
            vec![SpectrumStep::PeakPickingDefault],
            vec![ChromatogramStep::Index {
                indices: IntSet::single(0),
            }],
            [Switch::StripVersionFromSoftware, Switch::SrmAsSpectra],
        )
        .expect("buildable");
        let Lowering::ViaIntermediate {
            intermediate,
            output: written,
        } = intent.lowering()
        else {
            panic!("{output:?} is written from the intermediate");
        };
        assert_eq!(
            strings(intermediate),
            [
                "--mzML",
                "--zlib",
                "--64",
                "--srmAsSpectra",
                "--filter",
                "peakPicking",
                "--chromatogramFilter",
                "index 0",
            ]
        );
        let written = strings(written);
        assert_eq!(written[0], format!("--{}", output.flag()));
        assert_eq!(
            written.last().map(String::as_str),
            Some("--stripVersionFromSoftware")
        );
        assert!(
            !written
                .iter()
                .any(|t| t == "--filter" || t == "--chromatogramFilter")
        );
        assert!(!written.iter().any(|t| t == "--srmAsSpectra"));
    }
}

/// The text formats read no encoding option, so run 2 is the flag alone.
#[test]
fn a_text_format_carries_no_encoding_option() {
    for output in [
        OutputEncoding::Mgf,
        OutputEncoding::Text,
        OutputEncoding::Ms1,
        OutputEncoding::Cms1,
        OutputEncoding::Ms2,
        OutputEncoding::Cms2,
    ] {
        let Lowering::ViaIntermediate {
            output: written, ..
        } = build(output, Vec::new()).lowering()
        else {
            panic!("written from the intermediate");
        };
        assert_eq!(strings(written), [format!("--{}", output.flag())]);
    }
}

#[test]
fn switches_lower_in_one_order_whatever_order_they_arrive_in() {
    let forward = StructuredIntent::new(
        plain_mzml(),
        Vec::new(),
        Vec::new(),
        [Switch::SimAsSpectra, Switch::SingleThreaded],
    )
    .expect("buildable");
    let backward = StructuredIntent::new(
        plain_mzml(),
        Vec::new(),
        Vec::new(),
        [
            Switch::SingleThreaded,
            Switch::SimAsSpectra,
            Switch::SimAsSpectra,
        ],
    )
    .expect("buildable");
    assert_eq!(forward, backward);
    assert_eq!(
        direct(&forward),
        ["--mzML", "--zlib", "--simAsSpectra", "--singleThreaded"]
    );
    assert_eq!(direct(&forward), direct(&forward));
}

fn intent_with(step: SpectrumStep) -> StructuredIntent {
    build(plain_mzml(), vec![step])
}

fn shipped() -> StructuredIntent {
    StructuredIntent::from(ConversionIntent::SHIPPED)
}

fn centroiding_row() -> StructuredIntent {
    StructuredIntent::from(
        ConversionIntent::admitted(
            OutputFormat::MzMl,
            ProcessingIntent::UnscopedDefaultCentroiding,
            SpectrumPopulation::All,
            NumericPrecision::Mz64Intensity64,
            CompressionIntent::Zlib,
        )
        .expect("K1"),
    )
}

#[test]
fn the_tier_is_verified_only_where_all_four_conditions_hold() {
    let verified = capabilities(REAL_HELP, verified_build());
    for kind in SOURCE_KINDS {
        assert_eq!(
            shipped().tier(kind, &verified),
            Ok(Tier::Verified(ConversionIntent::SHIPPED)),
            "{kind:?}"
        );
    }
    // Another executable: nothing is verified.
    let other = capabilities(REAL_HELP, Sha256Digest::from_bytes([0xCD; 32]));
    assert_eq!(
        shipped().tier(ConversionSourceKind::MzmlFile, &other),
        Ok(Tier::Advanced)
    );
    // The row's evidence covers mzML only.
    let row = centroiding_row();
    assert!(matches!(
        row.tier(ConversionSourceKind::MzmlFile, &verified),
        Ok(Tier::Verified(_))
    ));
    assert_eq!(
        row.tier(ConversionSourceKind::ShimadzuLcdFile, &verified),
        Ok(Tier::Advanced)
    );
    // Not a row at all.
    assert_eq!(
        intent_with(SpectrumStep::SortByScanTime).tier(ConversionSourceKind::MzmlFile, &verified),
        Ok(Tier::Advanced)
    );
}

/// The second condition: the verified build's digest with a help that cannot
/// express the row's `--64` leaves the row advanced, not verified.
#[test]
fn a_row_the_installed_help_cannot_express_is_not_verified() {
    let without_64 = REAL_HELP.replace("  --64 ", "  --sixtyfour ");
    let capabilities = capabilities(&without_64, verified_build());
    assert_eq!(
        centroiding_row().tier(ConversionSourceKind::MzmlFile, &capabilities),
        Ok(Tier::Advanced)
    );
    assert_eq!(
        shipped().tier(ConversionSourceKind::MzmlFile, &capabilities),
        Ok(Tier::Verified(ConversionIntent::SHIPPED))
    );
}

#[test]
fn the_pickers_are_blocked_on_the_sources_they_were_measured_failing_on() {
    let capabilities = capabilities(REAL_HELP, verified_build());
    let vendor = intent_with(SpectrumStep::PeakPickingVendor { ms_levels: None });
    assert_eq!(
        vendor.tier(ConversionSourceKind::MzmlFile, &capabilities),
        Err(SourceBlock::VendorPickerOnMzmlSource)
    );
    assert_eq!(
        centroiding_row().tier(ConversionSourceKind::ThermoRawFile, &capabilities),
        Err(SourceBlock::DefaultPickerOnThermoRaw)
    );
    for kind in [
        ConversionSourceKind::ThermoRawFile,
        ConversionSourceKind::ShimadzuLcdFile,
        ConversionSourceKind::SciexWiffBundle,
    ] {
        assert_eq!(vendor.tier(kind, &capabilities), Ok(Tier::Advanced));
    }
}

/// One of every spectrum step, with valid values.
fn one_of_every_spectrum_step() -> Vec<SpectrumStep> {
    let set = |a, b| IntSet::new([(a, b)]).expect("set");
    let tolerance = MzTolerance {
        value: p(10.0),
        unit: MzToleranceUnit::Ppm,
    };
    let count = ThresholdCriterion::Count(NonZeroU32::new(100).expect("count"));
    vec![
        SpectrumStep::PeakPickingVendor {
            ms_levels: Some(set(1, Some(2))),
        },
        SpectrumStep::Index {
            indices: set(0, Some(9)),
        },
        SpectrumStep::Id {
            ids: vec![NativeId::new("scan=1").expect("id")],
        },
        SpectrumStep::MsLevel {
            levels: set(2, None),
        },
        SpectrumStep::ChargeState {
            charges: set(2, Some(4)),
        },
        SpectrumStep::PrecursorRecalculation,
        SpectrumStep::LockmassRefiner(Lockmass {
            mz: p(556.2771),
            mz_negative_ions: p(554.2615),
            tolerance: p(1.0),
        }),
        SpectrumStep::PrecursorRefine,
        SpectrumStep::PeakPickingDefault,
        SpectrumStep::ScanNumber {
            scan_numbers: set(1, Some(100)),
        },
        SpectrumStep::ScanEvent {
            scan_events: set(1, Some(4)),
        },
        SpectrumStep::ScanTime {
            start_seconds: n(60.0),
            end_seconds: n(119.99),
        },
        SpectrumStep::SortByScanTime,
        SpectrumStep::StripIt,
        SpectrumStep::MetadataFixer,
        SpectrumStep::TitleMaker {
            template: TitleTemplate::new(vec![TitlePart::Keyword(TitleKeyword::Index)])
                .expect("template"),
        },
        SpectrumStep::Threshold {
            criterion: count,
            orientation: Orientation::MostIntense,
            ms_levels: None,
        },
        SpectrumStep::MzWindow {
            low: n(100.1),
            high: n(307.5),
        },
        SpectrumStep::MzPrecursors {
            mzs: vec![n(123.4)],
            tolerance,
            target: PrecursorTarget::Selected,
            mode: SelectionMode::Include,
        },
        SpectrumStep::IsolationWindows {
            windows: vec![(n(123.4), n(153.4))],
            tolerance,
            mode: SelectionMode::Include,
        },
        SpectrumStep::IsolationWidth {
            widths: vec![n(1.5)],
            tolerance,
            mode: SelectionMode::Include,
        },
        SpectrumStep::DefaultArrayLength {
            peak_counts: set(100, None),
        },
        SpectrumStep::ZeroSamples {
            mode: ZeroSampleMode::RemoveExtra,
            ms_levels: None,
        },
        SpectrumStep::MzPresent {
            mzs: vec![n(100.0)],
            tolerance,
            criterion: count,
            orientation: Orientation::MostIntense,
            mode: SelectionMode::Include,
        },
        SpectrumStep::ScanSumming {
            precursor_tolerance: p(0.05),
            scan_time_tolerance_seconds: p(10.0),
            ion_mobility_tolerance: p(0.01),
        },
        SpectrumStep::ThermoScanFilter {
            match_kind: ScanFilterMatch::Exact,
            mode: SelectionMode::Include,
            text: ScanFilterText::new("FTMS + p NSI Full ms").expect("text"),
        },
        SpectrumStep::MzShift {
            shift: Real::new(10.0).expect("real"),
            unit: MassUnit::Ppm,
            ms_levels: set(1, None),
        },
        SpectrumStep::Ms2Denoise {
            peaks_in_window: NonZeroU32::new(6).expect("6"),
            window_width_da: n(30.0),
            multicharge_fragment_relaxation: true,
        },
        SpectrumStep::Ms2Deisotope {
            method: DeisotopeMethod::Markey,
        },
        SpectrumStep::EtdFilter {
            remove_precursor: true,
            remove_charge_reduced: true,
            remove_neutral_loss: true,
            blanket_removal: true,
            matching_tolerance: MzTolerance {
                value: p(3.1),
                unit: MzToleranceUnit::Mz,
            },
        },
        SpectrumStep::Demultiplex(Demultiplex {
            mass_error: p(10.0),
            mass_error_unit: MassUnit::Ppm,
            nnls_max_iter: NonZeroU32::new(50).expect("50"),
            nnls_eps: p(1e-10),
            no_weighting: false,
            demux_block_extra: n(0.0),
            variable_fill: false,
            no_sum_normalize: false,
            optimization: DemultiplexOptimization::None,
            interpolate_rt: true,
            min_window_size: p(0.2),
            remove_non_overlapping_edges: false,
        }),
        SpectrumStep::ChargeStatePredictor(ChargeStatePredictor {
            override_existing_charge: false,
            max_multiple_charge: 3,
            min_multiple_charge: 2,
            single_charge_fraction_tic: Fraction::new(0.9).expect("fraction"),
            max_known_charge: 0,
            make_ms2: false,
        }),
        SpectrumStep::Turbocharger(Turbocharger {
            min_charge: 1,
            max_charge: 8,
            precursors_before: 2,
            precursors_after: 0,
            half_isolation_width: p(1.25),
            default_min_charge: 0,
            default_max_charge: 0,
            use_vendor_peaks: false,
        }),
        SpectrumStep::Activation {
            kind: ActivationType::Hcd,
            mode: SelectionMode::Include,
        },
        SpectrumStep::CollisionEnergy {
            low: n(20.0),
            high: n(40.0),
            mode: SelectionMode::Include,
            accept_non_cid: true,
            accept_missing_ce: false,
        },
        SpectrumStep::Analyzer {
            analyzer: AnalyzerKind::Orbi,
        },
        SpectrumStep::Polarity {
            polarity: Polarity::Positive,
        },
    ]
}

/// Every option the lowerings emit is declared by the real help, with the
/// argument kind the lowering relies on. Read from the probe's own parse of
/// the captured text, so a wrong `Optional` or `Required` here fails.
#[test]
fn every_emitted_option_is_declared_by_the_captured_help_as_emitted() {
    let capabilities = capabilities(REAL_HELP, verified_build());
    let every_switch = [
        Switch::SimAsSpectra,
        Switch::SrmAsSpectra,
        Switch::CombineIonMobilitySpectra,
        Switch::DdaProcessing,
        Switch::IgnoreCalibrationScans,
        Switch::AcceptZeroLengthSpectra,
        Switch::IgnoreMissingZeroSamples,
        Switch::IgnoreUnknownInstrumentError,
        Switch::SingleThreaded,
        Switch::StripLocationFromSourceFiles,
        Switch::StripVersionFromSoftware,
    ];
    let mut outputs = every_other_format();
    outputs.push(mzml(
        MzArray::NumpressLinear {
            tolerance: LinearTolerance::Absolute(p(1e-4)),
        },
        IntensityArray::NumpressPic,
        false,
        false,
    ));
    outputs.push(mzml(
        MzArray::NumpressLinear {
            tolerance: LinearTolerance::Relative(p(2e-9)),
        },
        IntensityArray::NumpressSlof { tolerance: p(2e-4) },
        true,
        true,
    ));
    outputs.push(mzmlb(
        true,
        Some(9),
        Truncation::DropMantissaBits(NonZeroU8::MIN),
    ));
    outputs.push(OutputEncoding::MzMlb(MzMlbEncoding {
        mz: MzMlbMzArray::Plain(MzMlbPlainArray {
            precision: Precision::Bits64,
            truncation: Truncation::Off,
            prediction: Prediction::Linear,
        }),
        intensity: MzMlbIntensityArray::Plain(MzMlbPlainArray {
            precision: Precision::Bits32,
            truncation: Truncation::IntegersOnly,
            prediction: Prediction::Delta,
        }),
        zlib: true,
        chunk_size: None,
        compression_level: None,
    }));
    outputs.push(OutputEncoding::MzMlb(MzMlbEncoding {
        mz: MzMlbMzArray::NumpressLinear {
            tolerance: LinearTolerance::Relative(p(2e-9)),
        },
        intensity: MzMlbIntensityArray::Plain(MzMlbPlainArray {
            precision: Precision::Bits64,
            truncation: Truncation::DropMantissaBits(NonZeroU8::MIN),
            prediction: Prediction::Linear,
        }),
        zlib: true,
        chunk_size: None,
        compression_level: None,
    }));
    let mut seen = BTreeSet::new();
    for output in outputs {
        let intent = StructuredIntent::new(
            output,
            vec![SpectrumStep::PeakPickingDefault],
            vec![ChromatogramStep::Index {
                indices: IntSet::single(0),
            }],
            every_switch,
        )
        .expect("buildable");
        for requirement in intent.provider_requirements() {
            if let ProviderRequirement::Option { name, argument } = requirement {
                let declared = capabilities
                    .option(name)
                    .unwrap_or_else(|| panic!("--{name} is not in the captured help"));
                assert_eq!(declared.argument(), argument, "--{name}");
                seen.insert(name);
            }
        }
    }
    // Every option the lowering can emit, so one it stopped emitting, or one
    // it began emitting unlisted, is noticed here too. `--mz64` and
    // `--inten32` are absent because the lowering spells those widths as
    // silence or as a global switch.
    let expected: BTreeSet<&str> = [
        "mzML",
        "mzXML",
        "mzMLb",
        "mz5",
        "mgf",
        "text",
        "ms1",
        "cms1",
        "ms2",
        "cms2",
        "zlib",
        "64",
        "32",
        "mz32",
        "inten64",
        "numpressLinear",
        "numpressLinearAbsTol",
        "numpressPic",
        "numpressSlof",
        "noindex",
        "mzTruncation",
        "intenTruncation",
        "mzDelta",
        "mzLinear",
        "intenDelta",
        "intenLinear",
        "mzMLbChunkSize",
        "mzMLbCompressionLevel",
        "filter",
        "chromatogramFilter",
        "simAsSpectra",
        "srmAsSpectra",
        "combineIonMobilitySpectra",
        "ddaProcessing",
        "ignoreCalibrationScans",
        "acceptZeroLengthSpectra",
        "ignoreMissingZeroSamples",
        "ignoreUnknownInstrumentError",
        "singleThreaded",
        "stripLocationFromSourceFiles",
        "stripVersionFromSoftware",
    ]
    .into_iter()
    .collect();
    assert_eq!(seen, expected);
}

/// What the probe can confirm by name on the real help, pinned. The rest is
/// the probe lane's gap: a declaration it drops (a `.` in the signature) or a
/// section it does not read (chromatogram filters).
#[test]
fn the_probe_confirms_these_filter_names_on_the_captured_help_and_not_these() {
    let capabilities = capabilities(REAL_HELP, verified_build());
    let mut unconfirmed: Vec<&str> = Vec::new();
    for step in one_of_every_spectrum_step() {
        let name = step.lower().requirement.name;
        if capabilities.spectrum_filter(name).is_none() && !unconfirmed.contains(&name) {
            unconfirmed.push(name);
        }
    }
    unconfirmed.sort_unstable();
    assert_eq!(
        unconfirmed,
        ["demultiplex", "lockmassRefiner", "mzPresent", "mzShift"],
        "the probe's view of the captured help changed"
    );

    let confirmed = build(plain_mzml(), vec![SpectrumStep::SortByScanTime]);
    assert_eq!(
        confirmed.confirm_provider_requirements(&capabilities),
        Ok(())
    );
    let shifted = intent_with(SpectrumStep::MzShift {
        shift: Real::new(1.0).expect("real"),
        unit: MassUnit::Da,
        ms_levels: IntSet::single(1),
    });
    assert_eq!(
        shifted.confirm_provider_requirements(&capabilities),
        Err(CapabilityRequirementError::Missing("mzShift"))
    );
    let chromatogram = StructuredIntent::new(
        plain_mzml(),
        Vec::new(),
        vec![ChromatogramStep::Index {
            indices: IntSet::single(0),
        }],
        [],
    )
    .expect("buildable");
    assert_eq!(
        chromatogram.confirm_provider_requirements(&capabilities),
        Err(CapabilityRequirementError::Missing("index"))
    );
}

/// Every step of the full list builds into one chain (vendor picker first) and
/// lowers deterministically, one `--filter` and one argument per step.
#[test]
fn a_chain_of_every_step_lowers_in_order_and_deterministically() {
    let steps = one_of_every_spectrum_step();
    let intent = build(plain_mzml(), steps.clone());
    let tokens = direct(&intent);
    assert_eq!(tokens, direct(&intent));
    let filters: Vec<&str> = tokens
        .iter()
        .skip_while(|token| *token != "--filter")
        .collect::<Vec<_>>()
        .chunks(2)
        .map(|pair| {
            assert_eq!(pair[0], "--filter");
            pair[1].as_str()
        })
        .collect();
    let expected: Vec<String> = steps.iter().map(|step| step.lower().argument).collect();
    assert_eq!(filters, expected);
}
