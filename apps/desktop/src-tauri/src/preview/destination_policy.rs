//! Where a queue's outputs go: one decision, and as many admitted objects as it
//! implies.
//!
//! [ADR 0043]'s M6.5. A destination has always been an *object* here — a
//! directory admitted by volume serial and 128-bit file ID, held while it is
//! judged, re-proved before every item. What this module adds in front of that
//! admission is the thing the product decided long before the queue existed:
//! CNV-003's three choices, and the fact that **one of them is one decision and
//! several objects**.
//!
//! ```text
//! DestinationPolicy            one user decision, bound to the plan
//!   SourceSibling              source-relative -- resolved and bound PER ITEM
//!   NamedSubfolder(name)       source-relative -- resolved per item, under the
//!                              item's SIBLING container, never inside the
//!                              acquisition
//!   CustomFolder               one chosen folder -- every item may resolve to
//!                              the SAME admitted object, and that is the
//!                              policy working rather than a special case
//! ```
//!
//! This amends [ADR 0013]'s *One destination and one policy for the whole
//! queue* and [ADR 0020]'s restatement of it, in the count and in nothing else.
//! Everything those decisions made about a destination is preserved verbatim
//! and is still made by [`super::destination::admit_destination_root`]: local,
//! a real directory, not a link, not remote, identified by object rather than
//! by name, and held for the length of the work. What changes is that the item
//! may prove a *different* admitted object where the policy resolves to one.
//!
//! **Three containment questions, three answers, and they are ordered.**
//! Collapsing them into one "the destination contains the source" rule would
//! refuse `SourceSibling` outright — for a file-shaped acquisition the sibling
//! folder *is* the file's parent, so it contains the source by construction.
//!
//! ```text
//! 1  the destination object IS the source object      -> refused, on identity
//! 2  the destination is a directory-shaped
//!    acquisition root, or lies under one              -> fails closed
//! 3  the sibling container of the logical acquisition  -> admitted
//! ```
//!
//! Row 1 is an object-identity comparison. Row 2 is an ancestry walk compared
//! by identity at each step, not a string prefix — which is what fails over
//! links, substituted drives and volume mount points. Row 3 needs no comparison
//! at all: it is what a resolved policy produced, admitted because the two rows
//! above it declined.
//!
//! Rows 1 and 2 are **currently unexercisable through an admitted vendor
//! family**: every admitted source is a regular file and every destination is a
//! directory object, and no admitted family is directory-shaped. They are
//! implemented, ordered ahead of row 3, and tested through the mechanism a
//! directory-shaped source would enter — which is the named exception ADR 0043's
//! exit criterion 4 carries from CNV-D3, and is not the same thing as admitting
//! a directory-shaped reader.
//!
//! [ADR 0013]: ../../../../../docs/architecture/adr/0013-serial-conversion-queue.md
//! [ADR 0020]: ../../../../../docs/architecture/adr/0020-first-visible-shimadzu-lcd-workflow.md
//! [ADR 0043]: ../../../../../docs/architecture/adr/0043-conversion-completion-route.md

use std::path::{Component, Path, PathBuf};

use super::destination::{
    DestinationHold, DestinationIdentity, admit_destination_root, directory_identity_of,
};
use super::dto::PreviewErrorDto;
use super::operation::AdmittedDestination;
use super::selection::DatasetId;

/// The longest a subfolder name may be, in UTF-16 code units.
///
/// Windows bounds a single path component at 255, and a name this boundary
/// cannot create is better refused with its own sentence than discovered as an
/// opaque creation failure.
const MAX_SUBFOLDER_NAME_UNITS: usize = 255;

/// One validated single path component, and never anything that could leave it.
///
/// Constructed only by [`SubfolderName::parse`], which is why the field is
/// private: a `String` that reached a `join` unchecked is exactly the
/// unrestricted path concatenation this type exists to make unrepresentable.
/// The whole point is that a caller holding one of these cannot be holding
/// `..`, `C:\elsewhere`, `a/b` or an empty name.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct SubfolderName(String);

impl std::fmt::Debug for SubfolderName {
    /// Deliberately opaque, for the reason `AdmittedDestination` is. A folder
    /// name is the user's own text -- an acquisition label, a patient study, a
    /// date -- and a `{:?}` of anything containing one would put it into a log.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("<subfolder-name>")
    }
}

