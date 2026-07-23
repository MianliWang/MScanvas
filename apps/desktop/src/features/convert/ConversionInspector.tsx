interface ConversionInspectorProps {
  activeName: string | null;
  selectedCount: number;
}

export function ConversionInspector({ activeName, selectedCount }: ConversionInspectorProps) {
  return (
    <aside className="panel inspector-panel" aria-labelledby="inspector-heading">
      <header className="panel-header">
        <div>
          <h2 id="inspector-heading">Inspector</h2>
          <p>{activeName ?? "Batch settings"}</p>
        </div>
      </header>

      <section className="inspector-section">
        <h3>Acquisition</h3>
        <dl className="metadata-list">
          <div>
            <dt>Instrument</dt>
            <dd>Q Exactive HF</dd>
          </div>
          <div>
            <dt>Scans</dt>
            <dd>18,412</dd>
          </div>
          <div>
            <dt>MS levels</dt>
            <dd>MS1, MS2</dd>
          </div>
          <div>
            <dt>Representation</dt>
            <dd>Mixed</dd>
          </div>
        </dl>
      </section>

      <section className="inspector-section">
        <h3>Conversion</h3>
        <label className="field">
          <span>Output format</span>
          <select defaultValue="mzML">
            <option value="mzML">mzML</option>
            <option value="mzXML">mzXML (legacy)</option>
          </select>
        </label>
        <label className="field">
          <span>Spectrum processing</span>
          <select defaultValue="preserve">
            <option value="preserve">No additional centroiding</option>
            <option value="ms2">Centroid MS2</option>
            <option value="all">Centroid MS1 + MS2</option>
          </select>
        </label>
        <div className="conversion-summary">
          <strong>{selectedCount} selected</strong>
          <span>Compressed mzML · no overwrite · local output</span>
        </div>
      </section>
    </aside>
  );
}
