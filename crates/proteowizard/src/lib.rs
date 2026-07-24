//! Discovery, typed command planning, and spike-level process contracts for a
//! user-installed ProteoWizard backend.

mod command;
mod diagnostics;
mod discovery;
mod failure;
mod process;

pub use command::{
    BackendTool, CommandSpec, OpenFormat, PlanError, PreviewOperation, build_msaccess_command,
    build_msconvert_command,
};
pub use diagnostics::{Redactor, ReportableProcessOutput};
pub use discovery::{
    AvailabilityState, ConfiguredLocation, DiscoveredTool, DiscoveryEnvironment, DiscoveryFailure,
    DiscoveryRequest, DiscoveryResult, DiscoverySource, ProbeExecutor, ToolProbe, discover,
    discover_with,
};
pub use failure::{
    FailureCondition, FailureKind, NormalizedFailure, Retryability, classify_process_failure,
};
pub use process::{
    CancellationToken, LaunchFailureKind, ProcessError, ProcessOutput, ProcessRunner,
    SystemProcessRunner, Termination, execute, execute_cancellable,
};
