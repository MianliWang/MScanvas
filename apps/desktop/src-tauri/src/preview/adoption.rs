//! Taking a finalized conversion output into the workspace, on purpose.
//!
//! A conversion writes a file into a folder the user chose. Nothing about that
//! makes it part of the session: the workspace is a list the user curates, and
//! adding rows to it because a background process finished is the application
//! deciding what the user is working on. So adoption is an action, it is asked
//! for, and it happens all at once for the queue that is on screen.
//!
//! What makes it more than "add these files" is that MSCanvas knows something
//! about these particular files that `Add files…` cannot know: it made them, it
//! measured them, and it kept hold of the objects. Between finalization and this
//! moment the final names are ordinary names in a folder anyone can write to, so
//! the question this module answers is not "is there an mzML file called this?"
//! but "is the file about to enter the workspace the exact object this queue
//! finalized, still holding the bytes that were validated?".
//!
//! Both halves are required. Identity without bytes admits a file that was
//! rewritten in place; bytes without identity admits any copy, including one
//! MSCanvas was never told about. And the object those questions are asked of is
//! the object the registry is about to hold — not a name that currently resolves
//! to it — so there is no gap between the proof and the thing proved.
//!
//! Nothing here is persisted. A ticket lives as long as the terminal queue that
//! made it; replacing the queue drops it, and dropping it closes a handle and
//! nothing else. The output stays exactly where it is, and `Add files…` remains
//! the ordinary way to reach it afterwards.

use std::fmt;
use std::fs::File;
use std::path::Path;
use std::sync::Arc;

use mscanvas_proteowizard::{FinalizedOutput, OutputDrift};
use mscanvas_proteowizard::{MAX_CONVERSION_OUTPUTS_PER_SOURCE, SciexSampleCompleteness};

use mscanvas_proteowizard::{BackendDiagnosticText, FinalizedOutputSet};

use super::conversion::WorkspaceMultiOutputConversionReport;
use super::destination::{DestinationHold, admit_destination_root};
use super::operation::AdmittedDestination;
use super::operation::ItemState;
use super::selection::DatasetSourceKind;
use super::selection::{AcceptedFile, DatasetId, accept_mzml_file};
use super::service::SciexConversion;

/// The group outcome a set must have to be adoptable, by the lifecycle's own
/// name for it.
const FULLY_FINALIZED: &str = "fully_finalized";

/// The member state every member of such a set must be in.
const FINALIZED: &str = "finalized";

/// The group outcome of a set that stepped aside because every one of its
/// destination names was already occupied by something it did not write.
const SKIPPED_EXISTING_DESTINATIONS: &str = "skipped_existing_destinations";

/// Why one finalized output cannot be taken into the workspace.
///
/// Closed, coarse and path-free. Each member is the same decision — this row is
/// not added — and differs only in what can honestly be said about why. They are
/// deliberately not error kinds: nothing here failed, and a queue that produced
/// a file the user then replaced did its job.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AdoptionRefusal {
    /// Nothing is at that name any more, or the folder it was written to is no
    /// longer the folder MSCanvas wrote to.
    Missing,
    /// Something is there, and it is not the file this queue finalized — a
    /// different object, or the same one holding different bytes.
    Changed,
    /// Something is there and could not be read well enough to decide.
    Unreadable,
    /// Something is there and is not a file the workspace accepts as mzML.
    NotMzml,
}

impl AdoptionRefusal {
    pub(super) const fn stable_id(self) -> &'static str {
        match self {
            Self::Missing => "output_missing",
            Self::Changed => "output_changed",
            Self::Unreadable => "output_unreadable",
            Self::NotMzml => "output_not_mzml",
        }
    }

    /// Every drift the boundary can report, said in the vocabulary above.
    ///
    /// A length or content change and a substituted object are one answer to the
    /// user — "that is not the file we made" — and separating them on screen
    /// would ask them to care about a distinction they cannot act on.
    const fn of_drift(drift: OutputDrift) -> Self {
        match drift {
            OutputDrift::DifferentObject
            | OutputDrift::ByteLengthChanged
            | OutputDrift::ContentChanged => Self::Changed,
            OutputDrift::Unreadable => Self::Unreadable,
        }
    }
}

