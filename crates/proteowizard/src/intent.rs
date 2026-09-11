//! What a conversion is asked to do, as one typed product semantic.
//!
//! This module exists to hold a boundary, and the boundary is the whole point:
//! **a capability being supported individually is not a capability being
//! supported in combination.** M6.2 measured the installed `msconvert` across a
//! finite case ledger, and what it produced is not a list of independent
//! features — it is an *incomplete composition graph*. Nine of the forty-eight
//! combinations a free cross-product of the five dimensions below would allow
//! were actually measured. The other thirty-nine were not, and several of them
//! are known to behave differently from what a reader would assume.
//!
//! So the dimensions are named as separate types, because they are separate
//! product decisions and a reader needs to see them that way, and then
//! [`ConversionIntent`] is **not** a struct of five public fields. It has one
//! authority — [`ConversionIntent::ADMITTED`] — and the only way to obtain one
//! is to name a combination that table contains.
//!
//! The consequence is deliberate: adding a dimension value here does not widen
//! what can be built. Widening requires a new measured row, which requires new
//! evidence, which is [M6.2's] work and not this module's.
//!
//! [M6.2's]: ../../../docs/spikes/M6_MSCONVERT_CAPABILITY_EVIDENCE.md
//!
//! ## What the evidence admits, and why each exclusion holds
//!
//! - **mzXML is not constructible at all.** It is `MEASURED_REJECTED`: on a
//!   two-source document the writer silently dropped the spectra of the
//!   non-default source and then declared a scan count it had not written.
//!   [`OutputFormat`] therefore has one variant. The lower-level
//!   [`OpenFormat::MzXml`](crate::OpenFormat) stays where it is: **M6.10 made the
//!   disposition terminal as `MZXML_REFUSED`**, and a refusal is not deleted
//!   because nothing reaches it -- that is how a format returns without one. It
//!   simply cannot be reached from an intent.
//! - **No scoped centroiding is constructible**, and this is an entailment
//!   rather than a preference. `msLevel=` is positional after the picker token
//!   and is *silently discarded* without one; the installed grammar admits only
//!   `cwt` or `vendor` as that token; `cwt` is `MEASURED_REJECTED` and `vendor`
//!   is `EVIDENCE_BLOCKED`. The one admitted algorithm is the default picker,
//!   which has no token. So "centroid MS2 only" cannot be expressed by any
//!   admitted means, and this module offers no way to ask for it.
//! - **Per-array precision does not compose with processing.** Every measured
//!   case that ran a filter carried the *global* `--32` or `--64`; `--mz32`,
//!   `--mz64`, `--inten32` and `--inten64` appear only in cases that ran none.
//! - **`NoCompression` composes with nothing but the plain 64-bit conversion**,
//!   because `--zlib=off` was measured exactly once, on its own.
//! - **Centroiding does not compose with a population filter.** The measured
//!   order pair used `cwt`, which is rejected, so the admitted picker has never
//!   been measured beside an `msLevel` filter.

use std::ffi::OsString;

use crate::conversion_run::ConversionSourceKind;

/// The output format an intent may ask for.
///
/// One variant, and that is the encoding rather than an oversight: mzXML is
/// `MEASURED_REJECTED`, and a rejected format should be impossible to name in a
/// product intent rather than rejected later by a runtime check somebody could
/// forget to call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OutputFormat {
    MzMl,
}

impl OutputFormat {
    /// The identity this dimension carries in records and diagnostics.
    ///
    /// A product identity, deliberately not the provider's argv spelling. What
    /// MSCanvas asked for and how it happens to be spelled on a command line
    /// are two different facts, and only one of them is stable.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::MzMl => "mzml",
        }
    }
}

/// What the conversion is asked to do to the peaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProcessingIntent {
    /// MSCanvas inserts no peak-picking filter. The product's standing rule,
    /// and the only processing posture the shipped product has ever had.
    NoAdditionalCentroiding,
    /// Centroiding by whichever picker the build's **bare** `peakPicking` filter
    /// selects, across every MS level, because that form cannot be scoped -- see
    /// the module note.
    ///
    /// Not one algorithm, and M6.10 is why the wording changed. M6.2 measured
    /// the bare form on mzML sources, where it runs the local-maximum picker,
    /// and this said so. M6.10 measured it on a lawful Thermo acquisition, where
    /// the same form runs the **vendor** picker and records its name. The intent
    /// names the request MSCanvas issues, which is stable; the algorithm the
    /// provider selects for it depends on the source family, which is measured
    /// per family and not assumed.
    ///
    /// One consequence is recorded rather than left to be met: on this build a
    /// vendor acquisition converted under this intent is **refused** by the
    /// integrity contract, because the algorithm it runs is not the one M6.2
    /// admitted. The refusal is fail-closed and correct. Whether the product
    /// should offer this combination for a vendor row at all is a product
    /// decision this type does not make.
    UnscopedDefaultCentroiding,
}

impl ProcessingIntent {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NoAdditionalCentroiding => "no_additional_centroiding",
            Self::UnscopedDefaultCentroiding => "unscoped_default_centroiding",
        }
    }
}

/// Which spectra the output is asked to contain.
///
/// Deliberately a different type from [`ProcessingIntent`], and deliberately not
/// a field on it. Selecting a population and scoping a centroiding algorithm are
/// two different operations that happen to share the provider's `msLevel`
/// vocabulary, and a single `ms_levels` field whose meaning changed with a
/// sibling field is how the two would come to be confused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SpectrumPopulation {
    All,
    Ms1Only,
    Ms2Only,
}

impl SpectrumPopulation {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Ms1Only => "ms1_only",
            Self::Ms2Only => "ms2_only",
        }
    }

    /// The MS level this population keeps, where it keeps exactly one.
    #[must_use]
    pub const fn retained_ms_level(self) -> Option<u32> {
        match self {
            Self::All => None,
            Self::Ms1Only => Some(1),
            Self::Ms2Only => Some(2),
        }
    }
}

/// The width each stored array is asked to carry.
///
/// Named by the **semantic result** rather than by which flag produces it, and
/// in particular the first variant is not called `Default`. A provider default
/// is an observation about a build; it is not a product decision, and the whole
/// reason precision is typed here is that MSCanvas had been letting that
/// observation answer a question it had never asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NumericPrecision {
    /// m/z at 64 bits, intensity narrowed to 32. What the shipped product has
    /// always produced, measured rather than assumed.
    Mz64Intensity32,
    Mz64Intensity64,
    Mz32Intensity32,
    Mz32Intensity64,
}

