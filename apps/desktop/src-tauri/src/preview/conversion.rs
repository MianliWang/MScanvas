//! The private path from an accepted workspace dataset to one converted mzML.
//!
//! Nothing here is reachable from the webview. There is no command, no transfer
//! object and no capability behind it: the entry point is a Rust method on the
//! service, and what it answers with is a Rust value that carries no path. The
//! product's ingestion surfaces are unchanged and remain mzML-only.
//!
//! What this module is for is the join. `mscanvas-proteowizard` owns admission,
//! planning, staging, execution and the integrity contract, and owns them for a
//! caller that hands it a path. The session owns the dataset roster, the
//! identity every dataset was accepted with, the hold that keeps it, and the one
//! gate every backend process goes through. Neither side can convert a dataset
//! alone, and the whole risk of connecting them lives in the order the two are
//! touched -- which is why the order is written out here once, rather than being
//! implied by where the code happens to sit.

// Every item below is unreachable from a shipped build, because this path has
// no product surface yet and deliberately gains none in this slice. It is not
// test-only logic: it compiles into the release binary, it is the
// implementation a surface would call, and its tests exercise it rather than a
// stand-in. ADR 0011 records why it lands before the surface it serves.
//
// Stated once for the module rather than repeated on each item, and as an
// `expect` so that it stops being accepted the moment nothing here is dead.
#![cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "ADR 0011: the private conversion path lands before the surface it serves"
    )
)]

use std::path::Path;

use mscanvas_proteowizard::{
    BackendRunFacts, ConflictPolicy, ConversionPlan, ConversionPlanError, ConversionRunReport,
    ConversionSource, ConversionSourceKind, InstalledHelpCapabilities, IntegrityProperty,
    StagingResidue, ValidationMode, provider_build_is_evidenced, run_conversion,
};

use super::backend::ConversionBackend;
use super::dto::PreviewErrorDto;
use super::selection::DatasetSourceKind;

/// What one private conversion did.
///
/// Path-free by construction, and not merely by omission. The caller chose the
/// destination root and already knows it; the output is named by the file name
/// the plan derived and by what was measured of it, which is everything a caller
/// can act on and nothing that would put the user's filesystem into a log, a
/// panic message or a future transfer object built from this type.
///
/// A report exists for a refused conversion as well as a finalized one. The
/// alternative -- an error for anything that did not produce a file -- would
/// collapse "the destination name was already taken", "this build has no
/// evidence for this family" and "the output failed the integrity contract"
/// into one indistinguishable failure, and those are three different answers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkspaceConversionReport {
    /// The handle of the dataset that was converted. The opaque name the
    /// session already uses, not a location.
    dataset: String,
    /// The family the dataset was re-admitted as for this run.
    source_kind: DatasetSourceKind,
    /// What the run did, by the crate's own identifier.
    outcome: &'static str,
    /// The name a finalized output took in the destination root. A display
    /// name, not a location.
    output_file_name: Option<String>,
    /// What was measured of a finalized output.
    output: Option<OutputFacts>,
    /// How a finalized output was judged.
    validation: Option<ValidationFacts>,
    /// Bounded facts about the backend process, when one ran.
    backend: Option<BackendRunFacts>,
    /// What the run could not reclaim of its own staging area.
    ///
    /// Carried rather than dropped because a conversion that left something
    /// behind is a conversion the caller has to know about, whether or not it
    /// also produced an output.
    residue: Option<StagingResidue>,
    /// The installation sequence this run was stamped with, read at the moment
    /// the backend gate was taken.
    installation_generation: u64,
}

/// What was measured of a finalized output.
///
/// The counts are the observed ones, not the declared ones. A declared count is
/// a claim the document makes about itself; the integrity contract has already
/// compared the two, and what a caller wants to know afterwards is how many
/// records are actually there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OutputFacts {
    byte_length: u64,
    sha256: String,
    spectra: u64,
    chromatograms: u64,
}

/// How a finalized output was judged, including what the judgement could not
/// reach.
///
/// `inapplicable` is not a softer `unverified`. A property that could not apply
/// is one this source posture has no reading of at all -- a vendor acquisition
/// is not mzML, so nothing about the output can be compared to a document that
/// was never read. Reporting those as merely unverified would suggest a check
/// that could have been made and was not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ValidationFacts {
    mode: ValidationMode,
    verified: Vec<&'static str>,
    unverified: Vec<&'static str>,
    inapplicable: Vec<&'static str>,
    fully_verified: bool,
}

impl WorkspaceConversionReport {
    /// The handle of the dataset this report is about.
    pub(super) fn dataset(&self) -> &str {
        &self.dataset
    }

    /// The family the dataset was re-admitted as.
    pub(super) const fn source_kind(&self) -> DatasetSourceKind {
        self.source_kind
    }

