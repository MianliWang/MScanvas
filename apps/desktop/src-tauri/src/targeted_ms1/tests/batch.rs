//! Tests for a batch of targeted MS1 analyses (M9.4): one request resolved
//! into one independent plan per acquisition, run one member at a time
//! through exactly the path a single plan takes.
//!
//! The store's rules run against fake executors, as the single-run rules in
//! the parent module do: they need no runtime and always run. What the fixed
//! runtime does with a batch -- links and copies side by side, a changed
//! source, a malformed one, a cancel during a real worker -- is at the end,
//! `#[ignore]`d like the parent module's runtime tests.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::{Attempt, CAFFEINE, PARACETAMOL, completed, draft, target};
use crate::project::observe::Cancellation;
use crate::project::recipe::{AttemptEnd, AttemptOrder, RecipeExecutor, RunPhase, TargetDraft};
use crate::project::record::{InputId, LayerId, TargetedMs1Plan, TerminalOutcome};
use crate::project::tests::Scratch;
use crate::project::{BatchMember, MemberState, ProjectError, ProjectStore};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// What one attempt was given.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Given {
    layer: LayerId,
    plan_sha256: String,
    source: PathBuf,
}

type Preflight<'a> = dyn Fn(&TargetedMs1Plan) -> Result<(), ProjectError> + Sync + 'a;

/// An executor whose preflight and attempt the test chooses, and which
/// counts how many of its attempts are running at once.
struct Members<'a> {
    preflight: Box<Preflight<'a>>,
    attempt: Box<Attempt<'a>>,
    active: AtomicUsize,
    most: AtomicUsize,
    given: Mutex<Vec<Given>>,
}

