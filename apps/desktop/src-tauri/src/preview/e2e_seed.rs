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
//! it produces is a `SelectedSpectrumResult`, read by the same native mzML reader
//! a real preview uses (ADR 0056), from an mzML document held in memory.
//!
//! It does not prove source loading from disk. It was never meant to: what it
//! closes is the export and save residual, which is what M4.1 left unproved.

use std::io::Cursor;

use mscanvas_proteowizard::{
    MzmlScanLimits, MzmlSpectrumTable, SelectedSpectrumResult, read_selected_spectrum_from,
    read_spectrum_table_from,
};

use super::chromatogram::ChromatogramSource;
use super::mzml_fixture::{FixtureSpectrum, document};
use super::selection::DatasetId;
use super::service::PreviewService;

/// How many points the seeded spectrum carries.
///
/// Enough for a figure with real geometry -- peaks, a baseline and a negative --
/// and few enough that a rasterization at any accepted size is instant. A
/// rendered test is measuring the path, not the arithmetic.
const SEEDED_POINTS: u32 = 64;

/// Which dataset the seeded spectrum claims to have come from.
///
/// No workspace row has this identity, and none can: identities are allocated
/// from one upward and a session would have to interpret `u64::MAX` spectra to
/// reach it. So removing a real row never revokes the seeded spectrum, and the
/// seeded spectrum never impersonates a real one.
fn seeded_owner() -> DatasetId {
    DatasetId::parse(&format!("file-{}", u64::MAX)).expect("a well-formed handle")
}

/// How many scans the seeded run holds.
///
/// Enough that a current range can contain some of them and not others, and few
/// enough that every document this produces is instant to write.
const SEEDED_SCANS: u32 = 24;

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
const SEEDED_FIRST_SCAN_NUMBER: u32 = 19;

/// Where the seeded run's first scan sits.
///
/// Non-zero on purpose: it is the coordinate a linked figure's marker is drawn
/// at, and a zero would be indistinguishable from a number nobody supplied.
const SEEDED_FIRST_RETENTION_TIME: f64 = 0.10;

/// The seeded run as an mzML document.
///
/// The retention times ascend by a hundredth so a rendered test can name a
/// range and know which scans are inside it, and declare no unit, as the
/// rendered tests have always expected. The first scan is the seeded spectrum:
/// a shape rather than a ramp -- peaks that rise and fall, and one measured
/// negative -- so a rendered figure has something to be wrong about.
fn synthetic_document() -> String {
    let spectra: Vec<FixtureSpectrum> = (0..SEEDED_SCANS)
        .map(|index| {
            let retention_time = SEEDED_FIRST_RETENTION_TIME + f64::from(index) / 100.0;
            let id = format!("scan={}", index + SEEDED_FIRST_SCAN_NUMBER);
            if u64::from(index) == SEEDED_SELECTED_INDEX {
                let points: Vec<(f64, f64)> = (0..SEEDED_POINTS)
                    .map(|step| {
                        let intensity = match step % 8 {
                            0 => 9_000.0 - f64::from(step) * 40.0,
                            3 => -250.0,
                            5 => 4_500.0,
                            _ => 120.0,
                        };
                        (100.0 + f64::from(step) * 12.5, intensity)
                    })
                    .collect();
                FixtureSpectrum::new(id, 1, retention_time, (445.12, 9_000.0), 120_000.0, &points)
            } else {
                FixtureSpectrum::new(
                    id,
                    1,
                    retention_time,
                    (500.0, f64::from(100 + index)),
                    f64::from(1_000 + index * 10),
                    &[(500.0, f64::from(100 + index))],
                )
            }
        })
        .collect();
    document(&spectra)
}

/// The seeded run's table, read by the production reader.
fn seeded_table(document: &str) -> MzmlSpectrumTable {
    read_spectrum_table_from(Cursor::new(document.as_bytes()), MzmlScanLimits::default())
        .expect("the seeded run opens through the production reader")
}

/// The synthetic run, read through the production reader and the ordinary
/// eligibility.
///
/// A truncated or unreadable run would be refused here exactly as a real one is,
/// so what a rendered test reaches is the shipped path with a real snapshot
/// behind it rather than a shortcut around one.
fn seeded_chromatogram(service: &PreviewService, table: &MzmlSpectrumTable) -> ChromatogramSource {
    let rows = service.retained_rows_for_seed(table);
    ChromatogramSource::from_rows(&rows, false)
        .expect("the seeded run is one the viewer would draw")
}

/// The synthetic spectrum, read the same way, from the offset its table recorded.
fn seeded_spectrum(document: &str, table: &MzmlSpectrumTable) -> SelectedSpectrumResult {
    SelectedSpectrumResult::from_native(
        read_selected_spectrum_from(
            Cursor::new(document.as_bytes()),
            table,
            SEEDED_SELECTED_INDEX,
        )
        .expect("the seeded spectrum decodes through the production reader"),
    )
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
/// every linked figure refused for a reason no rendered test could act on.
/// Asserted here, at the one place that builds both, so a later edit to either
/// fails the application's own startup rather than one distant test.
pub(super) fn install(service: &PreviewService) {
    let document = synthetic_document();
    let table = seeded_table(&document);
    let spectrum = seeded_spectrum(&document, &table);
    let source = seeded_chromatogram(service, &table);
    assert!(
        source.row_for_spectrum(&spectrum).is_some(),
        "the seeded spectrum and the seeded run's row at its index describe one scan"
    );
    service.install_seeded_spectrum(seeded_owner(), spectrum);
    // After the spectrum, so the tokens are the session's first and second.
    service.install_seeded_chromatogram(seeded_owner(), source);
}

#[cfg(test)]
mod tests {
    use super::super::idle_provider::NoProcess;
    use super::*;

    /// The seed runs at the rendered build's startup, where a refusal is a
    /// panic before any test can look: read it once here instead.
    #[test]
    fn the_seed_installs_one_reconciled_pair() {
        install(&PreviewService::new(Box::new(NoProcess)));
    }
}
