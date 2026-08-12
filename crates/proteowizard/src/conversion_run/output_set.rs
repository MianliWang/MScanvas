//! The private one-source / multi-output conversion lifecycle.
//!
//! Every source family this repository admits produces exactly one mzML, and
//! the whole conversion boundary is built on that: one planned name, one staged
//! entry, one judged object, one handle-bound rename. The measured SCIEX WIFF
//! topology does not fit it — one acquisition legitimately yields one mzML *per
//! sample*, named by the backend rather than by the plan — and ADR 0018
//! recorded that as a gate rather than forcing it through.
//!
//! This module is the answer to that gate, and only to that gate. It models
//!
//! ```text
//! one logical source → one backend run → a bounded set of mzML documents
//! ```
//!
//! and proves the lifecycle: backend-authoritative names discovered in private
//! staging after the run, every member validated before the first is published,
//! group-level conflict semantics, one-at-a-time handle-bound publication that
//! is honestly *not* atomic, and an explicit partial-finalization result when
//! the filesystem makes one true.
//!
//! There are two ways in, and the difference between them is the point.
//! [`run_multi_output_conversion_evidence`] takes a Rust-owned path, applies no
//! recognition and consults no provider-evidence row; it is how the lifecycle
//! was measured before any family was admitted to it, and it stays for that.
//! [`run_admitted_multi_output_conversion`] takes an admitted
//! [`ConversionSource`], and will not start until the family is one that
//! produces a set, the installed build carries that family's evidence row by
//! digest, and every object the acquisition is made of has been proved
//! unchanged and pinned.
//!
//! **There is still no product surface.** No workspace row, no queue entry, no
//! command, no UI: a caller inside this crate can convert an admitted SCIEX
//! bundle, and nothing outside it can reach that.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use crate::capability::{InstalledHelpCapabilities, Sha256Digest};
use crate::command::{
    CommandSpec, InputSpelling, PlanError, SourceIdentity, build_msconvert_set_command_for_source,
};
use crate::conversion::{
    ConversionIntegrityOutcome, ConversionPolicy, IntegrityProperty, SourceObjectFacts,
    ValidatedConversionOutput, ValidationMode, VerifiedConversion,
    verify_staged_member_retaining_output,
};
use crate::finalized_output::FinalizedOutput;
use crate::mzml::MzmlScanLimits;
use crate::process::{ProcessRunner, Termination};
use crate::sciex_completeness::{
    BackendSampleEvidence, NoSampleLoss, SampleCompletenessRefusal, SciexSampleCompleteness,
    argv_requests_filtering, examine_backend_evidence,
};
use crate::{ConversionCancellation, fs_guard};

use super::{
    BackendExecutionFailure, BackendRunFacts, ConflictPolicy, ConversionSource,
    ConversionSourceKind, OwnedStagingArea, StagedContentObservation, StagingResidue, finalize,
};
use crate::BackendDiagnosticText;
use crate::diagnostics::Redactor;
use crate::process::ProcessOutput;

/// The most mzML documents one backend run may hand this lifecycle.
///
/// A bound, not a claim about any vendor format. The one measured multi-output
/// acquisition — the lawful SCIEX fixture ADR 0018 records — produces exactly
/// ten documents, and ProteoWizard's own committed reference outputs agree. 24
/// is more than double that measured set, and it is deliberately not the queue
/// capacity (16) or any workspace bound: this limits how many objects one run
/// may open, validate and retain at once, which is a different resource with a
/// different owner. A run that produces more is refused whole rather than
/// truncated, because a truncated set would publish an acquisition minus some
/// of its samples and call that a conversion.
pub const MAX_CONVERSION_OUTPUTS_PER_SOURCE: usize = 24;

/// Why a staging directory's contents were refused as an output set.
///
/// Path-free, like every refusal this crate publishes. The one thing a variant
/// may carry beyond a count or an [`io::ErrorKind`] is a *basename* — the
/// display-grade name of a staged member, which is derived from the source's
/// own display name and is the least that can explain a refusal.
#[derive(Clone, PartialEq, Eq)]
pub enum OutputSetRejection {
    /// The backend exited cleanly and produced nothing at all.
    NoOutputs,
    /// More members than the lifecycle's bound. Nothing was retained.
    TooManyOutputs { observed: usize },
    /// The staging directory could not be read whole.
    DirectoryUnreadable { kind: io::ErrorKind },
    /// A member is not an ordinary regular file: a directory, link or reparse
    /// point has no business in a backend's private output directory.
    NonRegularMember { member: String },
    /// A member carries a suffix backends use for unfinished output.
    PartialOutputMember { member: String },
    /// A member is not named as an mzML document, or its name is not one safe
    /// path component. Whatever it is, it is not an output this run planned
    /// for, and admitting it as a sidecar would publish something no judgement
    /// covers.
    UnexpectedMember { member: String },
    /// Two members whose names differ only by ASCII case. A case-insensitive
    /// destination directory holds one of them, so publishing both would leave
    /// the set half-published for a reason discovery could see first.
    CaseInsensitiveDuplicateMember { member: String },
}

impl OutputSetRejection {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::NoOutputs => "output_set_empty",
            Self::TooManyOutputs { .. } => "output_set_over_bound",
            Self::DirectoryUnreadable { .. } => "output_set_directory_unreadable",
            Self::NonRegularMember { .. } => "output_set_member_not_regular",
            Self::PartialOutputMember { .. } => "output_set_member_partial",
            Self::UnexpectedMember { .. } => "output_set_member_unexpected",
            Self::CaseInsensitiveDuplicateMember { .. } => "output_set_member_case_duplicate",
        }
    }
}

impl std::fmt::Debug for OutputSetRejection {
    /// The stable identifier plus the bounded shape, with the member name
    /// redacted. A backend-chosen basename embeds the vendor's own sample
    /// identifiers, and a debug projection is exactly where such a value would
    /// leak into a log or a panic message nobody meant to publish. Intentional
    /// reporting reads the fields by matching; this renders none of them.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooManyOutputs { observed } => formatter
                .debug_struct("TooManyOutputs")
                .field("observed", observed)
                .finish(),
            Self::DirectoryUnreadable { kind } => formatter
                .debug_struct("DirectoryUnreadable")
                .field("kind", kind)
                .finish(),
            _ => formatter.write_str(self.stable_id()),
        }
    }
}

/// One discovered staged member: its backend-chosen name and the length the
/// directory reported for it.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct DiscoveredMember {
    name: OsString,
    byte_length: u64,
}

impl std::fmt::Debug for DiscoveredMember {
    /// The shape, never the name. A backend-chosen basename embeds the
    /// vendor's own sample identifiers, and this type is exactly what a
    /// `Vec<DiscoveredMember>` in a failed `expect_err` would print.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DiscoveredMember")
            .field("name", &"<redacted>")
            .field("byte_length", &self.byte_length)
            .finish()
    }
}

impl DiscoveredMember {
    pub(crate) fn name(&self) -> &OsStr {
        &self.name
    }

    fn display_name(&self) -> String {
        self.name.to_string_lossy().into_owned()
    }

    /// A member with this name and no length, for testing the comparison
    /// against a declaration. Discovery is the only production constructor.
    #[cfg(test)]
    pub(crate) fn named_for_test(name: &str) -> Self {
        Self {
            name: OsString::from(name),
            byte_length: 0,
        }
    }
}

/// The exact line the measured backend prints immediately before it writes
/// each document.
///
/// Bound to a build, deliberately. This is not a documented interface and
/// nothing pretends it is one; it is a measured behaviour of the exact
/// `msconvert.exe` the provider-evidence row pins by digest, in the same way
/// the input spelling and the reader's companion requirement are measured
/// behaviours of that build. A build whose wording differs is a build with no
/// evidence row, and the family is refused before it could get here.
const OUTPUT_DECLARATION_PREFIX: &str = "writing output file: ";

/// The output names the backend itself said it wrote.
///
/// ## Why this exists
///
/// ADR 0021 left one gate open and named it: discovery trusts the staged
/// directory's contents, and an open directory handle does not stop another
/// local process from adding an entry to it. For a single-output run an extra
/// entry is refused, because exactly one was planned. For a *set* there is no
/// planned set, so an injected valid mzML would be validated, published and
/// credited to the acquisition — a refusal turned into an admission, which is
/// strictly worse than the exposure it grew out of.
///
/// This closes that. The backend announces each document on its own stdout,
/// which reaches this process through an anonymous pipe created here and
/// inherited only by the child it spawned — so unlike the staging directory,
/// it is not a place another local process can put things. Requiring the
/// discovered set to be exactly the declared set restores the single-output
/// boundary's property: a member nobody's backend claimed to write is refused,
/// and the whole set with it.
///
/// ## What it does not establish
///
/// It is a check against *additions*, not a completeness proof. Upstream's
/// `Reader_ABI::read` catches a per-sample failure, logs it and continues, so
/// an acquisition whose samples partly fail to open produces fewer documents,
/// declares exactly those fewer documents, and exits zero. Declaration and
/// discovery agree, and both are short. Nothing in this boundary can currently
/// tell that from a complete conversion.
///
/// Nor does it protect a member's *content*: an attacker who can write into the
/// staging directory can overwrite a declared member before validation, which
/// is the exposure that already existed for a single output and is unchanged.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct DeclaredOutputSet {
    names: Vec<String>,
    /// The declaration could not be read whole, so it cannot be compared
    /// against anything. Kept as a flag rather than an error because a
    /// declaration that is merely absent and one that is unreadable both mean
    /// the same thing here: refuse.
    unreadable: bool,
}