impl NumericPrecision {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Mz64Intensity32 => "mz64_intensity32",
            Self::Mz64Intensity64 => "mz64_intensity64",
            Self::Mz32Intensity32 => "mz32_intensity32",
            Self::Mz32Intensity64 => "mz32_intensity64",
        }
    }

    /// The width the m/z array must declare.
    #[must_use]
    pub const fn mz_bits(self) -> u8 {
        match self {
            Self::Mz64Intensity32 | Self::Mz64Intensity64 => 64,
            Self::Mz32Intensity32 | Self::Mz32Intensity64 => 32,
        }
    }

    /// The width the intensity array must declare. Read separately from
    /// [`Self::mz_bits`] on purpose: the shipped posture differs between them,
    /// and a document-wide precision marker could not express that.
    #[must_use]
    pub const fn intensity_bits(self) -> u8 {
        match self {
            Self::Mz64Intensity64 | Self::Mz32Intensity64 => 64,
            Self::Mz64Intensity32 | Self::Mz32Intensity32 => 32,
        }
    }
}

/// How the stored arrays are asked to be encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CompressionIntent {
    Zlib,
    NoCompression,
}

impl CompressionIntent {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Zlib => "zlib",
            Self::NoCompression => "none",
        }
    }
}

/// One provider capability an intent's lowering depends on.
///
/// The command builder must establish every one of these against the *live*
/// installed help before a `CommandSpec` exists. M6.2's evidence says a semantic
/// was measured on one executable; it says nothing about the executable a user
/// has installed today, and a flag the intent emits that the installed build
/// does not declare has to be a planning refusal rather than a backend failure.
///
/// Only what the intent actually emits appears here. The shipped intent lowers
/// to two flags and therefore requires two capabilities -- naming the whole M6.2
/// candidate list would make every conversion depend on features it never uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProviderFeature {
    /// A `--name` option that takes no argument, named as the help declares it.
    Flag(&'static str),
    /// The `--zlib` option, which is required for both compression directions
    /// because `--zlib=off` is that same option carrying its argument.
    ZlibOption,
    /// The generic `--filter` option, which takes a required argument.
    FilterOption,
    /// One exact spectrum-list filter invocation. Separate from
    /// [`Self::FilterOption`] because the option existing does not imply the
    /// named grammar existing, and the name existing does not imply that
    /// grammar accepting the shape this product sends.
    Filter(FilterInvocation),
}

/// The exact filter invocation one intent lowers to.
///
/// Carried as a shape rather than reconstructed from the argv string later. The
/// tokens and this description come out of the same segment, so what the
/// capability gate proves admissible is what the command actually sends -- and
/// a second hand-written grammar table beside the lowering cannot drift from it,
/// because there is no second table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FilterInvocation {
    /// The filter name, as the installed help declares it.
    pub name: &'static str,
    /// How many positional arguments follow the name in the emitted argument.
    /// `peakPicking` sends none; `msLevel 1` sends one.
    pub positional_arguments: usize,
    /// The `name=` parameters the invocation supplies. Empty for every admitted
    /// intent: the one scoped form the provider offers is the one M6.2 measured
    /// silently discarding its scope.
    pub named_arguments: &'static [&'static str],
}

impl ProviderFeature {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Flag(_) => "flag",
            Self::ZlibOption => "zlib_option",
            Self::FilterOption => "filter_option",
            Self::Filter(_) => "filter_invocation",
        }
    }
}

/// One thing an intent asks the provider to do: the argv it lowers to, and the
/// capabilities that argv depends on.
///
/// The pair is the whole point. `lower()` reads the tokens and the capability
/// requirement reads the features, both from one list built once, so an argument
/// cannot be emitted without its requirement being stated beside it.
#[derive(Debug, Clone, Copy)]
struct LoweredSegment {
    features: &'static [ProviderFeature],
    tokens: &'static [&'static str],
}

/// The population filter's invocation shape, which both levels share.
const MS_LEVEL_INVOCATION: FilterInvocation = FilterInvocation {
    name: "msLevel",
    positional_arguments: 1,
    named_arguments: &[],
};

/// One conversion's complete product semantics.
///
/// The fields are private and there is no public constructor that takes them.
/// The only way to obtain a value is [`ConversionIntent::admitted`], which
/// answers from [`ConversionIntent::ADMITTED`] — so "is this combination
/// evidenced?" has exactly one implementation, and it is a table rather than a
/// predicate somebody could re-derive slightly differently somewhere else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ConversionIntent {
    format: OutputFormat,
    processing: ProcessingIntent,
    population: SpectrumPopulation,
    precision: NumericPrecision,
    compression: CompressionIntent,
}