/// One finalized output, and the authority to admit it later.
///
/// Created only from a finalization that succeeded, and never reconstructed
/// afterwards from a filename and a report: the whole value of this is that it
/// holds the object rather than a description of it.
///
/// Bounded by the queue that owns it — sixteen items at most, one ticket each —
/// and dropped with it.
pub(super) struct FinalizedOutputAdoptionTicket {
    /// The queue that produced this. An adoption names the queue it is for, and
    /// a ticket that outlived its queue must never answer for a later one.
    operation: u64,
    /// The workspace row this was converted from, so an adopted output can say
    /// where it came from without naming a path.
    source: DatasetId,
    /// That row's display name, bounded because every row's is.
    source_display_name: String,
    /// The name the plan derived and the queue displayed throughout.
    output_file_name: String,
    /// The folder this was written into, as the object it was admitted as.
    destination: AdmittedDestination,
    /// The object itself, and what was measured about it.
    finalized: FinalizedOutput,
}

impl FinalizedOutputAdoptionTicket {
    pub(super) const fn new(
        operation: u64,
        source: DatasetId,
        source_display_name: String,
        output_file_name: String,
        destination: AdmittedDestination,
        finalized: FinalizedOutput,
    ) -> Self {
        Self {
            operation,
            source,
            source_display_name,
            output_file_name,
            destination,
            finalized,
        }
    }

    pub(super) const fn operation(&self) -> u64 {
        self.operation
    }

    pub(super) const fn source(&self) -> DatasetId {
        self.source
    }

    pub(super) fn source_display_name(&self) -> &str {
        &self.source_display_name
    }

    pub(super) fn output_file_name(&self) -> &str {
        &self.output_file_name
    }

    /// Re-establishes that the output is still what it was, and accepts it.
    ///
    /// The order is the argument. The destination root is re-admitted first,
    /// because a name inside a directory that is no longer the admitted one says
    /// nothing at all. A writer-excluding hold is then taken at the final name,
    /// so the bytes cannot move while they are being read. The workspace's own
    /// mzML admission runs next, which is what produces the lease the registry
    /// will hold. And only then is the comparison made — against that lease's
    /// object, so what is proved and what is admitted are the same object rather
    /// than two openings of one name.
    ///
    /// # Errors
    ///
    /// Answers with the first reason the output cannot be admitted. Nothing is
    /// created, nothing is written, and the file is left exactly as it was found
    /// on every path.
    pub(super) fn accept(&self) -> Result<AdmittedOutput, AdoptionRefusal> {
        // Held, not merely checked, and held for the whole of the inspection.
        // Proving the root and then reaching a name inside it are two steps, and
        // a directory that could be renamed away between them would leave the
        // proof describing one directory and the name resolving inside another.
        // Admission withholds delete sharing on the directory, which is what
        // stops that for as long as this lives.
        let root = self.held_destination_root()?;
        let output = self.destination.root().join(&self.output_file_name);
        // Held for the same reason one level down. The retention this ticket
        // carries deliberately permits writers, so this is what makes "the bytes
        // are still these" true at the moment it is said rather than a moment
        // before.
        let no_writers = hold_against_writers(&output)?;
        let accepted = accept_mzml_file(&output).map_err(|error| refusal_of(&error.kind))?;
        self.recognises(&accepted)?;
        // Both holds travel with the accepted file rather than ending here. The
        // caller checks every other output before it commits any of them, which
        // for a queue of large documents is not a short interval -- and a
        // rewrite inside it would put bytes into the workspace that no longer
        // match the ones just proved.
        Ok(AdmittedOutput {
            accepted,
            root,
            no_writers,
        })
    }

    /// The admitted destination root, proved to still be the same directory and
    /// held open as it.
    ///
    /// A root that no longer answers as the object it was admitted as is treated
    /// as the output being out of reach rather than as the output being wrong:
    /// MSCanvas does not look inside a folder it cannot show is the one it wrote
    /// to, so it has nothing to say about what is in there.
    fn held_destination_root(&self) -> Result<DestinationHold, AdoptionRefusal> {
        let (root, identity, held) = admit_destination_root(self.destination.root())
            .map_err(|_| AdoptionRefusal::Missing)?;
        if self
            .destination
            .is_still(&AdmittedDestination::new(root, identity))
        {
            return Ok(held);
        }
        Err(AdoptionRefusal::Missing)
    }

