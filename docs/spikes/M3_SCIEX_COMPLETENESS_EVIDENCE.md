# M3.13 SCIEX per-sample completeness evidence

- **Status:** Closed. For an admitted SCIEX bundle on the evidenced build,
  MSCanvas can establish that every sample the reader identified produced its
  output — and refuses to publish anything when it cannot.
- **Date:** 2026-08-11
- **Decision recorded in:** [ADR 0024](../architecture/adr/0024-sciex-sample-completeness.md)

## The exact stack this is about

| | |
| --- | --- |
| Provider release | `3.0.26013` |
| Provider source revision | `47b13cf` → **`47b13cfec55265af32055720a6c07b9d5bbed721`**, 2026-01-13 |
| `msconvert.exe` SHA-256 | `9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD` |

Everything below was read at that revision or measured against that executable.
Upstream `master` was not used: the executable is bound to this source.

## What the reader does, and where a sample can be lost

`Reader_ABI::read`'s multi-sample overload, at that revision:

```text
sampleCount = getSampleCount()
for i in 1..=sampleCount:
    try   { cacheExperiments; new SpectrumList/ChromatogramList; fillInMetadata;
            results.push_back(...) }
    catch (exception& e) { cerr << "[Reader_ABI::read] Error opening run " << i
                                << " in " << filename << ":\n" << e.what() }
```

- The loop visits **every** enumerated sample. No `break`, no early return, no
  conditional skip.
- Exactly **one** catch site can lose a sample while the loop continues, and it
  emits its marker **unconditionally** before continuing.
- The catch takes `std::exception` only. Anything else reaches the outer
  `catch (...)`, is rethrown, and fails the whole file.
- The lists are lazy, so spectral decoding failures surface later, in the
  driver's write loop, as `Error writing run` — which makes the process exit
  non-zero.
- `fillInMetadata` has three further `try`/`catch` blocks routed through
  `Reader::Config::instrumentMetadataError`. Under `msconvert`'s default
  (`unknownInstrumentIsError` is true) they throw, so they become the same
  per-sample skip with the same marker.

**The whole `Reader_ABI` string vocabulary of the shipped executable**, extracted
from the binary rather than inferred:

```
[Reader_ABI::read] Error opening run          <- the per-sample skip
Error writing run                             <- per-run write failure, exit != 0
[Reader_ABI::read()] unhandled exception      <- thrown, whole file
[Reader_ABI::readIds()] unhandled exception   <- thrown
[Reader_ABI::fillInMetadata] unable to determine instrument model (
[Reader_ABI::fillInMetadata] unable to read instrument serial number (
[Reader_ABI::fillInMetadata] unable to read sample acquisition time (
```

### Two ways a sample can vanish with nothing said

Found by tracing the driver, not the reader. Both are real and both matter.

1. **Silent output-filename collision.** `fillInMetadata` leaves `msd.id` at the
   bare file basename when a sample's name is a substring of it. `msconvert`
   derives the output path from `msd.run.id` and writes with no collision check,
   so two such samples write to *one* path and the second overwrites the first.
2. **A sample whose index comes out empty.** `SpectrumList_ABI::createIndex`
   only indexes cycles with data, so a sample with none yields an mzML with no
   records and no warning.

### One hazard that is out of scope, stated rather than hidden

`getSampleCount()` **is** `getSampleNames().size()`, and `getSampleNames()` takes
whatever length the vendor library returned. The one reconciliation that would
catch a short list — against the vendor's own sample count — is **commented out**
upstream, directly beneath a comment observing that *some files have more
samples than sample names*. So the enumerated set is the provider's statement of
intent, and no evidence available to this boundary can check it against the
container.

## Route A: rejected, because it does not exist

A source-side manifest was looked for first and is not obtainable from this
installation:

| Attempt | Result |
| --- | --- |
| `msaccess -x metadata` on the ten-sample bundle | one output file, `sampleList:` **empty** — it takes the reader's *single*-run overload and never sees samples 2..N |
| `msconvert --verbose` | nothing about runs |
| `msconvert --runIndexSet 0-4` | five outputs, exit 0 — but the filter is applied to the vector the reader already returned, so it counts samples that *read successfully*: circular |
| `msconvert --runIndexSet 99` | exit 1, `No runs correspond to the specified indices` — an out-of-range probe, still after the full read |
| any shipped executable calling `readIds` | **none**; `readIds` exists in the library and no command-line tool at that revision calls it |
| `msdir --detailed`, the one upstream tool that prints a line per run | **not in this installation.** Upstream builds it and it is absent from the eighteen executables here. Even if present it would not be an independent manifest: it goes through the same `Reader_ABI::read`, so a sample that fails to open simply gets no line — it cannot cross-check the reader against itself |

Reading the sample table out of the container would need a FAT-walking
compound-file parser this boundary deliberately does not have.

The eighteen executables in this installation, for the record: `chainsaw`,
`idcat`, `idconvert`, `msaccess`, `msbenchmark`, `mscat`, `msconvert`,
`MSConvertGUI`, `msistats`, `mspicture`, `peakaboo`, `pepcat`, `pepsum`,
`qtofpeakpicker`, `seems`, `sldout`, `ThermoRawMetaDump`, `txt2mzml`.

## Route B: the proof, and why it is a conjunction

