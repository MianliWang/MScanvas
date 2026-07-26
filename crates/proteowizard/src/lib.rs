//! Discovery, typed command planning, and spike-level process contracts for a
//! user-installed ProteoWizard backend.

mod capability;
mod command;
mod diagnostics;
mod discovery;
mod failure;
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
pub use process::{
    CancellationToken, LaunchFailureKind, ProcessError, ProcessOutput, ProcessRunner,
    SystemProcessRunner, Termination, execute, execute_cancellable,
};
pub use sha256::Sha256Error;
