//! ADR 0044 as amended by ADR 0055: the structured intent on the wire, from
//! the request to a labelled result.

use super::*;
use crate::preview::dto::{ConversionIntentWireDto, PreviewErrorContextDto};
use serde_json::{Value, json};

fn mzml_64_32(spectrum_filters: Value) -> Value {
    json!({
        "output": {
            "format": "mzml",
            "mz": { "encoding": "plain", "bits": 64 },
            "intensity": { "encoding": "plain", "bits": 32 },
            "zlib": true,
            "index": true
        },
        "spectrumFilters": spectrum_filters,
        "chromatogramFilters": [],
        "switches": []
    })
}

/// MS1 only at 64/32, which no row holds. The interval is spelled redundantly
/// on purpose: the plan answers with Rust's canonical form.
fn advanced_ms1() -> Value {
    mzml_64_32(json!([{
        "kind": "ms_level",
        "levels": [{ "start": 1, "end": 1 }, { "start": 1, "end": 1 }]
    }]))
}

fn plan_request(
    service: &PreviewService,
    handles: &[String],
    intent_id: Option<String>,
    intent: Option<Value>,
) -> ConversionPlanRequestDto {
    ConversionPlanRequestDto {
        handles: handles.to_vec(),
        intent_id,
        intent: intent.map(ConversionIntentWireDto),
        conflict_policy: ConversionConflictPolicyDto::Fail,
        expected_receipt: service.readied_receipt(),
        destination_policy: None,
    }
}

fn planned(
    service: &PreviewService,
    handles: &[String],
    intent: Value,
) -> Result<ConversionQueuePlanDto, PreviewErrorDto> {
    match service.conversion_queue_plan(&plan_request(service, handles, None, Some(intent)))? {
        ConversionPlanOutcomeDto::Planned { plan } => Ok(*plan),
        other => panic!("expected a plan, got {other:?}"),
    }
}

fn reason(error: &PreviewErrorDto) -> Option<&str> {
    match &error.context {
        Some(PreviewErrorContextDto::ConversionIntent { reason }) => Some(reason),
        _ => None,
    }
}

fn mzml_service(fixture: &TestFile) -> (PreviewService, String) {
    let source = fixture.readable_mzml("run.mzML");
    let service = PreviewService::new(Box::new(ConvertingProvider::offering_every_admitted_row()));
    let handle = service
        .add_dataset(&source)
        .expect("add an mzML row")
        .handle;
    (service, handle)
}

#[test]
fn an_advanced_intent_plans_in_its_canonical_form_with_every_row_labelled() {
    let fixture = TestFile::new("wire-advanced-plan");
    let (service, handle) = mzml_service(&fixture);

    let plan = planned(&service, &[handle], advanced_ms1()).expect("an advanced plan");

    assert_eq!(plan.intent, None, "no row describes an advanced plan");
    assert_eq!(
        serde_json::to_value(&plan.canonical_intent).expect("serialize"),
        mzml_64_32(json!([{ "kind": "ms_level", "levels": [{ "start": 1, "end": 1 }] }])),
        "the plan answers with Rust's canonical form, not the request's spelling"
    );
    assert!(plan.items[0].unverified_settings);
    let wire = serde_json::to_value(&plan).expect("serialize the plan");
    assert_eq!(wire["intent"], Value::Null);
    assert_eq!(wire["items"][0]["unverifiedSettings"], true);
}

#[test]
fn a_structured_row_is_that_row_and_verified_on_the_measured_build() {
    let fixture = TestFile::new("wire-structured-row");
    let (service, handle) = mzml_service(&fixture);

    let plan = planned(&service, &[handle], mzml_64_32(json!([]))).expect("a row plan");

    assert_eq!(
        plan.intent.as_ref().map(|intent| intent.id.clone()),
        Some(ConversionIntent::SHIPPED.stable_id())
    );
    assert!(!plan.items[0].unverified_settings);
}

#[test]
fn the_intent_is_named_exactly_once() {
    let fixture = TestFile::new("wire-ambiguous");
    let (service, handle) = mzml_service(&fixture);
    let handles = [handle];
    for (intent_id, intent) in [
        (None, None),
        (
            Some(ConversionIntent::SHIPPED.stable_id()),
            Some(advanced_ms1()),
        ),
    ] {
        let error = service
            .conversion_queue_plan(&plan_request(&service, &handles, intent_id, intent))
            .expect_err("refused");
        assert_eq!(error.kind, "conversion_intent_ambiguous");
    }
}

