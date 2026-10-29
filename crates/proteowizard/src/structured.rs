//! The structured conversion intent of ADR 0055 decision 4.
//!
//! A format with only the encoding options its writer reads, an ordered spectrum
//! chain, an ordered chromatogram chain and a typed set of reader and writer
//! switches. [`StructuredIntent::new`] enforces decision 4's rules, so an intent
//! that exists can be lowered, and its lowering is deterministic.
//!
//! **The nine rows stay the verified subset.** [`ConversionIntent::ADMITTED`]
//! is unchanged, and "is this verified?" is one lookup in it: an intent is
//! verified only where it equals a row's structured form and decision 1's other
//! three conditions hold ([`StructuredIntent::tier`]). Every other buildable
//! intent is advanced, labelled "not verified by MSCanvas".
//!
//! Most of decision 4 is structural, so the refused value has no spelling:
//!
//! - an encoding option exists only inside the encoding of a format whose
//!   writer reads it ([`OutputEncoding`]);
//! - numpress replaces a role's precision, which it fixes at 64 bits, and
//!   excludes truncation and prediction on that role;
//! - `--numpressPic` and `--numpressSlof` are two choices for one role;
//! - linear numpress carries exactly one tolerance, relative or absolute;
//! - every numpress tolerance is a [`Positive`].
//!
//! Not representable yet, each for its own later slice: `--contactInfo`
//! (a file, slice 4), `--merge`, `--runIndexSet` and `-g`. Blocked and never
//! representable: `--continueOnError`, `-c/--config` and the envelope switches
//! MSCanvas sets itself.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fmt;
use std::num::{NonZeroU8, NonZeroU64};

use thiserror::Error;

use crate::capability::{CapabilityRequirementError, InstalledHelpCapabilities, OptionArgument};
use crate::chain::{
    ChromatogramStep, FilterRequirement, LoweredFilter, Positive, SpectrumStep,
    StructuredIntentError,
};
use crate::command::OpenFormat;
use crate::conversion_run::ConversionSourceKind;
use crate::intent::{
    AdmittedIntent, CompressionIntent, ConversionIntent, OutputFormat, ProcessingIntent,
};

/// The executable every measured setting is bound to (ADR 0043 contract 3).
const VERIFIED_MSCONVERT_SHA256: &str =
    "9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Precision {
    Bits32,
    Bits64,
}

impl Precision {
    const fn of_bits(bits: u8) -> Self {
        if bits == 64 {
            Self::Bits64
        } else {
            Self::Bits32
        }
    }

    /// Mantissa bits a float of this width stores, the most truncation can drop.
    const fn mantissa_bits(self) -> u8 {
        match self {
            Self::Bits32 => 23,
            Self::Bits64 => 52,
        }
    }
}

/// Linear numpress's one tolerance. The build zeroes the relative tolerance
/// when an absolute one is given, so the two never coexist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinearTolerance {
    /// `--numpressLinear=<t>`.
    Relative(Positive),
    /// `--numpressLinear --numpressLinearAbsTol=<t>`.
    Absolute(Positive),
}

