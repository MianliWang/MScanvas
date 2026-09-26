//! The managed result store beside a project document.
//!
//! ## Layout
//!
//! A project published as `study.mscanvas` keeps what its targeted MS1 runs
//! produced in `study.mscanvas.payloads/`, beside it:
//!
//! - `.owner.json` names the project the store belongs to;
//! - `.staging/<ArtifactId>/` is a result being assembled;
//! - `<ArtifactId>/` is a published result, immutable from the moment it gets
//!   that name: `rows.jsonl`, `evidence.jsonl`, `evidence.index.json`, and a
//!   `manifest.json` that names the result and digests every other file.
//!
//! The document holds none of the bulk. Its record names the result by its own
//! identifier and by digest -- the manifest's and every file's -- and never by
//! path, so the only directory a record can reach is the one its identifier
//! names inside the store its document is beside.
//!
//! ## Order
//!
//! A result is written into staging on the store's own volume, validated, then
//! published by one rename that refuses to replace anything; only then does the
//! in-memory project reference it, and only a Save puts that reference in the
//! document. A document therefore never names a result that was not already
//! whole. A Save that fails after the rename leaves a whole result nobody
//! references -- an orphan, which an open counts and nothing here deletes.
//!
//! ## What this does not do
//!
//! It deletes no published result and no directory it did not create in the
//! same operation: a failed or cancelled assembly removes its own staging
//! directory and nothing else. There is no garbage collection and no crash
//! resume. The renames are ordinary same-volume renames; nothing here claims
//! the result survives a power loss.

use std::fs;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use mscanvas_core::ArtifactId;
use mscanvas_proteowizard::Sha256Digest;
use serde::{Deserialize, Serialize};

use super::record::{PayloadFile, PayloadFileName, PayloadReference, ProjectId, TargetId};
use crate::local_document;

/// What a store's name adds to its document's.
pub const STORE_SUFFIX: &str = ".payloads";
const OWNER_FILE: &str = ".owner.json";
const STAGING: &str = ".staging";
const MANIFEST: &str = "manifest.json";
const OWNER_SCHEMA: &str = "mscanvas.payloadStoreOwner/1";
const MANIFEST_SCHEMA: &str = "mscanvas.targetedMs1Payload/1";
const INDEX_SCHEMA: &str = "mscanvas.targetedMs1EvidenceIndex/1";

/// The largest file of one result this build reads whole.
pub const MAX_PAYLOAD_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// The largest manifest or owner record this build reads.
const MAX_SMALL_RECORD_BYTES: u64 = 64 * 1024;
/// The largest single evidence line one retrieval returns.
pub const MAX_EVIDENCE_LINE_BYTES: u64 = 8 * 1024 * 1024;
/// The most rows one page carries.
pub const MAX_PAGE_ROWS: usize = 500;

/// The store a document keeps its results in.
///
/// Derived from the document's own name, so renaming or moving the document
/// outside the application leaves its store behind; the open that follows says
/// so rather than looking elsewhere.
#[must_use]
pub fn store_of(document: &Path) -> Option<PathBuf> {
    let name = document.file_name()?.to_str()?;
    Some(document.with_file_name(format!("{name}{STORE_SUFFIX}")))
}

/// The directory one published result lives in.
#[must_use]
pub fn result_directory(store: &Path, artifact: ArtifactId) -> PathBuf {
    store.join(artifact.to_string())
}

/// Whether a published result is whole, as observed now.
///
/// Observed, never stored: a document says what it references, and whether
/// that is still intact is a separate question with a separate answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Availability {
    Available,
    /// The directory, its manifest or one of its files is not there.
    Missing,
    /// Something is there and it is not what the record names.
    Corrupt,
}

impl Availability {
    /// The stable wire identifier.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::Missing => "payloadMissing",
            Self::Corrupt => "payloadCorrupt",
        }
    }
}

/// Why a store could not be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreRefusal {
    /// Something that is not this application's store sits at the store's
    /// name: a file, a link, or a directory whose owner record is missing or
    /// unreadable. Nothing is written into it.
    NotAStore,
    /// A store is there and it belongs to another project.
    NotOwned,
    /// The store could not be created or written.
    Unwritable,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnerRecord {
    schema: String,
    project_id: ProjectId,
}

