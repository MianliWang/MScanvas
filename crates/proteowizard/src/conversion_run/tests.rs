use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::capability::{CapturedHelpStream, CompleteHelpCapture};
use crate::command::{BackendTool, CommandSpec};
use crate::conversion::{CompressionPolicy, IntegrityProperty};

static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

const FIXTURE_SHA256: Sha256Digest = Sha256Digest::from_bytes([0xAB; 32]);
const EMPTY_SHA256: Sha256Digest = Sha256Digest::from_bytes([0xCD; 32]);
const EXECUTABLE_SHA256: Sha256Digest = Sha256Digest::from_bytes([0xEF; 32]);

/// The subset of installed `msconvert` help the public conversion plan requires.
const MSCONVERT_HELP: &str = r"Usage: msconvert [options] [filemasks]
Convert mass spec data file formats.

Options:
  -o [ --outdir ] arg (=.)           : set output directory
  --outfile arg                      : Override the name of output file.
  --mzML                             : write mzML format [default]
  --mzXML                            : write mzXML format
  -z [ --zlib ] [=arg(=1)]           : use zlib compression for binary data
";

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "mscanvas-conversion-run-tests-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path).expect("create conversion run test directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// How the two documents below differ. A faithful `msconvert` run adds the
/// index wrapper and may re-encode numeric precision, and neither may fail a
/// conversion, so the fixtures differ in exactly those legal ways rather than
/// being a byte copy of one another.
#[derive(Clone, Copy)]
enum Serialization {
    Source,
    Output,
}

fn document(spectra: u32, serialization: Serialization) -> String {
    let precision = match serialization {
        Serialization::Source => "MS:1000523",
        Serialization::Output => "MS:1000521",
    };
    let mut body = String::new();
    for index in 0..spectra {
        body.push_str(&format!(
            r#"<spectrum index="{index}" id="scan={}" defaultArrayLength="4">"#,
            index + 1
        ));
        body.push_str(r#"<cvParam accession="MS:1000511" name="ms level" value="1"/>"#);
        body.push_str(r#"<cvParam accession="MS:1000128" name="profile spectrum"/>"#);
        body.push_str(r#"<binaryDataArrayList count="2">"#);
        for accession in ["MS:1000514", "MS:1000515"] {
            body.push_str(&format!(
                r#"<binaryDataArray encodedLength="8"><cvParam accession="{accession}"/><cvParam accession="MS:1000574"/><cvParam accession="{precision}"/><binary>AA==</binary></binaryDataArray>"#
            ));
        }
        body.push_str("</binaryDataArrayList></spectrum>");
    }
    let run = format!(
        r#"<run id="R1"><spectrumList count="{spectra}">{body}</spectrumList><chromatogramList count="0"></chromatogramList></run>"#
    );
    match serialization {
        Serialization::Source => format!(r#"<mzML version="1.1.0">{run}</mzML>"#),
        Serialization::Output => {
            format!(r#"<indexedmzML><mzML version="1.1.0">{run}</mzML></indexedmzML>"#)
        }
    }
}

fn source_document() -> String {
    document(2, Serialization::Source)
}

fn output_document() -> String {
    document(2, Serialization::Output)
}

fn capabilities() -> InstalledHelpCapabilities {
    let executable = fs::canonicalize(std::env::current_exe().expect("test executable"))
        .expect("canonical test executable");
    InstalledHelpCapabilities::parse_unbound_capture_for_tests(
        BackendTool::MsConvert,
        executable,
        EXECUTABLE_SHA256,
        CompleteHelpCapture::new(
            CapturedHelpStream::new(
                MSCONVERT_HELP.as_bytes(),
                MSCONVERT_HELP.len() as u64,
                false,
                FIXTURE_SHA256,
            ),
            CapturedHelpStream::new(&[], 0, false, EMPTY_SHA256),
        ),
    )
    .expect("parse the msconvert help fixture")
}

/// A source file whose contents really are mzML, written under `directory`.
fn write_source(directory: &Path, name: &str) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, source_document()).expect("write conversion source");
    path
}

fn open_source(path: &Path) -> ConversionSource {
    ConversionSource::open_mzml_file(path, MzmlScanLimits::default()).expect("open mzML source")
}

fn plan_into(source: ConversionSource, root: &Path, conflict: ConflictPolicy) -> ConversionPlan {
    ConversionPlan::to_mzml(source, root, conflict).expect("plan an mzML conversion")
}

/// A `msconvert` stand-in. It receives the real planned command, so what it is
/// told to write, and where, is decided by the boundary under test rather than
/// by the test.
struct FakeRunner<'a> {
    act: &'a dyn Fn(&CommandSpec) -> Result<i32, ProcessError>,
    termination: Termination,
    calls: Cell<usize>,
    argv: RefCell<Vec<OsString>>,
    working_directory: RefCell<Option<PathBuf>>,
}

impl<'a> FakeRunner<'a> {
    fn new(act: &'a dyn Fn(&CommandSpec) -> Result<i32, ProcessError>) -> Self {
        Self {
            act,
            termination: Termination::Exited,
            calls: Cell::new(0),
            argv: RefCell::new(Vec::new()),
            working_directory: RefCell::new(None),
        }
    }

    /// A runner that reports something other than an ordinary exit. Nothing in
    /// this boundary requests one; only a substituted runner can produce it.
    const fn reporting(mut self, termination: Termination) -> Self {
        self.termination = termination;
        self
    }

    fn calls(&self) -> usize {
        self.calls.get()
    }

    fn argv(&self) -> Vec<OsString> {
        self.argv.borrow().clone()
    }

    fn working_directory(&self) -> Option<PathBuf> {
        self.working_directory.borrow().clone()
    }
}

impl ProcessRunner for FakeRunner<'_> {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        self.calls.set(self.calls.get() + 1);
        self.argv.replace(spec.args().to_vec());
        self.working_directory
            .replace(Some(spec.working_directory().to_path_buf()));
        let exit_code = (self.act)(spec)?;
        Ok(ProcessOutput {
            stdout: Vec::new(),
            stderr: Vec::new(),
            stdout_total_bytes: 0,
            stderr_total_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: true,
            exit_code: Some(exit_code),
            elapsed: Duration::from_millis(7),
            termination: self.termination,
            max_active_processes: Some(1),
            final_active_processes: Some(0),
            peak_job_memory_bytes: Some(1_024),
        })
    }
}

