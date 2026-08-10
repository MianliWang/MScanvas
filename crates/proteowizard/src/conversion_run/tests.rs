use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use super::{OwnedStagingArea, StagingResidue};
use crate::cancellation::CancellationRequest;
use crate::capability::{CapturedHelpStream, CompleteHelpCapture};
use crate::command::{BackendTool, CommandSpec};
use crate::conversion::{
    CompressionPolicy, IntegrityProperty, SourceObjectFacts, ValidationMode,
    capture_conversion_source, verify_mzml_conversion_retaining_output,
    verify_vendor_conversion_retaining_output,
};
use crate::finalized_output::OutputDrift;

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
        plan.source()
            .mzml_facts()
            .expect("an mzML source carries mzML facts")
            .declared_spectrum_count(),
        Some(2)
    );
    assert_eq!(
        plan.source().byte_length(),
        source_document().len() as u64,
        "the plan records the source it measured"
    );
}

/// A run keeps a redacted account of its streams exactly when it failed.
///
/// The asymmetry is the whole retention rule. A conversion that worked has
/// nothing to diagnose, and keeping what a working backend printed would retain
/// text about the user's acquisition for no purpose at all -- so the successful
/// half of this test is the load-bearing one.
#[test]
fn only_a_failed_run_keeps_an_account_of_what_the_backend_said() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let mut report = run_conversion(&plan, &capabilities(), &runner);
    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    assert!(
        report.take_backend_text().is_none(),
        "a conversion that worked retains nothing of what the backend printed"
    );

    // The same plan against a backend that rejects the input. Now there is
    // something to account for, and it is kept.
    let other = directory.path().join("failing");
    fs::create_dir(&other).expect("create the second destination root");
    let plan = plan_into(open_source(&source), &other, ConflictPolicy::Fail);
    let act = |_spec: &CommandSpec| -> Result<i32, ProcessError> { Ok(1) };
    let runner = FakeRunner::new(&act);
    let mut report = run_conversion(&plan, &capabilities(), &runner);
    assert!(report.finalized().is_none(), "{:?}", report.outcome());
    let text = report
        .take_backend_text()
        .expect("a failed run keeps a redacted account of its streams");
    // Bounded and truthful even where the backend said nothing at all.
    assert_eq!(text.stdout().total_bytes(), 0);
    assert!(!text.stdout().capture_truncated());
    assert!(!text.stdout().excerpt_truncated());
    // Taken once. The caller that retains a diagnostic is the only one, and a
    // second copy on a report the queue keeps would be backend text in a value
    // whose contract is that it holds none.
    assert!(report.take_backend_text().is_none());
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
    let rewritten = Cell::new(true);
    let act = |spec: &CommandSpec| {
        fs::write(staged_destination(spec), output_document()).expect("write staged output");
        // The run holds the acquisition against writers for its whole duration,
        // so on a platform with a mandatory share mode this is refused outright
        // and there is nothing left for the revalidation to catch. Where the
        // platform offers none, the write lands and the revalidation is what
        // refuses the conversion. Both are recorded; neither is assumed.
        rewritten.set(fs::write(&replaced, document(3, Serialization::Source)).is_ok());
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &capabilities(), &runner);

    if rewritten.get() {
        assert_eq!(
            *report.outcome(),
            ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(
                ConversionIntegrityOutcome::SourceChangedDuringConversion
            ))
        );
        assert!(entry_names(&root).is_empty());
    } else {
        // Prevented rather than detected, which is the stronger of the two.
        assert_eq!(report.outcome().stable_id(), "finalized");
        assert_eq!(
            fs::read(&source).expect("read the acquisition"),
            source_document().into_bytes(),
            "the acquisition changed despite the run holding it"
        );
    }
}

/// On Windows the acquisition is held against writers and against renames for
/// the whole run, so the backend cannot be handed bytes or an object that
/// nothing admitted. This is the property the output-only postures depend on:
/// they have no source comparison to fall back on.
#[cfg(windows)]
#[test]
fn the_acquisition_cannot_be_changed_while_a_run_holds_it() {
    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");

    let attempts = RefCell::new(Vec::new());
    let act = |spec: &CommandSpec| {
        fs::write(staged_destination(spec), output_document()).expect("write the staged output");
        let mut attempts = attempts.borrow_mut();
        // Rewritten in place: the bytes the digest covers.
        attempts.push((
            "rewrite",
            fs::write(&source, thermo_bytes(b"rewritten-body!!")).is_ok(),
        ));
        // Renamed away: the name the backend resolves.
        attempts.push((
            "rename",
            fs::rename(&source, directory.path().join("moved.raw")).is_ok(),
        ));
        // Removed outright.
        attempts.push(("remove", fs::remove_file(&source).is_ok()));
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);

    for (what, succeeded) in attempts.into_inner() {
        assert!(!succeeded, "a held acquisition could still be {what}d");
    }
    assert_eq!(report.outcome().stable_id(), "finalized");
    assert_eq!(
        fs::read(&source).expect("read the acquisition"),
        thermo_bytes(b"acquisition-body"),
        "the acquisition changed under the run"
    );

    // And the hold is released once the run is over.
    fs::write(&source, thermo_bytes(b"afterwards-------")).expect("the hold outlived the run");
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

/// A name with a space and non-ASCII characters must survive planning, staging
/// and the wide-string rename, end to end rather than only as far as a plan.
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

/// A plan admits one acquisition, measured. The command builder reads the
/// source's identity from its path again, so the run has to bind to what the
/// plan accepted rather than to whatever now holds that name.
#[test]
fn a_source_that_changed_before_the_run_is_never_converted() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);

    // Rewritten in place: same name, same identity, different bytes.
    fs::write(&source, document(3, Serialization::Source)).expect("rewrite the source");
    let report = run_conversion(&plan, &capabilities(), &runner);
    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::SourceChangedBeforeRun)
    );
    assert_eq!(runner.calls(), 0, "the backend never ran");
    assert!(entry_names(&root).is_empty(), "no staging area was created");

    // Replaced by a different object at the same name.
    fs::remove_file(&source).expect("remove the source");
    fs::write(&source, source_document()).expect("write a replacement");
    let report = run_conversion(&plan, &capabilities(), &runner);
    assert!(
        matches!(
            report.outcome(),
            ConversionRunOutcome::Failed(
                ConversionRunFailure::SourceChangedBeforeRun
                    | ConversionRunFailure::SourceNotRechecked { .. }
            )
        ),
        "{:?}",
        report.outcome()
    );
    assert_eq!(runner.calls(), 0);

    // Gone entirely.
    fs::remove_file(&source).expect("remove the replacement");
    let report = run_conversion(&plan, &capabilities(), &runner);
    assert!(
        matches!(
            report.outcome(),
            ConversionRunOutcome::Failed(ConversionRunFailure::SourceNotRechecked {
                kind: io::ErrorKind::NotFound
            })
        ),
        "{:?}",
        report.outcome()
    );
    assert_eq!(runner.calls(), 0);
    assert!(entry_names(&root).is_empty());
}

/// The staging directory is new, but it sits in a root another process may write
/// to, so the marker has to be created exclusively rather than written over
/// whatever is at its name — a plain write would follow a link and truncate the
/// target, and nothing here could put that back.
#[test]
fn the_ownership_marker_is_created_exclusively() {
    let directory = TestDirectory::new();
    let marker = directory.path().join("marker");

    let mut created = create_owner_marker(&marker).expect("create the marker");
    write_owner_magic(&mut created).expect("write the marker");
    drop(created);
    assert_eq!(
        fs::read(&marker).expect("read the marker"),
        STAGING_OWNER_MAGIC
    );

    let refused = create_owner_marker(&marker).expect_err("an existing entry is refused");
    assert_eq!(refused.kind(), io::ErrorKind::AlreadyExists);
    assert_eq!(
        fs::read(&marker).expect("read the marker"),
        STAGING_OWNER_MAGIC,
        "the refused creation truncated nothing"
    );

    // The same refusal protects an entry that is not the marker at all.
    let occupied = directory.path().join("occupied");
    fs::write(&occupied, b"something the user already had").expect("write occupied");
    let refused = create_owner_marker(&occupied).expect_err("an existing entry is refused");
    assert_eq!(refused.kind(), io::ErrorKind::AlreadyExists);
    assert_eq!(
        fs::read(&occupied).expect("read occupied"),
        b"something the user already had"
    );
}

/// A plan admits a destination root as an object too. A plan can outlive the
/// directory the caller chose, so nothing may be created under whatever now
/// answers to its name.
#[test]
fn a_destination_root_that_changed_before_the_run_is_never_written_to() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);

    // The chosen directory is replaced by a different one at the same name.
    fs::remove_dir(&root).expect("remove the chosen root");
    fs::create_dir(&root).expect("create a different directory at that name");
    let sentinel = root.join("someone-elses.txt");
    fs::write(&sentinel, b"a directory the plan never accepted").expect("write sentinel");

    let report = run_conversion(&plan, &capabilities(), &runner);
    assert!(
        matches!(
            report.outcome(),
            ConversionRunOutcome::Failed(
                ConversionRunFailure::DestinationRootChanged
                    | ConversionRunFailure::DestinationRootNotRechecked { .. }
            )
        ),
        "{:?}",
        report.outcome()
    );
    assert_eq!(runner.calls(), 0, "the backend never ran");
    assert_eq!(
        entry_names(&root),
        vec![OsString::from("someone-elses.txt")],
        "nothing was created under a root the plan never accepted"
    );

    // And a staging area under such a root is not this plan's to reclaim.
    assert_eq!(
        plan.reclaim_staging_area(),
        Err(StagingReclaimError::NotOwned)
    );

    // Gone entirely. The root is held before it is judged, so a root that is no
    // longer there fails at the hold rather than at the recheck.
    fs::remove_file(&sentinel).expect("remove sentinel");
    fs::remove_dir(&root).expect("remove the replacement root");
    let report = run_conversion(&plan, &capabilities(), &runner);
    assert!(
        matches!(
            report.outcome(),
            ConversionRunOutcome::Failed(ConversionRunFailure::DestinationRootNotOpened {
                kind: io::ErrorKind::NotFound
            })
        ),
        "{:?}",
        report.outcome()
    );
    assert_eq!(runner.calls(), 0);
}

/// The staging name is the output name plus a suffix, so a name the plan would
/// otherwise accept can still be one it cannot stage. That is decided when the
/// plan is formed, not by the operating system once a run is under way.
#[test]
fn an_output_name_that_leaves_no_room_for_a_staging_name_is_refused_when_planned() {
    let directory = TestDirectory::new();
    // Canonical on Windows is a verbatim path, so a long component here is not
    // also a test of the legacy path limit.
    let base = fs::canonicalize(directory.path()).expect("canonical test directory");
    let root = base.join("out");
    fs::create_dir(&root).expect("create destination root");

    // ".mzML" is five units, and the staging suffix is seventeen more.
    let longest_stageable = 255 - 17 - 5;
    for (stem_length, expected) in [(longest_stageable, true), (longest_stageable + 1, false)] {
        let name = format!("{}.mzML", "n".repeat(stem_length));
        let source = base.join(&name);
        fs::write(&source, source_document()).expect("write a long-named source");
        let planned = ConversionPlan::to_mzml(open_source(&source), &root, ConflictPolicy::Fail);
        assert_eq!(
            planned.is_ok(),
            expected,
            "a {stem_length}-unit stem planned as {planned:?}"
        );
        if !expected {
            assert_eq!(
                planned.err(),
                Some(ConversionPlanError::OutputFileNameTooLongToStage)
            );
        }
        fs::remove_file(&source).expect("remove the long-named source");
    }
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
        ConversionRunFailure::SourceChangedBeforeRun,
        ConversionRunFailure::SourceNotRechecked {
            kind: io::ErrorKind::NotFound,
        },
        ConversionRunFailure::SourceNotRehashed,
        ConversionRunFailure::DestinationRootChanged,
        ConversionRunFailure::DestinationRootNotRechecked {
            kind: io::ErrorKind::NotFound,
        },
        ConversionRunFailure::DestinationRootNotOpened {
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
        ConversionPlanError::OutputFileNameTooLongToStage,
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

// --- Handle-bound finalization ---
//
// The claim under test is that the object which receives the final name is the
// object the integrity scanner read. Every test here works the seam
// `run_admitted` opens between those two moments.

/// Binds a second name to whatever object currently answers to `path`, so a
/// test can say "the same file" rather than "a file with the same bytes".
///
/// Writing through the witness afterwards shows up in every other name for that
/// object and in no other object, which is what makes it an identity check
/// rather than a content check.
fn witness_object(path: &Path, witness: &Path) {
    fs::hard_link(path, witness).expect("bind a witness name to the object");
}

/// The staged output of a plan, which only a test may name.
fn staged_output_of(plan: &ConversionPlan) -> PathBuf {
    let mut staging = OsString::from(plan.output_file_name());
    staging.push(STAGING_SUFFIX);
    plan.destination_root()
        .join(staging)
        .join(STAGING_OUTPUT_DIRECTORY)
        .join(plan.output_file_name())
}

struct Fixture {
    _directory: TestDirectory,
    root: PathBuf,
    plan: ConversionPlan,
}

fn fixture(source_name: &str, conflict: ConflictPolicy) -> Fixture {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), source_name);
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = plan_into(open_source(&source), &root, conflict);
    let root = plan.destination_root().to_path_buf();
    Fixture {
        _directory: directory,
        root,
        plan,
    }
}

#[test]
fn the_object_that_receives_the_final_name_is_the_object_that_was_validated() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let staged = staged_output_of(&fixture.plan);
    let witness = fixture.root.parent().expect("a parent").join("witness");

    let report = run_admitted_seamed(&fixture.plan, &capabilities(), &runner, || {
        // Bound after the judgement and before the final name is taken, so the
        // witness names exactly the object that was judged.
        witness_object(&staged, &witness);
    });

    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    let finalized = fixture.root.join("sample.mzML");
    let valid = report.finalized().expect("a finalized conversion");
    assert_eq!(
        valid.output().byte_length(),
        fs::metadata(&finalized)
            .expect("read the finalized output")
            .len(),
        "the reported facts do not describe the finalized object"
    );
    assert_eq!(
        fs::read_to_string(&finalized).expect("read the finalized output"),
        output_document()
    );
    // Nothing of the run's own reading is still holding the staging area open.
    assert_eq!(report.residue(), None);
    assert_eq!(
        entry_names(&fixture.root),
        vec![OsString::from("sample.mzML")]
    );

    // The witness and the finalized name are the same object: a write through
    // one is a write to the other.
    fs::write(&witness, b"the same object").expect("write through the witness");
    assert_eq!(
        fs::read(&finalized).expect("read the finalized output"),
        b"the same object",
        "the finalized name denotes a different object from the validated one"
    );
}

/// The load-bearing regression test, in its strongest form. Between the
/// judgement and the rename, the validated object is moved aside and a
/// different, perfectly valid-looking mzML document is put at the staged name.
/// A path-based move would carry that document to the final name under a report
/// describing the other one.
#[cfg(windows)]
#[test]
fn a_staging_path_replaced_after_validation_never_reaches_the_final_name() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let staged = staged_output_of(&fixture.plan);
    let outside = fixture.root.parent().expect("a parent").to_path_buf();
    let witness = outside.join("witness");
    let decoy = document(2, Serialization::Output).replace("R1", "DECOY");

    let report = run_admitted_seamed(&fixture.plan, &capabilities(), &runner, || {
        witness_object(&staged, &witness);
        // The validated object keeps living, under a name this run never knew,
        // and something else answers to the name it was staged under.
        fs::rename(&staged, outside.join("moved-aside")).expect("move the validated object aside");
        fs::write(&staged, &decoy).expect("write a different document at that name");
    });

    let finalized = fixture.root.join("sample.mzML");
    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    let finalized_bytes = fs::read_to_string(&finalized).expect("read the finalized output");
    assert_eq!(
        finalized_bytes,
        output_document(),
        "the finalized bytes are not the bytes that were judged"
    );
    assert!(
        !finalized_bytes.contains("DECOY"),
        "the replacement became a successful conversion"
    );
    // And it is the same object, not merely the same bytes.
    fs::write(&witness, b"the validated object").expect("write through the witness");
    assert_eq!(
        fs::read(&finalized).expect("read the finalized output"),
        b"the validated object",
        "the replacement, not the validated object, received the final name"
    );
    // The replacement stayed in the staging area and was discarded with it.
    assert_eq!(
        entry_names(&fixture.root),
        vec![OsString::from("sample.mzML")]
    );
}

/// The same attack, mounted by unlinking the staged name instead of moving the
/// object. Windows leaves the validated object delete-pending, so it can no
/// longer be renamed — which is the other acceptable outcome: the finalization
/// fails and the replacement never becomes a successful conversion.
#[cfg(windows)]
#[test]
fn a_staging_path_unlinked_after_validation_never_finalizes_the_replacement() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let staged = staged_output_of(&fixture.plan);
    let decoy = document(2, Serialization::Output).replace("R1", "DECOY");

    let report = run_admitted_seamed(&fixture.plan, &capabilities(), &runner, || {
        fs::remove_file(&staged).expect("unlink the validated object's name");
        fs::write(&staged, &decoy).expect("write a different document at that name");
    });

    assert!(
        matches!(
            report.outcome(),
            ConversionRunOutcome::Failed(ConversionRunFailure::NotFinalized { .. })
        ),
        "{:?}",
        report.outcome()
    );
    assert!(
        report.finalized().is_none(),
        "an unfinalized run reported a result"
    );
    assert!(
        entry_names(&fixture.root).is_empty(),
        "something reached the destination root: {:?}",
        entry_names(&fixture.root)
    );
}

