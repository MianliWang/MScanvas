//! What conversion semantics are known for the installation this session is
//! bound to, as a typed lifecycle keyed by binding receipt.
//!
//! [ADR 0044] Decision 5 moves this out of React, where it was rebuilt each
//! round from four separate refs -- which binding was served, which had been
//! automatically attempted, which catalog generation was installed, and whether
//! a standing catalog still described the current binding. Their disagreement
//! was a family of defects on its own: a catalog surviving the installation it
//! described, a plan and a catalog stamped from different readings, a settings
//! panel showing one build's rows beside another build's banner.
//!
//! Here there is one value per binding and no way to hold two.
//!
//! [ADR 0044]: ../../../../../docs/architecture/adr/0044-conversion-configuration-authority.md

use mscanvas_proteowizard::{ConversionIntent, InstalledHelpCapabilities, OpenFormat};

use super::authority::{BackendBindingReceipt, Binding};
use super::dto::{
    ConversionCatalogRowDto, ConversionConfigurationDto, ConversionIntentDto, PreviewErrorDto,
};

/// Whether one admitted combination is offered, and where it is not, why.
///
/// Two questions rather than one since CNV-D2: whether the product's evidence
/// for the row covers a source this workflow converts, and whether the bound
/// installation can run it. The first is asked first, and the variants below
/// keep the answers apart because the remedies differ -- one is a different
/// ProteoWizard release, and the other is a measurement no release supplies.
///
/// Decision 7: availability is a property of a *row*, never of an axis value.
/// M6.3 established that individual capability support does not imply arbitrary
/// composition support, and the last round's blocking defect was a row-level
/// refusal rendered against four separate axis values -- telling a reader whose
/// build lacks only the peak-picking grammar that it does not offer 64-bit
/// intensity, all spectra, or zlib. Three false statements, beside the very
/// controls needed to recover.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RowAvailability {
    Available,
    /// The installed build's grammar cannot express this row's argv.
    ///
    /// A fact about the installation. Choosing another ProteoWizard release can
    /// change it.
    UnsupportedByInstallation,
    /// No source this product converts is one this row's evidence covers.
    ///
    /// A fact about the *evidence*, and a different sentence entirely. The
    /// combination is one the measured vocabulary holds; what is missing is a
    /// measurement taken on the kinds of acquisition the visible workflow
    /// accepts. Peak picking is the axis this reaches, because the picker is
    /// chosen by the reader rather than by the writer.
    ///
    /// **It says nothing about the installation, in either direction.** This
    /// answer is decided before the grammar is consulted, deliberately: a row
    /// no convertible family is evidenced for is not made available by a build
    /// that happens to accept its argv. So a build that also could not express
    /// the row reports this rather than the grammar refusal, and that is the
    /// right way round -- the reader's remedy is the same either way, and it is
    /// not a different ProteoWizard release.
    NotEvidencedForConversionSources,
}

impl RowAvailability {
    pub(crate) const fn is_available(self) -> bool {
        matches!(self, Self::Available)
    }

    /// The identity the webview receives, so the two refusals stay two
    /// sentences rather than one boolean.
    pub(crate) const fn stable_id(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::UnsupportedByInstallation => "unsupported_by_installation",
            Self::NotEvidencedForConversionSources => "not_evidenced_for_conversion_sources",
        }
    }
}

/// One admitted combination, and whether this installation can run it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CatalogRow {
    pub(crate) intent: ConversionIntent,
    pub(crate) availability: RowAvailability,
}

