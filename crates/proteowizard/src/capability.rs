use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::str::FromStr;

use thiserror::Error;

use crate::command::{BackendTool, OpenFormat, PreviewOperation};
use crate::sha256::{Sha256Error, digest_bytes, digest_file};

/// A SHA-256 digest supplied by the component that captured the complete raw
/// help stream.
///
/// The adapter deliberately does not implement SHA-256 itself. The evidence
/// runner must calculate each digest with an approved implementation and pass
/// it alongside the bytes. Keeping the digest in the parsed model prevents a
/// later sanitized capability summary from losing its link to the raw capture.
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledHelpCapabilities {
    tool: BackendTool,
    raw_help_hashes: RawHelpHashes,
    options: BTreeMap<String, OptionDeclaration>,
    analysis_queries: BTreeMap<String, NamedGrammarDeclaration>,
    spectrum_filters: BTreeMap<String, NamedGrammarDeclaration>,
    examples: Vec<HelpExample>,
}

impl InstalledHelpCapabilities {
    pub fn parse(
        tool: BackendTool,
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
        parser.finish(RawHelpHashes {
            stdout: capture.stdout.sha256,
            stderr: capture.stderr.sha256,
        })
    }

    #[must_use]
    pub const fn tool(&self) -> BackendTool {
        self.tool
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
        self.require_flag_option("zlib")?;
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

    fn require_flag_option(&self, name: &'static str) -> Result<(), CapabilityRequirementError> {
        if self.option(name).is_some_and(|option| {
            matches!(
                option.argument,
                OptionArgument::None | OptionArgument::Optional
            )
        }) {
            Ok(())
        } else {
            Err(CapabilityRequirementError::Missing(name))
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
    if capture.truncated {
        return Err(HelpCapabilityError::Truncated(stream));
    }
    let captured_bytes = u64::try_from(capture.bytes.len()).unwrap_or(u64::MAX);
    if capture.total_bytes != captured_bytes {
        return Err(HelpCapabilityError::LengthMismatch {
            stream,
            captured_bytes,
            total_bytes: capture.total_bytes,
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
    ) -> Result<InstalledHelpCapabilities, HelpCapabilityError> {
        if !self.saw_usage {
            return Err(HelpCapabilityError::MissingUsage(self.tool));
        }
        if !self.saw_options {
            return Err(HelpCapabilityError::MissingOptionsSection);
        }
        Ok(InstalledHelpCapabilities {
            tool: self.tool,
            raw_help_hashes,
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

  tic [mz=<mzLow>[,<mzHigh>]] [delimiter=<fixed|space|comma|tab>]
    (write total ion counts for an m/z range)

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

    fn msaccess(text: &str) -> InstalledHelpCapabilities {
        InstalledHelpCapabilities::parse(BackendTool::MsAccess, capture(text))
            .expect("valid msaccess fixture")
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
        let error = InstalledHelpCapabilities::parse(BackendTool::MsAccess, capture(&help))
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
            InstalledHelpCapabilities::parse(BackendTool::MsAccess, truncated),
            Err(HelpCapabilityError::Truncated(HelpStream::Stdout))
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
            InstalledHelpCapabilities::parse(BackendTool::MsAccess, mismatch),
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
            InstalledHelpCapabilities::parse(BackendTool::MsAccess, capture(&help)),
            Err(HelpCapabilityError::WrongUsage { .. })
        ));
    }

    #[test]
    fn complete_msconvert_declarations_recognize_both_conversion_grammars() {
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
                .expect("valid msconvert fixture");

        assert_eq!(
            capabilities.option("zlib").map(OptionDeclaration::argument),
            Some(OptionArgument::Optional)
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
                .expect("valid msconvert fixture");
        capabilities
            .require_conversion(OpenFormat::MzXml)
            .expect("installed help recognizes the mzXML grammar");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            test_path("msconvert.exe"),
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
                .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.raw");
        let output_directory = test_directory.path().join("converted");
        fs::write(&input, b"source RAW").expect("write source RAW");
        fs::create_dir(&output_directory).expect("create fresh output directory");
        let canonical_output = fs::canonicalize(&output_directory).expect("canonical output root");
        let command = build_msconvert_command_with_capabilities(
            &capabilities,
            test_path("msconvert.exe"),
            &input,
            &output_directory,
            OsStr::new("样本 01.mzML"),
            OpenFormat::MzMl,
        )
        .expect("complete installed grammar permits mzML planning");

        assert_eq!(command.args()[0], input.as_os_str());
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
    }

    #[test]
    fn public_mzml_planning_rejects_an_existing_default_output() {
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
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
            test_path("msconvert.exe"),
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
                .expect("valid msconvert fixture");
        let output_directory = TestDirectory::new();
        let input = output_directory.path().join("sample.mzML");
        fs::write(&input, b"source mzML").expect("write source mzML");
        let canonical_output =
            fs::canonicalize(output_directory.path()).expect("canonical output root");

        let command = build_msconvert_command_with_capabilities(
            &capabilities,
            test_path("msconvert.exe"),
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
            test_path("msconvert.exe"),
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
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
            test_path("msconvert.exe"),
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
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
            test_path("msconvert.exe"),
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
            test_path("msconvert.exe"),
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
                .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.raw");
        let output_directory = test_directory.path().join("converted");
        fs::write(&input, b"source RAW").expect("write source RAW");
        fs::create_dir_all(output_directory.join("sample.mzML"))
            .expect("create conflicting destination directory");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            test_path("msconvert.exe"),
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
                .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("sample.raw");
        let missing_output = test_directory.path().join("missing");
        fs::write(&input, b"source RAW").expect("write source RAW");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            test_path("msconvert.exe"),
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
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
                test_path("msconvert.exe"),
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
                .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let input = test_directory.path().join("dataset.raw");
        let output_directory = test_directory.path().join("converted");
        fs::create_dir(&input).expect("create directory input");
        fs::create_dir(&output_directory).expect("create sibling output directory");
        let canonical_output = fs::canonicalize(&output_directory).expect("canonical output root");

        let command = build_msconvert_command_with_capabilities(
            &capabilities,
            test_path("msconvert.exe"),
            &input,
            &output_directory,
            OsStr::new("dataset.mzML"),
            OpenFormat::MzMl,
        )
        .expect("a fresh sibling output directory is safe to plan");

        assert_eq!(command.args()[0], input.as_os_str());
        assert_eq!(command.args()[4], canonical_output.as_os_str());
    }

    #[test]
    fn public_mzml_planning_fails_when_the_input_cannot_be_inspected() {
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
                .expect("valid msconvert fixture");
        let test_directory = TestDirectory::new();
        let missing_input = test_directory.path().join("missing.raw");
        let output_directory = test_directory.path().join("converted");
        fs::create_dir(&output_directory).expect("create fresh output directory");

        let error = build_msconvert_command_with_capabilities(
            &capabilities,
            test_path("msconvert.exe"),
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
        let capabilities =
            InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(MSCONVERT_HELP))
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
                test_path("msconvert.exe"),
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
                test_path("msconvert.exe"),
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
            let capabilities =
                InstalledHelpCapabilities::parse(BackendTool::MsConvert, capture(&help))
                    .expect("syntactically valid incomplete msconvert fixture");
            let error = build_msconvert_command_with_capabilities(
                &capabilities,
                test_path("msconvert.exe"),
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
    fn zero_ms_level_filter_is_rejected_before_public_command_planning() {
        let capabilities = msaccess(MSACCESS_HELP);
        let error = build_msaccess_command_with_capabilities(
            &capabilities,
            test_path("msaccess.exe"),
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
            test_path("msaccess.exe"),
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
                test_path("msaccess.exe"),
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
                test_path("msaccess.exe"),
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
        let input = test_directory.path().join("sample.mzML");
        let output_directory = test_directory.path().join("preview");
        fs::write(&input, b"source mzML").expect("write source mzML");
        fs::create_dir(&output_directory).expect("create preview directory");
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
                test_path("msaccess.exe"),
                &input,
                &output_directory,
                operation,
            )
            .expect("a fresh output root permits preview planning");

            assert_eq!(command.args()[1], "--outdir");
            assert_eq!(command.args()[2], canonical_output.as_os_str());
            assert_eq!(command.working_directory(), canonical_output);
            assert_eq!(
                command.fresh_output_directory(),
                Some(canonical_output.as_path())
            );
            assert_eq!(command.output_destination(), None);
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
            test_path("msaccess.exe"),
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
            test_path("msaccess.exe"),
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
                test_path("msaccess.exe"),
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
        let input = test_directory.path().join("dataset.raw");
        let output_directory = test_directory.path().join("preview");
        fs::create_dir(&input).expect("create directory input");
        fs::create_dir(&output_directory).expect("create sibling preview directory");
        let canonical_output = fs::canonicalize(&output_directory).expect("canonical output root");

        let command = build_msaccess_command_with_capabilities(
            &capabilities,
            test_path("msaccess.exe"),
            &input,
            &output_directory,
            PreviewOperation::RunSummary,
        )
        .expect("a fresh sibling preview directory is safe to plan");

        assert_eq!(command.args()[0], input.as_os_str());
        assert_eq!(command.args()[2], canonical_output.as_os_str());
        assert_eq!(command.working_directory(), canonical_output);
        assert_eq!(
            command.fresh_output_directory(),
            Some(canonical_output.as_path())
        );
        assert_eq!(command.output_destination(), None);
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
            test_path("msaccess.exe"),
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
            test_path("msaccess.exe"),
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
            test_path("msaccess.exe"),
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