impl SubfolderName {
    /// Reads one child name, or says why it is not one.
    ///
    /// **Refused rather than rewritten.** A name with a separator in it is not
    /// silently flattened and a traversal is not silently resolved: the user
    /// asked for something this boundary will not do, and quietly creating a
    /// *different* folder than the one they named is worse than saying no.
    pub(super) fn parse(requested: &str) -> Result<Self, PreviewErrorDto> {
        // **Not trimmed.** Trimming is itself the silent rewrite this refuses:
        // a name with a space at either end would produce a folder called
        // something other than what was asked for, and quietly creating a
        // different folder is exactly the outcome the paragraph above rules
        // out. Surrounding whitespace is refused, and the caller is told.
        let trimmed = requested;
        if trimmed.is_empty() || trimmed != trimmed.trim() {
            return Err(subfolder_name_unusable());
        }
        if trimmed.encode_utf16().count() > MAX_SUBFOLDER_NAME_UNITS {
            return Err(subfolder_name_unusable());
        }
        // Read as a path and required to be exactly one ordinary component.
        // This is the whole check: a rooted name, a drive prefix, a UNC share,
        // `.`, `..` and any separator all produce something other than one
        // `Normal` component, and none of them is a child of anything.
        let as_path = Path::new(trimmed);
        let mut components = as_path.components();
        let (Some(Component::Normal(only)), None) = (components.next(), components.next()) else {
            return Err(subfolder_name_unusable());
        };
        if only != std::ffi::OsStr::new(trimmed) {
            return Err(subfolder_name_unusable());
        }
        // Characters Windows will not put in a name, plus the separators the
        // component test above already refuses on every platform. Listed so the
        // refusal is this boundary's own sentence rather than a creation error
        // whose kind depends on which filesystem answered.
        if trimmed.chars().any(|character| {
            matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) || (character as u32) < 0x20
        }) {
            return Err(subfolder_name_unusable());
        }
        // **Reserved device names, refused here because Windows will not
        // refuse them there.** The usual reason `CON` is harmless as a folder
        // name is that Win32 refuses to create it -- but the parent this child
        // is joined to is the output of `canonicalize`, which is a verbatim
        // `\\?\` path, and a verbatim path bypasses exactly the layer that
        // performs device-name translation. `create_dir` would *succeed*, and
        // the user would be left with a directory Explorer, `cmd` and `rmdir`
        // cannot open, rename or delete. The Win32 rule is the name up to the
        // first dot, case-insensitively, so `CON.mzML` is the console too --
        // and the port suffix is one digit, which is why `COM10` is a folder.
        if names_a_device(trimmed) {
            return Err(subfolder_name_unusable());
        }
        // A trailing dot or space is what Win32 would drop from the name if it
        // parsed it -- and under the verbatim parent this child is joined to it
        // would *not* be dropped, so the folder would be created with a name
        // most tools then cannot address. Either way the user asked for one
        // name and would get another or an unreachable one, which is the silent
        // rewrite this refuses.
        if trimmed.ends_with('.') || trimmed.ends_with(' ') {
            return Err(subfolder_name_unusable());
        }
        Ok(Self(trimmed.to_owned()))
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

/// One bound user decision about where a queue's outputs go.
///
/// Bound to the plan when the queue is made and never reassigned — there is no
/// setter, exactly as there is none for the conflict policy and the intent. A
/// retry re-reads this value rather than deciding again, which is what makes
/// "a retry never re-resolves the policy into a different destination" a
/// property of the type rather than a promise in a comment.
///
/// **The kind may be fixed while its input is still pending**, and that is the
/// custom folder: `ConversionQueue::new` runs before the picker opens, so the
/// queue knows it is a custom-folder queue and does not yet know which folder.
/// Nothing here invents one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum DestinationPolicy {
    /// Beside the acquisition. Resolves to the sibling container of each item's
    /// logical acquisition, which is one object per distinct container.
    SourceSibling,
    /// A named child of each item's sibling container -- beside the
    /// acquisition, never inside it. That placement *is* the vendor-dataset-root
    /// rule for this policy: resolving under the acquisition would land in
    /// exactly the place row 2 fails closed on.
    NamedSubfolder(SubfolderName),
    /// One folder the user chose through the native picker. Every item may
    /// resolve to the same admitted object.
    CustomFolder,
}