/// Makes sure the store exists and belongs to `project`, creating it if it
/// does not exist.
///
/// A store that exists and names another project is refused, as is anything
/// at the name that is not a store at all. Nothing existing is changed.
///
/// # Errors
///
/// A [`StoreRefusal`].
pub fn ensure_store(store: &Path, project: ProjectId) -> Result<(), StoreRefusal> {
    match fs::symlink_metadata(store) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // Assembled under a fresh name beside it and renamed into place
            // without replacing, so the store is there whole or not at all: a
            // failed write, or a process that dies here, leaves nothing at the
            // store's name to refuse every later run.
            let (Some(parent), Some(name)) = (store.parent(), store.file_name()) else {
                return Err(StoreRefusal::Unwritable);
            };
            let pending = parent.join(format!(
                ".{}.{}.pending",
                name.to_string_lossy(),
                uuid::Uuid::new_v4()
            ));
            fs::create_dir(&pending).map_err(|_| StoreRefusal::Unwritable)?;
            match write_owner(&pending, project)
                .and_then(|()| rename_without_replacing(&pending, store))
            {
                Ok(()) => Ok(()),
                Err(error) => {
                    // This operation's own directory, created fresh above.
                    let _ = fs::remove_dir_all(&pending);
                    // Created by someone else meanwhile: judged like any other
                    // existing store.
                    if error.kind() == io::ErrorKind::AlreadyExists {
                        owned_by(store, project)
                    } else {
                        Err(StoreRefusal::Unwritable)
                    }
                }
            }
        }
        Err(_) => Err(StoreRefusal::NotAStore),
        Ok(_) => owned_by(store, project),
    }
}

/// Whether an existing name is a store and belongs to `project`.
fn owned_by(store: &Path, project: ProjectId) -> Result<(), StoreRefusal> {
    if !is_plain_directory(store) {
        return Err(StoreRefusal::NotAStore);
    }
    let bytes = match local_document::read_bounded(&store.join(OWNER_FILE), MAX_SMALL_RECORD_BYTES)
    {
        Ok(Some(bytes)) => bytes,
        _ => return Err(StoreRefusal::NotAStore),
    };
    let owner: OwnerRecord = serde_json::from_slice(&bytes).map_err(|_| StoreRefusal::NotAStore)?;
    if owner.schema != OWNER_SCHEMA {
        return Err(StoreRefusal::NotAStore);
    }
    if owner.project_id == project {
        Ok(())
    } else {
        Err(StoreRefusal::NotOwned)
    }
}

/// Whether a name is a directory and not a link or other reparse point.
#[must_use]
pub fn is_plain_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_dir() && !local_document::is_reparse_point(&metadata))
}

/// Creates the staging directory one result is assembled in.
///
/// Fresh, named by the result's identifier, and never an existing directory:
/// what is assembled here is this operation's alone, which is what later makes
/// removing it on failure a removal of nothing else.
///
/// # Errors
///
/// The directory could not be created fresh.
pub fn create_staging(store: &Path, artifact: ArtifactId) -> io::Result<PathBuf> {
    let staging_root = store.join(STAGING);
    match fs::create_dir(&staging_root) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    if !is_plain_directory(&staging_root) {
        return Err(io::Error::other(
            "the staging area is not a plain directory",
        ));
    }
    let staging = staging_root.join(artifact.to_string());
    fs::create_dir(&staging)?;
    Ok(staging)
}

/// Removes one staging directory this operation created, and nothing else.
///
/// Refuses anything that is not exactly `<store>/.staging/<ArtifactId>` for the
/// identifier given, so a mistaken path cannot turn into a recursive delete of
/// something that matters. Reports whether the directory is gone.
pub fn discard_staging(store: &Path, artifact: ArtifactId) -> bool {
    let staging = store.join(STAGING).join(artifact.to_string());
    if !is_plain_directory(&staging) {
        return fs::symlink_metadata(&staging).is_err();
    }
    fs::remove_dir_all(&staging).is_ok()
}

/// Writes one new file and orders its bytes before returning.
fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.flush()?;
    file.sync_data()
}

/// The manifest one published result carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PayloadManifest {
    pub schema: String,
    /// The result record this payload belongs to. A payload copied under
    /// another record's name does not match that record.
    pub artifact_id: ArtifactId,
    /// The plan the producing run executed.
    pub plan_sha256: String,
    pub files: Vec<PayloadFile>,
}

/// SHA-256 of one file as it is on disk, and its length.
fn measure(path: &Path) -> io::Result<(u64, String)> {
    let file = fs::File::open(path)?;
    let length = file.metadata()?.len();
    let digest = Sha256Digest::calculate_reader(file)
        .map_err(|_| io::Error::other("the file could not be digested"))?;
    Ok((length, digest.to_string()))
}

