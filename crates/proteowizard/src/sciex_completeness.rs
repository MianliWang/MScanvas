//! Whether every sample the SCIEX reader identified actually became an output.
//!
//! ## The claim this module exists to make, and the one it replaces
//!
//! [ADR 0022](../../../docs/architecture/adr/0022-sciex-wiff-source-admission.md)
//! recorded a gap and refused to paper over it: a conversion can finish
//! `fully_finalized` — every discovered member validated, published and equal
//! to the set the backend declared — while the acquisition it came from had
//! more samples than that. The boundary could say *what it published*. It could
//! not say *that it published everything*.
//!
//! That is not a theoretical worry. Measured on the evidenced build, with one
//! sample's own streams zeroed inside a copy of a real ten-sample acquisition
//! and every other byte of the container left identical: `msconvert` exits
//! **0**, declares **nine** outputs, writes **nine**, and the tenth sample is
//! simply absent. Declaration equals discovery. Every member validates. Nothing
//! anywhere says a sample was lost.
//!
//! ## Why this is an audit and not a manifest
//!
//! The stronger design would compare the acquisition's own sample list against
//! what was produced. It was looked for first and it is not available: no
//! executable shipped in this installation will enumerate a WIFF's samples
//! without converting it. `msaccess -x metadata` takes the reader's *single*-run
//! overload and reports one run with an empty sample list; `--verbose` adds
//! nothing; and `--runIndexSet` filters the vector the reader already returned,
//! so it counts samples that *read successfully* — the very thing in question.
//! Reading the sample table out of the container would mean a FAT-walking
//! compound-file parser this boundary deliberately does not have.
//!
//! So the proof runs the other way round: rather than counting what should have
//! happened, it establishes that **nothing was lost**.
//!
//! ## The proof, link by link
//!
//! At the evidenced source revision `47b13cfec55265af32055720a6c07b9d5bbed721`,
//! `Reader_ABI::read`'s multi-sample overload is
//!
//! ```text
//! sampleCount = getSampleCount()
//! for i in 1..=sampleCount:
//!     try   { ...; results.push_back(...) }
//!     catch (exception& e) { cerr << "[Reader_ABI::read] Error opening run " << i << ... }
//! ```
//!
//! 1. **The loop visits every enumerated sample.** No `break`, no early return,
//!    no conditional skip.
//! 2. **A sample can be lost in exactly one way while the loop continues:** the
//!    inner catch. It emits [`PER_SAMPLE_FAILURE_MARKER`] unconditionally,
//!    before continuing — there is no silent `continue` anywhere in the body.
//! 3. **A failure the inner catch does not take is not a silent skip either.**
//!    It catches `std::exception`; anything else reaches the outer `catch (...)`
//!    and is *rethrown*, which fails the whole file rather than one sample.
//! 4. **A sample lost after reading is not silent.** Writing is the driver's
//!    loop, and a write failure prints `Error writing run` and makes the process
//!    exit non-zero — measured, and refused by the lifecycle long before here.
//! 5. **Nothing else in the shipped executable can skip a sample.** Its whole
//!    `Reader_ABI` string vocabulary was extracted from the exact binary: one
//!    per-sample marker, two `unhandled exception` strings that are thrown
//!    rather than swallowed, and three `fillInMetadata` warnings that do not
//!    skip anything.
//!
//! ## The proof is a conjunction, and three of its links already existed
//!
//! Reading the error stream is necessary and **not** sufficient, because two of
//! the ways a sample can vanish emit nothing at all. Both were found by tracing
//! the driver rather than the reader, and both are already refused — by guards
//! this slice did not add and does not weaken:
//!
//! - **A silent overwrite.** `fillInMetadata` leaves `msd.id` at the bare file
//!   basename when a sample's name is a substring of it, so two such samples
//!   are written to *one* path and the second overwrites the first. Measured:
//!   ten samples, ten `writing output file:` lines naming nine distinct paths,
//!   nine files, exit 0, stderr empty. The declared-set comparison ADR 0022
//!   added for injected members refuses it — ten declared against nine
//!   discovered — and nothing publishes.
//! - **A sample whose index comes out empty.** An mzML is still written, with
//!   no records. Output-only validation refuses a document with no records at
//!   all, so the set is refused whole.
//!
//! Two more links come free: a *write* failure prints `Error writing run` and
//! makes the process exit non-zero, and a run where every sample failed leaves
//! an empty staging directory that discovery already refuses.
//!
//! So completeness is established only when all of these hold, and this module
//! owns the last two:
//!
//! | # | Link | Enforced by |
//! | - | ---- | ----------- |
//! | 1 | the backend exited cleanly | the lifecycle, before this |
//! | 2 | the declared set equals the discovered set | ADR 0022's declaration check |
//! | 3 | every member validated and published | the output-set lifecycle |
//! | 4 | the error stream is complete and carries no per-sample marker | here |
//! | 5 | the argv asked for no subset | here |
//!
//! ## What it still does not say
//!
//! Nothing about **fidelity**. Sample completeness and source fidelity are
//! different claims and this module makes only the first. An output judged
//! `output_only` is still not fully verified, and nothing here changes that.
//!
//! Nothing about samples the reader never identified — and that limit is
//! sharper than it sounds, so it is stated rather than implied. At this
//! revision `getSampleCount()` *is* `getSampleNames().size()`, and
//! `getSampleNames()` is however many names the vendor library returned. The
//! one reconciliation that would have caught a short list — comparing it with
//! the vendor's own sample count — is commented out upstream, directly beneath
//! a comment observing that some files have more samples than sample names.
//!
//! So the enumerated set is the provider's statement of what it intends to
//! process, and this boundary has no independent reading of the container to
//! check it against. Completeness here means *the reader lost none of what it
//! identified*. It does not mean the reader identified everything, and no
//! evidence available to this boundary could make it mean that.