/// The same interval, with the destination taken rather than the source
/// replaced. The validated object must not displace what arrived, whatever kind
/// of entry it is.
#[test]
fn a_destination_taken_after_validation_is_never_replaced() {
    for occupant in ["file", "directory", "hard-link"] {
        let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
        let act = convert_faithfully;
        let runner = FakeRunner::new(&act);
        let finalized = fixture.root.join("sample.mzML");
        let neighbour = fixture.root.join("neighbour.txt");
        fs::write(&neighbour, b"an unrelated file").expect("write neighbour");

        let report =
            run_admitted_seamed(&fixture.plan, &capabilities(), &runner, || match occupant {
                "directory" => fs::create_dir(&finalized).expect("take the name with a directory"),
                "hard-link" => {
                    fs::hard_link(&neighbour, &finalized).expect("take the name with a hard link");
                }
                _ => {
                    fs::write(&finalized, b"something else took this name").expect("take the name")
                }
            });

        assert_eq!(
            *report.outcome(),
            ConversionRunOutcome::Failed(ConversionRunFailure::DestinationAppearedDuringRun),
            "occupant: {occupant}"
        );
        match occupant {
            "directory" => assert!(finalized.is_dir(), "the directory was replaced"),
            "hard-link" => assert_eq!(
                fs::read(&finalized).expect("read the link"),
                b"an unrelated file",
                "the linked file was replaced"
            ),
            _ => assert_eq!(
                fs::read(&finalized).expect("read the occupant"),
                b"something else took this name"
            ),
        }
        // Nothing was finalized, and the staging area is gone either way.
        assert_eq!(
            entry_names(&fixture.root),
            vec![
                OsString::from("neighbour.txt"),
                OsString::from("sample.mzML")
            ],
            "occupant: {occupant}"
        );
        assert_eq!(report.residue(), None, "occupant: {occupant}");
    }
}

/// The destination root is held for the run, so the path the final name is
/// formed from cannot be made to denote a different directory while the run is
/// in flight.
#[cfg(windows)]
#[test]
fn the_admitted_destination_root_cannot_be_moved_out_from_under_a_run() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let elsewhere = fixture.root.with_extension("moved");
    let refusal = Cell::new(None);

    let report = run_admitted_seamed(&fixture.plan, &capabilities(), &runner, || {
        refusal.set(Some(
            fs::rename(&fixture.root, &elsewhere)
                .err()
                .and_then(|error| error.raw_os_error()),
        ));
    });

    // Exactly ERROR_SHARING_VIOLATION, not merely "some error". Without the pin
    // the validated output handle inside the subtree already refuses the rename,
    // but with ERROR_ACCESS_DENIED — so only the exact code distinguishes the
    // pin from that pre-existing effect.
    assert_eq!(
        refusal.get().expect("the hook ran"),
        Some(32),
        "the admitted destination root was not pinned against replacement"
    );
    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    assert_eq!(
        entry_names(&fixture.root),
        vec![OsString::from("sample.mzML")]
    );
    assert!(!elsewhere.exists());
}

/// A finalization that fails leaves no successful result and no residue, and
/// releases the validated object so cleanup can proceed.
#[test]
fn a_failed_finalization_produces_no_result_and_leaves_no_staging_behind() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let finalized = fixture.root.join("sample.mzML");
    let staged = staged_output_of(&fixture.plan);

    let report = run_admitted_seamed(&fixture.plan, &capabilities(), &runner, || {
        fs::write(&finalized, b"taken").expect("take the destination");
    });

    assert!(report.finalized().is_none());
    assert_eq!(
        report.residue(),
        None,
        "the staging area was not cleaned up"
    );
    assert_eq!(
        entry_names(&fixture.root),
        vec![OsString::from("sample.mzML")]
    );
    assert_eq!(fs::read(&finalized).expect("read the occupant"), b"taken");
    // The validated reading is released whether or not it was finalized, so the
    // staging directory it lived in could be removed.
    assert!(!staged.exists());
}

#[test]
fn a_validated_output_describes_itself_without_a_path_or_a_handle() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let staging = directory.path().join("staged");
    fs::create_dir(&staging).expect("create the staging directory");
    fs::write(staging.join("sample.mzML"), output_document()).expect("write the output");

    let facts = capture_conversion_source(&source, MzmlScanLimits::default())
        .expect("capture source facts");
    let validated = match verify_mzml_conversion_retaining_output(
        &facts,
        &staging,
        OsStr::new("sample.mzML"),
        ConversionPolicy::default(),
        MzmlScanLimits::default(),
    ) {
        VerifiedConversion::Valid(validated) => validated,
        VerifiedConversion::Rejected(outcome) => panic!("expected a valid conversion: {outcome:?}"),
    };

    let rendered = format!("{validated:?}");
    assert!(
        !rendered.contains('/') && !rendered.contains('\\'),
        "a validated output must not render a path: {rendered}"
    );
    assert!(
        !rendered.contains("sample.mzML") && !rendered.contains("mscanvas-conversion-run-tests"),
        "a validated output must not render a name: {rendered}"
    );
    assert!(rendered.contains("<opaque-validated-output>"), "{rendered}");
    assert!(
        !rendered.contains("handle") && !rendered.contains("0x"),
        "a validated output must not render a handle: {rendered}"
    );
    assert!(
        validated
            .valid()
            .verified()
            .contains(&IntegrityProperty::SpectrumCount)
    );

    // The held object is released when the validated reading is dropped, which
    // is what lets the directory it lives in be removed.
    drop(validated);
    fs::remove_dir_all(&staging).expect("the validated reading still held the output open");
}

/// The pin is taken before the root is judged, so a root that cannot be held is
/// refused before anything is inspected, created or launched.
#[cfg(windows)]
#[test]
fn a_destination_root_that_cannot_be_held_is_refused_before_anything_runs() {
    use std::os::windows::fs::OpenOptionsExt;

    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);

    // Held by someone else sharing nothing, so this run cannot hold it.
    let exclusive = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .custom_flags(0x0200_0000)
        .open(&fixture.root)
        .expect("hold the destination root exclusively");

    let report = run_conversion(&fixture.plan, &capabilities(), &runner);

    assert!(
        matches!(
            report.outcome(),
            ConversionRunOutcome::Failed(ConversionRunFailure::DestinationRootNotOpened { .. })
        ),
        "{:?}",
        report.outcome()
    );
    assert_eq!(runner.calls(), 0, "the backend never ran");
    drop(exclusive);
    assert!(
        entry_names(&fixture.root).is_empty(),
        "a run that could not hold the root still created something"
    );
}

/// The rename target and the object are separate bindings, and only the object
/// end is handle-bound. Everything the finalization reads about the target has
/// to come from the admitted root.
#[test]
fn a_unicode_name_with_a_space_survives_the_object_bound_rename() {
    let fixture = fixture("样本 01.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let witness = fixture
        .root
        .parent()
        .expect("a parent")
        .join("見証 witness");

    let report = run_admitted_seamed(&fixture.plan, &capabilities(), &runner, || {
        witness_object(&staged_output_of(&fixture.plan), &witness);
    });

    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    let finalized = fixture.root.join("样本 01.mzML");
    assert_eq!(
        fs::read_to_string(&finalized).expect("read the finalized output"),
        output_document()
    );
    fs::write(&witness, b"the same object").expect("write through the witness");
    assert_eq!(
        fs::read(&finalized).expect("read the finalized output"),
        b"the same object",
        "the wide-string rename finalized a different object"
    );
}

/// Binding the rename to the object settles which object is finalized, not what
/// is in it. The judgement is only worth anything if the bytes cannot change
/// underneath it, so the retained object refuses a concurrent writer for as long
/// as the run holds it.
#[cfg(windows)]
#[test]
fn a_validated_object_cannot_be_written_to_while_it_is_held() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let staged = staged_output_of(&fixture.plan);
    let refusal = Cell::new(None);

    let report = run_admitted_seamed(&fixture.plan, &capabilities(), &runner, || {
        refusal.set(Some(
            fs::OpenOptions::new()
                .write(true)
                .open(&staged)
                .err()
                .and_then(|error| error.raw_os_error()),
        ));
        // Reading it is still allowed: a reader cannot invalidate a judgement.
        assert!(fs::read(&staged).is_ok(), "a concurrent reader was refused");
    });

    assert_eq!(
        refusal.get().expect("the hook ran"),
        Some(32),
        "the validated object accepted a writer between judgement and finalization"
    );
    assert!(report.finalized().is_some(), "{:?}", report.outcome());
    assert_eq!(
        fs::read_to_string(fixture.root.join("sample.mzML")).expect("read the finalized output"),
        output_document()
    );
}

// --- Identity-bound staging cleanup ---
//
// The claim under test is that nothing is deleted because a name once passed a
// check. Every test here works the seam `discard_seamed` opens between the
// moment a directory is listed and the moment anything that listing named is
// opened or removed.

/// A staging area created the way a run creates one, with a tree written into
/// its output directory.
fn staging_with_tree(directory: &TestDirectory) -> (OwnedStagingArea, PathBuf) {
    let root = directory.path().join("staging");
    let area = OwnedStagingArea::create(root.clone()).expect("create the staging area");
    let output = area.output_directory();
    fs::write(output.join("result.mzML"), output_document()).expect("write the output");
    fs::create_dir(output.join("nested")).expect("create a nested directory");
    fs::write(output.join("nested").join("sidecar.txt"), b"sidecar").expect("write a sidecar");
    fs::create_dir(output.join("nested").join("deeper")).expect("create a deeper directory");
    fs::write(
        output.join("nested").join("deeper").join("leaf.bin"),
        b"leaf",
    )
    .expect("write a leaf");
    (area, root)
}

#[test]
fn an_arbitrary_backend_tree_is_removed_and_the_area_with_it() {
    let directory = TestDirectory::new();
    let (area, root) = staging_with_tree(&directory);

    assert_eq!(area.discard(), None);
    assert!(!root.exists(), "the staging area outlived its own teardown");
    assert_eq!(
        entry_names(directory.path()),
        Vec::<OsString>::new(),
        "teardown touched something outside the staging area"
    );
}

/// Deletion is post-order: a directory only goes once everything in it has, and
/// the marker only after the output tree, so an interrupted teardown always
/// leaves the proof that makes its residue reclaimable.
#[cfg(windows)]
#[test]
fn teardown_is_post_order_and_the_marker_goes_last() {
    let directory = TestDirectory::new();
    let (area, root) = staging_with_tree(&directory);
    let marker = root.join(".mscanvas-staging-owner");
    let output = root.join("output");
    let deepest = output.join("nested").join("deeper");
    let observed = RefCell::new(Vec::new());

    // The seam fires after each directory is listed, which is once per level on
    // the way down. Recording what still exists at each firing shows the order
    // the levels are emptied in.
    let residue = area.discard_seamed(&mut || {
        observed.borrow_mut().push((
            marker.exists(),
            deepest.join("leaf.bin").exists(),
            output.join("result.mzML").exists(),
        ));
    });

    // The outcome is itself the post-order proof: a directory with any child
    // refuses deletion, so a teardown that reached a parent before its children
    // could not have finished at all.
    assert_eq!(residue, None);
    assert!(!root.exists());

    // And nothing was removed before the descent finished, which is what makes
    // the order post- rather than merely depth-first.
    let observed = observed.into_inner();
    assert!(
        observed.len() >= 3,
        "the descent did not reach every level: {observed:?}"
    );
    assert!(
        observed.iter().all(|level| *level == (true, true, true)),
        "something was deleted before the deepest level was listed: {observed:?}"
    );
}

#[test]
fn a_backend_failure_still_leaves_the_destination_root_clean() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = |spec: &CommandSpec| {
        let staged = staged_destination(spec);
        let staging = staged.parent().expect("the staged output has a parent");
        fs::write(&staged, b"<partial").expect("write a partial output");
        fs::create_dir(staging.join("scratch")).expect("write a sidecar directory");
        fs::write(staging.join("scratch").join("tmp.bin"), b"tmp").expect("write a sidecar");
        Ok(3)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&fixture.plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::BackendRejected { exit_code: Some(3) })
    );
    assert_eq!(
        report.residue(),
        None,
        "an arbitrary sidecar tree defeated cleanup"
    );
    assert!(entry_names(&fixture.root).is_empty());
}

/// The load-bearing regression test for the root. Between admission and
/// deletion the staging root is attacked: renamed away, and replaced at its
/// name by a different directory carrying a plausible marker and unrelated
/// data. A path-recursive cleanup would delete the replacement.
#[cfg(windows)]
#[test]
fn a_staging_root_replaced_after_admission_is_never_the_thing_deleted() {
    let directory = TestDirectory::new();
    let (area, root) = staging_with_tree(&directory);
    let decoy = directory.path().join("decoy");
    let refusal = Cell::new(None);
    let firing = Cell::new(0_u32);

    let residue = area.discard_seamed(&mut || {
        if firing.replace(firing.get() + 1) != 0 {
            return;
        }
        // The admitted root is held without delete sharing, so it cannot be
        // renamed out from under the teardown at all.
        refusal.set(Some(
            fs::rename(&root, directory.path().join("moved"))
                .err()
                .and_then(|error| error.raw_os_error()),
        ));
        // A plausible impostor beside it must be untouched either way.
        fs::create_dir(&decoy).expect("create the decoy");
        fs::write(
            decoy.join(".mscanvas-staging-owner"),
            b"mscanvas-conversion-staging-area\n",
        )
        .expect("write a plausible marker");
        fs::write(decoy.join("precious.txt"), b"not yours").expect("write unrelated data");
    });

    assert_eq!(
        refusal.get().expect("the seam ran"),
        Some(32),
        "the admitted staging root was not pinned against replacement"
    );
    assert_eq!(residue, None);
    assert!(!root.exists(), "the admitted object was not removed");
    assert_eq!(
        fs::read(decoy.join("precious.txt")).expect("read the decoy"),
        b"not yours",
        "an unrelated directory was deleted"
    );
}

/// The same for a child. Between the listing and the open, the entry a name
/// referred to is replaced. Identity is what refuses it; the name is not
/// evidence.
#[cfg(windows)]
#[test]
fn a_child_replaced_after_enumeration_is_refused_and_the_replacement_survives() {
    for replacement in ["file", "directory", "hard-link"] {
        let directory = TestDirectory::new();
        let root = directory.path().join("staging");
        let area = OwnedStagingArea::create(root.clone()).expect("create the staging area");
        let output = area.output_directory();
        fs::write(output.join("result.mzML"), output_document()).expect("write the output");

        let outside = directory.path().join("outside.txt");
        fs::write(&outside, b"outside data").expect("write an outside object");
        let target = output.join("result.mzML");
        // The seam fires once per directory listed: first for the staging root,
        // then for the output directory. The second firing is the moment this
        // test is about, because that is when `result.mzML` has been listed and
        // has not yet been opened.
        let firing = Cell::new(0_u32);

        let residue = area.discard_seamed(&mut || {
            if firing.replace(firing.get() + 1) != 1 {
                return;
            }
            fs::remove_file(&target).expect("unlink the listed child");
            match replacement {
                "directory" => fs::create_dir(&target).expect("replace with a directory"),
                "hard-link" => {
                    fs::hard_link(&outside, &target).expect("replace with a link to outside");
                }
                _ => fs::write(&target, b"a different file").expect("replace with a file"),
            }
        });

        assert_eq!(
            residue,
            Some(StagingResidue::IdentityChanged),
            "replacement: {replacement}"
        );
        assert_eq!(
            fs::read(&outside).expect("read the outside object"),
            b"outside data",
            "an object outside the staging area was touched: {replacement}"
        );
        assert!(
            root.exists(),
            "a refused teardown removed the tree anyway: {replacement}"
        );
        assert!(
            root.join(".mscanvas-staging-owner").is_file(),
            "a refused teardown took the ownership proof with it: {replacement}"
        );
        let _ = fs::remove_dir_all(&root);
    }
}

/// A junction planted in the owned tree is refused, never followed and never
/// removed, and what it points at is untouched.
#[cfg(windows)]
#[test]
fn a_reparse_entry_inside_the_owned_tree_is_refused_and_never_followed() {
    let directory = TestDirectory::new();
    let root = directory.path().join("staging");
    let area = OwnedStagingArea::create(root.clone()).expect("create the staging area");
    let output = area.output_directory();
    fs::write(output.join("result.mzML"), output_document()).expect("write the output");

    let outside = directory.path().join("outside");
    fs::create_dir(&outside).expect("create the outside directory");
    fs::write(outside.join("precious.txt"), b"not yours").expect("write outside data");
    if !make_junction(&output.join("link"), &outside) {
        // Junction creation is the one thing here that can be unavailable; the
        // test says so rather than passing quietly.
        eprintln!("skipped: this environment cannot create a junction");
        let _ = area.discard();
        return;
    }

    let residue = area.discard();

    assert_eq!(residue, Some(StagingResidue::ReparsePointEncountered));
    assert_eq!(
        fs::read(outside.join("precious.txt")).expect("read outside the tree"),
        b"not yours",
        "the junction was followed"
    );
    assert!(root.exists(), "a refused teardown removed the tree anyway");
}

