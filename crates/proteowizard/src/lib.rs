//! Discovery, typed command planning, process supervision, and typed preview
//! output interpretation for a user-installed ProteoWizard backend.

mod capability;
mod command;
mod diagnostics;
mod discovery;
mod failure;
mod preview;
mod process;
mod sha256;

pub use capability::{
    CapabilityRequirementError, CapturedHelpStream, CompleteHelpCapture, DeclarationKind,
    HelpCapabilityError, HelpExample, HelpStream, InstalledHelpCapabilities,
    NamedGrammarDeclaration, OptionArgument, OptionDeclaration, RawHelpHashes, Sha256Digest,
    Sha256DigestParseError, TicCapability,
};
pub use command::{
    BackendTool, CommandSpec, OpenFormat, PlanError, PreviewOperation,
    build_msaccess_command_with_capabilities, build_msconvert_command_with_capabilities,
};
pub use diagnostics::{Redactor, ReportableProcessOutput};
pub use discovery::{
    AvailabilityState, ConfiguredLocation, DiscoveredTool, DiscoveryEnvironment, DiscoveryFailure,
    DiscoveryRequest, DiscoveryResult, DiscoverySource, ToolProbe, discover,
};
pub use failure::{
    FailureCondition, FailureKind, NormalizedFailure, Retryability, classify_process_failure,
};
pub use preview::{
    MetadataEntry, MetadataResult, MetadataSection, MetadataSectionKind, MsLevelBucket,
    MsLevelCount, NumericPrecisionEvidence, PreviewInputSource, PreviewInterpretError,
    PreviewMalformedKind, PreviewNoResult, PreviewOutcome, PreviewOutputEntry,
    PreviewOutputManifest, PreviewValue, RetentionTime, RunRetentionTimeRange, RunSummaryResult,
    SelectedSpectrumResult, SpectrumIdentifier, SpectrumIdentifierKind, SpectrumIdentity,
    SpectrumIdentityConflict, SpectrumPrecursor, SpectrumRepresentationState, SpectrumTableResult,
    SpectrumTableRow, TicIntensityOrigin, TicPoint, TicResult, TicSourceOrder, UnitState,
    interpret_preview,
};
pub use process::{
    CancellationToken, LaunchFailureKind, ProcessError, ProcessOutput, ProcessRunner,
    SystemProcessRunner, Termination, execute, execute_cancellable,
};
pub use sha256::Sha256Error;
