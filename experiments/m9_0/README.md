# M9.0 targeted MS1 experiment

Experiment code only; nothing here ships. The record is
[M9.0 route evidence](../../docs/spikes/M9_0_TARGETED_MS1_ROUTE_EVIDENCE.md); the
decision is the [M9.1 handoff](../../docs/product/M9_1_TARGETED_MS1_HANDOFF.md).

Reproduce on Windows x64 with scratch at `.tmp/m90-evidence/` (ignored):

1. Unpack `python-3.13.15-embed-amd64.zip` (digest in [manifest.json](manifest.json))
   to `.tmp/m90-evidence/runtime/cpython-3.13.15-embed/` and add a `site-packages`
   line to `python313._pth`.
2. Download the locked wheels, then install them offline:
   `pip --isolated install --no-index --find-links <wheels> --require-hashes --no-deps --no-compile
   --only-binary=:all: --platform win_amd64 --python-version 3.13 --implementation cp --abi cp313
   --target <runtime>/site-packages -r runtime/requirements-cp313-win_amd64.lock.txt`.
3. With the runtime's `python.exe -X utf8`:
   `protocol.py generate .tmp/m90-evidence/fixtures`, then
   `controller.py run .tmp/m90-evidence` and `controller.py evaluate .tmp/m90-evidence`;
   `protocol_r2.py generate .tmp/m90-evidence/round2/fixtures`, then
   `controller.py run2 .tmp/m90-evidence/round2 .tmp/m90-evidence` and
   `protocol_r2.py evaluate .tmp/m90-evidence/round2 .tmp/m90-evidence`;
   `diagnostics.py .tmp/m90-evidence`, `diagnostics.py relocate .tmp/m90-evidence`,
   `storage_proto.py .tmp/m90-evidence` and `report.py .tmp/m90-evidence`.

The upstream regression case needs the three `FeatureFinderMetaboIdent_1` files
from the pinned OpenMS commit in `.tmp/m90-evidence/data/openms-regression/`.
