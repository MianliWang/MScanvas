//! The one versioned UI preference record, and every rule about its contents.
//!
//! This is deliberately a small closed record rather than a serialization of
//! application state. What may be durable is enumerated here, each field has a
//! finite validated domain, and anything a reader does not recognise is a
//! refusal rather than data to carry forward. Nothing scientific, nothing that
//! locates a file, and nothing that could be mistaken for authority over a
//! backend, a conversion or a dataset is representable in this type at all --
//! the allowlist is the type, not a filter applied to a wider one.

use serde::{Deserialize, Serialize};

/// The only schema this build reads or writes.
///
/// A record carrying anything else is refused as unsupported, not migrated. No
/// earlier schema was ever published, so a migration path would be code for a
/// format that never existed; a later one belongs to the build that wrote it.
pub const SCHEMA_VERSION: u32 = 1;

/// The largest stored record this build will read.
///
/// Sixteen kibibytes for a record whose valid serialization is under two
/// hundred bytes. It is a bound on what a reader will pull into memory and
/// parse, not a budget to grow into: the point is that an unusable file cannot
/// become an unbounded read, and the margin exists so that formatting or a
/// future field never turns a legitimate record into a refusal.
pub const MAX_RECORD_BYTES: u64 = 16 * 1024;

/// The interface language, restricted to the locales this build actually
/// bundles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UiLocale {
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-CN")]
    ZhCn,
}

/// Roster row spacing. Presentation only: it changes no file, no selection and
/// no measurement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RosterDensity {
    Comfortable,
    Compact,
}

/// What a user asked of one workspace panel.
///
/// Three states rather than two, because "I never said" and "I said hide it"
/// are different facts and only one of them should survive a window that got
/// narrow. `Automatic` is the absence of a choice, so the responsive default
/// decides; `Shown` and `Hidden` are choices, and a breakpoint that collapses a
/// panel for space does not get to overwrite them.
///
/// It records the request, never the outcome. A details panel asked for while
/// nothing is loaded stays `Shown` here: whether there is anything to show is a
/// fact about the session, and storing that would make a preference into a
/// claim that a dataset is open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PanelPresentation {
    Automatic,
    Shown,
    Hidden,
}

/// The Settings-owned half of the record: exactly what the dialog edits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppearancePreferences {
    pub locale: UiLocale,
    pub density: RosterDensity,
}

impl Default for AppearancePreferences {
    fn default() -> Self {
        Self {
            locale: UiLocale::En,
            density: RosterDensity::Comfortable,
        }
    }
}

/// The shell-owned half: what the two panel toggles asked for.
///
/// No dimension is stored, and that is a finding rather than an omission. The
/// workspace grid gives the roster and the inspector fixed track widths and
/// offers no resize affordance, so there is no user-chosen size to remember.
/// Inventing one would mean inventing the splitter to set it with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutPreferences {
    pub roster: PanelPresentation,
    pub details: PanelPresentation,
}

impl Default for LayoutPreferences {
    fn default() -> Self {
        Self {
            roster: PanelPresentation::Automatic,
            details: PanelPresentation::Automatic,
        }
    }
}

/// The whole stored record.
///
/// `deny_unknown_fields` throughout, at every level. A field this build does
/// not know is refused rather than retained: keeping it would make the store a
/// place to park opaque data, and writing the record back would then publish
/// something no validator here has ever judged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiPreferences {
    pub schema_version: u32,
    pub appearance: AppearancePreferences,
    pub layout: LayoutPreferences,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            appearance: AppearancePreferences::default(),
            layout: LayoutPreferences::default(),
        }
    }
}

/// Why a stored record could not be used.
///
/// Each of these leaves the file exactly as it was found. The distinction
/// between them is what the interface can honestly say about it, and
/// `UnsupportedVersion` is the one that matters most: it is the case where the
/// bytes are probably fine and this build is simply the wrong reader, so
/// replacing them silently would discard a newer build's settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordProblem {
    /// Not JSON, not this shape, an unknown field, or a value outside its
    /// domain.
    Malformed,
    /// Well-formed enough to read a `schemaVersion`, and it is not this one.
    UnsupportedVersion,
    /// Longer than [`MAX_RECORD_BYTES`]. Never parsed.
    Oversized,
    /// The file is there and this process could not read it.
    Unreadable,
    /// The name at the storage boundary is not an ordinary file this build owns
    /// -- a link, a reparse point, a directory or a device.
    UnsafeTarget,
}

impl RecordProblem {
    /// The stable wire identifier. Owned, enumerated, and never a message.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Malformed => "malformed",
            Self::UnsupportedVersion => "unsupportedVersion",
            Self::Oversized => "oversized",
            Self::Unreadable => "unreadable",
            Self::UnsafeTarget => "unsafeTarget",
        }
    }
}

/// Reads one stored record from its bytes, or says why it cannot be used.
///
/// The version is read first, from a probe that tolerates every other field.
/// Doing it the other way round would report a record written by a later build
/// as malformed, which is both untrue and the wrong thing to offer to replace.
///
/// # Errors
///
/// Answers [`RecordProblem::UnsupportedVersion`] for a readable record of
/// another schema, and [`RecordProblem::Malformed`] for anything whose
/// structure, fields or values this build does not accept.
pub fn read_record(bytes: &[u8]) -> Result<UiPreferences, RecordProblem> {
    /// Tolerant on purpose: this exists only to find the version, so a record
    /// full of fields from another build must still get past it.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionProbe {
        schema_version: Option<u32>,
    }

    let probe: VersionProbe =
        serde_json::from_slice(bytes).map_err(|_| RecordProblem::Malformed)?;
    match probe.schema_version {
        Some(SCHEMA_VERSION) => {}
        Some(_) => return Err(RecordProblem::UnsupportedVersion),
        None => return Err(RecordProblem::Malformed),
    }
    let record: UiPreferences =
        serde_json::from_slice(bytes).map_err(|_| RecordProblem::Malformed)?;
    // Defence in depth rather than a second opinion: the strict deserialization
    // above cannot admit another version, and a record whose version disagrees
    // with the fields beside it is exactly the thing not to publish onward.
    if record.schema_version != SCHEMA_VERSION {
        return Err(RecordProblem::UnsupportedVersion);
    }
    Ok(record)
}

/// The bytes one validated record is stored as.
///
/// Serialized from the typed record, so what is written is always something
/// this build's own reader accepts. Compact and newline-terminated; the bound
/// is asserted by the caller that publishes it.
///
/// Answers `None` only if serializing a closed record of enumerated scalars
/// somehow fails, which the type system makes unreachable and which is still
/// not something to unwrap in a writer.
#[must_use]
pub fn write_record(record: &UiPreferences) -> Option<Vec<u8>> {
    let mut bytes = serde_json::to_vec(record).ok()?;
    bytes.push(b'\n');
    Some(bytes)
}