/// What the bound build's catalog says about one admitted combination.
///
/// Four answers rather than a boolean, because they lead to four different
/// sentences and only one of them is a refusal a reader can act on by changing
/// installation. A missing catalog is not an unavailable row: it says this
/// binding's grammar has not been read, which is an obligation rather than a
/// verdict. A row no converted source is evidenced for is not one either: the
/// binding is fine and the measurement is the thing that is missing.
///
/// There is no arm for "the catalog has no such row", and there never was. A
/// catalog is always every row of `ConversionIntent::ADMITTED`, and the only
/// way to obtain a [`ConversionIntent`] is to look one up in that same table --
/// so a resolved intent is a row of every catalog that exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RowAdmission {
    /// This binding has no catalog: unread, refused, or a binding that names no
    /// build at all.
    NoCatalog,
    /// The row exists and the installed build cannot run it.
    Unavailable,
    /// The row exists, and no source this product converts is one the row's
    /// evidence covers.
    ///
    /// **A third arm rather than a second meaning for `Unavailable`.** The two
    /// refusals send a reader to different places: one is about this
    /// installation and another ProteoWizard release can change it; this one is
    /// about the product's evidence, and no release supplies a measurement.
    /// Collapsing them here is how the distinction the catalog draws would stop
    /// travelling one call before the sentence that states it.
    ///
    /// Says nothing about the grammar in either direction: the catalog decides
    /// applicability before it asks the build, so a row this build also could
    /// not express still arrives here.
    NotEvidencedForSources,
    Available,
}

/// Every admitted combination, judged against this product's source evidence
/// and then against one installation's grammar.
///
/// Always all nine rows, in the order `ConversionIntent::ADMITTED` states them.
/// A catalog that omitted its unavailable rows could not answer the question
/// Decision 7's one-axis edit asks -- *does a row for this combination exist at
/// all, and if so is it available here?* -- and the answers are different
/// sentences: whether the product measured the combination at all, whether the
/// measurement covers the kinds of acquisition this workflow converts, and
/// whether this build can express it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConversionCatalog {
    rows: Vec<CatalogRow>,
}

impl ConversionCatalog {
    /// Judges every admitted row, on the two questions
    /// [`Self::availability_of`] asks in the order it asks them: whether the
    /// product's evidence for the row covers a source this workflow converts,
    /// and then whether the bound build's msconvert grammar can express it.
    ///
    /// The grammar question is asked row by row, through
    /// `require_conversion_intent`, which reads the same segments the intent's
    /// own argv is built from. Nothing here asks whether an *axis value* is
    /// supported, because no such question has an answer: `--64` being declared
    /// says nothing about whether the row that uses it is one the evidence
    /// admits, and the peak-picking grammar being absent says nothing about
    /// zlib.
    pub(crate) fn of(capabilities: &InstalledHelpCapabilities) -> Self {
        Self {
            rows: ConversionIntent::ADMITTED
                .iter()
                .map(|admitted| CatalogRow {
                    intent: admitted.intent(),
                    availability: Self::availability_of(admitted.intent(), capabilities),
                })
                .collect(),
        }
    }

    /// The three answers for one row, in the order that makes each true.
    ///
    /// **Source applicability first**, because it is a fact about the product's
    /// evidence and holds whatever installation is bound: a row no convertible
    /// family is evidenced for is not made available by a build that happens to
    /// accept its argv. The grammar question follows and is about this
    /// installation alone.
    ///
    /// Derived rather than listed. Nothing here names a vendor family or copies
    /// the admitted graph; it asks the crate's own rule about the families the
    /// visible workflow converts, so a family admitted or withdrawn later moves
    /// this answer with it.
    fn availability_of(
        intent: ConversionIntent,
        capabilities: &InstalledHelpCapabilities,
    ) -> RowAvailability {
        if !super::conversion::convertible_source_kinds()
            .any(|kind| intent.evidence_covers_source(kind))
        {
            return RowAvailability::NotEvidencedForConversionSources;
        }
        if capabilities.require_conversion_intent(&intent).is_ok() {
            RowAvailability::Available
        } else {
            RowAvailability::UnsupportedByInstallation
        }
    }
}

