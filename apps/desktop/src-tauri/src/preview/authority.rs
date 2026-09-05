//! Which ProteoWizard installation this session is bound to, as a typed state.
//!
//! [ADR 0044] replaces the bare `installationGeneration` counter with three
//! things that were previously one: an *identity* the frontend compares, an
//! *ordering* token it never interprets, and a *state* that says whether a
//! verdict exists at all. The counter conflated them, and every reader supplied
//! its own meaning -- which is how a plan stamped from one reading and a catalog
//! stamped from another came to be compared for equality and disagree.
//!
//! [ADR 0044]: ../../../../../docs/architecture/adr/0044-conversion-configuration-authority.md

use std::path::PathBuf;

use super::dto::{
    BackendAuthorityProjectionDto, BackendAuthorityStateDto, BackendBindingDto,
    BackendPreviewAvailabilityDto,
};
use super::installation::InstallationIdentity;

/// Which installation a fact is about, on the wire.
///
/// Opaque, path-free, session-scoped, and equatable -- that is the whole of its
/// interface. It is not an [`InstallationIdentity`]: that is made of absolute
/// paths and must not reach the webview, and it answers a different question.
/// An identity asks *are these the same files as before*, which must survive a
/// session switching installation away and back; a receipt asks *is this the
/// binding you are rendering*, which must not.
///
/// A monotonic counter remains the implementation. What must not happen again is
/// exposing that counter and letting call sites perform arithmetic on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct BackendBindingReceipt(u64);

impl BackendBindingReceipt {
    /// The value that crosses the wire. Opaque to every reader: equality is the
    /// only operation the frontend may perform on it.
    pub(crate) const fn wire(self) -> u64 {
        self.0
    }
}

/// Which of two projections is newer.
///
/// Ordering, and nothing else. A projection with a lower revision is stale and
/// cannot replace one with a higher revision; that is the single meaning the
/// frontend is permitted to read from it. It advances when what is projected
/// changes -- a replaced binding, or a verdict that moved on an unchanged one --
/// and not otherwise, so a recheck that finds everything as it was cannot
/// invalidate anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct BackendAuthorityRevision(u64);

impl BackendAuthorityRevision {
    pub(crate) const fn wire(self) -> u64 {
        self.0
    }
}

/// Whether this session is bound to an installation it may launch.
///
/// The fact is binary because the question is: `AvailabilityState::Available` or
/// not. A `Partial` folder -- msconvert present, msaccess missing -- is
/// `NoInstallation`, and so is a mismatched pair and a timed-out probe. The
/// binding is deliberately *not* minted from `InstallationIdentity::of`
/// returning `Some`, which it does for a `Partial` build too, because that
/// identity is a content fact rather than a statement about usability.
///
/// `NoInstallation` carries a receipt like any other binding. It is not the
/// absence of one: an observed absence differs from a build, so it revokes what
/// the build's receipt bound, which is what stops a catalog outliving the
/// installation it described.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Binding {
    Installed { receipt: BackendBindingReceipt },
    NoInstallation { receipt: BackendBindingReceipt },
}

impl Binding {
    pub(crate) const fn receipt(self) -> BackendBindingReceipt {
        match self {
            Self::Installed { receipt } | Self::NoInstallation { receipt } => receipt,
        }
    }

    pub(crate) const fn is_installed(self) -> bool {
        matches!(self, Self::Installed { .. })
    }
}

/// Whether preview may run on the bound build.
///
/// A judgement about a build, so it accompanies a binding that names one. For a
/// `NoInstallation` binding it is entailed rather than judged, and the state
/// below carries it anyway so that one shape crosses the wire; every reader
/// requires `Binding::Installed` in the same conjunction, so the entailed value
/// can never be read as a claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PreviewAvailability {
    Usable,
    Unusable,
}

impl PreviewAvailability {
    pub(crate) const fn is_usable(self) -> bool {
        matches!(self, Self::Usable)
    }
}

/// The authority itself.
///
/// Two members, not three. An earlier draft of ADR 0044 added an
/// `ObservedButUnsettled` for an operation that resolves a build without
/// producing a verdict, and no such operation exists: every observation comes
/// from a `discover()` the observer is already holding, and the verdict is a
/// pure function of that same result. A binding and its verdict travel together.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BackendAuthorityState {
    /// Nothing has been observed yet, or an operation answered without reaching
    /// a discovery. No receipt is invented for it.
    Unresolved,
    Settled {
        binding: Binding,
        preview_availability: PreviewAvailability,
    },
}

impl BackendAuthorityState {
    pub(crate) const fn binding(self) -> Option<Binding> {
        match self {
            Self::Unresolved => None,
            Self::Settled { binding, .. } => Some(binding),
        }
    }
}