Reading the error stream is **necessary and not sufficient** — the two silent
paths above emit nothing. Completeness is established only when all five hold:

| # | Link | Enforced by | Refuses |
| - | ---- | ----------- | ------- |
| 1 | the backend exited cleanly | the lifecycle | whole-file failure; any write failure |
| 2 | declared set == discovered set | ADR 0022's declaration check | the silent overwrite collision; injected members |
| 3 | every member validated, whole set published | the output-set lifecycle | the record-free member; partial publication |
| 4 | complete error stream, no per-sample marker | `sciex_completeness` | the read-time skip |
| 5 | argv asked for no subset | `sciex_completeness` | `--runIndexSet` |

Two of the five are new. Three already existed for other reasons and turn out to
close exactly the holes an error-stream audit cannot see.

## Real measurements

### The hazard, reproduced

A throwaway compound-file walker located `SampleSubtree/Sample5` inside a copy of
the ten-sample acquisition and zeroed **only that sample's own streams**; the
header, FAT, directory and the other nine samples are byte-identical to the
original.

| | value |
| --- | --- |
| exit code | **0** |
| declared outputs | 9 |
| files written | 9 |
| stderr | one `[Reader_ABI::read] Error opening run 5 …` marker |
| pre-slice MSCanvas verdict | **`fully_finalized`, 9 members** — the false claim |

Breaking two samples gives two markers naming runs 3 and 7, eight outputs, exit
0. A clean run gives **zero stderr bytes**.

### Every per-sample stream, broken in turn

Each zeroable stream of `Sample5`, one at a time:

| stream | outputs | markers |
| --- | --- | --- |
| `Idx` | 9 | 1 |
| `Rsrc` | 9 | 1 |
| `Log`, `RealTimeSettings`, `TDCStatistics`, `TOFCalibrationData` | 10 | 0 |

**No silent skip observed**: every lost sample produced exactly one marker, and
no marker appeared without a lost sample.

### The collision, reproduced

No corruption at all — only a file name. A copy named
`20070918_En_01_and_20070918_En_02.wiff` makes samples 1 and 2 share an output
path:

| | value |
| --- | --- |
| exit code | **0** |
| `writing output file:` lines | **10** (one name twice) |
| files written | **9** |
| stderr | **0 bytes**, no marker |

An error-stream audit alone would call this complete. The declared-set check
refuses it: `multi_output_set_not_as_declared`, nothing published.

### Failure shapes that are already visible

| Damage | exit | shape |
| --- | --- | --- |
| companion truncated to 90/70/50/30 % | 1 | `Error writing run N`, refused on exit code |
| primary truncated to 95 % | 1 | `Error writing run 10` |
| primary truncated to 80 % or less | 1 | whole file unreadable, no outputs |

### Success evidence, through a workspace handle

All three acquisitions ADR 0022 pins, admitted through the private workspace
service and converted from a `DatasetId`:

| | Enolase | PressureTrace1 | 201208-378803 |
| --- | --- | --- | --- |
| Group outcome | `fully_finalized` | `fully_finalized` | `fully_finalized` |
| Members published | 10 | 1 | 1 |
| Completeness | **established** | **established** | **established** |
| `sample_count` | 10 | 1 | 1 |
| Proof method | `reader_error_audit_v1` | same | same |
| Validation | `output_only`, not fully verified | same | same |

### Discrimination, on the real backend

| Acquisition | Group outcome | Refusal | Files written |
| --- | --- | --- | --- |
| one sample's streams zeroed | `refused_before_publication` | `source_sample_failure_observed` | **0** |
| colliding output names | `refused_before_publication` | `multi_output_set_not_as_declared` | **0** |

The same runs against the pre-slice boundary published nine files and reported
`fully_finalized`.

## Deterministic suite and mutations

Vendor-free and backend-free. The audit is covered over: a clean stream; one
marker; several markers; a marker inside a stream that is not valid UTF-8; a
truncated stream; a failure *in* a truncated stream; an unclassifiable reader
failure; five kinds of ordinary noise that must **not** read as a sample failure
(including `Error writing run` and a bare `Error opening run` without the
prefix); a filtered argv; an unclean exit; zero published members; and the
typestate itself — that the positive value cannot be built without an
examination. The lifecycle is covered over: an incomplete run publishes nothing
and keeps no positive evidence; a truncated stream publishes nothing; a complete
run publishes and carries its evidence bound to the executable digest; a skipped
set is not complete; and the evidence entry point is never asked, so a stderr
full of markers changes nothing about it.

**Eight focused mutations, all red:** the marker ignored; a truncated stream
treated as complete; an unclassifiable failure waved through; a filtered run
judged complete; completeness judged after publication instead of before; a
partially published set counted complete; the SCIEX family no longer asked; and
the declared-set check removed.

## What is claimed, and what is not

**Claimed:** for an admitted SCIEX bundle on this exact executable, every sample
the reader identified produced its own admitted, validated, published mzML — or
nothing was published at all.

**Not claimed:** fidelity of any output (still `output_only`, still not fully
verified); anything about samples the reader never identified; that any other
provider build behaves this way; and that `fully_finalized` means completeness —
it keeps ADR 0021's meaning and the two are reported separately.

## Cleanup

Every acquisition, companion, damaged copy, converted output, destination and
scratch directory was deleted after measurement. No vendor data is tracked and
no local path appears in this record.
