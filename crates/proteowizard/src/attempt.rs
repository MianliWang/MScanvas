//! The facts one conversion attempt establishes about itself, beside its
//! outcome.
//!
//! Three of them, and each answers a question the outcome cannot. What the
//! private staging area held is not decidable from whether an output appeared.
//! Whether a process ran is not decidable from whether process facts came back.
//! And which attempt produced a retained output is not decidable from the
//! output's name.
//!
//! Everything here is minted or observed by the boundary that invoked the
//! provider, because that is the only place the answers exist. A later reader
//! looking at a destination folder, a log line or a queue row cannot
//! reconstruct any of them.
//!
//! **What the types enforce, exactly.** Minting is `pub(crate)`, so no consumer
//! can name an attempt that never reached a provider. An observation's payload
//! can only be built by taking one, so no consumer can describe a directory it
//! did not read. The two evidence arms that carry no payload -- nothing was
//! given a directory, and what was staged took its final name -- are ordinary
//! public variants, and a consumer that constructed one would be stating a fact
//! about a run rather than reading it. Nothing stops that but the fact that
//! every value a caller receives comes from a report.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::conversion_run::{BackendRunFacts, StagedContentObservation};
use crate::process::Termination;

/// An opaque identity for one attempt that reached provider execution.
///
/// **Minted before the provider is invoked, and only then.** Not on first
/// read, not on completion, and never derived from the output's filename or
/// from the queue position -- an identity taken from either would be a second
/// spelling of a fact that already exists, and would change when a retry
/// produced a different file or when the queue was re-sorted.
///
/// An attempt that settles *before* the provider is invoked has none. That is
/// the whole of what keeps "a run happened" from being manufactured by a skip,
/// a pre-launch refusal or a stop that arrived before the launch: those
/// attempts carry `None`, and no downstream reader can invent one because
/// nothing outside this module can construct the value.
///
/// **The form is persistable and M6 keeps no store of it.** It is a fixed-width
/// value that renders to a stable 32-character lowercase hex string, so a later
/// milestone that builds a run store can keep it unchanged. This milestone
/// holds no record of one between sessions and resolves none across them, and
/// there is deliberately no parser: a value that cannot be read back cannot be
/// compared against one from another session by accident.
///
/// It does reach a file: the redacted diagnostics export the user chooses to
/// save carries it, exactly as it carries every other stable identifier about
/// an attempt. That is a document the user asked for rather than session state,
/// and saying it is "never written to disk" would be false of it.
///
/// **Uniqueness within a session is by construction**: the low half is a
/// monotonic counter that never repeats within a process, rendered through a
/// bijection, so two attempts of one session cannot collide.
///
/// **Across sessions it is an argument, not a proof.** The high half is a
/// 64-bit per-process nonce mixed from the wall clock, the process id and the
/// address of a static; two sessions colliding is improbable rather than
/// impossible. That is the right strength for what this is -- nothing
/// authorizes anything on an identity, and M6 does not resolve one across
/// sessions at all -- but a summary that called it certain would be claiming
/// more than the derivation gives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct OperationRunIdentity {
    nonce: u64,
    sequence: u64,
}

/// Mixes the bits of one value so that near-identical inputs do not produce
/// near-identical nonces.
///
/// The finalizer of SplitMix64, written out because it is four lines and the
/// alternative is a dependency for a value nothing authorizes anything on.
const fn mix(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

/// The per-process half of every identity this session mints.
///
/// Derived once, from the wall clock, the process id and the address of the
/// counter itself -- which a relocated image makes differ between two sessions
/// started in the same nanosecond. It needs to be *unlike* another session's
/// rather than unpredictable: nothing authorizes anything on the strength of an
/// identity, and the property that matters is that an identity kept from one
/// session is not silently equal to a fresh one from the next.
fn session_nonce() -> u64 {
    static NONCE: AtomicU64 = AtomicU64::new(0);
    let cached = NONCE.load(Ordering::Relaxed);
    if cached != 0 {
        return cached;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos());
    let seed = mix((nanos & u128::from(u64::MAX)) as u64)
        ^ mix((nanos >> 64) as u64)
        ^ mix(u64::from(std::process::id()))
        ^ mix(std::ptr::from_ref(&NONCE) as usize as u64);
    // Zero is the "not yet derived" marker above, so it is the one value this
    // may not produce.
    let derived = seed | 1;
    // A race here settles on whichever value lands first, and both are equally
    // valid nonces for this process. What must not happen is two *different*
    // nonces being used, so the winner is read back rather than assumed.
    match NONCE.compare_exchange(0, derived, Ordering::Relaxed, Ordering::Relaxed) {
        Ok(_) => derived,
        Err(existing) => existing,
    }
}

impl OperationRunIdentity {
    /// Mints one identity, for one attempt about to invoke the provider.
    ///
    /// Crate-private on purpose. Every caller outside this crate reads an
    /// identity off a report; none can create one, so no consumer can stamp a
    /// run onto an attempt that never launched.
    pub(crate) fn mint() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        Self {
            nonce: session_nonce(),
            sequence: NEXT.fetch_add(1, Ordering::Relaxed),
        }
    }

    /// The stable, persistable rendering: 32 lowercase hex characters.
    ///
    /// Fixed width, so a reader can tell a truncated one from a whole one, and
    /// carrying nothing a filename or a path could be read out of.
    ///
    /// The counter is mixed rather than printed. `mix` is a bijection, so
    /// uniqueness and non-reuse are exactly as strong as the counter's -- what
    /// changes is that the low half stops being this session's launch ordinal
    /// in plain hexadecimal. An identity that ends `…0001`, `…0002`, `…0003`
    /// down a queue is one whose "opaque" is a word rather than a property, and
    /// a reader who learns to count from it is relying on something no
    /// milestone promised.
    #[must_use]
    pub fn to_hex(self) -> String {
        format!("{:016x}{:016x}", self.nonce, mix(self.sequence))
    }
}

