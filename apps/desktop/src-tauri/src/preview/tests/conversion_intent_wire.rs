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

fn vendor_picker_from(first: u32) -> Value {
    mzml_64_32(json!([{
        "kind": "peak_picking_vendor",
        "msLevels": [{ "start": first, "end": null }]
    }]))
}

/// ADR 0059, decision 2, on the wire: on a Thermo RAW row and the evidenced
/// build, vendor centroiding from MS1 and from MS2 are verified rows,
/// unlabelled, whether named by identity or sent as the structured step; from
/// MS3 it plans as advanced, labelled "not verified". On an mzML row each row
/// is refused for its evidence and the step for its source.
#[test]
fn thermo_vendor_centroiding_is_the_verified_row_from_ms1_and_from_ms2() {
    let fixture = TestFile::new("wire-thermo-vendor");
    let service = PreviewService::new(Box::new(ConvertingProvider::offering_every_admitted_row()));
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("acquisition.raw"))
        .expect("add a Thermo row")
        .handle;
    let rows = [
        (
            1,
            "mzml+vendor_centroiding_from_ms1+all+mz64_intensity32+zlib",
        ),
        (
            2,
            "mzml+vendor_centroiding_from_ms2+all+mz64_intensity32+zlib",
        ),
    ]
    .map(|(first, id)| {
        (
            first,
            ConversionIntent::from_stable_id(id).expect("a vendor-centroiding row"),
        )
    });

    for (first, row) in rows {
        for intent in [
            plan_request(
                &service,
                std::slice::from_ref(&thermo),
                Some(row.stable_id()),
                None,
            ),
            plan_request(
                &service,
                std::slice::from_ref(&thermo),
                None,
                Some(vendor_picker_from(first)),
            ),
        ] {
            let ConversionPlanOutcomeDto::Planned { plan } =
                service.conversion_queue_plan(&intent).expect("a row plan")
            else {
                panic!("expected a plan");
            };
            assert_eq!(
                plan.intent.as_ref().map(|intent| intent.id.clone()),
                Some(row.stable_id())
            );
            assert!(!plan.items[0].unverified_settings);
            assert_eq!(plan.items[0].unverified_build_release, None);
        }
    }

    let plan = planned(&service, &[thermo], vendor_picker_from(3)).expect("an advanced plan");
    assert_eq!(plan.intent, None, "MS3 and above is not a row");
    assert!(plan.items[0].unverified_settings);

    // On mzML a row's scope, by identity or as the step, is a row refused for
    // its evidence; any other scope is an advanced step refused for its source.
    let (service, mzml) = mzml_service(&fixture);
    for (first, row) in rows {
        for intent in [
            plan_request(
                &service,
                std::slice::from_ref(&mzml),
                Some(row.stable_id()),
                None,
            ),
            plan_request(
                &service,
                std::slice::from_ref(&mzml),
                None,
                Some(vendor_picker_from(first)),
            ),
        ] {
            let error = service.conversion_queue_plan(&intent).expect_err("refused");
            assert_eq!(error.kind, "conversion_settings_not_evidenced_for_source");
        }
    }
    let error = planned(&service, &[mzml], vendor_picker_from(3)).expect_err("refused");
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
fn an_advanced_mzml_conversion_runs_is_labelled_and_its_adopted_row_keeps_the_label() {
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
    assert_eq!(queue.adoptable_output_count, 1);

    // ADR 0055, owner decision 2 of 2026-10-29: the adopted row carries the
    // label, and the source row does not gain one.
    let adopted = service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("the labelled output is adoptable");
    let [WorkspaceOutputAdoptionOutcomeDto::Added { dataset, .. }] = adopted.outcomes.as_slice()
    else {
        panic!("one output added: {:?}", adopted.outcomes);
    };
    let label = crate::project::record::NotVerifiedByMscanvas::of(true, None);
    assert_eq!(dataset.not_verified_by_mscanvas, label);
    let roster = service.roster().datasets;
    assert_eq!(roster.len(), 2);
    assert_eq!(roster[0].not_verified_by_mscanvas, None);
    assert_eq!(roster[1].not_verified_by_mscanvas, label);

    // A project registration of that object asks the session about it and
    // records the label; the source's object has none.
    let projects = crate::project::ProjectStore::new();
    projects.create("Labels".to_owned(), false).expect("new");
    let output = fixture.directory.join("run-converted.mzML");
    projects
        .register_input_labelled(&output, |identity| {
            service.not_verified_label_of_object(identity)
        })
        .expect("the output registers");
    projects
        .register_input_labelled(&fixture.directory.join("run.mzML"), |identity| {
            service.not_verified_label_of_object(identity)
        })
        .expect("the source registers");
    let described = projects.describe();
    assert_eq!(described.inputs[0].not_verified_by_mscanvas, label);
    assert_eq!(described.inputs[1].not_verified_by_mscanvas, None);
}

