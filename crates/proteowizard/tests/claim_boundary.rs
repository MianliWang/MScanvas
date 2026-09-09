//! What a crate downstream of this one may do with the cancellation claim.
//!
//! An integration test is compiled as a separate crate that links this one the
//! way any consumer does, so what it can reach is what a consumer can reach.
//! That is the point of putting this here rather than in the library: a
//! `#[cfg(test)]` module inside the crate can name everything, and would prove
//! nothing about the boundary.
//!
//! **The negative half is not written here.** A downstream crate that names
//! `OwnedTreeDisposition::ConfirmedGone` or calls `OwnedTreeDisposition::of`
//! does not compile, so it cannot be a test in a suite that has to compile. It
//! is measured instead by a two-crate probe whose recorded `rustc` diagnostics
//! are part of this milestone's evidence; what this file pins is that closing
//! those two doors left the read-only API a consumer actually uses open.

use mscanvas_proteowizard::OwnedTreeDisposition;

/// A consumer reads the judgement, and reads it exhaustively.
///
/// Every predicate and identifier the desktop crate depends on is reachable
/// from outside, and the two members that describe no confirmed tree are
/// nameable — only the affirmative one is not.
#[test]
fn a_consumer_reads_every_disposition_it_is_given() {
    let none_launched = OwnedTreeDisposition::NoneLaunched;
    let unconfirmed = OwnedTreeDisposition::Unconfirmed;

    assert_eq!(none_launched.stable_id(), "none_launched");
    assert_eq!(unconfirmed.stable_id(), "unconfirmed");

    assert!(none_launched.no_owned_process_survives());
    assert!(!unconfirmed.no_owned_process_survives());

    assert!(!none_launched.confirms_a_terminated_tree());
    assert!(!unconfirmed.confirms_a_terminated_tree());
}

/// A consumer may branch on the affirmative member without being able to make
/// one.
///
/// `#[non_exhaustive]` on a unit variant refuses `OwnedTreeDisposition::ConfirmedGone`
/// in an expression *and* in a pattern; the struct pattern below is what stays
/// legal. Reading a judgement is not making one, and the boundary is deliberately
/// on the making: a queue that could not ask "was this the confirmed one?" could
/// not render what it was told.
#[test]
fn a_consumer_may_match_the_affirmative_member_without_constructing_it() {
    let given = OwnedTreeDisposition::Unconfirmed;
    assert!(!matches!(given, OwnedTreeDisposition::ConfirmedGone { .. }));

    // And a wildcard arm still covers it, which is what every consumer that
    // renders a disposition actually writes.
    let rendered = match given {
        OwnedTreeDisposition::NoneLaunched => "nothing was launched",
        OwnedTreeDisposition::Unconfirmed => "not confirmed",
        _ => "confirmed gone",
    };
    assert_eq!(rendered, "not confirmed");
}