impl ConversionIntent {
    /// Every combination the M6.2 evidence admits, and nothing else.
    ///
    /// **This constant is the boundary.** A free cross-product of the five
    /// dimensions would allow forty-eight combinations; nine were measured.
    /// Each row below names the evidence case that measured it, so a reader can
    /// go and check, and so a row added without one is visibly different from a
    /// row that has one.
    ///
    /// The order is the order the evidence record presents them in, which is
    /// also the order a reader meets them: the shipped posture first, then the
    /// dimensions varied one at a time from a fixed 64-bit baseline.
    pub const ADMITTED: [AdmittedIntent; 9] = [
        // The posture the product ships today, measured with no flag at all.
        AdmittedIntent {
            intent: ConversionIntent {
                format: OutputFormat::MzMl,
                processing: ProcessingIntent::NoAdditionalCentroiding,
                population: SpectrumPopulation::All,
                precision: NumericPrecision::Mz64Intensity32,
                compression: CompressionIntent::Zlib,
            },
            evidence: "D1",
            sources: EvidenceSourceDomain::AnyAdmittedSource,
        },
        AdmittedIntent {
            intent: ConversionIntent {
                format: OutputFormat::MzMl,
                processing: ProcessingIntent::NoAdditionalCentroiding,
                population: SpectrumPopulation::All,
                precision: NumericPrecision::Mz64Intensity64,
                compression: CompressionIntent::Zlib,
            },
            evidence: "P4, P1, L3, C1",
            sources: EvidenceSourceDomain::AnyAdmittedSource,
        },
        AdmittedIntent {
            intent: ConversionIntent {
                format: OutputFormat::MzMl,
                processing: ProcessingIntent::NoAdditionalCentroiding,
                population: SpectrumPopulation::All,
                precision: NumericPrecision::Mz32Intensity32,
                compression: CompressionIntent::Zlib,
            },
            evidence: "P3, P2",
            sources: EvidenceSourceDomain::AnyAdmittedSource,
        },
        AdmittedIntent {
            intent: ConversionIntent {
                format: OutputFormat::MzMl,
                processing: ProcessingIntent::NoAdditionalCentroiding,
                population: SpectrumPopulation::All,
                precision: NumericPrecision::Mz32Intensity64,
                compression: CompressionIntent::Zlib,
            },
            evidence: "P5",
            sources: EvidenceSourceDomain::AnyAdmittedSource,
        },
        // The one case that measured compression off, and the only combination
        // it therefore admits.
        AdmittedIntent {
            intent: ConversionIntent {
                format: OutputFormat::MzMl,
                processing: ProcessingIntent::NoAdditionalCentroiding,
                population: SpectrumPopulation::All,
                precision: NumericPrecision::Mz64Intensity64,
                compression: CompressionIntent::NoCompression,
            },
            evidence: "C2",
            sources: EvidenceSourceDomain::AnyAdmittedSource,
        },
        AdmittedIntent {
            intent: ConversionIntent {
                format: OutputFormat::MzMl,
                processing: ProcessingIntent::NoAdditionalCentroiding,
                population: SpectrumPopulation::Ms1Only,
                precision: NumericPrecision::Mz64Intensity64,
                compression: CompressionIntent::Zlib,
            },
            evidence: "L1",
            sources: EvidenceSourceDomain::AnyAdmittedSource,
        },
        AdmittedIntent {
            intent: ConversionIntent {
                format: OutputFormat::MzMl,
                processing: ProcessingIntent::NoAdditionalCentroiding,
                population: SpectrumPopulation::Ms2Only,
                precision: NumericPrecision::Mz64Intensity64,
                compression: CompressionIntent::Zlib,
            },
            evidence: "L2",
            sources: EvidenceSourceDomain::AnyAdmittedSource,
        },
        // The two rows that compose processing with anything. Both carry a
        // *global* precision posture, which is the whole reason the per-array
        // ones are absent here.
        AdmittedIntent {
            intent: ConversionIntent {
                format: OutputFormat::MzMl,
                processing: ProcessingIntent::UnscopedDefaultCentroiding,
                population: SpectrumPopulation::All,
                precision: NumericPrecision::Mz64Intensity64,
                compression: CompressionIntent::Zlib,
            },
            evidence: "K1, K8",
            // Reader-sensitive: measured on mzML sources only. M6.10 measured
            // that a vendor reader selects its own picker for this same argv.
            sources: EvidenceSourceDomain::MeasuredOn(&[ConversionSourceKind::MzmlFile]),
        },
        AdmittedIntent {
            intent: ConversionIntent {
                format: OutputFormat::MzMl,
                processing: ProcessingIntent::UnscopedDefaultCentroiding,
                population: SpectrumPopulation::All,
                precision: NumericPrecision::Mz32Intensity32,
                compression: CompressionIntent::Zlib,
            },
            evidence: "K12",
            // Reader-sensitive: measured on mzML sources only. M6.10 measured
            // that a vendor reader selects its own picker for this same argv.
            sources: EvidenceSourceDomain::MeasuredOn(&[ConversionSourceKind::MzmlFile]),
        },
    ];

    /// What the product converts with today, stated rather than inherited.
    ///
    /// Before this existed the same answer came from four independent places —
    /// `ConversionPolicy::default()`, a hard-coded `OpenFormat::MzMl`, an
    /// unconditional `--zlib`, and the provider's own precision default, which
    /// nothing in the repository had ever named. This is one value, and it is
    /// the first row of [`Self::ADMITTED`].
    pub const SHIPPED: Self = Self::ADMITTED[0].intent;

    /// Whether this intent's evidence is evidence about `kind`.
    ///
    /// **The third question, asked once.** `admitted(..)` answers whether the
    /// measured vocabulary contains a combination; the installed build's grammar
    /// answers whether it can be expressed; this answers whether the measurement
    /// behind it covers the source in hand. All three must hold before a
    /// conversion may be planned, and none of them substitutes for another.
    ///
    /// A `ConversionIntent` can only exist by having been looked up in
    /// [`Self::ADMITTED`], so the row is always found; `false` for an intent that
    /// somehow is not in the table is the fail-closed answer rather than a panic.
    #[must_use]
    pub fn evidence_covers_source(self, kind: ConversionSourceKind) -> bool {
        Self::ADMITTED
            .iter()
            .find(|admitted| admitted.intent == self)
            .is_some_and(|admitted| admitted.sources.covers(kind))
    }

    /// The intent for this combination, or `None` where the evidence does not
    /// admit it.
    ///
    /// Failure happens *before* a `ConversionIntent` exists, which is the point:
    /// there is no partially-valid value to inspect, log or accidentally use.
    #[must_use]
    pub fn admitted(
        format: OutputFormat,
        processing: ProcessingIntent,
        population: SpectrumPopulation,
        precision: NumericPrecision,
        compression: CompressionIntent,
    ) -> Option<Self> {
        let candidate = Self {
            format,
            processing,
            population,
            precision,
            compression,
        };
        Self::ADMITTED
            .iter()
            .any(|admitted| admitted.intent == candidate)
            .then_some(candidate)
    }

