//! The one place a requested conversion intent becomes a bound one (ADR 0044
//! as amended by ADR 0055).
//!
//! A request names its settings exactly once: a row by stable identity, or a
//! structured intent. A structured intent is read through the crate's own
//! parts and rebuilt by `StructuredIntent::new`, so what leaves here is either
//! a row of `ConversionIntent::ADMITTED` or an advanced intent decision 4
//! admits. One equal to a row is that row, and runs as the row.
//!
//! [`read_structured_intent`] is also the only judge of a saved preset's
//! intent (ADR 0058, decision 5), so a preset lists as usable exactly when a
//! plan would read the same value.

use mscanvas_proteowizard::{
    ConversionIntent, StructuredIntent, StructuredIntentError, StructuredIntentParts,
};
use serde_json::Value;

use super::super::conversion::BoundIntent;
use super::super::dto::{
    ConversionIntentWireDto, PreviewErrorDto, conversion_intent_ambiguous,
    conversion_intent_not_admitted, conversion_intent_rejected,
};

/// The most bytes one structured intent may hold on the wire: 64 steps of a
/// few hundred bytes each, with room. A bound on what a request can make Rust
/// read, not a measured limit.
const MAX_INTENT_WIRE_BYTES: usize = 64 * 1024;

pub(in crate::preview) fn resolve_requested_intent(
    intent_id: Option<&str>,
    intent: Option<&ConversionIntentWireDto>,
) -> Result<BoundIntent, PreviewErrorDto> {
    match (intent_id, intent) {
        (Some(id), None) => ConversionIntent::from_stable_id(id)
            .map(BoundIntent::Row)
            .ok_or_else(conversion_intent_not_admitted),
        (None, Some(wire)) => {
            let structured = read_structured_intent(&wire.0).map_err(conversion_intent_rejected)?;
            Ok(match structured.verified_row() {
                Some(row) => BoundIntent::Row(row),
                None => BoundIntent::Advanced(Box::new(structured)),
            })
        }
        _ => Err(conversion_intent_ambiguous()),
    }
}

/// Reads one structured intent from its wire value, or names why not:
/// `too_large`, `malformed` for a value of the wrong shape (a row's stable id
/// string among them), or the refusing constructor's own stable id.
///
/// Availability on the installed build and the source-dependent blocks are
/// not asked here; they belong to the plan.
pub(crate) fn read_structured_intent(value: &Value) -> Result<StructuredIntent, &'static str> {
    let size = serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len());
    if size > MAX_INTENT_WIRE_BYTES {
        return Err("too_large");
    }
    // A value's own constructor refuses during deserialization, and the
    // deserializer reports that only as text; the refusal is recovered from
    // it, and anything else is a value of the wrong shape.
    let parts: StructuredIntentParts = serde_json::from_value(value.clone()).map_err(|error| {
        StructuredIntentError::from_deserializer_message(&error.to_string())
            .map_or("malformed", StructuredIntentError::stable_id)
    })?;
    StructuredIntent::try_from(parts).map_err(StructuredIntentError::stable_id)
}