fn digest_of(bytes: &[u8]) -> io::Result<String> {
    Sha256Digest::calculate(bytes)
        .map(|digest| digest.to_string())
        .map_err(|_| io::Error::other("the bytes could not be digested"))
}

/// Writes one result's files into its staging directory and answers the
/// reference a record will carry.
///
/// Every digest is measured from the file as written, not from the bytes that
/// were meant to be written.
///
/// # Errors
///
/// A file could not be written or measured.
pub fn stage_payload(
    staging: &Path,
    artifact: ArtifactId,
    plan_sha256: &str,
    rows: &[u8],
    evidence: &[u8],
) -> io::Result<PayloadReference> {
    let index = build_index(evidence)?;
    let mut files = Vec::with_capacity(PayloadFileName::ALL.len());
    for (name, bytes) in [
        (PayloadFileName::Rows, rows),
        (PayloadFileName::Evidence, evidence),
        (PayloadFileName::EvidenceIndex, index.as_slice()),
    ] {
        let path = staging.join(name.file_name());
        write_new(&path, bytes)?;
        let (byte_length, sha256) = measure(&path)?;
        if byte_length != bytes.len() as u64 || sha256 != digest_of(bytes)? {
            return Err(io::Error::other(
                "a staged file does not hold what was written",
            ));
        }
        files.push(PayloadFile {
            name,
            byte_length,
            sha256,
        });
    }
    let manifest = PayloadManifest {
        schema: MANIFEST_SCHEMA.to_owned(),
        artifact_id: artifact,
        plan_sha256: plan_sha256.to_ascii_uppercase(),
        files: files.clone(),
    };
    let mut bytes = serde_json::to_vec_pretty(&manifest).map_err(io::Error::other)?;
    bytes.push(b'\n');
    let path = staging.join(MANIFEST);
    write_new(&path, &bytes)?;
    let (_, manifest_sha256) = measure(&path)?;
    Ok(PayloadReference {
        manifest_sha256,
        files,
    })
}

/// Gives a staged result its published name, refusing to replace anything.
///
/// Both names are inside one store, so this is a same-volume rename; a
/// directory that appeared at the published name meanwhile is refused rather
/// than replaced.
///
/// # Errors
///
/// The rename did not happen. Nothing was published.
pub fn publish(store: &Path, artifact: ArtifactId) -> io::Result<()> {
    let staging = store.join(STAGING).join(artifact.to_string());
    rename_without_replacing(&staging, &result_directory(store, artifact))
}

/// Renames a directory, refusing an existing destination of any kind.
///
/// `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` or `MOVEFILE_COPY_ALLOWED`:
/// a rename within one volume that fails if the destination exists, and never
/// a copy dressed as a rename. `std::fs::rename` is not used, because on this
/// platform it may replace an empty destination directory.
///
/// # Errors
///
/// Whatever the platform answered.
#[cfg(windows)]
pub fn rename_without_replacing(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt as _;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "MoveFileExW"]
        fn move_file_ex_w(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    let wide = |path: &Path| -> io::Result<Vec<u16>> {
        let mut name: Vec<u16> = path.as_os_str().encode_wide().collect();
        if name.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a rename name may not contain an interior null",
            ));
        }
        name.push(0);
        Ok(name)
    };
    let (existing, new) = (wide(from)?, wide(to)?);
    // SAFETY: both buffers are null-terminated wide strings that outlive the
    // call, and a zero flag word asks for a plain same-volume rename.
    let moved = unsafe { move_file_ex_w(existing.as_ptr(), new.as_ptr(), 0) };
    if moved == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The same, with the weaker guarantee this platform offers: the destination
/// is checked and then renamed onto, so a name that appears in between may be
/// replaced. Windows is the supported target and carries the stronger form.
///
/// # Errors
///
/// Whatever the platform answered.
#[cfg(not(windows))]
pub fn rename_without_replacing(from: &Path, to: &Path) -> io::Result<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    fs::rename(from, to)
}

/// What the project document says one stored result is.
///
/// Both halves come from the document: the reference from the result's own
/// record, and the plan from the one run that produced it. A stored copy that
/// names another plan is not this result, however whole its files are -- two
/// members of one batch can hold byte-identical rows. This is a consistency
/// check between the document and its store, not an authentication against
/// someone who rewrites both.
#[derive(Debug, Clone, Copy)]
pub struct Expected<'a> {
    pub reference: &'a PayloadReference,
    pub plan_sha256: &'a str,
}