/// Only the marker object this boundary wrote makes a staging area reclaimable.
#[cfg(windows)]
#[test]
fn reclamation_trusts_only_the_admitted_marker_object() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let staging = fixture.root.join("sample.mzML.mscanvas-staging");
    let marker = staging.join(".mscanvas-staging-owner");

    // No marker at all.
    fs::create_dir(&staging).expect("create the staging name");
    fs::write(staging.join("held.txt"), b"someone else").expect("write foreign content");
    assert_eq!(
        fixture.plan.reclaim_staging_area(),
        Err(StagingReclaimError::NotOwned)
    );

    // A marker with the wrong content.
    fs::write(&marker, b"not the marker").expect("write a wrong marker");
    assert_eq!(
        fixture.plan.reclaim_staging_area(),
        Err(StagingReclaimError::NotOwned)
    );

    // A marker that is a directory rather than the file this boundary writes.
    fs::remove_file(&marker).expect("remove the wrong marker");
    fs::create_dir(&marker).expect("create a marker directory");
    assert_eq!(
        fixture.plan.reclaim_staging_area(),
        Err(StagingReclaimError::NotOwned)
    );
    fs::remove_dir(&marker).expect("remove the marker directory");

    // A marker that is a link is never read through.
    if make_junction(&marker, &staging) {
        assert_eq!(
            fixture.plan.reclaim_staging_area(),
            Err(StagingReclaimError::NotOwned)
        );
        remove_junction(&marker);
    }

    assert!(
        fs::read(staging.join("held.txt")).expect("read the foreign content") == b"someone else",
        "a refused reclamation removed something"
    );
    let _ = fs::remove_dir_all(&staging);
}

/// The staging name is as untrustworthy as every other name here. A link
/// planted where a staging area should be is never opened as one, so no amount
/// of plausible-looking content on the other side of it can be reclaimed
/// through.
#[cfg(windows)]
#[test]
fn a_link_at_the_staging_name_is_never_reclaimed_through() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let staging = fixture.root.join("sample.mzML.mscanvas-staging");
    let outside = fixture
        .root
        .parent()
        .expect("the destination root has a parent")
        .to_path_buf();

    // The tree on the other side of the link is dressed as a staging area this
    // boundary owns — marker, output directory and all — so the link is the
    // only thing standing between reclamation and a recursive delete of it.
    let victim = outside.join("victim");
    fs::create_dir(&victim).expect("create the victim tree");
    fs::write(victim.join(STAGING_OWNER_MARKER), STAGING_OWNER_MAGIC)
        .expect("write a convincing marker");
    fs::create_dir(victim.join("output")).expect("create a convincing output directory");
    fs::write(
        victim.join("output").join("result.mzML"),
        b"someone else's work",
    )
    .expect("write the victim's data");

    if !make_junction(&staging, &victim) {
        return;
    }

    let refused = fixture.plan.reclaim_staging_area();

    assert!(
        matches!(refused, Err(StagingReclaimError::NotOwned)),
        "a link at the staging name was accepted as a staging area: {refused:?}"
    );
    assert!(victim.is_dir(), "reclamation deleted through the link");
    assert_eq!(
        fs::read(victim.join("output").join("result.mzML")).expect("read the victim's data"),
        b"someone else's work"
    );
    assert!(
        victim.join(".mscanvas-staging-owner").is_file(),
        "reclamation reached the victim's marker"
    );

    remove_junction(&staging);
    assert!(!staging.exists(), "the test left the link behind");
}

/// The whole reclamation ladder, in the order a caller meets it.
#[test]
fn reclamation_covers_absent_owned_empty_and_repeated_attempts() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create the destination root");
    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);
    let staging = plan.destination_root().join("sample.mzML.mscanvas-staging");

    // Absent is nothing to reclaim.
    plan.reclaim_staging_area()
        .expect("an absent staging area is not a failure");

    // An owned area with a real tree is reclaimed as objects.
    let area = OwnedStagingArea::create(staging.clone()).expect("create the staging area");
    let output = area.output_directory();
    fs::write(output.join("result.mzML"), output_document()).expect("write the output");
    fs::create_dir(output.join("nested")).expect("create a nested directory");
    fs::write(output.join("nested").join("leaf.bin"), b"leaf").expect("write a leaf");
    // Release the run's handles without tearing down, which is what a process
    // that died mid-run leaves behind.
    area.abandon();
    assert!(staging.is_dir());
    plan.reclaim_staging_area()
        .expect("an owned staging area is reclaimable");
    assert!(!staging.exists());

    // A second attempt has nothing to do and says so.
    plan.reclaim_staging_area()
        .expect("a second reclaim is not a failure");

    // An empty directory is reclaimable: teardown removes the marker before the
    // root, so this is exactly what an interrupted cleanup leaves.
    fs::create_dir(&staging).expect("leave an empty staging directory");
    plan.reclaim_staging_area()
        .expect("an empty staging directory is reclaimable");
    assert!(!staging.exists());
}

/// Cleanup residue never replaces the conversion result, and the evidence a
/// later attempt needs survives.
#[cfg(windows)]
#[test]
fn a_cleanup_that_cannot_finish_keeps_the_outcome_and_stays_reclaimable() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    /// Share reads only, so the staged file cannot be opened for deletion.
    const FILE_SHARE_READ: u32 = 0x0000_0001;

    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let held = RefCell::new(None);
    let act = |spec: &CommandSpec| {
        let staged = staged_destination(spec);
        fs::write(&staged, output_document()).expect("write the staged output");
        *held.borrow_mut() = Some(
            OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .open(&staged)
                .expect("hold the staged output open"),
        );
        Ok(4)
    };
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&fixture.plan, &capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::BackendRejected { exit_code: Some(4) }),
        "cleanup residue replaced the primary outcome"
    );
    assert!(
        report.residue().is_some(),
        "an unremovable tree reported nothing"
    );
    let staging = fixture.root.join("sample.mzML.mscanvas-staging");
    assert!(
        staging.join(".mscanvas-staging-owner").is_file(),
        "the residue lost the proof a later attempt needs"
    );

    // The reason a locked owned tree gives has been `staging_not_removed` since
    // reclamation existed, and callers classify on it.
    let refused = fixture
        .plan
        .reclaim_staging_area()
        .expect_err("a locked tree cannot be reclaimed");
    assert!(matches!(refused, StagingReclaimError::NotRemoved { .. }));
    assert_eq!(refused.stable_id(), "staging_not_removed");
    assert_eq!(refused.detailed_stable_id(), "staging_not_removed");

    // Once the obstruction is gone the same area is reclaimable.
    drop(held.borrow_mut().take());
    fixture
        .plan
        .reclaim_staging_area()
        .expect("the residue is reclaimable once the lock is gone");
    assert!(!staging.exists());
    assert!(entry_names(&fixture.root).is_empty());
}

/// The staging root holds exactly what this boundary put there. Anything else
/// stops the teardown rather than being deleted or deleted around.
#[cfg(windows)]
#[test]
fn a_foreign_entry_in_the_staging_root_stops_teardown_without_deleting_it() {
    let directory = TestDirectory::new();
    let root = directory.path().join("staging");
    let area = OwnedStagingArea::create(root.clone()).expect("create the staging area");
    fs::write(root.join("someone-elses.txt"), b"not yours").expect("write a foreign entry");

    let residue = area.discard();

    assert_eq!(residue, Some(StagingResidue::ForeignEntry));
    assert_eq!(
        fs::read(root.join("someone-elses.txt")).expect("read the foreign entry"),
        b"not yours"
    );
    assert!(root.join(".mscanvas-staging-owner").is_file());
    let _ = fs::remove_dir_all(&root);
}

/// A live run removes what it created and held, and nothing else. An entry
/// under an expected name that this run does not hold arrived some other way,
/// and automatic cleanup is not the place to decide what it was.
#[test]
fn cleanup_after_a_run_removes_only_what_that_run_held() {
    let directory = TestDirectory::new();
    let root = directory.path().join("staging");
    let mut area = OwnedStagingArea::create(root.clone()).expect("create the staging area");
    let output = area.output_directory();
    fs::write(output.join("someone-elses.mzML"), b"not ours").expect("write into the output");

    // The state a run is in when it never managed to create and hold its own
    // output directory, because something else got there first.
    area.release_output();
    let residue = area.discard();

    assert_eq!(residue, Some(StagingResidue::ForeignEntry));
    assert_eq!(
        fs::read(output.join("someone-elses.mzML")).expect("read the unheld output"),
        b"not ours"
    );
    assert!(
        root.join(".mscanvas-staging-owner").is_file(),
        "the refusal spent the proof that makes this reclaimable"
    );
    let _ = fs::remove_dir_all(&root);
}

/// A marker this run created but never managed to fill in is still this run's
/// to remove. Refusing it would leave a staging root that reclamation cannot
/// vouch for either, and the deterministic staging name would be blocked for
/// good by a partial write.
#[cfg(windows)]
#[test]
fn a_marker_created_but_never_filled_in_is_still_the_run_s_to_remove() {
    let directory = TestDirectory::new();
    let root = directory.path().join("staging");
    fs::create_dir(&root).expect("create the staging root");
    let marker_path = root.join(".mscanvas-staging-owner");

    // Exactly what `populate` holds when the write into a freshly created
    // marker fails: the object exists, this run holds it, and it is empty.
    let area = OwnedStagingArea {
        root: Some(open_owned_directory(&root).expect("open the staging root")),
        output: None,
        marker: Some(create_owner_marker(&marker_path).expect("create the marker")),
        path: root.clone(),
        state: StagingState::Active,
    };
    assert_eq!(
        fs::metadata(&marker_path).expect("stat the marker").len(),
        0,
        "the marker under test is supposed to be unwritten"
    );

    assert_eq!(area.discard(), None);
    assert!(
        !root.exists(),
        "a run could not clean up after its own unfinished marker"
    );
}

/// The proof is never spent on a teardown that is about to fail. Something
/// arriving in the staging root while the output tree is going would otherwise
/// leave a directory nothing can show was ever MSCanvas's.
#[cfg(windows)]
#[test]
fn an_entry_arriving_during_teardown_keeps_the_marker_where_it_is() {
    let directory = TestDirectory::new();
    let (area, root) = staging_with_tree(&directory);
    let intruder = root.join("arrived-late.txt");
    let firing = Cell::new(0_usize);

    // The seam fires once per directory listed. Firing 0 is the staging root
    // itself; writing then means the entry appears after that listing and while
    // the output tree below is still being removed.
    let residue = area.discard_seamed(&mut || {
        if firing.replace(firing.get() + 1) == 0 {
            fs::write(&intruder, b"arrived late").expect("write the late entry");
        }
    });

    assert_eq!(residue, Some(StagingResidue::ForeignEntry));
    assert_eq!(
        fs::read(&intruder).expect("read the late entry"),
        b"arrived late"
    );
    assert!(
        root.join(".mscanvas-staging-owner").is_file(),
        "the marker went even though the root could not"
    );
    let _ = fs::remove_file(&intruder);
    let _ = fs::remove_dir_all(&root);
}

/// An unwind performs the same object-bound teardown, never the path-recursive
/// one, because it cannot report what it finds.
#[test]
fn an_unwind_tears_the_staging_area_down_by_object() {
    let directory = TestDirectory::new();
    let root = directory.path().join("staging");
    let outside = directory.path().join("outside.txt");
    fs::write(&outside, b"outside data").expect("write an outside object");

    let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let area = OwnedStagingArea::create(root.clone()).expect("create the staging area");
        fs::write(area.output_directory().join("result.mzML"), b"partial")
            .expect("write an output");
        panic!("something went wrong mid-run");
    }));

    assert!(unwound.is_err(), "the panic must not be swallowed");
    assert!(!root.exists(), "the staging area outlived the unwind");
    assert_eq!(
        fs::read(&outside).expect("read the outside object"),
        b"outside data"
    );
}

#[test]
fn every_staging_residue_and_reclaim_reason_renders_without_a_path() {
    let residues = [
        StagingResidue::NotRemoved {
            kind: io::ErrorKind::PermissionDenied,
        },
        StagingResidue::IdentityChanged,
        StagingResidue::ReparsePointEncountered,
        StagingResidue::ForeignEntry,
        StagingResidue::TraversalLimitReached,
        StagingResidue::NotEnumerable,
    ];
    let identifiers: BTreeSet<&str> = residues
        .iter()
        .copied()
        .map(StagingResidue::stable_id)
        .collect();
    assert_eq!(identifiers.len(), residues.len());

    let reclaims = [
        StagingReclaimError::NotOwned,
        StagingReclaimError::NotInspectable {
            kind: io::ErrorKind::PermissionDenied,
        },
        StagingReclaimError::NotRemoved {
            kind: io::ErrorKind::PermissionDenied,
        },
        StagingReclaimError::NotFullyRemoved(StagingResidue::IdentityChanged),
        StagingReclaimError::NotAdmissible(StagingResidue::NotEnumerable),
    ];
    let reclaim_identifiers: BTreeSet<&str> = reclaims
        .iter()
        .copied()
        .map(StagingReclaimError::stable_id)
        .collect();
    assert_eq!(reclaim_identifiers.len(), reclaims.len());
    assert_eq!(
        StagingReclaimError::NotFullyRemoved(StagingResidue::ReparsePointEncountered)
            .detailed_stable_id(),
        "staging_reparse_point"
    );

    for rendered in residues
        .iter()
        .map(|residue| format!("{residue:?} {residue}"))
        .chain(
            reclaims
                .iter()
                .map(|reclaim| format!("{reclaim:?} {reclaim}")),
        )
    {
        assert!(
            !rendered.contains('/') && !rendered.contains('\\'),
            "a cleanup reason must not render a path: {rendered}"
        );
        assert!(
            !rendered.contains("0x") && !rendered.to_lowercase().contains("handle"),
            "a cleanup reason must not render a handle: {rendered}"
        );
    }

    // The area itself describes its state and nothing about where it is.
    let directory = TestDirectory::new();
    let area = OwnedStagingArea::create(directory.path().join("staging"))
        .expect("create the staging area");
    let rendered = format!("{area:?}");
    assert!(
        !rendered.contains('/') && !rendered.contains('\\') && !rendered.contains("staging"),
        "a staging area must not render its path: {rendered}"
    );
    assert!(rendered.contains("Active"), "{rendered}");
    assert_eq!(area.discard(), None);
}

/// Creates a directory junction, reporting whether the environment allowed it.
///
/// A junction is the reparse entry an unprivileged process can actually make,
/// and there is no standard-library API for one, so this is the documented
/// `FSCTL_SET_REPARSE_POINT` call rather than a shelled-out `mklink`.
#[cfg(windows)]
fn make_junction(link: &Path, target: &Path) -> bool {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;

    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FSCTL_SET_REPARSE_POINT: u32 = 0x0009_00A4;
    const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
    const GENERIC_WRITE: u32 = 0x4000_0000;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "DeviceIoControl"]
        fn device_io_control(
            device: *mut c_void,
            control_code: u32,
            in_buffer: *mut c_void,
            in_size: u32,
            out_buffer: *mut c_void,
            out_size: u32,
            returned: *mut u32,
            overlapped: *mut c_void,
        ) -> i32;
    }

    if fs::create_dir_all(link).is_err() {
        return false;
    }
    let mut substitute: Vec<u16> = OsString::from(format!(
        "\\??\\{}",
        fs::canonicalize(target)
            .expect("canonical junction target")
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
    ))
    .encode_wide()
    .collect();
    substitute.push(0);
    let name_bytes = (substitute.len() - 1) * 2;

    // REPARSE_DATA_BUFFER: tag, data length, reserved, then the mount-point
    // header and the two path buffers.
    let mut buffer = vec![0_u8; 8 + 8 + name_bytes + 2 + 2];
    buffer[0..4].copy_from_slice(&IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
    let data_length = (8 + name_bytes + 2 + 2) as u16;
    buffer[4..6].copy_from_slice(&data_length.to_le_bytes());
    buffer[8..10].copy_from_slice(&0_u16.to_le_bytes());
    buffer[10..12].copy_from_slice(&(name_bytes as u16).to_le_bytes());
    buffer[12..14].copy_from_slice(&((name_bytes + 2) as u16).to_le_bytes());
    buffer[14..16].copy_from_slice(&0_u16.to_le_bytes());
    for (index, unit) in substitute.iter().take(substitute.len() - 1).enumerate() {
        let at = 16 + index * 2;
        buffer[at..at + 2].copy_from_slice(&unit.to_le_bytes());
    }

    let Ok(handle) = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .access_mode(GENERIC_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(link)
    else {
        let _ = fs::remove_dir(link);
        return false;
    };
    let mut returned = 0_u32;
    // SAFETY: the handle is live and the buffer is a correctly sized
    // REPARSE_DATA_BUFFER for a mount point that outlives the call.
    let set = unsafe {
        device_io_control(
            handle.as_raw_handle(),
            FSCTL_SET_REPARSE_POINT,
            buffer.as_mut_ptr().cast(),
            buffer.len() as u32,
            std::ptr::null_mut(),
            0,
            &raw mut returned,
            std::ptr::null_mut(),
        )
    };
    drop(handle);
    if set == 0 {
        let _ = fs::remove_dir(link);
        return false;
    }
    true
}

#[cfg(windows)]
fn remove_junction(link: &Path) {
    let _ = fs::remove_dir(link);
}

// --- The first evidenced vendor source family ---
//
// The claim under test is narrow and worth stating exactly: a Thermo RAW file
// is recognized by what it *is*, converted through the same boundary as every
// other source, and judged on its output alone — and nothing anywhere reports
// that as a fidelity comparison.
//
// None of these tests reach a backend. The real-acquisition evidence is a
// separate, explicitly ignored run recorded in the evidence document.

/// The exact 18 bytes a Thermo RAW file begins with, spelled out here rather
/// than imported so a test cannot pass because the constant it checks against
/// was changed to match a mistake.
const THERMO_HEADER: [u8; 18] = [
    0x01, 0xA1, b'F', 0, b'i', 0, b'n', 0, b'n', 0, b'i', 0, b'g', 0, b'a', 0, b'n', 0,
];

/// The provider build this repository has Thermo RAW evidence for.
const EVIDENCED_RELEASE: &str = "3.0.26013";
const EVIDENCED_REVISION: &str = "47b13cf";

/// A stand-in acquisition: the real family signature followed by filler.
///
/// It is deliberately not vendor data. Everything this boundary decides about a
/// source is decided from the signature, the posture and the object's identity,
/// and all three are real here. What it cannot stand in for is the vendor
/// reader's behaviour, which is why the backend is substituted in these tests
/// and measured for real elsewhere.
fn thermo_bytes(filler: &[u8]) -> Vec<u8> {
    let mut bytes = THERMO_HEADER.to_vec();
    bytes.extend_from_slice(filler);
    bytes
}

fn write_thermo_source(directory: &Path, name: &str) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, thermo_bytes(b"acquisition-body")).expect("write a vendor source");
    path
}