    /// Whether the file the workspace just accepted is this finalized output.
    ///
    /// Asked of the accepted file's own object, which is the one the registry
    /// keeps. Anything else would prove a fact about a different opening of the
    /// same name.
    #[cfg(windows)]
    fn recognises(&self, accepted: &AcceptedFile) -> Result<(), AdoptionRefusal> {
        self.finalized
            .still_matches(accepted.accepted_object())
            .map_err(AdoptionRefusal::of_drift)
    }

    /// This platform's admission holds no object to compare against, and its
    /// finalization made no object-bound claim either. The bytes are still
    /// compared, through a reading of the accepted name.
    #[cfg(not(windows))]
    fn recognises(&self, accepted: &AcceptedFile) -> Result<(), AdoptionRefusal> {
        let current = File::open(accepted.path()).map_err(|_| AdoptionRefusal::Unreadable)?;
        self.finalized
            .still_matches(&current)
            .map_err(AdoptionRefusal::of_drift)
    }
}

/// One output that passed every check, with the holds that keep it true.
///
/// The checks establish that this object is the finalized one and still holds
/// the validated bytes. That stays true only while nobody may write it, so the
/// writer-excluding hold and the directory it lives in travel with the accepted
/// Why one fully finalized conversion could not become an adoptable output set.
///
/// Path-free and count-free beyond what a caller needs to tell the cases apart.
/// Every member is the same decision — there is no set to adopt — differing
/// only in what it can honestly say about why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OutputSetNotAdoptable {
    /// The conversion did not publish its whole output set. Deliberately not
    /// adoptable *as a set*; see [`FinalizedOutputSetAdoptionTicket`].
    NotFullyFinalized,
    /// The run never established that every sample the reader identified
    /// produced an output, so what it published is not known to be the
    /// acquisition.
    SampleCompletenessNotEstablished,
    /// The retained objects and the reported members do not line up, so no
    /// member could be paired with the object that is supposed to be its own.
    MembersDoNotPair,
}

impl OutputSetNotAdoptable {
    pub(super) const fn stable_id(self) -> &'static str {
        match self {
            Self::NotFullyFinalized => "output_set_not_fully_finalized",
            Self::SampleCompletenessNotEstablished => "output_set_completeness_not_established",
            Self::MembersDoNotPair => "output_set_members_do_not_pair",
        }
    }
}

/// One fully finalized, sample-complete conversion, retained so its whole
/// output set can be adopted later.
///
/// ## Why a set rather than a queue of ones
///
/// The single-output ticket beside this one is the right shape for everything
/// *inside* it: one object, one name, one destination, one pair of proofs. What
/// it cannot express is that these particular outputs are the outputs of one
/// acquisition, all of them, and that adopting some of them is not adopting the
/// acquisition. So this holds an ordered list of those tickets and adds only
/// the facts that are about the set: which source it came from, which run, and
/// the evidence that the set is the whole of what the reader identified.
///
/// The member tickets are the existing type, unchanged. Nothing about how one
/// output is proved differs because there are ten of them.
///
/// ## Eligibility, and the one case people will want to bend
///
/// A ticket exists only for a run that was **fully finalized** *and* whose
/// **sample completeness was established**. A partially finalized conversion
/// does not get one, and that is a decision rather than an oversight: its
/// published members are real, they are the user's files, and nothing here
/// deletes or hides them — but they are not the acquisition's output set, and
/// offering them through an action named for one would turn a conversion that
/// stopped halfway into a workflow that looks complete. Those files can be
/// opened the way any other mzML on disk is opened.
///
/// Bounded by the lifecycle's own output bound, so the vector cannot grow past
/// what one conversion may produce.
///
/// Dropping this closes the retained handles and deletes nothing.
pub(super) struct FinalizedOutputSetAdoptionTicket {
    /// The session that minted this, because the row below is named by an id
    /// only that session allocates.
    session: u64,
    /// The workspace row the acquisition was converted from.
    ///
    /// The acquisition's *display name* is not kept here: every member ticket
    /// carries its own copy, and that is the one the registry reads when it
    /// records where an adopted row came from. A second copy at set level would
    /// be a second thing to keep true.
    source: DatasetId,
    /// The family it was admitted as, so a later reader can tell what kind of
    /// acquisition produced a set rather than inferring it from the count.
    source_kind: DatasetSourceKind,
    /// This conversion, so two runs of one dataset cannot be mixed. Session
    /// scoped and never persisted; it names an event, not a thing on disk.
    run: u64,
    /// How many samples the reader identified and converted, as proved before
    /// publication. Carried because the ticket's own existence is the claim
    /// that this set is that acquisition — a reader of the ticket should be
    /// able to see what that rests on.
    sample_count: usize,
    /// One per published member, in the lifecycle's publication order.
    members: Vec<Arc<FinalizedOutputAdoptionTicket>>,
}