/// The path the planned command tells the backend to write.
fn staged_destination(spec: &CommandSpec) -> PathBuf {
    spec.output_destination()
        .expect("a conversion plan carries an output destination")
        .to_path_buf()
}

/// Writes the faithful conversion output the plan asked for.
fn convert_faithfully(spec: &CommandSpec) -> Result<i32, ProcessError> {
    fs::write(staged_destination(spec), output_document()).expect("write staged output");
    Ok(0)
}

fn entry_names(directory: &Path) -> Vec<OsString> {
    let mut names: Vec<OsString> = fs::read_dir(directory)
        .expect("read directory")
        .map(|entry| entry.expect("directory entry").file_name())
        .collect();
    names.sort();
    names
}

#[test]
fn a_plan_derives_a_deterministic_mzml_name_and_fixes_every_other_decision() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "样本 01.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);

    assert_eq!(plan.output_file_name(), OsStr::new("样本 01.mzML"));
    assert_eq!(plan.format(), OpenFormat::MzMl);
    assert_eq!(plan.conflict_policy(), ConflictPolicy::Fail);
    assert_eq!(plan.compression_policy().compression().stable_id(), "zlib");
    assert_eq!(plan.source().kind(), ConversionSourceKind::MzmlFile);
    // The plan judges its output with the same limits that read its source.
    assert_eq!(plan.scan_limits(), plan.source().scan_limits());
    assert_eq!(
        plan.source().mzml_facts().declared_spectrum_count(),
        Some(2)
    );
    assert_eq!(
        plan.source().byte_length(),
        source_document().len() as u64,
        "the plan records the source it measured"
    );
}