/// What is known about conversion settings for one binding.
///
/// The four states of Decision 5's lifecycle. `loading` is deliberately absent:
/// it is request activity rather than domain state, and persisting it here is
/// how a panel came to render a spinner for a request whose binding had already
/// been replaced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ConversionConfiguration {
    /// The binding names no installation, so there is nothing to probe and no
    /// probe is attempted. Entered from the binding and from nothing else --
    /// never because preview became unusable, which is a different judgement
    /// about a build that is still there.
    UnavailableForBinding,
    /// An installed binding whose grammar has not been read yet, so no row can
    /// be judged against it.
    ///
    /// An obligation, not a resting state. A session left here has a first read
    /// still owed, and the stimulus that re-issues it is named in Decision 4b
    /// rather than left to a timer.
    Unattempted,
    Ready {
        catalog: ConversionCatalog,
    },
    Failed {
        error: PreviewErrorDto,
    },
}

/// What a configuration read established about the build it resolved.
///
/// One value rather than a `Result`, because the third arm is neither success
/// nor failure of the read: finding no installation is an answer about the
/// binding, and routing it through `Failed` would offer the reader a retry for
/// a build that is not there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReadAnswer {
    /// The read's own discovery was still `Available` and its grammar, judged
    /// beside the product's source evidence, yields a catalog.
    Cataloged(ConversionCatalog),
    /// The read's own discovery was still `Available` and that grammar cannot
    /// be used: the bound help will not parse, or `require_conversion` refuses.
    Unusable(PreviewErrorDto),
    /// The read's own discovery no longer resolves an installation, so the
    /// binding it answers for is a `NoInstallation` one.
    NoInstallation,
}

/// One admitted combination, as the webview receives it.
///
/// One projection, shared by the catalog and by the plan, so a row a reader
/// chose and the plan they act on cannot describe the same combination in two
/// ways.
pub(crate) fn intent_dto(intent: &ConversionIntent) -> ConversionIntentDto {
    ConversionIntentDto {
        id: intent.stable_id(),
        format: intent.format().stable_id().to_owned(),
        processing: intent.processing().stable_id().to_owned(),
        population: intent.population().stable_id().to_owned(),
        precision: intent.precision().stable_id().to_owned(),
        compression: intent.compression().stable_id().to_owned(),
    }
}

impl ConversionCatalog {
    fn to_dto(&self) -> Vec<ConversionCatalogRowDto> {
        self.rows
            .iter()
            .map(|row| ConversionCatalogRowDto {
                intent: intent_dto(&row.intent),
                available: row.availability.is_available(),
                availability: row.availability.stable_id().to_owned(),
            })
            .collect()
    }
}

impl ConversionConfiguration {
    /// What the webview receives for the binding the snapshot's authority
    /// names. The receipt is not repeated here; there is one copy, in the
    /// authority, and this describes the binding that copy identifies.
    pub(crate) fn to_dto(&self) -> ConversionConfigurationDto {
        match self {
            Self::UnavailableForBinding => ConversionConfigurationDto::UnavailableForBinding,
            Self::Unattempted => ConversionConfigurationDto::Unattempted,
            Self::Ready { catalog } => ConversionConfigurationDto::Ready {
                catalog: catalog.to_dto(),
                shipped: ConversionIntent::SHIPPED.stable_id(),
            },
            Self::Failed { error } => ConversionConfigurationDto::Failed {
                error: error.clone(),
            },
        }
    }
}

/// The session's configuration lifecycle: one binding's state, and no way to
/// hold a second.
#[derive(Debug, Default)]
pub(crate) struct ConversionConfigurations {
    held: Option<HeldConfiguration>,
}

#[derive(Debug)]
struct HeldConfiguration {
    receipt: BackendBindingReceipt,
    configuration: ConversionConfiguration,
}

