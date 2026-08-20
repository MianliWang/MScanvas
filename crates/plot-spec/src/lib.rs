//! Renderer-independent semantic plot specifications.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlotKind {
    Chromatogram,
    CentroidSpectrum,
    ProfileSpectrum,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AxisSpec {
    pub label: String,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeriesSpec {
    pub id: String,
    pub label: String,
    pub x: Vec<f64>,
    pub y: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlotSpec {
    pub schema_version: u32,
    pub kind: PlotKind,
    pub title: Option<String>,
    pub x_axis: AxisSpec,
    pub y_axis: AxisSpec,
    pub series: Vec<SeriesSpec>,
}

impl PlotSpec {
    pub const SCHEMA_VERSION: u32 = 1;

    #[must_use]
    pub fn new(kind: PlotKind, x_axis: AxisSpec, y_axis: AxisSpec) -> Self {
        Self {
            schema_version: Self::SCHEMA_VERSION,
            kind,
            title: None,
            x_axis,
            y_axis,
            series: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plot_spec_round_trips_as_json() {
        let spec = PlotSpec::new(
            PlotKind::Chromatogram,
            AxisSpec {
                label: "Retention time".into(),
                unit: Some("min".into()),
            },
            AxisSpec {
                label: "Intensity".into(),
                unit: None,
            },
        );

        let json = serde_json::to_string(&spec).expect("serialize plot spec");
        let decoded: PlotSpec = serde_json::from_str(&json).expect("deserialize plot spec");

        assert_eq!(decoded, spec);
    }

    // TEMPORARY PROBE -- DELETE. A disposable trigger check, not product code.
    // This branch and its pull request are closed and deleted immediately.
    #[test]
    fn temporary_probe_a_new_plot_spec_carries_no_series() {
        let spec = PlotSpec::new(
            PlotKind::CentroidSpectrum,
            AxisSpec {
                label: "m/z".into(),
                unit: None,
            },
            AxisSpec {
                label: "Intensity".into(),
                unit: None,
            },
        );

        assert_eq!(spec.schema_version, PlotSpec::SCHEMA_VERSION);
        assert_eq!(spec.kind, PlotKind::CentroidSpectrum);
        assert_eq!(spec.title, None);
        assert!(spec.series.is_empty());
        assert_eq!(spec.x_axis.label, "m/z");
        assert_eq!(spec.y_axis.label, "Intensity");
        assert_eq!(spec.x_axis.unit, None);
        assert_eq!(spec.y_axis.unit, None);
    }
}