use crate::capability::Sha256Digest;

/// The exact bytes the reader prints when it loses one sample and carries on.
///
/// Byte-level and ASCII, which is what makes the search sound: the vendor's own
/// message follows on the same line and is localized — measured, it arrived as
/// UTF-8 Chinese on this machine — so a scan that had to decode the stream
/// first would be deciding about encodings when its actual question is whether
/// a fixed ASCII sentinel is present. This one is not, and cannot be, affected
/// by what the vendor library says after it.
///
/// Bound to the evidenced build and not to ProteoWizard in general. It is a
/// string literal in one executable whose digest a provider-evidence row pins,
/// not a documented interface, and the row is what keeps a build with different
/// wording from ever reaching this code.
pub(crate) const PER_SAMPLE_FAILURE_MARKER: &[u8] = b"[Reader_ABI::read] Error opening run ";

/// Other things this reader says when it is in trouble.
///
/// Both are thrown rather than swallowed, so a run that emitted one should
/// already have failed on its exit code. They are searched for anyway. The cost
/// of looking is nothing and the alternative is a boundary whose completeness
/// answer depends on a failure path continuing to behave the way it does today.
pub(crate) const READER_FAILURE_MARKERS: [&[u8]; 2] = [
    b"[Reader_ABI::read()] unhandled exception",
    b"[Reader_ABI::readIds()] unhandled exception",
];

/// The option that would make the driver convert a subset on purpose.
///
/// Measured: `--runIndexSet 0-4` on the ten-sample acquisition produces five
/// outputs, exits 0 and prints nothing to stderr. That is the one way this
/// audit's reasoning could be defeated without any failure occurring, so the
/// argv is checked rather than assumed. This crate's set-command builder never
/// emits it; the check is what makes that a fact about the run instead of a
/// fact about the builder as it is written today.
pub(crate) const RUN_FILTER_OPTION: &str = "--runIndexSet";

/// Why sample completeness could not be established.
///
/// Path-free and text-free, like every other refusal this crate publishes. A
/// count is the most any variant carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleCompletenessRefusal {
    /// At least one sample the reader identified did not become an output.
    SampleFailureObserved { failed: usize },
    /// The error stream was cut short, so the absence of a marker in what was
    /// captured says nothing about what was not.
    AuditTruncated,
    /// The reader reported a failure this boundary cannot classify as
    /// per-sample or whole-file. Refused rather than assumed harmless.
    UnrecognizedReaderFailure,
    /// The run asked the backend to convert a subset of the samples, so fewer
    /// outputs than samples is expected rather than evidence of loss — and
    /// completeness is not a claim this boundary can make about it.
    OutputFilteringRequested,
    /// The backend did not exit cleanly, so nothing downstream of the exit code
    /// is worth auditing.
    BackendDidNotCompleteCleanly,
    /// No published member, so there is nothing this could be a statement
    /// about.
    NoPublishedMembers,
    /// The output set did not reach its destination whole, so whether the
    /// acquisition converted completely is not a question this run answers.
    SetNotFullyPublished,
}

impl SampleCompletenessRefusal {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::SampleFailureObserved { .. } => "source_sample_failure_observed",
            Self::AuditTruncated => "source_sample_audit_truncated",
            Self::UnrecognizedReaderFailure => "source_sample_audit_unrecognized",
            Self::OutputFilteringRequested => "source_sample_output_filtering_requested",
            Self::BackendDidNotCompleteCleanly => "source_sample_backend_incomplete",
            Self::NoPublishedMembers => "source_sample_no_published_members",
            Self::SetNotFullyPublished => "source_sample_set_not_fully_published",
        }
    }
}