/// The m/z array; linear numpress encodes retention time with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzArray {
    Plain(Precision),
    /// Fixed at 64 bits, so an array stored without numpress keeps every bit.
    NumpressLinear(LinearTolerance),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntensityArray {
    Plain(Precision),
    /// Fixed at 64 bits.
    NumpressPic,
    /// Fixed at 64 bits; the relative tolerance is above 0.
    NumpressSlof(Positive),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Truncation {
    Off,
    /// `-1`: integers only.
    IntegersOnly,
    DropMantissaBits(NonZeroU8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prediction {
    None,
    Delta,
    Linear,
}

/// An mzMLb array without numpress: the only writer that reads truncation and
/// prediction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MzMlbPlainArray {
    pub precision: Precision,
    pub truncation: Truncation,
    pub prediction: Prediction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzMlbMzArray {
    Plain(MzMlbPlainArray),
    NumpressLinear(LinearTolerance),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MzMlbIntensityArray {
    Plain(MzMlbPlainArray),
    NumpressPic,
    NumpressSlof(Positive),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MzMlEncoding {
    pub mz: MzArray,
    pub intensity: IntensityArray,
    pub zlib: bool,
    /// `false` emits `--noindex`.
    pub index: bool,
}

/// mzXML's `<peaks>` hold pairs at one global precision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MzXmlEncoding {
    pub precision: Precision,
    pub zlib: bool,
    pub index: bool,
}

/// No `index`: the mzMLb writer writes its index whatever `--noindex` says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MzMlbEncoding {
    pub mz: MzMlbMzArray,
    pub intensity: MzMlbIntensityArray,
    pub zlib: bool,
    /// `None` leaves the build's default.
    pub chunk_size: Option<NonZeroU64>,
    /// 0-9; 0 only with zlib off. `None` leaves the build's default.
    pub compression_level: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mz5Encoding {
    pub mz: Precision,
    pub intensity: Precision,
    pub zlib: bool,
}

/// A format and the encoding options its writer reads (ADR 0055 decision 4's
/// table). The text formats read none, so they carry none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputEncoding {
    MzMl(MzMlEncoding),
    MzXml(MzXmlEncoding),
    MzMlb(MzMlbEncoding),
    Mz5(Mz5Encoding),
    Mgf,
    Text,
    Ms1,
    Cms1,
    Ms2,
    Cms2,
}

impl OutputEncoding {
    const fn flag(&self) -> &'static str {
        match self {
            Self::MzMl(_) => "mzML",
            Self::MzXml(_) => "mzXML",
            Self::MzMlb(_) => "mzMLb",
            Self::Mz5(_) => "mz5",
            Self::Mgf => "mgf",
            Self::Text => "text",
            Self::Ms1 => "ms1",
            Self::Cms1 => "cms1",
            Self::Ms2 => "ms2",
            Self::Cms2 => "cms2",
        }
    }
}

/// A reader or writer switch. Lowered in this declaration order, whatever
/// order a caller added them in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Switch {
    SimAsSpectra,
    SrmAsSpectra,
    CombineIonMobilitySpectra,
    DdaProcessing,
    IgnoreCalibrationScans,
    AcceptZeroLengthSpectra,
    IgnoreMissingZeroSamples,
    IgnoreUnknownInstrumentError,
    SingleThreaded,
    StripLocationFromSourceFiles,
    StripVersionFromSoftware,
}

impl Switch {
    const fn name(self) -> &'static str {
        match self {
            Self::SimAsSpectra => "simAsSpectra",
            Self::SrmAsSpectra => "srmAsSpectra",
            Self::CombineIonMobilitySpectra => "combineIonMobilitySpectra",
            Self::DdaProcessing => "ddaProcessing",
            Self::IgnoreCalibrationScans => "ignoreCalibrationScans",
            Self::AcceptZeroLengthSpectra => "acceptZeroLengthSpectra",
            Self::IgnoreMissingZeroSamples => "ignoreMissingZeroSamples",
            Self::IgnoreUnknownInstrumentError => "ignoreUnknownInstrumentError",
            Self::SingleThreaded => "singleThreaded",
            Self::StripLocationFromSourceFiles => "stripLocationFromSourceFiles",
            Self::StripVersionFromSoftware => "stripVersionFromSoftware",
        }
    }

    /// Writer switches go to the run that writes the requested format; reader
    /// switches to the run that reads the source (decision 6).
    #[must_use]
    pub const fn is_writer_switch(self) -> bool {
        matches!(
            self,
            Self::StripLocationFromSourceFiles | Self::StripVersionFromSoftware
        )
    }

    const fn argument(self) -> OptionArgument {
        match self {
            // `[=arg(=1)]`: the bare switch takes its implicit value, 1.
            Self::SingleThreaded => OptionArgument::Optional,
            _ => OptionArgument::None,
        }
    }
}

/// What the installed help must declare for an intent's argv.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderRequirement {
    /// A `--name` option and the argument kind the lowering relies on.
    Option {
        name: &'static str,
        argument: OptionArgument,
    },
    SpectrumFilter(FilterRequirement),
    ChromatogramFilter(FilterRequirement),
}

/// The argv between the source path and `--outdir`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Lowering {
    /// mzML: one provider run.
    Direct(Vec<OsString>),
    /// Every other format (decision 6). Run 1 writes a private mzML
    /// intermediate at 64/64 with zlib and an index, carrying both chains and
    /// the reader switches. Run 2 converts it, carrying the format flag, that
    /// format's encoding and the writer switches, and no filter.
    ViaIntermediate {
        intermediate: Vec<OsString>,
        output: Vec<OsString>,
    },
}

/// Decision 1's verified tier, or the advanced one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Verified(ConversionIntent),
    Advanced,
}