/// What every operation returns beside its own outcome.
///
/// The ordering and the state travel together because separating them is what
/// let a late reply about the build a session had left revoke the build it was
/// on: an opaque receipt can say two things differ, and cannot say which is
/// newer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BackendAuthorityProjection {
    pub(crate) revision: BackendAuthorityRevision,
    pub(crate) state: BackendAuthorityState,
}

/// Where a discovery looked.
///
/// Part of what a `NoInstallation` binding *is*: "bound to no installation
/// here" is a different binding from "bound to no installation there", and the
/// banner has an origin, a failure and corrective advice to tell between them.
/// Without this, two unusable candidates project identically, the revision does
/// not advance, and a recheck racing the picker can overwrite the newer folder's
/// verdict with the older one's.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) enum DiscoveryTarget {
    /// Where a session that has not been told otherwise is pointed.
    #[default]
    Automatic,
    Chosen(PathBuf),
}

impl DiscoveryTarget {
    pub(crate) fn of(configured_home: Option<PathBuf>) -> Self {
        configured_home.map_or(Self::Automatic, Self::Chosen)
    }
}

/// What one operation's discovery established.
///
/// The pair an observer already holds: the identity when the discovery was
/// `Available`, and the preview verdict computed from that same result. Passing
/// them together is what keeps a binding from arriving without its verdict.
#[derive(Debug, Clone)]
pub(crate) struct Observation {
    /// `Some` only when the discovery was `Available`. A `Partial` candidate
    /// yields an identity from `InstallationIdentity::of` and must not be
    /// admitted here.
    pub(crate) installed: Option<InstallationIdentity>,
    pub(crate) preview_availability: PreviewAvailability,
    pub(crate) target: DiscoveryTarget,
}

impl BackendAuthorityProjection {
    /// What the webview receives.
    ///
    /// The one place the typed authority becomes wire values, so a caller
    /// cannot assemble a projection out of a receipt it read from one response
    /// and a revision it read from another -- which is the join this whole type
    /// exists to remove.
    pub(crate) fn to_dto(self) -> BackendAuthorityProjectionDto {
        BackendAuthorityProjectionDto {
            revision: self.revision.wire(),
            state: match self.state {
                BackendAuthorityState::Unresolved => BackendAuthorityStateDto::Unresolved,
                BackendAuthorityState::Settled {
                    binding,
                    preview_availability,
                } => BackendAuthorityStateDto::Settled {
                    receipt: binding.receipt().wire(),
                    binding: if binding.is_installed() {
                        BackendBindingDto::Installed
                    } else {
                        BackendBindingDto::NoInstallation
                    },
                    preview_availability: if preview_availability.is_usable() {
                        BackendPreviewAvailabilityDto::Usable
                    } else {
                        BackendPreviewAvailabilityDto::Unusable
                    },
                },
            },
        }
    }
}

/// The session's authority, and the only thing that mints receipts.
#[derive(Debug, Default)]
pub(crate) struct BackendAuthority {
    state: Option<BackendAuthorityState>,
    revision: u64,
    next_receipt: u64,
    /// What the current binding was minted from, so a later observation can be
    /// compared without the receipt having to carry it.
    bound_identity: Option<InstallationIdentity>,
    bound_target: Option<DiscoveryTarget>,
}

impl BackendAuthority {
    /// The projection as it stands, for an operation that observed nothing.
    pub(crate) fn projection(&self) -> BackendAuthorityProjection {
        BackendAuthorityProjection {
            revision: BackendAuthorityRevision(self.revision),
            state: self.state.unwrap_or(BackendAuthorityState::Unresolved),
        }
    }

    /// Record what an operation's discovery established, and return the
    /// authority as it stands afterwards.
    ///
    /// The value returned is the one this observation produced, not the one it
    /// found on the way in -- a caller that records it records its own effect.
    pub(crate) fn observe(&mut self, observed: Observation) -> BackendAuthorityProjection {
        let replaced = self.binding_replaced(&observed);
        if replaced {
            self.next_receipt += 1;
            self.bound_identity = observed.installed.clone();
            self.bound_target = Some(observed.target);
        }
        let receipt = BackendBindingReceipt(self.next_receipt);
        let binding = if observed.installed.is_some() {
            Binding::Installed { receipt }
        } else {
            Binding::NoInstallation { receipt }
        };
        let state = BackendAuthorityState::Settled {
            binding,
            preview_availability: observed.preview_availability,
        };
        if self.state != Some(state) {
            self.revision += 1;
        }
        self.state = Some(state);
        self.projection()
    }