impl ConversionConfigurations {
    /// Records a binding an operation observed while having no catalog to
    /// offer.
    ///
    /// Two rules, both from Decision 5. On an unchanged receipt the held state
    /// is *retained*: a recheck that finds the same build must never cause a
    /// second probe, and must never demote a `Ready` catalog back to
    /// `Unattempted`. On a replaced receipt the previous configuration is
    /// non-current immediately, whatever it was, and the new one is initialized
    /// from what the binding is -- installed builds owe a read, absences do not.
    pub(crate) fn observe(&mut self, binding: Binding) {
        if self
            .held
            .as_ref()
            .is_some_and(|held| held.receipt == binding.receipt())
        {
            return;
        }
        self.held = Some(HeldConfiguration {
            receipt: binding.receipt(),
            configuration: Self::initial_for(binding),
        });
    }

    /// Records a configuration read's own answer for the binding it resolved.
    ///
    /// One transaction with the observation that minted the binding, which is
    /// what keeps `Unattempted` from being rendered for a build whose read has
    /// already answered: a read that discovers a replacement lands the new
    /// binding directly on what its own answer supports, never routing through
    /// the obligation state on the way.
    ///
    /// A reply whose binding is no longer the current one is dropped rather
    /// than installed. Under the gate the two cannot diverge; the check is here
    /// so "a stale reply cannot become current" is a property of this type
    /// rather than a rule every call site has to remember.
    pub(crate) fn answer(&mut self, binding: Binding, answer: ReadAnswer) {
        self.observe(binding);
        let Some(held) = self.held.as_mut() else {
            return;
        };
        if held.receipt != binding.receipt() {
            return;
        }
        held.configuration = match answer {
            ReadAnswer::Cataloged(catalog) => ConversionConfiguration::Ready { catalog },
            ReadAnswer::Unusable(error) => ConversionConfiguration::Failed { error },
            ReadAnswer::NoInstallation => ConversionConfiguration::UnavailableForBinding,
        };
    }

    /// The state a binding starts in, which is a function of the binding and of
    /// nothing else.
    ///
    /// Stated once. An installed build owes a read; an absence has nothing to
    /// read and says so. This is the rule Rust owns -- and precisely the
    /// derivation the frontend is forbidden to perform, because there it would
    /// overwrite an answer Rust already holds.
    const fn initial_for(binding: Binding) -> ConversionConfiguration {
        if binding.is_installed() {
            ConversionConfiguration::Unattempted
        } else {
            ConversionConfiguration::UnavailableForBinding
        }
    }

    /// What is held for this binding, initializing it if this is the first
    /// time the binding has been seen.
    ///
    /// The receipt is the key rather than a field to compare afterwards: a
    /// reader that could take the configuration without naming a binding is the
    /// reader that would put one build's catalog beside another build's banner.
    /// Asking for a binding the lifecycle does not hold does not produce the
    /// held one -- it replaces it, because a binding the session has moved to is
    /// what the previous configuration stopped describing.
    ///
    /// Total, so a reader can never find itself holding a settled binding and
    /// no configuration for it. Every observation already routes through
    /// `observe`, so in practice this returns what is there; it exists so that
    /// "a settled binding always has a configuration" is a property of the type
    /// rather than an ordering every call site has to preserve.
    /// What this binding's catalog says about one admitted combination.
    ///
    /// Read from the held configuration and from nothing else: the answer is a
    /// statement about the build the receipt names, so a lookup that fell back
    /// to the admitted table would report the *product's* evidence as though it
    /// were this installation's.
    pub(crate) fn admits(&mut self, binding: Binding, intent: &ConversionIntent) -> RowAdmission {
        let ConversionConfiguration::Ready { catalog } = self.for_binding(binding) else {
            return RowAdmission::NoCatalog;
        };
        catalog
            .rows
            .iter()
            .find(|row| row.intent == *intent)
            .map_or(RowAdmission::NoCatalog, |row| match row.availability {
                // Matched rather than reduced to a boolean, so the catalog's
                // three answers reach the caller as three. A row refused for
                // absent source evidence that arrived here as `Unavailable`
                // would be answered with a sentence about the installation --
                // which is the exact misdirection this repair exists to stop.
                RowAvailability::Available => RowAdmission::Available,
                RowAvailability::UnsupportedByInstallation => RowAdmission::Unavailable,
                RowAvailability::NotEvidencedForConversionSources => {
                    RowAdmission::NotEvidencedForSources
                }
            })
    }