impl<'a> Members<'a> {
    fn new(
        attempt: impl Fn(&AttemptOrder<'_>, &Cancellation, &(dyn Fn(RunPhase) + Sync)) -> AttemptEnd
        + Sync
        + 'a,
    ) -> Self {
        Self::with_preflight(|_| Ok(()), attempt)
    }

    fn with_preflight(
        preflight: impl Fn(&TargetedMs1Plan) -> Result<(), ProjectError> + Sync + 'a,
        attempt: impl Fn(&AttemptOrder<'_>, &Cancellation, &(dyn Fn(RunPhase) + Sync)) -> AttemptEnd
        + Sync
        + 'a,
    ) -> Self {
        Self {
            preflight: Box::new(preflight),
            attempt: Box::new(attempt),
            active: AtomicUsize::new(0),
            most: AtomicUsize::new(0),
            given: Mutex::new(Vec::new()),
        }
    }

    fn most_at_once(&self) -> usize {
        self.most.load(Ordering::SeqCst)
    }

    fn given(&self) -> Vec<Given> {
        self.given.lock().expect("lock").clone()
    }
}

impl RecipeExecutor for Members<'_> {
    fn preflight(&self, plan: &TargetedMs1Plan, _source: &Path) -> Result<(), ProjectError> {
        (self.preflight)(plan)
    }

    fn attempt(
        &self,
        order: &AttemptOrder<'_>,
        cancellation: &Cancellation,
        progress: &(dyn Fn(RunPhase) + Sync),
    ) -> AttemptEnd {
        let running = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.most.fetch_max(running, Ordering::SeqCst);
        self.given.lock().expect("lock").push(Given {
            layer: order.plan.layer_id,
            plan_sha256: order.plan.plan_sha256.clone(),
            source: order.source.to_path_buf(),
        });
        let end = (self.attempt)(order, cancellation, progress);
        self.active.fetch_sub(1, Ordering::SeqCst);
        end
    }
}

/// Completes every attempt with a real staged payload, as the supervisor
/// would.
fn completes(
    order: &AttemptOrder<'_>,
    _: &Cancellation,
    _: &(dyn Fn(RunPhase) + Sync),
) -> AttemptEnd {
    completed(order)
}

/// A saved project with one layer over each of `count` small files named as
/// mzML, each holding its own bytes. The store's rules read none of them.
fn project_of(scratch: &Scratch, count: usize) -> (ProjectStore, Vec<LayerId>, Vec<PathBuf>) {
    let store = ProjectStore::new();
    store.create("Batch".to_owned(), false).expect("new");
    let mut sources = Vec::with_capacity(count);
    let mut inputs: Vec<InputId> = Vec::with_capacity(count);
    for n in 0..count {
        let source = scratch.write(
            &format!("data/sample-{n}.mzML"),
            format!("<mzML id=\"{n}\"/>").as_bytes(),
        );
        inputs.push(store.register_input(&source).expect("register"));
        sources.push(source);
    }
    let check = store.accept_job().expect("accept");
    store.check_linked_files(check).expect("check");
    let layers = inputs
        .iter()
        .enumerate()
        .map(|(n, input)| {
            let job = store.accept_job().expect("accept");
            let proof = store.prove_admissible(job, *input).expect("proved");
            store
                .record_admission(&proof, &format!("dataset-{n}"), proof.identities())
                .expect("remembered");
            store.create_layer(*input, |_| true).expect("layer")
        })
        .collect();
    store
        .save_as(&scratch.join("study.mscanvas"))
        .expect("save as");
    (store, layers, sources)
}

fn two_targets() -> Vec<TargetDraft> {
    vec![
        target("caffeine", CAFFEINE, "60", "20"),
        target("paracetamol", PARACETAMOL, "90", "20"),
    ]
}

/// Reviews a batch and answers every member's plan, failing the test on any
/// problem or refusal.
fn review(
    store: &ProjectStore,
    layers: &[LayerId],
    executor: &dyn RecipeExecutor,
) -> Vec<TargetedMs1Plan> {
    let resolution = store
        .resolve_targeted_ms1_batch(layers, &draft(two_targets()), executor)
        .expect("resolved");
    assert!(resolution.problems.is_empty(), "{:?}", resolution.problems);
    resolution
        .members
        .into_iter()
        .map(|member| {
            assert_eq!(member.refused, None);
            member.plan.expect("a plan")
        })
        .collect()
}

fn digests(plans: &[TargetedMs1Plan]) -> Vec<String> {
    plans.iter().map(|plan| plan.plan_sha256.clone()).collect()
}

fn run_batch(
    store: &ProjectStore,
    plans: &[TargetedMs1Plan],
    executor: &dyn RecipeExecutor,
) -> Result<Vec<BatchMember>, ProjectError> {
    let job = store.accept_job()?;
    store.run_targeted_ms1_batch(job, &digests(plans), executor)
}

// ---------------------------------------------------------------------------
// Sequential dispatch through the single-run path
// ---------------------------------------------------------------------------

#[test]
fn two_independently_bound_plans_run_one_after_the_other_through_the_single_run_path() {
    let scratch = Scratch::new("m94-dispatch");
    let (store, layers, sources) = project_of(&scratch, 2);
    let executor = Members::new(completes);
    let plans = review(&store, &layers, &executor);

    // One request, two plans: the same ordered targets under the same
    // identifiers and parameters, each bound to its own layer, its own
    // reference and that reference's own bytes, and named by its own digest.
    let [first, second] = plans.as_slice() else {
        panic!("two plans, got {}", plans.len());
    };
    assert_eq!(first.targets, second.targets);
    assert_eq!(first.target_list_sha256, second.target_list_sha256);
    assert_eq!(first.parameters, second.parameters);
    assert_eq!(first.recipe, second.recipe);
    assert_ne!(first.plan_sha256, second.plan_sha256);
    assert_eq!([first.layer_id, second.layer_id], [layers[0], layers[1]]);
    assert_ne!(first.input_id, second.input_id);
    assert_ne!(first.expected_content, second.expected_content);

    let members = run_batch(&store, &plans, &executor).expect("ran");

    // Never two attempts at once, in the order reviewed, and each attempt was
    // given one plan and that plan's one source.
    assert_eq!(executor.most_at_once(), 1);
    assert_eq!(
        executor.given(),
        plans
            .iter()
            .zip(&sources)
            .map(|(plan, source)| Given {
                layer: plan.layer_id,
                plan_sha256: plan.plan_sha256.clone(),
                source: source.clone(),
            })
            .collect::<Vec<_>>()
    );

    // Each member is its own ordinary run, with its own plan, what it
    // consumed, and its own result.
    let described = store.describe();
    assert_eq!(described.plans, plans);
    assert_eq!(described.runs.len(), 2);
    assert_eq!(described.artifacts.len(), 2);
    for ((member, plan), run) in members.iter().zip(&plans).zip(&described.runs) {
        assert_eq!(member.layer_id, plan.layer_id);
        let MemberState::Ended(end) = member.state else {
            panic!("an ended member, got {:?}", member.state);
        };
        assert_eq!(end.outcome, TerminalOutcome::Completed);
        assert_eq!(run.id, end.run.to_string());
        assert_eq!(run.operation, "targetedMs1V1");
        assert_eq!(run.layer_ids, vec![plan.layer_id.to_string()]);
        let execution = run.targeted_ms1.as_ref().expect("the block");
        assert_eq!(execution.plan_sha256, plan.plan_sha256);
        assert_eq!(execution.consumed_content, plan.expected_content);
        let artifact = end.artifact.expect("a result").to_string();
        assert_eq!(run.output_artifact_ids, vec![artifact.clone()]);
        let record = described
            .artifacts
            .iter()
            .find(|record| record.id == artifact)
            .expect("its record");
        assert_eq!(record.produced_by_run_id.as_deref(), Some(run.id.as_str()));
    }
    assert_ne!(described.artifacts[0].id, described.artifacts[1].id);
    assert!(
        store.analysis_progress().is_none(),
        "released when it ended"
    );
}