    /// Whether this observation binds something other than what is bound now.
    ///
    /// An installed build is compared by identity, so switching away and back
    /// within one session mints a new receipt both times -- correct for a
    /// *binding*, which is what the frontend is rendering, and the reason Rust's
    /// own identity comparisons keep using [`InstallationIdentity`] instead.
    ///
    /// An absence is compared by *target*: a session that stays unbound at one
    /// folder keeps one receipt however many discoveries confirm it, and moving
    /// to another folder is a different binding of nothing.
    fn binding_replaced(&self, observed: &Observation) -> bool {
        let Some(state) = self.state else {
            return true;
        };
        let Some(binding) = state.binding() else {
            return true;
        };
        match (binding.is_installed(), observed.installed.as_ref()) {
            (true, Some(identity)) => self.bound_identity.as_ref() != Some(identity),
            (false, None) => self.bound_target.as_ref() != Some(&observed.target),
            _ => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(name: &str) -> InstallationIdentity {
        InstallationIdentity::for_test(
            &PathBuf::from(format!("/{name}/msconvert.exe")),
            &PathBuf::from(format!("/{name}/msaccess.exe")),
            "3.0.0",
        )
    }

    /// Which binding a projection names, or `None` while nothing is settled.
    ///
    /// The receipt lives on the binding rather than on the state, because a
    /// state with no binding has no receipt to return -- and a helper that
    /// invented one for `Unresolved` is precisely what this type refuses to do.
    fn receipt(projection: BackendAuthorityProjection) -> Option<BackendBindingReceipt> {
        projection.state.binding().map(Binding::receipt)
    }

    fn installed(name: &str) -> Observation {
        Observation {
            installed: Some(identity(name)),
            preview_availability: PreviewAvailability::Usable,
            target: DiscoveryTarget::Automatic,
        }
    }

    fn absent(target: DiscoveryTarget) -> Observation {
        Observation {
            installed: None,
            preview_availability: PreviewAvailability::Unusable,
            target,
        }
    }

    #[test]
    fn opens_unresolved_and_invents_no_receipt() {
        let authority = BackendAuthority::default();
        let projection = authority.projection();
        assert_eq!(projection.state, BackendAuthorityState::Unresolved);
        assert_eq!(receipt(projection), None);
    }

    #[test]
    fn a_recheck_of_the_same_build_keeps_one_receipt_and_one_revision() {
        let mut authority = BackendAuthority::default();
        let first = authority.observe(installed("A"));
        let again = authority.observe(installed("A"));
        assert_eq!(receipt(first), receipt(again));
        assert_eq!(first.revision, again.revision);
    }

    #[test]
    fn a_replaced_build_replaces_the_receipt() {
        let mut authority = BackendAuthority::default();
        let a = authority.observe(installed("A"));
        let b = authority.observe(installed("B"));
        assert_ne!(receipt(a), receipt(b));
        assert!(b.revision > a.revision);
    }

    #[test]
    fn switching_away_and_back_mints_a_new_receipt() {
        // Correct for a binding, and the reason Rust's own retry admission
        // keeps comparing identities instead: the queue must still admit a
        // retry after a round trip, and a receipt cannot say that.
        let mut authority = BackendAuthority::default();
        let first = authority.observe(installed("A"));
        authority.observe(installed("B"));
        let back = authority.observe(installed("A"));
        assert_ne!(receipt(first), receipt(back));
    }

    #[test]
    fn a_build_becoming_no_build_replaces_the_receipt() {
        let mut authority = BackendAuthority::default();
        let built = authority.observe(installed("A"));
        let gone = authority.observe(absent(DiscoveryTarget::Automatic));
        assert_ne!(receipt(built), receipt(gone));
        assert!(matches!(
            gone.state.binding(),
            Some(Binding::NoInstallation { .. })
        ));
    }

    #[test]
    fn repeated_absence_at_one_target_keeps_one_receipt() {
        let mut authority = BackendAuthority::default();
        let first = authority.observe(absent(DiscoveryTarget::Automatic));
        let again = authority.observe(absent(DiscoveryTarget::Automatic));
        assert_eq!(receipt(first), receipt(again));
        assert_eq!(first.revision, again.revision);
    }

    #[test]
    fn absence_at_another_target_is_another_binding() {
        let mut authority = BackendAuthority::default();
        let automatic = authority.observe(absent(DiscoveryTarget::Automatic));
        let chosen = authority.observe(absent(DiscoveryTarget::Chosen(PathBuf::from("/pw"))));
        assert_ne!(receipt(automatic), receipt(chosen));
        assert!(chosen.revision > automatic.revision);
    }

    #[test]
    fn a_verdict_that_moves_advances_the_revision_at_one_receipt() {
        // Reachable through the msaccess help capture: discovery accepts a
        // probe on exit and metadata, and only the later capability parse
        // refuses a truncated stream.
        let mut authority = BackendAuthority::default();
        let usable = authority.observe(installed("A"));
        let unusable = authority.observe(Observation {
            preview_availability: PreviewAvailability::Unusable,
            ..installed("A")
        });
        assert_eq!(receipt(usable), receipt(unusable));
        assert!(unusable.revision > usable.revision);
    }

    #[test]
    fn an_operation_that_observes_nothing_leaves_the_authority_alone() {
        let mut authority = BackendAuthority::default();
        let observed = authority.observe(installed("A"));
        let projected = authority.projection();
        assert_eq!(observed, projected);
    }
}