#[test]
fn a_structured_intent_rust_cannot_build_is_refused_with_its_rule() {
    let fixture = TestFile::new("wire-rejected");
    let (service, handle) = mzml_service(&fixture);
    let handles = [handle];
    let ms1 = json!({ "kind": "ms_level", "levels": [{ "start": 1, "end": 1 }] });
    let vendor = json!({ "kind": "peak_picking_vendor", "msLevels": null });
    let mut unknown_field = advanced_ms1();
    unknown_field["extra"] = json!(true);
    let mut zero_tolerance = advanced_ms1();
    zero_tolerance["output"]["intensity"] = json!({ "encoding": "numpress_slof", "tolerance": 0 });
    let cases = [
        (unknown_field, "malformed"),
        (mzml_64_32(json!([{ "kind": "no_such_step" }])), "malformed"),
        (zero_tolerance, "not_positive"),
        (
            mzml_64_32(json!([{ "kind": "ms_level", "levels": [{ "start": 3, "end": 2 }] }])),
            "unordered_range",
        ),
        (
            mzml_64_32(json!([ms1.clone(), vendor])),
            "vendor_picker_not_first",
        ),
        (mzml_64_32(Value::Array(vec![ms1; 65])), "chain_too_long"),
        (
            mzml_64_32(json!([{ "kind": "id", "ids": ["x".repeat(70 * 1024)] }])),
            "too_large",
        ),
    ];
    for (intent, expected) in cases {
        let error = planned(&service, &handles, intent).expect_err("refused");
        assert_eq!(error.kind, "conversion_intent_rejected");
        assert_eq!(reason(&error), Some(expected));
    }
}

#[test]
fn an_intent_without_output_checks_or_blocked_for_the_source_never_becomes_a_queue() {
    let fixture = TestFile::new("wire-not-checkable");
    let (service, handle) = mzml_service(&fixture);
    let handles = [handle];
    let mzxml = json!({
        "output": { "format": "mzxml", "bits": 64, "zlib": true, "index": true },
        "spectrumFilters": [],
        "chromatogramFilters": [],
        "switches": []
    });
    let error = planned(&service, &handles, mzxml).expect_err("refused");
    assert_eq!(error.kind, "conversion_intent_not_checkable");

    let vendor = mzml_64_32(json!([{ "kind": "peak_picking_vendor", "msLevels": null }]));
    let error = planned(&service, &handles, vendor).expect_err("refused");
    assert_eq!(error.kind, "conversion_step_blocked_for_source");
    assert_eq!(reason(&error), Some("vendor_picker_on_mzml_source"));
}

#[test]
fn an_intent_the_build_cannot_express_is_refused_with_the_missing_name() {
    let fixture = TestFile::new("wire-unsupported");
    let (service, handle) = mzml_service(&fixture);
    let sorted = mzml_64_32(json!([{ "kind": "sort_by_scan_time" }]));
    let error = planned(&service, &[handle], sorted).expect_err("refused");
    assert_eq!(error.kind, "conversion_intent_unsupported");
    assert_eq!(reason(&error), Some("sortByScanTime"));
}

#[test]
fn an_advanced_mzml_conversion_runs_is_labelled_and_is_not_offered_for_adoption() {
    let fixture = TestFile::new("wire-advanced-run");
    let (service, handle) = mzml_service(&fixture);
    let document = current_document(&service);
    let request = ConversionBeginRequestDto {
        handles: vec![handle],
        intent_id: None,
        intent: Some(ConversionIntentWireDto(advanced_ms1())),
        conflict_policy: ConversionConflictPolicyDto::Fail,
        expected_receipt: service.readied_receipt(),
        destination_policy: None,
    };
    let reservation = match service
        .begin_conversion_queue_under(&request, document, DestinationPolicy::SourceSibling)
        .outcome
    {
        ConversionBeginOutcomeDto::Reserved { reservation } => reservation,
        ConversionBeginOutcomeDto::Refused { error } => panic!("refused: {error:?}"),
    };
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("the reservation is claimed");
    let update = service.resolve_claimed_conversion(operation);

    let report = sole_report(&update.state).expect("the conversion reaches an outcome");
    assert_eq!(report.outcome, "finalized", "{report:?}");
    assert!(report.unverified_settings);
    let validation = report.validation.as_ref().expect("a judged output");
    assert!(
        validation
            .unverified
            .iter()
            .any(|property| property == "spectrum_count"),
        "the requested selection is reported unverified: {validation:?}"
    );
    assert!(fixture.directory.join("run-converted.mzML").is_file());
    let WorkspaceConversionStateDto::Terminal { queue, .. } = &update.state else {
        panic!("the queue is terminal");
    };
    assert_eq!(
        queue.adoptable_output_count, 0,
        "an advanced output is not adopted until its provenance carries the label"
    );
}
