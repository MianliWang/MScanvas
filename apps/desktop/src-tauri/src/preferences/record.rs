//! The one versioned UI preference record, and every rule about its contents.
//!
//! This is deliberately a small closed record rather than a serialization of
//! application state. What may be durable is enumerated here, each field has a
//! finite validated domain, and anything a reader does not recognise is a
//! refusal rather than data to carry forward. Nothing scientific, no
//! acquisition, dataset or destination, and nothing that could be mistaken for
//! authority over a conversion or a dataset is representable in this type at
//! all -- the allowlist is the type, not a filter applied to a wider one.
//!
//! One location is: the ProteoWizard folder a user chose, so the next launch
//! can start on it. It is not authority either. A stored folder binds nothing
//! by being read; it is handed to the same discovery a picker choice goes
//! through, and a folder that no longer holds usable tools is reported and
//! searched past rather than trusted. It never reaches the webview through this
//! store: the preference transfer objects carry a path-free view.

use serde::{Deserialize, Serialize};

/// The schema this build writes, and the newest it reads.
///
/// Schema 1 has been on users' disks since beta 1 shipped on 2026-10-28, so it
/// is read too, through [`SchemaOneRecord`], and becomes this schema the next
/// time the record changes. Reading never rewrites it. Any other version is
/// refused as unsupported and left in place: it belongs to the build that wrote
/// it, and that includes a later one.
pub const SCHEMA_VERSION: u32 = 2;

/// The one earlier schema this build reads.
const SCHEMA_ONE: u32 = 1;

/// The largest stored record this build will read.
///
/// Sixteen kibibytes for a record whose valid serialization, without a folder,
/// is under three hundred bytes. It is a bound on what a reader will pull into
/// memory and parse, not a budget to grow into: the point is that an unusable
/// file cannot become an unbounded read, and the margin exists so that
/// formatting or a future field never turns a legitimate record into a refusal.
pub const MAX_RECORD_BYTES: u64 = 16 * 1024;

/// The longest ProteoWizard folder this build stores, in UTF-8 bytes.
///
/// Far above any installation path a person would pick, and low enough that a
/// record holding one -- every backslash escaped -- still sits well inside
/// [`MAX_RECORD_BYTES`].
pub const MAX_BACKEND_FOLDER_BYTES: usize = 4 * 1024;

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

/// The Settings-owned group of the record: what the dialog edits today.
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

/// The shell-owned group: what the two panel toggles asked for.
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

/// Interface text size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextSize {
    Standard,
    Large,
}

/// Interface text contrast.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextContrast {
    Normal,
    High,
}

/// Interface motion: whatever the system asks for, or reduced regardless.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MotionPreference {
    System,
    Reduce,
}

/// What the wheel does on a plot: draw style zooms; Figma style pans, and
/// Ctrl+wheel zooms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WheelHabit {
    Draw,
    Figma,
}

/// The settings of the one bump the owner chose (V-7.1), in one group.
///
/// A group of its own rather than more of [`AppearancePreferences`], which the
/// webview uses as its session state. Every default keeps what a build without
/// these fields does, which is why `crosshair` is off: a plot draws no pointer
/// lines today, only a crosshair cursor, and that cursor is not this switch.
/// That default is a reading, not an owner decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayPreferences {
    pub text_size: TextSize,
    pub contrast: TextContrast,
    pub motion: MotionPreference,
    pub wheel_habit: WheelHabit,
    pub crosshair: bool,
    pub grid: bool,
    /// Whether interface preferences are written at all. The record keeps this
    /// switch itself; [`super::UiPreferenceStore::save`] applies its rule.
    pub remember: bool,
}

impl Default for DisplayPreferences {
    fn default() -> Self {
        Self {
            text_size: TextSize::Standard,
            contrast: TextContrast::Normal,
            motion: MotionPreference::System,
            wheel_habit: WheelHabit::Draw,
            crosshair: false,
            grid: true,
            remember: true,
        }
    }
}

/// The whole stored record.
///
/// `deny_unknown_fields` throughout, at every level. A field this build does
/// not know is refused rather than retained: keeping it would make the store a
/// place to park opaque data, and writing the record back would then publish
/// something no validator here has ever judged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiPreferences {
    pub schema_version: u32,
    pub appearance: AppearancePreferences,
    pub layout: LayoutPreferences,
    pub display: DisplayPreferences,
    /// The ProteoWizard folder the next launch starts discovery on, if the
    /// user chose one that worked.
    ///
    /// Optional and omitted when absent. Written only by Rust, after a picker
    /// choice read as usable; the webview's write payload cannot name it.
    /// Validated on read: absolute, bounded, no control characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend_folder: Option<String>,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            appearance: AppearancePreferences::default(),
            layout: LayoutPreferences::default(),
            display: DisplayPreferences::default(),
            backend_folder: None,
        }
    }
}

/// A stored record of schema 1, in either of the shapes on users' disks.
///
/// Beta 1 wrote three fields. Builds from 2026-10-29 can add `backendFolder`
/// and still call it schema 1. As strict as the current record: a field neither
/// shape has, `display` included, is a refusal rather than something to drop.
///
/// It shares the two group types with schema 2, so a change to either of them
/// has to keep reading these records. The fixtures in `tests.rs` hold it to that.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SchemaOneRecord {
    #[serde(rename = "schemaVersion")]
    _schema_version: u32,
    appearance: AppearancePreferences,
    layout: LayoutPreferences,
    #[serde(default)]
    backend_folder: Option<String>,
}

impl From<SchemaOneRecord> for UiPreferences {
    fn from(record: SchemaOneRecord) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            appearance: record.appearance,
            layout: record.layout,
            display: DisplayPreferences::default(),
            backend_folder: record.backend_folder,
        }
    }
}

/// Whether a folder is one this record may hold.
///
/// Absolute, because a relative one would be resolved against whatever the
/// process's working directory happens to be. Bounded, so the record stays
/// inside its own limit. And free of control characters, which no folder a
/// picker returns contains and which would otherwise be text nobody can see.
#[must_use]
pub fn storable_backend_folder(folder: &str) -> bool {
    folder.len() <= MAX_BACKEND_FOLDER_BYTES
        && std::path::Path::new(folder).is_absolute()
        && !folder.chars().any(char::is_control)
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
    /// Well-formed enough to read a `schemaVersion`, and it is not one this
    /// build reads.
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
/// Answers [`RecordProblem::UnsupportedVersion`] for a readable record of a
/// schema this build does not read, and [`RecordProblem::Malformed`] for
/// anything whose structure, fields or values this build does not accept.
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
    let record: UiPreferences = match probe.schema_version {
        Some(SCHEMA_VERSION) => {
            serde_json::from_slice(bytes).map_err(|_| RecordProblem::Malformed)?
        }
        Some(SCHEMA_ONE) => serde_json::from_slice::<SchemaOneRecord>(bytes)
            .map_err(|_| RecordProblem::Malformed)?
            .into(),
        Some(_) => return Err(RecordProblem::UnsupportedVersion),
        None => return Err(RecordProblem::Malformed),
    };
    // Defence in depth rather than a second opinion: the strict deserialization
    // above cannot admit another version, and a record whose version disagrees
    // with the fields beside it is exactly the thing not to publish onward.
    if record.schema_version != SCHEMA_VERSION {
        return Err(RecordProblem::UnsupportedVersion);
    }
    if record
        .backend_folder
        .as_deref()
        .is_some_and(|folder| !storable_backend_folder(folder))
    {
        return Err(RecordProblem::Malformed);
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
