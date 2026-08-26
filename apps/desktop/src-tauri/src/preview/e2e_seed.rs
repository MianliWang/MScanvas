//! One synthetic selected spectrum, for the rendered tests that need a real one.
//!
//! Compiled in only under the non-default `e2e` feature.
//!
//! ## Why this exists
//!
//! M4.1 could prove that a save dialog can be found and dismissed by automation,
//! and could not prove the thing that actually matters: that pressing `Export
//! PNG…` in the real application opens the real dialog, runs the real writer and
//! leaves a real file on disk. The obstacle was never the dialog. It was that
//! reaching an export needs a loaded spectrum, loading one needs a ProteoWizard
//! installation and an mzML file, and a QA machine has neither -- so Rust held
//! no snapshot and the export refused the stale token long before a dialog could
//! open.
//!
//! This closes exactly that gap and nothing else. It installs one spectrum into
//! the ordinary slot. Everything after that -- the token, `begin`, `claim`, the
//! `FigureSpec`, the SVG, the rasterizer, the encoder, the dialog, the
//! no-clobber writer -- is the production path, unmodified and untested-around.
//!
//! ## What it deliberately is not
//!
//! It is not a command. There is nothing to register, nothing the webview can
//! call, and therefore nothing to accidentally leave reachable: the registration
//! list is byte-identical in every build. It takes no arguments at all, so there
//! is no path to pass it, no command name to smuggle through it and no size to
//! exhaust a machine with. And it is not a renderer or a writer -- the one thing
//! it produces is a `SelectedSpectrumResult`, built by the same parser that
//! reads a real backend's output, from bytes shaped exactly as that backend
//! writes them.
//!
//! It does not prove ProteoWizard source loading. It was never meant to: what it
//! closes is the export and save residual, which is what M4.1 left unproved.

use mscanvas_proteowizard::{
    PreviewOperation, PreviewOutcome, PreviewOutputManifest, PreviewValue, ProcessOutput,
    Termination, interpret_preview,
};

use super::backend::SELECTED_SPECTRUM_PRECISION;
use super::chromatogram::ChromatogramSource;
use super::selection::DatasetId;
use super::service::PreviewService;

/// How many points the seeded spectrum carries.
///
/// Enough for a figure with real geometry -- peaks, a baseline and a negative --
/// and few enough that a rasterization at any accepted size is instant. A
/// rendered test is measuring the path, not the arithmetic.
const SEEDED_POINTS: u64 = 64;

/// Which dataset the seeded spectrum claims to have come from.
///
/// No workspace row has this identity, and none can: identities are allocated
/// from one upward and a session would have to interpret `u64::MAX` spectra to
/// reach it. So removing a real row never revokes the seeded spectrum, and the
/// seeded spectrum never impersonates a real one.
fn seeded_owner() -> DatasetId {
    DatasetId::parse(&format!("file-{}", u64::MAX)).expect("a well-formed handle")
}

/// The backend output one selected spectrum read produces.
///
/// Shaped as `msaccess` writes it, because that is what the production parser
/// reads. Nothing here is a shortcut around the parser: if this text were
/// malformed the seed would fail exactly as a real malformed read does.
fn synthetic_output() -> String {
    let mut text = String::from("# mscanvas-e2e.mzML\n#\n");
    text.push_str(&format!("# index: {SEEDED_SELECTED_INDEX}\n"));
    text.push_str(&format!("# id: scan={SEEDED_FIRST_SCAN_NUMBER}\n"));
    text.push_str(&format!("# scanNumber: {SEEDED_FIRST_SCAN_NUMBER}\n"));
    text.push_str("# massAnalyzerType: FTMS\n");
    text.push_str("# scanEvent: 1\n");
    text.push_str("# msLevel: 1\n");
    text.push_str(&format!(
        "# retentionTime: {SEEDED_FIRST_RETENTION_TIME:.2}\n"
    ));
    text.push_str("# filterString: synthetic\n");
    text.push_str("# mzLow: 100\n");
    text.push_str("# mzHigh: 1000\n");
    text.push_str("# basePeakMZ: 445.12000000\n");
    text.push_str("# basePeakIntensity: 9000.00000000\n");
    text.push_str("# totalIonCurrent: 120000.00000000\n");
    text.push_str("# precursorCount: 0\n");
    text.push_str(&format!("# binary ({SEEDED_POINTS}):\n"));
    for step in 0..SEEDED_POINTS {
        let mz = 100.0 + (step as f64) * 12.5;
        // A shape rather than a ramp: peaks that rise and fall, and one measured
        // negative, so a rendered figure has something to be wrong about.
        let intensity = match step % 8 {
            0 => 9_000.0 - (step as f64) * 40.0,
            3 => -250.0,
            5 => 4_500.0,
            _ => 120.0,
        };
        text.push_str(&format!("{mz:.8} {intensity:.8}\n"));
    }
    text
}

/// The process a synthetic read would have been.
fn completed_process() -> ProcessOutput {
    ProcessOutput {
        stdout: Vec::new(),
        stderr: Vec::new(),
        stdout_total_bytes: 0,
        stderr_total_bytes: 0,
        stdout_truncated: false,
        stderr_truncated: false,
        exit_code: Some(0),
        elapsed: std::time::Duration::from_millis(1),
        termination: Termination::Exited,
        max_active_processes: None,
        final_active_processes: None,
        peak_job_memory_bytes: None,
    }
}

/// How many scans the seeded run holds.
///
/// Enough that a current range can contain some of them and not others, and few
/// enough that every document this produces is instant to write.
const SEEDED_SCANS: u64 = 24;

