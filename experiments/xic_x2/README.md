# XIC X2 evidence runners

Experiment code only; nothing here ships. The record is
[X2 evidence](../../docs/spikes/XIC_X2_CANDIDATE_EVIDENCE.md); the decision is
[ADR 0072](../../docs/architecture/adr/0072-xic-candidate-decision-x3.md).

`harness_x2.py` and `run_supplement_x2.py` are hashed revisions of PX.3's
`harness.py` and `run-supplement.py`, which hard-code B's executable. Those stay
byte-identical in their archives, and these import `compare()`, `peak()`, `js()` and
`canonical()` from there after checking digests. Nothing is written to an archive,
which is why every command runs with `python -B`.

Reproduce on Windows, from the repository root. `PX3` and `REPS` are the two local
PX.3 archives; `OUT` is a new folder outside the repository; `R0` is the R0 profile
mzML. Each command writes a new folder and refuses one that exists. Before each,
check the memory gate: 8 GiB free and at most 80% used.

```text
python -B experiments/xic_x2/harness_x2.py identity --repo . --out OUT/build
python -B experiments/xic_x2/harness_x2.py run --px3 PX3 --build OUT/build --out OUT/main
python -B experiments/xic_x2/run_supplement_x2.py --reps REPS --build OUT/build --out OUT/supplement
python -B experiments/xic_x2/combine_x2.py --main OUT/main --supplement OUT/supplement --out OUT
python -B experiments/xic_x2/integer_rows.py freeze --out OUT/integer
python -B experiments/xic_x2/integer_rows.py run --px3 PX3 --build OUT/build --dir OUT/integer --out OUT/integer-scored
python -B experiments/xic_x2/observe_x2.py --px3 PX3 --build OUT/build --out OUT/observations \
  profile=REPS/inputs/20171016_POOL_POS_1_105-134.mzML=1=105=134 \
  centroid=REPS/inputs/PestMix1_DDA.mzML=1=100=102 \
  r0_narrow=R0=1=524.259257355=524.269742645 \
  r0_whole=R0=1=360=1300
```

`identity` runs the build itself,
`cargo build -p mscanvas-proteowizard --release --example xic_candidate --locked`,
from a clean tree. The example is package-scoped: a root-scoped `--example` turns on
`test-support` and hits that feature's `compile_error!`. No ProteoWizard program runs
at any step.

`--mutation NAME` lets `identity` build from a changed tree, for the controls in the
record's "Whether the run can fail", and `combine_x2.py` refuses such a build.
`--supersedes` on `freeze` writes a new freeze after a runner-only revision, and it
refuses one that changes an input or an answer.

`test_record.py` checks what the record and ADR 0072 say against the record's own tables
and, with `MSCANVAS_X2_EVIDENCE` set to the retained folder, against the retained runs. No
identity digest binds it, and it is run by hand.