#[test]
fn a_conversion_runs_in_a_private_staging_directory_and_finalizes_into_the_root() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let neighbour = root.join("unrelated.txt");
    fs::write(&neighbour, b"a file the user already had").expect("write neighbour");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    let valid = report.finalized().unwrap_or_else(|| {
        panic!(
            "expected a finalized conversion, got {:?}",
            report.outcome()
        )
    });
    assert!(valid.verified().contains(&IntegrityProperty::SpectrumCount));
    assert_eq!(report.residue(), None);
    assert_eq!(
        report.backend().and_then(BackendRunFacts::exit_code),
        Some(0)
    );

    // The output holds its planned name, the neighbour is untouched, and the
    // staging directory is gone.
    assert_eq!(
        entry_names(&root),
        vec![
            OsString::from("sample.mzML"),
            OsString::from("unrelated.txt")
        ]
    );
    assert_eq!(
        fs::read_to_string(root.join("sample.mzML")).expect("read finalized output"),
        output_document()
    );
    assert_eq!(
        fs::read(&neighbour).expect("read neighbour"),
        b"a file the user already had"
    );
}

#[test]
fn the_planned_command_writes_into_the_staging_directory_and_never_names_mzxml() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);
    assert!(report.finalized().is_some(), "{:?}", report.outcome());

    let argv = runner.argv();
    let canonical_root = fs::canonicalize(&root).expect("canonical destination root");
    assert_eq!(
        plan.destination_root(),
        canonical_root,
        "the plan carries the canonical root a caller needs to find the output"
    );
    // Spelled out rather than rebuilt from the constants, so renaming either is
    // a decision this test forces someone to make. The backend writes one level
    // below the staging root, because the ownership marker lives in the root and
    // the integrity contract insists the output directory hold one entry.
    let staging = canonical_root
        .join("sample.mzML.mscanvas-staging")
        .join("output");
    // And the suffix must not be one the output snapshot reads as an
    // interrupted write, decided by that rule rather than by restating it.
    let probe = directory.path().join("suffix-probe");
    fs::create_dir(&probe).expect("create the suffix probe directory");
    fs::create_dir(probe.join("sample.mzML.mscanvas-staging")).expect("create the probe entry");
    assert!(
        !fs_guard::snapshot_output_directory(&probe)
            .expect("snapshot the suffix probe directory")
            .contains_partial_output()
    );
    assert_eq!(
        runner.working_directory().as_deref(),
        Some(staging.as_path()),
        "the backend's working directory is the private staging directory"
    );

    assert_eq!(argv.len(), 7);
    assert_eq!(argv[1], OsStr::new("--mzML"));
    // The compression the integrity contract is entitled to assume and the flag
    // the backend is actually given are two facts, and they must agree.
    assert_eq!(
        plan.compression_policy().compression(),
        CompressionPolicy::Zlib
    );
    assert_eq!(argv[2], OsStr::new("--zlib"));
    assert_eq!(argv[3], OsStr::new("--outdir"));
    assert_eq!(
        argv[4],
        staging.as_os_str(),
        "the backend writes into the private staging directory, not the destination root"
    );
    assert_eq!(argv[5], OsStr::new("--outfile"));
    assert_eq!(argv[6], OsStr::new("sample.mzML"));
    assert!(
        !argv.iter().any(|value| value == OsStr::new("--mzXML")),
        "{argv:?}"
    );
    assert!(
        !argv.iter().any(|value| value == OsStr::new("--filter")),
        "no filter is inserted: {argv:?}"
    );
}

#[test]
fn an_existing_destination_is_refused_or_skipped_and_never_overwritten() {
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
        let directory = TestDirectory::new();
        let source = write_source(directory.path(), "sample.mzML");
        let root = directory.path().join("out");
        fs::create_dir(&root).expect("create destination root");
        let destination = root.join("sample.mzML");
        fs::write(&destination, b"the result of an earlier run").expect("write destination");

        let plan = plan_into(open_source(&source), &root, conflict);
        let act = convert_faithfully;
        let runner = FakeRunner::new(&act);
        let report = run_conversion(&plan, &capabilities(), &runner);

        assert_eq!(*report.outcome(), expected);
        assert_eq!(runner.calls(), 0, "the backend never ran");
        assert_eq!(
            fs::read(&destination).expect("read destination"),
            b"the result of an earlier run"
        );
        assert_eq!(entry_names(&root), vec![OsString::from("sample.mzML")]);
    }
}

