use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use thiserror::Error;

use crate::command::{BackendTool, OpenFormat, PreviewOperation};
use crate::discovery::{BoundHelpProbe, DiscoveredTool};
use crate::sha256::{Sha256Error, digest_bytes, digest_file};

/// A SHA-256 digest supplied by the component that captured the complete raw
/// help stream.
///
/// Discovery calculates each digest with the approved Windows implementation
/// while it creates the opaque executable-bound help receipt. Keeping the
/// digest in the parsed model prevents a later sanitized capability summary
/// from losing its link to the raw capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Sha256Digest([u8; 32]);

impl Sha256Digest {
    #[must_use]
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Calculates a digest with the Windows CNG implementation used by the
    /// isolated M0 evidence harness.
    pub fn calculate(bytes: &[u8]) -> Result<Self, Sha256Error> {
        digest_bytes(bytes).map(Self)
    }

    /// Calculates a file digest with the Windows CNG implementation without
    /// loading the complete file into memory.
    pub fn calculate_file(path: &std::path::Path) -> Result<Self, Sha256Error> {
        digest_file(path).map(Self)
    }

    /// Calculates a digest from an already-open object, so a caller that holds
    /// the exact file it means to measure never reopens it by name.
    pub(crate) fn calculate_reader<R: std::io::Read>(reader: R) -> Result<Self, Sha256Error> {
        crate::sha256::digest_reader(reader).map(Self)
    }
}

impl fmt::Display for Sha256Digest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0 {
            write!(formatter, "{byte:02X}")?;
        }
        Ok(())
    }
}

impl FromStr for Sha256Digest {
    type Err = Sha256DigestParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.len() != 64 {
            return Err(Sha256DigestParseError::WrongLength(value.len()));
        }

        let mut bytes = [0_u8; 32];
        for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
            bytes[index] = (decode_hex(pair[0])? << 4) | decode_hex(pair[1])?;
        }
        Ok(Self(bytes))
    }
}

fn decode_hex(value: u8) -> Result<u8, Sha256DigestParseError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(Sha256DigestParseError::InvalidHex(char::from(value))),
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum Sha256DigestParseError {
    #[error("SHA-256 digest must contain exactly 64 hexadecimal characters, found {0}")]
    WrongLength(usize),
    #[error("SHA-256 digest contains a non-hexadecimal character: {0:?}")]
    InvalidHex(char),
}

#[derive(Debug, Clone, Copy)]
pub struct CapturedHelpStream<'a> {
    bytes: &'a [u8],
    total_bytes: u64,
    truncated: bool,
    sha256: Sha256Digest,
}

