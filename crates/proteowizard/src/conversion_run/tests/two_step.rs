//! ADR 0055 decision 6: every format but mzML written from a private mzML
//! intermediate, run end to end against a stand-in for both provider runs.

use super::*;
use crate::chain::{IntSet, SpectrumStep};
use crate::output_inspect::{FinalOutputVerdict, NonMzmlFormat, OutputCheckRefusal};
use crate::structured::{
    IntensityArray, Lowering, Mz5Encoding, MzArray, MzMlEncoding, MzMlbEncoding,
    MzMlbIntensityArray, MzMlbMzArray, MzMlbPlainArray, MzXmlEncoding, OutputEncoding, Precision,
    Prediction, Tier, Truncation,
};

/// The captured 3.0.26013 help, which declares every format flag.
const CAPTURED_HELP: &str = include_str!("../../structured/msconvert-3.0.26013-help.txt");

/// An MS1 spectrum and an MS2 spectrum whose precursor names a selected ion:
/// something every format keeps.
fn two_level_source() -> String {
    source_document().replace(
        r#"<spectrum index="1" id="scan=2" defaultArrayLength="4"><cvParam accession="MS:1000511" name="ms level" value="1"/>"#,
        r#"<spectrum index="1" id="scan=2" defaultArrayLength="4"><cvParam accession="MS:1000511" name="ms level" value="2"/><precursorList count="1"><precursor><selectedIonList count="1"><selectedIon/></selectedIonList></precursor></precursorList>"#,
    )
}

/// What run 1 writes for `source`: the same records at the intermediate's
/// encoding, 64/64 with zlib, indexed.
fn intermediate_of(source: &str) -> String {
    format!("<indexedmzML>{source}</indexedmzML>")
}

/// Every format the output inspectors cover, with an encoding where the
/// format's writer reads one.
fn every_format() -> [(OutputEncoding, NonMzmlFormat); 8] {
    let plain = |precision| MzMlbPlainArray {
        precision,
        truncation: Truncation::Off,
        prediction: Prediction::None,
    };
    [
        (OutputEncoding::Mgf, NonMzmlFormat::Mgf),
        (OutputEncoding::Text, NonMzmlFormat::Text),
        (OutputEncoding::Ms1, NonMzmlFormat::Ms1),
        (OutputEncoding::Ms2, NonMzmlFormat::Ms2),
        (OutputEncoding::Cms1, NonMzmlFormat::Cms1),
        (OutputEncoding::Cms2, NonMzmlFormat::Cms2),
        (
            OutputEncoding::Mz5(Mz5Encoding {
                mz: Precision::Bits64,
                intensity: Precision::Bits32,
                zlib: true,
            }),
            NonMzmlFormat::Mz5,
        ),
        (
            OutputEncoding::MzMlb(MzMlbEncoding {
                mz: MzMlbMzArray::Plain(plain(Precision::Bits64)),
                intensity: MzMlbIntensityArray::Plain(plain(Precision::Bits32)),
                zlib: true,
                chunk_size: None,
                compression_level: None,
            }),
            NonMzmlFormat::MzMlb,
        ),
    ]
}

/// A final file that passes `format`'s checks, in the shape its writer begins.
fn written(format: NonMzmlFormat) -> Vec<u8> {
    let cms = |file_type: i32| {
        let mut bytes = file_type.to_le_bytes().to_vec();
        bytes.extend_from_slice(&3_i32.to_le_bytes());
        bytes.resize(4 + 4 + 16 * 128 + 12, 0);
        bytes
    };
    match format {
        NonMzmlFormat::Mgf => b"BEGIN IONS\nTITLE=scan=2\nEND IONS\n".to_vec(),
        NonMzmlFormat::Text => b"msdata:\n  run:\n    spectrumList:\n      spectrum:\n".to_vec(),
        NonMzmlFormat::Ms1 | NonMzmlFormat::Ms2 => b"H\tCreationDate\tx\nS\t1\t1\n".to_vec(),
        NonMzmlFormat::Cms1 => cms(2),
        NonMzmlFormat::Cms2 => cms(4),
        NonMzmlFormat::Mz5 | NonMzmlFormat::MzMlb => b"\x89HDF\r\n\x1a\n\0\0\0\0".to_vec(),
        NonMzmlFormat::MzXml(_) => unreachable!("mzXML is refused before planning"),
    }
}