#[test]
fn an_existing_staging_target_fails_without_disturbing_what_is_in_it() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let mut staging_name = OsString::from("sample.mzML");
    staging_name.push(STAGING_SUFFIX);
    let staging = root.join(&staging_name);
    fs::create_dir(&staging).expect("create the pre-existing staging directory");
    fs::write(staging.join("in-flight"), b"another run may still own this")
        .expect("write staging content");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::StagingTargetExists)
    );
    assert_eq!(runner.calls(), 0, "the backend never ran");
    assert_eq!(
        fs::read(staging.join("in-flight")).expect("read staging content"),
        b"another run may still own this",
        "a staging area this run did not create is left alone"
    );

    // And reclaiming will not delete it either. The name is deterministic, so a
    // user may hold it too; only the ownership marker decides, and a tree of
    // someone else's data is never removed on the strength of a name.
    assert_eq!(
        plan.reclaim_staging_area(),
        Err(StagingReclaimError::NotOwned)
    );
    assert_eq!(
        fs::read(staging.join("in-flight")).expect("read staging content"),
        b"another run may still own this"
    );

    // A marker that is not a plain file MSCanvas wrote does not confer ownership
    // either.
    fs::write(staging.join(".mscanvas-staging-owner"), b"not the marker")
        .expect("write a wrong marker");
    assert_eq!(
        plan.reclaim_staging_area(),
        Err(StagingReclaimError::NotOwned)
    );
    assert!(staging.join("in-flight").exists());

    // Teardown removes the marker before it removes the root, so a root removal
    // that fails leaves exactly an empty directory. That must stay reclaimable
    // or it becomes the permanent obstruction the marker exists to prevent —
    // and removing an empty directory destroys nothing, whoever made it.
    fs::remove_dir_all(&staging).expect("remove the unowned directory");
    fs::create_dir(&staging).expect("leave an empty staging directory behind");
    plan.reclaim_staging_area()
        .expect("an empty staging directory is reclaimable");
    assert!(!staging.exists());

    // An absent staging area is nothing to reclaim rather than a failure.
    plan.reclaim_staging_area()
        .expect("reclaiming an absent staging area is not a failure");

    let report = run_conversion(&plan, &capabilities(), &runner);
    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    assert_eq!(runner.calls(), 1);
    assert_eq!(entry_names(&root), vec![OsString::from("sample.mzML")]);
}

#[test]
fn a_backend_failure_leaves_its_partial_output_out_of_the_destination_root() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = |spec: &CommandSpec| {
        fs::write(staged_destination(spec), b"<indexedmzML><mzML><run>")
            .expect("write partial output");
        Ok(1)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::BackendRejected { exit_code: Some(1) })
    );
    assert_eq!(
        report.backend().and_then(BackendRunFacts::exit_code),
        Some(1)
    );
    assert_eq!(report.residue(), None);
    assert!(
        entry_names(&root).is_empty(),
        "a failed run leaves nothing behind: {:?}",
        entry_names(&root)
    );
}

#[test]
fn a_backend_launch_failure_is_reported_without_the_executable_it_names() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = |_: &CommandSpec| {
        Err(ProcessError::Launch {
            executable: "C:\\a\\path\\msconvert.exe".to_owned(),
            kind: LaunchFailureKind::NotFound,
            detail: "The system cannot find the file specified.".to_owned(),
        })
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::Backend(
            BackendExecutionFailure::NotLaunched {
                kind: LaunchFailureKind::NotFound
            }
        ))
    );
    assert_eq!(report.backend(), None);
    let rendered = format!("{:?}", report.outcome());
    assert!(
        !rendered.contains("C:\\a\\path"),
        "the executable path must not survive the projection: {rendered}"
    );
    assert!(entry_names(&root).is_empty());
}

#[test]
fn an_output_that_fails_the_integrity_contract_is_never_finalized() {
    // One spectrum arrives where the source had two. Exit status says success.
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = |spec: &CommandSpec| {
        fs::write(staged_destination(spec), document(1, Serialization::Output))
            .expect("write a lossy output");
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(
            ConversionIntegrityOutcome::SpectrumCountMismatch {
                source: 2,
                output: 1
            }
        ))
    );
    assert!(entry_names(&root).is_empty(), "nothing reached the root");
}

#[test]
fn an_empty_output_is_never_a_successful_conversion() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = |spec: &CommandSpec| {
        fs::write(staged_destination(spec), b"").expect("write an empty output");
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(
            ConversionIntegrityOutcome::EmptyOutput
        ))
    );
    assert!(entry_names(&root).is_empty());
}

