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

#[cfg(test)]
use std::fmt;
use std::fs::File;
use std::path::Path;
#[cfg(test)]
use std::sync::Arc;

use mscanvas_proteowizard::{FinalizedOutput, OutputDrift};
#[cfg(test)]
use mscanvas_proteowizard::{MAX_CONVERSION_OUTPUTS_PER_SOURCE, SciexSampleCompleteness};

use super::destination::{DestinationHold, admit_destination_root};
use super::operation::AdmittedDestination;
#[cfg(test)]
use super::selection::DatasetSourceKind;
use super::selection::{AcceptedFile, DatasetId, accept_mzml_file};
#[cfg(test)]
use super::service::SciexConversion;

/// The group outcome a set must have to be adoptable, by the lifecycle's own
/// name for it.
#[cfg(test)]
const FULLY_FINALIZED: &str = "fully_finalized";

/// The member state every member of such a set must be in.
#[cfg(test)]
const FINALIZED: &str = "finalized";

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
#[cfg(test)]
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

#[cfg(test)]
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
#[cfg(test)]
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

#[cfg(test)]
impl fmt::Debug for FinalizedOutputSetAdoptionTicket {
    /// Opaque but for its shape. The member tickets hold open handles and the
    /// names are the backend's; what a reader of a log needs is how many there
    /// are, not what the user's folder is called.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FinalizedOutputSetAdoptionTicket")
            .field("members", &self.members.len())
            .field("sample_count", &self.sample_count)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
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
    /// and refuses a run whose retained objects cannot be paired one-to-one
    /// with the members the report says were finalized.
    pub(super) fn of(
        session: u64,
        source: DatasetId,
        source_display_name: String,
        source_kind: DatasetSourceKind,
        conversion: SciexConversion,
    ) -> Result<Self, OutputSetNotAdoptable> {
        let run = conversion.run();
        let destination = conversion.destination().clone();
        let SciexConversion {
            report, retained, ..
        } = conversion;
        let report = &report;
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

    pub(super) const fn source(&self) -> DatasetId {
        self.source
    }

    /// The session that minted this ticket.
    pub(super) const fn session(&self) -> u64 {
        self.session
    }

    pub(super) const fn source_kind(&self) -> DatasetSourceKind {
        self.source_kind
    }

    pub(super) const fn run(&self) -> u64 {
        self.run
    }

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