/// MS1 and MS2 kept, so the chain's filter changes nothing a format keeps; it
/// is there to show that run 1 carries it and run 2 does not.
fn intent(output: OutputEncoding) -> StructuredIntent {
    StructuredIntent::new(
        output,
        vec![SpectrumStep::MsLevel {
            levels: IntSet::new([(1, Some(2))]).expect("1-2"),
        }],
        Vec::new(),
        [],
    )
    .expect("a valid intent")
}

struct Fixture {
    /// Held for its removal on drop.
    _directory: TestDirectory,
    root: PathBuf,
    source: PathBuf,
}

impl Fixture {
    fn new(source: &str) -> Self {
        let directory = TestDirectory::new();
        let root = directory.path().join("out");
        fs::create_dir(&root).expect("create destination root");
        let source_path = directory.path().join("sample.mzML");
        fs::write(&source_path, source).expect("write the source");
        Self {
            _directory: directory,
            root,
            source: source_path,
        }
    }

    fn plan(&self, output: OutputEncoding, conflict: ConflictPolicy) -> ConversionPlan {
        ConversionPlan::advanced(
            open_source(&self.source),
            &self.root,
            conflict,
            intent(output),
        )
        .expect("plan a conversion written from an intermediate")
    }

    fn root_entries(&self) -> Vec<OsString> {
        entry_names(&self.root)
    }
}

/// What a stand-in run does in place of the backend.
type Act = dyn Fn(&CommandSpec) -> Result<i32, ProcessError>;

/// The stand-in for both runs. Run 1 is the one that writes mzML; each run has
/// its own act and its own ending.
struct TwoRuns<'a> {
    first: FakeRunner<'a>,
    second: FakeRunner<'a>,
}

impl ProcessRunner for TwoRuns<'_> {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        if spec.args().iter().any(|token| token == "--mzML") {
            self.first.run(spec)
        } else {
            self.second.run(spec)
        }
    }
}

fn tokens(argv: &[OsString]) -> Vec<String> {
    argv.iter()
        .map(|token| token.to_string_lossy().into_owned())
        .collect()
}

fn writes(bytes: Vec<u8>) -> impl Fn(&CommandSpec) -> Result<i32, ProcessError> {
    move |spec| {
        fs::write(staged_destination(spec), &bytes).expect("write the staged output");
        Ok(0)
    }
}