impl DestinationPolicy {
    /// Reads one requested policy, or says why it is not one.
    ///
    /// The only way a request becomes a bound decision. A subfolder name is
    /// validated here rather than at creation time, so a queue is never
    /// reserved under a name this boundary would refuse to make.
    pub(super) fn from_request(
        requested: Option<&super::dto::DestinationPolicyDto>,
    ) -> Result<Self, PreviewErrorDto> {
        match requested {
            // Absent is the custom folder, which is what every request means
            // today and what the picker that follows a reservation is for.
            None | Some(super::dto::DestinationPolicyDto::CustomFolder) => Ok(Self::CustomFolder),
            Some(super::dto::DestinationPolicyDto::SourceSibling) => Ok(Self::SourceSibling),
            Some(super::dto::DestinationPolicyDto::NamedSubfolder { name }) => {
                Ok(Self::NamedSubfolder(SubfolderName::parse(name)?))
            }
        }
    }

    /// Whether resolving this policy needs a folder the user chooses.
    ///
    /// What decides whether a reservation opens a picker at all. A
    /// source-relative policy has nothing to choose: its destinations follow
    /// from the acquisitions the queue is already bound to.
    pub(super) const fn needs_a_chosen_folder(&self) -> bool {
        matches!(self, Self::CustomFolder)
    }
    /// Whether every item of a queue under this policy is bound to one object.
    ///
    /// Read by the pre-picker collision check, which is entitled to refuse two
    /// items that fold to one name **only** where the policy already proves
    /// they share a destination. Under a source-relative policy it proves
    /// nothing of the sort, and the check waits for the identities.
    pub(super) const fn shares_one_destination(&self) -> bool {
        matches!(self, Self::CustomFolder)
    }
}

/// Whether MSCanvas made the directory it is about to write into.
///
/// Tracked separately from existence, and the distinction is ownership rather
/// than emptiness: a folder that happened to be empty when it was found is
/// still the user's, and nothing here may remove it. Only a child this
/// resolution created is a candidate for cleanup, and only while removing it
/// stays safe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DestinationOwnership {
    /// Found already there. Never removed by MSCanvas, whatever happens next.
    PreExisting,
    /// Created by this resolution, after it was authorized.
    CreatedHere,
}

/// One admitted destination object.
///
/// **Ownership is deliberately not here.** Who created a directory is a fact
/// about the resolution attempt that created it, not a property of the object:
/// the same folder is `CreatedHere` for the attempt that made it and
/// `PreExisting` for every attempt afterwards. Carrying it on the binding also
/// forced the record to be taken *after* admission, which left a child that was
/// created and then refused with nothing to take it back. The attempt keeps its
/// own list instead, written where the creation is decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ResolvedDestinationBinding {
    admitted: AdmittedDestination,
}

impl ResolvedDestinationBinding {
    pub(super) const fn new(admitted: AdmittedDestination) -> Self {
        Self { admitted }
    }

    pub(super) const fn admitted(&self) -> &AdmittedDestination {
        &self.admitted
    }
}

/// Every queue item, and the admitted object it will be written into.
///
/// **Complete by construction.** There is no way to build one of these that
/// leaves an item unbound, which is what makes "no item runs against an
/// unbound destination" a property of the type rather than a check somebody
/// has to remember. A partial resolution is an `Err`, never a half-filled map.
///
/// Keyed by [`DatasetId`], which is the queue item's own stable identity —
/// deliberately not by source basename, which two items in different folders
/// share, and deliberately not by a parallel vector that can lose alignment
/// with the item list it is supposed to describe.
///
/// Several items sharing one object is ordinary: the destinations are stored
/// once and referred to by position, so a shared destination is one object
/// rather than several equal copies, and the sharing is visible.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct ItemDestinationBindings {
    /// The distinct admitted objects this policy resolved to, in first-bound
    /// order.
    destinations: Vec<ResolvedDestinationBinding>,
    /// Which of them each dataset is bound to.
    bound: Vec<(DatasetId, usize)>,
    /// The children this resolution created, newest last, each with the
    /// identity it had when it was created.
    ///
    /// Carried on the result rather than dropped at the end of the resolution,
    /// because **a caller may refuse bindings that resolved perfectly well** --
    /// a name collision the identities have only now made decidable, a slot
    /// that stopped while the objects were being proved -- and whoever refuses
    /// after a successful resolution owns taking back what it made.
    created: Vec<CreatedChild>,
}

/// A directory this resolution created, and the object it was.
///
/// **The identity is what makes removing it safe.** Everything else in this
/// module insists a folder is an object rather than a name; the one operation
/// that *deletes* something in the user's filesystem must hold to that hardest.
/// Between creating a child and taking it back there is a real interval -- more
/// admissions, more creations -- and a sync client or an installer can remove
/// the child and leave its own directory at the same path. Removing by name
/// would then remove theirs.
#[derive(Clone, PartialEq, Eq)]
struct CreatedChild {
    path: PathBuf,
    identity: Option<DestinationIdentity>,
}

