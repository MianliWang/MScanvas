//! The one document a diagnostics export writes.
//!
//! Serialized by hand, which is a decision rather than an omission. Nothing in
//! this application's production dependencies renders JSON — `serde` describes
//! shapes and a format crate would have to be added to turn one into text — and
//! adding a dependency to write two hundred bytes of structure would be the
//! wrong trade for a file this bounded and this closed.
//!
//! Writing it out has two further properties worth having here. Field order is
//! the order these functions call for it, so two exports of one queue are
//! byte-identical rather than merely equivalent. And every string goes through
//! one escaper, so what makes the output valid JSON is a single function with a
//! single test rather than a property inherited from a crate.

use std::fmt::Write as _;

use mscanvas_proteowizard::{BackendRunFacts, BackendTextExcerpt};

use super::{
    ConversionFailureDiagnosticTicket, DiagnosticsExportRequest, REVIEW_BEFORE_SHARING,
    validation_mode_id,
};
use crate::preview::dto::ConversionConflictPolicyDto;
use crate::preview::operation::ItemState;
use crate::preview::selection::DatasetSourceKind;

/// The name a reader keys off to know what this file is.
const SCHEMA: &str = "mscanvas.conversion-diagnostics";

/// Incremented when a field changes meaning or leaves, never for an addition.
///
/// **Five since M6.9's release review**, for a count that narrowed:
/// `outputSet.notPublishedCount` counts members in the state `not_published`,
/// and a member the integrity judgement read and refused used to be one of
/// them. Once refusal became its own state such a member fell out of that count
/// and into none of the others, so the export accounted for fewer members than
/// the `memberCount` beside it. `rejectedCount` is new and holds it -- an
/// addition -- but the older field's population is smaller than it was, and a
/// reader written against version 4 must not read a version 5 file as though it
/// still included refused members. The four member counts partition the set.
///
/// Four before that, for a field that changed meaning:
/// `cancellation.processLaunched` became nullable. It was derived from
/// whether process facts came back, so a stop the boundary could not confirm
/// reported `false` -- no process launched -- beside a `process` judgement of
/// `indeterminate`, which says exactly that this was not established. A boolean
/// cannot hold "unknown", so the field now holds `null` there.
///
/// Three before that, and that increment was earned too:
/// `cancellation.partialOutputObserved` **left**. It was a boolean over an
/// optional observation, so it answered `false` both for a staging area read
/// and found empty and for one that could not be read at all -- and a reader
/// given `false` could not tell the two apart. What replaced it is the item's
/// own `stagedOutput`, which is a typed four-way answer and is present for
/// every item rather than only for the ones a stop reached.
const SCHEMA_VERSION: u64 = 5;

/// The redaction contract this file's excerpts were produced under.
const REDACTION_SCHEMA: &str = "mscanvas.path-redaction";
const REDACTION_SCHEMA_VERSION: u64 = 1;

/// What one export produced, before anything is written.
pub(in crate::preview) struct RenderedDiagnostics {
    pub(in crate::preview) bytes: Vec<u8>,
    pub(in crate::preview) item_count: usize,
}

