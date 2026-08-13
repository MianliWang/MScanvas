//! Renderer-independent semantic plot specifications, and one renderer of them.
//!
//! Two modules with a one-way dependency, which is the whole architecture in
//! miniature:
//!
//! - [`spec`] is what a figure *means*. It names no renderer, no component, no
//!   stylesheet, no path and no command. It is what the screen and the export
//!   must agree about.
//! - [`svg`] is one way to draw that. It reads the specification; the
//!   specification cannot read it.
//!
//! The screen renderer is deliberately **not** here. It lives in the desktop
//! application, in TypeScript, because interactive rendering belongs where the
//! pointer is -- and it consumes the same semantic facts rather than the same
//! drawing code. Sharing semantics is the requirement; sharing a drawing
//! technology is not.
//!
//! Nothing in this crate is reachable from a user-facing surface yet. It is the
//! foundation the figure-export milestone will be built on, proved on its own
//! terms first.

pub mod spec;
pub mod svg;

#[cfg(test)]
mod tests;

pub use spec::{
    AxisSpec, Caption, DataScope, DecodeError, Domain, FigureSize, FigureSpec, FigureTheme, Label,
    MAX_CAPTION_CHARS, MAX_FIGURE_EDGE, MAX_LABEL_CHARS, MAX_PANELS, Marker, PanelSpec, PlotKind,
    ReductionRule, SCHEMA_VERSION, SeriesSpec, SpecError, SpectrumRepresentation, StyleRole,
    UnitState,
};
pub use svg::render;