impl std::fmt::Debug for DeclaredOutputSet {
    /// The shape, never the names.
    ///
    /// The same discipline every other type in this module keeps, for the same
    /// reason: these are backend-chosen basenames carrying the vendor's own
    /// sample identifiers, and a derived projection would put all of them into
    /// the first panic message or assertion failure that touched this value.
    /// The count and whether the declaration could be read are what a reader of
    /// such a message actually needs.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DeclaredOutputSet")
            .field("declared", &self.names.len())
            .field("unreadable", &self.unreadable)
            .finish()
    }
}

impl DeclaredOutputSet {
    /// Reads the declaration out of a completed run's captured stdout.
    ///
    /// The bytes are required to be UTF-8 — measured on this build, including
    /// for a non-ASCII output name, where the declared bytes are byte-identical
    /// to the name's own UTF-8 encoding rather than console-encoded. Anything
    /// else is a declaration this cannot read, and an unreadable declaration
    /// refuses the run rather than waving it through.
    pub(crate) fn from_backend_stdout(stdout: &[u8], truncated: bool) -> Self {
        let Ok(text) = std::str::from_utf8(stdout) else {
            return Self {
                names: Vec::new(),
                unreadable: true,
            };
        };
        let mut names = Vec::new();
        // A truncated capture is a partial declaration, and a partial
        // declaration compared against a whole directory would refuse honest
        // runs and, worse, could be *made* to match by an injector who knew the
        // prefix. Neither is a comparison worth making.
        let mut unreadable = truncated;
        for line in text.lines() {
            let Some(declared) = line.trim_end().strip_prefix(OUTPUT_DECLARATION_PREFIX) else {
                continue;
            };
            // The backend prints an absolute path; only the last component can
            // be compared with a directory entry. Both separators, because the
            // spelling that reaches the backend is the caller's.
            let basename = declared.rsplit(['\\', '/']).next().unwrap_or(declared);
            if basename.is_empty() {
                unreadable = true;
                continue;
            }
            if names.len() == MAX_CONVERSION_OUTPUTS_PER_SOURCE {
                // Past the bound the set is refused whichever way this went;
                // stopping here keeps the parse bounded by the same number the
                // lifecycle is bounded by.
                unreadable = true;
                break;
            }
            names.push(basename.to_owned());
        }
        Self { names, unreadable }
    }

    /// How many documents the backend said it wrote.
    pub(crate) fn len(&self) -> usize {
        self.names.len()
    }

    /// Whether the discovered members are exactly what was declared.
    ///
    /// Exact string equality after sorting, not a case-folded comparison. Both
    /// sides come from the same event — the backend printed the name it was
    /// about to write, then wrote it — so any difference at all is a difference
    /// worth refusing, and folding would only discard information. A member
    /// whose name is not valid Unicode has no comparable form and fails the
    /// match, which is the safe direction: discovery already requires a safe
    /// single-component mzML name, so this costs nothing real.
    pub(crate) fn matches(&self, discovered: &[DiscoveredMember]) -> bool {
        if self.unreadable || self.names.len() != discovered.len() {
            return false;
        }
        let mut found: Vec<&str> = Vec::with_capacity(discovered.len());
        for member in discovered {
            let Some(name) = member.name().to_str() else {
                return false;
            };
            found.push(name);
        }
        found.sort_unstable();
        let mut declared: Vec<&str> = self.names.iter().map(String::as_str).collect();
        declared.sort_unstable();
        found == declared
    }
}

/// Reads the staged output directory as a bounded set of mzML members.
///
/// The directory is the sole authority for what the backend produced: nothing
/// here reads stdout, counts source samples or trusts a name prefix. The order
/// returned is the snapshot's — the repository's stable Windows filename order
/// — and it is *application* ordering: deterministic so reports and
/// publication are reproducible, and not a claim about vendor sample order.
pub(crate) fn discover_staged_output_set(
    output_directory: &Path,
) -> Result<Vec<DiscoveredMember>, OutputSetRejection> {
    // Bounded enumeration, not a bounded answer over an unbounded reading. A
    // backend that filled staging is refused after `MAX + 1` entries rather
    // than after a metadata read for every one of them.
    let snapshot = match fs_guard::snapshot_output_directory_bounded(
        output_directory,
        MAX_CONVERSION_OUTPUTS_PER_SOURCE,
    ) {
        Ok(fs_guard::BoundedSnapshot::Within(snapshot)) => snapshot,
        Ok(fs_guard::BoundedSnapshot::OverBound { observed }) => {
            return Err(OutputSetRejection::TooManyOutputs { observed });
        }
        Err(error) => {
            return Err(OutputSetRejection::DirectoryUnreadable {
                kind: match error {
                    fs_guard::RegularFileError::Io { kind } => kind,
                    _ => io::ErrorKind::Other,
                },
            });
        }
    };
    if snapshot.is_empty() {
        return Err(OutputSetRejection::NoOutputs);
    }

    let mut members: Vec<DiscoveredMember> = Vec::with_capacity(snapshot.len());
    for entry in snapshot.entries() {
        let member = entry.file_name().to_string_lossy().into_owned();
        // Partial first: an in-progress name explains more than "unexpected".
        if entry.has_partial_suffix() {
            return Err(OutputSetRejection::PartialOutputMember { member });
        }
        if entry.kind() != fs_guard::OutputEntryKind::RegularFile {
            return Err(OutputSetRejection::NonRegularMember { member });
        }
        // An mzML name that is exactly one ordinary path component. The
        // component rule is the same lock finalization applies again later;
        // checked here as well so a crafted name refuses the whole set before
        // anything is opened.
        if !entry.has_extension("mzML")
            || finalize::single_component(entry.file_name()).is_err()
            || Path::new(entry.file_name())
                .file_stem()
                .is_none_or(|stem| stem.is_empty())
        {
            return Err(OutputSetRejection::UnexpectedMember { member });
        }
        // ASCII case only, and the narrowness is the point.
        //
        // These members coexist in one directory *on the destination's own
        // volume* -- staging is created inside the destination root -- so the
        // volume has already proved it tells their names apart, and anything
        // it distinguishes here it can hold there. Full Unicode uppercasing
        // does not agree with a volume's upcase table at the edges: it expands
        // `ß` to `SS`, so it would refuse a `straße.mzML` / `STRASSE.mzML`
        // pair that NTFS keeps apart and would have published perfectly well.
        // The queue's own collision rule folds that way deliberately, because
        // there the two names come from rows that need not coexist anywhere;
        // here they demonstrably do.
        //
        // What is left is the case a case-sensitive staging directory can
        // produce under a case-insensitive destination -- Windows sets that
        // flag per directory -- where the second publication would hit the
        // no-clobber rename. Catching it here refuses the set whole instead of
        // leaving it half-published. An exotic non-ASCII equivalence this
        // misses is not a hazard: it falls through to the same no-clobber
        // rename and becomes an honest partial finalization. Nothing is ever
        // overwritten either way.
        if members
            .iter()
            .any(|seen| seen.name().eq_ignore_ascii_case(entry.file_name()))
        {
            return Err(OutputSetRejection::CaseInsensitiveDuplicateMember { member });
        }
        members.push(DiscoveredMember {
            name: entry.file_name().to_owned(),
            byte_length: entry.byte_length(),
        });
    }
    Ok(members)
}

/// What one member of the set is, in the report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMemberState {
    /// Judged valid; no destination name was ever taken for it.
    ValidatedNotPublished,
    /// Judged valid and renamed to its final destination name.
    Finalized,
    /// Never validated, or its publication never began. Nothing exists for it
    /// at the destination.
    NotPublished,
}

impl OutputMemberState {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::ValidatedNotPublished => "validated_not_published",
            Self::Finalized => "finalized",
            Self::NotPublished => "not_published",
        }
    }
}

/// What was established about one member.
///
/// The name is intentionally reachable only through [`Self::file_name`]: a
/// backend-chosen basename embeds the vendor's own sample identifiers, so the
/// debug projection below redacts it and a caller that wants it says so.
#[derive(Clone, PartialEq, Eq)]
pub struct OutputMemberReport {
    file_name: String,
    state: OutputMemberState,
    validation: Option<OutputMemberValidation>,
}

impl std::fmt::Debug for OutputMemberReport {
    /// State and shape, with the backend-chosen name redacted. Reports carry
    /// names through accessors on purpose; incidental diagnostics do not.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OutputMemberReport")
            .field("file_name", &"<redacted>")
            .field("state", &self.state)
            .field("validated", &self.validation.is_some())
            .finish()
    }
}