impl std::fmt::Debug for CreatedChild {
    /// Opaque, for the reason every path in this module is.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("<created-child>")
    }
}

impl std::fmt::Debug for ItemDestinationBindings {
    /// Counts, never paths. This carries the children it created, and a `{:?}`
    /// of a queue would otherwise put them in a log.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ItemDestinationBindings")
            .field("destinations", &self.destinations.len())
            .field("bound", &self.bound.len())
            .field("created", &self.created.len())
            .finish()
    }
}

impl ItemDestinationBindings {
    /// The object this dataset's outputs go into, or `None` where the dataset
    /// is not one of the bound items.
    ///
    /// A caller that gets `None` must not run: the answer is that this queue
    /// never bound a destination for that item, which is a refusal rather than
    /// a default.
    pub(super) fn destination_for(
        &self,
        dataset: DatasetId,
    ) -> Option<&ResolvedDestinationBinding> {
        self.position_for(dataset)
            .and_then(|at| self.destinations.get(at))
    }

    /// Which distinct destination this dataset is bound to, as a position.
    ///
    /// The key half of the collision pair, read from the binding table rather
    /// than recovered by comparing objects. Recovering it would ask an identity
    /// question that is already answered, and answer "the destination changed"
    /// whenever the answer could not be read -- which is a different sentence
    /// from the truth, and one this queue has no reason to say.
    pub(super) fn position_for(&self, dataset: DatasetId) -> Option<usize> {
        self.bound
            .iter()
            .find(|(bound, _)| *bound == dataset)
            .map(|(_, at)| *at)
    }

    /// Every distinct admitted object this queue will write into.
    ///
    /// What a retry revalidates, and what a caller asks when it needs to prove
    /// the whole queue rather than one item.
    pub(super) fn distinct_destinations(&self) -> &[ResolvedDestinationBinding] {
        &self.destinations
    }

    /// How many items are bound. Only for assertions about completeness.
    pub(super) fn len(&self) -> usize {
        self.bound.len()
    }

    /// Takes back the children this resolution created, and only those.
    ///
    /// For a caller that resolved successfully and then refused the result
    /// anyway. Consuming, because bindings that have been reclaimed name
    /// directories that are gone and must not be run against.
    pub(super) fn reclaim_created(mut self) {
        self.reclaim_created_now();
    }

    /// The same, leaving the bindings usable and the list empty.
    ///
    /// Draining is what makes a second call a no-op: a queue that reclaimed at
    /// one terminal transition must not try again at another, and an empty list
    /// says "there is nothing of mine out there" rather than "ask again".
    pub(super) fn reclaim_created_now(&mut self) {
        let created = std::mem::take(&mut self.created);
        reclaim_created(&created);
    }

    /// Records a directory as one this resolution created.
    ///
    /// For the reclaim's own test, which has to put a *different* object at a
    /// recorded path -- the thing that happens when a sync client or an
    /// installer replaces MSCanvas's child between the resolution and its
    /// refusal. Nothing single-threaded can produce that interleaving through
    /// the resolver, so the record is made directly.
    #[cfg(all(test, windows))]
    pub(super) fn with_created(mut self, path: &Path) -> Self {
        self.created.push(CreatedChild {
            identity: directory_identity_of(path),
            path: path.to_path_buf(),
        });
        self
    }

    /// Every listed dataset bound to one object.
    ///
    /// What `CustomFolder` produces, made directly. For the slot's own unit
    /// tests, which move a queue between states without touching a filesystem:
    /// the resolution above is the production path and is exercised through the
    /// service, and this exists so a state-machine test does not have to admit
    /// a real directory to check that a transition happens.
    #[cfg(test)]
    pub(super) fn bound_to_one(
        datasets: &[DatasetId],
        destination: ResolvedDestinationBinding,
    ) -> Self {
        Self {
            destinations: vec![destination],
            bound: datasets.iter().map(|dataset| (*dataset, 0)).collect(),
            created: Vec::new(),
        }
    }

