# Artifact, project and lineage model

## Core entities

### Project

A user-owned logical workspace containing references to artifacts, saved views/figures, settings and runs. It does not imply copying acquisition data.

### Artifact

A typed inspectable object with identity, display metadata, location/storage, availability and lineage.

Candidate kinds:

- Acquisition (vendor RAW/directory dataset)
- OpenMsRun (mzML/mzXML)
- Chromatogram / SpectrumSelection
- FeatureMap / FeatureTable / AlignedFeatureTable
- SpectrumCollection / SpectralMatchTable
- QcReport / StatisticalResult
- Figure

### Run

One execution attempt with module/backend identity, parameters, inputs, status, timestamps, events/logs and outputs.

### Module

A typed operation that declares compatible inputs, parameter schema, outputs, capabilities and execution provider.

## Identity

Artifact identity must distinguish logical identity from path. Single files can later use configurable hashes; directory datasets need normalized manifest identity. Hashing is not required for the first UI slice, but the model must not assume every acquisition is one file.

## Lineage

```text
Acquisition --conversion run--> OpenMsRun
OpenMsRun --feature recipe--> FeatureMap
FeatureMaps --alignment run--> AlignedFeatureTable
AlignedFeatureTable --PCA run--> StatisticalResult
```

Each derived artifact can answer:

- which inputs produced it;
- which module/provider/version ran;
- parameters and warnings;
- status and relevant logs;
- compatible views and downstream modules.

## Selection versus artifact

A transient selected scan or m/z point is not automatically a persisted artifact. It becomes one only when the user saves/pins/exports it or a module requires a stable reference.