impl OutputMemberReport {
    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    #[must_use]
    pub const fn state(&self) -> OutputMemberState {
        self.state
    }

    #[must_use]
    pub const fn validation(&self) -> Option<&OutputMemberValidation> {
        self.validation.as_ref()
    }
}

/// The safe facts of one validated member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputMemberValidation {
    byte_length: u64,
    sha256: String,
    spectra: u64,
    chromatograms: u64,
    mode: ValidationMode,
    verified: Vec<&'static str>,
    unverified: Vec<&'static str>,
    inapplicable: Vec<&'static str>,
}

impl OutputMemberValidation {
    fn of(valid: &crate::conversion::ValidConversion) -> Self {
        let ids = |properties: &std::collections::BTreeSet<IntegrityProperty>| {
            properties
                .iter()
                .map(|property| property.stable_id())
                .collect()
        };
        Self {
            byte_length: valid.output().byte_length(),
            sha256: valid.output().sha256().to_string(),
            spectra: valid.output().facts().observed_spectrum_count(),
            chromatograms: valid.output().facts().observed_chromatogram_count(),
            mode: valid.validation_mode(),
            verified: ids(valid.verified()),
            unverified: ids(valid.unverified()),
            inapplicable: ids(valid.inapplicable()),
        }
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    #[must_use]
    pub const fn spectrum_count(&self) -> u64 {
        self.spectra
    }

    #[must_use]
    pub const fn chromatogram_count(&self) -> u64 {
        self.chromatograms
    }

    #[must_use]
    pub const fn validation_mode(&self) -> ValidationMode {
        self.mode
    }

    #[must_use]
    pub fn verified(&self) -> &[&'static str] {
        &self.verified
    }

    #[must_use]
    pub fn unverified(&self) -> &[&'static str] {
        &self.unverified
    }

    #[must_use]
    pub fn inapplicable(&self) -> &[&'static str] {
        &self.inapplicable
    }
}

/// Why a run published nothing.
///
/// Path-free. Where a variant names members it names bounded basenames, and
/// only the ones needed to explain the refusal.
#[derive(PartialEq)]
pub enum MultiOutputFailure {
    /// The command could not be planned against these capabilities.
    NotPlannable(PlanError),
    /// The source object could not be captured or pinned.
    SourceNotCaptured { kind: io::ErrorKind },
    /// The destination root could not be opened and pinned.
    DestinationRootNotOpened { kind: io::ErrorKind },
    /// The staging area could not be created exclusively.
    StagingNotCreated { kind: io::ErrorKind },
    /// A staging area already occupies the derived name.
    StagingTargetExists,
    /// The process boundary failed.
    Backend(BackendExecutionFailure),
    /// The backend ran and rejected the input.
    BackendRejected { exit_code: Option<i32> },
    /// The backend ended without an ordinary exit and nobody asked it to stop.
    BackendDidNotComplete,
    /// A stop was requested and the owned tree was confirmed gone.
    Cancelled { surviving_processes: Option<u32> },
    /// A stop was requested and this boundary cannot say the tree is gone.
    CancellationNotConfirmed(BackendExecutionFailure),
    /// The staged contents were not an acceptable output set.
    OutputSet(OutputSetRejection),
    /// A member failed validation. Per the all-before-any rule, nothing was
    /// published for any member.
    MemberRejected {
        member: String,
        rejection: ConversionIntegrityOutcome,
    },
    /// The destination could not be inspected for the set preflight.
    DestinationNotInspectable { kind: io::ErrorKind },
    /// Under [`ConflictPolicy::Fail`], at least one planned final name is
    /// already occupied.
    DestinationOccupied { occupied: Vec<String> },
    /// Under [`ConflictPolicy::Skip`], a strict subset of the planned names is
    /// occupied. Skipping some members of one acquisition and publishing the
    /// rest would present a partial acquisition as a converted one, so the set
    /// is refused whole.
    MixedDestinationConflict { occupied: Vec<String> },
    /// The first publication failed, so nothing was published. A failure after
    /// earlier members were already published is not this — it is
    /// [`MultiOutputOutcome::PartiallyFinalized`].
    MemberNotFinalized { member: String, kind: io::ErrorKind },
    /// The staged set is not the set the backend said it wrote.
    ///
    /// Counts only, because a name that is in one set and not the other is
    /// either the backend's or the injector's and this refusal cannot say
    /// which.
    OutputSetNotAsDeclared { declared: usize, discovered: usize },
    /// The source's family does not convert to a set of documents, so this
    /// lifecycle is not the one for it.
    SourceFamilyNotMultiOutput,
    /// The installed build is not one this source's family has been converted
    /// on and recorded against.
    ProviderBuildNotEvidenced,
    /// An object the acquisition is made of is no longer the object that was
    /// admitted, or could not be rechecked.
    SourceNotStillAdmitted(super::ConversionRunFailure),
    /// The acquisition's objects could not be bound to the command — more
    /// members than the bound allows, or a command with no source at all.
    SourceBundleNotBound,
    /// One of the names this set discovered is already owned by something
    /// outside this run -- in practice, another item of the same queue.
    ///
    /// Not a destination conflict. The destination may well be empty at that
    /// name; what is occupied is the *plan*, and no conflict policy has an
    /// opinion about which of two acquisitions should win a name neither of
    /// them has written yet.
    OutputNameClaimedElsewhere { name: String },
    /// The run could not be shown to have converted every sample the reader
    /// identified, so nothing was published.
    ///
    /// A refusal rather than a warning, and taken before the first member
    /// reaches its destination: a partially converted acquisition that had
    /// already been written could not be withdrawn without deleting the user's
    /// files, and this boundary does not delete a finalized output to tidy up
    /// a claim it should not have made.
    SampleCompletenessNotEstablished(SampleCompletenessRefusal),
}

impl MultiOutputFailure {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::NotPlannable(_) => "multi_output_not_plannable",
            Self::SourceNotCaptured { .. } => "multi_output_source_not_captured",
            Self::DestinationRootNotOpened { .. } => "multi_output_destination_root_not_opened",
            Self::StagingNotCreated { .. } => "multi_output_staging_not_created",
            Self::StagingTargetExists => "multi_output_staging_target_exists",
            Self::Backend(_) => "multi_output_backend_failure",
            Self::BackendRejected { .. } => "multi_output_backend_rejected",
            Self::BackendDidNotComplete => "multi_output_backend_did_not_complete",
            Self::Cancelled { .. } => "multi_output_cancelled",
            Self::CancellationNotConfirmed(_) => "multi_output_cancellation_not_confirmed",
            Self::OutputSet(_) => "multi_output_set_rejected",
            Self::MemberRejected { .. } => "multi_output_member_rejected",
            Self::DestinationNotInspectable { .. } => "multi_output_destination_not_inspectable",
            Self::DestinationOccupied { .. } => "multi_output_destination_occupied",
            Self::MixedDestinationConflict { .. } => "multi_output_mixed_destination_conflict",
            Self::MemberNotFinalized { .. } => "multi_output_member_not_finalized",
            Self::OutputSetNotAsDeclared { .. } => "multi_output_set_not_as_declared",
            Self::SourceFamilyNotMultiOutput => "multi_output_source_family_not_multi_output",
            Self::ProviderBuildNotEvidenced => "multi_output_provider_build_not_evidenced",
            Self::SourceNotStillAdmitted(_) => "multi_output_source_not_still_admitted",
            Self::SourceBundleNotBound => "multi_output_source_bundle_not_bound",
            Self::OutputNameClaimedElsewhere { .. } => "multi_output_output_name_claimed_elsewhere",
            Self::SampleCompletenessNotEstablished(refusal) => refusal.stable_id(),
        }
    }
}