    /// Each dataset bound to its own object.
    ///
    /// The shape a source-relative policy produces where every item has its own
    /// container. For the rule's own unit tests, which state both cardinalities
    /// without needing two real volumes.
    #[cfg(test)]
    pub(super) fn bound_each(entries: &[(DatasetId, ResolvedDestinationBinding)]) -> Self {
        let mut destinations = Vec::new();
        let mut bound = Vec::with_capacity(entries.len());
        for (dataset, destination) in entries {
            let at = bind(&mut destinations, destination.clone());
            bound.push((*dataset, at));
        }
        Self {
            destinations,
            bound,
            created: Vec::new(),
        }
    }
}

/// What one item contributes to a resolution.
///
/// The **logical acquisition**, not a filesystem shape and not an arbitrary
/// member: for a SCIEX bundle the container is the primary's parent, because
/// the companion is derived from the primary's whole name in the primary's own
/// parent, so that is where the acquisition lives.
pub(super) struct ResolutionSubject {
    pub(super) dataset: DatasetId,
    /// The acquisition's primary object, as the workspace holds it.
    pub(super) source: PathBuf,
    /// The acquisition root where the acquisition is directory-shaped.
    ///
    /// `None` for every family admitted today, all of which are file-shaped.
    /// Carried rather than inferred: row 2 protects the roots the bound scope
    /// actually knows about, and guessing one from a suffix would be this
    /// boundary claiming a discovery it never made.
    pub(super) acquisition_root: Option<PathBuf>,
}

impl ResolutionSubject {
    /// The container of this logical acquisition.
    ///
    /// ```text
    /// regular file        the file's parent folder
    /// bundle              the primary's parent, where the companion lives too
    /// directory-shaped    the parent of the acquisition directory, never its
    ///                     interior
    /// ```
    fn sibling_container(&self) -> Option<PathBuf> {
        let anchor = self.acquisition_root.as_deref().unwrap_or(&self.source);
        anchor.parent().map(Path::to_path_buf)
    }
}

/// Resolves one bound policy over one bound membership, or says why it cannot.
///
/// **This is the production coordinator**, and the only one: the custom-folder
/// flow the product ships today reaches it with the folder the picker returned,
/// and a source-relative policy reaches it with none. There is no second
/// implementation for the policies that have no control yet.
///
/// `chosen` is the folder a native picker returned, and is required by
/// [`DestinationPolicy::CustomFolder`] and refused by the others — a
/// source-relative policy that arrived with a folder would be a caller
/// confusing two decisions.
///
/// Filesystem work happens **here and only here**: this is the authorized
/// resolution step. Planning, polling and summarising never reach it, so none
/// of them creates a directory.
pub(super) fn resolve_destinations(
    policy: &DestinationPolicy,
    subjects: &[ResolutionSubject],
    chosen: Option<&Path>,
) -> Result<ItemDestinationBindings, PreviewErrorDto> {
    // **A partial resolution is an error, and it takes back only what it
    // made.** A queue whose first three items resolved and whose fourth did not
    // is not a queue -- nothing runs, and the children this attempt created
    // beside three acquisitions would otherwise be empty folders the user did
    // not ask for and MSCanvas never mentions again.
    let mut created: Vec<CreatedChild> = Vec::new();
    match resolve_or_partial(policy, subjects, chosen, &mut created) {
        Ok(mut bindings) => {
            // Handed on with the result: the caller may still refuse it, and
            // then this is the list that has to be taken back.
            bindings.created = created;
            Ok(bindings)
        }
        Err(refusal) => {
            reclaim_created(&created);
            Err(refusal)
        }
    }
}