impl fmt::Debug for FinalizedOutputSetAdoptionTicket {
    /// Opaque but for its shape. The member tickets hold open handles and the
    /// names are the backend's; what a reader of a log needs is how many there
    /// are, not what the user's folder is called.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FinalizedOutputSetAdoptionTicket")
            .field("members", &self.members.len())
            .field("sample_count", &self.sample_count)
            // Both safe to render and both worth having in a log: a family name
            // is this application's own vocabulary, and the run is a
            // session-scoped counter that names an event and never reaches
            // disk. The row is the opaque handle every other answer already
            // carries.
            .field("source", &self.source)
            .field("source_kind", &self.source_kind)
            .field("run", &self.run)
            .finish_non_exhaustive()
    }
}

impl FinalizedOutputSetAdoptionTicket {
    /// Builds a ticket from a conversion that really happened, or refuses.
    ///
    /// Takes the whole conversion by value, because that is the whole point
    /// twice over. There is no path here from which the outputs could be found
    /// again, so a ticket assembled from names and a report would be trusting
    /// exactly what this boundary exists not to trust — and a report handed in
    /// beside *someone else's* objects would describe a run whose files it was
    /// not adopting, which counting members cannot detect.
    ///
    /// # Errors
    ///
    /// Refuses every run that is not a complete, sample-complete publication,
    /// a run of another session, and a run whose retained objects cannot be
    /// paired one-to-one with the members the report says were finalized.
    pub(super) fn of(
        session: u64,
        source_display_name: String,
        conversion: SciexConversion,
    ) -> JudgedOutputSet {
        // Before the row is looked up, because the lookup is the crossing: the
        // report names its source by an id every session allocates from zero,
        // so another session's conversion would resolve a row of *this*
        // session's and mint a perfectly self-consistent ticket for the wrong
        // acquisition. A check made afterwards would be checking a ticket that
        // is already internally consistent and already wrong.
        let ran_here = conversion.session() == session;
        let (report, retained, destination, run) = conversion.into_parts();
        let ticket = if ran_here {
            Self::judge(
                session,
                source_display_name,
                &report,
                retained,
                destination,
                run,
            )
        } else {
            Err(OutputSetNotAdoptable::MembersDoNotPair)
        };
        JudgedOutputSet {
            report,
            run,
            ticket,
        }
    }

    /// The judgement itself, over one conversion already taken apart.
    ///
    /// Private, and reached only from [`Self::of`] one line after it destroyed
    /// the value these came out of, so there is no caller who could assemble
    /// this argument list out of two runs.
    fn judge(
        session: u64,
        source_display_name: String,
        report: &WorkspaceMultiOutputConversionReport,
        retained: FinalizedOutputSet,
        destination: AdmittedDestination,
        run: u64,
    ) -> Result<Self, OutputSetNotAdoptable> {
        // The row and the family come from the report rather than from a
        // parameter, for the reason every other crossing in this boundary was
        // closed: a supplied row could be any live row, and a report that named
        // one thing while the ticket named another would persist the wrong
        // acquisition as where these files came from.
        let Some(source) = DatasetId::parse(report.dataset()) else {
            return Err(OutputSetNotAdoptable::MembersDoNotPair);
        };
        let source_kind = report.source_kind();
        if report.group_outcome() != FULLY_FINALIZED {
            return Err(OutputSetNotAdoptable::NotFullyFinalized);
        }
        let Some(completeness) = report
            .completeness()
            .and_then(SciexSampleCompleteness::established)
        else {
            return Err(OutputSetNotAdoptable::SampleCompletenessNotEstablished);
        };
        let sample_count = completeness.sample_count();

        let outputs = retained.into_outputs();
        // One object per reported member, in the same order, and every member
        // finalized. The lifecycle publishes in the order it reports, so this
        // is a check that the two agree rather than an attempt to match them
        // up: a mismatch means something about this run is not understood, and
        // pairing an object with the wrong member's name would be worse than
        // refusing.
        if outputs.len() != report.members().len()
            || outputs.len() != sample_count
            || report
                .members()
                .iter()
                .any(|member| member.state() != FINALIZED)
        {
            return Err(OutputSetNotAdoptable::MembersDoNotPair);
        }
        if outputs.len() > MAX_CONVERSION_OUTPUTS_PER_SOURCE {
            return Err(OutputSetNotAdoptable::MembersDoNotPair);
        }

        let members = report
            .members()
            .iter()
            .zip(outputs)
            .map(|(member, finalized)| {
                Arc::new(FinalizedOutputAdoptionTicket::new(
                    run,
                    source,
                    source_display_name.clone(),
                    member.file_name().to_owned(),
                    destination.clone(),
                    finalized,
                ))
            })
            .collect();

        Ok(Self {
            session,
            source,
            source_kind,
            run,
            sample_count,
            members,
        })
    }

