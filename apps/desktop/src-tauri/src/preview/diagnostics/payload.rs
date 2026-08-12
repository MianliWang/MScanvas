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
const SCHEMA_VERSION: u64 = 1;

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
    match ticket.validation.as_ref() {
        Some(validation) => item.object("validation", |written| {
            written.string("mode", validation_mode_id(validation.mode));
            written.boolean("fullyVerified", validation.fully_verified);
            written.string_array("verified", &validation.verified);
            written.string_array("unverified", &validation.unverified);
            written.string_array("inapplicable", &validation.inapplicable);
        }),
        None => item.null("validation"),
    }
    match ticket.backend {
        Some(backend) => item.object("backend", |written| write_backend(written, backend)),
        None => item.null("backend"),
    }
    match ticket.cancellation {
        Some(cancellation) => item.object("cancellation", |written| {
            written.boolean("processLaunched", cancellation.process_launched);
            written.boolean("terminationRequested", true);
            written.boolean(
                "treeTerminationConfirmed",
                cancellation.tree_termination_confirmed,
            );
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
            written.boolean(
                "partialOutputObserved",
                cancellation.partial_output_observed,
            );
        }),
        None => item.null("cancellation"),
    }
    item.optional_string(
        "stagingResidue",
        ticket
            .residue
            .map(mscanvas_proteowizard::StagingResidue::stable_id),
    );
    // Emitted only for a backend-named set, so an ordinary queue's export is
    // exactly the document it was before this member existed.
    #[cfg(test)]
    if let Some(facts) = ticket.output_set {
        item.object("outputSet", |written| {
            written.count("maxMembers", facts.max_members);
            written.count("memberCount", facts.member_count);
            written.count("finalizedCount", facts.finalized_count);
            written.count(
                "validatedNotPublishedCount",
                facts.validated_not_published_count,
            );
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
    #[cfg(test)]
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