/// Decision 7's refusals that depend on the source, which an intent does not
/// know until it meets one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum SourceBlock {
    #[error("the vendor picker on an mzML source was measured running another picker")]
    VendorPickerOnMzmlSource,
    #[error("bare peakPicking on Thermo RAW runs the vendor picker, which the check refuses")]
    DefaultPickerOnThermoRaw,
}

impl SourceBlock {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::VendorPickerOnMzmlSource => "vendor_picker_on_mzml_source",
            Self::DefaultPickerOnThermoRaw => "default_picker_on_thermo_raw",
        }
    }
}

/// One conversion's complete product semantics, beyond the nine rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StructuredIntent {
    output: OutputEncoding,
    spectrum_chain: Vec<SpectrumStep>,
    chromatogram_chain: Vec<ChromatogramStep>,
    switches: BTreeSet<Switch>,
}

impl StructuredIntent {
    /// Builds an intent, or refuses it under decision 4.
    pub fn new(
        output: OutputEncoding,
        spectrum_chain: Vec<SpectrumStep>,
        chromatogram_chain: Vec<ChromatogramStep>,
        switches: impl IntoIterator<Item = Switch>,
    ) -> Result<Self, StructuredIntentError> {
        validate_output(&output)?;
        for (position, step) in spectrum_chain.iter().enumerate() {
            step.validate()?;
            if position > 0 && matches!(step, SpectrumStep::PeakPickingVendor { .. }) {
                return Err(StructuredIntentError::VendorPickerNotFirst);
            }
        }
        for step in &chromatogram_chain {
            step.validate()?;
        }
        Ok(Self {
            output,
            spectrum_chain,
            chromatogram_chain,
            switches: switches.into_iter().collect(),
        })
    }

    #[must_use]
    pub const fn output(&self) -> &OutputEncoding {
        &self.output
    }

    #[must_use]
    pub fn spectrum_chain(&self) -> &[SpectrumStep] {
        &self.spectrum_chain
    }

    #[must_use]
    pub fn chromatogram_chain(&self) -> &[ChromatogramStep] {
        &self.chromatogram_chain
    }