/// Whether one referenced result is whole, as it is on disk now.
///
/// Missing before corrupt: an absent file is reported as missing even where
/// another file of the same result is also wrong, because the recovery for a
/// missing store -- find it, or move the document back beside it -- is the one
/// to offer first.
#[must_use]
pub fn observe(store: &Path, artifact: ArtifactId, expected: Expected<'_>) -> Availability {
    let directory = result_directory(store, artifact);
    match fs::symlink_metadata(&directory) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Availability::Missing,
        Err(_) => return Availability::Corrupt,
        Ok(_) if !is_plain_directory(&directory) => return Availability::Corrupt,
        Ok(_) => {}
    }
    let manifest = match read_manifest(&directory, artifact, expected) {
        Ok(manifest) => manifest,
        Err(availability) => return availability,
    };
    let mut worst = Availability::Available;
    for file in &manifest.files {
        match measure(&directory.join(file.name.file_name())) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Availability::Missing,
            Err(_) => worst = Availability::Corrupt,
            Ok((length, sha256)) => {
                if length != file.byte_length || !sha256.eq_ignore_ascii_case(&file.sha256) {
                    worst = Availability::Corrupt;
                }
            }
        }
    }
    worst
}

/// Reads and checks a result's manifest against what the document says the
/// result is: the record's reference, and the producing run's plan.
fn read_manifest(
    directory: &Path,
    artifact: ArtifactId,
    expected: Expected<'_>,
) -> Result<PayloadManifest, Availability> {
    let reference = expected.reference;
    let path = directory.join(MANIFEST);
    let bytes = match local_document::read_bounded(&path, MAX_SMALL_RECORD_BYTES) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return Err(Availability::Missing),
        Err(_) => return Err(Availability::Corrupt),
    };
    let digest = digest_of(&bytes).map_err(|_| Availability::Corrupt)?;
    if !digest.eq_ignore_ascii_case(&reference.manifest_sha256) {
        return Err(Availability::Corrupt);
    }
    let manifest: PayloadManifest =
        serde_json::from_slice(&bytes).map_err(|_| Availability::Corrupt)?;
    let same_files = manifest.files.len() == reference.files.len()
        && manifest
            .files
            .iter()
            .zip(&reference.files)
            .all(|(stated, recorded)| {
                stated.name == recorded.name
                    && stated.byte_length == recorded.byte_length
                    && stated.sha256.eq_ignore_ascii_case(&recorded.sha256)
            });
    if manifest.schema != MANIFEST_SCHEMA
        || manifest.artifact_id != artifact
        || !manifest
            .plan_sha256
            .eq_ignore_ascii_case(expected.plan_sha256)
        || !same_files
    {
        return Err(Availability::Corrupt);
    }
    Ok(manifest)
}

/// How many published results in the store no record in `referenced` names.
///
/// Counted, never deleted: an orphan is a whole result a Save did not reach,
/// and it may belong to a copy of this project that does reference it.
#[must_use]
pub fn unreferenced(store: &Path, referenced: &[ArtifactId]) -> usize {
    let Ok(entries) = fs::read_dir(store) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().to_str()?.parse::<ArtifactId>().ok())
        .filter(|id| !referenced.contains(id))
        .count()
}

/// Copies one available result into a directory a Save As is assembling,
/// then checks every copied byte against the record.
///
/// # Errors
///
/// The copy failed, or what arrived is not what the record names. The caller
/// abandons the whole pending store: a destination is published whole or not
/// at all.
pub fn copy_result(
    from_store: &Path,
    into: &Path,
    artifact: ArtifactId,
    expected: Expected<'_>,
    copy_file: &dyn Fn(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let source = result_directory(from_store, artifact);
    let target = into.join(artifact.to_string());
    fs::create_dir(&target)?;
    for name in PayloadFileName::ALL
        .iter()
        .map(|name| name.file_name())
        .chain([MANIFEST])
    {
        copy_file(&source.join(name), &target.join(name))?;
    }
    match observe(into, artifact, expected) {
        Availability::Available => Ok(()),
        _ => Err(io::Error::other(
            "a copied result does not match its record",
        )),
    }
}

/// The ordinary copy a Save As uses.
///
/// # Errors
///
/// Whatever the copy answered.
pub fn plain_copy(from: &Path, to: &Path) -> io::Result<()> {
    fs::copy(from, to).map(|_| ())
}

/// Writes the owner record into a store being assembled.
///
/// # Errors
///
/// It could not be written.
pub fn write_owner(store: &Path, project: ProjectId) -> io::Result<()> {
    let owner = OwnerRecord {
        schema: OWNER_SCHEMA.to_owned(),
        project_id: project,
    };
    let bytes = serde_json::to_vec(&owner).map_err(io::Error::other)?;
    write_new(&store.join(OWNER_FILE), &bytes)
}

// ---------------------------------------------------------------------------
// The payload's contents
//
// Typed, closed and checked on the way in. The worker writes these shapes; the
// supervisor parses every line before anything is staged, and a reader parses
// them again before anything reaches the interface. Numbers are JSON numbers:
// a reader may see a value one unit in the last place away from what was
// written, which is below anything the interface displays and is why a result
// is compared by digest and never by re-serialising it.
// ---------------------------------------------------------------------------

/// What one target's row says happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RowOutcome {
    /// One candidate, selected as a feature.
    #[serde(rename = "DETECTED")]
    Detected,
    /// A feature was selected from two or more candidates.
    #[serde(rename = "DETECTED_AMBIGUOUS")]
    DetectedAmbiguous,
    /// One feature stands for this target and another.
    #[serde(rename = "SHARED")]
    Shared,
    /// Another target's overlapping feature was kept instead of this one's.
    #[serde(rename = "SUPPRESSED_BY_OVERLAP")]
    SuppressedByOverlap,
    /// The run completed, the target was processed and no candidate existed
    /// in its window. A scientific outcome, never a failure renamed.
    #[serde(rename = "NOT_DETECTED")]
    NotDetected,
    /// The row cannot be read as any of the above. The reason says why.
    #[serde(rename = "FAILED")]
    Failed,
}

