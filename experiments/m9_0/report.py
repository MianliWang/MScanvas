#!/usr/bin/env python3
"""M9.0 developer-only inspection page, generated from actual experiment output.

    python report.py <scratch-root>   ->  <scratch-root>/report/index.html

Every number and every curve comes from a published result and its evidence
lines: the chromatogram points the engine extracted, the boundaries it picked,
the candidates it considered and the outcome the adapter derived. Nothing is
re-smoothed or re-drawn from the fixture specification. The sources are
synthetic fixtures or the OpenMS regression input, and the page says which.
It is a local file for developers, not a product route. Standard library only.
"""

from __future__ import annotations

import html
import json
import sys
from pathlib import Path

RUNS = [
    ("round2", "r2_strict", "Round 2 strict-domain fixture (synthetic, seed 93)"),
    ("", "main", "Round 1 main fixture (synthetic, seed 90) - contains two MS1 spectra sharing RT 60.0 s"),
    ("", "reg_upstream_1", "OpenMS FeatureFinderMetaboIdent_1 regression input (profile; accepted by experiment flag)"),
]
OUTCOME_MARK = {"DETECTED": "&#10003;", "DETECTED_AMBIGUOUS": "&#9888;", "SHARED": "&#9888;",
                "SUPPRESSED_BY_OVERLAP": "&#9888;", "NOT_DETECTED": "&#8709;", "FAILED": "&#10007;"}

CSS = """
:root{--bg:#f3f5f8;--surface:#fff;--subtle:#f7f8fa;--border:#dce3eb;--strong:#9aa9bc;--ink:#172337;--muted:#4b5b70;
--primary:#1769d1;--select:#edf4ff;--warn:#8a5a00;--bad:#b3261e;--m1:#1769d1;--m2:#c2410c}
@media (prefers-color-scheme:dark){:root{--bg:#10151d;--surface:#18202b;--subtle:#1e2733;--border:#2c3847;--strong:#5b6b80;
--ink:#e6ebf2;--muted:#a7b3c2;--primary:#6aa6f0;--select:#1d2c40;--warn:#e0b050;--bad:#f28b82;--m1:#6aa6f0;--m2:#f5a26b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font:14px/1.45 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}
h3{font-size:14px;margin:0}.note{color:var(--muted);font-size:13px}.banner{border:1px solid var(--strong);background:var(--subtle);
border-radius:8px;padding:8px 12px;margin:12px 0 16px;font-size:13px}
section{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin:0 0 16px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0;font-size:13px}dt{color:var(--muted)}dd{margin:0;
overflow-wrap:anywhere}code{font:12px Consolas,monospace}.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums lining-nums}
th,td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top;white-space:nowrap}
th{color:var(--muted);font-weight:600}td.num{text-align:right}.o-DETECTED{color:var(--ink)}
.o-DETECTED_AMBIGUOUS,.o-SHARED,.o-SUPPRESSED_BY_OVERLAP{color:var(--warn)}.o-FAILED{color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px;margin-top:12px}
figure{margin:0;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--subtle)}
figcaption{font-size:12px;color:var(--muted);margin-top:4px}svg{width:100%;height:auto;display:block}
.axis{stroke:var(--strong);stroke-width:1}.lab{fill:var(--muted);font-size:10px}.m1{stroke:var(--m1);fill:none;stroke-width:1.5}
.m2{stroke:var(--m2);fill:none;stroke-width:1.2;stroke-dasharray:4 2}.feat{fill:var(--select);stroke:var(--primary);stroke-width:1}
.cand{stroke:var(--muted);stroke-dasharray:2 3;fill:none}.apex{stroke:var(--primary);stroke-width:1.5}
"""


def esc(value) -> str:
    return html.escape(str(value))


def fmt(value, digits=6):
    if value is None:
        return "&mdash;"
    if isinstance(value, float):
        return f"{value:.{digits}g}"
    return esc(value)


