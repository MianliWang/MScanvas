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
//!   [`OpenFormat::MzXml`](crate::OpenFormat) stays where it is, because M6.10
//!   still owns that disposition; it simply cannot be reached from an intent.
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
    /// Centroiding by the build's default local-maximum picker, across every MS
    /// level, because that picker cannot be scoped — see the module note.
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
        let mut argv = Vec::new();
        argv.push(OsString::from(match self.format {
            OutputFormat::MzMl => "--mzML",
        }));
        argv.push(OsString::from(match self.compression {
            CompressionIntent::Zlib => "--zlib",
            CompressionIntent::NoCompression => "--zlib=off",
        }));
        match self.precision {
            // The measured lowering of the shipped posture is silence.
            NumericPrecision::Mz64Intensity32 => {}
            NumericPrecision::Mz64Intensity64 => argv.push(OsString::from("--64")),
            NumericPrecision::Mz32Intensity32 => argv.push(OsString::from("--32")),
            NumericPrecision::Mz32Intensity64 => {
                argv.push(OsString::from("--mz32"));
                argv.push(OsString::from("--inten64"));
            }
        }
        // Filters last, and processing before population. The provider applies
        // filters in the order they are listed and says a picker must come
        // first, so the order is a property of the scientific intent rather
        // than of anything a control happens to do.
        //
        // No admitted intent currently produces both — centroiding beside a
        // population filter is unmeasured — so this order is stated for the
        // evidence that would widen it rather than exercised today.
        if let Some(filter) = self.processing_filter() {
            argv.push(OsString::from("--filter"));
            argv.push(OsString::from(filter));
        }
        if let Some(filter) = self.population_filter() {
            argv.push(OsString::from("--filter"));
            argv.push(OsString::from(filter));
        }
        argv
    }

    /// The peak-picking filter this intent asks for, if any.
    ///
    /// Never emits an `msLevel=` argument. The measured behaviour of
    /// `peakPicking msLevel=<set>` without a picker token is that the scope is
    /// silently discarded and *every* level is centroided, so the form is not
    /// merely unevidenced — it is known to mean something other than it reads.
    fn processing_filter(&self) -> Option<&'static str> {
        match self.processing {
            ProcessingIntent::NoAdditionalCentroiding => None,
            ProcessingIntent::UnscopedDefaultCentroiding => Some("peakPicking"),
        }
    }

    fn population_filter(&self) -> Option<&'static str> {
        match self.population {
            SpectrumPopulation::All => None,
            SpectrumPopulation::Ms1Only => Some("msLevel 1"),
            SpectrumPopulation::Ms2Only => Some("msLevel 2"),
        }
    }

    /// A stable, path-free identity for this intent.
    ///
    /// No production caller reads it yet: nothing visible names an intent, so
    /// nothing has one to render. It is kept rather than deferred because it is
    /// the one shape a record of *what was asked for* can take without a path
    /// in it, and because it cannot drift -- every part is the five values'
    /// own identity, composed here in one order and nowhere else.
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
}

/// One row of the admitted table: a combination and the evidence for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdmittedIntent {
    intent: ConversionIntent,
    /// The M6.2 case identifier(s) that measured this combination.
    evidence: &'static str,
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