impl std::fmt::Debug for MultiOutputFailure {
    /// The stable identifier plus bounded, name-free shape. Member basenames
    /// stay out of every debug projection for the reason the set rejection's
    /// does; the counts say how much was involved without saying what it was
    /// called. Reports carry names deliberately, through accessors -- a debug
    /// string is not a report.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotPlannable(error) => {
                formatter.debug_tuple("NotPlannable").field(error).finish()
            }
            Self::SourceNotCaptured { kind } => formatter
                .debug_struct("SourceNotCaptured")
                .field("kind", kind)
                .finish(),
            Self::DestinationRootNotOpened { kind } => formatter
                .debug_struct("DestinationRootNotOpened")
                .field("kind", kind)
                .finish(),
            Self::StagingNotCreated { kind } => formatter
                .debug_struct("StagingNotCreated")
                .field("kind", kind)
                .finish(),
            Self::Backend(cause) => formatter.debug_tuple("Backend").field(cause).finish(),
            Self::BackendRejected { exit_code } => formatter
                .debug_struct("BackendRejected")
                .field("exit_code", exit_code)
                .finish(),
            Self::Cancelled {
                surviving_processes,
            } => formatter
                .debug_struct("Cancelled")
                .field("surviving_processes", surviving_processes)
                .finish(),
            Self::CancellationNotConfirmed(cause) => formatter
                .debug_tuple("CancellationNotConfirmed")
                .field(cause)
                .finish(),
            Self::OutputSet(rejection) => {
                formatter.debug_tuple("OutputSet").field(rejection).finish()
            }
            Self::MemberRejected { rejection, .. } => formatter
                .debug_struct("MemberRejected")
                .field("member", &"<redacted>")
                .field("rejection", rejection)
                .finish(),
            Self::DestinationNotInspectable { kind } => formatter
                .debug_struct("DestinationNotInspectable")
                .field("kind", kind)
                .finish(),
            Self::DestinationOccupied { occupied } => formatter
                .debug_struct("DestinationOccupied")
                .field("occupied_count", &occupied.len())
                .finish(),
            Self::MixedDestinationConflict { occupied } => formatter
                .debug_struct("MixedDestinationConflict")
                .field("occupied_count", &occupied.len())
                .finish(),
            Self::OutputSetNotAsDeclared {
                declared,
                discovered,
            } => formatter
                .debug_struct("OutputSetNotAsDeclared")
                .field("declared", declared)
                .field("discovered", discovered)
                .finish(),
            Self::SourceFamilyNotMultiOutput => formatter.write_str("SourceFamilyNotMultiOutput"),
            Self::ProviderBuildNotEvidenced => formatter.write_str("ProviderBuildNotEvidenced"),
            Self::SourceNotStillAdmitted(failure) => formatter
                .debug_tuple("SourceNotStillAdmitted")
                .field(failure)
                .finish(),
            Self::SourceBundleNotBound => formatter.write_str("SourceBundleNotBound"),
            // The name stays out, like every other member basename here. It is
            // in the report, through an accessor, because a refusal has to say
            // which name it was about; a debug string is not a report.
            Self::OutputNameClaimedElsewhere { .. } => {
                formatter.write_str("OutputNameClaimedElsewhere")
            }
            Self::SampleCompletenessNotEstablished(refusal) => formatter
                .debug_tuple("SampleCompletenessNotEstablished")
                .field(refusal)
                .finish(),
            Self::MemberNotFinalized { kind, .. } => formatter
                .debug_struct("MemberNotFinalized")
                .field("member", &"<redacted>")
                .field("kind", kind)
                .finish(),
            Self::StagingTargetExists | Self::BackendDidNotComplete => {
                formatter.write_str(self.stable_id())
            }
        }
    }
}

/// How one multi-output run ended, as a group.
#[derive(PartialEq)]
pub enum MultiOutputOutcome {
    /// Every member was validated and every member received its final name.
    FullyFinalized,
    /// Under [`ConflictPolicy::Skip`], every planned final name was already
    /// occupied, so the whole set was skipped and nothing was touched. The
    /// occupants were never inspected and are never called this run's outputs.
    SkippedExistingDestinations,
    /// Nothing was published, for the stated reason.
    RefusedBeforePublication(MultiOutputFailure),
    /// Publication stopped partway: the named members hold their final
    /// destination names, and the rest were never published.
    ///
    /// This is the honest name for what a sequence of single-file renames can
    /// leave behind. The published members are the user's files and are not
    /// rolled back; the staged remainder was cleaned with the staging area.
    PartiallyFinalized {
        /// Members that received their final names, in publication order.
        finalized: Vec<String>,
        /// The member whose publication failed.
        failed_member: String,
        /// Why it failed, as the filesystem reported it.
        kind: io::ErrorKind,
        /// Members never published: the failed one first, then every member
        /// that was still waiting.
        not_published: Vec<String>,
    },
}

impl std::fmt::Debug for MultiOutputOutcome {
    /// Stable identifiers and counts; member basenames stay out, as they do
    /// on every failure projection in this module.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FullyFinalized | Self::SkippedExistingDestinations => {
                formatter.write_str(self.stable_id())
            }
            Self::RefusedBeforePublication(failure) => formatter
                .debug_tuple("RefusedBeforePublication")
                .field(failure)
                .finish(),
            Self::PartiallyFinalized {
                finalized,
                kind,
                not_published,
                ..
            } => formatter
                .debug_struct("PartiallyFinalized")
                .field("finalized_count", &finalized.len())
                .field("failed_member", &"<redacted>")
                .field("kind", kind)
                .field("not_published_count", &not_published.len())
                .finish(),
        }
    }
}

impl MultiOutputOutcome {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::FullyFinalized => "fully_finalized",
            Self::SkippedExistingDestinations => "skipped_existing_destinations",
            Self::RefusedBeforePublication(_) => "refused_before_publication",
            Self::PartiallyFinalized { .. } => "partially_finalized",
        }
    }
}

/// What one multi-output run established. Path-free by construction.
pub struct MultiOutputConversionReport {
    outcome: MultiOutputOutcome,
    /// What was in the staging directory when a stop reached this run.
    ///
    /// Taken only on the cancellation paths, because it is the one
    /// partial-output claim a run makes about itself and a run that reached its
    /// own end has already said what it published.
    staged: Option<StagedContentObservation>,
    members: Vec<OutputMemberReport>,
    backend: Option<BackendRunFacts>,
    residue: Option<StagingResidue>,
    /// Bounded, redacted backend text, retained only where a run is worth
    /// diagnosing: the backend rejected the input, did not complete, or exited
    /// cleanly and produced something the lifecycle then refused. A run that
    /// finalized keeps none, exactly as the single-output boundary keeps none.
    diagnostics: Option<Box<BackendDiagnosticText>>,
}

impl std::fmt::Debug for MultiOutputConversionReport {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MultiOutputConversionReport")
            .field("outcome", &self.outcome)
            .field("members", &self.members)
            .field("backend", &self.backend)
            .field("residue", &self.residue)
            .field("diagnostics_retained", &self.diagnostics.is_some())
            .finish()
    }
}

impl MultiOutputConversionReport {
    #[must_use]
    pub const fn outcome(&self) -> &MultiOutputOutcome {
        &self.outcome
    }

    /// Every member the run discovered, in the deterministic application
    /// order, with what happened to each.
    #[must_use]
    pub fn members(&self) -> &[OutputMemberReport] {
        &self.members
    }

    #[must_use]
    pub const fn backend(&self) -> Option<BackendRunFacts> {
        self.backend
    }

    #[must_use]
    pub const fn residue(&self) -> Option<StagingResidue> {
        self.residue
    }

    /// What was staged when a stop reached this run, where one did.
    #[must_use]
    pub const fn staged_content(&self) -> Option<StagedContentObservation> {
        self.staged
    }

    /// Takes the redacted backend text out of the report.
    ///
    /// The same move the single-output report offers, for the same reason: a
    /// caller that keeps the report for display must be able to put the largest
    /// thing on it somewhere with a shorter life, and copying it would leave two
    /// of it.
    #[must_use]
    pub fn take_backend_text(&mut self) -> Option<Box<BackendDiagnosticText>> {
        self.diagnostics.take()
    }

    /// Bounded, redacted backend text for a diagnosis-worthy run.
    #[must_use]
    pub fn diagnostics(&self) -> Option<&BackendDiagnosticText> {
        self.diagnostics.as_deref()
    }
}

/// The finalized objects a run retained, beside the report rather than in it.
///
/// One [`FinalizedOutput`] per member that really received its final name — a
/// fully finalized run retains all of them, a partially finalized run retains
/// exactly the published prefix. Dropping this closes the retained handles and
/// deletes nothing: the outputs are the user's files.
pub struct FinalizedOutputSet {
    outputs: Vec<FinalizedOutput>,
}

impl FinalizedOutputSet {
    #[must_use]
    pub fn len(&self) -> usize {
        self.outputs.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.outputs.is_empty()
    }

    #[must_use]
    pub fn outputs(&self) -> &[FinalizedOutput] {
        &self.outputs
    }

    /// Hands the retained objects to a caller that will own them, in
    /// publication order.
    ///
    /// Ownership rather than a copy, because a [`FinalizedOutput`] holds the
    /// handle that keeps its object from being reissued and there is no way to
    /// duplicate that meaningfully: two of them would be two claims on one
    /// object, and the second would outlive whatever the first was for.
    ///
    /// The order is the one publication used, which is the lifecycle's stable
    /// application order over the discovered set. A caller pairing these with
    /// the report's members relies on that, and should say so where it does.
    #[must_use]
    pub fn into_outputs(self) -> Vec<FinalizedOutput> {
        self.outputs
    }
}

impl std::fmt::Debug for FinalizedOutputSet {
    /// A count, deliberately. The retained objects hold open handles, and the
    /// report beside this set already carries every safe fact about them.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FinalizedOutputSet")
            .field("outputs", &self.outputs.len())
            .finish()
    }
}

/// Whether anything outside this run already owns the names it wants.
///
/// This lifecycle knows about staged files and destination entries. It does not
/// know that another item of the same queue has already promised one of these
/// names to a different acquisition, and it must not learn -- a queue is not a
/// concept a conversion boundary should carry. So the question is asked
/// outward, once, with the complete discovered set, after every member is known
/// good and **before** the destination is inspected.
///
/// Before the destination inspection deliberately, and that ordering is the
/// whole point of asking. A name an earlier item of the same queue already
/// published is an ordinary file by then, so the conflict policy would answer
/// for it: under `Fail` a refusal blaming something that was already there, and
/// under `Skip` the far worse answer that this acquisition is already
/// converted -- when what sits at that name is somebody else's output.
pub enum OutputNamesClaimed {
    /// Nothing outside this run owns any of them.
    None,
    /// One of them is already owned. One basename, because that is what the
    /// caller knows and all the refusal needs.
    Already { name: String },
}

