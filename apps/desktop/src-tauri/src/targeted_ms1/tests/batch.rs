//! Tests for a batch of targeted MS1 analyses (M9.4): one request resolved
//! into one independent plan per acquisition, run one member at a time
//! through exactly the path a single plan takes.
//!
//! The store's rules run against fake executors, as the single-run rules in
//! the parent module do: they need no runtime and always run. What the fixed
//! runtime does with a batch -- links and copies side by side, a changed
//! source, a malformed one, a cancel during a real worker -- is at the end,
//! `#[ignore]`d like the parent module's runtime tests.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Instant;

use mscanvas_core::ArtifactId;
use mscanvas_plot_spec::spec::{FigureSize, FigureTheme};

use super::{
    Attempt, CAFFEINE, PARACETAMOL, PHENYLALANINE, SNAPSHOT_NAME, Scan, Seeded, Supervisor,
    WorkArea, completed, draft, grid, matrix, mzml, plain, scans, target, two_peaks,
};
use crate::project::observe::Cancellation;
use crate::project::payload::{self, RowOutcome};
use crate::project::recipe::{AttemptEnd, AttemptOrder, RecipeExecutor, RunPhase, TargetDraft};
use crate::project::record::{
    FailureCode, FailureStage, InputId, LayerId, RunFailure, SourceView, StopFacts, StopReason,
    TargetedMs1Plan, TerminalOutcome,
};
use crate::project::targeted_output::{TableFormat, result_table};
use crate::project::tests::Scratch;
use crate::project::{BatchMember, CancelOutcome, MemberState, ProjectError, ProjectStore};

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
    let sources: Vec<PathBuf> = (0..count)
        .map(|n| {
            scratch.write(
                &format!("data/sample-{n}.mzML"),
                format!("<mzML id=\"{n}\"/>").as_bytes(),
            )
        })
        .collect();
    let (store, layers) = project_at(&scratch.join("study.mscanvas"), &sources);
    (store, layers, sources)
}