fn open_thermo(path: &Path) -> ConversionSource {
    ConversionSource::open_thermo_raw_file(path, MzmlScanLimits::default())
        .expect("open a Thermo RAW source")
}

/// The digest the vendor evidence is bound to.
fn evidenced_executable_sha256() -> Sha256Digest {
    EVIDENCED_PROVIDER_BUILDS[0]
        .executable_sha256
        .parse()
        .expect("the evidenced executable digest parses")
}

/// Installed help that also declares which build produced it.
fn capabilities_reporting(release: &str, revision: Option<&str>) -> InstalledHelpCapabilities {
    capabilities_reporting_for(release, revision, evidenced_executable_sha256())
}

/// The same, for an installation whose executable is not the evidenced one.
fn capabilities_reporting_for(
    release: &str,
    revision: Option<&str>,
    executable_sha256: Sha256Digest,
) -> InstalledHelpCapabilities {
    let executable = fs::canonicalize(std::env::current_exe().expect("test executable"))
        .expect("canonical test executable");
    let reported = revision.map_or_else(
        || release.to_owned(),
        |revision| format!("{release} ({revision})"),
    );
    let help =
        format!("ProteoWizard release: {reported}\nBuild date: Jan 13 2026\n{MSCONVERT_HELP}");
    InstalledHelpCapabilities::parse_unbound_capture_for_tests(
        BackendTool::MsConvert,
        executable,
        executable_sha256,
        CompleteHelpCapture::new(
            CapturedHelpStream::new(help.as_bytes(), help.len() as u64, false, FIXTURE_SHA256),
            CapturedHelpStream::new(&[], 0, false, EMPTY_SHA256),
        ),
    )
    .expect("parse the msconvert help fixture")
}

/// Capabilities for the exact build the vendor evidence was recorded on.
fn evidenced_capabilities() -> InstalledHelpCapabilities {
    capabilities_reporting(EVIDENCED_RELEASE, Some(EVIDENCED_REVISION))
}

// --- Source admission -------------------------------------------------------

/// Recognition is the file signature. The extension is a filter in front of it,
/// because the installed reader will not open the object without one, and
/// neither half is allowed to stand in for the other.
#[test]
fn a_vendor_source_is_recognized_by_its_signature_and_not_by_its_name() {
    let directory = TestDirectory::new();

    // The evidenced shape: right name, right signature.
    let admitted = write_thermo_source(directory.path(), "acquisition.raw");
    let source = open_thermo(&admitted);
    assert_eq!(source.kind(), ConversionSourceKind::ThermoRawFile);
    assert_eq!(source.byte_length(), 34);
    assert!(source.mzml_facts().is_none(), "a RAW file was read as mzML");
    assert!(!source.kind().supports_source_comparison());

    // The extension alone establishes nothing. This is the whole point: a file
    // that ends in `.raw` and contains something else is refused, so no source
    // is ever created by a suffix.
    let misnamed = directory.path().join("not-really.raw");
    fs::write(&misnamed, b"PK\x03\x04 this is a zip archive").expect("write a decoy");
    assert_eq!(
        ConversionSource::open_thermo_raw_file(&misnamed, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::SignatureMismatch)
    );

    // A file too short to carry the signature cannot be carrying it. That is a
    // mismatch, not an inspection failure.
    let truncated = directory.path().join("truncated.raw");
    fs::write(&truncated, &THERMO_HEADER[..4]).expect("write a truncated decoy");
    assert_eq!(
        ConversionSource::open_thermo_raw_file(&truncated, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::SignatureMismatch)
    );

    // One byte wrong is wrong.
    let mut nearly = THERMO_HEADER;
    nearly[17] = 1;
    let near_miss = directory.path().join("near-miss.raw");
    fs::write(&near_miss, nearly).expect("write a near miss");
    assert_eq!(
        ConversionSource::open_thermo_raw_file(&near_miss, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::SignatureMismatch)
    );

    // And the signature alone is not enough either, because the reader this
    // boundary hands the file to refuses any other extension.
    let unsupported = directory.path().join("acquisition.dat");
    fs::write(&unsupported, thermo_bytes(b"body")).expect("write a misnamed acquisition");
    assert_eq!(
        ConversionSource::open_thermo_raw_file(&unsupported, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::UnsupportedExtension)
    );

    // Windows does not distinguish the case of an extension and neither does
    // this, or a file the backend accepts would be refused for its spelling.
    let shouted = directory.path().join("acquisition.RAW");
    fs::write(&shouted, thermo_bytes(b"body")).expect("write an upper-case acquisition");
    assert_eq!(
        open_thermo(&shouted).kind(),
        ConversionSourceKind::ThermoRawFile
    );

    // An mzML file is not admitted by the vendor posture, and a vendor file is
    // not admitted by the mzML posture. The two recognitions are independent.
    let mzml = write_source(directory.path(), "sample.mzML");
    assert_eq!(
        ConversionSource::open_thermo_raw_file(&mzml, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::UnsupportedExtension)
    );
    assert!(matches!(
        ConversionSource::open_mzml_file(&admitted, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotReadableAsMzml(_))
    ));
}

/// Admission reads the signature and the digest from one handle that withholds
/// write sharing, so both describe the same snapshot. An acquisition somebody
/// else is writing is not a finished acquisition and is not admitted.
#[cfg(windows)]
#[test]
fn an_acquisition_being_written_is_not_admitted() {
    use std::os::windows::fs::OpenOptionsExt;

    /// Share reads only: a writer holding the file this way still permits our
    /// read, which is what makes the refusal below about *write* sharing rather
    /// than about the file being open at all.
    const FILE_SHARE_READ: u32 = 0x0000_0001;

    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");

    let writer = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(FILE_SHARE_READ)
        .open(&source)
        .expect("hold the acquisition open for writing");

    assert!(
        matches!(
            ConversionSource::open_thermo_raw_file(&source, MzmlScanLimits::default()),
            Err(ConversionSourceRejection::NotInspectable { .. })
        ),
        "an acquisition under a writer was admitted"
    );

    // And once the writer is gone it is an ordinary acquisition again.
    drop(writer);
    assert_eq!(
        open_thermo(&source).kind(),
        ConversionSourceKind::ThermoRawFile
    );
}

/// A source is an object. A directory carrying the right name and a link to a
/// real acquisition are both refused before anything is read.
#[test]
fn a_vendor_source_must_be_a_plain_regular_file() {
    let directory = TestDirectory::new();

    let directory_source = directory.path().join("acquisition.raw");
    fs::create_dir(&directory_source).expect("create a directory named like an acquisition");
    assert_eq!(
        ConversionSource::open_thermo_raw_file(&directory_source, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotARegularFile)
    );
    fs::remove_dir(&directory_source).expect("remove the directory");

    let absent = directory.path().join("absent.raw");
    assert!(matches!(
        ConversionSource::open_thermo_raw_file(&absent, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotInspectable { .. })
    ));
}

/// A junction standing where an acquisition should be is refused rather than
/// followed, so nothing outside the chosen object is ever read as one.
#[cfg(windows)]
#[test]
fn a_link_at_a_vendor_source_name_is_refused_and_never_followed() {
    let directory = TestDirectory::new();
    let target = directory.path().join("target");
    fs::create_dir(&target).expect("create the link target");
    fs::write(target.join("real.raw"), thermo_bytes(b"body")).expect("write behind the link");

    let link = directory.path().join("acquisition.raw");
    if !make_junction(&link, &target) {
        return;
    }
    assert_eq!(
        ConversionSource::open_thermo_raw_file(&link, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotARegularFile)
    );
    remove_junction(&link);
}

/// Everything a refusal renders is safe to show. None of it names the file.
#[test]
fn every_vendor_source_rejection_renders_without_a_path() {
    let rejections = [
        ConversionSourceRejection::UnsupportedExtension,
        ConversionSourceRejection::SignatureMismatch,
    ];
    let identifiers: BTreeSet<&str> = rejections
        .iter()
        .copied()
        .map(|rejection| rejection.stable_id())
        .collect();
    assert_eq!(identifiers.len(), rejections.len());
    for rejection in rejections {
        let rendered = format!("{rejection:?} {rejection}");
        assert!(
            !rendered.contains('/') && !rendered.contains('\\'),
            "{rendered}"
        );
    }

    // The source itself is opaque: its debug projection says what kind it is
    // and nothing about where it came from.
    let directory = TestDirectory::new();
    let path = write_thermo_source(directory.path(), "样本 01.raw");
    let rendered = format!("{:?}", open_thermo(&path));
    assert!(rendered.contains("ThermoRawFile"));
    assert!(!rendered.contains('/') && !rendered.contains('\\'));
    assert!(!rendered.contains("样本"));
}

// --- Validation mode --------------------------------------------------------

/// A vendor conversion is judged on its output and says so. Nothing in the
/// result can be read as a statement about what the acquisition contained.
#[test]
fn a_vendor_conversion_is_validated_on_its_output_alone() {
    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");
    assert_eq!(plan.output_file_name(), OsStr::new("acquisition.mzML"));

    let runner = FakeRunner::new(&convert_faithfully);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);

    let ConversionRunOutcome::Finalized(finalized) = report.outcome() else {
        panic!("a faithful vendor conversion was not finalized: {report:?}");
    };
    let valid = finalized.valid();
    assert_eq!(valid.validation_mode(), ValidationMode::OutputOnly);
    assert!(!valid.validation_mode().compares_against_source());

    // What an output-only run can establish, and exactly that.
    let verified: BTreeSet<&str> = valid
        .verified()
        .iter()
        .map(|property| property.stable_id())
        .collect();
    assert_eq!(
        verified,
        BTreeSet::from([
            "source_unchanged",
            "output_declared_counts",
            "output_declared_array_lengths",
            "output_array_payload_presence",
            "output_array_roles",
            "output_array_encoding",
            "output_spectrum_metadata",
            "index_sequences",
            "compression_policy",
        ])
    );
    // Every comparison is recorded as never having been a question, rather than
    // as something this run failed to establish.
    assert!(valid.unverified().is_empty(), "{:?}", valid.unverified());
    assert!(
        valid
            .inapplicable()
            .contains(&IntegrityProperty::SpectrumCount)
    );
    assert!(
        valid
            .inapplicable()
            .contains(&IntegrityProperty::MsLevelDistribution)
    );
    assert!(valid.verified().is_disjoint(valid.inapplicable()));

    // The load-bearing one: an empty `unverified` set must not become a
    // fidelity claim.
    assert!(
        !valid.is_fully_verified(),
        "an output-only conversion claimed full verification"
    );
    assert!(report.residue().is_none());
    assert_eq!(entry_names(&root), vec![OsString::from("acquisition.mzML")]);
}

/// An mzML source keeps the comparison it always had. The vendor posture adds a
/// mode; it does not weaken the one that was there.
#[test]
fn an_mzml_conversion_still_compares_against_its_source() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);

    let runner = FakeRunner::new(&convert_faithfully);
    let report = run_conversion(&plan, &capabilities(), &runner);

    let ConversionRunOutcome::Finalized(finalized) = report.outcome() else {
        panic!("a faithful mzML conversion was not finalized: {report:?}");
    };
    let valid = finalized.valid();
    assert_eq!(valid.validation_mode(), ValidationMode::SourceComparison);
    assert!(valid.validation_mode().compares_against_source());
    assert!(
        valid.inapplicable().is_empty(),
        "a comparison reported an inapplicable property"
    );
    assert!(valid.verified().contains(&IntegrityProperty::SpectrumCount));
}

