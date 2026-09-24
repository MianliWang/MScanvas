//! The targeted MS1 recipe, as code: what it is bound to, and how a request
//! becomes a plan.
//!
//! The recipe definition is not configuration. The adapter the worker runs,
//! the fixed engine profile it applies and the runtime it runs in are all
//! decided here, at build time, and every plan names them by digest. A plan is
//! the one thing a user shapes: a source, two parameters and an ordered target
//! list. Resolving one reads no file and starts nothing -- it checks what was
//! asked against the recipe's domain and says, row by row, what does not fit.

use std::path::Path;
use std::sync::OnceLock;

use mscanvas_core::ArtifactId;
use mscanvas_proteowizard::Sha256Digest;

use super::ProjectError;
use super::observe::Cancellation;
use super::record::{
    self, AttemptFacts, DecimalValue, InputRecord, LayerRecord, MAX_TARGETS, MemberRole,
    ObservedMember, RecipeBinding, RecipeId, RunFailure, StopFacts, TargetDefinition, TargetId,
    TargetedMs1Parameters, TargetedMs1Plan, TargetedMs1ResultV1,
};

/// The recipe version this build runs.
pub const RECIPE_VERSION: u32 = 1;

/// The adapter the worker runs: reviewed source, compiled into the
/// application, written into each attempt's work directory and digested again
/// there before the interpreter is given it.
pub const ADAPTER_SOURCE: &[u8] = include_bytes!("../targeted_ms1/adapter_v1.py");

/// SHA-256 of the canonical runtime manifest this build pins, as
/// `scripts/provision_targeted_ms1_runtime.py` writes it.
pub const RUNTIME_MANIFEST_SHA256: &str =
    "6A3EB44A4611DB6B906F43B0278F67BB2B6996DDC7871BF614812E2CAC29B295";

/// The engine the recipe runs, for the interface and the record. Its identity
/// is the runtime manifest; these are names.
pub const ENGINE_PACKAGE: &str = "pyopenms";
pub const ENGINE_VERSION: &str = "3.5.0";
pub const ENGINE_ALGORITHM: &str = "FeatureFinderAlgorithmMetaboIdent";
/// The revision OpenMS reports about itself in this runtime. It is not the
/// `release/3.5.0` tag commit; the two are recorded as different in M9.0.
pub const ENGINE_REVISION: &str = "c1370fb";

/// The engine parameters the adapter fixes, with the values the engine must
/// report back after it resolved them, in canonical form.
///
/// Every key the recipe relies on is here, including those whose value is the
/// engine's own default: a different engine build with a different default is
/// a different recipe, and the supervisor refuses its result. The four values
/// the adapter derives from the plan -- both windows, the peak width and the
/// candidate file -- are checked separately against the plan.
pub const FIXED_ENGINE_PROFILE: &str = concat!(
    "{",
    "\"EMGScoring:init_mom\":\"true\",",
    "\"EMGScoring:max_iteration\":100,",
    "\"debug\":0,",
    "\"detect:min_peak_width\":0.2,",
    "\"detect:signal_to_noise\":0.8,",
    "\"extract:im_window\":0.0,",
    "\"extract:isotope_pmin\":0.0,",
    "\"extract:n_isotopes\":2,",
    "\"faims:merge_features\":\"true\",",
    "\"model:add_zeros\":0.2,",
    "\"model:check:asymmetry\":10.0,",
    "\"model:check:boundaries\":0.5,",
    "\"model:check:min_area\":1.0,",
    "\"model:check:width\":10.0,",
    "\"model:each_trace\":\"false\",",
    "\"model:no_imputation\":\"false\",",
    "\"model:type\":\"symmetric\",",
    "\"model:unweighted_fit\":\"false\"",
    "}"
);

fn digest_text(bytes: &[u8]) -> String {
    Sha256Digest::calculate(bytes).map_or_else(|_| String::new(), |digest| digest.to_string())
}

/// SHA-256 of [`ADAPTER_SOURCE`].
#[must_use]
pub fn adapter_sha256() -> &'static str {
    static DIGEST: OnceLock<String> = OnceLock::new();
    DIGEST.get_or_init(|| digest_text(ADAPTER_SOURCE))
}