    #[cfg(test)]
    pub(super) const fn source(&self) -> DatasetId {
        self.source
    }

    /// The session that minted this ticket.
    ///
    /// Asked by the queue before it will expand this authority into member
    /// candidates: a `DatasetId` is allocated per session from zero, so a
    /// ticket of another session would commit its outputs against whatever row
    /// happens to hold that number here.
    pub(super) const fn session(&self) -> u64 {
        self.session
    }

    #[cfg(test)]
    pub(super) const fn source_kind(&self) -> DatasetSourceKind {
        self.source_kind
    }

    #[cfg(test)]
    pub(super) const fn run(&self) -> u64 {
        self.run
    }

    #[cfg(test)]
    pub(super) const fn sample_count(&self) -> usize {
        self.sample_count
    }

    pub(super) fn len(&self) -> usize {
        self.members.len()
    }

    /// The members as adoption candidates, in publication order.
    ///
    /// Clones the `Arc`s and not the tickets: the retained objects stay in this
    /// ticket, so a second attempt after freeing workspace capacity asks the
    /// same objects the same questions.
    pub(super) fn candidates(&self) -> Vec<(usize, Arc<FinalizedOutputAdoptionTicket>)> {
        self.members.iter().cloned().enumerate().collect()
    }
}

/// file and are released by the commit rather than by the check.
pub(super) struct AdmittedOutput {
    accepted: AcceptedFile,
    /// The directory, still the admitted one. Held so the file cannot be moved
    /// out from under the row about to name it.
    root: DestinationHold,
    /// Held until the registry has the row.
    no_writers: WriterExclusion,
}

/// Everything an admitted output is holding, until its row exists.
///
/// A separate value so the commit has something to drop by name. The registry
/// takes the accepted file by value, and without this the holds would end at
/// whatever scope produced them rather than at the moment the row is real.
pub(super) struct AdmittedOutputHolds {
    _root: DestinationHold,
    _no_writers: WriterExclusion,
}

impl AdmittedOutput {
    /// Takes the file to register, and the holds to release once it is.
    ///
    /// Two values rather than one, so the caller cannot accidentally release
    /// them before the row exists: dropping the second is a statement, and it
    /// has to be written where it happens.
    pub(super) fn into_parts(self) -> (AcceptedFile, AdmittedOutputHolds) {
        (
            self.accepted,
            AdmittedOutputHolds {
                _root: self.root,
                _no_writers: self.no_writers,
            },
        )
    }
}

/// Deliberately opaque. It holds a handle, a destination and two names, and none
/// of them is something a log may carry.
impl std::fmt::Debug for FinalizedOutputAdoptionTicket {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FinalizedOutputAdoptionTicket")
            .field("output", &"<opaque-adoption-ticket>")
            .finish_non_exhaustive()
    }
}

/// Opens the final name so that nobody may write it while it is being read.
///
/// Reparse points are not followed: a link that appeared at the final name is
/// not the object this queue finalized, and following it would ask the identity
/// comparison a question about somewhere else entirely.
/// What keeps an inspected output from being written while it is admitted.
#[cfg(windows)]
pub(super) type WriterExclusion = File;

