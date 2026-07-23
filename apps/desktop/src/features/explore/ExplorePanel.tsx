const chromatogramPath =
  "M12 132 C34 130 42 126 58 128 C76 130 84 110 94 114 C112 121 118 78 130 86 C145 98 153 34 168 54 C181 72 188 24 202 45 C214 61 224 92 238 86 C255 78 266 111 281 105 C296 99 309 119 326 112 C341 106 354 124 372 117";

const spectrumPeaks = [
  [24, 108],
  [46, 88],
  [67, 119],
  [83, 52],
  [102, 96],
  [128, 35],
  [151, 77],
  [177, 19],
  [203, 69],
  [229, 42],
  [255, 102],
  [282, 57],
  [313, 91],
  [341, 48],
  [365, 112],
];

interface ExplorePanelProps {
  activeName: string | null;
}

export function ExplorePanel({ activeName }: ExplorePanelProps) {
  return (
    <main className="viewer-stack" aria-label="Linked mass spectrometry viewer">
      <section className="panel chart-panel" aria-labelledby="chromatogram-heading">
        <header className="panel-header compact">
          <div>
            <h2 id="chromatogram-heading">Chromatogram</h2>
            <p>{activeName ?? "No acquisition selected"}</p>
          </div>
          <div className="segmented-control" aria-label="Chromatogram type">
            <button className="is-selected" type="button">
              TIC
            </button>
            <button type="button" disabled title="Mock shell: BPC loading is not connected">BPC</button>
          </div>
        </header>
        <svg
          aria-label="Mock total ion chromatogram"
          className="plot"
          role="img"
          viewBox="0 0 384 152"
        >
          <g className="plot-grid">
            <line x1="12" x2="372" y1="38" y2="38" />
            <line x1="12" x2="372" y1="76" y2="76" />
            <line x1="12" x2="372" y1="114" y2="114" />
          </g>
          <path className="chromatogram-line" d={chromatogramPath} />
          <line className="selection-line" x1="177" x2="177" y1="16" y2="132" />
          <text className="axis-label" x="328" y="148">
            RT (min)
          </text>
        </svg>
      </section>

      <section className="panel chart-panel" aria-labelledby="spectrum-heading">
        <header className="panel-header compact">
          <div>
            <h2 id="spectrum-heading">Mass spectrum</h2>
            <p>Scan 5,482 · MS2 · RT 8.42 min</p>
          </div>
          <button className="quiet-button" type="button" disabled title="Planned for M4">
            Export figure
          </button>
        </header>
        <svg aria-label="Mock centroid mass spectrum" className="plot" role="img" viewBox="0 0 384 152">
          <g className="plot-grid">
            <line x1="12" x2="372" y1="38" y2="38" />
            <line x1="12" x2="372" y1="76" y2="76" />
            <line x1="12" x2="372" y1="114" y2="114" />
          </g>
          {spectrumPeaks.map(([x, y]) => (
            <line className="spectrum-peak" key={`${x}-${y}`} x1={x} x2={x} y1="132" y2={y} />
          ))}
          <text className="peak-label" x="168" y="15">
            445.2187
          </text>
          <text className="axis-label" x="346" y="148">
            m/z
          </text>
        </svg>
      </section>
    </main>
  );
}