/// Sample completeness, established.
///
/// There is no public constructor and no public field. The only way to obtain
/// one is [`audit_sample_completeness`], which means the value cannot be
/// assembled by a caller who merely believes the run went well — which is
/// exactly what a `bool` here would have permitted.
///
/// It carries what it was proved from, so that a report holding one can be
/// read back to the evidence: the method that proved it, the count it is about,
/// and the exact executable it is a statement for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EstablishedSampleCompleteness {
    method: &'static str,
    sample_count: usize,
    executable_sha256: Sha256Digest,
}

/// The name and version of the proof, carried in the value it produces.
///
/// Versioned because the proof is an argument about one reader's control flow,
/// and an argument that changes is a different claim. A stored value naming
/// `v1` is a statement about the reasoning recorded in this module today.
const PROOF_METHOD: &str = "reader_error_audit_v1";

impl EstablishedSampleCompleteness {
    /// How this was proved.
    #[must_use]
    pub const fn method(&self) -> &'static str {
        self.method
    }

    /// How many samples the reader identified and converted.
    ///
    /// Equal to the number of published members, and that equality is the
    /// proof's conclusion rather than its assumption: the audit establishes
    /// that no identified sample was lost, so what was published is what was
    /// identified.
    #[must_use]
    pub const fn sample_count(&self) -> usize {
        self.sample_count
    }

    /// The exact executable this is a statement about.
    #[must_use]
    pub const fn executable_sha256(&self) -> Sha256Digest {
        self.executable_sha256
    }
}

/// What the audit concluded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SciexSampleCompleteness {
    Established(EstablishedSampleCompleteness),
    NotEstablished(SampleCompletenessRefusal),
}

impl SciexSampleCompleteness {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::Established(_) => "source_sample_completeness_established",
            Self::NotEstablished(refusal) => refusal.stable_id(),
        }
    }

    #[must_use]
    pub const fn established(&self) -> Option<&EstablishedSampleCompleteness> {
        match self {
            Self::Established(evidence) => Some(evidence),
            Self::NotEstablished(_) => None,
        }
    }

    #[must_use]
    pub const fn refusal(&self) -> Option<SampleCompletenessRefusal> {
        match self {
            Self::Established(_) => None,
            Self::NotEstablished(refusal) => Some(*refusal),
        }
    }
}

/// Everything the pre-publication examination is allowed to look at.
///
/// Gathered into one value so a call site cannot supply half of it. The error
/// stream is borrowed rather than owned: this is raw backend output, it is
/// judged while it is still the process boundary's private capture, and nothing
/// here keeps a byte of it.
pub(crate) struct BackendSampleEvidence<'a> {
    pub(crate) stderr: &'a [u8],
    pub(crate) stderr_truncated: bool,
    pub(crate) exited_cleanly: bool,
    pub(crate) argv_requests_filtering: bool,
    pub(crate) executable_sha256: Sha256Digest,
}

/// Proof that the completed backend run carries no sign of a lost sample.
///
/// The only way to obtain one is [`examine_backend_evidence`], and the only
/// thing it can become is an [`EstablishedSampleCompleteness`]. That is the
/// point: the positive state cannot be assembled by a caller who merely
/// believes the run went well, which is exactly what a `bool` here would have
/// permitted, and it cannot be assembled *before* the evidence was examined.
///
/// It deliberately does not carry a sample count. What the audit establishes is
/// that nothing was lost; how many there were is the publication's answer, and
/// the two are joined by [`Self::with_published_members`] only once publication
/// has actually happened.
#[must_use]
pub(crate) struct NoSampleLoss {
    executable_sha256: Sha256Digest,
}

impl NoSampleLoss {
    /// Completes the proof with what was published.
    ///
    /// Called only after a fully finalized run, because that is what makes the
    /// published count equal to the identified count: the audit says none of
    /// the identified samples was lost, and full finalization says every
    /// surviving member reached its destination.
    pub(crate) const fn with_published_members(self, published: usize) -> SciexSampleCompleteness {
        if published == 0 {
            // Nothing to be complete about. Unreachable through the lifecycle,
            // which refuses an empty output set long before here, and answered
            // rather than asserted so this type has no panicking path at all.
            return SciexSampleCompleteness::NotEstablished(
                SampleCompletenessRefusal::NoPublishedMembers,
            );
        }
        SciexSampleCompleteness::Established(EstablishedSampleCompleteness {
            method: PROOF_METHOD,
            sample_count: published,
            executable_sha256: self.executable_sha256,
        })
    }
}