/// Output-only is not permission to accept anything. Every postcondition the
/// output alone can fail still fails it.
#[test]
fn a_vendor_conversion_rejects_every_output_its_own_contract_forbids() {
    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");

    let attempt = |act: &dyn Fn(&CommandSpec) -> Result<i32, ProcessError>| {
        let root = directory.path().join(format!(
            "out-{}",
            NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("create destination root");
        let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
            .expect("plan a vendor conversion");
        let runner = FakeRunner::new(act);
        let report = run_conversion(&plan, &evidenced_capabilities(), &runner);
        let outcome = match report.outcome() {
            ConversionRunOutcome::Failed(failure) => failure.detailed_stable_id(),
            other => panic!("an unusable output was accepted: {other:?}"),
        };
        assert!(
            entry_names(&root).is_empty(),
            "a rejected conversion left something in the destination root"
        );
        outcome
    };

    // Nothing written at all.
    assert_eq!(attempt(&|_| Ok(0)), "missing_output");

    // An empty file is not a document.
    assert_eq!(
        attempt(&|spec| {
            fs::write(staged_destination(spec), b"").expect("write an empty output");
            Ok(0)
        }),
        "zero_byte_output"
    );

    // Not mzML at all.
    assert_eq!(
        attempt(&|spec| {
            fs::write(staged_destination(spec), b"<html></html>").expect("write a non-document");
            Ok(0)
        }),
        "wrong_root_format"
    );

    // mzML whose own declared count disagrees with what it holds. The output is
    // this boundary's product, so it has to agree with itself.
    assert_eq!(
        attempt(&|spec| {
            let inconsistent = output_document()
                .replace(r#"<spectrumList count="2">"#, r#"<spectrumList count="7">"#);
            fs::write(staged_destination(spec), inconsistent)
                .expect("write an inconsistent output");
            Ok(0)
        }),
        "output_declared_count_inconsistent"
    );

    // Indices that skip are a document disagreeing with itself just as much as
    // a declared count that does. There is no source to blame it on here, which
    // is exactly why the output has to answer for it alone.
    assert_eq!(
        attempt(&|spec| {
            let gapped =
                output_document().replace(r#"<spectrum index="1""#, r#"<spectrum index="5""#);
            fs::write(staged_destination(spec), gapped).expect("write a gapped output");
            Ok(0)
        }),
        "index_sequence_not_consecutive"
    );

    // A well-formed shell that converted nothing. Every structural check below
    // would pass vacuously over it, so the emptiness itself has to be the
    // refusal.
    for shell in [
        r#"<mzML version="1.1.0"></mzML>"#,
        r#"<mzML version="1.1.0"><run id="R1"></run></mzML>"#,
        r#"<mzML version="1.1.0"><run id="R1"><spectrumList count="0"></spectrumList></run></mzML>"#,
    ] {
        assert_eq!(
            attempt(&|spec| {
                fs::write(staged_destination(spec), shell).expect("write an empty shell");
                Ok(0)
            }),
            "output_contains_no_records",
            "an empty shell was accepted as a conversion result"
        );
    }

    // Metadata describing peaks the document does not carry. With no source to
    // find the missing payloads against, the contradiction between a declared
    // length and an absent payload is the whole of what is available — and it
    // is enough.
    assert_eq!(
        attempt(&|spec| {
            let hollow = output_document().replace("<binary>AA==</binary>", "<binary></binary>");
            fs::write(staged_destination(spec), hollow).expect("write a hollow output");
            Ok(0)
        }),
        "output_declared_array_without_payload"
    );

    // The quieter half of the same rule: a record declaring points while
    // carrying no binary arrays at all. Nothing else here would notice, because
    // there is no payload to find empty and no array to find uncompressed.
    assert_eq!(
        attempt(&|spec| {
            let arrayless = output_document()
                .replace(r#"<binaryDataArrayList count="2">"#, "")
                .replace("</binaryDataArrayList>", "")
                .replace(
                    r#"<binaryDataArray encodedLength="8"><cvParam accession="MS:1000514"/><cvParam accession="MS:1000574"/><cvParam accession="MS:1000521"/><binary>AA==</binary></binaryDataArray>"#,
                    "",
                )
                .replace(
                    r#"<binaryDataArray encodedLength="8"><cvParam accession="MS:1000515"/><cvParam accession="MS:1000574"/><cvParam accession="MS:1000521"/><binary>AA==</binary></binaryDataArray>"#,
                    "",
                );
            fs::write(staged_destination(spec), arrayless).expect("write an arrayless output");
            Ok(0)
        }),
        "output_declared_array_without_payload"
    );

    // Arrays that do not say what they are. Nothing downstream can read the
    // document as a spectrum, and no source is needed to notice.
    assert_eq!(
        attempt(&|spec| {
            let roleless = output_document()
                .replace(r#"<cvParam accession="MS:1000514"/>"#, "")
                .replace(r#"<cvParam accession="MS:1000515"/>"#, "");
            fs::write(staged_destination(spec), roleless).expect("write a roleless output");
            Ok(0)
        }),
        "output_array_role_missing"
    );

    // Both arrays claiming the same role is the same defect wearing a disguise.
    assert_eq!(
        attempt(&|spec| {
            let doubled =
                output_document().replace(r#"accession="MS:1000515""#, r#"accession="MS:1000514""#);
            fs::write(staged_destination(spec), doubled).expect("write a doubled-role output");
            Ok(0)
        }),
        "output_array_role_missing"
    );

    // Arrays with no numeric encoding: their width and type are unstated, so
    // the payload cannot be decoded even though everything about it looks
    // present.
    assert_eq!(
        attempt(&|spec| {
            let unencoded = output_document().replace(r#"<cvParam accession="MS:1000521"/>"#, "");
            fs::write(staged_destination(spec), unencoded).expect("write an unencoded output");
            Ok(0)
        }),
        "output_array_encoding_missing"
    );

    // Both compression answers at once. The compressed-array count is satisfied,
    // so only looking at the contradiction finds it.
    assert_eq!(
        attempt(&|spec| {
            let contradictory = output_document().replace(
                r#"<cvParam accession="MS:1000574"/>"#,
                r#"<cvParam accession="MS:1000574"/><cvParam accession="MS:1000576"/>"#,
            );
            fs::write(staged_destination(spec), contradictory)
                .expect("write a contradictory output");
            Ok(0)
        }),
        "output_compression_contradictory"
    );

    // A spectrum that does not say which MS level it is cannot be told from any
    // other one downstream.
    assert_eq!(
        attempt(&|spec| {
            let levelless = output_document().replace(
                r#"<cvParam accession="MS:1000511" name="ms level" value="1"/>"#,
                "",
            );
            fs::write(staged_destination(spec), levelless).expect("write a levelless output");
            Ok(0)
        }),
        "output_ms_level_missing"
    );

    // Written as zero rather than omitted. MS levels start at one, so this says
    // no more about the stage than leaving it out does.
    assert_eq!(
        attempt(&|spec| {
            let zeroed = output_document().replace(
                r#"name="ms level" value="1""#,
                r#"name="ms level" value="0""#,
            );
            fs::write(staged_destination(spec), zeroed).expect("write a zero-level output");
            Ok(0)
        }),
        "output_ms_level_missing"
    );

    // Both representations at once says two incompatible things about the same
    // peaks.
    assert_eq!(
        attempt(&|spec| {
            let conflicting = output_document().replace(
                r#"<cvParam accession="MS:1000128" name="profile spectrum"/>"#,
                r#"<cvParam accession="MS:1000128" name="profile spectrum"/><cvParam accession="MS:1000127" name="centroid spectrum"/>"#,
            );
            fs::write(staged_destination(spec), conflicting).expect("write a conflicting output");
            Ok(0)
        }),
        "output_representation_conflicting"
    );

    // No declared length at all, with empty payloads. The point count cannot be
    // determined, so the peakless excuse is unavailable: it rests on a
    // declaration this record never made.
    assert_eq!(
        attempt(&|spec| {
            let undeclared = output_document()
                .replace(r#" defaultArrayLength="4""#, "")
                .replace("<binary>AA==</binary>", "<binary></binary>");
            fs::write(staged_destination(spec), undeclared).expect("write an undeclared output");
            Ok(0)
        }),
        "output_array_length_missing"
    );

    // And with a non-empty payload it is refused for the same reason: the
    // document does not state its own point counts either way.
    assert_eq!(
        attempt(&|spec| {
            let undeclared = output_document().replace(r#" defaultArrayLength="4""#, "");
            fs::write(staged_destination(spec), undeclared).expect("write an undeclared output");
            Ok(0)
        }),
        "output_array_length_missing"
    );

    // A record carrying no arrays at all still has to say so. Declaring nothing
    // is a missing schema-required attribute whether or not arrays are present.
    assert_eq!(
        attempt(&|spec| {
            let arrayless_undeclared = output_document()
                .replace(r#" defaultArrayLength="4""#, "")
                .replace(r#"<binaryDataArrayList count="2">"#, "")
                .replace("</binaryDataArrayList>", "");
            fs::write(staged_destination(spec), arrayless_undeclared)
                .expect("write an arrayless undeclared output");
            Ok(0)
        }),
        "output_array_length_missing"
    );

    // A peakless record is legitimate and stays so: zero declared length with
    // an empty payload is a real spectrum, not a defect.
    let peakless = output_document()
        .replace(r#"defaultArrayLength="4""#, r#"defaultArrayLength="0""#)
        .replace("<binary>AA==</binary>", "<binary></binary>");
    let root = directory.path().join("peakless-out");
    fs::create_dir(&root).expect("create destination root");
    let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");
    let act = |spec: &CommandSpec| {
        fs::write(staged_destination(spec), &peakless).expect("write a peakless output");
        Ok(0)
    };
    let runner = FakeRunner::new(&act);
    assert_eq!(
        run_conversion(&plan, &evidenced_capabilities(), &runner)
            .outcome()
            .stable_id(),
        "finalized",
        "a legitimately peakless document was refused"
    );

    // An entry the plan did not ask for is never silently ignored.
    assert_eq!(
        attempt(&|spec| {
            let staged = staged_destination(spec);
            fs::write(&staged, output_document()).expect("write the planned output");
            fs::write(
                staged
                    .parent()
                    .expect("staged output has a parent")
                    .join("extra.log"),
                b"backend chatter",
            )
            .expect("write an unexpected sidecar");
            Ok(0)
        }),
        "unexpected_output"
    );

    // A backend that failed produced nothing worth judging.
    assert_eq!(attempt(&|_| Ok(1)), "backend_rejected");
}

/// The acquisition a run converts is the acquisition it admitted, and for a
/// vendor source that check is the only thing standing between the boundary and
/// a backend reading a file nobody verified.
#[test]
fn a_vendor_source_replaced_or_rewritten_before_the_run_is_refused() {
    let directory = TestDirectory::new();
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    // Rewritten in place, same name, same length: only the content moved.
    let source = write_thermo_source(directory.path(), "acquisition.raw");
    let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");
    fs::write(&source, thermo_bytes(b"different-body!!")).expect("rewrite the acquisition");
    let runner = FakeRunner::new(&convert_faithfully);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);
    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::SourceChangedBeforeRun)
    );
    assert_eq!(
        runner.calls(),
        0,
        "the backend read a rewritten acquisition"
    );

    // Replaced by a different object under the same name.
    let replaced = write_thermo_source(directory.path(), "second.raw");
    let plan = ConversionPlan::to_mzml(open_thermo(&replaced), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");
    fs::remove_file(&replaced).expect("remove the acquisition");
    fs::write(&replaced, thermo_bytes(b"acquisition-body")).expect("replace the acquisition");
    let runner = FakeRunner::new(&convert_faithfully);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);
    assert!(
        matches!(
            report.outcome(),
            ConversionRunOutcome::Failed(
                ConversionRunFailure::SourceChangedBeforeRun
                    | ConversionRunFailure::SourceNotRechecked { .. }
            )
        ),
        "a replaced acquisition was converted: {report:?}"
    );
    assert_eq!(runner.calls(), 0);
    assert!(entry_names(&root).is_empty());
}

// --- Capability binding -----------------------------------------------------

/// One successful conversion is evidence about the build it ran on. A vendor
/// family is refused on every other build, before a staging area exists.
#[test]
fn a_vendor_family_runs_only_on_a_build_it_has_evidence_for() {
    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");

    let attempt = |installed: &InstalledHelpCapabilities| {
        let root = directory.path().join(format!(
            "out-{}",
            NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("create destination root");
        let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
            .expect("plan a vendor conversion");
        let runner = FakeRunner::new(&convert_faithfully);
        let report = run_conversion(&plan, installed, &runner);
        // Nothing may be created for a build with no evidence, so the staging
        // name has to be as absent as everything else.
        let entries = entry_names(&root);
        (
            report.outcome().stable_id().to_owned(),
            runner.calls(),
            entries,
        )
    };

    let (outcome, calls, entries) = attempt(&evidenced_capabilities());
    assert_eq!(outcome, "finalized");
    assert_eq!(calls, 1);
    assert_eq!(entries, vec![OsString::from("acquisition.mzML")]);

    // A later release is not this release.
    let (outcome, calls, entries) = attempt(&capabilities_reporting("3.0.26204", Some("a09eea9")));
    assert_eq!(outcome, "source_family_not_evidenced");
    assert_eq!(calls, 0, "an unevidenced build launched a backend");
    assert!(
        entries.is_empty(),
        "an unevidenced build created {entries:?}"
    );

    // The right release built from a different revision is a different build.
    let (outcome, ..) = attempt(&capabilities_reporting(EVIDENCED_RELEASE, Some("deadbee")));
    assert_eq!(outcome, "source_family_not_evidenced");

    // A build that will not say which it is cannot be matched against evidence
    // recorded for a specific one.
    let (outcome, ..) = attempt(&capabilities_reporting(EVIDENCED_RELEASE, None));
    assert_eq!(outcome, "source_family_not_evidenced");

    // Help that declares no release at all is the case every existing test
    // fixture is in, and it is refused for the same reason.
    let (outcome, ..) = attempt(&capabilities());
    assert_eq!(outcome, "source_family_not_evidenced");

    // The right release and the right revision out of a different binary. Two
    // strings from a help banner say what a build calls itself; the evidence was
    // taken against an artifact, and an installation with the vendor libraries
    // missing or replaced would answer these two identically.
    let (outcome, calls, entries) = attempt(&capabilities_reporting_for(
        EVIDENCED_RELEASE,
        Some(EVIDENCED_REVISION),
        EXECUTABLE_SHA256,
    ));
    assert_eq!(outcome, "source_family_not_evidenced");
    assert_eq!(calls, 0);
    assert!(entries.is_empty());
}

/// The gate is about the vendor family, not about conversion in general: an
/// mzML source is unaffected by a build this repository has no vendor evidence
/// for, because its reader is not the one the evidence is about.
#[test]
fn the_provider_build_gate_does_not_touch_the_mzml_posture() {
    let directory = TestDirectory::new();
    let source = write_source(directory.path(), "sample.mzML");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = plan_into(open_source(&source), &root, ConflictPolicy::Fail);

    let runner = FakeRunner::new(&convert_faithfully);
    let report = run_conversion(
        &plan,
        &capabilities_reporting("9.9.99999", Some("ffffff0")),
        &runner,
    );

    assert_eq!(report.outcome().stable_id(), "finalized");
    assert!(!ConversionSourceKind::MzmlFile.requires_provider_build_evidence());
    assert!(ConversionSourceKind::ThermoRawFile.requires_provider_build_evidence());
}

/// The build identity comes from the same complete help capture every other
/// capability fact comes from, so a capability decision and a discovery report
/// cannot disagree about which build answered.
#[test]
fn the_provider_build_is_read_from_the_installed_help() {
    let evidenced = evidenced_capabilities();
    let build = evidenced
        .provider_build()
        .expect("help declaring a release yields a build");
    assert_eq!(build.release(), EVIDENCED_RELEASE);
    assert_eq!(build.source_revision(), Some(EVIDENCED_REVISION));
    assert!(build.is(EVIDENCED_RELEASE, EVIDENCED_REVISION));
    assert!(!build.is(EVIDENCED_RELEASE, "other"));

    // Help that never names a release yields no build rather than a guess.
    assert!(capabilities().provider_build().is_none());

    // A build that reports two different releases is not an identity.
    let conflicting = capabilities_reporting("3.0.26013\nProteoWizard release: 3.0.26204", None);
    assert!(conflicting.provider_build().is_none());
}

// --- Execution safety, for the family that has just been admitted -----------

/// Every safety property the boundary already had applies unchanged to the new
/// source posture. This is the point of adding a source rather than a pipeline.
#[test]
fn a_vendor_conversion_reuses_the_whole_safety_boundary() {
    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    // The backend writes into a private staging directory, never the
    // destination root, and is told to name its output there.
    let observed = RefCell::new(None);
    let act = |spec: &CommandSpec| {
        let staged = staged_destination(spec);
        *observed.borrow_mut() = Some(staged.clone());
        assert!(
            staged
                .parent()
                .and_then(Path::parent)
                .is_some_and(|staging| staging
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().ends_with(".mscanvas-staging"))),
            "a vendor run wrote outside a private staging area"
        );
        assert_eq!(
            entry_names(&root),
            vec![OsString::from("acquisition.mzML.mscanvas-staging")],
            "the destination root held something other than the staging area"
        );
        fs::write(&staged, output_document()).expect("write the staged output");
        Ok(0)
    };
    let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);

    assert_eq!(report.outcome().stable_id(), "finalized");
    assert!(report.residue().is_none(), "staging survived a vendor run");
    assert_eq!(entry_names(&root), vec![OsString::from("acquisition.mzML")]);
    assert!(!observed.borrow().as_ref().expect("a staged path").exists());

    // No-clobber: a second run refuses the name the first one took, and leaves
    // what is there exactly as it is.
    let existing = fs::read(root.join("acquisition.mzML")).expect("read the finalized output");
    let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
        .expect("plan a second vendor conversion");
    let runner = FakeRunner::new(&convert_faithfully);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);
    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::DestinationExists)
    );
    assert_eq!(runner.calls(), 0);
    assert_eq!(
        fs::read(root.join("acquisition.mzML")).expect("read it again"),
        existing
    );
}

/// A backend that never reached an ordinary exit produced nothing this boundary
/// will finalize, whatever the source family.
#[test]
fn a_vendor_run_that_did_not_complete_finalizes_nothing() {
    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");

    let runner = FakeRunner::new(&convert_faithfully).reporting(Termination::Cancelled);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::BackendDidNotComplete)
    );
    assert!(entry_names(&root).is_empty());
}

/// The measured fact that changed the design: this family's reader cannot open
/// the Windows extended-length path this crate binds identity to, and the open
/// format's reader can. The spelling is therefore per-family, and it is proved
/// to name the admitted object rather than assumed to.
#[cfg(windows)]
#[test]
fn a_vendor_source_is_named_to_the_backend_in_a_spelling_its_reader_accepts() {
    assert_eq!(
        ConversionSourceKind::MzmlFile.input_spelling(),
        InputSpelling::Canonical
    );
    assert_eq!(
        ConversionSourceKind::ThermoRawFile.input_spelling(),
        InputSpelling::PlainVerified
    );

    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = ConversionPlan::to_mzml(open_thermo(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");

    let runner = FakeRunner::new(&convert_faithfully);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);
    assert_eq!(report.outcome().stable_id(), "finalized");

    let argv = runner.argv();
    let input = argv.first().expect("the input is the first argument");
    let input = Path::new(input);
    assert!(
        !input.to_string_lossy().starts_with(r"\\?\"),
        "the vendor reader was handed an extended-length path"
    );
    assert!(input.is_absolute());
    // The spelling is not merely shorter: it reaches the object that was
    // admitted, which is what the plan proved before using it.
    assert_eq!(
        fs::read(input).expect("read through the spelling handed to the backend"),
        fs::read(&source).expect("read the admitted acquisition")
    );

    // The open format keeps the spelling its own evidence was recorded with.
    let mzml = write_source(directory.path(), "sample.mzML");
    let mzml_root = directory.path().join("mzml-out");
    fs::create_dir(&mzml_root).expect("create destination root");
    let plan = plan_into(open_source(&mzml), &mzml_root, ConflictPolicy::Fail);
    let runner = FakeRunner::new(&convert_faithfully);
    assert_eq!(
        run_conversion(&plan, &capabilities(), &runner)
            .outcome()
            .stable_id(),
        "finalized"
    );
    assert!(
        runner
            .argv()
            .first()
            .expect("the input is the first argument")
            .to_string_lossy()
            .starts_with(r"\\?\"),
        "the open-format spelling changed"
    );
}

/// The hold normally prevents an acquisition changing under a run, but the hold
/// is a Windows guarantee and this contract is not. An output whose acquisition
/// no longer matches what was admitted is refused wherever that happens, and an
/// output-only judgement must refuse it exactly as a comparison would.
#[test]
fn an_output_whose_acquisition_no_longer_matches_is_refused() {
    let directory = TestDirectory::new();
    let source = write_thermo_source(directory.path(), "acquisition.raw");
    let staging = directory.path().join("staging");
    fs::create_dir(&staging).expect("create a staging directory");
    fs::write(staging.join("acquisition.mzML"), output_document()).expect("write an output");

    // Facts describing bytes this file does not hold: exactly what a run would
    // be left holding if the acquisition changed under it.
    let stale = SourceObjectFacts::from_parts(
        SourceIdentity::capture(&source).expect("capture the acquisition identity"),
        thermo_bytes(b"acquisition-body").len() as u64,
        Sha256Digest::from_bytes([0x5A; 32]),
    );

    let verified = verify_vendor_conversion_retaining_output(
        &stale,
        &staging,
        OsStr::new("acquisition.mzML"),
        ConversionPolicy::default(),
        MzmlScanLimits::default(),
    );

    match verified {
        VerifiedConversion::Rejected(outcome) => {
            assert_eq!(outcome.stable_id(), "source_changed_during_conversion");
        }
        VerifiedConversion::Valid(_) => panic!("an unmatched acquisition was accepted"),
    }
}

/// The real-acquisition evidence, kept out of ordinary runs.
///
/// CI has no lawful vendor acquisition and no ProteoWizard, so this is ignored
/// rather than skipped silently: a machine that has both can run it by name,
/// and one that does not is told the claim went unchecked instead of shown a
/// green run. The reproduction command and the fixture provenance are in the
/// vendor RAW evidence document.
#[test]
#[ignore = "requires a lawful vendor acquisition and an installed ProteoWizard; see docs/spikes/M3_VENDOR_RAW_EVIDENCE.md"]
fn the_vendor_raw_evidence_run_is_reproducible() {
    let Some(fixture) = std::env::var_os("MSCANVAS_THERMO_RAW_FIXTURE").map(PathBuf::from) else {
        panic!(
            "set MSCANVAS_THERMO_RAW_FIXTURE to the lawful acquisition described in the evidence document"
        );
    };
    let source = ConversionSource::open_thermo_raw_file(&fixture, MzmlScanLimits::default())
        .expect("the fixture is admitted as a Thermo RAW source");
    assert_eq!(source.kind(), ConversionSourceKind::ThermoRawFile);

    let discovery = crate::discovery::discover(crate::discovery::DiscoveryRequest::automatic());
    let capabilities = InstalledHelpCapabilities::from_discovered_tool(&discovery.msconvert)
        .expect("installed help");
    let directory = TestDirectory::new();
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = ConversionPlan::to_mzml(source, &root, ConflictPolicy::Fail).expect("plan");

    let report = run_conversion(&plan, &capabilities, &crate::process::SystemProcessRunner);
    let ConversionRunOutcome::Finalized(finalized) = report.outcome() else {
        panic!("the evidence conversion did not finalize: {report:?}");
    };
    let valid = finalized.valid();
    assert_eq!(valid.validation_mode(), ValidationMode::OutputOnly);
    assert!(!valid.is_fully_verified());
    assert!(report.residue().is_none());
    assert_eq!(entry_names(&root).len(), 1);
}

// --- The second evidenced vendor source family ---
//
// Shimadzu LabSolutions LCD. Everything the section above establishes applies
// unchanged, so nothing here re-tests the boundary itself. What is new is the
// one thing that is different about this family: its leading bytes name a
// container, not a vendor, so recognition reads one level in. These tests are
// about that reading, and about the family reaching the same boundary through
// it.
//
// As above, no backend is reached. The real acquisition is measured by a
// separate ignored run.

/// The eight bytes a Microsoft compound file begins with, spelled out here
/// rather than imported for the same reason the Thermo header is.
const COMPOUND_HEADER: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// The entries a LabSolutions acquisition carries, spelled out for the same
/// reason. If the constant in the crate is edited to match a mistake, these
/// still say what was measured.
const SHIMADZU_ENTRIES: [&str; 3] = ["Method File Property", "GUMM_Information", "LSS Raw Data"];

/// A compound file holding exactly these entries.
///
/// Built, not vendor data. What this boundary decides about a source is decided
/// from the container's header, the entry names inside it, the posture and the
/// object's identity, and every one of those is real here. What it cannot stand
/// in for is the Shimadzu reader, which is measured for real elsewhere.
fn compound_bytes(entries: &[&str]) -> Vec<u8> {
    const SECTOR: usize = 512;
    let mut bytes = vec![0_u8; SECTOR * 2];
    bytes[..8].copy_from_slice(&COMPOUND_HEADER);
    // Major version 3, which is the version 512-byte sectors belong to. Both
    // real fixtures are version 4 with 4096-byte sectors; either defined pair
    // exercises the same reading, and a header that named neither would be a
    // file no writer produces.
    bytes[26..28].copy_from_slice(&3_u16.to_le_bytes());
    bytes[28..30].copy_from_slice(&[0xFE, 0xFF]);
    bytes[30..32].copy_from_slice(&9_u16.to_le_bytes());
    bytes[48..52].copy_from_slice(&0_u32.to_le_bytes());

    // "Root Entry" first, as a real one has, and then the family's own.
    let named = std::iter::once("Root Entry").chain(entries.iter().copied());
    for (index, name) in named.enumerate() {
        let at = SECTOR + index * 128;
        let units: Vec<u16> = name.encode_utf16().collect();
        for (unit, slot) in units.iter().zip(bytes[at..].chunks_exact_mut(2)) {
            slot.copy_from_slice(&unit.to_le_bytes());
        }
        let declared = u16::try_from(units.len() * 2 + 2).expect("a short name");
        bytes[at + 64..at + 66].copy_from_slice(&declared.to_le_bytes());
        bytes[at + 66] = if index == 0 { 5 } else { 2 };
    }
    bytes
}

fn write_shimadzu_source(directory: &Path, name: &str) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, compound_bytes(&SHIMADZU_ENTRIES)).expect("write a vendor source");
    path
}

fn open_shimadzu(path: &Path) -> ConversionSource {
    ConversionSource::open_shimadzu_lcd_file(path, MzmlScanLimits::default())
        .expect("open a Shimadzu LCD source")
}

/// The claim that justifies reading inside the container at all: the signature
/// alone cannot name this family, and the entries can.
///
/// The decoy here is not arbitrary. A SCIEX `.wiff` is a compound file too, and
/// its first eight bytes are byte-for-byte these -- measured on real fixtures
/// of both. Renaming one to `.lcd` is the exact case a suffix-plus-signature
/// rule would admit, and the backend would then refuse it after launching. It
/// is refused here instead.
#[test]
fn a_compound_file_family_is_recognized_by_its_contents_and_not_by_its_magic() {
    let directory = TestDirectory::new();

    let admitted = write_shimadzu_source(directory.path(), "acquisition.lcd");
    let source = open_shimadzu(&admitted);
    assert_eq!(source.kind(), ConversionSourceKind::ShimadzuLcdFile);
    assert_eq!(source.byte_length(), 1024);
    assert!(source.mzml_facts().is_none(), "an LCD was read as mzML");
    assert!(!source.kind().supports_source_comparison());

    // The magic is right, the extension is right, and the contents belong to
    // another vendor. This is the whole reason the family reads one level in.
    let other_vendor = directory.path().join("renamed-wiff.lcd");
    fs::write(
        &other_vendor,
        compound_bytes(&["Sample", "WiffFileInfo", "AcqMethod"]),
    )
    .expect("write another vendor's compound file");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&other_vendor, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::FamilyStructureMismatch)
    );

    // Every marker is required. A container holding two of the three is not
    // two-thirds of an acquisition.
    for (absent, missing) in SHIMADZU_ENTRIES.iter().enumerate() {
        let partial: Vec<&str> = SHIMADZU_ENTRIES
            .iter()
            .enumerate()
            .filter_map(|(index, name)| (index != absent).then_some(*name))
            .collect();
        let path = directory.path().join(format!("partial-{absent}.lcd"));
        fs::write(&path, compound_bytes(&partial)).expect("write an incomplete container");
        assert_eq!(
            ConversionSource::open_shimadzu_lcd_file(&path, MzmlScanLimits::default()),
            Err(ConversionSourceRejection::FamilyStructureMismatch),
            "a container without {missing} was admitted"
        );
    }

    // The markers are not a substring search. An entry that merely contains one
    // is a different entry.
    let nearly = directory.path().join("nearly.lcd");
    fs::write(
        &nearly,
        compound_bytes(&["Method File Property 2", "GUMM_Information", "LSS Raw Data"]),
    )
    .expect("write a near miss");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&nearly, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::FamilyStructureMismatch)
    );

    // Not a compound file at all: refused before any structure is looked for,
    // and refused as a signature mismatch, because that is what it is.
    let decoy = directory.path().join("not-really.lcd");
    fs::write(&decoy, b"PK\x03\x04 this is a zip archive").expect("write a decoy");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&decoy, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::SignatureMismatch)
    );

    // The container itself has to hold together. One whose directory sector is
    // not there is not admitted on the strength of its first eight bytes.
    let mut headless = compound_bytes(&SHIMADZU_ENTRIES);
    headless.truncate(512);
    let unreadable = directory.path().join("no-directory.lcd");
    fs::write(&unreadable, &headless).expect("write a truncated container");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&unreadable, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::FamilyStructureMismatch)
    );

    // And the structure alone is not enough, because the installed reader
    // consults the name and refuses every other extension.
    let unsupported = directory.path().join("acquisition.dat");
    fs::write(&unsupported, compound_bytes(&SHIMADZU_ENTRIES)).expect("write a misnamed one");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&unsupported, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::UnsupportedExtension)
    );

    // Case, as everywhere else on this platform.
    let shouted = directory.path().join("acquisition.LCD");
    fs::write(&shouted, compound_bytes(&SHIMADZU_ENTRIES)).expect("write an upper-case one");
    assert_eq!(
        open_shimadzu(&shouted).kind(),
        ConversionSourceKind::ShimadzuLcdFile
    );
}