/// Renders one terminal queue's diagnostics as a complete JSON document.
///
/// The trailing newline is part of the document rather than an afterthought: a
/// file that ends without one is awkward in every tool that concatenates or
/// prints it, and it is counted against the bound like every other byte.
pub(in crate::preview) fn render(request: &DiagnosticsExportRequest) -> RenderedDiagnostics {
    let mut out = String::new();
    let mut root = Members::new(&mut out);
    root.string("schema", SCHEMA);
    root.number("version", SCHEMA_VERSION);
    root.object("application", |application| {
        application.string("name", "MSCanvas");
        application.string("version", env!("CARGO_PKG_VERSION"));
    });
    root.object("queue", |queue| {
        let facts = &request.queue;
        queue.string("operationId", &facts.operation.to_string());
        queue.string("terminalReason", facts.terminal_reason);
        queue.string("conflictPolicy", conflict_policy_id(facts.conflict_policy));
        queue.number("retryRound", facts.retry_round);
        queue.count("itemCount", facts.item_count);
        queue.count("diagnosticItemCount", request.tickets.len());
        queue.count("finalizedCount", facts.finalized_count);
        queue.count("skippedCount", facts.skipped_count);
        queue.count("failedCount", facts.failed_count);
        queue.count("cancelledCount", facts.cancelled_count);
        queue.count("notRunCount", facts.not_run_count);
        queue.count("skippedByRequestCount", facts.skipped_by_request_count);
        queue.count("cancellationFailedCount", facts.cancellation_failed_count);
        queue.number("installationGeneration", facts.installation_generation);
        queue.optional_string("queueError", facts.queue_error.as_deref());
    });
    root.object("provider", |provider| {
        let facts = &request.provider;
        provider.optional_string("release", facts.release.as_deref());
        provider.optional_string("buildDate", facts.build_date.as_deref());
        provider.optional_string("sourceRevision", facts.source_revision.as_deref());
        provider.optional_string("executableSha256", facts.executable_sha256.as_deref());
        provider.number(
            "installationGeneration",
            request.queue.installation_generation,
        );
    });
    root.array("items", |items| {
        for ticket in &request.tickets {
            items.object(|item| write_item(item, ticket));
        }
    });
    root.object("redaction", |redaction| {
        redaction.string("schema", REDACTION_SCHEMA);
        redaction.number("version", REDACTION_SCHEMA_VERSION);
        redaction.count("replacementCount", total_replacements(request));
        redaction.count("suppressedExcerptCount", total_suppressions(request));
        redaction.string("warning", REVIEW_BEFORE_SHARING);
    });
    root.end();
    out.push('\n');
    RenderedDiagnostics {
        bytes: out.into_bytes(),
        item_count: request.tickets.len(),
    }
}