/// SHA-256 of [`FIXED_ENGINE_PROFILE`].
#[must_use]
pub fn engine_profile_sha256() -> &'static str {
    static DIGEST: OnceLock<String> = OnceLock::new();
    DIGEST.get_or_init(|| digest_text(FIXED_ENGINE_PROFILE.as_bytes()))
}

/// What a plan resolved by this build is bound to.
#[must_use]
pub fn this_build() -> RecipeBinding {
    RecipeBinding {
        recipe: RecipeId::TargetedMs1,
        recipe_version: RECIPE_VERSION,
        adapter_sha256: adapter_sha256().to_owned(),
        engine_profile_sha256: engine_profile_sha256().to_owned(),
        runtime_manifest_sha256: RUNTIME_MANIFEST_SHA256.to_owned(),
    }
}

/// Whether a reference is a source this recipe reads: one file, named as
/// mzML. Anything else -- a vendor bundle, another format -- is refused before
/// a plan exists; nothing is converted to make it fit.
#[must_use]
pub fn source_is_supported(input: &InputRecord) -> bool {
    match input.members.as_slice() {
        [only] if only.role == MemberRole::Primary => {
            let name = match &input.locator {
                record::Locator::ProjectRelative { path } => {
                    path.rsplit('/').next().map(str::to_owned)
                }
                record::Locator::LocalAbsolute { path } => path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_owned),
            };
            name.is_some_and(|name| {
                std::path::Path::new(&name)
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("mzml"))
            })
        }
        _ => false,
    }
}

/// One target as the user typed it. Every number is the text they entered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetDraft {
    pub label: String,
    pub formula: String,
    pub neutral_mass: Option<String>,
    pub rt_s: String,
    pub rt_half_width_s: String,
}

/// A plan as the user asked for it, before anything was checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanDraft {
    pub mz_half_width_ppm: String,
    pub expected_peak_width_s: String,
    pub targets: Vec<TargetDraft>,
}

/// Which value a problem is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanField {
    Targets,
    Label,
    Formula,
    NeutralMass,
    RtS,
    RtHalfWidthS,
    MzHalfWidthPpm,
    ExpectedPeakWidthS,
}

impl PlanField {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Targets => "targets",
            Self::Label => "label",
            Self::Formula => "formula",
            Self::NeutralMass => "neutralMass",
            Self::RtS => "rtS",
            Self::RtHalfWidthS => "rtHalfWidthS",
            Self::MzHalfWidthPpm => "mzHalfWidthPpm",
            Self::ExpectedPeakWidthS => "expectedPeakWidthS",
        }
    }
}

/// What is wrong with a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProblemKind {
    /// Nothing was entered where something is required.
    Required,
    /// What was entered is not a value of this kind.
    Invalid,
    /// A number outside the recipe's measured range.
    OutOfRange,
    /// Another target already carries this label.
    Duplicate,
    /// More targets than one plan holds.
    TooMany,
}

impl ProblemKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Required => "required",
            Self::Invalid => "invalid",
            Self::OutOfRange => "outOfRange",
            Self::Duplicate => "duplicate",
            Self::TooMany => "tooMany",
        }
    }
}

/// One problem, located by target row (counted from one) where it is about a
/// target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanProblem {
    pub row: Option<usize>,
    pub field: PlanField,
    pub problem: ProblemKind,
}

/// Reads one number the user typed, into its canonical form, if it is inside
/// `low..=high` (the low end open where `low_open`).
fn number(text: &str, low: f64, low_open: bool, high: f64) -> Result<DecimalValue, ProblemKind> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(ProblemKind::Required);
    }
    let value: f64 = trimmed.parse().map_err(|_| ProblemKind::Invalid)?;
    let decimal = DecimalValue::of(value).ok_or(ProblemKind::Invalid)?;
    if record::decimal_in(&decimal, low, low_open, high) {
        Ok(decimal)
    } else {
        Err(ProblemKind::OutOfRange)
    }
}