/// Two ways a crafted container could have talked its way past recognition,
/// both refused. Neither is exotic: each is a field this reader has to take
/// from the file it is judging.
#[test]
fn a_crafted_container_cannot_talk_its_way_into_the_family() {
    let directory = TestDirectory::new();

    // A geometry the format does not define. 10 and 11 sit between the two
    // that are defined, so a range check would accept them and send the
    // directory read to an invented 1024- or 2048-byte offset -- where a
    // crafted file is free to have put three convincing marker names.
    for shift in [10_u16, 11] {
        let mut invented = compound_bytes(&SHIMADZU_ENTRIES);
        invented[30..32].copy_from_slice(&shift.to_le_bytes());
        let path = directory.path().join(format!("shift-{shift}.lcd"));
        fs::write(&path, &invented).expect("write an invented geometry");
        assert_eq!(
            ConversionSource::open_shimadzu_lcd_file(&path, MzmlScanLimits::default()),
            Err(ConversionSourceRejection::FamilyStructureMismatch),
            "a container claiming sector shift {shift} was admitted"
        );
    }

    // A header that contradicts itself. Each field is one the format defines;
    // the combination is not, and a reader that checked them separately would
    // read the directory at whichever geometry the crafted file preferred.
    let mut contradictory = compound_bytes(&SHIMADZU_ENTRIES);
    contradictory[26..28].copy_from_slice(&4_u16.to_le_bytes());
    let path = directory.path().join("contradictory.lcd");
    fs::write(&path, &contradictory).expect("write a contradictory header");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&path, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::FamilyStructureMismatch),
        "a container claiming version 4 with 512-byte sectors was admitted"
    );

    // A marker forged out of a longer name. `LSS Raw DataX` declared as though
    // the `X` were the two-byte terminator reads back as `LSS Raw Data` unless
    // the terminator is actually checked -- and then this container, which
    // holds no such entry, passes for an acquisition.
    let mut forged = compound_bytes(&["Method File Property", "GUMM_Information", "LSS Raw DataX"]);
    // Third entry after "Root Entry", in the directory sector one sector in.
    let entry = 512 + 3 * 128;
    let declared = u16::try_from("LSS Raw DataX".len() * 2).expect("a short name");
    forged[entry + 64..entry + 66].copy_from_slice(&declared.to_le_bytes());
    let path = directory.path().join("forged.lcd");
    fs::write(&path, &forged).expect("write a forged marker");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&path, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::FamilyStructureMismatch),
        "a forged marker was admitted"
    );

    // And the honest container the forgery was built from is still admitted,
    // so the refusal above is about the mismatch and not about the shape.
    let honest = write_shimadzu_source(directory.path(), "honest.lcd");
    assert_eq!(
        open_shimadzu(&honest).kind(),
        ConversionSourceKind::ShimadzuLcdFile
    );
}

/// The two vendor postures are independent, and neither is a fallback for the
/// other. A rule that let one family answer for another would make the family
/// recorded on a run something other than what was recognized.
#[test]
fn the_two_vendor_postures_do_not_admit_each_others_acquisitions() {
    let directory = TestDirectory::new();
    let thermo = write_thermo_source(directory.path(), "acquisition.raw");
    let shimadzu = write_shimadzu_source(directory.path(), "acquisition.lcd");

    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&thermo, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::UnsupportedExtension)
    );
    assert_eq!(
        ConversionSource::open_thermo_raw_file(&shimadzu, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::UnsupportedExtension)
    );

    // Under each other's names, so the extension filter is not what answers.
    let thermo_named_lcd = directory.path().join("thermo-inside.lcd");
    fs::write(&thermo_named_lcd, thermo_bytes(b"acquisition-body")).expect("write one");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&thermo_named_lcd, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::SignatureMismatch)
    );
    let shimadzu_named_raw = directory.path().join("shimadzu-inside.raw");
    fs::write(&shimadzu_named_raw, compound_bytes(&SHIMADZU_ENTRIES)).expect("write one");
    assert_eq!(
        ConversionSource::open_thermo_raw_file(&shimadzu_named_raw, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::SignatureMismatch)
    );

    // Neither is admitted by the open-format posture, and an mzML is admitted
    // by neither of theirs.
    let mzml = write_source(directory.path(), "sample.mzML");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&mzml, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::UnsupportedExtension)
    );
    assert!(matches!(
        ConversionSource::open_mzml_file(&shimadzu, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotReadableAsMzml(_))
    ));
}

/// The posture the family inherits, exercised on this family rather than
/// assumed from the shared body: a directory and a missing object are refused,
/// and no refusal names a path.
#[test]
fn a_compound_file_family_keeps_the_posture_the_shared_admission_has() {
    let directory = TestDirectory::new();

    let as_directory = directory.path().join("acquisition-folder.lcd");
    fs::create_dir(&as_directory).expect("create a directory named like an acquisition");
    assert_eq!(
        ConversionSource::open_shimadzu_lcd_file(&as_directory, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotARegularFile)
    );

    let absent = directory.path().join("absent.lcd");
    assert!(matches!(
        ConversionSource::open_shimadzu_lcd_file(&absent, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotInspectable { .. })
    ));

    // A path whose Debug would be the most tempting place for one to leak.
    let named = write_shimadzu_source(directory.path(), "\u{6837}\u{672c} 02.lcd");
    let rendered = format!("{:?}", open_shimadzu(&named));
    assert!(rendered.contains("ShimadzuLcdFile"));
    assert!(!rendered.contains('\u{6837}'), "a source rendered its path");
    assert!(!rendered.contains(".lcd"), "a source rendered its name");

    // Every refusal this family can produce, rendered.
    for rejection in [
        ConversionSourceRejection::FamilyStructureMismatch,
        ConversionSourceRejection::SignatureMismatch,
        ConversionSourceRejection::UnsupportedExtension,
    ] {
        let rendered = format!("{rejection}");
        assert!(!rendered.contains(std::path::MAIN_SEPARATOR));
        assert!(!rendered.contains(".lcd"));
    }
    assert_eq!(
        ConversionSourceRejection::FamilyStructureMismatch.stable_id(),
        "source_family_structure_mismatch"
    );
    assert_ne!(
        ConversionSourceRejection::FamilyStructureMismatch.stable_id(),
        ConversionSourceRejection::SignatureMismatch.stable_id()
    );
}

/// A no-follow open, on this family. The structure is read through the handle
/// that was pinned, so a name repointed after admission cannot change what was
/// recognized.
#[cfg(windows)]
#[test]
fn a_compound_file_family_is_not_reached_through_a_link() {
    let directory = TestDirectory::new();
    let target = directory.path().join("target");
    fs::create_dir(&target).expect("create a link target directory");
    fs::write(target.join("real.lcd"), compound_bytes(&SHIMADZU_ENTRIES))
        .expect("write behind the link");

    let link = directory.path().join("linked.lcd");
    if std::os::windows::fs::symlink_file(target.join("real.lcd"), &link).is_err() {
        // An unprivileged account cannot create one. The claim is untestable
        // here, not false, and reporting it as checked would be worse.
        return;
    }
    assert!(matches!(
        ConversionSource::open_shimadzu_lcd_file(&link, MzmlScanLimits::default()),
        Err(ConversionSourceRejection::NotInspectable { .. })
            | Err(ConversionSourceRejection::NotARegularFile)
    ));
}

/// The identity the source carries is the object that was recognized, so an
/// acquisition replaced between admission and the run is caught before the
/// backend is launched -- for this family as for the other.
#[test]
fn a_replaced_compound_file_acquisition_is_caught_before_the_backend() {
    let directory = TestDirectory::new();
    let source = write_shimadzu_source(directory.path(), "acquisition.lcd");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let plan = ConversionPlan::to_mzml(open_shimadzu(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");
    // Same family, same length, different bytes: only the digest tells them
    // apart, and it is the digest of the object the handle recognized.
    fs::write(
        &source,
        compound_bytes(&["Method File Property", "GUMM_Information", "LSS Raw Data "]),
    )
    .expect("replace the acquisition");

    let runner = FakeRunner::new(&convert_faithfully);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);

    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::SourceChangedBeforeRun)
    );
    assert_eq!(
        runner.calls(),
        0,
        "a replaced acquisition launched a backend"
    );
    assert!(entry_names(&root).is_empty());
}

/// The family reaches the same boundary: private staging, no-clobber
/// finalization, and an output-only judgement that never claims to be more.
#[test]
fn a_compound_file_family_runs_through_the_same_boundary_and_is_judged_on_its_output() {
    let directory = TestDirectory::new();
    let source = write_shimadzu_source(directory.path(), "acquisition.lcd");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");

    let act = |spec: &CommandSpec| {
        let staged = staged_destination(spec);
        assert!(
            staged
                .parent()
                .and_then(Path::parent)
                .is_some_and(|staging| staging
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().ends_with(".mscanvas-staging"))),
            "a vendor run wrote outside a private staging area"
        );
        fs::write(&staged, output_document()).expect("write the staged output");
        Ok(0)
    };
    let plan = ConversionPlan::to_mzml(open_shimadzu(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");
    let runner = FakeRunner::new(&act);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);

    let ConversionRunOutcome::Finalized(finalized) = report.outcome() else {
        panic!("the vendor conversion did not finalize: {report:?}");
    };
    let valid = finalized.valid();
    assert_eq!(valid.validation_mode(), ValidationMode::OutputOnly);
    assert!(
        !valid.is_fully_verified(),
        "an output-only judgement claimed full verification"
    );
    assert!(report.residue().is_none(), "staging survived a vendor run");
    assert_eq!(entry_names(&root), vec![OsString::from("acquisition.mzML")]);

    // No-clobber, on this family.
    let existing = fs::read(root.join("acquisition.mzML")).expect("read the finalized output");
    let plan = ConversionPlan::to_mzml(open_shimadzu(&source), &root, ConflictPolicy::Fail)
        .expect("plan a second vendor conversion");
    let runner = FakeRunner::new(&convert_faithfully);
    let report = run_conversion(&plan, &evidenced_capabilities(), &runner);
    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::DestinationExists)
    );
    assert_eq!(runner.calls(), 0);
    assert_eq!(
        fs::read(root.join("acquisition.mzML")).expect("read it again"),
        existing
    );
}