/// When a staged-content observation was taken.
///
/// Carried with every observation, because an empty snapshot says the staging
/// area was empty *at that moment* and not that the provider never wrote a
/// byte. Without the phase, an observation taken after a publication emptied
/// the directory would read exactly like one taken over a backend that
/// produced nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StagedObservationPhase {
    /// Taken after the attempt settled **without the provider being invoked**.
    ///
    /// The staging area exists -- this run created it -- and nothing was ever
    /// handed it, so a reading here says what was in a directory the converter
    /// never saw. Distinct from `BackendSettled` because that one names an
    /// execution that happened, and stamping it on an attempt that reached no
    /// provider would assert one.
    ProviderNotInvoked,
    /// Taken as soon as the backend's own execution settled, before anything
    /// was validated, published or removed. The phase at which "did the
    /// provider write anything" is actually answerable.
    BackendSettled,
    /// Taken after the staged output was judged and refused. Validation reads
    /// and removes nothing, so this sees what the backend left.
    OutputRefused,
    /// Taken after publication ran -- succeeded, failed, or stopped partway.
    /// An empty snapshot here is consistent with everything having been
    /// published and says nothing about what the backend produced.
    PublicationSettled,
}

impl StagedObservationPhase {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::ProviderNotInvoked => "provider_not_invoked",
            Self::BackendSettled => "backend_settled",
            Self::OutputRefused => "output_refused",
            Self::PublicationSettled => "publication_settled",
        }
    }
}

/// What one attempt established about its own private staging area.
///
/// The second of the five judgements, and the one that is *not* derivable from
/// any of the others. A clean teardown reports no residue at all whether the
/// directory held a half-written output or nothing at all, the
/// destination says only what was published, and exit status says neither. So
/// this is observed where the evidence still exists and carried from there.
///
/// **It is evidence and only evidence.** Nothing here decides what is removed,
/// changes a termination judgement, replaces a primary failure or authorizes
/// cleanup. An observation that fails, races or reads a directory mid-write
/// produces [`Self::Unobserved`] and changes nothing else about the attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StagedOutputEvidence {
    /// No staging area was available to observe, because none survived to be
    /// handed to a provider.
    ///
    /// Two ways that is so, and both mean the same thing to a reader: the
    /// attempt settled before a staging area was created at all, or one was
    /// created and its own setup failed, in which case teardown removed what it
    /// had built before anything was invoked. Neither gave a provider anywhere
    /// to write.
    ///
    /// Distinct from an observed empty one, and the distinction is real: this
    /// says no provider was ever given a directory, while an observed empty one
    /// says a provider had one and it stayed empty.
    NotCreated,
    /// A staging area existed and could not be read when the observation was
    /// attempted.
    ///
    /// **Unknown, and never empty.** A directory that could not be enumerated
    /// is a directory nothing was established about, and reporting that as
    /// "nothing was staged" would turn a failed read into a claim about the
    /// provider.
    Unobserved(StagedObservationPhase),
    /// Read, at the stated phase.
    Observed(StagedObservationPhase, StagedContentObservation),
    /// The staged output took its final name.
    ///
    /// Not an observation and stated as such: publication is what establishes
    /// it. The judgement's question -- was anything staged -- is settled by the
    /// object having been renamed out of staging, so no directory listing is
    /// taken on the path where a conversion simply worked.
    Published,
}