/// Resolves a request into a plan bound to `binding`, or says every problem
/// it has.
///
/// Target identifiers are minted here, fresh, in the order the rows came:
/// the plan's order is the order the engine receives. Every problem is
/// reported, not only the first, so one correction pass can fix them all.
///
/// # Errors
///
/// Every [`PlanProblem`], in row order with the parameters last.
pub fn resolve(
    layer: &LayerRecord,
    input: &InputRecord,
    draft: &PlanDraft,
    binding: RecipeBinding,
) -> Result<TargetedMs1Plan, Vec<PlanProblem>> {
    use record::domain::{
        EXPECTED_PEAK_WIDTH_S_MAX, MZ_HALF_WIDTH_PPM, NEUTRAL_MASS_MAX, RT_HALF_WIDTH_S_MAX,
        RT_S_MAX,
    };

    let mut problems = Vec::new();
    if draft.targets.is_empty() {
        problems.push(PlanProblem {
            row: None,
            field: PlanField::Targets,
            problem: ProblemKind::Required,
        });
    }
    if draft.targets.len() > MAX_TARGETS {
        problems.push(PlanProblem {
            row: None,
            field: PlanField::Targets,
            problem: ProblemKind::TooMany,
        });
    }
    let mut targets = Vec::with_capacity(draft.targets.len());
    let mut labels: Vec<&str> = Vec::with_capacity(draft.targets.len());
    for (index, row) in draft.targets.iter().enumerate() {
        let at = Some(index + 1);
        let mut problem = |field, kind| {
            problems.push(PlanProblem {
                row: at,
                field,
                problem: kind,
            });
        };
        let label = row.label.trim();
        if label.is_empty() {
            problem(PlanField::Label, ProblemKind::Required);
        } else if !record::storable_label(label) {
            problem(PlanField::Label, ProblemKind::Invalid);
        } else if labels.contains(&label) {
            problem(PlanField::Label, ProblemKind::Duplicate);
        }
        labels.push(label);
        let formula = row.formula.trim();
        if formula.is_empty() {
            problem(PlanField::Formula, ProblemKind::Required);
        } else if !record::plain_formula(formula) {
            problem(PlanField::Formula, ProblemKind::Invalid);
        }
        let neutral_mass = match row.neutral_mass.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(text) => match number(text, 0.0, true, NEUTRAL_MASS_MAX) {
                Ok(mass) => Some(mass),
                Err(kind) => {
                    problem(PlanField::NeutralMass, kind);
                    None
                }
            },
        };
        let rt_s = number(&row.rt_s, 0.0, false, RT_S_MAX)
            .inspect_err(|kind| problem(PlanField::RtS, *kind))
            .ok();
        let rt_half_width_s = number(&row.rt_half_width_s, 0.0, true, RT_HALF_WIDTH_S_MAX)
            .inspect_err(|kind| problem(PlanField::RtHalfWidthS, *kind))
            .ok();
        if let (Some(rt_s), Some(rt_half_width_s)) = (rt_s, rt_half_width_s) {
            targets.push(TargetDefinition {
                target_id: TargetId::new(),
                label: label.to_owned(),
                formula: formula.to_owned(),
                neutral_mass,
                rt_s,
                rt_half_width_s,
            });
        }
    }
    let mz_half_width_ppm = number(
        &draft.mz_half_width_ppm,
        MZ_HALF_WIDTH_PPM.0,
        false,
        MZ_HALF_WIDTH_PPM.1,
    )
    .inspect_err(|kind| {
        problems.push(PlanProblem {
            row: None,
            field: PlanField::MzHalfWidthPpm,
            problem: *kind,
        });
    });
    let expected_peak_width_s = number(
        &draft.expected_peak_width_s,
        0.0,
        true,
        EXPECTED_PEAK_WIDTH_S_MAX,
    )
    .inspect_err(|kind| {
        problems.push(PlanProblem {
            row: None,
            field: PlanField::ExpectedPeakWidthS,
            problem: *kind,
        });
    });
    let (Ok(mz_half_width_ppm), Ok(expected_peak_width_s)) =
        (mz_half_width_ppm, expected_peak_width_s)
    else {
        return Err(problems);
    };
    if !problems.is_empty() {
        return Err(problems);
    }
    let mut plan = TargetedMs1Plan {
        plan_sha256: String::new(),
        recipe: binding,
        layer_id: layer.id,
        input_id: input.id,
        expected_content: record::expected_content_of(input),
        parameters: TargetedMs1Parameters {
            mz_half_width_ppm,
            expected_peak_width_s,
        },
        target_list_sha256: String::new(),
        targets,
    };
    // The platform digest is the one thing that can fail here, and a plan
    // without its name cannot be recorded; it is reported against the list.
    let unnamed = || {
        vec![PlanProblem {
            row: None,
            field: PlanField::Targets,
            problem: ProblemKind::Invalid,
        }]
    };
    plan.target_list_sha256 = record::target_list_digest(&plan.targets).ok_or_else(unnamed)?;
    plan.plan_sha256 = record::plan_digest(&plan).ok_or_else(unnamed)?;
    Ok(plan)
}