/// Which scan of the seeded run the seeded spectrum is.
///
/// Zero, because it is the run's first, and named rather than written out so the
/// two halves of this seed cannot drift apart silently.
const SEEDED_SELECTED_INDEX: u64 = 0;

/// The scan number the seeded run's first scan reports.
///
/// The seeded spectrum's own, which is what makes the pair a pair: the linked
/// figure reconciles a spectrum against the retained row at its index, by
/// identity, and two halves that named different scans could never be linked.
/// Before M4.4 nothing asked, and the seed's table numbered its scans from one
/// while its spectrum called itself nineteen.
const SEEDED_FIRST_SCAN_NUMBER: u64 = 19;

/// Where the seeded run's first scan sits.
///
/// The seeded spectrum's own retention time, for the same reason. Non-zero on
/// purpose: it is the coordinate a linked figure's marker is drawn at, and a
/// zero would be indistinguishable from a number nobody supplied.
const SEEDED_FIRST_RETENTION_TIME: f64 = 0.10;

/// The backend output one spectrum-table read produces.
///
/// Shaped as `msaccess` writes it, and read by the production parser -- the same
/// one a real preview goes through. The retention times ascend by a hundredth so
/// a rendered test can name a range and know which scans are inside it.
///
/// The first row **is** the seeded spectrum's row: the same scan number, the
/// same retention time and the same measured summary. A session that had read
/// that spectrum from this table would have reconciled the two, and a seed whose
/// halves described different scans is a seed no linked figure can be made from.
fn synthetic_table() -> String {
    let mut text = String::from("# mscanvas-e2e.mzML\n");
    text.push_str(
        "index\tid\tevent\tanalyzer\tmsLevel\trt\tmzLow\tmzHigh\tbasePeakMZ\tbasePeakInt\tTIC\t\
         charge\tprecursorMZ\tthermo_monoMZ\tfilterStringMZ\tionInjectionTime\n",
    );
    for index in 0..SEEDED_SCANS {
        let retention_time =
            SEEDED_FIRST_RETENTION_TIME + f64::from(u32::try_from(index).unwrap_or(0)) / 100.0;
        let selected = index == SEEDED_SELECTED_INDEX;
        let (base_peak_mz, base_peak, total_ion_current) = if selected {
            ("445.12", 9_000, 120_000)
        } else {
            ("500", 100 + index, 1_000 + index * 10)
        };
        text.push_str(&format!(
            "{index}\tscan={}\t1\tFTMS\tms1\t{retention_time}\t100\t1000\t{base_peak_mz}\t\
             {base_peak}\t{total_ion_current}\t\t\t\t\t\n",
            index + SEEDED_FIRST_SCAN_NUMBER,
        ));
    }
    text
}

/// The synthetic run, read through the production parser and the ordinary
/// eligibility.
///
/// A truncated or unreadable run would be refused here exactly as a real one is,
/// so what a rendered test reaches is the shipped path with a real snapshot
/// behind it rather than a shortcut around one.
fn seeded_chromatogram(service: &PreviewService) -> ChromatogramSource {
    let manifest = PreviewOutputManifest::single_complete_file(synthetic_table().into_bytes());
    let outcome = interpret_preview(
        &PreviewOperation::SpectrumTable,
        &completed_process(),
        &manifest,
    )
    .expect("the seeded table parses through the production interpreter");
    let PreviewOutcome::Value(value) = outcome else {
        panic!("a seeded table read produces a value");
    };
    let PreviewValue::SpectrumTable(table) = *value else {
        panic!("a seeded table read produces a spectrum table");
    };
    let rows = service.retained_rows_for_seed(&table);
    ChromatogramSource::from_rows(&rows, false)
        .expect("the seeded run is one the viewer would draw")
}

/// The synthetic spectrum, read the same way.
fn seeded_spectrum() -> mscanvas_proteowizard::SelectedSpectrumResult {
    let manifest = PreviewOutputManifest::single_complete_file(synthetic_output().into_bytes());
    let outcome = interpret_preview(
        &PreviewOperation::SpectrumByIndex {
            index: SEEDED_SELECTED_INDEX,
            precision: SELECTED_SPECTRUM_PRECISION,
        },
        &completed_process(),
        &manifest,
    )
    .expect("the seeded output parses through the production interpreter");
    let PreviewOutcome::Value(value) = outcome else {
        panic!("a seeded spectrum read produces a value");
    };
    let PreviewValue::SelectedSpectrum(spectrum) = *value else {
        panic!("a seeded spectrum read produces a selected spectrum");
    };
    spectrum
}

/// Installs one synthetic run and one synthetic spectrum of it.
///
/// Called once, at startup, under this feature only. The tokens are the
/// session's first and second, which is what lets a rendered test name them --
/// and if either were ever wrong the export would refuse it as stale rather than
/// write something else, so the test fails loudly rather than quietly passing.
///
/// **The two halves are checked to be one scan before either is installed.** A
/// seed whose spectrum did not reconcile with its own run's row would leave
/// every linked figure refused for a reason no rendered test could act on, and
/// nothing asked until M4.4: the table numbered its scans from one while the
/// spectrum called itself nineteen, and both halves worked perfectly on their
/// own. Asserted here, at the one place that builds both, so a later edit to
/// either fails the application's own startup rather than one distant test.
pub(super) fn install(service: &PreviewService) {
    let spectrum = seeded_spectrum();
    let source = seeded_chromatogram(service);
    assert!(
        source.row_for_spectrum(&spectrum).is_some(),
        "the seeded spectrum and the seeded run's row at its index describe one scan"
    );
    service.install_seeded_spectrum(seeded_owner(), spectrum);
    // After the spectrum, so the tokens are the session's first and second.
    service.install_seeded_chromatogram(seeded_owner(), source);
}
