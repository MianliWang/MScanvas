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
}