// ---------------------------------------------------------------------------
// The execution boundary
//
// The project store owns the job, the lock, the document and the commit; an
// executor owns everything between the start and the end of one attempt. The
// split is what lets the store's rules -- one job, no lifecycle change during a
// run, a failure kept in history, a result referenced only once it is whole --
// be tested without a runtime, and the supervisor's be tested without a
// project.
// ---------------------------------------------------------------------------

/// Where a running attempt is, for the interface. Session-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunPhase {
    Preparing,
    VerifyingRuntime,
    PinningSource,
    /// Copying the pinned source into the work area for the engine.
    PreparingInput,
    LoadingSource,
    CheckingSource,
    RunningEngine,
    Collecting,
    Validating,
    Publishing,
}

impl RunPhase {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Preparing => "preparing",
            Self::VerifyingRuntime => "verifyingRuntime",
            Self::PinningSource => "pinningSource",
            Self::PreparingInput => "preparingInput",
            Self::LoadingSource => "loadingSource",
            Self::CheckingSource => "checkingSource",
            Self::RunningEngine => "runningEngine",
            Self::Collecting => "collecting",
            Self::Validating => "validating",
            Self::Publishing => "publishing",
        }
    }
}

/// What the store hands an executor for one attempt.
pub struct AttemptOrder<'a> {
    pub plan: &'a TargetedMs1Plan,
    /// The source's primary member, resolved from the project's locator.
    pub source: &'a Path,
    /// The result store beside the document. It exists and is this project's.
    pub store: &'a Path,
    /// The identifier the result will carry. A completed attempt leaves its
    /// validated payload staged under it, and nowhere else.
    pub artifact: ArtifactId,
}

/// How one attempt ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttemptEnd {
    /// Validated and staged, not yet published.
    Completed {
        consumed: Vec<ObservedMember>,
        attempt: AttemptFacts,
        result: TargetedMs1ResultV1,
    },
    Failed {
        consumed: Vec<ObservedMember>,
        attempt: Option<AttemptFacts>,
        failure: RunFailure,
        stop: Option<StopFacts>,
    },
    Cancelled {
        consumed: Vec<ObservedMember>,
        attempt: Option<AttemptFacts>,
        stop: StopFacts,
    },
}

/// What runs one attempt.
pub trait RecipeExecutor: Sync {
    /// The checks made before any run exists: that this build can run the
    /// recipe at all, and that the source can be given to it. A refusal here
    /// records nothing.
    ///
    /// # Errors
    ///
    /// The [`ProjectError`] that says why the recipe cannot run now.
    fn preflight(&self, plan: &TargetedMs1Plan, source: &Path) -> Result<(), ProjectError>;

    /// Runs one attempt to its end, however it ends. Owns every file it
    /// creates and leaves nothing behind but a completed attempt's staged
    /// payload.
    fn attempt(
        &self,
        order: &AttemptOrder<'_>,
        cancellation: &Cancellation,
        progress: &(dyn Fn(RunPhase) + Sync),
    ) -> AttemptEnd;
}