/// What a caller may contribute to one set run beyond its inputs.
///
/// Two powers, kept apart because they are not the same kind of thing.
pub struct SetRunSeam<'a> {
    /// The claim gate: asked once, with the complete discovered set, and able
    /// to refuse the whole run before any name is taken. Production's queue is
    /// the caller this exists for. See [`OutputNamesClaimed`].
    pub names_claimed: &'a mut dyn FnMut(&[String]) -> OutputNamesClaimed,
    /// Asked before each member's rename, and unable to refuse anything.
    ///
    /// The deterministic suite's, for the one interval this lifecycle's central
    /// claims are about: a name taken between the preflight that found it free
    /// and the rename that wanted it is the only way a real filesystem produces
    /// [`MultiOutputOutcome::PartiallyFinalized`], and a test must not have to
    /// win that race. The hook is handed a position and nothing else -- no
    /// object, no handle, no name -- so all it can do is act on the world,
    /// exactly as another process could.
    pub before_member_publication: &'a mut dyn FnMut(usize),
}

/// What, beyond the lifecycle's own rules, must hold before a set may publish.
///
/// Named at the call site rather than inferred, and deliberately a closed
/// enumeration rather than a hook: this lifecycle knows about staged files and
/// destination names, and it must not grow an opinion about source samples. It
/// knows only that a requirement can refuse, and which one was asked for.
pub(crate) enum PrePublicationRequirement {
    /// Nothing beyond what the lifecycle already checks.
    None,
    /// Every sample the SCIEX reader identified must have produced its output.
    /// See [`crate::sciex_completeness`] for what that is proved from.
    SciexSampleCompleteness { executable_sha256: Sha256Digest },
}

/// One multi-output run: the path-free report, the retained objects, and
/// whatever the pre-publication requirement established.
#[derive(Debug)]
pub struct MultiOutputConversionRun {
    pub report: MultiOutputConversionReport,
    pub retained: FinalizedOutputSet,
    /// The completeness judgement, for a run that asked for one.
    ///
    /// `None` means the question was never posed — every family but SCIEX, and
    /// the evidence entry point. It does not mean "incomplete", which is why it
    /// is an `Option` of a judgement rather than a judgement with a neutral
    /// value.
    pub completeness: Option<SciexSampleCompleteness>,
}

/// Runs one acquisition through the multi-output lifecycle, for evidence.
///
/// **This is not a production conversion.** It takes a Rust-owned path rather
/// than an admitted source, applies no source-family recognition and consults
/// no provider-evidence row — which is how the lifecycle was measured before
/// any family was admitted to it, and is why it stays. Production conversion
/// of an admitted family is
/// [`run_admitted_multi_output_conversion`], which reaches this same body only
/// after the gates this one has none of.
///
/// What it shares with production is everything that matters for the evidence:
/// the reviewed process boundary, the private staging ownership, the
/// fail-closed scanner, the backend's own declaration of what it wrote, the
/// handle-bound finalization and the identity-bound cleanup.
///
/// The input spelling is the plain verified one both measured vendor readers
/// require; the harness confirms it against the real backend.
pub fn run_multi_output_conversion_evidence(
    source: &Path,
    destination_root: &Path,
    conflict: ConflictPolicy,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    limits: MzmlScanLimits,
    cancellation: Option<&ConversionCancellation>,
) -> MultiOutputConversionRun {
    // Before anything is opened, inspected or created, so a request that was
    // already made costs the user no staging directory and no reads.
    if let Some(cancellation) = cancellation
        && cancellation.is_requested()
    {
        return refused(
            MultiOutputFailure::Cancelled {
                surviving_processes: None,
            },
            None,
            None,
        );
    }

    // The source object, captured through one pinned no-follow handle and held
    // for the whole run — the same posture and the same reason as production:
    // the backend must convert the bytes that were measured.
    let (pinned_source, facts, canonical_source) = match capture_source_object(source) {
        Ok(captured) => captured,
        Err(kind) => return refused(MultiOutputFailure::SourceNotCaptured { kind }, None, None),
    };

    run_bound_multi_output(
        BoundSource {
            pins: vec![pinned_source],
            facts,
            canonical_primary: canonical_source,
            companions: Vec::new(),
        },
        SetRunRequest {
            destination_root,
            conflict,
            capabilities,
            runner,
            limits,
            cancellation,
            requirement: &PrePublicationRequirement::None,
        },
        SetRunSeam {
            names_claimed: &mut |_: &[String]| OutputNamesClaimed::None,
            before_member_publication: &mut |_: usize| {},
        },
    )
}

/// Runs one **admitted** acquisition of a multi-output family through the
/// lifecycle.
///
/// This is the production entry point the evidence one was a rehearsal for, and
/// the difference is entirely in what must be true before the backend starts:
///
/// 1. the source's family must actually produce a set — a single-output family
///    routed here would be converted under a lifecycle that expects the backend
///    to name its own outputs, and it does not;
/// 2. the installed build must be one this family has been converted on and
///    recorded against, by release, revision **and** executable digest;
/// 3. every object the acquisition is made of must still be the object that was
///    admitted — reopened no-follow, posture, length and digest — and must stay
///    held for the whole run.
///
/// Step 3 is where a bundle differs from everything before it. The `.wiff.scan`
/// is never named on the command line and is opened by the vendor library
/// regardless; measured on this build, removing it turns a ten-document
/// conversion into ten truncated documents and a non-zero exit. An acquisition
/// is not pinned if only the part with the name on it is pinned.
///
/// There is still no product surface for any of this: no workspace row, no
/// queue, no command. What exists now is a boundary a later surface could be
/// built on without loosening anything.
pub fn run_admitted_multi_output_conversion(
    source: &ConversionSource,
    destination_root: &Path,
    conflict: ConflictPolicy,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    cancellation: Option<&ConversionCancellation>,
) -> MultiOutputConversionRun {
    // Nobody outside owns a name, and nothing happens between members. Bound to
    // locals rather than offered as a constructor, because a seam of borrowed
    // closures cannot outlive the call it is for.
    let mut names_claimed = |_: &[String]| OutputNamesClaimed::None;
    let mut before_member_publication = |_: usize| {};
    run_admitted_multi_output_conversion_seamed(
        source,
        destination_root,
        conflict,
        capabilities,
        runner,
        cancellation,
        SetRunSeam {
            names_claimed: &mut names_claimed,
            before_member_publication: &mut before_member_publication,
        },
    )
}

/// The same admitted run, carrying the caller's [`SetRunSeam`] into the
/// lifecycle it cannot reach directly.
///
/// This is the entry point a queue uses, because a queue is the one caller that
/// knows something the lifecycle must not: that another item has already
/// promised one of these names to a different acquisition.
pub fn run_admitted_multi_output_conversion_seamed(
    source: &ConversionSource,
    destination_root: &Path,
    conflict: ConflictPolicy,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    cancellation: Option<&ConversionCancellation>,
    seam: SetRunSeam<'_>,
) -> MultiOutputConversionRun {
    if let Some(cancellation) = cancellation
        && cancellation.is_requested()
    {
        return refused(
            MultiOutputFailure::Cancelled {
                surviving_processes: None,
            },
            None,
            None,
        );
    }

    if !source.kind().produces_output_set() {
        return refused(MultiOutputFailure::SourceFamilyNotMultiOutput, None, None);
    }
    // The same predicate the single-output boundary applies, asked here for the
    // same reason: a family is evidence about the build it was measured on, and
    // an installation that merely calls itself that build is not that build.
    if !super::provider_build_is_evidenced(capabilities, source.kind()) {
        return refused(MultiOutputFailure::ProviderBuildNotEvidenced, None, None);
    }

    let pins = match super::pin_source_bundle(source) {
        Ok(pins) => pins,
        Err(failure) => {
            return refused(
                MultiOutputFailure::SourceNotStillAdmitted(failure),
                None,
                None,
            );
        }
    };
    let companions = source
        .companions()
        .iter()
        .map(|companion| companion.identity().clone())
        .collect();

    run_bound_multi_output(
        BoundSource {
            pins,
            facts: source.primary_object().clone(),
            canonical_primary: source
                .primary_object()
                .identity()
                .canonical_path()
                .to_path_buf(),
            companions,
        },
        SetRunRequest {
            destination_root,
            conflict,
            capabilities,
            runner,
            limits: source.scan_limits(),
            cancellation,
            // Asked for by family, and asked for here rather than inside the
            // lifecycle: the lifecycle publishes staged files and has no notion
            // of a source sample, and giving it one would make every other
            // family's run answer a question that is not about it.
            requirement: &completeness_requirement(source.kind(), capabilities),
        },
        seam,
    )
}