    pub fn switches(&self) -> impl Iterator<Item = Switch> + '_ {
        self.switches.iter().copied()
    }

    /// The verified row this intent is, if any: one lookup in
    /// [`ConversionIntent::ADMITTED`], by structural equality.
    #[must_use]
    pub fn verified_row(&self) -> Option<ConversionIntent> {
        ConversionIntent::ADMITTED
            .iter()
            .map(AdmittedIntent::intent)
            .find(|row| Self::from(*row) == *self)
    }

    /// Decision 7's source-dependent refusals, then decision 1's tier.
    ///
    /// Verified needs all four: the intent is a row, the installed build can
    /// express that row, the executable is the verified build, and the row's
    /// evidence covers this source. Anything else is advanced.
    pub fn tier(
        &self,
        source: ConversionSourceKind,
        capabilities: &InstalledHelpCapabilities,
    ) -> Result<Tier, SourceBlock> {
        for step in &self.spectrum_chain {
            match (step, source) {
                (SpectrumStep::PeakPickingVendor { .. }, ConversionSourceKind::MzmlFile) => {
                    return Err(SourceBlock::VendorPickerOnMzmlSource);
                }
                (SpectrumStep::PeakPickingDefault, ConversionSourceKind::ThermoRawFile) => {
                    return Err(SourceBlock::DefaultPickerOnThermoRaw);
                }
                _ => {}
            }
        }
        let verified_build = capabilities
            .executable_sha256()
            .to_string()
            .eq_ignore_ascii_case(VERIFIED_MSCONVERT_SHA256);
        Ok(self
            .verified_row()
            .filter(|row| {
                verified_build
                    && row.evidence_covers_source(source)
                    && capabilities.require_conversion_intent(row).is_ok()
            })
            .map_or(Tier::Advanced, Tier::Verified))
    }

    /// The argv this intent lowers to, between the source and `--outdir`.
    ///
    /// Format first and, where the format takes it, compression second; then
    /// precision and the other encoding options, the switches, the spectrum
    /// chain in order and the chromatogram chain in order. A verified row's
    /// structured form lowers to exactly the row's own argv.
    #[must_use]
    pub fn lowering(&self) -> Lowering {
        let runs = self.runs();
        match <[Argv; 2]>::try_from(runs) {
            Ok([intermediate, output]) => Lowering::ViaIntermediate {
                intermediate: intermediate.os_tokens(),
                output: output.os_tokens(),
            },
            Err(mut runs) => Lowering::Direct(runs.remove(0).os_tokens()),
        }
    }

    /// Everything the lowering's runs need the help to declare, each once, in
    /// first-use order.
    #[must_use]
    pub fn provider_requirements(&self) -> Vec<ProviderRequirement> {
        let mut all: Vec<ProviderRequirement> = Vec::new();
        for requirement in self.runs().into_iter().flat_map(|run| run.requirements) {
            if !all.contains(&requirement) {
                all.push(requirement);
            }
        }
        all
    }

    /// Whether the installed help lists every option and filter the lowering
    /// emits. Evidence of spelling only (M6.2's rule).
    ///
    /// By name, because the probe cannot yet read a full filter grammar: it
    /// reads a declaration's first line only, drops one whose signature holds a
    /// `.`, and skips the chromatogram section. ponytail: until it reads that
    /// section, no chromatogram step is confirmed, so every intent with one is
    /// refused here; read the section in the probe to lift it.
    pub fn confirm_provider_requirements(
        &self,
        capabilities: &InstalledHelpCapabilities,
    ) -> Result<(), CapabilityRequirementError> {
        // Every route writes mzML first (decision 6), so this is always needed.
        capabilities.require_conversion(OpenFormat::MzMl)?;
        for requirement in self.provider_requirements() {
            let (confirmed, name) = match requirement {
                ProviderRequirement::Option { name, argument } => (
                    capabilities
                        .option(name)
                        .is_some_and(|option| option.argument() == argument),
                    name,
                ),
                ProviderRequirement::SpectrumFilter(filter) => (
                    capabilities.spectrum_filter(filter.name).is_some(),
                    filter.name,
                ),
                ProviderRequirement::ChromatogramFilter(filter) => (false, filter.name),
            };
            if !confirmed {
                return Err(CapabilityRequirementError::Missing(name));
            }
        }
        Ok(())
    }

    /// One `Argv` per provider run.
    fn runs(&self) -> Vec<Argv> {
        let mut processing = Argv::default();
        for switch in self.switches().filter(|switch| !switch.is_writer_switch()) {
            processing.switch(switch);
        }
        let mut writing = Argv::default();
        for switch in self.switches().filter(|switch| switch.is_writer_switch()) {
            writing.switch(switch);
        }
        let mut filters = Argv::default();
        for step in &self.spectrum_chain {
            filters.filter("filter", step.lower(), ProviderRequirement::SpectrumFilter);
        }
        for step in &self.chromatogram_chain {
            filters.filter(
                "chromatogramFilter",
                step.lower(),
                ProviderRequirement::ChromatogramFilter,
            );
        }

        let mut output = Argv::default();
        output.flag(self.output.flag());
        encode(&mut output, &self.output);
        if let OutputEncoding::MzMl(_) = self.output {
            output.extend(processing);
            output.extend(writing);
            output.extend(filters);
            return vec![output];
        }
        let mut intermediate = Argv::default();
        intermediate.flag("mzML");
        intermediate.zlib(true);
        intermediate.flag("64");
        intermediate.extend(processing);
        intermediate.extend(filters);
        output.extend(writing);
        vec![intermediate, output]
    }
}

fn validate_output(output: &OutputEncoding) -> Result<(), StructuredIntentError> {
    let OutputEncoding::MzMlb(encoding) = output else {
        return Ok(());
    };
    match encoding.compression_level {
        Some(level) if level > 9 => return Err(StructuredIntentError::CompressionLevelOutOfRange),
        Some(0) if encoding.zlib => {
            return Err(StructuredIntentError::CompressionLevelZeroWithZlib);
        }
        _ => {}
    }
    let plain = [
        match encoding.mz {
            MzMlbMzArray::Plain(array) => Some(array),
            MzMlbMzArray::NumpressLinear(_) => None,
        },
        match encoding.intensity {
            MzMlbIntensityArray::Plain(array) => Some(array),
            MzMlbIntensityArray::NumpressPic | MzMlbIntensityArray::NumpressSlof(_) => None,
        },
    ];
    for array in plain.into_iter().flatten() {
        if let Truncation::DropMantissaBits(bits) = array.truncation
            && bits.get() > array.precision.mantissa_bits()
        {
            return Err(StructuredIntentError::TruncationExceedsMantissa);
        }
    }
    Ok(())
}