    pub(crate) fn for_binding(&mut self, binding: Binding) -> &ConversionConfiguration {
        self.observe(binding);
        &self
            .held
            .as_ref()
            .expect("observing a binding leaves a configuration for it")
            .configuration
    }
}

/// Reads one installation's conversion grammar into an answer.
///
/// The discrimination Decision 5's `Unattempted` arm states, in one place, so
/// the arm that lands a *replaced* binding uses the same one rather than a
/// second copy that could drift.
pub(crate) fn read_configuration(capabilities: &InstalledHelpCapabilities) -> ReadAnswer {
    match capabilities.require_conversion(OpenFormat::MzMl) {
        Ok(()) => ReadAnswer::Cataloged(ConversionCatalog::of(capabilities)),
        Err(_) => ReadAnswer::Unusable(PreviewErrorDto::new(
            "conversion_capability_unavailable",
            "The installed ProteoWizard cannot convert to mzML.",
            false,
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use mscanvas_proteowizard::{
        BackendTool, CapturedHelpStream, CompleteHelpCapture, CompressionIntent, NumericPrecision,
        OutputFormat, ProcessingIntent, Sha256Digest, SpectrumPopulation,
    };

    use super::*;
    use crate::preview::authority::{
        BackendAuthority, DiscoveryTarget, Observation, PreviewAvailability,
    };
    use crate::preview::installation::InstallationIdentity;

    /// A build declaring everything every admitted row emits.
    ///
    /// Written out here rather than imported from the crate's own test module,
    /// which is private and would not be visible anyway. Copied deliberately:
    /// a fixture that tracked the crate's would pass whatever the crate said,
    /// including after a change that silently widened what a build must
    /// declare -- and what this module asserts is that the *catalog* reflects
    /// the build, which needs a build this test controls.
    const COMPLETE_HELP: &str = r#"ProteoWizard release: 3.0.26013
Build date: Jan 13 2026
Usage: msconvert [options] [filemasks]
Convert mass spec data file formats.

Options:
  -o [ --outdir ] arg (=.)           : set output directory
  --outfile arg                      : Override the name of output file.
  --mzML                             : write mzML format [default]
  --mzXML                            : write mzXML format
  -z [ --zlib ] [=arg(=1)]           : use zlib compression for binary data
  --filter arg                       : add a spectrum list filter
  --32                               : set default binary encoding to 32-bit precision
  --64                               : set default binary encoding to 64-bit precision [default]
  --mz32                             : encode m/z values in 32-bit precision
  --mz64                             : encode m/z values in 64-bit precision [default]
  --inten32                          : encode intensity values in 32-bit precision [default]
  --inten64                          : encode intensity values in 64-bit precision

Spectrum List Filters
=====================

msLevel <mslevels>
This filter selects only spectra with the indicated <mslevels>, expressed as an int_set.

peakPicking [<PickerType>] [msLevel=<ms levels>]
This filter performs centroiding on spectra with the selected <ms levels>.
"#;

    const HELP_STDOUT_SHA256: Sha256Digest = Sha256Digest::from_bytes([0xAB; 32]);
    const HELP_STDERR_SHA256: Sha256Digest = Sha256Digest::from_bytes([0xCD; 32]);
    const FIXTURE_EXECUTABLE_SHA256: &str =
        "9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD";

    fn capabilities_from(help: &str) -> InstalledHelpCapabilities {
        let executable = fs::canonicalize(std::env::current_exe().expect("test executable"))
            .expect("canonical test executable");
        InstalledHelpCapabilities::parse_unbound_capture_for_tests(
            BackendTool::MsConvert,
            executable,
            FIXTURE_EXECUTABLE_SHA256
                .parse()
                .expect("the fixture digest is a digest"),
            CompleteHelpCapture::new(
                CapturedHelpStream::new(
                    help.as_bytes(),
                    help.len() as u64,
                    false,
                    HELP_STDOUT_SHA256,
                ),
                CapturedHelpStream::new(&[], 0, false, HELP_STDERR_SHA256),
            ),
        )
        .expect("the help fixture parses")
    }

    fn complete_help() -> InstalledHelpCapabilities {
        capabilities_from(COMPLETE_HELP)
    }

    /// The same build with one declaration removed.
    fn help_without(declaration: &str) -> InstalledHelpCapabilities {
        let crippled: String = COMPLETE_HELP
            .lines()
            .filter(|line| !line.trim_start().starts_with(declaration))
            .collect::<Vec<_>>()
            .join("\n");
        capabilities_from(&crippled)
    }

    fn intent(
        processing: ProcessingIntent,
        population: SpectrumPopulation,
        precision: NumericPrecision,
        compression: CompressionIntent,
    ) -> ConversionIntent {
        ConversionIntent::admitted(
            OutputFormat::MzMl,
            processing,
            population,
            precision,
            compression,
        )
        .expect("an admitted combination")
    }

    /// One catalog row, found the way the webview finds it: by the identity
    /// the row carries, over the rows the wire actually gets.
    fn row(rows: &[ConversionCatalogRowDto], intent: &ConversionIntent) -> Option<bool> {
        rows.iter()
            .find(|row| row.intent.id == intent.stable_id())
            .map(|row| row.available)
    }

    /// The catalog a `Ready` configuration carries, or a panic naming what it
    /// was instead.
    fn catalog_of(configuration: &ConversionConfiguration) -> Vec<ConversionCatalogRowDto> {
        match configuration.to_dto() {
            ConversionConfigurationDto::Ready { catalog, .. } => catalog,
            other => panic!("expected a ready configuration, found {other:?}"),
        }
    }

    fn installed_binding(authority: &mut BackendAuthority, name: &str) -> Binding {
        authority
            .observe(Observation {
                installed: Some(InstallationIdentity::for_test(
                    &PathBuf::from(format!("/{name}/msconvert.exe")),
                    &PathBuf::from(format!("/{name}/msaccess.exe")),
                    "3.0.0",
                )),
                preview_availability: PreviewAvailability::Usable,
                target: DiscoveryTarget::Automatic,
            })
            .state
            .binding()
            .expect("an installed observation settles a binding")
    }

    fn absent_binding(authority: &mut BackendAuthority) -> Binding {
        authority
            .observe(Observation {
                installed: None,
                preview_availability: PreviewAvailability::Unusable,
                target: DiscoveryTarget::Automatic,
            })
            .state
            .binding()
            .expect("an absent observation settles a binding too")
    }

    #[test]
    fn an_installed_binding_opens_owing_a_read() {
        let mut authority = BackendAuthority::default();
        let binding = installed_binding(&mut authority, "one");
        let mut configurations = ConversionConfigurations::default();
        assert_eq!(
            configurations.for_binding(binding),
            &ConversionConfiguration::Unattempted
        );
    }

    #[test]
    fn an_absent_binding_owes_nothing_and_is_not_probed() {
        // There is nothing to probe, so the state says so directly rather than
        // sitting in an obligation nothing could discharge.
        let mut authority = BackendAuthority::default();
        let binding = absent_binding(&mut authority);
        let mut configurations = ConversionConfigurations::default();
        assert_eq!(
            configurations.for_binding(binding),
            &ConversionConfiguration::UnavailableForBinding
        );
    }

    #[test]
    fn a_recheck_of_the_same_build_never_demotes_a_catalog() {
        // A recheck that resolves the same installation must not reset the
        // panel to unread: that would re-probe, which would re-issue a plan,
        // for a build nothing had said anything new about.
        let mut authority = BackendAuthority::default();
        let binding = installed_binding(&mut authority, "one");
        let mut configurations = ConversionConfigurations::default();
        configurations.answer(binding, read_configuration(&complete_help()));

        let again = installed_binding(&mut authority, "one");
        assert_eq!(again.receipt(), binding.receipt());
        configurations.observe(again);
        assert!(matches!(
            configurations.for_binding(again),
            ConversionConfiguration::Ready { .. }
        ));
    }

    #[test]
    fn a_replaced_binding_cannot_reach_the_previous_ones_catalog() {
        let mut authority = BackendAuthority::default();
        let first = installed_binding(&mut authority, "one");
        let mut configurations = ConversionConfigurations::default();
        configurations.answer(first, read_configuration(&complete_help()));

        let second = installed_binding(&mut authority, "two");
        assert_ne!(second.receipt(), first.receipt());
        // Not stale, not hidden: gone. The catalog is keyed by the binding it
        // described, and asking about a different one replaces it rather than
        // producing the answer that described the build the session has left.
        assert_eq!(
            configurations.for_binding(second),
            &ConversionConfiguration::Unattempted
        );
    }

    #[test]
    fn a_read_that_discovers_a_replacement_never_renders_unattempted() {
        // The read observes B and answers for B in one transaction, so B's
        // first rendered state is the answer rather than the obligation.
        let mut authority = BackendAuthority::default();
        let first = installed_binding(&mut authority, "one");
        let mut configurations = ConversionConfigurations::default();
        configurations.observe(first);

        let second = installed_binding(&mut authority, "two");
        configurations.answer(second, read_configuration(&complete_help()));
        assert!(matches!(
            configurations.for_binding(second),
            ConversionConfiguration::Ready { .. }
        ));
    }

    #[test]
    fn a_build_that_cannot_convert_to_mzml_fails_rather_than_offering_nothing() {
        // `Failed` and not an empty catalog. An empty catalog would say the
        // settings are known and there is nothing to choose, which offers the
        // reader no retry and no reason.
        let mut authority = BackendAuthority::default();
        let binding = installed_binding(&mut authority, "one");
        let mut configurations = ConversionConfigurations::default();
        configurations.answer(binding, read_configuration(&help_without("--mzML")));
        assert!(matches!(
            configurations.for_binding(binding),
            ConversionConfiguration::Failed { .. }
        ));
    }

    #[test]
    fn a_read_that_finds_nothing_installed_says_so_about_the_binding() {
        let mut authority = BackendAuthority::default();
        let binding = absent_binding(&mut authority);
        let mut configurations = ConversionConfigurations::default();
        configurations.answer(binding, ReadAnswer::NoInstallation);
        assert_eq!(
            configurations.for_binding(binding),
            &ConversionConfiguration::UnavailableForBinding
        );
    }

    #[test]
    fn a_ready_catalog_always_offers_the_shipped_row() {
        // `require_conversion(MzMl)` and `require_conversion_intent(SHIPPED)`
        // demand the identical set, so a build admitting the first admits the
        // second. Without this a session could be Ready with nothing it is
        // allowed to convert with, and the panel would open with no selection
        // and no way to make one.
        //
        // Asserted on the minimum build rather than the complete one: every
        // declaration beyond what the shipped row emits is removed, and the
        // shipped row is still there.
        let minimum = capabilities_from(
            &COMPLETE_HELP
                .lines()
                .filter(|line| {
                    let line = line.trim_start();
                    !(line.starts_with("--filter")
                        || line.starts_with("--32")
                        || line.starts_with("--64")
                        || line.starts_with("--mz32")
                        || line.starts_with("--mz64")
                        || line.starts_with("--inten32")
                        || line.starts_with("--inten64"))
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
        match read_configuration(&minimum) {
            ReadAnswer::Cataloged(catalog) => {
                let rows = catalog.to_dto();
                assert_eq!(row(&rows, &ConversionIntent::SHIPPED), Some(true));
                // And the webview is told which row that is, rather than
                // re-deriving it from the same table by a rule of its own.
                match (ConversionConfiguration::Ready { catalog }).to_dto() {
                    ConversionConfigurationDto::Ready { shipped, .. } => {
                        assert_eq!(shipped, ConversionIntent::SHIPPED.stable_id());
                    }
                    other => panic!("a ready configuration projects as ready, not {other:?}"),
                }
            }
            other => panic!("a build that converts to mzML is cataloged, not {other:?}"),
        }
    }

    #[test]
    fn the_catalog_keeps_every_admitted_row_including_the_unavailable_ones() {
        // A build lacking only the peak-picking grammar. Two admitted rows
        // compose processing, and both are unavailable on it.
        let rows = catalog_of(&ConversionConfiguration::Ready {
            catalog: ConversionCatalog::of(&help_without("peakPicking [")),
        });
        assert_eq!(rows.len(), ConversionIntent::ADMITTED.len());

        let centroided: Vec<_> = rows
            .iter()
            .filter(|row| row.intent.processing == "unscoped_default_centroiding")
            .collect();
        assert_eq!(centroided.len(), 2);
        assert!(centroided.iter().all(|row| !row.available));

        // And the axis values those two rows use are not condemned with them.
        // This is the blocking defect of the previous round, stated as an
        // assertion: 32/32 precision, all spectra and zlib each appear in a row
        // that is available here, so nothing may tell the reader this build
        // does not offer them.
        for surviving in [
            intent(
                ProcessingIntent::NoAdditionalCentroiding,
                SpectrumPopulation::All,
                NumericPrecision::Mz32Intensity32,
                CompressionIntent::Zlib,
            ),
            intent(
                ProcessingIntent::NoAdditionalCentroiding,
                SpectrumPopulation::All,
                NumericPrecision::Mz64Intensity64,
                CompressionIntent::Zlib,
            ),
        ] {
            assert_eq!(
                row(&rows, &surviving),
                Some(true),
                "{} is available on a build that lacks only peak picking",
                surviving.stable_id()
            );
        }
    }

    #[test]
    fn a_missing_axis_flag_takes_only_the_rows_that_emit_it() {
        // Row-level, not value-level, in the other direction: removing `--64`
        // takes every row that emits it and leaves the rest, including the
        // shipped row, which emits no precision flag at all.
        let rows = catalog_of(&ConversionConfiguration::Ready {
            catalog: ConversionCatalog::of(&help_without("--64")),
        });
        // Filtered on the *reason*, not on unavailability. Two rows are
        // unavailable for a different reason entirely -- no source this product
        // converts is one their evidence covers -- and lumping the two together
        // is what this repair exists to stop.
        assert!(
            rows.iter()
                .filter(|row| row.availability == "unsupported_by_installation")
                .all(|row| row.intent.precision == "mz64_intensity64"),
            "a row that does not emit --64 was refused for it"
        );
        assert!(
            rows.iter()
                .filter(|row| row.availability == "not_evidenced_for_conversion_sources")
                .all(|row| row.intent.processing == "unscoped_default_centroiding"),
            "a row was refused for absent source evidence that does not ask for a picker"
        );
        assert_eq!(row(&rows, &ConversionIntent::SHIPPED), Some(true));
    }

    #[test]
    fn a_combination_the_evidence_never_admitted_is_not_a_row_at_all() {
        // Not qualified is a different sentence from unavailable, and the
        // lookup has to be able to say which. A bare boolean could not.
        let rows = catalog_of(&ConversionConfiguration::Ready {
            catalog: ConversionCatalog::of(&complete_help()),
        });
        assert_eq!(rows.len(), 9);
        assert!(
            ConversionIntent::admitted(
                OutputFormat::MzMl,
                ProcessingIntent::NoAdditionalCentroiding,
                SpectrumPopulation::Ms1Only,
                NumericPrecision::Mz32Intensity32,
                CompressionIntent::Zlib,
            )
            .is_none(),
            "MS1 at 32/32 is one of the thirty-nine the evidence never measured"
        );
    }
}
