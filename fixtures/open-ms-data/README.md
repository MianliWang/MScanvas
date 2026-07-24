# Open mass-spectrometry fixtures

Record lawful public mzML/mzXML fixtures here by source URL, version/accession, license/redistribution terms, checksum and the behavior they cover. Do not commit vendor RAW files without explicit redistribution permission.

## Candidate: ProteoWizard tiny mzML

`tiny.pwiz.1.1.mzML` is not currently tracked. The reviewed candidate is ProteoWizard's synthetic mzML example, pinned to upstream commit `a09eea91209131f6aa487f7316647fc536188c19`:

- source: <https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/example_data/tiny.pwiz.1.1.mzML>
- raw download: <https://raw.githubusercontent.com/ProteoWizard/pwiz/a09eea91209131f6aa487f7316647fc536188c19/example_data/tiny.pwiz.1.1.mzML>
- size: `25,072` bytes
- SHA-256: `711ac14b666f14817c208bd4d39b738e96ac827574c4639d8f8f6eebbfde9c83`
- license: [Apache-2.0](https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/LICENSE); the pinned root license permits reproduction and distribution, and the example-data writer carries the same license
- provenance: generated from ProteoWizard's in-memory [`examples::initializeTiny`](https://github.com/ProteoWizard/pwiz/blob/a09eea91209131f6aa487f7316647fc536188c19/pwiz/data/msdata/examples.cpp) test model; it is not a vendor or biological acquisition

To acquire it, download the pinned raw URL to a temporary staging path, verify both the exact byte size and SHA-256 above, then copy the unchanged bytes into this directory only when adding the fixture is authorized. Record the upstream attribution when the file becomes tracked.

The fixture contains four spectra with MS levels `1, 2, 1, 1`, two chromatograms, m/z and intensity arrays, TIC data, and profile/centroid markers. It is suitable for deterministic open-format smoke checks of metadata, counts, MS-level distribution, RT/TIC, one selected spectrum and an unavailable-scan error. It is not evidence for vendor-reader coverage, a stored BPC chromatogram, conversion fidelity, realistic performance or memory use, process cancellation/partial output, or scientific suitability.

Always derive `msaccess` commands and parsing expectations from the installed build's help/usage output. Historical online documentation and this fixture description are provenance aids, not the executable contract.