    /// The evidence case(s) that admitted this intent.
    ///
    /// Every constructed intent has one, because construction goes through the
    /// table. Returning it rather than storing it keeps the intent itself a
    /// pure product semantic.
    ///
    /// Like [`Self::stable_id`], no production caller reads it yet. It is the
    /// runtime half of an audit link whose static half `check_repo.py` already
    /// enforces -- that every row cites a measurement the ledger actually
    /// holds -- and it answers from the same table, so the two cannot disagree.
    #[must_use]
    pub fn evidence(&self) -> &'static str {
        Self::ADMITTED
            .iter()
            .find(|admitted| admitted.intent == *self)
            .map_or("", |admitted| admitted.evidence)
    }

    #[must_use]
    pub const fn format(&self) -> OutputFormat {
        self.format
    }

    #[must_use]
    pub const fn processing(&self) -> ProcessingIntent {
        self.processing
    }

    #[must_use]
    pub const fn population(&self) -> SpectrumPopulation {
        self.population
    }

    #[must_use]
    pub const fn precision(&self) -> NumericPrecision {
        self.precision
    }

    #[must_use]
    pub const fn compression(&self) -> CompressionIntent {
        self.compression
    }

    /// The provider arguments this intent lowers to, between the source path
    /// and `--outdir`.
    ///
    /// **Deterministic by construction.** The sequence is built in one fixed
    /// order by straight-line code — there is no map, no set, no sort and no
    /// caller-supplied ordering — so the same intent produces the same argv
    /// every time and from every entry point.
    ///
    /// Two lowerings are omissions, and both are deliberate rather than
    /// accidental:
    ///
    /// - [`NumericPrecision::Mz64Intensity32`] emits **no** precision flag,
    ///   because that is the form the evidence measured. `--mz64 --inten32`
    ///   was never run, and emitting it would be an argv nothing observed.
    /// - [`SpectrumPopulation::All`] emits no filter, which the evidence
    ///   measured as byte-identical to the explicit `msLevel 1-` form.
    ///
    /// Compression is emitted explicitly in both directions even though `zlib`
    /// is the provider's default, because MSCanvas's compression choice is a
    /// stated product semantic and this is the argv the product already ships.
    #[must_use]
    pub fn lower(&self) -> Vec<OsString> {
        self.segments()
            .into_iter()
            .flat_map(|segment| segment.tokens.iter().copied().map(OsString::from))
            .collect()
    }

    /// Every provider capability this intent's own lowering depends on.
    ///
    /// Read from the same segments `lower()` reads, so the two cannot come
    /// apart: an argument has no way to reach argv without arriving inside a
    /// segment that names what it needs.
    #[must_use]
    pub fn required_provider_features(&self) -> Vec<ProviderFeature> {
        self.segments()
            .into_iter()
            .flat_map(|segment| segment.features.iter().copied())
            .collect()
    }

    /// What this intent asks the provider to do, in the order it asks.
    ///
    /// Filters last, and processing before population. The provider applies
    /// filters in the order they are listed and says a picker must come first,
    /// so the order is a property of the scientific intent rather than of
    /// anything a control happens to do.
    ///
    /// No admitted intent currently produces both — centroiding beside a
    /// population filter is unmeasured — so this order is stated for the
    /// evidence that would widen it rather than exercised today.
    ///
    /// A segment may carry no tokens at all. The shipped precision posture is
    /// one: it emits nothing, so it depends on nothing, and a build declaring no
    /// precision options can still run it.
    fn segments(&self) -> Vec<LoweredSegment> {
        let format = match self.format {
            OutputFormat::MzMl => LoweredSegment {
                features: &[ProviderFeature::Flag("mzML")],
                tokens: &["--mzML"],
            },
        };
        let compression = match self.compression {
            CompressionIntent::Zlib => LoweredSegment {
                features: &[ProviderFeature::ZlibOption],
                tokens: &["--zlib"],
            },
            CompressionIntent::NoCompression => LoweredSegment {
                features: &[ProviderFeature::ZlibOption],
                tokens: &["--zlib=off"],
            },
        };
        let precision = match self.precision {
            // The measured lowering of the shipped posture is silence, and
            // silence depends on nothing.
            NumericPrecision::Mz64Intensity32 => LoweredSegment {
                features: &[],
                tokens: &[],
            },
            NumericPrecision::Mz64Intensity64 => LoweredSegment {
                features: &[ProviderFeature::Flag("64")],
                tokens: &["--64"],
            },
            NumericPrecision::Mz32Intensity32 => LoweredSegment {
                features: &[ProviderFeature::Flag("32")],
                tokens: &["--32"],
            },
            NumericPrecision::Mz32Intensity64 => LoweredSegment {
                features: &[
                    ProviderFeature::Flag("mz32"),
                    ProviderFeature::Flag("inten64"),
                ],
                tokens: &["--mz32", "--inten64"],
            },
        };
        // The `--filter` option itself is required by every filter segment, and
        // the named grammar beside it: a build declaring `--filter` but not the
        // filter this intent names cannot run it.
        //
        // Never an `msLevel=` argument inside the picker. The measured
        // behaviour of `peakPicking msLevel=<set>` without a picker token is
        // that the scope is silently discarded and *every* level is centroided,
        // so the form is not merely unevidenced -- it is known to mean
        // something other than it reads.
        let processing = match self.processing {
            ProcessingIntent::NoAdditionalCentroiding => LoweredSegment {
                features: &[],
                tokens: &[],
            },
            ProcessingIntent::UnscopedDefaultCentroiding => LoweredSegment {
                features: &[
                    ProviderFeature::FilterOption,
                    ProviderFeature::Filter(FilterInvocation {
                        name: "peakPicking",
                        positional_arguments: 0,
                        named_arguments: &[],
                    }),
                ],
                tokens: &["--filter", "peakPicking"],
            },
        };
        let population = match self.population {
            SpectrumPopulation::All => LoweredSegment {
                features: &[],
                tokens: &[],
            },
            SpectrumPopulation::Ms1Only => LoweredSegment {
                features: &[
                    ProviderFeature::FilterOption,
                    ProviderFeature::Filter(MS_LEVEL_INVOCATION),
                ],
                tokens: &["--filter", "msLevel 1"],
            },
            SpectrumPopulation::Ms2Only => LoweredSegment {
                features: &[
                    ProviderFeature::FilterOption,
                    ProviderFeature::Filter(MS_LEVEL_INVOCATION),
                ],
                tokens: &["--filter", "msLevel 2"],
            },
        };
        vec![format, compression, precision, processing, population]
    }

    /// A stable, path-free identity for this intent.
    ///
    /// It is the one shape a record of *what was asked for* can take without a
    /// path in it, and it cannot drift -- every part is the five values' own
    /// identity, composed here in one order and nowhere else.
    #[must_use]
    pub fn stable_id(&self) -> String {
        format!(
            "{}+{}+{}+{}+{}",
            self.format.stable_id(),
            self.processing.stable_id(),
            self.population.stable_id(),
            self.precision.stable_id(),
            self.compression.stable_id(),
        )
    }

    /// The admitted intent one identity names, or `None` where no row has it.
    ///
    /// **The reverse of [`Self::stable_id`], answered from the same table
    /// [`Self::admitted`] answers from, and deliberately not by parsing.** A
    /// parser would have to split the identity into five values and look each
    /// one up in its own dimension, which is a second way to arrive at a
    /// combination -- and a caller could then name one of the thirty-nine the
    /// evidence never measured by supplying five individually valid parts. A
    /// scan over the admitted rows can only ever answer with a row.
    ///
    /// This is the boundary an untrusted identity crosses. What arrives from
    /// the webview is a string; what leaves here is either a measured
    /// combination or nothing at all, so there is no partially-valid value for
    /// a caller to inspect or accidentally use.
    #[must_use]
    pub fn from_stable_id(id: &str) -> Option<Self> {
        Self::ADMITTED
            .iter()
            .map(AdmittedIntent::intent)
            .find(|admitted| admitted.stable_id() == id)
    }
}