/// The resolution itself, recording what it created as it goes.
fn resolve_or_partial(
    policy: &DestinationPolicy,
    subjects: &[ResolutionSubject],
    chosen: Option<&Path>,
    created: &mut Vec<CreatedChild>,
) -> Result<ItemDestinationBindings, PreviewErrorDto> {
    if subjects.is_empty() {
        return Err(destination_not_resolvable());
    }
    let mut destinations: Vec<ResolvedDestinationBinding> = Vec::new();
    let mut bound: Vec<(DatasetId, usize)> = Vec::with_capacity(subjects.len());

    match policy {
        DestinationPolicy::CustomFolder => {
            let Some(chosen) = chosen else {
                return Err(destination_not_resolvable());
            };
            // One admission for the whole queue, and every item bound to it.
            // The safety rows are still asked, once per subject, because a
            // chosen folder may perfectly well be a source's own container --
            // which is admitted -- or inside a directory-shaped acquisition,
            // which is not.
            let admitted = admit_and_check(chosen, subjects)?;
            destinations.push(admitted);
            for subject in subjects {
                bound.push((subject.dataset, 0));
            }
        }
        DestinationPolicy::SourceSibling => {
            if chosen.is_some() {
                return Err(destination_not_resolvable());
            }
            for subject in subjects {
                let container = subject
                    .sibling_container()
                    .ok_or_else(destination_not_resolvable)?;
                let at = bind(
                    &mut destinations,
                    admit_and_check(&container, std::slice::from_ref(subject))?,
                );
                bound.push((subject.dataset, at));
            }
        }
        DestinationPolicy::NamedSubfolder(name) => {
            if chosen.is_some() {
                return Err(destination_not_resolvable());
            }
            for subject in subjects {
                let container = subject
                    .sibling_container()
                    .ok_or_else(destination_not_resolvable)?;
                // **Beside the acquisition, never inside it.** The child hangs
                // off the sibling container, which is what makes this policy
                // satisfy the vendor-dataset-root rule by placement rather than
                // by a later refusal.
                //
                // The container is admitted first: a subfolder is created only
                // under a parent this boundary has already proved is a local,
                // real, unlinked directory that is not inside an acquisition.
                // **Held across the creation.** `_parent_held` is what makes
                // the sentence above true at the moment it is relied on: the
                // container cannot be renamed or deleted out from under the
                // child while this handle is open.
                let (parent, _parent_held) =
                    admit_and_hold(&container, std::slice::from_ref(subject))?;
                let child = parent.admitted().root().join(name.as_str());
                // Existence decides ownership, and ownership decides what may
                // ever be cleaned up. Creating is authorized here because the
                // parent above passed every check; it is not authorized
                // anywhere a plan or a poll can reach.
                //
                // **The record is taken where the creation is decided**, before
                // the child is admitted -- because admitting it can fail, and a
                // child created and then refused is exactly the folder MSCanvas
                // must not leave behind without ever mentioning again.
                if matches!(ownership_of(&child), DestinationOwnership::CreatedHere) {
                    std::fs::create_dir(&child).map_err(|_| subfolder_not_created())?;
                    created.push(CreatedChild {
                        identity: directory_identity_of(&child),
                        path: child.clone(),
                    });
                }
                // The created or existing child passes the same admission as
                // any other destination. Creating it is not admitting it.
                let admitted = admit_and_check(&child, std::slice::from_ref(subject))?;
                let at = bind(&mut destinations, admitted);
                bound.push((subject.dataset, at));
            }
        }
    }

    debug_assert_eq!(bound.len(), subjects.len());
    Ok(ItemDestinationBindings {
        destinations,
        bound,
        // Filled in by `resolve_destinations`, which owns the list until it
        // knows whether this resolution succeeded.
        created: Vec::new(),
    })
}

/// Removes the children this resolution created, and only those.
///
/// **Ownership decides, and emptiness is the safety.** A folder that was
/// already there is the user's whatever it contains, and is never touched; a
/// child this attempt made is removed only while it is still empty, with
/// `remove_dir` rather than anything recursive -- so a folder something else
/// has already written into is left exactly as it is rather than taken away
/// with its contents.
///
/// A removal that does not succeed is not an error to report: the resolution
/// has already failed and the caller is being told why. What is left behind in
/// that case is an empty folder, which is visible and harmless, and it is not
/// described as nothing having changed.
fn reclaim_created(created: &[CreatedChild]) {
    // Newest first, so a child is taken back before any parent this attempt
    // also made -- `remove_dir` refuses a non-empty directory, and the reverse
    // order is what keeps that refusal from being about our own work.
    for child in created.iter().rev() {
        // **Still the object this attempt created, or it is not ours.** An
        // identity that cannot be read now, or that names a different object,
        // means whatever is at this path belongs to somebody else -- and
        // leaving a folder behind is the safe half of that answer. Emptiness is
        // still required underneath: `remove_dir` refuses a directory with
        // anything in it, so a child something has already written into stays.
        let Some(created_as) = child.identity else {
            continue;
        };
        if directory_identity_of(&child.path) != Some(created_as) {
            continue;
        }
        let _ = std::fs::remove_dir(&child.path);
    }
}

/// Whether this name is one Windows reserves for a device.
///
/// The stem is the name up to the first dot, compared case-insensitively. Port
/// numbers are a **single** character, so `COM10` is an ordinary folder -- and
/// the superscripts `\u{b9}`, `\u{b2}` and `\u{b3}` count, because Win32 accepts
/// `COM\u{b9}` as `COM1`.
fn names_a_device(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    let Some(port) = stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"))
    else {
        return false;
    };
    let mut characters = port.chars();
    let (Some(only), None) = (characters.next(), characters.next()) else {
        return false;
    };
    only.is_ascii_digit() || matches!(only, '\u{b9}' | '\u{b2}' | '\u{b3}')
}