impl StagedOutputEvidence {
    /// The stable identifier for which of the four this is.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotCreated => "not_created",
            Self::Unobserved(_) => "unobserved",
            Self::Observed(..) => "observed",
            Self::Published => "published",
        }
    }

    /// When the observation was taken, where one was.
    #[must_use]
    pub const fn phase(self) -> Option<StagedObservationPhase> {
        match self {
            Self::Unobserved(phase) | Self::Observed(phase, _) => Some(phase),
            Self::NotCreated | Self::Published => None,
        }
    }

    /// The observation itself, where one was taken.
    #[must_use]
    pub const fn observation(self) -> Option<StagedContentObservation> {
        match self {
            Self::Observed(_, observation) => Some(observation),
            Self::NotCreated | Self::Unobserved(_) | Self::Published => None,
        }
    }

    /// Records an observation taken at `phase`, or that it could not be taken.
    ///
    /// The only constructor for either arm, so a caller cannot pass `None`
    /// from a failed read into a variant that means "empty".
    pub(crate) const fn of(
        phase: StagedObservationPhase,
        observed: Option<StagedContentObservation>,
    ) -> Self {
        match observed {
            Some(observation) => Self::Observed(phase, observation),
            None => Self::Unobserved(phase),
        }
    }
}

/// What the execution boundary established about this attempt's own process.
///
/// Read from the boundary that invoked the provider, and deliberately not from
/// whether a success report came back. The absence of process facts is not
/// evidence that nothing launched: a run whose streams could not be captured,
/// or whose wait could not be completed, has no facts to report and may well
/// have created a process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessAttemptOutcome {
    /// The attempt settled before the provider was invoked at all.
    ///
    /// Every refusal ahead of the launch decision, and a stop that arrived
    /// before it. Nothing was created, and this is the only variant that says
    /// so.
    NotAttempted,
    /// The provider was invoked and the boundary could not establish what
    /// became of the process.
    ///
    /// It covers both halves of that uncertainty -- a launch that may or may
    /// not have created a process, and a created process whose ending could
    /// not be read -- because a caller can act on neither, and splitting them
    /// would invite one to be rendered as the other's certainty.
    Indeterminate,
    /// A process ran and this is how it ended.
    ///
    /// The two facts are carried together because they can disagree, which is
    /// the reason [`BackendRunFacts`] carries both.
    Settled {
        termination: Termination,
        exit_code: Option<i32>,
    },
}

impl ProcessAttemptOutcome {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotAttempted => "not_attempted",
            Self::Indeterminate => "indeterminate",
            Self::Settled { .. } => "settled",
        }
    }

    /// What the boundary reported about the ending, where it reported one.
    #[must_use]
    pub const fn termination(self) -> Option<Termination> {
        match self {
            Self::Settled { termination, .. } => Some(termination),
            Self::NotAttempted | Self::Indeterminate => None,
        }
    }

    #[must_use]
    pub const fn exit_code(self) -> Option<i32> {
        match self {
            Self::Settled { exit_code, .. } => exit_code,
            Self::NotAttempted | Self::Indeterminate => None,
        }
    }

    /// The outcome of an attempt that reached the provider and got a result
    /// back.
    pub(crate) const fn of(facts: BackendRunFacts) -> Self {
        Self::Settled {
            termination: facts.termination(),
            exit_code: facts.exit_code(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minted_identities_are_distinct_and_render_at_a_fixed_width() {
        let first = OperationRunIdentity::mint();
        let second = OperationRunIdentity::mint();
        assert_ne!(first, second);
        assert_eq!(first.to_hex().len(), 32);
        assert_eq!(second.to_hex().len(), 32);
        assert!(first.to_hex().chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(first.to_hex(), second.to_hex());
    }

    #[test]
    fn every_identity_of_one_session_shares_its_nonce() {
        let first = OperationRunIdentity::mint();
        let second = OperationRunIdentity::mint();
        assert_eq!(first.nonce, second.nonce);
        assert_ne!(first.nonce, 0);
    }

    #[test]
    fn a_failed_observation_is_unknown_rather_than_empty() {
        let unknown = StagedOutputEvidence::of(StagedObservationPhase::BackendSettled, None);
        assert_eq!(unknown.stable_id(), "unobserved");
        assert_eq!(unknown.observation(), None);
        assert_eq!(
            unknown.phase(),
            Some(StagedObservationPhase::BackendSettled)
        );
        assert_ne!(unknown, StagedOutputEvidence::NotCreated);
    }

    #[test]
    fn a_missing_process_result_is_not_a_statement_that_none_ran() {
        assert_eq!(ProcessAttemptOutcome::Indeterminate.termination(), None);
        assert_ne!(
            ProcessAttemptOutcome::Indeterminate,
            ProcessAttemptOutcome::NotAttempted
        );
        assert_eq!(
            ProcessAttemptOutcome::NotAttempted.stable_id(),
            "not_attempted"
        );
    }
}
