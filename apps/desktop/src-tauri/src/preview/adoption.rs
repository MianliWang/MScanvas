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

use std::fs::File;
use std::path::Path;

use mscanvas_proteowizard::{FinalizedOutput, OutputDrift};

use super::destination::admit_destination_root;
use super::operation::AdmittedDestination;
use super::selection::{AcceptedFile, DatasetId, accept_mzml_file};

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
    pub(super) fn accept(&self) -> Result<AcceptedFile, AdoptionRefusal> {
        let root = self.current_destination_root()?;
        let output = root.join(&self.output_file_name);
        // Held for the whole of the inspection below and dropped after it. The
        // retention this ticket carries deliberately permits writers, so this is
        // what makes "the bytes are still these" true at the moment it is said
        // rather than a moment before.
        let _no_writers = hold_against_writers(&output)?;
        let accepted = accept_mzml_file(&output).map_err(|error| refusal_of(&error.kind))?;
        self.recognises(&accepted)?;
        Ok(accepted)
    }

    /// The admitted destination root, proved to still be the same directory.
    ///
    /// A root that no longer answers as the object it was admitted as is treated
    /// as the output being out of reach rather than as the output being wrong:
    /// MSCanvas does not look inside a folder it cannot show is the one it wrote
    /// to, so it has nothing to say about what is in there.
    fn current_destination_root(&self) -> Result<&Path, AdoptionRefusal> {
        let readmitted = admit_destination_root(self.destination.root())
            .map_err(|_| AdoptionRefusal::Missing)?;
        let (root, identity, _held) = readmitted;
        if self
            .destination
            .is_still(&AdmittedDestination::new(root, identity))
        {
            return Ok(self.destination.root());
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
#[cfg(windows)]
fn hold_against_writers(output: &Path) -> Result<File, AdoptionRefusal> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_READ_DATA: u32 = 0x0000_0001;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    /// Reads and deletes, but never writes. The user may still remove or rename
    /// their own file; nobody may change it underneath this reading.
    const FILE_SHARE_READ_DELETE: u32 = 0x0000_0005;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    std::fs::OpenOptions::new()
        .read(true)
        .access_mode(FILE_READ_DATA | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ_DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(output)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => AdoptionRefusal::Missing,
            _ => AdoptionRefusal::Unreadable,
        })
}

/// No platform outside Windows offers the hold, and this one does not claim it.
#[cfg(not(windows))]
fn hold_against_writers(output: &Path) -> Result<(), AdoptionRefusal> {
    match std::fs::symlink_metadata(output) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(AdoptionRefusal::Missing)
        }
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