/// One row of the admitted table: a combination and the evidence for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdmittedIntent {
    intent: ConversionIntent,
    /// The M6.2 case identifier(s) that measured this combination.
    evidence: &'static str,
    /// Which source families that measurement is evidence *about*.
    sources: EvidenceSourceDomain,
}

/// The source families one row's measurement actually covers.
///
/// **A third question, and the reason it is separate from the other two.** Until
/// now a combination had two: does the measured vocabulary contain it, and can
/// the installed build express it. Both are answered without reference to what
/// is being converted, and for most of this table that is right.
///
/// It is not right for peak picking. M6.2 measured every row on generated mzML
/// fixtures, and for output format, numeric precision, compression and MS-level
/// population that generalizes: those are decided by the **writer**, downstream
/// of whichever reader produced the spectra. Peak picking is decided by the
/// **reader** -- [CNV-D2](../../../docs/architecture/adr/0043-conversion-completion-route.md#cnv-d2--processing-intent)
/// records from the provider's own sources that vendor centroiding is selected
/// by a `dynamic_cast` on the immediately inner spectrum list -- so a
/// measurement of it on one source family says nothing about another.
///
/// M6.10 then measured what that means in practice: on a lawful Thermo
/// acquisition the bare `peakPicking` filter selects the *vendor* picker, which
/// the requested-processing contract correctly refuses. The repair is to stop
/// offering the combination where its evidence does not reach, **not** to widen
/// the contract to accept whichever algorithm a reader happens to use.
///
/// Membership of [`ConversionIntent::ADMITTED`] therefore no longer asserts
/// source applicability on its own. The nine measured combinations and the
/// thirty-nine they exclude are unchanged; what changed is that two of the nine
/// now say which sources they were measured on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceSourceDomain {
    /// The measured semantic is writer-side, so the measurement carries to
    /// every source family.
    ///
    /// **It answers `true` for any family, including one added after this was
    /// written**, and the name says *admitted* because admitting a family is a
    /// different gate: [`provider_build_is_evidenced`](crate::provider_build_is_evidenced)
    /// is asked per family and refuses one whose reader nobody measured on this
    /// build. A family therefore reaches these rows only after that gate lets
    /// it convert at all, which is why this variant does not repeat the check
    /// -- two lists of admitted families would be one more thing to drift.
    ///
    /// **Not a claim that all future writer-side behaviour is source-independent.**
    /// It is this table's seven rows, on the axes M6.2 measured, and a new axis
    /// gets this variant only by argument.
    AnyAdmittedSource,
    /// The measured semantic is reader-sensitive, and these are the families it
    /// was measured on. Every other family -- admitted, unadmitted or not yet
    /// recognized -- is outside it.
    MeasuredOn(&'static [ConversionSourceKind]),
}

impl EvidenceSourceDomain {
    /// Whether a measurement in this domain is evidence about `kind`.
    #[must_use]
    pub fn covers(self, kind: ConversionSourceKind) -> bool {
        match self {
            Self::AnyAdmittedSource => true,
            // A linear scan of a list of at most a few entries, and deliberately
            // not a set: the lists are literal, and a family is named or it is
            // not. Nothing here infers a family from a name, a path, an
            // extension or a caller-supplied flag.
            Self::MeasuredOn(families) => families.contains(&kind),
        }
    }
}

impl AdmittedIntent {
    #[must_use]
    pub const fn intent(&self) -> ConversionIntent {
        self.intent
    }