impl<'a> CapturedHelpStream<'a> {
    #[must_use]
    pub const fn new(
        bytes: &'a [u8],
        total_bytes: u64,
        truncated: bool,
        sha256: Sha256Digest,
    ) -> Self {
        Self {
            bytes,
            total_bytes,
            truncated,
            sha256,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct CompleteHelpCapture<'a> {
    stdout: CapturedHelpStream<'a>,
    stderr: CapturedHelpStream<'a>,
}

impl<'a> CompleteHelpCapture<'a> {
    #[must_use]
    pub const fn new(stdout: CapturedHelpStream<'a>, stderr: CapturedHelpStream<'a>) -> Self {
        Self { stdout, stderr }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawHelpHashes {
    pub stdout: Sha256Digest,
    pub stderr: Sha256Digest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptionArgument {
    None,
    Required,
    Optional,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OptionDeclaration {
    argument: OptionArgument,
    normalized_declaration: String,
}

impl OptionDeclaration {
    #[must_use]
    pub const fn argument(&self) -> OptionArgument {
        self.argument
    }

    #[must_use]
    pub fn normalized_declaration(&self) -> &str {
        &self.normalized_declaration
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedGrammarDeclaration {
    normalized_signature: String,
    parameters: BTreeMap<String, ParameterGrammar>,
}

impl NamedGrammarDeclaration {
    #[must_use]
    pub fn normalized_signature(&self) -> &str {
        &self.normalized_signature
    }

    pub fn parameter_names(&self) -> impl Iterator<Item = &str> {
        self.parameters.keys().map(String::as_str)
    }

    #[must_use]
    pub fn has_parameter(&self, name: &str) -> bool {
        self.parameters.contains_key(name)
    }

    #[must_use]
    pub fn parameter_allows_exact_value(&self, name: &str, value: &str) -> bool {
        self.parameters
            .get(name)
            .is_some_and(|grammar| grammar.allows_exact_value(value))
    }

    #[must_use]
    pub fn parameter_is_optional(&self, name: &str) -> Option<bool> {
        self.parameters.get(name).map(|grammar| grammar.optional)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParameterGrammar {
    normalized_value: String,
    exact_choices: BTreeSet<String>,
    optional: bool,
}

impl ParameterGrammar {
    fn allows_exact_value(&self, value: &str) -> bool {
        self.exact_choices.contains(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpExample {
    normalized_line: String,
    tokens: Vec<String>,
}

impl HelpExample {
    #[must_use]
    pub fn normalized_line(&self) -> &str {
        &self.normalized_line
    }

    #[must_use]
    pub fn tokens(&self) -> &[String] {
        &self.tokens
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TicCapability {
    Unsupported,
    SupportedWithoutFilter,
    SupportedMsLevelFilterUnverified,
    SupportedWithMsLevelFilter,
}

const ANALYSIS_HEADING: &str = "Analysis commands (used with -x/--exec):";
const METADATA_SIGNATURE: &str = "";
const RUN_SUMMARY_SIGNATURE: &str =
    "[msLevels=<int_set>] [charges=<int_set>] [delimiter=<fixed|space|comma|tab>]";
const SPECTRUM_TABLE_SIGNATURE: &str = "[delimiter=<fixed|space|comma|tab>]";
const TIC_SIGNATURE: &str = "[mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed|space|comma|tab>]";
const BINARY_SIGNATURE: &str = "index=<spectrumIndexLow>[,<spectrumIndexHigh>] | sn=<scanNumberLow>[,<scanNumberHigh>] [precision=<precision>]";
const ZLIB_OPTION_DECLARATION: &str = "-z [ --zlib ] [=arg(=1)]";
const ZLIB_OPTION_REQUIREMENT: &str = "exact --zlib [=arg(=1)] grammar";

impl TicCapability {
    #[must_use]
    pub const fn supports_unfiltered(self) -> bool {
        !matches!(self, Self::Unsupported)
    }

    #[must_use]
    pub const fn supports_ms_level_filter(self) -> bool {
        matches!(self, Self::SupportedWithMsLevelFilter)
    }
}

/// Which ProteoWizard build the installed help says it came from.
///
/// Read out of the same complete, non-truncated capture every other capability
/// fact is read from, using the same parsing discovery uses, so the build a
/// capability decision is made against and the build discovery reported cannot
/// disagree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderBuild {
    release: String,
    source_revision: Option<String>,
}

impl ProviderBuild {
    /// The normalized release, such as `3.0.26013`.
    #[must_use]
    pub fn release(&self) -> &str {
        &self.release
    }

    /// The source revision the release advertised, such as `47b13cf`. Absent
    /// when the build did not emit one.
    #[must_use]
    pub fn source_revision(&self) -> Option<&str> {
        self.source_revision.as_deref()
    }

    /// Whether this build is exactly the one named.
    ///
    /// A build that emitted no revision never matches one that names a
    /// revision: evidence recorded against a specific revision is not evidence
    /// about a build that will not say which it is.
    #[must_use]
    pub fn is(&self, release: &str, source_revision: &str) -> bool {
        self.release == release && self.source_revision.as_deref() == Some(source_revision)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledHelpCapabilities {
    tool: BackendTool,
    executable: PathBuf,
    executable_sha256: Sha256Digest,
    raw_help_hashes: RawHelpHashes,
    provider_build: Option<ProviderBuild>,
    options: BTreeMap<String, OptionDeclaration>,
    analysis_queries: BTreeMap<String, NamedGrammarDeclaration>,
    spectrum_filters: BTreeMap<String, NamedGrammarDeclaration>,
    examples: Vec<HelpExample>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedHelpCapabilities {
    tool: BackendTool,
    raw_help_hashes: RawHelpHashes,
    provider_build: Option<ProviderBuild>,
    options: BTreeMap<String, OptionDeclaration>,
    analysis_queries: BTreeMap<String, NamedGrammarDeclaration>,
    spectrum_filters: BTreeMap<String, NamedGrammarDeclaration>,
    examples: Vec<HelpExample>,
}

impl ParsedHelpCapabilities {
    fn bind_to_executable(
        self,
        executable: PathBuf,
        executable_sha256: Sha256Digest,
    ) -> InstalledHelpCapabilities {
        InstalledHelpCapabilities {
            tool: self.tool,
            executable,
            executable_sha256,
            raw_help_hashes: self.raw_help_hashes,
            provider_build: self.provider_build,
            options: self.options,
            analysis_queries: self.analysis_queries,
            spectrum_filters: self.spectrum_filters,
            examples: self.examples,
        }
    }
}

/// Reads the build identity out of a complete help capture.
///
/// Uses discovery's parsing rather than a second one, so a build that reports
/// two different releases produces no identity here for exactly the reason it
/// produces none there.
fn parse_provider_build(stdout: &[u8], stderr: &[u8]) -> Option<ProviderBuild> {
    let (reported, conflict) =
        crate::discovery::unique_label_value([stdout, stderr], "ProteoWizard release:");
    if conflict {
        return None;
    }
    let (release, source_revision) = crate::discovery::split_release_revision(reported.as_deref()?);
    Some(ProviderBuild {
        release: release?,
        source_revision,
    })
}

impl InstalledHelpCapabilities {
    /// Parses installed help only from the private receipt that discovery
    /// captured together with the canonical executable and SHA-256 identity it
    /// verified across the probe.
    pub fn from_discovered_tool(
        discovered_tool: &DiscoveredTool,
    ) -> Result<Self, HelpCapabilityError> {
        let bound_help_probe = discovered_tool
            .validated_help_probe()
            .ok_or(HelpCapabilityError::ValidatedHelpProbeRequired)?;
        Self::parse_bound_help(bound_help_probe)
    }

    pub(crate) fn parse_bound_help(
        bound_help_probe: &BoundHelpProbe,
    ) -> Result<Self, HelpCapabilityError> {
        validate_stream_parts(
            HelpStream::Stdout,
            &bound_help_probe.stdout,
            bound_help_probe.stdout_total_bytes,
            bound_help_probe.stdout_truncated,
        )?;
        validate_stream_parts(
            HelpStream::Stderr,
            &bound_help_probe.stderr,
            bound_help_probe.stderr_total_bytes,
            bound_help_probe.stderr_truncated,
        )?;
        let stdout_sha256 = Sha256Digest::calculate(&bound_help_probe.stdout)
            .map_err(|_| HelpCapabilityError::DigestUnavailable(HelpStream::Stdout))?;
        let stderr_sha256 = Sha256Digest::calculate(&bound_help_probe.stderr)
            .map_err(|_| HelpCapabilityError::DigestUnavailable(HelpStream::Stderr))?;
        let capture = CompleteHelpCapture::new(
            CapturedHelpStream::new(
                &bound_help_probe.stdout,
                bound_help_probe.stdout_total_bytes,
                bound_help_probe.stdout_truncated,
                stdout_sha256,
            ),
            CapturedHelpStream::new(
                &bound_help_probe.stderr,
                bound_help_probe.stderr_total_bytes,
                bound_help_probe.stderr_truncated,
                stderr_sha256,
            ),
        );
        Self::parse_bound_capture(
            bound_help_probe.tool,
            bound_help_probe.executable.clone(),
            bound_help_probe.executable_sha256,
            capture,
        )
    }

    /// Builds capabilities from help text that no discovery probe bound to an
    /// executable. It exists so a test can reach a conversion plan without a
    /// local installation, and is compiled out of the shipped binary: the
    /// authority chain that makes installed help evidence runs through
    /// `parse_bound_help`, and nothing in production may step around it.
    ///
    /// Reachable from another crate's tests only through the `test-support`
    /// feature, which is off by default and enabled as a dev-dependency. The
    /// desktop service's conversion path cannot be tested any other way: it
    /// takes capability evidence by value, and every production route to one
    /// runs a real executable. Widening this to an ordinary public constructor
    /// would make forged evidence reachable from the shipped binary, which is
    /// exactly what the gate above it is for.
    #[cfg(any(test, feature = "test-support"))]
    pub fn parse_unbound_capture_for_tests(
        tool: BackendTool,
        executable: PathBuf,
        executable_sha256: Sha256Digest,
        capture: CompleteHelpCapture<'_>,
    ) -> Result<Self, HelpCapabilityError> {
        Self::parse_bound_capture(tool, executable, executable_sha256, capture)
    }

    fn parse_bound_capture(
        tool: BackendTool,
        executable: PathBuf,
        executable_sha256: Sha256Digest,
        capture: CompleteHelpCapture<'_>,
    ) -> Result<Self, HelpCapabilityError> {
        validate_stream(HelpStream::Stdout, capture.stdout)?;
        validate_stream(HelpStream::Stderr, capture.stderr)?;

        let stdout = std::str::from_utf8(capture.stdout.bytes)
            .map_err(|_| HelpCapabilityError::InvalidUtf8(HelpStream::Stdout))?;
        let stderr = std::str::from_utf8(capture.stderr.bytes)
            .map_err(|_| HelpCapabilityError::InvalidUtf8(HelpStream::Stderr))?;

        let mut parser = HelpParser::new(tool);
        parser.parse_stream(stdout)?;
        parser.parse_stream(stderr)?;
        let mut parsed = parser.finish(RawHelpHashes {
            stdout: capture.stdout.sha256,
            stderr: capture.stderr.sha256,
        })?;
        parsed.provider_build = parse_provider_build(capture.stdout.bytes, capture.stderr.bytes);
        Ok(parsed.bind_to_executable(executable, executable_sha256))
    }

    /// Which ProteoWizard build this help came from, when it said.
    #[must_use]
    pub const fn provider_build(&self) -> Option<&ProviderBuild> {
        self.provider_build.as_ref()
    }

    #[must_use]
    pub const fn tool(&self) -> BackendTool {
        self.tool
    }

    #[must_use]
    pub fn executable(&self) -> &Path {
        &self.executable
    }

    #[must_use]
    pub(crate) const fn executable_sha256(&self) -> Sha256Digest {
        self.executable_sha256
    }

    #[must_use]
    pub const fn raw_help_hashes(&self) -> RawHelpHashes {
        self.raw_help_hashes
    }

    #[must_use]
    pub fn option(&self, name: &str) -> Option<&OptionDeclaration> {
        self.options.get(name)
    }

    #[must_use]
    pub fn analysis_query(&self, name: &str) -> Option<&NamedGrammarDeclaration> {
        self.analysis_queries.get(name)
    }

    #[must_use]
    pub fn spectrum_filter(&self, name: &str) -> Option<&NamedGrammarDeclaration> {
        self.spectrum_filters.get(name)
    }

    #[must_use]
    pub fn examples(&self) -> &[HelpExample] {
        &self.examples
    }

    #[must_use]
    pub fn tic_capability(&self) -> TicCapability {
        if self.tool != BackendTool::MsAccess
            || !self.query_has_exact_signature("tic", TIC_SIGNATURE)
        {
            return TicCapability::Unsupported;
        }

        if !self.option_has_argument("filter") {
            return TicCapability::SupportedWithoutFilter;
        }

        let exact_filter_declaration = self.spectrum_filter("msLevel").is_some_and(|declaration| {
            declaration.normalized_signature == "<mslevels>" && declaration.parameters.is_empty()
        });
        let exact_example = self.examples.iter().any(example_confirms_filtered_tic);

        if exact_filter_declaration && exact_example {
            TicCapability::SupportedWithMsLevelFilter
        } else {
            TicCapability::SupportedMsLevelFilterUnverified
        }
    }

    pub fn require_preview_operation(
        &self,
        operation: &PreviewOperation,
    ) -> Result<(), CapabilityRequirementError> {
        self.require_tool(BackendTool::MsAccess)?;
        self.require_option("outdir", OptionArgument::Required)?;
        self.require_option("exec", OptionArgument::Required)?;

        match operation {
            PreviewOperation::Metadata => {
                self.require_exact_query("metadata", METADATA_SIGNATURE)?;
            }
            PreviewOperation::RunSummary => {
                self.require_exact_query("run_summary", RUN_SUMMARY_SIGNATURE)?;
            }
            PreviewOperation::SpectrumTable => {
                self.require_exact_query("spectrum_table", SPECTRUM_TABLE_SIGNATURE)?;
            }
            PreviewOperation::Tic { ms_level: None } => {
                self.require_exact_query("tic", TIC_SIGNATURE)?;
            }
            PreviewOperation::Tic { ms_level: Some(_) } => {
                self.require_exact_query("tic", TIC_SIGNATURE)?;
                if !self.tic_capability().supports_ms_level_filter() {
                    return Err(CapabilityRequirementError::Missing(
                        "exact --filter plus `msLevel <mslevels>` grammar and filtered-TIC example",
                    ));
                }
            }
            PreviewOperation::SpectrumByIndex { .. } => {
                self.require_exact_query("binary", BINARY_SIGNATURE)?;
            }
        }
        Ok(())
    }

    pub fn require_conversion(&self, format: OpenFormat) -> Result<(), CapabilityRequirementError> {
        self.require_tool(BackendTool::MsConvert)?;
        self.require_option("outdir", OptionArgument::Required)?;
        self.require_option("outfile", OptionArgument::Required)?;
        self.require_zlib_option()?;
        match format {
            OpenFormat::MzMl => self.require_option("mzML", OptionArgument::None),
            OpenFormat::MzXml => self.require_option("mzXML", OptionArgument::None),
        }
    }

    fn require_tool(&self, expected: BackendTool) -> Result<(), CapabilityRequirementError> {
        if self.tool != expected {
            return Err(CapabilityRequirementError::WrongTool {
                expected,
                actual: self.tool,
            });
        }
        Ok(())
    }

    fn require_option(
        &self,
        name: &'static str,
        argument: OptionArgument,
    ) -> Result<(), CapabilityRequirementError> {
        if self
            .option(name)
            .is_some_and(|option| option.argument == argument)
        {
            Ok(())
        } else {
            Err(CapabilityRequirementError::Missing(name))
        }
    }

    fn require_zlib_option(&self) -> Result<(), CapabilityRequirementError> {
        if self.option("zlib").is_some_and(|option| {
            option.argument == OptionArgument::Optional
                && option.normalized_declaration == ZLIB_OPTION_DECLARATION
        }) {
            Ok(())
        } else {
            Err(CapabilityRequirementError::Missing(ZLIB_OPTION_REQUIREMENT))
        }
    }

    fn option_has_argument(&self, name: &str) -> bool {
        self.option(name).is_some_and(|option| {
            matches!(
                option.argument,
                OptionArgument::Required | OptionArgument::Optional
            )
        })
    }

    fn query_has_exact_signature(&self, query: &str, signature: &str) -> bool {
        self.analysis_query(query)
            .is_some_and(|declaration| declaration.normalized_signature == signature)
    }

    fn require_exact_query(
        &self,
        query: &'static str,
        signature: &'static str,
    ) -> Result<(), CapabilityRequirementError> {
        if self.query_has_exact_signature(query, signature) {
            Ok(())
        } else {
            Err(CapabilityRequirementError::Missing(query))
        }
    }
}

fn validate_stream(
    stream: HelpStream,
    capture: CapturedHelpStream<'_>,
) -> Result<(), HelpCapabilityError> {
    validate_stream_parts(
        stream,
        capture.bytes,
        capture.total_bytes,
        capture.truncated,
    )
}

fn validate_stream_parts(
    stream: HelpStream,
    bytes: &[u8],
    total_bytes: u64,
    truncated: bool,
) -> Result<(), HelpCapabilityError> {
    if truncated {
        return Err(HelpCapabilityError::Truncated(stream));
    }
    let captured_bytes = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    if total_bytes != captured_bytes {
        return Err(HelpCapabilityError::LengthMismatch {
            stream,
            captured_bytes,
            total_bytes,
        });
    }
    Ok(())
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum HelpCapabilityError {
    #[error("{0} help capture is truncated")]
    Truncated(HelpStream),
    #[error(
        "{stream} help capture retained {captured_bytes} bytes but reports {total_bytes} total bytes"
    )]
    LengthMismatch {
        stream: HelpStream,
        captured_bytes: u64,
        total_bytes: u64,
    },
    #[error("{0} help capture is not valid UTF-8")]
    InvalidUtf8(HelpStream),
    #[error("help does not contain the expected {0:?} usage declaration")]
    MissingUsage(BackendTool),
    #[error("help contains a usage declaration for {actual}, expected {expected}")]
    WrongUsage {
        expected: &'static str,
        actual: String,
    },
    #[error("a validated help probe bound to its executable is required")]
    ValidatedHelpProbeRequired,
    #[error("the {0} help capture digest could not be calculated")]
    DigestUnavailable(HelpStream),
    #[error("help does not contain an Options declaration section")]
    MissingOptionsSection,
    #[error("contradictory {kind} declaration for {name:?}: {first:?} conflicts with {second:?}")]
    ContradictoryDeclaration {
        kind: DeclarationKind,
        name: String,
        first: String,
        second: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelpStream {
    Stdout,
    Stderr,
}

impl fmt::Display for HelpStream {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Stdout => formatter.write_str("stdout"),
            Self::Stderr => formatter.write_str("stderr"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeclarationKind {
    Option,
    AnalysisQuery,
    SpectrumFilter,
}

impl fmt::Display for DeclarationKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Option => formatter.write_str("option"),
            Self::AnalysisQuery => formatter.write_str("analysis-query"),
            Self::SpectrumFilter => formatter.write_str("spectrum-filter"),
        }
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityRequirementError {
    #[error("installed help describes {actual:?}, not required tool {expected:?}")]
    WrongTool {
        expected: BackendTool,
        actual: BackendTool,
    },
    #[error("installed help does not confirm required grammar: {0}")]
    Missing(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Section {
    Other,
    Options,
    SpectrumFilters,
    ChromatogramFilters,
    AnalysisQueries,
    Examples,
}

struct HelpParser {
    tool: BackendTool,
    saw_usage: bool,
    saw_options: bool,
    options: BTreeMap<String, OptionDeclaration>,
    analysis_queries: BTreeMap<String, NamedGrammarDeclaration>,
    spectrum_filters: BTreeMap<String, NamedGrammarDeclaration>,
    examples: Vec<HelpExample>,
}

impl HelpParser {
    fn new(tool: BackendTool) -> Self {
        Self {
            tool,
            saw_usage: false,
            saw_options: false,
            options: BTreeMap::new(),
            analysis_queries: BTreeMap::new(),
            spectrum_filters: BTreeMap::new(),
            examples: Vec::new(),
        }
    }

    fn parse_stream(&mut self, text: &str) -> Result<(), HelpCapabilityError> {
        let mut section = Section::Other;
        let mut previous_blank = true;

        for raw_line in text.lines() {
            let line = raw_line.trim_end_matches('\r');
            let trimmed = line.trim();

            if let Some(program) = trimmed.strip_prefix("Usage: ") {
                let actual = program.split_ascii_whitespace().next().unwrap_or_default();
                let expected = tool_program(self.tool);
                if actual != expected {
                    return Err(HelpCapabilityError::WrongUsage {
                        expected,
                        actual: actual.to_owned(),
                    });
                }
                self.saw_usage = true;
                previous_blank = false;
                continue;
            }

            match trimmed {
                "Options:" => {
                    self.saw_options = true;
                    section = Section::Options;
                    previous_blank = false;
                    continue;
                }
                "Spectrum List Filters" => {
                    section = Section::SpectrumFilters;
                    previous_blank = false;
                    continue;
                }
                "Chromatogram List Filters" => {
                    section = Section::ChromatogramFilters;
                    previous_blank = false;
                    continue;
                }
                ANALYSIS_HEADING => {
                    section = Section::AnalysisQueries;
                    previous_blank = false;
                    continue;
                }
                "Examples:" => {
                    section = Section::Examples;
                    previous_blank = false;
                    continue;
                }
                _ => {}
            }

            match section {
                Section::Options => {
                    if leading_spaces(line) == 2
                        && let Some((name, declaration)) = parse_option_declaration(line)
                    {
                        insert_unique(
                            &mut self.options,
                            DeclarationKind::Option,
                            name,
                            declaration,
                            |value| value.normalized_declaration.clone(),
                        )?;
                    }
                }
                Section::SpectrumFilters if previous_blank => {
                    if let Some((name, declaration)) = parse_named_grammar_declaration(line, 0) {
                        insert_unique(
                            &mut self.spectrum_filters,
                            DeclarationKind::SpectrumFilter,
                            name,
                            declaration,
                            |value| value.normalized_signature.clone(),
                        )?;
                    }
                }
                Section::AnalysisQueries => {
                    if let Some((name, declaration)) = parse_named_grammar_declaration(line, 2) {
                        insert_unique(
                            &mut self.analysis_queries,
                            DeclarationKind::AnalysisQuery,
                            name,
                            declaration,
                            |value| value.normalized_signature.clone(),
                        )?;
                    }
                }
                Section::Examples => {
                    if let Some(example) = parse_example(line, tool_program(self.tool))
                        && !self.examples.contains(&example)
                    {
                        self.examples.push(example);
                    }
                }
                Section::Other | Section::ChromatogramFilters | Section::SpectrumFilters => {}
            }

            previous_blank = trimmed.is_empty();
        }
        Ok(())
    }

    fn finish(
        self,
        raw_help_hashes: RawHelpHashes,
    ) -> Result<ParsedHelpCapabilities, HelpCapabilityError> {
        if !self.saw_usage {
            return Err(HelpCapabilityError::MissingUsage(self.tool));
        }
        if !self.saw_options {
            return Err(HelpCapabilityError::MissingOptionsSection);
        }
        Ok(ParsedHelpCapabilities {
            tool: self.tool,
            raw_help_hashes,
            // Filled in by the caller, which holds the raw capture the build
            // identity is read from.
            provider_build: None,
            options: self.options,
            analysis_queries: self.analysis_queries,
            spectrum_filters: self.spectrum_filters,
            examples: self.examples,
        })
    }
}

fn tool_program(tool: BackendTool) -> &'static str {
    match tool {
        BackendTool::MsConvert => "msconvert",
        BackendTool::MsAccess => "msaccess",
    }
}

fn leading_spaces(value: &str) -> usize {
    value.bytes().take_while(|byte| *byte == b' ').count()
}

fn parse_option_declaration(line: &str) -> Option<(String, OptionDeclaration)> {
    let (left, _) = line.split_once(':')?;
    let normalized = normalize_space(left);
    let tokens = normalized.split_ascii_whitespace().collect::<Vec<_>>();
    let (index, option_token) = tokens
        .iter()
        .enumerate()
        .find(|(_, token)| token.starts_with("--"))?;
    let name = option_token.trim_start_matches("--").trim_end_matches(']');
    if !is_identifier(name) {
        return None;
    }

    let trailing = &tokens[index + 1..];
    let argument = if trailing.contains(&"arg") {
        OptionArgument::Required
    } else if trailing.iter().any(|token| token.starts_with("[=arg")) {
        OptionArgument::Optional
    } else {
        OptionArgument::None
    };
    Some((
        name.to_owned(),
        OptionDeclaration {
            argument,
            normalized_declaration: normalized,
        },
    ))
}

fn parse_named_grammar_declaration(
    line: &str,
    required_indent: usize,
) -> Option<(String, NamedGrammarDeclaration)> {
    if leading_spaces(line) != required_indent {
        return None;
    }
    let normalized = normalize_space(line);
    let (name, signature) = normalized
        .split_once(' ')
        .map_or((normalized.as_str(), ""), |(name, signature)| {
            (name, signature)
        });
    if !is_identifier(name) || name.ends_with(':') {
        return None;
    }
    if required_indent == 0 && !signature.is_empty() && !signature.contains(['<', '[', '=']) {
        return None;
    }
    if required_indent == 0 && signature.contains('.') {
        return None;
    }

    Some((
        name.to_owned(),
        NamedGrammarDeclaration {
            normalized_signature: signature.to_owned(),
            parameters: parse_parameters(signature),
        },
    ))
}

fn parse_parameters(signature: &str) -> BTreeMap<String, ParameterGrammar> {
    let bytes = signature.as_bytes();
    let mut parameters = BTreeMap::new();
    let mut index = 0;
    let mut optional_depth = 0_u32;
    while index < bytes.len() {
        if bytes[index] == b'[' {
            optional_depth = optional_depth.saturating_add(1);
            index += 1;
            continue;
        }
        if bytes[index] == b']' {
            optional_depth = optional_depth.saturating_sub(1);
            index += 1;
            continue;
        }
        if !is_identifier_start(bytes[index]) {
            index += 1;
            continue;
        }

        let name_start = index;
        index += 1;
        while index < bytes.len() && is_identifier_continue(bytes[index]) {
            index += 1;
        }
        let name_end = index;
        if bytes.get(index) != Some(&b'=') {
            continue;
        }
        index += 1;
        let value_start = index;
        if let Some(open) = bytes
            .get(index)
            .copied()
            .filter(|byte| matches!(byte, b'[' | b'<'))
        {
            let close = if open == b'[' { b']' } else { b'>' };
            index += 1;
            while index < bytes.len() && bytes[index] != close {
                index += 1;
            }
            if index < bytes.len() {
                index += 1;
            }
        } else {
            while index < bytes.len()
                && !bytes[index].is_ascii_whitespace()
                && !matches!(bytes[index], b']' | b'|')
            {
                index += 1;
            }
        }

        let name = &signature[name_start..name_end];
        let normalized_value = signature[value_start..index].to_owned();
        let exact_choices = parse_exact_choices(&normalized_value);
        parameters.insert(
            name.to_owned(),
            ParameterGrammar {
                normalized_value,
                exact_choices,
                optional: optional_depth > 0,
            },
        );
    }
    parameters
}

fn parse_exact_choices(value: &str) -> BTreeSet<String> {
    let value = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .or_else(|| {
            value
                .strip_prefix('<')
                .and_then(|value| value.strip_suffix('>'))
        })
        .unwrap_or_default();
    if value.is_empty() {
        return BTreeSet::new();
    }
    let choices = value.split('|').collect::<Vec<_>>();
    if choices.iter().all(|choice| is_identifier(choice)) {
        choices.into_iter().map(str::to_owned).collect()
    } else {
        BTreeSet::new()
    }
}

fn parse_example(line: &str, program: &str) -> Option<HelpExample> {
    let normalized_line = normalize_space(line);
    let tokens = tokenize_example(&normalized_line)?;
    if tokens.first().is_none_or(|token| token != program) {
        return None;
    }
    Some(HelpExample {
        normalized_line,
        tokens,
    })
}

fn tokenize_example(line: &str) -> Option<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for character in line.chars() {
        match character {
            '"' => quoted = !quoted,
            value if value.is_ascii_whitespace() && !quoted => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            value => current.push(value),
        }
    }
    if quoted {
        return None;
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Some(tokens)
}

fn example_confirms_filtered_tic(example: &HelpExample) -> bool {
    let has_tic_query = example.tokens.windows(2).any(|tokens| {
        matches!(tokens[0].as_str(), "-x" | "--exec")
            && tokens[1]
                .split_ascii_whitespace()
                .next()
                .is_some_and(|query| query == "tic")
    });
    let has_exact_filter = example
        .tokens
        .iter()
        .any(|token| token == "--filter=msLevel 2");
    has_tic_query && has_exact_filter
}

fn insert_unique<T: PartialEq>(
    declarations: &mut BTreeMap<String, T>,
    kind: DeclarationKind,
    name: String,
    declaration: T,
    describe: impl Fn(&T) -> String,
) -> Result<(), HelpCapabilityError> {
    if let Some(existing) = declarations.get(&name) {
        if existing != &declaration {
            return Err(HelpCapabilityError::ContradictoryDeclaration {
                kind,
                name,
                first: describe(existing),
                second: describe(&declaration),
            });
        }
    } else {
        declarations.insert(name, declaration);
    }
    Ok(())
}

fn normalize_space(value: &str) -> String {
    value.split_ascii_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes.next().is_some_and(is_identifier_start) && bytes.all(is_identifier_continue)
}

const fn is_identifier_start(value: u8) -> bool {
    value.is_ascii_alphabetic() || value == b'_'
}

const fn is_identifier_continue(value: u8) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, b'_' | b'-')
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::command::{
        PlanError, build_msaccess_command_with_capabilities,
        build_msconvert_command_with_capabilities,
    };

    const EMPTY_SHA256: Sha256Digest = Sha256Digest::from_bytes([
        0xE3, 0xB0, 0xC4, 0x42, 0x98, 0xFC, 0x1C, 0x14, 0x9A, 0xFB, 0xF4, 0xC8, 0x99, 0x6F, 0xB9,
        0x24, 0x27, 0xAE, 0x41, 0xE4, 0x64, 0x9B, 0x93, 0x4C, 0xA4, 0x95, 0x99, 0x1B, 0x78, 0x52,
        0xB8, 0x55,
    ]);
    const FIXTURE_SHA256: Sha256Digest = Sha256Digest::from_bytes([0xAB; 32]);
    const FIXTURE_EXECUTABLE_SHA256: Sha256Digest = Sha256Digest::from_bytes([0xCD; 32]);

    const MSACCESS_HELP: &str = r#"Usage: msaccess [options] [filenames]
MassSpecAccess - command line access to mass spec data files
                 uses -x/--exec to specify analysis command.

Options:

  -o [ --outdir ] arg (=.) : output directory
  -x [ --exec ] arg        : execute command, e.g --exec "tic mz=409-412"
  --filter arg             : add a spectrum list filter, e.g. --filter="msLevel [2,3]"

Spectrum List Filters
=====================

msLevel <mslevels>
This filter selects only spectra with the indicated <mslevels>, expressed as an int_set.

Analysis commands (used with -x/--exec):

  metadata
    (write file-level metadata)

  run_summary [msLevels=<int_set>] [charges=<int_set>] [delimiter=<fixed|space|comma|tab>]
    (print summary statistics about a run)

  spectrum_table [delimiter=<fixed|space|comma|tab>]
    (write spectrum metadata in a table format)

  binary index=<spectrumIndexLow>[,<spectrumIndexHigh>] | sn=<scanNumberLow>[,<scanNumberHigh>] [precision=<precision>]
    (write binary data for selected spectra)

  slice [mz=<mzLow>[,<mzHigh>]] [rt=<rtLow>[,<rtHigh>]]] [index=<indexLow>[,<indexHigh>] | sn=<scanLow>[,<scanHigh>]] [delimiter=<fixed|space|comma|tab>]
    (write data from a rectangular region)

  tic [mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed|space|comma|tab>]
    (write total ion counts for an m/z range)

  sic mzCenter=<mz> radius=<radius> radiusUnits=<amu|ppm> [delimiter=<fixed|space|comma|tab>]
    (write selected ion chromatogram for an m/z and radius)
      mzCenter: set mz value
      radius: set radius value
      radiusUnits: set units for radius value (must be amu or ppm)

  image [args - see list]
    (create pseudo-2D-gel image)
      args:
      label=<xxxx> (set filename label to xxxx)
      mz=<mzLow>[,<mzHigh>] (set m/z cutoff range)

Examples:

msaccess data.mzML -x "tic mz=409-410" --filter="msLevel 2"
msaccess data.mzML -x spectrum_table
"#;

    const MSCONVERT_HELP: &str = r#"Usage: msconvert [options] [filemasks]
Convert mass spec data file formats.

Options:
  -o [ --outdir ] arg (=.)           : set output directory
  --outfile arg                      : Override the name of output file.
  --mzML                             : write mzML format [default]
  --mzXML                            : write mzXML format
  -z [ --zlib ] [=arg(=1)]           : use zlib compression for binary data

Examples:

msconvert data.RAW --mzXML
"#;

    fn capture(text: &str) -> CompleteHelpCapture<'_> {
        CompleteHelpCapture::new(
            CapturedHelpStream::new(text.as_bytes(), text.len() as u64, false, FIXTURE_SHA256),
            CapturedHelpStream::new(&[], 0, false, EMPTY_SHA256),
        )
    }

    fn parse_capabilities(
        tool: BackendTool,
        capture: CompleteHelpCapture<'_>,
    ) -> Result<InstalledHelpCapabilities, HelpCapabilityError> {
        let executable = fs::canonicalize(std::env::current_exe().expect("test executable"))
            .expect("canonical test executable");
        InstalledHelpCapabilities::parse_bound_capture(
            tool,
            executable,
            FIXTURE_EXECUTABLE_SHA256,
            capture,
        )
    }

    fn msaccess(text: &str) -> InstalledHelpCapabilities {
        parse_capabilities(BackendTool::MsAccess, capture(text)).expect("valid msaccess fixture")
    }

    #[test]
    fn bound_capabilities_supply_the_only_executable_to_public_plans() {
        let test_directory = TestDirectory::new();
        let installation_a = test_directory.path().join("installation-a");
        let installation_b = test_directory.path().join("installation-b");
        fs::create_dir(&installation_a).expect("create installation A");
        fs::create_dir(&installation_b).expect("create installation B");
        let msconvert_a = installation_a.join("msconvert.exe");
        let msconvert_b = installation_b.join("msconvert.exe");
        let msaccess_a = installation_a.join("msaccess.exe");
        fs::write(&msconvert_a, b"installation A converter").expect("write converter A");
        fs::write(&msconvert_b, b"installation B converter").expect("write converter B");
        fs::write(&msaccess_a, b"installation A preview").expect("write preview A");

        let converter_alias = installation_a
            .join("..")
            .join("installation-a")
            .join("msconvert.exe");
        let converter_capabilities = InstalledHelpCapabilities::parse_bound_capture(
            BackendTool::MsConvert,
            fs::canonicalize(&converter_alias).expect("canonical converter A alias"),
            FIXTURE_EXECUTABLE_SHA256,
            capture(MSCONVERT_HELP),
        )
        .expect("bind converter help to installation A");
        let input = test_directory.path().join("sample.raw");
        let conversion_output = test_directory.path().join("converted");
        fs::write(&input, b"source RAW").expect("write source RAW");
        fs::create_dir(&conversion_output).expect("create conversion output");
        let canonical_input = fs::canonicalize(&input).expect("canonical source input");

        let conversion = build_msconvert_command_with_capabilities(
            &converter_capabilities,
            &input,
            &conversion_output,
            OsStr::new("sample.mzML"),
            OpenFormat::MzMl,
        )
        .expect("bound conversion command");

        assert_eq!(
            converter_capabilities.executable(),
            fs::canonicalize(&msconvert_a)
                .expect("canonical converter A")
                .as_path()
        );
        assert_eq!(conversion.executable(), converter_capabilities.executable());
        assert_eq!(
            conversion.executable_sha256,
            Some(FIXTURE_EXECUTABLE_SHA256)
        );
        assert_eq!(
            conversion
                .source_identity
                .as_ref()
                .map(|identity| identity.primary().canonical_path()),
            Some(canonical_input.as_path())
        );
        assert_ne!(
            conversion.executable(),
            fs::canonicalize(&msconvert_b)
                .expect("canonical converter B")
                .as_path()
        );

        let preview_capabilities = InstalledHelpCapabilities::parse_bound_capture(
            BackendTool::MsAccess,
            fs::canonicalize(&msaccess_a).expect("canonical preview executable"),
            FIXTURE_EXECUTABLE_SHA256,
            capture(MSACCESS_HELP),
        )
        .expect("bind preview help to installation A");
        let preview_output = test_directory.path().join("preview");
        fs::create_dir(&preview_output).expect("create preview output");
        let preview = build_msaccess_command_with_capabilities(
            &preview_capabilities,
            &input,
            &preview_output,
            PreviewOperation::Metadata,
        )
        .expect("bound preview command");

        assert_eq!(preview.executable(), preview_capabilities.executable());
        assert_eq!(preview.executable_sha256, Some(FIXTURE_EXECUTABLE_SHA256));
        assert_eq!(
            preview
                .source_identity
                .as_ref()
                .map(|identity| identity.primary().canonical_path()),
            Some(canonical_input.as_path())
        );
    }

    #[test]
    fn parses_realistic_msaccess_declarations_without_confusing_descriptions() {
        let capabilities = msaccess(MSACCESS_HELP);

        assert_eq!(
            capabilities
                .option("outdir")
                .map(OptionDeclaration::argument),
            Some(OptionArgument::Required)
        );
        assert_eq!(
            capabilities.tic_capability(),
            TicCapability::SupportedWithMsLevelFilter
        );
        let binary = capabilities
            .analysis_query("binary")
            .expect("binary query declaration");
        assert!(binary.has_parameter("index"));
        assert!(binary.has_parameter("precision"));
        assert_eq!(binary.parameter_is_optional("index"), Some(false));
        assert_eq!(binary.parameter_is_optional("precision"), Some(true));
        assert!(capabilities.analysis_query("write").is_none());
        assert_eq!(capabilities.examples().len(), 2);
        assert_eq!(capabilities.raw_help_hashes().stdout, FIXTURE_SHA256);
    }

    /// Every live analysis query the installed backend declares is readable
    /// through the generic accessor, including `slice`, `sic` and `image` --
    /// the three the repository held no signature constant for.
    ///
    /// M5.4 evidence, and the reason that slice changed no production code. The
    /// question it had to answer was whether an XIC source could be *described*
    /// by the capability contract as it stands; `analysis_query` is the same
    /// accessor `tic` already reaches through, and it holds `sic` and `slice`
    /// with no new parsing at all. A candidate inventory is therefore a thing
    /// this contract can express, not a thing that needed one.
    ///
    /// The signatures below are copied verbatim from the help of ProteoWizard
    /// `3.0.26013 (47b13cf)`. They are that build's, and a different build may
    /// declare different ones -- which is exactly why they are asserted as
    /// exact text rather than described.
    #[test]
    fn every_live_analysis_query_is_readable_through_the_generic_accessor() {
        let capabilities = msaccess(MSACCESS_HELP);

        // All eight the installed build declares, so the name of this case is
        // the claim it makes. The four the product already depends on are
        // asserted by exact signature at the end; the four below are the ones
        // M5.4 had to read for the first time or reason about.
        for declared in [
            "metadata",
            "run_summary",
            "spectrum_table",
            "binary",
            "slice",
            "tic",
            "sic",
            "image",
        ] {
            assert!(
                capabilities.analysis_query(declared).is_some(),
                "{declared} is declared by the installed build"
            );
        }
        assert!(capabilities.analysis_query("write").is_none());

        // `sic` -- the one whose name means *selected ion chromatogram*, and
        // whose three parameters are all required. A window is expressed as a
        // centre and a radius rather than as two bounds, which is a different
        // input shape from `tic`'s and is the fact M5.4 had to measure rather
        // than assume.
        let sic = capabilities
            .analysis_query("sic")
            .expect("the installed build declares sic");
        assert_eq!(
            sic.normalized_signature(),
            "mzCenter=<mz> radius=<radius> radiusUnits=<amu|ppm> [delimiter=<fixed|space|comma|tab>]"
        );
        for required in ["mzCenter", "radius", "radiusUnits"] {
            assert_eq!(
                sic.parameter_is_optional(required),
                Some(false),
                "{required} is required by this signature"
            );
        }
        // The units are a closed pair, which is a gate a caller can enforce
        // before invoking rather than discovering from a failure.
        assert!(sic.parameter_allows_exact_value("radiusUnits", "amu"));
        assert!(sic.parameter_allows_exact_value("radiusUnits", "ppm"));
        assert!(!sic.parameter_allows_exact_value("radiusUnits", "da"));

        // `slice` -- a rectangular region reader. It expresses an m/z window the
        // same way `tic` does, and adds retention-time and index/scan bounds.
        let slice = capabilities
            .analysis_query("slice")
            .expect("the installed build declares slice");
        assert!(slice.has_parameter("mz"));
        assert!(slice.has_parameter("rt"));
        assert_eq!(slice.parameter_is_optional("mz"), Some(true));

        // And `tic`, unchanged, so this case also pins that adding the two
        // above did not disturb the declaration the product already depends on.
        let tic = capabilities
            .analysis_query("tic")
            .expect("the installed build declares tic");
        assert_eq!(
            tic.normalized_signature(),
            "[mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed|space|comma|tab>]"
        );
        assert_eq!(tic.parameter_is_optional("mz"), Some(true));
        assert_eq!(
            capabilities.tic_capability(),
            TicCapability::SupportedWithMsLevelFilter
        );

        // `image`, whose declaration is the odd one: its parameters are listed
        // as prose under an `[args - see list]` placeholder rather than in the
        // signature. It is held as a declaration with no parameters, which is
        // the honest reading -- the grammar genuinely does not declare any.
        let image = capabilities
            .analysis_query("image")
            .expect("the installed build declares image");
        assert_eq!(image.normalized_signature(), "[args - see list]");
        assert_eq!(image.parameter_names().count(), 0);
        assert!(!image.has_parameter("mz"));
    }

    /// Two limits of the generic accessor, pinned so a caller does not mistake
    /// it for more than it is.
    ///
    /// The case above reads exact signatures out of live help, which is what
    /// M5.4 needed. It would be easy to read that as "the accessor models the
    /// grammar", and it does not model two things a caller could otherwise be
    /// misled by. Both are recorded here rather than fixed, because M5.4 is an
    /// evidence slice and neither is reachable from any shipped route: nothing
    /// in production asks about `binary`'s alternation or `slice`'s brackets.
    #[test]
    fn the_generic_accessor_models_neither_alternation_nor_malformed_help() {
        let capabilities = msaccess(MSACCESS_HELP);

        // `binary index=<...> | sn=<...>` is an *alternation*: exactly one of
        // the two is supplied. The accessor reports both as required, because
        // it reads optionality from bracketing alone and `|` is not bracketing.
        // A caller that gated `binary sn=413` on `parameter_is_optional` would
        // reject a valid invocation.
        let binary = capabilities
            .analysis_query("binary")
            .expect("binary query declaration");
        assert_eq!(binary.parameter_is_optional("index"), Some(false));
        assert_eq!(binary.parameter_is_optional("sn"), Some(false));

        // And `slice`'s own declaration is unbalanced in the installed help --
        // `[rt=<rtLow>[,<rtHigh>]]]` closes one bracket more than it opens.
        // That is upstream's text, reproduced verbatim above rather than
        // silently repaired, and the parser absorbs the extra close instead of
        // refusing the line. Asserted so a later transcription error in the
        // fixture is a failing test rather than an invisible edit.
        let slice = capabilities
            .analysis_query("slice")
            .expect("slice query declaration");
        //
        // Pinned as exact text, which is what makes a later transcription error
        // in the fixture a failing test rather than an invisible edit. A
        // separate bracket-balance assertion would add nothing: it would run on
        // the string this line has already fixed.
        assert_eq!(
            slice.normalized_signature(),
            "[mz=<mzLow>[,<mzHigh>]] [rt=<rtLow>[,<rtHigh>]]] [index=<indexLow>[,<indexHigh>] | sn=<scanLow>[,<scanHigh>]] [delimiter=<fixed|space|comma|tab>]"
        );
    }

    #[test]
    fn exact_declarations_validate_each_current_preview_operation() {
        let capabilities = msaccess(MSACCESS_HELP);
        for operation in [
            PreviewOperation::Metadata,
            PreviewOperation::RunSummary,
            PreviewOperation::SpectrumTable,
            PreviewOperation::Tic { ms_level: None },
            PreviewOperation::Tic { ms_level: Some(2) },
            PreviewOperation::SpectrumByIndex {
                index: 7,
                precision: 8,
            },
        ] {
            capabilities
                .require_preview_operation(&operation)
                .expect("fixture confirms complete operation grammar");
        }
    }

    #[test]
    fn substrings_in_option_descriptions_and_examples_are_not_declarations() {
        let help = r#"Usage: msaccess [options] [filenames]
Options:
  --help : examples mention --outdir --exec --filter
Analysis commands (used with -x/--exec):
Examples:
msaccess data.mzML --exec "tic delimiter=tab" --filter="msLevel 2"
"#;
        let capabilities = msaccess(help);

        assert!(capabilities.option("outdir").is_none());
        assert!(capabilities.analysis_query("tic").is_none());
        assert!(capabilities.spectrum_filter("msLevel").is_none());
        assert_eq!(capabilities.tic_capability(), TicCapability::Unsupported);
        assert!(
            capabilities
                .require_preview_operation(&PreviewOperation::Tic { ms_level: None })
                .is_err()
        );
    }

    #[test]
    fn generic_filter_support_does_not_confirm_ms_level_grammar() {
        let help = MSACCESS_HELP.replace(
            "msLevel <mslevels>\nThis filter selects only spectra with the indicated <mslevels>, expressed as an int_set.\n",
            "",
        );
        let capabilities = msaccess(&help);

        assert_eq!(
            capabilities.tic_capability(),
            TicCapability::SupportedMsLevelFilterUnverified
        );
        assert!(
            capabilities
                .require_preview_operation(&PreviewOperation::Tic { ms_level: Some(2) })
                .is_err()
        );
    }

    #[test]
    fn current_typed_queries_reject_new_unprovided_required_parameters() {
        let metadata_help =
            MSACCESS_HELP.replacen("  metadata\n", "  metadata required=<value>\n", 1);
        let metadata = msaccess(&metadata_help);
        assert!(
            metadata
                .require_preview_operation(&PreviewOperation::Metadata)
                .is_err()
        );

        let tic_help = MSACCESS_HELP.replacen(
            "  tic [mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed|space|comma|tab>]",
            "  tic [mz=<mzLow>[,<mzHigh>]] delimiter=<fixed|space|comma|tab>",
            1,
        );
        let tic = msaccess(&tic_help);
        assert_eq!(tic.tic_capability(), TicCapability::Unsupported);
        assert!(
            tic.require_preview_operation(&PreviewOperation::Tic { ms_level: None })
                .is_err()
        );
    }

    #[test]
    fn residual_tokens_unbalanced_groups_and_duplicate_parameters_fail_exact_plans() {
        let residual = msaccess(&MSACCESS_HELP.replace(
            "  tic [mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed|space|comma|tab>]",
            "  tic required_token [mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed|space|comma|tab>]",
        ));
        assert!(
            residual
                .require_preview_operation(&PreviewOperation::Tic { ms_level: None })
                .is_err()
        );

        let unbalanced = msaccess(&MSACCESS_HELP.replace(
            "  spectrum_table [delimiter=<fixed|space|comma|tab>]",
            "  spectrum_table [delimiter=<fixed|space|comma|tab>",
        ));
        assert!(
            unbalanced
                .require_preview_operation(&PreviewOperation::SpectrumTable)
                .is_err()
        );

        let duplicate = msaccess(&MSACCESS_HELP.replace(
            "  run_summary [msLevels=<int_set>] [charges=<int_set>] [delimiter=<fixed|space|comma|tab>]",
            "  run_summary [msLevels=<int_set>] [charges=<int_set>] delimiter=<fixed|space|comma|tab> [delimiter=<fixed|space|comma|tab>]",
        ));
        assert!(
            duplicate
                .require_preview_operation(&PreviewOperation::RunSummary)
                .is_err()
        );

        let extra_binary = msaccess(&MSACCESS_HELP.replace(
            "  binary index=<spectrumIndexLow>[,<spectrumIndexHigh>] | sn=<scanNumberLow>[,<scanNumberHigh>] [precision=<precision>]",
            "  binary index=<spectrumIndexLow>[,<spectrumIndexHigh>] | sn=<scanNumberLow>[,<scanNumberHigh>] foo=<required> [precision=<precision>]",
        ));
        assert!(
            extra_binary
                .require_preview_operation(&PreviewOperation::SpectrumByIndex {
                    index: 0,
                    precision: 8,
                })
                .is_err()
        );
    }

    #[test]
    fn near_miss_analysis_heading_does_not_open_the_declaration_section() {
        let help = MSACCESS_HELP.replace(
            ANALYSIS_HEADING,
            "Analysis commands (used with -x/--exec): examples only",
        );
        let capabilities = msaccess(&help);
        assert!(capabilities.analysis_query("metadata").is_none());
        assert!(
            capabilities
                .require_preview_operation(&PreviewOperation::Metadata)
                .is_err()
        );
    }

    #[test]
    fn tic_without_a_declared_filter_is_modeled_separately() {
        let help = MSACCESS_HELP
            .replace(
                "  --filter arg             : add a spectrum list filter, e.g. --filter=\"msLevel [2,3]\"\n",
                "",
            )
            .replace(
                "msaccess data.mzML -x \"tic mz=409-410\" --filter=\"msLevel 2\"",
                "msaccess data.mzML -x \"tic mz=409-410\"",
            );
        let capabilities = msaccess(&help);

        assert_eq!(
            capabilities.tic_capability(),
            TicCapability::SupportedWithoutFilter
        );
        capabilities
            .require_preview_operation(&PreviewOperation::Tic { ms_level: None })
            .expect("unfiltered TIC remains confirmed");
    }

    #[test]
    fn conflicting_duplicate_query_declarations_fail_closed() {
        let help = format!(
            "{MSACCESS_HELP}\nAnalysis commands (used with -x/--exec):\n\n  tic [delimiter=[comma|space]]\n"
        );
        let error = parse_capabilities(BackendTool::MsAccess, capture(&help))
            .expect_err("contradictory TIC declarations must fail");

        assert!(matches!(
            error,
            HelpCapabilityError::ContradictoryDeclaration {
                kind: DeclarationKind::AnalysisQuery,
                ref name,
                ..
            } if name == "tic"
        ));
    }

    #[test]
    fn truncated_or_length_mismatched_streams_fail_closed() {
        let truncated = CompleteHelpCapture::new(
            CapturedHelpStream::new(
                MSACCESS_HELP.as_bytes(),
                MSACCESS_HELP.len() as u64 + 1,
                true,
                FIXTURE_SHA256,
            ),
            CapturedHelpStream::new(&[], 0, false, EMPTY_SHA256),
        );
        assert_eq!(
            parse_capabilities(BackendTool::MsAccess, truncated),
            Err(HelpCapabilityError::Truncated(HelpStream::Stdout))
        );

        let truncated_stderr = CompleteHelpCapture::new(
            CapturedHelpStream::new(&[], 0, false, EMPTY_SHA256),
            CapturedHelpStream::new(
                MSACCESS_HELP.as_bytes(),
                MSACCESS_HELP.len() as u64 + 1,
                true,
                FIXTURE_SHA256,
            ),
        );
        assert_eq!(
            parse_capabilities(BackendTool::MsAccess, truncated_stderr),
            Err(HelpCapabilityError::Truncated(HelpStream::Stderr))
        );

        let mismatch = CompleteHelpCapture::new(
            CapturedHelpStream::new(
                MSACCESS_HELP.as_bytes(),
                MSACCESS_HELP.len() as u64 + 1,
                false,
                FIXTURE_SHA256,
            ),
            CapturedHelpStream::new(&[], 0, false, EMPTY_SHA256),
        );
        assert!(matches!(
            parse_capabilities(BackendTool::MsAccess, mismatch),
            Err(HelpCapabilityError::LengthMismatch {
                stream: HelpStream::Stdout,
                ..
            })
        ));
    }

    #[test]
    fn wrong_program_header_fails_even_when_markers_are_present() {
        let help = MSACCESS_HELP.replacen("Usage: msaccess", "Usage: msconvert", 1);
        assert!(matches!(
            parse_capabilities(BackendTool::MsAccess, capture(&help)),
            Err(HelpCapabilityError::WrongUsage { .. })
        ));
    }

    #[test]
    fn complete_msconvert_declarations_recognize_both_conversion_grammars() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");

        assert_eq!(
            capabilities.option("zlib").map(OptionDeclaration::argument),
            Some(OptionArgument::Optional)
        );
        assert_eq!(
            capabilities
                .option("zlib")
                .map(OptionDeclaration::normalized_declaration),
            Some(ZLIB_OPTION_DECLARATION)
        );
        assert_eq!(
            capabilities
                .option("outfile")
                .map(OptionDeclaration::argument),
            Some(OptionArgument::Required)
        );
        capabilities
            .require_conversion(OpenFormat::MzMl)
            .expect("mzML grammar");
        capabilities
            .require_conversion(OpenFormat::MzXml)
            .expect("mzXML grammar");
    }

    #[test]
    fn mzxml_grammar_does_not_enable_public_conversion_planning() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        capabilities
            .require_conversion(OpenFormat::MzXml)
            .expect("installed help recognizes the mzXML grammar");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            &test_path("sample.raw"),
            &test_path("converted"),
            OsStr::new("sample.mzXML"),
            OpenFormat::MzXml,
        )
        .expect_err("mzXML must remain unavailable until its integrity gate is implemented");

        assert_eq!(error, PlanError::MzXmlIntegrityGateRequired);
    }

    #[test]
    fn complete_mzml_grammar_builds_the_expected_public_conversion_plan() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let source_directory = test_directory.path().join("source");
        fs::create_dir(&source_directory).expect("create source directory");
        let source = source_directory.join("sample.raw");
        let input = source_directory
            .join("..")
            .join("source")
            .join("sample.raw");
        let output_directory = test_directory.path().join("converted");
        fs::write(&source, b"source RAW").expect("write source RAW");
        fs::create_dir(&output_directory).expect("create fresh output directory");
        let canonical_input = fs::canonicalize(&input).expect("canonical file input");
        let canonical_output = fs::canonicalize(&output_directory).expect("canonical output root");
        let command = build_msconvert_command_with_capabilities(
            &capabilities,
            &input,
            &output_directory,
            OsStr::new("样本 01.mzML"),
            OpenFormat::MzMl,
        )
        .expect("complete installed grammar permits mzML planning");

        assert_eq!(command.args()[0], canonical_input.as_os_str());
        assert_ne!(command.args()[0], input.as_os_str());
        assert_eq!(command.args()[1], "--mzML");
        assert_eq!(command.args()[2], "--zlib");
        assert_eq!(command.args()[3], "--outdir");
        assert_eq!(command.args()[4], canonical_output.as_os_str());
        assert_eq!(command.args()[5], "--outfile");
        assert_eq!(command.args()[6], OsStr::new("样本 01.mzML"));
        assert!(!command.contains_argument("--filter"));
        assert_eq!(command.args().len(), 7);
        assert_eq!(
            command.output_destination(),
            Some(canonical_output.join("样本 01.mzML").as_path())
        );
        assert_eq!(command.source_directory_boundary(), None);
    }

    #[test]
    fn public_mzml_planning_rejects_an_existing_default_output() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.raw");
        let output_directory = test_directory.path().join("converted");
        fs::write(&input, b"source RAW").expect("write source RAW");
        fs::create_dir(&output_directory).expect("create output directory");
        fs::write(output_directory.join("sample.mzML"), b"existing output")
            .expect("write existing output");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            &input,
            &output_directory,
            OsStr::new("sample.mzML"),
            OpenFormat::MzMl,
        )
        .expect_err("an existing default output must not produce a command specification");

        assert_eq!(error, PlanError::OutputDestinationExists);
    }

    #[test]
    fn public_mzml_planning_allows_a_distinct_target_in_the_input_parent() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        let output_directory = TestDirectory::new();
        let input = output_directory.path().join("sample.mzML");
        fs::write(&input, b"source mzML").expect("write source mzML");
        let canonical_output =
            fs::canonicalize(output_directory.path()).expect("canonical output root");

        let command = build_msconvert_command_with_capabilities(
            &capabilities,
            &input,
            output_directory.path(),
            OsStr::new("converted.mzML"),
            OpenFormat::MzMl,
        )
        .expect("a distinct exact target does not conflict with the source");

        assert_eq!(
            command.output_destination(),
            Some(canonical_output.join("converted.mzML").as_path())
        );
        assert_eq!(fs::read(&input).expect("read source mzML"), b"source mzML");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            &input,
            output_directory.path(),
            OsStr::new("sample.mzML"),
            OpenFormat::MzMl,
        )
        .expect_err("the exact source path must never be a conversion destination");
        assert_eq!(error, PlanError::OutputDestinationExists);
        assert_eq!(fs::read(&input).expect("read source mzML"), b"source mzML");
    }

    #[test]
    fn public_mzml_planning_allows_unrelated_entries_in_a_shared_output_root() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.raw");
        let output_directory = test_directory.path().join("converted");
        fs::write(&input, b"source RAW").expect("write source RAW");
        fs::create_dir(&output_directory).expect("create output directory");
        fs::write(output_directory.join("unrelated.txt"), b"unrelated")
            .expect("write unrelated entry");
        let canonical_output = fs::canonicalize(&output_directory).expect("canonical output root");

        let command = build_msconvert_command_with_capabilities(
            &capabilities,
            &input,
            &output_directory,
            OsStr::new("sample.mzML"),
            OpenFormat::MzMl,
        )
        .expect("unrelated entries do not conflict with the exact destination");

        assert_eq!(
            command.output_destination(),
            Some(canonical_output.join("sample.mzML").as_path())
        );
    }

    #[test]
    fn sequential_conversion_plans_reuse_one_output_root_for_distinct_targets() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let first_input = test_directory.path().join("first.raw");
        let second_input = test_directory.path().join("second.raw");
        let output_directory = test_directory.path().join("converted");
        fs::write(&first_input, b"first source").expect("write first source");
        fs::write(&second_input, b"second source").expect("write second source");
        fs::create_dir(&output_directory).expect("create shared output directory");
        let canonical_output = fs::canonicalize(&output_directory).expect("canonical output root");

        let first = build_msconvert_command_with_capabilities(
            &capabilities,
            &first_input,
            &output_directory,
            OsStr::new("first.mzML"),
            OpenFormat::MzMl,
        )
        .expect("plan first item");
        fs::write(
            first
                .output_destination()
                .expect("first destination is recorded"),
            b"first output",
        )
        .expect("simulate completed first item");

        let second = build_msconvert_command_with_capabilities(
            &capabilities,
            &second_input,
            &output_directory,
            OsStr::new("second.mzML"),
            OpenFormat::MzMl,
        )
        .expect("plan second item in the same output root");
        assert_eq!(
            second.output_destination(),
            Some(canonical_output.join("second.mzML").as_path())
        );
    }

    #[test]
    fn public_mzml_planning_rejects_an_existing_destination_directory() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.raw");
        let output_directory = test_directory.path().join("converted");
        fs::write(&input, b"source RAW").expect("write source RAW");
        fs::create_dir_all(output_directory.join("sample.mzML"))
            .expect("create conflicting destination directory");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            &input,
            &output_directory,
            OsStr::new("sample.mzML"),
            OpenFormat::MzMl,
        )
        .expect_err("any object at the exact destination must fail closed");

        assert_eq!(error, PlanError::OutputDestinationExists);
    }

    #[test]
    fn public_mzml_planning_fails_when_the_output_directory_cannot_be_inspected() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.raw");
        let missing_output = test_directory.path().join("missing");
        fs::write(&input, b"source RAW").expect("write source RAW");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            &input,
            &missing_output,
            OsStr::new("sample.mzML"),
            OpenFormat::MzMl,
        )
        .expect_err("an uninspectable output directory must fail closed");

        assert_eq!(
            error,
            PlanError::OutputDirectoryInspectionFailed {
                kind: std::io::ErrorKind::NotFound,
            }
        );
    }

    #[test]
    fn public_mzml_planning_rejects_output_equal_to_or_nested_inside_a_directory_input() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");

        for nested in [false, true] {
            let test_directory = TestDirectory::new();
            let input = test_directory.path().join("dataset.raw");
            fs::create_dir(&input).expect("create directory input");
            let output_directory = if nested {
                let output = input.join("converted");
                fs::create_dir(&output).expect("create nested output directory");
                output
            } else {
                input.clone()
            };

            let error = build_msconvert_command_with_capabilities(
                &capabilities,
                &input,
                &output_directory,
                OsStr::new("dataset.mzML"),
                OpenFormat::MzMl,
            )
            .expect_err("output inside a directory input must fail closed");

            assert_eq!(error, PlanError::OutputDirectoryInsideDirectoryInput);
        }
    }

    #[test]
    fn public_mzml_planning_accepts_fresh_sibling_output_for_a_directory_input() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let source_parent = test_directory.path().join("source");
        let source = source_parent.join("dataset.raw");
        let input = source_parent.join("..").join("source").join("dataset.raw");
        let output_directory = test_directory.path().join("converted");
        fs::create_dir_all(&source).expect("create directory input");
        fs::create_dir(&output_directory).expect("create sibling output directory");
        let canonical_input = fs::canonicalize(&input).expect("canonical directory input");
        let canonical_output = fs::canonicalize(&output_directory).expect("canonical output root");

        let command = build_msconvert_command_with_capabilities(
            &capabilities,
            &input,
            &output_directory,
            OsStr::new("dataset.mzML"),
            OpenFormat::MzMl,
        )
        .expect("a fresh sibling output directory is safe to plan");

        assert_eq!(command.args()[0], canonical_input.as_os_str());
        assert_ne!(command.args()[0], input.as_os_str());
        assert_eq!(command.args()[4], canonical_output.as_os_str());
        assert_eq!(
            command.source_directory_boundary(),
            Some(canonical_input.as_path())
        );
    }

