# PX.4 — B-only XIC provider decision and M7 handoff

Status: **XIC_PROVIDER_REFUSED — authorized B-only evaluation.**
Date: 2026-09-12. Decision baseline: `64c721159421da84cef1cb85e34141d6769fd307`,
the published PX.3 supplement in [PR #117](https://github.com/MianliWang/MScanvas/pull/117).
Authority: [ADR 0046](../architecture/adr/0046-post-m6-xic-provider-runtime-route-lock.md#the-slice-route)
and the owner's separate PX.4 authorization. Markdown only.

**The bounded interlude ends on its non-admission branch.** This pinned B
candidate does not meet the frozen source-domain contract. No provider is
admitted, production XIC remains unimplemented, and PX.5 / PX.6 are **NOT ENTERED**.
M6 remains complete. **M7's route / first-release-scope decision is NEXT / NOT
STARTED**, requiring its own authorization.

## Evaluation identity and evidence custody

The evaluated set contains **only B**, as the owner selected before PX.2 and
confirmed for PX.3 and this decision. It is not a selection of B for production
or a comparison with A. The subject is the standalone `repaired-v1` candidate
in [PX.3](PX_3_XIC_COMPARATIVE_EVIDENCE.md#recovered-baseline-and-unchanged-final-candidate-identity),
not the earlier PX.2 binary or a newly repaired reader.

| Binding | Exact identity |
| --- | --- |
| Candidate source manifest SHA256 | `0986ed9bdb999892b114f5f40ae24554f3ef3513fa7f24b36f677730a9941990` |
| Full Cargo.lock SHA256 | `9863e066c2574d699a39d0c36ea62a83c5037a3dd3f78dec6e076c43c8863e01` |
| Scored executable SHA256 | `7751cd0c46911098012d347867dbe032a76ad7f41db96454941243157d3ddf8b` |
| Initial protocol SHA256 | `e3a7340a937d2d48bf968270a538bdf18c36f3a2390e07177f762add503a4b6f` |
| Supplemental freeze SHA256 | `3de43a2b748ad9001f2ff9c628773f8669363b449bc4b8fa5956ea8fc0f3967a` |

`mzdata` and its bindata/meta/param/spectrum companions remain **0.66.6**.
Defaults are disabled; requested `mzml` / `miniz_oxide`, their required feature
edges and the complete lock are unchanged. The measured executable used the
existing Rust/Cargo 1.97.1 Windows MSVC dev/debug toolchain. PX.4 performed no
dependency resolution, build, candidate execution or new scientific measurement.

The initial and supplemental archives jointly retain the complete evidence.
Read-only access in PX.4 verified both archive identities and selected entries
against their manifests, including the frozen protocol, candidate identity,
combined ledger and the decisive reference/results. Nothing was extracted or
executed. The original archives, scratch, failed runs and approval history remain
untouched; no acquisition bytes, archive or private filesystem path is published
by this task.

| Retained archive | Bytes | SHA256 |
| --- | --- | --- |
| `px3-b-evidence.zip` | 168611147 | `be25076e6f9ef06acf482b92e2d9141bd68ca13c3eaeba98595736412c981977` |
| `px3-approved-input-evidence-v2.zip` | 102171819 | `74194d5f44202e839fb33c00c91bde0bc22302e0a42ea22eda5dfda0f75c431d` |

## Ordered decision

**1. Required evidence is complete.** The [current PX.3 ledger](PX_3_XIC_COMPARATIVE_EVIDENCE.md#current-complete-ledger)
and supplemental `evidence/combined-summary.json` record **77 rows: 76 PASS /
1 FAIL / 0 MISSING**, including three passing fault controls. All thirty named
cases pass; those thirty are not the whole contract. The supplemental evidence
fills the four earlier gaps on the same executable. Original lowint/duprt
physical files remain absent: unmodified historical generators reproduced
byte lengths and SHA256 identities exactly, and new independent references and
candidate runs establish those rows. This is exact-content reproduction, not
recovery of old physical objects or reuse of historical scientific outcomes.
The two approved representative roles have obtained independent references.
The earlier permission-gap publication remains history, not a current missing
row. A is outside the set and does not create an evidence gap within it.

**2. B fails an applicable source-domain/read requirement.** The
[located prefixed-mzML failure](PX_3_XIC_COMPARATIVE_EVIDENCE.md#the-applicable-pinned-reader-failure)
is decisive. Initial `protocol/case-ledger.json` includes `prefixed` as a normal
semantic case; `protocol/PROTOCOL.md` explicitly makes legal namespace prefixes
applicable before scoring. `generate.py` documents a namespace-only derivation
from the same valid one-scan construction used inside the indexed control.
PX.4's readback confirms that `inputs/prefixed.mzML` and the mzML subtree of
`inputs/indexed.mzML` have equal resolved element names, attributes and payload
text. No payload was decoded anew, and no rewritten input was given to B.

The retained `protocol/oracle-answers.json` answers for both cases are equal:
three in-window points, sum **0.875**, binary64 bits `3fec000000000000`, complete
source coverage. Under `evidence/repaired-v1/`, `prefixed-1/result.json` and
`prefixed-2/result.json` both record FAIL; their `science.json` files retain the
one scan's metadata but return **`CandidateReadIncomplete:EOF`, `complete:false`**.
The corresponding `indexed-1` and `indexed-2` results pass with complete science
equal to the retained reference. Honest incompleteness avoids a false successful
trace; it does not satisfy support for this legal source.

PX.3's published pinned-source inspection locates literal qualified-name
matching in mzdata 0.66.6's reader. This explains the observed reader limitation;
PX.4 does not repeat that audit. The defect is not a malformed acquisition,
a missing oracle, or evidence that all B's sums are arithmetically wrong.

**3. The evaluated survivor set is empty at the scientific/source-domain gate.**
Consequently ADR 0046 yields **XIC_PROVIDER_REFUSED**, before practicality or
runtime-placement filtering. Neither a high pass ratio nor passing the named
subset overrides the complete frozen source contract. The decision concerns
this exact candidate and domain; it does not reject every mzdata version,
every mzML input, or XIC as a scientific quantity.

**4. Practical acceptability for admission is NOT REACHED.** The
[representative resource observations](PX_3_XIC_COMPARATIVE_EVIDENCE.md#resource-observations-at-these-two-file-scales)
remain valid observations of their exact approved files, host and dev/debug
executable. Each has three serial runs. The profile is a publisher-defined
subset. Timing includes process launch, source reading, traversal/query and
stdout/snapshot serialization, with independent reference work outside it;
memory is the final OS peak working set. These observations neither establish
production readiness nor justify a new latency or memory threshold. This refusal
does not rest on measured impracticality, a release-build estimate or an imagined
large-acquisition budget.

**5. No admission or architecture selection follows.** `EVIDENCE_BLOCKED` does
not apply because the required evidence was obtained. `XIC_PROVIDER_ADMITTED`
does not apply because no evaluated candidate meets the complete contract.
`ARCHITECTURE_DECISION_REQUIRED` is unreachable without a scientifically
acceptable and practical survivor whose placement remains unsettled. A's
unperformed trust-boundary/runtime experiment supplies no such survivor.
There are no multiple admissible contenders, so XIC-D4's governance choice is
not invoked and no winner is chosen implicitly.

## Semantic and direction boundaries

XIC-S2, XIC-S3 and XIC-S4 remain exactly as decided in ADR 0046: source unit
absence is preserved without inference/conversion, arithmetic uses the frozen
source-value agreement rule, and in-window nonfinite intensity yields
`NonFiniteIntensity` without a sum. No threshold, precedence or legal source
domain is relaxed to rescue the candidate.

**XIC-S1, for this outcome:** the profile point-sum evidence is valid, but no
profile XIC is offered on the non-admission branch. Nothing here calls a point
sum an integrated area, and no integration semantics is needed to close this
branch. **XIC-D5** governs placement and value-axis evidence before an admitted
runtime can be authorized. That branch is not entered; no rendering experiment
is required here. Its conditional ownership remains intact, not falsely marked
completed or reassigned to M7.

| Direction | Disposition carried into the handoff |
| --- | --- |
| B | This pinned candidate fails the frozen source-domain contract; refused in this evaluation |
| A | **VIABLE / NOT PROTOTYPED / NOT REJECTED / OUTSIDE THIS EVALUATION SET**, as [PX.1](PX_1_XIC_PROVIDER_API_AUDIT.md#viability-matrix) and [PX.2](PX_2_XIC_BOUNDED_PROTOTYPES.md) record |
| C | PX.1 **NOT VIABLE AS DEFINED**: existing full-array access was a false premise; no claim that a new decoder is impossible |

## Terminal handoff and publication

The interlude is finished, not waiting for A or an automatic B repair. PX.5 and
PX.6 are **NOT ENTERED**, not failed implementation slices or unresolved work
needed to close PX.4. XIC remains unavailable for the stated provider reason;
there is no simulated trace, fallback, replacement-provider search or newly
added disabled control. Any user-facing explanation belongs to the authorized
frontend owner in the existing availability posture.

[ADR 0045's M7/M8 handoff](../architecture/adr/0045-conversion-completion-closure-and-handoff.md#the-m7-and-m8-seams)
stands. M6 completion, CNV-D2 source qualification, existing provider/integrity
gates, M5.4's separately scoped refusal and all four M6.10 dispositions are
unchanged. Experimental B's refusal does not revoke the shipped mzML preview,
vendor conversion or figure export. Issue #112 and the native **NOT RE-RUN**
residual retain their current owners and status.

The repository owner may next authorize **M7's route / first-release-scope
decision**. This handoff neither starts M7 nor chooses a shell, stack, release
scope or release-ready status. No XIC follow-up is a prerequisite. A future
owner may separately authorize a newly identified B compatibility investigation
covering legal namespaces and affected evidence reruns, or a bounded A experiment.
Neither is scheduled. Prefix stripping, XML rewriting, wrapper substitution,
reader patching/upgrading or excluding this case cannot silently carry this
candidate's authorization forward.

Publication requires the actual reviewed Markdown head's required checks and
review, protected true merge pinned to that head, actual ordered-parent/tree
verification, natural `push` / `main` CI and local ff-only closeout. The PR's
publication record and task-owned local closeout retain those actual identities;
this decision baseline is not a preview merge or a claim that publication has
already occurred.