/// A project saved at `document` with one layer over each source, in order.
fn project_at(document: &Path, sources: &[PathBuf]) -> (ProjectStore, Vec<LayerId>) {
    let store = ProjectStore::new();
    store.create("Batch".to_owned(), false).expect("new");
    let inputs: Vec<InputId> = sources
        .iter()
        .map(|source| store.register_input(source).expect("register"))
        .collect();
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
    store.save_as(document).expect("save as");
    (store, layers)
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

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

#[test]
fn a_batch_names_two_to_sixteen_distinct_acquisitions_and_runs_all_sixteen_in_turn() {
    let scratch = Scratch::new("m94-bounds");
    let (store, layers, _) = project_of(&scratch, 17);
    let executor = Members::new(completes);
    let asked = |layers: &[LayerId]| {
        store
            .resolve_targeted_ms1_batch(layers, &draft(two_targets()), &executor)
            .map(|_| ())
    };
    assert_eq!(asked(&layers[..1]), Err(ProjectError::BatchSizeOutOfRange));
    assert_eq!(asked(&layers), Err(ProjectError::BatchSizeOutOfRange));
    // A repeated acquisition is refused, never deduplicated.
    assert_eq!(
        asked(&[layers[0], layers[1], layers[0]]),
        Err(ProjectError::BatchDuplicateInput)
    );
    assert_eq!(
        asked(&[layers[0], LayerId::new()]),
        Err(ProjectError::UnknownRecord)
    );
    assert!(store.describe().runs.is_empty());

    let plans = review(&store, &layers[..16], &executor);
    assert_eq!(plans.len(), 16);
    let members = run_batch(&store, &plans, &executor).expect("ran");
    assert_eq!(executor.most_at_once(), 1);
    assert_eq!(
        executor
            .given()
            .iter()
            .map(|given| given.layer)
            .collect::<Vec<_>>(),
        layers[..16]
    );
    assert!(members.iter().all(|member| matches!(
        member.state,
        MemberState::Ended(end) if end.outcome == TerminalOutcome::Completed
    )));
    assert_eq!(store.describe().runs.len(), 16);
}

#[test]
fn acquisitions_holding_the_same_bytes_are_still_two_plans_and_two_runs() {
    let scratch = Scratch::new("m94-same-bytes");
    let source = scratch.write("data/a.mzML", b"<mzML id=\"same\"/>");
    let copy = scratch.write("data/b.mzML", b"<mzML id=\"same\"/>");
    let store = ProjectStore::new();
    store.create("Batch".to_owned(), false).expect("new");
    let inputs: Vec<InputId> = [&source, &copy]
        .into_iter()
        .map(|path| store.register_input(path).expect("register"))
        .collect();
    let check = store.accept_job().expect("accept");
    store.check_linked_files(check).expect("check");
    let layers: Vec<LayerId> = inputs
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

    let executor = Members::new(completes);
    let plans = review(&store, &layers, &executor);
    assert_eq!(plans[0].expected_content, plans[1].expected_content);
    assert_ne!(
        plans[0].plan_sha256, plans[1].plan_sha256,
        "each plan binds its own layer and reference"
    );
    run_batch(&store, &plans, &executor).expect("ran");
    let described = store.describe();
    assert_eq!(described.plans, plans);
    assert_eq!(described.runs.len(), 2);
    assert_ne!(described.runs[0].layer_ids, described.runs[1].layer_ids);
}

#[test]
fn a_member_whose_source_is_not_mzml_is_refused_and_nothing_is_held_for_a_run() {
    let scratch = Scratch::new("m94-unsupported");
    let (store, mut layers, _) = project_of(&scratch, 2);
    // A third reference that is not an mzML file, with its own layer.
    let other = scratch.write("data/notes.txt", b"not an acquisition");
    let input = store.register_input(&other).expect("register");
    let check = store.accept_job().expect("accept");
    store.check_linked_files(check).expect("check");
    let job = store.accept_job().expect("accept");
    let proof = store.prove_admissible(job, input).expect("proved");
    store
        .record_admission(&proof, "dataset-other", proof.identities())
        .expect("remembered");
    layers.push(store.create_layer(input, |_| true).expect("layer"));
    store.save().expect("save");

    let executor = Members::new(completes);
    let resolution = store
        .resolve_targeted_ms1_batch(&layers, &draft(two_targets()), &executor)
        .expect("resolved");
    assert_eq!(resolution.members.len(), 3, "no member is left out");
    assert_eq!(
        resolution.members[2].refused,
        Some(ProjectError::RecipeSourceUnsupported)
    );
    assert!(resolution.members[2].plan.is_none());
    let plans: Vec<TargetedMs1Plan> = resolution.members[..2]
        .iter()
        .map(|member| member.plan.clone().expect("a plan"))
        .collect();
    // The members that had a plan cannot run without the one that did not.
    assert_eq!(
        run_batch(&store, &plans, &executor).map(|_| ()),
        Err(ProjectError::PlanNotCurrent)
    );
    assert!(store.describe().runs.is_empty());
    assert!(executor.given().is_empty());
}

#[test]
fn a_batch_runs_only_exactly_the_batch_last_reviewed() {
    let scratch = Scratch::new("m94-exact");
    let (store, layers, _) = project_of(&scratch, 3);
    let executor = Members::new(completes);
    let plans = review(&store, &layers, &executor);
    let reordered = [plans[1].clone(), plans[0].clone(), plans[2].clone()];
    let refused = |plans: &[TargetedMs1Plan]| run_batch(&store, plans, &executor).map(|_| ());
    assert_eq!(refused(&reordered), Err(ProjectError::PlanNotCurrent));
    assert_eq!(refused(&plans[..2]), Err(ProjectError::PlanNotCurrent));
    assert_eq!(refused(&plans[..1]), Err(ProjectError::PlanNotCurrent));
    // A single review since replaces the batch.
    super::plan(&store, layers[0], two_targets(), &executor);
    assert_eq!(refused(&plans), Err(ProjectError::PlanNotCurrent));
    assert!(store.describe().runs.is_empty());
    assert!(executor.given().is_empty());
    assert!(
        store.analysis_progress().is_none(),
        "every refusal released the job"
    );
    store.accept_job().expect("a new operation can be accepted");
}

#[test]
fn review_says_for_each_member_what_would_stop_it_running_now() {
    let scratch = Scratch::new("m94-blocked");
    let (store, layers, _) = project_of(&scratch, 3);
    let crowded = layers[1];
    let executor = Members::with_preflight(
        move |plan| {
            if plan.layer_id == crowded {
                Err(ProjectError::InsufficientWorkAreaSpace)
            } else {
                Ok(())
            }
        },
        completes,
    );
    let resolution = store
        .resolve_targeted_ms1_batch(&layers, &draft(two_targets()), &executor)
        .expect("resolved");
    let blocked: Vec<_> = resolution
        .members
        .iter()
        .map(|member| member.blocked)
        .collect();
    assert_eq!(
        blocked,
        [None, Some(ProjectError::InsufficientWorkAreaSpace), None]
    );
    // One member's copy is judged on its own, never as the sum of all.
    assert!(
        resolution
            .members
            .iter()
            .all(|member| member.plan.is_some())
    );
}

#[test]
fn a_review_made_while_a_batch_runs_changes_nothing_the_batch_runs() {
    let scratch = Scratch::new("m94-frozen");
    let (store, layers, _) = project_of(&scratch, 3);
    let plans = review(&store, &layers, &Members::new(completes));
    let first = layers[0];
    let executor = Members::new(|order, _, _| {
        if order.plan.layer_id == first {
            // Reviews are not held off by a run in progress (M9.3); each one
            // replaces what is held for review, with fresh target identifiers.
            super::plan(&store, first, two_targets(), &Members::new(completes));
            review(&store, &layers, &Members::new(completes));
        }
        completed(order)
    });
    let members = run_batch(&store, &plans, &executor).expect("ran");
    assert!(members.iter().all(|member| matches!(
        member.state,
        MemberState::Ended(end) if end.outcome == TerminalOutcome::Completed
    )));
    // Every member ran the plan the batch was accepted with.
    assert_eq!(
        executor
            .given()
            .iter()
            .map(|given| given.plan_sha256.clone())
            .collect::<Vec<_>>(),
        digests(&plans)
    );
    assert_eq!(store.describe().plans, plans);
}

// ---------------------------------------------------------------------------
// Failure isolation
// ---------------------------------------------------------------------------

#[test]
fn a_member_that_fails_or_times_out_leaves_every_other_member_as_it_is() {
    let scratch = Scratch::new("m94-isolation");
    let (store, layers, _) = project_of(&scratch, 4);
    let document = scratch.join("study.mscanvas");
    let (changed, slow) = (layers[1], layers[2]);
    let executor = Members::new(move |order, _, _| {
        if order.plan.layer_id == changed {
            AttemptEnd::Failed {
                consumed: Vec::new(),
                attempt: None,
                failure: RunFailure {
                    code: FailureCode::SourceChanged,
                    stage: FailureStage::Source,
                },
                stop: None,
            }
        } else if order.plan.layer_id == slow {
            AttemptEnd::Failed {
                consumed: order.plan.expected_content.clone(),
                attempt: Some(super::fake_facts()),
                failure: RunFailure {
                    code: FailureCode::WorkerTimeout,
                    stage: FailureStage::Engine,
                },
                stop: Some(StopFacts {
                    reason: StopReason::TimeBudgetExceeded,
                    worker_terminated: true,
                    exit_observed: true,
                }),
            }
        } else {
            completed(order)
        }
    });
    let plans = review(&store, &layers, &executor);
    let members = run_batch(&store, &plans, &executor).expect("ran");
    let outcomes: Vec<TerminalOutcome> = members
        .iter()
        .map(|member| match member.state {
            MemberState::Ended(end) => end.outcome,
            other => panic!("every member ran, got {other:?}"),
        })
        .collect();
    assert_eq!(
        outcomes,
        [
            TerminalOutcome::Completed,
            TerminalOutcome::Failed,
            TerminalOutcome::Failed,
            TerminalOutcome::Completed,
        ]
    );
    // A timeout is its member's failure, not a stop of the batch.
    let described = store.describe();
    let failures: Vec<_> = described
        .runs
        .iter()
        .map(|run| run.targeted_ms1.as_ref().and_then(|block| block.failure))
        .collect();
    assert_eq!(
        failures[1].map(|failure| failure.code),
        Some(FailureCode::SourceChanged)
    );
    assert_eq!(
        failures[2].map(|failure| failure.code),
        Some(FailureCode::WorkerTimeout)
    );
    // Both results stand whole, each in its own payload, and nothing was
    // staged or published for the members that failed.
    assert_eq!(described.artifacts.len(), 2);
    assert!(described.artifacts.iter().all(|artifact| {
        artifact
            .targeted_ms1
            .as_ref()
            .map(|result| result.availability)
            == Some("available")
    }));
    let store_dir = payload::store_of(&document).expect("store");
    for artifact in &described.artifacts {
        assert!(payload::is_plain_directory(&store_dir.join(&artifact.id)));
    }
    assert!(
        std::fs::read_dir(store_dir.join(".staging"))
            .expect("staging")
            .next()
            .is_none()
    );
}

#[test]
fn a_member_refused_before_its_attempt_gets_no_run_and_the_next_member_runs() {
    let scratch = Scratch::new("m94-refused");
    let (store, layers, _) = project_of(&scratch, 3);
    let plans = review(&store, &layers, &Members::new(completes));
    // The work area filled up after review, for the second member only.
    let crowded = layers[1];
    let executor = Members::with_preflight(
        move |plan| {
            if plan.layer_id == crowded {
                Err(ProjectError::InsufficientWorkAreaSpace)
            } else {
                Ok(())
            }
        },
        completes,
    );
    let members = run_batch(&store, &plans, &executor).expect("ran");
    assert_eq!(
        members[1].state,
        MemberState::Refused(ProjectError::InsufficientWorkAreaSpace)
    );
    assert!(matches!(members[2].state, MemberState::Ended(_)));
    assert_eq!(
        executor
            .given()
            .iter()
            .map(|given| given.layer)
            .collect::<Vec<_>>(),
        [layers[0], layers[2]]
    );
    let described = store.describe();
    assert_eq!(described.runs.len(), 2, "no run for the refused member");
    assert!(
        described
            .runs
            .iter()
            .all(|run| run.layer_ids != [crowded.to_string()])
    );
}

// ---------------------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------------------

#[test]
fn stopping_the_batch_ends_the_member_running_as_a_cancelled_run_and_starts_no_other() {
    let scratch = Scratch::new("m94-stop");
    let (store, layers, _) = project_of(&scratch, 3);
    let plans = review(&store, &layers, &Members::new(completes));
    let job = store.accept_job().expect("accept");
    let second = layers[1];
    let executor = Members::new(|order, _, _| {
        if order.plan.layer_id != second {
            return completed(order);
        }
        // The user stops the batch while the second member's worker runs;
        // the worker is stopped and observed gone.
        assert_eq!(store.cancel_job(job), CancelOutcome::Cancelled);
        AttemptEnd::Cancelled {
            consumed: order.plan.expected_content.clone(),
            attempt: Some(super::fake_facts()),
            stop: StopFacts {
                reason: StopReason::CancelRequested,
                worker_terminated: true,
                exit_observed: true,
            },
        }
    });
    let members = store
        .run_targeted_ms1_batch(job, &digests(&plans), &executor)
        .expect("ran");
    assert!(matches!(
        members[0].state,
        MemberState::Ended(end) if end.outcome == TerminalOutcome::Completed
    ));
    assert!(matches!(
        members[1].state,
        MemberState::Ended(end) if end.outcome == TerminalOutcome::Cancelled
    ));
    assert_eq!(members[2].state, MemberState::NotStarted(None));
    assert_eq!(executor.given().len(), 2, "the third member never started");
    let described = store.describe();
    assert_eq!(
        described.runs.len(),
        2,
        "no run for the member never started"
    );
    assert_eq!(described.runs[1].outcome, "cancelled");
    let stop = described.runs[1]
        .targeted_ms1
        .as_ref()
        .and_then(|block| block.stop)
        .expect("stop facts");
    assert_eq!(stop.reason, StopReason::CancelRequested);
    // The completed member's result stands.
    assert_eq!(described.artifacts.len(), 1);
    assert!(store.analysis_progress().is_none());
}

#[test]
fn a_batch_stopped_before_its_first_member_starts_records_nothing() {
    let scratch = Scratch::new("m94-stop-first");
    let (store, layers, _) = project_of(&scratch, 2);
    let executor = Members::new(completes);
    let plans = review(&store, &layers, &executor);
    let job = store.accept_job().expect("accept");
    assert_eq!(store.cancel_job(job), CancelOutcome::Cancelled);
    let members = store
        .run_targeted_ms1_batch(job, &digests(&plans), &executor)
        .expect("answered");
    assert!(
        members
            .iter()
            .all(|member| member.state == MemberState::NotStarted(None))
    );
    assert!(executor.given().is_empty());
    assert!(store.describe().runs.is_empty());
    assert!(store.analysis_progress().is_none());
}

#[test]
fn a_stale_cancel_reaches_neither_the_batch_running_nor_a_later_one() {
    let scratch = Scratch::new("m94-stale");
    let (store, layers, _) = project_of(&scratch, 2);
    let executor = Members::new(completes);
    let plans = review(&store, &layers, &executor);
    let earlier = store.accept_job().expect("accept");
    store
        .run_targeted_ms1_batch(earlier, &digests(&plans), &executor)
        .expect("ran");
    // Idle: a cancel of the finished batch changes nothing.
    assert_eq!(store.cancel_job(earlier), CancelOutcome::NoActiveOperation);

    let plans = review(&store, &layers, &executor);
    let later = store.accept_job().expect("accept");
    let seen = Mutex::new(Vec::new());
    let running = Members::new(|order, cancellation, _| {
        seen.lock().expect("lock").push(store.cancel_job(earlier));
        assert!(!cancellation.requested());
        completed(order)
    });
    let members = store
        .run_targeted_ms1_batch(later, &digests(&plans), &running)
        .expect("ran");
    assert_eq!(
        *seen.lock().expect("lock"),
        [CancelOutcome::Stale, CancelOutcome::Stale]
    );
    assert!(members.iter().all(|member| matches!(
        member.state,
        MemberState::Ended(end) if end.outcome == TerminalOutcome::Completed
    )));
    assert_eq!(store.describe().runs.len(), 4);
}

#[test]
fn a_worker_not_accounted_for_keeps_every_later_member_out() {
    let scratch = Scratch::new("m94-quarantine");
    let (store, layers, _) = project_of(&scratch, 3);
    let lost = layers[1];
    let executor = Members::new(move |order, _, _| {
        if order.plan.layer_id == lost {
            AttemptEnd::Failed {
                consumed: order.plan.expected_content.clone(),
                attempt: Some(super::fake_facts()),
                failure: RunFailure {
                    code: FailureCode::WorkerNotAccountedFor,
                    stage: FailureStage::Runtime,
                },
                stop: None,
            }
        } else {
            completed(order)
        }
    });
    let plans = review(&store, &layers, &executor);
    let members = run_batch(&store, &plans, &executor).expect("ran");
    assert!(matches!(
        members[1].state,
        MemberState::Ended(end) if end.outcome == TerminalOutcome::Failed
    ));
    assert_eq!(
        members[2].state,
        MemberState::NotStarted(Some(ProjectError::AnalysisQuarantined))
    );
    assert_eq!(executor.given().len(), 2);
    assert_eq!(store.describe().runs.len(), 2);
    assert!(store.analysis_quarantined());
    // And a new review says so for every member.
    let resolution = store
        .resolve_targeted_ms1_batch(&layers, &draft(two_targets()), &executor)
        .expect("resolved");
    assert!(
        resolution
            .members
            .iter()
            .all(|member| member.blocked == Some(ProjectError::AnalysisQuarantined))
    );
}

// ---------------------------------------------------------------------------
// Progress, and what a batch leaves in the project
// ---------------------------------------------------------------------------

#[test]
fn progress_names_every_member_in_order_and_the_phase_of_the_one_running() {
    let scratch = Scratch::new("m94-progress");
    let (store, layers, _) = project_of(&scratch, 3);
    let plans = review(&store, &layers, &Members::new(completes));
    let job = store.accept_job().expect("accept");
    let second = layers[1];
    let seen = Mutex::new(None);
    let executor = Members::new(|order, _, progress| {
        if order.plan.layer_id == second {
            progress(RunPhase::RunningEngine);
            *seen.lock().expect("lock") = store.analysis_progress();
        }
        completed(order)
    });
    store
        .run_targeted_ms1_batch(job, &digests(&plans), &executor)
        .expect("ran");
    drop(executor);
    let progress = seen.into_inner().expect("lock").expect("in progress");
    assert_eq!(progress.operation_id, job.handle());
    assert_eq!(progress.phase, "runningEngine");
    let batch = progress.batch.expect("a batch");
    assert_eq!(
        batch.iter().map(|member| member.state).collect::<Vec<_>>(),
        ["completed", "running", "queued"]
    );
    assert_eq!(
        batch
            .iter()
            .map(|member| member.layer_id.clone())
            .collect::<Vec<_>>(),
        layers.iter().map(ToString::to_string).collect::<Vec<_>>()
    );
    assert!(batch[0].run_id.is_some() && batch[0].artifact_id.is_some());
    assert!(batch[1].run_id.is_none());
    assert!(
        store.describe().analysis_run.is_none(),
        "gone once it ended"
    );
}

#[test]
fn every_result_of_a_batch_survives_save_reopen_and_save_as_and_reads_without_its_source() {
    let scratch = Scratch::new("m94-history");
    let (store, layers, sources) = project_of(&scratch, 3);
    let executor = Members::new(completes);
    let plans = review(&store, &layers, &executor);
    let members = run_batch(&store, &plans, &executor).expect("ran");
    let artifacts: Vec<ArtifactId> = members
        .iter()
        .map(|member| match member.state {
            MemberState::Ended(end) => end.artifact.expect("a result"),
            other => panic!("completed, got {other:?}"),
        })
        .collect();
    let rows_before: Vec<_> = artifacts
        .iter()
        .map(|artifact| {
            store
                .read_targeted_ms1_rows(*artifact, 0)
                .expect("rows")
                .rows
        })
        .collect();
    store.save().expect("save");
    let document = scratch.join("study.mscanvas");

    // Reopened: every result is whole, each produced by its own run over its
    // own layer, and nothing about the batch is left to resume.
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let described = reopened.describe();
    assert!(described.analysis_run.is_none());
    assert_eq!(described.plans, plans);
    for ((artifact, plan), rows) in artifacts.iter().zip(&plans).zip(&rows_before) {
        let record = described
            .artifacts
            .iter()
            .find(|record| record.id == artifact.to_string())
            .expect("its record");
        assert_eq!(
            record
                .targeted_ms1
                .as_ref()
                .map(|result| result.availability),
            Some("available")
        );
        let run = described
            .runs
            .iter()
            .find(|run| Some(run.id.as_str()) == record.produced_by_run_id.as_deref())
            .expect("its run");
        assert_eq!(run.layer_ids, vec![plan.layer_id.to_string()]);
        assert_eq!(
            run.targeted_ms1
                .as_ref()
                .map(|block| block.plan_sha256.clone()),
            Some(plan.plan_sha256.clone())
        );
        assert_eq!(
            &reopened
                .read_targeted_ms1_rows(*artifact, 0)
                .expect("rows")
                .rows,
            rows
        );
    }

    // Save As copies every result whole, each on its own.
    let copy = scratch.join("copy/study-copy.mscanvas");
    std::fs::create_dir_all(copy.parent().expect("parent")).expect("dir");
    reopened.save_as(&copy).expect("save as");
    let copied_store = payload::store_of(&copy).expect("store");
    for artifact in &artifacts {
        assert!(payload::is_plain_directory(
            &copied_store.join(artifact.to_string())
        ));
    }
    assert!(reopened.describe().artifacts.iter().all(|artifact| {
        artifact
            .targeted_ms1
            .as_ref()
            .map(|result| result.availability)
            == Some("available")
    }));

    // One member's result is read, tabulated and drawn with its source gone
    // and no executor anywhere.
    std::fs::remove_file(&sources[1]).expect("the source goes");
    let later = ProjectStore::new();
    later.open_document(&copy, false).expect("open the copy");
    let stored = later.stored_targeted_result(artifacts[1]).expect("stored");
    assert_eq!(stored.plan, plans[1]);
    let (_, count) = result_table(&stored, TableFormat::Csv).expect("a table");
    assert_eq!(count, plans[1].targets.len());
    later
        .targeted_evidence_figure(
            artifacts[1],
            plans[1].targets[0].target_id,
            FigureSize::new(1_200.0, 640.0).expect("a size"),
            FigureTheme::Light,
        )
        .expect("drawn");
    assert!(!later.describe().dirty, "reading recorded nothing");
}

// ---------------------------------------------------------------------------
// With the real runtime
//
// Run with `cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored
// --test-threads=1`: each test compares the shared attempts root before and
// after, which another test's attempt would disturb.
// ---------------------------------------------------------------------------

/// The real supervisor, watched: how many of its attempts run at once,
/// whether the work area holds only what it held before the batch as each
/// attempt starts, and how many bytes of verified copies it holds while the
/// attempt runs.
struct Watched<'a> {
    real: Supervisor,
    baseline: BTreeSet<OsString>,
    active: AtomicUsize,
    most: AtomicUsize,
    clean_at_start: Mutex<Vec<bool>>,
    copied_bytes: Mutex<Vec<u64>>,
    on_phase: Box<OnPhase<'a>>,
}