/// What must be established about a run of this family before it may publish.
///
/// Total over the families, so one added later has to say whether its backend
/// can lose part of an acquisition without saying so. The three single-output
/// families cannot: one source, one planned output, and a run that produced
/// anything else is already refused.
fn completeness_requirement(
    kind: ConversionSourceKind,
    capabilities: &InstalledHelpCapabilities,
) -> PrePublicationRequirement {
    match kind {
        ConversionSourceKind::MzmlFile
        | ConversionSourceKind::ThermoRawFile
        | ConversionSourceKind::ShimadzuLcdFile => PrePublicationRequirement::None,
        ConversionSourceKind::SciexWiffBundle => {
            PrePublicationRequirement::SciexSampleCompleteness {
                executable_sha256: capabilities.executable_sha256(),
            }
        }
    }
}

/// Everything a set run needs besides its source.
///
/// Gathered because the list had grown past the point where a reader could tell
/// the arguments apart at a call site, and because the last of them --
/// [`PrePublicationRequirement`] -- is the one that must never be passed by
/// accident.
struct SetRunRequest<'a> {
    destination_root: &'a Path,
    conflict: ConflictPolicy,
    capabilities: &'a InstalledHelpCapabilities,
    runner: &'a dyn ProcessRunner,
    limits: MzmlScanLimits,
    cancellation: Option<&'a ConversionCancellation>,
    requirement: &'a PrePublicationRequirement,
}

/// One acquisition bound for a run: every object held open, the primary's facts
/// and canonical name, and the companion identities the command must carry.
struct BoundSource {
    /// Held for the whole run and dropped together. A companion released early
    /// is a companion the backend could be reading while somebody else replaces
    /// it.
    pins: Vec<File>,
    /// The primary's facts. Every staged member is validated against these, as
    /// the source object the run is attributed to.
    facts: SourceObjectFacts,
    canonical_primary: PathBuf,
    /// Empty for a single-object acquisition.
    companions: Vec<SourceIdentity>,
}

/// Everything a multi-output run does once its source is bound.
///
/// Shared verbatim by the evidence entry point and the admitted one, so the two
/// cannot drift into different staging, different discovery or different
/// publication. What differs between them is only how the source was obtained
/// and what had to be true before it was: a family, a provider-evidence row and
/// a recheck of every member on one side; a Rust-owned path on the other.
fn run_bound_multi_output(
    bound: BoundSource,
    request: SetRunRequest<'_>,
    seam: SetRunSeam<'_>,
) -> MultiOutputConversionRun {
    let SetRunRequest {
        destination_root,
        conflict,
        capabilities,
        runner,
        limits,
        cancellation,
        requirement,
    } = request;
    let policy = ConversionPolicy::default();
    let BoundSource {
        pins,
        facts,
        canonical_primary: canonical_source,
        companions,
    } = bound;

    let canonical_destination = match std::fs::canonicalize(destination_root) {
        Ok(canonical) => canonical,
        Err(error) => {
            return refused(
                MultiOutputFailure::DestinationRootNotOpened { kind: error.kind() },
                None,
                None,
            );
        }
    };
    let destination = match finalize::DestinationDirectory::open(&canonical_destination) {
        Ok(directory) => directory,
        Err(error) => {
            return refused(
                MultiOutputFailure::DestinationRootNotOpened { kind: error.kind() },
                None,
                None,
            );
        }
    };

    let staging = match OwnedStagingArea::create(staging_directory(
        &canonical_destination,
        &canonical_source,
    )) {
        Ok(staging) => staging,
        Err(failure) => {
            return refused(staging_failure(&failure), None, None);
        }
    };

    let command = match build_msconvert_set_command_for_source(
        capabilities,
        &canonical_source,
        &staging.output_directory(),
        InputSpelling::PlainVerified,
    ) {
        Ok(command) => command,
        Err(error) => {
            let residue = staging.discard();
            return refused(MultiOutputFailure::NotPlannable(error), None, residue);
        }
    };
    // The companions never appear in the argv — the backend derives their names
    // itself — and they are bound to the spec anyway, so the pre-spawn recheck
    // covers every object the run will read rather than only the one it names.
    let command = match command.with_source_companion_identities(companions) {
        Some(command) => command,
        None => {
            let residue = staging.discard();
            return refused(MultiOutputFailure::SourceBundleNotBound, None, residue);
        }
    };

    let staging_output = staging.output_directory();
    let (backend, process_failure, process_output) =
        run_set_backend(&command, runner, cancellation);
    let diagnostics_of = |output: &Option<ProcessOutput>| {
        output.as_ref().and_then(|output| {
            set_diagnostic_text(
                output,
                &canonical_source,
                &canonical_destination,
                &staging_output,
                &command.executable,
            )
        })
    };
    if let Some(failure) = process_failure {
        let diagnostics = diagnostics_of(&process_output);
        // Read before the staging area is taken down, and only where a stop is
        // what ended the run: this is the run's own account of what it had
        // written when it was interrupted, and it is the only partial-output
        // claim it makes.
        let stopped = matches!(
            failure,
            MultiOutputFailure::Cancelled { .. } | MultiOutputFailure::CancellationNotConfirmed(_)
        );
        let staged = stopped
            .then(|| super::observe_staged_content(&staging_output))
            .flatten();
        let residue = staging.discard();
        return refused_after_stop(failure, backend, residue, diagnostics, staged);
    }

    // Before discovery, before validation, before any destination name is
    // taken: the earliest point at which the finished run can be judged. A
    // requirement that could only be judged after publication would not be a
    // gate at all -- it would be a note attached to files the user already has.
    let proof = match examine_requirement(requirement, &command, process_output.as_ref()) {
        Ok(proof) => proof,
        Err(refusal) => {
            let diagnostics = diagnostics_of(&process_output);
            let residue = staging.discard();
            return refused_diagnosable(
                MultiOutputFailure::SampleCompletenessNotEstablished(refusal),
                backend,
                residue,
                diagnostics,
            );
        }
    };

    let declared = process_output.as_ref().map_or_else(
        || DeclaredOutputSet::from_backend_stdout(&[], true),
        |output| DeclaredOutputSet::from_backend_stdout(&output.stdout, output.stdout_truncated),
    );
    let settled = settle_staged_output_set_seamed(
        StagedOutputSet {
            source: &facts,
            directory: &staging_output,
            declared: &declared,
        },
        &destination,
        conflict,
        policy,
        limits,
        seam,
    );
    drop(pins);
    // Retained only where the run is worth diagnosing. A finalized or skipped
    // set keeps no backend text, exactly as a finalized single output keeps
    // none; anything refused or partial keeps what the backend said, redacted.
    let diagnostics = match &settled.outcome {
        MultiOutputOutcome::FullyFinalized | MultiOutputOutcome::SkippedExistingDestinations => {
            None
        }
        MultiOutputOutcome::RefusedBeforePublication(_)
        | MultiOutputOutcome::PartiallyFinalized { .. } => diagnostics_of(&process_output),
    };
    // Completed only by a set that reached its destination whole. The audit
    // says no identified sample was lost on the way out of the backend; full
    // finalization says every surviving member reached the user. Neither alone
    // is the claim, and a partially published set is explicitly not one.
    let completeness = proof.map(|proof| {
        if matches!(settled.outcome, MultiOutputOutcome::FullyFinalized) {
            proof.with_published_members(settled.retained.len())
        } else {
            SciexSampleCompleteness::NotEstablished(SampleCompletenessRefusal::SetNotFullyPublished)
        }
    });
    let residue = staging.discard();
    MultiOutputConversionRun {
        report: MultiOutputConversionReport {
            outcome: settled.outcome,
            members: settled.members,
            // A run that reached settlement was not stopped inside the backend,
            // so there is no interrupted staging directory to describe.
            staged: None,
            backend,
            residue,
            diagnostics,
        },
        retained: FinalizedOutputSet {
            outputs: settled.retained,
        },
        completeness,
    }
}

/// Applies the run's pre-publication requirement, if it has one.
///
/// The lifecycle's whole knowledge of the subject: a requirement either
/// produces a proof to be completed later, or refuses. What the proof is about
/// lives in the module that owns it.
fn examine_requirement(
    requirement: &PrePublicationRequirement,
    command: &CommandSpec,
    output: Option<&ProcessOutput>,
) -> Result<Option<NoSampleLoss>, SampleCompletenessRefusal> {
    match requirement {
        PrePublicationRequirement::None => Ok(None),
        PrePublicationRequirement::SciexSampleCompleteness { executable_sha256 } => {
            // No captured output at all is not a clean run to audit. Reached
            // only if the boundary reported success without a capture, which
            // it does not do -- answered rather than unwrapped.
            let Some(output) = output else {
                return Err(SampleCompletenessRefusal::BackendDidNotCompleteCleanly);
            };
            examine_backend_evidence(&BackendSampleEvidence {
                stderr: &output.stderr,
                stderr_truncated: output.stderr_truncated,
                exited_cleanly: output.termination == Termination::Exited && output.success(),
                argv_requests_filtering: argv_requests_filtering(command.args()),
                executable_sha256: *executable_sha256,
            })
            .map(Some)
        }
    }
}