    #[test]
    fn public_mzml_planning_fails_when_the_input_cannot_be_inspected() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let missing_input = test_directory.path().join("missing.raw");
        let output_directory = test_directory.path().join("converted");
        fs::create_dir(&output_directory).expect("create fresh output directory");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            &missing_input,
            &output_directory,
            OsStr::new("missing.mzML"),
            OpenFormat::MzMl,
        )
        .expect_err("an uninspectable input must fail closed");

        assert_eq!(
            error,
            PlanError::InputPathInspectionFailed {
                kind: std::io::ErrorKind::NotFound,
            }
        );
    }

    #[test]
    fn public_mzml_planning_rejects_unsafe_output_file_names_and_wrong_extensions() {
        let capabilities = parse_capabilities(BackendTool::MsConvert, capture(MSCONVERT_HELP))
            .expect("valid msconvert fixture");

        for output_file_name in [
            "",
            ".",
            "..",
            "nested/output.mzML",
            r"nested\output.mzML",
            r"C:output.mzML",
            r"\\server\share\output.mzML",
            "bad?name.mzML",
            "CON.mzML",
            "CON .mzML",
            "nul.MZML",
            "AUX.data.mzML",
            "COM1.mzML",
            "Lpt9.mzML",
            "COM¹.mzML",
            "lpt³.mzML",
        ] {
            let error = build_msconvert_command_with_capabilities(
                &capabilities,
                &test_path("sample.raw"),
                &test_path("converted"),
                OsStr::new(output_file_name),
                OpenFormat::MzMl,
            )
            .expect_err("unsafe output names must fail before filesystem inspection");
            assert_eq!(error, PlanError::InvalidOutputFileName);
        }

        for output_file_name in ["sample", "sample.mzXML"] {
            let error = build_msconvert_command_with_capabilities(
                &capabilities,
                &test_path("sample.raw"),
                &test_path("converted"),
                OsStr::new(output_file_name),
                OpenFormat::MzMl,
            )
            .expect_err("the exact output extension must match the selected format");
            assert_eq!(error, PlanError::OutputFileExtensionMismatch);
        }
    }

    #[test]
    fn public_conversion_planning_requires_an_exact_outfile_argument_declaration() {
        let outfile_declaration =
            "  --outfile arg                      : Override the name of output file.\n";
        for help in [
            MSCONVERT_HELP.replace(outfile_declaration, ""),
            MSCONVERT_HELP.replace(
                outfile_declaration,
                "  --outfile [=arg(=name)]           : Override the name of output file.\n",
            ),
        ] {
            let capabilities = parse_capabilities(BackendTool::MsConvert, capture(&help))
                .expect("syntactically valid incomplete msconvert fixture");
            let error = build_msconvert_command_with_capabilities(
                &capabilities,
                &test_path("sample.raw"),
                &test_path("converted"),
                OsStr::new("sample.mzML"),
                OpenFormat::MzMl,
            )
            .expect_err("missing or optional outfile grammar must fail closed");

            assert_eq!(
                error,
                PlanError::InstalledHelpCapability(CapabilityRequirementError::Missing("outfile"))
            );
        }
    }

    #[test]
    fn public_conversion_planning_requires_the_zlib_declaration() {
        let zlib_declaration =
            "  -z [ --zlib ] [=arg(=1)]           : use zlib compression for binary data\n";
        for replacement in [
            "",
            "  -z [ --zlib ] [=arg(=0)]           : use zlib compression for binary data\n",
            "  -z [ --zlib ] [=arg]               : use zlib compression for binary data\n",
            "  -z [ --zlib ]                      : use zlib compression for binary data\n",
        ] {
            let help = MSCONVERT_HELP.replace(zlib_declaration, replacement);
            let capabilities = parse_capabilities(BackendTool::MsConvert, capture(&help))
                .expect("syntactically valid incomplete msconvert fixture");
            let error = build_msconvert_command_with_capabilities(
                &capabilities,
                &test_path("sample.raw"),
                &test_path("converted"),
                OsStr::new("sample.mzML"),
                OpenFormat::MzMl,
            )
            .expect_err("missing or changed zlib grammar must fail closed");

            assert_eq!(
                error,
                PlanError::InstalledHelpCapability(CapabilityRequirementError::Missing(
                    ZLIB_OPTION_REQUIREMENT
                ))
            );
        }
    }

    #[test]
    fn zero_ms_level_filter_is_rejected_before_public_command_planning() {
        let capabilities = msaccess(MSACCESS_HELP);
        let error = build_msaccess_command_with_capabilities(
            &capabilities,
            &test_path("sample.mzML"),
            &test_path("preview"),
            PreviewOperation::Tic { ms_level: Some(0) },
        )
        .expect_err("zero must not produce a public command specification");

        assert_eq!(error, PlanError::InvalidMsLevelFilter);
    }

    #[test]
    fn unfiltered_tic_plan_has_no_filter_argument() {
        let capabilities = msaccess(MSACCESS_HELP);
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.mzML");
        let output_directory = test_directory.path().join("preview");
        fs::write(&input, b"source mzML").expect("write source mzML");
        fs::create_dir(&output_directory).expect("create fresh preview directory");
        let command = build_msaccess_command_with_capabilities(
            &capabilities,
            &input,
            &output_directory,
            PreviewOperation::Tic { ms_level: None },
        )
        .expect("complete TIC grammar permits unfiltered planning");

        assert!(!command.contains_argument("--filter"));
        assert!(
            command
                .args()
                .iter()
                .all(|argument| !argument.to_string_lossy().contains("msLevel"))
        );
    }

    #[test]
    fn valid_ms_level_filter_bounds_build_exact_arguments() {
        let capabilities = msaccess(MSACCESS_HELP);
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.mzML");
        let output_directory = test_directory.path().join("preview");
        fs::write(&input, b"source mzML").expect("write source mzML");
        fs::create_dir(&output_directory).expect("create fresh preview directory");

        for ms_level in [1, u8::MAX] {
            let command = build_msaccess_command_with_capabilities(
                &capabilities,
                &input,
                &output_directory,
                PreviewOperation::Tic {
                    ms_level: Some(ms_level),
                },
            )
            .expect("valid filtered TIC bounds have exact grammar evidence");

            assert_eq!(command.args()[5], "--filter");
            assert_eq!(
                command.args()[6].to_string_lossy(),
                format!("msLevel {ms_level}")
            );
        }
    }

    #[test]
    fn every_public_preview_operation_rejects_a_nonfresh_output_directory() {
        let capabilities = msaccess(MSACCESS_HELP);
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.mzML");
        let output_directory = test_directory.path().join("preview");
        fs::write(&input, b"source mzML").expect("write source mzML");
        fs::create_dir(&output_directory).expect("create preview directory");
        fs::write(output_directory.join("previous-output.txt"), b"existing")
            .expect("write existing preview output");

        for operation in [
            PreviewOperation::Metadata,
            PreviewOperation::RunSummary,
            PreviewOperation::SpectrumTable,
            PreviewOperation::Tic { ms_level: None },
            PreviewOperation::Tic { ms_level: Some(1) },
            PreviewOperation::SpectrumByIndex {
                index: 7,
                precision: 8,
            },
        ] {
            let error = build_msaccess_command_with_capabilities(
                &capabilities,
                &input,
                &output_directory,
                operation,
            )
            .expect_err("a nonfresh preview directory must not produce a command specification");

            assert_eq!(error, PlanError::OutputDirectoryNotEmpty);
        }
    }

    #[test]
    fn every_public_preview_operation_records_a_fresh_canonical_output_guard() {
        let capabilities = msaccess(MSACCESS_HELP);
        let test_directory = TestDirectory::new();
        let source_directory = test_directory.path().join("source");
        fs::create_dir(&source_directory).expect("create source directory");
        let source = source_directory.join("sample.mzML");
        let input = source_directory
            .join("..")
            .join("source")
            .join("sample.mzML");
        let output_directory = test_directory.path().join("preview");
        fs::write(&source, b"source mzML").expect("write source mzML");
        fs::create_dir(&output_directory).expect("create preview directory");
        let canonical_input = fs::canonicalize(&input).expect("canonical preview input");
        let canonical_output = fs::canonicalize(&output_directory).expect("canonical output root");

        for operation in [
            PreviewOperation::Metadata,
            PreviewOperation::RunSummary,
            PreviewOperation::SpectrumTable,
            PreviewOperation::Tic { ms_level: None },
            PreviewOperation::Tic { ms_level: Some(1) },
            PreviewOperation::SpectrumByIndex {
                index: 7,
                precision: 8,
            },
        ] {
            let command = build_msaccess_command_with_capabilities(
                &capabilities,
                &input,
                &output_directory,
                operation,
            )
            .expect("a fresh output root permits preview planning");

            assert_eq!(command.args()[0], canonical_input.as_os_str());
            assert_ne!(command.args()[0], input.as_os_str());
            assert_eq!(command.args()[1], "--outdir");
            assert_eq!(command.args()[2], canonical_output.as_os_str());
            assert_eq!(command.working_directory(), canonical_output);
            assert_eq!(
                command.fresh_output_directory(),
                Some(canonical_output.as_path())
            );
            assert_eq!(command.output_destination(), None);
            assert_eq!(command.source_directory_boundary(), None);
        }
    }

    #[test]
    fn preview_validation_precedence_remains_fail_closed() {
        let capabilities = msaccess(MSACCESS_HELP);

        let invalid_precision_tree = TestDirectory::new();
        let input = invalid_precision_tree.path().join("sample.mzML");
        let output_directory = invalid_precision_tree.path().join("preview");
        fs::write(&input, b"source mzML").expect("write source mzML");
        fs::create_dir(&output_directory).expect("create preview directory");
        fs::write(output_directory.join("existing.txt"), b"existing")
            .expect("populate preview directory");
        let precision_error = build_msaccess_command_with_capabilities(
            &capabilities,
            &input,
            &output_directory,
            PreviewOperation::SpectrumByIndex {
                index: 0,
                precision: 16,
            },
        )
        .expect_err("invalid precision must precede output inspection");
        assert_eq!(precision_error, PlanError::InvalidSpectrumPrecision);

        let stale_output_tree = TestDirectory::new();
        let missing_input = stale_output_tree.path().join("missing.mzML");
        let stale_output = stale_output_tree.path().join("preview");
        fs::create_dir(&stale_output).expect("create preview directory");
        fs::write(stale_output.join("existing.txt"), b"existing")
            .expect("populate preview directory");
        let freshness_error = build_msaccess_command_with_capabilities(
            &capabilities,
            &missing_input,
            &stale_output,
            PreviewOperation::Metadata,
        )
        .expect_err("nonfresh output must precede input inspection");
        assert_eq!(freshness_error, PlanError::OutputDirectoryNotEmpty);
    }

    #[test]
    fn public_preview_planning_rejects_output_inside_a_directory_input() {
        let capabilities = msaccess(MSACCESS_HELP);

        for nested in [false, true] {
            let test_directory = TestDirectory::new();
            let input = test_directory.path().join("dataset.raw");
            fs::create_dir(&input).expect("create directory input");
            let output_directory = if nested {
                let output = input.join("preview");
                fs::create_dir(&output).expect("create nested preview directory");
                output
            } else {
                input.clone()
            };

            let error = build_msaccess_command_with_capabilities(
                &capabilities,
                &input,
                &output_directory,
                PreviewOperation::Metadata,
            )
            .expect_err("preview output inside a directory input must fail closed");

            assert_eq!(error, PlanError::OutputDirectoryInsideDirectoryInput);
        }
    }

    #[test]
    fn public_preview_planning_accepts_fresh_sibling_output_for_a_directory_input() {
        let capabilities = msaccess(MSACCESS_HELP);
        let test_directory = TestDirectory::new();
        let source_parent = test_directory.path().join("source");
        let source = source_parent.join("dataset.raw");
        let input = source_parent.join("..").join("source").join("dataset.raw");
        let output_directory = test_directory.path().join("preview");
        fs::create_dir_all(&source).expect("create directory input");
        fs::create_dir(&output_directory).expect("create sibling preview directory");
        let canonical_input = fs::canonicalize(&input).expect("canonical directory input");
        let canonical_output = fs::canonicalize(&output_directory).expect("canonical output root");

        let command = build_msaccess_command_with_capabilities(
            &capabilities,
            &input,
            &output_directory,
            PreviewOperation::RunSummary,
        )
        .expect("a fresh sibling preview directory is safe to plan");

        assert_eq!(command.args()[0], canonical_input.as_os_str());
        assert_ne!(command.args()[0], input.as_os_str());
        assert_eq!(command.args()[2], canonical_output.as_os_str());
        assert_eq!(command.working_directory(), canonical_output);
        assert_eq!(
            command.fresh_output_directory(),
            Some(canonical_output.as_path())
        );
        assert_eq!(command.output_destination(), None);
        assert_eq!(
            command.source_directory_boundary(),
            Some(canonical_input.as_path())
        );
    }

    #[test]
    fn public_preview_planning_fails_when_paths_cannot_be_inspected() {
        let capabilities = msaccess(MSACCESS_HELP);

        let missing_output_tree = TestDirectory::new();
        let input = missing_output_tree.path().join("sample.mzML");
        fs::write(&input, b"source mzML").expect("write source mzML");
        let missing_output = missing_output_tree.path().join("missing");
        let output_error = build_msaccess_command_with_capabilities(
            &capabilities,
            &input,
            &missing_output,
            PreviewOperation::Metadata,
        )
        .expect_err("an uninspectable preview directory must fail closed");
        assert_eq!(
            output_error,
            PlanError::OutputDirectoryInspectionFailed {
                kind: std::io::ErrorKind::NotFound,
            }
        );

        let missing_input_tree = TestDirectory::new();
        let missing_input = missing_input_tree.path().join("missing.mzML");
        let output_directory = missing_input_tree.path().join("preview");
        fs::create_dir(&output_directory).expect("create fresh preview directory");
        let input_error = build_msaccess_command_with_capabilities(
            &capabilities,
            &missing_input,
            &output_directory,
            PreviewOperation::Metadata,
        )
        .expect_err("an uninspectable preview input must fail closed");
        assert_eq!(
            input_error,
            PlanError::InputPathInspectionFailed {
                kind: std::io::ErrorKind::NotFound,
            }
        );
    }

    #[test]
    fn filtered_tic_public_builder_requires_exact_installed_grammar() {
        let help = MSACCESS_HELP.replace(
            "msLevel <mslevels>\nThis filter selects only spectra with the indicated <mslevels>, expressed as an int_set.\n",
            "",
        );
        let capabilities = msaccess(&help);
        let error = build_msaccess_command_with_capabilities(
            &capabilities,
            &test_path("sample.mzML"),
            &test_path("preview"),
            PreviewOperation::Tic { ms_level: Some(1) },
        )
        .expect_err("missing exact filter grammar must fail closed");

        assert_eq!(
            error,
            PlanError::InstalledHelpCapability(CapabilityRequirementError::Missing(
                "exact --filter plus `msLevel <mslevels>` grammar and filtered-TIC example"
            ))
        );
    }

    #[test]
    fn sha256_digest_accepts_both_hex_cases_and_displays_canonically() {
        let lowercase = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let digest = lowercase.parse::<Sha256Digest>().expect("valid digest");
        assert_eq!(digest, EMPTY_SHA256);
        assert_eq!(digest.to_string(), lowercase.to_ascii_uppercase());
        assert!("xyz".parse::<Sha256Digest>().is_err());
    }

    fn test_path(relative: &str) -> PathBuf {
        std::env::current_dir()
            .expect("test current directory")
            .join(relative)
    }

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock after Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "mscanvas-capability-tests-{}-{timestamp}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create capability test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
