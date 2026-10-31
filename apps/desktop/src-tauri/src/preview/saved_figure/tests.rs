//! Saved figures: the document, its checks, the source identity and the
//! regeneration (ADR 0062).
//!
//! Every test writes a real source file and a real document into its own
//! temporary folder, because the identity a document records is the SHA-256 of
//! actual bytes and the writer it is saved through is the export's own. What
//! is substituted is only the reader that turns those bytes into a spectrum
//! table and a spectrum: a fixed one, standing in for the preview's.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use mscanvas_plot_spec::svg::render;

use super::*;
use crate::preview::dto::dataset_not_previewable;

/// The bytes every test's source holds. What they say does not matter: the
/// reader below is fixed, and the document records only their length and
/// digest.
const SOURCE: &[u8] = b"<mzML>a stand-in for the acquisition the reader is asked about</mzML>\n";

/// The source's file name, inside each test's folder.
const SOURCE_NAME: &str = "run.mzML";

const SPECTRUM_GOLDEN: &str =
    include_str!("../../../../../../fixtures/plot-golden/spectrum-full-source.svg");
const CHROMATOGRAM_FULL_GOLDEN: &str =
    include_str!("../../../../../../fixtures/plot-golden/chromatogram-full-run.svg");
const CHROMATOGRAM_CURRENT_GOLDEN: &str =
    include_str!("../../../../../../fixtures/plot-golden/chromatogram-current-range.svg");
const LINKED_GOLDEN: &str =
    include_str!("../../../../../../fixtures/plot-golden/linked-full-run.svg");
const PINNED_DOCUMENT: &str =
    include_str!("../../../../../../fixtures/saved-figure-golden/linked-full-run.msfigure");

// ------------------------------------------------------------------ fixtures

/// One edit to a document read as plain JSON.
type JsonEdit = fn(&mut serde_json::Value);

/// One edit to a document's wire shape, before it is sealed again.
type WireEdit = fn(&mut WireDocument);

static NEXT_FOLDER: AtomicU64 = AtomicU64::new(0);

/// One test's own folder, removed when the test ends.
struct Folder(PathBuf);

impl Folder {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "mscanvas-saved-figure-{label}-{}-{}",
            std::process::id(),
            NEXT_FOLDER.fetch_add(1, Ordering::Relaxed),
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("a temporary folder");
        Self(path)
    }

    /// A folder holding the source, as every save below starts from.
    fn with_source(label: &str) -> Self {
        let folder = Self::new(label);
        folder.write(SOURCE_NAME, SOURCE);
        folder
    }

    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.path(name);
        std::fs::write(&path, bytes).expect("a file in the temporary folder");
        path
    }

    fn source(&self) -> PathBuf {
        self.path(SOURCE_NAME)
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A view-cache root that does not exist, and so holds nothing: what every
/// save outside the view-cache test is given.
fn no_view_cache() -> PathBuf {
    std::env::temp_dir().join(format!(
        "mscanvas-saved-figure-no-view-cache-{}",
        std::process::id()
    ))
}

/// One retained table row: index, scan number, retention time, TIC, BPC.
///
/// The one place a test builds a row, so a change to the row's test
/// constructor is a change here and nowhere else.
fn row(index: u64, scan: u64, retention_time: f64, tic: f64, bpc: f64) -> TableRowFacts {
    TableRowFacts::for_test(
        index,
        Some(scan),
        1,
        retention_time,
        mscanvas_proteowizard::RetentionTimeUnitState::NotDeclared,
        tic,
        bpc,
    )
}

/// The run `fixtures/plot-golden`'s chromatogram documents were rendered from.
fn golden_rows() -> Arc<Vec<TableRowFacts>> {
    Arc::new(vec![
        row(0, 1, 9.0, 9_000_000.0, 10.0),
        row(1, 2, 10.0, 90.0, 20.0),
        row(2, 3, 11.0, 100.0, 30.0),
        row(3, 4, 12.0, 110.0, 40.0),
        row(4, 5, 13.0, 120.0, 50.0),
    ])
}

/// The spectrum `spectrum-full-source.svg` was rendered from.
fn golden_spectrum() -> SelectedSpectrumResult {
    SelectedSpectrumResult::from_points_for_tests(
        7,
        vec![100.5, 200.25, 300.0, 400.125, 500.0],
        vec![10.0, 90.0, 0.0, 45.5, 22.25],
    )
}

/// The scan `linked-full-run.svg` draws below the chromatogram.
fn selected_scan() -> SelectedSpectrumResult {
    SelectedSpectrumResult::from_points_for_tests(
        2,
        vec![100.0, 200.0, 300.0, 400.0],
        vec![10.0, 90.0, 45.0, 22.0],
    )
}

/// A fixed reader: one table and the spectra it is asked for by index.
struct Reader {
    rows: Arc<Vec<TableRowFacts>>,
    spectra: Vec<SelectedSpectrumResult>,
    refuses: bool,
    /// Whether the table is one the preview shows truncated.
    truncated: bool,
    /// Whether each read reads the handle it is given to its end, as a real
    /// reader does, and checks it holds the bytes that were measured.
    reads_source: bool,
}

impl Reader {
    fn golden() -> Self {
        Self {
            rows: golden_rows(),
            spectra: vec![golden_spectrum(), selected_scan()],
            refuses: false,
            truncated: false,
            reads_source: false,
        }
    }

    fn read(&self, mut source: &File) -> Result<(), PreviewErrorDto> {
        if self.refuses {
            return Err(dataset_not_previewable());
        }
        if self.reads_source {
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut source, &mut bytes).expect("the held source reads");
            assert_eq!(bytes, SOURCE);
        }
        Ok(())
    }
}

impl FigureSourceReader for Reader {
    fn spectrum_table(&self, source: &File) -> Result<SourceTable, PreviewErrorDto> {
        self.read(source)?;
        Ok(SourceTable {
            rows: Arc::clone(&self.rows),
            truncated: self.truncated,
        })
    }

    fn spectrum(
        &self,
        source: &File,
        index: u64,
    ) -> Result<SelectedSpectrumResult, PreviewErrorDto> {
        self.read(source)?;
        self.spectra
            .iter()
            .find(|spectrum| spectrum.identity().index() == index)
            .cloned()
            .ok_or_else(dataset_not_previewable)
    }
}