    #[must_use]
    pub const fn evidence(&self) -> &'static str {
        self.evidence
    }

    /// Which source families this row's evidence covers.
    #[must_use]
    pub const fn sources(&self) -> EvidenceSourceDomain {
        self.sources
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every dimension value, so the cross-product test below cannot silently
    /// stop covering one when a variant is added.
    const FORMATS: [OutputFormat; 1] = [OutputFormat::MzMl];
    const PROCESSING: [ProcessingIntent; 2] = [
        ProcessingIntent::NoAdditionalCentroiding,
        ProcessingIntent::UnscopedDefaultCentroiding,
    ];
    const POPULATIONS: [SpectrumPopulation; 3] = [
        SpectrumPopulation::All,
        SpectrumPopulation::Ms1Only,
        SpectrumPopulation::Ms2Only,
    ];
    const PRECISIONS: [NumericPrecision; 4] = [
        NumericPrecision::Mz64Intensity32,
        NumericPrecision::Mz64Intensity64,
        NumericPrecision::Mz32Intensity32,
        NumericPrecision::Mz32Intensity64,
    ];
    const COMPRESSIONS: [CompressionIntent; 2] =
        [CompressionIntent::Zlib, CompressionIntent::NoCompression];

    /// Every source family, so the applicability tests below cannot silently
    /// stop covering one when a variant is added.
    const SOURCE_KINDS: [ConversionSourceKind; 4] = [
        ConversionSourceKind::MzmlFile,
        ConversionSourceKind::ThermoRawFile,
        ConversionSourceKind::ShimadzuLcdFile,
        ConversionSourceKind::SciexWiffBundle,
    ];

    /// A distinct position per family.
    ///
    /// **What this does and does not buy, stated exactly.** A variant added to
    /// [`ConversionSourceKind`] fails to compile here until it is answered, so
    /// the author is *prompted*. It is not a proof: Rust cannot enumerate an
    /// enum's variants without a derive macro, and no dependency was added for
    /// one, so an author who answers here and forgets `SOURCE_KINDS` leaves the
    /// array short and nothing fails. The test below therefore claims only what
    /// it holds -- that the array and this function agree about the families
    /// the array does name.
    const fn source_kind_index(kind: ConversionSourceKind) -> usize {
        match kind {
            ConversionSourceKind::MzmlFile => 0,
            ConversionSourceKind::ThermoRawFile => 1,
            ConversionSourceKind::ShimadzuLcdFile => 2,
            ConversionSourceKind::SciexWiffBundle => 3,
        }
    }

    /// The family list and the index function agree, and the list repeats
    /// nobody.
    ///
    /// **Deliberately not named as an exhaustiveness proof, because it is not
    /// one.** `seen` is sized from the array under test, so a variant absent
    /// from the array is absent from this loop too and nothing here can notice.
    /// What it does catch is the array disagreeing with `source_kind_index` --
    /// a duplicate entry, a stale index, or an entry whose index names a
    /// different family. The prompt to add a new variant to the array is the
    /// compile error in `source_kind_index`; it is a prompt, not a guarantee,
    /// and the record says so.
    #[test]
    fn the_family_list_and_its_index_agree() {
        let mut seen = [false; SOURCE_KINDS.len()];
        for kind in SOURCE_KINDS {
            let index = source_kind_index(kind);
            assert!(
                !seen[index],
                "two families share index {index}, so one of them is missing"
            );
            assert_eq!(
                SOURCE_KINDS[index], kind,
                "index {index} names a different family than the one at it"
            );
            seen[index] = true;
        }
        assert!(
            seen.iter().all(|listed| *listed),
            "the family list does not name every family it indexes: {seen:?}"
        );
    }

    /// Every admitted row says which sources its measurement covers, and the two
    /// reader-sensitive ones say `mzML` and nothing else.
    ///
    /// The distinction this pins is the whole repair. M6.2 measured all nine
    /// rows on generated mzML fixtures. For seven of them that generalizes,
    /// because the semantic is decided by the writer. For the two centroiding
    /// rows it does not, because the picker is chosen by the reader -- and M6.10
    /// measured a vendor reader choosing its own.
    #[test]
    fn each_admitted_row_states_the_sources_its_evidence_covers() {
        for admitted in ConversionIntent::ADMITTED {
            // Keyed on *asking for a picker*, not on one variant's name. A
            // scoped MS-level preset added later is reader-sensitive for the
            // same reason, and would have to carry a measured domain rather
            // than trip this test into demanding the writer-side one.
            let reader_sensitive = !matches!(
                admitted.intent().processing(),
                ProcessingIntent::NoAdditionalCentroiding
            );
            match (reader_sensitive, admitted.sources()) {
                (false, EvidenceSourceDomain::AnyAdmittedSource) => {}
                (true, EvidenceSourceDomain::MeasuredOn(families)) => {
                    assert_eq!(
                        families,
                        [ConversionSourceKind::MzmlFile],
                        "a centroiding row claims a source family nobody measured it on: {:?}",
                        admitted.intent()
                    );
                }
                (reader_sensitive, domain) => panic!(
                    "row {:?} is reader_sensitive={reader_sensitive} and carries {domain:?}",
                    admitted.intent()
                ),
            }
        }
    }

    /// Each affected intent against every source family, and each unaffected one
    /// too, so the field cannot be read as a blanket narrowing.
    #[test]
    fn evidence_applicability_is_answered_per_row_and_per_source_family() {
        for admitted in ConversionIntent::ADMITTED {
            let intent = admitted.intent();
            let centroiding = !matches!(
                intent.processing(),
                ProcessingIntent::NoAdditionalCentroiding
            );
            for kind in SOURCE_KINDS {
                let covered = intent.evidence_covers_source(kind);
                let expected = !centroiding || kind == ConversionSourceKind::MzmlFile;
                assert_eq!(
                    covered, expected,
                    "{intent:?} on {kind:?}: expected covered={expected}"
                );
            }
        }
    }

    /// `SHIPPED` converts every admitted family, and the repair does not touch
    /// it. If this fails, the product's default posture has been narrowed.
    #[test]
    fn the_shipped_posture_still_covers_every_source_family() {
        for kind in SOURCE_KINDS {
            assert!(
                ConversionIntent::SHIPPED.evidence_covers_source(kind),
                "the shipped posture stopped covering {kind:?}"
            );
        }
    }

    /// The seven writer-side rows keep every family, and the two centroiding
    /// rows keep exactly one. Counted rather than described, so a row that
    /// changed sides is a failure rather than a re-reading.
    #[test]
    fn seven_rows_cover_every_family_and_two_cover_only_mzml() {
        let (any, mzml_only): (Vec<&AdmittedIntent>, Vec<&AdmittedIntent>) =
            ConversionIntent::ADMITTED.iter().partition(|admitted| {
                SOURCE_KINDS
                    .iter()
                    .all(|kind| admitted.intent().evidence_covers_source(*kind))
            });
        assert_eq!(any.len(), 7, "writer-side rows");
        assert_eq!(mzml_only.len(), 2, "reader-sensitive rows");
        for admitted in mzml_only {
            // *Only* mzML, asserted family by family. The partition above only
            // establishes "misses at least one", so a row widened to mzML plus
            // one vendor family would still land here and still look right.
            for kind in SOURCE_KINDS {
                assert_eq!(
                    admitted.intent().evidence_covers_source(kind),
                    kind == ConversionSourceKind::MzmlFile,
                    "a reader-sensitive row covers {kind:?}, which nobody measured it on"
                );
            }
        }
    }

    /// Adding the applicability field admitted no combination and excluded none.
    ///
    /// The nine measured combinations and the thirty-nine the cross-product
    /// excludes are M6.2's, and this repair is about *sources*, not about the
    /// vocabulary. A field that quietly changed the table would be a different
    /// change wearing this one's clothes.
    #[test]
    fn the_measured_vocabulary_is_unchanged_by_source_qualification() {
        assert_eq!(ConversionIntent::ADMITTED.len(), 9);
        let admitted_count = cross_product()
            .into_iter()
            .filter(|(format, processing, population, precision, compression)| {
                ConversionIntent::admitted(
                    *format,
                    *processing,
                    *population,
                    *precision,
                    *compression,
                )
                .is_some()
            })
            .count();
        assert_eq!(admitted_count, 9, "admitted combinations");
        assert_eq!(cross_product().len() - admitted_count, 39, "excluded");
    }

    fn cross_product() -> Vec<(
        OutputFormat,
        ProcessingIntent,
        SpectrumPopulation,
        NumericPrecision,
        CompressionIntent,
    )> {
        let mut all = Vec::new();
        for format in FORMATS {
            for processing in PROCESSING {
                for population in POPULATIONS {
                    for precision in PRECISIONS {
                        for compression in COMPRESSIONS {
                            all.push((format, processing, population, precision, compression));
                        }
                    }
                }
            }
        }
        all
    }

    #[test]
    fn the_admitted_table_is_a_small_minority_of_the_cross_product() {
        // The number itself is not the point; that the two differ by this much
        // is. If a later change made every combination constructible, this is
        // the test that says so out loud.
        let total = cross_product().len();
        assert_eq!(total, 48);
        assert_eq!(ConversionIntent::ADMITTED.len(), 9);
    }

    #[test]
    fn exactly_the_admitted_combinations_are_constructible() {
        for (format, processing, population, precision, compression) in cross_product() {
            let built =
                ConversionIntent::admitted(format, processing, population, precision, compression);
            let listed = ConversionIntent::ADMITTED.iter().any(|admitted| {
                admitted.intent.format == format
                    && admitted.intent.processing == processing
                    && admitted.intent.population == population
                    && admitted.intent.precision == precision
                    && admitted.intent.compression == compression
            });
            assert_eq!(
                built.is_some(),
                listed,
                "{format:?}/{processing:?}/{population:?}/{precision:?}/{compression:?} \
                 constructible={} but admitted={listed}",
                built.is_some()
            );
        }
    }

    #[test]
    fn no_admitted_row_is_listed_twice() {
        for (position, admitted) in ConversionIntent::ADMITTED.iter().enumerate() {
            assert!(
                !ConversionIntent::ADMITTED[..position]
                    .iter()
                    .any(|earlier| earlier.intent == admitted.intent),
                "{:?} appears more than once",
                admitted.intent
            );
        }
    }

    #[test]
    fn an_identity_round_trips_through_the_admitted_table() {
        for admitted in &ConversionIntent::ADMITTED {
            let intent = admitted.intent();
            assert_eq!(
                ConversionIntent::from_stable_id(&intent.stable_id()),
                Some(intent),
                "{} does not name its own row",
                intent.stable_id()
            );
        }
    }

    #[test]
    fn an_identity_no_row_carries_names_no_intent() {
        // The whole reason this scans rather than parses: five individually
        // valid parts do not compose an admitted combination, and a caller that
        // sends this one gets nothing rather than something to inspect.
        assert!(
            ConversionIntent::admitted(
                OutputFormat::MzMl,
                ProcessingIntent::NoAdditionalCentroiding,
                SpectrumPopulation::Ms1Only,
                NumericPrecision::Mz32Intensity32,
                CompressionIntent::Zlib,
            )
            .is_none(),
            "the fixture must name one of the thirty-nine"
        );
        let unmeasured = format!(
            "{}+{}+{}+{}+{}",
            OutputFormat::MzMl.stable_id(),
            ProcessingIntent::NoAdditionalCentroiding.stable_id(),
            SpectrumPopulation::Ms1Only.stable_id(),
            NumericPrecision::Mz32Intensity32.stable_id(),
            CompressionIntent::Zlib.stable_id(),
        );
        assert_eq!(ConversionIntent::from_stable_id(&unmeasured), None);
    }

    #[test]
    fn a_string_that_is_not_an_identity_names_no_intent() {
        let shipped = ConversionIntent::SHIPPED.stable_id();
        for nonsense in ["", "mzML", "mzML+++", &shipped[1..], &format!("{shipped} ")] {
            assert_eq!(ConversionIntent::from_stable_id(nonsense), None);
        }
    }

    #[test]
    fn every_admitted_row_names_its_evidence() {
        for admitted in &ConversionIntent::ADMITTED {
            assert!(
                !admitted.evidence.is_empty(),
                "{:?} has no evidence case",
                admitted.intent
            );
            assert_eq!(admitted.intent.evidence(), admitted.evidence);
        }
    }

    #[test]
    fn scoped_centroiding_cannot_be_named_at_all() {
        // Not "is refused" -- there is no value to refuse. The population and
        // the processing intent are separate types, and nothing in
        // `ProcessingIntent` carries an MS level, so "centroid MS2 only" has no
        // spelling in this module. The closest constructible thing is the
        // population filter, which selects spectra and picks no peaks.
        let ms2_selection = ConversionIntent::admitted(
            OutputFormat::MzMl,
            ProcessingIntent::NoAdditionalCentroiding,
            SpectrumPopulation::Ms2Only,
            NumericPrecision::Mz64Intensity64,
            CompressionIntent::Zlib,
        )
        .expect("MS2-only selection is admitted");
        assert_eq!(
            ms2_selection.processing(),
            ProcessingIntent::NoAdditionalCentroiding
        );
        // And centroiding beside any population but `All` is not constructible.
        for population in [SpectrumPopulation::Ms1Only, SpectrumPopulation::Ms2Only] {
            for precision in PRECISIONS {
                for compression in COMPRESSIONS {
                    assert!(
                        ConversionIntent::admitted(
                            OutputFormat::MzMl,
                            ProcessingIntent::UnscopedDefaultCentroiding,
                            population,
                            precision,
                            compression,
                        )
                        .is_none(),
                        "centroiding composed with {population:?} is not measured"
                    );
                }
            }
        }
    }

    #[test]
    fn per_array_precision_never_composes_with_processing() {
        for precision in [
            NumericPrecision::Mz64Intensity32,
            NumericPrecision::Mz32Intensity64,
        ] {
            for population in POPULATIONS {
                for compression in COMPRESSIONS {
                    assert!(
                        ConversionIntent::admitted(
                            OutputFormat::MzMl,
                            ProcessingIntent::UnscopedDefaultCentroiding,
                            population,
                            precision,
                            compression,
                        )
                        .is_none(),
                        "{precision:?} with processing is not measured"
                    );
                }
            }
        }
    }

    #[test]
    fn no_compression_composes_with_nothing_else() {
        for (format, processing, population, precision, compression) in cross_product() {
            if compression != CompressionIntent::NoCompression {
                continue;
            }
            let built =
                ConversionIntent::admitted(format, processing, population, precision, compression);
            let is_the_measured_one = processing == ProcessingIntent::NoAdditionalCentroiding
                && population == SpectrumPopulation::All
                && precision == NumericPrecision::Mz64Intensity64;
            assert_eq!(built.is_some(), is_the_measured_one);
        }
    }

    #[test]
    fn the_shipped_intent_is_todays_behaviour_and_lowers_to_todays_argv() {
        let shipped = ConversionIntent::SHIPPED;
        assert_eq!(shipped.format(), OutputFormat::MzMl);
        assert_eq!(
            shipped.processing(),
            ProcessingIntent::NoAdditionalCentroiding
        );
        assert_eq!(shipped.population(), SpectrumPopulation::All);
        assert_eq!(shipped.precision(), NumericPrecision::Mz64Intensity32);
        assert_eq!(shipped.compression(), CompressionIntent::Zlib);
        // Exactly the flags the product has always emitted, in the order it has
        // always emitted them.
        assert_eq!(
            shipped.lower(),
            vec![OsString::from("--mzML"), OsString::from("--zlib")]
        );
    }

    /// Every argument an admitted intent emits is covered by a stated
    /// requirement, and nothing is required that is not emitted.
    ///
    /// Derived from the argv here only as a *proof*: the mechanism is that both
    /// come from one segment list, and this reads the result back to show the
    /// two halves of each segment agree. A flag that reached argv without its
    /// requirement would be one the planner could not have established before
    /// emitting it, which is the whole defect this closes.
    #[test]
    fn every_emitted_argument_is_covered_by_a_stated_requirement() {
        for admitted in &ConversionIntent::ADMITTED {
            let intent = admitted.intent;
            let features = intent.required_provider_features();
            let lowered = intent.lower();

            let mut expected: Vec<ProviderFeature> = Vec::new();
            let mut tokens = lowered.iter();
            while let Some(token) = tokens.next() {
                let token = token.to_str().expect("every lowered token is UTF-8");
                if token == "--filter" {
                    expected.push(ProviderFeature::FilterOption);
                    let argument = tokens.next().expect("a filter carries its grammar");
                    // The invocation shape is read back out of the emitted
                    // argument, so what the capability gate is told to prove is
                    // measured against what is actually sent.
                    let argument = argument.to_str().expect("every lowered token is UTF-8");
                    let mut words = argument.split(' ');
                    let named = words.next().expect("a filter names a grammar");
                    let positional_arguments = words.count();
                    expected.push(ProviderFeature::Filter(FilterInvocation {
                        name: match named {
                            "peakPicking" => "peakPicking",
                            "msLevel" => "msLevel",
                            other => panic!("{other} reached argv with no requirement rule"),
                        },
                        positional_arguments,
                        named_arguments: &[],
                    }));
                } else if token.starts_with("--zlib") {
                    expected.push(ProviderFeature::ZlibOption);
                } else {
                    expected.push(ProviderFeature::Flag(match token {
                        "--mzML" => "mzML",
                        "--32" => "32",
                        "--64" => "64",
                        "--mz32" => "mz32",
                        "--inten64" => "inten64",
                        other => panic!("{other} reached argv with no requirement rule"),
                    }));
                }
            }

            assert_eq!(
                features, expected,
                "{:?} emits arguments its requirement list does not cover",
                intent
            );
        }
    }

    /// The shipped intent depends on the two flags it emits and nothing else.
    ///
    /// The other half of the same rule. Requiring the whole M6.2 candidate list
    /// would make every production conversion refuse on a build that declares
    /// only what it actually uses.
    #[test]
    fn the_shipped_intent_requires_only_what_it_emits() {
        assert_eq!(
            ConversionIntent::SHIPPED.required_provider_features(),
            vec![ProviderFeature::Flag("mzML"), ProviderFeature::ZlibOption,]
        );
    }

    #[test]
    fn lowering_is_deterministic_and_never_reorders() {
        for admitted in &ConversionIntent::ADMITTED {
            let once = admitted.intent.lower();
            let again = admitted.intent.lower();
            assert_eq!(once, again, "{:?} lowered differently", admitted.intent);
            // The format flag is always first and compression always second, so
            // a reader comparing two argv lines is comparing the same columns.
            assert_eq!(once[0], OsString::from("--mzML"));
            assert!(once[1] == "--zlib" || once[1] == "--zlib=off");
            // Not merely "mzML is first". The rejected legacy format appears
            // nowhere in a lowering, at any position, for any admitted row.
            assert!(
                !once.contains(&OsString::from("--mzXML")),
                "{:?} lowered to the legacy format",
                admitted.intent
            );
        }
    }

    #[test]
    fn no_admitted_intent_lowers_to_more_than_one_filter() {
        for admitted in &ConversionIntent::ADMITTED {
            let filters = admitted
                .intent
                .lower()
                .iter()
                .filter(|argument| *argument == &OsString::from("--filter"))
                .count();
            assert!(
                filters <= 1,
                "{:?} lowered to {filters} filters",
                admitted.intent
            );
        }
    }

    #[test]
    fn no_additional_centroiding_never_lowers_to_a_picker() {
        for admitted in &ConversionIntent::ADMITTED {
            if admitted.intent.processing() != ProcessingIntent::NoAdditionalCentroiding {
                continue;
            }
            assert!(
                !admitted
                    .intent
                    .lower()
                    .iter()
                    .any(|argument| argument.to_string_lossy().contains("peakPicking")),
                "{:?} emitted a peak-picking filter",
                admitted.intent
            );
        }
    }

    #[test]
    fn no_intent_ever_lowers_to_a_scoped_picker() {
        for admitted in &ConversionIntent::ADMITTED {
            for argument in admitted.intent.lower() {
                let text = argument.to_string_lossy();
                assert!(
                    !(text.contains("peakPicking") && text.contains("msLevel")),
                    "{:?} emitted a scoped picker, which the evidence says is silently ignored",
                    admitted.intent
                );
            }
        }
    }

    #[test]
    fn precision_reports_each_array_independently() {
        assert_eq!(NumericPrecision::Mz64Intensity32.mz_bits(), 64);
        assert_eq!(NumericPrecision::Mz64Intensity32.intensity_bits(), 32);
        assert_eq!(NumericPrecision::Mz32Intensity64.mz_bits(), 32);
        assert_eq!(NumericPrecision::Mz32Intensity64.intensity_bits(), 64);
    }

    #[test]
    fn the_shipped_precision_lowers_to_silence_because_that_is_what_was_measured() {
        // Every precision flag the installed grammar declares, named exactly.
        // A prefix test would be wrong here in a way worth avoiding: `--mzML`
        // is the *format* flag and shares three characters with `--mz32`.
        const PRECISION_FLAGS: [&str; 6] =
            ["--64", "--32", "--mz64", "--mz32", "--inten64", "--inten32"];
        let shipped = ConversionIntent::SHIPPED.lower();
        assert!(
            !shipped.iter().any(|argument| PRECISION_FLAGS
                .iter()
                .any(|flag| argument == &OsString::from(*flag))),
            "the measured lowering of the shipped precision posture is no flag at all"
        );
        // And the format flag is still there, which is what makes the check above
        // meaningful rather than vacuous.
        assert!(shipped.contains(&OsString::from("--mzML")));
    }
}
