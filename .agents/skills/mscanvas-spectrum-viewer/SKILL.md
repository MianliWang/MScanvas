---
name: mscanvas-spectrum-viewer
description: Design, implement or review MSCanvas chromatogram, spectrum, scan-table, linked-selection and scientific figure behavior. Use for plotting, navigation, large-array performance, annotations or plot/data export.
---

# MSCanvas spectrum viewer

1. Read `docs/architecture/FIGURE_MODEL.md`, viewer feature entries and linked-view workflow.
2. Identify data representation, units, point counts, loading strategy and interaction state.
3. Render profile spectra as continuous lines and centroid spectra as sticks; never blur the distinction.
4. Keep TIC/BPC/XIC and absolute/relative intensity semantics explicit.
5. Treat hover as transient preview and click/keyboard selection as persistent inspectable state.
6. Synchronize chromatogram marker, scan table, spectrum and inspector bidirectionally without update loops.
7. Keep high-frequency pointer state out of broad React/global state; use bounded refs/renderer state and throttled semantic updates.
8. Plan downsampling, viewport clipping, virtualization and cache behavior for realistic data scale.
9. Keep on-screen rendering and export derived from shared PlotSpec/FigureSpec semantics.
10. Test empty/single-point/extreme-intensity/profile/centroid/large-scan cases, keyboard operation, exported units and current/full-range behavior.
