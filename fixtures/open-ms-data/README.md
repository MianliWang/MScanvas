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

## Representative scale fixture: PRIDE PXD081190

The M0C Slice 2B navigation and scale measurements used one representative public
open-format acquisition. It is not tracked here and must never be committed; it is acquired
at execution time inside a disposable runtime and discarded during teardown.

- accession: [`PXD081190`](https://www.ebi.ac.uk/pride/archive/projects/PXD081190) — "Annotation-independent phylogenetic analysis of molecular phenotypes from mass spectrometry data using TreeMS2"
- file: `BBM_506_P110_31_MIA_004_30_calibrated.mzML`
- official download: <https://ftp.pride.ebi.ac.uk/pride/data/archive/2026/07/PXD081190/BBM_506_P110_31_MIA_004_30_calibrated.mzML>
- size: `208,408,454` bytes
- SHA-256: `262D1178303CD934223239D5D93A3B842DCA69DA09CEF58E95A39B950D26B7E8`
- license: `Creative Commons Public Domain (CC0)`, as reported by the PRIDE Archive API for this project
- attribution: cite accession `PXD081190`; submitted by the University of Antwerp. CC0 imposes no legal attribution requirement, so this is scientific practice rather than a licence term.
- provenance: a real bottom-up LC-MS/MS acquisition, not synthetic data

Its measured structure is `indexedmzML` with `36,319` spectra, all MS2, no chromatograms,
declared point counts from `10` to `399` with a median of `41`, retention times in minutes,
and no `referenceableParamGroup` indirection.

The file name encodes a sample identifier. It appears only in this provenance section;
every published runtime record aliases it to `<representative-fixture>`, and the evidence
sanitizer rejects both the exact name and its prefix.

Acquisition is a two-stage protocol. A first isolated run re-queries the live PRIDE record
and requires the accession, public CC0 licence, advertised size and official location to
still match, downloads the file once with no redirect allowance, records the SHA-256 above
and discards the payload without executing anything. Only then is that hash pinned, and a
measurement run refuses to start without it. Repeat both stages before any future use;
neither the size nor the hash may be assumed.

Suitable for: representative navigation and scale observation, repeated random-access
measurement, conversion integrity against a real acquisition, and post-conversion
reinspection. Not suitable for: vendor-reader coverage, stored BPC chromatograms, MS1
behaviour of any kind, chromatogram handling, alternate-locale parsing, real cancellation,
or any universal performance claim. One file on one shared two-core hosted runner is a
single observation.