/// The encoding options of one format, in the order the rows established:
/// compression, then precision, then everything else.
fn encode(argv: &mut Argv, output: &OutputEncoding) {
    match *output {
        OutputEncoding::MzMl(encoding) => {
            argv.zlib(encoding.zlib);
            let (mz, linear) = mz_role(encoding.mz);
            let (intensity, intensity_numpress) = intensity_role(encoding.intensity);
            argv.precision(mz, intensity, linear.is_some());
            numpress(argv, linear, intensity_numpress);
            if !encoding.index {
                argv.flag("noindex");
            }
        }
        OutputEncoding::MzXml(encoding) => {
            argv.zlib(encoding.zlib);
            argv.flag(match encoding.precision {
                Precision::Bits32 => "32",
                Precision::Bits64 => "64",
            });
            if !encoding.index {
                argv.flag("noindex");
            }
        }
        OutputEncoding::MzMlb(encoding) => {
            argv.zlib(encoding.zlib);
            let (mz_plain, mz, linear) = match encoding.mz {
                MzMlbMzArray::Plain(array) => (Some(array), array.precision, None),
                MzMlbMzArray::NumpressLinear(tolerance) => {
                    (None, Precision::Bits64, Some(tolerance))
                }
            };
            let (intensity_plain, intensity, intensity_numpress) = match encoding.intensity {
                MzMlbIntensityArray::Plain(array) => (Some(array), array.precision, None),
                MzMlbIntensityArray::NumpressPic => {
                    (None, Precision::Bits64, Some(IntensityNumpress::Pic))
                }
                MzMlbIntensityArray::NumpressSlof(tolerance) => (
                    None,
                    Precision::Bits64,
                    Some(IntensityNumpress::Slof(tolerance)),
                ),
            };
            argv.precision(mz, intensity, linear.is_some());
            numpress(argv, linear, intensity_numpress);
            let roles = [
                (mz_plain, ["mzTruncation", "mzDelta", "mzLinear"]),
                (
                    intensity_plain,
                    ["intenTruncation", "intenDelta", "intenLinear"],
                ),
            ];
            for (array, [truncation, delta, linear]) in roles {
                let Some(array) = array else { continue };
                match array.truncation {
                    Truncation::Off => {}
                    Truncation::IntegersOnly => {
                        argv.valued(truncation, -1, OptionArgument::Required);
                    }
                    Truncation::DropMantissaBits(bits) => {
                        argv.valued(truncation, bits, OptionArgument::Required);
                    }
                }
                match array.prediction {
                    Prediction::None => {}
                    Prediction::Delta => argv.flag(delta),
                    Prediction::Linear => argv.flag(linear),
                }
            }
            if let Some(size) = encoding.chunk_size {
                argv.valued("mzMLbChunkSize", size, OptionArgument::Required);
            }
            if let Some(level) = encoding.compression_level {
                argv.valued("mzMLbCompressionLevel", level, OptionArgument::Required);
            }
        }
        OutputEncoding::Mz5(encoding) => {
            argv.zlib(encoding.zlib);
            argv.precision(encoding.mz, encoding.intensity, false);
        }
        OutputEncoding::Mgf
        | OutputEncoding::Text
        | OutputEncoding::Ms1
        | OutputEncoding::Cms1
        | OutputEncoding::Ms2
        | OutputEncoding::Cms2 => {}
    }
}

#[derive(Clone, Copy)]
enum IntensityNumpress {
    Pic,
    Slof(Positive),
}

const fn mz_role(array: MzArray) -> (Precision, Option<LinearTolerance>) {
    match array {
        MzArray::Plain(precision) => (precision, None),
        MzArray::NumpressLinear(tolerance) => (Precision::Bits64, Some(tolerance)),
    }
}

const fn intensity_role(array: IntensityArray) -> (Precision, Option<IntensityNumpress>) {
    match array {
        IntensityArray::Plain(precision) => (precision, None),
        IntensityArray::NumpressPic => (Precision::Bits64, Some(IntensityNumpress::Pic)),
        IntensityArray::NumpressSlof(tolerance) => {
            (Precision::Bits64, Some(IntensityNumpress::Slof(tolerance)))
        }
    }
}

fn numpress(
    argv: &mut Argv,
    linear: Option<LinearTolerance>,
    intensity: Option<IntensityNumpress>,
) {
    match linear {
        None => {}
        Some(LinearTolerance::Relative(tolerance)) => {
            argv.valued("numpressLinear", tolerance, OptionArgument::Optional);
        }
        Some(LinearTolerance::Absolute(tolerance)) => {
            argv.option("numpressLinear", OptionArgument::Optional);
            argv.valued("numpressLinearAbsTol", tolerance, OptionArgument::Optional);
        }
    }
    match intensity {
        None => {}
        Some(IntensityNumpress::Pic) => argv.flag("numpressPic"),
        Some(IntensityNumpress::Slof(tolerance)) => {
            argv.valued("numpressSlof", tolerance, OptionArgument::Optional);
        }
    }
}