fn write_item(item: &mut Members<'_>, ticket: &ConversionFailureDiagnosticTicket) {
    item.count("queueIndex", ticket.identity.item_index);
    item.string("sourceFileName", &ticket.identity.source_file_name);
    match ticket.identity.output.planned_name() {
        Some(name) => item.string("outputFileName", name),
        // A backend-named set has no single output name and must not be given
        // one. `null` rather than a placeholder, and rather than the empty
        // string a reader could mistake for a name.
        None => item.null("outputFileName"),
    }
    item.string("sourceKind", source_kind_id(ticket.identity.source_kind));
    item.number("attempt", ticket.identity.attempt);
    item.string("state", item_state_id(ticket.state));
    item.optional_string("outcome", ticket.outcome);
    item.optional_string("detail", ticket.detailed_outcome);
    item.optional_string("refusal", ticket.refusal.as_deref());
    item.optional_string("refusalDetail", ticket.refusal_detail.as_deref());
    item.boolean("retryable", ticket.retryable);
    // Beside the record rather than inside it. A refused output keeps no
    // record, and a check reported without its scope says less than the
    // boundary established. `null` only where no conversion was reached.
    match ticket.validation_mode {
        Some(mode) => item.string("validationMode", validation_mode_id(mode)),
        None => item.null("validationMode"),
    }
    match ticket.validation.as_ref() {
        Some(validation) => item.object("validation", |written| {
            written.string("mode", validation_mode_id(validation.mode));
            written.boolean("fullyVerified", validation.fully_verified);
            written.string_array("verified", &validation.verified);
            written.string_array("unverified", &validation.unverified);
            written.string_array("inapplicable", &validation.inapplicable);
            // The fourth list, and it is a list rather than a disposition: an
            // advisory observation is not a check that could have been made and
            // was not. Dropping it here left a saved diagnostic carrying three
            // quarters of a judgement the application shows in full.
            written.string_array("advisory", &validation.advisory);
        }),
        None => item.null("validation"),
    }
    match ticket.backend {
        Some(backend) => item.object("backend", |written| write_backend(written, backend)),
        None => item.null("backend"),
    }
    match ticket.cancellation {
        Some(cancellation) => item.object("cancellation", |written| {
            // `null` where the boundary could not say, exactly as the wire
            // carries it. A `false` here would be the export asserting what the
            // stop itself refused to assert.
            match cancellation.process_launched {
                Some(launched) => written.boolean("processLaunched", launched),
                None => written.null("processLaunched"),
            }
            written.boolean("terminationRequested", true);
            written.string("ownedTree", cancellation.owned_tree.stable_id());
            written.number(
                "elapsedMilliseconds",
                u64::try_from(cancellation.elapsed.as_millis()).unwrap_or(u64::MAX),
            );
            written.optional_string(
                "termination",
                cancellation
                    .termination
                    .map(mscanvas_proteowizard::Termination::stable_id),
            );
        }),
        None => item.null("cancellation"),
    }
    // The two judgements an ordinary failure's diagnosis most needs, and the
    // two an export could not previously carry for one. Written for every item
    // rather than only for a stopped one: a run that exited non-zero after
    // writing half a document and one that wrote nothing are the pair this
    // whole record exists to tell apart.
    item.object("process", |written| {
        written.string("kind", ticket.attempt.process.stable_id());
        written.optional_string(
            "termination",
            ticket
                .attempt
                .process
                .termination()
                .map(mscanvas_proteowizard::Termination::stable_id),
        );
        match ticket.attempt.process.exit_code() {
            Some(code) => written.signed("exitCode", i64::from(code)),
            None => written.null("exitCode"),
        }
    });
    item.object("stagedOutput", |written| {
        written.string("kind", ticket.attempt.staged.stable_id());
        written.optional_string(
            "phase",
            ticket
                .attempt
                .staged
                .phase()
                .map(mscanvas_proteowizard::StagedObservationPhase::stable_id),
        );
        match ticket.attempt.staged.observation() {
            Some(observation) => {
                written.count("entryCount", observation.entry_count());
                // Whether the enumeration stopped at its bound. Dropping it
                // would export a lower bound as an exact total, and would
                // export "no directories, no file with content" for a reading
                // that classified nothing -- three false facts from one absent
                // field.
                written.boolean("countsAreLowerBounds", observation.bounded());
                if observation.bounded() {
                    written.null("directoryCount");
                    written.null("nonEmptyFileObserved");
                } else {
                    written.count("directoryCount", observation.directory_count());
                    written.boolean(
                        "nonEmptyFileObserved",
                        observation.non_empty_file_observed(),
                    );
                }
            }
            // Absent rather than zero. A zero here would be the one reading
            // this field must never produce: an unread directory described as
            // an empty one.
            None => {
                written.null("entryCount");
                written.null("countsAreLowerBounds");
                written.null("directoryCount");
                written.null("nonEmptyFileObserved");
            }
        }
    });
    // Opaque, session-local, and absent for an attempt that never reached the
    // provider -- which is what keeps a refusal from reading as a run.
    item.optional_string(
        "runIdentity",
        ticket
            .attempt
            .identity
            .map(mscanvas_proteowizard::OperationRunIdentity::to_hex)
            .as_deref(),
    );
    item.optional_string(
        "stagingResidue",
        ticket
            .residue
            .map(mscanvas_proteowizard::StagingResidue::stable_id),
    );
    // Emitted only for a backend-named set, so an ordinary queue's export is
    // exactly the document it was before this member existed.
    if let Some(facts) = ticket.output_set {
        item.object("outputSet", |written| {
            written.count("maxMembers", facts.max_members);
            written.count("memberCount", facts.member_count);
            written.count("finalizedCount", facts.finalized_count);
            written.count(
                "validatedNotPublishedCount",
                facts.validated_not_published_count,
            );
            written.count("rejectedCount", facts.rejected_count);
            written.count("notPublishedCount", facts.not_published_count);
            written.optional_count("boundSourceObjects", facts.bound_source_objects);
            written.optional_string("sampleCompleteness", facts.completeness);
            written.optional_string("notAdoptable", facts.not_adoptable);
            match facts.partial {
                Some(partial) => written.object("partialFinalization", |partial_written| {
                    partial_written.count("finalizedCount", partial.finalized_count);
                    partial_written.count("notPublishedCount", partial.not_published_count);
                    partial_written.string("failureKind", partial.failure_kind);
                }),
                None => written.null("partialFinalization"),
            }
        });
    }
    let text = ticket.text.as_deref();
    item.object("stdout", |written| {
        write_excerpt(
            written,
            text.map(mscanvas_proteowizard::BackendDiagnosticText::stdout),
        );
    });
    item.object("stderr", |written| {
        write_excerpt(
            written,
            text.map(mscanvas_proteowizard::BackendDiagnosticText::stderr),
        );
    });
}

