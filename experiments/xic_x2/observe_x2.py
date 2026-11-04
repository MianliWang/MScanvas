"""Release resource observations of the production pass (ADR 0071 decisions 8 and 9).

Three serial runs per target, each process running read_xic once on the source
itself: no snapshot, no metadata echo and no positions. Wall time spans process
launch to exit, as PX.3 timed it; pass_wall_seconds spans read_xic alone. Memory is
the process's final Windows PeakWorkingSetSize. These are observations of one host
and one build, never thresholds.

  observe_x2.py --px3 PX3 --build BUILD --out EVIDENCE TARGET...

A TARGET is NAME=PATH=MS_LEVEL=LOW=HIGH.
"""
import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import harness_x2 as x2


def main(args):
    harness, _ = x2.load_frozen(args.px3)
    exe, build = x2.load_build(args.build)
    args.out.mkdir(parents=True, exist_ok=False)
    observations = []
    for target in args.targets:
        name, path, level, low, high = target.split("=")
        path = pathlib.Path(path)
        source = dict(name=name, bytes=path.stat().st_size, sha256=x2.sha(path), query=[level, low, high])
        for repeat in range(args.repeats):
            x2.emergency_stop()
            folder = args.out / f"{name}-{repeat + 1}"
            folder.mkdir()
            diagnostics = x2.invoke(harness, exe, path, source["query"], folder / "unused", "observe", folder)
            assert diagnostics["exit_code"] == 0, (name, (folder / "stderr.txt").read_text(encoding="utf-8"))
            result = json.loads((folder / "stdout.json").read_text(encoding="utf-8"))
            record = dict(source=source, repeat=repeat + 1, wall_seconds=diagnostics["wall_seconds"], peak_working_set_final_bytes=diagnostics["peak_working_set_final_bytes"], result=result, host=x2.host(), created_utc=datetime.now(timezone.utc).isoformat())
            x2.dump(folder / "result.json", record)
            observations.append(record)
            print(json.dumps(dict(name=name, repeat=repeat + 1, wall=round(diagnostics["wall_seconds"], 3), peak=diagnostics["peak_working_set_final_bytes"], **result)), flush=True)
    x2.dump(args.out / "OBSERVATIONS.json", dict(identity=build, runners=x2.runner_hashes(), observations=observations))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--px3", type=pathlib.Path, required=True)
    parser.add_argument("--build", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("targets", nargs="+")
    main(parser.parse_args())