/// Why one row is `FAILED`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RowFailure {
    /// The target's window meets the extractor's measured first- or last-peak
    /// defect in at least one spectrum.
    ExtractionAtSpectrumEdge,
    /// The feature standing for this target was shared with, or kept by, a
    /// target whose window meets that defect.
    RelatedTargetAtSpectrumEdge,
    /// The target had candidates and no feature: the engine removed its
    /// selection without saying why, which is not an absence.
    CandidatesWithoutFeature,
    /// The target had candidates and no feature after every fit in the run
    /// was invalid, when the engine discards every feature.
    EngineDiscardedNoValidFit,
    /// The engine's library did not contain the target.
    TargetAbsentFromEngineLibrary,
    /// The target appears nowhere in the engine's answer.
    TargetUnaccounted,
    /// No MS1 spectrum with peaks lies in the target's retention-time window,
    /// so nothing was measured there and no absence can be reported.
    WindowWithoutMs1Peaks,
}

/// Where a feature's engine intensity came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IntensitySource {
    /// The area of this feature's own valid model fit.
    ModelArea,
    /// Imputed from a regression over the other features of the run.
    ImputedFromRunRegression,
}

/// The ion one row is about.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowIon {
    pub adduct: String,
    pub charge: u8,
    /// Per trace (M, M+1), the theoretical m/z the engine extracted at.
    pub mz_theoretical: Vec<f64>,
    pub isotope_probability: Vec<f64>,
}

/// The windows one row was extracted in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowWindows {
    /// The closed retention-time interval, seconds.
    pub rt_closed_s: [f64; 2],
    /// Per trace, the open m/z interval.
    pub mz_open: Vec<[f64; 2]>,
}

/// What the extracted window held, before any peak was picked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowSignal {
    /// Spectra the window visited.
    pub points: u32,
    /// Per trace, binary64 sums of binary32-rounded intensities.
    pub sum: Vec<f64>,
    pub max: Vec<f64>,
    /// Whether any extracted point is above zero. Not a claim of signal.
    pub any_nonzero_point: bool,
}

/// The feature the engine selected.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowFeature {
    pub apex_rt_s: f64,
    pub left_s: f64,
    pub right_s: f64,
    /// The sum of raw chromatogram points in bounds over both traces, as a
    /// binary32 value. The primary quantity; not an area in intensity x s.
    pub raw_area: f64,
    /// The engine's model status text, for example `0 (valid)`.
    pub model_status: String,
    #[serde(deserialize_with = "Option::deserialize")]
    pub model_area: Option<f64>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub model_fwhm_s: Option<f64>,
    /// Depends on the other targets in the run and is not reproducible run to
    /// run; shown with its source and never used to compare.
    #[serde(deserialize_with = "Option::deserialize")]
    pub engine_intensity: Option<f64>,
    pub engine_intensity_source: IntensitySource,
}

/// One candidate the engine considered for a target.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowCandidate {
    pub apex_rt_s: f64,
    pub left_s: f64,
    pub right_s: f64,
    pub raw_area: f64,
}

/// Which other targets a row's outcome involves, by identifier.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowRelations {
    pub shared_with: Vec<TargetId>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub suppressed_by: Option<TargetId>,
    pub overlap_removed: Vec<TargetId>,
}