fn write_backend(written: &mut Members<'_>, backend: BackendRunFacts) {
    match backend.exit_code() {
        Some(code) => written.signed("exitCode", i64::from(code)),
        None => written.null("exitCode"),
    }
    written.string("termination", backend.termination().stable_id());
    written.number(
        "elapsedMilliseconds",
        u64::try_from(backend.elapsed().as_millis()).unwrap_or(u64::MAX),
    );
    match backend.peak_job_memory_bytes() {
        Some(bytes) => written.number("peakJobMemoryBytes", bytes),
        None => written.null("peakJobMemoryBytes"),
    }
    // Two process counts under names that keep them apart, and a third fact
    // that says what they are counts *of*.
    //
    // `sampledMaxActiveProcesses` is polled, so it is a floor on the real peak:
    // a process that began and ended between two observations was never
    // sampled. `totalOwnedProcesses` is the kernel's own cumulative count and
    // has no such interval. Neither is the number left at the end.
    //
    // `null` is the absence of bounded accounting, never a count of zero. A
    // reader that saw `0` for both a run that owned nothing and a run that could
    // not count could not tell them apart, and only one of those is a fact.
    match backend.max_active_processes() {
        Some(count) => written.number("sampledMaxActiveProcesses", u64::from(count)),
        None => written.null("sampledMaxActiveProcesses"),
    }
    match backend.total_owned_processes() {
        Some(count) => written.number("totalOwnedProcesses", u64::from(count)),
        None => written.null("totalOwnedProcesses"),
    }
    // Whether the counts above are about the whole tree or only the part
    // ownership happened to hold.
    written.string("treeOwnership", backend.tree_ownership().stable_id());
}

/// One stream, or the honest absence of one.
///
/// `retained: "none"` is not the same answer as an empty excerpt. A backend
/// that printed nothing and an attempt that never launched one are different
/// facts, and a reader that saw `""` for both could not tell them apart.
fn write_excerpt(written: &mut Members<'_>, excerpt: Option<&BackendTextExcerpt>) {
    let Some(excerpt) = excerpt else {
        written.string("retained", "none");
        written.null("text");
        written.null("suppressed");
        return;
    };
    written.string(
        "retained",
        // Stated in the document rather than inferred from the counts. The
        // process boundary keeps the leading bytes of a stream and drops the
        // rest, so what is here is a prefix and never a tail.
        if excerpt.text().is_some() {
            "prefix"
        } else {
            "withheld"
        },
    );
    written.optional_string("text", excerpt.text());
    written.optional_string(
        "suppressed",
        excerpt
            .suppression()
            .map(mscanvas_proteowizard::ExcerptSuppression::stable_id),
    );
    written.boolean("lossy", excerpt.lossy());
    written.number("totalBytes", excerpt.total_bytes());
    written.number("capturedBytes", excerpt.captured_bytes());
    written.boolean("captureTruncated", excerpt.capture_truncated());
    written.boolean("excerptTruncated", excerpt.excerpt_truncated());
    written.count("redactionCount", excerpt.redactions());
}

