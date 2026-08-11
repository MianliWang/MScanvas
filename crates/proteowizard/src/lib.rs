//! Discovery, typed command planning, process supervision, and typed preview
//! output interpretation for a user-installed ProteoWizard backend.

// `test-support` exposes a constructor that builds capability evidence from
// help text no discovery probe bound to an executable. A conversion is gated on
// evidence naming one release, one revision and one executable digest, and that
// gate is worth exactly as much as the impossibility of forging its input.
//
// The feature is off by default and is enabled here only as a dev-dependency,
// but `cargo build --all-features` turns on every feature a manifest declares
// and Cargo offers no way to exempt one. So the barrier is here instead, at the
// only property that distinguishes a build users receive: an optimized one.
// A test build keeps the constructor; an optimized build carrying it does not
// compile at all, rather than compiling and shipping a way around the gate.
#[cfg(all(feature = "test-support", not(debug_assertions)))]
compile_error!(
    "the test-support feature forges capability evidence and must never be part of \
     an optimized build; it exists for tests, which are not optimized"
);

mod cancellation;
mod capability;
mod command;
mod compound_file;
mod conversion;
mod conversion_run;
mod diagnostics;
mod discovery;
mod failure;
mod finalized_output;
mod fs_guard;
mod mzml;
mod preview;
mod process;
mod sciex_wiff;
mod sha256;

pub use cancellation::{CancellationObservation, CancellationRequest, ConversionCancellation};
pub use capability::{
    CapabilityRequirementError, CapturedHelpStream, CompleteHelpCapture, DeclarationKind,
    HelpCapabilityError, HelpExample, HelpStream, InstalledHelpCapabilities,
    NamedGrammarDeclaration, OptionArgument, OptionDeclaration, ProviderBuild, RawHelpHashes,
    Sha256Digest, Sha256DigestParseError, TicCapability,
};
pub use command::{
    BackendTool, CommandSpec, InputSpelling, OpenFormat, PlanError, PreviewOperation,
    SourceIdentity, build_msaccess_command_with_capabilities, build_msconvert_command_for_source,
    build_msconvert_command_with_capabilities,
};
pub use conversion::{
    AdvisoryObservation, BinaryArrayMismatchKind, CompressionPolicy, ConversionIntegrityOutcome,
    ConversionOutputInspection, ConversionOutputRejection, ConversionPolicy, ConversionSourceError,
    ConversionSourceFacts, DocumentPart, DocumentSide, IntegrityProperty, SourceObjectFacts,
    ValidConversion, ValidationMode, capture_conversion_source, conversion_output_file_name,
    inspect_conversion_output, verify_mzml_conversion,
};
pub use conversion_run::artifact::{
    LocalFileWriteError, LocalFileWriteFailure, write_new_local_file,
};
pub use conversion_run::output_set::{
    FinalizedOutputSet, MAX_CONVERSION_OUTPUTS_PER_SOURCE, MultiOutputConversionReport,
    MultiOutputConversionRun, MultiOutputFailure, MultiOutputOutcome, OutputMemberReport,
    OutputMemberState, OutputMemberValidation, OutputSetRejection,
    run_admitted_multi_output_conversion, run_multi_output_conversion_evidence,
};
pub use conversion_run::{
    BackendDiagnosticText, BackendExecutionFailure, BackendRunFacts, BackendStream,
    CancellationFailure, CancellationReport, ConflictPolicy, ConversionAttempt, ConversionPlan,
    ConversionPlanError, ConversionRunFailure, ConversionRunOutcome, ConversionRunReport,
    ConversionSource, ConversionSourceKind, ConversionSourceRejection, StagedContentObservation,
    StagingReclaimError, StagingResidue, provider_build_is_evidenced, run_conversion,
    run_conversion_cancellable,
};
pub use diagnostics::{
    BackendTextExcerpt, ExcerptSuppression, MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES, Redactor,
    ReportableProcessOutput, absolute_path_start,
};
pub use discovery::{
    AvailabilityState, ConfiguredLocation, DiscoveredTool, DiscoveryEnvironment, DiscoveryFailure,
    DiscoveryRequest, DiscoveryResult, DiscoverySource, ToolProbe, discover,
};
pub use failure::{
    FailureCondition, FailureKind, NormalizedFailure, Retryability, classify_process_failure,
};
pub use finalized_output::{FinalizedOutput, OutputDrift};
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
pub use sciex_wiff::sciex_wiff_companion_path;
pub use sha256::Sha256Error;