type OnPhase<'a> = dyn Fn(&AttemptOrder<'_>, RunPhase) + Sync + 'a;

impl<'a> Watched<'a> {
    fn new(on_phase: impl Fn(&AttemptOrder<'_>, RunPhase) + Sync + 'a) -> Self {
        let real = super::real();
        let baseline = super::attempt_entries(&real);
        Self {
            real,
            baseline,
            active: AtomicUsize::new(0),
            most: AtomicUsize::new(0),
            clean_at_start: Mutex::new(Vec::new()),
            copied_bytes: Mutex::new(Vec::new()),
            on_phase: Box::new(on_phase),
        }
    }

    fn most_at_once(&self) -> usize {
        self.most.load(Ordering::SeqCst)
    }

    fn clean_at_start(&self) -> Vec<bool> {
        self.clean_at_start.lock().expect("lock").clone()
    }

    fn copied_bytes(&self) -> Vec<u64> {
        self.copied_bytes.lock().expect("lock").clone()
    }

    fn clean_now(&self) -> bool {
        super::attempt_entries(&self.real) == self.baseline
    }
}

impl RecipeExecutor for Watched<'_> {
    fn preflight(&self, plan: &TargetedMs1Plan, source: &Path) -> Result<(), ProjectError> {
        self.real.preflight(plan, source)
    }