#[test]
fn every_format_is_written_from_a_checked_intermediate_and_finalized_as_a_file() {
    let capabilities = capabilities_from(CAPTURED_HELP);
    for (output, format) in every_format() {
        let fixture = Fixture::new(&two_level_source());
        let plan = fixture.plan(output, ConflictPolicy::Fail);
        // Run 1 writes mzML; the plan names the format it finalizes.
        assert_eq!(plan.format(), OpenFormat::MzMl);
        assert_eq!(plan.two_step_target(), Some(format));
        let requested = plan.advanced_intent().expect("an advanced plan").clone();
        // Never a verified row: every such output is "not verified by MSCanvas".
        assert_eq!(
            requested.tier(ConversionSourceKind::MzmlFile, &capabilities),
            Ok(Tier::Advanced)
        );
        let first = writes(intermediate_of(&two_level_source()).into_bytes());
        let second = writes(written(format));
        let runner = TwoRuns {
            first: FakeRunner::new(&first),
            second: FakeRunner::new(&second),
        };
        let report = run_conversion(&plan, &capabilities, &runner);

        let file = report
            .finalized_file()
            .unwrap_or_else(|| panic!("{format:?}: {:?}", report.outcome()));
        assert_eq!(file.format(), format);
        assert_eq!(
            file.verdict(),
            match format {
                NonMzmlFormat::Mz5 | NonMzmlFormat::MzMlb => FinalOutputVerdict::SignatureOnly,
                _ => FinalOutputVerdict::RecordsPresent,
            }
        );
        assert_eq!(file.byte_length(), written(format).len() as u64);
        assert_eq!(
            file.sha256(),
            Sha256Digest::calculate(&written(format)).expect("digest")
        );
        // The chain's selection is reported unverified on the intermediate.
        assert!(
            file.intermediate()
                .unverified()
                .contains(&IntegrityProperty::SpectrumCount)
        );
        assert_eq!(report.step(), Some(ConversionStep::Target));
        assert!(report.finalized().is_none(), "not an mzML output");
        assert_eq!(report.residue(), None);

        // Exactly the planned name holds exactly the bytes run 2 wrote: no
        // intermediate, no staging area.
        let name = format!("sample.{}", format.extension());
        assert_eq!(fixture.root_entries(), [OsString::from(&name)]);
        assert_eq!(
            fs::read(fixture.root.join(&name)).expect("read"),
            written(format)
        );

        // Run 1: the source to mzML at 64/64 with zlib, carrying the chain.
        let first_argv = tokens(&runner.first.argv());
        assert_eq!(
            first_argv[1..6],
            ["--mzML", "--zlib", "--64", "--filter", "msLevel 1-2"]
        );
        assert_eq!(
            first_argv[first_argv.len() - 2..],
            ["--outfile", "sample-converted.mzML"]
        );
        // Run 2: the intermediate to the format, its encoding and nothing
        // else, under a fixed stem.
        let second_argv = tokens(&runner.second.argv());
        assert!(second_argv[0].ends_with("sample-converted.mzML"));
        let Lowering::ViaIntermediate {
            output: expected, ..
        } = requested.lowering()
        else {
            panic!("{format:?} is written from an intermediate");
        };
        let outdir = second_argv
            .iter()
            .position(|token| token == "--outdir")
            .expect("--outdir");
        assert_eq!(second_argv[1..outdir], tokens(&expected)[..], "{format:?}");
        assert!(!second_argv.iter().any(|token| token == "--filter"));
        assert_eq!(
            second_argv[second_argv.len() - 2..],
            ["--outfile", "target"]
        );

        // Not adoptable: there is no retained output to recognise.
        assert!(report.into_finalized_output().is_none());
    }
}

#[test]
fn an_intermediate_that_fails_the_mzml_checks_never_reaches_run_two() {
    let fixture = Fixture::new(&two_level_source());
    let plan = fixture.plan(OutputEncoding::Mgf, ConflictPolicy::Fail);
    // 32-bit intensity where the intermediate asks for 64.
    let first = writes(
        intermediate_of(&two_level_source())
            .replace(
                r#"<cvParam accession="MS:1000515"/><cvParam accession="MS:1000574"/><cvParam accession="MS:1000523"/>"#,
                r#"<cvParam accession="MS:1000515"/><cvParam accession="MS:1000574"/><cvParam accession="MS:1000521"/>"#,
            )
            .into_bytes(),
    );
    let second = writes(written(NonMzmlFormat::Mgf));
    let runner = TwoRuns {
        first: FakeRunner::new(&first),
        second: FakeRunner::new(&second),
    };
    let report = run_conversion(&plan, &capabilities_from(CAPTURED_HELP), &runner);
    assert!(
        matches!(
            report.outcome(),
            ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(
                ConversionIntegrityOutcome::NumericPrecisionMismatch { .. }
            ))
        ),
        "{:?}",
        report.outcome()
    );
    assert_eq!(report.step(), Some(ConversionStep::Intermediate));
    assert_eq!(runner.second.calls(), 0);
    assert_eq!(report.residue(), None);
    assert!(
        fixture.root_entries().is_empty(),
        "the intermediate is gone"
    );
}