fn total_replacements(request: &DiagnosticsExportRequest) -> usize {
    request
        .tickets
        .iter()
        .filter_map(|ticket| ticket.text.as_deref())
        .map(|text| text.stdout().redactions() + text.stderr().redactions())
        .sum()
}

fn total_suppressions(request: &DiagnosticsExportRequest) -> usize {
    request
        .tickets
        .iter()
        .filter_map(|ticket| ticket.text.as_deref())
        .map(|text| {
            usize::from(text.stdout().suppression().is_some())
                + usize::from(text.stderr().suppression().is_some())
        })
        .sum()
}

const fn conflict_policy_id(policy: ConversionConflictPolicyDto) -> &'static str {
    match policy {
        ConversionConflictPolicyDto::Fail => "fail",
        ConversionConflictPolicyDto::Skip => "skip",
    }
}

const fn source_kind_id(kind: DatasetSourceKind) -> &'static str {
    match kind {
        DatasetSourceKind::Mzml => "mzml",
        DatasetSourceKind::ThermoRaw => "thermo_raw",
        // Total over the families rather than over the ones a queue can hold.
        // A diagnostics export describes queue items and nothing admits this
        // family into a queue, so this arm is unreachable today; naming it is
        // still cheaper than a fallback that would quietly export one family
        // under another's identifier.
        DatasetSourceKind::ShimadzuLcd => "shimadzu_lcd",
        // And this one is doubly unreachable: nothing admits it into a queue,
        // and it does not convert through the single-output path a diagnostics
        // export describes at all.
        DatasetSourceKind::SciexWiff => "sciex_wiff",
    }
}

/// The item states an export can name.
///
/// Total over the queue's own vocabulary rather than a subset, so a state that
/// becomes diagnostic-worthy later cannot reach this without being named.
const fn item_state_id(state: ItemState) -> &'static str {
    match state {
        ItemState::Pending => "pending",
        ItemState::Running => "running",
        ItemState::Finalized => "finalized",
        ItemState::Skipped => "skipped",
        ItemState::Failed => "failed",
        ItemState::Cancelled => "cancelled",
        ItemState::NotRun => "not_run",
        ItemState::SkippedByRequest => "skipped_by_request",
        ItemState::CancellationFailed => "cancellation_failed",
    }
}

/// One JSON object being written, member by member.
struct Members<'a> {
    out: &'a mut String,
    written: bool,
}

impl<'a> Members<'a> {
    fn new(out: &'a mut String) -> Self {
        out.push('{');
        Self {
            out,
            written: false,
        }
    }

    fn key(&mut self, name: &str) {
        if self.written {
            self.out.push(',');
        }
        self.written = true;
        write_json_string(self.out, name);
        self.out.push(':');
    }

    fn string(&mut self, name: &str, value: &str) {
        self.key(name);
        write_json_string(self.out, value);
    }

    fn optional_string(&mut self, name: &str, value: Option<&str>) {
        match value {
            Some(value) => self.string(name, value),
            None => self.null(name),
        }
    }

    /// A count, or `null` where there is none to report.
    fn optional_count(&mut self, name: &str, value: Option<usize>) {
        match value {
            Some(value) => self.count(name, value),
            None => self.null(name),
        }
    }

    fn number(&mut self, name: &str, value: u64) {
        self.key(name);
        let _ = write!(self.out, "{value}");
    }

    fn signed(&mut self, name: &str, value: i64) {
        self.key(name);
        let _ = write!(self.out, "{value}");
    }

    fn count(&mut self, name: &str, value: usize) {
        self.number(name, value as u64);
    }

    fn boolean(&mut self, name: &str, value: bool) {
        self.key(name);
        self.out.push_str(if value { "true" } else { "false" });
    }

    fn null(&mut self, name: &str) {
        self.key(name);
        self.out.push_str("null");
    }

    fn string_array(&mut self, name: &str, values: &[&str]) {
        self.key(name);
        self.out.push('[');
        for (index, value) in values.iter().enumerate() {
            if index > 0 {
                self.out.push(',');
            }
            write_json_string(self.out, value);
        }
        self.out.push(']');
    }