/// The nine rows' structured forms. Every row is trivially valid, which a test
/// asserts by rebuilding each through [`StructuredIntent::new`].
impl From<ConversionIntent> for StructuredIntent {
    fn from(row: ConversionIntent) -> Self {
        let OutputFormat::MzMl = row.format();
        let precision = row.precision();
        let mut spectrum_chain = Vec::new();
        match row.processing() {
            ProcessingIntent::NoAdditionalCentroiding => {}
            ProcessingIntent::UnscopedDefaultCentroiding => {
                spectrum_chain.push(SpectrumStep::PeakPickingDefault);
            }
        }
        if let Some(level) = row.population().retained_ms_level() {
            spectrum_chain.push(SpectrumStep::MsLevel(crate::chain::IntSet::single(level)));
        }
        Self {
            output: OutputEncoding::MzMl(MzMlEncoding {
                mz: MzArray::Plain(Precision::of_bits(precision.mz_bits())),
                intensity: IntensityArray::Plain(Precision::of_bits(precision.intensity_bits())),
                zlib: match row.compression() {
                    CompressionIntent::Zlib => true,
                    CompressionIntent::NoCompression => false,
                },
                index: true,
            }),
            spectrum_chain,
            chromatogram_chain: Vec::new(),
            switches: BTreeSet::new(),
        }
    }
}

/// Tokens and the requirement each one carries, built together so an argument
/// cannot reach argv without its requirement beside it.
#[derive(Default)]
struct Argv {
    tokens: Vec<String>,
    requirements: Vec<ProviderRequirement>,
}

impl Argv {
    fn option(&mut self, name: &'static str, argument: OptionArgument) {
        self.tokens.push(format!("--{name}"));
        self.requirements
            .push(ProviderRequirement::Option { name, argument });
    }

    fn flag(&mut self, name: &'static str) {
        self.option(name, OptionArgument::None);
    }

    /// One `--name=value` token. A separate value token after an option whose
    /// argument is optional would be read as a second input file.
    fn valued(&mut self, name: &'static str, value: impl fmt::Display, argument: OptionArgument) {
        self.tokens.push(format!("--{name}={value}"));
        self.requirements
            .push(ProviderRequirement::Option { name, argument });
    }

    fn zlib(&mut self, on: bool) {
        self.tokens
            .push(if on { "--zlib" } else { "--zlib=off" }.to_owned());
        self.requirements.push(ProviderRequirement::Option {
            name: "zlib",
            argument: OptionArgument::Optional,
        });
    }

    fn switch(&mut self, switch: Switch) {
        self.option(switch.name(), switch.argument());
    }

    /// The rows' precision spelling: 64/32 is silence, as D1 measured, and
    /// both-equal is the global switch. With linear numpress the global switch
    /// is never emitted, so retention time keeps its 64-bit default; m/z is
    /// then 64 and only intensity is spelled, per array.
    fn precision(&mut self, mz: Precision, intensity: Precision, linear_numpress: bool) {
        use Precision::{Bits32, Bits64};
        let flags: &[&'static str] = match (linear_numpress, mz, intensity) {
            (true, _, Bits32) | (false, Bits64, Bits32) => &[],
            (true, _, Bits64) => &["inten64"],
            (false, Bits64, Bits64) => &["64"],
            (false, Bits32, Bits32) => &["32"],
            (false, Bits32, Bits64) => &["mz32", "inten64"],
        };
        for flag in flags {
            self.flag(flag);
        }
    }

    fn filter(
        &mut self,
        option: &'static str,
        step: LoweredFilter,
        requirement: fn(FilterRequirement) -> ProviderRequirement,
    ) {
        self.tokens.push(format!("--{option}"));
        self.tokens.push(step.argument);
        self.requirements.push(ProviderRequirement::Option {
            name: option,
            argument: OptionArgument::Required,
        });
        self.requirements.push(requirement(step.requirement));
    }

    fn extend(&mut self, other: Self) {
        self.tokens.extend(other.tokens);
        self.requirements.extend(other.requirements);
    }

    fn os_tokens(self) -> Vec<OsString> {
        self.tokens.into_iter().map(OsString::from).collect()
    }
}

#[cfg(test)]
mod tests;
