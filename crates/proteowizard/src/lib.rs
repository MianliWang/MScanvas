//! Discovery, typed command planning, process supervision, and typed preview
//! output interpretation for a user-installed ProteoWizard backend.

mod capability;
mod command;
mod conversion;
mod diagnostics;
mod discovery;
mod failure;
mod fs_guard;
mod mzml;
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
pub use conversion::{
    CompressionPolicy, ConversionOutputInspection, ConversionOutputRejection, ConversionPolicy,
    conversion_output_file_name, inspect_conversion_output,
};
pub use diagnostics::{Redactor, ReportableProcessOutput};
pub use discovery::{
    AvailabilityState, ConfiguredLocation, DiscoveredTool, DiscoveryEnvironment, DiscoveryFailure,
    DiscoveryRequest, DiscoveryResult, DiscoverySource, ToolProbe, discover,
};
pub use failure::{
    FailureCondition, FailureKind, NormalizedFailure, Retryability, classify_process_failure,
};
pub use fs_guard::{
    OutputDirectoryEntry, OutputDirectorySnapshot, OutputEntryKind, RegularFileError,
    is_reparse_point, snapshot_output_directory,
};
pub use mzml::{
    ArrayKind, ArrayKindSet, CompressionMarker, CompressionSet, MzmlChromatogramRecord, MzmlFacts,
    MzmlLimitKind, MzmlMalformedKind, MzmlRoot, MzmlScanError, MzmlScanLimits, MzmlSpectrumRecord,
    NumericPrecisionMarker, NumericPrecisionSet, RepresentationMarker, RetentionTimeUnitMarker,
    UnsafeXmlKind, inspect_file, inspect_reader,
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
