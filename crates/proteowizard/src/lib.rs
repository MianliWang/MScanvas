//! Discovery, typed command planning, process supervision, and typed preview
//! output interpretation for a user-installed ProteoWizard backend.

mod capability;
mod command;
mod conversion;
mod conversion_run;
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
    BackendTool, CommandSpec, OpenFormat, PlanError, PreviewOperation, SourceIdentity,
    build_msaccess_command_with_capabilities, build_msconvert_command_with_capabilities,
};
pub use conversion::{
    AdvisoryObservation, BinaryArrayMismatchKind, CompressionPolicy, ConversionIntegrityOutcome,
    ConversionOutputInspection, ConversionOutputRejection, ConversionPolicy, ConversionSourceError,
    ConversionSourceFacts, DocumentPart, DocumentSide, IntegrityProperty, ValidConversion,
    capture_conversion_source, conversion_output_file_name, inspect_conversion_output,
    verify_mzml_conversion,
};
pub use conversion_run::{
    BackendExecutionFailure, BackendRunFacts, BackendStream, ConflictPolicy, ConversionPlan,
    ConversionPlanError, ConversionRunFailure, ConversionRunOutcome, ConversionRunReport,
    ConversionSource, ConversionSourceKind, ConversionSourceRejection, StagingResidue,
    run_conversion,
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
    MAX_PREVIEW_TEXT_BYTES, MetadataEntry, MetadataResult, MetadataSection, MetadataSectionKind,
    MsLevelBucket, MsLevelCount, NumericPrecisionEvidence, PreviewInputSource,
    PreviewInterpretError, PreviewMalformedKind, PreviewNoResult, PreviewOutcome,
    PreviewOutputEntry, PreviewOutputManifest, PreviewValue, RetentionTime, RunRetentionTimeRange,
    RunSummaryResult, SelectedSpectrumResult, SpectrumIdentifier, SpectrumIdentifierKind,
    SpectrumIdentity, SpectrumIdentityConflict, SpectrumPrecursor, SpectrumRepresentationState,
    SpectrumTableResult, SpectrumTableRow, TicIntensityOrigin, TicPoint, TicResult, TicSourceOrder,
    UnitState, interpret_preview,
};
pub use process::{
    CancellationToken, LaunchFailureKind, ProcessError, ProcessOutput, ProcessRunner,
    SystemProcessRunner, Termination, execute, execute_cancellable,
};
pub use sha256::Sha256Error;