/// A refusal carrying what the backend said on the way.
fn refused_diagnosable(
    failure: MultiOutputFailure,
    backend: Option<BackendRunFacts>,
    residue: Option<StagingResidue>,
    diagnostics: Option<Box<BackendDiagnosticText>>,
) -> MultiOutputConversionRun {
    let mut run = refused(failure, backend, residue);
    run.report.diagnostics = diagnostics;
    run
}

/// The same refusal, carrying what was staged when a stop reached the run.
///
/// Only the cancellation paths take this observation, and only they should: it
/// is the one partial-output claim a run makes about itself, and a run that
/// reached its own end has already said what it published.
fn refused_after_stop(
    failure: MultiOutputFailure,
    backend: Option<BackendRunFacts>,
    residue: Option<StagingResidue>,
    diagnostics: Option<Box<BackendDiagnosticText>>,
    staged: Option<StagedContentObservation>,
) -> MultiOutputConversionRun {
    let mut run = refused_diagnosable(failure, backend, residue, diagnostics);
    run.report.staged = staged;
    run
}

/// A refusal that produced no members.
fn refused(
    failure: MultiOutputFailure,
    backend: Option<BackendRunFacts>,
    residue: Option<StagingResidue>,
) -> MultiOutputConversionRun {
    MultiOutputConversionRun {
        report: MultiOutputConversionReport {
            outcome: MultiOutputOutcome::RefusedBeforePublication(failure),
            members: Vec::new(),
            staged: None,
            backend,
            residue,
            diagnostics: None,
        },
        retained: FinalizedOutputSet {
            outputs: Vec::new(),
        },
        // A run that published nothing answers no question about the source.
        completeness: None,
    }
}

/// Where a multi-output run stages, beside the destination like every other
/// staging area, and named so no single-output run of the same source could
/// derive the same directory.
fn staging_directory(destination_root: &Path, source: &Path) -> PathBuf {
    let stem = source
        .file_stem()
        .map_or_else(|| OsString::from("acquisition"), OsStr::to_os_string);
    let mut name = stem;
    name.push(".mzML-set");
    name.push(super::STAGING_SUFFIX);
    destination_root.join(name)
}

/// The staging-creation failures translated into this lifecycle's vocabulary.
fn staging_failure(failure: &super::ConversionRunFailure) -> MultiOutputFailure {
    match failure {
        super::ConversionRunFailure::StagingTargetExists => MultiOutputFailure::StagingTargetExists,
        super::ConversionRunFailure::StagingNotCreated { kind } => {
            MultiOutputFailure::StagingNotCreated { kind: *kind }
        }
        // `OwnedStagingArea::create` produces only the two staging failures.
        _ => MultiOutputFailure::StagingNotCreated {
            kind: io::ErrorKind::Other,
        },
    }
}

/// Captures the source object for the run: pinned handle, facts, canonical
/// path. The handle is the pin; the caller holds it until the set settles.
fn capture_source_object(
    source: &Path,
) -> Result<(File, SourceObjectFacts, PathBuf), io::ErrorKind> {
    use std::io::Seek;

    let canonical = std::fs::canonicalize(source).map_err(|error| error.kind())?;
    let mut file = super::open_admission_candidate(&canonical).map_err(|error| error.kind())?;
    let metadata = file.metadata().map_err(|error| error.kind())?;
    fs_guard::require_regular_file(&metadata).map_err(|_| io::ErrorKind::InvalidInput)?;
    let identity = SourceIdentity::capture(&canonical).map_err(|error| error.kind())?;
    file.rewind().map_err(|error| error.kind())?;
    let sha256 =
        Sha256Digest::calculate_reader(&mut file).map_err(|_| io::ErrorKind::InvalidData)?;
    let facts = SourceObjectFacts::from_parts(identity, metadata.len(), sha256);
    Ok((file, facts, canonical))
}

/// Runs the backend and classifies everything that is not a clean exit.
///
/// The same classification the single-output run applies, expressed in this
/// lifecycle's vocabulary. Process supervision itself is untouched: the one
/// production runner remains the authority for the child, the job object, the
/// capture and the teardown.
fn run_set_backend(
    command: &CommandSpec,
    runner: &dyn ProcessRunner,
    cancellation: Option<&ConversionCancellation>,
) -> (
    Option<BackendRunFacts>,
    Option<MultiOutputFailure>,
    Option<ProcessOutput>,
) {
    if let Some(cancellation) = cancellation
        && cancellation.is_requested()
    {
        return (
            None,
            Some(MultiOutputFailure::Cancelled {
                surviving_processes: None,
            }),
            None,
        );
    }
    let result = match cancellation {
        Some(cancellation) => runner.run_cancellable(command, cancellation.token()),
        None => runner.run(command),
    };
    let requested = cancellation.is_some_and(ConversionCancellation::is_requested);
    let output = match result {
        Ok(output) => output,
        Err(error) => {
            let cause = BackendExecutionFailure::from(&error);
            let failure = if requested
                && matches!(
                    cause,
                    BackendExecutionFailure::NotTerminated | BackendExecutionFailure::NotAwaited
                ) {
                MultiOutputFailure::CancellationNotConfirmed(cause)
            } else {
                MultiOutputFailure::Backend(cause)
            };
            return (None, Some(failure), None);
        }
    };
    let backend = Some(BackendRunFacts::from(&output));
    if output.termination != Termination::Exited {
        let failure = if !requested {
            MultiOutputFailure::BackendDidNotComplete
        } else {
            match output.termination {
                Termination::NotStarted => MultiOutputFailure::Cancelled {
                    surviving_processes: None,
                },
                Termination::Cancelled if output.final_active_processes == Some(0) => {
                    MultiOutputFailure::Cancelled {
                        surviving_processes: Some(0),
                    }
                }
                _ => MultiOutputFailure::CancellationNotConfirmed(
                    BackendExecutionFailure::NotTerminated,
                ),
            }
        };
        return (backend, Some(failure), Some(output));
    }
    if !output.success() {
        let failure = MultiOutputFailure::BackendRejected {
            exit_code: output.exit_code,
        };
        return (backend, Some(failure), Some(output));
    }
    (backend, None, Some(output))
}

/// Bounded, redacted backend text for this run.
///
/// The same shape and the same redaction discipline as the single-output
/// boundary's: every location this run knows -- the acquisition, the
/// destination, the staging area, the executable and its installation, the
/// temporary folder -- is replaced before a byte of backend text is retained.
fn set_diagnostic_text(
    output: &ProcessOutput,
    source: &Path,
    destination_root: &Path,
    staging_output: &Path,
    executable: &Path,
) -> Option<Box<BackendDiagnosticText>> {
    let mut redactor = Redactor::new();
    redactor.add_path(source, "<source>");
    if let Some(directory) = source.parent() {
        redactor.add_path(directory, "<source>");
    }
    redactor.add_path(destination_root, "<destination>");
    if let Some(staging_root) = staging_output.parent() {
        redactor.add_path(staging_root, "<staging>");
    }
    redactor.add_path(staging_output, "<staging>");
    redactor.add_path(executable, "<backend>");
    if let Some(directory) = executable.parent() {
        redactor.add_path(directory, "<backend>");
        if let Some(home) = directory.parent() {
            redactor.add_path(home, "<backend>");
        }
    }
    redactor.add_path(&std::env::temp_dir(), "<local-path>");
    Some(Box::new(BackendDiagnosticText::from_streams(
        output, &redactor,
    )))
}

/// Everything the filesystem half of a settled run produced.
pub(crate) struct SettledOutputSet {
    pub(crate) outcome: MultiOutputOutcome,
    pub(crate) members: Vec<OutputMemberReport>,
    pub(crate) retained: Vec<FinalizedOutput>,
}

/// What one settlement is about: the acquisition it is attributed to, the
/// private directory the backend wrote into, and the backend's own account of
/// what it put there.
///
/// The three travel together because settlement is meaningless without all
/// three — a directory with no declaration cannot be told from a directory
/// somebody added to.
pub(crate) struct StagedOutputSet<'a> {
    pub(crate) source: &'a SourceObjectFacts,
    pub(crate) directory: &'a Path,
    pub(crate) declared: &'a DeclaredOutputSet,
}