/// The settings every pre-publication export used: 1200 x 640, light.
fn pixels() -> SavedFigureSettings {
    SavedFigureSettings::new(
        FigureTheme::Light,
        SavedSize::Pixels {
            width: 1_200,
            height: 640,
        },
        None,
        None,
        None,
        PngDpi::default(),
    )
    .expect("the default settings")
}

fn label(text: &str) -> Label {
    Label::new(text).expect("a label")
}

fn chromatogram() -> ChromatogramSource {
    ChromatogramSource::from_rows(&golden_rows(), false).expect("an exportable run")
}

fn resolved(source: &ChromatogramSource, range: SavedRetentionTimeRange) -> ResolvedRange {
    source
        .resolve(range.request().expect("a request"))
        .expect("a range inside the run")
}

fn both() -> TraceSet {
    TraceSet::from_wire(true, true)
}

fn window(low: f64, high: f64) -> Domain {
    Domain::new(low, high).expect("an interval")
}

/// One figure kind, the figure its own export draws, and the pinned document
/// that export writes.
struct Case {
    name: &'static str,
    kind: SavedFigureKind,
    shown: FigureSpec,
    golden: &'static str,
}

/// Every figure kind a user can save, each built by its export's own call.
fn cases() -> Vec<Case> {
    let source = chromatogram();
    let settings = FigureRenderSettings::default();
    let full = SavedRetentionTimeRange::Full;
    let current = SavedRetentionTimeRange::Current(window(10.0, 13.0));
    let scan = selected_scan();
    let row = source.row_for_spectrum(&scan).expect("a scan of the run");
    vec![
        Case {
            name: "spectrum",
            kind: SavedFigureKind::Spectrum {
                index: 7,
                range: ResolvedSpectrumRange::Full,
            },
            shown: spectrum_figure(&golden_spectrum(), settings, ResolvedSpectrumRange::Full)
                .expect("a spectrum figure"),
            golden: SPECTRUM_GOLDEN,
        },
        Case {
            name: "chromatogram-full",
            kind: SavedFigureKind::Chromatogram {
                range: full,
                traces: both(),
            },
            shown: chromatogram_figure(&source, resolved(&source, full), both(), settings)
                .expect("a chromatogram figure"),
            golden: CHROMATOGRAM_FULL_GOLDEN,
        },
        Case {
            name: "chromatogram-current",
            kind: SavedFigureKind::Chromatogram {
                range: current,
                traces: both(),
            },
            shown: chromatogram_figure(&source, resolved(&source, current), both(), settings)
                .expect("a chromatogram figure"),
            golden: CHROMATOGRAM_CURRENT_GOLDEN,
        },
        Case {
            name: "linked",
            kind: SavedFigureKind::Linked {
                index: 2,
                range: full,
                traces: both(),
            },
            shown: linked_figure_spec(
                &source,
                &scan,
                row,
                resolved(&source, full),
                both(),
                settings,
            )
            .expect("a linked figure"),
            golden: LINKED_GOLDEN,
        },
    ]
}

/// Saves one case into `folder` under `name`, from the folder's source.
fn save_case(
    folder: &Folder,
    name: &str,
    case: &Case,
    reader: &Reader,
) -> Result<PathBuf, SaveRefusal> {
    let destination = folder.path(name);
    save(
        case.kind,
        pixels(),
        &folder.source(),
        &case.shown,
        reader,
        &destination,
        &no_view_cache(),
    )
    .map(|_| destination)
}

fn linked_case() -> Case {
    cases()
        .into_iter()
        .find(|case| case.name == "linked")
        .expect("the linked case")
}

fn spectrum_case() -> Case {
    cases()
        .into_iter()
        .find(|case| case.name == "spectrum")
        .expect("the spectrum case")
}

/// A saved document's wire shape, for a test that alters it.
fn wire_of(path: &Path) -> WireDocument {
    serde_json::from_slice(&std::fs::read(path).expect("the document")).expect("a document")
}

/// One canonical decimal, as a document spells it.
fn decimal(text: &str) -> DecimalValue {
    serde_json::from_value(serde_json::json!(text)).expect("a decimal")
}

// ------------------------------------------------------------------ round trip

/// Save then reopen gives back the pinned document of every figure kind.
///
/// The goldens are the bytes each export writes (`fixtures/plot-golden`), so a
/// reopened figure is the exported one byte for byte, and its specification is
/// the exported one value for value.
#[test]
fn every_figure_kind_reopens_to_its_pinned_document() {
    let reader = Reader::golden();
    for case in cases() {
        let folder = Folder::with_source(case.name);
        let document = save_case(&folder, "figure.msfigure", &case, &reader)
            .unwrap_or_else(|refusal| panic!("{} was not saved: {refusal:?}", case.name));
        let reopened = reopen(&document, &reader)
            .unwrap_or_else(|refusal| panic!("{} was not reopened: {refusal:?}", case.name));
        assert_eq!(reopened.figure(), &case.shown, "{}", case.name);
        assert_eq!(render(reopened.figure()), case.golden, "{}", case.name);
        assert_eq!(reopened.document().kind(), case.kind, "{}", case.name);
    }
}

/// A printed figure with the user's own words, in the dark theme, over a
/// committed m/z window, comes back as the same figure and the same settings.
#[test]
fn a_printed_figure_with_edited_words_reopens_byte_identical() {
    let reader = Reader::golden();
    let folder = Folder::with_source("printed");
    let print = PrintSize::new(85.0, 60.0, 7.0, 0.75).expect("a printed size");
    let settings = SavedFigureSettings::new(
        FigureTheme::Dark,
        SavedSize::Print {
            print,
            preset: PrintPreset::SingleColumn,
        },
        Some(label("Enolase, scan 7 \u{2014} \u{9009}\u{5B9A}")),
        None,
        Some(label("Signal")),
        PngDpi::from_wire(600).expect("a resolution"),
    )
    .expect("printed settings");
    let range = ResolvedSpectrumRange::Current(window(150.0, 450.0));
    let built = spectrum_figure(
        &golden_spectrum(),
        FigureRenderSettings::from_wire(1_200, 640, "dark").expect("settings"),
        range,
    )
    .expect("a spectrum figure");
    let shown = publication_figure(
        built,
        FigureSize::printed(print).expect("a printed size"),
        "Enolase, scan 7 \u{2014} \u{9009}\u{5B9A}",
        "",
        "Signal",
    )
    .expect("a publication figure");
    let kind = SavedFigureKind::Spectrum { index: 7, range };

    let destination = folder.path("printed.msfigure");
    save(
        kind,
        settings.clone(),
        &folder.source(),
        &shown,
        &reader,
        &destination,
        &no_view_cache(),
    )
    .expect("saved");
    let reopened = reopen(&destination, &reader).expect("reopened");

    assert_eq!(render(reopened.figure()), render(&shown));
    assert_eq!(reopened.figure(), &shown);
    let restored = reopened.document().settings();
    assert_eq!(restored, &settings);
    assert_eq!(restored.theme(), FigureTheme::Dark);
    assert_eq!(
        restored.size(),
        SavedSize::Print {
            print,
            preset: PrintPreset::SingleColumn
        }
    );
    assert_eq!(restored.raster_dpi().get(), 600);
}