#[test]
fn an_intermediate_with_nothing_the_format_keeps_is_refused_before_run_two() {
    // MS1 only: nothing for mgf.
    let fixture = Fixture::new(&source_document());
    let plan = fixture.plan(OutputEncoding::Mgf, ConflictPolicy::Fail);
    let first = writes(intermediate_of(&source_document()).into_bytes());
    let second = writes(written(NonMzmlFormat::Mgf));
    let runner = TwoRuns {
        first: FakeRunner::new(&first),
        second: FakeRunner::new(&second),
    };
    let report = run_conversion(&plan, &capabilities_from(CAPTURED_HELP), &runner);
    assert_eq!(
        report.outcome(),
        &ConversionRunOutcome::Failed(ConversionRunFailure::FormatCheckRefused(
            OutputCheckRefusal::OutputContainsNoRecords
        ))
    );
    assert_eq!(
        report.outcome().detailed_stable_id(),
        "output_contains_no_records"
    );
    assert_eq!(report.step(), Some(ConversionStep::Intermediate));
    assert_eq!(runner.second.calls(), 0);
    assert!(fixture.root_entries().is_empty());
}

#[test]
fn a_final_file_that_fails_its_checks_is_never_finalized() {
    let extra = |spec: &CommandSpec| -> Result<i32, ProcessError> {
        let destination = staged_destination(spec);
        fs::write(&destination, written(NonMzmlFormat::Mgf)).expect("write");
        fs::write(destination.with_extension("log"), b"x").expect("write");
        Ok(0)
    };
    let failing = |_: &CommandSpec| -> Result<i32, ProcessError> { Ok(1) };
    let no_ions = writes(b"MASS=Monoisotopic\n".to_vec());
    let not_hdf5 = writes(b"not an hdf5 file".to_vec());
    let empty = writes(Vec::new());
    // The unmeasured naming (ADR 0055's note): a build that appends `.txt`
    // after a `.txt` it did not strip, or spells the extension in another
    // case, wrote a name nothing planned, and it fails closed.
    let doubled = |spec: &CommandSpec| -> Result<i32, ProcessError> {
        let mut name = staged_destination(spec).into_os_string();
        name.push(".txt");
        fs::write(name, written(NonMzmlFormat::Text)).expect("write");
        Ok(0)
    };
    let lower_case = |spec: &CommandSpec| -> Result<i32, ProcessError> {
        let destination = staged_destination(spec).with_extension("mzmlb");
        fs::write(destination, written(NonMzmlFormat::MzMlb)).expect("write");
        Ok(0)
    };
    let cases: [(&Act, OutputEncoding, &str); 7] = [
        (&no_ions, OutputEncoding::Mgf, "output_contains_no_records"),
        (&not_hdf5, every_format()[6].0, "output_signature_mismatch"),
        (&empty, OutputEncoding::Text, "zero_byte_output"),
        (&extra, OutputEncoding::Mgf, "unexpected_output"),
        (&failing, OutputEncoding::Ms2, "backend_rejected"),
        (&doubled, OutputEncoding::Text, "unexpected_output_name"),
        (&lower_case, every_format()[7].0, "unexpected_output_name"),
    ];
    for (act, output, detail) in cases {
        let fixture = Fixture::new(&two_level_source());
        let plan = fixture.plan(output, ConflictPolicy::Fail);
        let first = writes(intermediate_of(&two_level_source()).into_bytes());
        let runner = TwoRuns {
            first: FakeRunner::new(&first),
            second: FakeRunner::new(act),
        };
        let report = run_conversion(&plan, &capabilities_from(CAPTURED_HELP), &runner);
        assert_eq!(report.outcome().detailed_stable_id(), detail, "{output:?}");
        assert_eq!(report.step(), Some(ConversionStep::Target), "{detail}");
        assert_eq!(report.residue(), None, "{detail}");
        assert!(fixture.root_entries().is_empty(), "{detail}");
    }
}