    fn object(&mut self, name: &str, build: impl FnOnce(&mut Members<'_>)) {
        self.key(name);
        let mut nested = Members::new(self.out);
        build(&mut nested);
        nested.end();
    }

    fn array(&mut self, name: &str, build: impl FnOnce(&mut Elements<'_>)) {
        self.key(name);
        let mut nested = Elements::new(self.out);
        build(&mut nested);
        nested.end();
    }

    fn end(self) {
        self.out.push('}');
    }
}

/// One JSON array being written, element by element.
struct Elements<'a> {
    out: &'a mut String,
    written: bool,
}

impl<'a> Elements<'a> {
    fn new(out: &'a mut String) -> Self {
        out.push('[');
        Self {
            out,
            written: false,
        }
    }

    fn object(&mut self, build: impl FnOnce(&mut Members<'_>)) {
        if self.written {
            self.out.push(',');
        }
        self.written = true;
        let mut nested = Members::new(self.out);
        build(&mut nested);
        nested.end();
    }

    fn end(self) {
        self.out.push(']');
    }
}

/// Writes one JSON string, escaping everything that must be escaped.
///
/// The C0 range is escaped whole rather than only where a reader would break,
/// and DEL with it. Excerpt text has already had control characters replaced,
/// so this is the second lock on the same class: what makes the file valid JSON
/// should not depend on a sanitizer somewhere else having run first.
fn write_json_string(out: &mut String, value: &str) {
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if control.is_control() => {
                let _ = write!(out, "\\u{:04x}", control as u32);
            }
            ordinary => out.push(ordinary),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Everything a reader could choke on is escaped, and nothing else is
    /// touched.
    #[test]
    fn every_control_character_and_delimiter_is_escaped() {
        let mut out = String::new();
        write_json_string(&mut out, "a\"b\\c\nd\te\rf\u{0}g\u{1b}h\u{7f}i 样本");

        assert_eq!(
            out,
            "\"a\\\"b\\\\c\\nd\\te\\rf\\u0000g\\u001bh\\u007fi 样本\""
        );
    }

    /// Every list of the integrity judgement reaches the document.
    ///
    /// Written through `write_item`, the function the export actually calls,
    /// rather than through a second copy of its body -- a test that spells out
    /// the writer it is checking would pass whatever the writer does.
    ///
    /// The advisory list was modelled, projected to the queue and rendered, and
    /// then dropped here, so a saved diagnostic carried three quarters of
    /// judgement four while the application showed all of it. No configuration
    /// this release converts records an advisory, which is exactly why nothing
    /// noticed.
    #[test]
    fn a_validation_reaches_the_document_with_all_four_of_its_lists() {
        use crate::preview::conversion::ValidationFacts;
        use crate::preview::diagnostics::DiagnosticItemIdentity;
        use crate::preview::operation::{AttemptFacts, ItemOutputTopology};
        use mscanvas_proteowizard::ValidationMode;

        let ticket = ConversionFailureDiagnosticTicket {
            identity: DiagnosticItemIdentity {
                operation: 1,
                item_index: 0,
                source_file_name: "sample.raw".to_owned(),
                output: ItemOutputTopology::KnownSingle {
                    basename: "sample.mzML".to_owned(),
                },
                source_kind: DatasetSourceKind::ThermoRaw,
                attempt: 1,
            },
            state: ItemState::Failed,
            retryable: false,
            outcome: Some("output_rejected"),
            detailed_outcome: None,
            refusal: None,
            refusal_detail: None,
            validation_mode: Some(ValidationMode::SourceComparison),
            validation: Some(ValidationFacts {
                mode: ValidationMode::SourceComparison,
                verified: vec!["output_is_well_formed_mzml"],
                unverified: vec!["source_spectrum_count_preserved"],
                inapplicable: vec!["source_chromatogram_count_preserved"],
                advisory: vec!["source_reported_no_chromatograms"],
                fully_verified: false,
            }),
            backend: None,
            cancellation: None,
            residue: None,
            attempt: AttemptFacts::NOTHING_RAN,
            text: None,
            output_set: None,
        };

        let mut out = String::new();
        let mut root = Members::new(&mut out);
        root.object("item", |written| write_item(written, &ticket));
        root.end();

        let document: serde_json::Value = serde_json::from_str(&out).expect("valid JSON");
        // Stated beside the record, so a refused output -- which keeps no
        // record at all -- still says what it was checked against.
        assert_eq!(document["item"]["validationMode"], "source_comparison");
        let validation = &document["item"]["validation"];
        let mut keys: Vec<&str> = validation
            .as_object()
            .expect("a validation object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "advisory",
                "fullyVerified",
                "inapplicable",
                "mode",
                "unverified",
                "verified"
            ],
            "every list the judgement records reaches the saved document"
        );
        assert_eq!(
            validation["advisory"][0],
            "source_reported_no_chromatograms"
        );
        assert_eq!(validation["mode"], "source_comparison");
    }