/// One target's row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PayloadRow {
    pub target_id: TargetId,
    pub outcome: RowOutcome,
    #[serde(deserialize_with = "Option::deserialize")]
    pub failure_reason: Option<RowFailure>,
    /// Spectrum traces the edge guard flagged; zero unless that is the reason.
    pub edge_trace_count: u32,
    #[serde(deserialize_with = "Option::deserialize")]
    pub ion: Option<RowIon>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub windows: Option<RowWindows>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub signal: Option<RowSignal>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub feature: Option<RowFeature>,
    pub candidates: Vec<RowCandidate>,
    /// Whether this row's feature was kept over another target's overlap.
    pub overlap_winner: bool,
    pub relations: RowRelations,
    /// Whether this row is `NOT_DETECTED` through the empty-selection
    /// recovery rather than through the engine's own unassigned list.
    pub recovered_from_empty_selection: bool,
}

impl PayloadRow {
    /// Whether the row says what its outcome requires and nothing its outcome
    /// excludes.
    ///
    /// The rule that matters most is the one for `NOT_DETECTED`: no candidate,
    /// no feature and no relation, over a window that was really extracted
    /// from at least one spectrum. Anything short of that is not an absence.
    #[must_use]
    pub fn is_consistent(&self) -> bool {
        let finite = |values: &[f64]| values.iter().all(|value| value.is_finite());
        let traces = self.ion.as_ref().map_or(0, |ion| ion.mz_theoretical.len());
        let extracted = self.ion.as_ref().is_some_and(|ion| {
            ion.adduct == "[M+H]+"
                && ion.charge == 1
                && traces > 0
                && ion.isotope_probability.len() == traces
                && finite(&ion.mz_theoretical)
                && finite(&ion.isotope_probability)
        }) && self.windows.as_ref().is_some_and(|windows| {
            windows.mz_open.len() == traces
                && finite(&windows.rt_closed_s)
                && windows.rt_closed_s[0] <= windows.rt_closed_s[1]
                && windows
                    .mz_open
                    .iter()
                    .all(|pair| finite(pair) && pair[0] < pair[1])
        }) && self.signal.as_ref().is_some_and(|signal| {
            signal.sum.len() == traces
                && signal.max.len() == traces
                && finite(&signal.sum)
                && finite(&signal.max)
                && signal.any_nonzero_point == signal.max.iter().any(|value| *value > 0.0)
        });
        // Extracted over at least one spectrum. Every outcome other than
        // `FAILED` is a statement about what was measured, so it needs this.
        let measured = extracted && self.signal.as_ref().is_some_and(|signal| signal.points > 0);
        let feature_sound = self.feature.as_ref().is_none_or(|feature| {
            finite(&[
                feature.apex_rt_s,
                feature.left_s,
                feature.right_s,
                feature.raw_area,
            ]) && feature.left_s <= feature.right_s
                && feature.model_area.is_none_or(f64::is_finite)
                && feature.model_fwhm_s.is_none_or(f64::is_finite)
                && feature.engine_intensity.is_none_or(f64::is_finite)
                && !feature.model_status.is_empty()
                && feature.model_status.len() <= 64
        });
        let candidates_sound = self.candidates.iter().all(|candidate| {
            finite(&[
                candidate.apex_rt_s,
                candidate.left_s,
                candidate.right_s,
                candidate.raw_area,
            ]) && candidate.left_s <= candidate.right_s
        });
        let relations = &self.relations;
        let no_relation = relations.shared_with.is_empty() && relations.suppressed_by.is_none();
        let shaped = match self.outcome {
            RowOutcome::Detected => {
                measured && self.feature.is_some() && self.candidates.len() == 1 && no_relation
            }
            RowOutcome::DetectedAmbiguous => {
                measured && self.feature.is_some() && self.candidates.len() >= 2 && no_relation
            }
            RowOutcome::Shared => {
                measured
                    && self.feature.is_some()
                    && !relations.shared_with.is_empty()
                    && relations.suppressed_by.is_none()
            }
            RowOutcome::SuppressedByOverlap => {
                measured
                    && self.feature.is_none()
                    && relations.suppressed_by.is_some()
                    && relations.shared_with.is_empty()
            }
            RowOutcome::NotDetected => {
                measured
                    && self.feature.is_none()
                    && self.candidates.is_empty()
                    && no_relation
                    && relations.overlap_removed.is_empty()
                    && !self.overlap_winner
            }
            RowOutcome::Failed => self.feature.is_none(),
        };
        let reason_fits = match (self.outcome, self.failure_reason) {
            (RowOutcome::Failed, Some(reason)) => {
                (reason == RowFailure::ExtractionAtSpectrumEdge) == (self.edge_trace_count > 0)
                    && (reason == RowFailure::TargetAbsentFromEngineLibrary || extracted)
                    && (reason == RowFailure::WindowWithoutMs1Peaks) == (extracted && !measured)
            }
            (RowOutcome::Failed, None) => false,
            (_, Some(_)) => false,
            (_, None) => self.edge_trace_count == 0,
        };
        let recovery_fits = !self.recovered_from_empty_selection
            || (self.outcome == RowOutcome::NotDetected
                || matches!(
                    self.failure_reason,
                    Some(RowFailure::ExtractionAtSpectrumEdge | RowFailure::WindowWithoutMs1Peaks)
                ));
        shaped && reason_fits && recovery_fits && feature_sound && candidates_sound
    }
}