    fn attempt(
        &self,
        order: &AttemptOrder<'_>,
        cancellation: &Cancellation,
        progress: &(dyn Fn(RunPhase) + Sync),
    ) -> AttemptEnd {
        let running = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.most.fetch_max(running, Ordering::SeqCst);
        self.clean_at_start
            .lock()
            .expect("lock")
            .push(self.clean_now());
        let copied = AtomicU64::new(0);
        let watched = |phase: RunPhase| {
            copied.fetch_max(copies_below(&self.real.attempts), Ordering::SeqCst);
            (self.on_phase)(order, phase);
            progress(phase);
        };
        let end = self.real.attempt(order, cancellation, &watched);
        self.copied_bytes
            .lock()
            .expect("lock")
            .push(copied.load(Ordering::SeqCst));
        self.active.fetch_sub(1, Ordering::SeqCst);
        end
    }
}

/// The bytes of every verified copy in an attempt directory below `root`.
fn copies_below(root: &Path) -> u64 {
    std::fs::read_dir(root)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| {
                    std::fs::metadata(entry.path().join(SNAPSHOT_NAME))
                        .map_or(0, |metadata| metadata.len())
                })
                .sum()
        })
        .unwrap_or(0)
}

/// MS1 spectra of matrix alone: no signal for any fixture target.
fn nothing() -> Vec<Scan> {
    let mut rng = Seeded(0x5DEE_CE66_D1CE_4E5B);
    scans(&grid(120.0), |_| matrix(&mut rng, true))
}

