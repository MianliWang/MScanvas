//! Which conversion semantics may be chosen, projected from the one authority
//! that decides.
//!
//! **The interface does not hold a compatibility matrix, and this module is
//! why.** A free cross-product of the five dimensions
//! [`ConversionIntent`] names would allow forty-eight combinations; M6.2
//! measured nine, and [`ConversionIntent::ADMITTED`] is the table that says
//! which. Everything selectable is a projection of that table taken here, so
//! the answer to "does this combination exist?" is a lookup in Rust's own list
//! rather than a rule written a second time in TypeScript.
//!
//! Two questions are answered, and they are deliberately different:
//!
//! - **Is the combination admitted at all?** Answered by membership in
//!   [`ConversionIntent::ADMITTED`]. A combination that is not there is not in
//!   the catalog, and its absence *is* the answer.
//! - **Can the executable installed right now express it?** Answered by
//!   [`InstalledHelpCapabilities::require_conversion_intent`], which is the same
//!   gate the command builder applies before it emits argv. An admitted
//!   combination a build cannot run is present and marked
//!   [`ConversionIntentAvailabilityDto::UnsupportedByInstallation`].
//!
//! Collapsing the two would tell a user their combination has not been
//! qualified when the truth is that their ProteoWizard is too old, or the
//! reverse, and each of those calls for a different action.
//!
//! Nothing here re-derives a semantic. Every projection below is a total match
//! over a crate type, so a dimension value added to the crate is a compile
//! error here rather than a value that silently never reaches a control.

use mscanvas_proteowizard::{
    CompressionIntent, ConversionIntent, InstalledHelpCapabilities, NumericPrecision, OutputFormat,
    ProcessingIntent, SpectrumPopulation,
};

use super::dto::{
    ConversionCompressionDto, ConversionIntentAvailabilityDto, ConversionIntentDto,
    ConversionIntentOptionDto, ConversionNumericPrecisionDto, ConversionOutputFormatDto,
    ConversionProcessingDto, ConversionSpectrumPopulationDto,
};

/// The wire name for the format an intent asks for.
///
/// A total match rather than a constant, so a second admitted output format
/// could not be added to the crate without this refusing to compile.
pub(super) const fn output_format_dto(format: OutputFormat) -> ConversionOutputFormatDto {
    match format {
        OutputFormat::MzMl => ConversionOutputFormatDto::MzMl,
    }
}

const fn processing_dto(processing: ProcessingIntent) -> ConversionProcessingDto {
    match processing {
        ProcessingIntent::NoAdditionalCentroiding => {
            ConversionProcessingDto::NoAdditionalCentroiding
        }
        ProcessingIntent::UnscopedDefaultCentroiding => {
            ConversionProcessingDto::UnscopedDefaultCentroiding
        }
    }
}

const fn population_dto(population: SpectrumPopulation) -> ConversionSpectrumPopulationDto {
    match population {
        SpectrumPopulation::All => ConversionSpectrumPopulationDto::All,
        SpectrumPopulation::Ms1Only => ConversionSpectrumPopulationDto::Ms1Only,
        SpectrumPopulation::Ms2Only => ConversionSpectrumPopulationDto::Ms2Only,
    }
}

const fn precision_dto(precision: NumericPrecision) -> ConversionNumericPrecisionDto {
    match precision {
        NumericPrecision::Mz64Intensity32 => ConversionNumericPrecisionDto::Mz64Intensity32,
        NumericPrecision::Mz64Intensity64 => ConversionNumericPrecisionDto::Mz64Intensity64,
        NumericPrecision::Mz32Intensity32 => ConversionNumericPrecisionDto::Mz32Intensity32,
        NumericPrecision::Mz32Intensity64 => ConversionNumericPrecisionDto::Mz32Intensity64,
    }
}

const fn compression_dto(compression: CompressionIntent) -> ConversionCompressionDto {
    match compression {
        CompressionIntent::Zlib => ConversionCompressionDto::Zlib,
        CompressionIntent::NoCompression => ConversionCompressionDto::None,
    }
}

/// One intent, as a surface reads it.
///
/// The identity comes from the intent's own `stable_id`, which composes the
/// five values' identities in one order and nowhere else — so the string a
/// caller sends back names exactly the combination it was given, and this is
/// the only place that shape is built.
pub(super) fn intent_dto(intent: ConversionIntent) -> ConversionIntentDto {
    ConversionIntentDto {
        id: intent.stable_id(),
        format: output_format_dto(intent.format()),
        processing: processing_dto(intent.processing()),
        population: population_dto(intent.population()),
        precision: precision_dto(intent.precision()),
        compression: compression_dto(intent.compression()),
    }
}

/// The admitted intent this identity names, or nothing.
///
/// **The only way a caller-supplied value becomes a `ConversionIntent`.** The
/// identity is matched against the admitted table rather than split into five
/// parts and reassembled: a string naming a combination the evidence does not
/// admit resolves to `None`, so there is no partially valid request to inspect,
/// log or accidentally run — the same property `ConversionIntent::admitted`
/// gives the crate, reached from the wire.
pub(super) fn intent_from_id(id: &str) -> Option<ConversionIntent> {
    ConversionIntent::ADMITTED
        .iter()
        .map(|admitted| admitted.intent())
        .find(|intent| intent.stable_id() == id)
}

/// Every admitted intent, each marked with what this build can do about it.
///
/// In `ConversionIntent::ADMITTED` order, which is the order the evidence
/// record presents and the order a reader meets: the shipped posture first,
/// then the dimensions varied one at a time. The interface derives each axis's
/// vocabulary from first appearance in this list, so the order is a product
/// fact rather than an incidental one.
pub(super) fn catalog_options(
    capabilities: &InstalledHelpCapabilities,
) -> Vec<ConversionIntentOptionDto> {
    ConversionIntent::ADMITTED
        .iter()
        .map(|admitted| {
            let intent = admitted.intent();
            ConversionIntentOptionDto {
                intent: intent_dto(intent),
                // The same gate the command builder applies, asked of the same
                // intent. Not a summary of it and not a copy of its rules: a
                // second predicate here could refuse what the builder accepts,
                // or offer what it will not emit.
                availability: match capabilities.require_conversion_intent(&intent) {
                    Ok(()) => ConversionIntentAvailabilityDto::Available,
                    Err(_) => ConversionIntentAvailabilityDto::UnsupportedByInstallation,
                },
            }
        })
        .collect()
}