/// Whether the child is already there, or would be this attempt's to make.
///
/// `symlink_metadata` rather than `metadata`: a link standing where the child
/// would go already exists, is the user's, and is refused by admission a moment
/// later rather than replaced here.
fn ownership_of(child: &Path) -> DestinationOwnership {
    match std::fs::symlink_metadata(child) {
        Ok(_) => DestinationOwnership::PreExisting,
        Err(_) => DestinationOwnership::CreatedHere,
    }
}

/// Files one resolved binding, sharing an object that is already there.
///
/// **Both halves of `is_still`: the canonical root and the object identity.**
/// Not identity alone -- the comparison requires the paths to match too, and
/// requires an identity to have been readable at all. That conjunction can only
/// ever split one object into two entries, never merge two into one, so the
/// collision check is conservative in the safe direction; and because every
/// root here comes from `canonicalize`, two spellings of one directory converge
/// before they are ever compared.
fn bind(
    destinations: &mut Vec<ResolvedDestinationBinding>,
    resolved: ResolvedDestinationBinding,
) -> usize {
    if let Some(at) = destinations
        .iter()
        .position(|existing| existing.admitted().is_still(resolved.admitted()))
    {
        return at;
    }
    destinations.push(resolved);
    destinations.len() - 1
}

/// Admits one directory and answers the ordered containment questions about it.
///
/// The order is the safety: row 1 and row 2 are asked before anything is
/// admitted as a sibling, so a destination that is an acquisition, or inside
/// one, is refused whichever policy proposed it.
fn admit_and_check(
    candidate: &Path,
    subjects: &[ResolutionSubject],
) -> Result<ResolvedDestinationBinding, PreviewErrorDto> {
    admit_and_hold(candidate, subjects).map(|(binding, _held)| binding)
}

/// The same admission, handing back the hold instead of dropping it.
///
/// **For the one caller that then mutates the filesystem under what it just
/// admitted.** Admission proves a container is local, real, unlinked and not
/// inside an acquisition -- and a proof released before it is relied on is a
/// window, not a proof: between the two, the container can be renamed away and
/// a junction of the same name left in its place, and the child would be
/// created under the substitute. The hold is opened without `FILE_SHARE_DELETE`
/// (see `hold_chosen_directory`), so keeping it alive across the creation is
/// what stops *this* container being renamed or deleted while the child is made
/// under it. It is not a claim about the whole path: Windows still allows an
/// ancestor of a held directory to be renamed, and `create_dir` re-resolves the
/// name it is given, so the window is closed for the object admission proved
/// and narrowed for the path above it.
pub(super) fn admit_and_hold(
    candidate: &Path,
    subjects: &[ResolutionSubject],
) -> Result<(ResolvedDestinationBinding, DestinationHold), PreviewErrorDto> {
    let (root, identity, held) = admit_destination_root(candidate)?;
    for subject in subjects {
        // Row 1 -- object aliasing, by identity rather than by a path prefix.
        // Currently unexercisable through an admitted family: every admitted
        // source is a regular file and this is a directory object, so the two
        // cannot be one object. Asked anyway, first, and by the mechanism a
        // directory-shaped source would enter.
        //
        // **This row is about directory-shaped sources, and it fails closed
        // for exactly those.** A source that is not a directory cannot be this
        // directory object, so the row is answered without a handle. Where the
        // source *is* a directory, an identity that cannot be read is **a
        // refusal, not agreement**: the row cannot be answered, and an
        // unanswered safety question is not the same as a safe one -- the rule
        // `directory_identity_of` states for its callers, and the one row 2
        // follows at every step of its walk.
        //
        // A source whose shape cannot be read at all is **not** this row's to
        // refuse. It is missing, or it is not readable, and either way it is
        // one item's problem: that item fails on its own, as it always has,
        // while the rest of the batch converts. Refusing the whole queue here
        // would trade the per-item failure isolation this boundary keeps for a
        // safety answer about a directory that is not there -- and would say
        // `destination_unprovable` about a folder the user just chose, which is
        // the wrong sentence as well as the wrong scope.
        if std::fs::symlink_metadata(&subject.source).is_ok_and(|shape| shape.is_dir()) {
            let (Some(source_identity), Some(admitted_identity)) =
                (directory_identity_of(&subject.source), identity)
            else {
                return Err(destination_unprovable());
            };
            if source_identity == admitted_identity {
                return Err(destination_is_the_source());
            }
        }
        // Row 2 -- at or under a recognised acquisition root. Fails closed,
        // and before row 3 can admit anything.
        if let Some(acquisition_root) = subject.acquisition_root.as_deref()
            && destination_is_within(&root, &held, acquisition_root)?
        {
            return Err(destination_inside_acquisition());
        }
    }
    // Row 3 needs no comparison: this is what the policy produced, admitted
    // because the two rows above declined. The hold goes to the caller, which
    // decides whether the proof still has work to do.
    Ok((
        ResolvedDestinationBinding::new(AdmittedDestination::new(root, identity)),
        held,
    ))
}