#[test]
fn a_backend_that_produced_no_output_is_never_a_successful_conversion() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = |_: &CommandSpec| Ok(0);
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(
            ConversionIntegrityOutcome::MissingOutput
        ))
    );
    assert!(entry_names(&root).is_empty());
}

#[test]
fn an_extra_backend_output_is_rejected_because_the_staging_area_is_private() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = |spec: &CommandSpec| {
        let destination = staged_destination(spec);
        fs::write(&destination, output_document()).expect("write staged output");
        fs::write(
            destination
                .parent()
                .expect("the staged output has a parent")
                .join("sample.mzML.index"),
            b"an output the plan never asked for",
        )
        .expect("write an extra output");
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(
            ConversionIntegrityOutcome::UnexpectedExtraOutput { observed: 2 }
        ))
    );
    assert!(entry_names(&root).is_empty());
}

#[test]
fn a_source_replaced_during_the_conversion_is_never_finalized() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let replaced = source.clone();
    let act = move |spec: &CommandSpec| {
        fs::write(staged_destination(spec), output_document()).expect("write staged output");
        fs::write(&replaced, document(3, Serialization::Source))
            .expect("rewrite the source under the run");
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(
            ConversionIntegrityOutcome::SourceChangedDuringConversion
        ))
    );
    assert!(entry_names(&root).is_empty());
}

#[test]
fn a_destination_taken_during_the_run_is_left_exactly_as_it_arrived() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let raced = root.join("sample.mzML");
    let act = move |spec: &CommandSpec| {
        fs::write(staged_destination(spec), output_document()).expect("write staged output");
        fs::write(&raced, b"something else took this name").expect("take the destination");
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::DestinationAppearedDuringRun)
    );
    assert_eq!(
        fs::read(root.join("sample.mzML")).expect("read the raced destination"),
        b"something else took this name",
        "finalization never replaces what already holds the name"
    );
    assert_eq!(entry_names(&root), vec![OsString::from("sample.mzML")]);
}

#[test]
fn a_source_is_opened_and_read_rather_than_named() {
    let directory = TestDirectory::new();

    // An extension is not identity: a file named .mzML that is not mzML is
    // refused before any plan exists.
    let impostor = directory.path().join("not-really.mzML");
    fs::write(&impostor, b"PK\x03\x04 this is not mzML").expect("write impostor");
    assert!(matches!(
        ConversionSource::open_mzml_file(&impostor, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotReadableAsMzml(_))
    ));

    // A directory-formatted acquisition is not a source this boundary accepts.
    let acquisition = directory.path().join("acquisition.d");
    fs::create_dir(&acquisition).expect("create a directory acquisition");
    assert_eq!(
        ConversionSource::open_mzml_file(&acquisition, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotARegularFile)
    );

    // A name that resolves to nothing is not a source either.
    assert_eq!(
        ConversionSource::open_mzml_file(
            &directory.path().join("absent.mzML"),
            MzmlScanLimits::default()
        ),
        Err(ConversionSourceRejection::NotInspectable {
            kind: io::ErrorKind::NotFound
        })
    );

    // Only a real mzML document becomes one, and the name it happens to carry
    // decides nothing: this source is called `.raw` and reads as mzML, so the
    // output name comes from the format rather than from the source extension.
    let real = write_source(directory.path(), "acquisition.raw");
    let source = open_source(&real);
    assert_eq!(source.kind(), ConversionSourceKind::MzmlFile);
    assert_eq!(source.kind().stable_id(), "mzml_file");

    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = plan_into(source, &root, ConflictPolicy::Fail);
    assert_eq!(plan.output_file_name(), OsStr::new("acquisition.mzML"));

    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);
    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    assert_eq!(entry_names(&root), vec![OsString::from("acquisition.mzML")]);
}

/// The only new foreign-function boundary in this module converts a path to a
/// wide string. A name with a space and non-ASCII characters must survive it,
/// end to end, rather than only as far as a plan.
#[test]
fn a_unicode_name_with_a_space_survives_planning_staging_and_finalization() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "样本 01.mzML");
    let root = directory.path().join("输出 root");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    assert_eq!(entry_names(&root), vec![OsString::from("样本 01.mzML")]);
    assert_eq!(
        fs::read_to_string(root.join("样本 01.mzML")).expect("read finalized output"),
        output_document()
    );
    let argv = runner.argv();
    assert_eq!(argv[6], OsStr::new("样本 01.mzML"));
    assert_eq!(argv.len(), 7, "the name stays one argv value: {argv:?}");
}

