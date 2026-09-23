//! Which run used what, and which run produced what.
//!
//! Everything here is a lookup over identifiers the document already stores.
//! Nothing is inferred from a name, a path, a timestamp or a position in a
//! list: a relationship exists because one record names another record's
//! identifier, or it does not exist at all. That is the whole rule, and it is
//! what makes lineage survive a rename, a relink and a reopen.
//!
//! ## Two edges are stored and two are derived
//!
//! A [`RunRecord`] names the inputs or the layer it consumed and the artifacts
//! it produced, so run-to-input, run-to-layer and run-to-artifact are read
//! straight off the record. The reverse directions -- which runs consumed an
//! input or a layer, which run produced an artifact -- are not stored, because storing a back-reference would be a
//! second copy of the same fact that could disagree with the first. They are
//! derived here, once, so that every consumer gets the same answer.
//!
//! [`producing_run`] can answer `None`, and that is a real state rather than a
//! fault: the schema permits an artifact no run in this document claims, which
//! is what lets [`super::ProjectStore::remove_input`] drop a run without having
//! to invent a replacement producer for what it produced. What the schema does
//! *not* permit is two runs claiming one artifact, because then "what produced
//! this" would have two answers; [`super::record::validate`] refuses that
//! document rather than letting this module pick one.
//!
//! ## Why there is no cycle detection
//!
//! Not an omission. The schema cannot express a cycle: an [`InputRecord`] names
//! no other record, an [`ArtifactRecord`] names only inputs through its
//! observations, and a [`RunRecord`] names only inputs, layers and artifacts.
//! Every edge therefore runs input <- run -> artifact or input <- layer <- run
//! -> artifact, and no edge leaves an artifact, a layer or an input towards a
//! run. A detector would be code for a shape that has no representation.
//!
//! That reasoning is the thing to check if the schema ever gains an edge -- an
//! artifact that names a run, or a run that consumes an artifact -- because
//! either would make a cycle representable and this paragraph false. The layer
//! M8.4 added is checked here: a [`super::record::LayerRecord`] names one
//! input and an input still names nothing. M8.5 made a run name a layer, which
//! is an edge *into* a layer from a run rather than out of one, and the QC
//! snapshot that run produces names no record at all -- its producing run is
//! derived below, like every other reverse edge, rather than stored. So there
//! is still no cycle.
//!
//! ## What is not here
//!
//! An artifact has no backing file. `FileFactsV1` is a typed payload stored
//! *inside* the project document, and there is no field on [`ArtifactRecord`]
//! that could hold a locator. So this module answers nothing about an
//! artifact's current filesystem state, because there is no filesystem state to
//! answer about -- and a consumer that displayed one would be displaying
//! something invented. Current file state belongs to inputs, and comes from a
//! check the user asked for.
//!
//! Nothing here opens, reads or stats a file.

use mscanvas_core::ArtifactId;

use super::record::{InputId, LayerId, ProjectDocument, RunId};

/// The runs that consumed one input, in document order.
///
/// Document order is the order runs were recorded, which is the order they
/// happened: a run is appended when it ends. Empty where nothing has used it,
/// which is the ordinary state of a reference that has just been registered.
#[must_use]
pub fn consuming_runs(document: &ProjectDocument, input: InputId) -> Vec<RunId> {
    document
        .runs
        .iter()
        .filter(|run| run.consumes_input(input))
        .map(|run| run.id)
        .collect()
}

/// The runs that consumed one layer, in document order.
///
/// The layer's own history, distinct from its source's: a run that consumed
/// the reference is the reference's, and one that consumed the layer is the
/// layer's.
#[must_use]
pub fn layer_consuming_runs(document: &ProjectDocument, layer: LayerId) -> Vec<RunId> {
    document
        .runs
        .iter()
        .filter(|run| run.consumes_layer(layer))
        .map(|run| run.id)
        .collect()
}

/// The run that produced one artifact, if a run in this document claims it.
///
/// `None` is a state, not a failure: an artifact whose producing run was
/// removed is still a record of what was observed, and saying "no run in this
/// project claims this" is the true thing to say about it.
///
/// There is never more than one. A document in which two runs name the same
/// artifact is refused at [`super::record::validate`], so this returns the
/// first match knowing there is no second.
#[must_use]
pub fn producing_run(document: &ProjectDocument, artifact: ArtifactId) -> Option<RunId> {
    document
        .runs
        .iter()
        .find(|run| run.output_artifact_ids.contains(&artifact))
        .map(|run| run.id)
}

/// The inputs one artifact recorded observations of, in the artifact's own
/// order.
///
/// Read from the artifact rather than from its producing run. The two agree for
/// anything this build writes -- a capture observes exactly what it was asked
/// to -- but they are different questions: the run says what it was *asked* to
/// observe, and the artifact says what it actually *did* observe. An artifact
/// whose run was removed still answers this one.
///
/// Empty for a QC snapshot, which observed no reference: it copied a preview,
/// and what that preview was of is the layer its run consumed.
#[must_use]
pub fn source_inputs(document: &ProjectDocument, artifact: ArtifactId) -> Vec<InputId> {
    document
        .artifacts
        .iter()
        .find(|recorded| recorded.id == artifact)
        .and_then(|recorded| recorded.payload.file_facts())
        .map(|facts| {
            facts
                .observations
                .iter()
                .map(|observation| observation.input_id)
                .collect()
        })
        .unwrap_or_default()
}