#[test]
fn a_taken_name_is_never_replaced() {
    let capabilities = capabilities_from(CAPTURED_HELP);
    let first = writes(intermediate_of(&two_level_source()).into_bytes());
    let second = writes(written(NonMzmlFormat::Mgf));

    // Taken before the run: refused or skipped, and nothing runs.
    for (conflict, expected) in [
        (
            ConflictPolicy::Fail,
            ConversionRunOutcome::Failed(ConversionRunFailure::DestinationExists),
        ),
        (
            ConflictPolicy::Skip,
            ConversionRunOutcome::SkippedExistingDestination,
        ),
    ] {
        let fixture = Fixture::new(&two_level_source());
        fs::write(fixture.root.join("sample.mgf"), b"theirs").expect("write");
        let plan = fixture.plan(OutputEncoding::Mgf, conflict);
        let runner = TwoRuns {
            first: FakeRunner::new(&first),
            second: FakeRunner::new(&second),
        };
        let report = run_conversion(&plan, &capabilities, &runner);
        assert_eq!(report.outcome(), &expected);
        assert_eq!(runner.first.calls() + runner.second.calls(), 0);
        assert_eq!(
            fs::read(fixture.root.join("sample.mgf")).expect("read"),
            b"theirs"
        );
    }

    // Taken while run 2 ran: what arrived is left as it is.
    let fixture = Fixture::new(&two_level_source());
    let plan = fixture.plan(OutputEncoding::Mgf, ConflictPolicy::Fail);
    let taken = fixture.root.join("sample.mgf");
    let arrives = |spec: &CommandSpec| {
        fs::write(&taken, b"theirs").expect("write");
        second(spec)
    };
    let runner = TwoRuns {
        first: FakeRunner::new(&first),
        second: FakeRunner::new(&arrives),
    };
    let report = run_conversion(&plan, &capabilities, &runner);
    assert_eq!(
        report.outcome(),
        &ConversionRunOutcome::Failed(ConversionRunFailure::DestinationAppearedDuringRun)
    );
    assert_eq!(report.step(), Some(ConversionStep::Target));
    assert_eq!(fs::read(&taken).expect("read"), b"theirs");
    assert_eq!(fixture.root_entries(), [OsString::from("sample.mgf")]);
}