/// The measured layout for this family is one mzML and nothing else, and that
/// is a requirement rather than an observation. A backend that writes anything
/// beside the planned output finalizes nothing, and neither does one whose
/// output is still being written.
///
/// Recorded for this family specifically because the evidence run measured the
/// layout it produces. A family that turned out to emit a sidecar would have
/// been a gate to record, not something to make this boundary tolerate.
#[test]
fn a_compound_file_run_that_left_more_than_the_planned_output_finalizes_nothing() {
    let directory = TestDirectory::new();
    let source = write_shimadzu_source(directory.path(), "acquisition.lcd");

    let attempt = |act: &dyn Fn(&CommandSpec) -> Result<i32, ProcessError>| {
        let root = directory.path().join(format!(
            "out-{}",
            NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("create destination root");
        let plan = ConversionPlan::to_mzml(open_shimadzu(&source), &root, ConflictPolicy::Fail)
            .expect("plan a vendor conversion");
        let runner = FakeRunner::new(act);
        let report = run_conversion(&plan, &evidenced_capabilities(), &runner);
        // The detailed identifier, because the distinction between these two
        // refusals is the point: an interrupted write is not the same defect as
        // an output set nobody planned, and one reported as the other would
        // send an investigation to the wrong place.
        let outcome = match report.outcome() {
            ConversionRunOutcome::Failed(failure) => failure.detailed_stable_id(),
            other => panic!("a refused vendor run reported {other:?}"),
        };
        (outcome, entry_names(&root), report.residue().is_none())
    };

    // A sidecar the plan did not name. Real for other vendors; not for this
    // one, and refused either way.
    let (outcome, entries, swept) = attempt(&|spec: &CommandSpec| {
        let staged = staged_destination(spec);
        fs::write(&staged, output_document()).expect("write the staged output");
        let sidecar = staged.with_file_name("acquisition.mzML.scan");
        fs::write(&sidecar, b"a sidecar nobody planned for").expect("write a sidecar");
        Ok(0)
    });
    assert_eq!(outcome, "unexpected_output");
    assert!(entries.is_empty(), "a sidecar run finalized {entries:?}");
    assert!(swept, "staging survived a refused vendor run");

    // Output the backend is still in the middle of writing, reported as that
    // rather than as an output set nobody planned. The distinction matters:
    // one says the run was interrupted, the other says it produced something
    // unexpected, and they send an investigation to different places.
    let (outcome, entries, swept) = attempt(&|spec: &CommandSpec| {
        let staged = staged_destination(spec);
        let in_progress = staged.with_file_name("acquisition.mzML.part");
        fs::write(&in_progress, output_document()).expect("write an in-progress output");
        Ok(0)
    });
    assert_eq!(outcome, "partial_output");
    assert!(
        entries.is_empty(),
        "an interrupted run finalized {entries:?}"
    );
    assert!(swept, "staging survived a refused vendor run");

    // A document that stops in the middle of itself. This family's reader is
    // not granted an exception for it: an output that does not parse is
    // refused whichever vendor's file it came from.
    let (outcome, entries, swept) = attempt(&|spec: &CommandSpec| {
        let staged = staged_destination(spec);
        let whole = output_document();
        fs::write(&staged, &whole[..whole.len() / 2]).expect("write half an output");
        Ok(0)
    });
    assert_eq!(outcome, "malformed_xml");
    assert!(entries.is_empty(), "a malformed run finalized {entries:?}");
    assert!(swept, "staging survived a refused vendor run");
}

/// The build gate is per family, and the second row was added rather than the
/// first widened. A build with no evidence for this family launches nothing.
#[test]
fn the_compound_file_family_runs_only_on_a_build_it_has_evidence_for() {
    assert!(ConversionSourceKind::ShimadzuLcdFile.requires_provider_build_evidence());
    assert_eq!(
        ConversionSourceKind::ShimadzuLcdFile.stable_id(),
        "shimadzu_lcd_file"
    );
    // Two families, two rows, one build. A row is a family converted on a
    // build; a build that reads one vendor's files is not evidence about
    // another vendor's library sitting beside it.
    assert_eq!(EVIDENCED_PROVIDER_BUILDS.len(), 2);
    assert!(
        EVIDENCED_PROVIDER_BUILDS
            .iter()
            .any(|build| build.kind == ConversionSourceKind::ShimadzuLcdFile)
    );

    let directory = TestDirectory::new();
    let source = write_shimadzu_source(directory.path(), "acquisition.lcd");

    let attempt = |installed: &InstalledHelpCapabilities| {
        let root = directory.path().join(format!(
            "out-{}",
            NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("create destination root");
        let plan = ConversionPlan::to_mzml(open_shimadzu(&source), &root, ConflictPolicy::Fail)
            .expect("plan a vendor conversion");
        let runner = FakeRunner::new(&convert_faithfully);
        let report = run_conversion(&plan, installed, &runner);
        (
            report.outcome().stable_id().to_owned(),
            runner.calls(),
            entry_names(&root),
        )
    };

    let (outcome, calls, entries) = attempt(&evidenced_capabilities());
    assert_eq!(outcome, "finalized");
    assert_eq!(calls, 1);
    assert_eq!(entries, vec![OsString::from("acquisition.mzML")]);

    // A later release, a different revision, a build that will not say, and the
    // same two strings out of a different binary. Each is a different build.
    for installed in [
        capabilities_reporting("3.0.26204", Some("a09eea9")),
        capabilities_reporting(EVIDENCED_RELEASE, Some("deadbee")),
        capabilities_reporting(EVIDENCED_RELEASE, None),
        capabilities_reporting_for(
            EVIDENCED_RELEASE,
            Some(EVIDENCED_REVISION),
            EXECUTABLE_SHA256,
        ),
    ] {
        let (outcome, calls, entries) = attempt(&installed);
        assert_eq!(outcome, "source_family_not_evidenced");
        assert_eq!(calls, 0, "an unevidenced build launched a backend");
        assert!(
            entries.is_empty(),
            "an unevidenced build created {entries:?}"
        );
    }
}

/// The measured spelling for this family, which agrees with the other vendor
/// one for a different reason: `msconvert` expands its file masks before any
/// reader sees the argument, so an extended-length path matches nothing.
#[cfg(windows)]
#[test]
fn a_compound_file_family_is_named_to_the_backend_in_the_spelling_its_reader_accepts() {
    assert_eq!(
        ConversionSourceKind::ShimadzuLcdFile.input_spelling(),
        InputSpelling::PlainVerified
    );

    let directory = TestDirectory::new();
    let source = write_shimadzu_source(directory.path(), "acquisition.lcd");
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = ConversionPlan::to_mzml(open_shimadzu(&source), &root, ConflictPolicy::Fail)
        .expect("plan a vendor conversion");

    let runner = FakeRunner::new(&convert_faithfully);
    assert_eq!(
        run_conversion(&plan, &evidenced_capabilities(), &runner)
            .outcome()
            .stable_id(),
        "finalized"
    );

    let argv = runner.argv();
    let input = Path::new(argv.first().expect("the input is the first argument"));
    assert!(
        !input.to_string_lossy().starts_with(r"\\?\"),
        "the vendor reader was handed an extended-length path"
    );
    assert!(input.is_absolute());
    assert_eq!(
        fs::read(input).expect("read through the spelling handed to the backend"),
        fs::read(&source).expect("read the admitted acquisition")
    );
}

/// The real-acquisition evidence for this family, kept out of ordinary runs for
/// the same reason the other one is.
#[test]
#[ignore = "requires a lawful vendor acquisition and an installed ProteoWizard; see docs/spikes/M3_NEXT_VENDOR_EVIDENCE.md"]
fn the_shimadzu_lcd_evidence_run_is_reproducible() {
    let Some(fixture) = std::env::var_os("MSCANVAS_SHIMADZU_LCD_FIXTURE").map(PathBuf::from) else {
        panic!(
            "set MSCANVAS_SHIMADZU_LCD_FIXTURE to the lawful acquisition described in the evidence document"
        );
    };
    let source = ConversionSource::open_shimadzu_lcd_file(&fixture, MzmlScanLimits::default())
        .expect("the fixture is admitted as a Shimadzu LCD source");
    assert_eq!(source.kind(), ConversionSourceKind::ShimadzuLcdFile);

    let discovery = crate::discovery::discover(crate::discovery::DiscoveryRequest::automatic());
    let capabilities = InstalledHelpCapabilities::from_discovered_tool(&discovery.msconvert)
        .expect("installed help");
    let directory = TestDirectory::new();
    let root = directory.path().join("out");
    fs::create_dir(&root).expect("create destination root");
    let plan = ConversionPlan::to_mzml(source, &root, ConflictPolicy::Fail).expect("plan");

    let report = run_conversion(&plan, &capabilities, &crate::process::SystemProcessRunner);
    let ConversionRunOutcome::Finalized(finalized) = report.outcome() else {
        panic!("the evidence conversion did not finalize: {report:?}");
    };
    let valid = finalized.valid();
    assert_eq!(valid.validation_mode(), ValidationMode::OutputOnly);
    assert!(!valid.is_fully_verified());
    assert!(report.residue().is_none());
    // One source, one output, no sidecars. The measured layout, asserted.
    assert_eq!(entry_names(&root).len(), 1);
}

// --- Private cancellation ---------------------------------------------------

/// A `msconvert` stand-in that acts on the cancellation request the boundary
/// hands it, so a cancellation can be exercised with no process at all.
///
/// It never invents supervision facts the real runner would have to establish:
/// what it reports about the owned job is supplied by each test, which is how
/// the "reported cancelled before the tree was confirmed empty" case can be
/// written at all.
struct CancellingRunner<'a> {
    act: &'a dyn Fn(&CommandSpec) -> Result<i32, ProcessError>,
    /// Whether this runner makes the request itself while it is running, which
    /// is what a user pressing a button during a real conversion does.
    requests: Option<CancellationRequest>,
    termination: Termination,
    final_active_processes: Option<u32>,
    calls: Cell<usize>,
}

impl<'a> CancellingRunner<'a> {
    fn new(act: &'a dyn Fn(&CommandSpec) -> Result<i32, ProcessError>) -> Self {
        Self {
            act,
            requests: None,
            termination: Termination::Exited,
            final_active_processes: Some(0),
            calls: Cell::new(0),
        }
    }

    fn requesting(mut self, request: CancellationRequest) -> Self {
        self.requests = Some(request);
        self
    }

    const fn reporting(mut self, termination: Termination) -> Self {
        self.termination = termination;
        self
    }

    const fn leaving_active_processes(mut self, active: Option<u32>) -> Self {
        self.final_active_processes = active;
        self
    }

    fn calls(&self) -> usize {
        self.calls.get()
    }
}

impl ProcessRunner for CancellingRunner<'_> {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        self.calls.set(self.calls.get() + 1);
        // The staged bytes are written before the request is made, so what a
        // cancellation has to clean up is already there when it lands.
        let exit_code = (self.act)(spec)?;
        if let Some(request) = &self.requests {
            request.request();
        }
        Ok(ProcessOutput {
            stdout: Vec::new(),
            stderr: Vec::new(),
            stdout_total_bytes: 0,
            stderr_total_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(exit_code),
            elapsed: Duration::from_millis(11),
            termination: self.termination,
            max_active_processes: Some(1),
            final_active_processes: self.final_active_processes,
            peak_job_memory_bytes: Some(2_048),
        })
    }
}

/// Writes the partial document a terminated backend leaves behind: the planned
/// name, real bytes, and nothing that finishes it.
fn write_partial_output(spec: &CommandSpec) -> Result<i32, ProcessError> {
    fs::write(
        staged_destination(spec),
        b"<indexedmzML><mzML version=\"1.1.0\"><run",
    )
    .expect("write a partial staged output");
    Ok(0)
}

/// A run whose request preceded it inspects, creates, plans and launches
/// nothing.
#[test]
fn a_request_made_before_the_run_reaches_no_backend_and_creates_no_staging_area() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let cancellation = ConversionCancellation::new();
    cancellation.request_handle().request();

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::Cancelled(report) = &attempt else {
        panic!("a request made before the run is a cancellation: {attempt:?}");
    };
    assert_eq!(report.observation(), CancellationObservation::BeforeRun);
    assert!(!report.backend_was_run());
    assert_eq!(report.backend(), None);
    assert_eq!(report.staged_content(), None);
    assert_eq!(report.residue(), None);
    assert_eq!(runner.calls(), 0, "a refused run reached the backend");
    assert!(
        entry_names(&fixture.root).is_empty(),
        "a refused run left something in the destination root"
    );
    assert!(attempt.finalized().is_none());
    assert_eq!(attempt.stable_id(), "cancelled_before_run");
}

/// A request that lands after the acquisition has been rehashed and before the
/// launch decision creates no staging area, and does not claim a backend ran.
///
/// The rehash is the longest thing a run does before it creates anything, so
/// this interval is where a real request most often arrives. Reported as
/// `DuringRun` rather than `BeforeRun`, because the attempt had begun: it
/// opened and read the acquisition, and only the launch did not happen.
#[test]
fn a_request_made_before_the_launch_decision_creates_no_staging_area() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = FakeRunner::new(&act);
    let cancellation = ConversionCancellation::new();
    cancellation.request_handle().request();

    let result = run_admitted_cancellable(&fixture.plan, &capabilities(), &runner, &cancellation);

    let RunResult::Cancelled(report) = result else {
        panic!("a request before the launch decision is a cancellation");
    };
    assert_eq!(report.observation(), CancellationObservation::DuringRun);
    assert!(
        !report.backend_was_run(),
        "no process ran, so no backend facts may be reported"
    );
    assert_eq!(report.staged_content(), None);
    assert_eq!(report.residue(), None);
    assert_eq!(runner.calls(), 0, "a refused run reached the backend");
    assert!(
        entry_names(&fixture.root).is_empty(),
        "a staging area was created for a run that never launched"
    );
}

/// The central claim: a request that lands while the backend is running ends
/// with the partial document removed and the destination root untouched.
#[test]
fn a_cancelled_run_removes_its_partial_output_and_finalizes_nothing() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let cancellation = ConversionCancellation::new();
    let act = write_partial_output;
    let runner = CancellingRunner::new(&act)
        .requesting(cancellation.request_handle())
        .reporting(Termination::Cancelled);
    let staged = staged_output_of(&fixture.plan);

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::Cancelled(report) = &attempt else {
        panic!("a confirmed request is a cancellation: {attempt:?}");
    };
    assert_eq!(report.observation(), CancellationObservation::DuringRun);
    assert!(report.backend_was_run());
    assert_eq!(report.surviving_processes(), Some(0));
    let staged_content = report
        .staged_content()
        .expect("the staging area was observed before it was removed");
    assert_eq!(staged_content.entry_count(), 1);
    assert_eq!(staged_content.directory_count(), 0);
    assert!(staged_content.non_empty_file_observed());
    assert_eq!(report.residue(), None);
    assert!(attempt.finalized().is_none());
    assert!(
        !staged.exists(),
        "the partial document survived identity-bound cleanup"
    );
    assert!(
        entry_names(&fixture.root).is_empty(),
        "a cancelled run left something in the destination root"
    );
}

/// A backend that made a directory beside its output has that removed too.
#[test]
fn a_cancelled_run_removes_a_nested_tree_the_backend_left_behind() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let cancellation = ConversionCancellation::new();
    let act = |spec: &CommandSpec| {
        let staged = staged_destination(spec);
        let staging = staged.parent().expect("the staged output has a parent");
        let sidecar = staging.join("scratch");
        fs::create_dir(&sidecar).expect("create a backend sidecar directory");
        fs::write(sidecar.join("index"), b"partial index").expect("write a sidecar file");
        fs::write(&staged, b"<indexedmzML").expect("write a partial staged output");
        Ok(0)
    };
    let runner = CancellingRunner::new(&act)
        .requesting(cancellation.request_handle())
        .reporting(Termination::Cancelled);

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::Cancelled(report) = &attempt else {
        panic!("a confirmed request is a cancellation: {attempt:?}");
    };
    let staged_content = report
        .staged_content()
        .expect("the staging area was observed before it was removed");
    assert_eq!(staged_content.entry_count(), 2);
    assert_eq!(staged_content.directory_count(), 1);
    assert!(staged_content.non_empty_file_observed());
    assert_eq!(report.residue(), None);
    assert!(
        entry_names(&fixture.root).is_empty(),
        "a nested tree survived a cancelled run"
    );
}