/// Discovers, validates, preflights and publishes one staged output set.
///
/// This is the lifecycle itself, separable from the backend so the
/// deterministic suite can drive every branch of it over synthetic staging
/// content. The order is the contract:
///
/// 1. the staging directory is read as a bounded set of ordinary mzML members;
/// 2. **every** member is validated — opened no-follow with writers denied,
///    scanned fail-closed, hashed through the held object — before any member
///    is published;
/// 3. the destination is inspected for the complete planned name set;
/// 4. only then are members published, one at a time, in the deterministic
///    order, each through the handle-bound no-clobber rename.
///
/// The seam sits at the one interval those claims are about: after the
/// whole-set preflight and before each member's publication. Production passes
/// an empty hook; the deterministic suite uses it to occupy a destination name
/// mid-set — the race a real filesystem can produce and a test must not have
/// to win probabilistically. The hook is handed the zero-based position of the
/// member about to be published and nothing else: it cannot fail a rename,
/// choose a name, see a handle or touch a staged object. It can only act on the
/// world, exactly as another process could.
pub(crate) fn settle_staged_output_set_seamed(
    staged: StagedOutputSet<'_>,
    destination: &finalize::DestinationDirectory,
    conflict: ConflictPolicy,
    policy: ConversionPolicy,
    limits: MzmlScanLimits,
    seam: SetRunSeam<'_>,
) -> SettledOutputSet {
    let SetRunSeam {
        names_claimed,
        before_member_publication,
    } = seam;
    let StagedOutputSet {
        source,
        directory: staged_output_directory,
        declared,
    } = staged;
    // 1. Discovery. The staging directory is the authority.
    let discovered = match discover_staged_output_set(staged_output_directory) {
        Ok(discovered) => discovered,
        Err(rejection) => {
            return SettledOutputSet {
                outcome: MultiOutputOutcome::RefusedBeforePublication(
                    MultiOutputFailure::OutputSet(rejection),
                ),
                members: Vec::new(),
                retained: Vec::new(),
            };
        }
    };

    // 1b. The backend's own account of what it wrote, against what is there.
    // Ordered after discovery's rules so a sidecar, a directory or a
    // partial-output name is still refused for what it is; this catches the one
    // thing discovery cannot, which is a member that is a perfectly ordinary
    // mzML document the backend never wrote.
    if !declared.matches(&discovered) {
        return SettledOutputSet {
            outcome: MultiOutputOutcome::RefusedBeforePublication(
                MultiOutputFailure::OutputSetNotAsDeclared {
                    declared: declared.len(),
                    discovered: discovered.len(),
                },
            ),
            members: Vec::new(),
            retained: Vec::new(),
        };
    }

    // 2. Validation, all before any. Every validated member's exact object is
    // held; a failure publishes nothing whatever the other members looked like.
    // The safe facts are copied out beside each held object, so a member's row
    // in the report keeps them whatever finalization later consumes.
    let mut validated: Vec<(DiscoveredMember, ValidatedConversionOutput)> =
        Vec::with_capacity(discovered.len());
    // Keyed by the member's own `OsString`, never by its display string: a
    // lossy conversion can map two distinct native names to one value, and a
    // report that matched on it would attach one member's facts to another's
    // row -- or call an unpublished member finalized.
    let mut facts: Vec<(OsString, OutputMemberValidation)> = Vec::with_capacity(discovered.len());
    for member in &discovered {
        match verify_staged_member_retaining_output(
            source,
            staged_output_directory,
            member.name(),
            member.byte_length,
            policy,
            limits,
        ) {
            VerifiedConversion::Valid(output) => {
                facts.push((
                    member.name().to_owned(),
                    OutputMemberValidation::of(output.valid_ref()),
                ));
                validated.push((member.clone(), *output));
            }
            VerifiedConversion::Rejected(rejection) => {
                let failed = member.display_name();
                return SettledOutputSet {
                    outcome: MultiOutputOutcome::RefusedBeforePublication(
                        MultiOutputFailure::MemberRejected {
                            member: failed,
                            rejection,
                        },
                    ),
                    members: build_member_reports(&discovered, &facts, &[]),
                    retained: Vec::new(),
                };
            }
        }
    }

    // 2b. The claim gate. Everything is known good and nothing has been
    // written, so this is the last moment at which refusing costs nobody a
    // file -- and it is deliberately ahead of the destination inspection, so a
    // name an earlier queue item already published is answered as a queue
    // collision rather than as this acquisition being already converted.
    let discovered_names: Vec<String> = discovered
        .iter()
        .map(DiscoveredMember::display_name)
        .collect();
    if let OutputNamesClaimed::Already { name } = names_claimed(&discovered_names) {
        return SettledOutputSet {
            outcome: MultiOutputOutcome::RefusedBeforePublication(
                MultiOutputFailure::OutputNameClaimedElsewhere { name },
            ),
            members: build_member_reports(&discovered, &facts, &[]),
            retained: Vec::new(),
        };
    }

    // 3. The destination preflight, over the complete name set, only now that
    // every document is known good. The names were unknowable before the
    // backend ran, so this is the earliest a conflict could be seen — recorded
    // as a property of the topology, not a weakness of the check.
    let mut occupied = Vec::new();
    for (member, _) in &validated {
        let target = destination.path().join(member.name());
        match std::fs::symlink_metadata(&target) {
            Ok(_) => occupied.push(member.display_name()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return SettledOutputSet {
                    outcome: MultiOutputOutcome::RefusedBeforePublication(
                        MultiOutputFailure::DestinationNotInspectable { kind: error.kind() },
                    ),
                    members: build_member_reports(&discovered, &facts, &[]),
                    retained: Vec::new(),
                };
            }
        }
    }
    if !occupied.is_empty() {
        let outcome = match conflict {
            // Any occupation refuses the whole set: which member would have
            // been dropped is not a question Fail answers.
            ConflictPolicy::Fail => MultiOutputOutcome::RefusedBeforePublication(
                MultiOutputFailure::DestinationOccupied { occupied },
            ),
            ConflictPolicy::Skip if occupied.len() == validated.len() => {
                // Every name is taken: the acquisition reads as already
                // converted, and the whole set steps aside. Nothing existing
                // was inspected and nothing is called this run's output.
                MultiOutputOutcome::SkippedExistingDestinations
            }
            // A strict subset is taken. Publishing around it would present a
            // partial acquisition as a converted one, and skipping the whole
            // set would present it as already converted when part of it is
            // not. Neither is true, so the set is refused with the conflict
            // named.
            ConflictPolicy::Skip => MultiOutputOutcome::RefusedBeforePublication(
                MultiOutputFailure::MixedDestinationConflict { occupied },
            ),
        };
        return SettledOutputSet {
            outcome,
            members: build_member_reports(&discovered, &facts, &[]),
            retained: Vec::new(),
        };
    }

    // 4. Publication, one member at a time, in the deterministic order. Not
    // atomic, and not pretended to be: each rename is individually
    // object-bound and no-clobber, and a failure between renames leaves the
    // published prefix exactly where the user asked for it.
    let mut retained: Vec<FinalizedOutput> = Vec::new();
    let mut finalized: Vec<OsString> = Vec::new();
    let mut finalized_names: Vec<String> = Vec::new();
    let mut waiting = validated.into_iter();
    let mut position = 0_usize;
    while let Some((member, output)) = waiting.next() {
        before_member_publication(position);
        position += 1;
        #[cfg(windows)]
        let result = finalize::finalize_validated(output, destination, member.name());
        #[cfg(not(windows))]
        let result = finalize::finalize_validated(
            output,
            destination,
            &staged_output_directory.join(member.name()),
            member.name(),
        );
        match result {
            Ok(output) => {
                finalized.push(member.name().to_owned());
                finalized_names.push(member.display_name());
                retained.push(output);
            }
            Err(error) => {
                let failed_member = member.display_name();
                let mut not_published = vec![failed_member.clone()];
                not_published.extend(waiting.map(|(member, _)| member.display_name()));
                let outcome = if finalized_names.is_empty() {
                    // Nothing was published, so this is an ordinary refusal
                    // rather than a partial state.
                    MultiOutputOutcome::RefusedBeforePublication(
                        MultiOutputFailure::MemberNotFinalized {
                            member: failed_member,
                            kind: error.kind(),
                        },
                    )
                } else {
                    MultiOutputOutcome::PartiallyFinalized {
                        finalized: finalized_names.clone(),
                        failed_member,
                        kind: error.kind(),
                        not_published,
                    }
                };
                return SettledOutputSet {
                    members: build_member_reports(&discovered, &facts, &finalized),
                    outcome,
                    retained,
                };
            }
        }
    }

    SettledOutputSet {
        outcome: MultiOutputOutcome::FullyFinalized,
        members: build_member_reports(&discovered, &facts, &finalized),
        retained,
    }
}

/// One report row per discovered member: finalized members say so, validated
/// ones that never published say that, and a member that was never judged is
/// simply not published. Facts stay on every validated member's row, whether
/// or not finalization later consumed its object.
fn build_member_reports(
    discovered: &[DiscoveredMember],
    facts: &[(OsString, OutputMemberValidation)],
    finalized: &[OsString],
) -> Vec<OutputMemberReport> {
    discovered
        .iter()
        .map(|member| {
            let display = member.display_name();
            // Matched on the native name, so two members whose display strings
            // collapse together still keep their own facts and their own state.
            let validation = facts
                .iter()
                .find(|(name, _)| name.as_os_str() == member.name())
                .map(|(_, validation)| validation.clone());
            let state = if finalized
                .iter()
                .any(|name| name.as_os_str() == member.name())
            {
                OutputMemberState::Finalized
            } else if validation.is_some() {
                OutputMemberState::ValidatedNotPublished
            } else {
                OutputMemberState::NotPublished
            };
            OutputMemberReport {
                file_name: display,
                state,
                validation,
            }
        })
        .collect()
}