/// Every step kind, switch and encoding shape `contracts.ts` declares, in
/// canonical form: each deserializes, builds, and serializes back unchanged.
#[test]
fn every_wire_shape_the_frontend_declares_round_trips_unchanged() {
    let set = json!([{ "start": 1, "end": 2 }, { "start": 5, "end": null }]);
    let one = json!([{ "start": 2, "end": null }]);
    let tolerance = json!({ "value": 10.0, "unit": "ppm" });
    let lockmass = json!({ "mz": 556.2771, "mzNegIons": 554.2615, "tol": 1.0 });
    let mut lockmass_step = lockmass.clone();
    lockmass_step["kind"] = json!("lockmass_refiner");
    let spectrum_filters = json!([
        { "kind": "index", "indices": set },
        { "kind": "id", "ids": ["controllerType=0 controllerNumber=1 scan=1"] },
        { "kind": "ms_level", "levels": set },
        { "kind": "charge_state", "charges": set },
        { "kind": "precursor_recalculation" },
        lockmass_step,
        { "kind": "precursor_refine" },
        { "kind": "peak_picking_default" },
        { "kind": "scan_number", "scanNumbers": set },
        { "kind": "scan_event", "scanEvents": set },
        { "kind": "scan_time", "startSeconds": 1.0, "endSeconds": 2.5 },
        { "kind": "sort_by_scan_time" },
        { "kind": "strip_it" },
        { "kind": "metadata_fixer" },
        { "kind": "title_maker", "template": [{ "keyword": "RunId" }, { "literal": "." }] },
        {
            "kind": "threshold",
            "criterion": { "type": "bpi_relative", "value": 0.75 },
            "orientation": "most_intense",
            "msLevels": one
        },
        { "kind": "mz_window", "low": 100.0, "high": 200.0 },
        {
            "kind": "mz_precursors", "mzs": [0.0, 123.4], "mzTol": tolerance,
            "target": "isolated", "mode": "include"
        },
        {
            "kind": "isolation_windows", "windows": [[0.0, 0.0], [400.0, 425.0]],
            "mzTol": tolerance, "mode": "exclude"
        },
        { "kind": "isolation_width", "widths": [2.0], "mzTol": tolerance, "mode": "include" },
        { "kind": "default_array_length", "peakCounts": set },
        {
            "kind": "zero_samples",
            "mode": { "kind": "add_missing", "flankingZeroCount": 5 },
            "msLevels": null
        },
        { "kind": "zero_samples", "mode": { "kind": "remove_extra" }, "msLevels": one },
        {
            "kind": "mz_present", "mzs": [100.0], "mzTol": tolerance,
            "criterion": { "type": "count", "value": 10 }, "orientation": "least_intense",
            "mode": "exclude"
        },
        { "kind": "scan_summing", "precursorTol": 0.05, "scanTimeTolSeconds": 10.0, "ionMobilityTol": 0.01 },
        { "kind": "thermo_scan_filter", "match": "contains", "mode": "exclude", "filter": "ITMS + c NSI" },
        { "kind": "mz_shift", "shift": -5.0, "unit": "ppm", "msLevels": one },
        { "kind": "ms2_denoise", "peaksInWindow": 6, "windowWidthDa": 30.0, "multichargeFragmentRelaxation": true },
        { "kind": "ms2_deisotope", "method": { "kind": "markey" } },
        { "kind": "ms2_deisotope", "method": { "kind": "markey_high_resolution", "mzTolerance": 0.01 } },
        { "kind": "ms2_deisotope", "method": { "kind": "poisson", "minCharge": 1, "maxCharge": 3 } },
        {
            "kind": "etd_filter", "removePrecursor": true, "removeChargeReduced": true,
            "removeNeutralLoss": true, "blanketRemoval": false,
            "matchingTolerance": { "value": 0.5, "unit": "mz" }
        },
        {
            "kind": "demultiplex", "massError": 10.0, "massErrorUnit": "ppm", "nnlsMaxIter": 50,
            "nnlsEps": 1e-10, "noWeighting": false, "demuxBlockExtra": 0.0, "variableFill": false,
            "noSumNormalize": false, "optimization": "overlap_only", "interpolateRt": true,
            "minWindowSize": 0.2, "removeNonOverlappingEdges": false
        },
        {
            "kind": "charge_state_predictor", "overrideExistingCharge": false, "maxMultipleCharge": 3,
            "minMultipleCharge": 2, "singleChargeFractionTic": 0.9, "maxKnownCharge": 0, "makeMs2": false
        },
        {
            "kind": "turbocharger", "minCharge": 1, "maxCharge": 8, "precursorsBefore": 2,
            "precursorsAfter": 0, "halfIsoWidth": 1.25, "defaultMinCharge": 0,
            "defaultMaxCharge": 0, "useVendorPeaks": false
        },
        { "kind": "activation", "type": "hcd", "mode": "include" },
        {
            "kind": "collision_energy", "low": 20.0, "high": 30.0, "mode": "include",
            "acceptNonCid": true, "acceptMissingCe": false
        },
        { "kind": "analyzer", "analyzer": "orbi" },
        { "kind": "polarity", "polarity": "positive" }
    ]);
    let mut chromatogram_lockmass = lockmass;
    chromatogram_lockmass["kind"] = json!("lockmass_refiner");
    let switches = json!([
        "simAsSpectra",
        "srmAsSpectra",
        "combineIonMobilitySpectra",
        "ddaProcessing",
        "ignoreCalibrationScans",
        "acceptZeroLengthSpectra",
        "ignoreMissingZeroSamples",
        "ignoreUnknownInstrumentError",
        "singleThreaded",
        "stripLocationFromSourceFiles",
        "stripVersionFromSoftware"
    ]);
    let plain = |bits: u8| json!({ "encoding": "plain", "bits": bits });
    let linear = json!({ "encoding": "numpress_linear", "tolerance": { "kind": "absolute", "value": 1e-4 } });
    let outputs = [
        json!({ "format": "mzml", "mz": linear, "intensity": { "encoding": "numpress_slof", "tolerance": 2e-4 }, "zlib": true, "index": false }),
        json!({ "format": "mzml", "mz": plain(32), "intensity": { "encoding": "numpress_pic" }, "zlib": false, "index": true }),
        json!({ "format": "mzxml", "bits": 32, "zlib": true, "index": true }),
        json!({
            "format": "mzmlb",
            "mz": { "encoding": "plain", "bits": 64, "truncation": -1, "prediction": "delta" },
            "intensity": { "encoding": "plain", "bits": 32, "truncation": 7, "prediction": "none" },
            "zlib": false, "chunkSize": 1_048_576, "compressionLevel": 0
        }),
        json!({ "format": "mzmlb", "mz": linear, "intensity": { "encoding": "numpress_pic" }, "zlib": true, "chunkSize": null, "compressionLevel": null }),
        json!({ "format": "mz5", "mzBits": 64, "intensityBits": 32, "zlib": true }),
        json!({ "format": "mgf" }),
        json!({ "format": "text" }),
        json!({ "format": "ms1" }),
        json!({ "format": "cms1" }),
        json!({ "format": "ms2" }),
        json!({ "format": "cms2" }),
    ];
    for output in outputs {
        let wire = json!({
            "output": output,
            "spectrumFilters": spectrum_filters,
            "chromatogramFilters": [{ "kind": "index", "indices": set }, chromatogram_lockmass],
            "switches": switches
        });
        let intent: mscanvas_proteowizard::StructuredIntent =
            serde_json::from_value(wire.clone()).unwrap_or_else(|error| panic!("{error}: {wire}"));
        assert_eq!(serde_json::to_value(&intent).expect("serialize"), wire);
    }
}