/// Judges, before anything is published, whether the run shows a lost sample.
///
/// Fail-closed in every direction. Any reason the evidence might be incomplete
/// — a cut-off stream, an unclassifiable reader failure, a run that asked for a
/// subset, a backend that did not exit cleanly — is a refusal rather than a
/// weaker positive.
pub(crate) fn examine_backend_evidence(
    evidence: &BackendSampleEvidence<'_>,
) -> Result<NoSampleLoss, SampleCompletenessRefusal> {
    use SampleCompletenessRefusal as Refusal;

    if !evidence.exited_cleanly {
        return Err(Refusal::BackendDidNotCompleteCleanly);
    }
    if evidence.argv_requests_filtering {
        return Err(Refusal::OutputFilteringRequested);
    }

    // Counted before truncation is considered, so a stream that was cut short
    // *and* already shows a failure reports the failure. Both are refusals; the
    // one that says a sample was lost is the more useful of the two to read.
    let failed = count_occurrences(evidence.stderr, PER_SAMPLE_FAILURE_MARKER);
    if failed > 0 {
        return Err(Refusal::SampleFailureObserved { failed });
    }
    for marker in READER_FAILURE_MARKERS {
        if count_occurrences(evidence.stderr, marker) > 0 {
            return Err(Refusal::UnrecognizedReaderFailure);
        }
    }

    // Only now. An absent marker in a stream that was cut short is not evidence
    // of an absent failure, and this is the direction that would be easiest to
    // get wrong: the whole proof is negative, so it rests entirely on having
    // seen all of the stream there was.
    if evidence.stderr_truncated {
        return Err(Refusal::AuditTruncated);
    }

    Ok(NoSampleLoss {
        executable_sha256: evidence.executable_sha256,
    })
}

/// How many times a byte sequence occurs, counting overlaps out.
///
/// A plain byte scan over the raw stream. Nothing is decoded, split into lines
/// or normalised first: the marker is ASCII and the text around it is the
/// vendor's own localized message, so decoding would introduce a question the
/// search does not need to ask and could fail on.
fn count_occurrences(haystack: &[u8], needle: &[u8]) -> usize {
    if needle.is_empty() || haystack.len() < needle.len() {
        return 0;
    }
    let mut count = 0;
    let mut at = 0;
    while at + needle.len() <= haystack.len() {
        if &haystack[at..at + needle.len()] == needle {
            count += 1;
            at += needle.len();
        } else {
            at += 1;
        }
    }
    count
}