/// Nothing, elsewhere, and deliberately: this platform takes no such hold.
#[cfg(not(windows))]
pub(super) type WriterExclusion = ();

#[cfg(windows)]
fn hold_against_writers(output: &Path) -> Result<WriterExclusion, AdoptionRefusal> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_READ_DATA: u32 = 0x0000_0001;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    /// Reads only. Not deletes, and this is the one place that matters: the
    /// window this hold spans ends when the row exists, and a rename or a delete
    /// inside it would leave the registry holding a path that no longer reaches
    /// the object it just proved. Outside this window the output is entirely the
    /// user's to move or remove; ADR 0016 keeps the retention permissive for
    /// exactly that reason.
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    std::fs::OpenOptions::new()
        .read(true)
        .access_mode(FILE_READ_DATA | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(output)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => AdoptionRefusal::Missing,
            _ => AdoptionRefusal::Unreadable,
        })
}

/// No platform outside Windows offers the hold, and this one does not claim it.
#[cfg(not(windows))]
fn hold_against_writers(output: &Path) -> Result<WriterExclusion, AdoptionRefusal> {
    match std::fs::symlink_metadata(output) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(AdoptionRefusal::Missing),
        Err(_) => Err(AdoptionRefusal::Unreadable),
    }
}

/// What the workspace's own mzML admission refused, said in this vocabulary.
///
/// Admission answers with the kinds every other acquisition path uses, and most
/// of them mean the same thing here: whatever is at that name is not a file this
/// workspace takes. The two that are about reaching the file at all are kept
/// apart, because "it is gone" and "it is not mzML" are different things to be
/// told about a file MSCanvas itself wrote.
fn refusal_of(kind: &str) -> AdoptionRefusal {
    match kind {
        "file_not_resolvable" => AdoptionRefusal::Missing,
        "file_unreadable" | "source_in_use" => AdoptionRefusal::Unreadable,
        _ => AdoptionRefusal::NotMzml,
    }
}

/// What one conversion is entitled to, and the report it was judged from.
///
/// The two travel together because the judgement is *about* the report: an
/// answer of "no ticket" is only meaningful beside the outcome that explains
/// it, and a caller holding one without the other could describe a refusal with
/// somebody else's report.
pub(super) struct JudgedOutputSet {
    pub(super) report: WorkspaceMultiOutputConversionReport,
    /// The exact attempt this is about.
    pub(super) run: u64,
    pub(super) ticket: Result<FinalizedOutputSetAdoptionTicket, OutputSetNotAdoptable>,
}

/// One backend-named set attempt, settled into everything the queue keeps.
///
/// The reason this type exists is that the queue must not be handed the pieces.
/// A report, a set of retained objects, a destination, a run identity and a
/// ticket are five values that only mean anything about the *same* attempt, and
/// a settling transition that accepted them separately could be given one
/// attempt's report beside another attempt's objects — same member count, same
/// states, nothing for a check to notice.
///
/// So one owned [`SciexConversion`] goes in and one settlement comes out. The
/// eligibility judgement happens once, here, and the ticket either exists or
/// the reason it does not is recorded beside the report that explains it.
pub(super) struct SciexAttemptSettlement {
    state: ItemState,
    retryable: bool,
    report: WorkspaceMultiOutputConversionReport,
    /// Present exactly when the set published whole *and* the ticket boundary
    /// accepted it. Never rebuilt and never assembled from members.
    adoption: Option<FinalizedOutputSetAdoptionTicket>,
    /// Why there is no ticket, where the outcome might have looked entitled to
    /// one. `None` where it never was.
    not_adoptable: Option<&'static str>,
    /// This exact attempt, so a later one cannot be described by it.
    run: u64,
    diagnostics: Option<Box<BackendDiagnosticText>>,
}