#[test]
fn a_stop_is_answered_in_each_step_and_names_it() {
    let capabilities = capabilities_from(CAPTURED_HELP);
    let first = writes(intermediate_of(&two_level_source()).into_bytes());
    let second = writes(written(NonMzmlFormat::Mgf));

    // Before anything runs.
    let fixture = Fixture::new(&two_level_source());
    let cancellation = ConversionCancellation::new();
    cancellation.request_handle().request();
    let runner = TwoRuns {
        first: FakeRunner::new(&first),
        second: FakeRunner::new(&second),
    };
    let attempt = run_conversion_cancellable(
        &fixture.plan(OutputEncoding::Mgf, ConflictPolicy::Fail),
        &capabilities,
        &runner,
        cancellation,
    );
    let ConversionAttempt::Cancelled(report) = attempt else {
        panic!("{attempt:?}");
    };
    assert_eq!(report.observation(), CancellationObservation::BeforeRun);
    assert_eq!(report.step(), None);
    assert_eq!(runner.first.calls() + runner.second.calls(), 0);

    // During run 1, between the runs (run 1 ended normally after the request),
    // and during run 2.
    for (stopped_in, first_ending, second_ending) in [
        (
            ConversionStep::Intermediate,
            Termination::Cancelled,
            Termination::Exited,
        ),
        (
            ConversionStep::Target,
            Termination::Exited,
            Termination::Exited,
        ),
        (
            ConversionStep::Target,
            Termination::Exited,
            Termination::Cancelled,
        ),
    ] {
        let fixture = Fixture::new(&two_level_source());
        let cancellation = ConversionCancellation::new();
        let request = cancellation.request_handle();
        let observer = cancellation.recovery_observer();
        let requests_in_run_two = second_ending == Termination::Cancelled;
        let first_act = |spec: &CommandSpec| {
            let code = first(spec)?;
            if !requests_in_run_two {
                request.request();
            }
            Ok(code)
        };
        let second_act = |spec: &CommandSpec| {
            let code = second(spec)?;
            request.request();
            Ok(code)
        };
        let runner = TwoRuns {
            first: FakeRunner::new(&first_act).reporting(first_ending),
            second: FakeRunner::new(&second_act).reporting(second_ending),
        };
        let attempt = run_conversion_cancellable(
            &fixture.plan(OutputEncoding::Mgf, ConflictPolicy::Fail),
            &capabilities,
            &runner,
            cancellation,
        );
        let ConversionAttempt::Cancelled(report) = attempt else {
            panic!("{stopped_in:?}: {attempt:?}");
        };
        assert_eq!(report.observation(), CancellationObservation::DuringRun);
        assert_eq!(report.step(), Some(stopped_in));
        // A run launched, so the stop never reads as one that launched nothing.
        assert!(report.owned_tree().confirms_a_terminated_tree());
        assert!(report.backend_was_run());
        assert_eq!(report.residue(), None);
        // Read where a provider had returned: run 1's directory, holding the
        // intermediate, when the stop settled between the runs.
        let staged = report.staged_content();
        assert_eq!(
            staged.phase(),
            Some(StagedObservationPhase::ProviderReturned),
            "{stopped_in:?}"
        );
        if first_ending == Termination::Exited && !requests_in_run_two {
            assert!(
                staged
                    .observation()
                    .is_some_and(|observed| observed.non_empty_file_observed())
            );
        }
        assert_eq!(
            runner.second.calls(),
            usize::from(requests_in_run_two),
            "{stopped_in:?}"
        );
        assert!(fixture.root_entries().is_empty(), "{stopped_in:?}");
        // One staging area for both runs, retained for recovery like any other.
        assert_eq!(
            observer.retained().map(|recovery| recovery.status()),
            Some(StagingRecoveryStatus::Cleaned)
        );
    }
}

#[test]
fn a_stop_that_beats_run_two_to_its_launch_reports_run_one_as_the_launched_tree() {
    let fixture = Fixture::new(&two_level_source());
    let cancellation = ConversionCancellation::new();
    let request = cancellation.request_handle();
    let first = writes(intermediate_of(&two_level_source()).into_bytes());
    // Requested as run 2 is handed over, and the runner reports that nothing
    // started: run 2 created nothing, and run 1 did launch.
    let second = |_: &CommandSpec| -> Result<i32, ProcessError> {
        request.request();
        Ok(0)
    };
    let runner = TwoRuns {
        first: FakeRunner::new(&first),
        second: FakeRunner::new(&second).reporting(Termination::NotStarted),
    };
    let attempt = run_conversion_cancellable(
        &fixture.plan(OutputEncoding::Mgf, ConflictPolicy::Fail),
        &capabilities_from(CAPTURED_HELP),
        &runner,
        cancellation,
    );
    let ConversionAttempt::Cancelled(report) = attempt else {
        panic!("{attempt:?}");
    };
    assert_eq!(report.step(), Some(ConversionStep::Target));
    assert!(report.owned_tree().confirms_a_terminated_tree());
    assert!(report.backend_was_run());
    // Run 2's directory, which no provider was handed.
    assert_eq!(
        report.staged_content().phase(),
        Some(StagedObservationPhase::ProviderNotInvoked)
    );
    assert_eq!(report.residue(), None);
    assert!(fixture.root_entries().is_empty());
}