/// A saved retention-time range is the range the export resolved, and asking
/// the same run to resolve it again gives back that range.
#[test]
fn a_saved_retention_time_range_resolves_back_to_itself() {
    let source = chromatogram();
    for range in [
        SavedRetentionTimeRange::Full,
        SavedRetentionTimeRange::Current(window(10.0, 13.0)),
        // A current range as wide as the run stays a current range.
        SavedRetentionTimeRange::Current(window(9.0, 13.0)),
    ] {
        let resolved = resolved(&source, range);
        assert_eq!(SavedRetentionTimeRange::of(resolved), range);
    }
}

/// A linked figure at a double-column printed size, and a refused edit: one
/// axis title for two panels whose axes differ is refused by the contract, so
/// nothing is saved.
#[test]
fn a_printed_linked_figure_reopens_and_an_ambiguous_axis_title_is_refused() {
    let reader = Reader::golden();
    let folder = Folder::with_source("printed-linked");
    let print = PrintSize::new(175.0, 120.0, 7.0, 0.75).expect("a printed size");
    let size = SavedSize::Print {
        print,
        preset: PrintPreset::DoubleColumn,
    };
    let case = linked_case();
    let shown = publication_figure(
        case.shown.clone(),
        FigureSize::printed(print).expect("a printed size"),
        "Run 7",
        "",
        "",
    )
    .expect("a publication figure");
    let settings = SavedFigureSettings::new(
        FigureTheme::Light,
        size,
        Some(label("Run 7")),
        None,
        None,
        PngDpi::default(),
    )
    .expect("printed settings");
    let destination = folder.path("linked.msfigure");
    save(
        case.kind,
        settings,
        &folder.source(),
        &shown,
        &reader,
        &destination,
        &no_view_cache(),
    )
    .expect("saved");
    assert_eq!(
        render(reopen(&destination, &reader).expect("reopened").figure()),
        render(&shown)
    );

    let ambiguous = SavedFigureSettings::new(
        FigureTheme::Light,
        size,
        None,
        Some(label("Time")),
        None,
        PngDpi::default(),
    )
    .expect("settings are checked without the figure");
    let refused = folder.path("ambiguous.msfigure");
    assert_eq!(
        save(
            case.kind,
            ambiguous,
            &folder.source(),
            &shown,
            &reader,
            &refused,
            &no_view_cache(),
        ),
        Err(SaveRefusal::Regeneration(RegenerationRefusal::Spec(
            SpecError::AxisTitleAmbiguous
        ))),
    );
    assert!(!refused.exists(), "nothing is written for a refused save");
}

