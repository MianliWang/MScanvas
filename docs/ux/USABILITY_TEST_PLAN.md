# Usability test plan

## Purpose

Validate task structure before expensive backend integration and establish repeatable regression tasks.

## Representative participants

Prefer a mix of:

- routine MSConvertGUI users;
- MZmine/OpenMS/Skyline users;
- core-facility or batch-processing users;
- one technically capable but less mass-spec-specialized user for terminology/discoverability checks.

Three to five participants are useful for early structural comparisons; findings are directional, not statistical proof.

## Prototype tasks

1. Add three acquisitions and a folder; identify a duplicate.
2. Remove two selected rows without touching source files.
3. Clear the entire idle workspace.
4. Open an acquisition and find a spectrum near a stated RT.
5. Move to the next MS2 scan and identify precursor m/z.
6. Convert only two selected files to compressed mzML without additional centroiding.
7. Recover from one output-permission failure and retry it.
8. Export the current chromatogram and spectrum as a clean light-theme figure.

## Measures

- completion and assistance required;
- task time (used comparatively, not as a universal target);
- wrong clicks, backtracks and mode confusion;
- terms participants hesitate over;
- missed feedback and incorrect assumptions;
- perceived difficulty (single ease question);
- qualitative comments and desired shortcuts.

## Acceptance signals

- Primary actions are found without instruction.
- Users correctly understand that list removal does not delete data.
- Users can explain whether centroiding will occur before conversion.
- Linked selection is understood after one interaction.
- Failure recovery does not require rebuilding the batch.
- Exported figure expectation matches the preview.

## Recording

Store anonymized notes under a non-source-controlled research location unless participants explicitly consent. Commit synthesized findings and design decisions, not raw sensitive recordings.
