//! The private path from an accepted workspace dataset to one converted mzML.
//!
//! No path reaches the webview from here. ADR 0011 landed this as a private
//! path with no surface; ADR 0012 gives it one, so the report below is now
//! projected into a closed transfer object as well as read from Rust. What
//! crosses is the projection, never the report: the report holds what the run
//! established, and the projection holds what the interface may show.
//!
//! What this module is for is the join. `mscanvas-proteowizard` owns admission,
//! planning, staging, execution and the integrity contract, and owns them for a
//! caller that hands it a path. The session owns the dataset roster, the
//! identity every dataset was accepted with, the hold that keeps it, and the one
//! gate every backend process goes through. Neither side can convert a dataset
//! alone, and the whole risk of connecting them lives in the order the two are
//! touched -- which is why the order is written out here once, rather than being
//! implied by where the code happens to sit.

use std::path::Path;

use mscanvas_proteowizard::{
    BackendRunFacts, ConflictPolicy, ConversionPlan, ConversionPlanError, ConversionPolicy,
    ConversionRunOutcome, ConversionRunReport, ConversionSource, ConversionSourceKind,
    InstalledHelpCapabilities, IntegrityProperty, StagingResidue, ValidationMode,
    provider_build_is_evidenced, run_conversion,
};

use super::backend::ConversionBackend;
use super::dto::{
    ConversionBackendFactsDto, ConversionConflictPolicyDto, ConversionOutputDto,
    ConversionReportDto, ConversionValidationDto, PreviewErrorDto, ValidationModeDto,
};
use super::selection::{DatasetSourceKind, source_kind_dto};

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
    /// The precise failure, reaching into the plan or integrity error where one
    /// exists. Absent unless the run failed.
    detailed_outcome: Option<&'static str>,
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
            // The two are not one answer. `outcome` groups -- a caller tells
            // finalized from skipped from failed by it -- and this one
            // explains, which is what a reader needs when the group is
            // "failed".
            detailed_outcome: match run.outcome() {
                ConversionRunOutcome::Failed(failure) => Some(failure.detailed_stable_id()),
                ConversionRunOutcome::Finalized(_)
                | ConversionRunOutcome::SkippedExistingDestination => None,
            },
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

/// Property sets as their stable identifiers, in the crate's own order.
fn property_ids<'a>(
    properties: impl IntoIterator<Item = &'a IntegrityProperty>,
) -> Vec<&'static str> {
    properties
        .into_iter()
        .map(|property| property.stable_id())
        .collect()
}

impl WorkspaceConversionReport {
    /// The projection this surface may show.
    ///
    /// Narrower than the report on purpose. Everything here is either a display
    /// name, a measurement or a stable identifier; nothing is a location, and
    /// there is no field a path could reach even if one were added upstream.
    pub(super) fn to_dto(&self) -> ConversionReportDto {
        ConversionReportDto {
            dataset_handle: self.dataset.clone(),
            source_kind: source_kind_dto(self.source_kind),
            outcome: self.outcome.to_owned(),
            detailed_outcome: self.detailed_outcome.map(str::to_owned),
            output_file_name: self.output_file_name.clone(),
            output: self.output.as_ref().map(|output| ConversionOutputDto {
                byte_length: output.byte_length,
                sha256: output.sha256.clone(),
                spectrum_count: output.spectra,
                chromatogram_count: output.chromatograms,
            }),
            validation: self
                .validation
                .as_ref()
                .map(|validation| ConversionValidationDto {
                    mode: validation_mode_dto(validation.mode),
                    fully_verified: validation.fully_verified,
                    verified: owned(&validation.verified),
                    unverified: owned(&validation.unverified),
                    inapplicable: owned(&validation.inapplicable),
                }),
            backend: self.backend.map(|backend| ConversionBackendFactsDto {
                exit_code: backend.exit_code(),
                // Milliseconds, not the Duration itself: a struct with two
                // fields would be a second time format on the wire for no
                // reader that needs one.
                elapsed_milliseconds: u64::try_from(backend.elapsed().as_millis())
                    .unwrap_or(u64::MAX),
            }),
            staging_residue: self.residue.map(|residue| residue.stable_id().to_owned()),
            installation_generation: self.installation_generation,
        }
    }
}

fn owned(properties: &[&'static str]) -> Vec<String> {
    properties
        .iter()
        .map(|property| (*property).to_owned())
        .collect()
}

/// The wire name for how an output was judged.
pub(super) const fn validation_mode_dto(mode: ValidationMode) -> ValidationModeDto {
    match mode {
        ValidationMode::SourceComparison => ValidationModeDto::SourceComparison,
        ValidationMode::OutputOnly => ValidationModeDto::OutputOnly,
    }
}

/// The conversion boundary's name for a conflict policy the webview chose.
///
/// Total, and the only crossing point. There is no overwrite member on either
/// side, so no policy the webview can name replaces a file this boundary did
/// not create.
pub(super) const fn conflict_policy(policy: ConversionConflictPolicyDto) -> ConflictPolicy {
    match policy {
        ConversionConflictPolicyDto::Fail => ConflictPolicy::Fail,
        ConversionConflictPolicyDto::Skip => ConflictPolicy::Skip,
    }
}

/// The compression every output of this workflow must carry.
///
/// Read from the policy a plan is actually fixed with rather than restated, so
/// a summary shown before a conversion and the contract applied after it cannot
/// describe different things.
pub(super) fn fixed_compression() -> &'static str {
    ConversionPolicy::default().compression().stable_id()
}

/// Which family this workflow can convert.
///
/// mzML is already the format the product reads, so converting one to another
/// is work with no product purpose; the private path supports it because the
/// crate does, and the visible workflow declines it because a user asking for
/// it has misunderstood what it does.
pub(super) const fn is_convertible(kind: DatasetSourceKind) -> bool {
    match kind {
        DatasetSourceKind::Mzml => false,
        DatasetSourceKind::ThermoRaw => true,
    }
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