/// Whether an argv asks the backend to convert only some of the runs.
pub(crate) fn argv_requests_filtering<S: AsRef<std::ffi::OsStr>>(args: &[S]) -> bool {
    args.iter()
        .any(|argument| argument.as_ref() == std::ffi::OsStr::new(RUN_FILTER_OPTION))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIGEST: Sha256Digest = Sha256Digest::from_bytes([0x5C; 32]);

    fn input(stderr: &[u8]) -> BackendSampleEvidence<'_> {
        BackendSampleEvidence {
            stderr,
            stderr_truncated: false,
            exited_cleanly: true,
            argv_requests_filtering: false,
            executable_sha256: DIGEST,
        }
    }

    /// The whole judgement: examine, then complete with what was published.
    fn verdict(evidence: &BackendSampleEvidence<'_>, published: usize) -> SciexSampleCompleteness {
        match examine_backend_evidence(evidence) {
            Ok(proof) => proof.with_published_members(published),
            Err(refusal) => SciexSampleCompleteness::NotEstablished(refusal),
        }
    }

    #[test]
    fn a_clean_untruncated_stream_establishes_completeness() {
        let verdict = verdict(&input(b""), 10);
        let evidence = verdict.established().expect("a clean run is complete");
        assert_eq!(evidence.sample_count(), 10);
        assert_eq!(evidence.method(), "reader_error_audit_v1");
        assert_eq!(evidence.executable_sha256(), DIGEST);
    }

    #[test]
    fn one_marker_is_one_lost_sample() {
        // The exact shape the evidenced build emits, localized tail included.
        let stderr = "[Reader_ABI::read] Error opening run 5 in \"E.wiff\":\r\n\
             [ExperimentImpl::ctor()] 索引超出范围。\r\n"
            .as_bytes();
        assert_eq!(
            verdict(&input(stderr), 10).refusal(),
            Some(SampleCompletenessRefusal::SampleFailureObserved { failed: 1 })
        );
    }

    #[test]
    fn several_markers_are_counted() {
        let stderr = b"[Reader_ABI::read] Error opening run 3 in \"E.wiff\":\nboom\n\
                       [Reader_ABI::read] Error opening run 7 in \"E.wiff\":\nboom\n";
        assert_eq!(
            verdict(&input(stderr), 10).refusal(),
            Some(SampleCompletenessRefusal::SampleFailureObserved { failed: 2 })
        );
    }

    #[test]
    fn a_truncated_stream_establishes_nothing() {
        let mut input = input(b"");
        input.stderr_truncated = true;
        assert_eq!(
            verdict(&input, 10).refusal(),
            Some(SampleCompletenessRefusal::AuditTruncated)
        );
    }

    #[test]
    fn a_failure_in_a_truncated_stream_is_still_reported_as_a_failure() {
        let mut input = input(b"[Reader_ABI::read] Error opening run 2 in \"E.wiff\":\n");
        input.stderr_truncated = true;
        assert_eq!(
            verdict(&input, 10).refusal(),
            Some(SampleCompletenessRefusal::SampleFailureObserved { failed: 1 })
        );
    }

    #[test]
    fn an_unclassifiable_reader_failure_refuses() {
        let stderr = b"[Reader_ABI::read()] unhandled exception\n";
        assert_eq!(
            verdict(&input(stderr), 10).refusal(),
            Some(SampleCompletenessRefusal::UnrecognizedReaderFailure)
        );
    }

    #[test]
    fn ordinary_noise_is_not_a_sample_failure() {
        // Every one of these was chosen to look like trouble. None of them is
        // the reader losing a sample, and a boundary that refused on the word
        // "error" would refuse honest conversions for the rest of its life.
        for line in [
            &b"[Reader_ABI::fillInMetadata] unable to read sample acquisition time (x)\n"[..],
            b"warning: an error occurred somewhere else entirely\n",
            b"Error writing run 9:\n",
            b"[SpectrumList_ABI::spectrum()] Error opening something\n",
            b"Error opening run 5\n",
        ] {
            assert!(
                verdict(&input(line), 10).established().is_some(),
                "refused on {:?}",
                String::from_utf8_lossy(line)
            );
        }
    }

    #[test]
    fn invalid_utf8_around_the_marker_does_not_hide_it() {
        // The vendor's message is localized and this boundary never decodes it.
        // A stream that is not valid UTF-8 at all must not be able to conceal
        // an ASCII sentinel that is plainly present in the bytes.
        let mut stderr = Vec::from(&b"[Reader_ABI::read] Error opening run 4 in \"E.wiff\":\n"[..]);
        stderr.extend_from_slice(&[0xFF, 0xFE, 0x80, 0x81]);
        assert!(
            std::str::from_utf8(&stderr).is_err(),
            "the fixture is not UTF-8"
        );
        assert_eq!(
            verdict(&input(&stderr), 10).refusal(),
            Some(SampleCompletenessRefusal::SampleFailureObserved { failed: 1 })
        );
    }

    #[test]
    fn a_filtered_run_is_not_a_complete_one() {
        let mut input = input(b"");
        input.argv_requests_filtering = true;
        assert_eq!(
            verdict(&input, 10).refusal(),
            Some(SampleCompletenessRefusal::OutputFilteringRequested)
        );
        assert!(argv_requests_filtering(&["--mzML", "--runIndexSet", "0-4"]));
        assert!(!argv_requests_filtering(&["--mzML", "--outdir", "x"]));
    }

    #[test]
    fn an_unclean_exit_is_not_audited() {
        let mut input = input(b"");
        input.exited_cleanly = false;
        assert_eq!(
            verdict(&input, 10).refusal(),
            Some(SampleCompletenessRefusal::BackendDidNotCompleteCleanly)
        );
    }

    #[test]
    fn no_published_member_is_not_a_complete_acquisition() {
        assert_eq!(
            verdict(&input(b""), 0).refusal(),
            Some(SampleCompletenessRefusal::NoPublishedMembers)
        );
    }

    #[test]
    fn the_positive_state_can_only_come_from_an_examination() {
        // Not an assertion about behaviour but about the type: the only public
        // way to reach `Established` is through `examine_backend_evidence`,
        // whose `NoSampleLoss` has no constructor of its own and no fields a
        // caller can fill. A future edit that added one would make this whole
        // module's guarantee a convention instead of a rule, so the shape is
        // exercised here rather than left to review.
        let proof = examine_backend_evidence(&input(b"")).expect("a clean run examines cleanly");
        let established = proof.with_published_members(3);
        assert_eq!(
            established
                .established()
                .map(EstablishedSampleCompleteness::sample_count),
            Some(3)
        );
    }
}