/// Whether an admitted destination is the acquisition root, or lies under it.
///
/// **An ancestry walk compared by object identity at each step**, not a string
/// prefix — which is what fails over links, substituted drives and volume mount
/// points, and which is exactly the mechanism ADR 0043 says row 2 must not use.
///
/// Termination is explicit: the walk climbs by parent until a path has no
/// parent, and it is bounded so a pathological chain cannot spin. **Inability
/// to establish ancestry is a refusal**, not evidence of safety: a step whose
/// identity cannot be read answers `Err`, and the caller refuses.
fn destination_is_within(
    destination_root: &Path,
    destination_hold: &DestinationHold,
    acquisition_root: &Path,
) -> Result<bool, PreviewErrorDto> {
    /// More components than any real path this boundary will meet, and a bound
    /// rather than a promise that `parent()` always terminates.
    const MAX_ANCESTRY_STEPS: usize = 4_096;

    // **Resolved, because the walk climbs resolved objects.** The destination
    // side starts from a canonical root -- admission canonicalizes, and refuses
    // a destination that is itself a link -- so every step above it names a
    // real directory. Reading the acquisition root without resolving it would
    // compare a junction's *own* identity against a chain that contains only
    // its target's, and the two could never meet: a destination genuinely
    // inside a junction-rooted acquisition would walk past it to the volume
    // root and be reported safe. Canonicalizing first asks about the same
    // object the walk can actually encounter.
    let Ok(resolved_root) = std::fs::canonicalize(acquisition_root) else {
        return Err(destination_unprovable());
    };
    let Some(root_identity) = directory_identity_of(&resolved_root) else {
        // The acquisition root cannot be named as an object, so nothing can be
        // shown to be outside it.
        return Err(destination_unprovable());
    };
    // The destination's own identity comes from the handle admission is already
    // holding, so the first step of the walk is the object that passed every
    // check rather than whatever the name means now.
    let mut current_identity = super::destination::identity_of_hold(destination_hold);
    let mut current = destination_root.to_path_buf();
    for _ in 0..MAX_ANCESTRY_STEPS {
        let Some(identity) = current_identity else {
            return Err(destination_unprovable());
        };
        if identity == root_identity {
            return Ok(true);
        }
        let Some(parent) = current.parent().map(Path::to_path_buf) else {
            // A path with no parent is the top of its volume. The walk
            // terminated without meeting the acquisition root, which is the
            // answer rather than the absence of one.
            return Ok(false);
        };
        if parent == current {
            return Ok(false);
        }
        current_identity = directory_identity_of(&parent);
        current = parent;
    }
    Err(destination_unprovable())
}

fn destination_not_resolvable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "destination_not_resolvable",
        "MSCanvas could not work out where these conversions should be saved.",
        true,
    )
}

fn subfolder_name_unusable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "subfolder_name_unusable",
        "That is not a folder name MSCanvas can create beside your acquisitions. Use a single \
         name with no slashes.",
        true,
    )
}

fn subfolder_not_created() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "subfolder_not_created",
        "MSCanvas could not create that folder beside the acquisition. Choose another name or \
         another destination.",
        true,
    )
}

fn destination_is_the_source() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "destination_is_the_source",
        "That destination is the acquisition itself. Choose a folder to save the converted files \
         in.",
        true,
    )
}

fn destination_inside_acquisition() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "destination_inside_acquisition",
        "MSCanvas does not write converted files inside an acquisition. Choose a folder beside it.",
        true,
    )
}

fn destination_unprovable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "destination_unprovable",
        "MSCanvas could not establish where that folder sits, so it will not write there. Choose \
         another folder.",
        true,
    )
}