/// A runner is caller-supplied code. An unwind through it must not leave the
/// backend's output in the destination root under a name every later run would
/// then refuse.
#[test]
fn a_panic_in_the_runner_still_discards_the_staging_directory() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = |spec: &CommandSpec| -> Result<i32, ProcessError> {
        fs::write(staged_destination(spec), output_document()).expect("write staged output");
        panic!("a substituted runner panicked");
    };
    let runner = FakeRunner::new(&act);
    let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_conversion(&plan, &capabilities(), &runner)
    }));

    assert!(unwound.is_err(), "the panic must not be swallowed");
    assert!(
        entry_names(&root).is_empty(),
        "the staging directory outlived the unwind: {:?}",
        entry_names(&root)
    );
}

/// This boundary requests no cancellation, so a termination that is not an
/// ordinary exit can only come from a substituted runner. It is a typed failure
/// rather than a cancellation feature, and it is never a success.
#[test]
fn a_run_that_did_not_complete_is_a_failure_rather_than_a_cancellation() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act).reporting(Termination::Cancelled);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::BackendDidNotComplete)
    );
    assert!(
        entry_names(&root).is_empty(),
        "a document produced by a run that did not complete is never finalized"
    );
}

/// The backend facts a later surface would show are projected exactly, and are
/// reported whether or not the run produced a usable document.
#[test]
fn backend_facts_are_projected_faithfully_on_success_and_on_rejection() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = |spec: &CommandSpec| {
        fs::write(staged_destination(spec), document(1, Serialization::Output))
            .expect("write a lossy output");
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    let backend = report
        .backend()
        .expect("a process ran, so its facts are reported");
    assert_eq!(backend.exit_code(), Some(0));
    assert_eq!(backend.elapsed(), Duration::from_millis(7));
    assert!(!backend.stdout_truncated());
    assert!(backend.stderr_truncated());
    assert_eq!(backend.peak_job_memory_bytes(), Some(1_024));
    assert!(
        matches!(
            report.outcome(),
            ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(_))
        ),
        "{:?}",
        report.outcome()
    );
}

#[test]
fn a_plan_refuses_a_destination_root_that_is_not_a_readable_directory() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");

    assert_eq!(
        ConversionPlan::to_mzml(
            open_source(&source),
            &directory.path().join("absent"),
            ConflictPolicy::Fail,
        ),
        Err(ConversionPlanError::DestinationRootNotInspectable {
            kind: io::ErrorKind::NotFound
        })
    );

    let file_as_root = directory.path().join("root.txt");
    fs::write(&file_as_root, b"not a directory").expect("write file used as a root");
    assert_eq!(
        ConversionPlan::to_mzml(open_source(&source), &file_as_root, ConflictPolicy::Fail),
        Err(ConversionPlanError::DestinationRootNotADirectory)
    );
}