def chart(row: dict, traces: list) -> str:
    w, h, pl, pr, pt, pb = 360, 170, 46, 8, 8, 28
    start, end = row["windows"]["rt_closed_s"]
    ymax = max([p[3] for t in traces for p in t["points"]] + [1.0])
    x = lambda rt: pl + (rt - start) / (end - start) * (w - pl - pr)  # noqa: E731
    y = lambda v: pt + (1 - v / ymax) * (h - pt - pb)  # noqa: E731
    parts = [f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="Engine-extracted chromatogram for {esc(row["target_id"])}">']
    f = row.get("feature")
    if f:
        parts.append(f'<rect class="feat" x="{x(f["left_s"]):.1f}" y="{pt}" width="{max(1.0, x(f["right_s"]) - x(f["left_s"])):.1f}" '
                     f'height="{h - pt - pb}" opacity="0.6"/>')
    for c in row.get("candidates") or []:
        for edge in (c["left_s"], c["right_s"]):
            parts.append(f'<line class="cand" x1="{x(edge):.1f}" x2="{x(edge):.1f}" y1="{pt}" y2="{h - pb}"/>')
    for cls, t in zip(("m1", "m2"), traces):
        pts = " ".join(f"{x(p[2]):.1f},{y(p[3]):.1f}" for p in t["points"])
        parts.append(f'<polyline class="{cls}" points="{pts}"/>')
    if f:
        parts.append(f'<line class="apex" x1="{x(f["rt_s"]):.1f}" x2="{x(f["rt_s"]):.1f}" y1="{pt}" y2="{h - pb}"/>')
    parts.append(f'<line class="axis" x1="{pl}" x2="{w - pr}" y1="{h - pb}" y2="{h - pb}"/>'
                 f'<line class="axis" x1="{pl}" x2="{pl}" y1="{pt}" y2="{h - pb}"/>'
                 f'<text class="lab" x="{pl}" y="{h - 14}">{start:g}</text>'
                 f'<text class="lab" x="{w - pr}" y="{h - 14}" text-anchor="end">{end:g}</text>'
                 f'<text class="lab" x="{(pl + w - pr) / 2:.0f}" y="{h - 2}" text-anchor="middle">RT (s, closed window)</text>'
                 f'<text class="lab" x="{pl - 4}" y="{pt + 8}" text-anchor="end">{ymax:.3g}</text>'
                 f'<text class="lab" x="{pl - 4}" y="{h - pb}" text-anchor="end">0</text></svg>')
    return "".join(parts)


def run_section(root: Path, sub: str, case: str, title: str) -> str:
    pub = root / sub / "runs" / case / "published"
    attempt = json.loads((root / sub / "runs" / case / "attempt.json").read_text(encoding="utf-8"))
    result = json.loads((pub / "result.json").read_text(encoding="utf-8"))
    evidence: dict = {}
    for line in (pub / "evidence.jsonl").read_text(encoding="utf-8").splitlines():
        e = json.loads(line)
        evidence.setdefault(e["target_id"], []).append(e)
    rt = result["runtime"]
    req = result["request"]
    head = (f'<section><h2>{esc(title)}</h2><dl>'
            f'<dt>Run</dt><dd><code>{esc(result["run_id"])}</code> &middot; {esc(attempt["status"])} &middot; '
            f'{attempt["wall_s"]} s wall &middot; peak working set {attempt["peak_working_set_bytes"] / 2**20:.1f} MiB</dd>'
            f'<dt>Source</dt><dd><code>{esc(Path(req["source"]["path"]).name)}</code> &middot; {result["source"]["bytes"]} bytes '
            f'&middot; SHA-256 <code>{esc(result["source"]["sha256"])}</code> &middot; {result["source"]["ms1_spectra"]} MS1 of '
            f'{result["source"]["spectra"]} spectra</dd>'
            f'<dt>Parameters</dt><dd>m/z half-width {req["parameters"]["mz_half_width_ppm"]} ppm (engine full window '
            f'{result["engine_parameters"]["extract:mz_window"]} ppm, open interval) &middot; expected peak width '
            f'{req["parameters"]["expected_peak_width_s"]} s &middot; experiment flags <code>{esc(json.dumps(req.get("experiment", {})))}</code></dd>'
            f'<dt>Engine</dt><dd>pyOpenMS {esc(rt["pyopenms"]["version"])} &middot; OpenMS {esc(rt["openms"]["version"])} '
            f'(self-reported revision <code>{esc(rt["openms"]["revision"])}</code>) &middot; FeatureFinderAlgorithmMetaboIdent '
            f'&middot; upstream label: experimental</dd>'
            f'<dt>Runtime</dt><dd>CPython {esc(rt["python"]["version"].split()[0])} embeddable, isolated={rt["python"]["flags"]["isolated"]}; '
            f'{rt["module_count"]} modules loaded, {len(rt["modules_outside_runtime_or_system"])} from outside the runtime or system</dd></dl>')
    rows = ['<div class="scroll"><table><thead><tr><th>Target</th><th>Outcome</th><th>Ion m/z (theoretical)</th>'
            '<th>RT window (s)</th><th>Apex RT (s)</th><th>Bounds (s)</th><th>Raw area (binary32)</th>'
            '<th>Model fit</th><th>Engine intensity</th><th>Candidates</th><th>Relations</th></tr></thead><tbody>']
    charts = []
    for r in result["targets"]:
        f = r.get("feature") or {}
        cands = r.get("candidates")
        rows.append(
            f'<tr><td>{esc(r["target_id"])}</td><td class="o-{r["outcome"]}">{OUTCOME_MARK.get(r["outcome"], "")} {esc(r["outcome"])}</td>'
            f'<td class="num">{fmt(r["ion"]["mz"][0], 10)}</td><td>{r["windows"]["rt_closed_s"][0]:g}&ndash;{r["windows"]["rt_closed_s"][1]:g}</td>'
            f'<td class="num">{fmt(f.get("rt_s"), 7)}</td>'
            f'<td>{"&mdash;" if not f else f"{f["left_s"]:g}&ndash;{f["right_s"]:g}"}</td>'
            f'<td class="num">{fmt(f.get("raw_area"), 9)}</td><td>{fmt((f.get("model") or {}).get("status"))}</td>'
            f'<td class="num">{fmt(f.get("engine_intensity"), 9)}{" (" + esc(f["engine_intensity_source"]) + ")" if f else ""}</td>'
            f'<td class="num">{"not captured" if cands is None else len(cands)}</td>'
            f'<td>{esc(json.dumps(r["relations"])) if r["relations"] else ""}</td></tr>')
        traces = sorted(evidence.get(r["target_id"], []), key=lambda e: e["trace"])
        if traces:
            charts.append(f'<figure>{chart(r, traces)}<figcaption><strong>{esc(r["target_id"])}</strong> &middot; '
                          f'{esc(r["outcome"])} &middot; solid M ({traces[0]["mz"]:.5f}), dashed M+1 &middot; shaded: picked '
                          f'bounds; dotted: candidate bounds; signal in window: {any(m > 0 for m in r["signal"]["max"])}</figcaption></figure>')
    rows.append("</tbody></table></div>")
    return head + "".join(rows) + '<div class="grid">' + "".join(charts) + "</div></section>"


def attempts_table(root: Path) -> str:
    out = ['<section><h2>Every attempt</h2><p class="note">Round 1 is the scored result; round 2 is the narrowed-domain '
           'confirmation. Refused and failed attempts publish nothing.</p><div class="scroll"><table><thead><tr>'
           '<th>Round</th><th>Case</th><th>Status</th><th>Code</th><th>Exit</th><th>Wall (s)</th><th>Peak WS (MiB)</th>'
           '<th>Published bytes</th></tr></thead><tbody>']
    for label, sub in (("1", ""), ("2", "round2")):
        for a_path in sorted((root / sub / "runs").glob("*/attempt.json")):
            a = json.loads(a_path.read_text(encoding="utf-8"))
            out.append(f'<tr><td>{label}</td><td>{esc(a["case"])}</td><td>{esc(a["status"])}</td><td>{esc(a["code"])}</td>'
                       f'<td class="num">{a["exit_code"]}</td><td class="num">{a["wall_s"]:.2f}</td>'
                       f'<td class="num">{(a["peak_working_set_bytes"] or 0) / 2**20:.1f}</td>'
                       f'<td class="num">{a["published_bytes"]}</td></tr>')
    out.append("</tbody></table></div></section>")
    return "".join(out)


def main(argv: list[str]) -> int:
    root = Path(argv[1]).resolve()
    body = [f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" '
            f'content="width=device-width,initial-scale=1"><title>M9.0 Inspection</title><style>{CSS}</style></head><body><main>'
            '<h1>M9.0 targeted MS1 &mdash; developer inspection</h1>'
            '<p class="note">Generated from published experiment results. Not a product surface.</p>'
            '<div class="banner">Every row, bound and curve below is actual adapter output: the chromatogram points the engine '
            'extracted and the boundaries it picked. Sources are synthetic fixtures unless stated. Raw area is a sum of '
            'chromatogram points stored as binary32; engine intensity is a model area or an imputed value and depends on the '
            'other targets in the run. Feature m/z is the theoretical ion, not an observed m/z.</div>']
    body += [run_section(root, sub, case, title) for sub, case, title in RUNS]
    body.append(attempts_table(root))
    body.append("</main></body></html>\n")
    out = root / "report" / "index.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text("".join(body), encoding="utf-8", newline="\n")
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