impl SciexAttemptSettlement {
    /// Settles one conversion, whole and by value.
    ///
    /// Everything the queue will keep is derived here from that one value. The
    /// only things supplied beside it are the session that ran it and the
    /// display name of the row it came from, and both are facts about the
    /// session rather than about the run.
    pub(super) fn of(
        session: u64,
        source_display_name: String,
        conversion: SciexConversion,
        diagnostics: Option<Box<BackendDiagnosticText>>,
    ) -> Self {
        let JudgedOutputSet {
            report,
            run,
            ticket,
        } = FinalizedOutputSetAdoptionTicket::of(session, source_display_name, conversion);
        let outcome = report.group_outcome();
        let (adoption, not_adoptable) = match ticket {
            Ok(ticket) => (Some(ticket), None),
            Err(refusal) => (None, Some(refusal.stable_id())),
        };
        // Finalized only when the set published whole *and* the authority to
        // adopt it exists. A fully finalized group with no ticket would be an
        // item claiming success while offering nothing to take, so it is a
        // failure — and, since only the completeness gate or a pairing fault
        // can produce it, one no second attempt would change.
        let state = if outcome == FULLY_FINALIZED && adoption.is_some() {
            ItemState::Finalized
        } else if outcome == SKIPPED_EXISTING_DESTINATIONS {
            ItemState::Skipped
        } else {
            ItemState::Failed
        };
        Self {
            state,
            retryable: state == ItemState::Failed && set_outcome_is_retryable(&report),
            report,
            adoption,
            not_adoptable,
            run,
            diagnostics,
        }
    }

    pub(super) const fn state(&self) -> ItemState {
        self.state
    }

    pub(super) const fn is_retryable(&self) -> bool {
        self.retryable
    }

    pub(super) const fn report(&self) -> &WorkspaceMultiOutputConversionReport {
        &self.report
    }

    pub(super) const fn not_adoptable(&self) -> Option<&'static str> {
        self.not_adoptable
    }

    pub(super) const fn run(&self) -> u64 {
        self.run
    }

    pub(super) fn diagnostics(&mut self) -> Option<Box<BackendDiagnosticText>> {
        self.diagnostics.take()
    }

    /// The names this attempt actually put at their final names.
    ///
    /// Exactly the members the report calls finalized, which for a partial
    /// publication is the prefix and nothing more. Bounded by the lifecycle's
    /// own member bound.
    pub(super) fn published_names(&self) -> Vec<String> {
        self.report
            .members()
            .iter()
            .filter(|member| member.state() == FINALIZED)
            .map(|member| member.file_name().to_owned())
            .collect()
    }

    /// Hands the queue what it stores: the report to show and the authority to
    /// keep, together and nothing else.
    pub(super) fn into_parts(
        self,
    ) -> (
        WorkspaceMultiOutputConversionReport,
        Option<FinalizedOutputSetAdoptionTicket>,
    ) {
        (self.report, self.adoption)
    }
}

impl fmt::Debug for SciexAttemptSettlement {
    /// Shape and stable identifiers. No member name, no path, no handle.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SciexAttemptSettlement")
            .field("state", &self.state)
            .field("retryable", &self.retryable)
            .field("adoptable", &self.adoption.is_some())
            .field("not_adoptable", &self.not_adoptable)
            .finish_non_exhaustive()
    }
}

/// Whether another attempt of this set could plausibly reach a different end.
///
/// Almost nothing can, and the default is the honest one.
///
/// A set that published part of itself must never rerun: its prefix is already
/// at its final names, so a second attempt would refuse on exactly those names,
/// and there is no state in which repeating it helps. A completeness refusal is
/// a measurement of what the reader did rather than a transient condition. A
/// declaration mismatch, a member that failed validation and a mixed
/// destination conflict are all facts about what was produced.
///
/// What survives is the class of physical failure that happened before the
/// backend was launched and that the single-output classifier already calls
/// retryable for the same physical reason: the destination folder could not be
/// opened or inspected. Nothing was created and the user can fix the folder.
fn set_outcome_is_retryable(report: &WorkspaceMultiOutputConversionReport) -> bool {
    // Residue disqualifies a retry for the reason it does on the single path: a
    // staging directory this session could not reclaim is still inside the
    // destination, and another attempt would derive the same name for it.
    if report.residue().is_some() {
        return false;
    }
    match report.refusal_id() {
        Some(id) => matches!(
            id,
            "multi_output_destination_root_not_opened" | "multi_output_destination_not_inspectable"
        ),
        // Fully finalized, skipped, or partially finalized. None of the three
        // is a failure a second attempt could correct.
        None => false,
    }
}