/// A request the boundary cannot confirm is never reported as a cancellation.
#[test]
fn a_termination_that_could_not_be_confirmed_is_a_distinct_failure() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let cancellation = ConversionCancellation::new();
    let request = cancellation.request_handle();
    let act = |spec: &CommandSpec| {
        write_partial_output(spec)?;
        request.request();
        Err(ProcessError::Terminate {
            detail: "the owned job refused termination".to_owned(),
        })
    };
    let runner = CancellingRunner::new(&act);

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::CancellationFailed(failure) = &attempt else {
        panic!("an unconfirmed termination is not a cancellation: {attempt:?}");
    };
    assert_eq!(failure.cause(), BackendExecutionFailure::NotTerminated);
    // The runner returned an error rather than a result, so there are no
    // process facts to report and none are invented.
    assert_eq!(failure.backend(), None);
    // The primary failure and the cleanup result are separate facts: cleanup
    // still ran, and it succeeded.
    assert_eq!(failure.residue(), None);
    assert!(
        failure
            .staged_content()
            .is_some_and(|staged| staged.non_empty_file_observed())
    );
    assert_eq!(attempt.stable_id(), "cancellation_failed");
    assert_eq!(attempt.detailed_stable_id(), "backend_not_terminated");
    assert!(attempt.finalized().is_none());
    assert!(
        entry_names(&fixture.root).is_empty(),
        "an unconfirmed cancellation left something in the destination root"
    );
}

/// A runner that says it cancelled while the owned job still holds processes is
/// reporting a tree that may still be writing. That is a failure, not a
/// cancellation.
#[test]
fn a_cancellation_claimed_before_the_owned_tree_is_empty_is_a_failure() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let cancellation = ConversionCancellation::new();
    let act = write_partial_output;
    let runner = CancellingRunner::new(&act)
        .requesting(cancellation.request_handle())
        .reporting(Termination::Cancelled)
        .leaving_active_processes(Some(2));

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::CancellationFailed(failure) = &attempt else {
        panic!("a surviving owned process is not a confirmed cancellation: {attempt:?}");
    };
    assert_eq!(failure.cause(), BackendExecutionFailure::NotTerminated);
    // A tree that may still be running is the outcome a reader most needs
    // described, so the process facts the boundary did establish are kept.
    let backend = failure
        .backend()
        .expect("a process ran, so its facts are reported");
    assert_eq!(backend.elapsed(), Duration::from_millis(11));
    assert_eq!(backend.peak_job_memory_bytes(), Some(2_048));
    assert!(attempt.finalized().is_none());
}

/// An owned job that reports no accounting at all has not confirmed anything.
///
/// `None` means the platform exposed no bounded query, which is precisely the
/// state in which a caller must not be told the conversion stopped. Only
/// `Some(0)` is the confirmation, and a runner that supplies neither gets the
/// failure rather than the cancellation.
#[test]
fn a_cancellation_with_no_owned_job_accounting_is_a_failure() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let cancellation = ConversionCancellation::new();
    let act = write_partial_output;
    let runner = CancellingRunner::new(&act)
        .requesting(cancellation.request_handle())
        .reporting(Termination::Cancelled)
        .leaving_active_processes(None);

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::CancellationFailed(failure) = &attempt else {
        panic!("an unconfirmed owned tree is not a cancellation: {attempt:?}");
    };
    assert_eq!(failure.cause(), BackendExecutionFailure::NotTerminated);
    assert!(attempt.finalized().is_none());
    assert!(
        entry_names(&fixture.root).is_empty(),
        "an unconfirmed cancellation left something in the destination root"
    );
}

/// A refusal inside the runner is not a terminated process, and the report says
/// so rather than attributing process facts to a process that never existed.
///
/// This is the ordinary race window: the request arrives after the run has made
/// its staging area and before the runner spawns anything. The staging area is
/// real and empty, and both of those are reported.
#[test]
fn a_refusal_inside_the_runner_reports_no_backend_and_an_empty_staging_area() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let cancellation = ConversionCancellation::new();
    let act = |_spec: &CommandSpec| Ok(0);
    let runner = CancellingRunner::new(&act)
        .requesting(cancellation.request_handle())
        .reporting(Termination::NotStarted)
        .leaving_active_processes(None);

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::Cancelled(report) = &attempt else {
        panic!("a refusal before launch is a cancellation: {attempt:?}");
    };
    assert_eq!(report.observation(), CancellationObservation::DuringRun);
    assert!(
        !report.backend_was_run(),
        "no process ran, so no backend facts may be reported"
    );
    assert_eq!(report.backend(), None);
    assert_eq!(report.surviving_processes(), None);
    let staged = report
        .staged_content()
        .expect("the staging area existed and was observed");
    assert_eq!(staged.entry_count(), 0);
    assert!(!staged.non_empty_file_observed());
    assert_eq!(report.residue(), None);
    assert!(
        entry_names(&fixture.root).is_empty(),
        "a refused run left something in the destination root"
    );
}

/// The ordering rule, from the completed side. A request that arrives after the
/// process was observed to exit does not relabel the run, and does not stop the
/// document it produced from taking its name.
#[test]
fn a_request_that_arrives_after_a_natural_exit_still_finalizes_the_conversion() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let cancellation = ConversionCancellation::new();
    let act = convert_faithfully;
    let runner = CancellingRunner::new(&act).requesting(cancellation.request_handle());

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::Completed(report) = &attempt else {
        panic!("a natural exit is a completed run: {attempt:?}");
    };
    assert!(matches!(
        report.outcome(),
        ConversionRunOutcome::Finalized(_)
    ));
    assert!(attempt.finalized().is_some());
    assert_eq!(attempt.stable_id(), "finalized");
    assert_eq!(entry_names(&fixture.root).len(), 1);
}

/// A backend that failed on its own keeps the reason that is true of it.
#[test]
fn a_natural_backend_failure_is_never_relabelled_as_a_cancellation() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let cancellation = ConversionCancellation::new();
    let act = |spec: &CommandSpec| {
        write_partial_output(spec)?;
        Ok(2)
    };
    let runner = CancellingRunner::new(&act).requesting(cancellation.request_handle());

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::Completed(report) = &attempt else {
        panic!("a backend that exited on its own is a completed run: {attempt:?}");
    };
    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::BackendRejected { exit_code: Some(2) })
    );
    assert!(
        entry_names(&fixture.root).is_empty(),
        "a rejected backend's partial output was finalized"
    );
}

/// A launch failure that coincides with a request keeps its own reason.
#[test]
fn a_launch_failure_under_a_request_is_not_reported_as_a_cancellation() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let cancellation = ConversionCancellation::new();
    let request = cancellation.request_handle();
    let act = |_spec: &CommandSpec| {
        request.request();
        Err(ProcessError::Launch {
            executable: "msconvert.exe".to_owned(),
            kind: LaunchFailureKind::PermissionDenied,
            detail: "access denied".to_owned(),
        })
    };
    let runner = CancellingRunner::new(&act);

    let attempt = run_conversion_cancellable(&fixture.plan, &capabilities(), &runner, cancellation);

    let ConversionAttempt::Completed(report) = &attempt else {
        panic!("a launch failure is not a cancellation: {attempt:?}");
    };
    assert_eq!(
        report.outcome().detailed_stable_id(),
        "backend_not_launched"
    );
}

/// A cancellation object nobody asked to cancel changes nothing at all.
#[test]
fn an_unrequested_cancellation_object_leaves_the_run_exactly_as_it_was() {
    let uncancellable = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let plain = run_conversion(&uncancellable.plan, &capabilities(), &FakeRunner::new(&act));

    let cancellable = fixture("sample.mzML", ConflictPolicy::Fail);
    let attempt = run_conversion_cancellable(
        &cancellable.plan,
        &capabilities(),
        &FakeRunner::new(&act),
        ConversionCancellation::new(),
    );

    let ConversionAttempt::Completed(report) = &attempt else {
        panic!("an unrequested attempt is a completed run: {attempt:?}");
    };
    assert_eq!(plain.outcome().stable_id(), report.outcome().stable_id());
    assert_eq!(plain.backend(), report.backend());
    assert_eq!(plain.residue(), report.residue());
    assert_eq!(entry_names(&cancellable.root).len(), 1);
}

/// A substituted runner that reports a non-ordinary termination without a
/// request is still reporting a run that did not complete, whether or not a
/// cancellation object is present.
#[test]
fn an_unrequested_non_ordinary_termination_is_still_not_a_cancellation() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let act = convert_faithfully;
    let runner = CancellingRunner::new(&act).reporting(Termination::Cancelled);

    let attempt = run_conversion_cancellable(
        &fixture.plan,
        &capabilities(),
        &runner,
        ConversionCancellation::new(),
    );

    let ConversionAttempt::Completed(report) = &attempt else {
        panic!("an unrequested termination is not a cancellation: {attempt:?}");
    };
    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::BackendDidNotComplete)
    );
    assert!(entry_names(&fixture.root).is_empty());
}

/// A destination the plan refuses is refused before a cancellation object can
/// change anything, and what holds the name is not touched.
#[test]
fn a_cancellable_attempt_never_disturbs_an_existing_destination() {
    let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
    let destination = fixture.root.join("sample.mzML");
    fs::write(&destination, b"the user's own file").expect("occupy the destination");
    let act = convert_faithfully;
    let runner = CancellingRunner::new(&act);

    let attempt = run_conversion_cancellable(
        &fixture.plan,
        &capabilities(),
        &runner,
        ConversionCancellation::new(),
    );

    let ConversionAttempt::Completed(report) = &attempt else {
        panic!("an occupied destination is a completed run: {attempt:?}");
    };
    assert_eq!(
        *report.outcome(),
        ConversionRunOutcome::Failed(ConversionRunFailure::DestinationExists)
    );
    assert_eq!(runner.calls(), 0, "a refused plan reached the backend");
    assert_eq!(
        fs::read(&destination).expect("read the occupant"),
        b"the user's own file"
    );
}

/// Every attempt renders a distinct identifier, and nothing it renders is a
/// path, a name or a process identifier.
#[test]
fn every_attempt_renders_a_distinct_identifier_and_no_path() {
    let cancelled = CancellationReportFixture::cancelled();
    let failed = CancellationFailureFixture::failed();
    let ids = [
        cancelled.before_run.stable_id(),
        cancelled.during_run.stable_id(),
        failed.attempt.stable_id(),
    ];
    let unique = ids.iter().collect::<BTreeSet<_>>();
    assert_eq!(unique.len(), ids.len(), "{ids:?}");

    let rendered = format!(
        "{:?} {:?} {:?}",
        cancelled.before_run, cancelled.during_run, failed.attempt
    );
    assert!(!rendered.contains('/'), "{rendered}");
    assert!(!rendered.contains('\\'), "{rendered}");
    assert!(!rendered.contains("sample"), "{rendered}");
    assert!(!rendered.contains("mzML"), "{rendered}");
}

struct CancellationReportFixture {
    before_run: ConversionAttempt,
    during_run: ConversionAttempt,
}

struct CancellationFailureFixture {
    attempt: ConversionAttempt,
}

impl CancellationReportFixture {
    fn cancelled() -> Self {
        let refused = fixture("sample.mzML", ConflictPolicy::Fail);
        let refused_cancellation = ConversionCancellation::new();
        refused_cancellation.request_handle().request();
        let act = write_partial_output;
        let before_run = run_conversion_cancellable(
            &refused.plan,
            &capabilities(),
            &FakeRunner::new(&act),
            refused_cancellation,
        );

        let running = fixture("sample.mzML", ConflictPolicy::Fail);
        let cancellation = ConversionCancellation::new();
        let runner = CancellingRunner::new(&act)
            .requesting(cancellation.request_handle())
            .reporting(Termination::Cancelled);
        let during_run =
            run_conversion_cancellable(&running.plan, &capabilities(), &runner, cancellation);

        Self {
            before_run,
            during_run,
        }
    }
}

impl CancellationFailureFixture {
    fn failed() -> Self {
        let fixture = fixture("sample.mzML", ConflictPolicy::Fail);
        let cancellation = ConversionCancellation::new();
        let request = cancellation.request_handle();
        let act = |spec: &CommandSpec| {
            write_partial_output(spec)?;
            request.request();
            Err(ProcessError::Terminate {
                detail: "refused".to_owned(),
            })
        };
        let runner = CancellingRunner::new(&act);
        Self {
            attempt: run_conversion_cancellable(
                &fixture.plan,
                &capabilities(),
                &runner,
                cancellation,
            ),
        }
    }
}

/// A retention of a real file, built the way finalization builds one.
///
/// Writes a genuine output document so the inspection that produces the
/// validated facts is the production one, not a stand-in for it.
#[cfg(windows)]
fn retained_output(directory: &Path, name: &str) -> (PathBuf, FinalizedOutput) {
    let path = directory.join(name);
    fs::write(&path, output_document()).expect("write an output to retain");
    let (file, valid) = crate::conversion::ValidatedConversionOutput::retainable_for_test(&path)
        .expect("inspect the output written for this test");
    let retained = FinalizedOutput::retain(&file, valid).expect("retain the finalized output");
    (path, retained)
}

/// The object opened at a name, as an adoption would open it.
#[cfg(windows)]
fn current_object(path: &Path) -> fs::File {
    fs::File::open(path).expect("open the current object at that name")
}

/// The whole point of retaining anything: the same object, unchanged, is
/// recognised -- and recognised again, because a check that consumed its answer
/// would be a one-shot the adoption path could not repeat.
#[cfg(windows)]
#[test]
fn a_finalized_output_still_matches_itself() {
    let directory = TestDirectory::new();
    let (path, retained) = retained_output(directory.path(), "alpha.mzML");

    assert_eq!(retained.still_matches(&current_object(&path)), Ok(()));
    assert_eq!(retained.still_matches(&current_object(&path)), Ok(()));
}

/// A different object at the same name is refused even when its bytes are
/// identical, because a name is not an identity.
#[cfg(windows)]
#[test]
fn another_object_at_the_final_name_is_not_the_finalized_one() {
    let directory = TestDirectory::new();
    let (path, retained) = retained_output(directory.path(), "alpha.mzML");

    // Moved aside rather than removed, so the refusal cannot be an accident of
    // the original having ceased to exist.
    let aside = directory.path().join("moved-aside.mzML");
    fs::rename(&path, &aside).expect("move the finalized output aside");
    fs::write(&path, output_document()).expect("write a byte-identical impostor");

    assert_eq!(
        retained.still_matches(&current_object(&path)),
        Err(OutputDrift::DifferentObject),
        "identical content is not identity"
    );
    // The impostor is left exactly as it was found.
    assert_eq!(
        fs::read_to_string(&path).expect("read the impostor"),
        output_document()
    );
}

/// The same object holding different bytes is refused.
///
/// Reachable only because the retention deliberately permits writers, so this
/// proves the posture as much as the comparison: a retention that forbade them
/// would fail at the open instead, and this case would be unreachable.
#[cfg(windows)]
#[test]
fn the_same_object_with_rewritten_bytes_is_refused() {
    use std::io::Write as _;

    let directory = TestDirectory::new();
    let (path, retained) = retained_output(directory.path(), "alpha.mzML");

    let mut writing = fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .expect("the retention permits the user to write their own file");
    let rewritten = output_document().replace("scan=1", "scan=9");
    assert_eq!(
        rewritten.len(),
        output_document().len(),
        "this case is about content, so the length must not be what differs"
    );
    writing
        .write_all(rewritten.as_bytes())
        .expect("rewrite in place");
    drop(writing);

    assert_eq!(
        retained.still_matches(&current_object(&path)),
        Err(OutputDrift::ContentChanged),
        "the same object is not the same bytes"
    );
}

/// A rewrite that also changes the length is separated from one that does not,
/// because the cheap half of the comparison runs first.
#[cfg(windows)]
#[test]
fn the_same_object_at_a_different_length_is_refused() {
    let directory = TestDirectory::new();
    let (path, retained) = retained_output(directory.path(), "alpha.mzML");

    fs::write(&path, b"<mzML/>").expect("truncate in place");

    assert_eq!(
        retained.still_matches(&current_object(&path)),
        Err(OutputDrift::ByteLengthChanged)
    );
}

/// The retention keeps the object alive, so nothing else can be issued its
/// identity while MSCanvas is still talking about it.
#[cfg(windows)]
#[test]
fn a_retained_output_outlives_its_own_name() {
    let directory = TestDirectory::new();
    let (path, retained) = retained_output(directory.path(), "alpha.mzML");
    let identity = retained.retained_identity().expect("the object answers");

    // Deleting is the user's to do, and the retention permits it.
    fs::remove_file(&path).expect("the retention permits deletion");
    assert!(!path.exists());
    assert_eq!(
        retained
            .retained_identity()
            .expect("the object outlives its directory entry"),
        identity
    );

    // So a new file at that name is necessarily a different object.
    fs::write(&path, output_document()).expect("write a new file at that name");
    assert_ne!(
        super::object_identity(&current_object(&path)).expect("identify the new file"),
        identity
    );
    assert_eq!(
        retained.still_matches(&current_object(&path)),
        Err(OutputDrift::DifferentObject)
    );
}

/// Dropping a retention closes a handle and does nothing else. The output is
/// the user's file, in the folder they chose.
#[cfg(windows)]
#[test]
fn dropping_a_retention_leaves_the_output_where_it_is() {
    let directory = TestDirectory::new();
    let (path, retained) = retained_output(directory.path(), "alpha.mzML");
    drop(retained);

    assert_eq!(
        fs::read_to_string(&path).expect("the output survives the retention"),
        output_document()
    );
}

/// Neither the handle nor the place on disk may be rendered.
#[cfg(windows)]
#[test]
fn a_retention_renders_nothing_about_the_object() {
    let directory = TestDirectory::new();
    let (_path, retained) = retained_output(directory.path(), "alpha.mzML");

    let rendered = format!("{retained:?}");
    assert!(rendered.contains("<opaque-finalized-output>"));
    assert!(!rendered.contains("alpha"));
    for separator in ['\\', '/'] {
        assert!(
            !rendered.contains(separator),
            "a rendered retention carries no path: {rendered}"
        );
    }
}