fn caffeine_and_phenylalanine() -> Vec<TargetDraft> {
    vec![
        target("caffeine", CAFFEINE, "60", "20"),
        target("phenylalanine", PHENYLALANINE, "100", "10"),
    ]
}

fn rows(store: &ProjectStore, member: &BatchMember) -> Vec<RowOutcome> {
    let MemberState::Ended(end) = member.state else {
        panic!("an ended member, got {:?}", member.state);
    };
    store
        .read_targeted_ms1_rows(end.artifact.expect("a result"), 0)
        .expect("rows")
        .rows
        .iter()
        .map(|row| row.outcome)
        .collect()
}

fn outcome(member: &BatchMember) -> Option<TerminalOutcome> {
    match member.state {
        MemberState::Ended(end) => Some(end.outcome),
        _ => None,
    }
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_batch_of_linked_and_copied_members_runs_one_worker_at_a_time_and_leaves_no_scratch() {
    let area = WorkArea::new("batch-mixed");
    let elsewhere = Scratch::new("m94-elsewhere");
    let linked = area.write("data/plain.mzML", &mzml(&plain(), ""));
    let copied = elsewhere.write("two-peaks.mzML", &mzml(&two_peaks(), ""));
    super::assert_another_volume(&area, &copied);
    let unicode = area.write("数据 目录/样品 无信号.mzML", &mzml(&nothing(), ""));
    let sources = [linked, copied.clone(), unicode];
    let document = area.join("study.mscanvas");
    let (store, layers) = project_at(&document, &sources);
    let executor = Watched::new(|_, _| {});
    let resolution = store
        .resolve_targeted_ms1_batch(&layers, &draft(caffeine_and_phenylalanine()), &executor)
        .expect("resolved");
    assert!(
        resolution
            .members
            .iter()
            .all(|member| member.refused.is_none() && member.blocked.is_none()),
        "{:?}",
        resolution.members
    );
    let plans: Vec<TargetedMs1Plan> = resolution
        .members
        .into_iter()
        .map(|member| member.plan.expect("a plan"))
        .collect();

    let started = Instant::now();
    let members = run_batch(&store, &plans, &executor).expect("ran");
    let wall = started.elapsed();

    let described = store.describe();
    assert!(
        members
            .iter()
            .all(|member| outcome(member) == Some(TerminalOutcome::Completed)),
        "{:?} {:?}",
        members,
        described
            .runs
            .iter()
            .map(|run| run.targeted_ms1.as_ref().and_then(|block| block.failure))
            .collect::<Vec<_>>()
    );
    // Each member's own bytes, read its own way, and its own findings: the
    // member holding nothing is a completed run of absences, not a failure.
    let views: Vec<_> = described
        .runs
        .iter()
        .map(|run| {
            run.targeted_ms1
                .as_ref()
                .and_then(|block| block.attempt.as_ref())
                .map(|attempt| attempt.source_view)
        })
        .collect();
    assert_eq!(
        views,
        [
            Some(SourceView::HardLinkInWorkArea),
            Some(SourceView::VerifiedSnapshotInWorkArea),
            Some(SourceView::HardLinkInWorkArea),
        ]
    );
    for (run, plan) in described.runs.iter().zip(&plans) {
        let block = run.targeted_ms1.as_ref().expect("the block");
        assert_eq!(block.plan_sha256, plan.plan_sha256);
        assert_eq!(block.consumed_content, plan.expected_content);
    }
    assert_ne!(plans[0].expected_content, plans[1].expected_content);
    assert_ne!(plans[1].expected_content, plans[2].expected_content);
    assert_eq!(
        rows(&store, &members[0]),
        [RowOutcome::Detected, RowOutcome::NotDetected]
    );
    assert_eq!(
        rows(&store, &members[1]),
        [RowOutcome::Detected, RowOutcome::Detected]
    );
    assert_eq!(
        rows(&store, &members[2]),
        [RowOutcome::NotDetected, RowOutcome::NotDetected]
    );

    // One worker at a time; each attempt began with the work area holding
    // only what it held before the batch, so no member's copy outlived it;
    // and the one copy held was the copied member's own bytes, once.
    assert_eq!(executor.most_at_once(), 1);
    assert_eq!(executor.clean_at_start(), [true, true, true]);
    assert!(executor.clean_now());
    let copied_bytes = executor.copied_bytes();
    let copied_length = plans[1].expected_content[0].byte_length;
    assert_eq!(copied_bytes, [0, copied_length, 0]);
    eprintln!(
        "M94_EVIDENCE mixed: members=3 views=[link, snapshot, link] most_at_once={} \
         clean_at_start={:?} copy_bytes_per_member={:?} source_bytes={:?} wall_s={:.2}",
        executor.most_at_once(),
        executor.clean_at_start(),
        copied_bytes,
        plans
            .iter()
            .map(|plan| plan.expected_content[0].byte_length)
            .collect::<Vec<_>>(),
        wall.as_secs_f64()
    );

    // Saved, reopened with the copied member's source gone and no executor:
    // each result is whole and the copied member's reads, tabulates and draws.
    store.save().expect("save");
    drop(store);
    let _aside = super::Aside::new(&copied);
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let artifacts: Vec<ArtifactId> = members
        .iter()
        .map(|member| match member.state {
            MemberState::Ended(end) => end.artifact.expect("a result"),
            _ => unreachable!("every member completed"),
        })
        .collect();
    assert!(reopened.describe().artifacts.iter().all(|artifact| {
        artifact
            .targeted_ms1
            .as_ref()
            .map(|result| result.availability)
            == Some("available")
    }));
    let stored = reopened
        .stored_targeted_result(artifacts[1])
        .expect("stored");
    assert_eq!(
        result_table(&stored, TableFormat::Csv).expect("a table").1,
        2
    );
    reopened
        .targeted_evidence_figure(
            artifacts[1],
            plans[1].targets[1].target_id,
            FigureSize::new(1_200.0, 640.0).expect("a size"),
            FigureTheme::Light,
        )
        .expect("drawn");
    // Save As carries all three, each whole.
    let copy = area.join("copy/study-copy.mscanvas");
    std::fs::create_dir_all(copy.parent().expect("parent")).expect("dir");
    reopened.save_as(&copy).expect("save as");
    let copied_store = payload::store_of(&copy).expect("store");
    for artifact in &artifacts {
        assert!(payload::is_plain_directory(
            &copied_store.join(artifact.to_string())
        ));
    }
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_changed_and_a_malformed_member_fail_on_their_own_and_the_others_complete() {
    let area = WorkArea::new("batch-isolation");
    let whole = mzml(&plain(), "");
    let sources = [
        area.write("data/first.mzML", &whole),
        area.write("data/changing.mzML", &mzml(&two_peaks(), "")),
        area.write("data/truncated.mzML", &whole[..whole.len() * 55 / 100]),
        area.write("data/last.mzML", &mzml(&two_peaks(), "")),
    ];
    let (store, layers) = project_at(&area.join("study.mscanvas"), &sources);
    let executor = Watched::new(|_, _| {});
    let resolution = store
        .resolve_targeted_ms1_batch(&layers, &draft(caffeine_and_phenylalanine()), &executor)
        .expect("resolved");
    let plans: Vec<TargetedMs1Plan> = resolution
        .members
        .into_iter()
        .map(|member| member.plan.expect("a plan"))
        .collect();
    // The second member's bytes change after review.
    let mut changed = std::fs::read(&sources[1]).expect("read");
    let at = changed.len() / 2;
    changed[at] = if changed[at] == b'A' { b'B' } else { b'A' };
    std::fs::write(&sources[1], &changed).expect("rewrite in place");

    let members = run_batch(&store, &plans, &executor).expect("ran");
    assert_eq!(
        members.iter().map(outcome).collect::<Vec<_>>(),
        [
            Some(TerminalOutcome::Completed),
            Some(TerminalOutcome::Failed),
            Some(TerminalOutcome::Failed),
            Some(TerminalOutcome::Completed),
        ]
    );
    let failures: Vec<_> = store
        .describe()
        .runs
        .iter()
        .map(|run| {
            run.targeted_ms1
                .as_ref()
                .and_then(|block| block.failure)
                .map(|failure| failure.code)
        })
        .collect();
    assert_eq!(
        failures,
        [
            None,
            Some(FailureCode::SourceChanged),
            Some(FailureCode::SourceUnreadable),
            None,
        ]
    );
    // Not re-planned against the new bytes: the changed member keeps its plan.
    assert_eq!(store.describe().plans, plans);
    // The members before and after the failures found what they hold.
    assert_eq!(
        rows(&store, &members[0]),
        [RowOutcome::Detected, RowOutcome::NotDetected]
    );
    assert_eq!(
        rows(&store, &members[3]),
        [RowOutcome::Detected, RowOutcome::Detected]
    );
    assert_eq!(executor.most_at_once(), 1);
    assert!(executor.clean_at_start().iter().all(|clean| *clean));
    assert!(executor.clean_now());
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn stopping_a_real_batch_terminates_the_member_worker_and_starts_no_other() {
    let area = WorkArea::new("batch-stop");
    let sources = [
        area.write("data/plain.mzML", &mzml(&plain(), "")),
        area.write("data/large.mzML", &mzml(&super::large(), "")),
        area.write("data/two-peaks.mzML", &mzml(&two_peaks(), "")),
    ];
    let (store, layers) = project_at(&area.join("study.mscanvas"), &sources);
    let plans = {
        let resolution = store
            .resolve_targeted_ms1_batch(
                &layers,
                &draft(caffeine_and_phenylalanine()),
                &super::real(),
            )
            .expect("resolved");
        resolution
            .members
            .into_iter()
            .map(|member| member.plan.expect("a plan"))
            .collect::<Vec<_>>()
    };
    let job = store.accept_job().expect("accept");
    let second = layers[1];
    let executor = Watched::new(|order, phase| {
        // Stop the batch once the second member's worker reads its source.
        if order.plan.layer_id == second
            && matches!(phase, RunPhase::LoadingSource | RunPhase::CheckingSource)
        {
            let _ = store.cancel_job(job);
        }
    });
    let members = store
        .run_targeted_ms1_batch(job, &digests(&plans), &executor)
        .expect("ran");
    assert_eq!(outcome(&members[0]), Some(TerminalOutcome::Completed));
    assert_eq!(outcome(&members[1]), Some(TerminalOutcome::Cancelled));
    assert_eq!(members[2].state, MemberState::NotStarted(None));
    let described = store.describe();
    assert_eq!(
        described.runs.len(),
        2,
        "no run for the member never started"
    );
    let stop = described.runs[1]
        .targeted_ms1
        .as_ref()
        .and_then(|block| block.stop)
        .expect("stop facts");
    assert_eq!(stop.reason, StopReason::CancelRequested);
    assert!(stop.worker_terminated, "the stop reached a running worker");
    assert!(stop.exit_observed);
    assert_eq!(described.artifacts.len(), 1, "the first result stands");
    assert_eq!(executor.most_at_once(), 1);
    assert!(executor.clean_now());
    // The finished batch's identifier names nothing, and the next batch runs.
    assert_eq!(store.cancel_job(job), CancelOutcome::NoActiveOperation);
    assert!(store.accept_job().is_ok());
}