    /// What the run did.
    pub(super) const fn outcome(&self) -> &'static str {
        self.outcome
    }

    /// The name a finalized output took, if one was finalized.
    pub(super) fn output_file_name(&self) -> Option<&str> {
        self.output_file_name.as_deref()
    }

    /// What was measured of a finalized output.
    pub(super) const fn output(&self) -> Option<&OutputFacts> {
        self.output.as_ref()
    }

    /// How a finalized output was judged.
    pub(super) const fn validation(&self) -> Option<&ValidationFacts> {
        self.validation.as_ref()
    }

    /// Bounded facts about the backend process, when one ran.
    pub(super) const fn backend(&self) -> Option<BackendRunFacts> {
        self.backend
    }

    /// What the run could not reclaim of its staging area.
    pub(super) const fn residue(&self) -> Option<StagingResidue> {
        self.residue
    }

    /// The installation sequence this run was stamped with.
    pub(super) const fn installation_generation(&self) -> u64 {
        self.installation_generation
    }

    /// Builds a report from the crate's own report, adding only what the
    /// session knows and the crate cannot: which dataset this was, what family
    /// it was admitted as, and which installation ran it.
    pub(super) fn of(
        dataset: String,
        source_kind: DatasetSourceKind,
        installation_generation: u64,
        plan: &ConversionPlan,
        run: &ConversionRunReport,
    ) -> Self {
        let finalized = run.finalized();
        Self {
            dataset,
            source_kind,
            outcome: run.outcome().stable_id(),
            // From the plan, which is where the name was decided, and only when
            // a run finalized something. Reporting the planned name for a run
            // that produced nothing would name a file that does not exist -- or
            // worse, one that does and that this run deliberately did not touch.
            output_file_name: finalized
                .map(|_| plan.output_file_name().to_string_lossy().into_owned()),
            output: finalized.map(|valid| OutputFacts {
                byte_length: valid.output().byte_length(),
                sha256: valid.output().sha256().to_string(),
                spectra: valid.output().facts().observed_spectrum_count(),
                chromatograms: valid.output().facts().observed_chromatogram_count(),
            }),
            validation: finalized.map(|valid| ValidationFacts {
                mode: valid.validation_mode(),
                verified: property_ids(valid.verified()),
                unverified: property_ids(valid.unverified()),
                inapplicable: property_ids(valid.inapplicable()),
                fully_verified: valid.is_fully_verified(),
            }),
            backend: run.backend(),
            residue: run.residue(),
            installation_generation,
        }
    }
}

impl OutputFacts {
    pub(super) const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    pub(super) fn sha256(&self) -> &str {
        &self.sha256
    }

    pub(super) const fn spectra(&self) -> u64 {
        self.spectra
    }

    pub(super) const fn chromatograms(&self) -> u64 {
        self.chromatograms
    }
}

impl ValidationFacts {
    pub(super) const fn mode(&self) -> ValidationMode {
        self.mode
    }

    pub(super) fn verified(&self) -> &[&'static str] {
        &self.verified
    }

    pub(super) fn unverified(&self) -> &[&'static str] {
        &self.unverified
    }

    pub(super) fn inapplicable(&self) -> &[&'static str] {
        &self.inapplicable
    }

    pub(super) const fn is_fully_verified(&self) -> bool {
        self.fully_verified
    }
}

/// Property sets as their stable identifiers, in the crate's own order.
fn property_ids<'a>(
    properties: impl IntoIterator<Item = &'a IntegrityProperty>,
) -> Vec<&'static str> {
    properties
        .into_iter()
        .map(|property| property.stable_id())
        .collect()
}

/// The conversion boundary's name for a family the session accepted.
///
/// A total function over the session's families, so a family added to the
/// session without a conversion boundary that knows it is a compile error
/// rather than a run-time surprise. There is deliberately no fallback: a family
/// the crate cannot name is a family it cannot convert, and guessing one would
/// admit an acquisition under another family's rules.
pub(super) const fn conversion_source_kind(kind: DatasetSourceKind) -> ConversionSourceKind {
    match kind {
        DatasetSourceKind::Mzml => ConversionSourceKind::MzmlFile,
        DatasetSourceKind::ThermoRaw => ConversionSourceKind::ThermoRawFile,
    }
}

/// Runs a planned conversion through one bound backend.
///
/// Takes the binding whole rather than its parts, so the capabilities a run is
/// gated and planned on and the process it launches cannot come from two
/// different resolutions of the installation.
pub(super) fn run_planned_conversion(
    plan: &ConversionPlan,
    backend: &ConversionBackend<'_>,
) -> ConversionRunReport {
    run_conversion(plan, &backend.capabilities, backend.runner)
}

/// Refuses a family this installation has no recorded evidence for.
///
/// The predicate is the crate's, not a copy of it. `run_conversion` applies the
/// same one regardless, so this is not the gate -- it is the same gate asked
/// early, before a destination has been opened or a staging directory created.
pub(super) fn refuse_unevidenced_build(
    capabilities: &InstalledHelpCapabilities,
    kind: ConversionSourceKind,
) -> Result<(), PreviewErrorDto> {
    if provider_build_is_evidenced(capabilities, kind) {
        return Ok(());
    }
    Err(PreviewErrorDto::new(
        "provider_build_not_evidenced",
        "MSCanvas has no conversion evidence for that acquisition format on the installed \
         ProteoWizard build.",
        false,
    ))
}

/// Plans one conversion, reporting a refusal by the plan error's own name.
pub(super) fn plan_conversion(
    source: ConversionSource,
    destination_root: &Path,
    conflict: ConflictPolicy,
) -> Result<ConversionPlan, PreviewErrorDto> {
    ConversionPlan::to_mzml(source, destination_root, conflict).map_err(not_plannable)
}

/// How a refused plan is reported.
///
/// Matched by name rather than through a catch-all for the same reason a
/// refused admission is: a plan error added later has to be answered here.
fn not_plannable(error: ConversionPlanError) -> PreviewErrorDto {
    let message = match error {
        ConversionPlanError::SourceHasNoConvertibleName
        | ConversionPlanError::UnsafeOutputFileName
        | ConversionPlanError::OutputFileNameTooLongToStage => {
            "MSCanvas could not derive a safe output name for that acquisition."
        }
        ConversionPlanError::DestinationRootNotInspectable { .. }
        | ConversionPlanError::DestinationRootNotADirectory => {
            "MSCanvas could not use that destination folder."
        }
    };
    PreviewErrorDto::new("conversion_not_plannable", message, false)
}