/// The document is a recipe: no array, no panel, and small.
#[test]
fn the_document_holds_no_data_and_names_its_source() {
    let reader = Reader::golden();
    let folder = Folder::with_source("no-data");
    let document = save_case(&folder, "figure.msfigure", &spectrum_case(), &reader).expect("saved");
    let text = std::fs::read_to_string(&document).expect("the document");
    assert!(
        text.len() < 2_048,
        "a recipe, not a copy: {} bytes",
        text.len()
    );
    for forbidden in ["45.5", "22.25", "400.125", "panels", "series"] {
        assert!(
            !text.contains(forbidden),
            "the document holds {forbidden:?}"
        );
    }
    assert!(text.contains(r#""kind": "projectRelative""#));
    assert!(text.contains(r#""path": "run.mzML""#));
    assert!(text.ends_with("}\n"));
    assert!(!text.contains('\r'));
}

// ------------------------------------------------------------------ the source

/// A source whose bytes changed is refused, whether or not its length did.
#[test]
fn a_changed_source_is_refused() {
    let reader = Reader::golden();
    for (label, bytes) in [
        ("same-length", {
            let mut bytes = SOURCE.to_vec();
            bytes[3] ^= 0x20;
            bytes
        }),
        ("longer", [SOURCE, b"<!-- appended -->\n"].concat()),
    ] {
        let folder = Folder::with_source(label);
        let document =
            save_case(&folder, "figure.msfigure", &linked_case(), &reader).expect("saved");
        folder.write(SOURCE_NAME, &bytes);
        assert_eq!(
            reopen(&document, &reader).map(|_| ()),
            Err(ReopenRefusal::SourceChanged),
            "{label}",
        );
    }
}

/// A source that is gone is refused as missing, and never drawn from anything.
#[test]
fn a_missing_source_is_refused() {
    let reader = Reader::golden();
    let folder = Folder::with_source("missing");
    let document = save_case(&folder, "figure.msfigure", &spectrum_case(), &reader).expect("saved");
    std::fs::remove_file(folder.source()).expect("the source is removed");
    let refusal = reopen(&document, &reader).map(|_| ()).expect_err("refused");
    assert_eq!(refusal, ReopenRefusal::SourceMissing);
    assert_eq!(refusal.stable_id(), "saved_figure_source_missing");
}

/// The same bytes read differently -- a reader or builder that changed -- are
/// refused rather than drawn as a figure of other data.
#[test]
fn the_same_bytes_regenerating_other_data_are_refused() {
    let folder = Folder::with_source("reader-drift");
    let document = save_case(
        &folder,
        "figure.msfigure",
        &spectrum_case(),
        &Reader::golden(),
    )
    .expect("saved");
    let drifted = Reader {
        spectra: vec![SelectedSpectrumResult::from_points_for_tests(
            7,
            vec![100.5, 200.25, 300.0, 400.125, 500.0],
            vec![10.0, 90.0, 0.0, 45.5, 22.250_000_000_000_004],
        )],
        ..Reader::golden()
    };
    assert_eq!(
        reopen(&document, &drifted).map(|_| ()),
        Err(ReopenRefusal::FigureChanged)
    );
}

/// A reader that refuses is reported with its own error, unchanged.
#[test]
fn a_reader_refusal_is_carried_through() {
    let folder = Folder::with_source("reader-refuses");
    let document = save_case(
        &folder,
        "figure.msfigure",
        &linked_case(),
        &Reader::golden(),
    )
    .expect("saved");
    let refusing = Reader {
        refuses: true,
        ..Reader::golden()
    };
    assert_eq!(
        reopen(&document, &refusing).map(|_| ()),
        Err(ReopenRefusal::Regeneration(
            RegenerationRefusal::SourceNotRead(dataset_not_previewable())
        )),
    );
}

/// A relative locator travels with its folder: the document and its source
/// moved together still reopen, and nothing is read from where they were.
#[test]
fn a_relative_locator_travels_with_its_folder() {
    let reader = Reader::golden();
    let before = Folder::with_source("moved-from");
    let saved = save_case(&before, "figure.msfigure", &linked_case(), &reader).expect("saved");
    let after = Folder::new("moved-to");
    after.write(SOURCE_NAME, SOURCE);
    let document = after.write(
        "figure.msfigure",
        &std::fs::read(&saved).expect("the document"),
    );
    drop(before);

    let reopened = reopen(&document, &reader).expect("reopened after the move");
    assert_eq!(render(reopened.figure()), LINKED_GOLDEN);
    assert_eq!(
        reopened.document().locator(),
        &Locator::ProjectRelative {
            path: SOURCE_NAME.to_owned()
        },
    );
}

/// A source outside the document's folder is recorded as the absolute path it
/// is, and reopens from there.
#[test]
fn a_source_elsewhere_is_named_absolutely() {
    let reader = Reader::golden();
    let data = Folder::with_source("elsewhere-data");
    let figures = Folder::new("elsewhere-figures");
    let destination = figures.path("figure.msfigure");
    let case = spectrum_case();
    save(
        case.kind,
        pixels(),
        &data.source(),
        &case.shown,
        &reader,
        &destination,
        &no_view_cache(),
    )
    .expect("saved");
    let reopened = reopen(&destination, &reader).expect("reopened");
    let Locator::LocalAbsolute { path } = reopened.document().locator() else {
        panic!("an absolute locator: {:?}", reopened.document().locator());
    };
    assert_eq!(
        path,
        &user_form(&std::fs::canonicalize(data.source()).expect("canonical")),
    );
    assert!(!path.to_string_lossy().starts_with(r"\\"), "{path:?}");
    assert_eq!(render(reopened.figure()), SPECTRUM_GOLDEN);
}

/// The preview holds its datasets' canonical, verbatim paths. A source named
/// that way is still recorded relative to a document beside it, and never in
/// the verbatim form the locator rule refuses.
#[test]
fn a_verbatim_source_path_is_recorded_as_a_person_writes_it() {
    let reader = Reader::golden();
    let folder = Folder::with_source("verbatim");
    let verbatim = std::fs::canonicalize(folder.source()).expect("canonical");
    let destination = folder.path("figure.msfigure");
    let case = linked_case();
    save(
        case.kind,
        pixels(),
        &verbatim,
        &case.shown,
        &reader,
        &destination,
        &no_view_cache(),
    )
    .expect("saved");
    let reopened = reopen(&destination, &reader).expect("reopened");
    assert_eq!(
        reopened.document().locator(),
        &Locator::ProjectRelative {
            path: SOURCE_NAME.to_owned()
        },
    );
}

/// The spelling rule itself.
#[cfg(windows)]
#[test]
fn a_verbatim_drive_path_is_written_without_its_prefix() {
    for (given, expected) in [
        (r"\\?\C:\data\run.mzML", r"C:\data\run.mzML"),
        (r"\\?\D:\", r"D:\"),
        (r"C:\data\run.mzML", r"C:\data\run.mzML"),
        // A network path stays what it is, and the locator rule refuses it.
        (
            r"\\?\UNC\server\share\run.mzML",
            r"\\?\UNC\server\share\run.mzML",
        ),
        (r"\\server\share\run.mzML", r"\\server\share\run.mzML"),
    ] {
        assert_eq!(
            user_form(Path::new(given)),
            PathBuf::from(expected),
            "{given}"
        );
    }
}

/// A mapped network drive canonicalizes to a verbatim network path. A source
/// there is named relative to a document in the same share and refused as an
/// absolute locator, so where the document is saved decides which.
#[cfg(windows)]
#[test]
fn a_source_on_a_share_is_named_only_beside_its_document() {
    let source = user_form(Path::new(r"\\?\UNC\server\share\data\run.mzML"));
    let locator = |folder: &str| locator_for(&source, &user_form(Path::new(folder)));

    let beside = locator(r"\\?\UNC\server\share\data");
    assert_eq!(
        beside,
        Locator::ProjectRelative {
            path: SOURCE_NAME.to_owned()
        },
    );
    assert!(validate_locator(&beside).is_ok());

    let elsewhere = locator(r"\\?\C:\figures");
    assert!(matches!(elsewhere, Locator::LocalAbsolute { .. }));
    assert!(validate_locator(&elsewhere).is_err());
}

/// The reader is handed the held handle, at its first byte for every call: a
/// linked figure reads it twice, and both reads are the measured bytes.
#[test]
fn the_reader_reads_the_held_bytes_from_the_start() {
    let reader = Reader {
        reads_source: true,
        ..Reader::golden()
    };
    let folder = Folder::with_source("held");
    let document = save_case(&folder, "figure.msfigure", &linked_case(), &reader).expect("saved");
    let reopened = reopen(&document, &reader).expect("reopened");
    assert_eq!(render(reopened.figure()), LINKED_GOLDEN);
}

// ------------------------------------------------------------------ the document

/// Any edit to a saved document's contents is refused, before its source is
/// read: a title, a theme, the spectrum it names, or its own digest.
#[test]
fn a_tampered_document_is_refused() {
    let reader = Reader::golden();
    let folder = Folder::with_source("tampered");
    let document = save_case(&folder, "figure.msfigure", &linked_case(), &reader).expect("saved");
    let text = std::fs::read_to_string(&document).expect("the document");
    let digest = wire_of(&document).document_sha256;
    let flipped = {
        let last = if digest.ends_with('0') { "1" } else { "0" };
        format!("{}{last}", &digest[..digest.len() - 1])
    };
    for (label, from, to) in [
        ("theme", r#""theme": "light""#, r#""theme": "dark""#),
        ("index", r#""spectrumIndex": 2"#, r#""spectrumIndex": 3"#),
        ("traces", r#""bpc": true"#, r#""bpc": false"#),
        ("digest", digest.as_str(), flipped.as_str()),
    ] {
        assert!(text.contains(from), "{label}: the document holds {from}");
        let edited = folder.write("edited.msfigure", text.replacen(from, to, 1).as_bytes());
        // Gone, so a refusal that reached the source would say so instead.
        let moved = folder.write("kept.mzML", SOURCE);
        std::fs::remove_file(folder.source()).expect("the source is set aside");
        assert_eq!(
            reopen(&edited, &reader).map(|_| ()),
            Err(ReopenRefusal::Document(DocumentRefusal::DigestMismatch)),
            "{label}",
        );
        std::fs::rename(moved, folder.source()).expect("the source is put back");
    }
    // Reformatting is not an edit: the digest covers what the document says.
    let compact = serde_json::to_vec(&wire_of(&document)).expect("compact");
    let reformatted = folder.write("compact.msfigure", &compact);
    assert!(reopen(&reformatted, &reader).is_ok());
}

/// A newer document is refused as newer, even though a strict read of it would
/// fail on a field this build does not know; and other documents are refused
/// as what they are.
#[test]
fn a_newer_or_foreign_document_is_refused_as_what_it_is() {
    let reader = Reader::golden();
    let folder = Folder::with_source("versions");
    for (label, text, refusal) in [
        (
            "newer",
            r#"{"format":"mscanvas_saved_figure","formatVersion":2,"layers":[]}"#,
            DocumentRefusal::NewerVersion,
        ),
        (
            "older",
            r#"{"format":"mscanvas_saved_figure","formatVersion":0}"#,
            DocumentRefusal::UnsupportedVersion,
        ),
        (
            "foreign",
            r#"{"format":"mscanvas_project","formatVersion":1}"#,
            DocumentRefusal::NotASavedFigure,
        ),
        ("not-json", "<svg/>", DocumentRefusal::Malformed),
        (
            "no-version",
            r#"{"format":"mscanvas_saved_figure"}"#,
            DocumentRefusal::Malformed,
        ),
    ] {
        let document = folder.write(&format!("{label}.msfigure"), text.as_bytes());
        assert_eq!(
            reopen(&document, &reader).map(|_| ()),
            Err(ReopenRefusal::Document(refusal)),
            "{label}",
        );
    }
}

/// A field this build does not declare is refused at every depth, and so is a
/// field that is missing.
#[test]
fn an_unknown_or_missing_field_is_refused_at_every_depth() {
    let reader = Reader::golden();
    let folder = Folder::with_source("fields");
    let document = save_case(&folder, "figure.msfigure", &linked_case(), &reader).expect("saved");
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&document).expect("the document")).expect("JSON");
    let edits: [(&str, JsonEdit); 6] = [
        ("top", |value| {
            value["comment"] = serde_json::json!("hand-written");
        }),
        ("figure", |value| {
            value["figure"]["visibleDomain"] = serde_json::json!(null);
        }),
        ("range", |value| {
            value["figure"]["retentionTimeRange"]["low"] = serde_json::json!("9");
        }),
        ("settings", |value| {
            value["settings"]["size"]["dpi"] = serde_json::json!(300);
        }),
        ("locator", |value| {
            value["source"]["locator"]["volume"] = serde_json::json!("C:");
        }),
        ("missing title", |value| {
            value["settings"]
                .as_object_mut()
                .expect("an object")
                .remove("title");
        }),
    ];
    for (label, edit) in edits {
        let mut edited = value.clone();
        edit(&mut edited);
        let path = folder.write(
            "edited.msfigure",
            &serde_json::to_vec(&edited).expect("JSON"),
        );
        assert_eq!(
            reopen(&path, &reader).map(|_| ()),
            Err(ReopenRefusal::Document(DocumentRefusal::Malformed)),
            "{label}",
        );
    }
}

/// A value outside its bounds is refused even in a document whose digest
/// agrees with it -- the bounds are this build's, not the digest's.
#[test]
fn a_value_outside_its_bounds_is_refused_even_when_resealed() {
    let reader = Reader::golden();
    let folder = Folder::with_source("bounds");
    let linked_document =
        save_case(&folder, "linked.msfigure", &linked_case(), &reader).expect("saved");
    let print = PrintSize::new(85.0, 60.0, 7.0, 0.75).expect("a printed size");
    let printed_settings = SavedFigureSettings::new(
        FigureTheme::Light,
        SavedSize::Print {
            print,
            preset: PrintPreset::SingleColumn,
        },
        None,
        None,
        None,
        PngDpi::default(),
    )
    .expect("printed settings");
    let spectrum = spectrum_case();
    let shown = publication_figure(
        spectrum.shown.clone(),
        FigureSize::printed(print).expect("a printed size"),
        "",
        "",
        "",
    )
    .expect("a publication figure");
    let printed_document = folder.path("printed.msfigure");
    save(
        spectrum.kind,
        printed_settings,
        &folder.source(),
        &shown,
        &reader,
        &printed_document,
        &no_view_cache(),
    )
    .expect("saved");
    let (linked, printed) = (linked_document.as_path(), printed_document.as_path());

    fn retention_time_range(wire: &mut WireDocument, low: &str, high: &str) {
        if let WireFigure::Linked {
            retention_time_range,
            ..
        } = &mut wire.figure
        {
            *retention_time_range = WireRange::Current {
                low: decimal(low),
                high: decimal(high),
            };
        }
    }
    fn paper(
        wire: &mut WireDocument,
        edit: fn(&mut DecimalValue, &mut DecimalValue, &mut DecimalValue),
    ) {
        if let WireSize::Print {
            width_mm,
            height_mm,
            text_pt,
            ..
        } = &mut wire.settings.size
        {
            edit(width_mm, height_mm, text_pt);
        }
    }
    let edits: [(&str, &Path, WireEdit); 18] = [
        ("long title", linked, |wire| {
            wire.settings.title = Some("x".repeat(121));
        }),
        ("blank title", linked, |wire| {
            wire.settings.y_axis_title = Some("   ".to_owned());
        }),
        ("control in title", linked, |wire| {
            wire.settings.title = Some("a\u{7}b".to_owned());
        }),
        ("dpi low", linked, |wire| wire.settings.raster_dpi = 71),
        ("dpi high", linked, |wire| wire.settings.raster_dpi = 1_201),
        ("narrow", linked, |wire| {
            wire.settings.size = WireSize::Pixels {
                width: 199,
                height: 640,
            };
        }),
        ("too short for two panels", linked, |wire| {
            wire.settings.size = WireSize::Pixels {
                width: 1_200,
                height: 259,
            };
        }),
        ("no trace", linked, |wire| {
            if let WireFigure::Linked { traces, .. } = &mut wire.figure {
                traces.tic = false;
                traces.bpc = false;
            }
        }),
        ("inverted range", linked, |wire| {
            retention_time_range(wire, "13", "9");
        }),
        ("non-canonical number", linked, |wire| {
            retention_time_range(wire, "9.0", "13");
        }),
        ("escaping locator", linked, |wire| {
            wire.source.locator = Locator::ProjectRelative {
                path: "../run.mzML".to_owned(),
            };
        }),
        ("network locator", linked, |wire| {
            wire.source.locator = Locator::LocalAbsolute {
                path: PathBuf::from(r"\\server\share\run.mzML"),
            };
        }),
        ("relative absolute locator", linked, |wire| {
            wire.source.locator = Locator::LocalAbsolute {
                path: PathBuf::from("run.mzML"),
            };
        }),
        ("lower-case baseline", linked, |wire| {
            wire.source.baseline.sha256 = wire.source.baseline.sha256.to_ascii_lowercase();
        }),
        ("short data digest", linked, |wire| {
            wire.data_sha256.truncate(63)
        }),
        ("text too large", printed, |wire| {
            paper(wire, |_, _, text| *text = decimal("30"));
        }),
        ("preset disagrees", printed, |wire| {
            paper(wire, |width, _, _| *width = decimal("90"));
        }),
        ("paper too small", printed, |wire| {
            paper(wire, |_, height, _| *height = decimal("19"));
        }),
    ];
    for (label, saved, edit) in edits {
        let mut wire = wire_of(saved);
        edit(&mut wire);
        let path = folder.write("edited.msfigure", &seal(wire).expect("sealed"));
        assert_eq!(
            reopen(&path, &reader).map(|_| ()),
            Err(ReopenRefusal::Document(DocumentRefusal::OutOfBounds)),
            "{label}",
        );
    }
}

/// A document too large to be one is refused without being read whole, and a
/// name with nothing at it is missing.
#[test]
fn an_oversized_or_absent_document_is_refused() {
    let reader = Reader::golden();
    let folder = Folder::new("size");
    let large = folder.write(
        "large.msfigure",
        &vec![b' '; usize::try_from(MAX_SAVED_FIGURE_BYTES).expect("small") + 1],
    );
    assert_eq!(
        reopen(&large, &reader).map(|_| ()),
        Err(ReopenRefusal::Document(DocumentRefusal::TooLarge)),
    );
    assert_eq!(
        reopen(&folder.path("absent.msfigure"), &reader).map(|_| ()),
        Err(ReopenRefusal::DocumentMissing),
    );
}

/// The document this build writes for the linked golden figure, pinned as
/// bytes, and still reopened to the linked golden SVG.
///
/// A later build that can no longer read what this one saved fails here, and
/// so does one that writes a different document for the same figure.
#[test]
fn the_pinned_document_is_written_and_reopened() {
    let reader = Reader::golden();
    let folder = Folder::with_source("pinned-write");
    let written = save_case(&folder, "figure.msfigure", &linked_case(), &reader).expect("saved");
    assert_eq!(
        std::fs::read_to_string(&written).expect("the document"),
        PINNED_DOCUMENT,
    );

    let elsewhere = Folder::with_source("pinned-read");
    let pinned = elsewhere.write("pinned.msfigure", PINNED_DOCUMENT.as_bytes());
    let reopened = reopen(&pinned, &reader).expect("the pinned document reopens");
    assert_eq!(render(reopened.figure()), LINKED_GOLDEN);
}

// ------------------------------------------------------------------ saving

/// A second save to the same name replaces nothing, and the first document is
/// what it was.
#[test]
fn a_save_never_replaces_a_file() {
    let reader = Reader::golden();
    let folder = Folder::with_source("no-overwrite");
    let case = linked_case();
    let document = save_case(&folder, "figure.msfigure", &case, &reader).expect("saved");
    let first = std::fs::read(&document).expect("the document");
    let refusal = save_case(&folder, "figure.msfigure", &spectrum_case(), &reader)
        .expect_err("the name is taken");
    assert_eq!(refusal.stable_id(), "spectrum_destination_exists");
    assert_eq!(std::fs::read(&document).expect("the document"), first);
}

/// A destination not named as a saved figure is refused before the source is
/// read: here the source does not exist, and the refusal is about the name.
#[test]
fn a_misnamed_destination_is_refused_first() {
    let reader = Reader::golden();
    let folder = Folder::new("misnamed");
    let case = spectrum_case();
    for name in ["figure.json", "figure.msfigure.json", "figure"] {
        let refusal = save(
            case.kind,
            pixels(),
            &folder.source(),
            &case.shown,
            &reader,
            &folder.path(name),
            &no_view_cache(),
        )
        .expect_err("refused");
        assert_eq!(
            refusal.stable_id(),
            "spectrum_destination_misnamed",
            "{name}"
        );
    }
    assert_eq!(
        save_case(&folder, "figure.msfigure", &case, &reader),
        Err(SaveRefusal::SourceMissing),
    );
}

/// A figure the source does not regenerate is not saved: the document would
/// reopen as something other than what was on screen.
#[test]
fn a_figure_the_source_does_not_regenerate_is_not_saved() {
    let reader = Reader::golden();
    let folder = Folder::with_source("not-shown");
    let case = spectrum_case();
    let dark = SavedFigureSettings::new(
        FigureTheme::Dark,
        SavedSize::Pixels {
            width: 1_200,
            height: 640,
        },
        None,
        None,
        None,
        PngDpi::default(),
    )
    .expect("settings");
    let destination = folder.path("figure.msfigure");
    assert_eq!(
        save(
            case.kind,
            dark,
            &folder.source(),
            &case.shown,
            &reader,
            &destination,
            &no_view_cache(),
        ),
        Err(SaveRefusal::NotTheShownFigure),
    );
    assert!(!destination.exists());
}

/// A linked figure whose scan lies outside its range is refused by the same
/// rule the linked export applies, and a scan the table does not hold is not
/// linked to the nearest one.
#[test]
fn a_linked_figure_keeps_the_linked_export_s_rules() {
    let reader = Reader::golden();
    let folder = Folder::with_source("linked-rules");
    let case = linked_case();
    let outside = SavedFigureKind::Linked {
        index: 2,
        range: SavedRetentionTimeRange::Current(window(9.0, 10.0)),
        traces: both(),
    };
    assert_eq!(
        save(
            outside,
            pixels(),
            &folder.source(),
            &case.shown,
            &reader,
            &folder.path("outside.msfigure"),
            &no_view_cache(),
        ),
        Err(SaveRefusal::Regeneration(
            RegenerationRefusal::SelectedScanOutsideRange
        )),
    );
    let stranger = Reader {
        spectra: vec![SelectedSpectrumResult::from_points_for_tests(
            9,
            vec![100.0],
            vec![1.0],
        )],
        ..Reader::golden()
    };
    let unknown = SavedFigureKind::Linked {
        index: 9,
        range: SavedRetentionTimeRange::Full,
        traces: both(),
    };
    assert_eq!(
        save(
            unknown,
            pixels(),
            &folder.source(),
            &case.shown,
            &stranger,
            &folder.path("unknown.msfigure"),
            &no_view_cache(),
        ),
        Err(SaveRefusal::Regeneration(
            RegenerationRefusal::SelectedScanNotInTable
        )),
    );
}

/// A linked figure over a committed retention-time range saves and reopens as
/// the figure the linked export draws, with its scan inside the range or on
/// either edge of it -- the export's rule, asked through the export's function.
#[test]
fn a_linked_figure_over_a_current_range_reopens_with_its_scan_on_an_edge() {
    let reader = Reader::golden();
    let source = chromatogram();
    let scan = selected_scan();
    let row = source.row_for_spectrum(&scan).expect("a scan of the run");
    // The scan's retention time is 11.0.
    for (low, high) in [(10.0, 13.0), (11.0, 13.0), (9.0, 11.0)] {
        let range = SavedRetentionTimeRange::Current(window(low, high));
        let shown = linked_figure_spec(
            &source,
            &scan,
            row,
            resolved(&source, range),
            both(),
            FigureRenderSettings::default(),
        )
        .expect("a linked figure");
        let kind = SavedFigureKind::Linked {
            index: 2,
            range,
            traces: both(),
        };
        let folder = Folder::with_source("linked-current");
        let document = folder.path("figure.msfigure");
        save(
            kind,
            pixels(),
            &folder.source(),
            &shown,
            &reader,
            &document,
            &no_view_cache(),
        )
        .unwrap_or_else(|refusal| panic!("{low}..{high} was not saved: {refusal:?}"));
        let reopened = reopen(&document, &reader)
            .unwrap_or_else(|refusal| panic!("{low}..{high} was not reopened: {refusal:?}"));
        assert_eq!(reopened.figure(), &shown, "{low}..{high}");
    }
}

/// An m/z window the spectrum does not hold is refused on reopening, through
/// the export's own resolver, even in a resealed document. A window wider than
/// the spectrum would otherwise draw the full spectrum under a caption naming
/// the window, which no export draws.
#[test]
fn a_resealed_m_z_window_the_spectrum_does_not_hold_is_refused() {
    let reader = Reader::golden();
    let folder = Folder::with_source("mz-window");
    let document = save_case(&folder, "figure.msfigure", &spectrum_case(), &reader).expect("saved");
    // The spectrum runs from m/z 100.5 to 500.
    for (low, high) in [("0", "10000"), ("50", "300"), ("150", "600")] {
        let mut wire = wire_of(&document);
        if let WireFigure::Spectrum { mz_range, .. } = &mut wire.figure {
            *mz_range = WireRange::Current {
                low: decimal(low),
                high: decimal(high),
            };
        }
        let path = folder.write("edited.msfigure", &seal(wire).expect("sealed"));
        assert_eq!(
            reopen(&path, &reader).map(|_| ()),
            Err(ReopenRefusal::Regeneration(
                RegenerationRefusal::RangeOutsideSource
            )),
            "{low}..{high}",
        );
    }
}

/// A retention-time range the run does not hold is refused on reopening,
/// through the chromatogram's own resolver, for a chromatogram and a linked
/// figure alike, even in a resealed document.
#[test]
fn a_resealed_retention_time_range_the_run_does_not_hold_is_refused() {
    let reader = Reader::golden();
    let folder = Folder::with_source("rt-window");
    let chromatogram = cases()
        .into_iter()
        .find(|case| case.name == "chromatogram-full")
        .expect("the chromatogram case");
    let saved = [
        save_case(&folder, "chromatogram.msfigure", &chromatogram, &reader).expect("saved"),
        save_case(&folder, "linked.msfigure", &linked_case(), &reader).expect("saved"),
    ];
    // The run spans retention times 9 to 13.
    for document in &saved {
        for (low, high) in [("8", "13"), ("9", "14")] {
            let mut wire = wire_of(document);
            if let WireFigure::Chromatogram {
                retention_time_range,
                ..
            }
            | WireFigure::Linked {
                retention_time_range,
                ..
            } = &mut wire.figure
            {
                *retention_time_range = WireRange::Current {
                    low: decimal(low),
                    high: decimal(high),
                };
            }
            let path = folder.write("edited.msfigure", &seal(wire).expect("sealed"));
            assert_eq!(
                reopen(&path, &reader).map(|_| ()),
                Err(ReopenRefusal::Regeneration(
                    RegenerationRefusal::RangeOutsideSource
                )),
                "{}: {low}..{high}",
                document.display(),
            );
        }
    }
}

/// A table the preview shows truncated has no chromatogram, here as on screen.
#[test]
fn a_truncated_table_regenerates_no_chromatogram() {
    let folder = Folder::with_source("truncated");
    let document = save_case(
        &folder,
        "figure.msfigure",
        &linked_case(),
        &Reader::golden(),
    )
    .expect("saved");
    let truncated = Reader {
        truncated: true,
        ..Reader::golden()
    };
    assert_eq!(
        reopen(&document, &truncated).map(|_| ()),
        Err(ReopenRefusal::Regeneration(
            RegenerationRefusal::NoChromatogram(NoChromatogram::Truncated)
        )),
    );
}

/// A reader that answers with a spectrum other than the one asked for is
/// refused, rather than drawn under the saved index.
#[test]
fn a_reader_answering_another_spectrum_is_refused() {
    struct Misindexed;
    impl FigureSourceReader for Misindexed {
        fn spectrum_table(&self, source: &File) -> Result<SourceTable, PreviewErrorDto> {
            Reader::golden().spectrum_table(source)
        }
        fn spectrum(&self, _: &File, _: u64) -> Result<SelectedSpectrumResult, PreviewErrorDto> {
            Ok(selected_scan())
        }
    }
    let folder = Folder::with_source("misindexed");
    let document = save_case(
        &folder,
        "figure.msfigure",
        &spectrum_case(),
        &Reader::golden(),
    )
    .expect("saved");
    assert_eq!(
        reopen(&document, &Misindexed).map(|_| ()),
        Err(ReopenRefusal::Regeneration(
            RegenerationRefusal::WrongSpectrum
        )),
    );
}

/// A source in the view cache is refused before anything is written: it is a
/// converted copy under this machine's application data, which the cache may
/// remove. A folder whose name only begins like the cache's is not in it.
#[test]
fn a_source_in_the_view_cache_is_not_saved() {
    let reader = Reader::golden();
    let folder = Folder::new("view-cache");
    let cache = folder.path("view-cache");
    let entry = cache.join("entries").join("0a1b");
    let outside = folder.path("view-cache-old");
    for directory in [&entry, &outside] {
        std::fs::create_dir_all(directory).expect("a folder");
    }
    let cached = entry.join("view.mzML");
    let beside = outside.join(SOURCE_NAME);
    for path in [&cached, &beside] {
        std::fs::write(path, SOURCE).expect("a source");
    }
    let case = spectrum_case();
    let destination = folder.path("figure.msfigure");
    let save_from = |source: &Path| {
        save(
            case.kind,
            pixels(),
            source,
            &case.shown,
            &reader,
            &destination,
            &cache,
        )
    };

    let refusal = save_from(&cached).expect_err("refused");
    assert_eq!(refusal, SaveRefusal::SourceInViewCache);
    assert_eq!(refusal.stable_id(), "saved_figure_source_in_view_cache");
    assert!(
        !destination.exists(),
        "nothing is written for a refused save"
    );

    save_from(&beside).expect("a folder beside the cache is not the cache");
    assert!(destination.exists());
}

/// A preset is a name for a width, and settings whose preset names another
/// width are not constructed.
#[test]
fn a_preset_must_agree_with_its_width() {
    let print = PrintSize::new(90.0, 60.0, 7.0, 0.75).expect("a printed size");
    for preset in [PrintPreset::SingleColumn, PrintPreset::DoubleColumn] {
        assert_eq!(
            SavedFigureSettings::new(
                FigureTheme::Light,
                SavedSize::Print { print, preset },
                None,
                None,
                None,
                PngDpi::default(),
            ),
            Err(SettingsOutOfBounds),
        );
    }
    assert!(
        SavedFigureSettings::new(
            FigureTheme::Light,
            SavedSize::Print {
                print,
                preset: PrintPreset::Custom,
            },
            None,
            None,
            None,
            PngDpi::default(),
        )
        .is_ok()
    );
}

/// Every refusal has a stable identifier the interface can map, and no two
/// refusals that mean different things share one. The one shared identifier
/// is SHA-256 being unavailable, which means the same wherever it is met.
#[test]
fn every_refusal_has_its_own_stable_identifier() {
    assert_eq!(
        DocumentRefusal::DigestUnavailable.stable_id(),
        ReopenRefusal::DigestUnavailable.stable_id(),
    );
    let documents = [
        DocumentRefusal::TooLarge,
        DocumentRefusal::Malformed,
        DocumentRefusal::NotASavedFigure,
        DocumentRefusal::NewerVersion,
        DocumentRefusal::UnsupportedVersion,
        DocumentRefusal::OutOfBounds,
        DocumentRefusal::DigestMismatch,
    ];
    let mut identifiers: Vec<&str> = documents
        .iter()
        .map(|refusal| refusal.stable_id())
        .collect();
    identifiers.extend(
        [
            ReopenRefusal::DocumentMissing,
            ReopenRefusal::DocumentUnreadable,
            ReopenRefusal::SourceMissing,
            ReopenRefusal::SourceUnavailable(UnavailableReason::Unreadable),
            ReopenRefusal::SourceChanged,
            ReopenRefusal::Regeneration(RegenerationRefusal::NoChromatogram(
                NoChromatogram::Truncated,
            )),
            ReopenRefusal::FigureChanged,
            ReopenRefusal::DigestUnavailable,
        ]
        .iter()
        .map(ReopenRefusal::stable_id),
    );
    let mut sorted = identifiers.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), identifiers.len(), "{identifiers:?}");
    for identifier in identifiers {
        assert!(identifier.starts_with("saved_figure_"), "{identifier}");
        assert!(
            identifier
                .bytes()
                .all(|byte| byte == b'_' || byte.is_ascii_lowercase()),
            "{identifier}",
        );
    }
    assert_eq!(
        SaveRefusal::NotTheShownFigure.stable_id(),
        "saved_figure_not_the_shown_figure"
    );
    assert_eq!(
        SaveRefusal::SourceNotReferencable.stable_id(),
        "saved_figure_source_not_referencable"
    );
    assert!(!sorted.contains(&SaveRefusal::SourceInViewCache.stable_id()));
}
