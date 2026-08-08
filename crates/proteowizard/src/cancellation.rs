//! A cancellation request bound to one conversion attempt.
//!
//! This is deliberately not a task framework. It expresses one thing — that a
//! caller has asked for the conversion attempt it created this object for to
//! stop — and it expresses it in the narrowest shape the evidence supports:
//!
//! - the request moves once, from not requested to requested, and never back;
//! - the object that a run consumes is not `Clone`, so it cannot be handed to a
//!   second run and cannot control one;
//! - the handle a caller keeps can only make the request, never read a path, a
//!   handle or a process identifier, and never register a callback;
//! - nothing here serializes, and `Debug` says nothing about the state, because
//!   a cancellation object is not evidence and must not read as though it were.
//!
//! What actually stops a process is the owned Windows Job Object the reviewed
//! process boundary already establishes. This type only carries the request to
//! it.

use std::fmt;

use crate::process::CancellationToken;

/// The cancellation request for exactly one conversion attempt.
///
/// A run takes this by value. That is the whole enforcement of "one request
/// belongs to one attempt": once a run has consumed it there is no second run
/// it could be given to, and there is no way to reset it and start again.
///
/// Creating one costs nothing and requests nothing. A conversion run given one
/// that was never asked to cancel behaves exactly as a run with no cancellation
/// object at all.
#[derive(Default)]
pub struct ConversionCancellation {
    token: CancellationToken,
}

impl ConversionCancellation {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The handle a caller keeps in order to ask this attempt to stop.
    ///
    /// It may be cloned and moved to another thread, because the thread that
    /// decides to cancel is never the thread running the conversion. Every
    /// clone refers to this attempt and to no other.
    #[must_use]
    pub fn request_handle(&self) -> CancellationRequest {
        CancellationRequest {
            token: self.token.clone(),
        }
    }

    /// The process-boundary token this request carries. Crate-internal: the
    /// process boundary owns process-tree termination and this type does not
    /// re-describe it.
    pub(crate) const fn token(&self) -> &CancellationToken {
        &self.token
    }

    pub(crate) fn is_requested(&self) -> bool {
        self.token.is_cancelled()
    }
}

/// Opaque. A cancellation object is not evidence about a run, and printing its
/// state would invite it to be read as one.
impl fmt::Debug for ConversionCancellation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConversionCancellation")
            .finish_non_exhaustive()
    }
}

/// A handle that can ask one conversion attempt to stop, and can do nothing
/// else.
///
/// Cloning it produces another way to make the same request, never a way to
/// make a different one. There is no way back: a request already made cannot be
/// withdrawn, because the process it stops cannot be un-terminated and a
/// withdrawable request would invite callers to pretend otherwise.
#[derive(Clone)]
pub struct CancellationRequest {
    token: CancellationToken,
}

impl CancellationRequest {
    /// Asks the attempt this handle belongs to to stop. Repeating it changes
    /// nothing and is not an error.
    pub fn request(&self) {
        self.token.cancel();
    }

    /// Whether the request has been made. This says nothing about whether the
    /// run has acted on it; only a run's own result can say that.
    #[must_use]
    pub fn is_requested(&self) -> bool {
        self.token.is_cancelled()
    }
}

impl fmt::Debug for CancellationRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CancellationRequest")
            .finish_non_exhaustive()
    }
}

/// When a run observed the request, relative to its own beginning.
///
/// The two are not degrees of the same thing. `BeforeRun` is decided by the run
/// before it inspects, creates, plans or launches anything, so it is a
/// statement that none of that happened. `DuringRun` is everything else, and
/// it is deliberately not a statement about how far the run got.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancellationObservation {
    /// The request was already made when the attempt began. Nothing was
    /// inspected, created, planned or launched, so there was no process tree to
    /// terminate and no staging area to clean.
    BeforeRun,
    /// The request arrived after the attempt had begun, and nothing more.
    ///
    /// It covers everything from a request that landed while the acquisition
    /// was still being rehashed — no staging area, no command, no process — to
    /// one that terminated a backend mid-write. **It is not evidence that a
    /// staging area existed or that a process ran.** Those are separate facts
    /// and the report carries them separately: whether a backend ran is
    /// `backend_was_run`, and what the staging area held is
    /// `staged_content`, which is absent when there was none.
    DuringRun,
}

impl CancellationObservation {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::BeforeRun => "cancelled_before_run",
            Self::DuringRun => "cancelled_during_run",
        }
    }
}

#[cfg(test)]
mod tests {
    use std::thread;

    use super::*;

    #[test]
    fn a_fresh_request_is_not_requested() {
        let cancellation = ConversionCancellation::new();

        assert!(!cancellation.is_requested());
        assert!(!cancellation.request_handle().is_requested());
    }

    #[test]
    fn a_request_moves_once_and_repeating_it_changes_nothing() {
        let cancellation = ConversionCancellation::new();
        let handle = cancellation.request_handle();

        handle.request();
        assert!(cancellation.is_requested());
        handle.request();
        handle.request();

        assert!(cancellation.is_requested());
        assert!(handle.is_requested());
    }

    #[test]
    fn every_handle_of_one_attempt_reaches_that_attempt() {
        let cancellation = ConversionCancellation::new();
        let first = cancellation.request_handle();
        let second = cancellation.request_handle();
        let cloned = first.clone();

        cloned.request();

        assert!(first.is_requested());
        assert!(second.is_requested());
        assert!(cancellation.is_requested());
    }

    #[test]
    fn a_handle_cannot_reach_another_attempt() {
        let first = ConversionCancellation::new();
        let second = ConversionCancellation::new();

        first.request_handle().request();

        assert!(first.is_requested());
        assert!(!second.is_requested());
        assert!(!second.request_handle().is_requested());
    }

    #[test]
    fn a_request_crosses_a_thread_boundary() {
        let cancellation = ConversionCancellation::new();
        let handle = cancellation.request_handle();

        thread::spawn(move || handle.request())
            .join()
            .expect("requesting thread");

        assert!(cancellation.is_requested());
    }

    #[test]
    fn debug_says_nothing_about_the_state() {
        let cancellation = ConversionCancellation::new();
        let handle = cancellation.request_handle();
        handle.request();

        let rendered = format!("{cancellation:?} {handle:?}");

        assert!(rendered.contains("ConversionCancellation"));
        assert!(rendered.contains("CancellationRequest"));
        assert!(!rendered.contains("true"));
        assert!(!rendered.contains("false"));
    }

    #[test]
    fn each_observation_has_its_own_identifier() {
        assert_eq!(
            CancellationObservation::BeforeRun.stable_id(),
            "cancelled_before_run"
        );
        assert_eq!(
            CancellationObservation::DuringRun.stable_id(),
            "cancelled_during_run"
        );
        assert_ne!(
            CancellationObservation::BeforeRun.stable_id(),
            CancellationObservation::DuringRun.stable_id()
        );
    }
}