#[test]
fn every_outcome_renders_a_distinct_stable_identifier_and_no_path() {
    let failures = [
        ConversionRunFailure::DestinationExists,
        ConversionRunFailure::DestinationNotInspectable {
            kind: io::ErrorKind::PermissionDenied,
        },
        ConversionRunFailure::StagingTargetExists,
        ConversionRunFailure::StagingNotCreated {
            kind: io::ErrorKind::PermissionDenied,
        },
        ConversionRunFailure::NotPlannable(PlanError::OutputDestinationExists),
        ConversionRunFailure::Backend(BackendExecutionFailure::ExecutableChanged),
        ConversionRunFailure::BackendRejected { exit_code: Some(3) },
        ConversionRunFailure::BackendDidNotComplete,
        ConversionRunFailure::OutputRejected(ConversionIntegrityOutcome::PartialOutput),
        ConversionRunFailure::DestinationAppearedDuringRun,
        ConversionRunFailure::NotFinalized {
            kind: io::ErrorKind::PermissionDenied,
        },
    ];
    let mut identifiers: Vec<&str> = failures
        .iter()
        .map(ConversionRunFailure::stable_id)
        .collect();
    identifiers.push(ConversionRunOutcome::SkippedExistingDestination.stable_id());
    // A finalized run and a skipped one must never share an identifier: one
    // wrote a file and the other deliberately did not. The finalized value is
    // read from a real run rather than constructed here, because
    // `ValidConversion` cannot be forged.
    identifiers.push(finalized_run().outcome().stable_id());
    let unique: BTreeSet<&str> = identifiers.iter().copied().collect();
    assert_eq!(unique.len(), identifiers.len(), "{identifiers:?}");

    // The embedded plan and integrity errors keep their own identifiers, so a
    // caller that must not render Debug can still say what went wrong.
    assert_eq!(
        ConversionRunFailure::NotPlannable(PlanError::MzXmlIntegrityGateRequired)
            .detailed_stable_id(),
        "mzxml_integrity_gate_required"
    );
    assert_eq!(
        ConversionRunFailure::OutputRejected(ConversionIntegrityOutcome::PartialOutput)
            .detailed_stable_id(),
        "partial_output"
    );
    assert_eq!(
        ConversionRunFailure::Backend(BackendExecutionFailure::SourceChanged).detailed_stable_id(),
        "source_changed"
    );
    assert_eq!(
        ConversionRunFailure::DestinationExists.detailed_stable_id(),
        "destination_exists"
    );

    for failure in &failures {
        for rendered in [format!("{failure:?}"), failure.to_string()] {
            assert!(
                !rendered.contains('/') && !rendered.contains('\\'),
                "a failure must not render a path: {rendered}"
            );
        }
    }

    // A source and a plan describe themselves without naming where they are.
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    for rendered in [format!("{:?}", plan.source()), format!("{plan:?}")] {
        assert!(
            !rendered.contains("mscanvas-conversion-run-tests"),
            "a plan must not render a path: {rendered}"
        );
        assert!(
            !rendered.contains("sample.mzML"),
            "a plan must not render a file name: {rendered}"
        );
    }
}

/// One real finalized run, so a `Finalized` outcome is read from the value the
/// boundary produces rather than from one a test constructed.
fn finalized_run() -> ConversionRunReport {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);
    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    report
}

#[test]
fn every_plan_source_and_policy_identifier_is_distinct() {
    let plan_errors = [
        ConversionPlanError::SourceHasNoConvertibleName,
        ConversionPlanError::UnsafeOutputFileName,
        ConversionPlanError::DestinationRootNotInspectable {
            kind: io::ErrorKind::NotFound,
        },
        ConversionPlanError::DestinationRootNotADirectory,
    ];
    let plan_identifiers: BTreeSet<&str> = plan_errors
        .iter()
        .copied()
        .map(ConversionPlanError::stable_id)
        .collect();
    assert_eq!(plan_identifiers.len(), plan_errors.len());

    let rejections = [
        ConversionSourceRejection::NotInspectable {
            kind: io::ErrorKind::NotFound,
        },
        ConversionSourceRejection::NotARegularFile,
        ConversionSourceRejection::NotHashed,
    ];
    let rejection_identifiers: BTreeSet<&str> = rejections
        .iter()
        .copied()
        .map(ConversionSourceRejection::stable_id)
        .collect();
    assert_eq!(rejection_identifiers.len(), rejections.len());

    assert_ne!(
        ConflictPolicy::Fail.stable_id(),
        ConflictPolicy::Skip.stable_id()
    );
    assert_eq!(ConflictPolicy::default(), ConflictPolicy::Fail);
    assert_eq!(
        StagingResidue::NotRemoved {
            kind: io::ErrorKind::PermissionDenied
        }
        .stable_id(),
        "staging_not_removed"
    );

    for rendered in plan_errors
        .iter()
        .map(ToString::to_string)
        .chain(rejections.iter().map(ToString::to_string))
    {
        assert!(
            !rendered.contains('/') && !rendered.contains('\\'),
            "{rendered}"
        );
    }
}