#[test]
fn run_two_never_launches_while_run_one_leaves_its_tree_unconfirmed() {
    let fixture = Fixture::new(&two_level_source());
    let cancellation = ConversionCancellation::new();
    let observer = cancellation.recovery_observer();
    let first = writes(intermediate_of(&two_level_source()).into_bytes());
    let second = writes(written(NonMzmlFormat::Mgf));
    let runner = TwoRuns {
        first: FakeRunner::new(&first).leaving_a_process(),
        second: FakeRunner::new(&second),
    };
    let attempt = run_conversion_cancellable(
        &fixture.plan(OutputEncoding::Mgf, ConflictPolicy::Fail),
        &capabilities_from(CAPTURED_HELP),
        &runner,
        cancellation,
    );
    let ConversionAttempt::Completed(report) = attempt else {
        panic!("{attempt:?}");
    };
    assert_eq!(
        report.outcome(),
        &ConversionRunOutcome::Failed(ConversionRunFailure::Backend(
            BackendExecutionFailure::NotTerminated
        ))
    );
    assert!(report.leaves_an_owned_process_unaccounted());
    assert_eq!(runner.second.calls(), 0);
    assert_eq!(report.step(), Some(ConversionStep::Target));
    assert_eq!(
        report.staged_content().phase(),
        Some(StagedObservationPhase::ProviderReturned)
    );
    // Unconfirmed process disposition refuses cleanup.
    assert_eq!(
        report.residue(),
        Some(StagingResidue::NotRemoved {
            kind: io::ErrorKind::WouldBlock
        })
    );
    assert_eq!(
        observer.retained().map(|recovery| recovery.status()),
        Some(StagingRecoveryStatus::ProcessUnconfirmed)
    );
}

#[test]
fn a_later_confirmed_run_never_clears_an_earlier_unconfirmed_one() {
    let directory = TestDirectory::new();
    let recovery = StagingRecovery::create(directory.path().join("area"), None)
        .expect("create a staging area");
    recovery.before_provider();
    recovery.after_provider(&Err(ProcessError::Terminate {
        detail: String::new(),
    }));
    recovery.before_provider();
    recovery.after_provider(&Ok(ProcessOutput::cancelled_before_launch()));
    assert_eq!(
        recovery.discard(),
        Some(StagingResidue::NotRemoved {
            kind: io::ErrorKind::WouldBlock
        })
    );
    assert_eq!(recovery.status(), StagingRecoveryStatus::ProcessUnconfirmed);
}

#[test]
fn an_intermediate_that_cannot_be_held_is_never_called_the_users_source() {
    use crate::conversion_run::two_step::hold_intermediate;
    let directory = TestDirectory::new();
    let path = directory.path().join("sample-converted.mzML");
    fs::write(&path, b"judged").expect("write");
    let judged = Sha256Digest::calculate(b"judged").expect("digest");
    drop(hold_intermediate(&path, 6, judged).expect("held as judged"));

    // Rewritten after its judgement, at the same length and at another, then
    // gone: run 1's output, never the user's source.
    let mut refusals = Vec::new();
    for rewritten in [&b"edited"[..], b"longer bytes"] {
        fs::write(&path, rewritten).expect("rewrite");
        refusals.push((
            hold_intermediate(&path, 6, judged).expect_err("refused"),
            "output_changed_during_inspection",
        ));
    }
    fs::remove_file(&path).expect("remove");
    refusals.push((
        hold_intermediate(&path, 6, judged).expect_err("refused"),
        "output_not_inspected",
    ));
    for (failure, detail) in refusals {
        assert_eq!(failure.stable_id(), "output_rejected", "{failure:?}");
        assert_eq!(failure.detailed_stable_id(), detail, "{failure:?}");
    }
}