    /// A bounded reading is exported as a floor, with what it did not read
    /// written as absent rather than as measured zeroes.
    ///
    /// Three facts hang on one flag. Without it the document would carry a
    /// lower bound as an exact total, and "no directories, no file with
    /// content" for a reading that classified nothing.
    #[test]
    fn a_bounded_reading_is_exported_as_a_floor_and_not_as_measured_zeroes() {
        use crate::preview::diagnostics::DiagnosticItemIdentity;
        use crate::preview::operation::{AttemptFacts, ItemOutputTopology};
        use mscanvas_proteowizard::{
            ProcessAttemptOutcome, StagedContentObservation, StagedObservationPhase,
            StagedOutputEvidence, ValidationMode,
        };

        let bounded = StagedOutputEvidence::Observed(
            StagedObservationPhase::ProviderReturned,
            StagedContentObservation::bounded_for_test(49),
        );
        let ticket = ConversionFailureDiagnosticTicket {
            identity: DiagnosticItemIdentity {
                operation: 1,
                item_index: 0,
                source_file_name: "sample.raw".to_owned(),
                output: ItemOutputTopology::KnownSingle {
                    basename: "sample.mzML".to_owned(),
                },
                source_kind: DatasetSourceKind::ThermoRaw,
                attempt: 1,
            },
            state: ItemState::Failed,
            retryable: false,
            outcome: Some("backend_rejected"),
            detailed_outcome: None,
            refusal: None,
            refusal_detail: None,
            validation_mode: Some(ValidationMode::OutputOnly),
            validation: None,
            backend: None,
            cancellation: None,
            residue: None,
            attempt: AttemptFacts {
                process: ProcessAttemptOutcome::Indeterminate,
                staged: bounded,
                identity: None,
            },
            text: None,
            output_set: None,
        };

        let mut out = String::new();
        let mut root = Members::new(&mut out);
        root.object("item", |written| write_item(written, &ticket));
        root.end();

        let document: serde_json::Value = serde_json::from_str(&out).expect("valid JSON");
        let staged = &document["item"]["stagedOutput"];
        assert_eq!(staged["kind"], "observed");
        assert_eq!(staged["entryCount"], 49);
        assert_eq!(
            staged["countsAreLowerBounds"], true,
            "the reader is told the count is a floor"
        );
        assert!(
            staged["directoryCount"].is_null(),
            "unread, and absent rather than zero"
        );
        assert!(
            staged["nonEmptyFileObserved"].is_null(),
            "unclassified, and absent rather than false"
        );
    }

    /// An empty object and an empty array are still valid documents.
    #[test]
    fn empty_structures_render_as_themselves() {
        let mut out = String::new();
        let mut root = Members::new(&mut out);
        root.object("nothing", |_| {});
        root.array("none", |_| {});
        root.string_array("empty", &[]);
        root.end();

        assert_eq!(out, r#"{"nothing":{},"none":[],"empty":[]}"#);
    }
}