#[test]
fn every_backend_execution_failure_has_its_own_identifier() {
    let failures = [
        BackendExecutionFailure::EnvironmentInvalid,
        BackendExecutionFailure::StagedDestinationExists,
        BackendExecutionFailure::StagedDestinationNotInspectable {
            kind: io::ErrorKind::PermissionDenied,
        },
        BackendExecutionFailure::StagingDirectoryNotEmpty,
        BackendExecutionFailure::StagingDirectoryNotInspectable {
            kind: io::ErrorKind::PermissionDenied,
        },
        BackendExecutionFailure::OutputInsideSource,
        BackendExecutionFailure::ExecutableNotReverified {
            kind: io::ErrorKind::PermissionDenied,
        },
        BackendExecutionFailure::ExecutableChanged,
        BackendExecutionFailure::SourceNotReverified {
            kind: io::ErrorKind::PermissionDenied,
        },
        BackendExecutionFailure::SourceChanged,
        BackendExecutionFailure::NotLaunched {
            kind: LaunchFailureKind::NotFound,
        },
        BackendExecutionFailure::NotSupervised,
        BackendExecutionFailure::NotAwaited,
        BackendExecutionFailure::OutputNotCaptured {
            stream: BackendStream::Stdout,
        },
        BackendExecutionFailure::NotTerminated,
    ];
    let identifiers: BTreeSet<&str> = failures
        .iter()
        .copied()
        .map(BackendExecutionFailure::stable_id)
        .collect();
    assert_eq!(identifiers.len(), failures.len());
}

/// A substituted runner names its capture stream with an unconstrained string.
/// It must not reach a type whose purpose is to be safe to render.
#[test]
fn an_arbitrary_capture_stream_label_is_projected_onto_a_closed_set() {
    let disclosing = ProcessError::Capture {
        stream: "D:\\acquisitions\\样本 01.raw",
        detail: "the capture thread failed".to_owned(),
    };
    let projected = BackendExecutionFailure::from(&disclosing);

    assert_eq!(
        projected,
        BackendExecutionFailure::OutputNotCaptured {
            stream: BackendStream::Unrecognized
        }
    );
    for rendered in [format!("{projected:?}"), projected.to_string()] {
        assert!(
            !rendered.contains('\\') && !rendered.contains("样本"),
            "{rendered}"
        );
    }

    for (label, expected) in [
        ("stdout", BackendStream::Stdout),
        ("stderr", BackendStream::Stderr),
    ] {
        assert_eq!(
            BackendExecutionFailure::from(&ProcessError::Capture {
                stream: label,
                detail: String::new(),
            }),
            BackendExecutionFailure::OutputNotCaptured { stream: expected }
        );
        assert_eq!(expected.stable_id(), label);
    }
    assert_eq!(
        BackendStream::Unrecognized.stable_id(),
        "unrecognized_stream"
    );
}

/// Cleanup is not a verdict. A staging directory that cannot be removed is
/// reported beside the outcome, and never instead of it.
#[cfg(windows)]
#[test]
fn a_staging_directory_that_cannot_be_removed_never_changes_the_outcome() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    /// Share reads only, so the staged file cannot be deleted while it is open.
    const FILE_SHARE_READ: u32 = 0x0000_0001;

    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let held = RefCell::new(None);
    let act = |spec: &CommandSpec| {
        let destination = staged_destination(spec);
        fs::write(&destination, output_document()).expect("write staged output");
        let handle = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&destination)
            .expect("hold the staged output open");
        *held.borrow_mut() = Some(handle);
        Ok(2)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::BackendRejected { exit_code: Some(2) }),
        "the primary cause survives a cleanup failure"
    );
    assert!(
        report.residue().is_some(),
        "an unremovable staging directory is reported"
    );
    assert_eq!(
        report.residue().map(StagingResidue::stable_id),
        Some("staging_not_removed")
    );
    assert!(
        !root.join("sample.mzML").exists(),
        "nothing was finalized into the destination root"
    );

    // Cleanup removes the backend's output before it removes the ownership
    // marker, so a cleanup that gives up part-way leaves the proof that this
    // area is MSCanvas's. Without that order the residue would be permanently
    // unreclaimable.
    let staging = root.join("sample.mzML.mscanvas-staging");
    assert!(
        staging.join(".mscanvas-staging-owner").is_file(),
        "the ownership marker did not survive the failed cleanup"
    );

    // Once the lock is gone, the residue this run left is reclaimable — it
    // carries that marker — and the conversion runs again.
    drop(held.borrow_mut().take());
    plan.reclaim_staging_area()
        .expect("reclaim the staging area this run created");

    let second = convert_faithfully;
    let runner = FakeRunner::new(&second);
    let report = run_conversion(&plan, &capabilities(), &runner);
    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    assert_eq!(report.residue(), None);
    assert_eq!(entry_names(&root), vec![OsString::from("sample.mzML")]);
}