/// One trace of one target's extracted chromatogram.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceLine {
    pub target_id: TargetId,
    /// 0 for M, 1 for M+1.
    pub trace: u8,
    pub mz_theoretical: f64,
    /// `[spectrum index in file order, retention time (s), intensity]`: the
    /// engine's own extracted points, each mapped to the spectrum it came from.
    pub points: Vec<(u32, f64, f64)>,
}

impl EvidenceLine {
    /// Whether every number is finite and the points are in retention order.
    #[must_use]
    pub fn is_consistent(&self) -> bool {
        self.trace <= 1
            && self.mz_theoretical.is_finite()
            && self
                .points
                .iter()
                .all(|(_, rt, intensity)| rt.is_finite() && intensity.is_finite())
            && self
                .points
                .windows(2)
                .all(|pair| pair[0].1 <= pair[1].1 && pair[0].0 < pair[1].0)
    }
}

/// Where one evidence line is, so a reader can take just that line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IndexLine {
    target_id: TargetId,
    trace: u8,
    offset: u64,
    length: u64,
    /// SHA-256 of exactly those bytes, so a bounded read is also a checked one.
    sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EvidenceIndex {
    schema: String,
    lines: Vec<IndexLine>,
}

/// The index of one evidence file: every line's target, trace, place and
/// digest.
fn build_index(evidence: &[u8]) -> io::Result<Vec<u8>> {
    let mut lines = Vec::new();
    let mut offset = 0_u64;
    for line in evidence.split_inclusive(|byte| *byte == b'\n') {
        let length = line.len() as u64;
        let body = line.strip_suffix(b"\n").unwrap_or(line);
        let parsed: EvidenceLine = serde_json::from_slice(body).map_err(io::Error::other)?;
        lines.push(IndexLine {
            target_id: parsed.target_id,
            trace: parsed.trace,
            offset,
            length,
            sha256: digest_of(line)?,
        });
        offset += length;
    }
    let mut bytes = serde_json::to_vec(&EvidenceIndex {
        schema: INDEX_SCHEMA.to_owned(),
        lines,
    })
    .map_err(io::Error::other)?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// Why a bounded read of a result did not answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadRefusal {
    /// The result is not whole: its availability says which way.
    Unavailable(Availability),
    /// The target is not one of this result's.
    UnknownTarget,
}

/// One page of rows.
#[derive(Debug, Clone, PartialEq)]
pub struct RowsPage {
    pub total: usize,
    pub offset: usize,
    pub rows: Vec<PayloadRow>,
}

/// Reads and checks one of a result's files whole, bounded.
fn read_checked(
    directory: &Path,
    reference: &PayloadReference,
    name: PayloadFileName,
) -> Result<Vec<u8>, ReadRefusal> {
    let recorded = reference
        .files
        .iter()
        .find(|file| file.name == name)
        .ok_or(ReadRefusal::Unavailable(Availability::Corrupt))?;
    let bytes = match local_document::read_bounded(
        &directory.join(name.file_name()),
        MAX_PAYLOAD_FILE_BYTES,
    ) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return Err(ReadRefusal::Unavailable(Availability::Missing)),
        Err(_) => return Err(ReadRefusal::Unavailable(Availability::Corrupt)),
    };
    let digest = digest_of(&bytes).map_err(|_| ReadRefusal::Unavailable(Availability::Corrupt))?;
    if bytes.len() as u64 != recorded.byte_length || !digest.eq_ignore_ascii_case(&recorded.sha256)
    {
        return Err(ReadRefusal::Unavailable(Availability::Corrupt));
    }
    Ok(bytes)
}