/// Run 1 cannot take the name of run 2's directory: anything beside the
/// intermediate is refused with it, before that directory is created.
#[test]
fn run_one_cannot_take_the_name_of_run_two_directory() {
    let fixture = Fixture::new(&two_level_source());
    let first = |spec: &CommandSpec| -> Result<i32, ProcessError> {
        let destination = staged_destination(spec);
        fs::write(&destination, intermediate_of(&two_level_source())).expect("write");
        fs::create_dir(destination.with_file_name("target")).expect("create");
        Ok(0)
    };
    let second = writes(written(NonMzmlFormat::Mgf));
    let runner = TwoRuns {
        first: FakeRunner::new(&first),
        second: FakeRunner::new(&second),
    };
    let report = run_conversion(
        &fixture.plan(OutputEncoding::Mgf, ConflictPolicy::Fail),
        &capabilities_from(CAPTURED_HELP),
        &runner,
    );
    assert_eq!(report.outcome().detailed_stable_id(), "unexpected_output");
    assert_eq!(report.step(), Some(ConversionStep::Intermediate));
    assert_eq!(runner.second.calls(), 0);
    assert!(fixture.root_entries().is_empty());
}

#[test]
fn a_vendor_acquisition_is_written_from_an_intermediate_judged_against_its_object() {
    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let mgf = StructuredIntent::new(OutputEncoding::Mgf, Vec::new(), Vec::new(), [])
        .expect("a valid intent");
    let plan = ConversionPlan::advanced(open_thermo(&source), &root, ConflictPolicy::Fail, mgf)
        .expect("plan a vendor conversion written from an intermediate");
    assert_eq!(plan.two_step_target(), Some(NonMzmlFormat::Mgf));
    let first = writes(intermediate_of(&two_level_source()).into_bytes());
    let second = writes(written(NonMzmlFormat::Mgf));
    let runner = TwoRuns {
        first: FakeRunner::new(&first),
        second: FakeRunner::new(&second),
    };
    let capabilities = capabilities_reporting_with(
        CAPTURED_HELP,
        EVIDENCED_RELEASE,
        Some(EVIDENCED_REVISION),
        evidenced_executable_sha256(),
    );
    let report = run_conversion(&plan, &capabilities, &runner);

    assert!(report.finalized_file().is_some(), "{:?}", report.outcome());
    assert_eq!(entry_names(&root), [OsString::from("acquisition.mgf")]);
    // The intermediate takes the acquisition's stem: no source is mzML here.
    let first_argv = tokens(&runner.first.argv());
    assert_eq!(
        first_argv[first_argv.len() - 2..],
        ["--outfile", "acquisition.mzML"]
    );
    assert!(tokens(&runner.second.argv())[0].ends_with("acquisition.mzML"));
}

#[test]
fn mzxml_stays_refused() {
    let fixture = Fixture::new(&two_level_source());
    let mzxml = StructuredIntent::new(
        OutputEncoding::MzXml(MzXmlEncoding {
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
        mzxml.intermediate_route(ConversionSourceKind::MzmlFile),
        None
    );
    assert_eq!(
        ConversionPlan::advanced(
            open_source(&fixture.source),
            &fixture.root,
            ConflictPolicy::Fail,
            mzxml
        ),
        Err(ConversionPlanError::IntentNotCheckable)
    );
    // An mzML output still runs once, and nothing here changes it.
    let mzml = StructuredIntent::new(
        OutputEncoding::MzMl(MzMlEncoding {
            mz: MzArray::Plain {
                bits: Precision::Bits64,
            },
            intensity: IntensityArray::Plain {
                bits: Precision::Bits64,
            },
            zlib: true,
            index: true,
        }),
        Vec::new(),
        Vec::new(),
        [],
    )
    .expect("a valid intent");
    assert_eq!(
        mzml.intermediate_route(ConversionSourceKind::MzmlFile),
        None
    );
}