fn checked_directory(
    store: &Path,
    artifact: ArtifactId,
    expected: Expected<'_>,
) -> Result<PathBuf, ReadRefusal> {
    let directory = result_directory(store, artifact);
    if !is_plain_directory(&directory) {
        return Err(ReadRefusal::Unavailable(
            if fs::symlink_metadata(&directory).is_err() {
                Availability::Missing
            } else {
                Availability::Corrupt
            },
        ));
    }
    read_manifest(&directory, artifact, expected).map_err(ReadRefusal::Unavailable)?;
    Ok(directory)
}

/// One page of a result's rows, checked against the record and the producing
/// plan before any row is returned.
///
/// # Errors
///
/// A [`ReadRefusal`]: the result is missing or does not match its record.
pub fn read_rows(
    store: &Path,
    artifact: ArtifactId,
    expected: Expected<'_>,
    offset: usize,
    limit: usize,
) -> Result<RowsPage, ReadRefusal> {
    let directory = checked_directory(store, artifact, expected)?;
    let bytes = read_checked(&directory, expected.reference, PayloadFileName::Rows)?;
    let text =
        std::str::from_utf8(&bytes).map_err(|_| ReadRefusal::Unavailable(Availability::Corrupt))?;
    let lines: Vec<&str> = text.lines().collect();
    let limit = limit.min(MAX_PAGE_ROWS);
    let mut rows = Vec::new();
    for line in lines.iter().skip(offset).take(limit) {
        let row: PayloadRow = serde_json::from_str(line)
            .map_err(|_| ReadRefusal::Unavailable(Availability::Corrupt))?;
        rows.push(row);
    }
    Ok(RowsPage {
        total: lines.len(),
        offset,
        rows,
    })
}

/// One target's evidence lines, each read by itself and checked against the
/// index before it is returned.
///
/// Reads the index whole and the evidence file only where the index says the
/// target's lines are, so the size of the answer is the size of one target's
/// evidence and not of the result.
///
/// # Errors
///
/// A [`ReadRefusal`].
pub fn read_evidence(
    store: &Path,
    artifact: ArtifactId,
    expected: Expected<'_>,
    target: TargetId,
) -> Result<Vec<EvidenceLine>, ReadRefusal> {
    let corrupt = ReadRefusal::Unavailable(Availability::Corrupt);
    let reference = expected.reference;
    let directory = checked_directory(store, artifact, expected)?;
    let index_bytes = read_checked(&directory, reference, PayloadFileName::EvidenceIndex)?;
    let index: EvidenceIndex = serde_json::from_slice(&index_bytes).map_err(|_| corrupt)?;
    if index.schema != INDEX_SCHEMA {
        return Err(corrupt);
    }
    let recorded_length = reference
        .files
        .iter()
        .find(|file| file.name == PayloadFileName::Evidence)
        .map(|file| file.byte_length)
        .ok_or(corrupt)?;
    let wanted: Vec<&IndexLine> = index
        .lines
        .iter()
        .filter(|line| line.target_id == target)
        .collect();
    if wanted.is_empty() {
        return Err(ReadRefusal::UnknownTarget);
    }
    let mut file = match fs::File::open(directory.join(PayloadFileName::Evidence.file_name())) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(ReadRefusal::Unavailable(Availability::Missing));
        }
        Err(_) => return Err(corrupt),
    };
    if file.metadata().map_err(|_| corrupt)?.len() != recorded_length {
        return Err(corrupt);
    }
    let mut out = Vec::with_capacity(wanted.len());
    for line in wanted {
        if line.length > MAX_EVIDENCE_LINE_BYTES
            || line
                .offset
                .checked_add(line.length)
                .is_none_or(|end| end > recorded_length)
        {
            return Err(corrupt);
        }
        file.seek(SeekFrom::Start(line.offset))
            .map_err(|_| corrupt)?;
        let mut bytes = vec![0_u8; usize::try_from(line.length).map_err(|_| corrupt)?];
        file.read_exact(&mut bytes).map_err(|_| corrupt)?;
        if !digest_of(&bytes)
            .map_err(|_| corrupt)?
            .eq_ignore_ascii_case(&line.sha256)
        {
            return Err(corrupt);
        }
        let body = bytes.strip_suffix(b"\n").unwrap_or(&bytes);
        let parsed: EvidenceLine = serde_json::from_slice(body).map_err(|_| corrupt)?;
        if parsed.target_id != target || parsed.trace != line.trace || !parsed.is_consistent() {
            return Err(corrupt);
        }
        out.push(parsed);
    }
    Ok(out)
}
